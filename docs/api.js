// Datenschicht: Supabase (live) oder localStorage (Demo). Beide haben dieselbe Schnittstelle.
// Aufbau: Projekt (ein Einladungslink) → mehrere Bestellungen (mit Abholtermin) → Auswahl je Gast.
// Gäste wählen als Entwurf und schicken ab; jedes Abschicken mit Änderungen landet im Verlauf.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

// ───────── Preise & Formatierung ─────────
const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
export const fmtEur = (n) => eur.format(n);
export function fmtRange([a, b]) {
  return Math.abs(a - b) < 0.005 ? `ca. ${fmtEur(a)}` : `${fmtEur(a)} – ${fmtEur(b)}`;
}
export function fmtKg(g) {
  return g >= 1000 ? `${(g / 1000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} kg` : `${Math.round(g)} g`;
}
const dt = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtPickup = (iso) => (iso ? dt.format(new Date(iso)) + " Uhr" : "");
const dtShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtWhen = (iso) => (iso ? dtShort.format(new Date(iso)) : "");
// Kosten einer Position → [min, max] in €
export function lineCost(p, qty) {
  if (p.unit === "kg") {
    const kg = (qty * (p.est_weight_g || 0)) / 1000;
    return [kg * p.price_min, kg * p.price_max];
  }
  return [qty * p.price_min, qty * p.price_max];
}
export const pieceCost = (p) => lineCost(p, 1);
export const lineWeight = (p, qty) => (p.unit === "kg" ? qty * (p.est_weight_g || 0) : 0);
export function priceLabel(p) {
  return p.unit === "kg"
    ? `${fmtEur(p.price_min)}/kg · ca. ${p.est_weight_g} g/Stück`
    : p.price_min === p.price_max ? `${fmtEur(p.price_min)}/Stück` : `ca. ${p.price_min}–${p.price_max} €/Stück`;
}
// Bestellungen nach Abholtermin (ohne Termin ans Ende), dann nach Anlage
const byPickup = (a, b) => (a.pickup_at || "~").localeCompare(b.pickup_at || "~") || a.created_at.localeCompare(b.created_at);

// ───────── Katalog ─────────
// Gäste: nur aktive Produkte. Admin ({ all: true }): auch ausgeblendete, zum Bearbeiten.
const catalogCache = {};
const normProduct = (x) => ({ active: true, coming_soon: false, kind: "suess", ...x, shop: x.shop_id ?? x.shop,
  price_min: +x.price_min, price_max: +x.price_max, est_weight_g: x.est_weight_g == null ? null : +x.est_weight_g });
export async function loadCatalog({ all = false } = {}) {
  const k = all ? "all" : "active";
  if (catalogCache[k]) return catalogCache[k];
  let shops, products;
  if (!DEMO) {
    const sb = await client();
    let q = sb.from("products").select("*").order("sort");
    if (!all) q = q.eq("active", true);
    const [s, p] = await Promise.all([sb.from("shops").select("*").order("sort"), q]);
    if (!s.error && !p.error && p.data.length) { shops = s.data; products = p.data; }
  }
  if (!products) {
    const base = await (await fetch("catalog.json")).json();
    shops = base.shops;
    products = DEMO ? demoProducts(base.products) : base.products;
  }
  products = products.map(normProduct).filter((p) => all || p.active).sort((a, b) => a.sort - b.sort);
  return (catalogCache[k] = { shops, products });
}
const resetCatalog = () => { delete catalogCache.all; delete catalogCache.active; };

// ───────── Supabase ─────────
let sbPromise;
function client() {
  sbPromise ??= import("https://esm.sh/@supabase/supabase-js@2").then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  );
  return sbPromise;
}
const must = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};
const rpc = async (fn, args) => must(await (await client()).rpc(fn, args));
const table = async (t) => (await client()).from(t);
const PRODUCT_COLS = ["id", "shop_id", "code", "category", "kind", "name", "image", "unit", "price_min", "price_max", "est_weight_g", "sort", "coming_soon", "active"];

const live = {
  // Gäste (ohne Login, nur über die guest_*-Funktionen)
  async guestProject(code) { return rpc("guest_project", { p_code: code }); },
  async guestJoin(code, name) {
    const r = (await rpc("guest_join", { p_code: code, p_name: name }))[0];
    return { id: r.participant_id, secret: r.secret };
  },
  async guestItems(id, secret) { return rpc("guest_items", { p_id: id, p_secret: secret }); },
  async guestSubmit(id, secret, items) { return rpc("guest_submit", { p_id: id, p_secret: secret, p_items: items }); },
  // Admin
  async session() { return (await (await client()).auth.getSession()).data.session; },
  async signIn(email, password) { must(await (await client()).auth.signInWithPassword({ email, password })); },
  async signOut() { await (await client()).auth.signOut(); },
  async listProjects() {
    const rows = must(await (await table("projects")).select("*, orders(*)").order("created_at", { ascending: false }));
    rows.forEach((p) => p.orders.sort(byPickup));
    return rows;
  },
  async createProject(title) { return must(await (await table("projects")).insert({ title }).select().single()); },
  async updateProject(id, patch) { must(await (await table("projects")).update(patch).eq("id", id)); },
  async createOrder(projectId, title, pickup_at) {
    return must(await (await table("orders")).insert({ project_id: projectId, title, pickup_at }).select().single());
  },
  async updateOrder(id, patch) { must(await (await table("orders")).update(patch).eq("id", id)); },
  async deleteOrder(id) { must(await (await table("orders")).delete().eq("id", id)); },
  async projectData(projectId) {
    const sb = await client();
    const [participants, submissions] = await Promise.all([
      sb.from("participants").select("id,name,created_at").eq("project_id", projectId).order("created_at").then(must),
      sb.from("submissions").select("id,participant_id,name,changes,created_at").eq("project_id", projectId).order("created_at", { ascending: false }).then(must),
    ]);
    const ids = participants.map((p) => p.id);
    const items = ids.length
      ? must(await sb.from("order_items").select("participant_id,order_id,product_id,qty,updated_at").in("participant_id", ids))
      : [];
    return { participants, items, submissions };
  },
  async deleteParticipant(id) { must(await (await table("participants")).delete().eq("id", id)); },
  async subscribe(projectId, cb) {
    const sb = await client();
    const ch = sb.channel("project-" + projectId)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `project_id=eq.${projectId}` }, cb)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "submissions", filter: `project_id=eq.${projectId}` }, cb)
      .subscribe();
    return () => sb.removeChannel(ch);
  },
  // Produkte (nur Admins, per RLS geprüft)
  async saveProduct(p) {
    const row = Object.fromEntries(PRODUCT_COLS.map((k) => [k, k === "shop_id" ? p.shop : p[k] ?? null]));
    must(await (await table("products")).upsert(row));
    resetCatalog();
  },
  async uploadImage(blob) {
    const sb = await client();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    must(await sb.storage.from("produktbilder").upload(path, blob, { contentType: blob.type || "image/jpeg" }));
    return sb.storage.from("produktbilder").getPublicUrl(path).data.publicUrl;
  },
};

// ───────── Demo (localStorage) ─────────
const KEY = "paradiso-demo-v3";
const PKEY = "paradiso-demo-products"; // im Admin geänderte/neue Produkte
const read = () => JSON.parse(localStorage.getItem(KEY) || '{"projects":[],"orders":[],"participants":[],"items":[],"submissions":[]}');
const write = (db) => localStorage.setItem(KEY, JSON.stringify(db));
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
function demoProducts(base) {
  const over = JSON.parse(localStorage.getItem(PKEY) || "{}");
  return base.map((p) => over[p.id] || p).concat(Object.values(over).filter((p) => !base.some((b) => b.id === p.id)));
}
function seedDemo() {
  const db = read();
  if (db.projects.length) return;
  const p = { id: uid(), title: "Weihnachten 2026", invite_code: "demo", note: "Abholung macht Luca, bezahlt wird nach der Abholung.", created_at: now() };
  db.projects.push(p);
  db.orders.push(
    { id: uid(), project_id: p.id, title: "Kaffee Heiligabend", pickup_at: new Date(2026, 11, 24, 10).toISOString(), closed: false, created_at: now() },
    { id: uid(), project_id: p.id, title: "Kaffee 1. Feiertag", pickup_at: new Date(2026, 11, 25, 14).toISOString(), closed: false, created_at: now() },
  );
  write(db);
}
const ordersOf = (db, projectId) => db.orders.filter((o) => o.project_id === projectId).sort(byPickup);
const guestOf = (db, id, secret) => {
  const p = db.participants.find((p) => p.id === id && p.secret === secret);
  if (!p) throw new Error("Nicht berechtigt");
  return p;
};
const lastSubmit = (db, id) => db.submissions.filter((s) => s.participant_id === id).map((s) => s.created_at).sort().pop() || null;
const demo = {
  async guestProject(code) {
    seedDemo();
    const db = read(); const p = db.projects.find((p) => p.invite_code === code);
    if (!p) return null;
    return {
      title: p.title, note: p.note || null,
      orders: ordersOf(db, p.id).map(({ id, title, pickup_at, closed }) => ({ id, title, pickup_at, closed })),
      members: db.participants.filter((x) => x.project_id === p.id).map((x) => ({ name: x.name, submitted: !!lastSubmit(db, x.id) })),
    };
  },
  async guestJoin(code, name) {
    const db = read(); const pr = db.projects.find((p) => p.invite_code === code);
    if (!pr) throw new Error("Unbekannter Einladungslink");
    if (!ordersOf(db, pr.id).some((o) => !o.closed)) throw new Error("Gerade ist keine Bestellung offen");
    const p = { id: uid(), secret: uid(), project_id: pr.id, name: name.trim(), created_at: now() };
    db.participants.push(p); write(db); return { id: p.id, secret: p.secret };
  },
  async guestItems(id, secret) {
    const db = read(); guestOf(db, id, secret);
    return {
      items: db.items.filter((i) => i.participant_id === id).map(({ order_id, product_id, qty }) => ({ order_id, product_id, qty })),
      submitted_at: lastSubmit(db, id),
    };
  },
  async guestSubmit(id, secret, wanted) {
    const db = read(); const p = guestOf(db, id, secret);
    const open = new Set(ordersOf(db, p.project_id).filter((o) => !o.closed).map((o) => o.id));
    const k = (i) => i.order_id + "|" + i.product_id;
    const want = new Map(wanted.filter((i) => i.qty > 0 && open.has(i.order_id)).map((i) => [k(i), { ...i, qty: Math.min(i.qty, 500) }]));
    const cur = new Map(db.items.filter((i) => i.participant_id === id && open.has(i.order_id)).map((i) => [k(i), i]));
    const { products } = await loadCatalog({ all: true });
    for (const [key, w] of want) {
      const pr = products.find((x) => x.id === w.product_id);
      if (!pr) throw new Error("Unbekanntes Produkt");
      if ((pr.active === false || pr.coming_soon) && !(cur.get(key)?.qty >= w.qty)) throw new Error("Nicht bestellbar: " + pr.name);
    }
    const changes = [...new Set([...want.keys(), ...cur.keys()])].sort()
      .map((key) => ({ order_id: key.split("|")[0], product_id: key.split("|")[1], old: cur.get(key)?.qty || 0, new: want.get(key)?.qty || 0 }))
      .filter((c) => c.old !== c.new);
    if (changes.length) {
      db.items = db.items.filter((i) => !(i.participant_id === id && open.has(i.order_id)))
        .concat([...want.values()].map((w) => ({ participant_id: id, order_id: w.order_id, product_id: w.product_id, qty: w.qty, updated_at: now() })));
      db.submissions.push({ id: db.submissions.length + 1, project_id: p.project_id, participant_id: id, name: p.name, changes, created_at: now() });
      write(db);
    }
    return { changes, submitted_at: lastSubmit(db, id) };
  },
  async session() { return { demo: true, user: { email: "Demo-Admin" } }; },
  async signIn() {}, async signOut() {},
  async listProjects() {
    seedDemo();
    const db = read();
    return db.projects.slice().reverse().map((p) => ({ ...p, orders: ordersOf(db, p.id) }));
  },
  async createProject(title) {
    const db = read(); const p = { id: uid(), title, note: null, invite_code: Math.random().toString(16).slice(2, 14), created_at: now() };
    db.projects.push(p); write(db); return p;
  },
  async updateProject(id, patch) { const db = read(); Object.assign(db.projects.find((p) => p.id === id), patch); write(db); },
  async createOrder(projectId, title, pickup_at) {
    const db = read(); const o = { id: uid(), project_id: projectId, title, pickup_at, closed: false, created_at: now() };
    db.orders.push(o); write(db); return o;
  },
  async updateOrder(id, patch) { const db = read(); Object.assign(db.orders.find((o) => o.id === id), patch); write(db); },
  async deleteOrder(id) {
    const db = read(); db.orders = db.orders.filter((o) => o.id !== id); db.items = db.items.filter((i) => i.order_id !== id); write(db);
  },
  async projectData(projectId) {
    const db = read();
    const participants = db.participants.filter((p) => p.project_id === projectId).map(({ id, name, created_at }) => ({ id, name, created_at }));
    const ids = new Set(participants.map((p) => p.id));
    return {
      participants,
      items: db.items.filter((i) => ids.has(i.participant_id)),
      submissions: db.submissions.filter((s) => s.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
  },
  async deleteParticipant(id) {
    const db = read();
    db.participants = db.participants.filter((p) => p.id !== id); db.items = db.items.filter((i) => i.participant_id !== id);
    db.submissions.forEach((s) => { if (s.participant_id === id) s.participant_id = null; });
    write(db);
  },
  async subscribe(_projectId, cb) {
    const onStorage = (e) => e.key === KEY && cb();
    addEventListener("storage", onStorage);
    const t = setInterval(cb, 3000);
    return () => { removeEventListener("storage", onStorage); clearInterval(t); };
  },
  async saveProduct(p) {
    const over = JSON.parse(localStorage.getItem(PKEY) || "{}");
    over[p.id] = { ...p };
    localStorage.setItem(PKEY, JSON.stringify(over));
    resetCatalog();
  },
  async uploadImage(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  },
};

export const api = DEMO ? demo : live;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
