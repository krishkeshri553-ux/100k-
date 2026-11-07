import { createHmac, timingSafeEqual } from "node:crypto";
import type { Store } from "../db/store.js";
import { logEvent } from "../lib/audit.js";

export const COOKIE = "hg_session";
const TTL_MS = 12 * 3_600_000;
const MAX_FAILED = 8;
const WINDOW_MS = 15 * 60_000;

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(secret: string, now = Date.now()): string {
  const payload = b64u(JSON.stringify({ sub: "owner", exp: now + TTL_MS }));
  const sig = b64u(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(secret: string, token: string | undefined | null, now = Date.now()): boolean {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const { exp, sub } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return sub === "owner" && typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = createHmac("sha256", "cmp").update(a).digest();
  const y = createHmac("sha256", "cmp").update(b).digest();
  return timingSafeEqual(x, y);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean, maxAgeSec = TTL_MS / 1000) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}

/** Persistent (cross-instance) brute-force protection using the audit log. */
export async function loginLocked(store: Store, now = Date.now()): Promise<boolean> {
  const since = new Date(now - WINDOW_MS).toISOString();
  const recent = (await store.select("events", { type: "auth.failed" }, { order: { column: "occurred_at", ascending: false }, limit: 50 })).filter((e) => e.occurred_at >= since);
  return recent.length >= MAX_FAILED;
}

export async function recordLogin(store: Store, ok: boolean, ip: string) {
  await logEvent(store, { type: ok ? "auth.login" : "auth.failed", source: "tracker", actor: ok ? "owner" : "system", summary: ok ? "Owner signed in to the tracker" : "Failed tracker sign-in attempt", data: { ip_hash: createHmac("sha256", "ip").update(ip).digest("hex").slice(0, 12) } });
}
