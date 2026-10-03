import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function extract(path, name, deps = {}) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert(declaration, name);
  const body = `export function factory(deps) { const {${Object.keys(deps).join(',')}}=deps; ${declaration.getText(source).replace(/^export /, '')}; return ${name}; }`;
  const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return (await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)).factory(deps);
}

const id = '3ea8370b-9624-4b46-90cc-6ca10031dd65';
const notice = { clinic_id: 'brand', appointment_id: 'appointment', kind: 'pending', status: 'failed',
  sent_at: null, provider_message_id: null, reviewed_at: null };
const appointment = { id: 'appointment', clinic_id: 'brand', status: 'cancelled', start_at: '2026-09-25T09:30:00Z' };

test('only a cancelled, elapsed, unreceipted pending failure is eligible for no-resend review', async () => {
  const canReview = await extract('lib/appointment-notification-review.ts', 'canReviewObsoletePendingNotification');
  const now = new Date('2026-10-03T00:00:00Z');
  assert.equal(canReview(notice, appointment, now), true);
  assert.equal(canReview({ ...notice, status: 'sending' }, appointment, now), false);
  assert.equal(canReview({ ...notice, kind: 'confirmed' }, appointment, now), false);
  assert.equal(canReview({ ...notice, provider_message_id: id }, appointment, now), false);
  assert.equal(canReview({ ...notice, sent_at: now.toISOString() }, appointment, now), false);
  assert.equal(canReview({ ...notice, reviewed_at: now.toISOString() }, appointment, now), false);
  assert.equal(canReview(notice, { ...appointment, clinic_id: 'other' }, now), false);
  assert.equal(canReview(notice, { ...appointment, status: 'confirmed' }, now), false);
  assert.equal(canReview(notice, { ...appointment, start_at: '2026-10-04T00:00:00Z' }, now), false);
});

test('system-admin review records actor and resolution while preserving failed delivery', async () => {
  const updates = [], invalidations = [];
  let notificationReads = 0;
  const service = { from(table) {
    let write = false;
    const query = {
      select: () => query, eq: () => query, is: () => query,
      update: values => { write = true; updates.push(values); return query; },
      maybeSingle: async () => {
        if (table === 'appointments') return { data: appointment, error: null };
        if (!write) { notificationReads++; return { data: { id, ...notice, updated_at: '2026-09-17T02:47:00Z' }, error: null }; }
        return { data: { id }, error: null };
      },
    };
    return query;
  } };
  const review = await extract('app/admin/platform/operations/actions.ts', 'reviewObsoletePendingNotificationAction', {
    requireSystemAdmin: async () => ({ user: { id: 'operator' } }), createServiceClient: () => service,
    adminQuery: async result => result, adminErrorMessage: () => 'safe error',
    canReviewObsoletePendingNotification: () => true,
    revalidatePath: path => invalidations.push(path),
  });
  const fd = new FormData(); fd.set('id', id);
  await review(fd);
  assert.equal(notificationReads, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(Object.keys(updates[0]).sort(), ['review_resolution', 'reviewed_at', 'reviewed_by']);
  assert.equal(updates[0].review_resolution, 'obsolete_no_resend');
  assert.equal(updates[0].reviewed_by, 'operator');
  assert.deepEqual(invalidations, ['/admin/platform/operations']);
});

test('review refuses an active appointment before writing', async () => {
  let writes = 0;
  const service = { from(table) {
    const query = { select: () => query, eq: () => query,
      update: () => { writes++; return query; },
      maybeSingle: async () => ({ data: table === 'appointments' ? { ...appointment, status: 'confirmed' }
        : { id, ...notice, updated_at: '2026-09-17T02:47:00Z' }, error: null }) };
    return query;
  } };
  const canReview = await extract('lib/appointment-notification-review.ts', 'canReviewObsoletePendingNotification');
  const review = await extract('app/admin/platform/operations/actions.ts', 'reviewObsoletePendingNotificationAction', {
    requireSystemAdmin: async () => ({ user: { id: 'operator' } }), createServiceClient: () => service,
    adminQuery: async result => result, adminErrorMessage: () => 'safe error',
    canReviewObsoletePendingNotification: canReview, revalidatePath: () => {},
  });
  const fd = new FormData(); fd.set('id', id);
  await assert.rejects(review(fd), /不能標記為過期不補寄/);
  assert.equal(writes, 0);
});
