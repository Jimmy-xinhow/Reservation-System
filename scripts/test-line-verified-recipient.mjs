import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('lib/line-customer-identity.ts', 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(code, { exports, Error, require: () => ({}) });

function service(row, error = null) {
  const filters = [];
  const query = {
    select: () => query,
    eq: (column, value) => { filters.push([column, value]); return query; },
    maybeSingle: async () => ({ data: row, error }),
  };
  return { db: { from: (table) => {
    assert.equal(table, 'line_customer_identities');
    return query;
  } }, filters };
}

test('verified identity belongs to this brand, LINE user and patient', async () => {
  const { db, filters } = service({ patient_id: 'patient-a', profile_completed: true });
  assert.equal(await exports.isVerifiedLineRecipient(db, 'brand-a', 'line-a', 'patient-a'), true);
  assert.deepEqual(filters, [['clinic_id', 'brand-a'], ['line_user_id', 'line-a'], ['active', true]]);
});

test('unlinked and different-patient identities cannot authorize a push', async () => {
  for (const row of [null, { patient_id: null }, { patient_id: 'patient-b' }]) {
    const { db } = service(row);
    assert.equal(await exports.isVerifiedLineRecipient(db, 'brand-a', 'line-a', 'patient-a'), false);
  }
});

test('identity database failure fails closed', async () => {
  const { db } = service(null, { message: 'database unavailable' });
  await assert.rejects(exports.isVerifiedLineRecipient(db, 'brand-a', 'line-a', 'patient-a'));
});
