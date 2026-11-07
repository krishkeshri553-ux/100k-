/**
 * Local development server for the tracker: serves public/ and routes /api/* to the same handler Vercel uses.
 * Without Supabase it uses an in-memory store; pass --seed to load synthetic demo data (development only).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { openAi } from "../src/ai/claude.js";
import { handle } from "../src/api/handler.js";
import { GoogleCalendar } from "../src/calendar/google.js";
import { openStore } from "../src/db/index.js";
import { loadEnv } from "../src/lib/env.js";
import { seedSynthetic } from "../src/seed.js";

process.env.TRACKER_PASSPHRASE ??= "dev-passphrase";
process.env.TRACKER_SESSION_SECRET ??= "dev-session-secret-dev-session-secret-0000";
const env = loadEnv();
if (env.appEnv === "production") throw new Error("dev-server is for development only");
const store = openStore(env);
const deps = { env, store, ai: openAi(env), cal: new GoogleCalendar(env) };
if (process.argv.includes("--seed")) await seedSynthetic(store, env);

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const PUBLIC = join(process.cwd(), "public");
const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body: unknown = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
    const out = await handle({ method: req.method ?? "GET", path: url.pathname.slice(5), query: Object.fromEntries(url.searchParams), headers, body, ip: req.socket.remoteAddress ?? "local" }, deps);
    res.writeHead(out.status, { "content-type": "application/json", ...(out.headers ?? {}) });
    res.end(JSON.stringify(out.body));
    return;
  }
  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const file = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`Tracker dev server: http://localhost:${port}  (passphrase: ${process.env.TRACKER_PASSPHRASE})`));
