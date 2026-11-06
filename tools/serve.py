"""Lokaler Webserver für die App (ohne Zwischenspeichern, damit Änderungen sofort sichtbar sind).

    conda activate weihnachten
    python tools/serve.py            # http://localhost:8520
    python tools/serve.py 9000       # anderer Port
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8520
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(NoCacheHandler, directory=str(WEB)))
    print(f"Weihnachts-App läuft auf http://localhost:{port}  (Beenden mit Strg+C)")
    server.serve_forever()


if __name__ == "__main__":
    main()
