import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chat, getSession, cartSnapshot, recordPaidOrder } from "./src/agent.js";
import { captureOrder, paypalConfigured } from "./src/paypal.js";
import { productSource } from "./src/products.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(express.static(join(here, "public")));

const validSession = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(id);

app.get("/api/config", (_req, res) => {
  res.json({
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
    paypalReady: paypalConfigured(),
    aiReady: Boolean(process.env.ANTHROPIC_API_KEY),
    productSource: productSource(),
    currency: "USD",
  });
});

app.post("/api/chat", async (req, res) => {
  const { sessionId, message } = req.body || {};
  if (!validSession(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Empty message" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "ANTHROPIC_API_KEY is not set on the server." });

  try {
    const result = await chat(sessionId, message.trim().slice(0, 2000));
    res.json(result);
  } catch (err) {
    console.error("[chat]", err);
    res.status(500).json({ error: err.message || "Agent error" });
  }
});

app.get("/api/cart", (req, res) => {
  const { sessionId } = req.query;
  if (!validSession(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });
  const session = getSession(sessionId);
  res.json({ cart: cartSnapshot(session), checkout: session.pendingOrder, orders: session.orders });
});

app.post("/api/orders/:orderId/capture", async (req, res) => {
  const { sessionId } = req.body || {};
  const { orderId } = req.params;
  if (!validSession(sessionId)) return res.status(400).json({ error: "Invalid sessionId" });
  const session = getSession(sessionId);
  if (!session.pendingOrder || session.pendingOrder.id !== orderId) {
    return res.status(409).json({ error: "This order doesn't match the current cart. Ask CartPilot to check out again." });
  }
  try {
    const capture = await captureOrder(orderId);
    const record = recordPaidOrder(sessionId, capture);
    res.json({ ok: true, order: record });
  } catch (err) {
    console.error("[capture]", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/healthz", (_req, res) => res.send("ok"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`CartPilot running on http://localhost:${port}`);
  console.log(`  AI: ${process.env.ANTHROPIC_API_KEY ? "ready" : "MISSING ANTHROPIC_API_KEY"}`);
  console.log(`  PayPal: ${paypalConfigured() ? "ready (" + (process.env.PAYPAL_ENVIRONMENT || "SANDBOX") + ")" : "MISSING PAYPAL credentials"}`);
  console.log(`  Products: ${productSource()}`);
});
