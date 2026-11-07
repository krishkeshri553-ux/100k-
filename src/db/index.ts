import type { Env } from "../lib/env.js";
import { MemoryStore, type Store } from "./store.js";
import { SupabaseStore } from "./supabase.js";

export * from "./store.js";
export * from "./types.js";

let memorySingleton: MemoryStore | null = null;

/**
 * Production must use Supabase. Development without Supabase credentials falls back to an
 * in-memory store (data lost on exit) and says so loudly — it never silently pretends to persist.
 */
export function openStore(env: Env): Store {
  if (env.supabaseUrl && env.supabaseServiceRoleKey) return new SupabaseStore(env.supabaseUrl, env.supabaseServiceRoleKey);
  if (env.appEnv === "production") {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production. Refusing to run without persistent storage.");
  }
  if (!memorySingleton) {
    memorySingleton = new MemoryStore();
    if (env.appEnv !== "test") console.warn("[store] Supabase not configured: using an in-memory store. Nothing will persist.");
  }
  return memorySingleton;
}
