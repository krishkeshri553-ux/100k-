# Security

| Control | Implementation | Verified by |
|---|---|---|
| No secrets in git | All credentials via GitHub Secrets / Vercel env; `.env*` ignored; CI greps for key patterns | `ci.yml`, `tests/infra.test.ts` |
| Least privilege DB | RLS enabled on every table with **no policies**; `anon`/`authenticated` revoked. Only the service-role key (server-side) can read/write | `tests/infra.test.ts` (real Postgres) |
| Least privilege CI | Every workflow `permissions: contents: read`; no write tokens | `tests/infra.test.ts` |
| Tracker auth | Single owner passphrase → HMAC-SHA256 signed session (12 h), `HttpOnly; Secure; SameSite=Strict` cookie; constant-time comparison | `tests/api-security.test.ts` |
| Brute force | Failed logins recorded in the audit log; 8 failures in 15 min lock login (works across serverless instances). IPs stored only as truncated HMAC | same |
| CSRF | Custom header required on every POST + Origin/Host check + SameSite=Strict | same |
| Input validation | Every tracker action validated by a Zod schema (UUIDs, enums, lengths); unknown actions rejected | same |
| XSS | UI builds DOM with `textContent` only; strict CSP (`script-src 'self'`, no inline scripts/styles); SVG text escaped | `tests/brain-content.test.ts` |
| Headers | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `noindex` | `vercel.json` |
| LinkedIn credentials | Never stored. No passwords, cookies or session tokens anywhere | design |
| Approval gate | Personal outreach, connection requests, InMail, discounts, contract/refund commitments need owner approval; guardrails block guarantees, unapproved prices, LinkedIn-publishing promises, invented real-estate results; owner can only override *commercial* flags (discount, custom price) | `tests/outreach.test.ts` |
| Opt-out enforcement | Opt-out language or DNC flags set `contact_status`; all pending drafts withdrawn; no drafts, approvals, sends or bookings possible; Claude cannot override | `tests/leads.test.ts`, `tests/outreach.test.ts` |
| Audit log | Append-only `events` for every owner action, workflow, AI fallback, login | — |
| Emergency pause | Tracker button / `npm run cli -- pause`: stops morning, daytime and content workflows; reports and backups continue | `tests/system.test.ts` |
| Backups | Daily AES-256-GCM encrypted export → private Actions artifact (30-day retention); production refuses unencrypted backups; tested restore | `tests/system.test.ts` |
| Rate limits / cost | Per-run caps on classifications, drafts, reply analyses, content ideas (`config/revenue.json`); SDK retries with backoff; token usage recorded per run | — |
| Data retention | `events`/`messages` kept for audit. To erase a person: delete the prospect row (cascades to messages, drafts, appointments, deals). Privacy policy on the site states 24 months for enquiries — align by deleting stale `never_engaged` prospects periodically | OPERATIONS.md |

## Reporting

Rotate any credential you suspect leaked: Supabase (service key), Anthropic, Google (revoke refresh token), Vercel, and `TRACKER_SESSION_SECRET` (rotating it signs everyone out).
