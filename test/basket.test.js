import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePack, packsNeeded, classify, buildOffers, feesFor, optimise } from '../public/lib/basket.js';
import { parseList } from '../lib/basket/parse.js';

test('Hinglish list parsing', () => {
  const items = parseList('doodh 2 packet, atta 5kg, maggi 4, dhaniya');
  assert.deepEqual(items.map((i) => [i.name, i.quantity, i.unit]), [['milk', 1000, 'ml'], ['atta', 5000, 'g'], ['maggi', 4, 'pc'], ['coriander leaves', 1, 'pc']]);
  const [a] = parseList('sirf aashirvaad atta 10 kg');
  assert.equal(a.brand, 'aashirvaad');
  assert.equal(a.allowSubstitute, false);
  assert.equal(parseList('1 dozen ande')[0].quantity, 12);
});

test('pack sizes', () => {
  assert.deepEqual(parsePack('500 ml'), { size: 500, unit: 'ml', count: 1 });
  assert.deepEqual(parsePack('1 kg'), { size: 1000, unit: 'g', count: 1 });
  assert.deepEqual(parsePack('4 x 70 g'), { size: 280, unit: 'g', count: 4 });
  assert.deepEqual(parsePack('6 pieces'), { size: 6, unit: 'pc', count: 6 });
  assert.equal(parsePack('1 L').size, 1000);
});

test('packs needed and match kinds', () => {
  const milk = { name: 'milk', quantity: 1000, unit: 'ml', brand: null, allowSubstitute: true };
  assert.equal(packsNeeded(milk, parsePack('500 ml')), 2);
  assert.equal(packsNeeded(milk, parsePack('1 L')), 1);
  const eggs = { name: 'eggs', quantity: 12, unit: 'pc' };
  assert.equal(packsNeeded(eggs, parsePack('6 pcs')), 2);
  const atta = { name: 'aashirvaad atta', quantity: 5000, unit: 'g', brand: 'aashirvaad' };
  assert.equal(classify(atta, 'Aashirvaad Shudh Chakki Atta', parsePack('5 kg')), 'exact');
  assert.equal(classify(atta, 'Aashirvaad Shudh Chakki Atta', parsePack('2 kg')), 'size_variant');
  assert.equal(classify(atta, 'Fortune Chakki Fresh Atta', parsePack('5 kg')), 'substitute');
});

test('no-substitute items drop substitutes', () => {
  const item = { id: 'a', name: 'amul butter', quantity: 100, unit: 'g', brand: 'amul', allowSubstitute: false };
  const offers = buildOffers(item, 'blinkit', [{ name: 'Amul Butter', pack: '100 g', price: 58 }, { name: 'Mother Dairy Butter', pack: '100 g', price: 50 }]);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].productName, 'Amul Butter');
});

test('fees: delivery, small cart threshold', () => {
  const r = { deliveryFee: 30, freeDeliveryAbove: 199, handlingFee: 4, smallCartFee: 20, smallCartThreshold: 99 };
  assert.equal(feesFor(r, 50).total, 54);
  assert.equal(feesFor(r, 150).total, 34);
  assert.equal(feesFor(r, 250).total, 4);
  assert.equal(feesFor(r, 0).total, 0);
});

const offer = (app, itemId, price) => ({ app, itemId, productName: `${itemId}@${app}`, lineCost: price, packs: 1, price });
const FEES = {
  blinkit: { deliveryFee: 30, freeDeliveryAbove: 200, handlingFee: 4 },
  zepto: { deliveryFee: 30, freeDeliveryAbove: 200, handlingFee: 4 },
  instamart: { deliveryFee: 30, freeDeliveryAbove: 200, handlingFee: 4 },
};

test('a split wins when it beats the best single app after fees', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const offers = {
    a: { blinkit: [offer('blinkit', 'a', 300)], zepto: [offer('zepto', 'a', 400)] },
    b: { blinkit: [offer('blinkit', 'b', 400)], zepto: [offer('zepto', 'b', 250)] },
  };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  assert.deepEqual(r.best.apps, ['blinkit', 'zepto']);
  assert.equal(r.best.total, 300 + 250 + 8);
  assert.equal(r.bestSingle.total, 654); // zepto 650 + 4
  assert.equal(r.savings, 96);
});

test('fees pull small items onto one app', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const offers = {
    a: { blinkit: [offer('blinkit', 'a', 100)], zepto: [offer('zepto', 'a', 110)] },
    b: { blinkit: [offer('blinkit', 'b', 52)], zepto: [offer('zepto', 'b', 50)] },
  };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  assert.deepEqual(r.best.apps, ['blinkit']); // splitting would pay two delivery fees
  assert.equal(r.best.total, 152 + 34);
});

test('local search moves an item to cross the free-delivery threshold', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const offers = {
    a: { blinkit: [offer('blinkit', 'a', 190)], zepto: [offer('zepto', 'a', 300)] },
    b: { blinkit: [offer('blinkit', 'b', 15)], zepto: [offer('zepto', 'b', 12)] },
    c: { blinkit: [offer('blinkit', 'c', 400)], zepto: [offer('zepto', 'c', 250)] },
  };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  const bLine = r.best.lines.find((l) => l.itemId === 'b');
  assert.equal(bLine.app, 'blinkit'); // ₹3 dearer, but saves the ₹30 delivery fee on Blinkit
  assert.equal(r.best.total, 190 + 15 + 250 + 8);
});

test('missing items, forced app and dropped items', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const offers = { a: { blinkit: [offer('blinkit', 'a', 300)], zepto: [offer('zepto', 'a', 280)] }, b: { blinkit: [offer('blinkit', 'b', 100)] } };
  const all = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'] });
  assert.equal(all.best.covered, 2);
  const zeptoOnly = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'], onlyApps: ['zepto'] });
  assert.deepEqual(zeptoOnly.best.missing, ['b']);
  const dropped = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'zepto'], dropped: ['b'] });
  assert.deepEqual(dropped.best.apps, ['zepto']);
});

test('ties within ₹5 go to the better-rated app', () => {
  const items = [{ id: 'a' }];
  const offers = { a: { blinkit: [offer('blinkit', 'a', 302)], instamart: [offer('instamart', 'a', 300)] } };
  const r = optimise({ items, offers, fees: FEES, apps: ['blinkit', 'instamart'] });
  assert.deepEqual(r.best.apps, ['blinkit']);
});
