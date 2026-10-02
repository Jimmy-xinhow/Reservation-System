import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const canary = 'PRIVATE_PERSON 0912345678 private@example.invalid SECRET_TOKEN';
function load(file, deps, logs) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, { exports, Error, Response, Headers, URL, URLSearchParams, Buffer,
    process: { env: { LINE_CHANNEL_SECRET: 'legacy-secret' } },
    console: { error: (...args) => logs.push(args) },
    require: name => name === 'node:crypto' ? crypto : name === 'next/server' ? { NextResponse: { json: Response.json } } : deps[name] ?? {},
  });
  return exports;
}
function harness({ stage, mode = 'returned', missingBrand = false, missingSettings = false, disabled = false, missingSecret = false, missingToken = false } = {}) {
  const logs = [], calls = [], replies = [];
  const failAt = name => { calls.push(name); if (stage === name) throw Error(canary); };
  function query(table) {
    const q = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve, reject) => {
      calls.push(table);
      if (stage === table) return (mode === 'thrown' ? Promise.reject(Error(canary)) : Promise.resolve({ data: null, error: { message: canary, details: canary } })).then(resolve, reject);
      const data = table === 'clinics' ? (missingBrand ? null : { id: 'brand', slug: 'fixture' }) : table === 'clinic_settings' ? (missingSettings ? null : {}) : [];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    } : (...args) => { if (key === 'eq') calls.push([table, ...args]); return q; } });
    return q;
  }
  const deps = { './error-category': load('lib/error-category.ts', {}, logs) };
  const line = load('lib/line.ts', deps, logs);
  Object.assign(deps, {
    '@/lib/http': load('lib/http.ts', deps, logs),
    '@/lib/supabase': { CLINIC_ID: 'legacy-brand', createServiceClient: () => { failAt('service'); return { from: query }; } },
    '@/lib/line': {
      verifyLineSignature: line.verifyLineSignature,
      lineCredentialsForDestination: async () => { failAt('credentials'); return { channelSecret: missingSecret ? undefined : 'test-secret', accessToken: missingToken ? undefined : 'test-token' }; },
    },
    '@/lib/line-channel': { getClinicLineChannelContext: async () => { failAt('context'); return { enabled: !disabled, liffId: null }; } },
    '@/lib/public-origin': { publicRequestOrigin: x => { failAt('origin'); return x; } },
    '@/lib/line-session': { claimLineWebhookEvent: async () => { failAt('claim'); return true; }, finishLineWebhookEvent: async () => { failAt('finish'); } },
    '@/lib/line-webhook-reply': { safeReply: async (...args) => replies.push(args) },
  });
  const route = load(process.env.LINE_INGRESS_SOURCE ?? 'app/api/line/webhook/route.ts', deps, logs);
  return { logs, calls, replies, run: (body = { destination: 'destination', events: [] }, { raw = JSON.stringify(body), secret = 'test-secret', noSignature = false, readFailure = false, signedRaw = raw } = {}) => route.POST({
    text: async () => { if (readFailure) throw Error(canary); return raw; },
    headers: new Headers(noSignature ? {} : { 'x-line-signature': crypto.createHmac('sha256', secret).update(signedRaw).digest('base64') }),
    nextUrl: new URL('https://example.invalid'),
  }) };
}
function privateFree(value) { for (const token of canary.split(' ')) assert.ok(!JSON.stringify(value).includes(token), token); }
const invalid = [null, [], 1, true, 'text', { destination: 1 }, { destination: null }, { events: {} }, { events: null }, { events: [null] }, { events: [[]] }, { events: [{}] }, { events: [{ type: 1 }] }, { events: [{ type: '' }] }];
for (const [field, value] of [['replyToken', 1], ['webhookEventId', {}], ['source', null], ['source', { userId: 1 }], ['message', { text: [] }], ['postback', { data: {} }], ['postback', { params: [] }], ['postback', { params: { date: 1 } }], ['link', { nonce: false }]]) invalid.push({ events: [{ type: 'postback', [field]: value }] });
for (const [i, body] of invalid.entries()) test('reject malformed payload before service creation ' + i, async () => {
  const h = harness(); const r = await h.run(body); assert.equal(r.status, 400); assert.equal(await r.text(), 'bad request'); assert.equal(h.calls.length + h.replies.length + h.logs.length, 0);
});
for (const options of [{ raw: '{' }, { readFailure: true }]) test('bad JSON or request body read failure: ' + JSON.stringify(options), async () => {
  const h = harness(); assert.equal((await h.run(undefined, options)).status, 400); assert.equal(h.calls.length, 0); privateFree(h.logs);
});
for (const stage of ['service', 'credentials', 'context', 'origin']) test(stage + ' exception is safe 503 before events', async () => {
  const h = harness({ stage }); const r = await h.run(); assert.equal(r.status, 503); const body = await r.json(); assert.ok(body.error_id); assert.equal(h.logs[0][1].errorId, body.error_id); privateFree([body, h.logs]); assert.ok(!h.calls.includes('claim'));
});
for (const stage of ['clinics', 'line_auto_replies', 'clinic_settings']) for (const mode of ['returned', 'thrown']) test(stage + ' ' + mode + ' failure never processes events with defaults', async () => {
  const h = harness({ stage, mode }); const r = await h.run({ destination: 'destination', events: [{ type: 'postback', replyToken: 'reply', postback: { data: 'action=unknown' } }] });
  assert.equal(r.status, 503); privateFree([await r.json(), h.logs]); assert.ok(!h.calls.includes('claim')); assert.equal(h.replies.length, 0);
});
test('missing reply settings fail closed', async () => { const h = harness({ missingSettings: true }); assert.equal((await h.run()).status, 503); assert.ok(!h.calls.includes('claim')); });
test('unknown destination never falls back to legacy brand', async () => { const h = harness({ missingBrand: true }); assert.equal((await h.run()).status, 404); assert.ok(!h.calls.includes('context')); });
test('inactive or missing legacy brand never proceeds using environment ID', async () => { const h = harness({ missingBrand: true }); assert.equal((await h.run({ events: [] })).status, 500); assert.ok(!h.calls.includes('context')); });
test('active legacy brand remains compatible', async () => { const h = harness(); assert.equal((await h.run({ events: [] })).status, 200); assert.ok(h.calls.some(x => Array.isArray(x) && x[0] === 'clinics' && x[1] === 'id' && x[2] === 'legacy-brand')); });
test('disabled brand is rejected', async () => { const h = harness({ disabled: true }); assert.equal((await h.run()).status, 404); assert.ok(!h.calls.includes('claim')); });
test('missing secret cannot use global legacy secret', async () => { const h = harness({ missingSecret: true }); assert.equal((await h.run(undefined, { secret: 'legacy-secret' })).status, 503); assert.ok(!h.calls.includes('clinics')); });
test('missing access token is rejected', async () => { const h = harness({ missingToken: true }); assert.equal((await h.run()).status, 503); assert.ok(!h.calls.includes('clinics')); });
test('missing signature performs no DB or secret lookup', async () => { const h = harness(); assert.equal((await h.run(undefined, { noSignature: true })).status, 401); assert.equal(h.calls.length, 0); });
test('wrong signature prevents all brand and event queries', async () => { const h = harness(); assert.equal((await h.run(undefined, { secret: 'wrong' })).status, 401); assert.ok(!h.calls.includes('clinics')); });
test('signature is checked against unmodified raw bytes', async () => { const h = harness(); const body = { destination: 'destination', events: [] }; assert.equal((await h.run(body, { raw: JSON.stringify(body, null, 2) })).status, 200); assert.equal((await h.run(body, { signedRaw: JSON.stringify(body, null, 2) })).status, 401); });
test('verification request and additional provider fields stay accepted', async () => { const h = harness(); assert.equal((await h.run({ destination: 'destination', events: [], extra: {} })).status, 200); assert.ok(!h.calls.includes('claim')); });
test('one malformed later event prevents partial batch execution', async () => { const h = harness(); assert.equal((await h.run({ destination: 'destination', events: [{ type: 'postback', replyToken: 'reply', postback: { data: 'action=unknown' } }, null] })).status, 400); assert.equal(h.calls.length + h.replies.length, 0); });
