import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { brain, brainForPrompt, approvedPrices, normaliseNumber } from "../src/brain/index.js";
import { FakeAi, NoAi } from "../src/ai/claude.js";
import { MemoryStore } from "../src/db/store.js";
import { renderSlide, SvgTemplateProvider, wrap } from "../src/design/carousel.js";
import { attributeLead, confirmPublished, contentPerformance, ContentError, draftPost, generateIdeas, recordMetrics, scheduleWeek, setContentStatus } from "../src/content/index.js";
import { addObservation, competitorInsights, researchCompetitor, upsertCompetitor, CompetitorError } from "../src/competitors/index.js";

const snapshot = (n: string) => readFileSync(new URL(`../knowledge/website_snapshot/${n}`, import.meta.url), "utf8");

describe("business brain accuracy (verified against the website snapshot)", () => {
  it("every pricing amount appears on the scraped pricing/terms pages", () => {
    const pages = snapshot("pricing.md") + snapshot("terms-and-conditions.md") + snapshot("faq.md");
    for (const plan of brain.pricing.plans) expect(pages).toContain(`$${plan.price.toLocaleString("en-US")}`);
    expect(pages).toContain("$499.92");
    expect(pages).toContain("$11,988");
  });
  it("case-study claims match the results page", () => {
    const results = snapshot("results.md") + snapshot("home.md");
    for (const c of brain.proof.case_studies) {
      expect(results).toContain(c.name);
      expect(results).toContain(c.url.replace("https://", ""));
    }
    expect(results).toContain("250M+");
    expect(results).toContain("200+");
  });
  it("records that there is no guarantee and that LinkedIn is not a delivered platform", () => {
    expect(snapshot("faq.md")).toMatch(/guarantee/i);
    expect(brain.guarantees.policy.text).toMatch(/No guarantee/);
    expect(snapshot("for-consultants.md")).toMatch(/LinkedIn publishing isn't part of the standard service/);
    expect(brain.rules.join(" ")).toMatch(/LinkedIn publishing is NOT part of the standard service/);
  });
  it("real-estate page exists and no real-estate results are claimed", () => {
    expect(snapshot("for-real-estate-agents.md")).toMatch(/Content that wins the listing/);
    expect(brain.proof.case_studies.every((c) => c.industry === null)).toBe(true);
    expect(brain.proof.industry_note).toMatch(/NO published real-estate-specific case studies/);
  });
  it("every website claim carries a source URL on hustlegrowthz.com", () => {
    const urls = JSON.stringify(brain).match(/"source":\s*"[^"]+"/g) ?? [];
    expect(urls.length).toBeGreaterThan(20);
    for (const u of urls) expect(u).toMatch(/hustlegrowthz\.com/);
  });
  it("prompt rendering is deterministic (cache-friendly) and includes approved prices only", () => {
    expect(brainForPrompt()).toBe(brainForPrompt());
    expect(brainForPrompt()).toContain("$999");
    expect([...approvedPrices()].sort()).toEqual(["11988", "499.92", "5989", "5999", "999"].sort());
    expect(normaliseNumber("1.5M")).toBe("1500000");
  });
});

describe("design studio", () => {
  it("renders on-brand 1080×1350 SVG slides with escaped text", async () => {
    const slides = await new SvgTemplateProvider().render([{ kind: "cover", title: "Agents <script>alert(1)</script> & listings" }, { kind: "point", title: "One", body: "Two" }, { kind: "cta", title: "Comment PLAN" }]);
    expect(slides).toHaveLength(3);
    expect(slides[0].svg).toContain('width="1080" height="1350"');
    expect(slides[0].svg).toContain("#C9A45C");
    expect(slides[0].svg).not.toContain("<script>");
    expect(slides[0].svg).toContain("&lt;script&gt;");
    expect(renderSlide({ kind: "stat", title: "t", stat: "250M+" }, 1, 3)).toContain("250M+");
    expect(wrap("a b c d e f", 3)).toEqual(["a b", "c d", "e f"]);
  });
});

describe("content department", () => {
  const ideas = (n: number) => ({ ideas: Array.from({ length: n }, (_, i) => ({ pillar: ["Authority positioning", "Marketing mistakes", "Video marketing"][i % 3], audience: "Dubai agents", topic: `Topic ${i}`, hook: `Hook ${i}`, main_content: "- a\n- b", cta: "Comment PLAN", format: i === 0 ? "carousel" : "text", objective: "conversation", strategic_reasoning: "why", suggested_visual: "black/gold" })) });
  it("requires Claude instead of inventing ideas", async () => {
    await expect(generateIdeas(new MemoryStore(), new NoAi(), { count: 3, weekOf: "2026-11-09" })).rejects.toThrow(ContentError);
  });
  it("generates ideas idempotently, schedules a week, drafts with carousel visuals, and gates publishing", async () => {
    const store = new MemoryStore();
    const ai = new FakeAi({
      content_ideas: () => ideas(5),
      content_post: () => ({ body: "Hook line\n\nBody.", first_comment: null, slides: [{ kind: "cover", title: "Cover", body: null, stat: null }, { kind: "cta", title: "CTA", body: "Comment", stat: null }] }),
    });
    expect(await generateIdeas(store, ai, { count: 5, weekOf: "2026-11-09" })).toHaveLength(5);
    expect(await generateIdeas(store, ai, { count: 5, weekOf: "2026-11-09" })).toHaveLength(0);
    const sched = await scheduleWeek(store, "2026-11-09");
    expect(sched).toHaveLength(5);
    expect(new Set(sched.map((s) => s.scheduled_for)).size).toBe(5);
    const carousel = (await store.select("content_items")).find((c) => c.format === "carousel")!;
    const drafted = await draftPost(store, ai, carousel.id);
    expect(drafted.status).toBe("pending_approval");
    expect(drafted.assets).toHaveLength(2);
    await expect(confirmPublished(store, carousel.id, {})).rejects.toThrow(/Approve/);
    await setContentStatus(store, carousel.id, "approve");
    await expect(confirmPublished(store, carousel.id, { url: "https://evil.example/x" })).rejects.toThrow();
    await confirmPublished(store, carousel.id, { url: "https://www.linkedin.com/posts/x" });
    await expect(recordMetrics(store, carousel.id, { impressions: -5 })).rejects.toThrow();
    await recordMetrics(store, carousel.id, { impressions: 1000, reactions: 20, comments: 5, reposts: 0 });
    const p = await store.insert("prospects", { identity_key: "x", full_name: "X", source: "t" });
    await attributeLead(store, carousel.id, p.id);
    await attributeLead(store, carousel.id, p.id);
    const perf = contentPerformance(await store.select("content_items"));
    expect(perf.published).toBe(1);
    expect(perf.by_pillar[0].engagement_rate).toBe(2.5);
    expect(perf.by_pillar[0].leads_attributed).toBe(1);
  });
  it("blocks approval while [OWNER: …] placeholders remain", async () => {
    const store = new MemoryStore();
    const c = await store.insert("content_items", { topic: "t", status: "pending_approval", body: "Story: [OWNER: insert real example]" });
    await expect(setContentStatus(store, c.id, "approve")).rejects.toThrow(/placeholders/);
  });
});

describe("competitor intelligence", () => {
  it("requires source URLs and dedupes observations", async () => {
    const store = new MemoryStore();
    const c = await upsertCompetitor(store, { name: "Agent X", market: "dubai" });
    await expect(addObservation(store, { competitor_id: c.id, source_url: "not a url", observation: "x" })).rejects.toThrow(CompetitorError);
    const a = await addObservation(store, { competitor_id: c.id, source_url: "https://youtube.com/@x", observation: "Weekly off-plan explainers", content_theme: "Off-plan" });
    const b = await addObservation(store, { competitor_id: c.id, source_url: "https://youtube.com/@x", observation: "Weekly off-plan explainers", content_theme: "off-plan" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    const ins = await competitorInsights(store);
    expect(ins.themes[0]).toMatchObject({ theme: "off-plan", count: 1, markets: ["dubai"] });
  });
  it("stores only observations grounded in real search-result URLs", async () => {
    const store = new MemoryStore();
    const c = await upsertCompetitor(store, { name: "Agent Y", market: "usa" });
    const ai = new FakeAi(
      { structure_competitor_research: () => ({ observations: [
        { source_url: "https://youtube.com/@agenty", observation: "Posts market updates", content_theme: "Market update", format: "video", evidence: "channel", strategic_opportunity: "Scripts + DM system", kind: "fact" },
        { source_url: "https://made-up.example/post", observation: "Gets 1M views a month", content_theme: "x", format: null, evidence: null, strategic_opportunity: null, kind: "fact" },
      ] }) },
      { text: "notes", sources: [{ url: "https://youtube.com/@agenty", title: "Agent Y" }] },
    );
    const r = await researchCompetitor(store, ai, c);
    expect(r).toEqual({ stored: 1, rejected: 1, sources: 1 });
  });
});
