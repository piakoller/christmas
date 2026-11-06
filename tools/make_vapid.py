"""Erzeugt das Schlüsselpaar (VAPID) für Push-Nachrichten.

    conda activate weihnachten
    python tools/make_vapid.py

Schreibt die Schlüssel in .vapid.json (wird NICHT committet). Danach:
  - publicKey  -> web/config.js (vapidPublicKey) – darf öffentlich sein
  - privateKey -> Supabase Secret VAPID_PRIVATE_KEY – geheim halten!
Ein vorhandenes .vapid.json wird nicht überschrieben (sonst müssten sich alle Geräte neu anmelden).
"""
import base64
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

OUT = Path(__file__).resolve().parent.parent / ".vapid.json"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def main():
    if OUT.exists() and "--force" not in sys.argv:
        print(f"{OUT.name} existiert schon. Öffentlicher Schlüssel:")
        print(json.loads(OUT.read_text())["publicKey"])
        return
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    OUT.write_text(json.dumps({"publicKey": b64url(public), "privateKey": b64url(private)}, indent=2))
    print(f"Schlüssel gespeichert in {OUT}")
    print("Öffentlicher Schlüssel (für web/config.js):")
    print(b64url(public))


if __name__ == "__main__":
    main()
