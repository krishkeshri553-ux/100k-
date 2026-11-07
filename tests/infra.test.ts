import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { config } from "../src/lib/config.js";
import { BACKUP_TABLES } from "../src/workflows/backup.js";
import { UNIQUE_KEYS } from "../src/db/types.js";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("cloud schedule", () => {
  it("GitHub Actions cron lines match config/schedule.json", () => {
    const ops = read(".github/workflows/revenue-ops.yml");
    const backup = read(".github/workflows/backup.yml");
    for (const [name, w] of Object.entries(config.schedule.workflows)) {
      const file = name === "backup" ? backup : ops;
      expect(file, `${name} cron`).toContain(`cron: "${w.cron}"`);
      if (name !== "backup") expect(ops).toContain(`"${w.cron}") n=${name}`);
    }
  });
  it("workflows never poll or keep alive", () => {
    for (const f of ["revenue-ops.yml", "backup.yml", "ci.yml", "deploy.yml"]) {
      const y = read(`.github/workflows/${f}`);
      const code = y.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
      expect(code).not.toMatch(/while true|sleep \d{3,}|keep-?alive/i);
      expect(y).toMatch(/timeout-minutes/);
      expect(y).toMatch(/permissions:\s*\n\s*contents: read/);
    }
  });
  it("no secrets are hardcoded in workflow files", () => {
    for (const f of ["revenue-ops.yml", "backup.yml", "deploy.yml", "db-migrate.yml"]) {
      const y = read(`.github/workflows/${f}`);
      for (const line of y.split("\n").filter((l) => /(KEY|TOKEN|SECRET):/.test(l))) expect(line).toMatch(/\$\{\{ secrets\./);
    }
  });
});

describe("database migration (real Postgres via PGlite)", () => {
  it("applies cleanly, twice (idempotent), with RLS on every table and the unique keys the code relies on", async () => {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated;`);
    const sql = read("supabase/migrations/0001_init.sql").replace(/create extension if not exists pgcrypto;/, ""); // gen_random_uuid is core in PG13+
    await db.exec(sql);
    await db.exec(sql);
    const tables = (await db.query<{ tablename: string; rowsecurity: boolean }>(`select tablename, rowsecurity from pg_tables where schemaname='public'`)).rows;
    expect(tables.map((t) => t.tablename).sort()).toEqual([...BACKUP_TABLES].sort());
    expect(tables.every((t) => t.rowsecurity)).toBe(true);
    // Every uniqueness rule the memory store enforces must exist in Postgres.
    const idx = (await db.query<{ tablename: string; indexdef: string }>(`select tablename, indexdef from pg_indexes where schemaname='public' and indexdef ilike '%unique%'`)).rows;
    for (const [table, sets] of Object.entries(UNIQUE_KEYS)) {
      for (const cols of sets) {
        const hit = idx.some((i) => i.tablename === table && cols.every((c) => new RegExp(`[(, ]${c}[,)]`).test(i.indexdef)));
        expect(hit, `${table}(${cols.join(",")}) unique`).toBe(true);
      }
    }
    // Duplicate prevention works at the database level.
    await db.query(`insert into prospects(identity_key, full_name, source) values ('li:in/x','X','t')`);
    await expect(db.query(`insert into prospects(identity_key, full_name, source) values ('li:in/x','X2','t')`)).rejects.toThrow(/duplicate key/);
    // updated_at trigger
    await db.query(`update prospects set full_name='Y' where identity_key='li:in/x'`);
    const r = await db.query<{ a: boolean }>(`select updated_at >= created_at as a from prospects`);
    expect(r.rows[0].a).toBe(true);
    // anon has no privileges
    const g = await db.query(`select * from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema='public'`);
    expect(g.rows).toHaveLength(0);
    await db.close();
  }, 60_000);
});
