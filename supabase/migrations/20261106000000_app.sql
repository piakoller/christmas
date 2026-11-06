-- Weihnachts-App: Tabellen, Zugriffsregeln (RLS), Login-Trigger, Speicher.
-- Ausführen im Supabase SQL Editor oder mit `npx supabase db push`.
-- Kann gefahrlos mehrfach ausgeführt werden.
-- Die alte Tabelle app_data bleibt unverändert als Archiv bestehen.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Personen
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    name              text primary key,
    auth_id           uuid unique references auth.users (id) on delete set null,
    is_admin          boolean not null default false,
    is_family_account boolean not null default false,
    sort_order        int     not null default 0,
    color_bg          text    not null default '#F1EFE8',
    color_fg          text    not null default '#444441'
);

insert into public.profiles (name, is_admin, is_family_account, sort_order, color_bg, color_fg) values
    ('Dieter', true,  false, 1, '#FCEBEB', '#791F1F'),
    ('Gudrun', true,  false, 2, '#FAEEDA', '#633806'),
    ('Lukas',  false, false, 3, '#E6F1FB', '#0C447C'),
    ('Pia',    false, false, 4, '#EAF3DE', '#27500A'),
    ('Emmy',   false, false, 5, '#FBEAF0', '#72243E'),
    ('Tim',    false, false, 6, '#E1F5EE', '#085041'),
    ('W11',    false, true,  7, '#1E3A2B', '#FFD666')
on conflict (name) do nothing;

-- Geheime Einstellungen (Familien-Code). Für niemanden über die API lesbar.
create table if not exists private.config (
    key   text primary key,
    value text not null
);

-- Name der angemeldeten Person (oder null)
create or replace function public.me() returns text
language sql stable security definer set search_path = public as $$
    select name from public.profiles where auth_id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((select is_admin from public.profiles where auth_id = auth.uid()), false)
$$;

create or replace function public.is_family_account(person text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce((select is_family_account from public.profiles where name = person), false)
$$;

-- Für die Login-Seite (auch ohne Anmeldung): wer hat schon eine PIN?
create or replace function public.login_profiles()
returns table (name text, has_pin boolean, is_family_account boolean, color_bg text, color_fg text)
language sql stable security definer set search_path = public as $$
    select name, auth_id is not null, is_family_account, color_bg, color_fg
    from public.profiles order by sort_order
$$;
grant execute on function public.login_profiles() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Login: erste PIN nur mit Familien-Code
-- Die App ruft supabase.auth.signUp mit data = {name, family_code} auf.
-- ---------------------------------------------------------------------------
create or replace function private.check_signup() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
    v_name     text := new.raw_user_meta_data ->> 'name';
    v_code     text := new.raw_user_meta_data ->> 'family_code';
    v_expected text;
begin
    select value into v_expected from private.config where key = 'family_code';
    if v_expected is null then
        raise exception 'Familien-Code ist nicht eingerichtet';
    end if;
    -- Leerzeichen am Rand und Groß-/Kleinschreibung spielen keine Rolle
    if v_code is null or lower(trim(v_code)) <> lower(trim(v_expected)) then
        raise exception 'Familien-Code stimmt nicht';
    end if;
    if not exists (select 1 from public.profiles where name = v_name) then
        raise exception 'Unbekannte Person';
    end if;
    if exists (select 1 from public.profiles where name = v_name and auth_id is not null) then
        raise exception 'Diese Person hat schon eine PIN';
    end if;
    new.raw_user_meta_data := new.raw_user_meta_data - 'family_code';
    return new;
end $$;

create or replace function private.link_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    update public.profiles set auth_id = new.id
    where name = new.raw_user_meta_data ->> 'name' and auth_id is null;
    return new;
end $$;

-- Der Supabase-Auth-Dienst führt diese Trigger aus
grant usage on schema private to supabase_auth_admin;
grant execute on function private.check_signup(), private.link_profile() to supabase_auth_admin;

drop trigger if exists check_signup on auth.users;
create trigger check_signup before insert on auth.users
    for each row execute function private.check_signup();

drop trigger if exists link_profile on auth.users;
create trigger link_profile after insert on auth.users
    for each row execute function private.link_profile();

-- PIN zurücksetzen (nur Dieter/Gudrun): Login der Person löschen,
-- danach legt sie mit dem Familien-Code eine neue PIN an. Daten bleiben erhalten.
create or replace function public.admin_reset_pin(person text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_auth uuid;
begin
    if not public.is_admin() then
        raise exception 'Nur Dieter und Gudrun dürfen PINs zurücksetzen';
    end if;
    select auth_id into v_auth from public.profiles where name = person;
    if v_auth is not null then
        delete from auth.users where id = v_auth;
    end if;
end $$;
revoke execute on function public.admin_reset_pin(text) from public, anon;
grant execute on function public.admin_reset_pin(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Wunschliste
-- ---------------------------------------------------------------------------
create table if not exists public.wishes (
    id          uuid primary key default gen_random_uuid(),
    season      int  not null,
    owner       text not null references public.profiles (name),
    name        text not null check (length(trim(name)) > 0),
    description text not null default '',
    link        text not null default '',
    price       numeric(10, 2) not null default 0 check (price >= 0),
    buy_self    boolean not null default false,
    expert      text references public.profiles (name),
    image_paths text[] not null default '{}',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    check (expert is null or expert <> owner)
);
create index if not exists wishes_season_idx on public.wishes (season);

create table if not exists public.suggestions (
    id            uuid primary key default gen_random_uuid(),
    season        int  not null,
    suggested_by  text not null references public.profiles (name),
    suggested_for text not null references public.profiles (name),
    name          text not null check (length(trim(name)) > 0),
    description   text not null default '',
    link          text not null default '',
    price         numeric(10, 2) not null default 0 check (price >= 0),
    created_at    timestamptz not null default now(),
    check (suggested_by <> suggested_for)
);
create index if not exists suggestions_season_idx on public.suggestions (season);

-- Wer besorgt was. Ein Geschenk kann nur von einer Person besorgt werden (Primärschlüssel).
-- recipient/item_name/season werden per Trigger aus dem Geschenk übernommen.
create table if not exists public.purchases (
    item_id      uuid primary key,
    item_kind    text not null check (item_kind in ('wish', 'suggestion')),
    season       int  not null,
    recipient    text not null references public.profiles (name),
    item_name    text not null,
    claimed_by   text not null references public.profiles (name),
    claimed_at   timestamptz not null default now(),
    purchased    boolean not null default false,
    actual_price numeric(10, 2) check (actual_price is null or actual_price >= 0),
    reimbursed   boolean not null default false
);
create index if not exists purchases_season_idx on public.purchases (season);

create or replace function private.purchase_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare w public.wishes; s public.suggestions;
begin
    if tg_op = 'UPDATE' then
        -- Geschenk und Käufer bleiben fest, nur Status/Preis ändern sich.
        -- Ausnahme: der Name, wenn die Änderung vom Umbenennen-Trigger kommt (Tiefe > 1).
        new.item_id := old.item_id; new.item_kind := old.item_kind; new.season := old.season;
        new.recipient := old.recipient;
        new.claimed_by := old.claimed_by; new.claimed_at := old.claimed_at;
        if pg_trigger_depth() <= 1 then
            new.item_name := old.item_name;
        end if;
        return new;
    end if;
    if new.item_kind = 'wish' then
        select * into w from public.wishes where id = new.item_id;
        if not found then raise exception 'Wunsch nicht gefunden'; end if;
        -- Fremde dürfen nur Wünsche ohne "kaufe ich selbst" besorgen; der Experte und
        -- der Besitzer selbst (bei "kaufe ich selbst") dürfen immer.
        if w.buy_self and new.claimed_by <> w.owner and new.claimed_by is distinct from w.expert then
            raise exception 'Diesen Wunsch kauft die Person selbst';
        end if;
        if not w.buy_self and new.claimed_by = w.owner then
            raise exception 'Eigene Wünsche können nicht selbst besorgt werden';
        end if;
        new.season := w.season; new.recipient := w.owner; new.item_name := w.name;
    else
        select * into s from public.suggestions where id = new.item_id;
        if not found then raise exception 'Vorschlag nicht gefunden'; end if;
        if new.claimed_by = s.suggested_for then raise exception 'Nicht erlaubt'; end if;
        new.season := s.season; new.recipient := s.suggested_for; new.item_name := s.name;
    end if;
    new.claimed_at := now();
    return new;
end $$;

drop trigger if exists purchase_fill on public.purchases;
create trigger purchase_fill before insert or update on public.purchases
    for each row execute function private.purchase_fill();

-- Name im Kauf aktuell halten, wenn ein Wunsch/Vorschlag umbenannt wird
create or replace function private.sync_purchase_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.name is distinct from old.name then
        update public.purchases set item_name = new.name where item_id = new.id;
    end if;
    return new;
end $$;
drop trigger if exists sync_purchase_name on public.wishes;
create trigger sync_purchase_name after update on public.wishes
    for each row execute function private.sync_purchase_name();
drop trigger if exists sync_purchase_name on public.suggestions;
create trigger sync_purchase_name after update on public.suggestions
    for each row execute function private.sync_purchase_name();

-- ---------------------------------------------------------------------------
-- Essensplanung
-- ---------------------------------------------------------------------------
create table if not exists public.dishes (
    id          uuid primary key default gen_random_uuid(),
    season      int  not null,
    name        text not null check (length(trim(name)) > 0),
    category    text not null check (category in ('Vorspeise', 'Hauptspeise', 'Nachspeise', 'Snacks')),
    description text not null default '',
    proposed_by text not null references public.profiles (name),
    responsible text references public.profiles (name),
    created_at  timestamptz not null default now()
);

create table if not exists public.dish_votes (
    dish_id uuid not null references public.dishes (id) on delete cascade,
    voter   text not null references public.profiles (name),
    primary key (dish_id, voter)
);

create table if not exists public.meal_schedule (
    season   int  not null,
    day      date not null,
    category text not null check (category in ('Vorspeise', 'Hauptspeise', 'Nachspeise', 'Snacks')),
    dish_id  uuid not null references public.dishes (id) on delete cascade,
    primary key (day, category, dish_id)
);

-- ---------------------------------------------------------------------------
-- Anwesenheit
-- days: {"2026-12-24": {"status": "present"|"unsure"|"absent", "with_partner": bool, "overnight": bool}}
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
    season     int  not null,
    person     text not null references public.profiles (name),
    days       jsonb not null default '{}'::jsonb,
    notes      text not null default '',
    updated_at timestamptz not null default now(),
    primary key (season, person)
);

-- ---------------------------------------------------------------------------
-- Adventskalender
-- ---------------------------------------------------------------------------
create table if not exists public.advent_photos (
    id         uuid primary key default gen_random_uuid(),
    path       text not null unique,
    year_label text not null default '',
    caption    text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.advent_opened (
    season int  not null,
    person text not null references public.profiles (name),
    day    int  not null check (day between 1 and 24),
    primary key (season, person, day)
);

create table if not exists public.advent_comments (
    id         uuid primary key default gen_random_uuid(),
    season     int  not null,
    day        int  not null check (day between 1 and 24),
    author     text not null references public.profiles (name),
    text       text not null check (length(trim(text)) between 1 and 500),
    created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Einstellungen und Benachrichtigungen
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
    key   text primary key,
    value jsonb not null
);
insert into public.app_settings (key, value) values ('advent_calendar', 'false'::jsonb)
on conflict (key) do nothing;

create table if not exists public.push_subscriptions (
    endpoint   text primary key,
    person     text not null references public.profiles (name),
    p256dh     text not null,
    auth       text not null,
    user_agent text not null default '',
    created_at timestamptz not null default now()
);

create table if not exists public.notification_prefs (
    person     text primary key references public.profiles (name),
    expert     boolean not null default true,
    meal       boolean not null default true,
    suggestion boolean not null default true
);

create table if not exists public.notifications_sent (
    kind      text not null,
    item_id   uuid not null,
    recipient text not null,
    sent_at   timestamptz not null default now(),
    primary key (kind, item_id, recipient)
);

-- ---------------------------------------------------------------------------
-- Zugriffsregeln (RLS). Ohne Anmeldung ist nichts lesbar.
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.wishes             enable row level security;
alter table public.suggestions        enable row level security;
alter table public.purchases          enable row level security;
alter table public.dishes             enable row level security;
alter table public.dish_votes         enable row level security;
alter table public.meal_schedule      enable row level security;
alter table public.attendance         enable row level security;
alter table public.advent_photos      enable row level security;
alter table public.advent_opened      enable row level security;
alter table public.advent_comments    enable row level security;
alter table public.app_settings       enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notifications_sent enable row level security;  -- nur Edge Function (Service-Key)

drop policy if exists "profiles lesen" on public.profiles;
create policy "profiles lesen" on public.profiles for select to authenticated using (true);

drop policy if exists "wishes lesen" on public.wishes;
create policy "wishes lesen"   on public.wishes for select to authenticated using (true);
drop policy if exists "wishes anlegen" on public.wishes;
create policy "wishes anlegen" on public.wishes for insert to authenticated with check (owner = public.me());
drop policy if exists "wishes ändern" on public.wishes;
create policy "wishes ändern"  on public.wishes for update to authenticated using (owner = public.me()) with check (owner = public.me());
drop policy if exists "wishes löschen" on public.wishes;
create policy "wishes löschen" on public.wishes for delete to authenticated using (owner = public.me());

drop policy if exists "suggestions lesen" on public.suggestions;
create policy "suggestions lesen"   on public.suggestions for select to authenticated using (suggested_for <> public.me());
drop policy if exists "suggestions anlegen" on public.suggestions;
create policy "suggestions anlegen" on public.suggestions for insert to authenticated
    with check (suggested_by = public.me() and suggested_for <> public.me());
drop policy if exists "suggestions ändern" on public.suggestions;
create policy "suggestions ändern"  on public.suggestions for update to authenticated
    using (suggested_by = public.me()) with check (suggested_by = public.me() and suggested_for <> public.me());
drop policy if exists "suggestions löschen" on public.suggestions;
create policy "suggestions löschen" on public.suggestions for delete to authenticated using (suggested_by = public.me());

-- Wer etwas für dich besorgt, bleibt eine Überraschung.
drop policy if exists "purchases lesen" on public.purchases;
create policy "purchases lesen"   on public.purchases for select to authenticated
    using (recipient <> public.me() or claimed_by = public.me());
drop policy if exists "purchases anlegen" on public.purchases;
create policy "purchases anlegen" on public.purchases for insert to authenticated with check (claimed_by = public.me());
drop policy if exists "purchases ändern" on public.purchases;
create policy "purchases ändern"  on public.purchases for update to authenticated
    using (claimed_by = public.me()) with check (claimed_by = public.me());
drop policy if exists "purchases löschen" on public.purchases;
create policy "purchases löschen" on public.purchases for delete to authenticated using (claimed_by = public.me());

drop policy if exists "dishes lesen" on public.dishes;
create policy "dishes lesen"   on public.dishes for select to authenticated using (true);
drop policy if exists "dishes anlegen" on public.dishes;
create policy "dishes anlegen" on public.dishes for insert to authenticated with check (proposed_by = public.me());
drop policy if exists "dishes ändern" on public.dishes;
create policy "dishes ändern"  on public.dishes for update to authenticated using (true) with check (true);
drop policy if exists "dishes löschen" on public.dishes;
create policy "dishes löschen" on public.dishes for delete to authenticated using (proposed_by = public.me());

drop policy if exists "votes lesen" on public.dish_votes;
create policy "votes lesen"   on public.dish_votes for select to authenticated using (true);
drop policy if exists "votes anlegen" on public.dish_votes;
create policy "votes anlegen" on public.dish_votes for insert to authenticated with check (voter = public.me());
drop policy if exists "votes löschen" on public.dish_votes;
create policy "votes löschen" on public.dish_votes for delete to authenticated using (voter = public.me());

drop policy if exists "schedule lesen" on public.meal_schedule;
create policy "schedule lesen"   on public.meal_schedule for select to authenticated using (true);
drop policy if exists "schedule anlegen" on public.meal_schedule;
create policy "schedule anlegen" on public.meal_schedule for insert to authenticated with check (true);
drop policy if exists "schedule löschen" on public.meal_schedule;
create policy "schedule löschen" on public.meal_schedule for delete to authenticated using (true);

drop policy if exists "attendance lesen" on public.attendance;
create policy "attendance lesen"   on public.attendance for select to authenticated using (true);
drop policy if exists "attendance anlegen" on public.attendance;
create policy "attendance anlegen" on public.attendance for insert to authenticated
    with check (person = public.me() and not public.is_family_account(person));
drop policy if exists "attendance ändern" on public.attendance;
create policy "attendance ändern"  on public.attendance for update to authenticated
    using (person = public.me()) with check (person = public.me() and not public.is_family_account(person));

drop policy if exists "photos lesen" on public.advent_photos;
create policy "photos lesen"   on public.advent_photos for select to authenticated using (true);
drop policy if exists "photos admins" on public.advent_photos;
create policy "photos admins"  on public.advent_photos for all to authenticated
    using (public.is_admin()) with check (public.is_admin());

drop policy if exists "opened eigene" on public.advent_opened;
create policy "opened eigene"  on public.advent_opened for all to authenticated
    using (person = public.me()) with check (person = public.me());

drop policy if exists "comments lesen" on public.advent_comments;
create policy "comments lesen"   on public.advent_comments for select to authenticated using (true);
drop policy if exists "comments anlegen" on public.advent_comments;
create policy "comments anlegen" on public.advent_comments for insert to authenticated with check (author = public.me());
drop policy if exists "comments löschen" on public.advent_comments;
create policy "comments löschen" on public.advent_comments for delete to authenticated using (author = public.me());

drop policy if exists "settings lesen" on public.app_settings;
create policy "settings lesen"  on public.app_settings for select to authenticated using (true);
drop policy if exists "settings admins" on public.app_settings;
create policy "settings admins" on public.app_settings for update to authenticated
    using (public.is_admin()) with check (public.is_admin());

drop policy if exists "subscriptions eigene" on public.push_subscriptions;
create policy "subscriptions eigene" on public.push_subscriptions for all to authenticated
    using (person = public.me()) with check (person = public.me());

drop policy if exists "prefs eigene" on public.notification_prefs;
create policy "prefs eigene" on public.notification_prefs for all to authenticated
    using (person = public.me()) with check (person = public.me());

-- ---------------------------------------------------------------------------
-- Speicher für Bilder (privat, nur für Angemeldete)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
    ('wish-images', 'wish-images', false),
    ('advent-photos', 'advent-photos', false)
on conflict (id) do nothing;

drop policy if exists "bilder lesen" on storage.objects;
create policy "bilder lesen" on storage.objects for select to authenticated
    using (bucket_id in ('wish-images', 'advent-photos'));
drop policy if exists "wunschbilder hochladen" on storage.objects;
create policy "wunschbilder hochladen" on storage.objects for insert to authenticated
    with check (bucket_id = 'wish-images' and (storage.foldername(name))[1] = public.me());
drop policy if exists "wunschbilder löschen" on storage.objects;
create policy "wunschbilder löschen" on storage.objects for delete to authenticated
    using (bucket_id = 'wish-images' and (storage.foldername(name))[1] = public.me());
drop policy if exists "adventsfotos admins" on storage.objects;
create policy "adventsfotos admins" on storage.objects for all to authenticated
    using (bucket_id = 'advent-photos' and public.is_admin())
    with check (bucket_id = 'advent-photos' and public.is_admin());
