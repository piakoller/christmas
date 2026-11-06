-- Zusätzliche Treffen (z. B. Glühwein & Plätzchen an der Feuerschale) für "Wer kommt wann?".
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.
-- Die Antworten stehen wie bei den Weihnachtstagen in attendance.days, Schlüssel "event:<id>".

create table if not exists public.events (
    id         uuid primary key default gen_random_uuid(),
    season     int  not null,
    title      text not null check (length(trim(title)) between 1 and 100),
    emoji      text not null default '📅' check (length(emoji) <= 16),
    event_date date,                       -- leer = "Datum folgt"
    created_by text not null references public.profiles (name),
    created_at timestamptz not null default now()
);
create index if not exists events_season_idx on public.events (season);

alter table public.events enable row level security;

drop policy if exists "events lesen" on public.events;
create policy "events lesen" on public.events for select to authenticated using (true);

drop policy if exists "events anlegen" on public.events;
create policy "events anlegen" on public.events for insert to authenticated
    with check (created_by = public.me());

-- Ändern/Löschen: wer es angelegt hat, oder Dieter/Gudrun
drop policy if exists "events ändern" on public.events;
create policy "events ändern" on public.events for update to authenticated
    using (created_by = public.me() or public.is_admin())
    with check (created_by = public.me() or public.is_admin());

drop policy if exists "events löschen" on public.events;
create policy "events löschen" on public.events for delete to authenticated
    using (created_by = public.me() or public.is_admin());

-- Erster Termin für 2026
insert into public.events (season, title, emoji, created_by)
select 2026, 'Glühwein & Plätzchen an der Feuerschale', '🔥', 'Pia'
where not exists (select 1 from public.events where season = 2026 and title like '%Feuerschale%');
