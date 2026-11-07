# Operations

## Schedule (Asia/Kolkata)

| Workflow | When | What it does | Runs while paused? |
|---|---|---|---|
| morning | 08:17 daily | Wake snoozed drafts, (re)analyse leads with new activity, score, draft outreach for due/qualified leads (cap 25), priority list notification | No |
| daytime | 11:47, 14:47, 17:47, 20:47 | Integration health; analyse new inbound replies; reply drafts; stage updates; hot-lead alerts with suggested call times | No |
| content | 09:47 Mon–Sat | Weekly ideas quota, schedule the week, draft posts due in the next 2 days (+ carousels) into approval | No |
| evening | 21:07 daily | Daily performance report (+ notification) | Yes |
| weekly | 17:37 Sunday | Revenue intelligence report, calibration suggestions | Yes |
| backup | 22:53 daily | Encrypted DB backup artifact | Yes |
| knowledge | 09:23 Monday | Website change check for the brain | Yes |

Edit times in **both** `config/schedule.json` and `.github/workflows/revenue-ops.yml` (a test fails if they diverge).

## Your daily loop (≈30–40 min)

See `docs/SALES_NAVIGATOR_SOP.md` §2. In short: clear **Approvals** → send manually → **I sent it**; add 5–10 researched Sales Navigator prospects; log replies; publish the approved post and mark it published; enter last week's post metrics on Mondays.

## Common tasks

| Task | How |
|---|---|
| Emergency stop | Tracker → **Emergency pause** (or `npm run cli -- pause`). Resume the same way. |
| Re-run a failed workflow | Actions → Revenue operations → Run workflow → pick it (tick *force* to redo a succeeded slot — safe, idempotent) |
| Import data | Tracker → Leads → Import CSV, or `npm run cli -- import file.csv` |
| Record a sale | Lead → **Deal / invoice** → open/proposal → **Mark won** → add invoice → **Mark paid** (confirm verified only when the money is in your account) |
| Book a call | Lead → **Book call** → pick a suggested time → paste the prospect's confirmation → book (creates the Google event + Meet link) |
| Update InMail credits | Overview → Outreach → Update |
| Research a competitor | `npm run cli -- competitor "Name" --market dubai --url https://...` |
| Restore a backup | Download the artifact → `BACKUP_ENCRYPTION_KEY=... SUPABASE_*=... npm run cli -- restore backup.json` (idempotent upsert) |
| Change scoring weights | Edit `config/scoring.json` (the weekly report suggests weights once you have ≥5 won and ≥5 lost scored prospects) |
| Change prices/offer | Edit `knowledge/business_brain.json` + `approved_amounts`, update `last_verified` |
| Remove a person's data | Supabase SQL: `delete from prospects where id = '…'` (cascades) |

## When something fails

1. Tracker → System Health shows open failures with the error (a failure later retried successfully disappears).
2. Actions run log has the full stack trace.
3. Typical causes: expired Google refresh token (re-issue, update secret), Supabase paused (free tier pauses after inactivity — upgrade or resume), Anthropic rate limit (the SDK retries; reduce caps in `config/revenue.json`).
