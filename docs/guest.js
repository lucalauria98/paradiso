import { api, DEMO, loadCatalog, esc, fmtPickup, fmtWhen, fmtSpan, fmtKg, stkCost, gramCost, priceText, variantsOf, VARIANTS, variantLabel, isWeighed, stepG, qtyText } from "./api.js";
import { productTabs, inTab, chipsHtml, sectionsHtml, infoHtml, variantHead } from "./ui.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const code = params.get("e") || (DEMO ? "demo" : "");
const storeKey = "paradiso-guest-" + code;
const draftKey = "paradiso-draft3-" + code;
const lastKey = "paradiso-last-" + code;   // letzte abgeschickte Auswahl als Sicherung (falls die Anmeldung verloren geht)
const isAuthError = (e) => /Nicht berechtigt/.test(e?.message || "");
let lostName = null; // Name, falls die Anmeldung nicht mehr gilt (z. B. vom Gastgeber entfernt)

let me = JSON.parse(localStorage.getItem(storeKey) || "null"); // {id, secret, name}
let catalog, project, tabs, activeOrder, activeTab, submittedAt = null, busy = false;
let vegOnly = localStorage.getItem("paradiso-veg") === "1"; // Filter „Nur vegetarisch“
// Abgeschickter Stand (wie beim Admin) und Entwurf im Browser: "bestellung|produkt|größe" → Menge
let sent = new Map(), draft = new Map();
// Notizen: abgeschickt / Entwurf. Schlüssel "bestellung|produkt" – Produkt leer = Anmerkung zur ganzen Bestellung
let sentNotes = new Map(), draftNotes = new Map();
const nkey = (orderId, productId = "") => orderId + "|" + productId;
let noteOpen = null; // Produkt, dessen Notizfeld auf der Karte gerade offen ist
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
      restoreDraft();
      return showShop();
    } catch (e) {
      // Netzwerkfehler o. ä.: Anmeldung NICHT wegwerfen, nur Hinweis zeigen
      if (!isAuthError(e)) return showNoLink("Verbindung fehlgeschlagen – bitte Seite neu laden.", "Hoppla");
      // Anmeldung gilt nicht mehr: Auswahl retten, Namen vorschlagen
      lostName = me.name; recoverSelection(); me = null; localStorage.removeItem(storeKey);
    }
  }
  if (project.orders.every((o) => o.closed)) return showNoLink("Alle Bestellungen sind bereits geschlossen.", "Geschlossen");
  showJoin();
}

async function loadMine() {
  const r = await api.guestItems(me.id, me.secret);
  sent = new Map(r.items.map((i) => [key(i.order_id, i.product_id, i.variant), i.qty]));
  draft = new Map(sent);
  sentNotes = new Map((r.notes || []).map((n) => [nkey(n.order_id, n.product_id), n.note]));
  draftNotes = new Map(sentNotes);
  submittedAt = r.submitted_at;
  localStorage.setItem(lastKey, JSON.stringify({ items: [...sent], notes: [...sentNotes] }));
}
function restoreDraft() {
  const saved = JSON.parse(localStorage.getItem(draftKey) || "null");
  if (saved) { draft = new Map(saved.items); draftNotes = new Map(saved.notes); }
}
// Entwurf bzw. letzte abgeschickte Auswahl übernehmen – als neuer, noch nicht abgeschickter Stand.
// Nur offene Bestellungen: In geschlossenen lässt sich nichts mehr neu abschicken.
function recoverSelection() {
  const saved = JSON.parse(localStorage.getItem(draftKey) || "null") || JSON.parse(localStorage.getItem(lastKey) || "null");
  const open = ([k]) => order(k.split("|")[0]) && !order(k.split("|")[0]).closed;
  sent = new Map(); sentNotes = new Map(); submittedAt = null;
  draft = new Map((saved?.items || []).filter(open)); draftNotes = new Map((saved?.notes || []).filter(open));
}

function showNoLink(text, heading) {
  if (!project) $("title").textContent = "Café Paradiso";
  if (heading) $("nolink").querySelector("h2").textContent = heading;
  if (text) $("nolinkText").textContent = text;
  $("nolink").classList.remove("hidden");
}

function showJoin() {
  $("join").classList.remove("hidden");
  if (lostName) {
    $("nameInput").value = lostName;
    $("joinNote").textContent = "Deine Anmeldung gibt es nicht mehr – vielleicht hat der Gastgeber dich entfernt. Trag dich einfach neu ein: Deine Auswahl ist noch da und du kannst sie gleich wieder abschicken.";
    $("joinNote").classList.remove("hidden");
  }
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
      persistDraft();
      $("join").classList.add("hidden");
      showShop();
      if (lostName && dirty()) { lostName = null; openSheet(); }
    } catch (e) { $("joinError").textContent = e.message; }
  };
}

function forget() {
  me = null; [storeKey, draftKey, lastKey].forEach((k) => localStorage.removeItem(k));
  sent.clear(); draft.clear(); sentNotes.clear(); draftNotes.clear();
}

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
  renderInfo(); renderOrders(); renderVeg(); renderTabs(); renderCatalog(); renderBar();
}

const renderInfo = () => { $("info").innerHTML = infoHtml({ note: project.note, members: project.members, products: catalog.products }); };

// ───────── Entwurf vs. abgeschickt ─────────
const isOpen = (k) => !order(k.split("|")[0])?.closed;
function changedKeys() {
  return [...new Set([...sent.keys(), ...draft.keys()])].filter((k) => isOpen(k) && (sent.get(k) || 0) !== (draft.get(k) || 0));
}
// Bestellungen, in denen sich eine Notiz geändert hat
const notesChanged = () => project.orders.filter((o) => !o.closed && [...new Set([...sentNotes.keys(), ...draftNotes.keys()])]
  .some((k) => k.startsWith(o.id + "|") && (sentNotes.get(k) || "").trim() !== (draftNotes.get(k) || "").trim()));
const dirty = () => changedKeys().length > 0 || notesChanged().length > 0;
function persistDraft() {
  dirty() ? localStorage.setItem(draftKey, JSON.stringify({ items: [...draft], notes: [...draftNotes] })) : localStorage.removeItem(draftKey);
}
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

// ───────── Nur vegetarisch ─────────
function renderVeg() {
  $("vegToggle").classList.toggle("on", vegOnly);
  $("vegToggle").setAttribute("aria-pressed", vegOnly);
  $("vegToggle").innerHTML = vegOnly ? "🌱 Nur vegetarisch <b>an</b>" : "🌱 Nur vegetarisch";
}
$("vegToggle").onclick = () => {
  vegOnly = !vegOnly;
  localStorage.setItem("paradiso-veg", vegOnly ? "1" : "0");
  renderVeg(); renderCatalog();
};

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
  const products = catalog.products.filter(inTab(activeTab)).filter((p) => !vegOnly || p.veggie);
  $("chips").innerHTML = chipsHtml(products);
  $("catalog").innerHTML = !products.length && vegOnly
    ? `<div class="empty"><h3 class="serif">Nichts Vegetarisches hier</h3>In diesem Bereich gibt es nichts mit 🌱. Schalte „Nur vegetarisch“ aus, um alles zu sehen.</div>`
    : sectionsHtml(products, cardHtml);
  $("catalog").onclick = onCatalogClick;
  // Produkt-Notiz tippen: nur Entwurf aktualisieren (Feld nicht neu zeichnen, sonst springt der Cursor)
  $("catalog").oninput = (e) => {
    const t = e.target.closest("[data-pnote]"); if (!t) return;
    draftNotes.set(nkey(activeOrder, t.dataset.pnote), t.value);
    persistDraft(); renderBar();
  };
}

// Notiz zu einem Produkt (z. B. „mit Bio-Rindhack“) – erscheint, sobald es gewählt ist
function cardNoteHtml(p) {
  const note = draftNotes.get(nkey(activeOrder, p.id)) || "";
  if (order().closed) return note ? `<p class="pnote-ro">📝 ${esc(note)}</p>` : "";
  if (noteOpen === p.id) return `<div class="pnote-edit"><textarea class="field note-in small" data-pnote="${p.id}" rows="2" maxlength="300"
      placeholder="Notiz zu ${esc(p.name)}, z. B. „mit Bio-Rindhack“">${esc(note)}</textarea>
      <button class="link-btn" data-noteclose="${p.id}">fertig</button></div>`;
  return note ? `<button class="pnote" data-noteopen="${p.id}" title="Notiz ändern">📝 ${esc(note)}</button>`
    : `<button class="pnote-add" data-noteopen="${p.id}">📝 Notiz</button>`;
}

// Karte: je Größe (Mini / Normal) eine Zeile mit Preis und eigener Menge
function cardHtml(p) {
  const vs = variantsOf(p);
  const total = vs.reduce((n, v) => n + (draft.get(key(activeOrder, p.id, v)) || 0), 0);
  const img = p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" data-zoom="${p.id}">`
    : `<div class="soon">Bild folgt</div>`;
  const rows = p.coming_soon ? `<div class="meta">Bald dabei – noch nicht bestellbar</div>` : vs.map((v) => {
    const q = draft.get(key(activeOrder, p.id, v)) || 0;
    const ctrl = order().closed ? (q ? `<div class="meta">${qtyText(p, v, q)}${isWeighed(p, v) ? "" : " Stück"} gewählt</div>` : "")
      : q ? stepperHtml(activeOrder, p.id, v, q)
      : `<button class="add" data-order="${activeOrder}" data-id="${p.id}" data-v="${v}" data-d="1">+ ${isWeighed(p, v) ? fmtKg(stepG(p)) : vs.length > 1 ? VARIANTS[v] : "Hinzufügen"}</button>`;
    return `<div class="variant ${q ? "on" : ""}">${variantHead(p, v)}${ctrl}</div>`;
  }).join("");
  return `<article class="card ${total ? "picked" : ""}" id="card-${p.id}">
    <div class="ph">${img}${p.veggie ? `<span class="veg-badge">🌱 Vegetarisch</span>` : ""}${total ? `<span class="badge">${p.by_weight && vs.length === 1 ? qtyText(p, "mini", total) : total}</span>` : ""}</div>
    <div class="body"><div class="name">${esc(p.name)}</div><div class="foot">${rows}${total && !p.coming_soon ? cardNoteHtml(p) : ""}</div></div></article>`;
}

const stepperHtml = (orderId, id, v, q) =>
  `<div class="stepper"><button data-order="${orderId}" data-id="${id}" data-v="${v}" data-d="-1" aria-label="weniger">−</button><span class="q">${qtyText(prod(id), v, q)}</span><button data-order="${orderId}" data-id="${id}" data-v="${v}" data-d="1" aria-label="mehr">+</button></div>`;

function onCatalogClick(e) {
  const z = e.target.closest("[data-zoom]");
  if (z) return zoom(z.dataset.zoom);
  const n = e.target.closest("[data-noteopen],[data-noteclose]");
  if (n) {
    const id = n.dataset.noteopen || n.dataset.noteclose;
    noteOpen = n.dataset.noteopen ? id : null;
    $("card-" + id).outerHTML = cardHtml(prod(id));
    if (noteOpen) $("card-" + id).querySelector("textarea")?.focus();
    return;
  }
  const b = e.target.closest("button[data-id]");
  if (b) change(b.dataset.order, b.dataset.id, b.dataset.v, +b.dataset.d);
}

function change(orderId, id, v, d) {
  if (order(orderId).closed) return;
  const k = key(orderId, id, v);
  const q = Math.max(0, Math.min(500, (draft.get(k) || 0) + d));
  q ? draft.set(k, q) : draft.delete(k);
  $("reviewed").checked = false; // nach jeder Änderung neu bestätigen
  // Produkt ganz abgewählt → Notiz dazu fällt weg
  if (!variantsOf(prod(id)).some((x) => draft.get(key(orderId, id, x)))) { draftNotes.delete(nkey(orderId, id)); if (noteOpen === id) noteOpen = null; }
  persistDraft();
  const card = $("card-" + id);
  if (card && orderId === activeOrder) card.outerHTML = cardHtml(prod(id));
  if (!$("sheet").classList.contains("hidden")) renderSheet();
  if (project.orders.length > 1) renderOrders();
  renderBar();
}

// ───────── Abschicken ─────────
async function submit() {
  if (busy || !dirty() || !$("reviewed").checked) return;
  busy = true; renderBar();
  let rejoinNeeded = false;
  const before = new Set(changedKeys().map((k) => k.split("|")[0]).concat(notesChanged().map((o) => o.id)));
  try {
    const items = [...draft].map(([k, qty]) => ({ ...split(k), qty }));
    const notes = [...draftNotes].map(([k, note]) => { const [order_id, product_id] = k.split("|"); return { order_id, product_id, note: note.trim() }; })
      .filter((n) => n.note && !order(n.order_id)?.closed);
    await api.guestSubmit(me.id, me.secret, items, notes);
    project = await api.guestProject(code);
    await loadMine();
    localStorage.removeItem(draftKey);
    const lost = project.orders.filter((o) => o.closed && before.has(o.id));
    toast(lost.length ? `„${lost.map((o) => o.title).join("“, „")}“ ist inzwischen geschlossen – dort wurde nichts geändert.`
      : "Abgeschickt ✓ – du kannst jederzeit ändern und erneut abschicken.", 4000);
    noteOpen = null; $("reviewed").checked = false;
    renderInfo(); renderOrders(); renderCatalog();
    if (!$("sheet").classList.contains("hidden")) renderSheet();
  } catch (e) {
    if (isAuthError(e)) rejoinNeeded = true;
    else toast("Abschicken fehlgeschlagen: " + e.message, 5000);
  } finally { busy = false; renderBar(); }
  if (rejoinNeeded) await rejoin();
}

// Anmeldung gibt es nicht mehr (z. B. vom Gastgeber entfernt): neu eintragen und Auswahl abschicken
async function rejoin() {
  const name = me.name;
  if (!confirm(`Deine Anmeldung gibt es nicht mehr – vielleicht hat der Gastgeber dich entfernt.\n\nNeu eintragen als „${name}“ und deine Auswahl abschicken?`)) {
    return toast("Nicht abgeschickt – deine Auswahl ist noch da.", 4000);
  }
  try {
    const r = await api.guestJoin(code, name);
    me = { ...r, name };
    localStorage.setItem(storeKey, JSON.stringify(me));
    sent = new Map(); sentNotes = new Map(); submittedAt = null;
    persistDraft();
    await submit();
  } catch (e) { toast("Neu eintragen fehlgeschlagen: " + e.message, 5000); }
}
// Unten „Abschicken“ öffnet erst die Übersicht (prüfen + Anmerkung), dort „Jetzt abschicken“
$("submitBtn").onclick = () => openSheet();
$("sheetSubmit").onclick = submit;

function renderBar() {
  const mine = [...draft].filter(([k]) => k.startsWith(activeOrder + "|"));
  let pieces = 0, grams = 0;
  for (const [k, q] of mine) { const { product_id, variant } = split(k); const p = prod(product_id); if (!p) continue; isWeighed(p, variant) ? (grams += q * stepG(p)) : (pieces += q); }
  const label = project.orders.length > 1 ? `${order().title}: ` : "Deine Auswahl: ";
  const amount = [pieces ? `${pieces} Stück` : "", grams ? fmtKg(grams) : ""].filter(Boolean).join(" + ");
  $("cartLabel").textContent = mine.length ? `🧺 ${label}${amount} · ${mine.length} Sorte${mine.length === 1 ? "" : "n"}` : "🧺 Noch nichts ausgewählt";
  const d = dirty();
  $("savedLabel").textContent = busy ? "wird abgeschickt …" : d ? "Noch nicht abgeschickt"
    : submittedAt ? `Abgeschickt ✓ ${fmtWhen(submittedAt)}` : "";
  $("savedLabel").classList.toggle("warn", d && !busy);
  $("submitBtn").disabled = busy || !d;
  $("submitBtn").textContent = d ? "Abschicken" : submittedAt ? "Abgeschickt ✓" : "Abschicken";
  $("reviewRow").classList.toggle("hidden", !d);
  $("sheetSubmit").disabled = busy || !d || !$("reviewed").checked;
  $("sheetSubmit").textContent = busy ? "Wird abgeschickt …" : d ? "Jetzt abschicken" : submittedAt ? "Abgeschickt ✓" : "Jetzt abschicken";
}

function openSheet() { renderSheet(); renderBar(); $("sheet").classList.remove("hidden"); $("sheetBg").classList.remove("hidden"); }
$("reviewed").onchange = renderBar;
$("cartBtn").onclick = openSheet;
$("sheetClose").onclick = $("sheetBg").onclick = () => { $("sheet").classList.add("hidden"); $("sheetBg").classList.add("hidden"); };

// Übersicht über alle Bestellungen des Projekts: Produkte mit Notiz + Anmerkung zur ganzen Bestellung
function renderSheet() {
  const multiShop = new Set(catalog.products.map((p) => p.shop)).size > 1;
  let total = [0, 0], minis = 0, tbd = 0, any = false;
  const html = project.orders.map((o) => {
    const products = catalog.products.filter((p) => variantsOf(p).some((v) => draft.get(key(o.id, p.id, v))));
    const note = draftNotes.get(nkey(o.id)) || "";
    if (products.length || note) any = true;
    const rows = products.map((p) => {
      const lines = variantsOf(p).filter((v) => draft.get(key(o.id, p.id, v))).map((v) => {
        const q = draft.get(key(o.id, p.id, v));
        const c = v === "stk" ? stkCost(p, q) : isWeighed(p, v) ? gramCost(p, q * stepG(p)) : null;
        if (c) total = [total[0] + c[0], total[1] + c[1]]; else if (v === "mini" && !p.by_weight) minis += q; else tbd += 1;
        const size = variantLabel(p, v);
        return `<div class="row">${p.image ? `<img src="${esc(p.image)}" alt="">` : `<div class="noimg"></div>`}
          <div class="grow">${p.veggie ? "🌱 " : ""}${esc(p.name)}${size ? ` <span class="size">${size}</span>` : ""}<small>${esc(multiShop ? catalog.shops.find((s) => s.id === p.shop)?.name + " · " : "")}${priceText(p, v)}</small></div>
          ${o.closed ? `<b>${isWeighed(p, v) ? qtyText(p, v, q) : q + "×"}</b>` : stepperHtml(o.id, p.id, v, q)}</div>`;
      }).join("");
      const pn = draftNotes.get(nkey(o.id, p.id)) || "";
      const pnHtml = o.closed ? (pn ? `<p class="pnote-ro">📝 ${esc(pn)}</p>` : "")
        : `<input class="field note-in small" data-order="${o.id}" data-pnote="${p.id}" maxlength="300" value="${esc(pn)}" placeholder="📝 Notiz zu ${esc(p.name)} (optional)">`;
      return `<div class="sheet-prod">${lines}${pnHtml}</div>`;
    }).join("");
    const noteHtml = o.closed
      ? (note ? `<p class="note-ro">📝 ${esc(note)}</p>` : "")
      : `<label class="note-label">Anmerkung zur ganzen Bestellung <span class="cat-note">(optional)</span>
          <textarea class="field note-in" data-note="${o.id}" rows="2" maxlength="500" placeholder="z. B. „Bitte alles getrennt verpacken“">${esc(note)}</textarea></label>`;
    return `<div class="shop-head">${esc(o.title)}${o.pickup_at ? " · " + esc(fmtPickup(o.pickup_at)) : ""}${o.closed ? " · geschlossen" : ""}</div>
      ${rows || `<p class="cat-note" style="margin:6px 0">Noch nichts ausgewählt.</p>`}${noteHtml}`;
  }).join("");
  $("sheetBody").innerHTML = html;
  const parts = [total[1] ? `Geschätzt <b>${fmtSpan(total)}</b>` : "", minis ? `+ ${minis} Minis nach Gewicht` : "", tbd ? `+ ${tbd} ${tbd === 1 ? "Position" : "Positionen"} ohne Preis` : ""].filter(Boolean);
  $("sheetTotal").innerHTML = any ? parts.join(" ") : "";
  $("sheetBody").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) change(b.dataset.order, b.dataset.id, b.dataset.v, +b.dataset.d); };
  // Notizen tippen: nur Entwurf aktualisieren (Feld nicht neu zeichnen, sonst springt der Cursor)
  $("sheetBody").oninput = (e) => {
    const t = e.target.closest("[data-note],[data-pnote]"); if (!t) return;
    draftNotes.set(t.dataset.note ? nkey(t.dataset.note) : nkey(t.dataset.order, t.dataset.pnote), t.value);
    persistDraft(); renderBar();
  };
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
