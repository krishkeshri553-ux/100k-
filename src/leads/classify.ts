import { z } from "zod";
import type { Ai } from "../ai/claude.js";
import { LEAD_CATEGORIES, type InterestLevel, type LeadCategory, type Message, type OfferFit, type Prospect } from "../db/types.js";
import { daysBetween } from "../lib/time.js";
import type { StrategyId } from "../brain/index.js";

export interface Classification {
  category: LeadCategory;
  interest_level: InterestLevel;
  offer_fit: OfferFit;
  previous_objection: string | null;
  opted_out: boolean;
  opt_out_evidence: string | null;
  buying_signals: string[];
  strategy: StrategyId;
  summary: string;
  recommended_next_action: string;
  follow_up_priority: 1 | 2 | 3 | 4 | 5;
  method: "rules" | "claude";
}

const RX = {
  optOut: /\b(stop (messaging|contacting|sending)|unsubscribe|remove me|do not (contact|message)|don'?t (contact|message|dm) me|not interested[,.!]? (please )?(stop|don'?t)|leave me alone|spam(ming)?|block(ed)? you|reported)\b/i,
  pricing: /\b(price|pricing|cost|costs|how much|rates?|fees?|budget|investment|package|packages|quote|charges?|per month|monthly fee)\b/i,
  info: /\b(send (me )?(some |more )?(info|information|details|deck|brochure)|more (info|information|details)|tell me more|share (more|some)? ?(details|info)|what do you (do|offer)|how does (it|this) work|examples?|case stud(y|ies)|portfolio|samples?)\b/i,
  proposal: /\b(proposal|quotation|invoice|contract|agreement|onboarding form|payment link)\b/i,
  interest: /\b(interested|sounds (good|great|interesting)|let'?s (talk|chat|connect|do it)|keen|would love|i'?d love|open to (it|this|a call|chat)|yes[,!. ]|count me in|makes sense|tell me more)\b/i,
  booking: /\b(book|booking|schedule|call|zoom|google meet|meet|calendar|calendly|available (on|at|tomorrow)|what time|when are you free)\b/i,
  booked: /\b(booked|see you (on|at|then|tomorrow)|invite (sent|received)|confirmed for|talk (on|then))\b/i,
  decline: /\b(not interested|no thanks|no thank you|not (right )?now|not at the moment|maybe later|next (month|quarter|year)|no budget|can'?t afford|too expensive|already (have|work with|use)|we have an? (agency|team|marketing)|not a priority|pass for now|not for me|i'?m good)\b/i,
  busy: /\b(busy|swamped|hectic|no time|crazy (week|month)|travell?ing|on leave|ramadan)\b/i,
  skeptical: /\b(guarantee|scam|does (it|this) (really )?work|proof|results\?|how do i know|sceptic|skeptic)\b/i,
  competitor: /\b(other agenc(y|ies)|another agency|compar(e|ing)|quote from|cheaper|freelancer|in-house)\b/i,
};

const OBJECTIONS: [RegExp, string][] = [
  [/\b(too expensive|can'?t afford|no budget|budget)\b/i, "price"],
  [/\b(busy|no time|swamped|hectic)\b/i, "time"],
  [/\b(camera|on video|shy|not comfortable)\b/i, "camera"],
  [/\b(guarantee)\b/i, "guarantee"],
  [/\b(already (have|work with)|we have an? (agency|team|marketing))\b/i, "agency_already"],
  [/\b(editor|freelancer)\b/i, "editor"],
  [/\b(not (right )?now|maybe later|next (month|quarter|year)|not a priority)\b/i, "timing"],
  [/\b(linkedin)\b/i, "linkedin"],
  [/\b(listings?)\b/i, "listings"],
  [/\b(proof|results|case stud(y|ies)|does it work)\b/i, "proof"],
];

function lastMatch(msgs: Message[], rx: RegExp, direction?: "inbound" | "outbound") {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (direction && m.direction !== direction) continue;
    if (rx.test(m.body)) return m;
  }
  return null;
}

/** Deterministic, explainable classification. Always runs; Claude may refine it but can never override an opt-out. */
export function classifyByRules(prospect: Pick<Prospect, "contact_status" | "deal_value_estimate">, messagesIn: Message[], now = new Date()): Classification {
  const msgs = [...messagesIn].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  const inbound = msgs.filter((m) => m.direction === "inbound");
  const outbound = msgs.filter((m) => m.direction === "outbound");
  const last = msgs[msgs.length - 1] ?? null;
  const lastIn = inbound[inbound.length - 1] ?? null;
  const daysSinceLast = last ? daysBetween(last.sent_at, now) : Infinity;
  const signals: string[] = [];

  const optOutMsg = lastMatch(inbound, RX.optOut);
  const optedOut = prospect.contact_status !== "ok" || !!optOutMsg;
  const objection = (() => {
    for (const m of [...inbound].reverse()) for (const [rx, id] of OBJECTIONS) if (rx.test(m.body)) return id;
    return null;
  })();

  const askedPricing = !!lastMatch(inbound, RX.pricing);
  const askedInfo = !!lastMatch(inbound, RX.info);
  const proposal = !!lastMatch(msgs, RX.proposal, "outbound") || !!lastMatch(inbound, RX.proposal);
  const interested = !!lastMatch(inbound, RX.interest);
  const bookingTalk = !!lastMatch(msgs, RX.booking);
  const booked = !!lastMatch(msgs, RX.booked);
  const declineMsg = lastMatch(inbound, RX.decline);
  const latestInboundDeclines = !!(lastIn && RX.decline.test(lastIn.body));
  if (askedPricing) signals.push("asked about pricing");
  if (askedInfo) signals.push("requested more information");
  if (proposal) signals.push("proposal discussed");
  if (interested) signals.push("expressed interest");
  if (bookingTalk) signals.push("discussed a call");

  const base = { previous_objection: objection, opted_out: optedOut, opt_out_evidence: optOutMsg?.body.slice(0, 200) ?? (prospect.contact_status !== "ok" ? "contact status " + prospect.contact_status : null), buying_signals: signals, method: "rules" as const };

  if (optedOut) {
    return { ...base, category: "I_not_worth_pursuing", interest_level: "none", offer_fit: "unknown", strategy: "not_ready", summary: "Prospect asked not to be contacted. Respect it.", recommended_next_action: "Do not contact", follow_up_priority: 5 };
  }
  if (inbound.length === 0) {
    return { ...base, category: "never_engaged", interest_level: "unknown", offer_fit: "unknown", strategy: "curious", summary: `${outbound.length} outbound message(s), no reply.`, recommended_next_action: outbound.length >= 3 ? "Stop: three unanswered messages already" : "Research, then one relevant follow-up with a new angle", follow_up_priority: outbound.length >= 3 ? 5 : 4 };
  }

  const engagedSales = askedPricing || proposal || bookingTalk;
  let category: LeadCategory;
  let interest: InterestLevel;
  let strategy: StrategyId = "reactivation";
  let priority: Classification["follow_up_priority"];
  let next: string;

  if (latestInboundDeclines && declineMsg) {
    const hard = /\b(not interested|no thanks|no thank you|not for me)\b/i.test(declineMsg.body) && !/\b(now|moment|later|yet|year|month)\b/i.test(declineMsg.body);
    category = hard && daysSinceLast < 180 ? "I_not_worth_pursuing" : "H_declined_may_revisit";
    interest = "low";
    strategy = objection === "price" ? "price_sensitive" : "not_ready";
    priority = category === "I_not_worth_pursuing" ? 5 : daysSinceLast > 90 ? 3 : 4;
    next = category === "I_not_worth_pursuing" ? "No follow-up; revisit only if they re-engage" : "Wait for a genuine new reason (new listing launch, team growth, new content push), then a respectful check-in";
  } else if (proposal) {
    category = last?.direction === "outbound" ? "E_received_proposal" : "G_ghosted_after_sales";
    interest = "high"; priority = 1; strategy = "interested";
    next = "Follow up on the proposal with one specific question about their decision";
  } else if (askedPricing) {
    category = "C_asked_pricing"; interest = "high"; priority = 1; strategy = "price_sensitive";
    next = "Answer pricing with the approved plans and offer a 30-minute call";
  } else if (booked && !booking_happened_recently(daysSinceLast)) {
    category = "G_ghosted_after_sales"; interest = "medium"; priority = 2; strategy = "reactivation";
    next = "Check whether the call happened; offer a fresh time";
  } else if (interested && (bookingTalk ? true : false)) {
    category = "F_interested_never_booked"; interest = "high"; priority = 1; strategy = "interested";
    next = "Offer two concrete call times";
  } else if (askedInfo) {
    category = "D_requested_info"; interest = "medium"; priority = 2; strategy = /case stud|example|proof|results/i.test(lastIn?.body ?? "") ? "case_study_request" : "curious";
    next = "Send the specific information requested, then one question";
  } else if (interested) {
    category = engagedSales ? "F_interested_never_booked" : "A_interested_inactive"; interest = "medium"; priority = 2; strategy = "interested";
    next = "Re-open with something specific to their business and a low-friction question";
  } else if (last?.direction === "outbound") {
    category = engagedSales ? "G_ghosted_after_sales" : "B_replied_then_silent"; interest = "low"; priority = 3;
    next = "Contextual follow-up referencing their last real message";
  } else {
    category = "A_interested_inactive"; interest = "medium"; priority = 2;
    next = "They wrote last — reply to their last message first";
  }

  if (RX.skeptical.test(lastIn?.body ?? "")) strategy = "skeptical";
  else if (RX.competitor.test(lastIn?.body ?? "")) strategy = "comparing_competitors";
  else if (RX.busy.test(lastIn?.body ?? "") && strategy === "reactivation") strategy = "busy";

  if (daysSinceLast < 2 && last?.direction === "outbound") {
    next = "Wait — last message was sent less than 2 days ago";
    priority = Math.min(5, priority + 1) as Classification["follow_up_priority"];
  }

  return {
    ...base, category, interest_level: interest, offer_fit: "unknown", strategy,
    summary: `${LEAD_CATEGORIES[category]}. ${inbound.length} inbound / ${outbound.length} outbound; last message ${Math.round(daysSinceLast)} days ago by ${last?.direction === "inbound" ? "them" : "us"}.${signals.length ? " Signals: " + signals.join(", ") + "." : ""}`,
    recommended_next_action: next, follow_up_priority: priority,
  };
}

function booking_happened_recently(days: number) {
  return days < 3;
}

const ClaudeClassification = z.object({
  category: z.enum(Object.keys(LEAD_CATEGORIES) as [LeadCategory, ...LeadCategory[]]),
  interest_level: z.enum(["high", "medium", "low", "none", "unknown"]),
  offer_fit: z.enum(["strong", "possible", "weak", "unknown"]),
  previous_objection: z.string().nullable(),
  opted_out: z.boolean(),
  opt_out_evidence: z.string().nullable(),
  buying_signals: z.array(z.string()),
  strategy: z.enum(["interested", "curious", "skeptical", "price_sensitive", "busy", "case_study_request", "comparing_competitors", "not_ready", "reactivation"]),
  summary: z.string(),
  recommended_next_action: z.string(),
  follow_up_priority: z.number().int().min(1).max(5),
});

export function renderConversation(msgs: Message[], ownerName = "Owner"): string {
  return [...msgs]
    .sort((a, b) => a.sent_at.localeCompare(b.sent_at))
    .map((m) => `[${m.sent_at.slice(0, 16).replace("T", " ")}] ${m.direction === "outbound" ? ownerName : "PROSPECT"} (${m.channel}): ${m.body}`)
    .join("\n");
}

export function prospectCard(p: Prospect): string {
  return JSON.stringify({
    name: p.full_name, title: p.title, headline: p.headline, company: p.company, location: p.location, market: p.market,
    linkedin_url: p.linkedin_url, source: p.source, stage: p.stage, deal_value_estimate: p.deal_value_estimate, research: p.research, tags: p.tags,
  });
}

/** Claude refinement. Hard rule: if rules detected an opt-out, the result stays opted out regardless of the model. */
export async function classifyWithClaude(ai: Ai, prospect: Prospect, msgs: Message[], rules: Classification, now = new Date()): Promise<Classification> {
  const out = await ai.json({
    task: "classify_conversation",
    instructions: `Classify this LinkedIn sales conversation for HustleGrowthz lead reactivation.
Categories: ${Object.entries(LEAD_CATEGORIES).map(([k, v]) => `${k} = ${v}`).join("; ")}.
offer_fit: how well the Authority Flywheel™ fits this prospect based ONLY on evidence (unknown if no evidence).
opted_out = true only if the prospect asked not to be contacted.
follow_up_priority: 1 highest … 5 lowest. Today is ${now.toISOString().slice(0, 10)}.
A rules-based pre-classification is supplied; agree or correct it with reasons in the summary.`,
    input: `PROSPECT: ${prospectCard(prospect)}\n\nRULES PRE-CLASSIFICATION: ${JSON.stringify(rules)}\n\nCONVERSATION:\n${renderConversation(msgs)}`,
    schema: ClaudeClassification,
    effort: "low",
    maxTokens: 3000,
  });
  const merged: Classification = { ...out, follow_up_priority: out.follow_up_priority as Classification["follow_up_priority"], method: "claude" };
  if (rules.opted_out) {
    return { ...merged, opted_out: true, opt_out_evidence: rules.opt_out_evidence, category: "I_not_worth_pursuing", recommended_next_action: "Do not contact", follow_up_priority: 5 };
  }
  return merged;
}
