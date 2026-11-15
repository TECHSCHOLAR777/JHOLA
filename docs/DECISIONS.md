# Decisions (2026-11-15)

Outcome of a backend, frontend and product review. Details and bug list: `DIAGNOSIS.md`.

1. **v1 audience: one household behind a password.** The server holds the owner's TinyFish key and the family's logged-in grocery profiles. No public multi-user, no bring-your-own-key yet: hosting strangers' grocery sessions is a liability and one missed ownership check is an account takeover.
2. **One core loop.** Type list → "Pay ₹X, saves ₹Y" → Approve → carts filled → "Pay in the app". Order, Compare and Forms move behind a `?labs` flag.
3. **Fix money and trust first.** Auth on every route, single active job, real cancel, approval timeout, server-side order-placed guard, fee-learning and multipack bugs, no positional result mapping.
4. **Frontend: Preact + htm, vendored, no build step.** Fixes the full re-render on every SSE event and makes escaping structural. Keep the current theme tokens; fix contrast.
5. **Measure before growing.** Track per basket: success, minutes, TinyFish cost, rupees saved. Widen access only if savings beat cost.
