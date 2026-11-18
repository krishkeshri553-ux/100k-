// Browser QA against a running preview (npm run build && npm run preview).
// For every page × viewport: horizontal overflow, console/page errors,
// broken images, overlapping header. Also exercises the mobile menu,
// reduced-motion mode and the contact form's validation + honest failure state.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:4321';
// Every page in the sitemap, plus pages deliberately left out of it.
const sitemap = await (await fetch(BASE + '/sitemap.xml')).text();
const pages = [...new Set([
  ...[...sitemap.matchAll(/<loc>https:\/\/longformedits\.com([^<]*)<\/loc>/g)].map((m) => m[1]),
  '/blog/', '/contact/thanks/', '/nope/',
])];
const widths = [320, 375, 768, 1024, 1440, 1920];
const fails = [];

const b = await chromium.launch();
for (const w of widths) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  for (const path of pages) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', (m) => m.type() === 'error' && !/404 \(Not Found\)/.test(m.text()) && errs.push(m.text()));
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto(BASE + path, { waitUntil: 'networkidle' });
    const r = await p.evaluate(async () => {
      document.documentElement.style.scrollBehavior = 'auto';
      for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 20)); }
      await new Promise((r) => setTimeout(r, 400));
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const wide = [...document.querySelectorAll('body *')].filter((el) => { const b = el.getBoundingClientRect(); return b.right > window.innerWidth + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.fcta__strip, .ftr__wordmark, .cmp-wrap, .cf__hp'); }).slice(0, 3).map((el) => el.className || el.tagName);
      const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src);
      const hidden = [...document.querySelectorAll('[data-reveal]')].filter((el) => !el.classList.contains('is-in')).length;
      return { overflow, wide, broken, hidden };
    });
    const tag = `${w}px ${path}`;
    if (r.overflow > 0) fails.push(`${tag}: horizontal overflow ${r.overflow}px (${r.wide.join(', ')})`);
    if (r.broken.length) fails.push(`${tag}: broken images ${r.broken.join(', ')}`);
    if (r.hidden) fails.push(`${tag}: ${r.hidden} reveal elements never shown`);
    if (errs.length) fails.push(`${tag}: console errors ${errs.join(' | ')}`);
    await p.close();
  }
  await ctx.close();
}

// Mobile menu
{
  const p = await b.newPage({ viewport: { width: 375, height: 800 } });
  await p.goto(BASE + '/');
  await p.click('[data-nav-toggle]');
  await p.waitForTimeout(500);
  if ((await p.getAttribute('[data-nav-toggle]', 'aria-expanded')) !== 'true') fails.push('mobile menu: did not open');
  if (!(await p.isVisible('#mobile-nav a[href="/pricing/"]'))) fails.push('mobile menu: links not visible');
  await p.click('#mobile-nav a[href="/pricing/"]');
  await p.waitForURL('**/pricing/');
  await p.keyboard.press('Escape');
  await p.close();
}

// Reduced motion: content visible without animation
{
  const ctx = await b.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + '/');
  const op = await p.evaluate(() => getComputedStyle(document.querySelector('[data-reveal]')).opacity);
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('.tl__head')).animationName);
  if (op !== '1') fails.push(`reduced motion: reveal opacity ${op}`);
  if (anim !== 'none') fails.push(`reduced motion: playhead still animating (${anim})`);
  await ctx.close();
}

// Contact form: validation, preselect, and honest failure when the API is unavailable
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(BASE + '/contact/?package=monthly-8');
  if (!(await p.isChecked('input[name="package"][value="monthly-8"]'))) fails.push('form: ?package preselect failed');
  await p.click('[data-submit]');
  const errCount = await p.$$eval('[data-err]', (els) => els.filter((e) => e.textContent.trim()).length);
  if (errCount < 5) fails.push(`form: expected validation errors, got ${errCount}`);
  await p.fill('#name', 'QA Tester'); await p.fill('#email', 'qa@example.com'); await p.fill('#channel', 'youtube.com/@qa');
  await p.selectOption('#content_type', { index: 1 }); await p.selectOption('#volume', { index: 1 });
  await p.waitForTimeout(3100);
  await p.click('[data-submit]');
  await p.waitForSelector('[data-status]:not([hidden])', { timeout: 5000 }).catch(() => {});
  const status = await p.textContent('[data-status]').catch(() => '');
  const success = await p.$('.cf__ok');
  // The static preview has no /api, so the page must say nothing was sent.
  if (success) fails.push('form: showed success without a working backend');
  if (!/could not be sent/.test(status || '')) fails.push(`form: missing honest failure message (${status})`);
  if (!(await p.$('[data-status] a[href^="mailto:"]'))) fails.push('form: missing mailto fallback');
  await p.close();
}

await b.close();
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log(`Browser QA passed: ${pages.length} pages × ${widths.length} viewports, menu, reduced motion, form.`);
