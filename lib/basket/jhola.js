// JHOLA — one grocery list, three apps, the cheapest real basket.
//
// 1. Collect: one Agent run per app (Blinkit, Zepto, Instamart), staggered,
//    stealth + the app's saved India-proxy login profile. Each run searches every
//    item from the home page and returns the top 3 matches + any fees it sees.
//    Blocked → Browser API scan fallback. Logged out → mark the login expired.
// 2. Plan: the shopper sees the optimised basket (public/lib/basket.js), can
//    swap, drop or force one app, and taps Approve. Nothing touches a cart before.
// 3. Fill: one Agent run per chosen app fills the cart and reads the bill.
//    It stops on the cart page. Jhola never presses a payment button.
// 4. Check: planned vs actual totals; >₹10 apart → the shopper is asked again.

import { runAgent } from '../tinyfish.js';
import { detectBlock } from '../safety.js';
import { readJSON, writeJSON } from '../store.js';
import { accountFor, markExpired, ensureProfile, APP_HOME } from '../accounts.js';
import { scanApp } from './scan.js';
import { fmtQty } from './parse.js';
import { APPS, APP_NAMES, buildOffers, feesFor } from '../../public/lib/basket.js';

// Starting estimates until Jhola reads real fees from a cart (then it learns them).
export const DEFAULT_FEES = {
  blinkit: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 2, smallCartFee: 20, smallCartThreshold: 99, otherFees: 0, source: 'estimate' },
  zepto: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 2, smallCartFee: 35, smallCartThreshold: 99, otherFees: 0, source: 'estimate' },
  instamart: { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 5, smallCartFee: 25, smallCartThreshold: 99, otherFees: 0, source: 'estimate' },
};
export const knownFees = () => ({ ...DEFAULT_FEES, ...readJSON('fees.json', {}) });

const NO_PAY = 'Do not click Proceed to Pay, Place Order, Pay, Checkout confirm or any payment button.';
const nn = (type) => ({ type, nullable: true });

const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    error: { type: 'string', enum: ['none', 'logged_out', 'blocked', 'location_needed'] },
    delivery_address: nn('string'),
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          found: { type: 'boolean' },
          results: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pack: nn('string'), price: { type: 'number' }, mrp: nn('number'), in_stock: { type: 'boolean' } }, required: ['name', 'price', 'in_stock'] } },
        },
        required: ['query', 'found', 'results'],
      },
    },
    fees_seen: { type: 'object', properties: { delivery_fee: nn('number'), free_delivery_above: nn('number'), handling_fee: nn('number'), small_cart_fee: nn('number'), small_cart_threshold: nn('number') } },
  },
  required: ['error', 'items'],
};

const CART_SCHEMA = {
  type: 'object',
  properties: {
    error: { type: 'string', enum: ['none', 'logged_out', 'blocked'] },
    removed_existing: { type: 'boolean' },
    lines: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, pack: nn('string'), qty: { type: 'number' }, price: { type: 'number' } }, required: ['name', 'qty', 'price'] } },
    item_total: nn('number'),
    delivery_fee: nn('number'),
    handling_fee: nn('number'),
    small_cart_fee: nn('number'),
    other_fees: nn('number'),
    grand_total: nn('number'),
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['error', 'lines'],
};

const queryFor = (it) => [it.brand && !it.name.includes(it.brand) ? it.brand : '', it.name, it.unit !== 'pc' ? fmtQty(it.quantity, it.unit) : ''].filter(Boolean).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function agentRun(ctx, label, body) {
  ctx.log(`${label}: agent started`, { tag: label });
  let run;
  try {
    run = await runAgent(body, {
      onEvent: (ev) => {
        if (ev.type === 'STREAMING_URL') ctx.log(`${label}: live view ready`, { tag: label, live: ev.streaming_url });
        if (ev.type === 'PROGRESS') ctx.log(`${label}: ${ev.purpose}`, { tag: label, progress: true });
      },
    });
  } catch (err) {
    run = { status: 'FAILED', error: { code: err.code, message: err.message } };
  }
  ctx.log(`${label}: agent finished (${run.steps ?? '?'} steps)`, { tag: label, liveEnd: true });
  ctx.usage('agentRuns');
  if (run.steps) ctx.usage('agentSteps', run.steps);
  return run;
}

const isLoggedIn = (app) => { const acc = accountFor(app); return !!(acc?.connectedAt && !acc.expired); };
// Every run goes through the app's own profile (created with proxy_country_code "IN"),
// logged in or not — that is how Agent runs get an Indian IP. Stealth on every run.
async function runBody(app, url, goal, schema) {
  const profileId = await ensureProfile(app);
  const body = { url, goal, output_schema: schema, browser_profile: 'stealth', agent_config: { max_duration_seconds: 540 }, use_profile: true, profile_id: profileId };
  return { body, loggedIn: isLoggedIn(app) };
}

// ---------- 1. collect prices on one app ----------
async function collectApp(ctx, app, items, pincode, setStatus) {
  const label = APP_NAMES[app];
  setStatus(app, { state: 'searching' });
  const list = items.map((it, i) => `   ${i + 1}. ${queryFor(it)}`).join('\n');
  const loggedIn = isLoggedIn(app);
  const { body } = await runBody(app, APP_HOME[app], `1. Wait for the page to fully load. Close any popup or banner.
2. Check the delivery address / location at the top of the page. Remember it as delivery_address.${loggedIn ? '' : ` If the app asks for a location, type the PIN code ${pincode} and pick the first suggestion. If it insists on login to see prices, return error "logged_out".`}
3. For each item in this list, do steps 4 to 6:
${list}
4. Click the search bar at the top, clear it, type the item name exactly as written, and press Enter.
5. Wait for results to load.
6. Note the first 3 results that match the item: product name, pack size as shown (e.g. "500 ml"), selling price, MRP if shown, and whether the ADD button is available (in_stock).
7. If you notice fee information anywhere (e.g. "Free delivery above ₹199", "Handling charge ₹4", "Small cart fee"), put it in fees_seen. Do not open the cart for this.
8. Do not add anything to the cart. ${NO_PAY}
If an item has no results, return it with "found": false and an empty results list.
If a login page blocks you, stop and return error "logged_out". If an access denied page or CAPTCHA appears, stop and return error "blocked". Otherwise error is "none".
Return JSON like this example:
{ "error": "none", "delivery_address": "Sector 7, Rohini", "items": [ { "query": "amul taaza milk 500 ml", "found": true, "results": [ { "name": "Amul Taaza Toned Fresh Milk", "pack": "500 ml", "price": 28, "mrp": 28, "in_stock": true } ] } ], "fees_seen": { "delivery_fee": 30, "free_delivery_above": 199 } }`, SEARCH_SCHEMA);

  const run = await agentRun(ctx, label, body);
  const r = run.result || {};
  const blocked = run.error?.code === 'SITE_BLOCKED' || r.error === 'blocked' || (run.status === 'COMPLETED' && detectBlock(run) === 'blocked');
  if (r.error === 'logged_out') {
    if (loggedIn) markExpired(app);
    setStatus(app, { state: 'logged_out', note: loggedIn ? 'Login expired — reconnect in Setup' : 'Needs login — connect in Setup' });
    return null;
  }
  let results = r.items;
  let source = 'agent';
  if (blocked || run.status !== 'COMPLETED' || !Array.isArray(results)) {
    ctx.log(`${label}: ${blocked ? 'blocked' : 'agent failed'} — trying a Browser scan instead`, { level: 'warn', tag: label });
    setStatus(app, { state: 'scanning' });
    results = await scanApp(ctx, app, items.map((it) => ({ itemId: it.id, query: queryFor(it) })), { label });
    source = 'scan';
    if (!results.some((x) => x.found)) { setStatus(app, { state: 'unavailable', note: 'Blocked — planning without this app' }); return null; }
  }
  // Map results back to items by position (the agent processes the list in order).
  const offers = {};
  items.forEach((it, i) => {
    const res = results.find((x) => x.itemId === it.id) || results[i] || { results: [] };
    offers[it.id] = buildOffers(it, app, res.results || []).map((o) => ({ ...o, source }));
  });
  const fs = source === 'agent' ? (r.fees_seen || {}) : {}; // a blocked run's fee hints are noise
  const fees = {
    ...knownFees()[app],
    ...(fs.delivery_fee > 0 ? { deliveryFee: fs.delivery_fee, source: 'seen on app' } : {}),
    ...(fs.free_delivery_above > 0 ? { freeDeliveryAbove: fs.free_delivery_above } : {}),
    ...(fs.handling_fee > 0 ? { handlingFee: fs.handling_fee } : {}),
    ...(fs.small_cart_fee > 0 ? { smallCartFee: fs.small_cart_fee } : {}),
    ...(fs.small_cart_threshold > 0 ? { smallCartThreshold: fs.small_cart_threshold } : {}),
  };
  const foundCount = Object.values(offers).filter((o) => o.length).length;
  setStatus(app, { state: 'done', found: foundCount, address: r.delivery_address || null, source, loggedIn });
  return { offers, fees, address: r.delivery_address };
}

// ---------- 3. fill one cart ----------
async function fillCart(ctx, app, lines, plannedFees) {
  const label = `${APP_NAMES[app]} cart`;
  if (!isLoggedIn(app)) return { app, state: 'not_connected', message: `Connect ${APP_NAMES[app]} in Setup so I can fill the cart on your account.` };
  const products = lines.map((l, i) => `   ${i + 1}. "${l.productName}"${l.packLabel ? ` (${l.packLabel})` : ''} — quantity ${l.packs}`).join('\n');
  const { body } = await runBody(app, APP_HOME[app], `1. Wait for the page to fully load. Close any popup or banner.
2. Open the cart. If it has any items, remove all of them and remember that you did (removed_existing).
3. For each product below, search for it, find the result whose name and pack size match exactly, and click ADD. Use the + button until the quantity matches.
${products}
4. Open the cart. Wait for the bill summary to load.
5. Note every line item (name, pack, qty, price), the item total, delivery fee, handling fee, small cart fee, any other fee, and the grand total ("To pay").
6. Stop on the cart page. ${NO_PAY}
If a product is out of stock or no exact match exists, skip it and list it under "missing".
If a login page appears, stop and return error "logged_out". If an access denied page or CAPTCHA appears, stop and return error "blocked". Otherwise error is "none".`, CART_SCHEMA);
  const run = await agentRun(ctx, label, body);
  const r = run.result || {};
  if (r.error === 'logged_out') { markExpired(app); return { app, state: 'logged_out', message: `${APP_NAMES[app]} logged you out. Reconnect it in Setup.` }; }
  if (run.status !== 'COMPLETED' || r.error === 'blocked' || !Array.isArray(r.lines)) {
    return { app, state: 'error', message: `${APP_NAMES[app]}: couldn't fill the cart (${r.error === 'blocked' ? 'blocked' : run.error?.message || 'agent failed'}). Check the app before paying.` };
  }
  const plannedSub = lines.reduce((s, l) => s + l.price * l.packs, 0);
  const planned = +(plannedSub + feesFor(plannedFees, plannedSub).total).toFixed(2);
  const actual = r.grand_total ?? null;
  // Learn the real fees for next time.
  const learned = readJSON('fees.json', {});
  learned[app] = {
    ...knownFees()[app],
    ...(r.delivery_fee != null ? { deliveryFee: r.delivery_fee } : {}),
    ...(r.handling_fee != null ? { handlingFee: r.handling_fee } : {}),
    ...(r.small_cart_fee ? { smallCartFee: r.small_cart_fee, smallCartThreshold: Math.max(knownFees()[app].smallCartThreshold || 0, (r.item_total || 0) + 1) } : {}),
    ...(r.other_fees != null ? { otherFees: r.other_fees } : {}),
    source: 'read from your cart', learnedAt: Date.now(),
  };
  writeJSON('fees.json', learned);
  return { app, state: 'filled', planned, actual, diff: actual != null ? +(actual - planned).toFixed(2) : null, cart: r };
}

// ---------- the chore ----------
export async function jhola(ctx, input) {
  const items = (input.items || []).filter((i) => i && i.name).slice(0, 25);
  if (!items.length) return { status: 'needs_input', message: 'Type your list first, e.g. "doodh 2 packet, atta 5kg, maggi 4".' };
  const apps = (input.apps || APPS).filter((a) => APPS.includes(a));
  const pincode = String(input.pincode || '').replace(/\D/g, '').slice(0, 6);
  const status = Object.fromEntries(apps.map((a) => [a, { state: 'queued' }]));
  const setStatus = (app, s) => { status[app] = { ...status[app], ...s }; ctx.update({ basket: { items, apps, status } }); };
  ctx.update({ basket: { items, apps, status } });

  ctx.step('collect', `Checking ${apps.map((a) => APP_NAMES[a]).join(', ')} for ${items.length} item(s)`);
  // Staggered start (a few seconds apart); TinyFish queues anything over the concurrency limit.
  const collected = await Promise.all(apps.map(async (app, i) => { await sleep(i * 4000); return [app, await collectApp(ctx, app, items, pincode, setStatus)]; }));
  const offers = Object.fromEntries(items.map((it) => [it.id, {}]));
  const fees = {};
  const usable = [];
  for (const [app, res] of collected) {
    if (!res) continue;
    usable.push(app);
    fees[app] = res.fees;
    for (const it of items) offers[it.id][app] = res.offers[it.id] || [];
  }
  if (!usable.length) {
    ctx.step('done', 'No app returned prices.');
    return { status: 'failed', message: 'None of the apps returned prices (blocked or logged out). Check Setup and try again.', status_by_app: status };
  }

  ctx.step('plan', 'Your plan is ready — review and approve');
  const answer = await ctx.askApproval({ kind: 'basket_plan', items, offers, fees, apps: usable, status });
  if (!answer.approved) { ctx.step('done', 'Cancelled. Nothing was added to any cart.'); return { status: 'cancelled', message: 'You cancelled. No cart was touched.' }; }

  // Validate the approved plan against what we actually found.
  const plan = answer.data?.plan;
  const byApp = {};
  for (const l of plan?.lines || []) {
    const known = offers[l.itemId]?.[l.app]?.find((o) => o.productName === l.productName);
    if (!known) continue;
    (byApp[l.app] ||= []).push({ ...known, packs: Math.max(1, Math.min(Number(l.packs) || known.packs, 30)) });
  }
  const planFees = { ...fees, ...(answer.data?.fees || {}) };
  if (!Object.keys(byApp).length) return { status: 'needs_input', message: 'The approved plan was empty.' };

  ctx.step('fill', `Filling ${Object.keys(byApp).map((a) => APP_NAMES[a]).join(' + ')} cart(s) — stopping before payment`);
  const carts = await Promise.all(Object.entries(byApp).map(async ([app, lines], i) => { await sleep(i * 4000); return { ...(await fillCart(ctx, app, lines, planFees[app])), lines }; }));

  const off = carts.filter((c) => c.state === 'filled' && c.diff != null && Math.abs(c.diff) > 10);
  if (off.length) {
    ctx.step('check', 'Cart totals differ from the plan — please check');
    const again = await ctx.askApproval({ kind: 'cart_diff', carts: off.map((c) => ({ app: c.app, planned: c.planned, actual: c.actual, diff: c.diff })) });
    if (!again.approved) {
      ctx.step('done', 'Okay — don\'t pay yet. Your carts are filled for you to review.');
      return { status: 'partial', message: 'You chose not to go ahead with the new totals. The carts are filled but nothing is paid.', carts, plan };
    }
  }
  const filled = carts.filter((c) => c.state === 'filled');
  const msg = filled.length
    ? `Carts ready on ${filled.map((c) => APP_NAMES[c.app]).join(' + ')}. Pay in each app — Jhola never pays.`
    : 'No cart could be filled. See the notes below.';
  ctx.step('done', msg);
  return { status: filled.length === carts.length ? 'done' : filled.length ? 'partial' : 'needs_input', message: msg, carts, plan };
}
