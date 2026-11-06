-- Supabase-Setup für die Weihnachts-Wunschliste.
-- Einmal im Supabase-Dashboard unter "SQL Editor" ausführen.
--
-- Jede Saison (Jahr) hat eigene Zeilen, dadurch bleiben alte Jahre als Archiv erhalten:
--   season = 2026, key = 'wishes'   -> Liste aller Wünsche und Vorschläge
--   season = 2026, key = 'planning' -> Essensplanung, Anwesenheit, Adventskalender

create table if not exists public.app_data (
    season     integer     not null,
    key        text        not null,
    data       jsonb       not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    primary key (season, key)
);

-- Row Level Security ohne Policies: Zugriff nur mit dem geheimen Server-Key
-- (service_role / secret key), den nur die Streamlit-App kennt.
-- Mit dem öffentlichen anon/publishable Key ist die Tabelle nicht lesbar.
alter table public.app_data enable row level security;
