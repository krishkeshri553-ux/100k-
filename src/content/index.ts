import { z } from "zod";
import type { Ai } from "../ai/claude.js";
import type { Store } from "../db/store.js";
import type { ContentItem, ContentMetrics } from "../db/types.js";
import { logEvent } from "../lib/audit.js";
import { idemKey } from "../lib/hash.js";
import { addDays } from "../lib/time.js";
import { competitorInsights } from "../competitors/index.js";
import { SvgTemplateProvider, type ImageProvider, type Slide } from "../design/carousel.js";
import { checkDraft, isBlocked } from "../outreach/guardrails.js";

export const PILLARS = [
  "Real estate personal branding", "Authority positioning", "Organic lead generation", "Content strategy", "Video marketing",
  "Business growth", "Case studies", "Founder stories", "Industry insights", "Marketing mistakes", "Behind-the-scenes",
] as const;

export class ContentError extends Error {}

const Idea = z.object({
  pillar: z.enum(PILLARS),
  audience: z.string(),
  topic: z.string(),
  hook: z.string(),
  main_content: z.string().describe("Outline of the post body (3–6 bullet lines)"),
  cta: z.string(),
  format: z.enum(["text", "carousel", "video", "image", "poll"]),
  objective: z.enum(["awareness", "authority", "engagement", "conversation", "conversion"]),
  strategic_reasoning: z.string(),
  suggested_visual: z.string(),
});
const Ideas = z.object({ ideas: z.array(Idea) });

/** Real performance per pillar/format from owner-entered metrics only. Engagement rate only where impressions are known. */
export function contentPerformance(items: ContentItem[]) {
  const published = items.filter((i) => i.status === "published" && i.metrics);
  const group = (key: (i: ContentItem) => string | null) => {
    const m = new Map<string, { posts: number; reactions: number; comments: number; reposts: number; impressions: number; withImpr: number; leads: number }>();
    for (const i of published) {
      const k = key(i) ?? "unknown";
      const g = m.get(k) ?? { posts: 0, reactions: 0, comments: 0, reposts: 0, impressions: 0, withImpr: 0, leads: 0 };
      const x = i.metrics as ContentMetrics;
      g.posts++;
      g.reactions += x.reactions ?? 0;
      g.comments += x.comments ?? 0;
      g.reposts += x.reposts ?? 0;
      if (x.impressions) { g.impressions += x.impressions; g.withImpr++; }
      g.leads += i.leads_attributed;
      m.set(k, g);
    }
    return [...m].map(([k, g]) => ({
      key: k, posts: g.posts,
      avg_comments: +(g.comments / g.posts).toFixed(1), avg_reactions: +(g.reactions / g.posts).toFixed(1),
      engagement_rate: g.withImpr ? +(((g.reactions + g.comments + g.reposts) / g.impressions) * 100).toFixed(2) : null,
      leads_attributed: g.leads,
    })).sort((a, b) => b.leads_attributed - a.leads_attributed || b.avg_comments - a.avg_comments);
  };
  return { published: published.length, by_pillar: group((i) => i.pillar), by_format: group((i) => i.format) };
}

export async function generateIdeas(store: Store, ai: Ai, opts: { count: number; weekOf: string; source?: string }): Promise<ContentItem[]> {
  if (!ai.available) throw new ContentError("Content ideas need Claude (ANTHROPIC_API_KEY). Nothing generated.");
  const items = await store.select("content_items");
  const perf = contentPerformance(items);
  const comp = await competitorInsights(store);
  const recentTopics = items.filter((i) => i.created_at >= addDays(opts.weekOf, -42)).map((i) => i.topic).slice(-60);
  const out = await ai.json({
    task: "content_ideas",
    instructions: `You are the LinkedIn content strategist for Krish Keshri (founder, HustleGrowthz). Audience: real estate agents, brokers, consultants and agency founders in Dubai (primary), USA and UK.
Generate ${opts.count} distinct LinkedIn post ideas for the week of ${opts.weekOf}, spread across pillars, mixing formats (include at least two carousels).
Learn from PERFORMANCE (real owner-entered numbers; empty = no data yet — do not assume anything performed well) and COMPETITOR INSIGHTS (public observations; facts vs estimates).
Do not repeat RECENT TOPICS. Never invent client results, stats or stories; case-study posts may only use published proof from the brain, or must be framed as a template the owner fills with a real story.
The goal is meaningful conversations with qualified real estate professionals, not vanity reach.`,
    input: `PERFORMANCE: ${JSON.stringify(perf)}\nCOMPETITOR INSIGHTS: ${JSON.stringify(comp)}\nRECENT TOPICS: ${JSON.stringify(recentTopics)}`,
    schema: Ideas,
    effort: "medium",
    maxTokens: 10000,
  });
  const created: ContentItem[] = [];
  for (const idea of out.ideas.slice(0, opts.count)) {
    const { row, created: isNew } = await store.insertIfAbsent("content_items", {
      status: "idea", pillar: idea.pillar, audience: idea.audience, topic: idea.topic, hook: idea.hook, body: idea.main_content, cta: idea.cta,
      format: idea.format, objective: idea.objective, reasoning: idea.strategic_reasoning, suggested_visual: idea.suggested_visual,
      generated_by: "claude:" + ai.model, idempotency_key: idemKey("idea", opts.weekOf, idea.topic.toLowerCase()),
    }, ["idempotency_key"]);
    if (isNew) created.push(row);
  }
  await logEvent(store, { type: "content.ideas_generated", source: opts.source ?? "workflow", summary: `${created.length} content ideas generated for week of ${opts.weekOf}`, data: { ids: created.map((c) => c.id) } });
  return created;
}

/** Assign unscheduled ideas to Mon–Fri of a week, alternating pillars. Deterministic. */
export async function scheduleWeek(store: Store, weekStartMonday: string, postsPerWeek = 5): Promise<ContentItem[]> {
  const ideas = (await store.select("content_items", { status: "idea" })).filter((i) => !i.scheduled_for);
  const taken = new Set((await store.select("content_items")).map((i) => i.scheduled_for).filter(Boolean));
  const chosen: ContentItem[] = [];
  const usedPillars = new Set<string>();
  for (const pass of [0, 1]) {
    for (const i of ideas) {
      if (chosen.length >= postsPerWeek) break;
      if (chosen.includes(i)) continue;
      if (pass === 0 && i.pillar && usedPillars.has(i.pillar)) continue;
      chosen.push(i);
      if (i.pillar) usedPillars.add(i.pillar);
    }
  }
  const out: ContentItem[] = [];
  let day = 0;
  for (const i of chosen) {
    while (taken.has(addDays(weekStartMonday, day)) && day < 7) day++;
    if (day >= 5) break;
    out.push(await store.update("content_items", i.id, { scheduled_for: addDays(weekStartMonday, day) }));
    day++;
  }
  return out;
}

const Post = z.object({
  body: z.string().describe("Complete, copy-ready LinkedIn post (≤ 2,800 characters), line breaks for readability"),
  first_comment: z.string().nullable(),
  slides: z.array(z.object({ kind: z.enum(["cover", "point", "quote", "stat", "cta"]), title: z.string(), body: z.string().nullable(), stat: z.string().nullable() })).describe("Only for carousel format: 6–9 slides, first is cover, last is cta. stat slides only with published numbers."),
});

/** Turn an idea into a ready-to-publish draft (plus carousel visuals) and queue it for approval. */
export async function draftPost(store: Store, ai: Ai, id: string, opts: { images?: ImageProvider; source?: string } = {}): Promise<ContentItem> {
  const item = await store.get("content_items", id);
  if (!item) throw new ContentError("Content item not found");
  if (!["idea", "draft", "rejected"].includes(item.status)) throw new ContentError(`Item is ${item.status}`);
  if (!ai.available) throw new ContentError("Post drafting needs Claude (ANTHROPIC_API_KEY).");
  const out = await ai.json({
    task: "content_post",
    instructions: `Write the full LinkedIn post in Krish's voice for this idea. Hook in the first line. Short paragraphs. No hashtag spam (max 3). No invented stats or client stories. If the idea needs a real story the owner must supply, write [OWNER: insert real example] placeholders.`,
    input: JSON.stringify({ pillar: item.pillar, audience: item.audience, topic: item.topic, hook: item.hook, outline: item.body, cta: item.cta, format: item.format, objective: item.objective, visual: item.suggested_visual }),
    schema: Post,
    effort: "medium",
    maxTokens: 8000,
  });
  const flags = checkDraft(out.body, { kind: "reply" }).filter((f) => f.code !== "too_long");
  let assets = item.assets;
  if (item.format === "carousel" && out.slides.length) {
    const slides: Slide[] = out.slides.map((s) => ({ kind: s.kind, title: s.title, body: s.body ?? undefined, stat: s.stat ?? undefined }));
    assets = (await (opts.images ?? new SvgTemplateProvider()).render(slides)).map((a) => ({ kind: "carousel_slide", ...a }));
  }
  const updated = await store.update("content_items", id, {
    body: out.body + (out.first_comment ? `\n\n— First comment —\n${out.first_comment}` : ""),
    assets, status: "pending_approval", generated_by: "claude:" + ai.model,
    reasoning: [item.reasoning, flags.length ? "Guardrail notes: " + flags.map((f) => f.message).join(" ") : null].filter(Boolean).join("\n"),
  });
  await logEvent(store, { type: "content.drafted", source: opts.source ?? "workflow", summary: `Content draft ready for approval: "${item.topic}"${isBlocked(flags) ? " (needs edits)" : ""}`, data: { content_id: id, flags: flags.map((f) => f.code) } });
  return updated;
}

export async function setContentStatus(store: Store, id: string, action: "approve" | "reject" | "edit", body?: string) {
  const item = await store.get("content_items", id);
  if (!item) throw new ContentError("Content item not found");
  if (action === "edit") {
    if (!body?.trim()) throw new ContentError("Body required");
    return store.update("content_items", id, { body, status: "pending_approval" });
  }
  if (action === "approve") {
    if (item.status !== "pending_approval") throw new ContentError("Only pending drafts can be approved");
    if (/\[OWNER:/.test(item.body ?? "")) throw new ContentError("Fill in the [OWNER: …] placeholders with real details first.");
  }
  const updated = await store.update("content_items", id, { status: action === "approve" ? "approved" : "rejected" });
  await logEvent(store, { type: `content.${action === "approve" ? "approved" : "rejected"}`, source: "tracker", actor: "owner", summary: `${action === "approve" ? "Approved" : "Rejected"} post "${item.topic}"` });
  return updated;
}

/** LinkedIn personal-profile publishing is done manually; the owner confirms it here. */
export async function confirmPublished(store: Store, id: string, opts: { url?: string | null; publishedAt?: string }) {
  const item = await store.get("content_items", id);
  if (!item) throw new ContentError("Content item not found");
  if (item.status !== "approved" && item.status !== "published") throw new ContentError("Approve the post before marking it published");
  if (opts.url && !/^https:\/\/(www\.)?linkedin\.com\//.test(opts.url)) throw new ContentError("Expected a linkedin.com post URL");
  const updated = await store.update("content_items", id, { status: "published", published_at: opts.publishedAt ?? new Date().toISOString(), published_url: opts.url ?? item.published_url });
  await logEvent(store, { type: "content.published", source: "tracker", actor: "owner", summary: `Owner confirmed published: "${item.topic}"`, data: { content_id: id, url: opts.url ?? null } });
  return updated;
}

export async function recordMetrics(store: Store, id: string, metrics: ContentMetrics) {
  const item = await store.get("content_items", id);
  if (!item) throw new ContentError("Content item not found");
  if (item.status !== "published") throw new ContentError("Metrics can only be recorded for published posts");
  for (const [k, v] of Object.entries(metrics)) if (k !== "recorded_at" && v !== null && v !== undefined && (typeof v !== "number" || v < 0 || !Number.isFinite(v))) throw new ContentError(`Invalid metric ${k}`);
  return store.update("content_items", id, { metrics: { ...metrics, recorded_at: new Date().toISOString() } });
}

export async function attributeLead(store: Store, contentId: string, prospectId: string) {
  const item = await store.get("content_items", contentId);
  const p = await store.get("prospects", prospectId);
  if (!item || !p) throw new ContentError("Not found");
  const already = (await store.select("events", { type: "content.lead_attributed", prospect_id: prospectId })).some((e) => e.data.content_id === contentId);
  if (already) return item;
  const updated = await store.update("content_items", contentId, { leads_attributed: item.leads_attributed + 1 });
  if (!p.tags.includes("source:content")) await store.update("prospects", p.id, { tags: [...p.tags, "source:content"] });
  await logEvent(store, { type: "content.lead_attributed", source: "tracker", actor: "owner", prospect_id: prospectId, summary: `${p.full_name} attributed to post "${item.topic}"`, data: { content_id: contentId } });
  return updated;
}
