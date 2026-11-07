import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/db/store.js";
import type { Message, Prospect } from "../src/db/types.js";
import { FakeAi, NoAi } from "../src/ai/claude.js";
import { detectMarket, identityKey, normaliseLinkedinUrl } from "../src/leads/identity.js";
import { detectFormat, parseLinkedinMessages } from "../src/leads/importers.js";
import { classifyByRules } from "../src/leads/classify.js";
import { analyseProspect, importFile } from "../src/leads/reactivation.js";
import { scoreProspect, suggestWeights } from "../src/leads/score.js";
import { withDefaults } from "../src/db/store.js";

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const owner = { name: "Krish Keshri", linkedinUrl: "https://www.linkedin.com/in/krish-keshri-test" };
const NOW = new Date("2026-11-07T06:00:00Z");

const msg = (direction: "inbound" | "outbound", body: string, sent_at: string): Message =>
  ({ id: sent_at, prospect_id: "p", external_id: sent_at, direction, channel: "linkedin_message", sent_at, body, source: "t", analysed: false, created_at: sent_at });
const prospect = (over: Partial<Prospect> = {}): Prospect => withDefaults("prospects", { identity_key: "x", full_name: "Test Person", source: "t", ...over });

describe("identity resolution", () => {
  it("normalises LinkedIn URLs from many shapes", () => {
    expect(normaliseLinkedinUrl("linkedin.com/in/Aisha-Rahman-DXB/")).toBe("https://www.linkedin.com/in/aisha-rahman-dxb");
    expect(normaliseLinkedinUrl("https://uk.linkedin.com/in/x?trk=abc")).toBe("https://www.linkedin.com/in/x");
    expect(normaliseLinkedinUrl("https://example.com/in/x")).toBeNull();
  });
  it("prefers LinkedIn > email > name+company", () => {
    expect(identityKey({ full_name: "A", linkedin_url: "linkedin.com/in/a", email: "a@b.co" })).toBe("li:in/a");
    expect(identityKey({ full_name: "A", email: "A@B.co" })).toBe("em:a@b.co");
    expect(identityKey({ full_name: "Sara Lee", company: "Lee Realty" })).toBe("nc:sara lee|lee realty");
  });
  it("detects markets in priority order and returns unknown without data", () => {
    expect(detectMarket("Dubai, United Arab Emirates")).toBe("dubai");
    expect(detectMarket("Miami, Florida")).toBe("usa");
    expect(detectMarket("Leeds, England, United Kingdom")).toBe("uk");
    expect(detectMarket("Toronto, Canada")).toBe("other");
    expect(detectMarket(null, "")).toBe("unknown");
    expect(detectMarket(null, "Acme Properties")).toBe("unknown");
    expect(detectMarket(null, "Top Dubai broker")).toBe("dubai");
  });
});

describe("importers", () => {
  it("detects formats", () => {
    expect(detectFormat(fx("linkedin_messages.csv"))).toBe("linkedin_messages");
    expect(detectFormat(fx("linkedin_connections.csv"))).toBe("linkedin_connections");
    expect(detectFormat(fx("crm.csv"))).toBe("crm_csv");
  });
  it("separates owner vs prospect messages in a LinkedIn export", () => {
    const contacts = parseLinkedinMessages(fx("linkedin_messages.csv"), owner);
    const aisha = contacts.find((c) => c.full_name === "Aisha Rahman")!;
    expect(aisha.linkedin_url).toBe("https://www.linkedin.com/in/aisha-rahman-dxb");
    expect(aisha.messages.map((m) => m.direction)).toEqual(["outbound", "inbound", "outbound"]);
    expect(contacts.find((c) => c.full_name === "Priya Shah")!.messages).toHaveLength(1);
  });
  it("infers the owner from frequency when no owner URL is configured", () => {
    const contacts = parseLinkedinMessages(fx("linkedin_messages.csv"), { name: "Someone Else", linkedinUrl: null });
    expect(contacts.map((c) => c.full_name).sort()).toEqual(["Aisha Rahman", "Omar Haddad", "Priya Shah", "Tom Becker"]);
  });
});

describe("import + dedupe", () => {
  it("merges the same person across three sources and is idempotent on re-import", async () => {
    const store = new MemoryStore();
    const a = await importFile(store, fx("linkedin_messages.csv"), owner);
    expect(a.prospects_created).toBe(4);
    expect(a.messages_added).toBe(9);
    const again = await importFile(store, fx("linkedin_messages.csv"), owner);
    expect(again.prospects_created).toBe(0);
    expect(again.messages_added).toBe(0);
    expect(again.messages_skipped_duplicate).toBe(9);

    const b = await importFile(store, fx("linkedin_connections.csv"), owner);
    expect(b.prospects_merged).toBe(1); // Aisha
    expect(b.prospects_created).toBe(1); // Daniel
    const c = await importFile(store, fx("crm.csv"), owner);
    expect(c.marked_do_not_contact).toBe(1);

    const all = await store.select("prospects");
    const aishas = all.filter((p) => p.full_name === "Aisha Rahman");
    expect(aishas).toHaveLength(1);
    expect(aishas[0].email).toBe("aisha@rahmanprops.ae");
    expect(aishas[0].title).toBe("Founder & CEO");
    expect(aishas[0].deal_value_estimate).toBe(5999);
    expect(aishas[0].market).toBe("dubai");
    const mark = all.find((p) => p.full_name === "Mark Jones")!;
    expect(mark.contact_status).toBe("do_not_contact");
    const sara = all.find((p) => p.full_name === "Sara Lee")!;
    expect((await store.select("messages", { prospect_id: sara.id })).map((m) => m.direction)).toEqual(["inbound", "outbound"]);
  });
});

describe("conversation classification (rules)", () => {
  const p = prospect();
  it("detects pricing questions", () => {
    const c = classifyByRules(p, [msg("outbound", "Hi", "2026-08-01T10:00:00Z"), msg("inbound", "How much does it cost?", "2026-08-02T10:00:00Z")], NOW);
    expect(c.category).toBe("C_asked_pricing");
    expect(c.follow_up_priority).toBe(1);
  });
  it("hard-enforces opt-outs", () => {
    const c = classifyByRules(p, [msg("inbound", "Please stop messaging me", "2026-08-02T10:00:00Z")], NOW);
    expect(c.opted_out).toBe(true);
    expect(c.category).toBe("I_not_worth_pursuing");
  });
  it("separates soft declines (may revisit) from hard declines", () => {
    expect(classifyByRules(p, [msg("inbound", "Not right now, maybe next year", "2026-01-02T10:00:00Z")], NOW).category).toBe("H_declined_may_revisit");
    expect(classifyByRules(p, [msg("inbound", "No thanks, not for me", "2026-10-02T10:00:00Z")], NOW).category).toBe("I_not_worth_pursuing");
  });
  it("recognises info requests, proposals, silence after a reply, and never-engaged", () => {
    expect(classifyByRules(p, [msg("inbound", "Can you send me more info?", "2026-09-02T10:00:00Z")], NOW).category).toBe("D_requested_info");
    expect(classifyByRules(p, [msg("inbound", "Ok", "2026-09-02T10:00:00Z"), msg("outbound", "Sent the proposal over", "2026-09-03T10:00:00Z")], NOW).category).toBe("E_received_proposal");
    expect(classifyByRules(p, [msg("inbound", "Thanks!", "2026-09-02T10:00:00Z"), msg("outbound", "Glad it helped", "2026-09-03T10:00:00Z")], NOW).category).toBe("B_replied_then_silent");
    expect(classifyByRules(p, [msg("outbound", "Hi", "2026-09-03T10:00:00Z")], NOW).category).toBe("never_engaged");
    expect(classifyByRules(p, [msg("inbound", "Sounds interesting, let's book a call", "2026-09-02T10:00:00Z")], NOW).category).toBe("F_interested_never_booked");
  });
  it("Claude can never override an opt-out", async () => {
    const store = new MemoryStore();
    const pr = await store.insert("prospects", { identity_key: "k", full_name: "Opt Out", source: "t" });
    await store.insert("messages", { prospect_id: pr.id, external_id: "e1", direction: "inbound", sent_at: "2026-10-01T00:00:00Z", body: "unsubscribe me please", source: "t" });
    const ai = new FakeAi({ classify_conversation: () => ({ category: "C_asked_pricing", interest_level: "high", offer_fit: "strong", previous_objection: null, opted_out: false, opt_out_evidence: null, buying_signals: [], strategy: "interested", summary: "x", recommended_next_action: "pitch", follow_up_priority: 1 }) });
    const r = await analyseProspect(store, ai, pr, { now: NOW });
    expect(r.prospect.contact_status).toBe("opted_out");
    expect(ai.calls).toHaveLength(0); // never even asked
    expect(r.score.score).toBe(0);
  });
});

describe("lead scoring", () => {
  it("treats unknowns as neutral, not negative, and reports low confidence", () => {
    const s = scoreProspect(prospect(), NOW);
    expect(s.confidence).toBe(0);
    expect(s.score).toBe(50);
    expect(s.breakdown.every((b) => b.value === null && b.reason.startsWith("UNKNOWN"))).toBe(true);
  });
  it("scores a researched Dubai founder who asked about pricing as hot, with an explanation", () => {
    const s = scoreProspect(prospect({
      title: "Founder & CEO", company: "Rahman Properties", market: "dubai", lead_category: "C_asked_pricing",
      last_inbound_at: "2026-11-01T00:00:00Z", research: { posting_frequency: "irregular", has_video: false, ability_to_invest: "high", headcount: 12 },
    }), NOW);
    expect(s.class_id).toBe("hot");
    expect(s.score).toBeGreaterThanOrEqual(85);
    expect(s.explanation).toContain("icp_fit");
  });
  it("caps hot/high when too little is verified", () => {
    const s = scoreProspect(prospect({ lead_category: "C_asked_pricing", last_inbound_at: "2026-11-05T00:00:00Z" }), NOW);
    expect(["warm", "low", "not_qualified"]).toContain(s.class_id);
  });
  it("zeroes opted-out prospects", () => {
    expect(scoreProspect(prospect({ contact_status: "opted_out", title: "Founder", company: "X Realty" }), NOW).score).toBe(0);
  });
  it("only suggests calibrated weights with enough outcomes", () => {
    expect(suggestWeights([]).ready).toBe(false);
  });
});

describe("analysis end-to-end without Claude", () => {
  it("imports, classifies, scores and sets next actions honestly", async () => {
    const store = new MemoryStore();
    await importFile(store, fx("linkedin_messages.csv"), owner);
    for (const p of await store.select("prospects")) await analyseProspect(store, new NoAi(), p, { now: NOW });
    const byName = Object.fromEntries((await store.select("prospects")).map((p) => [p.full_name, p]));
    expect(byName["Aisha Rahman"].lead_category).toBe("C_asked_pricing");
    expect(byName["Tom Becker"].contact_status).toBe("opted_out");
    expect(byName["Tom Becker"].next_action).toBe("Do not contact");
    expect(byName["Priya Shah"].lead_category).toBe("never_engaged");
    expect(byName["Omar Haddad"].lead_category).toBe("F_interested_never_booked");
    expect(byName["Omar Haddad"].stage).toBe("interested");
    const events = await store.select("events", { type: "lead.classified" });
    expect(events.length).toBeGreaterThanOrEqual(3);
  });
});
