# Jhola

Jhola is a personal shopping agent for Indian quick-commerce. You type one grocery list. Jhola checks live prices on Blinkit, Zepto and Swiggy Instamart, works out the cheapest way to buy the whole list after every fee, fills the carts on your own accounts, and stops at the payment page so you pay.

Built for the TinyFish x DTU "Personal Agents" track, on TinyFish Agent, Browser, Search, Fetch and Monitor.

## The problem

Indian households order groceries from three apps that show different prices for the same item. The item price is only part of the bill. Each app adds a delivery fee, a handling fee, and a small-cart fee when the order is below its minimum. Those fees change with location, time and order size.

So the cheapest app for milk is not always the cheapest app for the whole list. Splitting the list across two apps can save money, or it can cost more once the second app's fees are added. Nobody does this maths by hand every week. Most people open one app and accept its price.

## Who it is for

The first user is a parent who orders household groceries every week and does not want to compare three apps. Someone in the family connects the three accounts once. After that, the parent types a list and taps Approve.

## What it does, start to finish

1. Connect each app once. Jhola opens a TinyFish browser with an Indian IP. You log in with your phone number and OTP and confirm your address. TinyFish saves that login as a browser profile, so later runs are already signed in.
2. Type a list the way you would text it, for example "doodh 2 packet, atta 5kg, maggi x4, dhaniya". Jhola understands Hindi grocery words, quantities and pack sizes.
3. Jhola starts one TinyFish agent per app, side by side, each on that app's saved login. You watch all three browsers live on one screen. Each agent searches every item, records the top matches with pack size and price, and reads the fees the app shows.
4. Jhola converts every product to a price per gram, millilitre or piece, works out how many packs cover what you asked for, and flags substitutes.
5. The basket optimiser checks all seven ways to use the three apps (each app alone, each pair, all three). For each one it adds item prices and that app's real fees, then tries moving single items between apps to cross a free-delivery line or avoid a small-cart fee. It picks the lowest total.
6. Jhola shows the plan. For example: "Rs 1,240 on Blinkit + Zepto. Rs 118 less than the best single app." Each line shows the product, pack, price and any substitute. Short notes explain the choices, such as "Zepto alone would add a Rs 35 small-cart fee."
7. You can remove an item, force one app, or approve. Nothing goes into a cart before you approve.
8. On approval, agents fill each chosen cart and read back the real cart total. If it differs from the plan by more than Rs 10, Jhola shows the difference.
9. Jhola stops at the payment page. You pay in the app with your own UPI. Jhola never pays.

## What makes it different

- It optimises the whole bill, fees included, instead of comparing item prices.
- It reads fees from the live cart instead of hardcoding them, because fees change by pincode and order size.
- It works on your real logged-in accounts, so prices, stock and offers match what you would see.
- It runs the three apps at the same time and streams all three browsers into one page.
- It asks before anything goes into a cart and never touches payment.

## Other errands it does

Jhola grew out of Errand, a general errand agent. These features stay:

- Order. One sentence such as "2 Amul butter and eggs from Blinkit". Jhola finds each item and asks you to confirm the match.
- Compare. Find where a product is cheapest across Indian stores (Amazon, Flipkart, Croma and others), with a screenshot of the winning listing as proof.
- Watch. Get told when a page or a search topic changes.
- Forms. Jhola reads a web form, fills it from your saved details, and submits only after you approve every value.

## How TinyFish is used

| TinyFish product | What Jhola uses it for |
| --- | --- |
| Agent | Logged-in search on Blinkit, Zepto and Instamart, fee reading, cart filling up to the payment page. Also the live price check in Compare and Order, and form filling. |
| Browser context profiles | One saved login per app, created with an Indian proxy so every run sees Indian prices at your address. |
| Browser | Remote Chromium driven by Playwright for screenshot proof of a price, and a scripted price scan. |
| Search | Finds store product pages for Compare, and topic watches. |
| Fetch | Reads candidate pages and filters out reviews, blogs and listing pages before an agent opens a store. |
| Monitor | Scheduled checks on pages and search topics, such as a price on a product you buy every week. |

Every agent run on the grocery apps uses TinyFish stealth mode and the profile's Indian proxy. Goals start at each app's home page and use its search bar, because deep links look automated. Each run covers one app and stops when done.

## Safety rules

- Jhola never clicks Proceed to Pay, Place Order or any payment button. Every goal says so.
- Nothing goes into a cart until you approve the plan.
- Substitutes are marked and you can remove them.
- Jhola never types passwords, OTPs, card numbers or UPI IDs. You log in yourself in the TinyFish browser.
- Forms are submitted only after you approve each value.

## When things fail

- Login expired: Jhola marks that app as disconnected and asks you to reconnect it.
- Site blocked or CAPTCHA: TinyFish cannot solve CAPTCHAs. Jhola marks that app unavailable for this list and plans with the others.
- Item not found on an app: the optimiser treats it as unavailable there. If it is missing everywhere, the plan says so.
- Agent finished but returned nothing useful: Jhola treats it as a failure, not a success.
- Live stream dropped: Jhola polls the run until it finishes.

## Tech

Node.js and Express backend, plain HTML, CSS and JavaScript frontend, local JSON storage. A thin client for the TinyFish REST APIs with retries. Each errand runs as a background job that streams progress to the page and can pause for your approval. The parser and optimiser are plain code with unit tests, so the maths is checkable.

## Demo script (about 2 minutes)

1. Show the three apps connected (blur phone numbers and address).
2. Type "doodh 2 packet, atta 5kg, maggi x4, dhaniya, 6 ande".
3. Show the three live browsers searching at the same time.
4. Show the plan, the savings line and the fee notes. Remove one item to show the plan update.
5. Approve. Show the filled carts and the stop at the payment page.
6. Run a second, different list to show it is not scripted.

Blur in the recording: phone number, OTP, delivery address, name, order history.

## Numbers to fill in after the demo runs

- Savings on demo list 1: Rs ___ (___ %)
- Savings on demo list 2: Rs ___
- Time from list to plan: ___ seconds
- TinyFish agent steps per search run: ___, cost about $___

## Post material

One-line pitch:
Jhola checks Blinkit, Zepto and Instamart at the same time and builds the cheapest grocery basket after every fee, then stops at payment so you stay in control.

LinkedIn draft:

> Every week my family orders groceries from Blinkit, Zepto or Instamart, and the cheapest app for milk is rarely the cheapest app for the whole list. Delivery, handling and small-cart fees change the answer.
>
> For the TinyFish x DTU Personal Agents track I built Jhola. You type one list, in Hindi or English. Three TinyFish agents open the three apps on your own logged-in accounts and search every item at the same time. Jhola reads the real fees, checks every way to split the list, and shows the cheapest plan. On demo list 1 it saved Rs ___ against the best single app.
>
> You approve the plan, the agents fill the carts, and Jhola stops at the payment page. It never pays.
>
> Built on TinyFish Agent, Browser, Search, Fetch and Monitor. [demo video link]
>
> @TinyFish #TinyFish #AIAgents #DTU

X draft:

> Built Jhola for the @TinyFish x DTU Personal Agents track.
> One grocery list. Three TinyFish agents search Blinkit, Zepto and Instamart at once, read the real fees, and pick the cheapest split. Saved Rs ___ on my first list.
> It fills the carts and stops at payment. You pay.
> [demo video]

Replace the TinyFish handles with the exact ones before posting.
