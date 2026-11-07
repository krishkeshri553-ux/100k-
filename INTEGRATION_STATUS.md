# Integration status

_Last updated: 2026-11-07. "Code-verified" = implemented and covered by automated tests with mocks. "Live-verified" = exercised against the real service with your credentials. Nothing below is live-verified yet, because no credentials were available in the build environment._

| Integration | Status | What works without it | Credential / permission needed |
|---|---|---|---|
| **Claude API** | Code-verified, not live-verified | Rules-based classification, scoring, template drafts (only when specific facts exist), rules-based sales analysis. Content ideas/drafts, competitor research and weekly narrative are **skipped and logged**, never faked. | `ANTHROPIC_API_KEY` (GitHub secret + Vercel env). Model: `claude-opus-5-5` (override with `CLAUDE_MODEL` repo variable). |
| **Supabase** | Schema verified on real Postgres (PGlite) in tests; not live-verified | Dev/test only (in-memory). **Production refuses to run without it.** | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Actions + Vercel), `SUPABASE_DB_URL` (migrations only). |
| **Google Calendar** | Code-verified (OAuth refresh, freeBusy, insert with 409 idempotency, patch) | Booking disabled; hot-lead alerts omit suggested times. | OAuth client (Desktop or Web) + refresh token with scopes `calendar.events` and `calendar.freebusy`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. See DEPLOYMENT.md §4. |
| **Notifications** (Slack/Discord webhook) | Code-verified | Everything still appears in the tracker's activity feed. | `NOTIFY_WEBHOOK_URL`. |
| **Vercel** | Config written; deploy not executed | Run the tracker locally with `npm run dev:tracker`. | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` (GitHub secrets) + env vars in the Vercel project. |
| **LinkedIn (personal profile)** | **Manual only — by design** | Drafts + approval + "I sent it" confirmation; publishing calendar with copy-ready posts; manual metrics entry. | LinkedIn does not offer self-serve API access for personal messaging, InMail or connection requests. Personal-profile posting via API (`w_member_social`) requires an approved LinkedIn app; not configured. |
| **Sales Navigator** | **Manual only — subscription not yet verified** | SOP + saved-search definitions (`docs/SALES_NAVIGATOR_SOP.md`), manual prospect entry, InMail credit tracking. | Fill `config/sales_navigator.json` from your account. SNAP/CRM sync requires LinkedIn partner approval or Advanced Plus. |
| **Image generation** | Built-in SVG renderer (works, tested) | On-brand carousels render without any external service. | Optional: plug an image model into the `ImageProvider` interface (`src/design/carousel.ts`). |
| **Competitor web research** | Code-verified (Claude web search tool, LinkedIn domain blocked, URL grounding) | Manual observations via CLI/DB. | `ANTHROPIC_API_KEY` with web search enabled for your org. |

## Explicitly not implemented (platform rules)

LinkedIn scraping, browser automation, automated connection requests/messages/InMail, automated likes/comments, session-cookie use, restriction bypasses. An approval in the tracker never sends anything to LinkedIn.
