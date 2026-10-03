import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.createSourceFile('actions.ts', readFileSync(new URL('../app/admin/channels/actions.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['normalizedWebhookUrl', 'lineDeliveryChecks'];
const helpers = names.map(name => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name));
assert(helpers.every(Boolean));
const output = ts.transpileModule('export function factory() { ' + helpers.map(node => node.getText(source)).join('\n') + ' return lineDeliveryChecks; }', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { factory } = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
const check = factory();
const destination = 'U-qa-bot';
const expected = 'https://reservation-system-staging-staging.up.railway.app/api/line/webhook';
const bot = { userId: destination, displayName: 'QA', basicId: '@qa', chatMode: 'bot' };

test('current environment webhook and bot identity can pass', () => {
  const checks = check(bot, { active: true, endpoint: expected + '/' }, destination, expected);
  assert.deepEqual(checks.map(row => row.status), ['passed', 'passed', 'passed']);
});

test('shared OA pointing to another environment does not show LINE ready', () => {
  const checks = check(bot, { active: true, endpoint: 'https://reservation-system-production-9b71.up.railway.app/api/line/webhook' }, destination, expected);
  assert.equal(checks.find(row => row.label === 'Webhook 接收')?.status, 'warning');
  assert.match(checks.at(-1).detail, /請勿直接覆蓋/);
  assert.ok(!checks.at(-1).detail.includes('reservation-system-production'));
});

test('inactive or malformed webhook cannot pass', () => {
  assert.equal(check(bot, { active: false, endpoint: expected }, destination, expected).at(-1).status, 'warning');
  assert.equal(check(bot, { active: true, endpoint: 'not-a-url' }, destination, expected).at(-1).status, 'failed');
});

test('valid token for a different bot is refused before webhook readiness', () => {
  const checks = check({ ...bot, userId: 'U-foreign' }, { active: true, endpoint: expected }, destination, expected);
  assert.deepEqual(checks.map(row => row.status), ['failed']);
  assert.ok(!JSON.stringify(checks).includes('U-foreign'));
});
