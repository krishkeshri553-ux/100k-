import type { Ai } from "../ai/claude.js";
import type { CalendarApi } from "../calendar/google.js";
import type { Store } from "../db/store.js";
import type { WorkflowRun } from "../db/types.js";
import { isAutomationPaused, logEvent } from "../lib/audit.js";
import type { Env } from "../lib/env.js";
import type { Notifier } from "../notify/index.js";

export interface Ctx {
  store: Store;
  ai: Ai;
  cal: CalendarApi;
  notifier: Notifier;
  env: Env;
  now: Date;
}

export type WorkflowName = "morning" | "daytime" | "content" | "evening" | "weekly" | "backup" | "knowledge";

/** Workflows that keep running during an emergency pause (read-only / safety). */
export const RUNS_WHILE_PAUSED = new Set<WorkflowName>(["evening", "weekly", "backup", "knowledge"]);

const STALE_MS = 2 * 3_600_000;

export interface RunOutcome {
  status: WorkflowRun["status"] | "already_done";
  run: WorkflowRun | null;
  stats?: Record<string, unknown>;
  error?: string;
}

/**
 * Executes a workflow exactly once per slot. A succeeded slot is never re-run (idempotent schedule);
 * a failed or crashed slot is retried as attempt n+1. Every run is recorded for System Health.
 */
export async function runWorkflow(ctx: Ctx, name: WorkflowName, slot: string, fn: (ctx: Ctx) => Promise<Record<string, unknown>>, opts: { force?: boolean } = {}): Promise<RunOutcome> {
  const { store } = ctx;
  const prior = await store.select("workflow_runs", { workflow: name, slot });
  if (!opts.force && prior.some((r) => r.status === "succeeded")) return { status: "already_done", run: prior.find((r) => r.status === "succeeded")! };
  const live = prior.find((r) => r.status === "running" && ctx.now.getTime() - new Date(r.started_at).getTime() < STALE_MS);
  if (live) return { status: "already_done", run: live };
  for (const r of prior.filter((r) => r.status === "running")) {
    await store.update("workflow_runs", r.id, { status: "failed", finished_at: ctx.now.toISOString(), error: "Run did not finish (process crashed or timed out); retried." });
  }
  const attempt = prior.reduce((m, r) => Math.max(m, r.attempt), 0) + 1;

  if (!RUNS_WHILE_PAUSED.has(name) && (await isAutomationPaused(store))) {
    const run = await store.insert("workflow_runs", { workflow: name, slot, status: "skipped", attempt, started_at: ctx.now.toISOString(), finished_at: ctx.now.toISOString(), stats: { reason: "automation paused" } });
    return { status: "skipped", run };
  }

  const run = await store.insert("workflow_runs", { workflow: name, slot, status: "running", attempt, started_at: new Date().toISOString() });
  const usageBefore = ctx.ai.usage();
  try {
    const stats = await fn(ctx);
    const u = ctx.ai.usage();
    const ai_usage = { calls: u.calls - usageBefore.calls, input_tokens: u.input_tokens - usageBefore.input_tokens, output_tokens: u.output_tokens - usageBefore.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens - usageBefore.cache_read_input_tokens };
    const done = await store.update("workflow_runs", run.id, { status: "succeeded", finished_at: new Date().toISOString(), stats: { ...stats, ai_usage, ai_model: ctx.ai.model } });
    return { status: "succeeded", run: done, stats };
  } catch (e) {
    const msg = (e as Error).stack ?? String(e);
    const failed = await store.update("workflow_runs", run.id, { status: "failed", finished_at: new Date().toISOString(), error: msg.slice(0, 4000) });
    await logEvent(store, { type: "workflow.failed", source: `workflow:${name}`, summary: `Workflow ${name} (${slot}) failed on attempt ${attempt}: ${(e as Error).message.slice(0, 200)}` });
    await ctx.notifier.send(`Workflow ${name} failed`, `Slot ${slot}, attempt ${attempt}: ${(e as Error).message.slice(0, 500)}\nIt will be retried on the next scheduled run or a manual re-run.`, { level: "error", source: `workflow:${name}` });
    return { status: "failed", run: failed, error: (e as Error).message };
  }
}
