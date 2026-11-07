import { describe, expect, it } from "vitest";
import { FakeAi, NoAi } from "../src/ai/claude.js";
import { MemoryStore } from "../src/db/store.js";
import { computeTrackerMetrics, loadTrackerData } from "../src/metrics/tracker.js";
import { addInvoice, createDeal, markPaid, updateDealStatus, RevenueError } from "../src/revenue/index.js";
import { runWorkflow, type Ctx } from "../src/workflows/runner.js";
import { run, knowledge, slotFor } from "../src/workflows/index.js";
import { createBackup, restoreBackup } from "../src/workflows/backup.js";
import { SilentNotifier } from "../src/notify/index.js";
import { GoogleCalendar } from "../src/calendar/google.js";
import { loadEnv, type Env } from "../src/lib/env.js";
import { setSetting } from "../src/lib/audit.js";
import { seedSynthetic } from "../src/seed.js";
import { draftOutreach } from "../src/outreach/drafts.js";
import { approveDraft, markSent } from "../src/approvals/index.js";
import { dailyReport, weeklyReport } from "../src/reports/index.js";
import { nextCron } from "../src/lib/time.js";

const env = (over: Partial<Env> = {}): Env => ({ ...loadEnv(), appEnv: "test", anthropicApiKey: null, notifyWebhookUrl: null, ...over });
const ctx = (store: MemoryStore, over: Partial<Ctx> = {}): Ctx => ({
  store, ai: new NoAi(), notifier: new SilentNotifier(), env: env(), now: new Date(), cal: new GoogleCalendar(env({ google: { clientId: null, clientSecret: null, refreshToken: null, calendarId: "primary" } })), ...over,
});

describe("tracker metrics are honest", () => {
  it("shows zeros/nulls on an empty database (no demo numbers)", async () => {
    const m = computeTrackerMetrics(await loadTrackerData(new MemoryStore(), { includeSynthetic: false }));
    expect(m.top.collected_verified).toBe(0);
    expect(m.top.clients_closed).toBe(0);
    expect(m.revenue.avg_deal_value).toBeNull();
    expect(m.content.reactions).toBeNull();
    expect(m.leads.total).toBe(0);
    expect(m.feed).toHaveLength(0);
  });
  it("never counts drafts or approvals as sent", async () => {
    const store = new MemoryStore();
    const p = await store.insert("prospects", { identity_key: "a", full_name: "Aisha R", first_name: "Aisha", title: "Founder", company: "AR Properties", market: "dubai", source: "sales_navigator_manual" });
    const r = await draftOutreach(store, new NoAi(), p);
    let m = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: false }));
    expect(m.outreach.sent_confirmed).toBe(0);
    expect(m.outreach.pending_approval).toBe(r.created.filter((d) => d.status === "pending_approval" || d.status === "blocked").length);
    const d = r.created.find((x) => x.status === "pending_approval")!;
    await approveDraft(store, d.id);
    m = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: false }));
    expect(m.outreach.sent_confirmed).toBe(0);
    expect(m.outreach.approved_not_sent).toBe(1);
    await markSent(store, d.id);
    m = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: false }));
    expect(m.outreach.sent_confirmed).toBe(1);
  });
  it("separates pipeline, forecast, signed and verified collected cash", async () => {
    const store = new MemoryStore();
    const p = await store.insert("prospects", { identity_key: "a", full_name: "A", source: "t", market: "dubai" });
    const q = await store.insert("prospects", { identity_key: "b", full_name: "B", source: "t", market: "uk" });
    const won = await createDeal(store, { prospectId: p.id, contractValue: 5999, probability: 0.9 });
    await updateDealStatus(store, won.id, "won");
    const inv = await addInvoice(store, { dealId: won.id, amount: 5999, invoiceRef: "INV-1" });
    await addInvoice(store, { dealId: won.id, amount: 5999, invoiceRef: "INV-1" }); // idempotent
    await createDeal(store, { prospectId: q.id, contractValue: 999, probability: 0.5 });
    await createDeal(store, { prospectId: q.id, contractValue: 999 }); // no probability → excluded from forecast
    let m = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: false }));
    expect(m.revenue.signed_value_this_month).toBe(5999);
    expect(m.revenue.pipeline_value).toBe(1998);
    expect(m.revenue.forecast_value).toBe(499.5);
    expect(m.revenue.forecast_unweighted_deals).toBe(1);
    expect(m.revenue.collected_verified).toBe(0);
    expect(m.revenue.outstanding_invoices).toBe(1);
    await markPaid(store, inv.id, { verified: false });
    m = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: false }));
    expect(m.top.collected_verified).toBe(0);
    expect(m.top.collected_recorded).toBe(5999);
    await markPaid(store, inv.id, { verified: true });
    m = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: false }));
    expect(m.top.collected_verified).toBe(5999);
    expect(m.top.remaining_to_min).toBe(20000 - 5999);
    expect(m.revenue.by_market).toEqual([{ key: "dubai", amount: 5999 }]);
    expect(m.revenue.monthly.at(-1)!.collected).toBe(5999);
    expect(m.revenue.monthly).toHaveLength(6);
    await expect(createDeal(store, { prospectId: p.id, contractValue: 10, currency: "AED" })).rejects.toThrow(RevenueError);
  });
  it("excludes synthetic data from production metrics; seeding refuses in production", async () => {
    const store = new MemoryStore();
    await seedSynthetic(store, env({ appEnv: "development" }));
    const prod = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: false }));
    expect(prod.leads.total).toBe(0);
    expect(prod.top.collected_verified).toBe(0);
    const dev = computeTrackerMetrics(await loadTrackerData(store, { includeSynthetic: true }));
    expect(dev.leads.total).toBe(10);
    expect(dev.top.collected_verified).toBe(5999);
    await expect(seedSynthetic(new MemoryStore(), env({ appEnv: "production" }))).rejects.toThrow(/production/);
  });
});

describe("workflow runner", () => {
  it("runs a slot once (idempotent), retries failures as new attempts, recovers crashed runs", async () => {
    const store = new MemoryStore();
    let calls = 0;
    const ok = async () => ({ n: ++calls });
    const c = ctx(store);
    expect((await runWorkflow(c, "evening", "2026-11-07", ok)).status).toBe("succeeded");
    expect((await runWorkflow(c, "evening", "2026-11-07", ok)).status).toBe("already_done");
    expect(calls).toBe(1);

    const boom = async () => { throw new Error("boom"); };
    const f = await runWorkflow(c, "morning", "s1", boom);
    expect(f.status).toBe("failed");
    expect((c.notifier as SilentNotifier).sent[0].title).toMatch(/failed/);
    const retry = await runWorkflow(c, "morning", "s1", ok);
    expect(retry.status).toBe("succeeded");
    expect(retry.run!.attempt).toBe(2);

    await store.insert("workflow_runs", { workflow: "daytime", slot: "x", status: "running", attempt: 1, started_at: new Date(Date.now() - 3 * 3600_000).toISOString() });
    const rec = await runWorkflow(c, "daytime", "x", ok);
    expect(rec.status).toBe("succeeded");
    expect((await store.select("workflow_runs", { workflow: "daytime" })).find((r) => r.attempt === 1)!.status).toBe("failed");
  });
  it("emergency pause stops outreach workflows but not reports/backups", async () => {
    const store = new MemoryStore();
    await setSetting(store, "automation_paused", true);
    const fn = async () => ({});
    expect((await runWorkflow(ctx(store), "morning", "p", fn)).status).toBe("skipped");
    expect((await runWorkflow(ctx(store), "content", "p", fn)).status).toBe("skipped");
    expect((await runWorkflow(ctx(store), "backup", "p", fn)).status).toBe("succeeded");
    expect((await runWorkflow(ctx(store), "evening", "p", fn)).status).toBe("succeeded");
  });
  it("morning workflow analyses, drafts and is safe to re-run (force) without duplicating drafts", async () => {
    const store = new MemoryStore();
    await seedSynthetic(store, env({ appEnv: "development" }));
    const before = (await store.select("drafts")).length;
    const c = ctx(store);
    const r1 = await run(c, "morning");
    expect(r1.status).toBe("succeeded");
    const after1 = (await store.select("drafts")).length;
    await run(c, "morning", { force: true });
    expect((await store.select("drafts")).length).toBe(after1);
    expect(after1).toBeGreaterThanOrEqual(before);
  });
  it("daytime workflow analyses new inbound replies and alerts on hot prospects", async () => {
    const store = new MemoryStore();
    const p = await store.insert("prospects", { identity_key: "a", full_name: "Hot Lead", first_name: "Hot", title: "Founder", company: "HL Realty", market: "dubai", source: "linkedin_messages" });
    await store.insert("messages", { prospect_id: p.id, external_id: "m1", direction: "inbound", sent_at: new Date().toISOString(), body: "How much does it cost per month?", source: "owner_confirmed" });
    const notifier = new SilentNotifier();
    const r = await run(ctx(store, { notifier }), "daytime");
    expect(r.status).toBe("succeeded");
    expect(notifier.sent.some((s) => s.title.includes("Hot Lead"))).toBe(true);
    expect((await store.select("messages"))[0].analysed).toBe(true);
    expect((await store.select("integration_status")).map((i) => i.name)).toContain("linkedin");
  });
  it("evening + weekly reports are computed from data and saved once per period", async () => {
    const store = new MemoryStore();
    const c = ctx(store);
    await run(c, "evening");
    await run(c, "evening", { force: true });
    expect(await store.select("reports", { kind: "daily" })).toHaveLength(1);
    const w = await weeklyReport(store, new NoAi(), "2026-11-08");
    expect(w.body_md).toContain("## 1. Markets");
    expect(w.body_md).toContain("Need at least 5 won");
    const d = await dailyReport(store, "2026-11-07");
    expect(d.metrics.messages_confirmed_sent).toBe(0);
  });
  it("computes slots and cron schedule", () => {
    const now = new Date("2026-11-07T06:20:00Z");
    expect(slotFor("evening", now)).toBe("2026-11-07");
    expect(slotFor("daytime", now)).toBe("2026-11-07T11");
    expect(slotFor("weekly", now)).toBe("week-of-2026-11-02");
    expect(nextCron("37 15 * * *", now)!.toISOString()).toBe("2026-11-07T15:37:00.000Z");
    expect(nextCron("7 12 * * 0", now)!.toISOString()).toBe("2026-11-08T12:07:00.000Z");
    expect(nextCron("17 6,9,12,15 * * *", now)!.toISOString()).toBe("2026-11-07T09:17:00.000Z");
  });
  it("knowledge check flags website changes without editing the brain", async () => {
    const store = new MemoryStore();
    let version = "v1";
    const fake = (async () => new Response(`<html>${version}</html>`)) as typeof fetch;
    const notifier = new SilentNotifier();
    const first = await knowledge(ctx(store, { notifier }), fake);
    expect(first.first_run).toBe(true);
    version = "v2";
    const second = await knowledge(ctx(store, { notifier }), fake);
    expect(second.changed.length).toBeGreaterThan(0);
    expect(notifier.sent.at(-1)!.title).toMatch(/re-verify/);
  });
});

describe("backup and recovery", () => {
  it("encrypts, refuses the wrong key, and restores idempotently", async () => {
    const store = new MemoryStore();
    await seedSynthetic(store, env({ appEnv: "development" }));
    const key = "a".repeat(64);
    const file = await createBackup(store, key);
    expect(file.encrypted).toBe(true);
    expect(JSON.stringify(file)).not.toContain("Layla");
    await expect(restoreBackup(new MemoryStore(), file, "b".repeat(64))).rejects.toThrow();
    const fresh = new MemoryStore();
    const counts = await restoreBackup(fresh, file, key);
    expect(counts.prospects).toBe(10);
    await restoreBackup(fresh, file, key);
    expect((await fresh.select("prospects")).length).toBe(10);
    expect((await fresh.select("payments")).length).toBe((await store.select("payments")).length);
  });
});

describe("AI-dependent steps fail honestly without Claude", () => {
  it("content workflow skips instead of inventing ideas", async () => {
    const store = new MemoryStore();
    const r = await run(ctx(store), "content");
    expect(r.status).toBe("succeeded");
    expect(r.stats).toEqual({ skipped: "Claude not configured" });
    expect(await store.select("content_items")).toHaveLength(0);
  });
  it("records Claude token usage per run for cost tracking", async () => {
    const store = new MemoryStore();
    const ai = new FakeAi({});
    const r = await runWorkflow(ctx(store, { ai }), "evening", "s", async () => ({}));
    expect(r.run!.stats.ai_model).toBe("fake");
  });
});
