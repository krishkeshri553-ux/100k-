// Exports a built page as ONE self-contained .html file (CSS, fonts, images
// and scripts inlined) that opens straight from disk — for previews and sharing.
// Usage: npm run build && node scripts/export-html.mjs [page] [out.html]
//   page defaults to "/" ; links to other pages point at https://longformedits.com.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const DOMAIN = 'https://longformedits.com';
const page = process.argv[2] || '/';
const out = process.argv[3] || 'longformedits-home.html';

const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const dataUri = (p) => {
  const file = join(DIST, p.split(/[?#]/)[0]);
  if (!existsSync(file)) return null;
  return `data:${mime[extname(file)] || 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;
};

let html = readFileSync(join(DIST, page, 'index.html'), 'utf8');

// Stylesheets → inline <style>, keeping only Latin font subsets (others are
// unused for English text and would add ~600 KB), with fonts as data URIs.
html = html.replace(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g, (_, href) => {
  let css = readFileSync(join(DIST, href), 'utf8');
  css = css.replace(/@font-face\{[^}]*\}/g, (block) => {
    const src = block.match(/url\(([^)]+)\)/)?.[1];
    if (src && /\/_astro\//.test(src) && !/-latin-(wght|400)/.test(src)) return '';
    return block.replace(/url\((\/_astro\/[^)]+)\)/g, (_m, u) => `url(${dataUri(u) || u})`);
  });
  return `<style>${css}</style>`;
});

// Module scripts → inline.
html = html.replace(/<script type="module" src="([^"]+)"><\/script>/g, (_, src) =>
  `<script type="module">${readFileSync(join(DIST, src), 'utf8')}</script>`);

// Font preloads are redundant once fonts are inlined.
html = html.replace(/<link rel="preload"[^>]*>/g, '');

// Images, posters and icons → data URIs.
html = html.replace(/(src|poster|href)="(\/(?:media|brand|og|favicon|apple-touch)[^"]*)"/g, (m, attr, p) => {
  const uri = dataUri(p);
  return uri ? `${attr}="${uri}"` : m;
});

// Remaining site links → absolute production URLs (anchors stay on-page).
html = html.replace(/(href|action)="(\/[^"]*)"/g, (_, attr, p) => `${attr}="${DOMAIN}${p}"`);

writeFileSync(out, html);
console.log(`${out}: ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
