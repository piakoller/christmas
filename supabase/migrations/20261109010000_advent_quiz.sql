-- Adventskalender als Foto-Quiz: Jeden Tag ein Familienfoto, alle raten das Jahr.
-- Fotos und Jahre bleiben verborgen: ein Foto erst ab seinem Tag, das Jahr erst nach dem eigenen Tipp.
-- Im Supabase SQL Editor ausführen. Kann gefahrlos mehrfach ausgeführt werden.

-- Fotos (gibt es schon aus der ersten Migration) um Jahr und Originalnamen ergänzen
alter table public.advent_photos add column if not exists year int;
alter table public.advent_photos add column if not exists source_name text;
create unique index if not exists advent_photos_source_idx on public.advent_photos (source_name);

-- Fotos sind NICHT mehr direkt lesbar (sonst wäre das Jahr sichtbar) – nur über die Funktionen unten
drop policy if exists "photos lesen" on public.advent_photos;
drop policy if exists "photos admins" on public.advent_photos;

-- Welches Foto hinter welchem Türchen steckt (pro Saison einmal ausgelost)
create table if not exists public.advent_doors (
    season   int  not null,
    day      int  not null check (day between 1 and 24),
    photo_id uuid not null references public.advent_photos (id) on delete cascade,
    primary key (season, day)
);
alter table public.advent_doors enable row level security;   -- keine Regeln: nur über Funktionen

-- Tipps: jede Person einmal pro Türchen
create table if not exists public.advent_guesses (
    season     int  not null,
    day        int  not null check (day between 1 and 24),
    person     text not null references public.profiles (name),
    guess      int  not null check (guess between 1950 and 2100),
    created_at timestamptz not null default now(),
    primary key (season, day, person)
);
alter table public.advent_guesses enable row level security;
drop policy if exists "tipps eigene lesen" on public.advent_guesses;
create policy "tipps eigene lesen" on public.advent_guesses for select to authenticated using (person = public.me());

-- "Heute" in der Schweiz. Zum Testen kann ein Datum gesetzt werden:
--   insert into private.config values ('advent_test_date', '2026-12-05') on conflict (key) do update set value = excluded.value;
--   delete from private.config where key = 'advent_test_date';   -- danach wieder entfernen!
create or replace function private.advent_today() returns date
language sql stable security definer set search_path = private as $$
    select coalesce((select value::date from private.config where key = 'advent_test_date'),
                    (now() at time zone 'Europe/Zurich')::date)
$$;

create or replace function private.advent_points(guess int, year int) returns int
language sql immutable as $$
    select case abs(guess - year) when 0 then 5 when 1 then 3 when 2 then 1 else 0 end
$$;

-- Der Kalender aus Sicht der angemeldeten Person
create or replace function public.advent_calendar(p_season int)
returns table (day int, is_open boolean, photo_path text, my_guess int, year int, caption text, points int)
language sql stable security definer set search_path = public, private as $$
    with t as (select private.advent_today() as today)
    select d.day,
           t.today >= make_date(p_season, 12, d.day) as is_open,
           case when t.today >= make_date(p_season, 12, d.day) then p.path end,
           g.guess,
           case when g.guess is not null or t.today > make_date(p_season, 12, 24) then p.year end,
           case when g.guess is not null or t.today > make_date(p_season, 12, 24) then p.caption end,
           case when g.guess is not null then private.advent_points(g.guess, p.year) end
    from generate_series(1, 24) as d(day)
    cross join t
    left join public.advent_doors ad on ad.season = p_season and ad.day = d.day
    left join public.advent_photos p on p.id = ad.photo_id
    left join public.advent_guesses g on g.season = p_season and g.day = d.day and g.person = public.me()
    where public.me() is not null
    order by d.day
$$;
grant execute on function public.advent_calendar(int) to authenticated;

-- Einen Tipp abgeben (einmal pro Türchen, nur wenn es offen ist)
create or replace function public.advent_guess(p_season int, p_day int, p_guess int) returns void
language plpgsql security definer set search_path = public, private as $$
begin
    if public.me() is null or public.is_family_account(public.me()) then
        raise exception 'Nur Personen können mitraten';
    end if;
    if private.advent_today() < make_date(p_season, 12, p_day) then
        raise exception 'Dieses Türchen ist noch zu';
    end if;
    if private.advent_today() > make_date(p_season, 12, 24) then
        raise exception 'Das Quiz ist vorbei';
    end if;
    if not exists (select 1 from public.advent_doors where season = p_season and day = p_day) then
        raise exception 'Hinter diesem Türchen ist noch kein Foto';
    end if;
    insert into public.advent_guesses (season, day, person, guess) values (p_season, p_day, public.me(), p_guess);
exception when unique_violation then
    raise exception 'Du hast für dieses Türchen schon getippt';
end $$;
grant execute on function public.advent_guess(int, int, int) to authenticated;

-- Rangliste (zeigt nur Punkte, keine Jahre)
create or replace function public.advent_leaderboard(p_season int)
returns table (person text, points int, guesses int)
language sql stable security definer set search_path = public, private as $$
    select pr.name,
           coalesce(sum(private.advent_points(g.guess, p.year)), 0)::int,
           count(g.guess)::int
    from public.profiles pr
    left join public.advent_guesses g on g.person = pr.name and g.season = p_season
    left join public.advent_doors ad on ad.season = g.season and ad.day = g.day
    left join public.advent_photos p on p.id = ad.photo_id
    where not pr.is_group and not pr.is_family_account and public.me() is not null
    group by pr.name, pr.sort_order
    order by 2 desc, pr.sort_order
$$;
grant execute on function public.advent_leaderboard(int) to authenticated;

-- Speicher: Adventsfotos nur sichtbar, wenn ihr Türchen offen ist (Hochladen nur per Skript)
create or replace function public.advent_photo_visible(object_name text) returns boolean
language sql stable security definer set search_path = public, private as $$
    select exists (
        select 1 from public.advent_doors ad
        join public.advent_photos p on p.id = ad.photo_id
        where p.path = object_name and private.advent_today() >= make_date(ad.season, 12, ad.day)
    )
$$;

drop policy if exists "bilder lesen" on storage.objects;
drop policy if exists "wunschbilder lesen" on storage.objects;
create policy "wunschbilder lesen" on storage.objects for select to authenticated
    using (bucket_id = 'wish-images');
drop policy if exists "adventsfotos lesen" on storage.objects;
create policy "adventsfotos lesen" on storage.objects for select to authenticated
    using (bucket_id = 'advent-photos' and public.advent_photo_visible(name));
drop policy if exists "adventsfotos admins" on storage.objects;
