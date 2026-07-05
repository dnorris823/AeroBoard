"""User settings — persisted to settings.json, layered over config defaults.

The location lives here (not in config.py) so it can be changed from the
Settings page at runtime without editing code. data.py reads these values.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

from . import config

_PATH = Path(__file__).resolve().parent.parent / "settings.json"
_lock = threading.Lock()
_cache: dict | None = None

DEFAULTS = {
    "home_lat": config.HOME_LAT,
    "home_lon": config.HOME_LON,
    "location_label": "GEG (airport)",
    "radius_nm": config.RADIUS_NM,
    "visible_alt_ft": config.VISIBLE_ALT_FT,
}


def load() -> dict:
    global _cache
    if _cache is None:
        merged = dict(DEFAULTS)
        try:
            if _PATH.exists():
                merged.update(json.loads(_PATH.read_text()))
        except Exception:
            pass
        _cache = merged
    return dict(_cache)


def _coerce(patch: dict) -> dict:
    """Validate/clamp incoming values; ignore unknown keys."""
    cur = load()
    out = dict(cur)

    def num(key, lo, hi, cast):
        if key in patch and patch[key] is not None:
            try:
                out[key] = max(lo, min(hi, cast(patch[key])))
            except (TypeError, ValueError):
                pass

    num("home_lat", -90.0, 90.0, float)
    num("home_lon", -180.0, 180.0, float)
    num("radius_nm", 1, 250, int)
    num("visible_alt_ft", 500, 45000, int)
    if "location_label" in patch and patch["location_label"] is not None:
        out["location_label"] = str(patch["location_label"])[:48]
    return out


def save(patch: dict) -> dict:
    global _cache
    out = _coerce(patch)
    with _lock:
        _PATH.write_text(json.dumps(out, indent=2))
        _cache = out
    return dict(out)
