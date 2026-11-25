-- Paradiso Bestellseite – Supabase-Schema
-- Im Supabase-Dashboard: SQL Editor → New query → alles einfügen → Run.
-- Danach seed.sql ausführen (Produkte).

create extension if not exists pgcrypto;

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
  image         text,                          -- relativer Pfad auf GitHub Pages
  unit          text not null check (unit in ('kg','stk')),
  price_min     numeric(6,2) not null,         -- €/kg bzw. €/Stück
  price_max     numeric(6,2) not null,
  est_weight_g  int,                           -- geschätztes Gewicht pro Stück (nur unit='kg')
  sort          int not null default 0,
  coming_soon   boolean not null default false,
  active        boolean not null default true
);

-- ───────────── Bestellungen ─────────────
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  invite_code text not null unique default encode(gen_random_bytes(6),'hex'),
  admin_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists participants (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  secret     uuid not null default gen_random_uuid(),   -- nur dem Gast bekannt
  created_at timestamptz not null default now()
);

create table if not exists order_items (
  participant_id uuid not null references participants(id) on delete cascade,
  product_id     text not null references products(id),
  qty            int  not null check (qty > 0 and qty <= 500),
  updated_at     timestamptz not null default now(),
  primary key (participant_id, product_id)
);

-- ───────────── Tabellenrechte ─────────────
-- Explizit, damit es nicht von Supabase-Standardrechten abhängt. Was davon wirklich
-- erlaubt ist, entscheidet RLS unten. anon (Gäste) bekommt nur den Katalog.
grant usage on schema public to anon, authenticated;
grant select on shops, products to anon, authenticated;
grant select, insert, update, delete on events, participants, order_items to authenticated;
revoke all on events, participants, order_items from anon;

-- ───────────── Row Level Security ─────────────
alter table shops        enable row level security;
alter table products     enable row level security;
alter table events       enable row level security;
alter table participants enable row level security;
alter table order_items  enable row level security;

-- Katalog: alle dürfen lesen
drop policy if exists "shops read" on shops;
create policy "shops read" on shops for select using (true);
drop policy if exists "products read" on products;
create policy "products read" on products for select using (true);

-- Events: nur der Admin (eingeloggt) sieht/ändert seine eigenen
drop policy if exists "events own" on events;
create policy "events own" on events for all to authenticated
  using (admin_id = auth.uid()) with check (admin_id = auth.uid());

-- Teilnehmer & Positionen: nur der Admin des Events darf lesen/löschen.
-- Gäste greifen NIE direkt zu, sondern nur über die Funktionen unten.
drop policy if exists "participants admin" on participants;
create policy "participants admin" on participants for all to authenticated
  using (exists (select 1 from events e where e.id = event_id and e.admin_id = auth.uid()));

drop policy if exists "items admin" on order_items;
create policy "items admin" on order_items for all to authenticated
  using (exists (select 1 from participants p join events e on e.id = p.event_id
                 where p.id = participant_id and e.admin_id = auth.uid()));

-- ───────────── Funktionen für Gäste (ohne Login) ─────────────
-- Event-Infos zum Einladungscode
create or replace function guest_event(p_code text)
returns table (title text, closed boolean)
language sql security definer set search_path = public as $$
  select title, closed from events where invite_code = p_code;
$$;

-- Mit Namen anmelden → liefert id + secret (wird im Browser gespeichert)
create or replace function guest_join(p_code text, p_name text)
returns table (participant_id uuid, secret uuid)
language plpgsql security definer set search_path = public as $$
declare v_event uuid; v_closed boolean;
begin
  select id, closed into v_event, v_closed from events where invite_code = p_code;
  if v_event is null then raise exception 'Unbekannter Einladungslink'; end if;
  if v_closed then raise exception 'Die Bestellung ist bereits geschlossen'; end if;
  return query
    insert into participants (event_id, name) values (v_event, trim(p_name))
    returning id, participants.secret;
end $$;

-- Hilfsfunktion: prüft id + secret
create or replace function _guest_check(p_id uuid, p_secret uuid)
returns uuid language sql security definer set search_path = public as $$
  select p.event_id from participants p where p.id = p_id and p.secret = p_secret;
$$;

-- Eigene Auswahl lesen
create or replace function guest_items(p_id uuid, p_secret uuid)
returns table (product_id text, qty int)
language plpgsql security definer set search_path = public as $$
begin
  if _guest_check(p_id, p_secret) is null then raise exception 'Nicht berechtigt'; end if;
  return query select i.product_id, i.qty from order_items i where i.participant_id = p_id;
end $$;

-- Menge setzen (0 = entfernen)
create or replace function guest_set_item(p_id uuid, p_secret uuid, p_product text, p_qty int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid;
begin
  v_event := _guest_check(p_id, p_secret);
  if v_event is null then raise exception 'Nicht berechtigt'; end if;
  if (select closed from events where id = v_event) then
    raise exception 'Die Bestellung ist bereits geschlossen';
  end if;
  if p_qty is null or p_qty <= 0 then
    delete from order_items where participant_id = p_id and product_id = p_product;
  else
    insert into order_items (participant_id, product_id, qty, updated_at)
    values (p_id, p_product, least(p_qty, 500), now())
    on conflict (participant_id, product_id)
    do update set qty = excluded.qty, updated_at = now();
  end if;
end $$;

revoke all on function _guest_check(uuid, uuid) from public, anon, authenticated;
grant execute on function guest_event(text)                     to anon, authenticated;
grant execute on function guest_join(text, text)                to anon, authenticated;
grant execute on function guest_items(uuid, uuid)               to anon, authenticated;
grant execute on function guest_set_item(uuid, uuid, text, int) to anon, authenticated;

-- ───────────── Echtzeit für die Admin-Ansicht ─────────────
do $$ begin
  alter publication supabase_realtime add table order_items;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table participants;
exception when duplicate_object then null; end $$;
