"""AeroBoard local server — zero dependencies (standard library only).

Serves the web UI and a /api/flights JSON endpoint backed by data.py. Run this
on your Mac for browser dev now, and on the Raspberry Pi later (with Chromium in
kiosk mode pointed at it) to drive the OLED. Same code both places.

    python3 -m aeroboard.server            # then open http://localhost:8000
    python3 -m aeroboard.server 8080       # custom port
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import config
from .data import compass, get_snapshot

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def _flight_dict(ac) -> dict:
    return {
        "hex": ac.hex,
        "label": ac.label,
        "reg": ac.reg,
        "type": ac.type,
        "alt_ft": None if ac.alt_ft is None else round(ac.alt_ft),
        "on_ground": ac.on_ground,
        "gs_kt": None if ac.gs_kt is None else round(ac.gs_kt),
        "track": None if ac.track is None else round(ac.track),
        "vrate_fpm": None if ac.vrate_fpm is None else round(ac.vrate_fpm),
        "squawk": ac.squawk,
        "distance_nm": round(ac.distance_nm, 1),
        "bearing": round(ac.bearing, 1),
        "compass": compass(ac.bearing) if ac.distance_nm else "",
        "tag": ac.tag,
        "visible": ac.visible,
    }


def _snapshot_json() -> bytes:
    snap = get_snapshot()
    body = {
        "flights": [_flight_dict(a) for a in snap.flights],
        "counts": snap.counts,
        "source": snap.source,
        "error": snap.error,
        "tracking": len(snap.flights),
        "radius_nm": config.RADIUS_NM,
        "airport": "GEG",
    }
    return json.dumps(body).encode()


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/flights":
            try:
                self._send(200, _snapshot_json(), "application/json")
            except Exception as exc:  # noqa: BLE001
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
            return
        if path in ("/", "/index.html"):
            html = (WEB_DIR / "index.html").read_bytes()
            self._send(200, html, "text/html; charset=utf-8")
            return
        # any other static asset under web/
        target = (WEB_DIR / path.lstrip("/")).resolve()
        if str(target).startswith(str(WEB_DIR)) and target.is_file():
            ctype = "text/javascript" if target.suffix == ".js" else "text/plain"
            self._send(200, target.read_bytes(), ctype)
            return
        self._send(404, b"not found", "text/plain")

    def log_message(self, *args):  # quiet
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"AeroBoard → http://localhost:{port}   (Ctrl-C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
