/**
 * POST /api/contact — project enquiry handler (Vercel Node.js serverless function).
 *
 * Delivery (configure at least one in Vercel → Project → Settings → Environment Variables):
 *   A) Email via Resend (https://resend.com):
 *        RESEND_API_KEY      — API key
 *        CONTACT_TO_EMAIL    — inbox that receives enquiries
 *        CONTACT_FROM_EMAIL  — verified sender, e.g. "Longform Edits <enquiries@longformedits.com>"
 *   B) Webhook (Zapier, Make, Slack workflow, CRM, Google Sheets bridge…):
 *        CONTACT_WEBHOOK_URL — receives the validated enquiry as JSON
 *
 * If neither is configured the endpoint answers 503 and the page tells the
 * visitor plainly that nothing was sent, offering a pre-filled email instead.
 *
 * Spam protection: honeypot field, minimum fill time, strict validation and
 * length limits. For high volume, add Cloudflare Turnstile or Vercel BotID.
 */

const REQUIRED = {
  name: 'Please enter your name.',
  email: 'Please enter a valid email address.',
  channel: 'Please add your channel or website (or “Launching soon”).',
  content_type: 'Please choose the type of content.',
  volume: 'Please choose how many videos you need.',
  package: 'Please choose a package, or “Not sure yet”.',
};
const OPTIONAL = ['final_length', 'raw_length', 'budget', 'details'];
const PACKAGES = { single: 'Single Video', 'monthly-4': '4 Videos / month', 'monthly-8': '8 Videos / month', unsure: 'Not sure yet' };
const MAX = { details: 4000, default: 300 };
const MIN_FILL_MS = 3000;

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').slice(0, 20000);
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/json')) { try { return JSON.parse(raw); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

export function validate(input) {
  const data = {};
  const fields = {};
  for (const [k, msg] of Object.entries(REQUIRED)) {
    data[k] = clean(input[k], MAX.default);
    if (!data[k]) fields[k] = msg;
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) fields.email = REQUIRED.email;
  if (data.package && !PACKAGES[data.package]) fields.package = REQUIRED.package;
  for (const k of OPTIONAL) data[k] = clean(input[k], MAX[k] ?? MAX.default);
  return { data, fields };
}

export function isSpam(input, now = Date.now()) {
  if (clean(input.company_website, 200)) return true; // honeypot filled
  const started = Number(input.started_at);
  if (started && now - started < MIN_FILL_MS) return true; // filled faster than a human could
  return false;
}

function summary(d) {
  return [
    ['Name', d.name], ['Email', d.email], ['Channel / website', d.channel],
    ['Content type', d.content_type], ['Videos per month', d.volume],
    ['Final video length', d.final_length], ['Raw footage length', d.raw_length],
    ['Package', PACKAGES[d.package] || d.package], ['Budget', d.budget], ['Details', d.details],
  ].map(([k, v]) => [k, v || '—']);
}

async function deliver(d) {
  const { RESEND_API_KEY, CONTACT_TO_EMAIL, CONTACT_FROM_EMAIL, CONTACT_WEBHOOK_URL } = process.env;
  const rows = summary(d);
  const attempts = [];

  if (RESEND_API_KEY && CONTACT_TO_EMAIL && CONTACT_FROM_EMAIL) {
    attempts.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: CONTACT_FROM_EMAIL,
        to: CONTACT_TO_EMAIL.split(',').map((s) => s.trim()),
        reply_to: d.email,
        subject: `New project enquiry — ${d.name} (${PACKAGES[d.package] || d.package})`,
        text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
        html: `<table cellpadding="6" style="font-family:sans-serif;font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:#66746b;vertical-align:top"><b>${esc(k)}</b></td><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`,
      }),
    }).then((r) => r.ok));
  }
  if (CONTACT_WEBHOOK_URL) {
    attempts.push(fetch(CONTACT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'longformedits.com/contact', receivedAt: new Date().toISOString(), ...d, packageLabel: PACKAGES[d.package] }),
    }).then((r) => r.ok));
  }
  if (!attempts.length) return 'not_configured';
  const results = await Promise.allSettled(attempts);
  // Success if at least one channel accepted the enquiry.
  return results.some((r) => r.status === 'fulfilled' && r.value === true) ? 'sent' : 'failed';
}

export default async function handler(req, res) {
  const wantsJson = String(req.headers.accept || '').includes('application/json');
  const reply = (status, body, redirect) => {
    if (!wantsJson && redirect) { res.statusCode = 303; res.setHeader('Location', redirect); return res.end(); }
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };

  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reply(405, { ok: false, error: 'method_not_allowed' }); }

  const input = await readBody(req);
  // Pretend success to bots so they don't retry; nothing is delivered.
  if (isSpam(input)) return reply(200, { ok: true }, '/contact/thanks/');

  const { data, fields } = validate(input);
  if (Object.keys(fields).length) return reply(422, { ok: false, error: 'invalid', fields }, '/contact/?error=invalid');

  let outcome;
  try { outcome = await deliver(data); } catch { outcome = 'failed'; }

  if (outcome === 'sent') return reply(200, { ok: true }, '/contact/thanks/');
  if (outcome === 'not_configured') return reply(503, { ok: false, error: 'not_configured' }, '/contact/?error=unavailable');
  return reply(502, { ok: false, error: 'delivery_failed' }, '/contact/?error=unavailable');
}
