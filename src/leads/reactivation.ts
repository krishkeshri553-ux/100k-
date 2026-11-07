import type { Ai } from "../ai/claude.js";
import { AiUnavailableError } from "../ai/claude.js";
import type { Store } from "../db/store.js";
import type { Message, Prospect } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { config } from "../lib/config.js";
import { idemKey } from "../lib/hash.js";
import { addDays, localDate } from "../lib/time.js";
import { moveStage } from "../pipeline/stages.js";
import { classifyByRules, classifyWithClaude, type Classification } from "./classify.js";
import { detectMarket, identityKey, normaliseEmail, normaliseLinkedinUrl, splitName } from "./identity.js";
import { parseImport, type ImportedContact, type ImportFormat } from "./importers.js";
import { scoreProspect } from "./score.js";

export interface ImportSummary {
  format: ImportFormat;
  contacts_in_file: number;
  prospects_created: number;
  prospects_merged: number;
  messages_added: number;
  messages_skipped_duplicate: number;
  marked_do_not_contact: number;
}

/** Find an existing prospect by any strong identifier (identity resolution across sources). */
export async function resolveProspect(store: Store, c: { linkedin_url: string | null; email: string | null; full_name: string; company: string | null }) {
  const li = normaliseLinkedinUrl(c.linkedin_url);
  if (li) {
    const hit = await store.findOne("prospects", { linkedin_url: li });
    if (hit) return hit;
  }
  const em = normaliseEmail(c.email);
  if (em) {
    const hit = await store.findOne("prospects", { email: em });
    if (hit) return hit;
  }
  const key = identityKey(c);
  const hit = await store.findOne("prospects", { identity_key: key });
  if (hit) return hit;
  // Name-only record created earlier (e.g. CRM without URL) should merge into a richer record later.
  if (!key.startsWith("n:")) {
    const nameOnly = await store.findOne("prospects", { identity_key: identityKey({ full_name: c.full_name }) });
    if (nameOnly && !nameOnly.linkedin_url && !nameOnly.email) return nameOnly;
  }
  return null;
}

const fill = <T>(current: T | null, incoming: T | null | undefined): T | null => (current === null || current === undefined || current === "" ? incoming ?? current : current);

export async function upsertContact(store: Store, c: ImportedContact, source: string, opts: { synthetic?: boolean } = {}) {
  const existing = await resolveProspect(store, c);
  const li = normaliseLinkedinUrl(c.linkedin_url);
  const em = normaliseEmail(c.email);
  let prospect: Prospect;
  let created = false;
  if (existing) {
    const patch: Partial<Prospect> = {
      linkedin_url: fill(existing.linkedin_url, li),
      email: fill(existing.email, em),
      company: fill(existing.company, c.company),
      title: fill(existing.title, c.title),
      headline: fill(existing.headline, c.headline),
      location: fill(existing.location, c.location),
      deal_value_estimate: fill(existing.deal_value_estimate, c.deal_value_estimate),
    };
    // Upgrade a weak identity key once a strong identifier is known.
    const stronger = identityKey({ ...existing, ...patch, full_name: existing.full_name });
    if (stronger !== existing.identity_key && !(await store.findOne("prospects", { identity_key: stronger }))) patch.identity_key = stronger;
    if (existing.market === "unknown" || existing.market === "other") {
      const m = detectMarket(patch.location, patch.headline, patch.company);
      if (m !== "unknown") patch.market = m;
    }
    if (c.notes) patch.research = { ...existing.research, notes: [existing.research?.notes, c.notes].filter(Boolean).join("\n") };
    prospect = await store.update("prospects", existing.id, patch);
  } else {
    const { first, last } = splitName(c.full_name);
    prospect = await store.insert("prospects", {
      identity_key: identityKey(c),
      full_name: c.full_name,
      first_name: first,
      last_name: last,
      linkedin_url: li,
      email: em,
      company: c.company,
      title: c.title,
      headline: c.headline,
      location: c.location,
      market: detectMarket(c.location, c.headline, c.company, c.title),
      source,
      deal_value_estimate: c.deal_value_estimate,
      research: c.notes ? { notes: c.notes } : {},
      is_synthetic: opts.synthetic ?? false,
    });
    created = true;
  }

  let added = 0, skipped = 0;
  for (const m of c.messages) {
    const { created: isNew } = await store.insertIfAbsent(
      "messages",
      { prospect_id: prospect.id, external_id: idemKey("msg", m.external_ref, m.body), direction: m.direction, channel: m.channel, sent_at: m.sent_at, body: m.body, source },
      ["external_id"],
    );
    if (isNew) added++;
    else skipped++;
  }
  if (added > 0) prospect = await refreshInteractionDates(store, prospect);

  let dnc = false;
  if (c.do_not_contact && prospect.contact_status === "ok") {
    prospect = await setDoNotContact(store, prospect, "do_not_contact", `Flagged in ${source} import`, "import");
    dnc = true;
  }
  return { prospect, created, added, skipped, dnc };
}

export async function refreshInteractionDates(store: Store, p: Prospect): Promise<Prospect> {
  const msgs = await store.select("messages", { prospect_id: p.id });
  const latest = (dir?: Message["direction"]) => msgs.filter((m) => !dir || m.direction === dir).map((m) => m.sent_at).sort().at(-1) ?? null;
  return store.update("prospects", p.id, { last_interaction_at: latest(), last_inbound_at: latest("inbound"), last_outbound_at: latest("outbound") });
}

export async function importFile(store: Store, text: string, owner: { name: string; linkedinUrl: string | null }, opts: { format?: ImportFormat; source?: string; synthetic?: boolean } = {}): Promise<ImportSummary> {
  const { format, contacts } = parseImport(text, owner, opts.format);
  const source = opts.source ?? format;
  const s: ImportSummary = { format, contacts_in_file: contacts.length, prospects_created: 0, prospects_merged: 0, messages_added: 0, messages_skipped_duplicate: 0, marked_do_not_contact: 0 };
  for (const c of contacts) {
    const r = await upsertContact(store, c, source, { synthetic: opts.synthetic });
    if (r.created) s.prospects_created++;
    else s.prospects_merged++;
    s.messages_added += r.added;
    s.messages_skipped_duplicate += r.skipped;
    if (r.dnc) s.marked_do_not_contact++;
  }
  await logEvent(store, {
    type: "import.completed",
    source: "import",
    summary: `Imported ${format}: ${s.prospects_created} new, ${s.prospects_merged} merged, ${s.messages_added} messages (${s.messages_skipped_duplicate} duplicates skipped)`,
    data: { ...s },
    is_synthetic: opts.synthetic ?? false,
  });
  return s;
}

export async function setDoNotContact(store: Store, p: Prospect, status: "do_not_contact" | "opted_out", reason: string, source: string, actor: "system" | "owner" = "system"): Promise<Prospect> {
  const updated = await store.update("prospects", p.id, { contact_status: status, contact_status_reason: reason, next_action: "Do not contact", next_action_due: null, follow_up_priority: 5 });
  // Withdraw anything waiting to be sent.
  for (const d of await store.select("drafts", { prospect_id: p.id })) {
    if (["pending_approval", "approved", "snoozed", "blocked"].includes(d.status)) await store.update("drafts", d.id, { status: "superseded", decided_at: new Date().toISOString() });
  }
  await logEvent(store, { type: "prospect.do_not_contact", source, actor, prospect_id: p.id, summary: `${p.full_name} marked ${status.replace(/_/g, " ")}: ${reason}`, data: { status, reason }, is_synthetic: p.is_synthetic });
  return updated;
}

export interface AnalysisResult {
  prospect: Prospect;
  classification: Classification;
  score: ReturnType<typeof scoreProspect>;
  ai_error: string | null;
}

/** Classify + score + next action for one prospect. Idempotent: re-running just refreshes the analysis. */
export async function analyseProspect(store: Store, ai: Ai, prospectIn: Prospect, opts: { now?: Date; useAi?: boolean; source?: string } = {}): Promise<AnalysisResult> {
  const now = opts.now ?? new Date();
  const source = opts.source ?? "workflow";
  let prospect = prospectIn;
  const msgs = await store.select("messages", { prospect_id: prospect.id });
  const rules = classifyByRules(prospect, msgs, now);
  let classification = rules;
  let aiError: string | null = null;
  if (opts.useAi !== false && ai.available && msgs.some((m) => m.direction === "inbound") && !rules.opted_out) {
    try {
      classification = await classifyWithClaude(ai, prospect, msgs, rules, now);
    } catch (e) {
      aiError = e instanceof AiUnavailableError ? null : (e as Error).message;
    }
  }

  if (classification.opted_out && prospect.contact_status === "ok") {
    prospect = await setDoNotContact(store, prospect, "opted_out", classification.opt_out_evidence ?? "Asked not to be contacted", source);
  }

  const withClass: Prospect = {
    ...prospect,
    lead_category: classification.category,
    interest_level: classification.interest_level,
    offer_fit: classification.offer_fit,
    previous_objection: classification.previous_objection ?? prospect.previous_objection,
  };
  const score = scoreProspect(withClass, now);
  const today = localDate(now, config.calendar.owner_timezone);
  const gap = config.revenue.follow_up.default_gap_days;
  const lastOut = prospect.last_outbound_at ? localDate(new Date(prospect.last_outbound_at), config.calendar.owner_timezone) : null;
  const due = prospect.contact_status !== "ok" || classification.follow_up_priority === 5 ? null : lastOut && addDays(lastOut, gap) > today ? addDays(lastOut, gap) : today;

  prospect = await store.update("prospects", prospect.id, {
    lead_category: classification.category,
    interest_level: classification.interest_level,
    offer_fit: classification.offer_fit,
    previous_objection: classification.previous_objection ?? prospect.previous_objection,
    conversation_summary: classification.summary,
    score: score.score,
    score_class: score.class_id,
    score_confidence: score.confidence,
    score_breakdown: score.breakdown,
    next_action: prospect.contact_status !== "ok" ? "Do not contact" : classification.recommended_next_action,
    next_action_due: prospect.contact_status !== "ok" ? null : due,
    follow_up_priority: classification.follow_up_priority,
    analysed_at: now.toISOString(),
  });

  const qualifies = prospect.contact_status === "ok" && ["hot", "high", "warm"].includes(score.class_id);
  if (qualifies) prospect = await moveStage(store, prospect, "qualified", { actor: "system", source, reason: `score ${score.score} (${score.class_label})` });
  if (msgs.some((m) => m.direction === "inbound")) prospect = await moveStage(store, prospect, "replied", { actor: "system", source, reason: "conversation history shows a reply" });
  if (["F_interested_never_booked", "C_asked_pricing", "E_received_proposal"].includes(classification.category)) prospect = await moveStage(store, prospect, "interested", { actor: "system", source, reason: classification.category });

  if (prospectIn.lead_category !== classification.category || prospectIn.score_class !== score.class_id) {
    await logEvent(store, {
      type: "lead.classified",
      source,
      prospect_id: prospect.id,
      summary: `${prospect.full_name} (${prospect.market}) classified ${classification.category.replace(/_/g, " ")} · score ${score.score} ${score.class_label}`,
      data: { category: classification.category, score: score.score, class: score.class_id, method: classification.method, recovered: isRecoverable(classification) },
      is_synthetic: prospect.is_synthetic,
    });
  }
  return { prospect, classification, score, ai_error: aiError };
}

/** "Old lead recovered" = an old conversation classified into a category worth re-opening. */
export function isRecoverable(c: Pick<Classification, "category" | "opted_out">) {
  return !c.opted_out && ["A_interested_inactive", "B_replied_then_silent", "C_asked_pricing", "D_requested_info", "E_received_proposal", "F_interested_never_booked", "G_ghosted_after_sales", "H_declined_may_revisit"].includes(c.category);
}
