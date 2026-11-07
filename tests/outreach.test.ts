import { describe, expect, it } from "vitest";
import { FakeAi, NoAi } from "../src/ai/claude.js";
import { MemoryStore } from "../src/db/store.js";
import type { Prospect } from "../src/db/types.js";
import { checkDraft, isBlocked } from "../src/outreach/guardrails.js";
import { draftOutreach, plannedKinds } from "../src/outreach/drafts.js";
import { ApprovalError, approveDraft, editDraft, markConnectionOutcome, markDoNotContact, markReplied, markSent, rejectDraft, snoozeDraft, wakeSnoozed } from "../src/approvals/index.js";
import { analyseByRules, analyseSalesConversation } from "../src/sales/agent.js";
import { setSetting, getSetting } from "../src/lib/audit.js";

async function seedProspect(store: MemoryStore, over: Partial<Prospect> = {}) {
  return store.insert("prospects", {
    identity_key: "li:in/aisha" + Math.random(), full_name: "Aisha Rahman", first_name: "Aisha", title: "Founder", company: "Rahman Properties",
    location: "Dubai, UAE", market: "dubai", source: "sales_navigator_manual", ...over,
  });
}

const pkg = (over: Record<string, unknown> = {}) => ({
  insufficient_context: false, missing_info: [], observation: "Founder of Rahman Properties in Dubai (from profile).",
  positioning: "Scripts + DM system", cta: "Quick question", follow_up_in_days: 4, rationale: "Dubai founder, high fit",
  connection_note: "Hi Aisha — I work with Dubai agency founders on short-form video. Rahman Properties caught my eye. Would be good to connect.",
  initial_message: "Thanks for connecting Aisha. Is content something Rahman Properties is actively investing in this year?",
  follow_up: "Aisha, one idea for Rahman Properties: a weekly off-plan explainer series. Worth a chat?",
  inmail_subject: "Rahman Properties content", inmail_body: "Hi Aisha, I run HustleGrowthz. We script, edit and publish short-form video for real estate founders. Open to a 30-minute call?",
  reactivation: null, reply: null, ...over,
});

describe("guardrails", () => {
  it("blocks guarantees, discounts, unapproved prices and LinkedIn publishing promises", () => {
    expect(isBlocked(checkDraft("We guarantee 50 leads a month.", { kind: "initial_message" }))).toBe(true);
    expect(checkDraft("I can give you 20% off this month", { kind: "initial_message" }).map((f) => f.code)).toContain("discount");
    expect(checkDraft("It's only $799 per month", { kind: "initial_message" }).map((f) => f.code)).toContain("unapproved_price");
    expect(checkDraft("We'll post on your LinkedIn every day", { kind: "initial_message" }).map((f) => f.code)).toContain("linkedin_publishing_claim");
    expect(checkDraft("Our agents achieved 3x more listings", { kind: "initial_message" }).map((f) => f.code)).toContain("real_estate_results_claim");
  });
  it("allows approved pricing and published proof", () => {
    const f = checkDraft("It's $999 a month or $5,999 for the year. One client, Amy, saw 1M+ views — individual results, not typical.", { kind: "reply" });
    expect(isBlocked(f)).toBe(false);
    expect(f.map((x) => x.code)).not.toContain("unverified_stat");
  });
  it("enforces connection note length", () => {
    expect(checkDraft("x".repeat(400), { kind: "connection_note" }).map((f) => f.code)).toContain("too_long");
  });
  it("blocks near-identical generic messages across prospects", () => {
    const body = "Hi Sam, I help real estate agents grow with short-form content and a DM system. Would you be open to a quick chat this week about it?";
    const other = "hi {name} i help real estate agents grow with short form content and a dm system would you be open to a quick chat this week about it";
    expect(checkDraft(body, { kind: "initial_message", firstName: "Sam", otherBodies: [other] }).map((f) => f.code)).toContain("generic_duplicate");
  });
});

describe("draft generation", () => {
  it("plans connection + InMail for a fresh Sales Navigator prospect, reply for an inbound-last thread", async () => {
    const store = new MemoryStore();
    const p = await seedProspect(store);
    expect(plannedKinds(p, [])).toEqual(["connection_note", "initial_message", "follow_up", "inmail"]);
    expect(plannedKinds({ ...p, contact_status: "opted_out" }, [])).toEqual([]);
  });
  it("creates approval-queued drafts with Claude, idempotently", async () => {
    const store = new MemoryStore();
    const p = await seedProspect(store);
    const ai = new FakeAi({ outreach_package: () => pkg() });
    const r1 = await draftOutreach(store, ai, p);
    expect(r1.created.map((d) => d.kind).sort()).toEqual(["connection_note", "follow_up", "initial_message", "inmail"]);
    expect(r1.created.every((d) => d.status === "pending_approval")).toBe(true);
    expect(r1.created.find((d) => d.kind === "inmail")!.guardrail_flags.map((f) => f.code)).toContain("inmail_unverified");
    const r2 = await draftOutreach(store, ai, (await store.get("prospects", p.id))!);
    expect(r2.created).toHaveLength(0);
    expect(ai.calls).toHaveLength(1);
    expect((await store.get("prospects", p.id))!.stage).toBe("pending_approval");
  });
  it("blocks a Claude draft that breaks policy", async () => {
    const store = new MemoryStore();
    const p = await seedProspect(store);
    const ai = new FakeAi({ outreach_package: () => pkg({ initial_message: "We guarantee you 30 new listings in 60 days." }) });
    const r = await draftOutreach(store, ai, p);
    expect(r.created.find((d) => d.kind === "initial_message")!.status).toBe("blocked");
  });
  it("refuses to write a generic template when nothing specific is known", async () => {
    const store = new MemoryStore();
    const p = await store.insert("prospects", { identity_key: "n:x", full_name: "Unknown Person", source: "manual" });
    const r = await draftOutreach(store, new NoAi(), p);
    expect(r.created).toHaveLength(0);
    expect(r.skipped).toMatch(/insufficient/);
  });
  it("never drafts for do-not-contact prospects", async () => {
    const store = new MemoryStore();
    const p = await seedProspect(store, { contact_status: "do_not_contact" });
    const r = await draftOutreach(store, new FakeAi({ outreach_package: () => pkg() }), p);
    expect(r.created).toHaveLength(0);
  });
});

describe("approval workflow", () => {
  async function setup() {
    const store = new MemoryStore();
    const p = await seedProspect(store);
    const r = await draftOutreach(store, new FakeAi({ outreach_package: () => pkg() }), p);
    return { store, p, drafts: r.created };
  }
  it("approve → mark sent is the only way to record a sent message", async () => {
    const { store, p, drafts } = await setup();
    const d = drafts.find((x) => x.kind === "connection_note")!;
    await expect(markSent(store, d.id)).rejects.toThrow(ApprovalError);
    expect(await store.select("messages", { prospect_id: p.id })).toHaveLength(0);
    await approveDraft(store, d.id);
    await markSent(store, d.id);
    const msgs = await store.select("messages", { prospect_id: p.id });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].source).toBe("owner_confirmed");
    expect((await store.get("prospects", p.id))!.stage).toBe("manually_contacted");
    await markConnectionOutcome(store, d.id, "accepted");
    expect((await store.get("prospects", p.id))!.stage).toBe("connected");
  });
  it("edit re-runs guardrails; blocked drafts can't be approved unless the flag is owner-overridable", async () => {
    const { store, drafts } = await setup();
    const d = drafts.find((x) => x.kind === "initial_message")!;
    await editDraft(store, d.id, "Special price for you: 10% discount if you sign this week.");
    await expect(approveDraft(store, d.id)).rejects.toThrow(/Fix before approving/);
    const ok = await approveDraft(store, d.id, { acknowledgeFlags: ["discount", "fake_urgency"] });
    expect(ok.status).toBe("approved");
    const d2 = drafts.find((x) => x.kind === "follow_up")!;
    await editDraft(store, d2.id, "We guarantee results.");
    await expect(approveDraft(store, d2.id, { acknowledgeFlags: ["guarantee"] })).rejects.toThrow();
  });
  it("reject, snooze and wake", async () => {
    const { store, drafts } = await setup();
    await rejectDraft(store, drafts[0].id, "tone");
    expect((await store.get("drafts", drafts[0].id))!.status).toBe("rejected");
    await snoozeDraft(store, drafts[1].id, "2026-11-20");
    expect(await wakeSnoozed(store, "2026-11-19")).toBe(0);
    expect(await wakeSnoozed(store, "2026-11-20")).toBe(1);
    expect((await store.get("drafts", drafts[1].id))!.status).toBe("pending_approval");
  });
  it("InMail sending decrements known credits; do-not-contact withdraws drafts", async () => {
    const { store, p, drafts } = await setup();
    await setSetting(store, "inmail_credits_balance", 5);
    const inmail = drafts.find((x) => x.kind === "inmail")!;
    await approveDraft(store, inmail.id);
    await markSent(store, inmail.id);
    expect(await getSetting(store, "inmail_credits_balance", null)).toBe(4);
    await markDoNotContact(store, p.id, "asked by phone");
    const left = await store.select("drafts", { prospect_id: p.id });
    expect(left.filter((d) => ["pending_approval", "approved"].includes(d.status))).toHaveLength(0);
    await expect(approveDraft(store, drafts[0].id)).rejects.toThrow();
  });
  it("markReplied records the reply and advances the stage", async () => {
    const { store, p } = await setup();
    const fresh = await markReplied(store, p.id, { text: "Yes, interested — what's the price?", sentiment: "positive" });
    expect(fresh.stage).toBe("interested");
    expect((await store.select("messages", { prospect_id: p.id }))[0].direction).toBe("inbound");
  });
});

describe("sales agent", () => {
  it("rules fallback flags sensitive requests and booking readiness", async () => {
    const store = new MemoryStore();
    const p = await seedProspect(store);
    await store.insert("messages", { prospect_id: p.id, external_id: "1", direction: "inbound", sent_at: "2026-11-01T00:00:00Z", body: "What's the price? Can you do a discount for me?", source: "t" });
    const a = analyseByRules(p, await store.select("messages", { prospect_id: p.id }));
    expect(a.booking_readiness).toBe("ready");
    expect(a.sensitive_commitment_requested).toMatch(/discount/);
    expect(a.needs_owner_attention).toBe(true);
  });
  it("drops invented case-study ids from Claude and guardrails the reply", async () => {
    const store = new MemoryStore();
    const p = await seedProspect(store);
    await store.insert("messages", { prospect_id: p.id, external_id: "1", direction: "inbound", sent_at: "2026-11-01T00:00:00Z", body: "Do you have results for agents?", source: "t" });
    const ai = new FakeAi({ sales_conversation: () => ({
      strategy: "case_study_request", prospect_type_reasoning: "asked for proof", buying_signals: ["asked for results"], objections: [{ id: "proof", quote: "results for agents?" }],
      discovery_questions: ["What do you post now?"], recommended_case_study_ids: ["amy", "made_up_dubai_agent"], booking_readiness: "warming",
      needs_owner_attention: false, owner_attention_reason: null, suggested_stage: "replied",
      reply_draft: "Honest answer: our published case studies don't name industries. Amy saw 1M+ views in under two weeks — individual result, not typical. Want me to connect you with a current client on a call?",
      sensitive_commitment_requested: null,
    }) });
    const a = await analyseSalesConversation(store, ai, p);
    expect(a.recommended_case_studies.map((c) => c.id)).toEqual(["amy"]);
    expect(isBlocked(a.reply_flags)).toBe(false);
  });
});
