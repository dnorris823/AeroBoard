"""AeroBoard configuration — where we are and what counts as 'nearby'."""

# Spokane International Airport (GEG / KGEG)
GEG_LAT = 47.6199
GEG_LON = -117.5339

# Where the board lives / what we watch from. Default to the airport until we
# drop in the real home coordinates (city-level is fine to start).
HOME_LAT = GEG_LAT
HOME_LON = GEG_LON

# How far out to pull traffic, in nautical miles (airplanes.live caps at 250).
RADIUS_NM = 40

# Altitude (ft) at/below which climb/descent reads as an approach/departure and
# light traffic reads as general aviation. Purely a classification band — not a
# user-facing setting.
LOW_ALT_FT = 10000

# Above this it's a high overflight we de-emphasize.
OVERFLIGHT_ALT_FT = 18000

# Vertical rate (ft/min) thresholds for climb/descent classification.
CLIMB_FPM = 300
DESCENT_FPM = -300

# Local timezone for the on-screen clock (the board lives in Spokane).
TIMEZONE = "America/Los_Angeles"

# Data sources tried in order. Both speak the ADS-B "v2 point" schema (key "ac"),
# are free, and need no API key.
API_ENDPOINTS = (
    "https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}",
    "https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}",
)

USER_AGENT = "AeroBoard/0.1 (hobby flight board; contact: dnorris)"
HTTP_TIMEOUT = 12  # seconds

# Live weather: KGEG METAR from aviationweather.gov (free, JSON, no API key).
METAR_STATION = "KGEG"
METAR_URL = "https://aviationweather.gov/api/data/metar?ids={station}&format=json"

# Display: internal pixel-art canvas (16:9), scaled up to the panel.
INT_W = 384
INT_H = 216
