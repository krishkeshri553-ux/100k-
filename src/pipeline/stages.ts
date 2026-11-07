import { PIPELINE_STAGES, STAGE_LABELS, type PipelineStage, type Prospect } from "../db/types.js";
import type { Store } from "../db/store.js";
import { logEvent } from "../lib/audit.js";

const ORDER = new Map(PIPELINE_STAGES.map((s, i) => [s, i]));

export const stageIndex = (s: PipelineStage) => ORDER.get(s) ?? 0;

/**
 * Automation may only move a prospect forward (never backwards, never out of won/lost).
 * The owner may set any stage explicitly (e.g. reopen a lost deal), which is audited.
 */
export function canTransition(from: PipelineStage, to: PipelineStage, actor: "system" | "owner"): boolean {
  if (from === to) return false;
  if (actor === "owner") return true;
  if (from === "won" || from === "lost") return false;
  if (to === "lost") return true;
  return stageIndex(to) > stageIndex(from);
}

export async function moveStage(
  store: Store,
  prospect: Prospect,
  to: PipelineStage,
  opts: { actor: "system" | "owner"; source: string; reason: string },
): Promise<Prospect> {
  if (!canTransition(prospect.stage, to, opts.actor)) return prospect;
  const updated = await store.update("prospects", prospect.id, { stage: to });
  await logEvent(store, {
    type: "prospect.stage_changed",
    source: opts.source,
    actor: opts.actor,
    prospect_id: prospect.id,
    summary: `${prospect.full_name}: ${STAGE_LABELS[prospect.stage]} → ${STAGE_LABELS[to]} (${opts.reason})`,
    data: { from: prospect.stage, to, reason: opts.reason },
    is_synthetic: prospect.is_synthetic,
  });
  return updated;
}
