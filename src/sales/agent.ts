import { z } from "zod";
import type { Ai } from "../ai/claude.js";
import { brain, findCaseStudy, STRATEGY_IDS, type StrategyId } from "../brain/index.js";
import type { Store } from "../db/store.js";
import type { Message, Prospect } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { classifyByRules, prospectCard, renderConversation } from "../leads/classify.js";
import { checkDraft, isBlocked } from "../outreach/guardrails.js";

export interface SalesAnalysis {
  strategy: StrategyId;
  prospect_type_reasoning: string;
  buying_signals: string[];
  objections: { id: string; quote: string }[];
  discovery_questions: string[];
  recommended_case_studies: { id: string; name: string; claim: string; url: string }[];
  booking_readiness: "ready" | "warming" | "not_yet" | "never";
  needs_owner_attention: boolean;
  owner_attention_reason: string | null;
  suggested_stage: "replied" | "interested" | "appointment_booked" | "proposal_sent" | "lost" | null;
  reply_draft: string | null;
  reply_flags: ReturnType<typeof checkDraft>;
  sensitive_commitment_requested: string | null;
  method: "claude" | "rules";
}

const Out = z.object({
  strategy: z.enum(STRATEGY_IDS as [StrategyId, ...StrategyId[]]),
  prospect_type_reasoning: z.string(),
  buying_signals: z.array(z.string()),
  objections: z.array(z.object({ id: z.string(), quote: z.string() })),
  discovery_questions: z.array(z.string()).max(4),
  recommended_case_study_ids: z.array(z.string()).max(2),
  booking_readiness: z.enum(["ready", "warming", "not_yet", "never"]),
  needs_owner_attention: z.boolean(),
  owner_attention_reason: z.string().nullable(),
  suggested_stage: z.enum(["replied", "interested", "appointment_booked", "proposal_sent", "lost"]).nullable(),
  reply_draft: z.string().nullable(),
  sensitive_commitment_requested: z.string().nullable().describe("If the prospect asks for a discount, custom price, refund, contract change or guarantee, describe it; the owner must decide."),
});

const INSTRUCTIONS = `You are the HustleGrowthz sales setter. Analyse the latest state of this conversation and prepare the next reply for the owner to review.
Pick ONE strategy from: ${STRATEGY_IDS.join(", ")} (definitions in the brain).
Objection ids must come from the brain's objection list when they match (price, time, camera, guarantee, proof, agency_already, editor, timing, linkedin, listings); quote the prospect's words.
recommended_case_study_ids: ONLY ids from the brain's published case studies, only if relevant (e.g. they asked for proof). When you cite one in the reply, add that results are individual and not typical.
booking_readiness "ready" = they asked for/agreed to a call or asked about price/next steps; "never" = opted out or clearly unsuitable.
needs_owner_attention = true for hot prospects ready to book, pricing negotiations, sensitive commitments, angry/confused prospects.
reply_draft: ≤ 900 chars, in Krish's voice, answers what they actually asked, at most one question, approved pricing only, no discounts, no guarantees. If they asked something you cannot answer from the brain (e.g. custom scope, a discount), say you'll confirm personally and flag it in sensitive_commitment_requested. Null if no reply is appropriate (e.g. opted out).`;

/** Deterministic fallback so the workflow still produces an honest analysis without the API. */
export function analyseByRules(p: Prospect, msgs: Message[]): SalesAnalysis {
  const c = classifyByRules(p, msgs);
  const lastIn = [...msgs].filter((m) => m.direction === "inbound").sort((a, b) => a.sent_at.localeCompare(b.sent_at)).at(-1);
  const ready = ["C_asked_pricing", "F_interested_never_booked", "E_received_proposal"].includes(c.category);
  const sensitive = lastIn && /\b(discount|cheaper|lower price|refund|deal for me|special price|guarantee)\b/i.test(lastIn.body) ? lastIn.body.slice(0, 160) : null;
  const caseStudies = c.strategy === "skeptical" || c.strategy === "case_study_request" ? ["amy", "vadym"] : [];
  return {
    strategy: c.strategy, prospect_type_reasoning: "Rules-based: " + c.summary, buying_signals: c.buying_signals,
    objections: c.previous_objection && lastIn ? [{ id: c.previous_objection, quote: lastIn.body.slice(0, 140) }] : [],
    discovery_questions: brain.discovery_questions.slice(0, 2),
    recommended_case_studies: caseStudies.map((id) => findCaseStudy(id)!).map((cs) => ({ id: cs.id, name: cs.name, claim: cs.claim, url: cs.url })),
    booking_readiness: c.opted_out ? "never" : ready ? "ready" : c.interest_level === "medium" ? "warming" : "not_yet",
    needs_owner_attention: ready || !!sensitive, owner_attention_reason: sensitive ? "Sensitive commercial request: " + sensitive : ready ? "Prospect looks ready for a call" : null,
    suggested_stage: c.opted_out ? "lost" : ready ? "interested" : lastIn ? "replied" : null,
    reply_draft: null, reply_flags: [], sensitive_commitment_requested: sensitive, method: "rules",
  };
}

export async function analyseSalesConversation(store: Store, ai: Ai, p: Prospect, opts: { source?: string } = {}): Promise<SalesAnalysis> {
  const msgs = await store.select("messages", { prospect_id: p.id });
  if (p.contact_status !== "ok") return { ...analyseByRules(p, msgs), booking_readiness: "never", reply_draft: null, needs_owner_attention: false, owner_attention_reason: null };
  if (!ai.available) return analyseByRules(p, msgs);
  try {
    const out = await ai.json({
      task: "sales_conversation",
      instructions: INSTRUCTIONS,
      input: `PROSPECT: ${prospectCard(p)}\nPRIOR SUMMARY: ${p.conversation_summary ?? "none"}\nCONVERSATION:\n${renderConversation(msgs, "Krish")}`,
      schema: Out,
      effort: "medium",
      maxTokens: 5000,
    });
    const studies = out.recommended_case_study_ids.map((id) => findCaseStudy(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const flags = out.reply_draft ? checkDraft(out.reply_draft, { kind: "reply", firstName: p.first_name, ownHistory: msgs.filter((m) => m.direction === "outbound").map((m) => m.body) }) : [];
    return {
      strategy: out.strategy, prospect_type_reasoning: out.prospect_type_reasoning, buying_signals: out.buying_signals, objections: out.objections,
      discovery_questions: out.discovery_questions, recommended_case_studies: studies.map((cs) => ({ id: cs.id, name: cs.name, claim: cs.claim, url: cs.url })),
      booking_readiness: out.booking_readiness, needs_owner_attention: out.needs_owner_attention || !!out.sensitive_commitment_requested || isBlocked(flags),
      owner_attention_reason: out.owner_attention_reason ?? (out.sensitive_commitment_requested ? "Sensitive commercial request" : null),
      suggested_stage: out.suggested_stage, reply_draft: out.reply_draft, reply_flags: flags, sensitive_commitment_requested: out.sensitive_commitment_requested, method: "claude",
    };
  } catch (e) {
    await logEvent(store, { type: "ai.error", source: opts.source ?? "workflow", prospect_id: p.id, summary: `Sales analysis fell back to rules: ${(e as Error).message.slice(0, 160)}`, is_synthetic: p.is_synthetic });
    return analyseByRules(p, msgs);
  }
}
