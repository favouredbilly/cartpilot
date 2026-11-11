// Minimal PayPal Orders v2 client (sandbox by default).
// Docs: https://developer.paypal.com/docs/api/orders/v2/

const BASE =
  (process.env.PAYPAL_ENVIRONMENT || "SANDBOX").toUpperCase() === "PRODUCTION"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

let cachedToken = null; // { token, expiresAt }

export function paypalConfigured() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function paypalFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = data?.details?.[0]?.description || data?.message || text;
    throw new Error(`PayPal ${path} failed (${res.status}): ${msg}`);
  }
  return data;
}

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);

/**
 * Create a PayPal order from cart lines.
 * lines: [{ name, quantity, unitPrice, sku? }]
 */
export async function createOrder(lines, currency = "USD") {
  const items = lines.map((l) => ({
    name: String(l.name).slice(0, 127),
    sku: l.sku ? String(l.sku).slice(0, 127) : undefined,
    quantity: String(l.quantity),
    unit_amount: { currency_code: currency, value: money(l.unitPrice) },
    category: "PHYSICAL_GOODS",
  }));
  // Sum the rounded unit prices so item_total always matches what PayPal validates.
  const total = lines.reduce((s, l) => s + Number(money(l.unitPrice)) * l.quantity, 0);

  return paypalFetch("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": `cartpilot-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: "CartPilot AI shopping order",
          amount: {
            currency_code: currency,
            value: money(total),
            breakdown: { item_total: { currency_code: currency, value: money(total) } },
          },
          items,
        },
      ],
      application_context: {
        brand_name: "CartPilot",
        shipping_preference: "GET_FROM_FILE",
        user_action: "PAY_NOW",
      },
    }),
  });
}

export async function captureOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
  });
}

export async function getOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}
