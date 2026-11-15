# Roadmap

Planned in earlier docs (`docs/PROJECT.md` and `docs/SPEC-2026-10-14.md` (recovered from branch `local-master-backup-14-oct`)) and in `DIAGNOSIS.md`, checked against the code on 2026-11-15.

## In progress (wave 1)

| Work | Branch |
| --- | --- |
| Password auth, single active job, cancel, approval timeout, PII and login-window leaks, safe errors | `backend-hardening` |
| Fee learning, multipacks, parser decimals and fractions, no positional mapping, per-app failure isolation, server-side order-placed guard, list chunking | `basket-engine` |
| Preact + htm frontend, Basket / Orders / Family, plan cards with sticky Approve, login screen, a11y and contrast | `frontend-rewrite` |
| Free hosting comparison, Dockerfile, deploy guide | `free-deploy` |

## Planned, not built (wave 2)

1. **Fee notes on the plan.** Spec: "Zepto alone would add a ₹35 small-cart fee." The optimiser knows this but never says it.
2. **Price watch with Monitor.** Watchlist of regular products. Search finds each public product page, Fetch confirms name and pack, Monitor checks daily (`CRON_TZ=Asia/Kolkata`) and alerts on a drop. Built once in `c0f1626` (`lib/chores/watch.js`), removed in `24e5798`.
3. **Runs survive restart.** Persist collected offers and run ids so a restart or refresh resumes or re-plans without paying for collection again. Spec planned SQLite.
4. **Basket ledger.** Per basket: minutes to plan, TinyFish cost, rupees saved against the best single app, success. Shown in Family. Answers whether the product saves more than it costs.
5. **Login health.** "Logged in, saved 3 days ago" per app, alert the caretaker when a profile expires.
6. **Order again.** One tap re-runs a past list.
7. **Plan-ready alert.** Notification and title badge when a plan waits for approval; caretaker alert on failure.
8. **Search and Fetch in the basket flow** as the fallback when an app blocks both the agent and the Browser scan.
9. **Order and Compare through India profiles** instead of a US agent proxy.

## Later

- LLM fallback for list lines the rule parser can't read.
- Hindi UI and voice input (`hi-IN`).
- Own Indian residential proxy (`proxy_config.type: "custom"`) if the TinyFish India pool gets blocked.
- More apps (BigBasket, JioMart, Flipkart Minutes); the optimiser grows to 2^n subsets.
- Multi-household accounts. Only after the ledger shows savings beat cost.

## Not planned

Automatic payment. Coupons and bank card offers.
