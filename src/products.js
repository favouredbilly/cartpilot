// Product search: Channel3 (live catalog) when CHANNEL3_API_KEY is set,
// otherwise a built-in demo catalog so the app always runs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DEMO_CATALOG = JSON.parse(readFileSync(join(here, "catalog.json"), "utf8"));

// Cache every product we've shown, so cart operations can look them up by id.
const productCache = new Map();
for (const p of DEMO_CATALOG) productCache.set(p.id, p);

export function productSource() {
  return process.env.CHANNEL3_API_KEY ? "channel3" : "demo";
}

export function getProduct(id) {
  return productCache.get(id) || null;
}

export async function searchProducts({ query, min_price, max_price, limit = 6 }) {
  limit = Math.max(1, Math.min(Number(limit) || 6, 10));
  let results;
  if (productSource() === "channel3") {
    try {
      results = await searchChannel3({ query, min_price, max_price, limit });
    } catch (err) {
      console.warn("[products] Channel3 failed, using demo catalog:", err.message);
      results = searchDemo({ query, min_price, max_price, limit });
    }
  } else {
    results = searchDemo({ query, min_price, max_price, limit });
  }
  for (const p of results) productCache.set(p.id, p);
  return results;
}

// ---------- Channel3 ----------

async function searchChannel3({ query, min_price, max_price, limit }) {
  const filters = { availability: ["InStock"] };
  if (min_price != null || max_price != null) {
    filters.price = {};
    if (min_price != null) filters.price.min_price = Number(min_price);
    if (max_price != null) filters.price.max_price = Number(max_price);
  }

  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: {
      "x-api-key": process.env.CHANNEL3_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, filters, limit }),
  });
  if (!res.ok) throw new Error(`Channel3 ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.products || data.results || [];
  return list.map(normalizeChannel3).filter((p) => p && p.price > 0).slice(0, limit);
}

// Channel3's response is mapped defensively so small schema differences don't break the demo.
function normalizeChannel3(p) {
  if (!p) return null;
  const offers = Array.isArray(p.offers) ? p.offers : [];
  const offerPrice = (o) => {
    const v = typeof o?.price === "object" ? o.price?.price ?? o.price?.amount : o?.price;
    return Number(v) || Infinity;
  };
  const best = offers.slice().sort((a, b) => offerPrice(a) - offerPrice(b))[0] || {};
  const rawPrice =
    offers.length ? offerPrice(best) :
    typeof p.price === "object" ? p.price?.price ?? p.price?.amount : p.price;
  const price = Number(rawPrice);
  const currency =
    (typeof best.price === "object" && best.price?.currency) ||
    best.currency ||
    (typeof p.price === "object" && p.price?.currency) ||
    "USD";
  const img = Array.isArray(p.images) ? p.images[0] : p.image || p.image_url;
  const brand =
    typeof p.brand === "object" ? p.brand?.name : p.brand || p.brand_name || (p.brands?.[0]?.name ?? "");

  return {
    id: `c3_${p.id}`,
    title: p.title || p.name || "Untitled product",
    brand: brand || "",
    price: Number.isFinite(price) ? price : 0,
    currency,
    image: typeof img === "object" ? img?.url : img || null,
    merchant: best.domain || best.merchant || best.website || "",
    url: best.url || p.url || null,
    description: (p.description || "").slice(0, 300),
    source: "channel3",
  };
}

// ---------- Demo catalog ----------

function searchDemo({ query, min_price, max_price, limit }) {
  const words = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

  const scored = DEMO_CATALOG.map((p) => {
    const hay = `${p.title} ${p.brand} ${p.category} ${p.tags.join(" ")} ${p.description}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      const stem = w.replace(/s$/, "");
      if (hay.includes(stem)) score += p.tags.some((t) => t.includes(stem)) ? 3 : 1;
    }
    return { p, score };
  })
    .filter(({ p, score }) => score > 0 || words.length === 0)
    .filter(({ p }) => (min_price == null || p.price >= Number(min_price)) && (max_price == null || p.price <= Number(max_price)))
    .sort((a, b) => b.score - a.score || b.p.rating - a.p.rating);

  return scored.slice(0, limit).map(({ p }) => p);
}
