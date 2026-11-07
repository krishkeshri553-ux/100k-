# Deployment (≈45 minutes, once)

Everything runs in the cloud after this. You need accounts at Supabase, Vercel, Anthropic and Google Cloud.

## 1. Supabase (database)

1. Create a project (region close to you, e.g. Mumbai `ap-south-1`).
2. *Project Settings → API*: copy **Project URL** and the **service_role** key (never the anon key — it has no access by design).
3. *Project Settings → Database*: copy the connection string (URI) for migrations.
4. Apply the schema — either paste `supabase/migrations/0001_init.sql` into the SQL editor and run it, or add `SUPABASE_DB_URL` as a GitHub secret and run **Actions → DB migrate**. The script is idempotent.

## 2. GitHub secrets and variables

*Repo → Settings → Secrets and variables → Actions*

**Secrets:** `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `BACKUP_ENCRYPTION_KEY` (generate: `openssl rand -hex 32` — store a copy in your password manager; backups can't be restored without it), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `NOTIFY_WEBHOOK_URL` (optional), `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

**Variables:** `OWNER_NAME`, `OWNER_LINKEDIN_URL`, `GOOGLE_CALENDAR_ID` (default `primary`), `CLAUDE_MODEL` (optional).

## 3. Vercel (tracker)

1. Import the repo as a project (Framework preset: *Other*). Git auto-deploys are disabled in `vercel.json`; deployment runs from GitHub Actions **after tests pass**.
2. *Settings → Environment Variables (Production):* `APP_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_*`, `OWNER_NAME`, `OWNER_LINKEDIN_URL`, `TRACKER_PASSPHRASE` (a long passphrase you'll type), `TRACKER_SESSION_SECRET` (`openssl rand -hex 32`).
3. Create a token (*Account → Tokens*) → `VERCEL_TOKEN`; from `.vercel/project.json` after `npx vercel link` take `orgId` → `VERCEL_ORG_ID`, `projectId` → `VERCEL_PROJECT_ID`.
4. Push to `main` (or run **Actions → Deploy tracker**). The URL Vercel assigns is your private tracker. It sends `noindex` headers and requires the passphrase. Optional: enable Vercel *Deployment Protection* for a second lock.

## 4. Google Calendar OAuth (refresh token)

1. Google Cloud Console → new project → enable **Google Calendar API**.
2. *OAuth consent screen*: External, add yourself as a test user (or publish the app so the refresh token doesn't expire after 7 days in "Testing").
3. *Credentials → Create OAuth client ID* → **Desktop app**. Copy client ID/secret.
4. Get a refresh token with scopes `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy` — e.g. the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) (gear icon → "Use your own OAuth credentials"), authorise those scopes, exchange the code, copy the refresh token.
5. Store as `GOOGLE_REFRESH_TOKEN` in GitHub and Vercel.

## 5. Branch and schedules

GitHub only runs scheduled workflows from the **default branch**. This repo currently has a single branch (`claude/hustlegrowthz-ai-revenue-dept-amzp5b`), so it is the default and the schedule is already active. If you later create `main` and make it the default, merge into it first. (`deploy.yml` deploys on pushes to `main`; until then use **Actions → Deploy tracker → Run workflow**.)

Until the Supabase secrets exist, the scheduled jobs and backups **skip quietly**: each run finishes green with a "Skipped: … not set yet" warning in its summary. Once the database is configured they run for real — and the backup job then fails loudly if `BACKUP_ENCRYPTION_KEY` is missing, so real data is never backed up unencrypted.

After adding the secrets:

- **Actions → Revenue operations → Run workflow → `daytime`** once: it records integration status (System Health turns green for what's connected).
- **Actions → Database backup → Run workflow** once: confirms backups.

## 6. First data

Tracker → **Leads → Import CSV**: LinkedIn *Settings → Data privacy → Get a copy of your data* → *Messages* and *Connections*. Upload `messages.csv`, then `Connections.csv`, then any CRM sheet. Re-uploading is safe (duplicates are skipped). Files over ~3.9 MB: `npm run cli -- import messages.csv` locally with production env vars.

## Verify

| Check | Expected |
|---|---|
| Tracker login | Passphrase works; 8 wrong attempts lock for 15 min |
| Overview, empty DB | Honest zeros and "no data yet" states, no demo numbers |
| After import | Leads classified/scored with explanations; drafts in Approvals |
| `daytime` run | System Health lists Claude/Supabase/Google/LinkedIn statuses |
| Backup run | Artifact `backup-<id>` (encrypted JSON) in the run summary |
