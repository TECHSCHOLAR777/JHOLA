// Errand UI — vanilla JS, no build step.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
const time = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ago = (t) => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
const money = (n, cur) => { if (n == null) return '—'; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(n); } catch { return `${cur || ''} ${n}`; } };

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
function confirmBox(title, html, yes = 'Continue') {
  const d = $('#confirm');
  $('#confirmTitle').textContent = title; $('#confirmBody').innerHTML = html; $('#confirmYes').textContent = yes;
  d.showModal();
  return new Promise((r) => d.addEventListener('close', () => r(d.returnValue === 'yes'), { once: true }));
}
const formData = (f) => Object.fromEntries(new FormData(f).entries());

// ---------- tabs ----------
function show(tab) {
  if (document.body.classList.contains('simple') && ['price', 'watch', 'form'].includes(tab)) tab = 'order';
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'history') loadHistory();
  if (tab === 'watch') loadWatches();
  if (tab === 'me') loadMe();
  history.replaceState(null, '', `#${tab}`);
}
$$('#tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); show(g.dataset.goto); } });

// ---------- status ----------
async function loadStatus() {
  const el = $('#status');
  try {
    const s = await api('/api/status');
    el.className = `status ${s.ready ? 'ok' : 'bad'}`;
    el.lastElementChild.textContent = s.ready ? (s.wallet ? `TinyFish connected · $${Number(s.wallet.balance).toFixed(2)} left` : 'TinyFish connected') : s.message;
  } catch { el.className = 'status bad'; el.lastElementChild.textContent = 'Server offline'; }
}

// ---------- run view (shared by all chores) ----------
const STAGES = {
  price_hunt: [['search', 'Search'], ['triage', 'Fetch triage'], ['agents', 'Live agents'], ['proof', 'Browser proof'], ['done', 'Result']],
  form_fill: [['dryrun', 'Read form'], ['review', 'Your approval'], ['submit', 'Fill & submit'], ['done', 'Result']],
  order: [['find', 'Searching'], ['confirm', 'Your OK'], ['done', 'Ready']],
};
let activeStreams = new Map();

function mountRun(container, jobId) {
  activeStreams.get(container)?.close();
  container.innerHTML = '<div class="run"><div class="card">Starting…</div></div>';
  const state = { job: null, live: new Map(), liveTag: null, behindOpen: false };
  const es = new EventSource(`/api/jobs/${jobId}/stream`);
  activeStreams.set(container, es);
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.kind === 'snapshot') {
      state.job = ev.job;
      for (const e of ev.job.events) trackLive(state, e);
    } else {
      state.job.events.push(ev);
      trackLive(state, ev);
      if (ev.kind === 'usage') { state.job.usage = ev.usage; state.job.cost = ev.cost; }
      if (ev.kind === 'approval') { state.job.status = 'awaiting_approval'; state.job.approval = ev.approval; }
      if (ev.kind === 'approval_answer') { state.job.status = 'running'; state.job.approval = { ...state.job.approval, answered: ev.approved ? 'approved' : 'declined' }; }
      if (ev.kind === 'done') { state.job.status = ev.status; state.job.result = ev.result; state.job.cost = ev.cost; es.close(); loadStatus(); }
    }
    render(container, state);
  };
  es.onerror = () => { if (state.job && !['running', 'awaiting_approval'].includes(state.job.status)) es.close(); };
}

// Live views: show the newest agent browser that is still running.
function trackLive(state, e) {
  if (e.live) { state.live.set(e.tag, e.live); state.liveTag = e.tag; }
  if (e.liveEnd && state.live.has(e.tag)) {
    state.live.delete(e.tag);
    if (state.liveTag === e.tag) state.liveTag = [...state.live.keys()].pop() || null;
  }
}

function render(container, state) {
  const j = state.job;
  const stages = STAGES[j.type] || [];
  const seen = j.events.filter((e) => e.kind === 'stage').map((e) => e.stage);
  const current = seen[seen.length - 1];
  const finished = !['running', 'awaiting_approval'].includes(j.status);
  const stageHtml = stages.map(([k, label]) => {
    const idx = stages.findIndex((s) => s[0] === current);
    const my = stages.findIndex((s) => s[0] === k);
    const cls = finished && k === 'done' ? 'past' : my < idx || (finished && seen.includes(k)) ? 'past' : k === current ? 'now' : '';
    return `<span class="stage ${cls}">${esc(label)}</span>`;
  }).join('');
  const u = j.usage || {};
  const statusLabel = { running: 'Running', done: 'Done', partial: 'Partial', failed: 'Failed', cancelled: 'Cancelled', needs_input: 'Needs you', awaiting_approval: 'Waiting for you', interrupted: 'Interrupted' }[j.status] || j.status;

  // Keep the live iframe stable across re-renders (don't reload the stream).
  const prevFrame = $('iframe', container);
  const prevApproval = $('.approval', container);
  const prevBehind = $('details.behind', container);
  if (prevBehind) state.behindOpen = prevBehind.open;
  const isOrder = j.type === 'order';
  const latest = [...j.events].reverse().find((e) => e.kind === 'log' || e.kind === 'stage');
  const liveUrl = state.live.get(state.liveTag);
  const logs = j.events.filter((e) => e.kind === 'log' || e.kind === 'stage').slice(-80).reverse();

  container.innerHTML = `
  <div class="run">
    <div class="run-head">
      <div><h3>${esc(j.title)}</h3>
        <div class="meta"><span>${u.searches || 0} searches</span><span>${u.fetchedUrls || 0} pages fetched</span><span>${u.agentRuns || 0} agent runs · ${u.agentSteps || 0} steps</span><span>${u.browserSeconds || 0}s browser</span><span><b>≈ $${(j.cost || 0).toFixed(2)}</b></span></div></div>
      <span class="chip ${esc(j.status)}">${esc(statusLabel)}</span>
    </div>
    ${stageHtml ? `<div class="stages">${stageHtml}</div>` : ''}
    <div id="approvalSlot"></div>
    <div id="resultSlot"></div>
    ${isOrder && j.status === 'running' ? `<div class="card thinking"><span class="fish">🐟</span><div><b>On it…</b><div class="small">${esc(latest?.msg || 'Starting')}</div></div></div>` : ''}
    <details class="behind" ${!isOrder || state.behindOpen ? 'open' : ''}><summary>${isOrder ? 'See what the agent is doing' : 'Live view & activity'}</summary>
    <div class="split">
      <div class="card live">
        <div class="live-head">Live browser ${liveUrl && !finished ? `<a href="${esc(liveUrl)}" target="_blank" rel="noopener" style="margin-left:auto;order:9">Pop out ↗</a>` : ''} ${[...state.live.keys()].map((t) => `<button data-live="${esc(t)}" class="${t === state.liveTag ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
        ${liveUrl && !finished ? '<div class="frame-slot"></div>' : `<div class="empty">${finished ? 'Run finished. Live views close when each agent is done.' : seen.length > 2 && !state.live.size ? 'Agents are done. Wrapping up…' : 'The agent\'s live browser will appear here.'}</div>`}
      </div>
      <div class="card log">${logs.map((e) => `<div class="${esc(e.level || '')}"><time>${time(e.t)}</time><span>${e.kind === 'stage' ? `<b>${esc(e.msg)}</b>` : esc(e.msg)}</span></div>`).join('') || '<div>Waiting…</div>'}</div>
    </div></details>
  </div>`;

  const slot = $('.frame-slot', container);
  if (slot) {
    if (prevFrame && prevFrame.dataset.src === liveUrl) slot.replaceWith(prevFrame);
    else { const f = document.createElement('iframe'); f.src = liveUrl; f.dataset.src = liveUrl; f.title = 'Live agent browser'; slot.replaceWith(f); }
  }
  $$('[data-live]', container).forEach((b) => b.addEventListener('click', () => { state.liveTag = b.dataset.live; render(container, state); }));

  if (j.status === 'awaiting_approval' && j.approval && !j.approval.answered) {
    const slotA = $('#approvalSlot', container);
    // Keep the user's in-progress edits if this is the same approval request.
    if (prevApproval && prevApproval.dataset.at === String(j.approval.askedAt)) slotA.replaceChildren(prevApproval);
    else renderApproval(slotA, j);
  }
  if (finished && j.result) renderResult($('#resultSlot', container), j);
}

// ---------- approval (Form Fill review) ----------
function renderApproval(slot, j) {
  const a = j.approval;
  if (a.kind === 'order_match') return renderMatch(slot, j);
  if (a.kind !== 'form_review') return;
  slot.innerHTML = `
  <div class="card approval" data-at="${esc(a.askedAt)}">
    <h3>✋ Review before anything is sent: ${esc(a.title)}</h3>
    <p class="small">${esc(a.message)} <a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">Open form ↗</a></p>
    ${a.blockers?.length ? `<p><span class="badge warn">Heads up</span> ${a.blockers.map(esc).join(' · ')}</p>` : ''}
    <div class="tbl-wrap"><table class="fields"><thead><tr><th>Field</th><th>Value Errand will enter</th><th>Source</th></tr></thead><tbody>
    ${a.fields.map((f, i) => `<tr class="${f.locked ? 'locked' : ''}">
      <td>${esc(f.label)} ${f.required ? '<span class="req">*</span>' : ''}<div class="small">${esc(f.type)}</div></td>
      <td>${f.locked ? `<span class="badge bad">🔒 ${esc(f.note)}</span>` :
        f.options?.length && ['select', 'radio'].includes(f.type)
          ? `<select data-i="${i}"><option value="">— leave empty —</option>${f.options.map((o) => `<option ${o === f.proposed_value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
          : `<input data-i="${i}" value="${esc(f.proposed_value ?? '')}" placeholder="${f.required ? 'Required — please fill' : 'leave empty'}" />`}</td>
      <td class="small">${f.profile_key ? `profile: ${esc(f.profile_key)}` : f.proposed_value ? 'your note' : f.locked ? '' : '<span class="badge warn">missing</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="actions"><button class="danger" data-act="no">Cancel — send nothing</button><button class="primary" data-act="yes">Approve & submit once →</button></div>
  </div>`;
  $('[data-act=no]', slot).onclick = () => api(`/api/jobs/${j.id}/approve`, { method: 'POST', body: { approved: false } });
  $('[data-act=yes]', slot).onclick = async () => {
    const fields = a.fields.map((f, i) => ({ ...f, value: f.locked ? null : $(`[data-i="${i}"]`, slot)?.value ?? null }));
    const filled = fields.filter((f) => f.value);
    const missing = fields.filter((f) => f.required && !f.locked && !f.value);
    const ok = await confirmBox('Submit this form?',
      `<p>Errand will type <b>${filled.length}</b> value(s) into <b>${esc(a.title)}</b> and press <b>${esc(a.submitLabel || 'Submit')}</b> once.</p>
       ${missing.length ? `<p><span class="badge warn">${missing.length} required field(s) empty</span> the site may reject it: ${missing.map((m) => esc(m.label)).join(', ')}</p>` : ''}
       <p class="small">It stops before any payment, login or CAPTCHA.</p>`, 'Yes, submit');
    if (ok) api(`/api/jobs/${j.id}/approve`, { method: 'POST', body: { approved: true, data: { fields } } });
  };
}

// ---------- results ----------
function renderResult(slot, j) {
  const r = j.result;
  if (r.error) { slot.innerHTML = `<div class="summary"><span class="badge bad">Error</span> ${esc(r.error)}</div>`; return; }
  if (j.type === 'price_hunt') return renderPrice(slot, j, r);
  if (j.type === 'order') return renderOrderResult(slot, j, r);
  if (j.type === 'form_fill') {
    const good = r.status === 'done';
    slot.innerHTML = `<div class="card">
      <div class="summary ${good ? 'good' : ''}">${good ? '✅' : 'ℹ️'} ${esc(r.message)}</div>
      ${r.approved?.length ? `<h4>Values entered</h4><table><tbody>${r.approved.map((a) => `<tr><td>${esc(a.label)}</td><td>${esc(a.value)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${r.submitted?.confirmation_text ? `<h4>Confirmation from the site</h4><p>${esc(r.submitted.confirmation_text)}</p>` : ''}
    </div>`;
  }
}

function renderPrice(slot, j, r) {
  const b = r.best;
  const below = b && r.target && b.price <= r.target;
  slot.innerHTML = `
  <div class="summary ${b ? 'good' : ''}">${b ? '🏆' : 'ℹ️'} ${esc(r.summary || r.message)}</div>
  ${b ? `<div class="card best">
    <div>
      <div class="store">${esc(b.domain)} ${below ? '<span class="badge good">Below your target</span>' : ''}</div>
      <div><span class="price">${money(b.price, b.currency)}</span>${b.mrp && b.mrp > b.price ? `<span class="mrp">${money(b.mrp, b.currency)}</span> <span class="badge good">${Math.round((1 - b.price / b.mrp) * 100)}% off</span>` : ''}</div>
      <p>${esc(b.product_name)}</p>
      <p class="small">${b.in_stock ? '<span class="badge good">In stock</span>' : '<span class="badge bad">Out of stock</span>'} ${esc(b.delivery_info || '')} ${b.seller ? `· Sold by ${esc(b.seller)}` : ''}</p>
      ${b.offers?.length ? `<ul class="clean small">${b.offers.slice(0, 3).map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      <div class="actions" style="justify-content:flex-start">
        <button class="primary" data-buy>Buy at ${esc(b.domain)}…</button>
        <button data-watch-price>👀 Watch this price</button>
        <button data-rerun>↻ Check again</button>
      </div>
    </div>
    <div>${r.proof?.ok ? `<a href="${esc(r.proof.shot)}" target="_blank"><img src="${esc(r.proof.shot)}" alt="Screenshot of the listing"></a><div class="small">📸 Proof via TinyFish Browser · ${new Date(r.proof.at).toLocaleString()}</div>` : '<div class="small">No proof screenshot (the site may block headless browsers).</div>'}</div>
  </div>` : ''}
  ${r.offers?.length ? `<div class="card"><h4 style="margin-top:0">Every store checked</h4><div class="tbl-wrap"><table>
    <thead><tr><th>Store</th><th>Price</th><th>Stock</th><th>Listing</th><th>Delivery / offers</th></tr></thead><tbody>
    ${r.offers.map((o) => `<tr>
      <td><a href="${esc(safeUrl(o.url))}" target="_blank" rel="noopener">${esc(o.domain)}</a></td>
      <td class="num">${money(o.price, o.currency)}${o.mrp && o.mrp > o.price ? `<div class="small" style="text-decoration:line-through">${money(o.mrp, o.currency)}</div>` : ''}</td>
      <td>${o.in_stock ? '<span class="badge good">In stock</span>' : '<span class="badge bad">Out</span>'}</td>
      <td>${esc(o.product_name)} ${o.mismatch ? '<div><span class="badge warn">Different model/variant?</span></div>' : ''}</td>
      <td class="small">${esc(o.delivery_info || '')}${o.offers?.length ? `<div>${esc(o.offers[0])}</div>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
  ${r.failed?.length ? `<div class="card"><h4 style="margin-top:0">Couldn't check</h4><ul class="clean small">${r.failed.map((f) => `<li><a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">${esc(f.domain)}</a>: ${esc(f.reason)}</li>`).join('')}</ul></div>` : ''}`;

  $('[data-buy]', slot)?.addEventListener('click', async () => {
    const ok = await confirmBox(`Buy at ${b.domain}?`,
      `<p><b>${esc(b.product_name)}</b><br>${money(b.price, b.currency)} · checked ${new Date(j.finishedAt || Date.now()).toLocaleTimeString()}</p>
       <p>Errand doesn't pay for you, and it never sees your card or login. I'll open the listing in a new tab so <b>you</b> can check the final price and check out.</p>`, 'Open store');
    if (ok) window.open(b.url, '_blank', 'noopener');
  });
  $('[data-watch-price]', slot)?.addEventListener('click', async () => {
    try {
      await api('/api/watches', { method: 'POST', body: { kind: 'page', url: b.url, name: `${r.product} @ ${b.domain}`.slice(0, 100), schedule: 'every6h',
        purpose: `The selling price of ${r.product} changes from ${money(b.price, b.currency)}${r.target ? `, especially if it drops to ${money(r.target, b.currency)} or below` : ''}, or it goes out of stock` } });
      toast('Watching this price every 6 hours. See the Watch tab.');
    } catch (e) { toast(e.message); }
  });
  $('[data-rerun]', slot)?.addEventListener('click', () => rerun(j.id, slot.closest('.panel').querySelector('[id$=Run]')));
}

async function rerun(id, container) {
  const { id: nid } = await api(`/api/jobs/${id}/rerun`, { method: 'POST' });
  mountRun(container || $('#historyRun'), nid);
}

// ---------- Price Hunt ----------
const priceForm = $('#priceForm');
function updateEstimate() {
  const n = Number(priceForm.maxStores.value);
  $('#priceEstimate').textContent = `≈ ${n} agent runs · typically $${(n * 0.06).toFixed(2)}–$${(n * 0.2).toFixed(2)} · ~1–3 min`;
}
priceForm.maxStores.addEventListener('change', updateEstimate); updateEstimate();
priceForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const { id } = await api('/api/price-hunt', { method: 'POST', body: formData(priceForm) }); mountRun($('#priceRun'), id); }
  catch (err) { toast(err.message); }
});
$$('[data-fill]').forEach((b) => b.addEventListener('click', () => {
  const v = JSON.parse(b.dataset.fill);
  priceForm.reset(); for (const [k, val] of Object.entries(v)) priceForm[k].value = val; updateEstimate();
}));

// ---------- Form Fill ----------
const formForm = $('#formForm');
formForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try { const { id } = await api('/api/form-fill', { method: 'POST', body: formData(formForm) }); mountRun($('#formRun'), id); }
  catch (err) { toast(err.message); }
});
$$('[data-fill-form]').forEach((b) => b.addEventListener('click', () => {
  const v = JSON.parse(b.dataset.fillForm); for (const [k, val] of Object.entries(v)) formForm[k].value = val;
}));

// ---------- Watch ----------
const watchForm = $('#watchForm');
let watchKind = 'page';
function setKind(k) {
  watchKind = k;
  $$('#watchKind button').forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
  $$('.kind-page').forEach((el) => el.classList.toggle('hidden', k !== 'page'));
  $$('.kind-topic').forEach((el) => el.classList.toggle('hidden', k !== 'topic'));
}
$$('#watchKind button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
$$('[data-watch]').forEach((b) => b.addEventListener('click', () => {
  const v = JSON.parse(b.dataset.watch); watchForm.reset(); setKind(v.kind);
  for (const [k, val] of Object.entries(v)) if (watchForm[k]) watchForm[k].value = val;
}));
watchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button[type=submit]', watchForm); btn.disabled = true; btn.textContent = 'Taking a baseline…';
  try {
    const res = await api('/api/watches', { method: 'POST', body: { kind: watchKind, ...formData(watchForm) } });
    const bl = res.baseline;
    $('#watchResult').innerHTML = `<div class="card" style="margin-top:14px"><div class="summary good">✅ Watching <b>${esc(res.monitor.name)}</b>. Baseline captured. I'll compare every check against it.</div>
      ${bl?.preview ? `<div class="diff">${esc(bl.preview)}…</div>` : ''}
      ${bl?.items ? `<ul class="clean small">${bl.items.map((i) => `<li><a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener">${esc(i.title)}</a></li>`).join('')}</ul>` : ''}</div>`;
    watchForm.reset(); setKind('page'); loadWatches();
  } catch (err) { toast(err.message); }
  btn.disabled = false; btn.textContent = 'Start watching →';
});

const SCHED = { '0 * * * *': 'Every hour', '0 */6 * * *': 'Every 6 hours', 'CRON_TZ=Asia/Kolkata 0 9 * * *': 'Daily 9am IST', 'CRON_TZ=Asia/Kolkata 0 9 * * 1-5': 'Weekdays 9am IST', 'CRON_TZ=Asia/Kolkata 0 9 * * 1': 'Mondays 9am IST' };
async function loadWatches() {
  const list = $('#watchList');
  try {
    const ws = await api('/api/watches');
    if (!ws.length) { list.innerHTML = '<div class="card small">No watches yet. Try a preset above.</div>'; return; }
    list.innerHTML = ws.map((w) => `<div class="card watch" data-id="${esc(w.id)}">
      <h4>${esc(w.name)}</h4>
      <div class="small">${w.type === 'fetch' ? '📄 Page' : '🔎 Topic'} · ${esc(SCHED[w.schedule_cron] || w.schedule_cron)} · <span class="badge ${w.status === 'active' ? 'good' : 'warn'}">${esc(w.status)}</span></div>
      ${w.purpose ? `<div class="small">Looking for: ${esc(w.purpose)}</div>` : ''}
      <div class="small">${w.type === 'fetch' ? `<a href="${esc(safeUrl(w.config?.url))}" target="_blank" rel="noopener">${esc(w.config?.url)}</a>` : `“${esc(w.config?.query)}”`}</div>
      ${w.last_error ? `<div class="small"><span class="badge bad">Last error</span> ${esc(w.last_error)}</div>` : ''}
      <div class="small">Last checked here: ${ago(w.lastCheckedAt)}</div>
      <div class="row"><button class="primary" data-check>Check now</button><button data-pause>${w.status === 'paused' ? 'Resume' : 'Pause'}</button><button class="danger ghost" data-del>Delete</button></div>
      <div class="check-out"></div></div>`).join('');
    $$('.watch', list).forEach((card) => {
      const id = card.dataset.id; const w = ws.find((x) => x.id === id);
      $('[data-check]', card).onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Checking…';
        try { renderCheck($('.check-out', card), await api(`/api/watches/${id}/check`, { method: 'POST' })); }
        catch (err) { toast(err.message); }
        e.target.disabled = false; e.target.textContent = 'Check now';
      };
      $('[data-pause]', card).onclick = async () => { await api(`/api/watches/${id}`, { method: 'PATCH', body: { paused: w.status !== 'paused' } }); loadWatches(); };
      $('[data-del]', card).onclick = async () => {
        if (await confirmBox('Delete this watch?', `<p>“${esc(w.name)}” and its schedule will be removed permanently.</p>`, 'Delete')) { await api(`/api/watches/${id}`, { method: 'DELETE' }); loadWatches(); }
      };
    });
  } catch (err) { list.innerHTML = `<div class="card small">Couldn't load watches: ${esc(err.message)}</div>`; }
}
function renderCheck(el, r) {
  const c = r.change;
  if (r.monitor.type === 'fetch') {
    el.innerHTML = !r.since ? '<div class="small" style="margin-top:8px">First check from this computer. Saved as the new comparison point.</div>'
      : !c.changed ? `<div class="small" style="margin-top:8px"><span class="badge good">No change</span> since ${ago(r.since)}</div>`
      : `<div style="margin-top:8px"><span class="badge warn">Changed</span> <span class="small">since ${ago(r.since)}</span>
         <div class="diff">${c.added.map((l) => `<div class="add">+ ${esc(l)}</div>`).join('')}${c.removed.slice(0, 10).map((l) => `<div class="del">− ${esc(l)}</div>`).join('')}</div></div>`;
  } else {
    el.innerHTML = !r.since ? '<div class="small" style="margin-top:8px">First check from this computer. Saved as the new comparison point.</div>'
      : !c.newItems.length ? `<div class="small" style="margin-top:8px"><span class="badge good">Nothing new</span> since ${ago(r.since)}</div>`
      : `<div style="margin-top:8px"><span class="badge warn">${c.newItems.length} new</span><ul class="clean small">${c.newItems.map((i) => `<li><a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener">${esc(i.title)}</a></li>`).join('')}</ul></div>`;
  }
}

// ---------- History ----------
async function loadHistory() {
  const list = $('#historyList');
  const js = await api('/api/jobs');
  if (!js.length) { list.innerHTML = '<div class="card small">Nothing yet. Run a chore and it shows up here.</div>'; return; }
  list.innerHTML = js.map((j) => `<div class="card hist" data-id="${esc(j.id)}">
    <div><div class="t">${esc(j.title)}</div><div class="small">${new Date(j.createdAt).toLocaleString()} · ${j.usage.agentRuns} agent runs · ≈ $${j.cost.toFixed(2)}${j.result?.summary ? ` · ${esc(j.result.summary)}` : j.result?.message ? ` · ${esc(j.result.message)}` : ''}</div></div>
    <div class="row"><span class="chip ${esc(j.status)}">${esc(j.status.replace('_', ' '))}</span><button data-open>Open</button><button data-rerun>Re-run</button></div></div>`).join('');
  $$('.hist', list).forEach((row) => {
    $('[data-open]', row).onclick = () => { mountRun($('#historyRun'), row.dataset.id); $('#historyRun').scrollIntoView({ behavior: 'smooth' }); };
    $('[data-rerun]', row).onclick = () => { rerun(row.dataset.id, $('#historyRun')); $('#historyRun').scrollIntoView({ behavior: 'smooth' }); };
  });
}

// ---------- Order (one text box) ----------
let settings = { defaultStores: [], stores: [], simpleMode: false, hasPin: false };
let profile = {};
const storeLabel = (d) => settings.stores.find((s) => s.domain === d)?.name || d;
const orderForm = $('#orderForm');
let parseTimer;
async function previewPlan() {
  const text = orderForm.text.value.trim();
  const el = $('#orderPlan');
  if (!text) { el.innerHTML = ''; return; }
  try {
    const p = await api('/api/order/parse', { method: 'POST', body: { text } });
    el.innerHTML = p.items.map((i) => `<span class="pill">${i.qty > 1 ? `${i.qty} × ` : ''}${esc(i.name)}</span>`).join('') +
      (p.items.length ? ` <span>from</span> ${p.stores.map((d, k) => `<span class="pill ${p.usingDefaults ? 'soft' : 'store'}">${esc(storeLabel(d))}</span>${k < p.stores.length - 1 ? '<span>→</span>' : ''}`).join(' ')}` : '');
  } catch { el.innerHTML = ''; }
}
orderForm.text.addEventListener('input', () => { clearTimeout(parseTimer); parseTimer = setTimeout(previewPlan, 250); });
orderForm.text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); orderForm.requestSubmit(); } });
orderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = orderForm.text.value.trim();
  if (!text) return orderForm.text.focus();
  if (!hasAddress()) { toast('First add your name, phone and address in Me.'); return show('me'); }
  try { const { id } = await api('/api/order', { method: 'POST', body: { text } }); mountRun($('#orderRun'), id); }
  catch (err) { toast(err.message); }
});
$$('#orderExamples button').forEach((b) => b.addEventListener('click', () => { orderForm.text.value = b.textContent; previewPlan(); orderForm.text.focus(); }));
const hasAddress = () => ['full_name', 'phone', 'address_line1', 'pincode'].every((k) => profile[k]);

function renderMatch(slot, j) {
  const a = j.approval;
  const p = a.product;
  const img = /^https:\/\//.test(p.image_url || '') ? `style="background-image:url('${esc(p.image_url)}')"` : '';
  const next = a.moreStores?.length ? a.moreStores[0] : null;
  slot.innerHTML = `
  <div class="card match approval" data-at="${esc(a.askedAt)}">
    <div class="img" ${img}>${img ? '' : '🛍️'}</div>
    <div>
      <div class="tag">${a.confidence === 'perfect' ? '✨ Looks like a perfect match' : '🤔 Closest match'} · ${esc(a.storeName)}</div>
      <h3>${esc(p.product_name)}</h3>
      <div class="small">${esc(p.pack_size || '')} ${a.item.qty > 1 ? `· you asked for <b>${a.item.qty}</b>` : ''}</div>
      <div><span class="price">${money(p.price, p.currency)}</span>${p.mrp && p.mrp > p.price ? `<span class="mrp">${money(p.mrp, p.currency)}</span>` : ''}
        ${a.item.qty > 1 ? `<span class="small"> each · ${money(p.price * a.item.qty, p.currency)} total</span>` : ''}</div>
      <div class="small" style="margin-top:6px">You asked for “${esc(a.item.name)}”. ${p.why ? esc(p.why) : ''}</div>
      <div class="btns">
        <button class="primary big" data-a="yes">Yes, this one ✓</button>
        <button data-a="no">${next ? `No, try ${esc(next)}` : 'No, that\'s not it'}</button>
        <button class="ghost" data-a="skip">Skip this item</button>
      </div>
      <div class="small" style="margin-top:8px">Saying yes stops the search for this item.</div>
    </div>
  </div>`;
  const answer = (approved, action) => api(`/api/jobs/${j.id}/approve`, { method: 'POST', body: { approved, data: { action } } });
  $('[data-a=yes]', slot).onclick = () => answer(true);
  $('[data-a=no]', slot).onclick = () => answer(false, 'next');
  $('[data-a=skip]', slot).onclick = () => answer(false, 'skip');
}

function renderOrderResult(slot, j, r) {
  if (!r.orders) { slot.innerHTML = `<div class="summary">ℹ️ ${esc(r.message)} ${r.missing ? '<a href="#me">Open Me →</a>' : ''}</div>`; return; }
  slot.innerHTML = r.orders.map((o) => `
    <div class="card ready">
      <div><h3>🧡 Ready on ${esc(o.storeName)}</h3>
        ${o.items.map((i) => `<div>${i.qty} × ${esc(i.name)} <span class="small">· ${money(i.price, o.currency)}${i.qty > 1 ? ' each' : ''}</span></div>`).join('')}
        <div class="small" style="margin-top:6px">About ${money(o.total, o.currency)} + delivery. Choose <b>Cash on Delivery</b> at checkout if you like.</div></div>
      <div class="row" style="flex-wrap:wrap">${o.items.map((i) => `<a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener"><button class="primary">Open on ${esc(o.storeName)} ↗</button></a>`).join('')}</div>
    </div>`).join('') +
    (r.notFound?.length ? `<div class="card"><b>Not found:</b> ${r.notFound.map((n) => `${esc(n.name)} <span class="small">(${esc(n.reason)})</span>`).join(', ')} <button data-rerun>Try again</button></div>` : '');
  $('[data-rerun]', slot)?.addEventListener('click', () => rerun(j.id, $('#orderRun')));
}

// ---------- Me: details + caretaker ----------
const PROFILE_KEYS = ['full_name', 'phone', 'email', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'pincode'];
const SENSITIVE = /(pass(word|code)|otp|\bpin\b(?!\s*code)|cvv|card|upi|iban|ifsc|account|aadhaar|aadhar|\bpan\b|ssn|passport)/i;
const meForm = $('#meForm');
function extraRow(k = '', v = '') {
  const d = document.createElement('div'); d.className = 'prow';
  d.innerHTML = `<input class="k" placeholder="e.g. college" value="${esc(k)}"><input class="v" placeholder="value" value="${esc(v)}"><button type="button" class="ghost danger" title="Remove">✕</button>`;
  $('button', d).onclick = () => d.remove();
  return d;
}
async function loadMe() {
  profile = await api('/api/profile');
  PROFILE_KEYS.forEach((k) => { meForm[k].value = profile[k] || ''; });
  const rows = $('#extraRows'); rows.innerHTML = '';
  Object.entries(profile).filter(([k]) => !PROFILE_KEYS.includes(k)).forEach(([k, v]) => rows.append(extraRow(k, v)));
  renderCare();
  updateHello();
}
$('#addExtra').onclick = () => $('#extraRows').append(extraRow());
meForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const obj = {}; const refused = [];
  PROFILE_KEYS.forEach((k) => { const v = meForm[k].value.trim(); if (v) obj[k] = v; });
  $$('#extraRows .prow').forEach((r) => { const k = $('.k', r).value.trim(); const v = $('.v', r).value.trim(); if (!k || !v) return; if (SENSITIVE.test(k)) refused.push(k); else obj[k] = v; });
  if (obj.pincode && !/^\d{6}$/.test(obj.pincode)) return toast('PIN code should be 6 digits.');
  profile = await api('/api/profile', { method: 'PUT', body: obj });
  toast(refused.length ? `Saved. Not stored (sensitive): ${refused.join(', ')}` : 'Saved 🧡');
  updateHello();
});
function updateHello() {
  const first = (profile.full_name || '').split(' ')[0];
  $('#hello').textContent = first ? `Hi ${first}, what do you need today?` : 'What do you need today?';
  $('#needInfo').classList.toggle('hidden', hasAddress());
}

let careUnlocked = false;
let carePin = '';
let carePicked = [];
async function loadSettings() {
  settings = await api('/api/settings');
  document.body.classList.toggle('simple', settings.simpleMode);
  carePicked = [...settings.defaultStores];
}
function renderCare() {
  const locked = settings.hasPin && !careUnlocked;
  $('#careLocked').classList.toggle('hidden', !locked);
  $('#careBody').classList.toggle('hidden', locked);
  $('#careStores').innerHTML = settings.stores.map((s) => {
    const i = carePicked.indexOf(s.domain);
    return `<button type="button" data-d="${esc(s.domain)}" class="${i >= 0 ? 'on' : ''}">${i >= 0 ? `<span class="n">${i + 1}</span>` : ''}${esc(s.name)}</button>`;
  }).join('');
  $$('#careStores button').forEach((b) => b.onclick = () => {
    const d = b.dataset.d;
    carePicked = carePicked.includes(d) ? carePicked.filter((x) => x !== d) : carePicked.length < 4 ? [...carePicked, d] : carePicked;
    renderCare();
  });
  $('#careName').value = settings.caretakerName; $('#carePhone').value = settings.caretakerPhone;
  $('#careSimple').checked = settings.simpleMode;
}
$('#careUnlock').onclick = async () => {
  const pin = $('#careUnlockPin').value;
  const { ok } = await api('/api/settings/unlock', { method: 'POST', body: { pin } });
  if (!ok) return toast('Wrong PIN');
  careUnlocked = true; carePin = pin; renderCare();
};
$('#careSave').onclick = async () => {
  if (!carePicked.length) return toast('Pick at least one store.');
  try {
    const newPin = $('#careNewPin').value.trim();
    if (newPin && !/^\d{4,6}$/.test(newPin)) return toast('PIN must be 4–6 digits.');
    const s = await api('/api/settings', { method: 'PUT', body: { pin: carePin, newPin, defaultStores: carePicked, simpleMode: $('#careSimple').checked, caretakerName: $('#careName').value, caretakerPhone: $('#carePhone').value } });
    if (newPin) carePin = newPin;
    $('#careNewPin').value = '';
    settings = { ...settings, ...s };
    document.body.classList.toggle('simple', settings.simpleMode);
    toast(`Saved. Orders without a store go to ${carePicked.map(storeLabel).join(' → ')}.`);
  } catch (e) { toast(e.message); }
};

// ---------- boot ----------
loadStatus();
await loadSettings().catch(() => {});
await loadMe().catch(() => {});
show((location.hash || '#order').slice(1) || 'order');
window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'order'));
