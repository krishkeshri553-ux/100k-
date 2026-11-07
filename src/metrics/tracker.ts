import type { Store } from "../db/store.js";
import type { Appointment, ContentItem, Deal, Draft, EventRow, IntegrationStatus, Payment, Prospect, WorkflowRun } from "../db/types.js";
import { STAGE_LABELS } from "../db/types.js";
import { config } from "../lib/config.js";
import { localDate, monthStartUtc, nextCron, nextMonthStartUtc, zonedParts, zonedTimeToUtc } from "../lib/time.js";
import { isRecoverable } from "../leads/reactivation.js";

export interface TrackerData {
  prospects: Prospect[];
  drafts: Draft[];
  appointments: Appointment[];
  deals: Deal[];
  payments: Payment[];
  content: ContentItem[];
  events: EventRow[];
  runs: WorkflowRun[];
  integrations: IntegrationStatus[];
  settings: Record<string, unknown>;
}

export async function loadTrackerData(store: Store, opts: { includeSynthetic: boolean }): Promise<TrackerData> {
  const keep = <T extends { is_synthetic?: boolean }>(rows: T[]) => (opts.includeSynthetic ? rows : rows.filter((r) => !r.is_synthetic));
  const [prospects, drafts, appointments, deals, payments, content, events, runs, integrations, settings] = await Promise.all([
    store.select("prospects"), store.select("drafts"), store.select("appointments"), store.select("deals"), store.select("payments"),
    store.select("content_items"), store.select("events", {}, { order: { column: "occurred_at", ascending: false }, limit: 400 }),
    store.select("workflow_runs", {}, { order: { column: "started_at", ascending: false }, limit: 300 }), store.select("integration_status"), store.select("settings"),
  ]);
  return {
    prospects: keep(prospects), drafts: keep(drafts), appointments: keep(appointments), deals: keep(deals), payments: keep(payments),
    content: keep(content), events: keep(events), runs, integrations, settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
  };
}

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
const inRange = (iso: string | null | undefined, a: Date, b: Date) => !!iso && new Date(iso) >= a && new Date(iso) < b;

/** Every tracker number, computed only from stored rows. No defaults, no demo values. */
export function computeTrackerMetrics(d: TrackerData, now = new Date()) {
  const tz = config.calendar.owner_timezone;
  const mStart = monthStartUtc(now, tz);
  const mEnd = nextMonthStartUtc(now, tz);
  const today = localDate(now, tz);
  const targets = { min: Number(d.settings.monthly_revenue_target_min ?? config.revenue.targets.monthly_revenue_min), max: Number(d.settings.monthly_revenue_target_max ?? config.revenue.targets.monthly_revenue_max), clients: Number(d.settings.monthly_new_clients_target ?? config.revenue.targets.monthly_new_clients) };

  // ── Revenue ────────────────────────────────────────────────
  const dealById = new Map(d.deals.map((x) => [x.id, x]));
  const paidThisMonth = d.payments.filter((p) => p.status === "paid" && inRange(p.paid_at, mStart, mEnd));
  const collected = sum(paidThisMonth.map((p) => p.amount));
  const collectedVerified = sum(paidThisMonth.filter((p) => p.verified).map((p) => p.amount));
  const outstanding = d.payments.filter((p) => p.status === "outstanding");
  const won = d.deals.filter((x) => x.status === "won");
  const wonThisMonth = won.filter((x) => inRange(x.signed_at, mStart, mEnd));
  const open = d.deals.filter((x) => x.status === "open" || x.status === "proposal");
  const byKey = (key: (deal: Deal) => string | null) => {
    const m = new Map<string, number>();
    for (const p of paidThisMonth) {
      const k = key(dealById.get(p.deal_id)!) ?? "unknown";
      m.set(k, sum([m.get(k) ?? 0, p.amount]));
    }
    return [...m].map(([k, v]) => ({ key: k, amount: v })).sort((a, b) => b.amount - a.amount);
  };
  // Monthly collected cash, last 6 months (owner timezone).
  const nowParts = zonedParts(now, tz);
  const monthly: { month: string; collected: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    let y = nowParts.year, m = nowParts.month - i;
    while (m < 1) { m += 12; y--; }
    const a = zonedTimeToUtc(y, m, 1, 0, 0, tz);
    const b = m === 12 ? zonedTimeToUtc(y + 1, 1, 1, 0, 0, tz) : zonedTimeToUtc(y, m + 1, 1, 0, 0, tz);
    monthly.push({ month: `${y}-${String(m).padStart(2, "0")}`, collected: sum(d.payments.filter((p) => p.status === "paid" && inRange(p.paid_at, a, b)).map((p) => p.amount)) });
  }

  // ── Leads ──────────────────────────────────────────────────
  const active = d.prospects;
  const classOf = (c: string) => active.filter((p) => p.score_class === c).length;
  const qualified = active.filter((p) => p.contact_status === "ok" && ["hot", "high", "warm"].includes(p.score_class ?? "")).length;
  const recovered = active.filter((p) => p.lead_category && isRecoverable({ category: p.lead_category, opted_out: p.contact_status !== "ok" })).length;
  const followUpDue = active.filter((p) => p.contact_status === "ok" && p.next_action_due && p.next_action_due <= today && !["won", "lost"].includes(p.stage)).length;
  const pendingDrafts = d.drafts.filter((x) => x.status === "pending_approval" || x.status === "blocked");
  const awaitingApproval = new Set(pendingDrafts.map((x) => x.prospect_id)).size;

  // ── Outreach (this month). Sent = owner-confirmed only. ────
  const draftsThisMonth = d.drafts.filter((x) => inRange(x.created_at, mStart, mEnd));
  const sentThisMonth = d.drafts.filter((x) => x.status === "sent_manually" && inRange(x.sent_confirmed_at, mStart, mEnd));
  const replyEvents = d.events.filter((e) => e.type === "prospect.replied" && inRange(e.occurred_at, mStart, mEnd));
  const positive = replyEvents.filter((e) => e.data.sentiment === "positive").length;

  // ── Appointments ───────────────────────────────────────────
  const apptMonth = d.appointments.filter((a) => inRange(a.created_at, mStart, mEnd) && a.status !== "rescheduled");
  const upcoming = d.appointments.filter((a) => a.status === "confirmed" && new Date(a.start_at) > now).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const heldMonth = d.appointments.filter((a) => inRange(a.start_at, mStart, mEnd));

  // ── Content ────────────────────────────────────────────────
  const c = d.content;
  const published = c.filter((x) => x.status === "published");
  const withMetrics = published.filter((x) => x.metrics);

  // ── System health ──────────────────────────────────────────
  const lastOk = d.runs.find((r) => r.status === "succeeded") ?? null;
  const failed7d = d.runs.filter((r) => r.status === "failed" && new Date(r.started_at) > new Date(now.getTime() - 7 * 86_400_000));
  // A failure that was later retried successfully for the same slot isn't an open failure.
  const openFailures = failed7d.filter((f) => !d.runs.some((r) => r.workflow === f.workflow && r.slot === f.slot && r.status === "succeeded"));
  const nextRuns = Object.entries(config.schedule.workflows).map(([name, w]) => ({ name, at: nextCron(w.cron, now)?.toISOString() ?? null })).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  const lastSync = d.runs.find((r) => r.status === "succeeded" && ["morning", "daytime"].includes(r.workflow)) ?? null;
  const lastBackup = d.runs.find((r) => r.status === "succeeded" && r.workflow === "backup") ?? null;

  return {
    generated_at: now.toISOString(),
    period: { month: localDate(mStart, tz).slice(0, 7), timezone: tz },
    top: {
      target_min: targets.min, target_max: targets.max,
      collected_verified: collectedVerified, collected_recorded: collected,
      remaining_to_min: Math.max(0, targets.min - collectedVerified), remaining_to_max: Math.max(0, targets.max - collectedVerified),
      progress_pct: targets.min ? Math.round((collectedVerified / targets.min) * 1000) / 10 : 0,
      clients_closed: wonThisMonth.length, clients_target: targets.clients,
      appointments_booked: apptMonth.length, qualified_leads: qualified,
    },
    leads: {
      total: active.length, qualified, hot: classOf("hot"), high: classOf("high"), warm: classOf("warm"), low: classOf("low"), not_qualified: classOf("not_qualified"),
      unscored: active.filter((p) => p.score === null).length, old_recovered: recovered, follow_up_due: followUpDue, awaiting_approval: awaitingApproval,
      do_not_contact: active.filter((p) => p.contact_status !== "ok").length,
      by_market: ["dubai", "usa", "uk", "other", "unknown"].map((m) => ({ market: m, count: active.filter((p) => p.market === m).length })),
      by_stage: Object.entries(STAGE_LABELS).map(([s, label]) => ({ stage: s, label, count: active.filter((p) => p.stage === s).length })),
    },
    outreach: {
      connection_drafts: draftsThisMonth.filter((x) => x.kind === "connection_note").length,
      inmail_drafts: draftsThisMonth.filter((x) => x.kind === "inmail").length,
      other_drafts: draftsThisMonth.filter((x) => !["connection_note", "inmail"].includes(x.kind)).length,
      pending_approval: pendingDrafts.length,
      approved_not_sent: d.drafts.filter((x) => x.status === "approved").length,
      sent_confirmed: sentThisMonth.length,
      connections_accepted: d.drafts.filter((x) => x.kind === "connection_note" && x.outcome === "accepted" && inRange(x.updated_at, mStart, mEnd)).length,
      replies: replyEvents.length, positive_replies: positive,
      interested: active.filter((p) => p.stage === "interested").length,
      inmail_credits_known: typeof d.settings.inmail_credits_balance === "number" ? (d.settings.inmail_credits_balance as number) : null,
    },
    appointments: {
      booked_this_month: apptMonth.length,
      upcoming: upcoming.length,
      upcoming_list: upcoming.slice(0, 5).map((a) => ({ id: a.id, start_at: a.start_at, prospect: d.prospects.find((p) => p.id === a.prospect_id)?.full_name ?? "—" })),
      attended: heldMonth.filter((a) => a.status === "attended").length,
      no_shows: heldMonth.filter((a) => a.status === "no_show").length,
      rescheduled: d.appointments.filter((a) => a.status === "rescheduled" && inRange(a.updated_at, mStart, mEnd)).length,
      qualified_opportunities: heldMonth.filter((a) => a.qualified).length,
    },
    revenue: {
      deals_won_this_month: wonThisMonth.length,
      collected_verified: collectedVerified,
      collected_recorded: collected,
      outstanding_invoices: outstanding.length,
      outstanding_amount: sum(outstanding.map((p) => p.amount)),
      avg_deal_value: won.length ? Math.round(sum(won.map((x) => x.contract_value)) / won.length) : null,
      pipeline_value: sum(open.map((x) => x.contract_value)),
      forecast_value: sum(open.filter((x) => x.probability !== null).map((x) => x.contract_value * (x.probability ?? 0))),
      forecast_unweighted_deals: open.filter((x) => x.probability === null).length,
      signed_value_this_month: sum(wonThisMonth.map((x) => x.contract_value)),
      by_market: byKey((x) => x.market),
      by_source: byKey((x) => x.lead_source),
      monthly,
    },
    content: {
      ideas: c.filter((x) => x.status === "idea").length,
      drafted: c.filter((x) => ["draft", "pending_approval"].includes(x.status)).length,
      approved: c.filter((x) => x.status === "approved").length,
      published: published.length,
      scheduled: c.filter((x) => x.scheduled_for && x.scheduled_for >= today && x.status !== "published").length,
      with_metrics: withMetrics.length,
      reactions: withMetrics.length ? sum(withMetrics.map((x) => x.metrics?.reactions ?? 0)) : null,
      comments: withMetrics.length ? sum(withMetrics.map((x) => x.metrics?.comments ?? 0)) : null,
      impressions: withMetrics.some((x) => x.metrics?.impressions) ? sum(withMetrics.map((x) => x.metrics?.impressions ?? 0)) : null,
      leads_attributed: sum(c.map((x) => x.leads_attributed)),
    },
    health: {
      automation_paused: d.settings.automation_paused === true,
      last_success: lastOk ? { workflow: lastOk.workflow, at: lastOk.finished_at ?? lastOk.started_at } : null,
      next_scheduled: nextRuns[0] ?? null,
      schedule: nextRuns,
      failed_jobs_7d: openFailures.length,
      failures: openFailures.slice(0, 5).map((r) => ({ workflow: r.workflow, at: r.started_at, error: (r.error ?? "").slice(0, 200) })),
      integrations: d.integrations.map((i) => ({ name: i.name, status: i.status, detail: i.detail, checked_at: i.checked_at })),
      pending_approvals: pendingDrafts.length + c.filter((x) => x.status === "pending_approval").length,
      last_sync: lastSync?.finished_at ?? null,
      last_backup: lastBackup?.finished_at ?? null,
    },
    feed: d.events.filter((e) => !e.type.startsWith("notify.")).slice(0, 40).map((e) => ({ at: e.occurred_at, type: e.type, source: e.source, actor: e.actor, summary: e.summary, prospect_id: e.prospect_id })),
  };
}

export type TrackerMetrics = ReturnType<typeof computeTrackerMetrics>;
