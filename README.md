# AeroBoard

A pixel-art flight board for the skies over **Spokane International (GEG)** — it shows
the planes on approach that you can actually see, in a small airport/ATC-styled UI.
Runs in a browser now; the finished piece runs on a Raspberry Pi driving a 5.5" AMOLED.

> Status: **v1 — themed.** Live data + a pixel-art airport UI with 15 looks
> (auto time-of-day, weather scenes, full-bleed landscapes and a CRT scope).
> See [VISION.md](VISION.md) for the full design and [BOM.md](BOM.md) for hardware.

## Run it now (dev, in your browser)

No installs — standard library only:

```bash
python3 -m aeroboard.server
# open http://localhost:8000
```

You'll see live traffic near GEG: a flight-strip list (visible/approaching planes on
top), a radar, and an in-range summary. It refreshes every 10s. If the server isn't
reachable the page falls back to a small built-in sample so it still renders.

Peek at just the data:

```bash
python3 -m aeroboard.data          # prints classified nearby aircraft
curl localhost:8000/api/flights    # the JSON the UI consumes
```

## How it works

```
airplanes.live ─▶ aeroboard/data.py ─▶ aeroboard/server.py ─▶ web/index.html
 (free ADS-B)     fetch + classify      /api/flights (JSON)     canvas pixel UI
adsbdb.com  ─────▶ + geo-tag + route     + /api/settings         (board · detail
 (callsign→route)  enrichment            + /api/geocode           · radar · settings)
```

- **`data.py`** — fetches aircraft near GEG, computes distance/bearing from home, tags
  each as APPROACH / DEPARTURE / GA / OVERFLIGHT / GROUND, sorts the visible ones first.
- **`routes.py`** — adds origin → destination per airline callsign (adsbdb.com), cached.
- **`settings.py`** — user location/radius/threshold, persisted to `settings.json`.
- **`server.py`** — zero-dependency HTTP server: serves the UI + `/api/flights`,
  `/api/settings` (GET/POST), and `/api/geocode` (address → coordinates).
- **`web/index.html`** — mounts the pixel engine full-screen and feeds it live data.
- **`web/aeroboard-engine.js`** — the themeable renderer: board, flight-detail, radar
  and settings views, 15 themes, split-flap, scene art and CRT effects.
- **`web/settings.html`** — the settings form (location, traffic, theme).

## Settings

Tap the **⚙ gear** on the board (or open **`/settings`**) to set:

- **Location** — type an address (geocoded via OpenStreetMap), use your device's
  location, or enter latitude/longitude by hand. This is where distances and the
  "look" direction are measured from.
- **Search radius** and the **"visible" altitude ceiling**.
- **Theme** — the board's look. **Auto** follows the local clock (dawn / day / dusk /
  night scenes swap themselves); or pin a fixed time-of-day, a weather scene
  (overcast / rain / snow / fog), a full-bleed landscape, or the Radar-Ops CRT.
  All 15 themes render the same board / detail / radar / settings views; the pixel
  art lives in `web/aeroboard-engine.js` (`window.AeroBoard.mount`).

Saved to `settings.json` (gitignored); the board picks it up on its next refresh.
Defaults live in `aeroboard/config.py`.

## Porting to the OLED (later, on the Raspberry Pi)

Because the UI is a web page, moving from laptop to the finished board is just:

1. Copy this repo to the Pi; run `python3 -m aeroboard.server` (optionally as a
   `systemd` service so it starts on boot).
2. Launch Chromium in kiosk mode on the AMOLED:
   ```bash
   chromium-browser --kiosk --incognito http://localhost:8000
   ```
3. That's the whole port. Same code, no rewrite. Touch works out of the box.

## No dependencies

The data layer and server use only the Python standard library. The UI is plain
HTML/JS. Nothing to `pip install`.
