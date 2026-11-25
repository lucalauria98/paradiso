// Start: cd tests && npm install && npm test
// Testet supabase/schema.sql + seed.sql in einem echten Postgres (PGlite) mit nachgebauter Supabase-Umgebung.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";

const repo = new URL("..", import.meta.url).pathname; // Repo-Wurzel
const db = new PGlite({ extensions: { pgcrypto } });
let ok = 0, fail = 0;
const check = (cond, msg) => { cond ? ok++ : fail++; console.log((cond ? "  ✓ " : "  ✗ ") + msg); };
const ADMIN = "aaaaaaaa-0000-0000-0000-000000000001", OTHER = "bbbbbbbb-0000-0000-0000-000000000002";

// ── Supabase nachbauen ──
await db.exec(`
  create extension if not exists pgcrypto;
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated; grant all on storage.objects to anon, authenticated;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  insert into auth.users values ('${ADMIN}', 'admin@test');
`);
await db.exec(fs.readFileSync(repo + "/supabase/schema.sql", "utf8"));
await db.exec(fs.readFileSync(repo + "/supabase/seed.sql", "utf8"));
await db.exec(fs.readFileSync(repo + "/supabase/schema.sql", "utf8")); // zweimal: muss gefahrlos wiederholbar sein
await db.exec(`insert into auth.users values ('${OTHER}', 'fremd@test');`); // eingeloggt, aber kein Admin

async function as(role, sub, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub || ""}', false); set role ${role};`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
}
const err = async (fn) => { try { await fn(); return ""; } catch (e) { return e.message; } };
const anon = (sql, p) => as("anon", null, sql, p);
const admin = (sql, p) => as("authenticated", ADMIN, sql, p);
const other = (sql, p) => as("authenticated", OTHER, sql, p);
const one = async (q) => (await q).rows[0];
const submit = async (id, secret, items, notes = []) =>
  (await one(anon("select guest_submit($1, $2, $3::jsonb, $4::jsonb) as r", [id, secret, JSON.stringify(items), JSON.stringify(notes)]))).r;
const mine = async (id, secret) => (await one(anon("select guest_items($1, $2) as r", [id, secret]))).r;
const join = async (code, name) => one(anon("select * from guest_join($1, $2)", [code, name]));
const it = (order_id, product_id, variant, qty) => ({ order_id, product_id, variant, qty });

console.log("Aufbau:");
check((await one(db.query("select count(*)::int n from products"))).n === 59, "59 Produkte nach Seed");
check((await one(db.query("select count(*)::int n from admins"))).n === 1, "Admin eingetragen (Schema zweimal ausgeführt ohne Fehler)");

console.log("Admin legt Projekt + Bestellungen an:");
const pr = await one(admin("insert into projects (title) values ('Weihnachten 2026') returning id, invite_code"));
check(/^[0-9a-f]{12}$/.test(pr.invite_code), "Einladungscode erzeugt: " + pr.invite_code);
const o1 = (await one(admin("insert into orders (project_id, title, pickup_at) values ($1, 'Kaffee Heiligabend', '2026-12-24 10:00+01') returning id", [pr.id]))).id;
const o2 = (await one(admin("insert into orders (project_id, title) values ($1, 'Kaffee 1. Feiertag') returning id", [pr.id]))).id;

console.log("Gast: beitreten, abschicken:");
let gp = (await one(anon("select guest_project($1) as r", [pr.invite_code]))).r;
check(gp.title === "Weihnachten 2026" && gp.orders.length === 2 && gp.orders[0].title === "Kaffee Heiligabend" && gp.members.length === 0, "guest_project: Titel, 2 Bestellungen (nach Termin), noch niemand dabei");
check(!("mini_mix" in gp.orders[0]) && !("final_amount" in gp.orders[0]), "Gäste sehen keine Admin-Felder (Gemischt, Endbetrag)");
const lena = await join(pr.invite_code, "  Lena ");
check(!!lena.participant_id && !!lena.secret, "Lena tritt bei");
let r = await submit(lena.participant_id, lena.secret,
  [it(o1, "arancini-fleisch", "stk", 5), it(o1, "calzone", "mini", 4), it(o2, "pizza-rossa", "mini", 10)],
  [{ order_id: o1, product_id: "arancini-fleisch", note: "mit Bio-Rindhack" }, { order_id: o1, product_id: "", note: "Bitte getrennt verpacken" }]);
check(r.changes.length === 5 && r.submitted_at, "1. Abschicken: 3 Positionen + 2 Notizen geloggt");
let m = await mine(lena.participant_id, lena.secret);
check(m.items.length === 3 && m.notes.length === 2 && m.notes.some((n) => n.product_id === "arancini-fleisch"), "guest_items liefert Auswahl + Notizen");
gp = (await one(anon("select guest_project($1) as r", [pr.invite_code]))).r;
check(gp.members.length === 1 && gp.members[0].name === "Lena" && gp.members[0].submitted, "Wer ist dabei: Lena ✓ (Name getrimmt)");
check(JSON.stringify(gp).indexOf("Bio-Rindhack") < 0 && JSON.stringify(gp).indexOf("arancini") < 0, "guest_project verrät keine Auswahl/Notizen");

console.log("Gast ändert seine Bestellung:");
r = await submit(lena.participant_id, lena.secret, m.items, m.notes.map((n) => ({ ...n })));
check(r.changes.length === 0, "Gleicher Stand nochmal → keine Änderung, kein Verlaufseintrag");
check((await one(db.query("select count(*)::int n from submissions"))).n === 1, "Verlauf weiterhin 1 Eintrag");
await admin("update order_notes set forward = true where product_id = 'arancini-fleisch'");
r = await submit(lena.participant_id, lena.secret,
  [it(o1, "arancini-fleisch", "stk", 3), it(o1, "arancini-fleisch", "mini", 6), it(o2, "pizza-rossa", "mini", 10)],
  [{ order_id: o1, product_id: "arancini-fleisch", note: "mit Bio-Rindhack" }, { order_id: o1, product_id: "calzone", note: "scharf" },
   { order_id: o1, product_id: "", note: "Bitte getrennt verpacken!" }]);
const ch = Object.fromEntries(r.changes.map((c) => [`${c.type || "item"}:${c.product_id}:${c.variant || ""}`, c]));
check(ch["item:arancini-fleisch:stk"]?.old === 5 && ch["item:arancini-fleisch:stk"]?.new === 3, "Arancini Normal 5 → 3");
check(ch["item:arancini-fleisch:mini"]?.old === 0 && ch["item:arancini-fleisch:mini"]?.new === 6, "Arancini Mini neu: 6 (zweite Größe desselben Produkts)");
check(ch["item:calzone:mini"]?.old === 4 && ch["item:calzone:mini"]?.new === 0, "Calzone entfernt");
check(!ch["note:calzone:"], "Notiz zu abgewähltem Calzone wird ignoriert");
check(ch["note::"]?.note === "Bitte getrennt verpacken!" && !ch["note:arancini-fleisch:"], "Nur geänderte Notiz geloggt");
const notes = (await admin("select product_id, note, forward from order_notes order by product_id")).rows;
check(notes.find((n) => n.product_id === "arancini-fleisch").forward === true, "Unveränderte Produkt-Notiz behält „weitergeben“");
check(notes.find((n) => n.product_id === "").forward === false && notes.length === 2, "Geänderte Anmerkung: Haken zurückgesetzt; keine Calzone-Notiz");
r = await submit(lena.participant_id, lena.secret, [it(o1, "arancini-fleisch", "mini", 6), it(o2, "pizza-rossa", "mini", 10)],
  [{ order_id: o1, product_id: "arancini-fleisch", note: "mit Bio-Rindhack" }, { order_id: o1, product_id: "", note: "Bitte getrennt verpacken!" }]);
check(r.changes.length === 1 && (await admin("select count(*)::int n from order_notes where product_id = 'arancini-fleisch'")).rows[0].n === 1,
  "Mini bleibt gewählt → Produkt-Notiz bleibt, obwohl Normal entfernt");
r = await submit(lena.participant_id, lena.secret, [it(o2, "pizza-rossa", "mini", 10)], [{ order_id: o1, product_id: "arancini-fleisch", note: "mit Bio-Rindhack" }]);
check((await admin("select count(*)::int n from order_notes where participant_id = $1", [lena.participant_id])).rows[0].n === 0,
  "Produkt ganz abgewählt + Anmerkung weggelassen → beide Notizen gelöscht");
check(r.changes.filter((c) => c.type === "note" && c.note === "").length === 2, "Löschungen im Verlauf (leere Notiz)");

console.log("Grenzfälle beim Abschicken:");
r = await submit(lena.participant_id, lena.secret, [it(o1, "cantucci", "mini", 900), it(o1, "cantucci", "mini", 3), it(o2, "pizza-rossa", "mini", 10)]);
check((await admin("select qty from order_items where product_id = 'cantucci'")).rows[0].qty === 500, "Menge > 500 wird gekappt, doppelte Zeilen zusammengefasst");
check(/Nicht bestellbar: Cornetto Natur/.test(await err(() => submit(lena.participant_id, lena.secret, [it(o1, "cornetto-natur", "mini", 1)]))), "Größe, die es nicht gibt (Cornetto als Mini) → abgelehnt");
check(/Unbekanntes Produkt/.test(await err(() => submit(lena.participant_id, lena.secret, [it(o1, "gibts-nicht", "stk", 1)]))), "Unbekanntes Produkt → abgelehnt");
check(/Unbekannte Größe/.test(await err(() => submit(lena.participant_id, lena.secret, [it(o1, "pizza-rossa", "xl", 1)]))), "Unbekannte Größe → abgelehnt");
await db.exec("update products set coming_soon = true where id in ('cantucci', 'amaretti')");
const full = (extra) => [it(o1, "cantucci", "mini", 500), it(o2, "pizza-rossa", "mini", 10), ...extra];
check(/Nicht bestellbar: Amaretti/.test(await err(() => submit(lena.participant_id, lena.secret, full([it(o1, "amaretti", "mini", 1)])))), "„Bald dabei“: neu wählen abgelehnt");
check((await admin("select count(*)::int n from order_items")).rows[0].n === 2, "… und abgelehntes Abschicken ändert nichts");
r = await submit(lena.participant_id, lena.secret, [it(o1, "cantucci", "mini", 100), it(o2, "pizza-rossa", "mini", 10)]);
check(r.changes.length === 1 && r.changes[0].old === 500 && r.changes[0].new === 100, "„Bald dabei“: bereits Gewähltes verringern erlaubt (niemand bleibt hängen)");
await db.exec("update products set coming_soon = false where id in ('cantucci', 'amaretti')");
check(/Nicht berechtigt/.test(await err(() => submit(lena.participant_id, "00000000-0000-0000-0000-000000000000", []))), "Falsches Secret → Nicht berechtigt");
check(/Unbekannter Einladungslink/.test(await err(() => join("gibtsnicht", "X"))), "Falscher Einladungscode → abgelehnt");

console.log("Geschlossene Bestellung:");
await admin("update orders set closed = true where id = $1", [o2]);
r = await submit(lena.participant_id, lena.secret, [it(o1, "cantucci", "mini", 100), it(o2, "pizza-rossa", "mini", 99)]);
check(r.changes.length === 0 && (await admin("select qty from order_items where order_id = $1", [o2])).rows[0].qty === 10, "Änderung in geschlossener Bestellung wird ignoriert");
r = await submit(lena.participant_id, lena.secret, [it(o1, "cantucci", "mini", 100)]);
check((await admin("select count(*)::int n from order_items where order_id = $1", [o2])).rows[0].n === 1, "… und auch Weglassen löscht dort nichts");
await admin("update orders set closed = true where id = $1", [o1]);
check(/keine Bestellung offen/.test(await err(() => join(pr.invite_code, "Zu spät"))), "Alles geschlossen → niemand kann neu beitreten");
await admin("update orders set closed = false where id in ($1, $2)", [o1, o2]);

console.log("Admin entfernt Gast → Gast tritt neu bei (der gemeldete Fehler):");
const subsBefore = (await one(db.query("select count(*)::int n from submissions"))).n;
await admin("delete from participants where id = $1", [lena.participant_id]);
check(/Nicht berechtigt/.test(await err(() => submit(lena.participant_id, lena.secret, [it(o1, "cantucci", "mini", 1)]))), "Alte Anmeldung → „Nicht berechtigt“ (Seite bietet dann Neu-Eintragen an)");
check(/Nicht berechtigt/.test(await err(() => mine(lena.participant_id, lena.secret))), "guest_items mit alter Anmeldung → „Nicht berechtigt“");
check((await admin("select count(*)::int n from order_items")).rows[0].n === 0, "Auswahl der entfernten Person ist weg");
const subs = (await admin("select name, participant_id from submissions")).rows;
check(subs.length === subsBefore && subs.every((s) => s.name === "Lena" && s.participant_id === null), "Verlauf bleibt erhalten (Name steht noch da)");
const lena2 = await join(pr.invite_code, "Lena");
r = await submit(lena2.participant_id, lena2.secret, [it(o1, "arancini", "stk", 2)], [{ order_id: o1, product_id: "arancini", note: "mit Spinat" }]);
check(r.changes.length === 2 && (await mine(lena2.participant_id, lena2.secret)).items.length === 1, "Neu eingetragen → Abschicken klappt wieder");
gp = (await one(anon("select guest_project($1) as r", [pr.invite_code]))).r;
check(gp.members.length === 1 && gp.members[0].submitted, "Wer ist dabei: Lena nur einmal, mit ✓");

console.log("Rechte (Row Level Security):");
for (const t of ["projects", "orders", "participants", "order_items", "order_notes", "submissions", "order_plan", "admins"]) {
  check(/permission denied/.test(await err(() => anon(`select * from ${t}`))), `Gast liest ${t} → verweigert`);
}
check(/permission denied/.test(await err(() => anon("select _guest_check($1, $2)", [lena2.participant_id, lena2.secret]))), "Gast ruft _guest_check → verweigert");
check((await anon("select count(*)::int n from products")).rows[0].n === 59, "Gast liest Katalog");
check(/permission denied/.test(await err(() => anon("update products set name = 'x'"))), "Gast ändert Produkt → verweigert");
check((await other("select * from projects")).rows.length === 0 && (await other("select * from order_items")).rows.length === 0 && (await other("select * from order_notes")).rows.length === 0, "Fremder Login sieht keine Projekte/Auswahl/Notizen");
await other("update products set name = 'gehackt' where id = 'pizza-rossa'");
check((await one(db.query("select name from products where id = 'pizza-rossa'"))).name !== "gehackt", "Fremder Login (kein Admin) kann Produkte nicht ändern");
check(/row-level security/.test(await err(() => other("insert into order_plan values ($1, 'pizza-rossa', 'mini', 500)", [o1]))), "Fremder Login kann keine Bestellmengen setzen");
await admin("update products set mini_price_kg = 19 where id = 'pizza-rossa'");
check(+(await one(db.query("select mini_price_kg from products where id = 'pizza-rossa'"))).mini_price_kg === 19, "Admin ändert Preis");
await admin("insert into order_plan values ($1, 'arancini', 'stk', 3)", [o1]);
check((await admin("select amount from order_plan")).rows[0].amount === 3, "Admin setzt Bestellmenge");
check(/row-level security/.test(await err(() => other("insert into storage.objects (bucket_id, name) values ('produktbilder', 'x.jpg')"))), "Fremder Login kann keine Bilder hochladen");
await admin("insert into storage.objects (bucket_id, name) values ('produktbilder', 'ok.jpg')");
check((await one(db.query("select count(*)::int n from storage.objects"))).n === 1, "Admin lädt Bild hoch");

console.log(`\n${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
