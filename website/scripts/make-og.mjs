// Renders the default social preview (1200×630) and PNG icons with the
// preinstalled Chromium. Run after brand changes: npm run og
import { createRequire } from 'node:module';
// Uses the machine's Playwright (not a project dependency). Install it locally if missing.
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const favicon = readFileSync(new URL('public/favicon.svg', root), 'utf8');
// Fonts are inlined as data URLs (file:// URLs are blocked from about:blank).
const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(new URL(`node_modules/${pkg}/files/${file}`, root)).toString('base64')}`;

const og = `<!doctype html><html><head><style>
@font-face{font-family:IT;src:url(${font('@fontsource-variable/inter-tight', 'inter-tight-latin-wght-normal.woff2')});font-weight:100 900}
@font-face{font-family:IS;font-style:italic;src:url(${font('@fontsource/instrument-serif', 'instrument-serif-latin-400-italic.woff2')})}
@font-face{font-family:JB;src:url(${font('@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2')})}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:#f5f4ee;font-family:IT;color:#0b1a12;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:center;font-family:JB;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:#17603d}
.logo{display:flex;align-items:center;gap:14px;font-family:IT;font-weight:650;font-size:34px;letter-spacing:-.035em;text-transform:none;color:#0b1a12}
.logo em{font-family:IS;font-weight:400;font-size:1.25em;color:#17603d;letter-spacing:-.01em}
h1{font-size:96px;line-height:.93;letter-spacing:-.048em;font-weight:600;max-width:900px}
h1 em{font-family:IS;font-weight:400;color:#17603d;letter-spacing:-.02em}
.tl{display:flex;gap:4px;height:22px}.tl i{display:block;height:100%;border-radius:2px;background:#6fb68b}.tl i.g{background:#b9f27a}
.foot{display:flex;justify-content:space-between;align-items:flex-end;font-family:JB;font-size:20px;color:#3c4b42}
</style></head><body>
<div class="top"><span class="logo"><svg width="38" height="38" viewBox="0 0 28 28"><path d="M3 3h7v3H6v16h4v3H3z" fill="#0b1a12"/><path d="M25 3h-7v3h4v16h-4v3h7z" fill="#0b1a12"/><rect x="11.5" y="9" width="5" height="10" fill="#2f8a5c"/></svg>Longform <em>Edits</em></span><span>longformedits.com</span></div>
<h1>Your footage, cut into long-form videos worth <em>watching.</em></h1>
<div><div class="tl"><i style="width:170px"></i><i class="g" style="width:60px"></i><i style="width:240px"></i><i style="width:90px"></i><i style="width:200px"></i><i class="g" style="width:70px"></i><i style="width:226px"></i></div>
<div class="foot" style="margin-top:22px"><span>DONE-FOR-YOU LONG-FORM VIDEO EDITING</span></div></div>
</body></html>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(og, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: new URL('public/og/default.png', root).pathname });

for (const [size, file] of [[32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [512, 'brand/logo-mark.png']]) {
  const ip = await b.newPage({ viewport: { width: size, height: size } });
  await ip.setContent(`<style>*{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${favicon.replace('rx="7"', size === 180 ? 'rx="0"' : 'rx="7"')}`);
  await ip.screenshot({ path: new URL(`public/${file}`, root).pathname, omitBackground: true });
}
await b.close();
console.log('og + icons written');
