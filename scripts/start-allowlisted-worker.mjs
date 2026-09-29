import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cronWorkerSelection } from './cron-worker-selection.mjs';

// Railway background service: one run at a time, then a bounded five-minute wait.
// This service has no public domain and never calls any global GET cron endpoint.
const intervalMs = 5 * 60_000;
const maximumRunMs = 4 * 60_000;
let selection;
try {
  selection = cronWorkerSelection(process.env.CRON_WORKER_JOBS);
} catch {
  console.error(JSON.stringify({ event: 'cron_worker_config', status: 'invalid_job_selection' }));
  process.exit(1);
}
console.log(JSON.stringify({ event: 'cron_worker_config', status: 'ready', jobs: selection.jobs }));
let stopping = false;
let child = null;
process.on('SIGTERM', () => { stopping = true; child?.kill('SIGTERM'); });
process.on('SIGINT', () => { stopping = true; child?.kill('SIGINT'); });

async function cycle() {
  if (stopping) return;
  const cycleId = randomUUID();
  const started = Date.now();
  let status = 'failed';
  try {
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ['scripts/run-allowlisted-cron.mjs', ...selection.runnerArgs], {
        stdio: 'inherit', env: process.env, windowsHide: true,
      });
      const timeout = setTimeout(() => child?.kill('SIGTERM'), maximumRunMs);
      child.once('error', reject);
      child.once('exit', (code) => { clearTimeout(timeout); resolve(code); });
    });
    status = exitCode === 0 ? 'success' : 'failed';
  } catch {
    status = 'failed';
  } finally {
    child = null;
    console.log(JSON.stringify({ event: 'cron_worker_cycle', cycle_id: cycleId, status,
      duration_ms: Date.now() - started, at: new Date().toISOString() }));
  }
  if (!stopping) setTimeout(cycle, intervalMs);
}

await cycle();
