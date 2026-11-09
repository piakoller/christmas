-- Einkaufsliste: Zutaten pro Gericht + gemeinsame Liste (aus dem Menüplan und eigene Einträge).
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

-- Zutaten eines Gerichts, eine pro Zeile (z. B. "1 kg Raclettekäse")
alter table public.dishes add column if not exists ingredients text[] not null default '{}';

create table if not exists public.shopping_items (
    id         uuid primary key default gen_random_uuid(),
    season     int  not null,
    name       text not null check (length(trim(name)) between 1 and 200),
    dish_id    uuid references public.dishes (id) on delete set null,  -- woher die Zutat kommt (oder leer)
    added_by   text not null references public.profiles (name),
    done       boolean not null default false,
    done_by    text references public.profiles (name),
    created_at timestamptz not null default now()
);
create index if not exists shopping_items_season_idx on public.shopping_items (season);
-- Dieselbe Zutat desselben Gerichts nur einmal auf der Liste
create unique index if not exists shopping_items_dish_name_idx
    on public.shopping_items (season, dish_id, lower(name)) where dish_id is not null;

alter table public.shopping_items enable row level security;

-- Gemeinsame Familienliste: alle Angemeldeten dürfen lesen, hinzufügen, abhaken und löschen
drop policy if exists "einkauf lesen" on public.shopping_items;
create policy "einkauf lesen" on public.shopping_items for select to authenticated using (true);
drop policy if exists "einkauf anlegen" on public.shopping_items;
create policy "einkauf anlegen" on public.shopping_items for insert to authenticated with check (added_by = public.me());
drop policy if exists "einkauf ändern" on public.shopping_items;
create policy "einkauf ändern" on public.shopping_items for update to authenticated using (true) with check (true);
drop policy if exists "einkauf löschen" on public.shopping_items;
create policy "einkauf löschen" on public.shopping_items for delete to authenticated using (true);
