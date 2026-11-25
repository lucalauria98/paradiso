-- Paradiso Bestellseite – Supabase-Schema
-- Im Supabase-Dashboard: SQL Editor → New query → alles einfügen → Run.
-- Danach seed.sql ausführen (Produkte). Erneut ausführen ist gefahrlos.
--
-- Aufbau: Projekt (z. B. „Weihnachten 2026“, ein Einladungslink, Notiz für Gäste)
--           └─ Bestellungen (z. B. „Kaffee Heiligabend“, mit Abholtermin, einzeln schließbar)
--         Gäste tragen sich einmal pro Projekt ein, wählen pro Bestellung aus und schicken ab.
--         Jedes Abschicken mit Änderungen landet im Verlauf (submissions).

create extension if not exists pgcrypto;

-- ───────────── Admins ─────────────
-- Wer hier steht, darf Produkte & Bilder bearbeiten. Beim Ausführen werden alle vorhandenen
-- Supabase-User eingetragen (Signups sind aus → das ist nur der Admin-Login).
create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table admins enable row level security;               -- keine Policies → über die API unsichtbar
insert into admins (user_id) select id from auth.users on conflict do nothing;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ───────────── Katalog ─────────────
create table if not exists shops (
  id   text primary key,
  name text not null,
  sort int  not null default 0
);

create table if not exists products (
  id            text primary key,              -- slug, z. B. 'pizza-rossa'
  shop_id       text not null references shops(id) on delete cascade,
  code          text,                          -- z. B. 'V1-1.1' (Vitrine/Reihe)
  category      text not null,
  name          text not null,
  image         text,                          -- relativer Pfad auf GitHub Pages oder Storage-URL
  unit          text not null check (unit in ('kg','stk')),
  price_min     numeric(6,2) not null,         -- €/kg bzw. €/Stück
  price_max     numeric(6,2) not null,
  est_weight_g  int,                           -- geschätztes Gewicht pro Stück (nur unit='kg')
  sort          int not null default 0,
  coming_soon   boolean not null default false,
  active        boolean not null default true
);
alter table products add column if not exists kind text not null default 'suess';  -- 'herzhaft' | 'suess'
do $$ begin
  alter table products add constraint products_kind_check check (kind in ('herzhaft','suess'));
exception when duplicate_object then null; end $$;

-- ───────────── Projekte & Bestellungen ─────────────
create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  invite_code text not null unique default encode(gen_random_bytes(6),'hex'),
  admin_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table projects add column if not exists note text;   -- Hinweis für Gäste

create table if not exists orders (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  pickup_at   timestamptz,                     -- Abholtermin (optional)
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists participants (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  secret     uuid not null default gen_random_uuid(),   -- nur dem Gast bekannt
  created_at timestamptz not null default now()
);

-- Abgeschickter Stand je Gast, Bestellung und Produkt
create table if not exists order_items (
  participant_id uuid not null references participants(id) on delete cascade,
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     text not null references products(id),
  qty            int  not null check (qty > 0 and qty <= 500),
  updated_at     timestamptz not null default now(),
  primary key (participant_id, order_id, product_id)
);

-- Verlauf: jedes Abschicken mit Änderungen, changes = [{order_id, product_id, old, new}]
create table if not exists submissions (
  id             bigint generated always as identity primary key,
  project_id     uuid not null references projects(id) on delete cascade,
  participant_id uuid references participants(id) on delete set null,
  name           text not null,
  changes        jsonb not null,
  created_at     timestamptz not null default now()
);

-- ───────────── Tabellenrechte ─────────────
-- Explizit, damit es nicht von Supabase-Standardrechten abhängt. Was davon wirklich
-- erlaubt ist, entscheidet RLS unten. anon (Gäste) bekommt nur den Katalog.
grant usage on schema public to anon, authenticated;
revoke all on shops, products from anon;                 -- Gäste: Katalog nur lesen
grant select on shops, products to anon, authenticated;
grant insert, update on products to authenticated;
grant select, insert, update, delete on projects, orders, participants, order_items, submissions to authenticated;
revoke all on admins, projects, orders, participants, order_items, submissions from anon;
revoke all on admins from authenticated;
grant execute on function is_admin() to authenticated;

-- ───────────── Row Level Security ─────────────
alter table shops        enable row level security;
alter table products     enable row level security;
alter table projects     enable row level security;
alter table orders       enable row level security;
alter table participants enable row level security;
alter table order_items  enable row level security;
alter table submissions  enable row level security;

-- Katalog: alle dürfen lesen, nur Admins ändern
drop policy if exists "shops read" on shops;
create policy "shops read" on shops for select using (true);
drop policy if exists "products read" on products;
create policy "products read" on products for select using (true);
drop policy if exists "products admin insert" on products;
create policy "products admin insert" on products for insert to authenticated with check (is_admin());
drop policy if exists "products admin update" on products;
create policy "products admin update" on products for update to authenticated using (is_admin()) with check (is_admin());

-- Projekte: nur der Admin (eingeloggt) sieht/ändert seine eigenen
drop policy if exists "projects own" on projects;
create policy "projects own" on projects for all to authenticated
  using (admin_id = auth.uid()) with check (admin_id = auth.uid());

-- Bestellungen, Teilnehmer, Positionen, Verlauf: nur der Admin des Projekts.
-- Gäste greifen NIE direkt zu, sondern nur über die Funktionen unten.
drop policy if exists "orders admin" on orders;
create policy "orders admin" on orders for all to authenticated
  using (exists (select 1 from projects p where p.id = project_id and p.admin_id = auth.uid()));

drop policy if exists "participants admin" on participants;
create policy "participants admin" on participants for all to authenticated
  using (exists (select 1 from projects p where p.id = project_id and p.admin_id = auth.uid()));

drop policy if exists "items admin" on order_items;
create policy "items admin" on order_items for all to authenticated
  using (exists (select 1 from participants pa join projects p on p.id = pa.project_id
                 where pa.id = participant_id and p.admin_id = auth.uid()));

drop policy if exists "submissions admin" on submissions;
create policy "submissions admin" on submissions for all to authenticated
  using (exists (select 1 from projects p where p.id = project_id and p.admin_id = auth.uid()));

-- ───────────── Funktionen für Gäste (ohne Login) ─────────────
-- Projekt zum Einladungscode: Titel, Notiz, Bestellungen und wer dabei ist
-- (nur Namen + ob abgeschickt – nie, was andere gewählt haben)
create or replace function guest_project(p_code text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'title', p.title,
    'note', p.note,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'pickup_at', o.pickup_at, 'closed', o.closed)
                       order by o.pickup_at nulls last, o.created_at)
      from orders o where o.project_id = p.id), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('name', pa.name,
               'submitted', exists (select 1 from submissions s where s.participant_id = pa.id))
             order by pa.created_at)
      from participants pa where pa.project_id = p.id), '[]'::jsonb))
  from projects p where p.invite_code = p_code;
$$;

-- Mit Namen anmelden → liefert id + secret (wird im Browser gespeichert)
create or replace function guest_join(p_code text, p_name text)
returns table (participant_id uuid, secret uuid)
language plpgsql security definer set search_path = public as $$
declare v_project uuid;
begin
  select id into v_project from projects where invite_code = p_code;
  if v_project is null then raise exception 'Unbekannter Einladungslink'; end if;
  if not exists (select 1 from orders where project_id = v_project and not closed) then
    raise exception 'Gerade ist keine Bestellung offen';
  end if;
  return query
    insert into participants (project_id, name) values (v_project, trim(p_name))
    returning id, participants.secret;
end $$;

-- Hilfsfunktion: prüft id + secret, liefert das Projekt des Gastes
create or replace function _guest_check(p_id uuid, p_secret uuid)
returns uuid language sql security definer set search_path = public as $$
  select p.project_id from participants p where p.id = p_id and p.secret = p_secret;
$$;

-- Eigener abgeschickter Stand: {items: [{order_id, product_id, qty}], submitted_at}
create or replace function guest_items(p_id uuid, p_secret uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if _guest_check(p_id, p_secret) is null then raise exception 'Nicht berechtigt'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('order_id', i.order_id, 'product_id', i.product_id, 'qty', i.qty))
                       from order_items i where i.participant_id = p_id), '[]'::jsonb),
    'submitted_at', (select max(s.created_at) from submissions s where s.participant_id = p_id));
end $$;

-- Auswahl abschicken: p_items = [{order_id, product_id, qty}] = gesamter gewünschter Stand.
-- Ersetzt den Stand in allen OFFENEN Bestellungen des Projekts, schreibt Änderungen in den Verlauf
-- und liefert {changes, submitted_at}. Geschlossene Bestellungen bleiben unberührt.
create or replace function guest_submit(p_id uuid, p_secret uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_project uuid; v_name text; v_changes jsonb; v_bad text;
begin
  select project_id, name into v_project, v_name from participants where id = p_id and secret = p_secret;
  if v_project is null then raise exception 'Nicht berechtigt'; end if;

  drop table if exists _want, _cur;
  create temp table _want on commit drop as
    select (x->>'order_id')::uuid as order_id, x->>'product_id' as product_id, least(max((x->>'qty')::int), 500) as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
    where (x->>'qty')::int > 0
      and (x->>'order_id')::uuid in (select id from orders where project_id = v_project and not closed)
    group by 1, 2;
  create temp table _cur on commit drop as
    select i.order_id, i.product_id, i.qty from order_items i
    where i.participant_id = p_id
      and i.order_id in (select id from orders where project_id = v_project and not closed);

  -- Neu gewählte oder erhöhte Produkte müssen bestellbar sein
  select pr.name into v_bad from _want w join products pr on pr.id = w.product_id
    left join _cur c on c.order_id = w.order_id and c.product_id = w.product_id
    where (not pr.active or pr.coming_soon) and (c.qty is null or w.qty > c.qty) limit 1;
  if v_bad is not null then raise exception 'Nicht bestellbar: %', v_bad; end if;
  if exists (select 1 from _want w where not exists (select 1 from products pr where pr.id = w.product_id)) then
    raise exception 'Unbekanntes Produkt';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('order_id', d.order_id, 'product_id', d.product_id, 'old', d.old_qty, 'new', d.new_qty)
                            order by d.order_id, d.product_id), '[]'::jsonb)
    into v_changes
    from (select coalesce(w.order_id, c.order_id) as order_id, coalesce(w.product_id, c.product_id) as product_id,
                 coalesce(c.qty, 0) as old_qty, coalesce(w.qty, 0) as new_qty
          from _want w full join _cur c on c.order_id = w.order_id and c.product_id = w.product_id
          where c.qty is distinct from w.qty) d;

  if v_changes <> '[]'::jsonb then
    delete from order_items i using _cur c
      where i.participant_id = p_id and i.order_id = c.order_id and i.product_id = c.product_id;
    insert into order_items (participant_id, order_id, product_id, qty, updated_at)
      select p_id, w.order_id, w.product_id, w.qty, now() from _want w;
    insert into submissions (project_id, participant_id, name, changes) values (v_project, p_id, v_name, v_changes);
  end if;

  return jsonb_build_object('changes', v_changes,
    'submitted_at', (select max(s.created_at) from submissions s where s.participant_id = p_id));
end $$;

revoke all on function _guest_check(uuid, uuid) from public, anon, authenticated;
grant execute on function guest_project(text)                 to anon, authenticated;
grant execute on function guest_join(text, text)              to anon, authenticated;
grant execute on function guest_items(uuid, uuid)             to anon, authenticated;
grant execute on function guest_submit(uuid, uuid, jsonb)     to anon, authenticated;

-- ───────────── Produktbilder (Supabase Storage) ─────────────
-- Öffentlich lesbar (wie die Bilder auf GitHub Pages), hochladen/löschen nur Admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('produktbilder', 'produktbilder', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true;

drop policy if exists "produktbilder admin insert" on storage.objects;
create policy "produktbilder admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'produktbilder' and public.is_admin());
drop policy if exists "produktbilder admin delete" on storage.objects;
create policy "produktbilder admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'produktbilder' and public.is_admin());

-- ───────────── Echtzeit für die Admin-Ansicht ─────────────
do $$ begin
  alter publication supabase_realtime add table order_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table participants;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table submissions;
exception when duplicate_object then null; end $$;
