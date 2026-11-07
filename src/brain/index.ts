import brainJson from "../../knowledge/business_brain.json" with { type: "json" };

export type Brain = typeof brainJson;
export const brain: Brain = brainJson;

export type StrategyId = keyof Omit<Brain["sales_strategies"], "kind">;
export const STRATEGY_IDS = Object.keys(brain.sales_strategies).filter((k) => k !== "kind") as StrategyId[];

export function normaliseNumber(s: string): string {
  const t = s.toLowerCase().replace(/[,$\s+]/g, "");
  const m = t.match(/^([\d.]+)(k|m|million|b)?$/);
  if (!m) return t;
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1e3;
  if (m[2] === "m" || m[2] === "million") n *= 1e6;
  if (m[2] === "b") n *= 1e9;
  return String(+n.toFixed(2));
}

/** All numeric tokens the business is allowed to quote (prices + published proof), normalised. */
export function approvedNumberTokens(b: Brain = brain): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => out.add(normaliseNumber(s));
  for (const a of b.pricing.approved_amounts) add(String(a));
  for (const a of b.proof.aggregate) a.numbers.forEach(add);
  for (const c of b.proof.case_studies) c.numbers.forEach(add);
  for (const s of b.proof.screenshot_testimonials) s.numbers.forEach(add);
  return out;
}

/** Approved price amounts only (for the "unapproved price" guardrail). */
export function approvedPrices(b: Brain = brain): Set<string> {
  return new Set(b.pricing.approved_amounts.map((a) => normaliseNumber(String(a))));
}

/**
 * Compact, stable text rendering of the brain for Claude's system prompt.
 * Deterministic (no timestamps) so it is prompt-cache friendly.
 */
export function brainForPrompt(b: Brain = brain): string {
  const offer = b.offers[0];
  return [
    "# HUSTLEGROWTHZ_BUSINESS_BRAIN (verified " + b.last_verified + ")",
    "## Non-negotiable rules", ...b.rules.map((r) => "- " + r),
    "## Company", ...Object.values(b.company).map((c) => `- ${c.text} [${c.source}]`),
    "## Offer: Authority Flywheel™", `- ${offer.summary.text}`, `- ${offer.not_just_editing.text}`,
    "### Deliverables", ...offer.deliverables.map((d) => `- ${d.text}`),
    "### Limits", ...offer.limits.map((d) => `- ${d.text}`),
    "### Real estate angle (source " + offer.real_estate_angle.source + ")",
    `- ${offer.real_estate_angle.headline} ${offer.real_estate_angle.problem}`,
    ...offer.real_estate_angle.pillars.map((p) => "- " + p),
    `- DM system: ${offer.real_estate_angle.dm_system}`,
    ...offer.real_estate_angle.faqs.map((f) => `- Q: ${f.q} A: ${f.a}`),
    "## Approved pricing (USD, the ONLY prices you may state)",
    ...b.pricing.plans.map((p) => `- ${p.name}: $${p.price.toLocaleString("en-US")} per ${p.period}. ${p.billing}`),
    `- ${b.pricing.same_service.text} ${b.pricing.taxes.text} ${b.pricing.start_monthly.text}`,
    `- ${b.pricing.discount_policy.text}`,
    "## Payment terms", ...b.payment_terms.map((p) => "- " + p.text),
    "## Guarantees", `- ${b.guarantees.policy.text}`, `- Testimonial disclaimer: ${b.guarantees.testimonial_disclaimer.text}`,
    "## Published proof (quote exactly; include the disclaimer when citing results)",
    ...b.proof.aggregate.map((a) => `- ${a.text}`),
    ...b.proof.case_studies.map((c) => `- [${c.id}] ${c.name}: ${c.claim} (${c.url})`),
    ...b.proof.screenshot_testimonials.map((s) => `- ${s.name}: ${s.text}`),
    `- ${b.proof.proof_offer.text}`, `- NOTE: ${b.proof.industry_note}`,
    "## ICP", `- Website: ${b.icp.website_fit.text}`, `- Not a fit: ${b.icp.website_not_fit.text}`, `- ${b.icp.audience_size.text}`,
    `- Owner targets (internal): primary ${b.icp.owner_targets.primary}; secondary ${b.icp.owner_targets.secondary}; third ${b.icp.owner_targets.third}. ${b.icp.owner_targets.note}`,
    "## Qualification", ...b.qualification_criteria.must_have.map((x) => "- must: " + x),
    ...b.qualification_criteria.strong_signals.map((x) => "- signal: " + x),
    ...b.qualification_criteria.disqualifiers.map((x) => "- disqualify: " + x),
    `- ${b.qualification_criteria.vanity_warning}`,
    "## Competitive advantages", ...b.competitive_advantages.map((c) => "- " + c.text),
    "## FAQs", ...b.faqs.map((f) => `- Q: ${f.q} A: ${f.a}`),
    "## Objections", ...b.objections.map((o) => `- [${o.id}] "${o.objection}": ${o.response}`),
    "## Sales strategies (internal)", ...STRATEGY_IDS.map((id) => {
      const s = b.sales_strategies[id];
      return `- ${id}: goal=${s.goal}; approach=${s.approach}; cta=${s.cta}`;
    }),
    "## Discovery questions", ...b.discovery_questions.map((q) => "- " + q),
    "## Brand voice", `- Traits: ${b.brand_voice.traits.join("; ")}`, `- Do: ${b.brand_voice.do.join("; ")}`, `- Don't: ${b.brand_voice.dont.join("; ")}`,
    "## URLs", ...Object.entries(b.urls).map(([k, u]) => `- ${k}: ${u}`),
  ].join("\n");
}

export function findCaseStudy(id: string, b: Brain = brain) {
  return b.proof.case_studies.find((c) => c.id === id) ?? null;
}
