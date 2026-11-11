// CartPilot frontend: chat UI, product cards, cart, and PayPal Smart Buttons.

const $ = (id) => document.getElementById(id);
const els = {
  messages: $("messages"), composer: $("composer"), input: $("input"), send: $("send"),
  chips: $("chips"), products: $("products"), source: $("source"), cart: $("cart"),
  total: $("total"), budget: $("budget"), checkoutBtn: $("checkoutBtn"),
  paypalArea: $("paypal-area"), orderId: $("orderId"), receipt: $("receipt"), status: $("status"),
};

// A per-browser session id so the agent remembers your cart.
const sessionId = (() => {
  try {
    let id = localStorage.getItem("cartpilot_session");
    if (!id) { id = "s_" + crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("cartpilot_session", id); }
    return id;
  } catch { return "s_" + crypto.randomUUID().replace(/-/g, ""); }
})();

let config = null;
let busy = false;
let renderedOrderId = null;

// ---------- helpers ----------
const fmt = (n) => "$" + Number(n || 0).toFixed(2);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Tiny markdown: **bold**, *italic*, bullet lists, paragraphs.
function md(text) {
  const lines = esc(text).split("\n");
  let html = "", inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\s)\*(\S.+?)\*/g, "$1<em>$2</em>");
    const bullet = line.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/);
    if (bullet) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${bullet[1]}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function addMessage(role, text, extra = {}) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}` + (extra.className ? " " + extra.className : "");
  wrap.innerHTML = `<div class="bubble">${role === "user" ? esc(text) : md(text)}</div>`;
  if (extra.tools?.length) {
    const t = document.createElement("div");
    t.className = "tools";
    t.innerHTML = extra.tools.map((c) => `<span class="tool" title="${esc(JSON.stringify(c.input))}">${c.ok ? "✓" : "✗"} ${esc(c.name)}</span>`).join("");
    wrap.appendChild(t);
  }
  els.messages.appendChild(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;
  return wrap;
}

// ---------- rendering ----------
function renderProducts(products) {
  if (!products) return;
  if (!products.length) { els.products.innerHTML = `<p class="empty">No matches. Try different words or a wider price range.</p>`; return; }
  els.products.innerHTML = products.map((p) => `
    <article class="product">
      <div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : esc(p.emoji || "🛍️")}</div>
      <div class="title">${esc(p.title)}</div>
      <div class="meta">${esc(p.brand)}${p.rating ? ` · ★ ${p.rating}` : ""}${p.merchant ? ` · ${esc(p.merchant)}` : ""}</div>
      <div class="row">
        <span class="price">${fmt(p.price)}</span>
        <button class="add" data-id="${esc(p.id)}" data-title="${esc(p.title)}">Add</button>
      </div>
    </article>`).join("");
}

function renderCart(cart) {
  if (!cart) return;
  els.cart.innerHTML = cart.items.length
    ? cart.items.map((i) => `
      <li class="item">
        <span>${i.image ? "🛍️" : esc(i.emoji || "🛍️")}</span>
        <span>${esc(i.title)} <span class="qty">×${i.quantity}</span></span>
        <strong>${fmt(i.lineTotal)}</strong>
        <button class="x" data-id="${esc(i.id)}" data-title="${esc(i.title)}" aria-label="Remove">×</button>
      </li>`).join("")
    : `<li class="empty">Your cart is empty.</li>`;
  els.total.textContent = fmt(cart.total);
  if (cart.budget) {
    const over = cart.total > cart.budget;
    els.budget.textContent = `Budget ${fmt(cart.budget)}${over ? " · over!" : ` · ${fmt(cart.budget - cart.total)} left`}`;
    els.budget.className = "budget" + (over ? " over" : "");
  } else { els.budget.textContent = ""; els.budget.className = ""; }
  els.checkoutBtn.disabled = !cart.items.length || busy;
  if (!cart.items.length) hidePayPal();
}

function hidePayPal() {
  els.paypalArea.hidden = true;
  $("paypal-buttons").innerHTML = "";
  renderedOrderId = null;
}

// ---------- PayPal ----------
let paypalLoaded = null;
function loadPayPal() {
  if (paypalLoaded) return paypalLoaded;
  paypalLoaded = new Promise((resolve, reject) => {
    if (!config?.paypalClientId) return reject(new Error("PayPal client id not configured"));
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=USD&intent=capture&components=buttons`;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => reject(new Error("Could not load PayPal SDK"));
    document.head.appendChild(s);
  });
  return paypalLoaded;
}

async function showPayPal(checkout) {
  if (!checkout?.id || renderedOrderId === checkout.id) return;
  renderedOrderId = checkout.id;
  els.receipt.hidden = true;
  els.orderId.textContent = checkout.id;
  els.paypalArea.hidden = false;
  const container = $("paypal-buttons");
  container.innerHTML = "";
  try {
    const paypal = await loadPayPal();
    await paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "pay" },
      createOrder: () => checkout.id, // the AGENT created this order server-side
      onApprove: async (data) => {
        const res = await fetch(`/api/orders/${encodeURIComponent(data.orderID)}/capture`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }),
        });
        const out = await res.json();
        if (!res.ok) { addMessage("bot", "Payment problem: " + out.error, { className: "error" }); return; }
        hidePayPal();
        els.receipt.hidden = false;
        els.receipt.innerHTML = `✅ Paid ${fmt(out.order.total)} with PayPal.<br><span class="muted">Order ${esc(out.order.id)} · ${esc(out.order.status)}</span>`;
        renderCart({ items: [], total: 0, budget: null });
        addMessage("bot", `Payment captured! **${fmt(out.order.total)}** paid via PayPal (order ${out.order.id}). Anything else you need?`);
      },
      onCancel: () => addMessage("bot", "No problem, payment cancelled. Your cart is still here if you change your mind."),
      onError: (err) => addMessage("bot", "PayPal error: " + (err?.message || err), { className: "error" }),
    }).render(container);
  } catch (err) {
    container.innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

// ---------- chat ----------
async function send(text) {
  if (busy || !text.trim()) return;
  busy = true;
  els.send.disabled = true;
  els.checkoutBtn.disabled = true;
  addMessage("user", text);
  els.input.value = "";
  els.chips.hidden = true;
  const typing = addMessage("bot", "CartPilot is shopping…", { className: "typing" });
  try {
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message: text }),
    });
    const out = await res.json();
    typing.remove();
    if (!res.ok) throw new Error(out.error || "Request failed");
    addMessage("bot", out.reply || "(no reply)", { tools: out.toolCalls });
    renderProducts(out.products);
    busy = false;
    renderCart(out.cart);
    if (out.checkout) showPayPal(out.checkout);
  } catch (err) {
    typing.remove();
    addMessage("bot", "Something went wrong: " + err.message, { className: "error" });
  } finally {
    busy = false;
    els.send.disabled = false;
    els.input.focus();
  }
}

els.composer.addEventListener("submit", (e) => { e.preventDefault(); send(els.input.value); });
els.chips.addEventListener("click", (e) => { if (e.target.tagName === "BUTTON") send(e.target.textContent); });
els.products.addEventListener("click", (e) => {
  const b = e.target.closest(".add");
  if (b) send(`Add "${b.dataset.title}" [${b.dataset.id}] to my cart.`);
});
els.cart.addEventListener("click", (e) => {
  const b = e.target.closest(".x");
  if (b) send(`Remove "${b.dataset.title}" [${b.dataset.id}] from my cart.`);
});
els.checkoutBtn.addEventListener("click", () => send("I'm ready to check out."));

// ---------- boot ----------
(async () => {
  config = await fetch("/api/config").then((r) => r.json());
  const pill = (ok, label) => `<span class="pill ${ok ? "ok" : "bad"}">${label}</span>`;
  els.status.innerHTML =
    pill(config.aiReady, "Claude") +
    pill(config.paypalReady, "PayPal sandbox") +
    pill(true, config.productSource === "channel3" ? "Channel3 live catalog" : "Demo catalog");
  els.source.textContent = config.productSource === "channel3" ? "via Channel3" : "demo catalog";

  const state = await fetch(`/api/cart?sessionId=${sessionId}`).then((r) => r.json());
  renderCart(state.cart);
  if (state.checkout) showPayPal(state.checkout);
})();
