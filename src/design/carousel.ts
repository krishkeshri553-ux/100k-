/**
 * AI Design Studio — deterministic, on-brand LinkedIn carousel renderer.
 * Output is SVG (1080×1350, LinkedIn's 4:5 document/carousel size), previewable in the tracker and
 * exportable to PNG/PDF by any browser. An external image model can be plugged in via ImageProvider.
 */

export const BRAND = {
  name: "HustleGrowthz",
  colors: { bg: "#0B0B0C", surface: "#16161A", gold: "#C9A45C", goldSoft: "#E6CF9A", text: "#F5F3EE", muted: "#A29E94" },
  font: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  serif: "'Playfair Display', Georgia, serif",
  handle: "Krish Keshri · HustleGrowthz",
} as const;

export type SlideKind = "cover" | "point" | "quote" | "stat" | "cta";
export interface Slide {
  kind: SlideKind;
  title: string;
  body?: string;
  /** For "stat" slides: the number must be the prospect's/your own verified figure — never invented. */
  stat?: string;
}

export interface ImageProvider {
  readonly name: string;
  render(slides: Slide[]): Promise<{ name: string; svg?: string; url?: string }[]>;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Greedy word-wrap by approximate character width. */
export function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

function textBlock(lines: string[], x: number, y: number, size: number, opts: { color: string; weight?: number; family?: string; lh?: number }) {
  const lh = opts.lh ?? 1.25;
  return lines
    .map((l, i) => `<text x="${x}" y="${y + i * size * lh}" font-family="${opts.family ?? BRAND.font}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.color}">${esc(l)}</text>`)
    .join("");
}

export function renderSlide(slide: Slide, index: number, total: number): string {
  const W = 1080, H = 1350, P = 96;
  const c = BRAND.colors;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${c.bg}"/>`,
    `<rect x="${P}" y="${P}" width="72" height="4" fill="${c.gold}"/>`,
  ];
  if (slide.kind === "cover") {
    const t = wrap(slide.title, 18).slice(0, 5);
    parts.push(textBlock(t, P, 470, 88, { color: c.text, weight: 700, family: BRAND.serif, lh: 1.12 }));
    if (slide.body) parts.push(textBlock(wrap(slide.body, 38).slice(0, 3), P, 470 + t.length * 99 + 60, 38, { color: c.goldSoft }));
    parts.push(`<text x="${P}" y="${H - P - 40}" font-family="${BRAND.font}" font-size="28" fill="${c.muted}" letter-spacing="4">SWIPE →</text>`);
  } else if (slide.kind === "quote") {
    parts.push(`<text x="${P}" y="420" font-family="${BRAND.serif}" font-size="220" fill="${c.gold}">“</text>`);
    parts.push(textBlock(wrap(slide.title, 24).slice(0, 7), P, 560, 64, { color: c.text, weight: 600, family: BRAND.serif, lh: 1.2 }));
    if (slide.body) parts.push(textBlock(wrap(slide.body, 44).slice(0, 2), P, 1060, 32, { color: c.muted }));
  } else if (slide.kind === "stat") {
    parts.push(`<text x="${P}" y="560" font-family="${BRAND.serif}" font-size="200" font-weight="700" fill="${c.gold}">${esc(slide.stat ?? "")}</text>`);
    parts.push(textBlock(wrap(slide.title, 30).slice(0, 3), P, 680, 52, { color: c.text, weight: 600 }));
    if (slide.body) parts.push(textBlock(wrap(slide.body, 44).slice(0, 5), P, 880, 34, { color: c.muted }));
  } else if (slide.kind === "cta") {
    parts.push(`<rect x="${P}" y="380" width="${W - 2 * P}" height="560" rx="28" fill="${c.surface}" stroke="${c.gold}" stroke-width="2"/>`);
    parts.push(textBlock(wrap(slide.title, 22).slice(0, 4), P + 64, 520, 64, { color: c.text, weight: 700, family: BRAND.serif, lh: 1.15 }));
    if (slide.body) parts.push(textBlock(wrap(slide.body, 36).slice(0, 4), P + 64, 800, 36, { color: c.goldSoft }));
  } else {
    parts.push(`<text x="${P}" y="300" font-family="${BRAND.font}" font-size="30" fill="${c.gold}" letter-spacing="3">${String(index).padStart(2, "0")}</text>`);
    const t = wrap(slide.title, 22).slice(0, 4);
    parts.push(textBlock(t, P, 420, 68, { color: c.text, weight: 700, lh: 1.15 }));
    if (slide.body) parts.push(textBlock(wrap(slide.body, 40).slice(0, 9), P, 420 + t.length * 78 + 60, 38, { color: c.muted, lh: 1.4 }));
  }
  parts.push(`<text x="${P}" y="${H - P}" font-family="${BRAND.font}" font-size="26" fill="${c.muted}">${esc(BRAND.handle)}</text>`);
  parts.push(`<text x="${W - P}" y="${H - P}" text-anchor="end" font-family="${BRAND.font}" font-size="26" fill="${c.gold}">${index + 1}/${total}</text>`);
  parts.push(`</svg>`);
  return parts.join("");
}

export class SvgTemplateProvider implements ImageProvider {
  readonly name = "svg-template";
  async render(slides: Slide[]) {
    return slides.map((s, i) => ({ name: `slide-${String(i + 1).padStart(2, "0")}.svg`, svg: renderSlide(s, i, slides.length) }));
  }
}
