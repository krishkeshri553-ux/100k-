import { z } from "zod";
import type { Ai } from "../ai/claude.js";
import type { Store } from "../db/store.js";
import type { Report } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { config } from "../lib/config.js";
import { addDays, dayStartUtc, localDate, zonedParts, zonedTimeToUtc } from "../lib/time.js";
import { contentPerformance } from "../content/index.js";
import { seniority, suggestWeights } from "../leads/score.js";
import { competitorInsights } from "../competitors/index.js";

const tz = () => config.calendar.owner_timezone;
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Published per-MTok USD prices used only for the cost-per-client estimate in the weekly report. */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01 },
};

function dayBounds(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { a: zonedTimeToUtc(y, m, d, 0, 0, tz()), b: zonedTimeToUtc(y, m, d + 1, 0, 0, tz()) };
}
const within = (iso: string | null | undefined, a: Date, b: Date) => !!iso && new Date(iso) >= a && new Date(iso) < b;

export async function dailyReport(store: Store, date: string, opts: { includeSynthetic?: boolean } = {}): Promise<Report> {
  const { a, b } = dayBounds(date);
  const keep = <T extends { is_synthetic?: boolean }>(r: T[]) => (opts.includeSynthetic ? r : r.filter((x) => !x.is_synthetic));
  const [prospects, drafts, events, appts, deals, payments, runs, content] = await Promise.all([
    store.select("prospects").then(keep), store.select("drafts").then(keep), store.select("events").then(keep), store.select("appointments").then(keep),
    store.select("deals").then(keep), store.select("payments").then(keep), store.select("workflow_runs"), store.select("content_items").then(keep),
  ]);
  const ev = (type: string) => events.filter((e) => e.type === type && within(e.occurred_at, a, b));
  const m = {
    prospects_discovered: prospects.filter((p) => within(p.created_at, a, b)).length,
    newly_qualified: ev("prospect.stage_changed").filter((e) => e.data.to === "qualified").length,
    follow_ups_prepared: drafts.filter((d) => within(d.created_at, a, b)).length,
    messages_confirmed_sent: drafts.filter((d) => d.status === "sent_manually" && within(d.sent_confirmed_at, a, b)).length,
    replies: ev("prospect.replied").length,
    positive_responses: ev("prospect.replied").filter((e) => e.data.sentiment === "positive").length,
    appointments_booked: appts.filter((x) => within(x.created_at, a, b) && x.status !== "rescheduled").length,
    sales_opportunities: deals.filter((x) => within(x.created_at, a, b)).length,
    deals_closed: deals.filter((x) => x.status === "won" && within(x.signed_at, a, b)).length,
    revenue_collected_verified: payments.filter((p) => p.status === "paid" && p.verified && within(p.paid_at, a, b)).reduce((s, p) => s + p.amount, 0),
    revenue_recorded_unverified: payments.filter((p) => p.status === "paid" && !p.verified && within(p.paid_at, a, b)).reduce((s, p) => s + p.amount, 0),
    pending_approvals: drafts.filter((d) => d.status === "pending_approval" || d.status === "blocked").length + content.filter((c) => c.status === "pending_approval").length,
    failed_workflows: runs.filter((r) => r.status === "failed" && within(r.started_at, a, b)).length,
  };
  const hot = prospects.filter((p) => p.score_class === "hot" && p.contact_status === "ok" && !["won", "lost"].includes(p.stage)).sort((x, y) => (y.score ?? 0) - (x.score ?? 0)).slice(0, 5);
  const body = [
    `# Daily report — ${date}`,
    `| Metric | Today |`, `|---|---:|`,
    `| Prospects discovered | ${m.prospects_discovered} |`,
    `| Newly qualified | ${m.newly_qualified} |`,
    `| Follow-ups / drafts prepared | ${m.follow_ups_prepared} |`,
    `| Messages you confirmed sent | ${m.messages_confirmed_sent} |`,
    `| Replies | ${m.replies} |`,
    `| Positive responses | ${m.positive_responses} |`,
    `| Appointments booked | ${m.appointments_booked} |`,
    `| New sales opportunities | ${m.sales_opportunities} |`,
    `| Deals closed | ${m.deals_closed} |`,
    `| Revenue collected (verified) | ${money(m.revenue_collected_verified)} |`,
    m.revenue_recorded_unverified ? `| Revenue recorded, not yet verified | ${money(m.revenue_recorded_unverified)} |` : null,
    `| Pending approvals (now) | ${m.pending_approvals} |`,
    `| Failed workflows | ${m.failed_workflows} |`,
    ``,
    hot.length ? `## Hot prospects needing you\n${hot.map((p) => `- **${p.full_name}** (${p.market}, ${p.score}) — ${p.next_action ?? "review"}`).join("\n")}` : `No hot prospects open right now.`,
    ``,
    `_All figures come from the database. "Sent" counts only messages you confirmed you sent._`,
  ].filter((x) => x !== null).join("\n");
  const report = await store.upsert("reports", { kind: "daily", period_start: date, period_end: date, metrics: m, body_md: body, created_at: new Date().toISOString() }, ["kind", "period_start"]);
  await logEvent(store, { type: "report.daily", source: "workflow:evening", summary: `Daily report ${date}: ${m.messages_confirmed_sent} sent, ${m.replies} replies, ${m.appointments_booked} calls, ${money(m.revenue_collected_verified)} collected` });
  return report;
}

const Narrative = z.object({
  headline: z.string(),
  findings: z.array(z.string()).max(8),
  recommendations: z.array(z.object({ action: z.string(), why: z.string(), evidence: z.string(), owner_decision_required: z.boolean() })).max(8),
  data_gaps: z.array(z.string()),
});

/** Weekly revenue intelligence. Deterministic stats answer the 8 questions; Claude (optional) writes recommendations. */
export async function weeklyReport(store: Store, ai: Ai, weekEnd: string, opts: { includeSynthetic?: boolean } = {}): Promise<Report> {
  const start = addDays(weekEnd, -6);
  const a = dayBounds(start).a, b = dayBounds(weekEnd).b;
  const keep = <T extends { is_synthetic?: boolean }>(r: T[]) => (opts.includeSynthetic ? r : r.filter((x) => !x.is_synthetic));
  const [prospects, drafts, events, deals, payments, runs, content] = await Promise.all([
    store.select("prospects").then(keep), store.select("drafts").then(keep), store.select("events").then(keep),
    store.select("deals").then(keep), store.select("payments").then(keep), store.select("workflow_runs"), store.select("content_items").then(keep),
  ]);
  const rate = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
  const qualifiedP = (p: (typeof prospects)[number]) => ["hot", "high", "warm"].includes(p.score_class ?? "");
  const wonIds = new Set(deals.filter((d) => d.status === "won").map((d) => d.prospect_id));

  const markets = ["dubai", "usa", "uk", "other", "unknown"].map((m) => {
    const ps = prospects.filter((p) => p.market === m);
    return { market: m, prospects: ps.length, qualified: ps.filter(qualifiedP).length, qualification_rate: rate(ps.filter(qualifiedP).length, ps.length), replied: ps.filter((p) => p.last_inbound_at).length, won: ps.filter((p) => wonIds.has(p.id)).length };
  }).filter((x) => x.prospects > 0);

  const icp = ["founder", "leader", "broker", "agent", "unknown"].map((lvl) => {
    const ps = prospects.filter((p) => (seniority(p)?.level ?? "unknown") === lvl);
    return { segment: lvl, prospects: ps.length, qualification_rate: rate(ps.filter(qualifiedP).length, ps.length), won: ps.filter((p) => wonIds.has(p.id)).length };
  }).filter((x) => x.prospects > 0);

  const sent = drafts.filter((d) => d.status === "sent_manually");
  const angles = [...new Set(sent.map((d) => d.kind))].map((k) => {
    const ds = sent.filter((d) => d.kind === k);
    return { kind: k, sent: ds.length, replied: ds.filter((d) => d.outcome === "replied").length, reply_rate: rate(ds.filter((d) => d.outcome === "replied").length, ds.length) };
  });
  const positiveSamples = sent.filter((d) => d.outcome === "replied").slice(-5).map((d) => ({ kind: d.kind, positioning: d.positioning, body: d.body.slice(0, 300) }));

  const objections = Object.entries(prospects.reduce<Record<string, number>>((acc, p) => (p.previous_objection ? ((acc[p.previous_objection] = (acc[p.previous_objection] ?? 0) + 1), acc) : acc), {})).sort((x, y) => y[1] - x[1]);
  const perf = contentPerformance(content);
  const sources = [...new Set(deals.map((d) => d.lead_source ?? "unknown"))].map((s) => ({ source: s, deals: deals.filter((d) => (d.lead_source ?? "unknown") === s).length, won: deals.filter((d) => (d.lead_source ?? "unknown") === s && d.status === "won").length, collected: payments.filter((p) => p.status === "paid" && deals.find((d) => d.id === p.deal_id)?.lead_source === s).reduce((x, p) => x + p.amount, 0) }));
  const lostFrom = events.filter((e) => e.type === "prospect.stage_changed" && e.data.to === "lost").reduce<Record<string, number>>((acc, e) => ((acc[String(e.data.from)] = (acc[String(e.data.from)] ?? 0) + 1), acc), {});

  // Cost & time per acquired client (this week's AI spend from workflow stats; time from first record to signature).
  const weekRuns = runs.filter((r) => within(r.started_at, a, b));
  let aiCost = 0;
  for (const r of weekRuns) {
    const u = r.stats.ai_usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } | undefined;
    const price = PRICES[String(r.stats.ai_model ?? "")];
    if (u && price) aiCost += ((u.input_tokens ?? 0) * price.in + (u.output_tokens ?? 0) * price.out + (u.cache_read_input_tokens ?? 0) * price.cacheRead) / 1e6;
  }
  const wonWeek = deals.filter((d) => d.status === "won" && within(d.signed_at, a, b));
  const daysToClose = deals.filter((d) => d.status === "won" && d.signed_at).map((d) => {
    const p = prospects.find((x) => x.id === d.prospect_id);
    return p ? (new Date(d.signed_at!).getTime() - new Date(p.created_at).getTime()) / 86_400_000 : null;
  }).filter((x): x is number => x !== null);

  const stats = {
    period: { start, end: weekEnd }, markets, icp, outreach_angles: angles, objections, content: perf, lead_sources: sources, stage_losses: lostFrom,
    cost: { ai_cost_usd_this_week: Math.round(aiCost * 100) / 100, clients_won_this_week: wonWeek.length, ai_cost_per_client: wonWeek.length ? Math.round((aiCost / wonWeek.length) * 100) / 100 : null, avg_days_to_close: daysToClose.length ? Math.round(daysToClose.reduce((x, y) => x + y, 0) / daysToClose.length) : null, note: "Owner time and subscription costs are not tracked automatically." },
    calibration: suggestWeights(prospects),
    competitors: await competitorInsights(store),
  };

  let narrative: z.infer<typeof Narrative> | null = null;
  if (ai.available) {
    try {
      narrative = await ai.json({
        task: "weekly_optimisation",
        instructions: `Write the weekly revenue intelligence summary for the owner. Answer: best market; best ICP segment; outreach angles with positive replies; most frequent objections; content themes that generated conversations; lead sources producing paying customers; stages losing the most opportunities; cost/time per acquired client.
Use ONLY the stats provided. Where samples are tiny (<10), say the signal is weak. List data gaps honestly. Recommendations must be specific and actionable; mark owner_decision_required=true for anything touching pricing, policy, scoring weights or outreach permissions (you never change those yourself).`,
        input: JSON.stringify({ stats, positive_reply_samples: positiveSamples }),
        schema: Narrative,
        effort: "high",
        maxTokens: 6000,
      });
    } catch {
      narrative = null;
    }
  }

  const tbl = (rows: Record<string, unknown>[]) => (rows.length ? [`| ${Object.keys(rows[0]).join(" | ")} |`, `|${Object.keys(rows[0]).map(() => "---").join("|")}|`, ...rows.map((r) => `| ${Object.values(r).join(" | ")} |`)].join("\n") : "_No data yet._");
  const body = [
    `# Weekly revenue intelligence — ${start} → ${weekEnd}`,
    narrative ? `**${narrative.headline}**\n\n${narrative.findings.map((f) => "- " + f).join("\n")}` : `_AI narrative unavailable — stats only._`,
    `## 1. Markets`, tbl(markets),
    `## 2. ICP segments (by seniority)`, tbl(icp),
    `## 3. Outreach angles (owner-confirmed sends)`, tbl(angles),
    `## 4. Objections`, objections.length ? objections.map(([k, n]) => `- ${k}: ${n}`).join("\n") : "_None recorded._",
    `## 5. Content themes`, tbl(perf.by_pillar.map((p) => ({ pillar: p.key, posts: p.posts, avg_comments: p.avg_comments, engagement_rate: p.engagement_rate ?? "n/a", leads: p.leads_attributed }))),
    `## 6. Lead sources → paying customers`, tbl(sources.map((s) => ({ ...s, collected: money(s.collected) }))),
    `## 7. Where opportunities are lost`, Object.keys(lostFrom).length ? Object.entries(lostFrom).map(([k, n]) => `- from ${k}: ${n}`).join("\n") : "_No losses recorded._",
    `## 8. Cost & time per client`, `- AI spend this week: ${money(stats.cost.ai_cost_usd_this_week)} (estimate from token usage)\n- Clients won this week: ${wonWeek.length}\n- AI cost per client: ${stats.cost.ai_cost_per_client === null ? "n/a" : money(stats.cost.ai_cost_per_client)}\n- Average days from first record to signature: ${stats.cost.avg_days_to_close ?? "n/a"}\n- ${stats.cost.note}`,
    `## Recommendations`, narrative ? narrative.recommendations.map((r) => `- ${r.owner_decision_required ? "🔒 " : ""}**${r.action}** — ${r.why} _(evidence: ${r.evidence})_`).join("\n") : "_Requires Claude._",
    `## Scoring calibration`, stats.calibration.ready ? `Suggested weights (not applied — edit config/scoring.json to adopt): \`${JSON.stringify(stats.calibration.suggested)}\`` : stats.calibration.reason,
    narrative?.data_gaps.length ? `## Data gaps\n${narrative.data_gaps.map((g) => "- " + g).join("\n")}` : null,
  ].filter(Boolean).join("\n\n");

  const report = await store.upsert("reports", { kind: "weekly", period_start: start, period_end: weekEnd, metrics: stats as unknown as Record<string, unknown>, body_md: body, created_at: new Date().toISOString() }, ["kind", "period_start"]);
  await logEvent(store, { type: "report.weekly", source: "workflow:weekly", summary: `Weekly intelligence report ${start} → ${weekEnd} ready` });
  return report;
}

export function todayLocal(now = new Date()) {
  return localDate(now, tz());
}
export function mondayOf(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = zonedParts(dayStartUtc(zonedTimeToUtc(y, m, d, 12, 0, tz()), tz()), tz()).weekday;
  const idx = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(wd);
  return addDays(date, -idx);
}
