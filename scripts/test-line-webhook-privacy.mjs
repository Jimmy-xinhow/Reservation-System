import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const canary = 'PRIVATE_PERSON 0912345678 private@example.invalid SECRET_TOKEN';
function load(path, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, Response, URL, URLSearchParams, Date,
    require: name => deps[name] ?? {},
  });
  return exports;
}
function harness({ fault, signature = true, duplicate = false, persistenceFailure = false } = {}) {
  const updates = [], replies = [], claims = [], builds = [];
  function query(table) {
    let update, filters = [];
    const q = new Proxy({}, { get: (_, key) => key === 'then' ? (resolve, reject) => {
      if (update) updates.push({ table, update, filters });
      const data = table === 'clinics' ? { id: 'brand', slug: 'brand', name: 'Fixture' } : table === 'clinic_settings' ? {} : null;
      return Promise.resolve({ data, error: update && persistenceFailure ? { message: canary } : null }).then(resolve, reject);
    } : (...args) => {
      if (key === 'update') update = args[0];
      if (key === 'eq') filters.push(args);
      return q;
    } });
    return q;
  }
  const service = { from: query, rpc: async (name, args) => {
    claims.push({ name, args });
    return { data: !duplicate, error: null };
  } };
  const deps = {
    './error-category': load('lib/error-category.ts', {}),
    '@/lib/supabase': { createServiceClient: () => service },
    '@/lib/line': {
      lineCredentialsForDestination: async () => ({ channelSecret: 'fixture', accessToken: 'fixture' }),
      verifyLineSignature: () => signature,
      replyMessages: async (token, messages) => {
        replies.push({ token, messages });
        if (fault === 'provider' && messages[0].type === 'flex') throw Error(canary);
        if (fault === 'all-delivery') throw Error(canary);
      },
    },
    '@/lib/line-channel': { getClinicLineChannelContext: async () => ({ enabled: true, liffId: null }) },
    '@/lib/public-origin': { publicRequestOrigin: x => x },
    '@/lib/line-webhook-messages': { buildMessageById: async (...args) => {
      builds.push(args.slice(1));
      if (fault === 'build' || (fault === 'first-build' && builds.length === 1)) throw Error(canary);
      return fault === 'missing' ? null : { type: 'flex', altText: 'Fixture', contents: {} };
    } },
    '@/lib/line-customer-journeys': { replyBookingServices: async () => { throw Error(canary); } },
  };
  deps['@/lib/line-session'] = load(process.env.LINE_SESSION_SOURCE ?? 'lib/line-session.ts', deps);
  deps['@/lib/line-webhook-reply'] = load('lib/line-webhook-reply.ts', deps);
  const route = load(process.env.LINE_WEBHOOK_SOURCE ?? 'app/api/line/webhook/route.ts', deps);
  const event = (id = 'event', action = 'msg') => ({ type: 'postback', webhookEventId: id, replyToken: 'reply-' + id, source: { userId: 'user' }, postback: { data: 'action=' + action + '&id=material' } });
  return { updates, replies, builds, claims, service, session: deps['@/lib/line-session'], event,
    run: (events = [event()]) => route.POST({ text: async () => JSON.stringify({ destination: 'destination', events }), headers: new Headers({ 'x-line-signature': 'fixture' }), nextUrl: new URL('https://example.invalid') }),
  };
}
function privateFree(value) {
  for (const part of canary.split(' ')) assert.ok(!JSON.stringify(value).includes(part), part);
}
for (const fault of ['build', 'provider', 'all-delivery']) test('material ' + fault + ' failure is private and recorded failed', async () => {
  const h = harness({ fault });
  assert.equal((await h.run()).status, 200);
  assert.equal(h.builds.length, 1);
  assert.equal(h.updates.length, 1);
  assert.equal(h.updates[0].update.status, 'failed');
  assert.equal(h.updates[0].update.error, 'webhook_error:internal');
  assert.equal(h.updates[0].update.processed_at, null);
  assert.deepEqual(h.updates[0].filters, [['clinic_id', 'brand'], ['event_id', 'event']]);
  privateFree([h.replies, h.updates]);
});
test('another journey failure uses the same protected persistence', async () => {
  const h = harness(); await h.run([h.event('booking', 'booking')]);
  assert.equal(h.updates[0].update.status, 'failed'); privateFree([h.replies, h.updates]);
});
test('failed event does not stop the next event or falsely mark it failed', async () => {
  const h = harness({ fault: 'first-build' }); await h.run([h.event('one'), h.event('two')]);
  assert.deepEqual(h.updates.map(x => x.update.status), ['failed', 'processed']);
  privateFree([h.replies, h.updates]);
});
for (const fault of [undefined, 'missing']) test('normal material result remains processed: ' + fault, async () => {
  const h = harness({ fault }); assert.equal((await h.run()).status, 200);
  assert.equal(h.updates[0].update.status, 'processed'); assert.equal(h.updates[0].update.error, null);
  assert.ok(h.updates[0].update.processed_at); assert.equal(h.replies.length, 1);
});
test('duplicate event causes no reply or state update', async () => {
  const h = harness({ duplicate: true }); await h.run();
  assert.equal(h.claims.length, 1); assert.equal(h.builds.length + h.replies.length + h.updates.length, 0);
});
test('invalid signature performs no event work', async () => {
  const h = harness({ signature: false }); assert.equal((await h.run()).status, 401);
  assert.equal(h.claims.length + h.builds.length + h.updates.length + h.replies.length, 0);
});
test('failure persistence rejection does not expose raw errors or abort batch', async () => {
  const h = harness({ fault: 'build', persistenceFailure: true });
  assert.equal((await h.run([h.event('one'), h.event('two')])).status, 200);
  assert.equal(h.updates.length, 2); privateFree([h.replies, h.updates]);
});
for (const [error, category] of [[Error(canary), 'internal'], [canary, 'internal'], [{ message: canary }, 'internal'], [Error('fetch failed ' + canary), 'connection'], [Error('duplicate key ' + canary), 'database'], [Error('未設定 ' + canary), 'configuration'], ['', 'internal'], [false, 'internal'], [0, 'internal']]) {
  test('persist only a category for ' + typeof error + ' / ' + category + ' / ' + String(error).length, async () => {
    const h = harness(); await h.session.finishLineWebhookEvent(h.service, 'brand', ' event ', error);
    assert.equal(h.updates[0].update.error, 'webhook_error:' + category);
    assert.equal(h.updates[0].update.status, 'failed'); privateFree(h.updates);
  });
}
test('events without an ID do not create unscoped updates', async () => {
  const h = harness(); await h.session.finishLineWebhookEvent(h.service, 'brand', undefined, Error(canary));
  assert.equal(h.updates.length, 0);
});
