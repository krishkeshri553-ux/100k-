# Sales Navigator — Prospect Research SOP

**Status:** usable today, user-operated. Nothing here automates LinkedIn. You search in your own browser; the system scores, researches with you, drafts, and tracks.

## 0. Audit your subscription first (10 minutes, once)

The system does **not** assume what your plan includes. Open Sales Navigator → profile menu → *Settings* → *Subscription*, and fill in `config/sales_navigator.json`:

| Field | Where to find it | Why it matters |
|---|---|---|
| `subscription_type` | Settings → Subscription (Core / Advanced / Advanced Plus) | Drives which filters the SOP below can use |
| `features.inmail` / `inmail_credits_per_month` | InMail credit counter in the Sales Navigator inbox | InMail drafts are only generated when this isn't `false`; until verified they carry an "InMail unverified" flag |
| `features.saved_searches`, `lead_lists`, `account_lists` | Left nav | Saved-search alerts are your "new prospect" feed |
| `features.buyer_intent` | Account page → *Buyer intent* tab (if present) | Only use if you actually see it |
| `features.crm_sync` | Settings → CRM | If present, lead export via CRM sync is possible; otherwise entry is manual |
| `api_access` | Only via LinkedIn's partner programme | Leave `false` unless LinkedIn has granted you API access in writing |

Then record your current InMail balance in the tracker: **Overview → Outreach → InMail credits → Update**. The balance decrements each time you mark an InMail as sent, so the number stays honest. Re-check it in Sales Navigator weekly.

Commit the updated `config/sales_navigator.json`; the tracker's System Health shows it.

## 1. Saved searches (create once, in this order)

Priority follows the business brain: **Dubai/UAE → USA → UK**. Use Boolean in the *Current job title* filter (supported in the title and keyword filters on current plans — confirm in your account).

**Title Boolean (use for every market):**
```
("real estate agent" OR realtor OR "real estate broker" OR "property consultant" OR "real estate consultant" OR "team leader" OR "agency owner" OR founder OR "managing director" OR "head of sales" OR "broker owner") NOT (intern OR student OR assistant OR recruiter)
```

| # | Name | Geography | Industry | Extra filters (only if your plan has them) |
|---|---|---|---|---|
| 1 | `HG-DXB-Leaders` | Dubai, United Arab Emirates | Real Estate | Seniority: Owner/Partner, CXO, Director, Manager · Company headcount 11–200 · *Posted on LinkedIn in past 30 days* |
| 2 | `HG-DXB-Agents-Active` | Dubai, UAE | Real Estate | *Posted on LinkedIn in past 30 days* · Years in current company 1+ |
| 3 | `HG-DXB-JobChanges` | Dubai, UAE | Real Estate | *Changed jobs in past 90 days* (new team leads/agency founders invest in brand) |
| 4 | `HG-US-Brokers` | United States (start with Miami, NYC, LA, Austin, Dallas, Phoenix) | Real Estate | Seniority: Owner/Partner, Director · Posted in past 30 days |
| 5 | `HG-UK-Agents` | United Kingdom (London, Manchester first) | Real Estate | Seniority: Owner/Partner, Director, Manager · Posted in past 30 days |
| 6 | `HG-Followers` | any | — | *Follows your company* / *Viewed your profile* (if available) — warmest signal |

Turn on saved-search alerts for 1, 2, 3 and 6.

**Account lists:** build `HG-DXB-Agencies` (brokerages with 10–200 staff). Buyer intent, if your plan shows it, is a tie-breaker — not a reason on its own.

## 2. Daily routine (≈30 minutes, after the 08:17 IST morning workflow)

1. **Tracker → Approvals.** Clear the queue first: approve / edit / reject. Copy each approved message into LinkedIn yourself, then tap **I sent it**. Only this click counts as "sent".
2. **Sales Navigator → saved-search alerts.** For each new lead worth a look (aim for 5–10 a day):
   - Open their profile **and** their recent activity.
   - Ask: *real estate business? commercial reason to invest? visible content gap?* Follower count is not buying intent.
   - Tracker → Leads → **+ Prospect**: paste the Sales Navigator/LinkedIn URL, name, title, company, location, and one line about what you saw.
   - Open the lead → **Research**: posting frequency, uses video?, latest post date, team size, budget signal, content gap. Only what you verified — unknown stays unknown. Save → score recalculates with an explanation.
   - **Prepare outreach** → drafts land in Approvals with the reason for contacting them.
3. **Replies.** When someone replies on LinkedIn, open their lead → paste the reply → *Mark replied · positive/neutral/negative*. The daytime workflow analyses it and prepares a response draft; hot prospects trigger a notification with suggested call times.
4. **Connection outcomes.** When a request is accepted, open the approved connection note → *Accepted*.

## 3. What is never done

No scraping, no browser automation, no automated connection requests/InMail/messages, no likes or comments by bots, no session cookies, no exports that Sales Navigator doesn't offer you. An approval click in the tracker never sends anything to LinkedIn.

## 4. Weekly (Sunday report)

- Compare markets and title segments in the weekly report; prune saved searches that produce low qualification rates.
- Update InMail balance.
- Note which outreach angle earned replies; the report shows reply rate by message type from your confirmed sends.
