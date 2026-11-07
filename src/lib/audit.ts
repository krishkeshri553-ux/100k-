import type { Store } from "../db/store.js";
import type { EventRow } from "../db/types.js";

export interface LogEventInput {
  type: string;
  source: string;
  summary: string;
  actor?: "system" | "owner";
  prospect_id?: string | null;
  data?: Record<string, unknown>;
  is_synthetic?: boolean;
}

/** Append-only audit log; also feeds the tracker's live activity feed. */
export async function logEvent(store: Store, e: LogEventInput): Promise<EventRow> {
  return store.insert("events", {
    type: e.type,
    source: e.source,
    summary: e.summary,
    actor: e.actor ?? "system",
    prospect_id: e.prospect_id ?? null,
    data: e.data ?? {},
    is_synthetic: e.is_synthetic ?? false,
  });
}

export async function getSetting<T>(store: Store, key: string, fallback: T): Promise<T> {
  const s = await store.get("settings", key);
  return s ? (s.value as T) : fallback;
}

export async function setSetting(store: Store, key: string, value: unknown): Promise<void> {
  await store.upsert("settings", { key, value, updated_at: new Date().toISOString() }, ["key"]);
}

export const isAutomationPaused = (store: Store) => getSetting<boolean>(store, "automation_paused", false);

export async function setIntegrationStatus(
  store: Store,
  name: string,
  status: "connected" | "not_configured" | "error" | "manual_only",
  detail: string | null,
) {
  await store.upsert("integration_status", { name, status, detail, checked_at: new Date().toISOString() }, ["name"]);
}
