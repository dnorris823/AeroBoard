"""Callsign -> route (origin/destination) lookup via adsbdb.com.

adsbdb is a free, no-key flight-route database. Routes rarely change, so we
cache hard (both hits and misses) to keep refreshes fast and be kind to the API.
Only airline-style callsigns (3 letters + a number, e.g. SWA284) are queried;
GA tail numbers like N738BS have no scheduled route and are skipped.
"""

from __future__ import annotations

import json
import math
import re
import time
import urllib.request

from . import config

_URL = "https://api.adsbdb.com/v0/callsign/{cs}"
_AIRLINE = re.compile(r"^[A-Z]{3}[0-9]")
_TTL_OK = 6 * 3600       # a known route is good for hours
_TTL_MISS = 30 * 60      # re-check unknowns occasionally

# adsbdb keys routes by flight number, and airlines reuse a number across many
# legs, so the route it returns can belong to a *different* leg than the one the
# aircraft is flying now (e.g. SLC->DEN attached to a jet parked at GEG). Before
# trusting a route we check the aircraft's live position against it: reject the
# route if the aircraft sits too far off the direct origin->destination path.
# Bounds are generous so vectoring, holds and weather reroutes still pass.
_EARTH_NM = 3440.065
_CORRIDOR_NM = 100.0         # max cross-track (perpendicular) deviation from path
_ENDPOINT_MARGIN_NM = 100.0  # slack allowed past either endpoint along the path

# callsign -> (route_dict_or_None, expires_at)
_cache: dict[str, tuple] = {}


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _fetch(callsign: str):
    url = _URL.format(cs=callsign)
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=6) as resp:
        payload = json.load(resp)
    r = payload.get("response")
    if not isinstance(r, dict):
        return None
    fr = r.get("flightroute") or {}
    o, d = fr.get("origin") or {}, fr.get("destination") or {}
    if not o.get("iata_code") or not d.get("iata_code"):
        return None
    al = fr.get("airline") or {}
    return {
        "origin": o.get("iata_code"),
        "origin_city": o.get("municipality"),
        "origin_lat": _num(o.get("latitude")),
        "origin_lon": _num(o.get("longitude")),
        "dest": d.get("iata_code"),
        "dest_city": d.get("municipality"),
        "dest_lat": _num(d.get("latitude")),
        "dest_lon": _num(d.get("longitude")),
        # airline identity is tied to the callsign, so it's valid even when the
        # specific leg (origin/dest) can't be verified below.
        "airline_name": al.get("name") or None,
        "airline_iata": al.get("iata") or None,
        "airline_icao": al.get("icao") or None,
        "airline_country": al.get("country_iso") or al.get("country") or None,
    }


# Self-contained great-circle helpers (mirror aeroboard/data.py) so this module
# stays dependency-free apart from config.
def _haversine_nm(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return _EARTH_NM * 2 * math.asin(math.sqrt(a))


def _bearing_rad(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.atan2(y, x)


def _route_consistent(ac, route) -> bool:
    """True if the aircraft's live position is plausibly on `route`.

    Guards against adsbdb returning a stale/other-leg route for a reused flight
    number. When any coordinate is missing we can't verify, so we keep the route
    rather than hide good data.
    """
    o_lat, o_lon = route.get("origin_lat"), route.get("origin_lon")
    d_lat, d_lon = route.get("dest_lat"), route.get("dest_lon")
    if None in (ac.lat, ac.lon, o_lat, o_lon, d_lat, d_lon):
        return True

    d_od = _haversine_nm(o_lat, o_lon, d_lat, d_lon)
    d_op = _haversine_nm(o_lat, o_lon, ac.lat, ac.lon)
    d_dp = _haversine_nm(d_lat, d_lon, ac.lat, ac.lon)

    # Cross-track: perpendicular distance from the great-circle origin->dest path.
    if d_od > 0:
        ang13 = d_op / _EARTH_NM
        dtheta = (_bearing_rad(o_lat, o_lon, ac.lat, ac.lon)
                  - _bearing_rad(o_lat, o_lon, d_lat, d_lon))
        s = max(-1.0, min(1.0, math.sin(ang13) * math.sin(dtheta)))
        if abs(math.asin(s)) * _EARTH_NM > _CORRIDOR_NM:
            return False

    # Along-track: reject positions well beyond either endpoint of the path.
    limit = d_od + _ENDPOINT_MARGIN_NM
    return d_op <= limit and d_dp <= limit


def _cached(callsign: str):
    hit = _cache.get(callsign)
    if hit and time.time() < hit[1]:
        return True, hit[0]
    return False, None


def enrich(flights, budget: int = 6) -> None:
    """Attach .origin/.dest (+cities) to airline flights, in place.

    `budget` caps how many *new* network lookups we do per snapshot; the rest
    fill in on later refreshes as the cache warms. Flights are assumed already
    sorted so the nearest ones get routes first.
    """
    used = 0
    for ac in flights:
        cs = (ac.callsign or "").strip()
        if not cs or not _AIRLINE.match(cs):
            continue
        ok, route = _cached(cs)
        if not ok:
            if used >= budget:
                continue
            try:
                route = _fetch(cs)
            except Exception:
                route = None
            _cache[cs] = (route, time.time() + (_TTL_OK if route else _TTL_MISS))
            used += 1
        if route:
            # Airline identity holds regardless of leg consistency; the route
            # endpoints are only trusted when the live position confirms them.
            ac.airline_name = route["airline_name"]
            ac.airline_iata = route["airline_iata"]
            ac.airline_icao = route["airline_icao"]
            ac.airline_country = route["airline_country"]
            if _route_consistent(ac, route):
                ac.origin = route["origin"]
                ac.origin_city = route["origin_city"]
                ac.dest = route["dest"]
                ac.dest_city = route["dest_city"]
