import { NoAi } from "./ai/claude.js";
import { approveDraft, markReplied, markSent } from "./approvals/index.js";
import type { Store } from "./db/store.js";
import type { Env } from "./lib/env.js";
import { logEvent } from "./lib/audit.js";
import { analyseProspect, upsertContact } from "./leads/reactivation.js";
import { draftOutreach } from "./outreach/drafts.js";
import { addInvoice, createDeal, markPaid, updateDealStatus } from "./revenue/index.js";
import { SvgTemplateProvider } from "./design/carousel.js";

/**
 * Synthetic development data. Names/companies are fictional. Refuses to run in production, and every row is
 * flagged is_synthetic so production metrics can never include it.
 */
export async function seedSynthetic(store: Store, env: Env) {
  if (env.appEnv === "production") throw new Error("Refusing to seed synthetic data in production.");
  const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const people = [
    { n: "Layla Haddad (DEMO)", c: "Palm Crest Realty (demo)", t: "Founder & CEO", l: "Dubai, UAE", r: { posting_frequency: "irregular", has_video: false, ability_to_invest: "high", headcount: 18 }, convo: [["out", 40, "Layla, your Creek Harbour off-plan breakdown was sharp."], ["in", 39, "Thanks! What would something like this cost per month?"]] },
    { n: "Omar Siddiqui (DEMO)", c: "Marina Keys Properties (demo)", t: "Team Leader", l: "Dubai Marina, UAE", r: { posting_frequency: "regular", has_video: false }, convo: [["out", 25, "Omar, congrats on the new team."], ["in", 24, "Sounds interesting, tell me more about how it works."], ["out", 23, "Happy to — would a short call help?"]] },
    { n: "Hannah Price (DEMO)", c: "Price & Co Estates (demo)", t: "Estate Agent", l: "Manchester, England", r: { posting_frequency: "none" }, convo: [["out", 70, "Hi Hannah, saw your post about first-time buyers."], ["in", 68, "Not right now, maybe next year."]] },
    { n: "Jake Morales (DEMO)", c: "Morales Home Group (demo)", t: "Realtor", l: "Austin, Texas", r: { posting_frequency: "irregular", has_video: true }, convo: [["out", 12, "Jake, your listing walkthroughs are great."], ["in", 11, "Can you send me more info?"]] },
    { n: "Priya Nair (DEMO)", c: "Skyline Realty (demo)", t: "Property Consultant", l: "Business Bay, Dubai", r: {}, convo: [["out", 9, "Hi Priya — quick question on your content plans."]] },
    { n: "Ethan Clarke (DEMO)", c: "Clarke Lettings (demo)", t: "Managing Director", l: "London, UK", r: { posting_frequency: "irregular", ability_to_invest: "medium", headcount: 9 }, convo: [["out", 30, "Ethan, saw Clarke Lettings expanding to Hackney."], ["in", 29, "Please stop messaging me."]] },
    { n: "Sofia Ruiz (DEMO)", c: "Ruiz Realty Partners (demo)", t: "Broker Owner", l: "Miami, Florida", r: { posting_frequency: "regular", has_video: false, ability_to_invest: "high", headcount: 25 }, convo: [["out", 50, "Sofia, your Brickell market updates stand out."], ["in", 49, "Interested — let's book a call."], ["out", 48, "Great, here's the proposal for the annual plan."]] },
    { n: "Rashid Al Mansoori (DEMO)", c: "Desert Rose Homes (demo)", t: "Real Estate Broker", l: "Abu Dhabi, UAE", r: { posting_frequency: "none", ability_to_invest: "medium" }, convo: [] },
    { n: "Chloe Bennett (DEMO)", c: "Bennett Property (demo)", t: "Senior Broker", l: "Edinburgh, Scotland", r: { posting_frequency: "regular", has_video: true }, convo: [] },
    { n: "Marcus Lee (DEMO)", c: "Lee & Partners Realty (demo)", t: "Head of Sales", l: "Phoenix, Arizona", r: { posting_frequency: "irregular" }, convo: [["out", 15, "Marcus, your Scottsdale luxury posts are strong."], ["in", 14, "Thanks."], ["out", 13, "Is content a priority for the team this quarter?"]] },
  ];
  const ids: string[] = [];
  for (const [i, p] of people.entries()) {
    const { prospect } = await upsertContact(store, {
      full_name: p.n, linkedin_url: `https://www.linkedin.com/in/demo-${i}-${p.n.split(" ")[0].toLowerCase()}`, email: null, company: p.c, title: p.t, headline: `${p.t} at ${p.c}`, location: p.l,
      notes: null, deal_value_estimate: null, status_hint: null, last_contacted_at: null, do_not_contact: false,
      messages: p.convo.map(([dir, d, body], j) => ({ direction: dir === "out" ? "outbound" : "inbound", sent_at: day(d as number), body: body as string, channel: "linkedin_message", external_ref: `demo-${i}-${j}` })),
    }, i < 7 ? "linkedin_messages" : "sales_navigator_manual", { synthetic: true });
    await store.update("prospects", prospect.id, { research: { ...p.r, recent_post_at: p.r.posting_frequency && p.r.posting_frequency !== "none" ? day(5 + i) : null } as never });
    ids.push(prospect.id);
  }
  const ai = new NoAi();
  for (const id of ids) await analyseProspect(store, ai, (await store.get("prospects", id))!, { source: "seed" });
  for (const id of ids) await draftOutreach(store, ai, (await store.get("prospects", id))!, { source: "seed" });

  // A few owner actions so every tracker section has (synthetic) data.
  const drafts = await store.select("drafts", { status: "pending_approval" });
  for (const d of drafts.slice(0, 3)) {
    await approveDraft(store, d.id);
    await markSent(store, d.id);
  }
  await markReplied(store, ids[1], { text: "Yes, Thursday works for a call.", sentiment: "positive" });
  const appt = await store.insert("appointments", { prospect_id: ids[1], idempotency_key: "demo-appt-1", start_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), end_at: new Date(Date.now() + 2 * 86_400_000 + 1_800_000).toISOString(), timezone: "Asia/Kolkata", status: "confirmed", prospect_confirmation: "Yes, Thursday works for a call. (demo)", is_synthetic: true });
  await store.insert("appointments", { prospect_id: ids[6], idempotency_key: "demo-appt-2", start_at: day(3), end_at: day(3), timezone: "Asia/Kolkata", status: "attended", qualified: true, prospect_confirmation: "demo", is_synthetic: true });
  void appt;
  const won = await createDeal(store, { prospectId: ids[6], plan: "annual", contractValue: 5999, probability: 0.8, status: "proposal" });
  await updateDealStatus(store, won.id, "won");
  const inv = await addInvoice(store, { dealId: won.id, amount: 5999, invoiceRef: "DEMO-001" });
  await markPaid(store, inv.id, { verified: true });
  const open = await createDeal(store, { prospectId: ids[0], plan: "monthly", contractValue: 999, probability: 0.5 });
  await addInvoice(store, { dealId: open.id, amount: 999, invoiceRef: "DEMO-002", dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) });

  const slides = await new SvgTemplateProvider().render([
    { kind: "cover", title: "Why Dubai agents lose listings to worse agents", body: "It's not skill. It's visibility." },
    { kind: "point", title: "Buyers pick who they already know", body: "Before anyone calls, they've watched someone explain the market." },
    { kind: "point", title: "Listing photos aren't content", body: "They show the property, not why you're the agent to trust." },
    { kind: "cta", title: "Want the 4-pillar content plan?", body: "Comment PLAN and I'll send it." },
  ]);
  const topics = [
    { topic: "Why Dubai agents lose listings to worse agents (DEMO)", pillar: "Real estate personal branding", format: "carousel", status: "pending_approval", assets: slides.map((s) => ({ kind: "carousel_slide", ...s })) },
    { topic: "The 'just sold' post problem (DEMO)", pillar: "Marketing mistakes", format: "text", status: "published", metrics: { impressions: 4200, reactions: 61, comments: 14, reposts: 3 } },
    { topic: "Off-plan buyers' 5 questions, answered on camera (DEMO)", pillar: "Video marketing", format: "video", status: "idea" },
    { topic: "What an hour a week of recording looks like (DEMO)", pillar: "Behind-the-scenes", format: "text", status: "approved" },
  ];
  for (const t of topics) {
    await store.insert("content_items", { ...t, hook: t.topic, body: "Synthetic demo content.", cta: "Comment PLAN", audience: "Dubai real estate agents", objective: "conversation", reasoning: "demo", suggested_visual: "Black/gold carousel", is_synthetic: true, published_at: t.status === "published" ? day(4) : null } as never);
  }
  await store.insert("workflow_runs", { workflow: "morning", slot: "demo", status: "succeeded", started_at: day(0.2), finished_at: day(0.19), stats: { demo: true } });
  await store.insert("workflow_runs", { workflow: "backup", slot: "demo", status: "succeeded", started_at: day(0.6), finished_at: day(0.59), stats: { demo: true } });
  await logEvent(store, { type: "seed", source: "cli", summary: "Synthetic demo data loaded (development only)", is_synthetic: true });
  return { prospects: ids.length, note: "All rows flagged is_synthetic=true; production metrics exclude them." };
}
