// Turns one free-text sentence into an order plan, no LLM needed:
//   "i wanna order 2 amul butter and a dozen eggs from blinkit"
//   → { store: 'blinkit.com', items: [{ name: 'amul butter', qty: 2 }, { name: '12 eggs', qty: 1 }] }
import { resolveStore } from './stores.js';

const STORE_WORDS = {
  blinkit: 'blinkit', zepto: 'zepto', 'swiggy instamart': 'instamart', instamart: 'instamart', swiggy: 'instamart',
  bigbasket: 'bigbasket', 'big basket': 'bigbasket', amazon: 'amazon', flipkart: 'flipkart', jiomart: 'jiomart',
  'jio mart': 'jiomart', '1mg': '1mg', 'tata 1mg': '1mg', nykaa: 'nykaa', myntra: 'myntra', croma: 'croma',
};
const LEAD = /^(hey|hi|hello|please|pls|plz|kindly|can you|could you|i\s*(want|wanna|need|would like|'d like)\s*(to)?|i'm looking for|get me|send me|buy me|bring me|order|buy|get|deliver|purchase|me)\b[\s,]*/i;
const TAIL = /\b(please|pls|plz|asap|quickly|for me|right now|now|today|thanks|thank you)\b[\s.!]*$/i;
const KEEP_AND = ['head and shoulders', 'johnson and johnson', 'marks and spencer', 'mac and cheese', 'salt and pepper', 'bread and butter', 'h and m', 'ben and jerry', 'tom and jerry', 'dolce and gabbana'];
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, 'a couple of': 2, pair: 2 };
const UNIT = /^(kg|kgs|g|gm|gms|gram|grams|l|ltr|litre|litres|liter|liters|ml|pc|pcs|piece|pieces|dozen|tablets?|capsules?|inch|cm|mm|gb|tb|mah|w)\b/i;

function detectStore(text) {
  const lower = ` ${text.toLowerCase()} `;
  const keys = Object.keys(STORE_WORDS).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const re = new RegExp(`\\s(?:(?:from|on|at|via|using|through|in)\\s+)?${k.replace(/ /g, '\\s+')}(?:'s)?(?:\\s+(?:app|website|site|store))?(?=[\\s,.!?])`, 'i');
    const m = lower.match(re);
    if (m) return { word: STORE_WORDS[k], cleaned: lower.replace(re, ' ').trim() };
  }
  // A website the user typed directly: "from dmart.in"
  const site = lower.match(/\s(?:from|on|at|via)\s+((?:www\.)?[a-z0-9-]+\.[a-z.]{2,})(?=[\s,.!?])/i);
  if (site) return { word: site[1], cleaned: lower.replace(site[0], ' ').trim() };
  return { word: null, cleaned: text.trim() };
}

function splitItems(text) {
  let t = text;
  KEEP_AND.forEach((k, i) => { t = t.replace(new RegExp(k, 'gi'), `__KEEP${i}__`); });
  const parts = t.split(/\s*(?:,|;|\n|\+|&|\band\b|\balso\b|\bplus\b|\bwith\b(?=\s+\d))\s*/i);
  return parts.map((p) => p.replace(/__KEEP(\d+)__/g, (_, i) => KEEP_AND[i])).map((p) => p.trim()).filter(Boolean);
}

function parseQty(raw) {
  let s = raw.replace(/^(some|any|the)\s+/i, '').trim();
  let qty = 1;
  // trailing "x2" / "× 3" / "(2)"
  const tail = s.match(/\s*(?:x|×|\*)\s*(\d{1,2})$|\s*\((\d{1,2})\)$/i);
  if (tail) { qty = Number(tail[1] || tail[2]); s = s.slice(0, tail.index).trim(); }
  const dozen = s.match(/^(?:a\s+|one\s+)?dozen\s+(.+)/i);
  if (dozen) return { name: `12 ${dozen[1]}`, qty };
  const lead = s.match(/^(\d{1,3}|a couple of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|pair)\s+(.+)$/i);
  if (lead && !UNIT.test(lead[2])) {
    qty = /^\d/.test(lead[1]) ? Number(lead[1]) : WORD_NUM[lead[1].toLowerCase()] || 1;
    s = lead[2].replace(/^(packs?|packets?|bottles?|boxes?|units?|pcs|pieces|jars?|tins?|cans?|bags?)\s+of\s+/i, '').replace(/^of\s+/i, '');
  }
  return { name: s.replace(/[.!?]+$/, '').trim(), qty: Math.max(1, Math.min(qty, 20)) };
}

export function parseOrder(text, country = 'IN') {
  const original = String(text || '').trim();
  const { word, cleaned } = detectStore(original);
  let body = cleaned.replace(/\s+/g, ' ');
  for (let i = 0; i < 4; i++) body = body.replace(LEAD, '').trim();
  body = body.replace(TAIL, '').trim();
  const items = splitItems(body).map(parseQty).filter((it) => it.name && it.name.length > 1);
  return { store: word ? resolveStore(word, country) : null, items, original };
}
