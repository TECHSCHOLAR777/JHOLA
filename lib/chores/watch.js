// WATCH — "Tell me when this changes."
// Wraps the TinyFish Monitor API (Page monitors run Fetch on a schedule; Topic
// monitors repeat a Search) and keeps a local snapshot so "Check now" can show
// exactly what changed since last time.
import crypto from 'node:crypto';
import * as tf from '../tinyfish.js';
import { readJSON, writeJSON } from '../store.js';

const SNAP = 'watch-snapshots.json';
const snaps = () => readJSON(SNAP, {});
const hash = (s) => crypto.createHash('sha1').update(s || '').digest('hex');

export const SCHEDULES = {
  hourly: '0 * * * *',
  every6h: '0 */6 * * *',
  daily9: 'CRON_TZ=Asia/Kolkata 0 9 * * *',
  weekdays9: 'CRON_TZ=Asia/Kolkata 0 9 * * 1-5',
  weekly: 'CRON_TZ=Asia/Kolkata 0 9 * * 1',
};

function snapshotFrom(type, run) {
  if (!run) return null;
  if (type === 'fetch') {
    const text = (run.results || []).map((r) => r.text || '').join('\n');
    return { at: Date.now(), hash: hash(text), text: text.slice(0, 200000), title: run.results?.[0]?.title };
  }
  const items = (run.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet }));
  return { at: Date.now(), hash: hash(items.map((i) => i.url).join('\n')), items };
}

// Line-level diff: what lines appeared / disappeared since last snapshot.
export function diffText(before = '', after = '') {
  const norm = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l.length > 2);
  const a = new Set(norm(before));
  const b = new Set(norm(after));
  return {
    added: [...b].filter((l) => !a.has(l)).slice(0, 40),
    removed: [...a].filter((l) => !b.has(l)).slice(0, 40),
  };
}

export async function createWatch({ kind, url, query, name, purpose, schedule, webhook }) {
  const type = kind === 'topic' ? 'search' : 'fetch';
  const body = {
    type,
    name: (name || (type === 'fetch' ? url : query)).slice(0, 100),
    config: type === 'fetch' ? { url, format: 'markdown' } : { query, result_limit: 10, recency_minutes: 7 * 24 * 60 },
    schedule_cron: SCHEDULES[schedule] || schedule || SCHEDULES.daily9,
  };
  if (purpose) body.purpose = purpose.slice(0, 2000);
  if (webhook) body.webhook_url = webhook;
  if (type === 'fetch' && !/^https?:\/\//.test(url || '')) throw new Error('Give me the full page URL (https://…).');
  if (type === 'search' && !query) throw new Error('Tell me what topic to watch.');
  const res = await tf.createMonitor(body);
  const all = snaps();
  all[res.monitor.id] = { purpose, baseline: snapshotFrom(type, res.run), last: snapshotFrom(type, res.run) };
  writeJSON(SNAP, all);
  return { monitor: res.monitor, baseline: summarizeRun(type, res.run) };
}

function summarizeRun(type, run) {
  if (!run) return null;
  if (type === 'fetch') {
    const r = run.results?.[0];
    return { title: r?.title, preview: (r?.text || '').slice(0, 1200), errors: run.errors };
  }
  return { items: (run.results || []).slice(0, 10).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })) };
}

export async function listWatches() {
  const { monitors = [] } = await tf.listMonitors();
  const all = snaps();
  return monitors.map((m) => ({ ...m, purpose: all[m.id]?.purpose || null, lastCheckedAt: all[m.id]?.last?.at || null }));
}

export async function checkNow(id) {
  const monitor = await tf.getMonitor(id).then((r) => r.monitor || r);
  const res = await tf.runMonitor(id);
  const run = res.run || res;
  const type = monitor.type;
  const all = snaps();
  const prev = all[id]?.last;
  const next = snapshotFrom(type, run);
  let change;
  if (type === 'fetch') {
    const d = diffText(prev?.text, next?.text);
    change = { changed: !!prev && prev.hash !== next.hash, ...d };
  } else {
    const before = new Set((prev?.items || []).map((i) => i.url));
    const fresh = (next.items || []).filter((i) => !before.has(i.url));
    change = { changed: !!prev && fresh.length > 0, newItems: fresh, positions: run.new_result_positions || [] };
  }
  all[id] = { ...(all[id] || {}), last: next, prevAt: prev?.at || null };
  writeJSON(SNAP, all);
  return { monitor, change, since: prev?.at || null, purpose: all[id].purpose, run: summarizeRun(type, run), raw: { errors: run.errors, evaluation: run.evaluation ?? run.change ?? null } };
}

export const pauseWatch = (id, paused) => tf.updateMonitor(id, { status: paused ? 'paused' : 'active' });
export async function deleteWatch(id) {
  const r = await tf.deleteMonitor(id);
  const all = snaps(); delete all[id]; writeJSON(SNAP, all);
  return r;
}
