import { api, DEMO, loadCatalog, esc } from "./api.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const code = params.get("e") || (DEMO ? "demo" : "");
const storeKey = "paradiso-guest-" + code;

let me = JSON.parse(localStorage.getItem(storeKey) || "null"); // {id, secret, name}
let catalog, event, activeShop;
const qty = new Map(); // product_id → Menge
const timers = new Map();


if (DEMO) $("demo").classList.remove("hidden");
init().catch((e) => showNoLink(e.message));

async function init() {
  if (!code) return showNoLink();
  [catalog, event] = await Promise.all([loadCatalog(), api.guestEvent(code)]);
  if (!event) return showNoLink("Dieser Einladungslink ist ungültig oder abgelaufen. Frag beim Gastgeber nach einem neuen Link.");
  $("title").textContent = event.title;
  document.title = event.title + " · Bestellung";
  activeShop = catalog.shops[0].id;
  if (me) {
    try {
      (await api.guestItems(me.id, me.secret)).forEach((i) => qty.set(i.product_id, i.qty));
      return showShop();
    } catch { forget(); }
  }
  if (event.closed) return showNoLink("Die Bestellung ist bereits geschlossen.");
  showJoin();
}

function showNoLink(text) {
  $("title").textContent = "Café Paradiso";
  if (text) $("nolinkText").textContent = text;
  $("nolink").classList.remove("hidden");
}

function showJoin() {
  $("join").classList.remove("hidden");
  $("nameInput").focus();
  $("joinForm").onsubmit = async (ev) => {
    ev.preventDefault();
    const name = $("nameInput").value.trim();
    if (!name) return;
    $("joinError").textContent = "";
    try {
      const r = await api.guestJoin(code, name);
      me = { ...r, name };
      localStorage.setItem(storeKey, JSON.stringify(me));
      $("join").classList.add("hidden");
      showShop();
    } catch (e) { $("joinError").textContent = e.message; }
  };
}

function forget() { me = null; localStorage.removeItem(storeKey); qty.clear(); }

function showShop() {
  const who = $("who");
  who.innerHTML = `Du bestellst als <b>${esc(me.name)}</b><button id="notMe">Nicht du?</button>`;
  who.classList.remove("hidden");
  $("notMe").onclick = () => {
    if (!confirm("Abmelden? Deine bisherige Auswahl bleibt gespeichert, du startest aber mit einem neuen Namen.")) return;
    forget(); location.reload();
  };
  $("shopView").classList.remove("hidden");
  $("bar").classList.remove("hidden");
  if (event.closed) toast("Die Bestellung ist geschlossen – Änderungen sind nicht mehr möglich.", 5000);
  renderTabs(); renderCatalog(); renderBar();
}

function renderTabs() {
  $("tabs").innerHTML = catalog.shops.map((s) =>
    `<button data-shop="${s.id}" class="${s.id === activeShop ? "on" : ""}">${esc(s.name)}</button>`).join("");
  $("tabs").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    activeShop = b.dataset.shop; renderTabs(); renderCatalog(); scrollTo({ top: 0 });
  };
}

const catId = (c) => "cat-" + c.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function renderCatalog() {
  const products = catalog.products.filter((p) => p.shop === activeShop);
  const cats = [...new Set(products.map((p) => p.category))];
  $("chips").innerHTML = cats.map((c) => `<a href="#${catId(c)}">${esc(c)}</a>`).join("");
  if (!products.length) {
    $("catalog").innerHTML = `<div class="empty"><h3 class="serif">Kommt bald</h3>Hier kommen bald die Produkte dieses Ladens rein.</div>`;
    return;
  }
  $("catalog").innerHTML = cats.map((c) => {
    const list = products.filter((p) => p.category === c);
    const note = list[0].unit === "kg" ? "Mini-Varianten · Menge in Stück" : "Menge in Stück";
    return `<h2 class="cat-title" id="${catId(c)}">${esc(c)}</h2><p class="cat-note">${note}</p>
      <div class="grid">${list.map(cardHtml).join("")}</div>`;
  }).join("");
  $("catalog").onclick = onCatalogClick;
}

function cardHtml(p) {
  const q = qty.get(p.id) || 0;
  const img = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" data-zoom="${p.id}">`
    : `<div class="soon">Bild folgt</div>`;
  const ctrl = p.coming_soon ? `<div class="meta">Noch nicht bestellbar</div>`
    : event.closed ? `<div class="meta">${q ? q + " Stück gewählt" : ""}</div>`
    : q ? stepperHtml(p.id, q) : `<button class="add" data-id="${p.id}" data-d="1">+ Hinzufügen</button>`;
  return `<article class="card ${q ? "picked" : ""}" id="card-${p.id}">
    <div class="ph">${img}${p.code ? `<span class="code">${esc(p.code)}</span>` : ""}${q ? `<span class="badge">${q}</span>` : ""}</div>
    <div class="body"><div class="name">${esc(p.name)}</div><div class="foot">${ctrl}</div></div></article>`;
}

const stepperHtml = (id, q) =>
  `<div class="stepper"><button data-id="${id}" data-d="-1" aria-label="weniger">−</button><span class="q">${q}</span><button data-id="${id}" data-d="1" aria-label="mehr">+</button></div>`;

function onCatalogClick(e) {
  const z = e.target.closest("[data-zoom]");
  if (z) return zoom(z.dataset.zoom);
  const b = e.target.closest("button[data-id]");
  if (b) change(b.dataset.id, +b.dataset.d);
}

function change(id, d) {
  if (event.closed) return;
  const q = Math.max(0, Math.min(500, (qty.get(id) || 0) + d));
  q ? qty.set(id, q) : qty.delete(id);
  const card = $("card-" + id);
  if (card) card.outerHTML = cardHtml(catalog.products.find((p) => p.id === id));
  if (!$("sheet").classList.contains("hidden")) renderSheet();
  renderBar();
  save(id, q);
}

// Mehrere schnelle Klicks auf dasselbe Produkt = ein Speichervorgang
function save(id, q) {
  clearTimeout(timers.get(id));
  const t = setTimeout(async () => {
    try { await api.guestSetItem(me.id, me.secret, id, q); }
    catch (e) { toast("Speichern fehlgeschlagen: " + e.message, 4000); }
    finally { if (timers.get(id) === t) timers.delete(id); renderSaved(); }
  }, 400);
  timers.set(id, t);
  renderSaved();
}
function renderSaved() { $("savedLabel").textContent = timers.size ? "speichert …" : "gespeichert ✓"; }

function renderBar() {
  const n = [...qty.values()].reduce((a, b) => a + b, 0);
  const kinds = qty.size;
  $("cartLabel").textContent = n ? `Deine Auswahl: ${n} Stück · ${kinds} Sorte${kinds === 1 ? "" : "n"}` : "Noch nichts ausgewählt";
}

$("cartBtn").onclick = () => { renderSheet(); $("sheet").classList.remove("hidden"); $("sheetBg").classList.remove("hidden"); };
$("sheetClose").onclick = $("sheetBg").onclick = () => { $("sheet").classList.add("hidden"); $("sheetBg").classList.add("hidden"); };

function renderSheet() {
  const chosen = catalog.products.filter((p) => qty.get(p.id));
  if (!chosen.length) { $("sheetBody").innerHTML = `<div class="empty">Noch nichts ausgewählt.<br>Tipp auf „+ Hinzufügen" bei einem Produkt.</div>`; return; }
  $("sheetBody").innerHTML = catalog.shops.map((s) => {
    const list = chosen.filter((p) => p.shop === s.id);
    if (!list.length) return "";
    return `<div class="shop-head">${esc(s.name)}</div>` + list.map((p) => `
      <div class="row">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="noimg"></div>`}
        <div class="grow">${esc(p.name)}<small>${esc(p.category)}</small></div>
        ${event.closed ? `<b>${qty.get(p.id)}×</b>` : stepperHtml(p.id, qty.get(p.id))}</div>`).join("");
  }).join("");
  $("sheetBody").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) change(b.dataset.id, +b.dataset.d); };
}

function zoom(id) {
  const p = catalog.products.find((x) => x.id === id);
  const lb = $("lightbox");
  lb.innerHTML = `<div><img src="${esc(p.image)}" alt=""><p>${esc(p.name)}</p></div>`;
  lb.classList.remove("hidden");
  lb.onclick = () => lb.classList.add("hidden");
}

let toastT;
function toast(text, ms = 2500) {
  document.querySelector(".toast")?.remove();
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: text });
  document.body.append(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}
