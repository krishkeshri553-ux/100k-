// Exercises api/contact.js without a server: validation, spam, not-configured and delivery paths.
import handler, { validate, isSpam } from '../api/contact.js';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const good = { name: 'Test Person', email: 'test@example.com', channel: 'youtube.com/@test', content_type: 'Educational', volume: '4', package: 'monthly-4', started_at: String(Date.now() - 60000) };

function call(body, { json = true, env = {} } = {}) {
  const old = { ...process.env };
  Object.assign(process.env, env);
  const req = Readable.from([Buffer.from(json ? JSON.stringify(body) : new URLSearchParams(body).toString())]);
  req.method = 'POST';
  req.headers = { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded', accept: json ? 'application/json' : 'text/html' };
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { process.env = old; resolve({ status: this.statusCode, headers: this.headers, body: b ? JSON.parse(b) : null }); } };
    handler(req, res);
  });
}

assert.deepEqual(validate(good).fields, {});
assert.ok(validate({ ...good, email: 'nope' }).fields.email);
assert.ok(validate({ ...good, package: 'free' }).fields.package);
assert.ok(isSpam({ ...good, company_website: 'x' }));
assert.ok(isSpam({ ...good, started_at: String(Date.now()) }));
assert.ok(!isSpam(good));

for (const k of ['RESEND_API_KEY', 'CONTACT_TO_EMAIL', 'CONTACT_FROM_EMAIL', 'CONTACT_WEBHOOK_URL']) delete process.env[k];
let r = await call({ ...good, email: '' });
assert.equal(r.status, 422); assert.ok(r.body.fields.email);
r = await call(good);
assert.equal(r.status, 503); assert.equal(r.body.error, 'not_configured');
r = await call(good, { json: false });
assert.equal(r.status, 303); assert.equal(r.headers.location, '/contact/?error=unavailable');

// Delivery: stub fetch.
const calls = [];
globalThis.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
r = await call(good, { env: { CONTACT_WEBHOOK_URL: 'https://hooks.example.com/x' } });
assert.equal(r.status, 200); assert.equal(r.body.ok, true);
assert.equal(calls[0].body.email, 'test@example.com');
r = await call(good, { json: false, env: { RESEND_API_KEY: 'k', CONTACT_TO_EMAIL: 'a@b.co', CONTACT_FROM_EMAIL: 'LE <x@longformedits.com>' } });
assert.equal(r.status, 303); assert.equal(r.headers.location, '/contact/thanks/');
assert.equal(calls[1].url, 'https://api.resend.com/emails'); assert.equal(calls[1].body.reply_to, 'test@example.com');
globalThis.fetch = async () => ({ ok: false });
r = await call(good, { env: { CONTACT_WEBHOOK_URL: 'https://hooks.example.com/x' } });
assert.equal(r.status, 502);
console.log('api/contact.js: all checks passed');
