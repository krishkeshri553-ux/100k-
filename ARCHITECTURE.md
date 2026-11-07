# Architecture

One repository, one TypeScript codebase, three runtimes that share the same engines and database.

```
                ┌──────────────────────────── GitHub (this repo) ────────────────────────────┐
                │  src/ engines · config/ · knowledge/business_brain.json · supabase/migrations │
                └───────────────┬──────────────────────────────┬──────────────────────────────┘
                                │                              │
          GitHub Actions (finite scheduled jobs)      Vercel (tracker hosting)
          revenue-ops.yml  backup.yml  ci/deploy       public/ (static UI) + api/index.ts (1 function)
          `npm run cli -- workflow <name>`             src/api/handler.ts
                                │                              │
                                └──────────────┬───────────────┘
                                               ▼
                         Supabase Postgres (single source of truth, RLS deny-all,
                         service-role key server-side only)
                                               │
                 Claude API (intelligence) · Google Calendar API (OAuth) · Slack/Discord webhook
```

Claude Code is the development interface only. Nothing depends on a laptop, browser or chat session.

## Why this shape

| Choice | Reason | Trade-off |
|---|---|---|
| GitHub Actions for schedules | Free, in the same repo, auditable logs, secrets store | Cron can start a few minutes late; not real-time. Acceptable: nothing here needs sub-minute latency. |
| No always-on worker | There is no persistent stream to consume (LinkedIn gives no authorised inbox API). Every job is finite. | If a webhook source is added later (e.g. Calendly), a Vercel function receives it — still no worker. |
| Supabase Postgres | Durable, relational, backups, RLS | Service-role key must stay server-side (it does). |
| Single Vercel function + static page | Fast load (no framework bundle), one cold start, fits Hobby limits | Hand-written vanilla JS UI. |
| Store interface (`src/db/store.ts`) | Engines are tested against an in-memory store with identical uniqueness rules; migration tested on real Postgres (PGlite) | Tracker queries load whole tables; fine up to tens of thousands of rows. Add SQL views if it grows beyond that. |
| Deterministic rules first, Claude second | Everything works (degraded) without the API; Claude can refine but never override hard rules (opt-outs, guardrails) | Template drafts are weaker — and the system refuses to write generic ones. |

## Modules (`src/`)

| Module | Responsibility |
|---|---|
| `brain/` | Loads HUSTLEGROWTHZ_BUSINESS_BRAIN, renders the cached system prompt, exposes approved numbers for guardrails |
| `ai/claude.ts` | Claude client: structured outputs (`beta.messages.parse` + Zod), prompt caching on the brain, server-side refusal fallback, web search research (LinkedIn blocked), token accounting. `NoAi`/`FakeAi` for fallback/tests |
| `leads/` | Importers (LinkedIn messages/connections exports, CRM CSV), identity resolution, market detection, conversation classification (A–I), scoring 0–100, reactivation engine |
| `outreach/` | Draft generation (connection note, initial, follow-up, InMail, reactivation, reply) and guardrails |
| `approvals/` | Approval state machine; the *only* path that records a message as sent |
| `sales/` | Sales setter/closer analysis: strategy (9 types), objections, case studies (validated), booking readiness, sensitive-request escalation |
| `calendar/` | Slot finding (owner + prospect time zones), Google Calendar REST client, idempotent booking, reschedule/cancel/attendance |
| `competitors/` | Public-web research grounded to real URLs, observations (fact vs estimate), insights |
| `content/`, `design/` | Content strategist, weekly scheduling, post drafting, approval, manual publish confirmation, real metrics, attribution; SVG carousel renderer |
| `revenue/` | Deals, invoices, recorded vs verified cash |
| `metrics/` | All tracker numbers, computed from rows only |
| `reports/` | Daily report, weekly revenue intelligence (+ calibration suggestions) |
| `workflows/` | Runner (idempotent slots, retries, crash recovery, pause), the 7 workflows, encrypted backup/restore |
| `api/` | Tracker HTTP handler (auth, CSRF, rate limit, validated actions) |
| `pipeline/` | Stage order and transition rules |

## Data model

See `supabase/migrations/0001_init.sql`. Key tables: `prospects` (CRM), `messages` (timeline, content-hashed `external_id` for idempotent import), `drafts` (approval state, guardrail flags, idempotency key per prospect × kind × conversation state), `appointments`, `deals`, `payments`, `content_items`, `competitors`/`competitor_observations`, `events` (append-only audit + activity feed), `workflow_runs` (idempotency + health), `reports`, `settings`, `integration_status`.

Pipeline: Discovered → Qualified → Researched → Outreach Drafted → Pending Approval → Approved → Manually Contacted → Connected → Replied → Interested → Appointment Booked → Attended → Proposal Sent → Won / Lost. Automation only moves forward; the owner can set any stage (audited).

## Idempotency & recovery

| Risk | Guard |
|---|---|
| Re-importing the same export | `messages.external_id` = hash(conversation, timestamp, sender, body) — unique |
| Same person from 3 sources | Resolution by LinkedIn URL → email → identity key → name; strong identifiers upgrade weak keys |
| Workflow retried | `workflow_runs (workflow, slot)` — a succeeded slot never re-runs; failures retry as attempt n+1; runs stuck "running" > 2h are marked failed and retried |
| Duplicate drafts | `drafts.idempotency_key` = (prospect, kind, last interaction) + "one active draft per kind" |
| Duplicate bookings | `appointments.idempotency_key` = (prospect, start); deterministic Google event id (409 = already exists); one confirmed future call per prospect |
| Duplicate invoices | `payments.idempotency_key` |

## LinkedIn & platform compliance

There is no authorised LinkedIn API in this system. Messaging, InMail, connection requests and personal-profile publishing are prepared as drafts and executed **by you**, manually. See `INTEGRATION_STATUS.md`.
