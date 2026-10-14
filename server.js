// Jhola — one grocery list, three apps, the cheapest real basket (plus Order, Compare and Forms). Powered by TinyFish.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

// Minimal .env loader (no dependency).
if (fs.existsSync('.env')) {
  for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const { DATA_DIR, readJSON, writeJSON } = await import('./lib/store.js');
const jobs = await import('./lib/jobs.js');
const tf = await import('./lib/tinyfish.js');
const { priceHunt } = await import('./lib/chores/priceHunt.js');
const { formFill } = await import('./lib/chores/formFill.js');
const { isSensitiveField } = await import('./lib/safety.js');
const { order } = await import('./lib/chores/order.js');
const { parseOrder } = await import('./lib/orderParse.js');
const { ORDER_STORES, STORE_NAMES } = await import('./lib/stores.js');
const crypto = await import('node:crypto');
const { jhola, knownFees } = await import('./lib/basket/jhola.js');
const { parseList } = await import('./lib/basket/parse.js');
const accounts = await import('./lib/accounts.js');
const { APPS, APP_NAMES } = await import('./public/lib/basket.js');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));
app.use('/shots', express.static(path.join(DATA_DIR, 'shots')));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error(err);
  res.status(err.status && err.status < 500 ? err.status : 500).json({ error: err.message, code: err.code });
});

const CHORES = {
  price_hunt: { run: priceHunt, title: (i) => `Price hunt: ${i.product}` },
  form_fill: { run: formFill, title: (i) => `Form fill: ${hostOf(i.url)}` },
  order: { run: order, title: (i) => `Order: ${i.text.slice(0, 60)}` },
  jhola: { run: jhola, title: (i) => `Jhola: ${i.items.map((x) => x.name).join(', ').slice(0, 60)}` },
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function startChore(type, input) {
  const chore = CHORES[type];
  if (type === 'form_fill') input = { ...input, profile: readJSON('profile.json', {}) };
  if (type === 'order') input = { ...input, profile: readJSON('profile.json', {}), settings: publicSettings() };
  const job = jobs.runChore(type, input, chore.title(input), chore.run);
  return { id: job.id };
}

// ---- status ----
app.get('/api/status', wrap(async (_req, res) => {
  if (!process.env.TINYFISH_API_KEY) return res.json({ ready: false, message: 'Set TINYFISH_API_KEY in .env' });
  let wallet = null;
  try { wallet = await tf.getWallet(); } catch {}
  res.json({ ready: true, wallet: wallet ? { balance: wallet.available_balance, currency: wallet.currency } : null });
}));

// ---- chores ----
app.post('/api/price-hunt', wrap((req, res) => {
  if (!req.body.product?.trim()) return res.status(400).json({ error: 'Product is required' });
  res.json(startChore('price_hunt', req.body));
}));
app.post('/api/form-fill', wrap((req, res) => {
  if (!/^https?:\/\//.test(req.body.url || '')) return res.status(400).json({ error: 'A full https:// form URL is required' });
  res.json(startChore('form_fill', req.body));
}));

// ---- Jhola: one list, three apps ----
app.post('/api/jhola/parse', (req, res) => res.json({ items: parseList(String(req.body.text || '').slice(0, 2000)) }));
app.post('/api/jhola', wrap((req, res) => {
  const items = (Array.isArray(req.body.items) ? req.body.items : []).slice(0, 25).map((i) => ({
    id: String(i.id || crypto.randomUUID().slice(0, 8)).slice(0, 12),
    name: String(i.name || '').trim().slice(0, 80),
    quantity: Math.max(1, Math.min(Number(i.quantity) || 1, 50000)),
    unit: ['g', 'ml', 'pc'].includes(i.unit) ? i.unit : 'pc',
    brand: i.brand ? String(i.brand).trim().toLowerCase().slice(0, 40) : null,
    allowSubstitute: i.allowSubstitute !== false,
  })).filter((i) => i.name);
  if (!items.length) return res.status(400).json({ error: 'Add at least one item.' });
  const apps = (req.body.apps || APPS).filter((a) => APPS.includes(a));
  if (!apps.length) return res.status(400).json({ error: 'Pick at least one app.' });
  const pincode = readJSON('profile.json', {}).pincode || '';
  const job = jobs.runChore('jhola', { items, apps, pincode }, CHORES.jhola.title({ items }), jhola);
  res.json({ id: job.id });
}));
app.get('/api/jhola/fees', (_req, res) => res.json(knownFees()));

// ---- Setup: connected apps (log in once, India-proxy profiles) ----
app.get('/api/accounts', (_req, res) => {
  const acc = accounts.listAccounts();
  res.json(APPS.map((a) => ({ app: a, name: APP_NAMES[a], connected: !!acc[a]?.connectedAt, expired: !!acc[a]?.expired, connectedAt: acc[a]?.connectedAt || null })));
});
app.post('/api/accounts/:app/open', wrap(async (req, res) => {
  // purpose "pay": the same window, opened on the shopper's own logged-in session so they can pay themselves.
  res.json(await accounts.openWindow(req.params.app, { purpose: req.body.purpose === 'pay' ? 'pay' : 'login' }));
}));
app.get('/api/accounts/window/:sid/frame', wrap(async (req, res) => {
  const { buf, url } = await accounts.frame(req.params.sid);
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Page-Url': encodeURI(url) }).send(buf);
}));
app.post('/api/accounts/window/:sid/input', wrap(async (req, res) => res.json(await accounts.input(req.params.sid, req.body || {}))));
app.post('/api/accounts/window/:sid/close', wrap(async (req, res) => res.json(await accounts.closeWindow(req.params.sid, !!req.body.save))));
app.delete('/api/accounts/:app', wrap(async (req, res) => res.json(await accounts.disconnect(req.params.app))));

// ---- order (one text box) ----
app.post('/api/order/parse', (req, res) => {
  const plan = parseOrder(req.body.text || '', 'IN');
  res.json({ ...plan, stores: plan.store ? [plan.store] : publicSettings().defaultStores, usingDefaults: !plan.store });
});
app.post('/api/order', wrap((req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Tell me what you need.' });
  res.json(startChore('order', { text: text.slice(0, 500) }));
}));

// ---- caretaker settings (default stores, simple mode), optionally PIN-locked ----
const hashPin = (pin) => crypto.createHash('sha256').update(`errand:${pin}`).digest('hex');
function publicSettings() {
  const s = readJSON('settings.json', {});
  return {
    defaultStores: s.defaultStores?.length ? s.defaultStores : ['blinkit.com', 'amazon.in'],
    simpleMode: !!s.simpleMode,
    caretakerName: s.caretakerName || '',
    caretakerPhone: s.caretakerPhone || '',
    hasPin: !!s.pinHash,
  };
}
app.get('/api/settings', (_req, res) => res.json({ ...publicSettings(), stores: ORDER_STORES.map((d) => ({ domain: d, name: STORE_NAMES[d] || d })) }));
app.put('/api/settings', (req, res) => {
  const cur = readJSON('settings.json', {});
  if (cur.pinHash && hashPin(String(req.body.pin || '')) !== cur.pinHash) return res.status(403).json({ error: 'Wrong caretaker PIN' });
  const b = req.body;
  const next = {
    ...cur,
    defaultStores: Array.isArray(b.defaultStores) ? b.defaultStores.filter((d) => ORDER_STORES.includes(d)).slice(0, 4) : cur.defaultStores,
    simpleMode: typeof b.simpleMode === 'boolean' ? b.simpleMode : !!cur.simpleMode,
    caretakerName: String(b.caretakerName ?? cur.caretakerName ?? '').slice(0, 80),
    caretakerPhone: String(b.caretakerPhone ?? cur.caretakerPhone ?? '').slice(0, 20),
  };
  if (b.newPin && /^\d{4,6}$/.test(String(b.newPin))) next.pinHash = hashPin(String(b.newPin));
  if (b.clearPin) delete next.pinHash;
  writeJSON('settings.json', next);
  res.json(publicSettings());
});
app.post('/api/settings/unlock', (req, res) => {
  const cur = readJSON('settings.json', {});
  res.json({ ok: !cur.pinHash || hashPin(String(req.body.pin || '')) === cur.pinHash });
});

// ---- jobs ----
app.get('/api/jobs', (_req, res) => res.json(jobs.listJobs()));
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json({ ...job, cost: jobs.costOf(job.usage) });
});
app.get('/api/jobs/:id/stream', (req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  send({ kind: 'snapshot', job: { ...job, cost: jobs.costOf(job.usage) } });
  const off = jobs.onJob(job.id, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { off(); clearInterval(ping); });
});
app.post('/api/jobs/:id/approve', (req, res) => {
  const ok = jobs.answerApproval(req.params.id, !!req.body.approved, req.body.data || {});
  res.status(ok ? 200 : 409).json({ ok });
});
app.post('/api/jobs/:id/rerun', wrap((req, res) => {
  const job = jobs.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const { profile, settings, ...input } = job.input;
  res.json(startChore(job.type, input));
}));
app.delete('/api/jobs/:id', (req, res) => res.json({ ok: jobs.deleteJob(req.params.id) }));

// ---- profile (used only by Form Fill, stored locally) ----
app.get('/api/profile', (_req, res) => res.json(readJSON('profile.json', {})));
app.put('/api/profile', (req, res) => {
  const clean = Object.fromEntries(Object.entries(req.body || {}).filter(([k, v]) => typeof k === 'string' && typeof v === 'string').map(([k, v]) => [k.trim(), v.trim()]).filter(([k]) => k && !isSensitiveField(k)));
  writeJSON('profile.json', clean);
  res.json(clean);
});

const PORT = Number(process.env.PORT) || 4321;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🛍️  Jhola is running → http://localhost:${PORT}\n`);
  if (!process.env.TINYFISH_API_KEY) console.log('  ⚠  TINYFISH_API_KEY is not set — add it to .env\n');
});
