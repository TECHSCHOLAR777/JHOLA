import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseOrder } = await import('../lib/orderParse.js');

const cases = [
  ['I wanna order 2 amul butter and a dozen eggs from blinkit', 'blinkit.com', [['amul butter', 2], ['12 eggs', 1]]],
  ['order Vaseline lip balm from Blinkit', 'blinkit.com', [['vaseline lip balm', 1]]],
  ['get me milk, bread and 3 maggi on zepto please', 'zeptonow.com', [['milk', 1], ['bread', 1], ['maggi', 3]]],
  ['Head and Shoulders shampoo from amazon', 'amazon.in', [['head and shoulders shampoo', 1]]],
  ['1 kg aashirvaad atta', null, [['1 kg aashirvaad atta', 1]]],
  ['i need two packets of parle g from swiggy instamart', 'swiggy.com', [['parle g', 2]]],
  ['Dolo 650 x2', null, [['dolo 650', 2]]],
];
for (const [text, store, items] of cases) {
  test(text, () => {
    const r = parseOrder(text, 'IN');
    assert.equal(r.store, store);
    assert.deepEqual(r.items.map((i) => [i.name.toLowerCase(), i.qty]), items);
  });
}
