import { z } from "zod";
import type { Ai } from "../ai/claude.js";
import type { Store } from "../db/store.js";
import type { Competitor, CompetitorObservation } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { idemKey } from "../lib/hash.js";

export class CompetitorError extends Error {}

export async function upsertCompetitor(store: Store, c: { name: string; market?: string | null; profile_url?: string | null; category?: string | null; notes?: string | null }): Promise<Competitor> {
  const market = c.market ?? null;
  return store.upsert("competitors", { name: c.name.trim(), market, profile_url: c.profile_url ?? null, category: c.category ?? null, notes: c.notes ?? null }, ["name", "market"]);
}

export interface ObservationInput {
  competitor_id: string;
  source_url: string;
  observed_at?: string;
  observation: string;
  content_theme?: string | null;
  format?: string | null;
  evidence?: string | null;
  strategic_opportunity?: string | null;
  kind?: "fact" | "estimate";
}

export async function addObservation(store: Store, o: ObservationInput): Promise<{ row: CompetitorObservation; created: boolean }> {
  if (!/^https?:\/\//i.test(o.source_url)) throw new CompetitorError("Every observation needs a public source URL.");
  if (!o.observation.trim()) throw new CompetitorError("Observation text is required.");
  const observed_at = o.observed_at ?? new Date().toISOString().slice(0, 10);
  return store.insertIfAbsent("competitor_observations", {
    competitor_id: o.competitor_id, source_url: o.source_url, observed_at, observation: o.observation.trim(),
    content_theme: o.content_theme ?? null, format: o.format ?? null, evidence: o.evidence ?? null,
    strategic_opportunity: o.strategic_opportunity ?? null, kind: o.kind ?? "fact",
    idempotency_key: idemKey("obs", o.competitor_id, o.source_url, o.observation.trim().toLowerCase()),
  }, ["idempotency_key"]);
}

const Structured = z.object({
  observations: z.array(z.object({
    source_url: z.string(),
    observation: z.string(),
    content_theme: z.string().nullable(),
    format: z.string().nullable(),
    evidence: z.string().nullable(),
    strategic_opportunity: z.string().nullable(),
    kind: z.enum(["fact", "estimate"]),
  })),
});

/**
 * Public-web research on one competitor (web search, LinkedIn blocked), turned into structured observations.
 * Grounding rule: an observation is stored only if its URL appeared in the actual search results.
 */
export async function researchCompetitor(store: Store, ai: Ai, c: Competitor, opts: { now?: Date } = {}) {
  const research = await ai.webResearch(
    `Research the public content and personal-brand positioning of "${c.name}"${c.market ? ` (${c.market} real estate market)` : ""}${c.profile_url ? `, e.g. ${c.profile_url}` : ""}. ` +
    `Look at their website, YouTube, Instagram, TikTok, press or podcasts. Identify: positioning, recurring content topics, hooks, storytelling style, video/post formats, publishing frequency (only if visible), public engagement signals (only as shown publicly), audience, and content gaps a done-for-you short-form video service could fill. Cite URLs.`,
  );
  const allowed = new Set(research.sources.map((s) => s.url));
  if (allowed.size === 0) return { stored: 0, rejected: 0, sources: 0 };
  const out = await ai.json({
    task: "structure_competitor_research",
    instructions: `Turn the research notes into discrete observations. Each observation must cite exactly one source_url copied from SOURCES. kind="fact" only for things directly visible in the source; anything inferred (frequency estimates, audience guesses, effectiveness) is kind="estimate". Never state private metrics (reach, impressions, views unless publicly displayed, conversions). strategic_opportunity: how HustleGrowthz's Authority Flywheel™ positioning could differentiate.`,
    input: `COMPETITOR: ${c.name} (${c.market ?? "market unknown"})\nSOURCES:\n${research.sources.map((s) => `- ${s.url} — ${s.title}`).join("\n")}\n\nRESEARCH NOTES:\n${research.text}`,
    schema: Structured,
    effort: "low",
  });
  let stored = 0, rejected = 0;
  const observed_at = (opts.now ?? new Date()).toISOString().slice(0, 10);
  for (const o of out.observations) {
    if (!allowed.has(o.source_url)) { rejected++; continue; }
    const r = await addObservation(store, { ...o, competitor_id: c.id, observed_at });
    if (r.created) stored++;
  }
  await logEvent(store, { type: "competitor.researched", source: "workflow", summary: `Competitor research: ${c.name} — ${stored} new observations (${rejected} ungrounded discarded)`, data: { competitor_id: c.id, stored, rejected, sources: allowed.size } });
  return { stored, rejected, sources: allowed.size };
}

export interface CompetitorInsights {
  observations: number;
  competitors: number;
  themes: { theme: string; count: number; markets: string[] }[];
  formats: { format: string; count: number }[];
  opportunities: string[];
  facts: number;
  estimates: number;
}

/** Deterministic aggregation (no AI) — feeds the content strategist and the weekly report. */
export async function competitorInsights(store: Store, sinceDays = 90, now = new Date()): Promise<CompetitorInsights> {
  const since = new Date(now.getTime() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const comps = new Map((await store.select("competitors")).map((c) => [c.id, c]));
  const obs = (await store.select("competitor_observations")).filter((o) => o.observed_at >= since);
  const themes = new Map<string, { count: number; markets: Set<string> }>();
  const formats = new Map<string, number>();
  for (const o of obs) {
    if (o.content_theme) {
      const k = o.content_theme.toLowerCase().trim();
      const t = themes.get(k) ?? { count: 0, markets: new Set<string>() };
      t.count++;
      const m = comps.get(o.competitor_id)?.market;
      if (m) t.markets.add(m);
      themes.set(k, t);
    }
    if (o.format) formats.set(o.format.toLowerCase().trim(), (formats.get(o.format.toLowerCase().trim()) ?? 0) + 1);
  }
  return {
    observations: obs.length,
    competitors: new Set(obs.map((o) => o.competitor_id)).size,
    themes: [...themes].map(([theme, v]) => ({ theme, count: v.count, markets: [...v.markets] })).sort((a, b) => b.count - a.count).slice(0, 15),
    formats: [...formats].map(([format, count]) => ({ format, count })).sort((a, b) => b.count - a.count),
    opportunities: [...new Set(obs.map((o) => o.strategic_opportunity).filter((x): x is string => !!x))].slice(0, 10),
    facts: obs.filter((o) => o.kind === "fact").length,
    estimates: obs.filter((o) => o.kind === "estimate").length,
  };
}
