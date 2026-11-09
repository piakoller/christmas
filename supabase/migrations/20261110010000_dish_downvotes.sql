-- Gerichte mit 👍 oder 👎 bewerten (eine Stimme pro Person und Gericht).
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

-- Bisherige Stimmen sind alle 👍 (= 1)
alter table public.dish_votes add column if not exists value smallint not null default 1;
alter table public.dish_votes drop constraint if exists dish_votes_value_check;
alter table public.dish_votes add constraint dish_votes_value_check check (value in (1, -1));

-- Eigene Stimme von 👍 auf 👎 (oder umgekehrt) umstellen
drop policy if exists "votes ändern" on public.dish_votes;
create policy "votes ändern" on public.dish_votes for update to authenticated
    using (voter = public.me()) with check (voter = public.me());
