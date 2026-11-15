# Jhola

One Hinglish grocery list → TinyFish agents read live prices on Blinkit, Zepto, Instamart → cheapest basket after fees → agents fill the user's real carts and **stop before payment**. Target user: an elderly parent; a caretaker sets up logins.

## Commands

- `npm install`, then `cp .env.example .env` and set `TINYFISH_API_KEY`
- `npm start` — server on http://localhost:4321 (`npm run dev` restarts on change)
- `npm test` — `node --test "test/*.test.js"`; must stay green before every commit

Node ≥ 22, ESM only, no build step, no TypeScript. Express 5 serves `public/` as static files.

## Layout

- `server.js` — all HTTP routes, SSE job streams, settings/PIN
- `lib/tinyfish.js` — REST client for every TinyFish API (Agent run-sse, runs, Browser, Profiles, Search, Fetch, wallet)
- `lib/basket/` — the core flow: `parse.js` (Hinglish list → items), `jhola.js` (collect → approve → fill → check), `scan.js` (Browser fallback when an app blocks the agent)
- `public/lib/basket.js` — matcher + optimiser, shared by server and browser; keep it dependency-free
- `lib/accounts.js` — per-app Browser Context Profiles and the streamed login/pay window
- `lib/jobs.js` — job store, event log, approval gates, persistence to `data/jobs.json`
- `lib/store.js` — JSON files under `JHOLA_DATA_DIR` (default `data/`, gitignored)
- `lib/chores/` — side features (Order, Compare, Forms); secondary to the basket flow
- `docs/` — `DECISIONS.md` (why), `ROADMAP.md` (what next), `DIAGNOSIS.md` (known bugs), `PROJECT.md` and `SPEC-2026-10-14.md` (original pitch and design)

## Rules that must not break

- Never click Pay / Place order / any payment control, never type passwords, OTPs, card or UPI data. Enforced in agent goals (`lib/safety.js`) and must also be checked server-side on results.
- Nothing goes into a cart until the user approves the plan (`askApproval` in `lib/jobs.js`).
- A TinyFish `COMPLETED` status is not success: check results for login walls, CAPTCHAs, empty data (`lib/safety.js`).
- Escape every agent-returned string before it reaches HTML. Validate URLs from agents/events before using them in `src`/`href`.
- Every agent run costs money. No retries of paid runs without a reason; no double-submits.

## TinyFish facts (verified)

- Agent `proxy_config.country_code` has no `IN`. Indian IP only through a profile created with `proxy_country_code: "IN"`.
- Browser API sessions cannot load profiles. Logged-in work = Agent with `use_profile` + `profile_id`.
- Metered concurrency is about 2 runs; extra runs queue.
- Docs: https://docs.tinyfish.ai/llms-full.txt. Get exact request shapes from the endpoint page, not memory.

## Conventions

- Small modules, plain functions, no classes unless state demands it. No new dependency without a clear need.
- Errors to clients are short and generic; details go to the server log. Never log API keys or user PII.
- User-facing copy is plain words for an elderly reader: no "runs", "steps", "$" costs or stack traces.
- Tests live in `test/*.test.js` using `node:test`. Add one for every parser/matcher/optimiser fix.
- Commits: imperative subject, one concern per commit.
