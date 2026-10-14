// ORDER — "I want to order 2 Amul butter and eggs from Blinkit."
//
// 1. Parse the sentence into items + store (falls back to the caretaker's default stores).
// 2. For each item, search stores one at a time with the Agent. The moment a good
//    match is found, ask the shopper ONCE: "Is this it?" — yes stops the search.
// 3. Hand off: the confirmed products open on the store so the shopper adds them
//    to cart and pays (Cash on Delivery where offered). Errand doesn't pay.

import { smartRun } from '../agent.js';
import { READ_ONLY_RULES } from '../safety.js';
import { parseOrder } from '../orderParse.js';
import { storeEntryUrl, storeName } from '../stores.js';
import { matchScore } from './priceHunt.js';

const FIND_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    product_name: { type: 'string', nullable: true },
    pack_size: { type: 'string', nullable: true },
    price: { type: 'number', nullable: true },
    mrp: { type: 'number', nullable: true },
    currency: { type: 'string', nullable: true },
    in_stock: { type: 'boolean' },
    product_url: { type: 'string', nullable: true },
    image_url: { type: 'string', nullable: true },
    match: { type: 'string', enum: ['exact', 'close', 'none'] },
    why: { type: 'string', nullable: true },
    alternatives: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, price: { type: 'number', nullable: true } }, required: ['name'] } },
    page_status: { type: 'string', enum: ['ok', 'blocked', 'captcha', 'not_found', 'not_product_page'] },
  },
  required: ['found', 'in_stock', 'match', 'page_status'],
};

const addressLine = (p) => [p.address_line1, p.address_line2, p.landmark && `near ${p.landmark}`, p.city, p.state, p.pincode].filter(Boolean).join(', ');

async function findOnStore(ctx, item, store, profile) {
  const name = storeName(store);
  const goal = `You are shopping on ${name} for: ${item.qty} × "${item.name}".
1. If you are not already on a search results page, use the site's search to search for "${item.name}".
2. If the site asks for a delivery location, enter PIN code ${profile.pincode}${profile.city ? ` (${profile.city})` : ''} and pick the first matching area. This is not a login.
3. Look at the top results and pick the ONE product that best matches what the shopper asked for (brand, product type, and size/variant if stated). If no size is stated, prefer the most common standard pack.
4. Report it: product_name, pack_size, price for ONE unit (selling price, not MRP), mrp, currency (ISO code, e.g. INR), in_stock, product_url (open the product to get its URL if needed), image_url, match ("exact" = clearly what was asked; "close" = similar but different brand/size; "none" = nothing suitable), a short "why", and up to 2 alternatives with name and price.
Do NOT add anything to the cart.
${READ_ONLY_RULES}`;
  const run = await smartRun(ctx, {
    url: storeEntryUrl(store, item.name), goal, schema: FIND_SCHEMA, country: 'IN', label: name, maxSeconds: 200,
  });
  if (!run.ok) return { ok: false, reason: run.reason };
  const r = run.result || {};
  if (r.page_status !== 'ok' && !r.found) return { ok: false, reason: `${name}: ${String(r.page_status).replace(/_/g, ' ')}` };
  if (!r.found || r.match === 'none') return { ok: false, reason: `${name} doesn't seem to have "${item.name}"` };
  if (!r.in_stock) return { ok: false, reason: `${name}: ${r.product_name} is out of stock` };
  // Second opinion on "exact": the words the shopper typed should appear in the product name.
  const score = matchScore(item.name, `${r.product_name} ${r.pack_size || ''}`);
  const confidence = r.match === 'exact' && score >= 0.6 ? 'perfect' : 'close';
  return { ok: true, product: r, confidence, score };
}

// Hand-off: the shopper confirmed the exact product; Errand opens it on the store
// so they can add it to cart and pay (Cash on Delivery where offered) themselves.
function handoff(store, picks) {
  const name = storeName(store);
  const total = picks.reduce((t, p) => t + (p.product.price || 0) * p.item.qty, 0);
  return {
    store, storeName: name, status: 'ready', total, currency: picks[0].product.currency || 'INR',
    message: `Ready on ${name}: ${picks.map((p) => `${p.item.qty} × ${p.product.product_name}`).join(', ')}. Tap "Open on ${name}" to add to cart and choose Cash on Delivery.`,
  };
}

export async function order(ctx, input) {
  const profile = input.profile || {};
  const settings = input.settings || {};
  const plan = parseOrder(input.text, 'IN');
  if (!plan.items.length) return { status: 'needs_input', message: 'Tell me what to order, e.g. "2 Amul butter and 1 bread from Blinkit".' };
  const missing = ['full_name', 'phone', 'address_line1', 'pincode'].filter((k) => !profile[k]);
  if (missing.length) return { status: 'needs_input', message: 'Add your name, phone and delivery address in "Me" first, so I know where to send it.', missing };

  const stores = plan.store ? [plan.store] : (settings.defaultStores?.length ? settings.defaultStores : ['blinkit.com', 'amazon.in']);
  ctx.update({ plan: { ...plan, stores } });
  ctx.log(plan.store ? `Store: ${storeName(plan.store)}` : `No store mentioned — trying ${stores.map(storeName).join(', then ')}`);

  const picks = [];
  const notFound = [];
  for (const item of plan.items) {
    ctx.step('find', `Looking for ${item.qty} × ${item.name}`);
    let pick = null;
    let skipped = false;
    for (let i = 0; i < stores.length && !pick && !skipped; i++) {
      const store = stores[i];
      const found = await findOnStore(ctx, item, store, profile);
      if (!found.ok) { ctx.log(found.reason, { level: 'warn' }); continue; }
      const p = found.product;
      ctx.step('confirm', `Found it on ${storeName(store)} — waiting for your OK`);
      const answer = await ctx.askApproval({
        kind: 'order_match',
        item, store, storeName: storeName(store), product: p, confidence: found.confidence,
        address: addressLine(profile), payment: 'Cash on Delivery',
        moreStores: stores.slice(i + 1).map(storeName),
        message: found.confidence === 'perfect' ? 'I think this is a perfect match.' : 'This is the closest match I found.',
      });
      if (answer.approved) pick = { item, store, product: p };
      else if (answer.data?.action === 'skip') skipped = true;
      else ctx.log(`Okay, not that one. ${stores[i + 1] ? `Trying ${storeName(stores[i + 1])}…` : ''}`);
    }
    if (pick) { picks.push(pick); ctx.log(`✓ ${item.name}: ${pick.product.product_name} on ${storeName(pick.store)}`); }
    else notFound.push({ ...item, reason: skipped ? 'skipped by you' : 'no good match found' });
  }

  if (!picks.length) {
    ctx.step('done', 'Nothing to order.');
    return { status: 'needs_input', message: 'I couldn\'t find anything you approved, so nothing was ordered.', notFound, plan };
  }

  const byStore = new Map();
  for (const p of picks) byStore.set(p.store, [...(byStore.get(p.store) || []), p]);
  const orders = [];
  for (const [store, list] of byStore) orders.push({ ...handoff(store, list), items: list.map((p) => ({ name: p.product.product_name, qty: p.item.qty, price: p.product.price, image: p.product.image_url, url: p.product.product_url || storeEntryUrl(store, p.item.name) })) });

  const summary = orders.map((o) => o.message).join(' ');
  ctx.step('done', summary);
  return { status: notFound.length ? 'partial' : 'done', summary, orders, notFound, plan };
}
