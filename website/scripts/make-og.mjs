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
@font-face{font-family:IT;src:url(${font('@fontsource-variable/montserrat', 'montserrat-latin-wght-normal.woff2')});font-weight:100 900}
@font-face{font-family:IS;font-style:italic;src:url(${font('@fontsource/instrument-serif', 'instrument-serif-latin-400-italic.woff2')})}
@font-face{font-family:JB;src:url(${font('@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2')})}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:radial-gradient(60% 70% at 78% 40%,rgba(47,209,128,.28),transparent 70%),#030806;font-family:IT;color:#f3f7f4;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}
.top{display:flex;justify-content:space-between;align-items:center;font-family:JB;font-size:20px;letter-spacing:.08em;text-transform:uppercase;color:#2fd180}
.logo{display:flex;align-items:center;gap:14px;font-family:IT;font-weight:800;font-size:32px;letter-spacing:-.04em;text-transform:none;color:#f3f7f4}
.logo em{font-style:normal;color:#2fd180}
h1{font-size:104px;line-height:.95;letter-spacing:-.045em;font-weight:800;max-width:1000px}
h1 em{font-family:IS;font-weight:400;color:#2fd180;letter-spacing:-.02em}
.tl{display:flex;gap:4px;height:22px}.tl i{display:block;height:100%;border-radius:3px;background:#3f8f68}.tl i.g{background:#2fd180;box-shadow:0 0 16px #2fd180}
.foot{display:flex;justify-content:space-between;align-items:flex-end;font-family:JB;font-size:18px;letter-spacing:.12em;color:#a6b4ac}
</style></head><body>
<div class="top"><span class="logo"><span style="width:46px;height:46px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(160deg,#5fe3a0,#149a5a);box-shadow:0 0 24px rgba(47,209,128,.6)"><svg width="30" height="30" viewBox="0 0 28 28"><path d="M5 5h6v2.6H7.6v12.8H11V23H5z" fill="#021209"/><path d="M23 5h-6v2.6h3.4v12.8H17V23h6z" fill="#021209"/><rect x="12.2" y="10" width="3.6" height="8" rx=".6" fill="#021209"/></svg></span>Longform<em>Edits</em></span><span>longformedits.com</span></div>
<h1>Long videos. <em>Edited</em> to be watched.</h1>
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
