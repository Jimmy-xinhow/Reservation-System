import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const base = 'https://reservation-system-staging-staging.up.railway.app';
const expectedHost = 'ongjsegewpnbkqugrpom.supabase.co';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'staging' || !url || !key || new URL(url).host !== expectedHost) {
  throw new Error('Staging platform browser audit guard failed');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const suffix = `${Date.now()}-${randomBytes(4).toString('hex')}`;
const email = `qa-platform-g30324-${suffix}@example.invalid`;
const password = `${randomBytes(20).toString('base64url')}Aa1!`;
const session = `g303platform${randomBytes(3).toString('hex')}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
let userId;
let result = {};

function cli(command, ...args) {
  const processResult = spawnSync(process.execPath, [npxCli, '--yes', '--package', '@playwright/cli', 'playwright-cli', `-s=${session}`, command, ...args], {
    encoding: 'utf8', timeout: 90000, windowsHide: true,
  });
  if (processResult.error || processResult.status !== 0) {
    throw new Error(`Browser ${command} failed: ${processResult.error?.code ?? processResult.status}`);
  }
  return processResult.stdout;
}

function ref(snapshot, pattern) {
  const match = snapshot.match(pattern);
  if (!match) throw new Error(`Expected browser control missing: ${pattern.source}`);
  return match[1];
}

function assertMetric(label, expected) {
  const expression = `Array.from(document.querySelectorAll('.platform-metric')).find((element) => element.firstElementChild?.textContent?.trim() === ${JSON.stringify(label)})?.children[1]?.textContent?.trim() === ${JSON.stringify(String(expected))}`;
  const output = cli('eval', expression);
  if (!/### Result\s*\r?\ntrue\b/.test(output)) {
    throw new Error(`Platform metric ${label} did not match staging database count`);
  }
}

async function cleanup() {
  if (!userId) return;
  const { error: membershipError } = await db.from('platform_admins').delete().eq('user_id', userId);
  if (membershipError) throw new Error(`Remove platform test role failed: ${membershipError.code}`);
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError) throw new Error(`Remove platform test Auth failed: ${authError.status ?? 'unknown'}`);
  const { count, error: checkError } = await db.from('platform_admins').select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
  if (checkError || count !== 0) throw new Error('Platform test role residual remains');
  const { data, error: authCheckError } = await db.auth.admin.getUserById(userId);
  if (!authCheckError || data?.user) throw new Error('Platform test Auth user remains');
}

let workError;
try {
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error('Create isolated platform Auth user failed');
  userId = created.data.user.id;
  const { error: roleError } = await db.from('platform_admins').insert({
    user_id: userId, role: 'admin', access_type: 'system_admin', permissions: [], active: true,
  });
  if (roleError) throw new Error(`Create isolated platform role failed: ${roleError.code}`);
  const { count: brandCount, error: countError } = await db.from('clinics').select('id', { count: 'exact', head: true });
  if (countError || typeof brandCount !== 'number') throw new Error('Read staging brand count failed');
  const { data: usageRows, error: usageError } = await db.rpc('get_platform_usage_summary')
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(0, Math.max(brandCount - 1, 0));
  if (usageError || !Array.isArray(usageRows) || usageRows.length !== brandCount) {
    throw new Error('Staging platform usage RPC did not match brand count');
  }
  result.rpcBrandCountMatched = true;

  cli('open', `${base}/admin/login`);
  let snapshot = cli('snapshot');
  cli('click', ref(snapshot, /button "系統管理後台" \[ref=([a-zA-Z0-9]+)\]/));
  snapshot = cli('snapshot');
  cli('fill', ref(snapshot, /textbox "Email" \[ref=([a-zA-Z0-9]+)\]/), email);
  cli('fill', ref(snapshot, /textbox "密碼" \[ref=([a-zA-Z0-9]+)\]/), password);
  cli('click', ref(snapshot, /button "(?:進入系統管理|登入系統管理後台)" \[ref=([a-zA-Z0-9]+)\]/));
  let loggedIn = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    snapshot = cli('snapshot');
    if (snapshot.includes('/admin/platform')) { loggedIn = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!loggedIn) throw new Error('System admin did not reach platform workspace');
  result.login = true;

  cli('goto', `${base}/admin/platform?section=overview`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('系統管理控制台')) {
    throw new Error('Platform overview does not show current staging brand count');
  }
  assertMetric('品牌總數', brandCount);
  result.overview = true;

  cli('goto', `${base}/admin/platform/reports`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('跨品牌報表')) {
    throw new Error('Platform report does not show current staging brand count');
  }
  assertMetric('品牌', brandCount);
  result.report = true;
  result.brandCountMatched = true;

  cli('goto', `${base}/admin/platform/operations`);
  snapshot = cli('snapshot');
  if (!snapshot.includes('最近全域排程') || (snapshot.match(/尚無紀錄/g) ?? []).length < 7) {
    throw new Error('Platform operations did not show seven missing global Cron jobs');
  }
  result.globalCronMissingShown = true;
} catch (error) {
  workError = error;
} finally {
  try { cli('close'); } catch { /* data cleanup still runs */ }
  try { await cleanup(); result.fixtureResidual = 0; } catch (error) {
    workError = workError ? new AggregateError([workError, error], 'Browser audit and cleanup failed') : error;
  }
}

if (workError) throw workError;
console.log(JSON.stringify({ auditedAt: new Date().toISOString(), deployment: '4b31ca96-fa62-4714-b1ca-56d3e2cab601', ...result }));
