import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadRoute(file, guardName, redirect) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => name === '@/lib/admin' ? { [guardName]: async () => { throw redirect; } } : {},
    Response, Headers, URL, URLSearchParams, Buffer, Error,
  });
  return exports;
}

for (const [file, guard] of [
  ['app/api/admin/calendar/route.ts', 'requireMember'],
  ['app/api/admin/reports/route.ts', 'requireNonProvider'],
]) {
  test(`${file} propagates unauthenticated redirect`, async () => {
    const redirect = new Error('NEXT_REDIRECT');
    const route = loadRoute(file, guard, redirect);
    await assert.rejects(route.GET({ nextUrl: new URL('https://example.invalid/') }), (error) => error === redirect);
  });
}
