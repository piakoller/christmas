"""Übernimmt die Daten der alten Streamlit-App (Tabelle app_data) in die neuen Tabellen.

    conda activate weihnachten
    python supabase/migrate_app_data.py                 # Probelauf: zeigt nur, was passieren würde
    python supabase/migrate_app_data.py --apply         # schreibt wirklich

Zugangsdaten: Umgebungsvariablen SUPABASE_URL und SUPABASE_SERVICE_KEY, oder die Datei
.streamlit/secrets.toml ([supabase] url/key) im Projektordner. Der Service-Key bleibt lokal.
Optional: --season 2026 (Standard: aktuelle Saison).

Die alten Daten in app_data bleiben unverändert. Mehrfaches Ausführen überschreibt
gleiche Einträge (gleiche IDs), legt also nichts doppelt an.
PINs werden NICHT übernommen: alle legen in der App einmal neu ihre PIN an.
"""
import argparse
import base64
import datetime as dt
import os
import sys
import tomllib
import uuid
from pathlib import Path

from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
CATEGORIES = {"Vorspeise", "Hauptspeise", "Nachspeise", "Snacks"}


def season_now() -> int:
    today = dt.date.today()
    return today.year - 1 if today.month == 1 else today.year


def credentials():
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    if url and key:
        return url, key
    secrets = ROOT / ".streamlit" / "secrets.toml"
    if not secrets.exists():
        sys.exit("Keine Zugangsdaten: SUPABASE_URL/SUPABASE_SERVICE_KEY setzen oder .streamlit/secrets.toml anlegen.")
    cfg = tomllib.loads(secrets.read_text(encoding="utf-8"))["supabase"]
    from urllib.parse import urlsplit
    parts = urlsplit(cfg["url"].strip() if "://" in cfg["url"] else "https://" + cfg["url"].strip())
    return f"{parts.scheme}://{parts.netloc}", cfg["key"].strip()


def as_uuid(value) -> str:
    """Alte IDs sind uuid4-Strings; alles andere bekommt eine stabile neue UUID."""
    try:
        return str(uuid.UUID(str(value)))
    except ValueError:
        return str(uuid.uuid5(uuid.NAMESPACE_URL, f"weihnachten:{value}"))


def price(value) -> float:
    try:
        return max(0.0, round(float(value or 0), 2))
    except (TypeError, ValueError):
        return 0.0


class Migration:
    def __init__(self, client, season: int, apply: bool):
        self.db, self.season, self.apply = client, season, apply
        self.people = {p["name"] for p in client.table("profiles").select("name").execute().data}
        self.counts: dict[str, int] = {}
        self.problems: list[str] = []

    def load(self, key):
        rows = self.db.table("app_data").select("data").eq("season", self.season).eq("key", key).execute().data
        return rows[0]["data"] if rows else None

    def write(self, table, rows, conflict):
        rows = [r for r in rows if r]
        self.counts[table] = self.counts.get(table, 0) + len(rows)
        if self.apply and rows:
            self.db.table(table).upsert(rows, on_conflict=conflict).execute()

    def person(self, name, what):
        if name in self.people:
            return name
        if name:
            self.problems.append(f"{what}: unbekannte Person '{name}' – übersprungen")
        return None

    # ---------------- Wunschliste ----------------
    def upload_images(self, owner, images):
        paths = []
        for img in images or []:
            data = img.get("data") if isinstance(img, dict) else None
            if not data:
                continue
            path = f"{owner}/{uuid.uuid4()}.jpg"
            if self.apply:
                self.db.storage.from_("wish-images").upload(path, base64.b64decode(data), {"content-type": "image/jpeg"})
            paths.append(path)
        self.counts["bilder"] = self.counts.get("bilder", 0) + len(paths)
        return paths

    def wishes(self):
        items = self.load("wishes") or []
        if isinstance(items, dict):
            items = list(items.values())
        wishes, suggestions, purchases = [], [], []
        for item in items:
            item_id = as_uuid(item.get("id") or uuid.uuid4())
            if item.get("type") == "suggestion":
                by = self.person(item.get("suggested_by"), "Vorschlag")
                for_ = self.person(item.get("suggested_for"), "Vorschlag")
                if not by or not for_ or by == for_ or not (item.get("wish_name") or "").strip():
                    continue
                suggestions.append({
                    "id": item_id, "season": self.season, "suggested_by": by, "suggested_for": for_,
                    "name": item["wish_name"].strip(), "description": item.get("description") or "",
                    "link": item.get("link") or "", "price": price(item.get("price")),
                    "created_at": item.get("created_at") or dt.datetime.now().isoformat(),
                })
                kind = "suggestion"
            else:
                owner = self.person(item.get("owner_user"), "Wunsch")
                if not owner or not (item.get("wish_name") or "").strip():
                    continue
                expert = item.get("responsible_person")
                expert = expert if expert in self.people and expert != owner else None
                wishes.append({
                    "id": item_id, "season": self.season, "owner": owner, "name": item["wish_name"].strip(),
                    "description": item.get("description") or "", "link": item.get("link") or "",
                    "price": price(item.get("price")), "buy_self": bool(item.get("buy_self")), "expert": expert,
                    "image_paths": self.upload_images(owner, item.get("images")),
                })
                kind = "wish"
            claimer = item.get("claimed_by")
            if claimer and claimer in self.people:
                purchases.append({
                    "item_id": item_id, "item_kind": kind, "claimed_by": claimer,
                    "purchased": bool(item.get("purchased")),
                    "actual_price": price(item["actual_price"]) if item.get("actual_price") is not None else None,
                    "reimbursed": bool(item.get("reimbursed")),
                    # werden per Trigger aus dem Geschenk übernommen:
                    "season": self.season, "recipient": claimer, "item_name": "",
                })
        self.write("wishes", wishes, "id")
        self.write("suggestions", suggestions, "id")
        # Käufe einzeln, damit eine unzulässige Kombination nicht alles abbricht
        for p in purchases:
            try:
                self.write("purchases", [p], "item_id")
            except Exception as e:  # noqa: BLE001
                self.problems.append(f"Kauf {p['item_id']} von {p['claimed_by']}: {e}")

    # ---------------- Planung ----------------
    def planning(self):
        plan = self.load("planning") or {}
        dishes, votes, schedule = [], [], []
        known = set()
        for d in plan.get("meal_proposals") or []:
            name = (d.get("name") or "").strip()
            by = self.person(d.get("proposed_by"), "Gericht")
            if not name or not by:
                continue
            dish_id = as_uuid(d.get("id"))
            known.add(dish_id)
            responsible = d.get("responsible") if d.get("responsible") in self.people else None
            dishes.append({
                "id": dish_id, "season": self.season, "name": name,
                "category": d.get("category") if d.get("category") in CATEGORIES else "Hauptspeise",
                "description": d.get("description") or "", "proposed_by": by, "responsible": responsible,
                "created_at": d.get("created_at") or dt.datetime.now().isoformat(),
            })
            for voter in d.get("votes") or []:
                if voter in self.people:
                    votes.append({"dish_id": dish_id, "voter": voter})
        for day, cats in (plan.get("day_assignments") or {}).items():
            if not isinstance(cats, dict):
                continue
            for cat, ids in cats.items():
                for dish_id in ids or []:
                    dish_id = as_uuid(dish_id)
                    if cat in CATEGORIES and dish_id in known:
                        schedule.append({"season": self.season, "day": day, "category": cat, "dish_id": dish_id})
        attendance = []
        for person, entry in (plan.get("attendance") or {}).items():
            if not self.person(person, "Anwesenheit"):
                continue
            days = {}
            for day, info in (entry.get("days") or {}).items():
                status = "present" if info.get("present") else "unsure" if info.get("unsure") else "absent"
                days[day] = {"status": status, "with_partner": bool(info.get("with_partner")),
                             "overnight": bool(info.get("overnight"))}
            attendance.append({"season": self.season, "person": person, "days": days, "notes": entry.get("notes") or ""})
        opened = [{"season": self.season, "person": p, "day": int(d)}
                  for p, ds in (plan.get("advent_doors") or {}).items() if p in self.people
                  for d in ds or [] if 1 <= int(d) <= 24]
        comments = [{"id": as_uuid(f"{day}-{c.get('user')}-{c.get('timestamp')}"), "season": self.season,
                     "day": int(day), "author": c["user"], "text": (c.get("text") or "")[:500],
                     "created_at": c.get("timestamp") or dt.datetime.now().isoformat()}
                    for day, cs in (plan.get("advent_comments") or {}).items()
                    for c in cs or [] if c.get("user") in self.people and (c.get("text") or "").strip()]
        self.write("dishes", dishes, "id")
        self.write("dish_votes", votes, "dish_id,voter")
        self.write("meal_schedule", schedule, "day,category,dish_id")
        self.write("attendance", attendance, "season,person")
        self.write("advent_opened", opened, "season,person,day")
        self.write("advent_comments", comments, "id")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="wirklich schreiben (sonst nur Probelauf)")
    parser.add_argument("--season", type=int, default=season_now())
    args = parser.parse_args()

    url, key = credentials()
    m = Migration(create_client(url, key), args.season, args.apply)
    m.wishes()
    m.planning()

    print(f"{'Übernommen' if args.apply else 'Probelauf – würde übernehmen'} (Saison {args.season}, {url}):")
    for table, n in m.counts.items():
        print(f"  {table:16} {n}")
    for p in m.problems:
        print("  Hinweis:", p)
    if not args.apply:
        print("\nZum wirklichen Übernehmen mit --apply erneut ausführen.")


if __name__ == "__main__":
    main()
