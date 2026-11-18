// Rough performance check with Playwright (no Lighthouse needed): transfer
// size, request count, LCP and CLS on a throttled "fast 3G-ish" connection.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4321';
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/', '/pricing/', '/contact/'];

const b = await chromium.launch();
for (const path of paths) {
  for (const mobile of [false, true]) {
    const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    if (mobile) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    let bytes = 0, reqs = 0;
    cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; reqs++; });
    await p.addInitScript(() => {
      window.__lcp = 0; window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
    });
    await p.goto(BASE + path, { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    const { lcp, cls, fcp } = await p.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime }));
    console.log(`${path.padEnd(10)} ${mobile ? 'mobile ' : 'desktop'}  FCP ${Math.round(fcp)}ms  LCP ${Math.round(lcp)}ms  CLS ${cls.toFixed(3)}  ${reqs} requests  ${(bytes / 1024).toFixed(0)} KB`);
    await ctx.close();
  }
}
await b.close();
