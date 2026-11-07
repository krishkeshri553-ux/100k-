import { randomUUID } from "node:crypto";
import { PRIMARY_KEYS, UNIQUE_KEYS, type TableName, type Tables } from "./types.js";

export type Row<T extends TableName> = Tables[T];
export type Filter<T extends TableName> = Partial<Row<T>>;
export interface SelectOptions<T extends TableName> {
  order?: { column: keyof Row<T> & string; ascending?: boolean };
  limit?: number;
}

export class UniqueViolation extends Error {
  constructor(public table: string, public columns: string[]) {
    super(`Unique violation on ${table}(${columns.join(",")})`);
  }
}

/**
 * Minimal persistence contract. Every engine depends on this interface only,
 * so production (Supabase) and tests/dev (memory) are interchangeable.
 */
export interface Store {
  insert<T extends TableName>(table: T, row: Partial<Row<T>>): Promise<Row<T>>;
  /** Insert, or return the existing row if a unique key already matches (idempotent create). */
  insertIfAbsent<T extends TableName>(table: T, row: Partial<Row<T>>, conflictColumns: string[]): Promise<{ row: Row<T>; created: boolean }>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  upsert<T extends TableName>(table: T, row: Partial<Row<T>>, conflictColumns: string[]): Promise<Row<T>>;
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>;
  findOne<T extends TableName>(table: T, filter: Filter<T>): Promise<Row<T> | null>;
  select<T extends TableName>(table: T, filter?: Filter<T>, options?: SelectOptions<T>): Promise<Row<T>[]>;
  delete<T extends TableName>(table: T, id: string): Promise<void>;
}

const TIMESTAMPED = new Set<TableName>(["prospects", "drafts", "appointments", "deals", "payments", "content_items", "competitors"]);

function defaults<T extends TableName>(table: T): Partial<Row<T>> {
  const now = new Date().toISOString();
  const base: Record<string, unknown> = {};
  if (PRIMARY_KEYS[table] === "id") base.id = randomUUID();
  if (TIMESTAMPED.has(table)) {
    base.created_at = now;
    base.updated_at = now;
  }
  switch (table) {
    case "prospects":
      Object.assign(base, {
        stage: "discovered", market: "unknown", contact_status: "ok", research: {}, tags: [], is_synthetic: false,
        first_name: null, last_name: null, headline: null, title: null, company: null, location: null, linkedin_url: null,
        email: null, lead_category: null, interest_level: null, offer_fit: null, previous_objection: null, score: null,
        score_class: null, score_confidence: null, score_breakdown: null, conversation_summary: null, last_interaction_at: null,
        last_inbound_at: null, last_outbound_at: null, next_action: null, next_action_due: null, follow_up_priority: null,
        deal_value_estimate: null, contact_status_reason: null, snoozed_until: null, analysed_at: null,
      });
      break;
    case "messages":
      Object.assign(base, { channel: "linkedin_message", analysed: false, created_at: now });
      break;
    case "drafts":
      Object.assign(base, {
        status: "pending_approval", guardrail_flags: [], subject: null, rationale: null, observation: null, positioning: null,
        cta: null, follow_up_in_days: null, snooze_until: null, decided_at: null, sent_confirmed_at: null, outcome: null, is_synthetic: false,
      });
      break;
    case "appointments":
      Object.assign(base, { google_event_id: null, qualified: null, notes: null, is_synthetic: false });
      break;
    case "deals":
      Object.assign(base, {
        status: "open", contract_value: 0, currency: "USD", plan: null, probability: null, market: null, lead_source: null,
        signed_at: null, closed_at: null, lost_reason: null, is_synthetic: false,
      });
      break;
    case "payments":
      Object.assign(base, { status: "outstanding", currency: "USD", verified: false, invoice_ref: null, due_at: null, paid_at: null, idempotency_key: null, is_synthetic: false });
      break;
    case "content_items":
      Object.assign(base, {
        status: "idea", assets: [], leads_attributed: 0, is_synthetic: false, pillar: null, audience: null, hook: null, body: null,
        cta: null, format: null, objective: null, reasoning: null, suggested_visual: null, scheduled_for: null, published_at: null,
        published_url: null, metrics: null, generated_by: null, idempotency_key: null,
      });
      break;
    case "competitors":
      Object.assign(base, { market: null, profile_url: null, category: null, notes: null });
      break;
    case "competitor_observations":
      Object.assign(base, { kind: "fact", content_theme: null, format: null, evidence: null, strategic_opportunity: null, idempotency_key: null, created_at: now });
      break;
    case "events":
      Object.assign(base, { occurred_at: now, actor: "system", prospect_id: null, data: {}, is_synthetic: false });
      break;
    case "workflow_runs":
      Object.assign(base, { attempt: 1, started_at: now, finished_at: null, error: null, stats: {} });
      break;
    case "reports":
      Object.assign(base, { created_at: now });
      break;
    case "settings":
    case "integration_status":
      Object.assign(base, table === "settings" ? { updated_at: now } : { checked_at: now, detail: null });
      break;
  }
  return base as Partial<Row<T>>;
}

export function withDefaults<T extends TableName>(table: T, row: Partial<Row<T>>): Row<T> {
  const d = defaults(table) as Record<string, unknown>;
  const r = { ...d } as Record<string, unknown>;
  for (const [k, v] of Object.entries(row)) if (v !== undefined) r[k] = v;
  return r as unknown as Row<T>;
}

function matches(row: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => v === undefined || row[k] === v);
}

const clone = <X>(x: X): X => structuredClone(x);

/** In-memory store with the same uniqueness semantics as the Postgres schema. Used for tests and local dev. */
export class MemoryStore implements Store {
  private data = new Map<TableName, Map<string, Record<string, unknown>>>();

  private table(t: TableName) {
    let m = this.data.get(t);
    if (!m) this.data.set(t, (m = new Map()));
    return m;
  }

  private checkUnique(t: TableName, row: Record<string, unknown>, ignorePk?: string) {
    const pk = PRIMARY_KEYS[t];
    for (const cols of UNIQUE_KEYS[t]) {
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      for (const existing of this.table(t).values()) {
        if (ignorePk !== undefined && existing[pk] === ignorePk) continue;
        if (cols.every((c) => existing[c] === row[c])) throw new UniqueViolation(t, cols);
      }
    }
  }

  async insert<T extends TableName>(t: T, row: Partial<Row<T>>): Promise<Row<T>> {
    const full = withDefaults(t, row) as unknown as Record<string, unknown>;
    const pk = PRIMARY_KEYS[t];
    if (this.table(t).has(String(full[pk]))) throw new UniqueViolation(t, [pk]);
    this.checkUnique(t, full);
    this.table(t).set(String(full[pk]), clone(full));
    return clone(full) as unknown as Row<T>;
  }

  async insertIfAbsent<T extends TableName>(t: T, row: Partial<Row<T>>, conflictColumns: string[]) {
    const filter = Object.fromEntries(conflictColumns.map((c) => [c, (row as Record<string, unknown>)[c]]));
    const existing = await this.findOne(t, filter as Filter<T>);
    if (existing) return { row: existing, created: false };
    return { row: await this.insert(t, row), created: true };
  }

  async update<T extends TableName>(t: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>> {
    const current = this.table(t).get(id);
    if (!current) throw new Error(`${t} ${id} not found`);
    const next: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
    if (TIMESTAMPED.has(t)) next.updated_at = new Date().toISOString();
    this.checkUnique(t, next, id);
    this.table(t).set(id, clone(next));
    return clone(next) as unknown as Row<T>;
  }

  async upsert<T extends TableName>(t: T, row: Partial<Row<T>>, conflictColumns: string[]): Promise<Row<T>> {
    const filter = Object.fromEntries(conflictColumns.map((c) => [c, (row as Record<string, unknown>)[c]]));
    const existing = await this.findOne(t, filter as Filter<T>);
    if (existing) {
      const pk = PRIMARY_KEYS[t];
      const { [pk]: _drop, ...rest } = row as Record<string, unknown>;
      return this.update(t, String((existing as unknown as Record<string, unknown>)[pk]), rest as unknown as Partial<Row<T>>);
    }
    return this.insert(t, row);
  }

  async get<T extends TableName>(t: T, id: string): Promise<Row<T> | null> {
    const r = this.table(t).get(id);
    return r ? (clone(r) as unknown as Row<T>) : null;
  }

  async findOne<T extends TableName>(t: T, filter: Filter<T>): Promise<Row<T> | null> {
    const rows = await this.select(t, filter, { limit: 1 });
    return rows[0] ?? null;
  }

  async select<T extends TableName>(t: T, filter: Filter<T> = {}, options: SelectOptions<T> = {}): Promise<Row<T>[]> {
    let rows = [...this.table(t).values()].filter((r) => matches(r, filter as Record<string, unknown>));
    if (options.order) {
      const { column, ascending = true } = options.order;
      rows.sort((a, b) => {
        const av = a[column] as string | number | null;
        const bv = b[column] as string | number | null;
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (options.limit !== undefined) rows = rows.slice(0, options.limit);
    return rows.map((r) => clone(r) as unknown as Row<T>);
  }

  async delete<T extends TableName>(t: T, id: string): Promise<void> {
    this.table(t).delete(id);
  }

  /** Test helper: dump everything (used by backup tests). */
  dump(): Record<string, unknown[]> {
    return Object.fromEntries([...this.data.entries()].map(([k, v]) => [k, [...v.values()].map(clone)]));
  }
}
