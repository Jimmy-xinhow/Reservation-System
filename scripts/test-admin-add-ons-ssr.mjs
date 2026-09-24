import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

function page(denied = false) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync('app/admin/settings/add-ons/page.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => ({
      'react/jsx-runtime': jsx,
      'next/link': { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) },
      '@/lib/admin': { requireAdmin: async () => { if (denied) throw new Error('DENIED'); return { clinicId: 'fixture-brand' }; } },
    })[name],
  });
  return exports.default;
}

test('authorized add-on evaluation projects dependencies without enabled-product claims', async () => {
  const html = renderToStaticMarkup(await page()());
  for (const text of ['擴充功能規劃', 'Google Calendar 雙向同步', '台灣電子發票', '多店／總部分店', '推薦獎勵', '簡訊通知', '等待外部帳號', '需要規則確認']) {
    assert(html.includes(text), text);
  }
  assert(!/<span class="badge[^"]*">已啟用/.test(html));
});

test('unauthorized add-on evaluation rejects before projecting data', async () => {
  await assert.rejects(page(true)(), /DENIED/);
});
