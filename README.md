# 🛍️ Jhola

Jhola is a personal web agent for people who order groceries on **Blinkit, Zepto and Swiggy Instamart**. You type one list in plain words, Hinglish included (`doodh 2 packet, atta 5kg, maggi 4, dhaniya`). TinyFish agents read live prices on all three apps, and Jhola works out the cheapest way to buy the whole list **after delivery, small-cart and handling fees**. Sometimes that's one app, sometimes a split. Then Jhola fills the real carts on your logged-in accounts and **stops at the payment page**. You approve the plan and pay with your own UPI. Jhola never pays.

**Who it's for:** Any elderly person who orders household groceries every week and doesn't compare three apps by hand. A family member connects the apps once, and after that the parent only uses Jhola.

It also includes:
- **Order:** "2 Vaseline lip balm from Blinkit". It finds the product, asks once ("is this it?"), and stops searching the moment you say yes.
- **Compare:** best in-stock price for any product across stores, with a proof screenshot.
- **Forms:** two-phase form filling. A dry run shows every value, and it submits only after you approve.
- **Caretaker settings:** default stores (in order) when a store isn't named, simple mode with big text and fewer tabs, and an optional PIN.

## Run it

```bash
npm install
cp .env.example .env   # put your TINYFISH_API_KEY in it (or export it in your shell)
npm start              # → http://localhost:4321
npm test               # parser, matcher, optimiser and safety tests
```

Then:
1. **Me:** add your name, phone, address and PIN code.
2. **Setup:** connect Blinkit / Zepto / Instamart. A TinyFish browser (India) opens inside Jhola. Log in with your phone and OTP, check the delivery address, and press **Save & close**.
3. **Basket:** type your list, edit the items if needed (brand, size, "no subs"), and press **Find cheapest basket**.

Without a connected app, Jhola still compares prices using your PIN code. It just can't fill that app's cart.

## How it works

| Step | What happens | TinyFish |
| --- | --- | --- |
| Parse | Hinglish list → `{name, quantity, unit, brand, allowSubstitute}` (rules, no LLM): "doodh 2 packet" → milk 2 × 500 ml | — |
| Collect | One Agent run per app, staggered, from the home page: search each item, top 3 results, any fees shown | **Agent** (`run-sse`, `output_schema`, `browser_profile: stealth`, `use_profile` + `profile_id`) |
| Fallback | If an app blocks the agent, a scripted scan of its search pages | **Browser** (`api.browser.tinyfish.ai`, India proxy, Playwright over CDP) |
| Match | Pack sizes → price per kg / L / piece, packs needed, exact vs size variant vs substitute | — |
| Optimise | All 7 app combinations, items moved to cross free-delivery / small-cart thresholds, ₹5 ties go to the better-rated app | — |
| Plan | Three live browser panels, then the basket table: swap a product, drop an item, force one app, edit fees. Totals update instantly | Agent `streaming_url` |
| Fill | After **Approve**: one Agent run per chosen app clears the cart, adds products, reads the bill, and stops before payment | **Agent** + **Browser Context Profiles** |
| Check | Planned vs actual total. More than ₹10 apart, it asks you again. Real fees are saved for the next plan | — |
| Pay | Opens your logged-in session in a Jhola window so **you** pay | **Browser Context Profiles** (setup session) |
| Login once | Profile per app with `proxy_country_code: "IN"`. You type your own phone and OTP in the streamed window | `/v1/profiles`, `/setup-session`, `/save` |
| Compare tab | Find store pages, triage them cheaply, read live prices, screenshot the winner | **Search**, **Fetch**, **Agent**, **Browser** |

## Safety

- Jhola never clicks Pay, Place order or any payment button. Every goal says so, and you pay in the app yourself.
- Nothing goes into a cart until you tap **Approve** on the plan. Substitutes and size changes are flagged on the plan.
- The approval dialog warns that existing items in those carts will be removed first.
- It never types passwords, OTPs, card or UPI details. Only you type in the login and pay window.
- `COMPLETED` is not taken to mean success. Every result is checked for login walls, CAPTCHAs and empty data:
  - **Logged out** → Jhola marks the login expired and links you to Setup.
  - **Blocked** → Browser scan, then it plans without that app.

## Failure handling

| Failure | What Jhola does |
| --- | --- |
| `logged_out` | Marks that app's login expired and points you to Setup |
| `blocked` / `SITE_BLOCKED` | Retries with a Browser scan, then plans without that app |
| Item not on an app | Treated as unavailable on that app |
| Item not anywhere | Listed as "Not available" on the plan |
| Stream drops | Backend polls `GET /v1/runs/{id}` until the run finishes |
| Cart total ≠ plan | Shown side by side; you're asked again before paying |


