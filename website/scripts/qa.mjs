// Static QA over the built site (run `npm run build` first).
// Checks every page for: one <h1>, title, meta description, canonical on
// https://longformedits.com, OG tags, valid JSON-LD, no localhost URLs,
// internal links and assets that resolve, image alt text, and price consistency.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const DOMAIN = 'https://longformedits.com';
const ALLOWED_PRICES = new Set(['$129', '$449', '$849', '$112.25', '$106.13', '$150', '$500', '$900']); // plans, per-video maths, budget ranges
const errors = [];
const warn = [];

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const pages = walk(DIST).filter((f) => f.endsWith('.html'));
const titles = new Map();

const resolves = (href) => {
  const path = decodeURI(href.split('#')[0].split('?')[0]);
  if (!path || path === '/') return existsSync(join(DIST, 'index.html'));
  if (path.startsWith('/api/')) return existsSync(new URL('../api/' + path.slice(5).replace(/\/$/, '') + '.js', import.meta.url));
  const p = join(DIST, path);
  return existsSync(p) && (statSync(p).isFile() || existsSync(join(p, 'index.html')));
};

for (const file of pages) {
  if (file.endsWith('404.html')) continue; // served for any missing URL; not a canonical page
  const rel = '/' + relative(DIST, file).replace(/index\.html$/, '');
  const html = readFileSync(file, 'utf8');
  const err = (m) => errors.push(`${rel}: ${m}`);

  const h1s = html.match(/<h1[\s>]/g) || [];
  if (h1s.length !== 1) err(`expected 1 <h1>, found ${h1s.length}`);

  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (!title) err('missing <title>');
  else { if (titles.has(title)) err(`duplicate title with ${titles.get(title)}`); titles.set(title, rel); if (title.length > 70) warn.push(`${rel}: title ${title.length} chars`); }

  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  if (!desc) err('missing meta description');
  else if (desc.length < 70 || desc.length > 170) warn.push(`${rel}: description ${desc.length} chars`);

  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  if (!canonical?.startsWith(DOMAIN + '/')) err(`bad canonical ${canonical}`);
  if (!rel.startsWith('/404') && canonical !== DOMAIN + rel) err(`canonical ${canonical} ≠ ${DOMAIN + rel}`);

  for (const p of ['og:title', 'og:description', 'og:url', 'og:image']) if (!html.includes(`property="${p}"`)) err(`missing ${p}`);
  if (/localhost|127\.0\.0\.1/.test(html)) err('contains localhost URL');

  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { err('invalid JSON-LD'); }
    if (/aggregateRating|"Review"/.test(m[1])) err('JSON-LD contains ratings/reviews');
  }

  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="/.test(m[0])) err(`img without alt: ${m[0].slice(0, 80)}`);

  for (const m of html.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)) {
    const u = m[1];
    if (u.startsWith('/') && !u.startsWith('//') && !resolves(u)) err(`broken internal link ${u}`);
    if (u.startsWith(DOMAIN) && !resolves(u.slice(DOMAIN.length) || '/')) err(`broken absolute link ${u}`);
    if (u.startsWith('/') && !u.startsWith('/_astro') && !/\.[a-z0-9]+([?#]|$)/i.test(u) && !u.split(/[?#]/)[0].endsWith('/')) err(`link without trailing slash ${u}`);
  }

  // The calculator shows example outputs from the visitor's inputs, not prices.
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<section[^>]*id="calculator"[\s\S]*?<\/section>/, '');
  for (const m of text.matchAll(/\$\d[\d,]*(?:\.\d+)?/g)) if (!ALLOWED_PRICES.has(m[0])) err(`unexpected price ${m[0]}`);
  if (/lorem ipsum|TODO|FIXME/i.test(text)) err('placeholder copy found');

  if (/noindex/.test(html) && !/\/(404|contact\/thanks)\/?$|\/blog\//.test(rel)) err('unexpected noindex');
}

// Sitemap: only indexable pages, all on the domain, all present.
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  if (!m[1].startsWith(DOMAIN + '/')) errors.push(`sitemap: off-domain ${m[1]}`);
  const path = m[1].slice(DOMAIN.length);
  if (!resolves(path)) errors.push(`sitemap: missing page ${path}`);
  const html = readFileSync(join(DIST, path, 'index.html'), 'utf8');
  if (/name="robots" content="noindex/.test(html)) errors.push(`sitemap: lists noindex page ${path}`);
}
const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
if (!robots.includes(`Sitemap: ${DOMAIN}/sitemap.xml`)) errors.push('robots.txt: missing sitemap');

console.log(`Checked ${pages.length} pages.`);
warn.forEach((w) => console.log('  warn  ' + w));
if (errors.length) { errors.forEach((e) => console.log('  FAIL  ' + e)); process.exit(1); }
console.log('All static checks passed.');
