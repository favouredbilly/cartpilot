# ✈︎ CartPilot: an AI shopping agent with PayPal checkout

> Tell it what you need. CartPilot searches, compares, builds the cart within your budget, and creates a **PayPal order**. **You** approve the payment with one click.

Built for the **PayPal AI Hackathon: "Build what's next with PayPal and AI"**.

## What it does

1. **You describe what you want in plain language.** For example: *"Home office setup: desk, chair and a lamp. Budget $450."*
2. **Claude plans and acts with tools.** It breaks the request into searches, compares options on price and rating, sets your budget and adds items to the cart.
3. **Budget guardrails.** The server refuses any cart change or checkout over your budget, and the agent suggests cheaper swaps instead.
4. **The agent creates the PayPal order.** When you say "check out", Claude calls `create_checkout`, which creates a real **PayPal Orders v2** order (sandbox) from the cart's line items.
5. **A human approves every payment.** The PayPal Smart Button is rendered for *that exact order*. The agent can never pay on its own: you approve in PayPal, the server captures, and the agent is told the order is paid.

This is **agentic commerce with a human in the loop**: the AI does the shopping work, and PayPal provides the trusted payment and approval step.

## Architecture

```
Browser (chat · product cards · cart · PayPal Smart Buttons)
   │  POST /api/chat                       │ onApprove → POST /api/orders/:id/capture
   ▼                                       ▼
Express server ──► Claude (Messages API + tool use) ──► tools:
                     search_products   → Channel3 product API (or built-in demo catalog)
                     add/remove/view_cart, set_budget  → server-side cart + budget guard
                     create_checkout   → PayPal  POST /v2/checkout/orders
                     check_order_status→ PayPal  GET  /v2/checkout/orders/:id
                   capture endpoint    → PayPal  POST /v2/checkout/orders/:id/capture
```

| File | Purpose |
|---|---|
| `src/agent.js` | System prompt, tool definitions, agent loop, session/cart state, budget guard |
| `src/paypal.js` | PayPal OAuth + Orders v2 (create, get, capture) |
| `src/products.js` | Channel3 search (`POST /v1/search`) with a demo-catalog fallback |
| `server.js` | Express API + static frontend |
| `public/` | Chat UI, product cards, cart, PayPal JS SDK buttons |

## Run it locally (about 5 minutes)

**Requirements:** Node.js 18+.

```bash
git clone https://github.com/favouredbilly/cartpilot.git
cd cartpilot
npm install
cp .env.example .env     # then fill in the keys below
npm start                # → http://localhost:3000
```

### Keys

| Variable | Where to get it | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/) | ✅ |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox): **Apps & Credentials** (Sandbox) → *Create App* | ✅ for checkout |
| `CHANNEL3_API_KEY` | [trychannel3.com](https://trychannel3.com) (free tier) | Optional: without it, a 34-product demo catalog is used |

### Paying in the sandbox

In the PayPal Developer Dashboard go to **Testing Tools → Sandbox Accounts**. Use the default **Personal** account's email and password (click *View/Edit account* to see them) to log in when the PayPal popup opens. No real money moves.

### Offline tests

```bash
npm test   # exercises search, cart, budget guard and checkout validation without any API keys
```

## Deploy (Render)

This repo includes `render.yaml`. On [render.com](https://render.com), choose **New → Blueprint**, select the repo and fill in the env vars. Render gives you the public demo URL.

## Try these prompts

- `Find me a mechanical keyboard under $80`
- `Home office setup: desk, chair and a lamp. Budget $450`
- `Gift for a coffee lover under $50, pick the best one and add it`
- `Swap the chair for something cheaper` → `I'm ready to check out`

## How AI and PayPal are used

- **Claude (Anthropic Messages API, tool use):** understands intent, splits requests into searches, compares and recommends, manages the cart and budget, and decides when to create the PayPal order. Model: `claude-sonnet-5-5` (configurable through `ANTHROPIC_MODEL`).
- **PayPal Orders v2 REST API:** the agent creates itemized orders (`intent: CAPTURE`, item breakdown); the server captures after approval.
- **PayPal JavaScript SDK (Smart Buttons):** the human approval step, bound to the agent-created order id.
- **Channel3 (sponsor):** live product search across retailers for real shopping results.

## Limitations

- Sandbox only. Product links from Channel3 point to real merchants, but the PayPal order is a simulated purchase made by CartPilot, not an order placed with those merchants.
- Sessions are kept in memory, so they reset when the server restarts.

## License

[MIT](./LICENSE)
