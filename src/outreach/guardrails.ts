import { approvedNumberTokens, approvedPrices, brain, normaliseNumber } from "../brain/index.js";
import type { DraftKind, GuardrailFlag } from "../db/types.js";
import { config } from "../lib/config.js";
import { normaliseForCompare, similarity } from "../lib/hash.js";

const caps = config.revenue.caps;

const LIMITS: Record<DraftKind, number> = {
  connection_note: caps.connection_note_max_chars,
  inmail: caps.inmail_body_max_chars,
  initial_message: caps.message_max_chars,
  follow_up: caps.message_max_chars,
  reply: caps.message_max_chars,
  reactivation: caps.message_max_chars,
};

const RULES: { code: string; severity: GuardrailFlag["severity"]; rx: RegExp; message: string }[] = [
  { code: "guarantee", severity: "block", rx: /\b(guarantee[ds]?|guaranteeing|100% (results|success)|risk[- ]free|money[- ]back|promise (you|results|leads))\b/i, message: "Guarantee language — HustleGrowthz does not guarantee outcomes." },
  { code: "discount", severity: "block", rx: /\b(discount|% off|percent off|special (price|offer|deal)|free (month|trial|week)|promo|coupon|reduced (price|rate)|waive)\b/i, message: "Discount/concession — only the owner can authorise discounts." },
  { code: "fake_urgency", severity: "review", rx: /\b(only \d+ (spots?|slots?) left|last chance|expires (today|tonight)|act now|limited time)\b/i, message: "Artificial urgency or scarcity." },
  { code: "linkedin_publishing_claim", severity: "block", rx: /\b(we('| wi)ll|we can|we) (post|publish|manage|run)[^.]{0,40}\blinkedin\b/i, message: "LinkedIn publishing is not part of the standard service." },
  { code: "real_estate_results_claim", severity: "block", rx: /\b(other|our|many|dozens of|\d+\+?) (agents|realtors|brokers|property consultants|real estate clients)\b[^.]{0,60}\b(got|achieved|saw|closed|generated|increased|doubled|tripled|results?)\b|\b(helped|work(ed)? with) (\d+\+?|dozens of|many|hundreds of) (agents|realtors|brokers)\b/i, message: "Claims real-estate-specific client results; none are published." },
  { code: "contract_commitment", severity: "block", rx: /\b(i('| wi)ll (sign|waive|refund)|full refund|no(-| )contract needed|cancel anytime for a refund)\b/i, message: "Contract/refund commitment conflicts with published terms." },
  { code: "sent_claim", severity: "review", rx: /\b(as (i|we) (mentioned|said) (in|on) (my|our) (call|email))\b/i, message: "References an interaction that may not exist — verify." },
  { code: "generic_bump", severity: "review", rx: /\b(just (bumping|following up|checking in)|circling back|touching base)\b/i, message: "Generic follow-up wording." },
];

export interface GuardrailContext {
  kind: DraftKind;
  firstName?: string | null;
  /** Bodies already drafted for OTHER prospects recently (to detect generic, repeated messages). */
  otherBodies?: string[];
  /** Bodies previously drafted/sent to THIS prospect (to avoid repeating ourselves). */
  ownHistory?: string[];
  subject?: string | null;
}

/** Numbers that look like claims or prices in the text. */
function extractNumbers(text: string): { raw: string; isMoney: boolean; context: string }[] {
  const out: { raw: string; isMoney: boolean; context: string }[] = [];
  const rx = /(\$|usd\s?|aed\s?|£|€)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|b)?\+?/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const value = m[2] + (m[3] ?? "");
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 2);
    if (/^\s?%/.test(after) || /^\s?percent/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 9))) continue; // percentages are not prices
    const context = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).toLowerCase();
    out.push({ raw: value, isMoney: !!m[1] || /\b(per month|a month|\/mo|per year|a year|usd|dollars?|price|cost)\b/.test(context), context });
  }
  return out;
}

const CLAIM_WORDS = /\b(views?|followers?|leads?|clients?|calls? booked|reach|impressions|accounts reached|sales|revenue|deals?|listings?)\b/;

export function checkDraft(body: string, ctx: GuardrailContext): GuardrailFlag[] {
  const flags: GuardrailFlag[] = [];
  const text = (ctx.subject ? ctx.subject + "\n" : "") + body;

  if (!body.trim()) flags.push({ code: "empty", severity: "block", message: "Draft is empty." });
  const limit = LIMITS[ctx.kind];
  if (body.length > limit) flags.push({ code: "too_long", severity: "block", message: `${body.length} chars exceeds the ${limit}-char limit for ${ctx.kind}.` });
  if (ctx.kind === "inmail" && ctx.subject && ctx.subject.length > caps.inmail_subject_max_chars) flags.push({ code: "subject_too_long", severity: "block", message: "InMail subject too long." });
  if (ctx.kind === "connection_note" && /https?:\/\//i.test(body)) flags.push({ code: "link_in_note", severity: "review", message: "Links in connection notes look spammy." });

  for (const r of RULES) if (r.rx.test(text)) flags.push({ code: r.code, severity: r.severity, message: r.message });

  const prices = approvedPrices();
  const claims = approvedNumberTokens();
  for (const n of extractNumbers(text)) {
    const norm = normaliseNumber(n.raw);
    if (n.isMoney && !prices.has(norm)) {
      flags.push({ code: "unapproved_price", severity: "block", message: `Amount "${n.raw}" is not an approved price (${[...prices].join(", ")}).` });
    } else if (!n.isMoney && CLAIM_WORDS.test(n.context) && !claims.has(norm) && !/\b(\d+ (min|minutes|hour|hours|days?|weeks?|months?|scripts|videos|platforms))\b/.test(n.context)) {
      flags.push({ code: "unverified_stat", severity: "review", message: `Number "${n.raw}" near a results word isn't a published claim — verify it's the prospect's own number.` });
    }
  }

  const norm = normaliseForCompare(body, ctx.firstName);
  if (norm.length > 40) {
    for (const other of ctx.otherBodies ?? []) {
      if (similarity(norm, other) >= 0.8) {
        flags.push({ code: "generic_duplicate", severity: "block", message: "Nearly identical to a message drafted for another prospect — personalise it." });
        break;
      }
    }
    for (const prev of ctx.ownHistory ?? []) {
      if (similarity(norm, normaliseForCompare(prev, ctx.firstName)) >= 0.7) {
        flags.push({ code: "repeats_previous", severity: "block", message: "Repeats a previous message to this prospect." });
        break;
      }
    }
  }
  return dedupe(flags);
}

function dedupe(flags: GuardrailFlag[]) {
  const seen = new Set<string>();
  return flags.filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)));
}

export const isBlocked = (flags: GuardrailFlag[]) => flags.some((f) => f.severity === "block");

/** Published URLs the drafts may reference. */
export const allowedLinks = () => Object.values(brain.urls).filter((u) => u.startsWith("http"));
