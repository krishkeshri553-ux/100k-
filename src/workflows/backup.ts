import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Store } from "../db/store.js";
import { PRIMARY_KEYS, type TableName } from "../db/types.js";

export const BACKUP_TABLES: TableName[] = [
  "settings", "integration_status", "prospects", "messages", "drafts", "appointments", "deals", "payments",
  "content_items", "competitors", "competitor_observations", "events", "workflow_runs", "reports",
];

export interface BackupFile {
  format: "hustlegrowthz-backup";
  version: 1;
  created_at: string;
  encrypted: boolean;
  /** base64 AES-256-GCM payload when encrypted; otherwise the JSON tables. */
  payload: string | Record<string, unknown[]>;
  iv?: string;
  tag?: string;
  counts: Record<string, number>;
}

function keyFrom(hex: string): Buffer {
  const k = Buffer.from(hex, "hex");
  if (k.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  return k;
}

export async function createBackup(store: Store, encryptionKeyHex: string | null): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) tables[t] = await store.select(t);
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  const created_at = new Date().toISOString();
  if (!encryptionKeyHex) return { format: "hustlegrowthz-backup", version: 1, created_at, encrypted: false, payload: tables, counts };
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(encryptionKeyHex), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(tables), "utf8"), c.final()]);
  return { format: "hustlegrowthz-backup", version: 1, created_at, encrypted: true, payload: enc.toString("base64"), iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), counts };
}

export function decodeBackup(file: BackupFile, encryptionKeyHex: string | null): Record<string, Record<string, unknown>[]> {
  if (file.format !== "hustlegrowthz-backup") throw new Error("Not a HustleGrowthz backup file");
  if (!file.encrypted) return file.payload as Record<string, Record<string, unknown>[]>;
  if (!encryptionKeyHex) throw new Error("Backup is encrypted; BACKUP_ENCRYPTION_KEY required");
  const d = createDecipheriv("aes-256-gcm", keyFrom(encryptionKeyHex), Buffer.from(file.iv!, "base64"));
  d.setAuthTag(Buffer.from(file.tag!, "base64"));
  const json = Buffer.concat([d.update(Buffer.from(file.payload as string, "base64")), d.final()]).toString("utf8");
  return JSON.parse(json);
}

/** Restore = idempotent upsert by primary key, parents before children. Existing rows are overwritten with the backup version. */
export async function restoreBackup(store: Store, file: BackupFile, encryptionKeyHex: string | null) {
  const tables = decodeBackup(file, encryptionKeyHex);
  const restored: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const rows = tables[t] ?? [];
    for (const row of rows) await store.upsert(t, row as never, [PRIMARY_KEYS[t]]);
    restored[t] = rows.length;
  }
  return restored;
}
