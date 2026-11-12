-- Kommentare und Fragen zu Wünschen (z. B. "Welche Farbe?").
-- Alle sehen sie, auch der Besitzer des Wunsches – so kann er antworten.
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

create table if not exists public.wish_comments (
    id         uuid primary key default gen_random_uuid(),
    wish_id    uuid not null references public.wishes (id) on delete cascade,
    author     text not null references public.profiles (name),
    text       text not null check (length(trim(text)) between 1 and 500),
    created_at timestamptz not null default now()
);
create index if not exists wish_comments_wish_idx on public.wish_comments (wish_id);

alter table public.wish_comments enable row level security;

drop policy if exists "wunsch-kommentare lesen" on public.wish_comments;
create policy "wunsch-kommentare lesen" on public.wish_comments for select to authenticated using (true);
drop policy if exists "wunsch-kommentare schreiben" on public.wish_comments;
create policy "wunsch-kommentare schreiben" on public.wish_comments for insert to authenticated with check (author = public.me());
drop policy if exists "wunsch-kommentare löschen" on public.wish_comments;
create policy "wunsch-kommentare löschen" on public.wish_comments for delete to authenticated using (author = public.me());

-- Benachrichtigung bei neuen Fragen/Antworten (abschaltbar in den Einstellungen)
alter table public.notification_prefs add column if not exists comment boolean not null default true;
