# 🎄 Weihnachten – Familien-Planungsseite

Wunschliste, Essensplanung, Anwesenheit und Adventskalender für die Familie.
Gebaut mit Streamlit, Daten in Supabase, gehostet auf Streamlit Community Cloud.

Jedes Jahr startet automatisch frisch (ab Februar gilt das neue Jahr); alte Jahre bleiben in Supabase erhalten.

## 1. Supabase einrichten (einmalig)

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen.
2. Im Dashboard **SQL Editor** öffnen, den Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und ausführen.
3. Zugangsdaten notieren:
   - **URL**: *Connect* oben im Projekt oder *Project Settings → Data API* (`https://xyz.supabase.co`)
   - **Secret key**: *Project Settings → API Keys* (`sb_secret_…`, bzw. Legacy `service_role`).
     Nicht den *publishable/anon* Key verwenden.

## 2. Secrets vorbereiten

[`.streamlit/secrets.toml.example`](.streamlit/secrets.toml.example) kopieren und ausfüllen
(Supabase-URL, Secret key und ein Passwort pro Person). Diese Datei enthält Geheimnisse und
darf **nie** ins Git-Repository.

## 3. Auf Streamlit Community Cloud

1. In [share.streamlit.io](https://share.streamlit.io) die App öffnen → **⋮ → Settings → Secrets**.
2. Den ausgefüllten Inhalt aus Schritt 2 einfügen und speichern. Die App startet danach neu.

Jeder Push auf den Branch `main` wird automatisch neu veröffentlicht.

## Adventskalender ein-/ausschalten

Der Adventskalender ist standardmäßig **ausgeschaltet** (Kachel, Menüpunkt und Link sind ausgeblendet).
Zum Einschalten in den Secrets ergänzen bzw. ändern:

```toml
[features]
advent_calendar = true
```

Dafür ist keine Code-Änderung nötig.

## Daten aus Firebase übernehmen (optional)

In der Firebase Console unter *Realtime Database → ⋮ → JSON exportieren* den Export herunterladen, dann:

```bash
python supabase/migrate_firebase_export.py firebase-export.json
```

Daten, die direkt unter `wishes`/`planning` lagen, landen im Jahr 2025.

## Lokal starten

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Mit `.streamlit/secrets.toml` wird Supabase genutzt; ohne Supabase-Eintrag speichert die App in lokalen JSON-Dateien.

## Fotos für den Adventskalender

Fotos liegen in `images/` und heißen nach dem Jahr (z. B. `2025.jpg`, zweites Foto `2025-2.jpg`).
Die Bildunterschriften stehen in `streamlit_app.py` im Dictionary `year_captions`.
