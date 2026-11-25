import { api, DEMO, loadCatalog, esc, lineWeight, stkCost, gramCost, fmtRange, fmtKg, priceLabel, priceText, priceKnown, fmtPickup, fmtWhen, variantsOf, VARIANTS, withVariant } from "./api.js";
import { productTabs, inTab, chipsHtml, sectionsHtml, infoHtml } from "./ui.js";

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

// Summen je Produkt und Größe
function totals(items) {
  const m = new Map();
  for (const i of items) {
    const p = prod(i.product_id); if (!p) continue;
    const k = p.id + "|" + i.variant;
    const t = m.get(k) || { p, v: i.variant, qty: 0, people: new Map() };
    t.qty += i.qty;
    const name = data.participants.find((x) => x.id === i.participant_id)?.name || "?";
    t.people.set(name, (t.people.get(name) || 0) + i.qty);
    m.set(k, t);
  }
  return [...m.values()].sort((a, b) => a.p.sort - b.p.sort || (a.v === "mini" ? -1 : 1));
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
  renderStats(o, items);
  renderByProduct(o);
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

// ───────── Bestellplanung: was wirklich beim Laden bestellt wird ─────────
// Gäste wählen Stückzahlen. Der Admin legt pro Bestellung fest: Minis in Gramm (Vorschlag = Wünsche
// × Stückgewicht, auf 100 g aufgerundet), normale Teile in Stück, optional Minis gemischt je Kategorie.
const roundUp100 = (g) => (g > 0 ? Math.ceil(g / 100) * 100 : 0);
const planSet = (orderId, pid, v) => data.plans.find((x) => x.order_id === orderId && x.product_id === pid && x.variant === v)?.amount;
// kg-Preis einer gemischten Gruppe: gewichteter Mittelwert der bekannten Preise (null = Preis folgt)
const avgKgPrice = (rows) => {
  const known = rows.filter((r) => priceKnown(r.p, "mini"));
  if (!known.length) return null;
  const w = known.reduce((a, r) => a + lineWeight(r.p, r.qty, "mini"), 0);
  return w ? known.reduce((a, r) => a + lineWeight(r.p, r.qty, "mini") * r.p.mini_price_kg, 0) / w : known[0].p.mini_price_kg;
};
const costHtml = (c) => (c ? fmtRange(c) : '<span class="cat-note">Preis folgt</span>');
function planOf(o) {
  const mix = o.mini_mix || {};
  const lines = [], groups = new Map();
  for (const r of totals(itemsOf(o.id))) {
    if (r.v === "mini" && mix[r.p.category] != null) {
      let g = groups.get(r.p.category);
      if (!g) { g = { type: "mix", category: r.p.category, shop: r.p.shop, rows: [] }; groups.set(r.p.category, g); lines.push(g); }
      g.rows.push(r);
      continue;
    }
    const suggested = r.v === "mini" ? roundUp100(lineWeight(r.p, r.qty, "mini")) : r.qty;
    const set = planSet(o.id, r.p.id, r.v);
    const amount = set ?? suggested;
    const cost = r.v === "mini" ? gramCost(r.p, amount) : stkCost(r.p, amount);
    lines.push({ type: "item", ...r, shop: r.p.shop, suggested, amount, adjusted: set != null && set !== suggested, cost, grams: r.v === "mini" ? amount : 0 });
  }
  for (const g of groups.values()) {
    g.qty = g.rows.reduce((a, r) => a + r.qty, 0);
    g.suggested = roundUp100(g.rows.reduce((a, r) => a + lineWeight(r.p, r.qty, "mini"), 0));
    g.amount = mix[g.category] || g.suggested;     // 0 = Vorschlag verwenden
    g.adjusted = g.amount !== g.suggested;
    g.grams = g.amount;
    g.cost = gramCost(null, g.amount, avgKgPrice(g.rows));
  }
  return lines;
}
const sumPlan = (lines) => lines.reduce((t, l) => ({
  cost: l.cost ? add(t.cost, l.cost) : t.cost, grams: t.grams + l.grams, tbd: t.tbd + (l.cost || !l.amount ? 0 : 1),
}), { cost: [0, 0], grams: 0, tbd: 0 });
const sumHtml = (sum) => `${sum.cost[1] ? fmtRange(sum.cost) : sum.tbd ? "" : fmtRange(sum.cost)}${sum.tbd ? `<span class="cat-note">${sum.cost[1] ? " + " : ""}${sum.tbd} × Preis folgt</span>` : ""}`;
const people = (r) => [...r.people].map(([n, q]) => `${esc(n)} ${q}`).join(", ");

function renderStats(o, items) {
  const orders = o ? [o] : project.orders;
  const plan = sumPlan(orders.flatMap(planOf));
  const pieces = items.reduce((a, i) => a + i.qty, 0);
  const active = new Set(items.map((i) => i.participant_id)).size;
  const sent = data.participants.filter((p) => lastSubmit(p.id)).length;
  const finals = orders.filter((x) => x.final_amount != null);
  const finalSum = finals.reduce((a, x) => a + +x.final_amount, 0);
  const finalHtml = o
    ? `<div class="v"><input class="final" id="finalInput" type="number" min="0" step="0.01" inputmode="decimal" value="${o.final_amount ?? ""}" placeholder="–"> €</div>
       <div class="cat-note" style="margin:2px 0 0">${o.final_amount != null ? "laut Bon" : "nach dem Abholen eintragen"}</div>`
    : `<div class="v">${finals.length ? fmtRange([finalSum, finalSum]).replace("ca. ", "") : "–"}</div>
       <div class="cat-note" style="margin:2px 0 0">${finals.length} von ${orders.length} eingetragen</div>`;
  $("stats").innerHTML = `
    <div class="stat main"><div class="k">Geschätzte Kosten</div><div class="v">${plan.cost[1] || !plan.tbd ? fmtRange(plan.cost) : "–"}</div><div class="cat-note" style="margin:2px 0 0;color:#cfe6d8">nach Bestellmenge${plan.tbd ? ` · ${plan.tbd} Posten ohne Preis` : ""}</div></div>
    <div class="stat"><div class="k">Endbetrag</div>${finalHtml}</div>
    <div class="stat"><div class="k">Gäste mit Auswahl</div><div class="v">${active}</div><div class="cat-note" style="margin:2px 0 0">${data.participants.length} dabei · ${sent} abgeschickt</div></div>
    <div class="stat"><div class="k">Minis (Bestellung)</div><div class="v">${fmtKg(plan.grams)}</div><div class="cat-note" style="margin:2px 0 0">${pieces} Teile gewünscht</div></div>`;
}
$("stats").onchange = async (e) => {
  if (e.target.id !== "finalInput") return;
  const o = order(); const v = e.target.value === "" ? null : Math.round(+e.target.value * 100) / 100;
  await api.updateOrder(o.id, { final_amount: v });
  o.final_amount = v; render();
};

function renderByProduct(o) {
  if (!o) return renderWishes();
  const lines = planOf(o);
  if (!lines.length) { $("byProduct").innerHTML = `<div class="empty">Noch keine Auswahl abgeschickt.</div>` + notesHtml(o); return; }
  const mix = o.mini_mix || {};
  const cats = [...new Set(totals(itemsOf(o.id)).filter((r) => r.v === "mini").map((r) => r.p.category))];
  const mixBar = cats.length ? `<div class="mixbar no-print"><span class="cat-note">Minis gemischt bestellen:</span>
    ${cats.map((c) => `<button class="chip ${mix[c] != null ? "on" : ""}" data-mix="${esc(c)}">${mix[c] != null ? "✓ " : ""}${esc(c)}</button>`).join("")}</div>` : "";
  const unit = (v) => (v === "mini" ? "g" : "Stk");
  const amountHtml = (l, attr) => `<input class="amt" type="number" min="0" step="${l.type === "mix" || l.v === "mini" ? 100 : 1}" inputmode="numeric" value="${l.amount}" ${attr}>
    ${l.type === "mix" ? "g" : unit(l.v)}${l.adjusted ? `<br><button class="link-btn reset" ${attr.replace("data-plan", "data-reset").replace("data-mixamt", "data-mixreset")}>↺ Vorschlag ${l.type === "mix" || l.v === "mini" ? fmtKg(l.suggested) : l.suggested + " Stk"}</button>` : ""}`;
  $("byProduct").innerHTML = mixBar + catalog.shops.map((s) => {
    const list = lines.filter((l) => l.shop === s.id);
    if (!list.length) return "";
    const sum = sumPlan(list);
    const tr = list.map((l) => l.type === "mix"
      ? `<tr class="mix"><td></td>
          <td><b>${esc(l.category)} – Minis gemischt</b><br><span class="cat-note">Wünsche: ${l.rows.map((r) => `${r.qty}× ${esc(r.p.name)}`).join(", ")}</span></td>
          <td class="num"><b>${l.qty}</b> Stk<br><span class="cat-note">≈ ${fmtKg(l.rows.reduce((a, r) => a + lineWeight(r.p, r.qty, "mini"), 0))}</span></td>
          <td class="num plan">${amountHtml(l, `data-mixamt="${esc(l.category)}"`)}</td>
          <td class="num">${costHtml(l.cost)}</td></tr>`
      : `<tr><td>${l.p.image ? `<img src="${esc(l.p.image)}" alt="">` : ""}</td>
          <td><b>${esc(withVariant(l.p, l.v))}</b><br><span class="cat-note">${l.p.code ? esc(l.p.code) + " · " : ""}${esc(priceLabel(l.p, l.v))}</span><br>
          <span class="cat-note">${people(l)}</span></td>
          <td class="num"><b>${l.qty}</b> Stk${l.v === "mini" ? `<br><span class="cat-note">≈ ${fmtKg(lineWeight(l.p, l.qty, "mini"))}</span>` : ""}</td>
          <td class="num plan">${amountHtml(l, `data-plan="${l.p.id}|${l.v}"`)}</td>
          <td class="num">${costHtml(l.cost)}</td></tr>`).join("");
    return `<h3 class="serif">${esc(s.name)}</h3><table class="plan-table">
      <thead><tr><th></th><th>Produkt</th><th class="num">Wünsche</th><th class="num">Bestellen</th><th class="num">Kosten</th></tr></thead>
      <tbody>${tr}<tr class="sub"><td></td><td>Summe ${esc(s.name)}</td><td></td><td class="num">${sum.grams ? fmtKg(sum.grams) + " Minis" : ""}</td><td class="num">${sumHtml(sum)}</td></tr></tbody></table>`;
  }).join("") + notesHtml(o) + `<p class="cat-note no-print" style="margin-top:10px">Wünsche = was die Gäste gewählt haben. Unter „Bestellen“ legst du fest, was du beim Laden bestellst – das steht in der Bestellliste.</p>`;
}

// Anmerkungen der Gäste: Admin entscheidet, was an den Laden geht
const nameOf = (pid) => data.participants.find((x) => x.id === pid)?.name || "?";
const notesOf = (orderId) => (data.notes || []).filter((n) => n.order_id === orderId);
function notesHtml(o) {
  const notes = notesOf(o.id);
  if (!notes.length) return "";
  return `<div class="notes-box"><h3 class="serif">Anmerkungen der Gäste</h3>
    ${notes.map((n) => `<label class="note-line"><input type="checkbox" class="no-print" data-fwd="${n.participant_id}" ${n.forward ? "checked" : ""}>
      <span><b>${esc(nameOf(n.participant_id))}:</b> ${esc(n.note)}
      <span class="cat-note">${n.forward ? "→ steht in der Bestellliste" : "nur für dich"}</span></span></label>`).join("")}
    <p class="cat-note no-print" style="margin:6px 0 0">Haken = an den Laden weitergeben (erscheint als „Hinweise“ in der Bestellliste).</p></div>`;
}

// Bestellmengen ändern (Eingabe bestätigt mit Enter oder beim Verlassen des Felds)
$("byProduct").onchange = async (e) => {
  const o = order(); if (!o) return;
  const t = e.target, val = Math.max(0, Math.round(+t.value || 0));
  if (t.dataset.fwd) {
    await api.setNoteForward(t.dataset.fwd, o.id, t.checked);
    await refresh();
  } else if (t.dataset.plan) {
    const [pid, v] = t.dataset.plan.split("|");
    const l = planOf(o).find((x) => x.type === "item" && x.p.id === pid && x.v === v);
    await api.setPlan(o.id, pid, v, val === l?.suggested ? null : val);
    await refresh();
  } else if (t.dataset.mixamt != null) {
    const g = planOf(o).find((x) => x.type === "mix" && x.category === t.dataset.mixamt);
    await saveMix(o, { ...o.mini_mix, [t.dataset.mixamt]: val === g?.suggested ? 0 : val });
  }
};
$("byProduct").onclick = async (e) => {
  const o = order(); if (!o) return;
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.mix != null) {
    const mix = { ...o.mini_mix };
    mix[b.dataset.mix] != null ? delete mix[b.dataset.mix] : (mix[b.dataset.mix] = 0);
    await saveMix(o, mix);
  } else if (b.dataset.reset) {
    const [pid, v] = b.dataset.reset.split("|");
    await api.setPlan(o.id, pid, v, null); await refresh();
  } else if (b.dataset.mixreset != null) {
    await saveMix(o, { ...o.mini_mix, [b.dataset.mixreset]: 0 });
  }
};
async function saveMix(o, mix) { await api.updateOrder(o.id, { mini_mix: mix }); o.mini_mix = mix; render(); }

// „Gesamt“: nur die Wünsche über alle Bestellungen (Bestellmengen werden pro Bestellung festgelegt)
function renderWishes() {
  const rows = totals(itemsOf(ALL));
  if (!rows.length) { $("byProduct").innerHTML = `<div class="empty">Noch keine Auswahl abgeschickt.</div>`; return; }
  $("byProduct").innerHTML = catalog.shops.map((s) => {
    const list = rows.filter((r) => r.p.shop === s.id);
    if (!list.length) return "";
    return `<h3 class="serif">${esc(s.name)}</h3><table>
      <thead><tr><th></th><th>Produkt</th><th class="num">Wünsche</th></tr></thead>
      <tbody>${list.map((r) => `<tr><td>${r.p.image ? `<img src="${esc(r.p.image)}" alt="">` : ""}</td>
        <td><b>${esc(withVariant(r.p, r.v))}</b><br><span class="cat-note">${people(r)}</span></td>
        <td class="num"><b>${r.qty}</b> Stk${r.v === "mini" ? `<br><span class="cat-note">≈ ${fmtKg(lineWeight(r.p, r.qty, "mini"))}</span>` : ""}</td></tr>`).join("")}</tbody></table>`;
  }).join("") + `<p class="cat-note" style="margin-top:10px">Bestellmengen (Gramm, gemischt, Reserve) legst du pro Bestellung im jeweiligen Reiter fest.</p>`;
}

function renderByPerson(items) {
  if (!data.participants.length) { $("byPerson").innerHTML = `<div class="empty">Noch niemand hat sich eingetragen.</div>`; return; }
  const tag = (x) => sel === ALL ? order(x.order_id)?.title : multiShop() ? catalog.shops.find((s) => s.id === x.p.shop)?.name : "";
  $("byPerson").innerHTML = data.participants.map((pp) => {
    const its = items.filter((i) => i.participant_id === pp.id).map((i) => ({ ...i, p: prod(i.product_id) })).filter((x) => x.p)
      .sort((a, b) => project.orders.findIndex((o) => o.id === a.order_id) - project.orders.findIndex((o) => o.id === b.order_id) || a.p.sort - b.p.sort);
    const c = its.filter((x) => x.variant === "stk").map((x) => stkCost(x.p, x.qty)).filter(Boolean).reduce(add, [0, 0]);
    const minis = its.filter((x) => x.variant === "mini").reduce((a, x) => a + x.qty, 0);
    const costTxt = [c[1] ? fmtRange(c) : "", minis ? `<span class="cat-note">${minis} Minis</span>` : ""].filter(Boolean).join(" + ");
    const when = lastSubmit(pp.id);
    return `<div class="person"><div class="person-head"><span><b>${esc(pp.name)}</b>
      <span class="cat-note">${when ? `abgeschickt ${fmtWhen(when)}` : "noch nicht abgeschickt"}</span></span>
      <span>${its.length ? costTxt || '<span class="cat-note">Preis folgt</span>' : '<span class="cat-note">nichts gewählt</span>'}
      <button class="x no-print" data-del="${pp.id}">entfernen</button></span></div>
      ${its.length ? `<ul>${its.map((x) => `<li>${x.qty}× ${esc(withVariant(x.p, x.variant))}${tag(x) ? ` <span class="cat-note">(${esc(tag(x))})</span>` : ""}</li>`).join("")}</ul>` : ""}
      ${(data.notes || []).filter((n) => n.participant_id === pp.id && (sel === ALL || n.order_id === sel))
        .map((n) => `<p class="note-ro">📝 ${esc(n.note)}${sel === ALL ? ` <span class="cat-note">(${esc(order(n.order_id)?.title || "")})</span>` : ""}</p>`).join("")}</div>`;
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
    if (c.type === "note") return `<li class="note-chg">📝 ${c.note ? `Anmerkung: „${esc(c.note)}“` : "Anmerkung gelöscht"}${sel === ALL && project.orders.length > 1 ? ` <span class="cat-note">(${esc(order(c.order_id)?.title || "")})</span>` : ""}</li>`;
    const p = prod(c.product_id);
    const name = esc(p ? withVariant(p, c.variant || variantsOf(p)[0]) : c.product_id);
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

const fwdNotes = (o) => {
  const n = notesOf(o.id).filter((x) => x.forward);
  return n.length ? ["Hinweise:", ...n.map((x) => `– ${nameOf(x.participant_id)}: ${x.note}`)] : [];
};
// Text zum Durchgeben/Schicken an den Laden – je Bestellung ein Block, mit den Bestellmengen
function orderText(o) {
  const lines = planOf(o).filter((l) => l.amount > 0);
  if (!lines.length) return "";
  const head = [`Bestellung: ${o.title}`, o.pickup_at ? `Abholung: ${fmtPickup(o.pickup_at)}` : ""].filter(Boolean);
  return head.concat("", catalog.shops.flatMap((s) => {
    const list = lines.filter((l) => l.shop === s.id);
    if (!list.length) return [];
    const grams = sumPlan(list).grams;
    return [`== ${s.name} ==`, ...list.flatMap((l) => l.type === "mix"
      ? [`${fmtKg(l.amount)} ${l.category} – Minis gemischt`, `   (gern u. a.: ${l.rows.map((r) => r.p.name).join(", ")})`]
      : [`${l.v === "mini" ? fmtKg(l.amount) : l.amount + "×"} ${withVariant(l.p, l.v)}${l.p.code ? ` [${l.p.code}]` : ""}`]),
      grams ? `(Minis gesamt ca. ${fmtKg(grams)})` : "", ""];
  })).concat(fwdNotes(o)).join("\n").trim();
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
      <div class="ph">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : `<div class="soon">Bild folgt</div>`}${p.veggie ? `<span class="veg-badge">🌱 Vegetarisch</span>` : ""}
        ${p.code ? `<span class="code">${esc(p.code)}</span>` : ""}
        ${!p.active ? `<span class="flag">Ausgeblendet</span>` : p.coming_soon ? `<span class="flag soon-flag">Bald dabei</span>` : ""}</div>
      <div class="body"><div class="name">${esc(p.name)}</div>
        ${variantsOf(p).map((v) => `<div class="price">${variantsOf(p).length > 1 ? `<b>${VARIANTS[v]}</b> ` : ""}${esc(priceLabel(p, v))}</div>`).join("")}
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
  const d = p || { shop: defaults.shop, kind: defaults.kind, has_mini: true, has_piece: true, mini_weight_g: 30, active: true, coming_soon: false };
  $("pmTitle").textContent = p ? "Produkt bearbeiten" : "Neues Produkt";
  $("pmShop").innerHTML = catalog.shops.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("pmCats").innerHTML = [...new Set(catalog.products.map((x) => x.category))].map((c) => `<option value="${esc(c)}">`).join("");
  $("pmName").value = d.name || "";
  $("pmShop").value = d.shop;
  $("pmKind").value = d.kind || "suess";
  $("pmCat").value = d.category || "";
  $("pmVeggie").checked = !!d.veggie;
  $("pmMini").checked = !!d.has_mini;
  $("pmKg").value = d.mini_price_kg ?? "";
  $("pmWeight").value = d.mini_weight_g ?? 30;
  $("pmPiece").checked = !!d.has_piece;
  $("pmPmin").value = d.piece_price_min ?? "";
  $("pmPmax").value = d.piece_price_max ?? "";
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
// Größen + Preise aus dem Formular (leeres Preisfeld = „Preis folgt“)
const numOrNull = (id) => ($(id).value === "" ? null : +$(id).value);
function pmPrices() {
  const has_mini = $("pmMini").checked, has_piece = $("pmPiece").checked;
  const pmin = has_piece ? numOrNull("pmPmin") : null;
  return {
    has_mini, has_piece,
    mini_price_kg: has_mini ? numOrNull("pmKg") : null, mini_weight_g: has_mini ? Math.round(+$("pmWeight").value) || null : null,
    piece_price_min: pmin, piece_price_max: pmin == null ? null : numOrNull("pmPmax") ?? pmin,
  };
}
function pmUpdate() {
  for (const [box, fields] of [["pmMini", "pmMiniFields"], ["pmPiece", "pmPieceFields"]]) $(fields).classList.toggle("hidden", !$(box).checked);
  $("pmWeight").required = $("pmMini").checked;
  const p = pmPrices();
  const vs = variantsOf(p);
  $("pmHint").textContent = vs.length
    ? "Gäste sehen: " + vs.map((v) => `${vs.length > 1 ? VARIANTS[v] + " " : ""}${priceText(p, v)}`).join(" · ")
    : "Mindestens eine Größe auswählen.";
}
["pmMini", "pmPiece"].forEach((id) => { $(id).onchange = pmUpdate; });
["pmKg", "pmWeight", "pmPmin", "pmPmax"].forEach((id) => { $(id).oninput = pmUpdate; });
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
    const prices = pmPrices();
    if (!variantsOf(prices).length) throw new Error("Mindestens eine Größe (Mini oder Normal) auswählen.");
    if (prices.piece_price_max != null && prices.piece_price_max < prices.piece_price_min) throw new Error("„bis“ ist kleiner als „von“.");
    let id = pEdit?.id;
    if (!id) { id = slug($("pmName").value); while (prod(id)) id += "-2"; }
    const image = pFile ? await api.uploadImage(await shrink(pFile)) : pEdit?.image ?? null;
    const status = $("pmStatus").value;
    await api.saveProduct({
      id, shop: $("pmShop").value, kind: $("pmKind").value, category: $("pmCat").value.trim(),
      name: $("pmName").value.trim(), code: $("pmCode").value.trim() || null, image, ...prices,
      sort: pEdit?.sort ?? Math.max(0, ...catalog.products.map((x) => x.sort)) + 1,
      active: status !== "hidden", coming_soon: status === "soon", veggie: $("pmVeggie").checked,
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
