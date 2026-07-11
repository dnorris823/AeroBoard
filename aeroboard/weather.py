"""AeroBoard live weather — the current sky over GEG.

Pulls the KGEG METAR from aviationweather.gov (free, no API key) and boils it
down to one of five states the pixel-art engine knows how to draw:

    clear · overcast · rain · snow · fog

The result is a small dict the engine can render straight into the weather bar
(label / temp / wind / visibility) and use to pick the scene overlay. Standard
library only, and cached so the 10-second board poll never hammers the source.
"""

from __future__ import annotations

import json
import re
import threading
import time
import urllib.request

from . import config

_lock = threading.Lock()
_cache: dict | None = None      # last good reading (may be served stale)
_cache_at: float = 0.0

# How long a METAR reading is considered fresh. METARs update ~hourly (plus
# specials), so a 10-minute cache is plenty and keeps us well-mannered.
TTL_S = 600


def _c_to_f(c):
    try:
        return round(float(c) * 9 / 5 + 32)
    except (TypeError, ValueError):
        return None


def _visib_sm(visib):
    """METAR visibility -> (display string, numeric statute miles or None)."""
    if visib is None:
        return "--", None
    s = str(visib).strip()
    # aviationweather often reports "10+" for 10 or more.
    if s in ("10+", "6+"):
        return s + "SM", float(s.rstrip("+"))
    m = re.match(r"^(\d+)\s+(\d+)/(\d+)$", s)          # e.g. "1 1/2"
    if m:
        val = int(m[1]) + int(m[2]) / int(m[3])
        return s + "SM", val
    m = re.match(r"^(\d+)/(\d+)$", s)                   # e.g. "1/4"
    if m:
        return s + "SM", int(m[1]) / int(m[2])
    try:
        val = float(s)
        disp = (str(int(val)) if val == int(val) else s) + "SM"
        return disp, val
    except ValueError:
        return s, None


def _classify(wx_string: str, clouds, vis_val) -> str:
    """Map raw METAR fields to one of our five drawable weather states."""
    wx = (wx_string or "").upper()
    # Precipitation first — it dominates the look of the scene.
    if "SN" in wx or "SG" in wx or "PL" in wx:
        return "snow"
    if any(p in wx for p in ("RA", "DZ", "SH", "TS", "GR", "GS", "UP")):
        return "rain"
    # Obscuration / low visibility reads as fog.
    if "FG" in wx or "BR" in wx or "FU" in wx or (vis_val is not None and vis_val <= 1.0):
        return "fog"
    # Otherwise let the cloud deck decide.
    covers = {(c.get("cover") or "").upper() for c in (clouds or [])}
    if covers & {"OVC", "BKN", "OVX"}:
        return "overcast"
    return "clear"


def _fetch() -> dict:
    url = config.METAR_URL.format(station=config.METAR_STATION)
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=config.HTTP_TIMEOUT) as resp:
        data = json.load(resp)
    if not data:
        raise RuntimeError("empty METAR response")
    m = data[0]

    vis_disp, vis_val = _visib_sm(m.get("visib"))
    state = _classify(m.get("wxString"), m.get("clouds"), vis_val)

    wdir = m.get("wdir")
    if not isinstance(wdir, (int, float)):   # "VRB" or missing
        wdir = 0
    try:
        wspd = int(round(float(m.get("wspd"))))
    except (TypeError, ValueError):
        wspd = 0

    return {
        "state": state,
        "label": state.upper(),
        "tempF": _c_to_f(m.get("temp")),
        "windDir": int(wdir),
        "windKt": wspd,
        "visSM": vis_disp,
        "station": config.METAR_STATION,
    }


def get_weather() -> dict | None:
    """Current weather over GEG, cached. Returns None if never obtainable."""
    global _cache, _cache_at
    now = time.time()
    with _lock:
        if _cache is not None and (now - _cache_at) < TTL_S:
            return dict(_cache)
    try:
        reading = _fetch()
    except Exception:  # noqa: BLE001 - keep serving the last good reading
        with _lock:
            return dict(_cache) if _cache is not None else None
    with _lock:
        _cache, _cache_at = reading, now
        return dict(reading)


if __name__ == "__main__":  # quick manual check
    w = get_weather()
    print(w if w else "no weather (fetch failed)")
