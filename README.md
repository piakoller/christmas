# 🎄 Weihnachten – die Familien-App

Wunschliste, geheime Geschenkvorschläge, Essensplanung und „Wer kommt wann?“ für die Familie.
Eine installierbare Web-App (PWA) mit Push-Nachrichten, gehostet auf **GitHub Pages**, Daten in **Supabase**.

**Adresse:** https://piakoller.github.io/christmas/

## Für die Familie: App aufs Handy holen

1. Die Adresse oben im Handy-Browser öffnen.
2. Installieren:
   - **iPhone/iPad (Safari):** unten auf **Teilen** (□↑) → **„Zum Home-Bildschirm“** → Hinzufügen.
     Danach die App **über das neue Symbol** öffnen (nur so funktionieren Benachrichtigungen).
   - **Android (Chrome):** Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“.
3. Auf den eigenen Namen tippen. Beim ersten Mal den **Familien-Code** eingeben und eine eigene PIN (4–8 Ziffern) wählen.
4. Unter **Einstellungen → Benachrichtigungen** die Nachrichten auf diesem Gerät einschalten und wählen, wofür man benachrichtigt werden möchte.

PIN vergessen? Pia setzt sie unter Einstellungen → Verwaltung zurück.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `web/` | Die App (HTML/CSS/JavaScript, kein Build-Schritt). Einstellungen in `web/config.js`. |
| `supabase/migrations/` | Datenbank: Tabellen, Zugriffsregeln (RLS), Login-Trigger, Speicher |
| `supabase/functions/notify/` | Edge Function, die die Push-Nachrichten verschickt |
| `supabase/migrate_app_data.py` | Übernahme von Daten aus der alten Streamlit-App (Tabelle `app_data`) |
| `tools/` | Lokaler Webserver, Icons und Push-Schlüssel erzeugen |
| `tests/` | Tests (`pytest`) |
| `images/` | Fotos für den Adventskalender (werden noch in den privaten Speicher verschoben) |
| `.github/workflows/pages.yml` | Veröffentlicht `web/` bei jedem Push auf `main` |

Wer was sehen darf, regelt die Datenbank selbst: Käufe für dich und geheime Vorschläge für dich
sind für dich unsichtbar, auch wenn man die App umgeht.

## Entwicklung

Alles Nötige steckt im Conda-Environment `weihnachten`:

```bash
conda env create -f environment.yml
```
```bash
conda activate weihnachten
```
```bash
python tools/serve.py
```

Dann http://localhost:8520 öffnen. Tests: `python -m pytest tests`.

## Einrichtung (einmalig, schon erledigt)

1. **Supabase**
   - SQL Editor: `supabase/migrations/20261106000000_app.sql` ausführen (kann mehrfach laufen).
   - Familien-Code setzen:
     ```sql
     insert into private.config (key, value) values ('family_code', 'EUER-CODE')
     on conflict (key) do update set value = excluded.value;
     ```
   - Authentication → Email: **„Confirm email“ ausschalten**.
2. **Push-Nachrichten**
   - `python tools/make_vapid.py` erzeugt `.vapid.json` (nicht im Git!). Den öffentlichen Schlüssel in `web/config.js` eintragen.
   - `npx supabase@2 login`, dann
     `npx supabase@2 functions deploy notify --project-ref <REF> --use-api` und die Secrets
     `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` mit `npx supabase@2 secrets set` setzen.
3. **GitHub Pages:** Repository → Settings → Pages → Source: **GitHub Actions**.

## Neues Jahr

Nichts zu tun: Ab Februar plant die App automatisch das nächste Weihnachten (Spalte `season`);
die Daten früherer Jahre bleiben erhalten.
