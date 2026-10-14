// Job registry: every chore run is a Job with a live event log that the UI
// streams over SSE. Jobs can pause for a human approval and resume when the
// user answers. Finished jobs are persisted to data/jobs.json.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readJSON, writeJSON } from './store.js';
import { AGENT_COST_PER_STEP, BROWSER_COST_PER_MIN } from './tinyfish.js';

const FILE = 'jobs.json';
const jobs = new Map();
const bus = new EventEmitter();
bus.setMaxListeners(100);
const pendingApprovals = new Map(); // jobId -> resolve fn

for (const j of readJSON(FILE, [])) {
  if (['running', 'awaiting_approval'].includes(j.status)) j.status = 'interrupted';
  jobs.set(j.id, j);
}

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const all = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
    writeJSON(FILE, all);
  }, 300);
}

export function createJob(type, input, title) {
  const job = {
    id: randomUUID(),
    type,
    title,
    input,
    status: 'running',
    createdAt: Date.now(),
    finishedAt: null,
    events: [],
    result: null,
    approval: null,
    usage: { agentRuns: 0, agentSteps: 0, browserSeconds: 0, searches: 0, fetchedUrls: 0 },
  };
  jobs.set(job.id, job);
  persist();
  return job;
}

function emit(job, ev) {
  const e = { t: Date.now(), ...ev };
  job.events.push(e);
  bus.emit(job.id, e);
  persist();
}

export function makeContext(job) {
  return {
    job,
    log: (msg, extra = {}) => emit(job, { kind: 'log', msg, ...extra }),
    step: (stage, msg, extra = {}) => emit(job, { kind: 'stage', stage, msg, ...extra }),
    update: (patch) => { Object.assign(job, patch); emit(job, { kind: 'update', patch }); },
    usage: (k, n = 1) => { job.usage[k] = (job.usage[k] || 0) + n; emit(job, { kind: 'usage', usage: job.usage, cost: costOf(job.usage) }); },
    // Pause the job until the human answers. Resolves with { approved, data }.
    askApproval: (request) => new Promise((resolve) => {
      job.status = 'awaiting_approval';
      job.approval = { ...request, askedAt: Date.now() };
      pendingApprovals.set(job.id, resolve);
      emit(job, { kind: 'approval', approval: job.approval });
    }),
  };
}

export function answerApproval(id, approved, data = {}) {
  const job = jobs.get(id);
  const resolve = pendingApprovals.get(id);
  if (!job || !resolve) return false;
  pendingApprovals.delete(id);
  job.approval = { ...job.approval, answered: approved ? 'approved' : 'declined', answeredAt: Date.now() };
  job.status = 'running';
  emit(job, { kind: 'approval_answer', approved });
  resolve({ approved, data });
  return true;
}

export function finishJob(job, status, result) {
  job.status = status;
  job.result = result ?? job.result;
  job.finishedAt = Date.now();
  emit(job, { kind: 'done', status, result: job.result, cost: costOf(job.usage) });
}

export function costOf(u) {
  return +(u.agentSteps * AGENT_COST_PER_STEP + (u.browserSeconds / 60) * BROWSER_COST_PER_MIN).toFixed(3);
}

export const getJob = (id) => jobs.get(id);
export const listJobs = () => [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt)
  .map(({ events, ...j }) => ({ ...j, cost: costOf(j.usage) }));
export const onJob = (id, fn) => { bus.on(id, fn); return () => bus.off(id, fn); };
export function deleteJob(id) { const ok = jobs.delete(id); persist(); return ok; }

// Runs a chore function in the background with consistent error handling.
export function runChore(type, input, title, fn) {
  const job = createJob(type, input, title);
  const ctx = makeContext(job);
  Promise.resolve()
    .then(() => fn(ctx, input))
    .then((result) => { if (job.status !== 'done' && !job.finishedAt) finishJob(job, result?.status || 'done', result); })
    .catch((err) => {
      console.error(`[${type}]`, err);
      ctx.log(`Failed: ${err.message}`, { level: 'error' });
      finishJob(job, 'failed', { error: err.message, code: err.code });
    });
  return job;
}
