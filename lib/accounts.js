// Connected grocery-app accounts (TinyFish Browser Context Profiles, India proxy).
//
// The shopper logs in ONCE through Jhola's window: a remote TinyFish browser
// whose screen is streamed here as screenshots, with clicks and keys forwarded.
// The phone number and OTP are typed by the person straight into the app's own
// page — Jhola never stores them. TinyFish saves the cookies to a profile that
// later Agent runs reuse (use_profile + profile_id). The same window is reused
// for the payment hand-off: the person pays inside their own logged-in session.
import { chromium } from 'playwright-core';
import * as tf from './tinyfish.js';
import { readJSON, writeJSON } from './store.js';

const FILE = 'accounts.json';
export const APP_HOME = {
  blinkit: 'https://blinkit.com/',
  zepto: 'https://www.zeptonow.com/',
  instamart: 'https://www.swiggy.com/instamart',
};
const sessions = new Map(); // sessionId -> { app, profileId, browser, page, expiresAt, purpose }

export const listAccounts = () => readJSON(FILE, {});
export const accountFor = (app) => listAccounts()[app] || null;

export function markExpired(app) {
  const all = listAccounts();
  if (all[app]) { all[app].expired = true; writeJSON(FILE, all); }
}

export async function ensureProfile(app) {
  const all = listAccounts();
  if (all[app]?.profileId) return all[app].profileId;
  const p = await tf.createProfile({ name: `Jhola · ${app}`, proxy_country_code: 'IN' });
  all[app] = { profileId: p.id, connectedAt: null };
  writeJSON(FILE, all);
  return p.id;
}

export async function openWindow(app, { url, purpose = 'login' } = {}) {
  if (!APP_HOME[app]) throw Object.assign(new Error('Unknown app'), { status: 400 });
  const profileId = await ensureProfile(app);
  const start = url || APP_HOME[app];
  const s = await tf.startProfileSetup(profileId, { url: start, timeout_seconds: 900 });
  const browser = await chromium.connectOverCDP(s.cdp_url, { timeout: 60000 });
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url() !== 'about:blank') || ctx.pages()[0] || (await ctx.newPage());
  await page.setViewportSize({ width: 1000, height: 700 }).catch(() => {});
  if (page.url() === 'about:blank') await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  ctx.on('page', (np) => { const e = sessions.get(s.session_id); if (e) e.page = np; });
  sessions.set(s.session_id, { app, profileId, browser, page, expiresAt: s.expires_at, purpose });
  return { sessionId: s.session_id, expiresAt: s.expires_at, width: 1000, height: 700 };
}

function get(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) throw Object.assign(new Error('This window has closed or expired. Open it again.'), { status: 410 });
  return s;
}

export async function frame(sessionId) {
  const s = get(sessionId);
  return { buf: await s.page.screenshot({ type: 'jpeg', quality: 60, timeout: 15000 }), url: s.page.url() };
}

const KEYS = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Delete'];
export async function input(sessionId, ev) {
  const { page } = get(sessionId);
  if (ev.type === 'click') await page.mouse.click(Number(ev.x), Number(ev.y));
  else if (ev.type === 'type') await page.keyboard.type(String(ev.text || '').slice(0, 200), { delay: 25 });
  else if (ev.type === 'key' && KEYS.includes(ev.key)) await page.keyboard.press(ev.key);
  else if (ev.type === 'scroll') await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, Number(ev.dy) || 0)));
  else if (ev.type === 'back') await page.goBack({ timeout: 15000 }).catch(() => {});
  return { ok: true };
}

export async function closeWindow(sessionId, save) {
  const s = get(sessionId);
  sessions.delete(sessionId);
  let result = null;
  try {
    if (save) result = await tf.saveProfileSetup(s.profileId, sessionId);
    else await tf.cancelProfileSetup(s.profileId, sessionId);
  } finally {
    await s.browser.close().catch(() => {});
  }
  if (save) {
    const all = listAccounts();
    all[s.app] = { ...all[s.app], profileId: s.profileId, connectedAt: Date.now(), expired: false, cookies: result?.cookie_count ?? null };
    writeJSON(FILE, all);
  }
  return { ok: true, app: s.app, saved: !!save, cookies: result?.cookie_count ?? null };
}

export async function disconnect(app) {
  const all = listAccounts();
  if (all[app]?.profileId) await tf.deleteProfile(all[app].profileId).catch(() => null);
  delete all[app];
  writeJSON(FILE, all);
  return { ok: true };
}
