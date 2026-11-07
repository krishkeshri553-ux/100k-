import type { VercelRequest, VercelResponse } from "@vercel/node";
import { openAi } from "../src/ai/claude.js";
import { handle, type ApiDeps } from "../src/api/handler.js";
import { GoogleCalendar } from "../src/calendar/google.js";
import { openStore } from "../src/db/index.js";
import { loadEnv } from "../src/lib/env.js";

let deps: ApiDeps | null = null;
function getDeps(): ApiDeps {
  if (!deps) {
    const env = loadEnv();
    deps = { env, store: openStore(env), ai: openAi(env), cal: new GoogleCalendar(env) };
  }
  return deps;
}

/** Single serverless function for the whole tracker API (vercel.json rewrites /api/:path → ?path=). */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = String(req.query.path ?? "").replace(/^\/+|\/+$/g, "");
  const query = Object.fromEntries(Object.entries(req.query).filter(([k]) => k !== "path").map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]));
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]));
  const ip = String(headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  const out = await handle({ method: req.method ?? "GET", path, query, headers, body: req.body ?? null, ip }, getDeps());
  for (const [k, v] of Object.entries(out.headers ?? {})) res.setHeader(k, v);
  res.status(out.status).json(out.body);
}
