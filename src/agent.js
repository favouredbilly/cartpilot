// The CartPilot agent: Claude + tool use. Claude decides which tools to call
// (search, cart, budget, PayPal checkout); the server executes them.

import Anthropic from "@anthropic-ai/sdk";
import { searchProducts, getProduct, productSource } from "./products.js";
import { createOrder, getOrder, paypalConfigured } from "./paypal.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_TOOL_ROUNDS = 8;

let client = null;
function anthropic() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}

const SYSTEM_PROMPT = `You are CartPilot, a friendly AI shopping agent with a PayPal checkout.

What you do:
- Turn the shopper's request into one or more product searches (use search_products; split multi-item requests like "a desk and a lamp" into separate searches).
- Compare options on price, rating, and fit for the shopper's stated needs. Recommend clearly, with one-line reasons.
- Manage the cart with add_to_cart / remove_from_cart / view_cart. Only add items the shopper chose, or items they told you to pick for them.
- If the shopper mentions a spending limit, call set_budget. Never let the cart exceed the budget; suggest cheaper swaps instead.
- When the shopper is ready to pay, call create_checkout. This creates a PayPal order; the shopper then approves the payment themselves with the PayPal button shown in the app. You can never pay on your own: the human always approves.
- After the shopper says they paid, you can confirm with check_order_status.

Style: short and scannable. Mention products by name and price. Don't paste ids or URLs; the app shows product cards and the cart automatically. Prices are in USD unless a product says otherwise.`;

const TOOLS = [
  {
    name: "search_products",
    description:
      "Search the product catalog. Returns up to `limit` products with id, title, brand, price, rating and merchant. Product cards are shown to the shopper automatically.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text product search, e.g. 'mechanical keyboard brown switches'" },
        min_price: { type: "number", description: "Minimum price in USD" },
        max_price: { type: "number", description: "Maximum price in USD" },
        limit: { type: "integer", description: "Number of results (1-10, default 6)" },
      },
      required: ["query"],
    },
  },
  {
    name: "add_to_cart",
    description: "Add a product (by id from search results) to the cart.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        quantity: { type: "integer", minimum: 1, default: 1 },
      },
      required: ["product_id"],
    },
  },
  {
    name: "remove_from_cart",
    description: "Remove a product from the cart. Omit quantity to remove it entirely.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string" },
        quantity: { type: "integer", minimum: 1 },
      },
      required: ["product_id"],
    },
  },
  {
    name: "view_cart",
    description: "Show the current cart, total and budget.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "set_budget",
    description: "Set the shopper's maximum total spend in USD. Use 0 to clear the budget.",
    input_schema: {
      type: "object",
      properties: { amount: { type: "number" } },
      required: ["amount"],
    },
  },
  {
    name: "create_checkout",
    description:
      "Create a PayPal order for everything in the cart. The shopper must then approve it with the PayPal button. Only call this when the shopper has said they want to buy.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "check_order_status",
    description: "Look up the status of a PayPal order (e.g. CREATED, APPROVED, COMPLETED).",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
    },
  },
];

// ---------- Session state ----------

const sessions = new Map();

export function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, { messages: [], cart: new Map(), budget: null, pendingOrder: null, orders: [] });
  }
  return sessions.get(id);
}

export function cartSnapshot(session) {
  const items = [...session.cart.values()].map(({ product, quantity }) => ({
    id: product.id,
    title: product.title,
    brand: product.brand,
    price: product.price,
    quantity,
    lineTotal: round(product.price * quantity),
    emoji: product.emoji || null,
    image: product.image || null,
  }));
  const total = round(items.reduce((s, i) => s + i.lineTotal, 0));
  return { items, total, budget: session.budget, currency: "USD" };
}

const round = (n) => Math.round(n * 100) / 100;

// ---------- Tool execution ----------

export async function runTool(name, input, session, ui) {
  switch (name) {
    case "search_products": {
      const results = await searchProducts(input);
      ui.products = results; // latest search drives the product cards
      return {
        source: productSource(),
        count: results.length,
        products: results.map((p) => ({
          id: p.id,
          title: p.title,
          brand: p.brand,
          price: p.price,
          currency: p.currency,
          rating: p.rating ?? null,
          merchant: p.merchant,
          description: p.description,
        })),
      };
    }

    case "add_to_cart": {
      const product = getProduct(input.product_id);
      if (!product) return { error: `Unknown product_id ${input.product_id}. Search first.` };
      const qty = Math.max(1, Number(input.quantity) || 1);
      const existing = session.cart.get(product.id);
      const newQty = (existing?.quantity || 0) + qty;
      const projected = cartSnapshot(session).total - (existing ? existing.product.price * existing.quantity : 0) + product.price * newQty;
      if (session.budget && projected > session.budget) {
        return {
          error: `Adding this would bring the cart to $${round(projected)}, over the $${session.budget} budget.`,
          cart: cartSnapshot(session),
        };
      }
      session.cart.set(product.id, { product, quantity: newQty });
      session.pendingOrder = null; // cart changed; old order is stale
      return { ok: true, cart: cartSnapshot(session) };
    }

    case "remove_from_cart": {
      const line = session.cart.get(input.product_id);
      if (!line) return { error: "That product isn't in the cart.", cart: cartSnapshot(session) };
      if (input.quantity && input.quantity < line.quantity) line.quantity -= input.quantity;
      else session.cart.delete(input.product_id);
      session.pendingOrder = null;
      return { ok: true, cart: cartSnapshot(session) };
    }

    case "view_cart":
      return cartSnapshot(session);

    case "set_budget": {
      const amt = Number(input.amount);
      session.budget = amt > 0 ? round(amt) : null;
      const cart = cartSnapshot(session);
      return { ok: true, budget: session.budget, cart_total: cart.total, over_budget: Boolean(session.budget && cart.total > session.budget) };
    }

    case "create_checkout": {
      const cart = cartSnapshot(session);
      if (!cart.items.length) return { error: "The cart is empty." };
      if (session.budget && cart.total > session.budget) {
        return { error: `Cart total $${cart.total} exceeds the $${session.budget} budget. Remove or swap items first.` };
      }
      if (!paypalConfigured()) {
        return { error: "PayPal is not configured on this server (missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)." };
      }
      const order = await createOrder(
        cart.items.map((i) => ({ name: i.title, quantity: i.quantity, unitPrice: i.price, sku: i.id }))
      );
      session.pendingOrder = { id: order.id, total: cart.total, status: order.status };
      ui.checkout = session.pendingOrder;
      return {
        ok: true,
        paypal_order_id: order.id,
        status: order.status,
        total: cart.total,
        next_step: "The PayPal button is now shown to the shopper. They must approve the payment themselves.",
      };
    }

    case "check_order_status": {
      if (!paypalConfigured()) return { error: "PayPal is not configured." };
      const order = await getOrder(input.order_id);
      return { id: order.id, status: order.status, total: order.purchase_units?.[0]?.amount?.value };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}

// ---------- Agent loop ----------

/**
 * Send a user message to the agent. Returns { reply, products, cart, checkout, toolCalls }.
 */
export async function chat(sessionId, userText) {
  const session = getSession(sessionId);
  session.messages.push({ role: "user", content: userText });

  const ui = { products: null, checkout: null };
  const toolCalls = [];

  for (let round_ = 0; round_ < MAX_TOOL_ROUNDS; round_++) {
    const response = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: session.messages,
    });

    session.messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const reply = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return { reply, products: ui.products, cart: cartSnapshot(session), checkout: ui.checkout, toolCalls };
    }

    const results = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let output;
      try {
        output = await runTool(block.name, block.input || {}, session, ui);
      } catch (err) {
        console.error(`[tool ${block.name}]`, err);
        output = { error: err.message };
      }
      toolCalls.push({ name: block.name, input: block.input, ok: !output?.error });
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(output),
        is_error: Boolean(output?.error),
      });
    }
    session.messages.push({ role: "user", content: results });
  }

  return {
    reply: "I got a bit carried away there. Could you rephrase what you'd like?",
    products: ui.products,
    cart: cartSnapshot(session),
    checkout: ui.checkout,
    toolCalls,
  };
}

/** Called after the shopper approves + we capture the payment. */
export function recordPaidOrder(sessionId, capture) {
  const session = getSession(sessionId);
  const cart = cartSnapshot(session);
  const record = {
    id: capture.id,
    status: capture.status,
    total: cart.total,
    items: cart.items,
    payer: capture.payer?.name ? `${capture.payer.name.given_name || ""} ${capture.payer.name.surname || ""}`.trim() : null,
    at: new Date().toISOString(),
  };
  session.orders.push(record);
  session.cart.clear();
  session.pendingOrder = null;
  // Let the agent know, so follow-up questions have context.
  session.messages.push({
    role: "user",
    content: `[System note: the shopper approved and PayPal captured order ${record.id} for $${record.total}. Status: ${record.status}. The cart is now empty.]`,
  });
  session.messages.push({ role: "assistant", content: "Noted: payment captured and cart cleared." });
  return record;
}
