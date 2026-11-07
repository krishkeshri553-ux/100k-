import { config } from "../lib/config.js";
import type { LeadCategory, Prospect, ScoreBreakdownItem } from "../db/types.js";
import { daysBetween } from "../lib/time.js";

type Weights = typeof config.scoring.weights;
export type Dimension = keyof Weights;

export interface ScoreResult {
  score: number;
  class_id: string;
  class_label: string;
  confidence: number; // share of total weight backed by evidence (0..1)
  breakdown: ScoreBreakdownItem[];
  explanation: string;
}

interface Signal { value: number | null; reason: string }

const has = (hay: string, words: string[]) => words.some((w) => hay.includes(w));

function textOf(p: Pick<Prospect, "title" | "headline" | "company">) {
  return " " + [p.title, p.headline, p.company].filter(Boolean).join(" ").toLowerCase() + " ";
}

export function seniority(p: Pick<Prospect, "title" | "headline">): { level: keyof typeof config.revenue.icp.seniority_values; label: string } | null {
  const t = " " + [p.title, p.headline].filter(Boolean).join(" ").toLowerCase() + " ";
  if (t.trim() === "") return null;
  const groups = config.revenue.icp.titles;
  for (const level of ["founder", "leader", "broker", "agent"] as const) {
    const hit = groups[level].find((w) => (w.length <= 3 ? new RegExp(`\\b${w}\\b`).test(t) : t.includes(w)));
    if (hit) return { level, label: hit };
  }
  return null;
}

export function icpFit(p: Prospect): Signal {
  const t = textOf(p);
  if (t.trim() === "") return { value: null, reason: "No title, headline or company on record" };
  if (has(t, config.revenue.icp.disqualifiers)) return { value: 0.05, reason: "Profile text contains a disqualifier (e.g. student/open to work)" };
  const realEstate = has(t, config.revenue.icp.industry_keywords);
  const s = seniority(p);
  const market = config.revenue.markets.find((m) => m.id === p.market);
  const marketFit = market ? market.fit : p.market === "unknown" ? null : 0.3;
  if (!realEstate) return { value: s ? 0.25 : 0.1, reason: "No real-estate signal in title/headline/company" + (s ? ` (role: ${s.label})` : "") };
  const roleFit = s ? 1 : 0.7;
  const v = marketFit === null ? roleFit * 0.85 : roleFit * (0.5 + 0.5 * marketFit);
  return { value: v, reason: `Real estate ${s ? s.label : "professional"}; market ${market?.label ?? p.market}${marketFit === null ? " (unknown)" : ""}` };
}

export function businessPotential(p: Prospect): Signal {
  const s = seniority(p);
  const hc = p.research?.headcount ?? null;
  if (!s && hc === null && p.deal_value_estimate === null) return { value: null, reason: "Role, team size and deal value unknown" };
  let v = s ? config.revenue.icp.seniority_values[s.level] : 0.5;
  const reasons = [s ? `role ${s.label}` : "role unknown"];
  if (hc !== null) {
    const bump = hc >= 50 ? 0.2 : hc >= 10 ? 0.12 : hc >= 3 ? 0.05 : 0;
    v = Math.min(1, v + bump);
    reasons.push(`team/company size ${hc}`);
  }
  if (p.deal_value_estimate !== null) { v = Math.min(1, v + 0.1); reasons.push(`known deal value $${p.deal_value_estimate}`); }
  return { value: v, reason: reasons.join(", ") };
}

export function contentOpportunity(p: Prospect): Signal {
  const r = p.research ?? {};
  const f = r.posting_frequency ?? null;
  if (!f && r.has_video == null && !r.content_gap_notes) return { value: null, reason: "Content activity not researched yet" };
  let v: number;
  let reason: string;
  switch (f) {
    case "none": v = 0.75; reason = "Not publishing — clear gap (needs willingness to start)"; break;
    case "irregular": v = 0.95; reason = "Publishes irregularly — strongest system gap"; break;
    case "regular": v = r.has_video ? 0.5 : 0.8; reason = r.has_video ? "Regular video already — gap is scripting/DM system" : "Posts regularly but little video"; break;
    case "high": v = r.has_video ? 0.3 : 0.6; reason = r.has_video ? "High-volume video already — smaller gap" : "High volume, little video"; break;
    default: v = 0.7; reason = "Content gap noted";
  }
  if (r.content_gap_notes) reason += `; note: ${r.content_gap_notes.slice(0, 80)}`;
  return { value: v, reason };
}

export function recentActivity(p: Prospect, now: Date): Signal {
  const dates = [p.research?.recent_post_at, p.last_inbound_at].filter(Boolean) as string[];
  if (dates.length === 0) return { value: null, reason: "No recent activity date known" };
  const latest = dates.sort().at(-1)!;
  const d = daysBetween(latest, now);
  const v = d <= 14 ? 1 : d <= 30 ? 0.85 : d <= 90 ? 0.6 : d <= 180 ? 0.35 : 0.15;
  return { value: v, reason: `Most recent activity ${Math.round(d)} days ago` };
}

const CATEGORY_SIGNAL: Partial<Record<LeadCategory, number>> = {
  C_asked_pricing: 1, E_received_proposal: 1, F_interested_never_booked: 0.9, G_ghosted_after_sales: 0.75,
  D_requested_info: 0.75, A_interested_inactive: 0.65, B_replied_then_silent: 0.45, H_declined_may_revisit: 0.25, I_not_worth_pursuing: 0,
};

export function buyingSignals(p: Prospect): Signal {
  if (!p.lead_category || p.lead_category === "never_engaged") return { value: null, reason: "No conversation signals yet" };
  const v = CATEGORY_SIGNAL[p.lead_category] ?? null;
  return { value: v, reason: `Conversation: ${p.lead_category.replace(/^[A-I]_/, "").replace(/_/g, " ")}` };
}

export function abilityToInvest(p: Prospect): Signal {
  const a = p.research?.ability_to_invest ?? null;
  if (a) return { value: a === "high" ? 1 : a === "medium" ? 0.65 : 0.2, reason: `Researched ability to invest: ${a}` };
  if (p.deal_value_estimate !== null) return { value: p.deal_value_estimate >= 5999 ? 1 : p.deal_value_estimate >= 999 ? 0.75 : 0.3, reason: `Deal value estimate $${p.deal_value_estimate}` };
  const s = seniority(p);
  if (s && (s.level === "founder" || s.level === "leader")) return { value: 0.7, reason: `Proxy: ${s.label} (owner/leader roles usually control budget)` };
  return { value: null, reason: "Budget capacity unknown" };
}

export function classify(score: number) {
  return config.scoring.classes.find((c) => score >= c.min) ?? config.scoring.classes[config.scoring.classes.length - 1];
}

/**
 * 0–100 score. Unknown dimensions contribute a neutral prior (not zero) and lower the confidence.
 * Hot / High priority require at least `min_known_weight_for_high` of the weight to be evidence-backed.
 */
export function scoreProspect(p: Prospect, now = new Date(), weights: Weights = config.scoring.weights): ScoreResult {
  const signals: Record<Dimension, Signal> = {
    icp_fit: icpFit(p),
    business_potential: businessPotential(p),
    content_opportunity: contentOpportunity(p),
    recent_activity: recentActivity(p, now),
    buying_signals: buyingSignals(p),
    ability_to_invest: abilityToInvest(p),
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let points = 0;
  let known = 0;
  const breakdown: ScoreBreakdownItem[] = [];
  for (const [dim, w] of Object.entries(weights) as [Dimension, number][]) {
    const s = signals[dim];
    const val = s.value === null ? config.scoring.unknown_value : Math.max(0, Math.min(1, s.value));
    const pts = (w * val * 100) / total;
    points += pts;
    if (s.value !== null) known += w;
    breakdown.push({ dimension: dim, weight: w, value: s.value === null ? null : +s.value.toFixed(2), points: +pts.toFixed(1), reason: s.value === null ? "UNKNOWN — " + s.reason : s.reason });
  }
  let score = Math.round(points);
  const confidence = +(known / total).toFixed(2);
  const optedOut = p.contact_status !== "ok";
  if (optedOut) score = 0;
  let cls = classify(score);
  let capped = false;
  if ((cls.id === "hot" || cls.id === "high") && confidence < config.scoring.min_known_weight_for_high) {
    cls = config.scoring.classes.find((c) => c.id === "warm")!;
    capped = true;
  }
  const explanation = [
    `${score}/100 → ${cls.label}${capped ? " (capped: not enough verified information for a higher class)" : ""}${optedOut ? " (contact restricted)" : ""}.`,
    `Confidence ${Math.round(confidence * 100)}% of weight is evidence-based.`,
    ...breakdown.map((b) => `• ${b.dimension} (${b.weight}): ${b.points} pts — ${b.reason}`),
  ].join("\n");
  return { score, class_id: cls.id, class_label: cls.label, confidence, breakdown, explanation };
}

/**
 * Weight calibration from real outcomes: compares mean dimension values of won vs lost prospects and
 * suggests (does not apply) new weights. The owner reviews and commits config/scoring.json changes.
 */
export function suggestWeights(prospects: Prospect[], weights: Weights = config.scoring.weights) {
  const won = prospects.filter((p) => p.stage === "won" && p.score_breakdown);
  const lost = prospects.filter((p) => p.stage === "lost" && p.score_breakdown);
  if (won.length < 5 || lost.length < 5) {
    return { ready: false as const, reason: `Need at least 5 won and 5 lost scored prospects (have ${won.length} won, ${lost.length} lost).` };
  }
  const mean = (rows: Prospect[], dim: string) => {
    const vals = rows.map((p) => p.score_breakdown!.find((b) => b.dimension === dim)?.value).filter((v): v is number => v !== null && v !== undefined);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const lifts: Record<string, number> = {};
  for (const dim of Object.keys(weights)) {
    const w = mean(won, dim), l = mean(lost, dim);
    lifts[dim] = w === null || l === null ? 0 : w - l;
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const raw = Object.fromEntries(Object.entries(weights).map(([d, w]) => [d, Math.max(5, w * (1 + Math.max(-0.5, Math.min(0.5, lifts[d] * 2))))]));
  const rawTotal = Object.values(raw).reduce((a, b) => a + b, 0);
  const suggested = Object.fromEntries(Object.entries(raw).map(([d, w]) => [d, Math.round((w * total) / rawTotal)]));
  return { ready: true as const, lifts, suggested, sample: { won: won.length, lost: lost.length } };
}
