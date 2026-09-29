export const CRON_WORKER_JOBS = [
  'reminders', 'marketing', 'membership', 'followups', 'registration',
  'richmenu', 'subscription-freezes',
];

/** Keep the usual job order while allowing a staging worker to skip one job. */
export function cronWorkerSelection(raw) {
  if (raw === undefined || raw.trim() === '') {
    return { jobs: CRON_WORKER_JOBS, runnerArgs: [] };
  }
  const jobs = raw.split(',');
  const indexes = jobs.map(job => CRON_WORKER_JOBS.indexOf(job));
  if (indexes.some((index, position) => index < 0 ||
    (position > 0 && index <= indexes[position - 1]))) {
    throw new Error('invalid_job_selection');
  }
  return { jobs, runnerArgs: [`--jobs=${jobs.join(',')}`] };
}
