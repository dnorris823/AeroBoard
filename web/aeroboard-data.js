/* AeroBoard client-side data layer — no server required.
 *
 * This is the browser port of the Python back end (data.py / routes.py /
 * weather.py / settings.py). It fetches everything the board needs straight
 * from free, CORS-enabled public APIs, so the whole app can run on an iPad
 * (or any browser) with nothing else running on your network:
 *
 *   flights  -> api.airplanes.live      (ADS-B, no key, ACAO:*)
 *   routes   -> api.adsbdb.com          (callsign -> origin/dest, ACAO:*)
 *   weather  -> api.open-meteo.com      (global, by lat/lon, no key, ACAO:*)
 *   settings -> localStorage            (was settings.json on the server)
 *
 * Everything is keyed off the configured home lat/lon (Settings), so the board
 * works at any location worldwide — nothing is tied to Spokane/GEG.
 *
 * It exposes window.AeroData.getSnapshot(), which returns exactly the object
 * shape the pixel engine consumes (the old /api/flights payload), plus
 * loadSettings()/saveSettings() used by the settings page.
 */
(function () {
  'use strict';

  // ---- config (mirrors aeroboard/config.py) -------------------------------
  // GEG is only the *default* home location (used until the user picks their own
  // in Settings). No API call is pinned to it — see getSnapshot / getWeather.
  var GEG_LAT = 47.6199, GEG_LON = -117.5339;
  var VISIBLE_ALT_FT = 10000, OVERFLIGHT_ALT_FT = 18000;
  var CLIMB_FPM = 300, DESCENT_FPM = -300;
  // airplanes.live only (adsb.lol, the server's fallback, has no CORS header).
  var FLIGHTS_URL = 'https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}';
  var ROUTE_URL = 'https://api.adsbdb.com/v0/callsign/';
  // Open-Meteo: global current-conditions by lat/lon, keyless, CORS-enabled.
  var WX_URL = 'https://api.open-meteo.com/v1/forecast';

  // ---- geometry (mirrors data.py) -----------------------------------------
  var EARTH_NM = 3440.065, D2R = Math.PI / 180;

  function haversineNm(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R;
    var dp = (lat2 - lat1) * D2R, dl = (lon2 - lon1) * D2R;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return EARTH_NM * 2 * Math.asin(Math.sqrt(a));
  }
  function bearingDeg(lat1, lon1, lat2, lon2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / D2R + 360) % 360;
  }
  var COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function compass(b) { return COMPASS[Math.floor(((b + 22.5) % 360) / 45)]; }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function r0(v) { return v == null ? null : Math.round(v); }
  function r1(v) { return v == null ? null : Math.round(v * 10) / 10; }

  // ---- settings (mirrors settings.py, backed by localStorage) -------------
  var KEY = 'aeroboard.settings';
  var DEFAULTS = {
    home_lat: GEG_LAT, home_lon: GEG_LON, location_label: 'GEG · Spokane Intl',
    radius_nm: 40, visible_alt_ft: VISIBLE_ALT_FT, theme: 'auto'
  };
  var THEMES = {
    auto: 1, night: 1, poster: 1, crt: 1, night2: 1, poster2: 1,
    dawn3: 1, day3: 1, dusk3: 1, night3: 1, ovc4: 1, rain4: 1, snow4: 1, fog4: 1
  };

  function loadSettings() {
    var s = {};
    for (var k in DEFAULTS) s[k] = DEFAULTS[k];
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var p = JSON.parse(raw); for (var j in p) s[j] = p[j]; }
    } catch (e) { /* ignore corrupt/blocked storage */ }
    return s;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function coerce(patch) {
    var out = loadSettings();
    if (patch.home_lat != null && isFinite(patch.home_lat))
      out.home_lat = clamp(parseFloat(patch.home_lat), -90, 90);
    if (patch.home_lon != null && isFinite(patch.home_lon))
      out.home_lon = clamp(parseFloat(patch.home_lon), -180, 180);
    if (patch.radius_nm != null && isFinite(patch.radius_nm))
      out.radius_nm = clamp(parseInt(patch.radius_nm, 10), 1, 250);
    if (patch.visible_alt_ft != null && isFinite(patch.visible_alt_ft))
      out.visible_alt_ft = clamp(parseInt(patch.visible_alt_ft, 10), 500, 45000);
    if (patch.location_label != null)
      out.location_label = String(patch.location_label).slice(0, 48);
    if (THEMES[patch.theme]) out.theme = patch.theme;
    return out;
  }
  function saveSettings(patch) {
    var out = coerce(patch);
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* ignore */ }
    return out;
  }

  // ---- flights (mirrors data.py fetch/normalize/classify) -----------------
  function normalize(raw) {
    var altRaw = raw.alt_baro != null ? raw.alt_baro : raw.alt_geom;
    var onGround = altRaw === 'ground';
    var callsign = (raw.flight || '').trim() || null;
    return {
      hex: raw.hex || '', callsign: callsign, reg: raw.r || null, type: raw.t || null,
      alt_ft: onGround ? 0 : num(altRaw), on_ground: onGround,
      gs_kt: num(raw.gs), track: num(raw.track),
      vrate_fpm: num(raw.baro_rate != null ? raw.baro_rate : raw.geom_rate),
      lat: num(raw.lat), lon: num(raw.lon), squawk: raw.squawk || null,
      category: raw.category || null,
      distance_nm: 0, bearing: 0, tag: 'TRANSIT', visible: false,
      origin: null, dest: null, origin_city: null, dest_city: null,
      airline_name: null, airline_iata: null, airline_icao: null, airline_country: null
    };
  }
  function classify(ac, visibleAlt, overflightAlt) {
    if (ac.on_ground) return 'GROUND';
    var alt = ac.alt_ft;
    if (alt == null) return 'TRANSIT';
    if (alt >= overflightAlt) return 'OVERFLIGHT';
    if (alt <= visibleAlt) {
      var vr = ac.vrate_fpm || 0;
      if (vr <= DESCENT_FPM) return 'APPROACH';
      if (vr >= CLIMB_FPM) return 'DEPARTURE';
      if ((ac.gs_kt == null ? 999 : ac.gs_kt) < 160 &&
          ((ac.category == null || ac.category === 'A1') || alt <= 5000)) return 'GA';
      return 'LOW';
    }
    return 'TRANSIT';
  }
  function fetchFlights(lat, lon, radius) {
    var url = FLIGHTS_URL.replace('{lat}', lat).replace('{lon}', lon).replace('{radius}', radius);
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('flights HTTP ' + r.status);
      return r.json();
    }).then(function (p) { return p.ac || p.aircraft || []; });
  }

  // ---- routes (mirrors routes.py, cached with a per-snapshot budget) -------
  var AIRLINE = /^[A-Z]{3}[0-9]/;
  var TTL_OK = 6 * 3600 * 1000, TTL_MISS = 30 * 60 * 1000;
  var routeCache = {};   // callsign -> { route: {}|null, exp: ms }

  function fetchRoute(cs) {
    return fetch(ROUTE_URL + encodeURIComponent(cs)).then(function (r) {
      if (!r.ok) return null;      // 404 = unknown callsign
      return r.json();
    }).then(function (payload) {
      if (!payload) return null;
      var resp = payload.response;
      if (!resp || typeof resp !== 'object') return null;
      var fr = resp.flightroute || {};
      var o = fr.origin || {}, d = fr.destination || {};
      if (!o.iata_code || !d.iata_code) return null;
      var al = fr.airline || {};
      return {
        origin: o.iata_code, origin_city: o.municipality || null,
        origin_lat: num(o.latitude), origin_lon: num(o.longitude),
        dest: d.iata_code, dest_city: d.municipality || null,
        dest_lat: num(d.latitude), dest_lon: num(d.longitude),
        // airline identity is tied to the callsign, valid even if the leg isn't
        airline_name: al.name || null, airline_iata: al.iata || null,
        airline_icao: al.icao || null,
        airline_country: al.country_iso || al.country || null
      };
    })['catch'](function () { return null; });
  }
  function enrichRoutes(flights, budget) {
    var now = Date.now(), pending = [];
    for (var i = 0; i < flights.length; i++) {
      var ac = flights[i], cs = (ac.callsign || '').trim();
      if (!cs || !AIRLINE.test(cs)) continue;
      var hit = routeCache[cs];
      if (hit && now < hit.exp) {
        applyRoute(ac, hit.route);
      } else if (pending.length < budget) {
        pending.push(fetchOne(ac, cs));
      }
    }
    return Promise.all(pending);
  }
  function fetchOne(ac, cs) {
    return fetchRoute(cs).then(function (route) {
      routeCache[cs] = { route: route, exp: Date.now() + (route ? TTL_OK : TTL_MISS) };
      applyRoute(ac, route);
    });
  }
  // adsbdb keys routes by flight number, which airlines reuse across legs, so a
  // returned route can belong to a different leg than the aircraft is flying
  // now. Reject a route when the aircraft's live position sits too far off the
  // direct origin->destination path. Mirrors routes.py _route_consistent.
  var CORRIDOR_NM = 100, ENDPOINT_MARGIN_NM = 100;
  function routeConsistent(ac, route) {
    var oLat = route.origin_lat, oLon = route.origin_lon;
    var dLat = route.dest_lat, dLon = route.dest_lon;
    if (ac.lat == null || ac.lon == null ||
        oLat == null || oLon == null || dLat == null || dLon == null) return true;
    var dOD = haversineNm(oLat, oLon, dLat, dLon);
    var dOP = haversineNm(oLat, oLon, ac.lat, ac.lon);
    var dDP = haversineNm(dLat, dLon, ac.lat, ac.lon);
    if (dOD > 0) {
      var ang13 = dOP / EARTH_NM;
      var dth = (bearingDeg(oLat, oLon, ac.lat, ac.lon) -
                 bearingDeg(oLat, oLon, dLat, dLon)) * D2R;
      var s = Math.max(-1, Math.min(1, Math.sin(ang13) * Math.sin(dth)));
      if (Math.abs(Math.asin(s)) * EARTH_NM > CORRIDOR_NM) return false;
    }
    var limit = dOD + ENDPOINT_MARGIN_NM;
    return dOP <= limit && dDP <= limit;
  }
  function applyRoute(ac, route) {
    if (!route) return;
    // Airline identity holds regardless of leg consistency; only trust the
    // route endpoints when the live position confirms them.
    ac.airline_name = route.airline_name; ac.airline_iata = route.airline_iata;
    ac.airline_icao = route.airline_icao; ac.airline_country = route.airline_country;
    if (!routeConsistent(ac, route)) return;
    ac.origin = route.origin; ac.origin_city = route.origin_city;
    ac.dest = route.dest; ac.dest_city = route.dest_city;
  }

  // ---- weather (Open-Meteo current conditions, global, by lat/lon) --------
  var wxCache = null, wxAt = 0, wxKey = '', WX_TTL = 600 * 1000;

  function visDisplay(sm) {
    if (sm == null) return '--';
    if (sm >= 10) return '10+SM';
    if (sm >= 3) return Math.round(sm) + 'SM';
    return (Math.round(sm * 4) / 4) + 'SM';   // quarter-mile resolution when low
  }
  // WMO weather codes -> the five looks the engine can paint.
  function wmoState(code) {
    if (code == null) return 'clear';
    code = +code;
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
    if (code === 45 || code === 48) return 'fog';
    if (code === 3) return 'overcast';
    return 'clear';   // 0/1/2 = clear .. partly cloudy
  }
  function fetchWeather(lat, lon) {
    var url = WX_URL + '?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m' +
      '&hourly=visibility&temperature_unit=fahrenheit&wind_speed_unit=kn' +
      '&forecast_days=1&timezone=auto';
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('wx HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var c = j.current || {};
      // visibility (metres) for the current hour, from the hourly series
      var visM = null;
      if (j.hourly && j.hourly.time && j.hourly.visibility) {
        var ch = (c.time || '').slice(0, 13);
        for (var i = 0; i < j.hourly.time.length; i++) {
          if (j.hourly.time[i].slice(0, 13) === ch) { visM = j.hourly.visibility[i]; break; }
        }
      }
      var visSm = visM == null ? null : visM / 1609.34;
      var state = wmoState(c.weather_code);
      return {
        state: state, label: state.toUpperCase(),
        tempF: c.temperature_2m == null ? null : Math.round(c.temperature_2m),
        windDir: c.wind_direction_10m == null ? 0 : Math.round(c.wind_direction_10m),
        windKt: c.wind_speed_10m == null ? 0 : Math.round(c.wind_speed_10m),
        visSM: visDisplay(visSm)
      };
    });
  }
  function getWeather(lat, lon) {
    var key = (+lat).toFixed(3) + ',' + (+lon).toFixed(3);
    var now = Date.now();
    if (wxCache && wxKey === key && (now - wxAt) < WX_TTL) return Promise.resolve(wxCache);
    return fetchWeather(lat, lon).then(function (w) {
      wxCache = w; wxAt = now; wxKey = key; return w;
    })['catch'](function () { return wxKey === key ? wxCache : null; });  // keep last good for this spot
  }

  // ---- timezone (IANA zone for a lat/lon, via Open-Meteo) -----------------
  // The board's clock and "auto" theme should read local-to-the-location time,
  // not the device's. Open-Meteo returns the IANA zone (e.g. "Asia/Tokyo") for
  // any coordinate with timezone=auto; we cache it (memory + localStorage) keyed
  // by rounded lat/lon so a known spot resolves instantly and works offline.
  var TZ_KEY = 'aeroboard.tz';
  var tzMem = {};
  function tzCacheKey(lat, lon) { return (+lat).toFixed(2) + ',' + (+lon).toFixed(2); }
  function tzFromStore(key) {
    if (tzMem[key]) return tzMem[key];
    try {
      var raw = localStorage.getItem(TZ_KEY);
      var map = raw ? JSON.parse(raw) : {};
      if (map && map[key]) { tzMem[key] = map[key]; return map[key]; }
    } catch (e) { /* ignore */ }
    return null;
  }
  function tzToStore(key, tz) {
    tzMem[key] = tz;
    try {
      var raw = localStorage.getItem(TZ_KEY);
      var map = raw ? JSON.parse(raw) : {};
      map[key] = tz;
      localStorage.setItem(TZ_KEY, JSON.stringify(map));
    } catch (e) { /* ignore */ }
  }
  function getTimeZone(lat, lon) {
    var key = tzCacheKey(lat, lon);
    var cached = tzFromStore(key);
    if (cached) return Promise.resolve(cached);
    var url = WX_URL + '?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m&forecast_days=1&timezone=auto';
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('tz HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var tz = j && j.timezone;
      if (tz) tzToStore(key, tz);
      return tz || null;
    })['catch'](function () { return null; });   // caller keeps the device zone
  }

  // ---- reverse geocode: a human label for a coordinate --------------------
  // So the location label can follow the pin the same way the clock does: hand
  // it a lat/lon and get back a short "City, Region" string. Uses OSM Nominatim
  // (same service the address search uses) and caches the answer the same way
  // as the timezone — memory + localStorage, keyed by rounded lat/lon — so a
  // known spot resolves instantly and a repeat lookup works offline.
  var PLACE_KEY = 'aeroboard.place';
  var placeMem = {};
  function placeFromStore(key) {
    if (placeMem[key]) return placeMem[key];
    try {
      var raw = localStorage.getItem(PLACE_KEY);
      var map = raw ? JSON.parse(raw) : {};
      if (map && map[key]) { placeMem[key] = map[key]; return map[key]; }
    } catch (e) { /* ignore */ }
    return null;
  }
  function placeToStore(key, label) {
    placeMem[key] = label;
    try {
      var raw = localStorage.getItem(PLACE_KEY);
      var map = raw ? JSON.parse(raw) : {};
      map[key] = label;
      localStorage.setItem(PLACE_KEY, JSON.stringify(map));
    } catch (e) { /* ignore */ }
  }
  // Collapse Nominatim's address object into a compact "City, Region" label,
  // falling back through the coarser place fields (down to just a country) and
  // finally the raw display_name when the structured parts are missing.
  function labelFromPlace(j) {
    var a = j && j.address;
    if (a) {
      var city = a.city || a.town || a.village || a.hamlet || a.suburb ||
                 a.municipality || a.city_district || a.county;
      var region = a.state || a.country;
      if (city && region && city !== region) return (city + ', ' + region).slice(0, 48);
      if (city) return String(city).slice(0, 48);
      if (region) return String(region).slice(0, 48);
    }
    if (j && j.display_name) return String(j.display_name).split(',')[0].trim().slice(0, 48);
    return null;
  }
  function getPlaceLabel(lat, lon) {
    var key = tzCacheKey(lat, lon);
    var cached = placeFromStore(key);
    if (cached) return Promise.resolve(cached);
    var url = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=10' +
      '&addressdetails=1&lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon);
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('reverse HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var label = labelFromPlace(j);
      if (label) placeToStore(key, label);
      return label || null;
    })['catch'](function () { return null; });   // caller keeps whatever label it had
  }

  // ---- snapshot: the object the engine consumes ---------------------------
  function toFlightDict(ac) {
    return {
      hex: ac.hex, label: (ac.callsign || ac.reg || ac.hex || '??').trim(),
      reg: ac.reg, type: ac.type,
      alt_ft: r0(ac.alt_ft), on_ground: ac.on_ground, gs_kt: r0(ac.gs_kt),
      track: r0(ac.track), vrate_fpm: r0(ac.vrate_fpm), squawk: ac.squawk,
      origin: ac.origin, dest: ac.dest, origin_city: ac.origin_city, dest_city: ac.dest_city,
      airline_name: ac.airline_name, airline_iata: ac.airline_iata,
      airline_icao: ac.airline_icao, airline_country: ac.airline_country,
      distance_nm: r1(ac.distance_nm), bearing: r1(ac.bearing),
      compass: ac.distance_nm ? compass(ac.bearing) : '', tag: ac.tag, visible: ac.visible
    };
  }

  function getSnapshot() {
    var s = loadSettings();
    var raw;
    return fetchFlights(s.home_lat, s.home_lon, s.radius_nm).then(function (list) {
      raw = list;
      var flights = [];
      for (var i = 0; i < raw.length; i++) {
        var ac = normalize(raw[i]);
        if (ac.lat != null && ac.lon != null) {
          ac.distance_nm = haversineNm(s.home_lat, s.home_lon, ac.lat, ac.lon);
          ac.bearing = bearingDeg(s.home_lat, s.home_lon, ac.lat, ac.lon);
        }
        ac.visible = ac.alt_ft != null && ac.alt_ft <= s.visible_alt_ft;
        ac.tag = classify(ac, s.visible_alt_ft, OVERFLIGHT_ALT_FT);
        flights.push(ac);
      }
      flights.sort(function (a, b) {
        if (a.visible !== b.visible) return a.visible ? -1 : 1;
        return a.distance_nm - b.distance_nm;
      });
      // routes + weather in parallel; neither should block the board on failure.
      return Promise.all([enrichRoutes(flights, 6), getWeather(s.home_lat, s.home_lon)]).then(function (res) {
        var weather = res[1] || null;
        var dicts = flights.map(toFlightDict), counts = {};
        for (var k = 0; k < dicts.length; k++)
          counts[dicts[k].tag] = (counts[dicts[k].tag] || 0) + 1;
        return {
          flights: dicts, counts: counts, source: 'airplanes.live', error: null,
          tracking: dicts.length, radius_nm: s.radius_nm,
          location_label: s.location_label, weather: weather, live: true
        };
      });
    });
  }

  window.AeroData = {
    getSnapshot: getSnapshot,
    getTimeZone: getTimeZone,
    getPlaceLabel: getPlaceLabel,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    DEFAULTS: DEFAULTS,
    THEMES: THEMES
  };
})();
