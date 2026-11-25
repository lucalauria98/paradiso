// Datenschicht: Supabase (live) oder localStorage (Demo). Beide haben dieselbe Schnittstelle.
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
// Kosten einer Position → [min, max] in €
export function lineCost(p, qty) {
  if (p.unit === "kg") {
    const kg = (qty * (p.est_weight_g || 0)) / 1000;
    return [kg * p.price_min, kg * p.price_max];
  }
  return [qty * p.price_min, qty * p.price_max];
}
export const lineWeight = (p, qty) => (p.unit === "kg" ? qty * (p.est_weight_g || 0) : 0);
export function priceLabel(p) {
  return p.unit === "kg"
    ? `${fmtEur(p.price_min)}/kg · ca. ${p.est_weight_g} g/Stück`
    : p.price_min === p.price_max ? `${fmtEur(p.price_min)}/Stück` : `ca. ${p.price_min}–${p.price_max} €/Stück`;
}

// ───────── Katalog ─────────
let catalogCache;
export async function loadCatalog() {
  if (catalogCache) return catalogCache;
  if (!DEMO) {
    const sb = await client();
    const [s, p] = await Promise.all([
      sb.from("shops").select("*").order("sort"),
      sb.from("products").select("*").eq("active", true).order("sort"),
    ]);
    if (!s.error && !p.error && p.data.length) {
      catalogCache = {
        shops: s.data,
        products: p.data.map((x) => ({ ...x, shop: x.shop_id, price_min: +x.price_min, price_max: +x.price_max })),
      };
      return catalogCache;
    }
  }
  catalogCache = await (await fetch("catalog.json")).json();
  return catalogCache;
}

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

const live = {
  async guestEvent(code) { return must(await (await client()).rpc("guest_event", { p_code: code }))[0] || null; },
  async guestJoin(code, name) {
    const r = must(await (await client()).rpc("guest_join", { p_code: code, p_name: name }))[0];
    return { id: r.participant_id, secret: r.secret };
  },
  async guestItems(id, secret) { return must(await (await client()).rpc("guest_items", { p_id: id, p_secret: secret })); },
  async guestSetItem(id, secret, product, qty) {
    must(await (await client()).rpc("guest_set_item", { p_id: id, p_secret: secret, p_product: product, p_qty: qty }));
  },
  async session() { return (await (await client()).auth.getSession()).data.session; },
  async signIn(email, password) { must(await (await client()).auth.signInWithPassword({ email, password })); },
  async signOut() { await (await client()).auth.signOut(); },
  async listEvents() { return must(await (await client()).from("events").select("*").order("created_at", { ascending: false })); },
  async createEvent(title) { return must(await (await client()).from("events").insert({ title }).select().single()); },
  async setClosed(id, closed) { must(await (await client()).from("events").update({ closed }).eq("id", id)); },
  async eventData(eventId) {
    const sb = await client();
    const participants = must(await sb.from("participants").select("id,name,created_at").eq("event_id", eventId).order("created_at"));
    const ids = participants.map((p) => p.id);
    const items = ids.length ? must(await sb.from("order_items").select("participant_id,product_id,qty").in("participant_id", ids)) : [];
    return { participants, items };
  },
  async deleteParticipant(id) { must(await (await client()).from("participants").delete().eq("id", id)); },
  async subscribe(eventId, cb) {
    const sb = await client();
    const ch = sb.channel("event-" + eventId)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, cb)
      .on("postgres_changes", { event: "*", schema: "public", table: "participants", filter: `event_id=eq.${eventId}` }, cb)
      .subscribe();
    return () => sb.removeChannel(ch);
  },
};

// ───────── Demo (localStorage) ─────────
const KEY = "paradiso-demo-db";
const read = () => JSON.parse(localStorage.getItem(KEY) || '{"events":[],"participants":[],"items":[]}');
const write = (db) => localStorage.setItem(KEY, JSON.stringify(db));
const uid = () => crypto.randomUUID();
function seedDemo() {
  const db = read();
  if (!db.events.length) {
    db.events.push({ id: uid(), title: "Weihnachten 2026", invite_code: "demo", closed: false, created_at: new Date().toISOString() });
    write(db);
  }
}
const demo = {
  async guestEvent(code) { seedDemo(); const e = read().events.find((e) => e.invite_code === code); return e ? { title: e.title, closed: e.closed } : null; },
  async guestJoin(code, name) {
    const db = read(); const e = db.events.find((e) => e.invite_code === code);
    if (!e) throw new Error("Unbekannter Einladungslink");
    if (e.closed) throw new Error("Die Bestellung ist bereits geschlossen");
    const p = { id: uid(), secret: uid(), event_id: e.id, name: name.trim(), created_at: new Date().toISOString() };
    db.participants.push(p); write(db); return { id: p.id, secret: p.secret };
  },
  async guestItems(id, secret) {
    const db = read(); if (!db.participants.some((p) => p.id === id && p.secret === secret)) throw new Error("Nicht berechtigt");
    return db.items.filter((i) => i.participant_id === id).map(({ product_id, qty }) => ({ product_id, qty }));
  },
  async guestSetItem(id, secret, product, qty) {
    const db = read(); const p = db.participants.find((p) => p.id === id && p.secret === secret);
    if (!p) throw new Error("Nicht berechtigt");
    if (db.events.find((e) => e.id === p.event_id)?.closed) throw new Error("Die Bestellung ist bereits geschlossen");
    db.items = db.items.filter((i) => !(i.participant_id === id && i.product_id === product));
    if (qty > 0) db.items.push({ participant_id: id, product_id: product, qty });
    write(db);
  },
  async session() { return { demo: true, user: { email: "Demo-Admin" } }; },
  async signIn() {}, async signOut() {},
  async listEvents() { seedDemo(); return read().events.slice().reverse(); },
  async createEvent(title) {
    const db = read(); const e = { id: uid(), title, invite_code: Math.random().toString(16).slice(2, 14), closed: false, created_at: new Date().toISOString() };
    db.events.push(e); write(db); return e;
  },
  async setClosed(id, closed) { const db = read(); db.events.find((e) => e.id === id).closed = closed; write(db); },
  async eventData(eventId) {
    const db = read(); const participants = db.participants.filter((p) => p.event_id === eventId).map(({ id, name, created_at }) => ({ id, name, created_at }));
    const ids = new Set(participants.map((p) => p.id));
    return { participants, items: db.items.filter((i) => ids.has(i.participant_id)) };
  },
  async deleteParticipant(id) {
    const db = read(); db.participants = db.participants.filter((p) => p.id !== id); db.items = db.items.filter((i) => i.participant_id !== id); write(db);
  },
  async subscribe(_eventId, cb) {
    const onStorage = (e) => e.key === KEY && cb();
    addEventListener("storage", onStorage);
    const t = setInterval(cb, 3000);
    return () => { removeEventListener("storage", onStorage); clearInterval(t); };
  },
};

export const api = DEMO ? demo : live;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
