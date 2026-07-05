"""Callsign -> route (origin/destination) lookup via adsbdb.com.

adsbdb is a free, no-key flight-route database. Routes rarely change, so we
cache hard (both hits and misses) to keep refreshes fast and be kind to the API.
Only airline-style callsigns (3 letters + a number, e.g. SWA284) are queried;
GA tail numbers like N738BS have no scheduled route and are skipped.
"""

from __future__ import annotations

import json
import re
import time
import urllib.request

from . import config

_URL = "https://api.adsbdb.com/v0/callsign/{cs}"
_AIRLINE = re.compile(r"^[A-Z]{3}[0-9]")
_TTL_OK = 6 * 3600       # a known route is good for hours
_TTL_MISS = 30 * 60      # re-check unknowns occasionally

# callsign -> (route_dict_or_None, expires_at)
_cache: dict[str, tuple] = {}


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
    return {
        "origin": o.get("iata_code"),
        "origin_city": o.get("municipality"),
        "dest": d.get("iata_code"),
        "dest_city": d.get("municipality"),
    }


def _cached(callsign: str):
    hit = _cache.get(callsign)
    if hit and time.time() < hit[1]:
        return True, hit[0]
    return False, None


def enrich(flights, budget: int = 6) -> None:
    """Attach .origin/.dest (+cities) to airline flights, in place.

    `budget` caps how many *new* network lookups we do per snapshot; the rest
    fill in on later refreshes as the cache warms. Flights are assumed already
    sorted so the nearest/visible ones get routes first.
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
            ac.origin = route["origin"]
            ac.origin_city = route["origin_city"]
            ac.dest = route["dest"]
            ac.dest_city = route["dest_city"]
