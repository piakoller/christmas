-- Kommentare zu Gerichten (z. B. "Ich bringe den Käse mit").
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

create table if not exists public.dish_comments (
    id         uuid primary key default gen_random_uuid(),
    dish_id    uuid not null references public.dishes (id) on delete cascade,
    author     text not null references public.profiles (name),
    text       text not null check (length(trim(text)) between 1 and 500),
    created_at timestamptz not null default now()
);
create index if not exists dish_comments_dish_idx on public.dish_comments (dish_id);

alter table public.dish_comments enable row level security;

drop policy if exists "kommentare lesen" on public.dish_comments;
create policy "kommentare lesen" on public.dish_comments for select to authenticated using (true);
drop policy if exists "kommentare schreiben" on public.dish_comments;
create policy "kommentare schreiben" on public.dish_comments for insert to authenticated with check (author = public.me());
drop policy if exists "kommentare löschen" on public.dish_comments;
create policy "kommentare löschen" on public.dish_comments for delete to authenticated using (author = public.me());
