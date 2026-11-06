-- Gruppen als Empfänger für geheime Ideen: "Eltern" und "Kinder".
-- Ideen und Käufe für eine Gruppe sind für ALLE Mitglieder der Gruppe unsichtbar.
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

alter table public.profiles add column if not exists is_group boolean not null default false;

create table if not exists public.group_members (
    group_name text not null references public.profiles (name) on delete cascade,
    member     text not null references public.profiles (name) on delete cascade,
    primary key (group_name, member)
);
alter table public.group_members enable row level security;
drop policy if exists "gruppen lesen" on public.group_members;
create policy "gruppen lesen" on public.group_members for select to authenticated using (true);

insert into public.profiles (name, is_group, sort_order, color_bg, color_fg) values
    ('Eltern', true, 8, '#FFF4D6', '#6B4B00'),
    ('Kinder', true, 9, '#E7EEF8', '#1D4A80')
on conflict (name) do update set is_group = true;

insert into public.group_members (group_name, member) values
    ('Eltern', 'Dieter'), ('Eltern', 'Gudrun'),
    ('Kinder', 'Lukas'), ('Kinder', 'Pia'), ('Kinder', 'Emmy'), ('Kinder', 'Tim')
on conflict do nothing;

-- Ist das Geschenk für mich – direkt oder für eine Gruppe, zu der ich gehöre?
create or replace function public.is_for_me(recipient text) returns boolean
language sql stable security definer set search_path = public as $$
    select recipient = public.me()
        or exists (select 1 from public.group_members where group_name = recipient and member = public.me())
$$;

-- Gruppen erscheinen nicht auf der Login-Seite
create or replace function public.login_profiles()
returns table (name text, has_pin boolean, is_family_account boolean, color_bg text, color_fg text)
language sql stable security definer set search_path = public as $$
    select name, auth_id is not null, is_family_account, color_bg, color_fg
    from public.profiles where not is_group order by sort_order
$$;

-- Gruppen können sich nicht anmelden
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
    if not exists (select 1 from public.profiles where name = v_name and not is_group) then
        raise exception 'Unbekannte Person';
    end if;
    if exists (select 1 from public.profiles where name = v_name and auth_id is not null) then
        raise exception 'Diese Person hat schon eine PIN';
    end if;
    new.raw_user_meta_data := new.raw_user_meta_data - 'family_code';
    return new;
end $$;

-- Besorgen: Mitglieder einer Gruppe dürfen Ideen für ihre Gruppe nicht besorgen
create or replace function private.purchase_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare w public.wishes; s public.suggestions;
begin
    if tg_op = 'UPDATE' then
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
        if new.claimed_by = s.suggested_for
           or exists (select 1 from public.group_members where group_name = s.suggested_for and member = new.claimed_by) then
            raise exception 'Nicht erlaubt';
        end if;
        new.season := s.season; new.recipient := s.suggested_for; new.item_name := s.name;
    end if;
    new.claimed_at := now();
    return new;
end $$;

-- Ideen: unsichtbar für die Person bzw. alle Mitglieder der Gruppe
drop policy if exists "suggestions lesen" on public.suggestions;
create policy "suggestions lesen" on public.suggestions for select to authenticated
    using (not public.is_for_me(suggested_for));
drop policy if exists "suggestions anlegen" on public.suggestions;
create policy "suggestions anlegen" on public.suggestions for insert to authenticated
    with check (suggested_by = public.me() and not public.is_for_me(suggested_for));
drop policy if exists "suggestions ändern" on public.suggestions;
create policy "suggestions ändern" on public.suggestions for update to authenticated
    using (suggested_by = public.me()) with check (suggested_by = public.me() and not public.is_for_me(suggested_for));

-- Käufe: wer etwas für dich (oder deine Gruppe) besorgt, bleibt eine Überraschung
drop policy if exists "purchases lesen" on public.purchases;
create policy "purchases lesen" on public.purchases for select to authenticated
    using (not public.is_for_me(recipient) or claimed_by = public.me());
