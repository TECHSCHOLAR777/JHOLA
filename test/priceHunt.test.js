import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.ERRAND_DATA_DIR = new URL('../data-test', import.meta.url).pathname;
const { parseStores, resolveStore, matchScore } = await import('../lib/chores/priceHunt.js');
const { isSensitiveField, detectBlock } = await import('../lib/safety.js');

test('store names resolve to real domains', () => {
  assert.deepEqual(parseStores('Blinkit', 'IN'), ['blinkit.com']);
  assert.deepEqual(parseStores('blinkit, zepto and Amazon', 'IN'), ['blinkit.com', 'zeptonow.com', 'amazon.in']);
  assert.deepEqual(parseStores('Swiggy Instamart', 'IN'), ['swiggy.com']);
  assert.deepEqual(parseStores('amazon flipkart', 'IN'), ['amazon.in', 'flipkart.com']);
  assert.deepEqual(parseStores('https://www.croma.com/x', 'IN'), ['croma.com']);
  assert.equal(resolveStore('amazon', 'US'), 'amazon.com');
  assert.deepEqual(parseStores('', 'IN'), []);
});

test('model numbers must match', () => {
  assert.ok(matchScore('Sony WH-1000XM5', 'Sony WH-1000XM5 Wireless Headphones') > 0.9);
  assert.ok(matchScore('Sony WH-1000XM5', 'Sony WH-1000XM4 Wireless Headphones') < 0.6);
});

test('sensitive fields are never auto-filled', () => {
  for (const f of ['Password', 'OTP', 'Card number', 'CVV', 'Aadhaar No', 'UPI ID']) assert.ok(isSensitiveField(f), f);
  for (const f of ['Full name', 'Email', 'Phone', 'PIN code']) assert.ok(!isSensitiveField(f), f);
});

test('COMPLETED-but-blocked runs are detected', () => {
  assert.equal(detectBlock({ status: 'COMPLETED', result: { page_status: 'captcha' } }), 'captcha');
  assert.equal(detectBlock({ status: 'COMPLETED', result: { message: 'Access denied' } }), 'blocked');
  assert.equal(detectBlock({ status: 'COMPLETED', result: { page_status: 'ok', price: 10 } }), null);
});
