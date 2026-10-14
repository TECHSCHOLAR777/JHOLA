// Jhola UI — vanilla JS, no build step.
import { optimise, APPS, APP_NAMES, feesFor } from '/lib/basket.js';
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
  if (document.body.classList.contains('simple') && ['price', 'form', 'order'].includes(tab)) tab = 'order';
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
  if (tab === 'history') loadHistory();
  if (tab === 'me') loadMe();
  if (tab === 'setup') loadSetup();
  if (tab === 'jhola') loadAccounts().then(renderAppToggles);
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
  jhola: [['collect', 'Live prices'], ['plan', 'Your plan'], ['fill', 'Fill carts'], ['check', 'Check totals'], ['done', 'Pay']],
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
      if (ev.kind === 'update') Object.assign(state.job, ev.patch);
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
  const prevFrame = $('.live iframe', container);
  const prevFrames = new Map($$('.apanel iframe', container).map((f) => [f.dataset.src, f]));
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
    ${j.type === 'jhola' && j.basket ? panelsHtml(j, state, finished) : ''}
    <details class="behind" ${!isOrder && j.type !== 'jhola' || state.behindOpen ? 'open' : ''}><summary>${isOrder ? 'See what the agent is doing' : 'Live view & activity'}</summary>
    <div class="split">
      <div class="card live">
        <div class="live-head">Live browser ${liveUrl && !finished ? `<a href="${esc(liveUrl)}" target="_blank" rel="noopener" style="margin-left:auto;order:9">Pop out ↗</a>` : ''} ${[...state.live.keys()].map((t) => `<button data-live="${esc(t)}" class="${t === state.liveTag ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>
        ${liveUrl && !finished ? '<div class="frame-slot"></div>' : `<div class="empty">${finished ? 'Run finished. Live views close when each agent is done.' : seen.length > 2 && !state.live.size ? 'Agents are done. Wrapping up…' : 'The agent\'s live browser will appear here.'}</div>`}
      </div>
      <div class="card log">${logs.map((e) => `<div class="${esc(e.level || '')}"><time>${time(e.t)}</time><span>${e.kind === 'stage' ? `<b>${esc(e.msg)}</b>` : esc(e.msg)}</span></div>`).join('') || '<div>Waiting…</div>'}</div>
    </div></details>
  </div>`;

  // Re-use live iframes in the three app panels so streams don't reload.
  $$('.pframe', container).forEach((ph) => {
    const src = ph.dataset.src; const old = prevFrames.get(src);
    if (old) ph.replaceWith(old); else { const f = document.createElement('iframe'); f.src = src; f.dataset.src = src; f.title = 'Live agent browser'; ph.replaceWith(f); }
  });
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
  if (a.kind === 'basket_plan') return renderPlan(slot, j);
  if (a.kind === 'cart_diff') return renderCartDiff(slot, j);
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
  if (j.type === 'jhola') return renderCarts(slot, j, r);
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

// ---------- Jhola: list → live panels → plan → carts ----------
let accountsCache = [];
async function loadAccounts() { try { accountsCache = await api('/api/accounts'); } catch { accountsCache = []; } return accountsCache; }
const acct = (app) => accountsCache.find((a) => a.app === app) || {};
const rs = (n) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const qtyLabel = (i) => (i.unit === 'g' ? (i.quantity >= 1000 ? `${+(i.quantity / 1000).toFixed(2)} kg` : `${i.quantity} g`) : i.unit === 'ml' ? (i.quantity >= 1000 ? `${+(i.quantity / 1000).toFixed(2)} L` : `${i.quantity} ml`) : `× ${i.quantity}`);

const jForm = $('#jForm');
let jItems = [];
let jApps = [...APPS];
let jTimer;
async function jParse() {
  const text = jForm.text.value.trim();
  if (!text) { jItems = []; renderItems(); return; }
  const { items } = await api('/api/jhola/parse', { method: 'POST', body: { text } });
  // Keep edits the user made to items that still exist.
  const old = new Map(jItems.map((i) => [i.raw, i]));
  jItems = items.map((i) => (old.get(i.raw)?.edited ? old.get(i.raw) : i));
  renderItems();
}
function renderItems() {
  const box = $('#jItems');
  if (!jItems.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="items-edit"><div class="irow irow-head"><span>Item</span><span>Qty</span><span>Unit</span><span class="bw">Brand</span><span></span><span></span></div>
    ${jItems.map((i, k) => `<div class="irow" data-k="${k}">
      <input data-f="name" value="${esc(i.name)}" title="from “${esc(i.raw)}”">
      <input data-f="quantity" type="number" min="1" value="${esc(i.quantity)}">
      <select data-f="unit">${['pc', 'g', 'ml'].map((u) => `<option ${u === i.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
      <input class="bw" data-f="brand" placeholder="any brand" value="${esc(i.brand || '')}">
      <label class="nosub" title="Only this exact product"><input type="checkbox" data-f="nosub" ${i.allowSubstitute ? '' : 'checked'}> no subs</label>
      <button type="button" class="ghost x" data-del title="Remove">✕</button></div>`).join('')}</div>`;
  $$('.irow[data-k]', box).forEach((row) => {
    const it = jItems[row.dataset.k];
    $$('[data-f]', row).forEach((el) => el.addEventListener('input', () => {
      const f = el.dataset.f; it.edited = true;
      if (f === 'nosub') it.allowSubstitute = !el.checked;
      else if (f === 'quantity') it.quantity = Number(el.value) || 1;
      else if (f === 'brand') it.brand = el.value.trim().toLowerCase() || null;
      else it[f] = el.value;
    }));
    $('[data-del]', row).onclick = () => { jItems.splice(row.dataset.k, 1); renderItems(); };
  });
}
function renderAppToggles() {
  const any = accountsCache.some((a) => a.connected && !a.expired);
  $('#jNeedSetup').classList.toggle('hidden', any);
  $('#jApps').innerHTML = APPS.map((a) => {
    const ac = acct(a);
    return `<span class="apptog ${jApps.includes(a) ? 'on' : ''}" data-app="${a}" title="${ac.connected ? (ac.expired ? 'Login expired' : 'Connected') : 'Not connected — prices by PIN code only'}"><span class="d ${ac.connected ? (ac.expired ? 'exp' : 'ok') : ''}"></span>${APP_NAMES[a]}</span>`;
  }).join('');
  $$('#jApps .apptog').forEach((t) => t.onclick = () => {
    const a = t.dataset.app;
    jApps = jApps.includes(a) ? jApps.filter((x) => x !== a) : [...jApps, a];
    renderAppToggles();
  });
}
jForm.text.addEventListener('input', () => { clearTimeout(jTimer); jTimer = setTimeout(jParse, 300); });
$$('#jExamples button').forEach((b) => b.addEventListener('click', () => { jForm.text.value = b.textContent; jItems = []; jParse(); }));
jForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!jItems.length) await jParse();
  if (!jItems.length) return toast('Type your list first.');
  if (!jApps.length) return toast('Pick at least one app.');
  if (!profile.pincode && !accountsCache.some((a) => a.connected)) { toast('Add your PIN code in Me (or connect an app in Setup).'); return show('me'); }
  try {
    const { id } = await api('/api/jhola', { method: 'POST', body: { items: jItems.map(({ edited, raw, ...i }) => i), apps: jApps } });
    try { localStorage.setItem('jhola:last', id); } catch {}
    mountRun($('#jRun'), id);
  } catch (err) { toast(err.message); }
});
async function resumeJhola() {
  let id; try { id = localStorage.getItem('jhola:last'); } catch {}
  if (!id) return;
  try { const j = await api(`/api/jobs/${id}`); if (['running', 'awaiting_approval'].includes(j.status) || Date.now() - j.createdAt < 3600e3) mountRun($('#jRun'), id); } catch {}
}

// Three live panels, one per app.
const STATE_LABEL = { queued: 'Queued', searching: 'Searching…', scanning: 'Browser scan…', done: 'Done', logged_out: 'Logged out', unavailable: 'Unavailable' };
function panelsHtml(j, state, finished) {
  const b = j.basket;
  return `<div class="panels">${b.apps.map((app) => {
    const name = APP_NAMES[app];
    const st = b.status?.[app] || {};
    const live = !finished && (state.live.get(`${name} cart`) || state.live.get(name));
    const last = [...j.events].reverse().find((e) => e.tag === name || e.tag === `${name} cart`);
    const chip = { done: 'done', logged_out: 'failed', unavailable: 'failed', searching: 'running', scanning: 'running' }[st.state] || '';
    return `<div class="card apanel"><div class="ph"><b>${name}</b><span class="chip ${chip}">${esc(STATE_LABEL[st.state] || st.state || '')}</span></div>
      ${live ? `<div class="pframe" data-src="${esc(live)}"></div>` : `<div class="scr">${st.state === 'done' ? `✅ Found ${st.found}/${b.items.length} items${st.address ? `<br><span class="small">📍 ${esc(st.address)}</span>` : ''}${st.loggedIn === false ? '<br><span class="small">(not logged in — PIN-code prices)</span>' : ''}` : esc(st.note || (finished ? '' : 'Waiting for the browser…'))}</div>`}
      <div class="pl">${esc(last?.msg?.replace(/^.*?: /, '') || '')}</div></div>`;
  }).join('')}</div>`;
}

// Plan page: optimised basket with swap / drop / force-one-app; totals update instantly.
function renderPlan(slot, j) {
  const a = j.approval;
  const ps = { choice: {}, pinned: {}, dropped: [], onlyApps: null, fees: structuredClone(a.fees) };
  // A persistent root: the run view re-renders often and re-uses this node, so redraws target it, not the slot.
  const root = document.createElement('div');
  root.className = 'card approval'; root.dataset.at = a.askedAt;
  slot.replaceChildren(root);
  const draw = () => {
    const r = optimise({ items: a.items, offers: a.offers, fees: ps.fees, apps: a.apps, choice: ps.choice, pinned: ps.pinned, dropped: ps.dropped, onlyApps: ps.onlyApps });
    const p = r.best;
    if (!p) { root.innerHTML = 'Nothing could be planned with these choices. <button data-reset>Reset</button>'; $('[data-reset]', root).onclick = () => { Object.assign(ps, { choice: {}, pinned: {}, dropped: [], onlyApps: null }); draw(); }; return; }
    const lineOf = Object.fromEntries(p.lines.map((l) => [l.itemId, l]));
    const subs = p.lines.filter((l) => l.offer.matchKind !== 'exact');
    root.innerHTML = `
      <div class="plan-sum"><div><div class="small">Your cheapest basket</div>
        <div class="big">${p.apps.map((x) => APP_NAMES[x]).join(' + ')}, ${rs(p.total)} <span class="small">incl. fees</span></div>
        <div class="small">${r.bestSingle && r.bestSingle.apps.join() !== p.apps.join() ? `Best single app is ${APP_NAMES[r.bestSingle.apps[0]]} at ${rs(r.bestSingle.total)}.` : r.bestSingle ? 'One app is the cheapest here.' : 'No single app has everything.'}</div></div>
        ${r.savings > 0 ? `<span class="save">You save ${rs(r.savings)}</span>` : ''}</div>
      <div class="modes"><button data-mode="" class="${!ps.onlyApps ? 'on' : ''}">Best mix</button>${a.apps.map((x) => `<button data-mode="${x}" class="${ps.onlyApps?.[0] === x ? 'on' : ''}">${APP_NAMES[x]} only</button>`).join('')}</div>
      <div class="tbl-wrap"><table class="ptable"><thead><tr><th>Item</th><th>App</th><th>Product</th><th>Packs</th><th>Total</th><th>Change</th></tr></thead><tbody>
      ${a.items.map((it) => {
        const l = lineOf[it.id]; const dropped = ps.dropped.includes(it.id);
        const opts = a.apps.flatMap((app) => (a.offers[it.id]?.[app] || []).map((o, k) => ({ app, k, o })));
        if (!l) return `<tr class="${dropped ? 'dropped' : ''}"><td><b>${esc(it.name)}</b><div class="small">${qtyLabel(it)}</div></td><td colspan="4">${dropped ? 'Dropped' : '<span class="badge bad">Not available</span>'}</td><td><button data-drop="${esc(it.id)}">${dropped ? 'Restore' : 'Drop'}</button></td></tr>`;
        const o = l.offer;
        return `<tr><td><b>${esc(it.name)}</b><div class="small">${qtyLabel(it)}${it.brand ? ` · ${esc(it.brand)}` : ''}</div></td>
          <td><span class="appb">${APP_NAMES[l.app]}</span></td>
          <td>${esc(o.productName)}<div class="small">${esc(o.packLabel)} · ${rs(o.price)} · ${esc(o.unitPrice)}${o.source === 'scan' ? ' · scan' : ''}</div>
            ${o.matchKind === 'substitute' ? '<span class="badge warn">Substitute</span>' : o.matchKind === 'size_variant' ? '<span class="badge warn">Different size</span>' : ''}</td>
          <td class="num">${l.packs}</td><td class="num">${rs(o.lineCost)}</td>
          <td><select data-swap="${esc(it.id)}">${opts.map(({ app, k, o: c }) => `<option value="${app}|${k}" ${app === l.app && c === o ? 'selected' : ''}>${APP_NAMES[app]} · ${esc(c.productName.slice(0, 34))} ${esc(c.packLabel)} · ${rs(c.lineCost)}${c.matchKind !== 'exact' ? ' *' : ''}</option>`).join('')}</select>
            <button class="ghost" data-drop="${esc(it.id)}">Drop</button></td></tr>`;
      }).join('')}</tbody></table></div>
      <h4>Fees by app</h4>
      <div class="feegrid">${p.apps.map((x) => { const f = p.feesByApp[x]; const rule = ps.fees[x] || {}; return `<div class="fee"><b>${APP_NAMES[x]}</b> <span class="small">(${esc(rule.source || 'estimate')})</span>
        <div class="r"><span>Items</span><span>${rs(f.subtotal)}</span></div><div class="r"><span>Delivery</span><span>${rs(f.delivery)}</span></div>
        <div class="r"><span>Handling</span><span>${rs(f.handling)}</span></div>${f.smallCart ? `<div class="r"><span>Small cart</span><span>${rs(f.smallCart)}</span></div>` : ''}${f.other ? `<div class="r"><span>Other</span><span>${rs(f.other)}</span></div>` : ''}
        <div class="r t"><span>Total</span><span>${rs(f.subtotal + f.total)}</span></div>
        <details><summary class="small">Edit fees</summary><div class="fee-edit">${[['deliveryFee', 'Delivery'], ['freeDeliveryAbove', 'Free above'], ['handlingFee', 'Handling'], ['smallCartFee', 'Small cart fee'], ['smallCartThreshold', 'Small cart below']].map(([k, lab]) => `<label class="small">${lab}<input type="number" min="0" data-fee="${x}|${k}" value="${esc(rule[k] ?? 0)}"></label>`).join('')}</div></details></div>`; }).join('')}</div>
      ${subs.length ? `<p class="small">⚠️ ${subs.length} item(s) are a substitute or a different size. Approving accepts them.</p>` : ''}
      <div class="actions"><button class="danger" data-cancel>Cancel</button><button class="primary big" data-approve>Approve & fill carts →</button></div>`;
    $$('[data-mode]', root).forEach((b) => b.onclick = () => { ps.onlyApps = b.dataset.mode ? [b.dataset.mode] : null; draw(); });
    $$('[data-drop]', root).forEach((b) => b.onclick = () => { const id = b.dataset.drop; ps.dropped = ps.dropped.includes(id) ? ps.dropped.filter((x) => x !== id) : [...ps.dropped, id]; draw(); });
    $$('[data-swap]', root).forEach((s) => s.onchange = () => { const [app, k] = s.value.split('|'); const id = s.dataset.swap; ps.pinned[id] = app; ps.choice[id] = { ...(ps.choice[id] || {}), [app]: Number(k) }; if (ps.onlyApps && !ps.onlyApps.includes(app)) ps.onlyApps = null; draw(); });
    $$('[data-fee]', root).forEach((inp) => inp.onchange = () => { const [x, k] = inp.dataset.fee.split('|'); ps.fees[x] = { ...ps.fees[x], [k]: Number(inp.value) || 0, source: 'edited by you' }; draw(); });
    $('[data-cancel]', root).onclick = () => api(`/api/jobs/${j.id}/approve`, { method: 'POST', body: { approved: false } });
    $('[data-approve]', root).onclick = async () => {
      const ok = await confirmBox('Fill these carts?', `<p>I'll fill <b>${p.apps.map((x) => APP_NAMES[x]).join(' and ')}</b> with ${p.lines.length} item(s), planned total <b>${rs(p.total)}</b>.</p>
        <p>⚠️ Anything already in those carts will be <b>removed first</b>.</p><p class="small">I stop on the cart page. I never press Pay or Place order. You pay in the app.</p>`, 'Yes, fill carts');
      if (!ok) return;
      api(`/api/jobs/${j.id}/approve`, { method: 'POST', body: { approved: true, data: { plan: { apps: p.apps, total: p.total, lines: p.lines.map((l) => ({ itemId: l.itemId, app: l.app, productName: l.offer.productName, packs: l.packs })) }, fees: ps.fees } } });
    };
  };
  draw();
}

function renderCartDiff(slot, j) {
  const a = j.approval;
  slot.innerHTML = `<div class="card approval" data-at="${esc(a.askedAt)}"><h3>⚠️ The cart total isn't what I planned</h3>
    ${a.carts.map((c) => `<p><b>${APP_NAMES[c.app]}</b>: planned ${rs(c.planned)}, the app now says <b>${rs(c.actual)}</b> (${c.diff > 0 ? '+' : ''}${rs(c.diff)}).</p>`).join('')}
    <p class="small">Prices or fees changed since I checked. Do you still want to go ahead and pay?</p>
    <div class="actions"><button data-no>Don't pay yet</button><button class="primary" data-yes>Yes, continue to payment</button></div></div>`;
  $('[data-no]', slot).onclick = () => api(`/api/jobs/${j.id}/approve`, { method: 'POST', body: { approved: false } });
  $('[data-yes]', slot).onclick = () => api(`/api/jobs/${j.id}/approve`, { method: 'POST', body: { approved: true } });
}

function renderCarts(slot, j, r) {
  if (!r.carts) { slot.innerHTML = `<div class="summary">ℹ️ ${esc(r.message)} ${/Setup/.test(r.message || '') ? '<a href="#setup">Open Setup →</a>' : ''}</div>`; return; }
  slot.innerHTML = `<div class="summary ${r.status === 'done' ? 'good' : ''}">${r.status === 'done' ? '🛍️' : 'ℹ️'} ${esc(r.message)}</div>
  <div class="grid3">${r.carts.map((c) => {
    const name = APP_NAMES[c.app];
    if (c.state !== 'filled') return `<div class="card cartcard"><h3>${name}</h3><p>${esc(c.message)}</p>${/Setup/.test(c.message) ? '<a href="#setup"><button>Open Setup</button></a>' : ''}</div>`;
    const k = c.cart; const off = c.diff != null && Math.abs(c.diff) > 10;
    return `<div class="card cartcard"><h3>${name} cart</h3>
      ${k.removed_existing ? '<p class="small">I removed items that were already in this cart.</p>' : ''}
      <table><tbody>${k.lines.map((l) => `<tr><td>${esc(l.name)} <span class="small">${esc(l.pack || '')}</span></td><td class="num">×${l.qty}</td><td class="num">${rs(l.price)}</td></tr>`).join('')}</tbody></table>
      <div class="fee" style="margin-top:10px"><div class="r"><span>Items</span><span>${rs(k.item_total)}</span></div><div class="r"><span>Delivery</span><span>${rs(k.delivery_fee)}</span></div><div class="r"><span>Handling</span><span>${rs(k.handling_fee)}</span></div>${k.small_cart_fee ? `<div class="r"><span>Small cart</span><span>${rs(k.small_cart_fee)}</span></div>` : ''}${k.other_fees ? `<div class="r"><span>Other</span><span>${rs(k.other_fees)}</span></div>` : ''}
        <div class="r t"><span>To pay</span><span class="tot">${rs(c.actual)}</span></div></div>
      <p class="small">Planned ${rs(c.planned)} ${off ? `<span class="badge warn">${c.diff > 0 ? '+' : ''}${rs(c.diff)} different</span>` : '<span class="badge good">matches</span>'}</p>
      ${k.missing?.length ? `<p class="small"><span class="badge bad">Missing</span> ${k.missing.map(esc).join(', ')}</p>` : ''}
      <div class="row" style="flex-wrap:wrap"><button class="primary" data-pay="${c.app}">Pay on ${name} →</button></div>
      <p class="small">Opens your logged-in ${name} so <b>you</b> pay with your own UPI. You can also open the ${name} app on your phone; the cart is on your account.</p></div>`;
  }).join('')}</div>`;
  $$('[data-pay]', slot).forEach((b) => b.onclick = () => openWindow(b.dataset.pay, 'pay'));
}

// ---------- Setup + the remote window (login once / pay yourself) ----------
async function loadSetup() {
  await loadAccounts();
  $('#setupApps').innerHTML = accountsCache.map((a) => `<div class="card appcard"><h3>${esc(a.name)}</h3>
    <div>${a.connected ? (a.expired ? '<span class="badge warn">Login expired</span>' : '<span class="badge good">Connected</span>') : '<span class="badge">Not connected</span>'}</div>
    <div class="small">${a.connectedAt ? `Saved ${new Date(a.connectedAt).toLocaleString()}` : 'Log in with your phone number + OTP.'}</div>
    <div class="row"><button class="primary" data-open="${a.app}">${a.connected ? 'Reconnect' : 'Connect'}</button>${a.connected ? `<button class="ghost danger" data-disc="${a.app}">Disconnect</button>` : ''}</div></div>`).join('');
  $$('[data-open]').forEach((b) => b.onclick = () => openWindow(b.dataset.open, 'login'));
  $$('[data-disc]').forEach((b) => b.onclick = async () => { if (await confirmBox('Disconnect?', `<p>This deletes the saved ${esc(APP_NAMES[b.dataset.disc])} login from TinyFish.</p>`, 'Disconnect')) { await api(`/api/accounts/${b.dataset.disc}`, { method: 'DELETE' }); loadSetup(); } });
}

let win = null;
async function openWindow(app, purpose) {
  const d = $('#win');
  $('#winTitle').textContent = purpose === 'pay' ? `Pay on ${APP_NAMES[app]} (you pay, not Jhola)` : `Log in to ${APP_NAMES[app]}`;
  $('#winHint').textContent = purpose === 'pay' ? 'Open the cart and pay with your own UPI. Jhola does not click anything here.' : 'Tap Login, enter your phone number and OTP, and check your delivery address. Then Save & close.';
  $('#winImg').removeAttribute('src');
  d.showModal();
  try {
    const s = await api(`/api/accounts/${app}/open`, { method: 'POST', body: { purpose } });
    win = { ...s, app, alive: true };
    const loop = async () => {
      if (!win?.alive) return;
      try {
        const res = await fetch(`/api/accounts/window/${win.sessionId}/frame`);
        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          const img = $('#winImg'); const old = img.src; img.src = url; if (old.startsWith('blob:')) URL.revokeObjectURL(old);
          $('#winUrl').textContent = decodeURI(res.headers.get('X-Page-Url') || '');
        } else if (res.status === 410) { win.alive = false; toast('The window expired.'); d.close(); return; }
      } catch {}
      setTimeout(loop, 700);
    };
    loop();
  } catch (e) { toast(e.message); d.close(); }
}
const send = (ev) => win?.alive && api(`/api/accounts/window/${win.sessionId}/input`, { method: 'POST', body: ev }).catch(() => {});
$('#winImg').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect();
  send({ type: 'click', x: Math.round(((e.clientX - r.left) / r.width) * (win?.width || 1000)), y: Math.round(((e.clientY - r.top) / r.height) * (win?.height || 700)) });
  e.target.focus();
});
$('#winImg').addEventListener('wheel', (e) => { e.preventDefault(); send({ type: 'scroll', dy: e.deltaY }); }, { passive: false });
$('#winImg').addEventListener('keydown', (e) => {
  if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send({ type: 'type', text: e.key }); }
  else if (['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Delete'].includes(e.key)) { e.preventDefault(); send({ type: 'key', key: e.key }); }
});
$('#winSend').onclick = () => { const t = $('#winText').value; if (t) { send({ type: 'type', text: t }); $('#winText').value = ''; } };
$('#winText').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#winSend').click(); } });
$$('#win [data-key]').forEach((b) => b.onclick = () => send({ type: 'key', key: b.dataset.key }));
$$('#win [data-scroll]').forEach((b) => b.onclick = () => send({ type: 'scroll', dy: Number(b.dataset.scroll) }));
$('#win [data-back]').onclick = () => send({ type: 'back' });
async function closeWin(save) {
  const d = $('#win');
  if (!win) return d.close();
  const w = win; win = { ...w, alive: false };
  try { const r = await api(`/api/accounts/window/${w.sessionId}/close`, { method: 'POST', body: { save } }); if (save) toast(`${APP_NAMES[w.app]} saved${r.cookies ? ` (${r.cookies} cookies)` : ''} 🧡`); } catch (e) { toast(e.message); }
  win = null; d.close(); loadSetup(); loadAccounts().then(renderAppToggles);
}
$('#winSave').onclick = () => closeWin(true);
$('#winCancel').onclick = () => closeWin(false);
$('#win').addEventListener('cancel', (e) => { e.preventDefault(); closeWin(false); });

// ---------- boot ----------
loadStatus();
await loadSettings().catch(() => {});
await loadMe().catch(() => {});
await loadAccounts(); renderAppToggles();
show((location.hash || '#jhola').slice(1) || 'jhola');
window.addEventListener('hashchange', () => show(location.hash.slice(1) || 'jhola'));
resumeJhola();
