#!/usr/bin/env node
/**
 * Command-line entry point. GitHub Actions runs `npm run cli -- workflow <name>`; the owner can run the same
 * commands locally. Every command uses the same store and engines as the tracker.
 */
import { readFile } from "node:fs/promises";
import { openAi } from "./ai/claude.js";
import { GoogleCalendar } from "./calendar/google.js";
import { openStore } from "./db/index.js";
import { loadEnv } from "./lib/env.js";
import { setSetting } from "./lib/audit.js";
import { WebhookNotifier } from "./notify/index.js";
import { importFile } from "./leads/reactivation.js";
import { WORKFLOWS, run, checkIntegrations } from "./workflows/index.js";
import type { WorkflowName } from "./workflows/runner.js";
import { restoreBackup, type BackupFile } from "./workflows/backup.js";
import { seedSynthetic } from "./seed.js";
import { upsertCompetitor, researchCompetitor } from "./competitors/index.js";

function ctx() {
  const env = loadEnv();
  const store = openStore(env);
  return { env, store, ai: openAi(env), cal: new GoogleCalendar(env), notifier: new WebhookNotifier(store, env), now: new Date() };
}

const HELP = `Usage: npm run cli -- <command>
  workflow <${Object.keys(WORKFLOWS).join("|")}> [--force]   Run a scheduled workflow (idempotent per slot)
  import <file.csv> [--format linkedin_messages|linkedin_connections|crm_csv]
  pause | resume                                     Emergency pause / resume automation
  health                                             Refresh integration status
  competitor <name> [--market dubai|usa|uk] [--url https://...]   Research a competitor (public web)
  restore <backup.json>                              Restore an encrypted backup
  seed                                               Synthetic demo data (development only; refuses in production)`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const flag = (n: string) => {
    const i = args.indexOf("--" + n);
    return i >= 0 ? args[i + 1] ?? true : undefined;
  };
  const c = ctx();
  switch (cmd) {
    case "workflow": {
      const name = args[0] as WorkflowName;
      if (!WORKFLOWS[name]) throw new Error(`Unknown workflow ${name}`);
      const r = await run(c, name, { force: !!flag("force") });
      console.log(JSON.stringify({ workflow: name, status: r.status, slot: r.run?.slot, stats: r.stats ?? r.run?.stats, error: r.error }, null, 2));
      if (r.status === "failed") process.exitCode = 1;
      return;
    }
    case "import": {
      const text = await readFile(args[0], "utf8");
      const s = await importFile(c.store, text, { name: c.env.ownerName, linkedinUrl: c.env.ownerLinkedinUrl }, { format: flag("format") as never });
      console.log(JSON.stringify(s, null, 2));
      return;
    }
    case "pause":
    case "resume":
      await setSetting(c.store, "automation_paused", cmd === "pause");
      console.log(`Automation ${cmd === "pause" ? "PAUSED" : "resumed"}.`);
      return;
    case "health":
      await checkIntegrations(c);
      console.log(JSON.stringify(await c.store.select("integration_status"), null, 2));
      return;
    case "competitor": {
      const comp = await upsertCompetitor(c.store, { name: args[0], market: (flag("market") as string) ?? null, profile_url: (flag("url") as string) ?? null });
      console.log(JSON.stringify(await researchCompetitor(c.store, c.ai, comp), null, 2));
      return;
    }
    case "restore": {
      const file = JSON.parse(await readFile(args[0], "utf8")) as BackupFile;
      console.log(JSON.stringify(await restoreBackup(c.store, file, c.env.backupEncryptionKey), null, 2));
      return;
    }
    case "seed":
      console.log(JSON.stringify(await seedSynthetic(c.store, c.env), null, 2));
      return;
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
