# AeroBoard — Vision & Planning Doc

> A viral-style flight tracking board. A birthday gift for my wife.
> Status: **Brainstorming** — filling out the vision.

## The One-Liner
A cozy **Stardew Valley–style pixel-art flight companion** on a small tabletop
screen — it shows the planes on approach to Spokane International (GEG) as charming
pixel-art, set in a little living scene that changes with the time of day, weather,
and season. Glance over, and the sky over our home comes to life.

## Who & Why
- **Gift for:** my wife (birthday)
- **The emotional hook:** turn the everyday view off our deck into something
  magical — glance up, see a plane, and the board tells you exactly what it is
  and where it's going, in real time. It's *our* sky, not a generic feed.

## What We're Tracking
- Live aircraft overhead / near our home, especially on approach & departure at
  **GEG (Spokane International, KGEG)**.
- Real-time lookup of any plane in view: airline, flight #, route, type, altitude,
  speed, etc.

## Aesthetic / Form Factor
- **Craft = Stardew-LEVEL pixel art:** 16-bit quality + a living world (day/night,
  weather, seasons). But NOT the medieval-farm / wood-cottage skin.
- **Look = Age of Flight / Airport / ATC:** an aviation-operations aesthetic. UI chrome
  is **flight-progress strips, a split-flap departure board, a radar scope, and airport
  signage** — not wooden menus. A little golden-age travel-poster warmth is welcome so
  it doesn't feel cold/clinical.
- **Palette:** radar green, CRT amber, runway lights (white/red/green/blue), navy &
  black night, aluminum silver; optional deco cream/teal/gold (Pan Am era) accents.
- **World:** a pixel **airport at GEG** — control tower, runway + approach lights, radar
  sweep, rotating beacon, windsock, hangars, apron, ground crew, airliners.
- **Form factor:** **5.5" AMOLED** (1080×1920, mounted landscape), tabletop. True blacks
  = glowing night runway/radar scenes. NOT wall-mounted, NOT an LED matrix.
- **Pixel discipline:** low internal res (~320×240 / 400×240), nearest-neighbor upscale
  so pixels stay crisp and chunky on the dense screen.

## Hardware — RECOMMENDED STACK
- **Brain:** **Raspberry Pi 4** (Pi Zero 2 W also viable; Pi 4 gives comfy headroom).
- **Screen (choosing):** small color IPS or AMOLED, ~4–5.5". Candidates:
  - Waveshare 5" DSI IPS 1024×600 (~$50) — easiest (one ribbon), great value
  - Waveshare 4" square IPS 720×720 (~$55) — cozy "window" shape
  - **Waveshare 5.5" AMOLED 1080×1920 (~$100)** — deep-black OLED glow, premium
  - Official Pi Touch Display 2, 720×1280 (~$60) — best-supported
- **Touch:** most candidates include capacitive touch → tap a plane for details.
- **Optional:** small speaker for a gentle chime; nice wooden stand/bezel; light sensor
  for auto-dim at night (esp. if OLED, also helps avoid burn-in).
- _(Open door: a local ADS-B receiver can still be added later — data layer supports it.)_

## Software (BUILT — v0 functional)
- **Architecture:** a tiny **zero-dependency Python server** (`aeroboard/`) + an
  **HTML-canvas pixel-art UI** (`web/index.html`). Runs in any browser for dev; the
  Raspberry Pi drives the OLED by running the same server + **Chromium in kiosk mode** —
  no rewrite to port from laptop to device.
- **Data layer (`data.py`):** live aircraft near GEG from a free ADS-B API
  (airplanes.live → adsb.lol fallback), normalized, geo-tagged (distance/bearing from
  home), classified APPROACH / DEPARTURE / GA / OVERFLIGHT. Standard library only.
- **Routes + Settings:** `routes.py` adds origin→dest per airline callsign (adsbdb,
  cached); `settings.py` persists user location/radius/ceiling to `settings.json`.
- **UI (`web/`):** four tap-navigated views — **board**, **flight detail** (with a
  "look" compass pointing where to spot it), **fullscreen radar + stats**, and a
  **settings form** (address lookup / device location / manual coords). Touch handled
  via pointer events (a mouse click in dev == a finger tap on the panel). Basic +
  functional now; theming comes next.
- **Run:** `python3 -m aeroboard.server` → http://localhost:8000

## Data Sources (BUILT)
- **Traffic:** **airplanes.live** (primary) → **adsb.lol** (fallback) — free ADS-B
  aggregators, no key. Point+radius query around GEG → callsign, type, altitude,
  speed, position, vertical rate.
- **Routes:** **adsbdb.com** — callsign → origin/destination (IATA + city), cached hard.
- **Geocoding:** **OpenStreetMap Nominatim** — Settings address lookup → lat/lon.
- **Upgrades (later):** FlightAware AeroAPI (richer/route reliability); a local ADS-B
  receiver (data layer already supports it) if an antenna spot ever appears.

### Reference projects (for the data layer / prior art — aesthetic is our own)
- ColinWaddell FlightTracker (Pi/Python flight-data code worth borrowing): https://github.com/ColinWaddell/FlightTracker
- FlightWall OSS (ESP32/C++): https://github.com/AxisNimble/TheFlightWall_OSS

## Features (candidate menu — to prioritize)
### Core flight info
- Live info for aircraft near home / on approach to GEG: airline, flight #,
  route (origin → GEG or GEG → dest), aircraft type, altitude, speed, distance.
- Cycle through multiple planes in range; refresh ~every 10s.
- Flight details shown as a **flight-progress strip / split-flap departure board** in
  pixel art — the aviation-ops answer to a dialog box.

### The living airport scene (heart of the vibe)
- **The airfield:** GEG in pixel art — control tower with a lit cab, runway with PAPI /
  approach lights, taxiways + signage, apron with parked airliners, hangars, radar
  dish, rotating green-white beacon, windsock.
- **Time-of-day:** sky + lighting sync to real local time; at night the runway edge
  lights, beacon, and tower glow (AMOLED shines here).
- **Real weather (METAR-driven):** GEG's live wind swings the windsock and picks the
  runway in use; ceiling/visibility roll in real fog/overcast; rain & snow render.
- **Seasons:** subtle seasonal skin (summer haze, fall light, winter snow + a pixel
  de-icing truck on the ramp).
- **Aircraft sprites:** the arriving plane flies its approach, touches down, and taxis
  in; sprite varies by class (prop / regional jet / narrowbody / widebody).
- **Tower & ground crew:** a controller in the cab + ramp crew that scurry out to
  marshal an arrival — the aviation answer to the cozy critter.
- **Radar scope:** a small green ATC radar pane, sweeping, with blips for nearby traffic.
- **Gentle SFX** (optional speaker): soft radio chirp / arrival chime.

### GEG-specific magic (the differentiators)
- **"Look up!" pointer:** for a plane on final approach within your visible window,
  show a directional cue (e.g. "↖ NW") so she can match the board to the real plane.
- **Approach/departure filter:** prioritize planes actually landing/departing GEG
  (altitude + proximity filter) over unseeable 35,000 ft overflights.
- **Interesting-plane alerts:** widebody / military / rare airline / very-distant
  origin / the daily cargo run — chime + animation.
- **"Farthest traveler":** highlight the plane overhead that came from furthest away.

### Birthday-gift heart (personal touches)
- **Idle/no-planes messages:** rotating sweet notes ("Happy Birthday ♥", anniversary
  countdown, "clear skies over home") instead of a blank board.
- **Memory-route callouts:** if a flight matching a route meaningful to you two passes
  over (honeymoon, family visits), show a little heart + note.
- **Time-of-day palette:** color theme shifts at sunset / blue hour.
- **Weather line:** current GEG conditions (OpenWeatherMap) — good plane-watching night?

### Interaction / viral
- **Touch to inspect:** ✅ BUILT — tap a flight → detail view (route, altitude/speed,
  heading, squawk, "look" compass); tap the radar → fullscreen radar + stats.
- **Settings page:** ✅ BUILT — location (address lookup / device / manual coords),
  search radius, visibility ceiling.
- **Daily counter:** "planes spotted today: 42"; monthly "wrapped" summary from a log.

### Nice-to-have (later)
- Flight-history logging + stats ("wrapped"), multiple scene themes/"farms,"
  add a real ADS-B receiver, day/night ambient soundscape.

## Constraints
- **Budget:** "Whatever it takes" — this is THE gift. (Screen build likely ~$120–220 total.)
- **Deadline (birthday):** _(TBD — need the date!)_
- **My build skills:** Comfortable with code (Python-friendly). New to hardware — the
  screen route is mostly software, which suits this well.

## Open Questions
- **Birthday date — STILL NEED IT.** Sets our whole build runway. ⟵ most important open item
- Art-direction sub-vibe: **chosen → cozy night airport** (theming pass still to come).
- Home coordinates: now settable in the **Settings page**; using GEG until real ones entered.
- Personal details to weave in: her name, meaningful flight routes,
  favorite airlines/planes, and whether she (or you) is into aviation.

## Decisions Log
- **Concept:** pixel-art flight companion for planes on approach to GEG, seen from home.
- **Aesthetic:** Stardew-*level* pixel-art craft, themed as an **airport / ATC /
  golden-age-of-flight** ops scene (NOT the farm/wood skin). Tabletop, not wall/LED.
- **Screen:** 5.5" AMOLED, 1080×1920, mounted landscape. Touch = yes.
- **Art pipeline:** free/CC0 pixel asset packs + procedural rendering + custom personal bits.
- **Build vs buy:** BUILD ourselves (part of the gift).
- **Art sub-vibe:** cozy night airport (warm terminal glow, split-flap, apron floods).
- **Stack:** Raspberry Pi 4 + 5.5" AMOLED; **web UI (HTML canvas) + zero-dep Python
  server**; ports to the OLED via **Chromium kiosk** on the Pi (dev == device).
- **Data:** free ADS-B API (airplanes.live → adsb.lol); routes via **adsbdb**; geocode
  via **Nominatim**. No local receiver v1. METAR/weather still to come.
- **Built:** board + flight-detail + fullscreen-radar-with-stats + settings views;
  route enrichment; runtime settings (location/radius/ceiling) → settings.json.
- **~Superseded:** FlightWall / LED-matrix + Adafruit bonnet (pivoted to screen);
  Stardew wood-cottage skin (pivoted to airport/ATC look); Pygame renderer (swapped
  for a browser canvas so laptop-dev and the device run the exact same UI).
