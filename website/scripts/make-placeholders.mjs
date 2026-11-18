// Generates lightweight, clearly-abstract SVG placeholder frames.
// They suggest a format's composition without pretending to be real footage.
// Run: node scripts/make-placeholders.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const out = new URL('../public/media/placeholders/', import.meta.url);
mkdirSync(out, { recursive: true });

const W = 1600, H = 900;
const base = (id, bg1, bg2, light, body, label, showLabel = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="g${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
<radialGradient id="l${id}" cx="${light[0]}" cy="${light[1]}" r="0.6"><stop offset="0" stop-color="${light[2]}" stop-opacity="0.55"/><stop offset="1" stop-color="${light[2]}" stop-opacity="0"/></radialGradient>
<filter id="b${id}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
<radialGradient id="v${id}" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#g${id})"/>
<rect width="${W}" height="${H}" fill="url(#l${id})"/>
<g filter="url(#b${id})">${body}</g>
<rect width="${W}" height="${H}" fill="url(#v${id})"/>
<g fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="2">
<path d="M80 130V80h50M1520 130V80h-50M80 770v50h50M1520 770v50h-50"/>
</g>
${showLabel ? `<text x="80" y="${H - 40}" font-family="ui-monospace,Menlo,monospace" font-size="22" letter-spacing="3" fill="#fff" fill-opacity="0.45">PLACEHOLDER · ${label}</text>` : ''}
</svg>`;

const frames = [
  // 01 talking head: single figure, soft key light
  ['01', '#0f2a1f', '#1d4a36', [0.72, 0.3, '#f3e6c8'],
    `<circle cx="980" cy="360" r="120" fill="#c9b79a" fill-opacity="0.55"/><path d="M760 900c20-210 120-330 220-330s200 120 220 330z" fill="#2c2a26" fill-opacity="0.8"/><rect x="180" y="220" width="320" height="420" fill="#2f6b4c" fill-opacity="0.35"/>`, 'TALKING HEAD'],
  // 02 podcast: two figures, two mics
  ['02', '#14211b', '#2a3b2f', [0.5, 0.2, '#ffd9a8'],
    `<circle cx="520" cy="380" r="95" fill="#b9a487" fill-opacity="0.5"/><path d="M340 900c15-180 95-290 180-290s165 110 180 290z" fill="#33302b" fill-opacity="0.85"/><circle cx="1080" cy="370" r="95" fill="#a8977c" fill-opacity="0.5"/><path d="M900 900c15-180 95-290 180-290s165 110 180 290z" fill="#26332c" fill-opacity="0.85"/><rect x="640" y="520" width="26" height="140" rx="13" fill="#111" fill-opacity="0.8"/><rect x="934" y="520" width="26" height="140" rx="13" fill="#111" fill-opacity="0.8"/>`, 'PODCAST'],
  // 03 documentary: horizon landscape
  ['03', '#28331f', '#0c1b14', [0.3, 0.35, '#ffcf8a'],
    `<path d="M0 560 C300 480 520 520 760 470 S1250 420 1600 500 V900 H0z" fill="#0e2017" fill-opacity="0.9"/><path d="M0 660 C400 600 800 640 1600 590 V900 H0z" fill="#07120d"/><circle cx="470" cy="330" r="70" fill="#ffd79a" fill-opacity="0.6"/>`, 'DOCUMENTARY'],
  // 04 educational: board grid + diagram
  ['04', '#173a2b', '#0f2a1f', [0.4, 0.4, '#d8f5c4'],
    `<rect x="240" y="180" width="760" height="480" fill="#e8efe4" fill-opacity="0.16"/><path d="M320 560 L480 420 L620 480 L800 300" stroke="#b9f27a" stroke-width="10" fill="none" stroke-opacity="0.7"/><circle cx="1250" cy="400" r="100" fill="#c2ae90" fill-opacity="0.45"/><path d="M1060 900c15-190 100-300 190-300s175 110 190 300z" fill="#2a2a26" fill-opacity="0.8"/>`, 'EDUCATIONAL'],
  // 05 business: bar chart
  ['05', '#0b1d15', '#163d2c', [0.65, 0.25, '#bfe8cf'],
    `<g fill="#7fc79b" fill-opacity="0.5"><rect x="360" y="520" width="110" height="200"/><rect x="530" y="440" width="110" height="280"/><rect x="700" y="380" width="110" height="340"/><rect x="870" y="300" width="110" height="420"/><rect x="1040" y="220" width="110" height="500"/></g><path d="M300 720 H1250" stroke="#fff" stroke-opacity="0.3" stroke-width="4"/>`, 'BUSINESS'],
  // 06 faceless: city lights
  ['06', '#08140f', '#1a2f26', [0.5, 0.7, '#9ee0b8'],
    `<g fill="#e9f6d0" fill-opacity="0.35"><circle cx="300" cy="500" r="22"/><circle cx="420" cy="560" r="14"/><circle cx="640" cy="470" r="30"/><circle cx="820" cy="590" r="18"/><circle cx="1000" cy="450" r="26"/><circle cx="1180" cy="540" r="16"/><circle cx="1320" cy="480" r="24"/></g><path d="M0 700 H1600 V900 H0z" fill="#050c08"/>`, 'FACELESS'],
];

for (const [id, a, b, l, body, label] of frames) {
  writeFileSync(new URL(`frame-${id}.svg`, out), base(id, a, b, l, body, label));
}
writeFileSync(new URL('showreel.svg', out), base('sr', '#0c2a1d', '#1a4a35', [0.68, 0.28, '#f4e3c0'],
  `<circle cx="1010" cy="350" r="130" fill="#c9b79a" fill-opacity="0.5"/><path d="M770 900c20-230 130-360 240-360s220 130 240 360z" fill="#262622" fill-opacity="0.85"/><rect x="150" y="200" width="360" height="460" fill="#2f6b4c" fill-opacity="0.3"/><rect x="1330" y="160" width="140" height="540" fill="#f4e3c0" fill-opacity="0.12"/>`, 'SHOWREEL', false)); // labelled in markup instead
console.log('placeholders written');
