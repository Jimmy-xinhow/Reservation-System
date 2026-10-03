import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('actions.ts', readFileSync(new URL('../app/admin/channels/actions.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['matchingEmailProof', 'emailRevision', 'recentEmailRuns', 'sendChannelEmailTestAction', 'confirmChannelEmailReceiptAction'];
const bodies = names.map(name => {
  const node = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert(node, name);
  return node.getText(source).replace(/^export /, '');
}).join('\n');
const output = ts.transpileModule(`export function factory(deps) { const { requireAdmin, createServiceClient, emailConfigForClinic, sendEmail, revalidatePath, redirect, errorCategory, console } = deps; ${bodies} return { sendChannelEmailTestAction, confirmChannelEmailReceiptAction }; }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { factory } = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));

function fixture() {
  const rows = [];
  const sent = [];
  const tenant = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  let user = { id: '11111111-2222-4333-8444-555555555555', email: 'admin@example.invalid' };
  let revision = '2026-10-03T10:00:00Z';
  let enabled = true;
  let authorized = true;
  const refId = '66666666-7777-4888-8999-000000000000';
  const service = { from(table) {
    const filters = [];
    let lowerBound = '';
    const query = {
      select: () => query,
      eq: (field, value) => { filters.push([field, value]); return query; },
      gte: (_field, value) => { lowerBound = value; return query; },
      order: () => query,
      limit: () => query,
      single: async () => ({ data: table === 'clinic_settings' ? { email_enabled: enabled } : null, error: null }),
      maybeSingle: async () => ({ data: table === 'clinic_email_secret_refs' ? { api_key_secret_id: refId, updated_at: revision } : null, error: null }),
      insert: async row => { assert.equal(table, 'channel_test_runs'); assert.equal(row.clinic_id, tenant); rows.unshift({ ...row, created_at: new Date().toISOString() }); return { error: null }; },
      then: (resolve, reject) => Promise.resolve({ data: rows.filter(row => filters.every(([field, value]) => row[field] === value) && row.created_at >= lowerBound), error: null }).then(resolve, reject),
    };
    return query;
  } };
  const actions = factory({
    requireAdmin: async () => { if (!authorized) throw Error('ACCESS_DENIED'); return { clinicId: tenant, user }; },
    createServiceClient: () => service,
    emailConfigForClinic: async () => ({ apiKey: 'private-api-key', from: 'Test <booking@example.invalid>' }),
    sendEmail: async (_cfg, to, subject, body, options) => { sent.push({ to, subject, body, idempotencyKey: options.idempotencyKey }); return '12345678-abcd-4abc-8abc-123456789abc'; },
    revalidatePath: () => {},
    redirect: url => { throw Error(`NEXT_REDIRECT ${url}`); },
    errorCategory: () => 'internal',
    console: { error: () => {} },
  });
  return { actions, rows, sent, setUser: value => { user = value; }, setRevision: value => { revision = value; }, setEnabled: value => { enabled = value; }, setAuthorized: value => { authorized = value; } };
}

test('only the signed-in brand manager receives one test email, then attests its accepted receipt', async () => {
  const f = fixture();
  await assert.rejects(f.actions.sendChannelEmailTestAction(), /NEXT_REDIRECT .*email_test=sent/);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].to, 'admin@example.invalid');
  assert.ok(!JSON.stringify(f.rows).includes('private-api-key'));
  assert.equal(f.rows[0].status, 'warning');
  assert.equal(f.rows[0].checks[0].kind, 'email_test_sent');
  await assert.rejects(f.actions.sendChannelEmailTestAction(), /NEXT_REDIRECT .*email_test=sent/);
  assert.equal(f.sent.length, 1);
  await assert.rejects(f.actions.confirmChannelEmailReceiptAction(), /NEXT_REDIRECT .*email_test=confirmed/);
  assert.equal(f.rows[0].status, 'passed');
  assert.equal(f.rows[0].checks[0].kind, 'email_test_receipt_confirmed');
  assert.equal(f.rows[0].checks[0].receiptId, f.rows[1].checks[0].receiptId);
});

test('a different manager and a rotated credential cannot claim the test receipt', async () => {
  const f = fixture();
  await assert.rejects(f.actions.sendChannelEmailTestAction(), /NEXT_REDIRECT/);
  f.setUser({ id: '22222222-3333-4444-8555-666666666666', email: 'other@example.invalid' });
  await assert.rejects(f.actions.confirmChannelEmailReceiptAction(), /找不到目前憑證、本人寄出的近期測試信/);
  f.setUser({ id: '11111111-2222-4333-8444-555555555555', email: 'admin@example.invalid' });
  f.setRevision('2026-10-03T11:00:00Z');
  await assert.rejects(f.actions.confirmChannelEmailReceiptAction(), /找不到目前憑證、本人寄出的近期測試信/);
  assert.equal(f.rows.length, 1);
});

test('disabled Email and denied role never send or attest', async () => {
  const f = fixture();
  f.setEnabled(false);
  await assert.rejects(f.actions.sendChannelEmailTestAction(), /請先啟用品牌 Email 通知/);
  assert.equal(f.sent.length, 0);
  f.setEnabled(true);
  f.setAuthorized(false);
  await assert.rejects(f.actions.sendChannelEmailTestAction(), /ACCESS_DENIED/);
  await assert.rejects(f.actions.confirmChannelEmailReceiptAction(), /ACCESS_DENIED/);
  assert.equal(f.rows.length, 0);
});
