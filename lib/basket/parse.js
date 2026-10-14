// Hinglish / loose grocery list → structured items, no LLM needed.
//   "doodh 2 packet, atta 5kg, maggi 4, dhaniya"
//   → milk 2 × 500 ml · atta 5000 g · maggi 4 pc · coriander 1 pc
import { randomUUID } from 'node:crypto';

// Hindi/Hinglish grocery words → the English name stores index by.
const HINGLISH = {
  doodh: 'milk', dudh: 'milk', dahi: 'curd', paneer: 'paneer', makhan: 'butter', ghee: 'ghee', chaas: 'buttermilk', lassi: 'lassi',
  anda: 'eggs', ande: 'eggs', anday: 'eggs', aata: 'atta', atta: 'atta', maida: 'maida', besan: 'besan', suji: 'sooji', sooji: 'sooji', rava: 'sooji',
  chawal: 'rice', chaawal: 'rice', dal: 'dal', daal: 'dal', 'toor dal': 'toor dal', 'arhar dal': 'toor dal', 'moong dal': 'moong dal', 'masoor dal': 'masoor dal', 'chana dal': 'chana dal', rajma: 'rajma', chana: 'chana', chole: 'kabuli chana', poha: 'poha',
  cheeni: 'sugar', chini: 'sugar', shakkar: 'sugar', namak: 'salt', tel: 'oil', 'sarson tel': 'mustard oil', 'sarso ka tel': 'mustard oil', haldi: 'turmeric powder', mirch: 'chilli', 'lal mirch': 'red chilli powder', jeera: 'cumin seeds', rai: 'mustard seeds', 'garam masala': 'garam masala', chai: 'tea', 'chai patti': 'tea', patti: 'tea',
  aloo: 'potato', alu: 'potato', pyaz: 'onion', pyaaz: 'onion', kanda: 'onion', tamatar: 'tomato', tamatar: 'tomato', lehsun: 'garlic', lahsun: 'garlic', adrak: 'ginger', dhaniya: 'coriander leaves', dhania: 'coriander leaves', 'dhaniya powder': 'coriander powder', 'dhania powder': 'coriander powder', 'hara dhaniya': 'coriander leaves', pudina: 'mint', 'hari mirch': 'green chilli', nimbu: 'lemon', gobhi: 'cauliflower', 'patta gobhi': 'cabbage', bhindi: 'okra', baingan: 'brinjal', lauki: 'bottle gourd', palak: 'spinach', matar: 'peas', gajar: 'carrot', kheera: 'cucumber', kakdi: 'cucumber', shimla: 'capsicum', 'shimla mirch': 'capsicum',
  kela: 'banana', kele: 'banana', seb: 'apple', santra: 'orange', angoor: 'grapes', aam: 'mango', papita: 'papaya', tarbooz: 'watermelon',
  sabun: 'soap', 'kapde dhone ka powder': 'detergent powder', manjan: 'toothpaste', 'toothpaste': 'toothpaste', biskut: 'biscuits', biscuit: 'biscuits', namkeen: 'namkeen', double: 'bread', 'double roti': 'bread', pav: 'pav',
};

// Usual pack size when someone says "1 packet" of these.
const PACKET_SIZE = { milk: [500, 'ml'], curd: [400, 'g'], buttermilk: [500, 'ml'], butter: [100, 'g'], paneer: [200, 'g'] };

const BRANDS = ['amul', 'mother dairy', 'nandini', 'aashirvaad', 'ashirvaad', 'fortune', 'tata', 'tata sampann', 'maggi', 'yippee', 'parle', 'parle-g', 'britannia', 'haldiram', 'haldirams', 'nestle', 'saffola', 'patanjali', 'surf excel', 'ariel', 'tide', 'rin', 'vim', 'colgate', 'pepsodent', 'dettol', 'lifebuoy', 'lux', 'dove', 'vaseline', 'nivea', 'lays', "lay's", 'kurkure', 'cadbury', 'kissan', 'everest', 'mdh', 'catch', 'red label', 'taj mahal', 'brooke bond', 'bru', 'nescafe', 'dabur', 'harpic', 'lizol', 'good day', 'sunfeast', 'bingo', 'kellogg', "kellogg's", 'quaker', 'india gate', 'daawat', 'rajdhani', 'madhur', 'bisleri', 'kinley', 'coca cola', 'pepsi', 'sprite', 'thums up', 'real', 'tropicana', 'epigamia', 'milky mist', 'akshayakalpa', 'country delight', 'english oven', 'modern', 'harvest gold', 'del monte', 'heinz', 'chings', "ching's", 'knorr', 'top ramen', 'sunsilk', 'head and shoulders', 'clinic plus', 'pantene', 'gillette', 'whisper', 'stayfree', 'pampers', 'huggies', 'mamypoko'];

const WORD_NUM = { ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, half: 0.5, aadha: 0.5, dozen: 12, darjan: 12 };
const NUM = '(\\d+(?:\\.\\d+)?|' + Object.keys(WORD_NUM).join('|') + ')';
const toNum = (s) => (/^\d/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()] ?? 1);
const MASS = { kg: 1000, kilo: 1000, kilos: 1000, g: 1, gm: 1, gms: 1, gram: 1, grams: 1 };
const VOL = { l: 1000, ltr: 1000, litre: 1000, liter: 1000, litres: 1000, liters: 1000, ml: 1 };
const COUNT = ['packet', 'packets', 'pkt', 'pkts', 'pack', 'packs', 'pc', 'pcs', 'piece', 'pieces', 'bottle', 'bottles', 'box', 'boxes', 'jar', 'jars', 'bar', 'bars', 'tin', 'tins', 'can', 'cans', 'bunch', 'bunches', 'gaddi', 'unit', 'units', 'nos', 'no', 'x'];
const UNIT_RE = new RegExp(`(?:^|\\s)${NUM}\\s*(${[...Object.keys(MASS), ...Object.keys(VOL)].join('|')})\\b`, 'i');
const COUNT_RE = new RegExp(`(?:^|\\s)${NUM}\\s*(${COUNT.join('|')})\\b`, 'i');
const BARE_RE = new RegExp(`(?:^|\\s)${NUM}(?=\\s|$)`, 'i');

const KEEP_AND = ['head and shoulders', 'salt and pepper', 'bread and butter', 'mac and cheese'];

export function splitList(text) {
  let t = String(text || '');
  KEEP_AND.forEach((k, i) => { t = t.replace(new RegExp(k, 'gi'), `__K${i}__`); });
  return t.split(/\s*(?:,|;|\n|\+|&|\band\b|\baur\b|\bplus\b)\s*/i)
    .map((p) => p.replace(/__K(\d+)__/g, (_, i) => KEEP_AND[i]).trim())
    .map((p) => p.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim()) // list bullets "1. ", "- "
    .filter((p) => p.length > 1);
}

function translate(name) {
  let n = ` ${name.toLowerCase()} `;
  const keys = Object.keys(HINGLISH).sort((a, b) => b.length - a.length);
  for (const k of keys) n = n.replace(new RegExp(`\\s${k}\\s`, 'g'), ` ${HINGLISH[k]} `);
  return n.trim().replace(/\s+/g, ' ');
}

export function parseItem(raw) {
  let s = ` ${raw.toLowerCase().replace(/[()]/g, ' ')} `;
  let allowSubstitute = true;
  if (/\b(only|no substitutes?|no substitute|exact|sirf)\b/.test(s)) { allowSubstitute = false; s = s.replace(/\b(only|no substitutes?|exact|sirf)\b/g, ' '); }
  let quantity = 1;
  let unit = 'pc';
  let m;
  if ((m = s.match(UNIT_RE))) {
    const n = toNum(m[1]); const u = m[2].toLowerCase();
    if (MASS[u]) { quantity = n * MASS[u]; unit = 'g'; } else { quantity = n * VOL[u]; unit = 'ml'; }
    s = s.replace(m[0], ' ');
    // "2 x 500ml" / "2 packet 500ml" → multiply
    const c = s.match(COUNT_RE) || s.match(BARE_RE);
    if (c) { quantity *= toNum(c[1]); s = s.replace(c[0], ' '); }
  } else if ((m = s.match(COUNT_RE))) {
    quantity = toNum(m[1]); s = s.replace(m[0], ' ');
  } else if ((m = s.match(BARE_RE))) {
    quantity = toNum(m[1]); s = s.replace(m[0], ' ');
  }
  let name = translate(s.replace(/\b(of|ka|ki|ke|wala|wali|packet|pack|pcs?|dozen|darjan)\b/g, ' ').replace(/\s+/g, ' ').trim());
  if (/\b(dozen|darjan)\b/i.test(raw) && quantity < 12) quantity = 12 * Math.max(1, quantity);
  // "doodh 2 packet" → 2 × 500 ml
  if (unit === 'pc' && PACKET_SIZE[name] && /packet|pkt|pack/i.test(raw)) { const [size, u] = PACKET_SIZE[name]; quantity *= size; unit = u; }
  const brand = BRANDS.filter((b) => new RegExp(`(^|\\s)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(name)).sort((a, b) => b.length - a.length)[0] || null;
  quantity = Math.max(unit === 'pc' ? 1 : 1, Math.min(quantity, unit === 'pc' ? 30 : 50000));
  return { id: randomUUID().slice(0, 8), raw: raw.trim(), name: name || raw.trim(), quantity, unit, brand, allowSubstitute };
}

export const parseList = (text) => splitList(text).map(parseItem).filter((i) => i.name.length > 1).slice(0, 25);

// Human-friendly quantity: "2 × 500 ml" is shown as "1 L", 5000 g as "5 kg".
export function fmtQty(q, unit) {
  if (unit === 'g') return q >= 1000 ? `${+(q / 1000).toFixed(2)} kg` : `${q} g`;
  if (unit === 'ml') return q >= 1000 ? `${+(q / 1000).toFixed(2)} L` : `${q} ml`;
  return `${q}`;
}
