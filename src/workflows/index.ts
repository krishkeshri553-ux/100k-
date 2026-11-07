import { mkdir, writeFile } from "node:fs/promises";
import { brain } from "../brain/index.js";
import { suggestTimes } from "../calendar/booking.js";
import type { Prospect } from "../db/types.js";
import { getSetting, logEvent, setIntegrationStatus, setSetting } from "../lib/audit.js";
import { config } from "../lib/config.js";
import { idemKey, normaliseForCompare, sha256 } from "../lib/hash.js";
import { addDays, localDate, zonedParts } from "../lib/time.js";
import { wakeSnoozed } from "../approvals/index.js";
import { draftPost, generateIdeas, scheduleWeek } from "../content/index.js";
import { analyseProspect } from "../leads/reactivation.js";
import { draftOutreach } from "../outreach/drafts.js";
import { isBlocked } from "../outreach/guardrails.js";
import { moveStage } from "../pipeline/stages.js";
import { dailyReport, mondayOf, weeklyReport } from "../reports/index.js";
import { analyseSalesConversation } from "../sales/agent.js";
import { createBackup } from "./backup.js";
import { runWorkflow, type Ctx, type WorkflowName } from "./runner.js";

const tz = () => config.calendar.owner_timezone;
const ACTIVE_DRAFT = new Set(["pending_approval", "approved", "snoozed", "blocked"]);

function needsAnalysis(p: Prospect, latestMessageAt: string | null, now: Date) {
  if (!p.analysed_at) return true;
  if (latestMessageAt && latestMessageAt > p.analysed_at) return true;
  return now.getTime() - new Date(p.analysed_at).getTime() > 7 * 86_400_000;
}

/** MORNING: review old leads, rescore, follow-ups due, outreach drafts, priority list. */
export async function morning(ctx: Ctx) {
  const { store, ai, now } = ctx;
  const today = localDate(now, tz());
  const woke = await wakeSnoozed(store, today);
  const prospects = await store.select("prospects");
  const messages = await store.select("messages");
  const latest = new Map<string, string>();
  for (const m of messages) if ((latest.get(m.prospect_id) ?? "") < m.created_at) latest.set(m.prospect_id, m.created_at);

  let analysed = 0, aiErrors = 0;
  for (const p of prospects.filter((p) => needsAnalysis(p, latest.get(p.id) ?? null, now)).slice(0, config.revenue.caps.max_classifications_per_run)) {
    const r = await analyseProspect(store, ai, p, { now, source: "workflow:morning" });
    analysed++;
    if (r.ai_error) aiErrors++;
  }

  const fresh = await store.select("prospects");
  const drafts = await store.select("drafts");
  const hasActive = new Set(drafts.filter((d) => ACTIVE_DRAFT.has(d.status)).map((d) => d.prospect_id));
  const candidates = fresh
    .filter((p) => p.contact_status === "ok" && !["won", "lost", "appointment_booked", "attended", "proposal_sent"].includes(p.stage))
    .filter((p) => ["hot", "high", "warm"].includes(p.score_class ?? ""))
    .filter((p) => !hasActive.has(p.id))
    .filter((p) => (p.next_action_due ? p.next_action_due <= today : true))
    .filter((p) => !p.snoozed_until || p.snoozed_until <= today)
    .sort((a, b) => (a.follow_up_priority ?? 9) - (b.follow_up_priority ?? 9) || (b.score ?? 0) - (a.score ?? 0));
  let drafted = 0, skipped = 0;
  for (const p of candidates.slice(0, config.revenue.caps.max_ai_drafts_per_morning)) {
    const r = await draftOutreach(store, ai, p, { source: "workflow:morning", now });
    if (r.created.length) drafted++;
    else skipped++;
  }

  const priority = (await store.select("prospects"))
    .filter((p) => p.contact_status === "ok" && !["won", "lost"].includes(p.stage) && p.score !== null)
    .sort((a, b) => (a.follow_up_priority ?? 9) - (b.follow_up_priority ?? 9) || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);
  const pending = (await store.select("drafts", { status: "pending_approval" })).length;
  if (priority.length) {
    await ctx.notifier.send(
      `Morning priority list — ${today}`,
      priority.map((p, i) => `${i + 1}. ${p.full_name} (${p.market}, ${p.score} ${p.score_class}) — ${p.next_action ?? "review"}`).join("\n") + `\n\n${pending} draft(s) awaiting your approval.`,
      { source: "workflow:morning" },
    );
  }
  return { woke_snoozed: woke, analysed, ai_errors: aiErrors, prospects_drafted: drafted, draft_skips: skipped, priority: priority.map((p) => p.id) };
}

/** DAYTIME: process new inbound records, analyse replies, prepare responses, booking opportunities, hot alerts. */
export async function daytime(ctx: Ctx) {
  const { store, ai, now } = ctx;
  await checkIntegrations(ctx);
  const unanalysed = (await store.select("messages", { analysed: false })).filter((m) => m.direction === "inbound");
  const prospectIds = [...new Set(unanalysed.map((m) => m.prospect_id))].slice(0, config.revenue.caps.max_reply_analyses_per_run);
  let replies = 0, hot = 0;
  for (const id of prospectIds) {
    let p = await store.get("prospects", id);
    if (!p) continue;
    const r = await analyseProspect(store, ai, p, { now, source: "workflow:daytime" });
    p = r.prospect;
    if (p.contact_status === "ok") {
      const s = await analyseSalesConversation(store, ai, p, { source: "workflow:daytime" });
      if (s.reply_draft) {
        const existing = await store.select("drafts", { prospect_id: p.id });
        const key = idemKey("draft", p.id, "reply", p.last_interaction_at ?? "none");
        if (!existing.some((d) => d.idempotency_key === key)) {
          for (const d of existing.filter((d) => d.status === "pending_approval" || d.status === "blocked")) await store.update("drafts", d.id, { status: "superseded" });
          const flags = s.reply_flags;
          if (s.sensitive_commitment_requested) flags.push({ code: "sensitive_request", severity: "review", message: "Prospect asked for: " + s.sensitive_commitment_requested + " — owner decision." });
          await store.insert("drafts", {
            prospect_id: p.id, kind: "reply", body: s.reply_draft, rationale: `${s.strategy}: ${s.prospect_type_reasoning}`, positioning: s.recommended_case_studies.map((c) => `${c.name}: ${c.claim} (${c.url})`).join("; ") || null,
            cta: s.discovery_questions[0] ?? null, status: isBlocked(flags) ? "blocked" : "pending_approval", guardrail_flags: flags, generated_by: s.method === "claude" ? "claude:" + ai.model : "rules",
            idempotency_key: key, body_hash: sha256(normaliseForCompare(s.reply_draft, p.first_name)), is_synthetic: p.is_synthetic,
          });
          replies++;
          await logEvent(store, { type: "draft.created", source: "workflow:daytime", prospect_id: p.id, summary: `Reply draft prepared for ${p.full_name} (${s.strategy.replace(/_/g, " ")})`, is_synthetic: p.is_synthetic });
        }
      }
      if (s.suggested_stage && s.suggested_stage !== "appointment_booked") p = await moveStage(store, p, s.suggested_stage, { actor: "system", source: "workflow:daytime", reason: "sales analysis" });
      if (s.needs_owner_attention || s.booking_readiness === "ready") {
        hot++;
        let times = "";
        if (s.booking_readiness === "ready" && ctx.cal.configured) {
          try {
            const slots = await suggestTimes(ctx.cal, p, now);
            times = slots.length ? "\nSuggested times:\n" + slots.slice(0, 4).map((x) => `• ${x.owner_label}${x.prospect_label ? ` (their time: ${x.prospect_label})` : ""}`).join("\n") : "\nNo free slots found in the next 10 days.";
          } catch (e) {
            times = `\n(Calendar unavailable: ${(e as Error).message.slice(0, 100)})`;
          }
        }
        await ctx.notifier.send(`🔥 ${p.full_name} needs you`, `${s.owner_attention_reason ?? "Ready to book a strategy call"} · score ${p.score} (${p.market}).${times}`, { level: "hot", prospectId: p.id, source: "workflow:daytime" });
      }
    }
    for (const m of unanalysed.filter((m) => m.prospect_id === id)) await store.update("messages", m.id, { analysed: true });
  }
  return { inbound_messages: unanalysed.length, prospects_processed: prospectIds.length, reply_drafts: replies, owner_alerts: hot };
}

/** CONTENT: ideas (weekly quota), schedule, drafts + visuals for the next two days into the approval queue. */
export async function contentWorkflow(ctx: Ctx) {
  const { store, ai, now } = ctx;
  if (!ai.available) {
    await setIntegrationStatus(store, "claude", "not_configured", "Content generation skipped: no ANTHROPIC_API_KEY");
    return { skipped: "Claude not configured" };
  }
  const today = localDate(now, tz());
  const monday = mondayOf(today);
  const items = await store.select("content_items");
  const thisWeek = items.filter((i) => i.created_at >= new Date(now.getTime() - 7 * 86_400_000).toISOString()).length;
  let ideas = 0;
  const want = Math.max(0, Math.min(7, config.revenue.caps.max_content_ideas_per_week - thisWeek));
  if (want > 0 && items.filter((i) => i.status === "idea" && !i.scheduled_for).length < 5) ideas = (await generateIdeas(store, ai, { count: want, weekOf: monday, source: "workflow:content" })).length;
  const scheduled = (await scheduleWeek(store, zonedParts(now, tz()).weekday === "sat" ? addDays(monday, 7) : monday)).length;
  let drafted = 0;
  for (const i of await store.select("content_items", { status: "idea" })) {
    if (i.scheduled_for && i.scheduled_for >= today && i.scheduled_for <= addDays(today, 2)) {
      await draftPost(store, ai, i.id, { source: "workflow:content" });
      drafted++;
    }
  }
  return { ideas_generated: ideas, scheduled, drafted };
}

export async function evening(ctx: Ctx) {
  const today = localDate(ctx.now, tz());
  const r = await dailyReport(ctx.store, today, { includeSynthetic: ctx.env.appEnv !== "production" });
  await ctx.notifier.send(`Daily report — ${today}`, r.body_md.slice(0, 1800), { source: "workflow:evening" });
  return { report_id: r.id, metrics: r.metrics };
}

export async function weekly(ctx: Ctx) {
  const today = localDate(ctx.now, tz());
  const r = await weeklyReport(ctx.store, ctx.ai, today, { includeSynthetic: ctx.env.appEnv !== "production" });
  await ctx.notifier.send(`Weekly revenue intelligence`, r.body_md.slice(0, 1800), { source: "workflow:weekly" });
  return { report_id: r.id };
}

export async function backup(ctx: Ctx) {
  const file = await createBackup(ctx.store, ctx.env.backupEncryptionKey);
  await mkdir("backups", { recursive: true });
  const path = `backups/backup-${ctx.now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  await writeFile(path, JSON.stringify(file));
  if (!file.encrypted) await logEvent(ctx.store, { type: "backup.unencrypted", source: "workflow:backup", summary: "Backup written WITHOUT encryption — set BACKUP_ENCRYPTION_KEY." });
  return { path, encrypted: file.encrypted, counts: file.counts };
}

/** Detects website changes so the owner re-verifies the business brain (never auto-edits claims). */
export async function knowledge(ctx: Ctx, fetchImpl: typeof fetch = fetch) {
  const pages = [brain.urls.home, brain.urls.pricing, brain.urls.authority_flywheel, brain.urls.real_estate, brain.urls.terms, brain.urls.refund_policy];
  const prev = await getSetting<Record<string, string>>(ctx.store, "website_fingerprints", {});
  const next: Record<string, string> = {};
  const changed: string[] = [];
  for (const url of pages) {
    try {
      const res = await fetchImpl(url, { headers: { "user-agent": "HustleGrowthz-RevenueDept/1.0 (+website change check)" } });
      let html = await res.text();
      // SPA: the HTML shell references hashed bundles; include them so content changes are detected.
      const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => new URL(m[1], url).toString()).slice(0, 4);
      for (const s of scripts) html += await (await fetchImpl(s)).text();
      next[url] = sha256(html.replace(/\s+/g, " "));
      if (prev[url] && prev[url] !== next[url]) changed.push(url);
    } catch (e) {
      next[url] = prev[url] ?? "";
      await logEvent(ctx.store, { type: "knowledge.fetch_failed", source: "workflow:knowledge", summary: `Could not fetch ${url}: ${(e as Error).message.slice(0, 120)}` });
    }
  }
  await setSetting(ctx.store, "website_fingerprints", next);
  if (changed.length) {
    await ctx.notifier.send("Website changed — re-verify the business brain", `Changed: ${changed.join(", ")}\nReview pricing/offer/terms in knowledge/business_brain.json (last verified ${brain.last_verified}). The AI keeps using the last verified version until you update it.`, { source: "workflow:knowledge" });
  }
  return { checked: pages.length, changed, first_run: Object.keys(prev).length === 0 };
}

export async function checkIntegrations(ctx: Ctx) {
  const { store, env } = ctx;
  await setIntegrationStatus(store, "claude", env.anthropicApiKey ? "connected" : "not_configured", env.anthropicApiKey ? `Model ${env.claudeModel}` : "ANTHROPIC_API_KEY missing — deterministic fallbacks in use");
  await setIntegrationStatus(store, "supabase", env.supabaseUrl ? "connected" : "not_configured", env.supabaseUrl ? "Persistent database" : "In-memory store (development only)");
  await setIntegrationStatus(store, "google_calendar", ctx.cal.configured ? "connected" : "not_configured", ctx.cal.configured ? `Calendar ${env.google.calendarId}` : "OAuth credentials missing — booking disabled");
  await setIntegrationStatus(store, "notifications", env.notifyWebhookUrl ? "connected" : "not_configured", env.notifyWebhookUrl ? "Webhook" : "Activity feed only");
  await setIntegrationStatus(store, "linkedin", "manual_only", "No authorised API access to personal messaging/InMail/publishing. All sending is manual by the owner.");
  const sn = config.salesNavigator;
  await setIntegrationStatus(store, "sales_navigator", "manual_only", sn.subscription_type ? `${sn.subscription_type} (verified ${sn.verified_on ?? "unknown"}) — user-operated` : "Subscription not yet verified — fill config/sales_navigator.json");
}

export const WORKFLOWS: Record<WorkflowName, (ctx: Ctx) => Promise<Record<string, unknown>>> = {
  morning, daytime, content: contentWorkflow, evening, weekly, backup, knowledge: (c) => knowledge(c),
};

/** Slot = one execution window. Daytime runs several times a day → hourly slot; others → daily/weekly. */
export function slotFor(name: WorkflowName, now: Date): string {
  const d = localDate(now, tz());
  if (name === "daytime") return `${d}T${String(zonedParts(now, tz()).hour).padStart(2, "0")}`;
  if (name === "weekly" || name === "knowledge") return `week-of-${mondayOf(d)}`;
  return d;
}

export async function run(ctx: Ctx, name: WorkflowName, opts: { force?: boolean; slot?: string } = {}) {
  return runWorkflow(ctx, name, opts.slot ?? slotFor(name, ctx.now), WORKFLOWS[name], { force: opts.force });
}

