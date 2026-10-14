// Thin REST client for the TinyFish APIs Errand uses:
// Search, Fetch, Agent (SSE + runs), Browser (CDP sessions) and Browser Context Profiles.
// Every call retries transient failures (429 / 5xx / network) with backoff.

const AGENT = 'https://agent.tinyfish.ai';
const SEARCH = 'https://api.search.tinyfish.ai';
const FETCH = 'https://api.fetch.tinyfish.ai';
const BROWSER = 'https://api.browser.tinyfish.ai';

// Agent proxy only supports these exit countries.
export const AGENT_PROXY_COUNTRIES = ['US', 'GB', 'CA', 'DE', 'FR', 'JP', 'AU'];
export const AGENT_COST_PER_STEP = 0.016;
export const BROWSER_COST_PER_MIN = 0.002;

export class TinyFishError extends Error {
  constructor(message, { status, code, details, retryAfter } = {}) {
    super(message);
    this.name = 'TinyFishError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

function apiKey() {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) throw new TinyFishError('TINYFISH_API_KEY is not set. Add it to .env or your shell.', { code: 'MISSING_API_KEY' });
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE = new Set([409, 429, 500, 502, 503, 504]);

async function request(url, { method = 'GET', body, timeoutMs = 60000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 204) return null;
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (res.ok) return data;
      const e = data?.error || {};
      const retryAfter = Number(res.headers.get('retry-after')) || e.retry_after || null;
      lastErr = new TinyFishError(e.message || `HTTP ${res.status}`, { status: res.status, code: e.code, details: e.details, retryAfter });
      if (!RETRYABLE.has(res.status) || attempt === retries) throw lastErr;
      await sleep((retryAfter ? retryAfter * 1000 : 1500 * 2 ** attempt));
    } catch (err) {
      if (err instanceof TinyFishError && (!RETRYABLE.has(err.status) || attempt === retries)) throw err;
      lastErr = err instanceof TinyFishError ? err : new TinyFishError(`Network error: ${err.message}`, { code: 'NETWORK' });
      if (attempt === retries) throw lastErr;
      await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

// ---------- Search ----------
export async function search(query, opts = {}) {
  const params = new URLSearchParams({ query });
  for (const [k, v] of Object.entries(opts)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  return request(`${SEARCH}?${params}`, { timeoutMs: 20000 });
}

// ---------- Fetch ----------
export async function fetchPages(urls, opts = {}) {
  return request(FETCH, {
    method: 'POST',
    timeoutMs: 150000,
    retries: 1,
    body: { urls: urls.slice(0, 10), format: 'markdown', ...opts },
  });
}

// ---------- Agent ----------
// Streams an automation run. Calls onEvent for every SSE event.
// Resolves with { run_id, status, result, error, streaming_url, steps }.
export async function runAgent(body, { onEvent = () => {}, signal } = {}) {
  const res = await fetch(`${AGENT}/v1/automation/run-sse`, {
    method: 'POST',
    headers: { 'X-API-Key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let e = {};
    try { e = (await res.json()).error || {}; } catch {}
    throw new TinyFishError(e.message || `Agent HTTP ${res.status}`, { status: res.status, code: e.code });
  }

  const out = { run_id: null, status: null, result: null, error: null, streaming_url: null, steps: null };
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.run_id) out.run_id = ev.run_id;
        if (ev.type === 'STREAMING_URL') out.streaming_url = ev.streaming_url;
        if (ev.type === 'COMPLETE') {
          out.status = ev.status;
          out.result = ev.result ?? null;
          out.error = ev.error ?? null;
        }
        if (ev.type !== 'HEARTBEAT') onEvent(ev);
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    // Stream dropped: SSE has no resume, so poll the run until it finishes.
  }

  if (!out.status && out.run_id) {
    const run = await waitForRun(out.run_id, { signal });
    Object.assign(out, { status: run.status, result: run.result, error: run.error });
  }
  if (out.run_id) {
    try { out.steps = (await getRun(out.run_id)).num_of_steps ?? null; } catch {}
  }
  return out;
}

export const getRun = (id) => request(`${AGENT}/v1/runs/${id}`, { timeoutMs: 20000 });
export const cancelRun = (id) => request(`${AGENT}/v1/runs/${id}/cancel`, { method: 'POST', retries: 1 });

export async function waitForRun(id, { signal, timeoutMs = 10 * 60000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (signal?.aborted) throw new Error('aborted');
    const run = await getRun(id);
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) return run;
    await sleep(4000);
  }
  throw new TinyFishError('Run did not finish in time', { code: 'TIMEOUT' });
}

// ---------- Browser ----------
export const createBrowser = (body) => request(BROWSER, { method: 'POST', body, timeoutMs: 90000 });
export const closeBrowser = (id) => request(`${BROWSER}/${id}`, { method: 'DELETE', retries: 2 }).catch(() => null);

// ---------- Wallet ----------
export const getWallet = () => request(`${AGENT}/v1/wallet`, { timeoutMs: 15000 });


// ---------- Browser Context Profiles (saved logins) ----------
export const createProfile = (body) => request(`${AGENT}/v1/profiles`, { method: 'POST', body });
export const deleteProfile = (id) => request(`${AGENT}/v1/profiles/${id}`, { method: 'DELETE' });
export const startProfileSetup = (id, body) => request(`${AGENT}/v1/profiles/${id}/setup-session`, { method: 'POST', body, timeoutMs: 90000 });
export const saveProfileSetup = (id, sessionId) => request(`${AGENT}/v1/profiles/${id}/save`, { method: 'POST', body: { session_id: sessionId }, timeoutMs: 60000 });
export const cancelProfileSetup = (id, sessionId) => request(`${AGENT}/v1/profiles/${id}/setup-session/cancel`, { method: 'POST', body: { session_id: sessionId } }).catch(() => null);
