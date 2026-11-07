# HUSTLEGROWTHZ_BUSINESS_BRAIN

The machine-readable source of truth is [`knowledge/business_brain.json`](knowledge/business_brain.json). Every AI call loads it (prompt-cached). Verbatim page snapshots live in [`knowledge/website_snapshot/`](knowledge/website_snapshot/).

- **Last verified:** 2026-11-07, by scraping the homepage and 18 routes of https://www.hustlegrowthz.com.
- **Change detection:** the `knowledge` workflow (Mondays 09:23 IST) fingerprints the key pages and notifies you if they change. It never edits claims itself — you update the JSON and the `last_verified` date.

## What the website actually says (summary)

| Topic | Verified fact | Source |
|---|---|---|
| Offer | One offer: **Authority Flywheel™** — done-for-you short-form social media: positioning, research, 30 scripts + 30 edited videos/month, publishing on Instagram, TikTok, YouTube Shorts, Facebook, ManyChat comment-to-DM automation, lead qualification, call booking, weekly tracking, private Discord | /pricing, /authority-flywheel |
| Client time | ~45–60 min/week recording from finished scripts | /faq |
| Pricing | **$999/month** (billed in advance, auto-renews) or **$5,999/year** (once, upfront; $499.92/mo effective; saves $5,989 vs $11,988). USD, excl. taxes/fees. Same service on both. | /pricing, /terms |
| Payment terms | All payments non-refundable. Monthly cancellable before next billing date. Annual is a 12-month commitment. Billing errors within 7 days. | /refund-policy, /terms |
| Guarantees | **None.** "Do you guarantee leads, clients or revenue? No, and you should be careful with anyone who does." | /faq |
| Proof | 250M+ views, 200+ clients; 6 video testimonials (Alex 180K+ followers/25M+ views; Vadym 200 leads in 60 days; Amy 1M+ views/300+ qualified leads in <2 weeks; Tracy ×2; Jamell) + 17 screenshot results; "not typical or guaranteed" | /results |
| Real estate | Dedicated page "Content that wins the listing for you" — same offer and price; agents in US, UK, Canada, Australia, Europe and the UAE | /for/real-estate-agents |
| Fit | Coaches, consultants, founders, real estate agents, podcast hosts with offers > $1,000. Not for low-ticket, shortcut-seekers, or people who won't record. | /services, /book-a-call, /faq |
| Limits | 30 videos/month (not unlimited); client records (no on-location filming); 4 platforms; no graphic-only posting or paid ads; long-form YouTube quoted separately | /authority-flywheel, /services |
| Contact | info@hustlegrowthz.com · free 30-min strategy call via Calendly | /contact, /book-a-call |

## Findings that shape how the AI sells (important)

1. **LinkedIn is not a delivered platform.** The site says LinkedIn publishing "isn't part of the standard service". The AI must never promise LinkedIn posting to a prospect. (Your *own* LinkedIn is where we prospect and where your personal content strategy runs — that's separate.)
2. **No published real-estate case studies.** Testimonials don't name industries. The AI may say "we work with real estate agents" (true per /for/real-estate-agents) but must not claim real-estate-specific results. Guardrails block such claims. **Biggest commercial gap:** your first 2–3 real-estate wins should become published, permissioned case studies.
3. **Dubai isn't named on the site** — the UAE is. Prospect copy says "the UAE".
4. **Primary site positioning is coaches/consultants.** Your ICP (Dubai real estate) is supported by a footer-linked page, not the main navigation. Consider surfacing it if real estate becomes the core market.
5. **Scrape note:** animated price counters on /pricing rendered mid-animation as negative numbers in the scraper; the static text ($999 / $5,999) is consistent across pricing, FAQ and terms. Worth a visual check in a browser.

## Owner-defined (internal, not website claims)

ICP priorities (Dubai → USA → UK), qualification criteria, objection playbook, nine sales strategies, discovery questions, brand voice rules — marked `"kind": "owner"` in the JSON. Edit freely; they are strategy, not public claims.

## Editing rules

- Change a price or term → update `pricing` / `payment_terms`, the `approved_amounts` list (the guardrail's whitelist), the source URL and `last_verified`. Tests in `tests/brain-content.test.ts` check the brain against the snapshot; re-snapshot the page when it changes.
- Add a case study → only with the client's permission and a public source URL; add its numbers to `numbers` so the guardrail allows quoting them.
