# Decisions (2026-11-15)

Outcome of a backend, frontend and product review. Details and bug list: `DIAGNOSIS.md`.

1. **v1 audience: anyone with their own TinyFish key (BYOK).** Owner's call, overriding the panel's single-household pick. Each visitor pastes a TinyFish key; runs bill to their account and their grocery logins live as profiles in their own TinyFish account. The server keeps keys in memory only and isolates data per key (`users/<uid>/`, owner checks on every job, window and screenshot). `AUTH_MODE=password` keeps the single-household mode for private installs.
2. **One core loop.** Type list → "Pay ₹X, saves ₹Y" → Approve → carts filled → "Pay in the app". Order, Compare and Forms move behind a `?labs` flag.
3. **Fix money and trust first.** Auth on every route, single active job, real cancel, approval timeout, server-side order-placed guard, fee-learning and multipack bugs, no positional result mapping.
4. **Frontend: Preact + htm, vendored, no build step.** Fixes the full re-render on every SSE event and makes escaping structural. Keep the current theme tokens; fix contrast.
5. **Measure before growing.** Track per basket: success, minutes, TinyFish cost, rupees saved. Widen access only if savings beat cost.
