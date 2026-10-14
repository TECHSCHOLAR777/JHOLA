// Store directory shared by Price Hunt and Order.
// Store names people actually type → domains, plus each store's own search URL.
// Quick-commerce apps (Blinkit, Zepto, Instamart) are barely indexed by web
// search, so for any store the user names we also open its on-site search.
const AMAZON = { IN: 'amazon.in', US: 'amazon.com', GB: 'amazon.co.uk', CA: 'amazon.ca', DE: 'amazon.de', AU: 'amazon.com.au', JP: 'amazon.co.jp', FR: 'amazon.fr' };
const ALIASES = {
  amazon: (c) => AMAZON[c] || 'amazon.com', flipkart: 'flipkart.com', blinkit: 'blinkit.com', zepto: 'zeptonow.com', zeptonow: 'zeptonow.com',
  instamart: 'swiggy.com', swiggy: 'swiggy.com', swiggyinstamart: 'swiggy.com', bigbasket: 'bigbasket.com', croma: 'croma.com', reliance: 'reliancedigital.in',
  reliancedigital: 'reliancedigital.in', nykaa: 'nykaa.com', myntra: 'myntra.com', ajio: 'ajio.com', jiomart: 'jiomart.com',
  tatacliq: 'tatacliq.com', vijaysales: 'vijaysales.com', meesho: 'meesho.com', snapdeal: 'snapdeal.com', '1mg': '1mg.com',
  tata1mg: '1mg.com', pharmeasy: 'pharmeasy.in', decathlon: (c) => (c === 'IN' ? 'decathlon.in' : 'decathlon.com'),
  walmart: 'walmart.com', target: 'target.com', bestbuy: (c) => (c === 'CA' ? 'bestbuy.ca' : 'bestbuy.com'), costco: 'costco.com',
  ebay: 'ebay.com', newegg: 'newegg.com', argos: 'argos.co.uk', currys: 'currys.co.uk', apple: 'apple.com',
};
const q = encodeURIComponent;
const STORE_SEARCH = {
  'amazon.in': (t) => `https://www.amazon.in/s?k=${q(t)}`, 'amazon.com': (t) => `https://www.amazon.com/s?k=${q(t)}`,
  'amazon.co.uk': (t) => `https://www.amazon.co.uk/s?k=${q(t)}`, 'amazon.ca': (t) => `https://www.amazon.ca/s?k=${q(t)}`,
  'amazon.de': (t) => `https://www.amazon.de/s?k=${q(t)}`, 'amazon.com.au': (t) => `https://www.amazon.com.au/s?k=${q(t)}`,
  'flipkart.com': (t) => `https://www.flipkart.com/search?q=${q(t)}`,
  'blinkit.com': (t) => `https://blinkit.com/s/?q=${q(t)}`,
  'zeptonow.com': (t) => `https://www.zeptonow.com/search?query=${q(t)}`,
  'swiggy.com': (t) => `https://www.swiggy.com/instamart/search?query=${q(t)}`,
  'bigbasket.com': (t) => `https://www.bigbasket.com/ps/?q=${q(t)}`,
  'croma.com': (t) => `https://www.croma.com/searchB?q=${q(t)}%3Arelevance`,
  'reliancedigital.in': (t) => `https://www.reliancedigital.in/products?q=${q(t)}`,
  'nykaa.com': (t) => `https://www.nykaa.com/search/result/?q=${q(t)}`,
  'jiomart.com': (t) => `https://www.jiomart.com/search/${q(t)}`,
  'tatacliq.com': (t) => `https://www.tatacliq.com/search/?searchCategory=all&text=${q(t)}`,
  '1mg.com': (t) => `https://www.1mg.com/search/all?name=${q(t)}`,
  'walmart.com': (t) => `https://www.walmart.com/search?q=${q(t)}`,
  'target.com': (t) => `https://www.target.com/s?searchTerm=${q(t)}`,
  'bestbuy.com': (t) => `https://www.bestbuy.com/site/searchpage.jsp?st=${q(t)}`,
  'ebay.com': (t) => `https://www.ebay.com/sch/i.html?_nkw=${q(t)}`,
};

export function resolveStore(raw, country) {
  const s = String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*/, '');
  if (!s) return null;
  if (s.includes('.')) return s;
  const key = s.replace(/[^a-z0-9]/g, '');
  const a = ALIASES[key];
  if (a) return typeof a === 'function' ? a(country) : a;
  return `${key}.${country === 'IN' ? 'in' : 'com'}`; // best guess; the agent will tell us if it's wrong
}

// "blinkit, zepto" / "Blinkit and Amazon" / "swiggy instamart" / "amazon.in flipkart.com"
export function parseStores(text, country) {
  const parts = String(text || '').split(/[,;\n]+|\s+(?:and|&|or)\s+/i).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const whole = part.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (ALIASES[whole] || !/\s/.test(part)) out.push(resolveStore(part, country));
    else part.split(/\s+/).forEach((w) => out.push(resolveStore(w, country)));
  }
  return [...new Set(out.filter(Boolean))];
}

export const storeEntryUrl = (domain, product) => (STORE_SEARCH[domain] ? STORE_SEARCH[domain](product) : `https://www.${domain}/`);


// Friendly names for the UI and for messages to the shopper.
export const STORE_NAMES = {
  'blinkit.com': 'Blinkit', 'zeptonow.com': 'Zepto', 'swiggy.com': 'Swiggy Instamart', 'bigbasket.com': 'BigBasket',
  'amazon.in': 'Amazon', 'amazon.com': 'Amazon', 'flipkart.com': 'Flipkart', 'jiomart.com': 'JioMart', '1mg.com': 'Tata 1mg',
  'croma.com': 'Croma', 'reliancedigital.in': 'Reliance Digital', 'nykaa.com': 'Nykaa', 'myntra.com': 'Myntra',
};
export const storeName = (d) => STORE_NAMES[d] || d;
// Stores offered as caretaker defaults / quick picks.
export const ORDER_STORES = ['blinkit.com', 'zeptonow.com', 'swiggy.com', 'bigbasket.com', 'amazon.in', 'flipkart.com', 'jiomart.com', '1mg.com'];
