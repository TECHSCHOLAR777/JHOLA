// Fallback price scan with the TinyFish Browser API (India proxy, Playwright
// over CDP). Used when an Agent search run is blocked: it opens each app's
// search results page and reads product tiles from the page text. Scripted and
// cheap (billed per browser-minute), but less reliable than the agent, so its
// results are marked as "scan".
import { chromium } from 'playwright-core';
import { createBrowser, closeBrowser } from '../tinyfish.js';

const SEARCH = {
  blinkit: (q) => `https://blinkit.com/s/?q=${encodeURIComponent(q)}`,
  zepto: (q) => `https://www.zeptonow.com/search?query=${encodeURIComponent(q)}`,
  instamart: (q) => `https://www.swiggy.com/instamart/search?query=${encodeURIComponent(q)}`,
};
const PACK = /(\d+(?:\.\d+)?\s*(?:kg|g|gm|ml|l|ltr|litre|pcs?|pieces?|units?)\b|\d+\s*[x×]\s*\d+\s*(?:g|ml))/i;
const PRICE = /^₹\s?(\d[\d,]*(?:\.\d+)?)$/;

// Product tiles render as short lines: [discount] name, pack, ₹price, [₹mrp], ADD
export function tilesFromText(text, limit = 3) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    if (!/^add$/i.test(lines[i])) continue;
    const window = lines.slice(Math.max(0, i - 6), i);
    const prices = window.map((l) => l.match(PRICE)).filter(Boolean).map((m) => Number(m[1].replace(/,/g, '')));
    const pack = window.find((l) => PACK.test(l) && l.length < 25);
    const name = window.filter((l) => !PRICE.test(l) && l !== pack && !/% ?off|mins?$|^\d+$/i.test(l) && l.length > 3).sort((a, b) => b.length - a.length)[0];
    if (!name || !prices.length) continue;
    out.push({ name, pack: pack || '', price: Math.min(...prices), mrp: prices.length > 1 ? Math.max(...prices) : null, in_stock: true });
  }
  return out;
}

export async function scanApp(ctx, app, items, { label }) {
  const started = Date.now();
  let session; let browser;
  const found = [];
  try {
    session = await createBrowser({ timeout_seconds: 300, proxy_config: { country_code: 'IN' } });
    browser = await chromium.connectOverCDP(session.cdp_url, { timeout: 60000 });
    const page = browser.contexts()[0].pages()[0] || (await browser.contexts()[0].newPage());
    for (const it of items) {
      ctx.log(`${label}: browser scan for "${it.query}"`, { tag: label });
      try {
        await page.goto(SEARCH[app](it.query), { waitUntil: 'domcontentloaded', timeout: 40000 });
        await page.waitForTimeout(4500);
        const text = await page.evaluate(() => document.body.innerText);
        const results = tilesFromText(text);
        found.push({ query: it.query, itemId: it.itemId, found: results.length > 0, results });
      } catch (e) {
        found.push({ query: it.query, itemId: it.itemId, found: false, results: [] });
      }
    }
  } catch (err) {
    ctx.log(`${label}: browser scan failed (${err.message.split('\n')[0]})`, { tag: label, level: 'warn' });
  } finally {
    await browser?.close().catch(() => {});
    if (session) await closeBrowser(session.session_id);
    ctx.usage('browserSeconds', Math.round((Date.now() - started) / 1000));
  }
  return found;
}
