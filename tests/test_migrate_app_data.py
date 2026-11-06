"""Tests für die Datenübernahme aus der alten Streamlit-App (ohne echte Datenbank)."""
import base64
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "migrate_app_data", Path(__file__).resolve().parent.parent / "supabase" / "migrate_app_data.py")
migrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrate)

PEOPLE = ["Dieter", "Gudrun", "Lukas", "Pia", "Emmy", "Tim", "W11"]
WISH_ID = "11111111-1111-4111-8111-111111111111"
SUGG_ID = "22222222-2222-4222-8222-222222222222"
DISH_ID = "33333333-3333-4333-8333-333333333333"

OLD_WISHES = [
    {"id": WISH_ID, "owner_user": "Pia", "wish_name": "Buch", "description": "Krimi", "link": "x.de",
     "price": 25, "buy_self": False, "others_can_buy": True, "responsible_person": "Dieter",
     "images": [{"data": base64.b64encode(b"jpegdata").decode(), "type": "image/jpeg"}],
     "claimed_by": "Gudrun", "purchased": True, "actual_price": 23.5, "reimbursed": True},
    {"id": SUGG_ID, "type": "suggestion", "suggested_by": "Tim", "suggested_for": "Emmy",
     "wish_name": "Schal", "description": "blau", "price": "12.5", "claimed_by": None},
    {"id": "kein-uuid", "owner_user": "Unbekannt", "wish_name": "Weg damit"},
]
OLD_PLANNING = {
    "meal_proposals": [{"id": DISH_ID, "name": "Raclette", "category": "Hauptspeise", "proposed_by": "Pia",
                        "responsible": "Lukas", "votes": ["Pia", "Tim", "Fremd"]}],
    "day_assignments": {"2026-12-24": {"Hauptspeise": [DISH_ID, "gelöschtes-gericht"]}},
    "attendance": {"Pia": {"days": {"2026-12-24": {"present": True, "unsure": False, "with_partner": True, "overnight": False},
                                     "2026-12-25": {"present": False, "unsure": True}}, "notes": "vegetarisch"}},
    "advent_doors": {"Pia": [1, 2]},
    "advent_comments": {"1": [{"user": "Pia", "text": "Schön!", "timestamp": "2026-12-01T10:00:00"}]},
}


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, {}

    def select(self, *_):
        return self

    def eq(self, col, value):
        self.filters[col] = value
        return self

    def upsert(self, rows, on_conflict=None):
        self.db.written.setdefault(self.table, []).extend(rows)
        return self

    def execute(self):
        class R:
            pass
        r = R()
        if self.table == "profiles":
            r.data = [{"name": n} for n in PEOPLE]
        elif self.table == "app_data":
            data = {"wishes": OLD_WISHES, "planning": OLD_PLANNING}.get(self.filters.get("key"))
            r.data = [{"data": data}] if data is not None else []
        else:
            r.data = []
        return r


class Bucket:
    def __init__(self, db):
        self.db = db

    def upload(self, path, data, opts):
        self.db.uploads.append((path, data))


class Storage:
    def __init__(self, db):
        self.db = db

    def from_(self, _bucket):
        return Bucket(self.db)


class FakeDb:
    def __init__(self):
        self.written, self.uploads = {}, []
        self.storage = Storage(self)

    def table(self, name):
        return Query(self, name)


def run(apply):
    db = FakeDb()
    m = migrate.Migration(db, 2026, apply)
    m.wishes()
    m.planning()
    return db, m


def test_dry_run_writes_nothing():
    db, m = run(apply=False)
    assert db.written == {} and db.uploads == []
    assert m.counts["wishes"] == 1 and m.counts["suggestions"] == 1


def test_wishes_suggestions_purchases():
    db, m = run(apply=True)
    wish = db.written["wishes"][0]
    assert wish["id"] == WISH_ID and wish["owner"] == "Pia" and wish["expert"] == "Dieter"
    assert wish["image_paths"] and wish["image_paths"][0].startswith("Pia/")
    assert db.uploads[0][1] == b"jpegdata"
    sugg = db.written["suggestions"][0]
    assert sugg["suggested_for"] == "Emmy" and sugg["price"] == 12.5
    purchase = db.written["purchases"][0]
    assert purchase["claimed_by"] == "Gudrun" and purchase["purchased"] and purchase["actual_price"] == 23.5
    assert purchase["reimbursed"] is True
    assert any("Unbekannt" in p for p in m.problems)


def test_planning():
    db, _ = run(apply=True)
    assert db.written["dishes"][0]["responsible"] == "Lukas"
    assert {v["voter"] for v in db.written["dish_votes"]} == {"Pia", "Tim"}
    assert db.written["meal_schedule"] == [{"season": 2026, "day": "2026-12-24", "category": "Hauptspeise", "dish_id": DISH_ID}]
    days = db.written["attendance"][0]["days"]
    assert days["2026-12-24"] == {"status": "present", "with_partner": True, "overnight": False}
    assert days["2026-12-25"]["status"] == "unsure"
    assert len(db.written["advent_opened"]) == 2
    assert db.written["advent_comments"][0]["text"] == "Schön!"
