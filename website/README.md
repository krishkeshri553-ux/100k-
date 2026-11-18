# Longform Edits — website

Marketing site for **Longform Edits**, a done-for-you long-form video editing service.
Production domain: **https://longformedits.com**

Static [Astro](https://astro.build) site + one serverless function (`api/contact.js`) for the project enquiry form.
No client-side framework; ~2 KB of site-wide JavaScript.

```bash
cd website
npm ci
npm run dev        # http://localhost:4321
npm run build      # outputs dist/
npm run preview    # serve dist/
```

## Where things live

| What | File |
|---|---|
| Brand name, domain, email, nav, CTA wording, draft visibility | `src/config/site.ts` |
| **All prices and package contents** (one place — used by cards, FAQ, schema, form, blog) | `src/config/pricing.ts` |
| Portfolio items + hero showreel | `src/data/portfolio.ts` |
| Formats, capabilities, differentiators, process steps | `src/data/services.ts` |
| FAQ | `src/data/faq.ts` |
| Contact form options | `src/data/contact.ts` |
| Blog categories, authors, topic backlog | `src/config/blog.ts` |
| Blog articles (Markdown) | `src/content/blog/*.md` |
| Design tokens (colour, type, spacing, motion) | `src/styles/global.css` (top of file) |
| SEO head, Open Graph, JSON-LD | `src/components/Seo.astro`, `src/lib/schema.ts` |
| Sitemap / robots | `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts` |
| Contact form handler | `api/contact.js` |

## Adding real portfolio work

Until a project has `placeholder: false`, the homepage and `/work/` show a single "Our edits are being added here — ask for samples" panel instead of stand-in footage. Adding the first real project switches both to the video layout automatically.

1. Add files to `public/media/portfolio/<slug>/`:
   - `poster.jpg` — 1600×900, under ~200 KB (required)
   - `preview.mp4` — 6–10 s muted loop, 720p, under ~2 MB (optional; plays on hover, only downloads on hover)
   - either `full.mp4` or a YouTube/Vimeo embed URL (embeds load only when clicked)
2. Edit the entry in `src/data/portfolio.ts`: set `title`, `description`, `poster`, `preview`, `video` or `embed`, `runtime`, and `placeholder: false`.
3. Only set `client` with the client's written approval.
4. Category filters on `/work/` switch on automatically once there are 6 real projects (`MIN_ITEMS_FOR_FILTERS`).

**Showreel:** put a muted MP4 (under ~6 MB, ideally also WebM) in `public/media/showreel/` and set `showreel.src` (and `placeholder: false`) in `src/data/portfolio.ts`. It plays in the hero monitor only while on screen and never with reduced motion.

**Logo:** replace the markup in `src/components/Logo.astro` and `public/favicon.svg`, then run `npm run og` to regenerate the social preview and PNG icons.

## Blog

Articles are Markdown with validated frontmatter (`src/content.config.ts`). Three articles are written and marked `draft: true`:

- How to Hire a YouTube Video Editor
- How Much Does Long-Form YouTube Editing Cost?
- How to Improve Audience Retention in Long YouTube Videos

Drafts appear only in `npm run dev` (with a "Draft — under review" banner) so you can review them. Production builds leave them out, and the **Blog** link, footer topics and category pages stay hidden until at least one article is published. **To publish:** review the article and set `draft: false`.

Prices in articles use tokens — `{{price:single}}`, `{{price:monthly-4}}`, `{{price:monthly-8}}`, `{{firstDraft}}`, `{{finalLength}}`, `{{rawFootage}}` — so they always match the pricing config. An unknown token fails the build.

Planned topics not yet written are listed in `backlog` in `src/config/blog.ts`.

## Contact form — what remains to connect

The form validates in the browser and on the server, includes a honeypot and a minimum-fill-time check, and works without JavaScript. **It does not deliver anywhere until you set environment variables** (see `.env.example`):

- **Email (Resend):** `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` (verify `longformedits.com` in Resend first), and/or
- **Webhook:** `CONTACT_WEBHOOK_URL` (Zapier, Make, Slack, a CRM…).

Until then the endpoint returns `503` and the page tells the visitor plainly that nothing was sent, offering a pre-filled email to `site.email` instead. It never shows "sent" unless delivery succeeded.

`npm run dev` has no `/api` route, so locally the form always shows that failure state. Use `vercel dev` to run the function locally.

## Deploying to longformedits.com (Vercel)

1. In Vercel, **Add New → Project**, import this repository and set **Root Directory** to `website`. Framework preset: Astro (picked up from `vercel.json`).
2. Add the contact form environment variables (above) for Production.
3. Deploy, then **Settings → Domains → add `longformedits.com`** and `www.longformedits.com`. Vercel shows the DNS records to create at your registrar (typically an `A` record for the apex and a `CNAME` for `www`). `vercel.json` redirects `www` to the apex.
4. After DNS resolves, submit `https://longformedits.com/sitemap.xml` in Google Search Console.

Any static host works for the site itself (Netlify, Cloudflare Pages); only `api/contact.js` is Vercel-specific and would need porting.

## Quality checks

```bash
npm run typecheck                        # astro check (TypeScript + templates)
npm run build && npm run check:site      # static SEO/link/price checks over dist/
npm run preview &                        # then, with Playwright available:
node scripts/qa-browser.mjs              # 14 pages × 6 viewports, menu, reduced motion, form
node scripts/test-api.mjs                # contact handler: validation, spam, delivery paths
node scripts/perf.mjs                    # FCP / LCP / CLS / page weight on a throttled connection
```

Last measured (throttled ~1.6 Mbps, 4× CPU on mobile): about 120–130 KB and 6–8 requests per page, LCP 0.6–2.0 s, CLS ≤ 0.06. Only Chromium has been tested; check Safari and Firefox before launch.

## Before launch

- [ ] Confirm `hello@longformedits.com` exists (or change `site.email`)
- [ ] Set `legalName` and any social links in `src/config/site.ts`
- [ ] Connect contact form delivery (env vars) and send a real test enquiry
- [ ] Replace portfolio placeholders and the showreel with real work
- [ ] Review the FAQ answer marked `confirm: true` (raw footage limits on monthly plans)
- [ ] Review and publish (or hide) the draft articles
- [ ] Have `/privacy/` reviewed for the regions you serve, and update it if you add analytics or other tools
- [ ] Test in Safari (iOS and macOS) and Firefox
- [ ] Choose an analytics tool if you want to measure enquiries (none is installed; update the privacy page if you add one)
