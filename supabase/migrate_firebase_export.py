"""
Importiert einen Firebase-Realtime-Database-Export (JSON) in Supabase.

So bekommst du den Export: Firebase Console -> Realtime Database -> ⋮ -> "JSON exportieren".

Aufruf (aus dem Projektordner):
    python supabase/migrate_firebase_export.py firebase-export.json

Die Supabase-Zugangsdaten werden aus .streamlit/secrets.toml gelesen ([supabase] url + key).
Zuordnung:
    wishes / planning (Wurzel)        -> Saison 2025 (so war es letztes Jahr gespeichert)
    seasons/<jahr>/wishes / planning  -> Saison <jahr>
Bereits vorhandene Zeilen derselben Saison werden überschrieben (Rückfrage vorher).
"""

import json
import sys
import tomllib
from pathlib import Path

from supabase import create_client

LEGACY_SEASON = 2025
SECRETS_FILE = Path(".streamlit/secrets.toml")


def wishes_as_list(value):
    """Firebase stored wishes as a dict keyed by id; the app now stores a plain list."""
    if isinstance(value, dict):
        return list(value.values())
    return value or []


def collect_rows(export: dict) -> list[dict]:
    rows = []
    if export.get("wishes") is not None:
        rows.append({"season": LEGACY_SEASON, "key": "wishes", "data": wishes_as_list(export["wishes"])})
    if export.get("planning") is not None:
        rows.append({"season": LEGACY_SEASON, "key": "planning", "data": export["planning"]})
    for year, content in (export.get("seasons") or {}).items():
        if content.get("wishes") is not None:
            rows.append({"season": int(year), "key": "wishes", "data": wishes_as_list(content["wishes"])})
        if content.get("planning") is not None:
            rows.append({"season": int(year), "key": "planning", "data": content["planning"]})
    return rows


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    export = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rows = collect_rows(export)
    if not rows:
        sys.exit("Im Export wurden weder 'wishes' noch 'planning' gefunden.")

    for row in rows:
        size = len(row["data"]) if isinstance(row["data"], (list, dict)) else 0
        print(f"  Saison {row['season']}: {row['key']} ({size} Einträge)")
    if input("Diese Daten nach Supabase schreiben? [j/N] ").strip().lower() != "j":
        sys.exit("Abgebrochen.")

    secrets = tomllib.loads(SECRETS_FILE.read_text(encoding="utf-8"))["supabase"]
    client = create_client(secrets["url"], secrets["key"])
    client.table("app_data").upsert(rows).execute()
    print("Fertig.")


if __name__ == "__main__":
    main()
