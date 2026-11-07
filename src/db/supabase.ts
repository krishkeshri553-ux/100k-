import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PRIMARY_KEYS, type TableName } from "./types.js";
import { UniqueViolation, withDefaults, type Filter, type Row, type SelectOptions, type Store } from "./store.js";

const PAGE = 1000;

/** Production store backed by Supabase Postgres via the service-role key (server-side only). */
export class SupabaseStore implements Store {
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-client-info": "hustlegrowthz-revenue-dept" } },
    });
  }

  // The schema is defined in SQL, not generated TS types, so the query builder is used untyped here
  // and rows are typed at the Store boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private from(table: string): any {
    return this.client.from(table);
  }

  private fail(table: string, error: { code?: string; message: string; details?: string | null }, columns: string[] = []): never {
    if (error.code === "23505") throw new UniqueViolation(table, columns);
    throw new Error(`Supabase ${table}: ${error.message}${error.details ? ` (${error.details})` : ""}`);
  }

  async insert<T extends TableName>(table: T, row: Partial<Row<T>>): Promise<Row<T>> {
    const full = withDefaults(table, row);
    const { data, error } = await this.from(table).insert(full).select().single();
    if (error) this.fail(table, error);
    return data as Row<T>;
  }

  async insertIfAbsent<T extends TableName>(table: T, row: Partial<Row<T>>, conflictColumns: string[]) {
    const filter = Object.fromEntries(conflictColumns.map((c) => [c, (row as Record<string, unknown>)[c]]));
    const existing = await this.findOne(table, filter as Filter<T>);
    if (existing) return { row: existing, created: false };
    try {
      return { row: await this.insert(table, row), created: true };
    } catch (e) {
      // Lost a race with a concurrent run: the unique index is the real guarantee.
      if (e instanceof UniqueViolation) {
        const again = await this.findOne(table, filter as Filter<T>);
        if (again) return { row: again, created: false };
      }
      throw e;
    }
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>> {
    const pk = PRIMARY_KEYS[table];
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const { data, error } = await this.from(table).update(clean).eq(pk, id).select().single();
    if (error) this.fail(table, error);
    return data as Row<T>;
  }

  async upsert<T extends TableName>(table: T, row: Partial<Row<T>>, conflictColumns: string[]): Promise<Row<T>> {
    const filter = Object.fromEntries(conflictColumns.map((c) => [c, (row as Record<string, unknown>)[c]]));
    const existing = await this.findOne(table, filter as Filter<T>);
    if (existing) {
      const pk = PRIMARY_KEYS[table];
      const { [pk]: _drop, ...rest } = row as Record<string, unknown>;
      return this.update(table, String((existing as unknown as Record<string, unknown>)[pk]), rest as unknown as Partial<Row<T>>);
    }
    return this.insert(table, row);
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const { data, error } = await this.from(table).select("*").eq(PRIMARY_KEYS[table], id).maybeSingle();
    if (error) this.fail(table, error);
    return (data as Row<T>) ?? null;
  }

  async findOne<T extends TableName>(table: T, filter: Filter<T>): Promise<Row<T> | null> {
    const rows = await this.select(table, filter, { limit: 1 });
    return rows[0] ?? null;
  }

  async select<T extends TableName>(table: T, filter: Filter<T> = {}, options: SelectOptions<T> = {}): Promise<Row<T>[]> {
    const out: Row<T>[] = [];
    let from = 0;
    for (;;) {
      let q = this.from(table).select("*");
      for (const [k, v] of Object.entries(filter)) {
        if (v === undefined) continue;
        q = v === null ? q.is(k, null) : q.eq(k, v as never);
      }
      if (options.order) q = q.order(options.order.column as string, { ascending: options.order.ascending ?? true });
      const want = options.limit !== undefined ? Math.min(PAGE, options.limit - out.length) : PAGE;
      const { data, error } = await q.range(from, from + want - 1);
      if (error) this.fail(table, error);
      out.push(...((data ?? []) as Row<T>[]));
      if (!data || data.length < want || (options.limit !== undefined && out.length >= options.limit)) break;
      from += want;
    }
    return out;
  }

  async delete<T extends TableName>(table: T, id: string): Promise<void> {
    const { error } = await this.from(table).delete().eq(PRIMARY_KEYS[table], id);
    if (error) this.fail(table, error);
  }
}
