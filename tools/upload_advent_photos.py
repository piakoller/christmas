"""Lädt die Fotos für den Adventskalender in den privaten Supabase-Speicher und lost die Türchen aus.

    conda activate weihnachten
    python tools/upload_advent_photos.py                    # Probelauf: zeigt nur, was passieren würde
    python tools/upload_advent_photos.py --apply            # hochladen + Türchen für die aktuelle Saison auslosen
    python tools/upload_advent_photos.py --apply --season 2027

- Fotos aus dem Ordner images/ (oder --dir). Das Jahr kommt aus dem Dateinamen ("2010.jpg",
  "2011-2.jpg") oder, wenn dort keins steht, aus dem Aufnahmedatum im Foto.
- Fotos werden verkleinert (max. 1600 px), richtig gedreht und OHNE Metadaten (z. B. GPS-Ort)
  unter einem zufälligen Namen gespeichert – so verrät nicht einmal der Dateiname das Jahr.
- Schon hochgeladene Fotos (gleicher Dateiname) werden übersprungen.
- Auslosen: die Fotos aus dem neuesten Jahr kommen ans Ende (Türchen 24, 23, …) als Finale,
  der Rest wird zufällig verteilt. Steht eine Saison schon fest, wird sie nicht neu ausgelost.

Zugangsdaten wie bei der Datenübernahme: .streamlit/secrets.toml ([supabase] url/key, Secret Key).
"""
import argparse
import datetime as dt
import io
import random
import re
import sys
import tomllib
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from PIL import Image, ImageOps
from supabase import create_client

ROOT = Path(__file__).resolve().parent.parent
BUCKET = "advent-photos"
MAX_SIDE = 1600

# Sprüche aus der alten App (Schlüssel = Dateiname ohne Endung)
CAPTIONS = {
    "2005": "Mama mit den Mädels",
    "2006": "Emmy's Reaktion auf Omas Geschenk: 'Danke... aber nein danke!'",
    "2007": "Lukas hatte damals schon mehr Style als heute!",
    "2008": "Familien-Orchester in Action - Emmy sorgt für die 'besondere' Note!",
    "2008-2": "Emmy kann nicht warten: Winteroutfit-Test im Wohnzimmer!",
    "2009": "Lukas als Chef am Schneidebrett - hoffentlich nur das Essen!",
    "2009-2": "Emmy als Engel - zumindest optisch! 😇",
    "2010": "Die Mädels rocken Weihnachten - unplugged!",
    "2011": "Hühott! Tim's Freude war SO groß, er vergaß die Hos'!",
    "2011-2": "Neues Ski-Equipment? Ab auf die Couch-Piste!",
    "2012": "Houston, wir haben einen Start: Tim's erster Flug!",
    "2012-2": "Klein-Tim der Handwerker - die Werkbank hat (fast) überlebt! 🔨",
    "2013": "Krisenzeiten 2013: Immerhin eine Rolle pro Person! 🧻",
    "2014": "Daddy war Selfie-König bevor es cool war!",
    "2015": "Es ist Krieg! Das große Nerf-Battle beginnt! 🎯",
    "2016": "Aloha! Weihnachten trifft Hawaii-Style! 🌺",
    "2017": "Tim + Autos = wahre Liebe! Vroom vroom! 🚗",
    "2018": "Endlich! Tim darf auch ins Familien-Orchester!",
    "2019": "Illinois repräsentiert! U-S-A! U-S-A!",
    "2020": "Emmy's skeptischer Blick: 'Daddy, bitte nicht die Finger!'",
    "2021": "Prost auf ein weiteres verrücktes Jahr! 🥂",
    "2022": "Hola desde Business Class - Weihnachten mit Stil! ✈️",
    "2023": "Team Weihnachten bereit zum Anpfiff - äh, Auspacken! ⚽",
    "2024": "Frohe Weihnachten 2024 - Und das Abenteuer geht weiter! 🎄",
    "IMG_0348": "Die Feuerschalen-Tradition ist geboren. Dresscode: Mütze ist Pflicht! 🧣",
    "IMG_0354": "Pistenbereit vom Helm bis zur Hüfte, darunter noch voll im Wohnzimmer-Modus 🩴",
}


def season_now() -> int:
    today = dt.date.today()
    return today.year - 1 if today.month == 1 else today.year


def credentials():
    secrets = ROOT / ".streamlit" / "secrets.toml"
    if not secrets.exists():
        sys.exit("Keine Zugangsdaten: .streamlit/secrets.toml mit [supabase] url/key anlegen.")
    cfg = tomllib.loads(secrets.read_text(encoding="utf-8"))["supabase"]
    url = cfg["url"].strip()
    parts = urlsplit(url if "://" in url else "https://" + url)
    return f"{parts.scheme}://{parts.netloc}", cfg["key"].strip()


def photo_year(path: Path, image: Image.Image):
    match = re.match(r"(\d{4})", path.stem)
    if match:
        return int(match.group(1))
    taken = image.getexif().get_ifd(0x8769).get(36867) or image.getexif().get(306)
    return int(str(taken)[:4]) if taken else None


def prepare(path: Path) -> tuple[bytes, int | None]:
    with Image.open(path) as img:
        year = photo_year(path, img)
        img = ImageOps.exif_transpose(img).convert("RGB")
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, "JPEG", quality=85, optimize=True)  # ohne exif= -> keine Metadaten
        return out.getvalue(), year


def assign(photos: list[dict], season: int) -> dict[int, str]:
    """Türchen -> photo_id. Neuestes Jahr als Finale am Ende, Rest zufällig (fest pro Saison)."""
    newest = max(p["year"] for p in photos)
    finale = sorted([p for p in photos if p["year"] == newest], key=lambda p: p["source_name"])[:24]
    rest = [p for p in photos if p["year"] != newest]
    random.Random(season).shuffle(rest)
    chosen = rest[: 24 - len(finale)] + finale
    if len(chosen) < 24:
        sys.exit(f"Es braucht mindestens 24 Fotos, gefunden: {len(chosen)}")
    return {day: p["id"] for day, p in enumerate(chosen, start=1)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="wirklich hochladen und auslosen")
    parser.add_argument("--season", type=int, default=season_now())
    parser.add_argument("--dir", type=Path, default=ROOT / "images")
    args = parser.parse_args()

    files = sorted(p for p in args.dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    url, key = credentials()
    db = create_client(url, key)
    existing = {r["source_name"]: r for r in db.table("advent_photos").select("id,source_name,year").execute().data if r["source_name"]}

    print(f"{len(files)} Fotos in {args.dir}, {len(existing)} schon hochgeladen.")
    for path in files:
        if path.name in existing:
            continue
        data, year = prepare(path)
        caption = CAPTIONS.get(path.stem, "")
        print(f"  neu: {path.name:16} Jahr {year}  {len(data) // 1024} KB  {caption[:40]}")
        if year is None:
            print(f"    ⚠ kein Jahr erkennbar – übersprungen")
            continue
        if args.apply:
            object_path = f"photos/{uuid.uuid4()}.jpg"
            db.storage.from_(BUCKET).upload(object_path, data, {"content-type": "image/jpeg"})
            row = db.table("advent_photos").insert({
                "path": object_path, "year": year, "year_label": str(year), "caption": caption, "source_name": path.name,
            }).execute().data[0]
            existing[path.name] = row

    doors = db.table("advent_doors").select("day").eq("season", args.season).execute().data
    if doors:
        print(f"Saison {args.season}: Türchen sind schon ausgelost ({len(doors)}) – nichts geändert.")
    elif not args.apply:
        print(f"Saison {args.season}: würde 24 Türchen auslosen (mit --apply).")
    else:
        photos = db.table("advent_photos").select("id,year,source_name").not_.is_("year", "null").execute().data
        mapping = assign(photos, args.season)
        db.table("advent_doors").insert([{"season": args.season, "day": d, "photo_id": pid} for d, pid in mapping.items()]).execute()
        print(f"Saison {args.season}: 24 Türchen ausgelost.")
    if not args.apply:
        print("\nProbelauf – mit --apply wirklich hochladen.")


if __name__ == "__main__":
    main()
