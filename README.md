# AeroBoard

A pixel-art flight board for the skies over **Spokane International (GEG)** — it shows
the planes on approach that you can actually see, in a small airport/ATC-styled UI.
Runs in a browser now; the finished piece runs on a Raspberry Pi driving a 5.5" AMOLED.

> Status: **v0 — functional.** Live data + a basic airport UI. Theming is next.
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
                  + geo-tag             + serves the page        (browser)
```

- **`data.py`** — fetches aircraft near GEG, computes distance/bearing from home, tags
  each as APPROACH / DEPARTURE / GA / OVERFLIGHT / GROUND, sorts the visible ones first.
- **`server.py`** — zero-dependency HTTP server: serves the UI + `/api/flights`.
- **`web/index.html`** — draws a 384×216 pixel canvas, upscaled crisp to the screen.

## Configure

Edit `aeroboard/config.py`:

- `HOME_LAT` / `HOME_LON` — **currently set to the airport**; drop in your home
  coordinates so distance/bearing are from your deck.
- `RADIUS_NM` — how far out to look (default 40).
- `VISIBLE_ALT_FT`, `CLIMB_FPM`, `DESCENT_FPM` — the "can I see it / is it landing"
  thresholds.

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
