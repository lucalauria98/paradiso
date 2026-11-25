import { api, DEMO, loadCatalog, esc, lineCost, lineWeight, fmtRange, fmtKg, priceLabel, fmtPickup, fmtWhen } from "./api.js";
import { productTabs, inTab, chipsHtml, sectionsHtml, piecePrice, infoHtml } from "./ui.js";

const $ = (id) => document.getElementById(id);
const ALL = "all"; // Reiter „Gesamt“ über alle Bestellungen des Projekts
let catalog, projects = [], project, sel = ALL, view = "product", editing = null, unsub;
let data = { participants: [], items: [], submissions: [] }, seenSubs = null;

if (DEMO) $("demo").classList.remove("hidden");
start();

async function start() {
  catalog = await loadCatalog({ all: true });
  const s = await api.session();
  if (!s) return showLogin();
  $("who").innerHTML = `${esc(s.user?.email || "")}${DEMO ? "" : '<button id="logout">Abmelden</button>'}`;
  $("who").classList.remove("hidden");
  $("logout")?.addEventListener("click", async () => { await api.signOut(); location.reload(); });
  $("dash").classList.remove("hidden");
  setupNotify();
  await loadProjects();
}

function showLogin() {
  $("login").classList.remove("hidden");
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try { await api.signIn($("email").value, $("pw").value); location.reload(); }
    catch (err) { $("loginError").textContent = "Login fehlgeschlagen: " + err.message; }
  };
}

$("mainTabs").onclick = (e) => {
  const b = e.target.closest("button[data-m]"); if (!b) return;
  [...$("mainTabs").children].forEach((x) => x.classList.toggle("on", x === b));
  $("ordersArea").classList.toggle("hidden", b.dataset.m !== "orders");
  $("productsArea").classList.toggle("hidden", b.dataset.m !== "products");
  $("title").textContent = b.dataset.m === "products" ? "Produkte & Preise" : project?.title || "Bestellungen";
  if (b.dataset.m === "products") renderProducts();
};

// ───────── Projekte ─────────
async function loadProjects(selectId) {
  projects = await api.listProjects();
  if (!projects.length) {
    $("noProject").classList.remove("hidden"); $("projectView").classList.add("hidden"); $("projectSel").innerHTML = "";
    return;
  }
  $("noProject").classList.add("hidden");
  const keep = selectId || project?.id || localStorage.getItem("paradiso-admin-project");
  $("projectSel").innerHTML = projects.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join("");
  $("projectSel").value = projects.some((p) => p.id === keep) ? keep : projects[0].id;
  await openProject($("projectSel").value);
}

$("projectSel").onchange = (e) => openProject(e.target.value);
$("newProject").onclick = async () => {
  const title = prompt("Name des Projekts:", "Weihnachten 2026");
  if (!title?.trim()) return;
  const p = await api.createProject(title.trim());
  await loadProjects(p.id);
  openOrderForm();
};

async function openProject(id) {
  const switched = project?.id !== id;
  project = projects.find((p) => p.id === id);
  localStorage.setItem("paradiso-admin-project", id);
  $("title").textContent = project.title;
  $("projectView").classList.remove("hidden");
  const link = new URL("index.html?e=" + project.invite_code, location.href).href;
  $("inviteLink").textContent = link;
  $("guestLink").href = link;
  $("waLink").href = "https://wa.me/?text=" + encodeURIComponent(`${project.title}: Such dir hier aus, was du gern hättest 🥐🍕\n${link}`);
  if (switched) { sel = ALL; closeOrderForm(); seenSubs = null; $("noteInput").value = project.note || ""; noteChanged(); }
  if (sel !== ALL && !order()) sel = ALL;
  if (project.orders.length === 1) sel = project.orders[0].id; // „Gesamt“ lohnt erst ab 2 Bestellungen
  if (switched || !unsub) {
    unsub?.();
    await refresh();
    let t;
    unsub = await api.subscribe(id, () => { clearTimeout(t); t = setTimeout(refresh, 300); });
  } else await refresh();
}

// Notiz für Gäste
function noteChanged() {
  const dirty = $("noteInput").value.trim() !== (project.note || "").trim();
  $("noteSave").classList.toggle("hidden", !dirty);
  $("noteState").textContent = dirty ? "" : project.note ? "Gäste sehen diese Notiz oben auf ihrer Seite." : "";
}
$("noteInput").oninput = noteChanged;
$("noteSave").onclick = async () => {
  const note = $("noteInput").value.trim() || null;
  await api.updateProject(project.id, { note });
  project.note = note; noteChanged();
  $("noteState").textContent = "Gespeichert ✓";
};

// ───────── Mitteilungen ─────────
function setupNotify() {
  if (!("Notification" in globalThis) || Notification.permission !== "default") return;
  $("notifyBtn").classList.remove("hidden");
  $("notifyBtn").onclick = async () => { await Notification.requestPermission(); $("notifyBtn").classList.add("hidden"); };
}
function announce(subs) {
  for (const s of subs.slice(0, 3)) {
    const text = `${s.name} hat ${s.changes.length} Änderung${s.changes.length === 1 ? "" : "en"} abgeschickt`;
    toast(text, 5000);
    if (globalThis.Notification?.permission === "granted" && document.hidden) new Notification(project.title, { body: text });
  }
}

// ───────── Bestellungen anlegen / bearbeiten ─────────
const order = (id = sel) => project.orders.find((o) => o.id === id);
const pad = (n) => String(n).padStart(2, "0");
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function openOrderForm(o) {
  editing = o?.id || null;
  $("orderTitle").value = o?.title || "";
  $("orderPickup").value = toLocalInput(o?.pickup_at);
  $("orderSave").textContent = o ? "Speichern" : "Anlegen";
  $("orderForm").classList.remove("hidden");
  $("orderForm").scrollIntoView({ block: "nearest", behavior: "smooth" });
  $("orderTitle").focus();
}
function closeOrderForm() { editing = null; $("orderForm").classList.add("hidden"); }

$("newOrder").onclick = () => openOrderForm();
$("orderCancel").onclick = closeOrderForm;
$("orderForm").onsubmit = async (e) => {
  e.preventDefault();
  const title = $("orderTitle").value.trim();
  if (!title) return;
  const pickup_at = $("orderPickup").value ? new Date($("orderPickup").value).toISOString() : null;
  try {
    if (editing) await api.updateOrder(editing, { title, pickup_at });
    else sel = (await api.createOrder(project.id, title, pickup_at)).id;
    closeOrderForm();
    await loadProjects(project.id);
  } catch (err) { alert("Speichern fehlgeschlagen: " + err.message); }
};

$("orderTabs").onclick = (e) => {
  const b = e.target.closest("button[data-order]"); if (!b) return;
  sel = b.dataset.order; render();
};

$("orderHead").onclick = async (e) => {
  const o = order(); if (!o) return;
  if (e.target.closest("#editOrder")) return openOrderForm(o);
  if (e.target.closest("#deleteOrder")) {
    const n = data.items.filter((i) => i.order_id === o.id).length;
    if (!confirm(`„${o.title}" löschen?${n ? ` Die Auswahl der Gäste für diese Bestellung (${n} Positionen) geht verloren.` : ""}`)) return;
    await api.deleteOrder(o.id);
    sel = ALL;
    await loadProjects(project.id);
  }
};

$("copyLink").onclick = () => copy($("inviteLink").textContent, "Link kopiert");
$("print").onclick = () => print();
$("toggleClosed").onclick = async () => {
  const o = order(); if (!o) return;
  const closing = !o.closed;
  if (closing && !confirm(`„${o.title}" schließen? Gäste können für diese Bestellung danach nichts mehr ändern.`)) return;
  await api.updateOrder(o.id, { closed: closing });
  await loadProjects(project.id);
};
$("viewTabs").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  view = b.dataset.v;
  [...$("viewTabs").children].forEach((x) => x.classList.toggle("on", x === b));
  $("byProduct").classList.toggle("hidden", view !== "product");
  $("byPerson").classList.toggle("hidden", view !== "person");
  $("byLog").classList.toggle("hidden", view !== "log");
};

async function refresh() {
  data = await api.projectData(project.id);
  const ids = new Set(data.submissions.map((s) => s.id));
  if (seenSubs) announce(data.submissions.filter((s) => !seenSubs.has(s.id)));
  seenSubs = ids;
  render();
}

// ───────── Auswertung ─────────
const prod = (id) => catalog.products.find((p) => p.id === id);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const itemsOf = (s) => (s === ALL ? data.items : data.items.filter((i) => i.order_id === s));
const multiShop = () => new Set(catalog.products.map((p) => p.shop)).size > 1;
const lastSubmit = (pid) => data.submissions.find((s) => s.participant_id === pid)?.created_at; // neueste zuerst

// Summen je Produkt
function totals(items) {
  const m = new Map();
  for (const i of items) {
    const p = prod(i.product_id); if (!p) continue;
    const t = m.get(p.id) || { p, qty: 0, people: new Map() };
    t.qty += i.qty;
    const name = data.participants.find((x) => x.id === i.participant_id)?.name || "?";
    t.people.set(name, (t.people.get(name) || 0) + i.qty);
    m.set(p.id, t);
  }
  return [...m.values()].sort((a, b) => a.p.sort - b.p.sort);
}

function render() {
  renderOrderTabs();
  $("members").innerHTML = infoHtml({
    note: null, guest: false, products: catalog.products.filter((p) => p.active),
    members: data.participants.map((p) => ({ name: p.name, submitted: !!lastSubmit(p.id) })),
  });
  const o = order();
  $("orderView").classList.toggle("hidden", !project.orders.length);
  if (!project.orders.length) return;
  $("orderHead").innerHTML = o
    ? `<div><h2 class="serif">${esc(o.title)} ${o.closed ? '<span class="closed-tag">geschlossen</span>' : ""}</h2>
        <div class="cat-note" style="margin:2px 0 0">${o.pickup_at ? "Abholung " + esc(fmtPickup(o.pickup_at)) : "Kein Abholtermin"}</div></div>
       <div class="no-print"><button class="link-btn" id="editOrder">Bearbeiten</button><button class="link-btn" id="deleteOrder">Löschen</button></div>`
    : `<div><h2 class="serif">Alle Bestellungen</h2><div class="cat-note" style="margin:2px 0 0">${project.orders.length} Bestellungen · ${esc(project.title)}</div></div>`;
  $("toggleClosed").classList.toggle("hidden", !o);
  if (o) {
    $("toggleClosed").textContent = o.closed ? "Wieder öffnen" : "Bestellung schließen";
    $("toggleClosed").className = "btn small " + (o.closed ? "" : "danger");
  }

  const items = itemsOf(sel);
  const rows = totals(items);
  let cost = [0, 0], weight = 0, pieces = 0;
  rows.forEach((r) => { cost = add(cost, lineCost(r.p, r.qty)); weight += lineWeight(r.p, r.qty); pieces += r.qty; });
  const active = new Set(items.map((i) => i.participant_id)).size;
  const sent = data.participants.filter((p) => lastSubmit(p.id)).length;
  $("stats").innerHTML = `
    <div class="stat main"><div class="k">Geschätzte Kosten</div><div class="v">${fmtRange(cost)}</div></div>
    <div class="stat"><div class="k">Gäste mit Auswahl</div><div class="v">${active}</div><div class="cat-note" style="margin:2px 0 0">${data.participants.length} dabei · ${sent} abgeschickt</div></div>
    <div class="stat"><div class="k">Teile gesamt</div><div class="v">${pieces}</div></div>
    <div class="stat"><div class="k">Minis (Gewicht)</div><div class="v">${fmtKg(weight)}</div></div>`;
  renderByProduct(rows);
  renderByPerson(items);
  renderLog();
}

function renderOrderTabs() {
  const orders = project.orders;
  $("noOrder").classList.toggle("hidden", orders.length > 0);
  const tabs = (orders.length > 1 ? [{ id: ALL, title: "Gesamt", sub: `${orders.length} Bestellungen` }] : [])
    .concat(orders.map((o) => ({ id: o.id, title: o.title, sub: o.pickup_at ? fmtPickup(o.pickup_at) : "ohne Termin", closed: o.closed })));
  $("orderTabs").innerHTML = tabs.map((t) => {
    const n = itemsOf(t.id).reduce((a, i) => a + i.qty, 0);
    return `<button data-order="${t.id}" class="${t.id === sel ? "on" : ""}">
      <b>${esc(t.title)}</b><small>${t.closed ? '<span class="closed-tag">geschlossen</span> ' : ""}${esc(t.sub)}</small>
      ${n ? `<span class="cnt">${n}</span>` : ""}</button>`;
  }).join("");
}

function renderByProduct(rows) {
  if (!rows.length) { $("byProduct").innerHTML = `<div class="empty">Noch keine Auswahl abgeschickt.</div>`; return; }
  $("byProduct").innerHTML = catalog.shops.map((s) => {
    const list = rows.filter((r) => r.p.shop === s.id);
    if (!list.length) return "";
    let sub = [0, 0], subW = 0;
    const tr = list.map((r) => {
      const c = lineCost(r.p, r.qty), w = lineWeight(r.p, r.qty); sub = add(sub, c); subW += w;
      return `<tr><td>${r.p.image ? `<img src="${esc(r.p.image)}" alt="">` : ""}</td>
        <td><b>${esc(r.p.name)}</b><br><span class="cat-note">${r.p.code ? esc(r.p.code) + " · " : ""}${esc(priceLabel(r.p))}</span><br>
        <span class="cat-note">${[...r.people].map(([n, q]) => `${esc(n)} ${q}`).join(", ")}</span></td>
        <td class="num"><b>${r.qty}</b> Stk${w ? `<br><span class="cat-note">≈ ${fmtKg(w)}</span>` : ""}</td>
        <td class="num">${fmtRange(c)}</td></tr>`;
    }).join("");
    return `<h3 class="serif">${esc(s.name)}</h3><table>
      <thead><tr><th></th><th>Produkt</th><th class="num">Menge</th><th class="num">Kosten</th></tr></thead>
      <tbody>${tr}<tr class="sub"><td></td><td>Summe ${esc(s.name)}</td><td class="num">${subW ? "≈ " + fmtKg(subW) : ""}</td><td class="num">${fmtRange(sub)}</td></tr></tbody></table>`;
  }).join("");
}

function renderByPerson(items) {
  if (!data.participants.length) { $("byPerson").innerHTML = `<div class="empty">Noch niemand hat sich eingetragen.</div>`; return; }
  const tag = (x) => sel === ALL ? order(x.order_id)?.title : multiShop() ? catalog.shops.find((s) => s.id === x.p.shop)?.name : "";
  $("byPerson").innerHTML = data.participants.map((pp) => {
    const its = items.filter((i) => i.participant_id === pp.id).map((i) => ({ ...i, p: prod(i.product_id) })).filter((x) => x.p)
      .sort((a, b) => project.orders.findIndex((o) => o.id === a.order_id) - project.orders.findIndex((o) => o.id === b.order_id) || a.p.sort - b.p.sort);
    const c = its.reduce((s, x) => add(s, lineCost(x.p, x.qty)), [0, 0]);
    const when = lastSubmit(pp.id);
    return `<div class="person"><div class="person-head"><span><b>${esc(pp.name)}</b>
      <span class="cat-note">${when ? `abgeschickt ${fmtWhen(when)}` : "noch nicht abgeschickt"}</span></span>
      <span>${its.length ? fmtRange(c) : '<span class="cat-note">nichts gewählt</span>'}
      <button class="x no-print" data-del="${pp.id}">entfernen</button></span></div>
      ${its.length ? `<ul>${its.map((x) => `<li>${x.qty}× ${esc(x.p.name)}${tag(x) ? ` <span class="cat-note">(${esc(tag(x))})</span>` : ""}</li>`).join("")}</ul>` : ""}</div>`;
  }).join("");
  $("byPerson").onclick = async (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const name = data.participants.find((p) => p.id === b.dataset.del)?.name;
    if (!confirm(`${name} samt Auswahl in allen Bestellungen entfernen?`)) return;
    await api.deleteParticipant(b.dataset.del); await refresh();
  };
}

// Verlauf: wer hat wann was geändert
function renderLog() {
  const entries = data.submissions.map((s) => ({ ...s, changes: s.changes.filter((c) => sel === ALL || c.order_id === sel) }))
    .filter((s) => s.changes.length);
  if (!entries.length) { $("byLog").innerHTML = `<div class="empty">Noch nichts abgeschickt.</div>`; return; }
  const line = (c) => {
    const name = esc(prod(c.product_id)?.name || c.product_id);
    const where = sel === ALL && project.orders.length > 1 ? ` <span class="cat-note">(${esc(order(c.order_id)?.title || "gelöschte Bestellung")})</span>` : "";
    if (!c.old) return `<li class="plus">+ ${c.new}× ${name}${where}</li>`;
    if (!c.new) return `<li class="minus">− ${name} <span class="cat-note">(war ${c.old})</span>${where}</li>`;
    return `<li>${name}: ${c.old} → <b>${c.new}</b>${where}</li>`;
  };
  $("byLog").innerHTML = entries.map((s, i) => {
    const first = !entries.slice(i + 1).some((x) => x.participant_id === s.participant_id && x.name === s.name);
    return `<div class="log"><div class="log-head"><b>${esc(s.name)}</b> <span class="cat-note">${first ? "hat abgeschickt" : "hat aktualisiert"} · ${esc(fmtWhen(s.created_at))}</span></div>
      <ul>${s.changes.map(line).join("")}</ul></div>`;
  }).join("");
}

// Text zum Durchgeben/Schicken an den Laden – je Bestellung ein Block
function orderText(o) {
  const rows = totals(itemsOf(o.id));
  if (!rows.length) return "";
  const head = [`Bestellung: ${o.title}`, o.pickup_at ? `Abholung: ${fmtPickup(o.pickup_at)}` : ""].filter(Boolean);
  return head.concat("", catalog.shops.flatMap((s) => {
    const list = rows.filter((r) => r.p.shop === s.id);
    if (!list.length) return [];
    const w = list.reduce((a, r) => a + lineWeight(r.p, r.qty), 0);
    return [`== ${s.name} ==`, ...list.map((r) => `${r.qty}× ${r.p.name}${r.p.code ? ` [${r.p.code}]` : ""}`),
      w ? `(Minis gesamt ca. ${fmtKg(w)})` : "", ""];
  })).join("\n").trim();
}
$("copyList").onclick = () => {
  const txt = (sel === ALL ? project.orders : [order()]).map(orderText).filter(Boolean).join("\n\n――――――――――\n\n");
  if (!txt) return alert("Noch nichts bestellt.");
  copy(txt, "Bestellliste kopiert");
};

// ───────── Produkte & Preise ─────────
let pTab, pEdit = null, pFile = null;
function renderProducts() {
  const tabs = productTabs(catalog);
  if (!tabs.some((t) => t.id === pTab)) pTab = tabs[0]?.id;
  $("pTabs").classList.toggle("hidden", tabs.length < 2);
  $("pTabs").innerHTML = tabs.map((t) => `<button data-tab="${t.id}" class="${t.id === pTab ? "on" : ""}">${esc(t.label)}</button>`).join("");
  const products = catalog.products.filter(inTab(pTab));
  $("pChips").innerHTML = chipsHtml(products);
  $("pCatalog").innerHTML = sectionsHtml(products, (p) => `
    <article class="card admin ${p.active ? "" : "off"}" data-edit="${p.id}">
      <div class="ph">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<div class="soon">Bild folgt</div>`}
        ${p.code ? `<span class="code">${esc(p.code)}</span>` : ""}
        ${!p.active ? `<span class="flag">Ausgeblendet</span>` : p.coming_soon ? `<span class="flag soon-flag">Bald dabei</span>` : ""}</div>
      <div class="body"><div class="name">${esc(p.name)}</div>
        <div class="price">${piecePrice(p)} <span class="cat-note">· ${esc(priceLabel(p))}</span></div>
        <div class="foot"><span class="edit">Bearbeiten</span></div></div></article>`);
}
$("pTabs").onclick = (e) => { const b = e.target.closest("button[data-tab]"); if (b) { pTab = b.dataset.tab; renderProducts(); } };
$("pCatalog").onclick = (e) => { const c = e.target.closest("[data-edit]"); if (c) openProduct(prod(c.dataset.edit)); };
$("newProduct").onclick = () => {
  const [shop, kind] = (pTab || "paradiso:suess").split(":");
  openProduct(null, { shop, kind });
};

function openProduct(p, defaults = {}) {
  pEdit = p; pFile = null;
  const d = p || { shop: defaults.shop, kind: defaults.kind, unit: "kg", price_min: 18, price_max: 18, est_weight_g: 30, active: true, coming_soon: false };
  $("pmTitle").textContent = p ? "Produkt bearbeiten" : "Neues Produkt";
  $("pmShop").innerHTML = catalog.shops.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("pmCats").innerHTML = [...new Set(catalog.products.map((x) => x.category))].map((c) => `<option value="${esc(c)}">`).join("");
  $("pmName").value = d.name || "";
  $("pmShop").value = d.shop;
  $("pmKind").value = d.kind || "suess";
  $("pmCat").value = d.category || "";
  $("pmUnit").value = d.unit;
  $("pmWeight").value = d.est_weight_g ?? "";
  $("pmPmin").value = d.price_min; $("pmPmax").value = d.price_max;
  $("pmStatus").value = !d.active ? "hidden" : d.coming_soon ? "soon" : "active";
  $("pmCode").value = d.code || "";
  setPreview(d.image);
  $("pmError").textContent = "";
  pmUpdate();
  $("pm").classList.remove("hidden"); $("pmBg").classList.remove("hidden");
}
function setPreview(src) {
  $("pmImg").classList.toggle("hidden", !src); $("pmNoImg").classList.toggle("hidden", !!src);
  if (src) $("pmImg").src = src;
}
function pmUpdate() {
  const kg = $("pmUnit").value === "kg";
  $("pmWeightL").classList.toggle("hidden", !kg);
  $("pmWeight").required = kg;
  $("pmPminL").textContent = kg ? "€ pro kg (ab)" : "€ pro Stück (ab)";
  $("pmPmaxL").textContent = kg ? "€ pro kg (bis)" : "€ pro Stück (bis)";
  const p = { unit: $("pmUnit").value, price_min: +$("pmPmin").value, price_max: +$("pmPmax").value || +$("pmPmin").value, est_weight_g: +$("pmWeight").value };
  const pp = piecePrice(p);
  $("pmHint").textContent = pp ? `Gäste sehen: ${pp} pro Stück` : "";
}
["pmUnit", "pmPmin", "pmPmax", "pmWeight"].forEach((id) => { $(id).oninput = pmUpdate; });
$("pmFile").onchange = () => {
  pFile = $("pmFile").files[0] || null;
  if (pFile) setPreview(URL.createObjectURL(pFile));
};
const closeProduct = () => { $("pm").classList.add("hidden"); $("pmBg").classList.add("hidden"); $("pmFile").value = ""; };
$("pmClose").onclick = $("pmCancel").onclick = $("pmBg").onclick = closeProduct;

const slug = (s) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "produkt";
$("pmForm").onsubmit = async (e) => {
  e.preventDefault();
  $("pmError").textContent = "";
  $("pmSave").disabled = true; $("pmSave").textContent = "Speichert …";
  try {
    const kg = $("pmUnit").value === "kg";
    const pmin = +$("pmPmin").value, pmax = +$("pmPmax").value || pmin;
    if (pmax < pmin) throw new Error("„Preis bis“ ist kleiner als „Preis ab“.");
    let id = pEdit?.id;
    if (!id) { id = slug($("pmName").value); while (prod(id)) id += "-2"; }
    const image = pFile ? await api.uploadImage(await shrink(pFile)) : pEdit?.image ?? null;
    const status = $("pmStatus").value;
    await api.saveProduct({
      id, shop: $("pmShop").value, kind: $("pmKind").value, category: $("pmCat").value.trim(),
      name: $("pmName").value.trim(), code: $("pmCode").value.trim() || null, image,
      unit: $("pmUnit").value, price_min: pmin, price_max: pmax, est_weight_g: kg ? Math.round(+$("pmWeight").value) : null,
      sort: pEdit?.sort ?? Math.max(0, ...catalog.products.map((x) => x.sort)) + 1,
      active: status !== "hidden", coming_soon: status === "soon",
    });
    catalog = await loadCatalog({ all: true });
    pTab = $("pmShop").value + ":" + $("pmKind").value;
    closeProduct(); renderProducts(); if (project) render();
    toast("Gespeichert ✓");
  } catch (err) { $("pmError").textContent = "Speichern fehlgeschlagen: " + err.message; }
  finally { $("pmSave").disabled = false; $("pmSave").textContent = "Speichern"; }
};

// Fotos vor dem Hochladen verkleinern (Handyfotos haben oft mehrere MB)
async function shrink(file, max = 1200) {
  try {
    const img = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * s), height: Math.round(img.height * s) });
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
  } catch {
    if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size < 5e6) return file;
    throw new Error("Dieses Bildformat geht nicht – bitte ein JPG oder PNG wählen.");
  }
}

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); alert(msg); }
  catch { prompt("Zum Kopieren markieren:", text); }
}
let toastT;
function toast(text, ms = 2500) {
  document.querySelector(".toast")?.remove();
  const t = Object.assign(document.createElement("div"), { className: "toast", textContent: text });
  document.body.append(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}
