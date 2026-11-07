# Test report

**Run:** 2026-11-07 · `npm run check` (typecheck + Vitest) · **80 / 80 passed**, 7 files, ~3 s. Also enforced in CI (`ci.yml`) and before every deployment (`deploy.yml`).

All test data is synthetic (fictional names, flagged `is_synthetic`). No test calls a real external service: Claude, Google and webhooks are replaced with fakes that implement the same interfaces. The schema test runs on a real Postgres engine (PGlite).

## Coverage against the specification (Part 20)

| # | Requirement | Tests | Result |
|---|---|---|---|
| 1 | Website knowledge extraction | brain checked against the committed website snapshot (prices, case studies, no-guarantee, LinkedIn exclusion, real-estate page) | ✅ |
| 2 | Business knowledge accuracy | every website claim has a hustlegrowthz.com source; approved-price whitelist; deterministic prompt | ✅ |
| 3 | Old lead import | LinkedIn messages export (owner detection by URL / name / frequency), Connections export (with preamble), CRM CSV | ✅ |
| 4 | Conversation classification | pricing, info request, proposal, interested-not-booked, replied-then-silent, soft vs hard decline, never-engaged, opt-out | ✅ |
| 5 | Duplicate detection | same person across 3 sources → 1 prospect; re-import adds 0 messages; DB-level unique violation | ✅ |
| 6 | Lead scoring | unknown = neutral + confidence; hot founder case with explanation; confidence cap; opt-out = 0; calibration needs real outcomes | ✅ |
| 7 | Follow-up generation | planned message types; Claude package queued for approval idempotently; policy-breaking drafts blocked; refuses generic template; no drafts for DNC | ✅ |
| 8 | Approval workflow | approve → sent is the only "sent" path; edit re-runs guardrails; owner-overridable vs non-overridable flags; reject/snooze/wake; InMail credit decrement; DNC withdraws drafts | ✅ |
| 9 | Sales conversation analysis | sensitive requests escalate; invented case-study ids dropped; reply guardrailed | ✅ |
| 10 | Calendar availability | working hours in Asia/Kolkata, notice, buffers, busy times, ≤2 per day, prospect time zone labels/filter | ✅ |
| 11 | Appointment booking | explicit confirmation required; idempotent; no double booking; reschedule/cancel/attended/no-show; OAuth refresh + 409 handling | ✅ (mocked API) |
| 12 | Content generation | requires Claude (no invented ideas); idempotent ideas; weekly schedule; carousel rendering; approval gate; placeholder gate; manual publish with LinkedIn URL check; metrics validation; attribution; performance | ✅ |
| 13 | Tracker metrics | empty DB shows honest zeros/nulls; drafts/approvals never counted as sent; synthetic excluded in production | ✅ |
| 14 | Revenue calculations | pipeline vs weighted forecast vs signed vs recorded vs verified cash; idempotent invoices; by-market; 6-month history; USD only | ✅ |
| 15 | Cloud scheduling | cron lines match config; no polling/keep-alive; read-only permissions; slot computation; next-run computation | ✅ |
| 16 | Retry handling | failed slot retried as attempt 2; succeeded slot not re-run; forced re-run creates no duplicate drafts | ✅ |
| 17 | Failure recovery | stuck "running" jobs recovered; failure notification; encrypted backup → restore (idempotent), wrong key rejected | ✅ |
| 18 | Security controls | config required; forged/expired sessions; hardened cookie; brute-force lock; CSRF; payload validation; XSS escaping in SVG; no hardcoded secrets; RLS + no anon grants | ✅ |

## Also verified manually

- Tracker UI rendered in Chromium (desktop 1440 px and mobile 390 px) against the dev server with synthetic data: login, overview, leads, lead drawer, approvals, content (carousel previews), reports. No console errors besides the expected pre-login 401; no horizontal scroll on mobile.
- CLI: `import`, `workflow evening`; production mode refuses to start without Supabase.

## Not yet verified (needs your credentials)

Live Claude API calls (structured outputs, web search), live Supabase writes, live Google Calendar booking, Slack/Discord delivery, Vercel deployment and the scheduled GitHub Actions runs. See `BUILD_STATUS.md` for the exact steps.
