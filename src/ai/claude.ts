import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { brainForPrompt } from "../brain/index.js";
import type { Env } from "../lib/env.js";

export interface AiUsage {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}

export interface AiRequest<S extends z.ZodType> {
  /** Short task name, for logs/usage. */
  task: string;
  /** Task-specific instructions (stable text → cached after the brain). */
  instructions: string;
  /** Volatile per-call input (prospect data, conversation…). */
  input: string;
  schema: S;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface WebResearchResult {
  text: string;
  /** URLs that actually appeared in web search results (the only URLs allowed as evidence). */
  sources: { url: string; title: string }[];
}

/** Everything that needs intelligence goes through this interface. Tests inject a fake. */
export interface Ai {
  readonly available: boolean;
  readonly model: string;
  json<S extends z.ZodType>(req: AiRequest<S>): Promise<z.infer<S>>;
  /** Public-web research via Claude's server-side web search. LinkedIn is blocked: we never scrape it. */
  webResearch(question: string, opts?: { maxSearches?: number }): Promise<WebResearchResult>;
  usage(): AiUsage;
}

export const RESEARCH_BLOCKED_DOMAINS = ["linkedin.com"];

export class AiUnavailableError extends Error {
  constructor(reason = "ANTHROPIC_API_KEY is not configured") {
    super(`Claude unavailable: ${reason}`);
  }
}

const BASE_SYSTEM = `You are the AI Revenue Department for HustleGrowthz Pvt. Ltd., working for the founder, Krish Keshri.
You prepare research, analysis and drafts. A human (the owner) approves and personally sends every LinkedIn message — you never claim anything was sent.
Ground every business statement in the BUSINESS_BRAIN below. If a fact is not in the brain or in the provided input, treat it as unknown and say "unknown" rather than guessing.
Never invent results, testimonials, client industries, prices, discounts, guarantees or personal experiences.
Write like a thoughtful founder: specific, brief, honest, no hype, no emojis in first-touch messages.`;

export class ClaudeAi implements Ai {
  readonly available = true;
  readonly model: string;
  private client: Anthropic;
  private totals: AiUsage = { calls: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  private systemBrain = brainForPrompt();

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
    this.model = model;
  }

  async json<S extends z.ZodType>(req: AiRequest<S>): Promise<z.infer<S>> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 8000,
      // Server-side fallback: if the model declines for policy reasons, the API retries on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: BASE_SYSTEM + "\n\n" + this.systemBrain, cache_control: { type: "ephemeral" } },
        { type: "text", text: "## Task: " + req.task + "\n" + req.instructions },
      ],
      messages: [{ role: "user", content: req.input }],
      output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort ?? "medium" },
    });
    this.totals.calls++;
    this.totals.input_tokens += response.usage.input_tokens;
    this.totals.output_tokens += response.usage.output_tokens;
    this.totals.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;
    if (response.stop_reason === "refusal") throw new Error(`Claude declined task ${req.task}`);
    if (response.stop_reason === "max_tokens") throw new Error(`Claude output truncated for task ${req.task}`);
    const parsed = response.parsed_output;
    if (parsed === null || parsed === undefined) throw new Error(`Claude returned no parseable output for task ${req.task}`);
    return req.schema.parse(parsed);
  }

  async webResearch(question: string, opts: { maxSearches?: number } = {}): Promise<WebResearchResult> {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
    const sources = new Map<string, string>();
    let text = "";
    for (let i = 0; i < 4; i++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 12000,
        system: BASE_SYSTEM + "\nYou are doing public-web competitor research. Report only what the sources show; label anything inferred as an estimate. Never claim private metrics (reach, impressions, conversions).",
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 6, blocked_domains: RESEARCH_BLOCKED_DOMAINS }],
        output_config: { effort: "medium" },
        messages,
      });
      this.totals.calls++;
      this.totals.input_tokens += response.usage.input_tokens;
      this.totals.output_tokens += response.usage.output_tokens;
      for (const block of response.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const r of block.content) if (r.type === "web_search_result") sources.set(r.url, r.title);
        }
        if (block.type === "text") text += block.text;
      }
      if (response.stop_reason === "refusal") throw new Error("Claude declined the research request");
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }
    return { text, sources: [...sources].map(([url, title]) => ({ url, title })) };
  }

  usage(): AiUsage {
    return { ...this.totals };
  }
}

/** Used when no API key is configured: every call fails loudly, so callers fall back to deterministic logic or skip honestly. */
export class NoAi implements Ai {
  readonly available = false;
  readonly model = "none";
  async json<S extends z.ZodType>(): Promise<z.infer<S>> {
    throw new AiUnavailableError();
  }
  async webResearch(): Promise<WebResearchResult> {
    throw new AiUnavailableError();
  }
  usage(): AiUsage {
    return { calls: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  }
}

export function openAi(env: Env): Ai {
  return env.anthropicApiKey ? new ClaudeAi(env.anthropicApiKey, env.claudeModel) : new NoAi();
}

/** Test double: returns scripted responses per task name. */
export class FakeAi implements Ai {
  readonly available = true;
  readonly model = "fake";
  calls: { task: string; input: string }[] = [];
  constructor(private responders: Record<string, (input: string) => unknown>, private research?: WebResearchResult) {}
  async webResearch(question: string): Promise<WebResearchResult> {
    this.calls.push({ task: "web_research", input: question });
    if (!this.research) throw new Error("FakeAi: no research fixture");
    return this.research;
  }
  async json<S extends z.ZodType>(req: AiRequest<S>): Promise<z.infer<S>> {
    this.calls.push({ task: req.task, input: req.input });
    const r = this.responders[req.task];
    if (!r) throw new Error(`FakeAi: no responder for ${req.task}`);
    return req.schema.parse(r(req.input));
  }
  usage(): AiUsage {
    return { calls: this.calls.length, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  }
}
