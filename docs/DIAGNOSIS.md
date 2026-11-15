# Jhola: end-to-end diagnosis (2026-11-03)

Snapshot of `master` at `2935024`. Four read-only audits: core engine and TinyFish integration, UI/UX, deployment with a user-entered key, and product scope. Key findings were spot-checked against the code.

## 1. What the project is today

One Hinglish grocery list goes to Blinkit, Zepto and Instamart through TinyFish agents. Jhola works out the cheapest basket after fees, fills the real carts and stops at payment.

Pipeline:

1. **Parse** (`lib/basket/parse.js`): rule-based Hinglish to `{name, qty, unit, brand, allowSubstitute}`.
2. **Collect** (`lib/basket/jhola.js`): one Agent `run-sse` per app, 4 s apart, stealth, India-proxy profile.
3. **Fallback** (`lib/basket/scan.js`): Browser API session with India proxy, scrapes search-page text.
4. **Match** (`public/lib/basket.js`): pack sizes, packs needed, exact / size variant / substitute.
5. **Optimise** (in the browser): all 7 app subsets, items moved across fee thresholds.
6. **Approve** on the server, then **Fill**: one Agent run per app clears the cart, adds items, reads the bill.
7. **Check**: planned vs actual, ask again if more than ₹10 apart, learn fees.

TinyFish endpoints in use: **Agent**, **Browser**, **Browser Context Profiles**, **Search** and **Fetch**. Search and Fetch are used only in the Compare tab, not in the core basket flow.

## 2. Has / has not

| Feature | Status | Where |
|---|---|---|
| Hinglish parser (~80 words, ~90 brands, packets, "sirf") | Done | `lib/basket/parse.js` |
| Per-app price collection with India profiles | Done | `lib/basket/jhola.js` |
| Browser scan fallback | Done, fragile (text heuristic, no delivery location) | `lib/basket/scan.js` |
| Optimiser with fee thresholds | Done, but only uses each app's top offer | `public/lib/basket.js:115` |
| Plan editing and approval before carts | Done | `public/app.js`, `jhola.js` |
| Cart fill, ₹10 recheck, fee learning | Done (fee learning has bugs, see 3.1) | `jhola.js` |
| Login once via streamed window | Done | `lib/accounts.js` |
| Pay hand-off window | Partial: opens app home, not the cart | `lib/accounts.js` |
| Order tab | Partial: doesn't use saved profiles, can't fill carts. "Cash on Delivery" is text only | `lib/chores/order.js` |
| Compare (Search, Fetch, Agent, screenshot) | Done | `lib/chores/priceHunt.js` |
| Forms (dry run, then submit) | Done | `lib/chores/formFill.js` |
| Caretaker settings (PIN, default stores, simple mode) | Done, but PIN guards only settings | `server.js:121-153` |
| History and re-run | Done | `server.js:156-182` |
| Job cancel | Absent (`cancelRun` exists, unused) | `lib/tinyfish.js` |
| Resume after restart | Absent (jobs become `interrupted`) | `lib/jobs.js:16` |
| Price-drop alerts (Monitor) | Absent: built, then removed in `24e5798` | `git show c0f1626:lib/chores/watch.js` |
| Multi-user / bring-your-own key | Absent | — |
| Savings history, recurring basket, voice, chat bot, LLM fallback | Absent | — |
| Dark mode, PWA, Hindi UI | Absent | — |

## 3. Problems

### 3.1 Core engine

**High**

- `npm test` fails. `node --test test/` treats `test/` as a module path. With `node --test test/*.js`, 17 of 18 pass. `test/priceHunt.test.js:3` uses `new URL(...).pathname`, which breaks on Windows paths with spaces, so its 4 tests never run. Fix: `fileURLToPath`, and script `node --test "test/*.test.js"`.
- Learned fees go wrong. A cart above the free-delivery threshold saves `delivery_fee: 0`, so later plans assume delivery is always free. One-off surge or rain fees are also saved permanently (`jhola.js:186`).
- Multipacks are multiplied. For "maggi 4" against a "4 x 70 g" pack it buys 4 packs, because gram packs ignore `count` (`public/lib/basket.js:32`).
- Parser eats leading decimals. "1.5 L coke" is read as list numbering, giving 5000 ml (`parse.js:39`). Fractions ("1/2 kg") and "x 4" are not supported.
- Result mapping falls back to array position when the agent omits `itemId` (`jhola.js:142`). If the agent also skips or reorders an item, prices land on the wrong item.

**Medium**

- `ensureProfile` and `createProfile` throw inside `Promise.all` with no per-app try/catch (`jhola.js:97,208,239`). One app failing marks the job failed while other runs keep billing, and carts may be half filled.
- `accounts.json` lost update: read, await `createProfile`, write the whole file (`accounts.js:29-35`). Parallel apps can overwrite each other. Only the 4 s stagger hides this.
- `location_needed` result is ignored; the app is reported done with 0 items (`jhola.js:125-132`).
- Long lists (around 25 items) in one 540 s run hit `max_duration`, then fall back to a scan: you pay twice. Chunk to about 8 items per run.
- Order and Compare run Indian stores from a **US** IP: `smartRun` maps IN to US because the Agent proxy has no IN (`lib/agent.js:21`). They should use the India profiles like the basket flow.
- Job lifecycle: approvals never time out; `DELETE /api/jobs/:id` doesn't cancel TinyFish runs; no cancel endpoint; a restart loses collected offers so the user pays for collection again; `persist()` rewrites all of `jobs.json` on every event.

**Low**

- `runAgent` has no stall timeout on the SSE stream (`tinyfish.js:86`).
- 409 is retried on non-idempotent POSTs, which can duplicate profiles (`tinyfish.js:33`).
- `cookie_count` is always null; the save endpoint returns `domains_updated` (`accounts.js:87`).
- ₹5 tie rule makes the sort non-transitive (`basket.js:158`).
- Duplicate `itemId` lines and non-array `apps` are not validated.

### 3.2 Safety

- **"Never clicks Pay" is enforced only by prompt text.** The fill run sits on a logged-in cart where Place Order (including COD) is one click away. Add an `order_placed` / `final_url` field to the cart schema and alert on it, and inspect run steps via `GET /v1/runs/{id}`.
- The PIN guards only `PUT /api/settings`. `/unlock` has no rate limit and a fixed salt (`server.js:122,150`), so a 4-6 digit PIN is brute-forceable. Accounts, approvals and profile have no gate; simple mode is a client-side lock only.
- No auth, Origin check or CSRF protection on any route, including `/approve` (DNS rebinding possible locally).

### 3.3 UI / UX

**High**

- Status dot says "TinyFish connected" with an invalid key: wallet errors are swallowed and `ready: true` is returned (`server.js:59-60`).
- Buttons stay enabled after click. A double tap starts two paid runs (`app.js:512-523, 271, 327`).

**Medium**

- Edit the list and submit within 300 ms and the old parse is sent (`app.js:510,514`).
- `jParse`, `loadHistory`, `careUnlock` have no try/catch, so failures are silent.
- Mobile: tab bar shows about 2 of 5 tabs with no scroll cue; status text hidden under 960 px; item rows wrap and the brand box looks like a second item.
- Toasts disappear after 3.5 s and turn into blobs on mobile; too fast for elderly readers.
- Contrast fails WCAG AA: white on orange `#ff7a1a` is about 2.6:1 (every primary button); `--ink-3` is about 3:1. Many font sizes are 0.72-0.85 em even in simple mode.
- Accessibility: app toggles are unfocusable `<span>`s; 12 item inputs and the PIN input have no labels; no `aria-live`; status by colour only.

**Copy and flow**

- Old name "Errand" in user copy (`app.js:177,194,251`), the PIN salt and `ERRAND_DATA_DIR`.
- Simple-mode label claims "only Order, History and Me", but Basket and Setup stay visible (`index.html:163`).
- Default stores are `blinkit.com, amazon.in` (`server.js:126`), wrong for a grocery app.
- Developer jargon shown to parents: steps, `$0.42`, "Fetch triage", "in `data/`", "(N cookies)".
- Nothing tells the parent when a plan is waiting for approval (no sound, notification or title badge).
- Plan screen is a dense 6-column table; no simple "You save ₹X, Approve" view.
- No first-run flow; app opens on Basket though the README starts with Me then Setup.
- Units limited to pc, g, ml ("atta 5kg" shows as 5000 g). No dark mode.

### 3.4 Duplication and dead code

- `agentRun` (`jhola.js:331`) duplicates `smartRun` (`lib/agent.js`).
- Two parsers: `lib/orderParse.js` and `lib/basket/parse.js`. Order gets no Hinglish support.
- Two matchers: `matchScore` (`priceHunt.js:62`) and `classify` (`basket.js:40`).
- Store search URLs in three places: `scan.js:5`, `stores.js`, `accounts.js`.
- Browser setup (create, connect over CDP, close) copied in `proof.js` and `scan.js`.
- Caretaker name and phone stored but never used. `clearPin` never called.

## 4. Deployment with a user-entered TinyFish key

### 4.1 Blockers

- The key is a process-wide global: `apiKey()` reads `process.env.TINYFISH_API_KEY` (`tinyfish.js:26-30`).
- Single tenant everywhere. One `DATA_DIR` (`lib/store.js:6`) holds `profile.json` (name, phone, address: PII), `settings.json`, `accounts.json` (TinyFish profile IDs) and `jobs.json`. Visitor B would see A's data and run on A's logged-in apps.
- No access control: `/api/jobs` lists everyone's jobs; `/stream`, `/approve`, `DELETE` and `/window/:sid/*` work with any ID; `/shots` is public static.
- In-memory jobs, approvals and CDP sessions need one long-lived process.
- Long work: SSE for minutes, agent polls up to 10 min, login windows 900 s. Serverless timeouts kill these.
- `server.js:193` binds to `127.0.0.1`; containers need `0.0.0.0`.
- `.claude/launch.json` runs `zsh` and greps `~/.zshrc`; it doesn't work on Windows.
- No `engines` field, rate limits, security headers, or log redaction. Raw `err.message` is returned to clients.

### 4.2 Design

- **Key never stored on the server.** The user types it in a settings modal. Kept in `sessionStorage` by default, `localStorage` only if "Remember on this device" is ticked.
- **Session exchange.** `POST /api/session` takes the key over HTTPS, validates it with `GET /v1/wallet` (read-only, not billed), and returns an HttpOnly, Secure, SameSite=Strict cookie. The server keeps the key in memory only, in `Map<sid, {key, uid, exp}>` with a TTL. This also covers `EventSource`, which cannot send headers; the key must never go in a query string. `DELETE /api/session` logs out.
- **Per-request key without rewriting every signature.** `lib/tinyfish.js` exports an `AsyncLocalStorage`; `apiKey()` reads from it. Middleware in `server.js` runs each request inside it, and `runChore` (`lib/jobs.js:103`) wraps background work so it keeps the key after the response ends.
- **Isolation.** `uid = sha256(key + SERVER_PEPPER)[:16]`. Store under `DATA_DIR/users/<uid>/`. Every job, approval, CDP session and screenshot carries `owner`, checked on every `:id` / `:sid` route. Shots served through an auth-checked route.
- **Env key fallback** only with `ALLOW_ENV_KEY=1` behind an owner password, never for anonymous visitors.
- **Hardening.** Origin check on state-changing routes, no CORS, CSP and HSTS headers, `express-rate-limit` per IP and per uid, at most 2 concurrent jobs per uid, a cap on CDP windows, log redaction, `/healthz`.

Files to change: `lib/tinyfish.js`, `lib/jobs.js`, `lib/store.js`, `lib/accounts.js`, `lib/proof.js`, `server.js`, `public/app.js`, `public/index.html`, `.env.example`, `package.json`, `.claude/launch.json`, `README.md`.

### 4.3 Hosting

Vercel is out (function timeouts, no background jobs, no disk). **Render** (Starter plan, one instance, 1 GB disk at `/data`) is the pick; Railway and Fly.io also work.

```yaml
services:
  - type: web
    name: jhola
    runtime: node
    plan: starter
    buildCommand: npm ci
    startCommand: node server.js
    healthCheckPath: /healthz
    envVars:
      - { key: NODE_VERSION, value: "24" }
      - { key: ERRAND_DATA_DIR, value: /data }
      - { key: SERVER_PEPPER, generateValue: true }
      - { key: ALLOW_ENV_KEY, value: "0" }
    disk: { name: data, mountPath: /data, sizeGB: 1 }
```

The free tier sleeps and kills running jobs.

### 4.4 Checklist

1. Fix `launch.json` to run `node server.js`; add `"engines": {"node": ">=24 <25"}`.
2. Add the `AsyncLocalStorage` key context and wrap `runChore`.
3. Add session, validate and logout endpoints.
4. Namespace store, accounts, jobs and shots by uid; enforce ownership.
5. Bind `0.0.0.0`, add `/healthz`, rate limits, headers, Origin check, redaction, caps.
6. Build the key modal; on 401 open it.
7. Update `.env.example` and README.
8. `npm test`, then a two-browser isolation test: two keys must not see each other's jobs, accounts or shots.
9. Push, create the Render Blueprint, attach the disk.
10. Smoke test: validate key, run Compare, connect one app, run a full basket, restart and confirm data persists.

## 5. Upgrades

### Now (1-2 days)

| # | Upgrade | Why | Effort | TinyFish |
|---|---|---|---|---|
| 1 | Fix `npm test` and the Windows path in `priceHunt.test.js` | Tests actually run | S | — |
| 2 | Fix false "connected" status; clear "add your key" banner | First thing users see | S | — |
| 3 | Disable buttons in flight; fix stale parse | Stops double paid runs | S | — |
| 4 | Fee learning: never save 0 from free carts, learn `freeDeliveryAbove`, don't persist surge | Plans are wrong after first order | S | — |
| 5 | Parser: decimals, fractions, "x N", pao/dedh/dhai/sawa, kilo/litre | Varied input | S | — |
| 6 | Multipack `count` in matching; consider all offers by unit price in optimiser | Cheaper, correct baskets | M | — |
| 7 | Per-app try/catch; serialised writes to accounts and fees | One app can't sink the job | S | — |
| 8 | Order and Compare through India profiles | Correct prices | S | Agent + Profiles |
| 9 | Merge `agentRun` into `smartRun`; Order uses `basket/parse` | Less duplication | S | — |
| 10 | Cancel button wired to `cancelRun`; approval timeout | Saves money, user control | S | Agent |
| 11 | Rename Errand, fix simple-mode label, default stores Blinkit, Zepto, Instamart | Consistency | S | — |
| 12 | Contrast, labels, `aria-live`, bottom nav on mobile, longer toasts | Elderly users | S | — |
| 13 | "You save ₹X" headline, table behind "Change items" | Clear decision | S | — |
| 14 | Pay window opens on cart URL | Fewer taps | S | Profiles |
| 15 | Bring-your-own key and multi-user isolation, deploy to Render | Public deploy | M | Wallet |

### Next (1-2 weeks)

| # | Upgrade | Why | Effort | TinyFish |
|---|---|---|---|---|
| 16 | Bring Monitor back: price-drop and back-in-stock alerts on public pages (BigBasket, JioMart, Amazon) | 4th endpoint in the core story | M | Monitor |
| 17 | Search + Fetch fallback in the basket flow when an app is blocked | Resilience, endpoints in main flow | S | Search, Fetch |
| 18 | Server-side "order placed" guard on fill runs | Real safety, not prompt-only | S | Agent runs |
| 19 | Savings history ("saved ₹1,240 this month"), basket "order again" | Demo and habit | S | — |
| 20 | Cache offers per (app, pincode, query) for about 30 min; chunk long lists | Lower cost, fewer timeouts | M | Agent |
| 21 | Persist collected offers so approve and rerun survive restart | Don't pay twice | M | — |
| 22 | Plan-ready notification (Notification API, chime, title badge) | Parent doesn't miss approval | S | — |
| 23 | First-run caretaker wizard: Me, connect apps, PIN, simple mode | Onboarding | M | — |
| 24 | PIN gates Setup and Me, rate-limited unlock, forgot PIN, "Call caretaker" button | Real caretaker lock | M | — |
| 25 | Hindi/Hinglish UI toggle; voice input (Web Speech `hi-IN`) | Accessibility | M | — |
| 26 | Coupons and offers in the collect schema and optimiser; delivery ETA as tie-break | Real savings | M | Agent |
| 27 | Caretaker alerts on WhatsApp or Telegram; list input from a bot | Meet users where they are | M | — |
| 28 | LLM fallback for items the parser can't read | Varied input | S-M | — |
| 29 | Tests: orchestration, SSE parsing, jobs, routes, PIN | Safe refactors | M | — |

### Later

| # | Upgrade | Why | Effort | TinyFish |
|---|---|---|---|---|
| 30 | More stores: BigBasket, JioMart, Flipkart Minutes, Amazon Fresh (optimiser grows to 2^n subsets) | Coverage | M each | Agent + Profiles |
| 31 | Family accounts: one caretaker, several parents, real auth | Scale | L | Profiles |
| 32 | Recurring weekly basket, still approval-gated | Core elderly habit | M | Monitor schedule + Agent |
| 33 | PWA (installable), dark mode | Feels like an app | M | — |
| 34 | SKU catalogue per PIN code for exact matching | Accuracy | L | Datasets |
| 35 | Price-trend insights per app and area | Differentiation | L | Monitor history |
| 36 | Resume jobs after restart; receipts as PDF | Reliability, trust | M | Agent runs |
