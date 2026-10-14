// Uses the TinyFish Browser API (remote Chromium over CDP) to capture an
// independent screenshot of a page — visual proof of what the agent reported,
// taken from a fresh session in the shopper's country.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createBrowser, closeBrowser } from './tinyfish.js';
import { DATA_DIR } from './store.js';

export async function captureProof(ctx, url, { country } = {}) {
  const started = Date.now();
  let session;
  let browser;
  try {
    session = await createBrowser({
      url,
      timeout_seconds: 120,
      ...(country ? { proxy_config: { country_code: country } } : {}),
    });
    browser = await chromium.connectOverCDP(session.cdp_url, { timeout: 60000 });
    const context = browser.contexts()[0];
    const page = context.pages().find((p) => p.url() !== 'about:blank') || context.pages()[0] || (await context.newPage());
    if (page.url() === 'about:blank') await page.goto(url, { timeout: 45000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3500);
    const file = `${randomUUID()}.jpg`;
    await page.screenshot({ path: path.join(DATA_DIR, 'shots', file), type: 'jpeg', quality: 70 });
    const title = await page.title().catch(() => '');
    return { ok: true, shot: `/shots/${file}`, title, finalUrl: page.url(), at: new Date().toISOString() };
  } catch (err) {
    ctx.log(`Proof screenshot failed: ${err.message.split('\n')[0]}`, { level: 'warn' });
    return { ok: false, error: err.message };
  } finally {
    await browser?.close().catch(() => {});
    if (session) await closeBrowser(session.session_id);
    ctx.usage('browserSeconds', Math.round((Date.now() - started) / 1000));
  }
}
