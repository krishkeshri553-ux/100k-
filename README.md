# HustleGrowthz AI Revenue Department

A cloud-run sales and marketing operating system for HustleGrowthz Pvt. Ltd.: it revives old LinkedIn conversations, scores and researches real estate prospects (Dubai → USA → UK), prepares personalised outreach for **your** approval, analyses replies, books strategy calls on Google Calendar, researches competitors, runs a LinkedIn content department, and reports honest revenue numbers on a private black-and-gold **Revenue Command** tracker.

Claude does the thinking. GitHub Actions runs the schedule. Supabase stores everything. Vercel hosts the tracker. Your laptop can stay off.

> **Nothing is ever sent to LinkedIn automatically.** The system drafts; you approve, send by hand, and tap *I sent it*. Only that confirmation counts as "sent".

## Quick start (local, no credentials)

```bash
npm ci
```
```bash
npm run check
```
```bash
npm run dev:tracker -- --seed
```
Open http://localhost:3000, passphrase `dev-passphrase`. Demo rows are synthetic, labelled, and excluded from production.

## Going live

Follow [DEPLOYMENT.md](DEPLOYMENT.md) (≈45 min): Supabase → GitHub secrets → Vercel → Google OAuth → merge to `main`. Then import your LinkedIn data export from the tracker.

## Docs

| Doc | What's in it |
|---|---|
| [BUILD_STATUS.md](BUILD_STATUS.md) | What's done, what's blocked, what you need to provide |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, data model, idempotency, trade-offs |
| [BUSINESS_KNOWLEDGE.md](BUSINESS_KNOWLEDGE.md) | The verified business brain and key findings from the website |
| [docs/SALES_NAVIGATOR_SOP.md](docs/SALES_NAVIGATOR_SOP.md) | Subscription audit, saved searches, daily routine |
| [INTEGRATION_STATUS.md](INTEGRATION_STATUS.md) | Each integration, fallback and required credential |
| [OPERATIONS.md](OPERATIONS.md) | Schedule, daily loop, common tasks, troubleshooting |
| [SECURITY.md](SECURITY.md) | Controls and how they're verified |
| [TEST_REPORT.md](TEST_REPORT.md) | Test coverage against the spec |

## CLI

```bash
npm run cli -- help
```
`workflow <morning|daytime|content|evening|weekly|backup|knowledge> [--force]` · `import <file.csv>` · `pause` / `resume` · `health` · `competitor "<name>" --market dubai` · `restore <backup.json>` · `seed` (dev only)
