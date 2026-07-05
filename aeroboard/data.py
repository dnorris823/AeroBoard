"""AeroBoard data layer.

Pulls live aircraft near GEG from a free ADS-B API, normalizes the fields we
care about, computes distance/bearing from home, and tags each aircraft
(APPROACH / DEPARTURE / OVERFLIGHT / GA / ...). Standard library only, so this
part runs anywhere with no pip installs.
"""

from __future__ import annotations

import json
import math
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Optional

from . import config, routes, settings


# --------------------------------------------------------------------------- #
# geometry
# --------------------------------------------------------------------------- #
_EARTH_NM = 3440.065  # Earth radius in nautical miles


def haversine_nm(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return _EARTH_NM * 2 * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2) -> float:
    """Initial great-circle bearing from point 1 to point 2, degrees true."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


_COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def compass(bearing: float) -> str:
    return _COMPASS[int((bearing + 22.5) % 360 // 45)]


# --------------------------------------------------------------------------- #
# model
# --------------------------------------------------------------------------- #
@dataclass
class Aircraft:
    hex: str
    callsign: str
    reg: Optional[str]
    type: Optional[str]
    alt_ft: Optional[float]        # None if unknown, "ground" -> 0 with on_ground
    on_ground: bool
    gs_kt: Optional[float]
    track: Optional[float]
    vrate_fpm: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    squawk: Optional[str]
    category: Optional[str]
    distance_nm: float = 0.0
    bearing: float = 0.0
    tag: str = "TRANSIT"
    visible: bool = False
    origin: Optional[str] = None
    dest: Optional[str] = None
    origin_city: Optional[str] = None
    dest_city: Optional[str] = None

    @property
    def label(self) -> str:
        return (self.callsign or self.reg or self.hex or "??").strip()


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def classify(ac: Aircraft, visible_alt=None, overflight_alt=None) -> str:
    visible_alt = config.VISIBLE_ALT_FT if visible_alt is None else visible_alt
    overflight_alt = config.OVERFLIGHT_ALT_FT if overflight_alt is None else overflight_alt
    if ac.on_ground:
        return "GROUND"
    alt = ac.alt_ft
    if alt is None:
        return "TRANSIT"
    if alt >= overflight_alt:
        return "OVERFLIGHT"
    if alt <= visible_alt:
        vr = ac.vrate_fpm or 0
        if vr <= config.DESCENT_FPM:
            return "APPROACH"
        if vr >= config.CLIMB_FPM:
            return "DEPARTURE"
        # slow + light + low reads as general aviation / pattern work
        if (ac.gs_kt or 999) < 160 and (ac.category in (None, "A1") or (alt <= 5000)):
            return "GA"
        return "LOW"
    return "TRANSIT"


# --------------------------------------------------------------------------- #
# fetch
# --------------------------------------------------------------------------- #
def _fetch_raw(lat, lon, radius) -> list[dict]:
    last_err = None
    for tmpl in config.API_ENDPOINTS:
        url = tmpl.format(lat=lat, lon=lon, radius=radius)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
            with urllib.request.urlopen(req, timeout=config.HTTP_TIMEOUT) as resp:
                payload = json.load(resp)
            return payload.get("ac") or payload.get("aircraft") or []
        except Exception as exc:  # noqa: BLE001 - report, then try the fallback
            last_err = exc
            continue
    raise RuntimeError(f"all flight APIs failed: {last_err}")


def _normalize(raw: dict) -> Aircraft:
    alt_raw = raw.get("alt_baro", raw.get("alt_geom"))
    on_ground = alt_raw == "ground"
    alt_ft = 0.0 if on_ground else _num(alt_raw)
    return Aircraft(
        hex=raw.get("hex", ""),
        callsign=(raw.get("flight") or "").strip() or None,
        reg=raw.get("r"),
        type=raw.get("t"),
        alt_ft=alt_ft,
        on_ground=on_ground,
        gs_kt=_num(raw.get("gs")),
        track=_num(raw.get("track")),
        vrate_fpm=_num(raw.get("baro_rate", raw.get("geom_rate"))),
        lat=_num(raw.get("lat")),
        lon=_num(raw.get("lon")),
        squawk=raw.get("squawk"),
        category=raw.get("category"),
    )


@dataclass
class Snapshot:
    flights: list = field(default_factory=list)
    source: str = ""
    fetched_at: float = 0.0
    error: Optional[str] = None

    @property
    def counts(self) -> dict:
        c: dict = {}
        for ac in self.flights:
            c[ac.tag] = c.get(ac.tag, 0) + 1
        return c


def get_snapshot(
    home_lat=None, home_lon=None, radius=None
) -> Snapshot:
    """Fetch, normalize, geo-tag and sort nearby aircraft."""
    s = settings.load()
    home_lat = s["home_lat"] if home_lat is None else home_lat
    home_lon = s["home_lon"] if home_lon is None else home_lon
    radius = s["radius_nm"] if radius is None else radius
    visible_alt = s["visible_alt_ft"]

    try:
        raw = _fetch_raw(config.GEG_LAT, config.GEG_LON, radius)
    except Exception as exc:  # noqa: BLE001
        return Snapshot(error=str(exc), fetched_at=time.time())

    flights: list[Aircraft] = []
    for r in raw:
        ac = _normalize(r)
        if ac.lat is not None and ac.lon is not None:
            ac.distance_nm = haversine_nm(home_lat, home_lon, ac.lat, ac.lon)
            ac.bearing = bearing_deg(home_lat, home_lon, ac.lat, ac.lon)
        ac.visible = ac.alt_ft is not None and ac.alt_ft <= visible_alt
        ac.tag = classify(ac, visible_alt, config.OVERFLIGHT_ALT_FT)
        flights.append(ac)

    # visible/low aircraft first, then nearest.
    flights.sort(key=lambda a: (not a.visible, a.distance_nm))
    routes.enrich(flights)   # attach origin/dest to airline flights (cached)
    return Snapshot(flights=flights, source="airplanes.live", fetched_at=time.time())


if __name__ == "__main__":  # quick manual check
    snap = get_snapshot()
    if snap.error:
        print("ERROR:", snap.error)
    else:
        print(f"{len(snap.flights)} aircraft  counts={snap.counts}")
        for ac in snap.flights[:10]:
            print(
                f"  {ac.label:8} {ac.type or '----':5} "
                f"{(str(int(ac.alt_ft)) + 'ft') if ac.alt_ft is not None else '  --':>8} "
                f"{(str(int(ac.gs_kt)) + 'kt') if ac.gs_kt else '   --':>6} "
                f"{ac.distance_nm:5.1f}nm {compass(ac.bearing):>2} "
                f"{ac.tag}"
            )
