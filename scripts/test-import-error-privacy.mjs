import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const canary = 'duplicate key value contains Authorization=Bearer IMPORT_SYNTHETIC_SECRET email=person@example.invalid';
const { outputText: safeOutput } = ts.transpileModule(read('lib/import-error.ts'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { safeImportErrors } = await import('data:text/javascript;base64,' + Buffer.from(safeOutput).toString('base64'));

async function factory(path, declaration, dependencies, jsx = false) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const statements = declaration === 'ImportPage'
    ? source.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(source).replace(/^export default /, '').replace(/^export /, '')).join('\n')
    : source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === declaration).getText(source).replace(/^export /, '');
  const context = declaration === 'POST' ? 'const ENTITIES = new Set(["patients", "services", "memberships"]);' : '';
  const body = `export function factory(deps) { const {${dependencies.join(',')}} = deps; ${context} ${statements} return ${declaration}; }`;
  const { outputText } = ts.transpileModule(body, { fileName: jsx ? 'test.tsx' : 'test.ts', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.React } });
  return (await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))).factory;
}

test('CSV import API never returns a historical raw SQL error reason', async () => {
  const create = await factory('app/api/admin/import/route.ts', 'POST', ['checkRateLimit','getOptionalMember','hasBrandPermission','fail','ok','createServiceClient','safeImportErrors']);
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { id: 'job', entity: 'patients', status: 'completed', total_rows: 1, imported_rows: 0, failed_rows: 1, error_summary: [{ row: 1, reason: canary }], created_at: '2026-09-23T00:00:00Z', completed_at: null }, error: null }) };
  const POST = create({
    checkRateLimit: async () => ({ allowed: true }),
    getOptionalMember: async () => ({ clinicId: 'brand', user: { id: 'admin' } }),
    hasBrandPermission: () => true,
    fail: (message, status) => Response.json({ ok: false, error: status >= 500 ? '系統暫時無法完成操作' : message }, { status }),
    ok: data => Response.json({ ok: true, data }),
    createServiceClient: () => ({ rpc: async () => ({ data: 'job', error: null }), from: () => query }),
    safeImportErrors,
  });
  const response = await POST({ json: async () => ({ entity: 'patients', idempotency_key: 'fixture_12345678', rows: [{ name: 'Test', phone: '0900000000' }] }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert(!text.includes('IMPORT_SYNTHETIC_SECRET'));
  assert(!text.includes('person@example.invalid'));
});

test('CSV import history page never renders a historical raw SQL error reason', async () => {
  const create = await factory('app/admin/import/page.tsx', 'ImportPage', ['React','requireAdmin','adminQuery','createServiceClient','CsvImportWizard','adminErrorMessage','safeImportErrors','fetchAllSupabasePages'], true);
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, then: (resolve, reject) => Promise.resolve({ data: [{ id: 'job', entity: 'patients', status: 'completed', total_rows: 1, imported_rows: 0, failed_rows: 1, error_summary: [{ row: 1, reason: canary }], created_at: '2026-09-23T00:00:00Z' }], error: null }).then(resolve, reject) };
  const Page = create({ React, requireAdmin: async () => ({ clinicId: 'brand' }), adminQuery: async value => await value, createServiceClient: () => ({ from: () => query }), CsvImportWizard: () => null, adminErrorMessage: () => '讀取失敗', safeImportErrors, fetchAllSupabasePages: async () => [{ status: 'completed', imported_rows: 0 }] });
  const html = renderToStaticMarkup(await Page());
  assert(!html.includes('IMPORT_SYNTHETIC_SECRET'));
  assert(!html.includes('person@example.invalid'));
});

test('CSV import error projection retains only exact known reasons', () => {
  assert.deepEqual(safeImportErrors([{ row: 2, reason: 'invalid phone' }]), [{ row: 2, reason: '電話格式不正確，請填寫 8 至 20 碼' }]);
  assert.equal(safeImportErrors([{ row: 2, reason: 'invalid phone ' + canary }])[0].reason, '此列無法匯入，請檢查資料內容或聯絡服務人員');
  assert.equal(safeImportErrors([{ row: 99999, reason: canary }])[0].row, 0);
});
