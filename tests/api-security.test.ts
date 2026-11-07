import { describe, expect, it } from "vitest";
import { NoAi } from "../src/ai/claude.js";
import { handle, type ApiRequest } from "../src/api/handler.js";
import { signSession, verifySession } from "../src/api/auth.js";
import { GoogleCalendar } from "../src/calendar/google.js";
import { MemoryStore } from "../src/db/store.js";
import { loadEnv, type Env } from "../src/lib/env.js";
import { seedSynthetic } from "../src/seed.js";

const SECRET = "s".repeat(40);
const mkEnv = (over: Partial<Env> = {}): Env => ({ ...loadEnv(), appEnv: "test", trackerPassphrase: "correct horse battery staple", trackerSessionSecret: SECRET, ...over });
function setup(envOver: Partial<Env> = {}) {
  const store = new MemoryStore();
  const env = mkEnv(envOver);
  const deps = { store, env, ai: new NoAi(), cal: new GoogleCalendar(env) };
  const cookie = `hg_session=${signSession(SECRET)}`;
  const req = (r: Partial<ApiRequest>) => handle({ method: "GET", path: "metrics", query: {}, headers: {}, body: null, ip: "1.2.3.4", ...r }, deps);
  return { store, env, req, cookie };
}

describe("tracker API security", () => {
  it("requires configuration before doing anything", async () => {
    const { req } = setup({ trackerPassphrase: null });
    expect((await req({})).status).toBe(503);
  });
  it("rejects unauthenticated and forged sessions", async () => {
    const { req } = setup();
    expect((await req({})).status).toBe(401);
    const forged = signSession("x".repeat(40));
    expect((await req({ headers: { cookie: `hg_session=${forged}` } })).status).toBe(401);
    expect(verifySession(SECRET, signSession(SECRET, Date.now() - 13 * 3600_000))).toBe(false); // expired
  });
  it("logs in with the passphrase, sets a hardened cookie, and rate-limits brute force", async () => {
    const { req, store } = setup({ appEnv: "production" });
    const bad = await req({ method: "POST", path: "login", headers: { "x-hg-csrf": "1" }, body: { passphrase: "nope" } });
    expect(bad.status).toBe(401);
    const ok = await req({ method: "POST", path: "login", headers: { "x-hg-csrf": "1" }, body: { passphrase: "correct horse battery staple" } });
    expect(ok.status).toBe(200);
    const c = ok.headers!["set-cookie"];
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Secure/);
    for (let i = 0; i < 8; i++) await req({ method: "POST", path: "login", headers: { "x-hg-csrf": "1" }, body: { passphrase: "guess" + i } });
    const locked = await req({ method: "POST", path: "login", headers: { "x-hg-csrf": "1" }, body: { passphrase: "correct horse battery staple" } });
    expect(locked.status).toBe(429);
    expect((await store.select("events", { type: "auth.failed" })).every((e) => !JSON.stringify(e.data).includes("1.2.3.4"))).toBe(true);
  });
  it("blocks CSRF: missing header or cross-origin POSTs", async () => {
    const { req, cookie } = setup();
    expect((await req({ method: "POST", path: "action", headers: { cookie }, body: { action: "pause_automation" } })).status).toBe(403);
    expect((await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1", origin: "https://evil.example", host: "tracker.example" }, body: { action: "pause_automation" } })).status).toBe(403);
    expect((await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1", origin: "https://tracker.example", host: "tracker.example" }, body: { action: "pause_automation" } })).status).toBe(200);
  });
  it("validates action payloads", async () => {
    const { req, cookie } = setup();
    const r = await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1" }, body: { action: "mark_sent", id: "not-a-uuid" } });
    expect(r.status).toBe(400);
    const r2 = await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1" }, body: { action: "drop_tables" } });
    expect(r2.status).toBe(400);
  });
  it("returns 422 with a clear message for business-rule violations", async () => {
    const { req, cookie, store } = setup();
    const p = await store.insert("prospects", { identity_key: "a", full_name: "A", source: "t" });
    const d = await store.insert("drafts", { prospect_id: p.id, kind: "initial_message", body: "hi", generated_by: "t", idempotency_key: "k", body_hash: "h" });
    const r = await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1" }, body: { action: "mark_sent", id: d.id } });
    expect(r.status).toBe(422);
    expect((r.body as { error: string }).error).toMatch(/Approve/);
  });
  it("hides synthetic rows in production and shows them (flagged) in development", async () => {
    const prod = setup({ appEnv: "production" });
    await seedSynthetic(prod.store, mkEnv({ appEnv: "development" }));
    const m = (await prod.req({ headers: { cookie: prod.cookie } })).body as { leads: { total: number }; synthetic_included: boolean };
    expect(m.leads.total).toBe(0);
    expect(m.synthetic_included).toBe(false);
    const leads = (await prod.req({ path: "leads", headers: { cookie: prod.cookie } })).body as { leads: unknown[] };
    expect(leads.leads).toHaveLength(0);
    const dev = setup({ appEnv: "development" });
    await seedSynthetic(dev.store, mkEnv({ appEnv: "development" }));
    const md = (await dev.req({ headers: { cookie: dev.cookie } })).body as { leads: { total: number }; synthetic_included: boolean };
    expect(md.leads.total).toBe(10);
    expect(md.synthetic_included).toBe(true);
  });
  it("supports the full owner flow over HTTP: import → approve → sent", async () => {
    const { req, cookie, store } = setup();
    const csv = "Name,Company,Location,Title,LinkedIn\nNadia Karim,Karim Realty,\"Dubai, UAE\",Founder,linkedin.com/in/nadia-k\n";
    const imp = await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1" }, body: { action: "import_csv", csv } });
    expect(imp.status).toBe(200);
    const p = (await store.select("prospects"))[0];
    await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1" }, body: { action: "generate_drafts", prospect_id: p.id } });
    const appr = (await req({ path: "approvals", headers: { cookie } })).body as { drafts: { id: string; status: string }[] };
    const d = appr.drafts.find((x) => x.status === "pending_approval")!;
    expect((await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1" }, body: { action: "approve_draft", id: d.id } })).status).toBe(200);
    expect((await req({ method: "POST", path: "action", headers: { cookie, "x-hg-csrf": "1" }, body: { action: "mark_sent", id: d.id } })).status).toBe(200);
    const m = (await req({ headers: { cookie } })).body as { outreach: { sent_confirmed: number } };
    expect(m.outreach.sent_confirmed).toBe(1);
  });
});
