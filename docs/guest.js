import { api, DEMO, loadCatalog, esc, fmtPickup, fmtWhen, fmtRange, lineCost, variantsOf, VARIANTS, variantLabel } from "./api.js";
import { productTabs, inTab, chipsHtml, sectionsHtml, piecePrice, infoHtml, variantHead } from "./ui.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const code = params.get("e") || (DEMO ? "demo" : "");
const storeKey = "paradiso-guest-" + code;
const draftKey = "paradiso-draft2-" + code;

let me = JSON.parse(localStorage.getItem(storeKey) || "null"); // {id, secret, name}
let catalog, project, tabs, activeOrder, activeTab, submittedAt = null, busy = false;
// Abgeschickter Stand (wie beim Admin) und Entwurf im Browser: "bestellung|produkt|größe" → Menge
let sent = new Map(), draft = new Map();
const key = (orderId, productId, v) => orderId + "|" + productId + "|" + v;
const split = (k) => { const [order_id, product_id, variant] = k.split("|"); return { order_id, product_id, variant }; };
const order = (id = activeOrder) => project.orders.find((o) => o.id === id);
const prod = (id) => catalog.products.find((p) => p.id === id);

if (DEMO) $("demo").classList.remove("hidden");
init().catch((e) => showNoLink(e.message));

async function init() {
  if (!code) return showNoLink();
  [catalog, project] = await Promise.all([loadCatalog(), api.guestProject(code)]);
  if (!project) return showNoLink("Dieser Einladungslink ist ungültig oder abgelaufen. Frag beim Gastgeber nach einem neuen Link.");
  $("title").textContent = project.title;
  document.title = project.title + " · Bestellung";
  tabs = productTabs(catalog);
  activeTab = tabs[0]?.id;
  if (!project.orders.length) return showNoLink("Hier ist noch keine Bestellung angelegt. Schau später nochmal rein.", "Noch nichts offen");
  activeOrder = (project.orders.find((o) => !o.closed) || project.orders[0]).id;
  if (me) {
    try {
      await loadMine();
      const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (saved) draft = new Map(saved);
      return showShop();
    } catch { forget(); }
  }
  if (project.orders.every((o) => o.closed)) return showNoLink("Alle Bestellungen sind bereits geschlossen.", "Geschlossen");
  showJoin();
}

async function loadMine() {
  const r = await api.guestItems(me.id, me.secret);
  sent = new Map(r.items.map((i) => [key(i.order_id, i.product_id, i.variant), i.qty]));
  draft = new Map(sent);
  submittedAt = r.submitted_at;
}

function showNoLink(text, heading) {
  if (!project) $("title").textContent = "Café Paradiso";
  if (heading) $("nolink").querySelector("h2").textContent = heading;
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
      project = await api.guestProject(code); // jetzt mit dir in der Liste
      $("join").classList.add("hidden");
      showShop();
    } catch (e) { $("joinError").textContent = e.message; }
  };
}

function forget() { me = null; localStorage.removeItem(storeKey); localStorage.removeItem(draftKey); sent.clear(); draft.clear(); }

function showShop() {
  const who = $("who");
  who.innerHTML = `Du bestellst als <b>${esc(me.name)}</b><button id="notMe">Nicht du?</button>`;
  who.classList.remove("hidden");
  $("notMe").onclick = () => {
    if (!confirm("Abmelden? Deine abgeschickte Auswahl bleibt erhalten, du startest aber mit einem neuen Namen.")) return;
    forget(); location.reload();
  };
  $("shopView").classList.remove("hidden");
  $("bar").classList.remove("hidden");
  renderInfo(); renderOrders(); renderTabs(); renderCatalog(); renderBar();
}

const renderInfo = () => { $("info").innerHTML = infoHtml({ note: project.note, members: project.members, products: catalog.products }); };

// ───────── Entwurf vs. abgeschickt ─────────
const isOpen = (k) => !order(k.split("|")[0])?.closed;
function changedKeys() {
  return [...new Set([...sent.keys(), ...draft.keys()])].filter((k) => isOpen(k) && (sent.get(k) || 0) !== (draft.get(k) || 0));
}
const dirty = () => changedKeys().length > 0;
function persistDraft() { dirty() ? localStorage.setItem(draftKey, JSON.stringify([...draft])) : localStorage.removeItem(draftKey); }
addEventListener("beforeunload", (e) => { if (me && dirty()) { e.preventDefault(); e.returnValue = ""; } });

// ───────── Bestellungen (z. B. Kaffee Heiligabend / 1. Feiertag) ─────────
const countFor = (orderId) => [...draft].reduce((n, [k, q]) => (k.startsWith(orderId + "|") ? n + q : n), 0);

function renderOrders() {
  const o = order();
  const many = project.orders.length > 1;
  $("orderTabs").classList.toggle("hidden", !many);
  if (many) {
    $("orderTabs").innerHTML = project.orders.map((x) => {
      const n = countFor(x.id);
      return `<button data-order="${x.id}" class="${x.id === activeOrder ? "on" : ""}">
        <b>${esc(x.title)}</b><small>${x.closed ? "geschlossen" : esc(fmtPickup(x.pickup_at)) || "&nbsp;"}</small>
        ${n ? `<span class="cnt">${n}</span>` : ""}</button>`;
    }).join("");
    $("orderTabs").onclick = (e) => {
      const b = e.target.closest("button[data-order]"); if (!b) return;
      activeOrder = b.dataset.order; renderOrders(); renderCatalog(); renderBar();
    };
  }
  const when = o.pickup_at ? `Abholung ${fmtPickup(o.pickup_at)}` : "";
  $("orderInfo").innerHTML = o.closed
    ? `<b>${esc(o.title)}</b> ist geschlossen – Änderungen sind nicht mehr möglich.`
    : many ? esc(when) : `<b>${esc(o.title)}</b>${when ? " · " + esc(when) : ""}`;
  $("orderInfo").classList.toggle("closed", o.closed);
}

// ───────── Herzhaft / Süß ─────────
function renderTabs() {
  $("tabs").classList.toggle("hidden", tabs.length < 2);
  $("tabs").innerHTML = tabs.map((t) => `<button data-tab="${t.id}" class="${t.id === activeTab ? "on" : ""}">${esc(t.label)}</button>`).join("");
  $("tabs").onclick = (e) => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    activeTab = b.dataset.tab; renderTabs(); renderCatalog();
    $("tabs").scrollIntoView?.({ block: "start" });
  };
}

function renderCatalog() {
  const products = catalog.products.filter(inTab(activeTab));
  $("chips").innerHTML = chipsHtml(products);
  $("catalog").innerHTML = sectionsHtml(products, cardHtml);
  $("catalog").onclick = onCatalogClick;
}

// Karte: je Größe (Mini / Normal) eine Zeile mit Preis und eigener Menge
function cardHtml(p) {
  const vs = variantsOf(p);
  const total = vs.reduce((n, v) => n + (draft.get(key(activeOrder, p.id, v)) || 0), 0);
  const img = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" data-zoom="${p.id}">`
    : `<div class="soon">Bild folgt</div>`;
  const rows = p.coming_soon ? `<div class="meta">Bald dabei – noch nicht bestellbar</div>` : vs.map((v) => {
    const q = draft.get(key(activeOrder, p.id, v)) || 0;
    const ctrl = order().closed ? (q ? `<div class="meta">${q} Stück gewählt</div>` : "")
      : q ? stepperHtml(activeOrder, p.id, v, q)
      : `<button class="add" data-order="${activeOrder}" data-id="${p.id}" data-v="${v}" data-d="1">+ ${vs.length > 1 ? VARIANTS[v] : "Hinzufügen"}</button>`;
    return `<div class="variant ${q ? "on" : ""}">${variantHead(p, v)}${ctrl}</div>`;
  }).join("");
  return `<article class="card ${total ? "picked" : ""}" id="card-${p.id}">
    <div class="ph">${img}${total ? `<span class="badge">${total}</span>` : ""}</div>
    <div class="body"><div class="name">${esc(p.name)}</div><div class="foot">${rows}</div></div></article>`;
}

const stepperHtml = (orderId, id, v, q) =>
  `<div class="stepper"><button data-order="${orderId}" data-id="${id}" data-v="${v}" data-d="-1" aria-label="weniger">−</button><span class="q">${q}</span><button data-order="${orderId}" data-id="${id}" data-v="${v}" data-d="1" aria-label="mehr">+</button></div>`;

function onCatalogClick(e) {
  const z = e.target.closest("[data-zoom]");
  if (z) return zoom(z.dataset.zoom);
  const b = e.target.closest("button[data-id]");
  if (b) change(b.dataset.order, b.dataset.id, b.dataset.v, +b.dataset.d);
}

function change(orderId, id, v, d) {
  if (order(orderId).closed) return;
  const k = key(orderId, id, v);
  const q = Math.max(0, Math.min(500, (draft.get(k) || 0) + d));
  q ? draft.set(k, q) : draft.delete(k);
  persistDraft();
  const card = $("card-" + id);
  if (card && orderId === activeOrder) card.outerHTML = cardHtml(prod(id));
  if (!$("sheet").classList.contains("hidden")) renderSheet();
  if (project.orders.length > 1) renderOrders();
  renderBar();
}

// ───────── Abschicken ─────────
async function submit() {
  if (busy || !dirty()) return;
  busy = true; renderBar();
  const before = new Set(changedKeys().map((k) => k.split("|")[0]));
  try {
    const items = [...draft].map(([k, qty]) => ({ ...split(k), qty }));
    await api.guestSubmit(me.id, me.secret, items);
    project = await api.guestProject(code);
    await loadMine();
    localStorage.removeItem(draftKey);
    const lost = project.orders.filter((o) => o.closed && before.has(o.id));
    toast(lost.length ? `„${lost.map((o) => o.title).join("“, „")}“ ist inzwischen geschlossen – dort wurde nichts geändert.`
      : "Abgeschickt ✓ – du kannst jederzeit ändern und erneut abschicken.", 4000);
    renderInfo(); renderOrders(); renderCatalog();
    if (!$("sheet").classList.contains("hidden")) renderSheet();
  } catch (e) { toast("Abschicken fehlgeschlagen: " + e.message, 5000); }
  finally { busy = false; renderBar(); }
}
$("submitBtn").onclick = $("sheetSubmit").onclick = submit;

function renderBar() {
  const mine = [...draft].filter(([k]) => k.startsWith(activeOrder + "|"));
  const n = mine.reduce((a, [, q]) => a + q, 0);
  const label = project.orders.length > 1 ? `${order().title}: ` : "Deine Auswahl: ";
  $("cartLabel").textContent = n ? `${label}${n} Stück · ${mine.length} Sorte${mine.length === 1 ? "" : "n"}` : "Noch nichts ausgewählt";
  const d = dirty();
  $("savedLabel").textContent = busy ? "wird abgeschickt …" : d ? "Noch nicht abgeschickt"
    : submittedAt ? `Abgeschickt ✓ ${fmtWhen(submittedAt)}` : "";
  $("savedLabel").classList.toggle("warn", d && !busy);
  for (const b of [$("submitBtn"), $("sheetSubmit")]) {
    b.disabled = busy || !d;
    b.textContent = d ? "Abschicken" : submittedAt ? "Abgeschickt ✓" : "Abschicken";
  }
}

$("cartBtn").onclick = () => { renderSheet(); $("sheet").classList.remove("hidden"); $("sheetBg").classList.remove("hidden"); };
$("sheetClose").onclick = $("sheetBg").onclick = () => { $("sheet").classList.add("hidden"); $("sheetBg").classList.add("hidden"); };

// Übersicht über alle Bestellungen des Projekts
function renderSheet() {
  const multiShop = new Set(catalog.products.map((p) => p.shop)).size > 1;
  let total = [0, 0];
  const html = project.orders.map((o) => {
    const list = catalog.products.flatMap((p) => variantsOf(p).filter((v) => draft.get(key(o.id, p.id, v))).map((v) => ({ p, v })));
    if (!list.length) return "";
    return `<div class="shop-head">${esc(o.title)}${o.pickup_at ? " · " + esc(fmtPickup(o.pickup_at)) : ""}${o.closed ? " · geschlossen" : ""}</div>` + list.map(({ p, v }) => {
      const q = draft.get(key(o.id, p.id, v));
      const c = lineCost(p, q, v); total = [total[0] + c[0], total[1] + c[1]];
      const size = variantLabel(p, v);
      return `<div class="row">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="noimg"></div>`}
        <div class="grow">${esc(p.name)}${size ? ` <span class="size">${size}</span>` : ""}<small>${esc(multiShop ? catalog.shops.find((s) => s.id === p.shop)?.name + " · " : "")}${piecePrice(p, v)} pro Stück</small></div>
        ${o.closed ? `<b>${q}×</b>` : stepperHtml(o.id, p.id, v, q)}</div>`;
    }).join("");
  }).join("");
  $("sheetBody").innerHTML = html || `<div class="empty">Noch nichts ausgewählt.<br>Tipp auf „+ Hinzufügen" bei einem Produkt.</div>`;
  $("sheetTotal").innerHTML = html ? `Geschätzt <b>${fmtRange(total)}</b>` : "";
  $("sheetBody").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) change(b.dataset.order, b.dataset.id, b.dataset.v, +b.dataset.d); };
}

function zoom(id) {
  const p = prod(id);
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
