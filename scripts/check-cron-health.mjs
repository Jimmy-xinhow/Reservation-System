import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function assessCronHealth(records, jobs, maxAgeMs, now = Date.now()) {
  const relevant = records.filter(r => ['cron_job', 'cron_run', 'cron_config'].includes(r.event));
  const time = r => Date.parse(r.at ?? r.timestamp ?? '');
  if (relevant.some(r => !Number.isFinite(time(r)))) return { ok: false, status: 'invalid_timestamp' };
  relevant.sort((a,b) => time(a)-time(b));
  const latest = relevant.at(-1);
  if (!latest) return { ok: false, status: 'missing' };
  const age = now-time(latest);
  if (age < -60000) return { ok: false, status: 'future_timestamp' };
  if (age > maxAgeMs) return { ok: false, status: 'stale', age_seconds: Math.floor(age/1000) };
  const terminals = relevant.filter(r => r.event === 'cron_run');
  const last = terminals.at(-1);
  if (latest.event === 'cron_config') return { ok: false, status: 'configuration_failed' };
  if (!last || time(latest)>time(last) || latest.run_id !== last.run_id) return { ok: false, status: 'incomplete' };
  if (last.status !== 'success') return { ok: false, status: 'failed' };
  const work = relevant.filter(r => r.event === 'cron_job' && r.run_id === last.run_id);
  if (last.jobs !== jobs.length || work.length !== jobs.length || new Set(work.map(r=>r.job)).size !== jobs.length ||
    work.some(r => !jobs.includes(r.job) || r.status !== 'success' || r.http_status !== 200)) return { ok: false, status: 'incomplete_or_failed_jobs' };
  return { ok: true, status: 'healthy', age_seconds: Math.max(0,Math.floor(age/1000)), jobs: jobs.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if(args.length!==3 || new Set(args.map(a=>a.split('=')[0])).size!==3) throw Error();
    const values=Object.fromEntries(args.map(a=>{const i=a.indexOf('=');if(i<0)throw Error();return[a.slice(0,i),a.slice(i+1)];}));
    if(Object.keys(values).some(k=>!['--log-file','--jobs','--max-age-minutes'].includes(k)))throw Error();
    const jobs=values['--jobs'].split(','),age=Number(values['--max-age-minutes']);
    if(!jobs.length||new Set(jobs).size!==jobs.length||jobs.some(j=>!['reminders','marketing','membership','followups','registration','richmenu','subscription-freezes'].includes(j))||!Number.isFinite(age)||age<=0)throw Error();
    const records=readFileSync(values['--log-file'],'utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
    const result=assessCronHealth(records,jobs,age*60000);console.log(JSON.stringify({event:'cron_health',...result}));process.exitCode=result.ok?0:1;
  } catch { console.error(JSON.stringify({event:'cron_health',ok:false,status:'invalid_input'}));process.exitCode=1; }
}
