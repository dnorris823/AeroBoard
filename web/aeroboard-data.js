/* AeroBoard client-side data layer — no server required.
 *
 * This is the browser port of the Python back end (data.py / routes.py /
 * weather.py / settings.py). It fetches everything the board needs straight
 * from free, CORS-enabled public APIs, so the whole app can run on an iPad
 * (or any browser) with nothing else running on your network:
 *
 *   flights  -> api.airplanes.live      (ADS-B, no key, ACAO:*)
 *   routes   -> api.adsbdb.com          (callsign -> origin/dest, ACAO:*)
 *   weather  -> api.weather.gov  (NWS)  (KGEG observations, no key, ACAO:*)
 *   settings -> localStorage            (was settings.json on the server)
 *
 * It exposes window.AeroData.getSnapshot(), which returns exactly the object
 * shape the pixel engine consumes (the old /api/flights payload), plus
 * loadSettings()/saveSettings() used by the settings page.
 */
(function () {
  'use strict';

  // ---- config (mirrors aeroboard/config.py) -------------------------------
  var GEG_LAT = 47.6199, GEG_LON = -117.5339;
  var VISIBLE_ALT_FT = 10000, OVERFLIGHT_ALT_FT = 18000;
  var CLIMB_FPM = 300, DESCENT_FPM = -300;
  // airplanes.live only (adsb.lol, the server's fallback, has no CORS header).
  var FLIGHTS_URL = 'https://api.airplanes.live/v2/point/{lat}/{lon}/{radius}';
  var ROUTE_URL = 'https://api.adsbdb.com/v0/callsign/';
  var NWS_URL = 'https://api.weather.gov/stations/KGEG/observations/latest';
  var METAR_STATION = 'KGEG';

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
    home_lat: GEG_LAT, home_lon: GEG_LON, location_label: 'GEG (airport)',
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
      origin: null, dest: null, origin_city: null, dest_city: null
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
      return {
        origin: o.iata_code, origin_city: o.municipality || null,
        dest: d.iata_code, dest_city: d.municipality || null
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
  function applyRoute(ac, route) {
    if (!route) return;
    ac.origin = route.origin; ac.origin_city = route.origin_city;
    ac.dest = route.dest; ac.dest_city = route.dest_city;
  }

  // ---- weather (was aviationweather METAR; now NWS observations) ----------
  var wxCache = null, wxAt = 0, WX_TTL = 600 * 1000;

  function cToF(c) { return c == null ? null : Math.round(c * 9 / 5 + 32); }

  function visDisplay(sm) {
    if (sm == null) return '--';
    if (sm >= 10) return '10+SM';
    if (sm >= 3) return Math.round(sm) + 'SM';
    return (Math.round(sm * 4) / 4) + 'SM';   // quarter-mile resolution when low
  }
  function classifyWx(wx, clouds, visVal) {
    wx = (wx || '').toUpperCase();
    if (/SN|SG|PL/.test(wx)) return 'snow';
    if (/RA|DZ|SH|TS|GR|GS|UP/.test(wx)) return 'rain';
    if (/FG|BR|FU/.test(wx) || (visVal != null && visVal <= 1.0)) return 'fog';
    var covers = {};
    for (var i = 0; i < (clouds || []).length; i++) {
      var c = clouds[i]; if (c) covers[(c.cover || '').toUpperCase()] = 1;
    }
    if (covers.OVC || covers.BKN || covers.OVX) return 'overcast';
    return 'clear';
  }
  // Turn NWS presentWeather[] (+ rawMessage) into a METAR-ish string we can scan.
  function wxString(props) {
    var parts = [];
    var pw = props.presentWeather || [];
    for (var i = 0; i < pw.length; i++) {
      if (pw[i].rawString) parts.push(pw[i].rawString);
      var w = (pw[i].weather || '').toLowerCase();
      if (/snow|ice pellet/.test(w)) parts.push('SN');
      else if (/rain|drizzle|thunder|hail/.test(w)) parts.push('RA');
      else if (/fog|mist|haze|smoke/.test(w)) parts.push('BR');
    }
    if (props.rawMessage) parts.push(props.rawMessage);
    return parts.join(' ');
  }
  function fetchWeather() {
    return fetch(NWS_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('wx HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var p = j.properties || {};
      var visM = p.visibility ? p.visibility.value : null;
      var visSm = visM == null ? null : visM / 1609.34;
      var clouds = (p.cloudLayers || []).map(function (l) { return { cover: l.amount }; });
      var state = classifyWx(wxString(p), clouds, visSm);
      var wspdKmh = p.windSpeed ? p.windSpeed.value : null;
      var wdir = p.windDirection ? p.windDirection.value : null;
      return {
        state: state, label: state.toUpperCase(),
        tempF: cToF(p.temperature ? p.temperature.value : null),
        windDir: wdir == null ? 0 : Math.round(wdir),
        windKt: wspdKmh == null ? 0 : Math.round(wspdKmh / 1.852),
        visSM: visDisplay(visSm), station: METAR_STATION
      };
    });
  }
  function getWeather() {
    var now = Date.now();
    if (wxCache && (now - wxAt) < WX_TTL) return Promise.resolve(wxCache);
    return fetchWeather().then(function (w) {
      wxCache = w; wxAt = now; return w;
    })['catch'](function () { return wxCache; });  // keep last good / null
  }

  // ---- snapshot: the object the engine consumes ---------------------------
  function toFlightDict(ac) {
    return {
      hex: ac.hex, label: (ac.callsign || ac.reg || ac.hex || '??').trim(),
      reg: ac.reg, type: ac.type,
      alt_ft: r0(ac.alt_ft), on_ground: ac.on_ground, gs_kt: r0(ac.gs_kt),
      track: r0(ac.track), vrate_fpm: r0(ac.vrate_fpm), squawk: ac.squawk,
      origin: ac.origin, dest: ac.dest, origin_city: ac.origin_city, dest_city: ac.dest_city,
      distance_nm: r1(ac.distance_nm), bearing: r1(ac.bearing),
      compass: ac.distance_nm ? compass(ac.bearing) : '', tag: ac.tag, visible: ac.visible
    };
  }

  function getSnapshot() {
    var s = loadSettings();
    var raw;
    return fetchFlights(GEG_LAT, GEG_LON, s.radius_nm).then(function (list) {
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
      return Promise.all([enrichRoutes(flights, 6), getWeather()]).then(function (res) {
        var weather = res[1] || null;
        var dicts = flights.map(toFlightDict), counts = {};
        for (var k = 0; k < dicts.length; k++)
          counts[dicts[k].tag] = (counts[dicts[k].tag] || 0) + 1;
        return {
          flights: dicts, counts: counts, source: 'airplanes.live', error: null,
          tracking: dicts.length, radius_nm: s.radius_nm,
          location_label: s.location_label, airport: 'GEG', weather: weather, live: true
        };
      });
    });
  }

  window.AeroData = {
    getSnapshot: getSnapshot,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    DEFAULTS: DEFAULTS,
    THEMES: THEMES
  };
})();
