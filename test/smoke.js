// Offline smoke test of the agent's tools (no API keys needed).
import assert from "node:assert/strict";
import { runTool, getSession, cartSnapshot } from "../src/agent.js";

delete process.env.CHANNEL3_API_KEY;
const s = getSession("smoketest123");
const ui = {};

const r = await runTool("search_products", { query: "mechanical keyboard", max_price: 80 }, s, ui);
assert.ok(r.count > 0, "search returns results");
assert.ok(r.products.every((p) => p.price <= 80), "price filter applied");
console.log("search:", r.products.map((p) => `${p.title} $${p.price}`));

await runTool("set_budget", { amount: 100 }, s, ui);
const add = await runTool("add_to_cart", { product_id: r.products[0].id, quantity: 1 }, s, ui);
assert.ok(add.ok, "add to cart");
const over = await runTool("add_to_cart", { product_id: "demo_dk1" }, s, ui);
assert.ok(over.error?.includes("budget"), "budget guard blocks");
console.log("budget guard:", over.error);

const co = await runTool("create_checkout", {}, s, ui);
assert.ok(co.error?.includes("PayPal is not configured"), "checkout needs PayPal creds");

await runTool("remove_from_cart", { product_id: r.products[0].id }, s, ui);
assert.equal(cartSnapshot(s).items.length, 0);
console.log("All smoke tests passed ✓");
