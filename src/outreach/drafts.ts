import { z } from "zod";
import type { Ai } from "../ai/claude.js";
import { brain } from "../brain/index.js";
import type { Store } from "../db/store.js";
import type { Draft, DraftKind, Message, Prospect } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { config } from "../lib/config.js";
import { idemKey, normaliseForCompare, sha256 } from "../lib/hash.js";
import { classifyByRules, prospectCard, renderConversation } from "../leads/classify.js";
import { moveStage } from "../pipeline/stages.js";
import { checkDraft, isBlocked } from "./guardrails.js";

const ACTIVE: Draft["status"][] = ["pending_approval", "approved", "snoozed", "blocked"];

/** Which message types make sense for this prospect right now. */
export function plannedKinds(p: Prospect, msgs: Message[]): DraftKind[] {
  if (p.contact_status !== "ok") return [];
  if (msgs.length === 0) {
    const connected = p.source === "linkedin_connections" || p.stage === "connected" || p.tags.includes("connected");
    const kinds: DraftKind[] = connected ? ["initial_message", "follow_up"] : ["connection_note", "initial_message", "follow_up"];
    if (config.salesNavigator.features.inmail !== false && !connected) kinds.push("inmail");
    return kinds;
  }
  const last = [...msgs].sort((a, b) => a.sent_at.localeCompare(b.sent_at)).at(-1)!;
  return [last.direction === "inbound" ? "reply" : "reactivation"];
}

const Package = z.object({
  insufficient_context: z.boolean().describe("true if there is no specific, verifiable detail to personalise with"),
  missing_info: z.array(z.string()),
  observation: z.string().describe("One specific, verifiable observation about this prospect's business or content, citing where it came from (input field). Empty if none."),
  positioning: z.string().describe("Which part of the Authority Flywheel™ is most relevant and why"),
  cta: z.string(),
  follow_up_in_days: z.number().int().min(1).max(30),
  rationale: z.string().describe("Why this message, why now, which sales strategy"),
  connection_note: z.string().nullable(),
  initial_message: z.string().nullable(),
  follow_up: z.string().nullable(),
  inmail_subject: z.string().nullable(),
  inmail_body: z.string().nullable(),
  reactivation: z.string().nullable(),
  reply: z.string().nullable(),
});
type PackageOut = z.infer<typeof Package>;

const INSTRUCTIONS = `Prepare LinkedIn outreach for ONE prospect. The owner will review, edit and send manually.
Write only the message types requested; set the others to null.
Limits: connection_note ≤ ${config.revenue.caps.connection_note_max_chars} chars, no links; messages ≤ ${config.revenue.caps.message_max_chars} chars; InMail subject ≤ 80 chars and body ≤ 1200 chars.
Every message must contain at least one detail that is specific to THIS prospect and present in the input (their market, company, role, a quoted line from their last message, a research note). Never fabricate observations about their content — if research says nothing about their content, don't claim you saw their posts.
For reactivation/reply: reference the actual last exchange, add something genuinely new, ask one low-friction question. Never "just bumping this".
Pricing: only the approved plans, only if they asked or it is clearly useful. No discounts. No guarantees. Do not claim results for real estate clients specifically.
Prefer Dubai/UAE-relevant angles for Dubai prospects (off-plan launches, investor buyers, crowded agent market); US/UK: listings, local market knowledge, seller trust.
CTA should usually be a low-friction question or a free 30-minute strategy call.
follow_up_in_days: when the owner should follow up if there's no response.`;

export interface DraftOptions {
  source?: string;
  now?: Date;
  /** Limit to specific kinds (else plannedKinds). */
  kinds?: DraftKind[];
}

export interface DraftResult {
  created: Draft[];
  skipped: string | null;
  generated_by: string;
}

function templatePackage(p: Prospect, kinds: DraftKind[], msgs: Message[]): PackageOut | null {
  const first = p.first_name ?? p.full_name.split(" ")[0];
  const marketLabel = config.revenue.markets.find((m) => m.id === p.market)?.label ?? null;
  const specifics = [p.company && `${p.company}`, p.title, marketLabel].filter(Boolean);
  const lastIn = [...msgs].filter((m) => m.direction === "inbound").sort((a, b) => a.sent_at.localeCompare(b.sent_at)).at(-1);
  if (specifics.length === 0 && !lastIn) return null; // nothing specific → refuse to write a generic message
  const where = p.company ? ` at ${p.company}` : "";
  // Brain rule: the website names the UAE, not Dubai — never imply a Dubai client roster.
  const mkt = p.market === "dubai" ? " in the UAE" : p.market === "usa" ? " in the US" : p.market === "uk" ? " in the UK" : "";
  const role = p.title ? p.title.toLowerCase() : "agent";
  const cls = classifyByRules(p, msgs);
  const quote = lastIn ? lastIn.body.replace(/\s+/g, " ").slice(0, 90) : null;
  const pricing = cls.category === "C_asked_pricing" ? ` To answer your pricing question properly: it's $999 a month, or $5,999 for a year, same full service either way.` : "";
  return {
    insufficient_context: true,
    missing_info: ["No researched content observation — template used. Add research and regenerate for a stronger message."],
    observation: specifics.join(" · "),
    positioning: "Authority Flywheel™: scripts, editing, publishing and the DM system, so the agent only records ~1 hour a week.",
    cta: "Low-friction question",
    follow_up_in_days: config.revenue.follow_up.default_gap_days,
    rationale: `Template fallback (Claude unavailable). Strategy: ${cls.strategy}.`,
    connection_note: kinds.includes("connection_note") ? `Hi ${first}, I work with real estate professionals${mkt} on short-form video and inbound. Your work as ${role}${where} caught my eye — would be good to connect.` : null,
    initial_message: kinds.includes("initial_message") ? `Thanks for connecting, ${first}. Quick question as a ${role}${where}${mkt}: is content something you're actively building right now, or does it get squeezed by showings and calls?` : null,
    follow_up: kinds.includes("follow_up") ? `${first}, one thought for you${where}: buyers and sellers tend to pick the agent they already feel they know. If a short script-to-post system that took about an hour of your week would help, I'm happy to show how we set it up. Worth a look?` : null,
    inmail_subject: kinds.includes("inmail") ? `${first} — content that wins listings${mkt}` : null,
    inmail_body: kinds.includes("inmail") ? `Hi ${first},\n\nI run HustleGrowthz. We handle short-form video for real estate professionals end to end — positioning, scripts, editing, publishing on four platforms and a DM system that turns comments into booked calls. You record for about an hour a week.\n\nAs ${role}${where}${mkt}, would it be useful to see how that would look for your market? A free 30-minute call is the easiest way.\n\nKrish` : null,
    reactivation: kinds.includes("reactivation") ? `Hi ${first}, picking this back up${quote ? ` — last time you mentioned "${quote}"` : ""}.${pricing} Is building your content still on your list${where}, or has the priority changed?` : null,
    reply: kinds.includes("reply") ? `Thanks ${first}${quote ? ` — on "${quote}"` : ""}.${pricing} Would a 30-minute call this week help? I can share how the system would work for you${where}.` : null,
  };
}

/**
 * Generate an outreach package for one prospect and queue each message for approval.
 * Idempotent per (prospect, kind, conversation state): re-running doesn't duplicate drafts.
 */
export async function draftOutreach(store: Store, ai: Ai, p: Prospect, opts: DraftOptions = {}): Promise<DraftResult> {
  const source = opts.source ?? "workflow";
  if (p.contact_status !== "ok") return { created: [], skipped: "contact restricted", generated_by: "none" };
  if (p.snoozed_until && p.snoozed_until > (opts.now ?? new Date()).toISOString().slice(0, 10)) return { created: [], skipped: "snoozed", generated_by: "none" };
  const msgs = await store.select("messages", { prospect_id: p.id });
  const existing = await store.select("drafts", { prospect_id: p.id });
  const state = p.last_interaction_at ?? "none";
  const wanted = (opts.kinds ?? plannedKinds(p, msgs)).filter((k) => {
    const key = idemKey("draft", p.id, k, state);
    return !existing.some((d) => d.idempotency_key === key) && !existing.some((d) => d.kind === k && ACTIVE.includes(d.status));
  });
  if (wanted.length === 0) return { created: [], skipped: "drafts already exist for current conversation state", generated_by: "none" };

  let pkg: PackageOut | null = null;
  let generatedBy = "template";
  if (ai.available) {
    try {
      pkg = await ai.json({
        task: "outreach_package",
        instructions: INSTRUCTIONS,
        input: `REQUESTED TYPES: ${wanted.join(", ")}\nOWNER: ${brain.company.founder.text}\nPROSPECT: ${prospectCard(p)}\nCLASSIFICATION: ${p.lead_category ?? "none"} · interest ${p.interest_level ?? "unknown"} · objection ${p.previous_objection ?? "none"}\nSUMMARY: ${p.conversation_summary ?? "none"}\nCONVERSATION:\n${msgs.length ? renderConversation(msgs, "Krish") : "(no prior messages)"}`,
        schema: Package,
        effort: "medium",
        maxTokens: 6000,
      });
      generatedBy = "claude:" + ai.model;
    } catch (e) {
      await logEvent(store, { type: "ai.error", source, prospect_id: p.id, summary: `Draft generation fell back to template: ${(e as Error).message.slice(0, 160)}`, is_synthetic: p.is_synthetic });
    }
  }
  pkg ??= templatePackage(p, wanted, msgs);
  if (!pkg) {
    await logEvent(store, { type: "draft.skipped", source, prospect_id: p.id, summary: `${p.full_name}: no specific details to personalise with — research needed before drafting`, is_synthetic: p.is_synthetic });
    return { created: [], skipped: "insufficient context for a personalised message", generated_by: "none" };
  }

  // Bodies drafted for other prospects in the last 14 days → generic-message detection.
  const since = new Date((opts.now ?? new Date()).getTime() - 14 * 86_400_000).toISOString();
  const recentDrafts = (await store.select("drafts")).filter((d) => d.prospect_id !== p.id && d.created_at >= since);
  const firstNames = new Map<string, string | null>();
  for (const d of recentDrafts) if (!firstNames.has(d.prospect_id)) firstNames.set(d.prospect_id, (await store.get("prospects", d.prospect_id))?.first_name ?? null);
  const recentOthers = recentDrafts.map((d) => normaliseForCompare(d.body, firstNames.get(d.prospect_id)));
  const own = [...existing.map((d) => d.body), ...msgs.filter((m) => m.direction === "outbound").map((m) => m.body)];

  const bodies: Partial<Record<DraftKind, { body: string | null; subject?: string | null }>> = {
    connection_note: { body: pkg.connection_note },
    initial_message: { body: pkg.initial_message },
    follow_up: { body: pkg.follow_up },
    inmail: { body: pkg.inmail_body, subject: pkg.inmail_subject },
    reactivation: { body: pkg.reactivation },
    reply: { body: pkg.reply },
  };
  const created: Draft[] = [];
  for (const kind of wanted) {
    const item = bodies[kind];
    if (!item?.body) continue;
    const flags = checkDraft(item.body, { kind, firstName: p.first_name, otherBodies: recentOthers, ownHistory: own, subject: item.subject });
    if (kind === "inmail" && config.salesNavigator.features.inmail === null) flags.push({ code: "inmail_unverified", severity: "review", message: "InMail availability on your Sales Navigator plan is not verified yet (config/sales_navigator.json)." });
    if (pkg.insufficient_context) flags.push({ code: "low_personalisation", severity: "review", message: "Limited prospect research — " + (pkg.missing_info.join("; ") || "add research for a stronger message") });
    const { row, created: isNew } = await store.insertIfAbsent(
      "drafts",
      {
        prospect_id: p.id, kind, body: item.body.trim(), subject: item.subject ?? null, rationale: pkg.rationale, observation: pkg.observation || null,
        positioning: pkg.positioning, cta: pkg.cta, follow_up_in_days: pkg.follow_up_in_days, status: isBlocked(flags) ? "blocked" : "pending_approval",
        guardrail_flags: flags, generated_by: generatedBy, idempotency_key: idemKey("draft", p.id, kind, state), body_hash: sha256(normaliseForCompare(item.body, p.first_name)),
        is_synthetic: p.is_synthetic,
      },
      ["idempotency_key"],
    );
    if (isNew) {
      created.push(row);
      recentOthers.push(normaliseForCompare(row.body, p.first_name));
    }
  }
  if (created.length) {
    await moveStage(store, p, "outreach_drafted", { actor: "system", source, reason: `${created.length} draft(s)` });
    const fresh = (await store.get("prospects", p.id))!;
    await moveStage(store, fresh, "pending_approval", { actor: "system", source, reason: "awaiting owner approval" });
    await logEvent(store, {
      type: "draft.created", source, prospect_id: p.id,
      summary: `${created.map((d) => d.kind.replace(/_/g, " ")).join(", ")} drafted for ${p.full_name} — awaiting approval${created.some((d) => d.status === "blocked") ? " (some blocked by guardrails)" : ""}`,
      data: { draft_ids: created.map((d) => d.id), generated_by: generatedBy }, is_synthetic: p.is_synthetic,
    });
  }
  return { created, skipped: null, generated_by: generatedBy };
}
