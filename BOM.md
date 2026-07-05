# AeroBoard — Bill of Materials (shoppable)

**Direction: cozy Stardew-style pixel-art companion on a small tabletop screen.**
Prices are approximate USD as of research on 2026-07-05. This is now mostly a
software project — the hardware is a Pi + a screen + a stand.

> **Key compatibility note:** Use a **Raspberry Pi 4** (or Pi Zero 2 W). DSI/HDMI
> displays are broadly supported, but confirm the specific screen lists your Pi model.

---

## Common parts (every build)

| Part | Item | Price |
|---|---|---:|
| Brain | Raspberry Pi 4 Model B (4GB) | ~$100 |
| — *budget swap* | Raspberry Pi Zero 2 W | ~$15 |
| SD | 32GB microSD card | ~$10 |
| Power | Official USB-C PSU (Pi 4) | ~$10 |
| Stand | Wooden stand / bezel / 3D-printed enclosure | ~$15–40 |
| *optional* | Small USB/I2S speaker (for chime SFX) | ~$8 |
| *optional* | Light sensor for auto-dim / anti-burn-in | ~$8 |

---

## Screen options (pick one) — this is the main choice

| Screen | Res | Interface | Touch | ~Price | Vibe |
|---|---|---|---|---:|---|
| **Waveshare 5" DSI IPS** | 1024×600 | DSI (1 ribbon) | Yes | **$50** | Best value + easiest wiring |
| Waveshare 4" square IPS | 720×720 | DPI | Yes | $55 | Cozy "window" shape, dense |
| **Waveshare 5.5" AMOLED** ⭐ | 1080×1920 | HDMI + USB | Yes | $100 | Deep-black OLED glow, premium night scenes |
| Official Pi Touch Display 2 | 720×1280 | DSI | Yes | $60 | Best-supported, plug-and-play |

Notes:
- **AMOLED** = the "wow" pick: true blacks make the night sky/stars scene glow. Uses HDMI +
  a USB cable for touch/power; native portrait, so mount landscape (1920×1080 wide).
  Add auto-dim to reduce any long-term burn-in from static UI.
- **5" DSI IPS** = the pragmatic pick: single ribbon cable, driver-free, cheap, plenty
  crisp for chunky pixel art.

---

## Example totals

| Build | Screen | Brain | Rough total |
|---|---|---|---:|
| **Value** | 5" DSI IPS ($50) | Pi Zero 2 W | **~$110** |
| **Balanced** | 5" DSI IPS ($50) | Pi 4 | **~$190** |
| **Premium** ⭐ | 5.5" AMOLED ($100) | Pi 4 | **~$240** |

All comfortably inside the "whatever it takes" budget. The screen + stand are where any
extra polish spend goes (nice hardwood stand, glass front, etc.).

---

## What we are NOT buying anymore (pivoted away from)
- ~~LED matrix panels, Adafruit Matrix Bonnet, 5V/10A supply~~ (the FlightWall/LED plan).
