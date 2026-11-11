# Devpost submission kit (not required in the repo; delete it if you like)

## Project name
CartPilot: an AI shopping agent with PayPal checkout

## Tagline
Tell it what you need. AI shops, PayPal pays, and you stay in control.

## Description (paste into Devpost)

**Inspiration.** Shopping online still means dozens of tabs, comparing specs and doing budget maths in your head. AI agents can do that legwork, but nobody wants an AI spending their money unsupervised. We wanted an agent that does all the shopping work and leaves the final "yes" to the human, through a payment system people already trust.

**What it does.** CartPilot is a chat-based shopping agent. You describe what you need ("home office setup: desk, chair and a lamp, budget $450"). Claude breaks the request down, searches products (live through Channel3), compares price and rating, recommends options and builds your cart, while a server-side guard keeps the cart under your budget. When you say "check out", the agent creates an itemized **PayPal order** through the Orders v2 API. The PayPal Smart Button then appears for exactly that order, so you approve it yourself and the server captures the payment. The agent can never pay on its own.

**How we built it.** Node.js and Express. Claude (Anthropic Messages API) runs a tool-use loop with seven tools: `search_products`, `add_to_cart`, `remove_from_cart`, `view_cart`, `set_budget`, `create_checkout` and `check_order_status`. The PayPal integration uses OAuth client credentials, `POST /v2/checkout/orders` with a full item breakdown, `GET` for order status and `POST /capture` after buyer approval through the PayPal JS SDK. Product search uses the Channel3 `/v1/search` API, with a built-in demo catalog as a fallback.

**Challenges.** Making sure the PayPal order always matches the agent's cart: a cart change invalidates any pending order, the capture endpoint rejects order ids that don't match the session, and item totals are rounded the same way PayPal validates them.

**What's next.** Multi-merchant fulfilment, PayPal Vault for returning shoppers, price-drop alerts through Channel3 webhooks, and spending policies (per-category limits, approvals for a second person).

## Built with
claude, anthropic-api, paypal-orders-api, paypal-javascript-sdk, channel3, node.js, express, render

## Tools used (for the "Tools" field)
- **Claude (Anthropic API, tool use):** the agent's reasoning, planning, product comparison and tool calling (search, cart, budget, PayPal checkout).
- **Claude (as a coding assistant):** helped scaffold and write the codebase during the hackathon.
- **PayPal Orders v2 API and PayPal JS SDK:** order creation, buyer approval and capture (sandbox).
- **Channel3:** live product search API.
- **Render:** hosting.

## Demo video script (target: 2:30, hard cap under 3:00)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | App home screen | "This is CartPilot, an AI shopping agent. It does the shopping, PayPal handles the payment, and I approve every purchase." |
| 0:15–0:55 | Type: *"Home office setup: desk, chair and a lamp. Budget $450"* | "Claude splits this into three searches, sets my budget and compares options. You can see the tool calls under its reply." |
| 0:55–1:20 | Say: *"Add your picks"*, then *"Swap the chair for something cheaper"* | "It manages the cart and the budget bar updates live. If something would go over budget, the server blocks it and the agent suggests a swap." |
| 1:20–1:45 | *"I'm ready to check out"* | "The agent calls PayPal's Orders API and creates an itemized order. Here's the order id. It can't pay by itself." |
| 1:45–2:15 | PayPal popup → sandbox login → Pay | "I approve in PayPal, our server captures it, and the agent is told the order is paid." |
| 2:15–2:30 | Receipt and PayPal sandbox dashboard | "Paid, with a PayPal-verified order. AI does the legwork, PayPal supplies the trust. That's CartPilot." |

Use no copyrighted music. Upload to YouTube as **Public** and paste the link.
