# Build status

_Updated 2026-11-07. Honest status: **built and tested in code; not yet deployed or live-verified** (no credentials were available in the build environment)._

| Phase | Status | Notes |
|---|---|---|
| 1. Repo audit & website research | ✅ Done | Repo was empty. Site scraped (home + 18 routes), snapshots in `knowledge/website_snapshot/` |
| 2. Business knowledge base | ✅ Done | `knowledge/business_brain.json`, `BUSINESS_KNOWLEDGE.md`; tested against snapshot |
| 3. Database & old-lead reactivation | ✅ Code + tests | Schema verified on Postgres (PGlite). Import → resolve → classify (A–I) → score → next action → drafts |
| 4. Lead intelligence & qualification | ✅ Code + tests | 0–100 model, explanations, unknown-aware, calibration suggestions |
| 5. Sales Navigator workflow | ✅ SOP usable / ⏳ subscription unverified | `docs/SALES_NAVIGATOR_SOP.md`; fill `config/sales_navigator.json` |
| 6. Sales agent & message preparation | ✅ Code + tests | Packages, guardrails, approvals, 9 strategies |
| 7. Google Calendar | ✅ Code + tests (mocked) / ⏳ live | Needs OAuth refresh token |
| 8. Competitor intelligence | ✅ Code + tests (mocked) / ⏳ live | Needs Claude key with web search |
| 9. Content strategy & design | ✅ Code + tests | SVG design studio works without external services |
| 10. Revenue Command Tracker | ✅ Built, browser-checked locally | Deploy pending |
| 11. Cloud execution & deployment | ✅ Workflows + Vercel config written / ⏳ not run | Requires secrets + merge to default branch |
| 12. End-to-end testing | ✅ 80/80 automated | Live E2E pending credentials |
| 13. Production launch | ⏳ Blocked on credentials | See checklist below |

## What is working now

- Full engine stack runs locally and in CI with zero credentials (deterministic fallbacks, honest skips).
- `npm run dev:tracker -- --seed` serves the tracker with clearly-labelled synthetic data.

## Blocked / required from you

| Item | Needed for | Where |
|---|---|---|
| Supabase project + `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` | Everything in production | DEPLOYMENT.md §1 |
| `ANTHROPIC_API_KEY` | Claude classification refinement, outreach writing, content, research, weekly narrative | GitHub + Vercel |
| Google OAuth client + refresh token | Availability, booking | DEPLOYMENT.md §4 |
| Vercel project + token/IDs, `TRACKER_PASSPHRASE`, `TRACKER_SESSION_SECRET` | Private tracker URL | DEPLOYMENT.md §3 |
| `BACKUP_ENCRYPTION_KEY` | Production backups (refuse to run unencrypted) | GitHub secret |
| Merge to default branch | GitHub only runs cron from the default branch | — |
| Sales Navigator plan details | InMail drafting certainty, filter availability | `config/sales_navigator.json` |
| Your LinkedIn data export | Old-lead reactivation (the first module) | Tracker → Import |

## Permissions that are missing (and will stay manual)

LinkedIn messaging / InMail / connection requests / personal-profile publishing APIs — not available to this system. The tracker prepares and tracks; you send.

## Launch checklist (in order)

1. Supabase → run migration. 2. GitHub secrets/variables. 3. Vercel env + first deploy. 4. Google OAuth. 5. Merge to `main`. 6. Run `daytime` manually → System Health green. 7. Import LinkedIn export. 8. Review the first approval queue. 9. Run `backup` manually and confirm the artifact. 10. After a week, check the evening reports match what you did.

## Known limitations / next improvements

- Tracker queries load full tables — fine to tens of thousands of rows; add SQL views beyond that.
- Only USD revenue (all published prices are USD).
- Daily/weekly reports are delivered via webhook + tracker; email delivery not built.
- First real-estate case studies (with permission) would remove the biggest sales-proof gap.
