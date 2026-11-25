import { api, DEMO, loadCatalog, esc, lineCost, lineWeight, fmtRange, fmtKg, priceLabel } from "./api.js";

const $ = (id) => document.getElementById(id);
let catalog, events = [], current, data = { participants: [], items: [] }, unsub, view = "product";

if (DEMO) $("demo").classList.remove("hidden");
start();

async function start() {
  catalog = await loadCatalog();
  const s = await api.session();
  if (!s) return showLogin();
  $("who").innerHTML = `${esc(s.user?.email || "")}${DEMO ? "" : '<button id="logout">Abmelden</button>'}`;
  $("who").classList.remove("hidden");
  $("logout")?.addEventListener("click", async () => { await api.signOut(); location.reload(); });
  $("dash").classList.remove("hidden");
  await loadEvents();
}

function showLogin() {
  $("login").classList.remove("hidden");
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try { await api.signIn($("email").value, $("pw").value); location.reload(); }
    catch (err) { $("loginError").textContent = "Login fehlgeschlagen: " + err.message; }
  };
}

async function loadEvents(selectId) {
  events = await api.listEvents();
  if (!events.length) { $("noEvent").classList.remove("hidden"); $("eventView").classList.add("hidden"); $("eventSel").innerHTML = ""; return; }
  $("noEvent").classList.add("hidden");
  const keep = selectId || current?.id || localStorage.getItem("paradiso-admin-event");
  $("eventSel").innerHTML = events.map((e) => `<option value="${e.id}">${esc(e.title)}${e.closed ? " (geschlossen)" : ""}</option>`).join("");
  $("eventSel").value = events.some((e) => e.id === keep) ? keep : events[0].id;
  await openEvent($("eventSel").value);
}

$("eventSel").onchange = (e) => openEvent(e.target.value);
$("newEvent").onclick = async () => {
  const title = prompt("Name der Bestellung:", "Weihnachten 2026");
  if (!title?.trim()) return;
  const e = await api.createEvent(title.trim());
  await loadEvents(e.id);
};

async function openEvent(id) {
  current = events.find((e) => e.id === id);
  localStorage.setItem("paradiso-admin-event", id);
  $("title").textContent = current.title;
  $("eventView").classList.remove("hidden");
  const link = new URL("index.html?e=" + current.invite_code, location.href).href;
  $("inviteLink").textContent = link;
  $("waLink").href = "https://wa.me/?text=" + encodeURIComponent(`${current.title}: Such dir hier aus, was du gern hättest 🥐🍕\n${link}`);
  $("closedTag").innerHTML = current.closed ? '<span class="closed-tag">geschlossen</span>' : "";
  $("toggleClosed").textContent = current.closed ? "Wieder öffnen" : "Bestellung schließen";
  $("toggleClosed").className = "btn small " + (current.closed ? "" : "danger");
  unsub?.();
  await refresh();
  let t;
  unsub = await api.subscribe(id, () => { clearTimeout(t); t = setTimeout(refresh, 300); });
}

$("copyLink").onclick = () => copy($("inviteLink").textContent, "Link kopiert");
$("print").onclick = () => print();
$("toggleClosed").onclick = async () => {
  const closing = !current.closed;
  if (closing && !confirm("Bestellung schließen? Gäste können danach nichts mehr ändern.")) return;
  await api.setClosed(current.id, closing);
  await loadEvents(current.id);
};
$("viewTabs").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  view = b.dataset.v;
  [...$("viewTabs").children].forEach((x) => x.classList.toggle("on", x === b));
  $("byProduct").classList.toggle("hidden", view !== "product");
  $("byPerson").classList.toggle("hidden", view !== "person");
};

async function refresh() {
  data = await api.eventData(current.id);
  render();
}

const prod = (id) => catalog.products.find((p) => p.id === id);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];

// Summen je Produkt
function totals() {
  const m = new Map();
  for (const i of data.items) {
    const p = prod(i.product_id); if (!p) continue;
    const t = m.get(p.id) || { p, qty: 0, people: [] };
    t.qty += i.qty;
    t.people.push({ name: data.participants.find((x) => x.id === i.participant_id)?.name, qty: i.qty });
    m.set(p.id, t);
  }
  return [...m.values()].sort((a, b) => a.p.sort - b.p.sort);
}

function render() {
  const rows = totals();
  let cost = [0, 0], weight = 0, pieces = 0;
  rows.forEach((r) => { cost = add(cost, lineCost(r.p, r.qty)); weight += lineWeight(r.p, r.qty); pieces += r.qty; });
  const active = new Set(data.items.map((i) => i.participant_id)).size;
  $("stats").innerHTML = `
    <div class="stat main"><div class="k">Geschätzte Kosten</div><div class="v">${fmtRange(cost)}</div></div>
    <div class="stat"><div class="k">Gäste</div><div class="v">${data.participants.length}</div><div class="cat-note" style="margin:2px 0 0">${active} mit Auswahl</div></div>
    <div class="stat"><div class="k">Teile gesamt</div><div class="v">${pieces}</div></div>
    <div class="stat"><div class="k">Minis (Gewicht)</div><div class="v">${fmtKg(weight)}</div></div>`;
  renderByProduct(rows);
  renderByPerson();
}

function renderByProduct(rows) {
  if (!rows.length) { $("byProduct").innerHTML = `<div class="empty">Noch keine Bestellungen eingegangen.</div>`; return; }
  $("byProduct").innerHTML = catalog.shops.map((s) => {
    const list = rows.filter((r) => r.p.shop === s.id);
    if (!list.length) return "";
    let sub = [0, 0], subW = 0;
    const tr = list.map((r) => {
      const c = lineCost(r.p, r.qty), w = lineWeight(r.p, r.qty); sub = add(sub, c); subW += w;
      return `<tr><td>${r.p.image ? `<img src="${esc(r.p.image)}" alt="">` : ""}</td>
        <td><b>${esc(r.p.name)}</b><br><span class="cat-note">${esc(r.p.code || "")} · ${esc(priceLabel(r.p))}</span><br>
        <span class="cat-note">${r.people.map((x) => `${esc(x.name)} ${x.qty}`).join(", ")}</span></td>
        <td class="num"><b>${r.qty}</b> Stk${w ? `<br><span class="cat-note">≈ ${fmtKg(w)}</span>` : ""}</td>
        <td class="num">${fmtRange(c)}</td></tr>`;
    }).join("");
    return `<h3 class="serif">${esc(s.name)}</h3><table>
      <thead><tr><th></th><th>Produkt</th><th class="num">Menge</th><th class="num">Kosten</th></tr></thead>
      <tbody>${tr}<tr class="sub"><td></td><td>Summe ${esc(s.name)}</td><td class="num">${subW ? "≈ " + fmtKg(subW) : ""}</td><td class="num">${fmtRange(sub)}</td></tr></tbody></table>`;
  }).join("");
}

function renderByPerson() {
  if (!data.participants.length) { $("byPerson").innerHTML = `<div class="empty">Noch niemand hat sich eingetragen.</div>`; return; }
  $("byPerson").innerHTML = data.participants.map((pp) => {
    const its = data.items.filter((i) => i.participant_id === pp.id).map((i) => ({ p: prod(i.product_id), qty: i.qty })).filter((x) => x.p)
      .sort((a, b) => a.p.sort - b.p.sort);
    const c = its.reduce((s, x) => add(s, lineCost(x.p, x.qty)), [0, 0]);
    return `<div class="person"><div class="person-head"><b>${esc(pp.name)}</b>
      <span>${its.length ? fmtRange(c) : '<span class="cat-note">noch nichts gewählt</span>'}
      <button class="x no-print" data-del="${pp.id}">entfernen</button></span></div>
      ${its.length ? `<ul>${its.map((x) => `<li>${x.qty}× ${esc(x.p.name)} <span class="cat-note">(${esc(catalog.shops.find((s) => s.id === x.p.shop)?.name)})</span></li>`).join("")}</ul>` : ""}</div>`;
  }).join("");
  $("byPerson").onclick = async (e) => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const name = data.participants.find((p) => p.id === b.dataset.del)?.name;
    if (!confirm(`${name} samt Auswahl entfernen?`)) return;
    await api.deleteParticipant(b.dataset.del); await refresh();
  };
}

// Text zum Durchgeben/Schicken an den Laden
$("copyList").onclick = () => {
  const rows = totals();
  if (!rows.length) return alert("Noch nichts bestellt.");
  const txt = [`Bestellung: ${current.title}`, ""].concat(catalog.shops.flatMap((s) => {
    const list = rows.filter((r) => r.p.shop === s.id);
    if (!list.length) return [];
    const w = list.reduce((a, r) => a + lineWeight(r.p, r.qty), 0);
    return [`== ${s.name} ==`, ...list.map((r) => `${r.qty}× ${r.p.name}${r.p.code ? ` [${r.p.code}]` : ""}`),
      w ? `(Minis gesamt ca. ${fmtKg(w)})` : "", ""];
  })).join("\n").trim();
  copy(txt, "Bestellliste kopiert");
};

async function copy(text, msg) {
  try { await navigator.clipboard.writeText(text); alert(msg); }
  catch { prompt("Zum Kopieren markieren:", text); }
}
