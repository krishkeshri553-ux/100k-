import { z } from "zod";
import type { Ai } from "../ai/claude.js";
import { CalendarNotConfigured, type CalendarApi } from "../calendar/google.js";
import { BookingError, bookAppointment, cancelAppointment, markAttendance, rescheduleAppointment, suggestTimes } from "../calendar/booking.js";
import type { Store } from "../db/store.js";
import { PIPELINE_STAGES, type PipelineStage } from "../db/types.js";
import type { Env } from "../lib/env.js";
import { logEvent, setSetting } from "../lib/audit.js";
import { ApprovalError, approveDraft, editDraft, markConnectionOutcome, markDoNotContact, markReplied, markSent, pendingApprovals, rejectDraft, snoozeDraft } from "../approvals/index.js";
import { ContentError, attributeLead, confirmPublished, draftPost, recordMetrics, setContentStatus } from "../content/index.js";
import { analyseProspect, importFile, upsertContact } from "../leads/reactivation.js";
import { computeTrackerMetrics, loadTrackerData } from "../metrics/tracker.js";
import { draftOutreach } from "../outreach/drafts.js";
import { moveStage } from "../pipeline/stages.js";
import { CompetitorError } from "../competitors/index.js";
import { RevenueError, addInvoice, createDeal, markPaid, updateDealStatus, voidInvoice } from "../revenue/index.js";
import { COOKIE, loginLocked, parseCookies, recordLogin, safeEqual, sessionCookie, signSession, verifySession } from "./auth.js";

export interface ApiRequest {
  method: string;
  path: string; // e.g. "metrics"
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: unknown;
  ip: string;
}
export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface ApiDeps {
  store: Store;
  ai: Ai;
  cal: CalendarApi;
  env: Env;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse => ({ status, body, headers: { "cache-control": "no-store", ...headers } });

const id = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve_draft"), id, body: z.string().max(4000).optional(), subject: z.string().max(200).nullable().optional(), acknowledge: z.array(z.string()).optional() }),
  z.object({ action: z.literal("edit_draft"), id, body: z.string().min(1).max(4000), subject: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("reject_draft"), id, reason: z.string().max(500).optional() }),
  z.object({ action: z.literal("snooze_draft"), id, until: isoDate }),
  z.object({ action: z.literal("mark_sent"), id, final_body: z.string().max(4000).optional() }),
  z.object({ action: z.literal("connection_outcome"), id, outcome: z.enum(["accepted", "declined", "pending"]) }),
  z.object({ action: z.literal("mark_replied"), prospect_id: id, text: z.string().max(5000).optional(), sentiment: z.enum(["positive", "neutral", "negative"]).optional() }),
  z.object({ action: z.literal("do_not_contact"), prospect_id: id, reason: z.string().max(500).default("Owner decision") }),
  z.object({ action: z.literal("set_stage"), prospect_id: id, stage: z.enum(PIPELINE_STAGES as unknown as [PipelineStage, ...PipelineStage[]]) }),
  z.object({ action: z.literal("snooze_prospect"), prospect_id: id, until: isoDate }),
  z.object({ action: z.literal("update_research"), prospect_id: id, research: z.object({
    posting_frequency: z.enum(["none", "irregular", "regular", "high"]).nullable().optional(), has_video: z.boolean().nullable().optional(), recent_post_at: z.string().nullable().optional(),
    ability_to_invest: z.enum(["high", "medium", "low"]).nullable().optional(), headcount: z.number().int().nonnegative().nullable().optional(), content_gap_notes: z.string().max(1000).nullable().optional(), notes: z.string().max(4000).nullable().optional(),
  }) }),
  z.object({ action: z.literal("reanalyse"), prospect_id: id }),
  z.object({ action: z.literal("generate_drafts"), prospect_id: id }),
  z.object({ action: z.literal("add_prospect"), full_name: z.string().min(2).max(200), linkedin_url: z.string().max(400).nullable().optional(), email: z.string().max(200).nullable().optional(), company: z.string().max(200).nullable().optional(), title: z.string().max(200).nullable().optional(), headline: z.string().max(400).nullable().optional(), location: z.string().max(200).nullable().optional(), notes: z.string().max(4000).nullable().optional(), source: z.enum(["sales_navigator_manual", "manual", "referral", "content"]).default("sales_navigator_manual") }),
  z.object({ action: z.literal("import_csv"), csv: z.string().min(10).max(4_000_000), format: z.enum(["linkedin_messages", "linkedin_connections", "crm_csv"]).optional() }),
  z.object({ action: z.literal("pause_automation") }),
  z.object({ action: z.literal("resume_automation") }),
  z.object({ action: z.literal("set_inmail_credits"), credits: z.number().int().min(0).max(10_000) }),
  z.object({ action: z.literal("suggest_times"), prospect_id: id }),
  z.object({ action: z.literal("book"), prospect_id: id, start: z.string(), confirmation: z.string().min(3).max(1000), attendee_email: z.string().email().nullable().optional(), notes: z.string().max(1000).nullable().optional() }),
  z.object({ action: z.literal("reschedule"), appointment_id: id, start: z.string(), confirmation: z.string().min(3).max(1000) }),
  z.object({ action: z.literal("cancel_appointment"), appointment_id: id, reason: z.string().max(500) }),
  z.object({ action: z.literal("attendance"), appointment_id: id, outcome: z.enum(["attended", "no_show"]), qualified: z.boolean().optional() }),
  z.object({ action: z.literal("create_deal"), prospect_id: id, contract_value: z.number().nonnegative(), plan: z.string().max(40).nullable().optional(), probability: z.number().min(0).max(1).nullable().optional(), status: z.enum(["open", "proposal"]).optional() }),
  z.object({ action: z.literal("deal_status"), deal_id: id, status: z.enum(["open", "proposal", "won", "lost"]), lost_reason: z.string().max(500).optional(), contract_value: z.number().nonnegative().optional() }),
  z.object({ action: z.literal("add_invoice"), deal_id: id, amount: z.number().positive(), due_at: isoDate.nullable().optional(), invoice_ref: z.string().max(80).nullable().optional() }),
  z.object({ action: z.literal("mark_paid"), payment_id: id, verified: z.boolean(), paid_at: z.string().optional() }),
  z.object({ action: z.literal("void_invoice"), payment_id: id }),
  z.object({ action: z.literal("content_status"), id, status: z.enum(["approve", "reject", "edit"]), body: z.string().max(6000).optional() }),
  z.object({ action: z.literal("content_draft"), id }),
  z.object({ action: z.literal("content_published"), id, url: z.string().max(500).nullable().optional() }),
  z.object({ action: z.literal("content_metrics"), id, impressions: z.number().int().nonnegative().nullable().optional(), reactions: z.number().int().nonnegative().nullable().optional(), comments: z.number().int().nonnegative().nullable().optional(), reposts: z.number().int().nonnegative().nullable().optional(), profile_views: z.number().int().nonnegative().nullable().optional(), dms: z.number().int().nonnegative().nullable().optional() }),
  z.object({ action: z.literal("attribute_lead"), id, prospect_id: id }),
]);
export type TrackerAction = z.infer<typeof ActionSchema>;

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const { store, env } = deps;
  const secure = env.appEnv === "production";
  if (!env.trackerPassphrase || !env.trackerSessionSecret || env.trackerSessionSecret.length < 32) {
    return json(503, { error: "Tracker is not configured: set TRACKER_PASSPHRASE and TRACKER_SESSION_SECRET (32+ chars)." });
  }
  // CSRF: state-changing requests must come from our page (custom header + same-origin, SameSite=Strict cookie).
  if (req.method !== "GET") {
    if (req.headers["x-hg-csrf"] !== "1") return json(403, { error: "Missing CSRF header" });
    const origin = req.headers["origin"];
    const host = req.headers["x-forwarded-host"] ?? req.headers["host"];
    if (origin && host && new URL(origin).host !== host) return json(403, { error: "Cross-origin request refused" });
  }

  if (req.path === "login" && req.method === "POST") {
    if (await loginLocked(store)) return json(429, { error: "Too many failed attempts. Try again in 15 minutes." });
    const pass = z.object({ passphrase: z.string().max(500) }).safeParse(req.body);
    const ok = pass.success && safeEqual(pass.data.passphrase, env.trackerPassphrase);
    await recordLogin(store, ok, req.ip);
    if (!ok) return json(401, { error: "Incorrect passphrase" });
    return json(200, { ok: true }, { "set-cookie": sessionCookie(signSession(env.trackerSessionSecret), secure) });
  }
  if (req.path === "logout" && req.method === "POST") return json(200, { ok: true }, { "set-cookie": sessionCookie("", secure, 0) });

  const authed = verifySession(env.trackerSessionSecret, parseCookies(req.headers["cookie"])[COOKIE]);
  if (!authed) return json(401, { error: "Not signed in" });

  const includeSynthetic = env.appEnv !== "production";
  const keep = <T extends { is_synthetic?: boolean }>(rows: T[]) => (includeSynthetic ? rows : rows.filter((r) => !r.is_synthetic));

  try {
    if (req.method === "GET") {
      switch (req.path) {
        case "metrics": {
          const data = await loadTrackerData(store, { includeSynthetic });
          return json(200, { ...computeTrackerMetrics(data), environment: env.appEnv, synthetic_included: includeSynthetic });
        }
        case "leads": {
          const q = (req.query.q ?? "").toLowerCase().trim();
          const rows = keep(await store.select("prospects"))
            .filter((p) => !req.query.market || p.market === req.query.market)
            .filter((p) => !req.query.class || p.score_class === req.query.class)
            .filter((p) => !req.query.stage || p.stage === req.query.stage)
            .filter((p) => req.query.due !== "1" || (p.next_action_due && p.next_action_due <= new Date().toISOString().slice(0, 10)))
            .filter((p) => !q || [p.full_name, p.company, p.title, p.location, p.headline].some((x) => x?.toLowerCase().includes(q)))
            .sort((a, b) => (a.follow_up_priority ?? 9) - (b.follow_up_priority ?? 9) || (b.score ?? -1) - (a.score ?? -1))
            .slice(0, 300)
            .map((p) => ({ id: p.id, full_name: p.full_name, company: p.company, title: p.title, market: p.market, stage: p.stage, score: p.score, score_class: p.score_class, lead_category: p.lead_category, next_action: p.next_action, next_action_due: p.next_action_due, contact_status: p.contact_status, follow_up_priority: p.follow_up_priority }));
          return json(200, { leads: rows });
        }
        case "lead": {
          const p = await store.get("prospects", req.query.id ?? "");
          if (!p || (!includeSynthetic && p.is_synthetic)) return json(404, { error: "Not found" });
          const [messages, drafts, appointments, deals, events] = await Promise.all([
            store.select("messages", { prospect_id: p.id }, { order: { column: "sent_at", ascending: true } }),
            store.select("drafts", { prospect_id: p.id }, { order: { column: "created_at", ascending: false } }),
            store.select("appointments", { prospect_id: p.id }), store.select("deals", { prospect_id: p.id }),
            store.select("events", { prospect_id: p.id }, { order: { column: "occurred_at", ascending: false }, limit: 50 }),
          ]);
          const payments = (await Promise.all(deals.map((d) => store.select("payments", { deal_id: d.id })))).flat();
          return json(200, { prospect: p, messages, drafts, appointments, deals, payments, events });
        }
        case "approvals": {
          const a = await pendingApprovals(store);
          const approved = keep(await store.select("drafts", { status: "approved" }));
          const names = new Map(keep(await store.select("prospects")).map((p) => [p.id, { name: p.full_name, market: p.market, score: p.score, linkedin_url: p.linkedin_url }]));
          const withName = <T extends { prospect_id: string }>(rows: T[]) => rows.filter((r) => names.has(r.prospect_id)).map((r) => ({ ...r, prospect: names.get(r.prospect_id) }));
          return json(200, { drafts: withName(keep(a.drafts)), approved: withName(approved), content: keep(a.content) });
        }
        case "content":
          return json(200, { items: keep(await store.select("content_items", {}, { order: { column: "created_at", ascending: false }, limit: 200 })) });
        case "reports":
          return json(200, { reports: await store.select("reports", req.query.kind ? { kind: req.query.kind as "daily" } : {}, { order: { column: "period_start", ascending: false }, limit: 30 }) });
        default:
          return json(404, { error: "Unknown endpoint" });
      }
    }

    if (req.method === "POST" && req.path === "action") {
      const parsed = ActionSchema.safeParse(req.body);
      if (!parsed.success) return json(400, { error: "Invalid action", details: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) });
      return json(200, { ok: true, result: await act(parsed.data, deps) });
    }
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const err = e as Error;
    const known = [ApprovalError, BookingError, RevenueError, ContentError, CompetitorError, CalendarNotConfigured];
    if (known.some((k) => err instanceof k) || err.name === "CalendarNotConfigured") return json(422, { error: err.message });
    console.error(err);
    return json(500, { error: "Server error" });
  }
}

async function act(a: TrackerAction, { store, ai, cal, env }: ApiDeps): Promise<unknown> {
  const owner = { name: env.ownerName, linkedinUrl: env.ownerLinkedinUrl };
  switch (a.action) {
    case "approve_draft": return approveDraft(store, a.id, { body: a.body, subject: a.subject, acknowledgeFlags: a.acknowledge });
    case "edit_draft": return editDraft(store, a.id, a.body, a.subject);
    case "reject_draft": return rejectDraft(store, a.id, a.reason);
    case "snooze_draft": return snoozeDraft(store, a.id, a.until);
    case "mark_sent": return markSent(store, a.id, { finalBody: a.final_body });
    case "connection_outcome": return markConnectionOutcome(store, a.id, a.outcome);
    case "mark_replied": return markReplied(store, a.prospect_id, { text: a.text, sentiment: a.sentiment });
    case "do_not_contact": return markDoNotContact(store, a.prospect_id, a.reason);
    case "set_stage": {
      const p = await store.get("prospects", a.prospect_id);
      if (!p) throw new Error("Not found");
      return moveStage(store, p, a.stage, { actor: "owner", source: "tracker", reason: "owner updated stage" });
    }
    case "snooze_prospect": return store.update("prospects", a.prospect_id, { snoozed_until: a.until });
    case "update_research": {
      const p = await store.get("prospects", a.prospect_id);
      if (!p) throw new Error("Not found");
      const updated = await store.update("prospects", p.id, { research: { ...p.research, ...a.research }, stage: p.stage === "discovered" || p.stage === "qualified" ? "researched" : p.stage });
      return (await analyseProspect(store, ai, updated, { source: "tracker", useAi: false })).prospect;
    }
    case "reanalyse": {
      const p = await store.get("prospects", a.prospect_id);
      if (!p) throw new Error("Not found");
      const r = await analyseProspect(store, ai, p, { source: "tracker" });
      return { prospect: r.prospect, explanation: r.score.explanation };
    }
    case "generate_drafts": {
      const p = await store.get("prospects", a.prospect_id);
      if (!p) throw new Error("Not found");
      return draftOutreach(store, ai, p, { source: "tracker" });
    }
    case "add_prospect": {
      const r = await upsertContact(store, { full_name: a.full_name, linkedin_url: a.linkedin_url ?? null, email: a.email ?? null, company: a.company ?? null, title: a.title ?? null, headline: a.headline ?? null, location: a.location ?? null, notes: a.notes ?? null, deal_value_estimate: null, status_hint: null, last_contacted_at: null, do_not_contact: false, messages: [] }, a.source);
      await logEvent(store, { type: "prospect.added", source: "tracker", actor: "owner", prospect_id: r.prospect.id, summary: `${r.created ? "New" : "Existing"} prospect ${a.full_name} (${r.prospect.market}) ${r.created ? "added" : "updated"} from ${a.source.replace(/_/g, " ")}` });
      return (await analyseProspect(store, ai, r.prospect, { source: "tracker", useAi: false })).prospect;
    }
    case "import_csv": return importFile(store, a.csv, owner, { format: a.format });
    case "pause_automation":
    case "resume_automation": {
      const paused = a.action === "pause_automation";
      await setSetting(store, "automation_paused", paused);
      await logEvent(store, { type: paused ? "automation.paused" : "automation.resumed", source: "tracker", actor: "owner", summary: paused ? "EMERGENCY PAUSE: outreach, reply and content automation stopped" : "Automation resumed" });
      return { paused };
    }
    case "set_inmail_credits": {
      await setSetting(store, "inmail_credits_balance", a.credits);
      await logEvent(store, { type: "inmail.credits_set", source: "tracker", actor: "owner", summary: `InMail credit balance set to ${a.credits} (from Sales Navigator)` });
      return { credits: a.credits };
    }
    case "suggest_times": {
      const p = await store.get("prospects", a.prospect_id);
      if (!p) throw new Error("Not found");
      if (!cal.configured) throw new CalendarNotConfigured();
      return suggestTimes(cal, p);
    }
    case "book": return bookAppointment(store, cal, { prospectId: a.prospect_id, start: a.start, confirmation: a.confirmation, attendeeEmail: a.attendee_email, notes: a.notes });
    case "reschedule": return rescheduleAppointment(store, cal, a.appointment_id, a.start, a.confirmation);
    case "cancel_appointment": return cancelAppointment(store, cal, a.appointment_id, a.reason);
    case "attendance": return markAttendance(store, a.appointment_id, a.outcome, a.qualified);
    case "create_deal": return createDeal(store, { prospectId: a.prospect_id, contractValue: a.contract_value, plan: a.plan, probability: a.probability, status: a.status });
    case "deal_status": return updateDealStatus(store, a.deal_id, a.status, { lostReason: a.lost_reason, contractValue: a.contract_value });
    case "add_invoice": return addInvoice(store, { dealId: a.deal_id, amount: a.amount, dueAt: a.due_at, invoiceRef: a.invoice_ref });
    case "mark_paid": return markPaid(store, a.payment_id, { verified: a.verified, paidAt: a.paid_at });
    case "void_invoice": return voidInvoice(store, a.payment_id);
    case "content_status": return setContentStatus(store, a.id, a.status, a.body);
    case "content_draft": return draftPost(store, ai, a.id, { source: "tracker" });
    case "content_published": return confirmPublished(store, a.id, { url: a.url });
    case "content_metrics": {
      const { action: _a, id: cid, ...m } = a;
      return recordMetrics(store, cid, m);
    }
    case "attribute_lead": return attributeLead(store, a.id, a.prospect_id);
  }
}
