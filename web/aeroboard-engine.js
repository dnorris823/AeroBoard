/* AeroBoard themeable pixel-art engine.
   Faithful port of dnorris823/AeroBoard web/index.html (board/detail/radar views) + an
   in-canvas settings view + theming: palette, pixel font, scene art, split-flap, CRT.
   window.AeroBoard.mount(canvas, themeId, opts).

   App integration (opts):
   - opts.timeZone   IANA tz used for the on-screen clock and the "auto" theme (default America/Los_Angeles).
   - opts.lat/lon    board location; drives the local sunrise/sunset the "auto" theme blends to
                     (defaults to GEG / Spokane).
   - opts.onSettings callback for the header ⚙ (the app routes it to /settings); falls back to the
                     in-canvas settings view when omitted.
   - opts.data       initial data snapshot (defaults to the offline SAMPLE below).
   The returned handle exposes { destroy, setData, setTheme, setTimeZone } so the page can feed it
   live /api/flights data, change the look, and retune the clock to the board location at runtime.

   themeId "auto" tracks the real sun: it computes local sunrise/sunset from lat/lon (no
   network) and continuously blends the dawn/day/dusk/night keyframes (palette, sky, sun
   position and stars) as the sun crosses those events, so the board's sky matches the real
   sky outside. If sun times are unavailable (polar day/night) it falls back to fixed clock
   hours. A window.AeroBoardSunTest = { min, sunrise, sunset } override forces a time (dev).

   Two scene modes:
   - band  (t1 themes): a 40px living-airport strip along the bottom.
   - full  (t2 themes): a dense, full-bleed airport landscape covering the whole screen,
     with the UI floating on translucent "smoked-glass" panels. These render at a higher
     internal resolution (512x288) for finer pixels; the UI is drawn in the original
     384x216 logical space and scaled up, so its chrome stays chunky over a detailed world. */
(function () {
  // ---- offline sample (verbatim from the repo, +1 GA for a fuller board) ----
  const SAMPLE = {
    radius_nm: 40, source: 'airplanes.live', error: null, tracking: 6,
    location_label: 'GEG · Spokane Intl',
    counts: { APPROACH: 2, DEPARTURE: 1, GA: 2, OVERFLIGHT: 1 },
    flights: [
      { hex: 'a1b2c3', label: 'SKW5612', reg: 'N612SY', type: 'E75L', alt_ft: 2900, on_ground: false, gs_kt: 139, track: 210, vrate_fpm: -640, squawk: '4571', origin: 'SEA', dest: 'GEG', origin_city: 'Seattle', dest_city: 'Spokane', airline_name: 'SkyWest Airlines', airline_iata: 'OO', airline_icao: 'SKW', airline_country: 'US', distance_nm: 2.9, bearing: 41, compass: 'NE', tag: 'APPROACH' },
      { hex: 'a2c4e6', label: 'DAL1853', reg: 'N301DN', type: 'A320', alt_ft: 5400, on_ground: false, gs_kt: 216, track: 225, vrate_fpm: -900, squawk: '3422', origin: 'SLC', dest: 'GEG', origin_city: 'Salt Lake City', dest_city: 'Spokane', airline_name: 'Delta Air Lines', airline_iata: 'DL', airline_icao: 'DAL', airline_country: 'US', distance_nm: 11.1, bearing: 47, compass: 'NE', tag: 'APPROACH' },
      { hex: 'b3d5f7', label: 'N7908L', reg: 'N7908L', type: 'BE23', alt_ft: 3275, on_ground: false, gs_kt: 96, track: 90, vrate_fpm: 520, squawk: '1200', origin: null, dest: null, distance_nm: 0.9, bearing: 135, compass: 'SE', tag: 'DEPARTURE' },
      { hex: 'c4e6a8', label: 'N738BS', reg: 'N738BS', type: 'C172', alt_ft: 3300, on_ground: false, gs_kt: 103, track: 20, vrate_fpm: 0, squawk: '1200', origin: null, dest: null, distance_nm: 6.2, bearing: 20, compass: 'NNE', tag: 'GA' },
      { hex: 'e0a1b2', label: 'N512CP', reg: 'N512CP', type: 'PA28', alt_ft: 4100, on_ground: false, gs_kt: 88, track: 160, vrate_fpm: 200, squawk: '1200', origin: null, dest: null, distance_nm: 9.4, bearing: 300, compass: 'NW', tag: 'GA' },
      { hex: 'd5f7b9', label: 'ACA109', reg: 'C-GHQY', type: 'A321', alt_ft: 34000, on_ground: false, gs_kt: 358, track: 300, vrate_fpm: 0, squawk: '2701', origin: 'YVR', dest: 'SFO', origin_city: 'Vancouver', dest_city: 'San Francisco', airline_name: 'Air Canada', airline_iata: 'AC', airline_icao: 'ACA', airline_country: 'CA', distance_nm: 22, bearing: 300, compass: 'NW', tag: 'OVERFLIGHT' },
    ],
  };

  // ---- time-of-day keyframes ------------------------------------------------
  // The four phases (night/dawn/day/dusk) are keyframes the "auto" theme blends
  // between as the real sun moves (see sunTimesLocal / mixAt). Each holds a glass
  // HUD palette (C) and a full-scene palette (S). The palettes are authored so
  // they interpolate cleanly: every sky keeps its *upper* stops in the cool
  // blue -> indigo -> near-black family and concentrates warmth in the horizon
  // stop, so day<->dusk<->night never cross through muddy grey mid-blend.
  const TOD_INK = { ink: '#f4ecd8', dim: '#a9b6cf', faint: '#5f6f90', amber: '#ffbe5f', green: '#6bf0ac', blue: '#7cc0ff', red: '#ff7676' };
  const TOD_KF = {
    night: {
      C: { bg: '#060a14', glow: '#ffd48f', panel: 'rgba(11,18,34,0.60)', panelHi: 'rgba(28,46,76,0.66)', inner: 'rgba(6,11,22,0.55)', glassList: 'rgba(7,13,26,0.46)', line: '#2b4168', ring: 'rgba(107,240,172,0.28)' },
      S: {
        night: true, hy: 196, winLit: 1, lights: 1, sky: ['#050a18', '#0b1730', '#1e3559'],
        ground: '#0a1712', ground2: '#0d1f17', apron: '#0b1a20', far: '#0e2035', mid: '#122a44', near: '#0a1a2e',
        struct: '#122437', structDark: '#0c1a2a', roof: '#1a3453', metal: '#8294b0',
        win: '#ffcf87', winOff: '#243a54', runway: '#161f2e', center: '#3a4a66',
        edge: '#ffdf9a', papiR: '#ff5b5b', taxi: '#5aa9ff', tree: '#0c261c',
        plane: '#cdd9ec', planeDk: '#8a99b4', tail: '#6db4ff',
      },
    },
    dawn: {
      C: { bg: '#171334', glow: '#ffcaa0', panel: 'rgba(26,22,46,0.58)', panelHi: 'rgba(54,44,78,0.64)', inner: 'rgba(18,15,34,0.55)', glassList: 'rgba(20,17,38,0.46)', line: '#4a3f68', ring: 'rgba(107,240,172,0.26)' },
      S: {
        night: false, hy: 196, winLit: 0.6, lights: 0.5, sky: ['#141f47', '#4a4a72', '#e5975f'],
        ground: '#2a2436', ground2: '#332b40', apron: '#2b2438', far: '#4a3f63', mid: '#6a5580', near: '#3a3350',
        struct: '#3a3348', structDark: '#2a2436', roof: '#4a3f63', metal: '#9a90b0',
        win: '#ffd9a0', winOff: '#3a3550', runway: '#2e2838', center: '#6a5f7a',
        edge: '#ffe0b0', papiR: '#ff7b6b', taxi: '#8ab0d4', tree: '#2a3a44',
        plane: '#e6dcee', planeDk: '#a898b8', tail: '#e88ab0',
      },
    },
    day: {
      C: { bg: '#28394a', glow: '#ffe9a8', panel: 'rgba(14,22,36,0.64)', panelHi: 'rgba(30,48,70,0.68)', inner: 'rgba(8,14,24,0.60)', glassList: 'rgba(10,16,28,0.52)', line: '#33506e', ring: 'rgba(107,240,172,0.30)' },
      S: {
        night: false, hy: 196, winLit: 0, lights: 0.15, sky: ['#3f86cf', '#79b2e6', '#c4e2f2'],
        ground: '#42582f', ground2: '#52683a', apron: '#6a6a58', far: '#7fa0b0', mid: '#6a94a0', near: '#587a68',
        struct: '#8a8478', structDark: '#6a6458', roof: '#9a5040', metal: '#d8d4c8',
        win: '#bcd8f0', winOff: '#8a97a4', runway: '#8a8478', center: '#e8e4d8',
        edge: '#fffbe0', papiR: '#d1403a', taxi: '#3f8fb0', tree: '#33521f',
        plane: '#f4f0e8', planeDk: '#b8b4a8', tail: '#3f7fb0',
      },
    },
    dusk: {
      C: { bg: '#38272d', glow: '#ffdf8f', panel: 'rgba(32,22,26,0.58)', panelHi: 'rgba(60,40,44,0.64)', inner: 'rgba(22,14,16,0.55)', glassList: 'rgba(26,16,18,0.46)', line: '#5c4038', ring: 'rgba(107,240,172,0.26)' },
      S: {
        night: false, hy: 194, winLit: 0.85, lights: 0.7, sky: ['#2f4d84', '#c06a52', '#f28347'],
        ground: '#3a2b22', ground2: '#463328', apron: '#4a3629', far: '#a86a55', mid: '#8a5450', near: '#5e3f47',
        struct: '#5a4236', structDark: '#402e26', roof: '#6e5040', metal: '#d8c49a',
        win: '#ffe6a3', winOff: '#7a5a44', runway: '#4a382e', center: '#c9a878',
        edge: '#ffe9b0', papiR: '#d1573e', taxi: '#3f9fb0', tree: '#3a5238',
        plane: '#f4ead6', planeDk: '#caa87e', tail: '#e8a13c',
      },
    },
  };
  // ---- time-of-day builder: one glass HUD, scene swaps with the clock ----
  function TOD(scene3, glassC) {
    return {
      id: scene3 + '3', font: "'Space Mono', monospace", fontSize: 0,
      scene: 'none', scene3: scene3, flap: 'subtle', crt: false, grain: true,
      W: 512, H: 288, fullScene: true, glass: true,
      C: Object.assign({ sky: ['#000', '#000', '#000'] }, TOD_INK, glassC || TOD_KF[scene3].C),
    };
  }
  function WTH(scene3, weather, glassC) {
    const th = TOD(scene3, glassC); th.id = weather + '4'; th.weather = weather; return th;
  }
  // ATIS/METAR readout per weather state
  const WX = {
    clear:    { label: 'CLEAR',    tempF: 54, windDir: 230, windKt: 6,  visSM: '10SM' },
    overcast: { label: 'OVERCAST', tempF: 43, windDir: 200, windKt: 11, visSM: '6SM' },
    rain:     { label: 'RAIN',     tempF: 47, windDir: 210, windKt: 15, visSM: '3SM' },
    snow:     { label: 'SNOW',     tempF: 28, windDir: 340, windKt: 9,  visSM: '1SM' },
    fog:      { label: 'FOG',      tempF: 38, windDir: 150, windKt: 3,  visSM: '1/4SM' },
  };

  // ---- airline brand colors -------------------------------------------------
  // Keyed by ICAO callsign prefix (SWA284 -> SWA) so a brand chip can show from
  // the callsign alone, even before adsbdb resolves the airline. Each entry is
  // [primary, secondary] approximating the carrier's livery. Colors are only
  // ever painted inside self-contained chips/bars (which carry their own
  // contrast), so they stay legible across all 15 themes. Unknown carriers get
  // no chip and fall back to today's plain layout. AIRLINE_IATA supplies the
  // two-letter badge code when adsbdb hasn't (yet) returned one.
  const AIRLINE_BRAND = {
    // US mainline
    AAL: ['#0078d2', '#c8102e'], DAL: ['#1a3668', '#e01933'], UAL: ['#005daa', '#1f2a44'],
    SWA: ['#304cb2', '#f9b612'], ASA: ['#01426a', '#54c0e8'], JBU: ['#003876', '#00a1de'],
    NKS: ['#ffec00', '#1a1a1a'], FFT: ['#00854a', '#1f6b3b'], HAL: ['#4c0f6b', '#e6007e'],
    AAY: ['#003087', '#f47920'], SCX: ['#00539b', '#e01933'], MXY: ['#0033a0', '#6cace4'],
    VXP: ['#f37021', '#4b2e83'],
    // US regionals (often the actual metal near GEG)
    SKW: ['#0a4d8c', '#8f9fb3'], ENY: ['#0078d2', '#c8102e'], RPA: ['#0033a0', '#da291c'],
    EDV: ['#1a3668', '#e01933'], ASH: ['#0a4d8c', '#9aa6b5'], QXE: ['#01426a', '#54c0e8'],
    JIA: ['#0078d2', '#c8102e'], AWI: ['#005daa', '#9aa6b5'], GJS: ['#0a4d8c', '#9aa6b5'],
    // Canada
    ACA: ['#d81e05', '#1a1a1a'], WJA: ['#0f3583', '#00a2e1'], JZA: ['#d81e05', '#6b7280'],
    ROU: ['#8a1538', '#d81e05'], POE: ['#003da5', '#6b7280'], FLE: ['#00a94f', '#1a1a1a'],
    SWG: ['#f58220', '#003da5'], TSC: ['#00539b', '#0093d0'],
    // Cargo
    FDX: ['#4d148c', '#ff6600'], UPS: ['#4f3222', '#ffb500'], GTI: ['#0a4d8c', '#9aa6b5'],
    ABX: ['#0033a0', '#9aa6b5'], CKS: ['#00539b', '#9aa6b5'],
  };
  const AIRLINE_IATA = {
    AAL: 'AA', DAL: 'DL', UAL: 'UA', SWA: 'WN', ASA: 'AS', JBU: 'B6', NKS: 'NK', FFT: 'F9',
    HAL: 'HA', AAY: 'G4', SCX: 'SY', MXY: 'MX', VXP: 'XP', SKW: 'OO', ENY: 'MQ', RPA: 'YX',
    EDV: '9E', ASH: 'YV', QXE: 'QX', JIA: 'OH', AWI: 'ZW', GJS: 'G7', ACA: 'AC', WJA: 'WS',
    JZA: 'QK', ROU: 'RV', POE: 'PD', FLE: 'F8', SWG: 'WG', TSC: 'TS', FDX: 'FX', UPS: '5X',
    GTI: '5Y', ABX: 'GB', CKS: 'K4',
  };

  // ============================ THEMES ============================
  const THEMES = {
    // ---- t1: band scene, opaque panels, 384x216 ----
    night: {
      id: 'night', font: "'Space Mono', monospace", fontSize: 0,
      scene: 'night', flap: 'subtle', crt: false, grain: true,
      C: {
        bg: '#070b16', panel: '#0d1526', panelHi: '#152238', line: '#243b5c',
        inner: '#0a0e16', ring: '#173327',
        ink: '#f3ead6', dim: '#8aa0c4', faint: '#4a5c80',
        amber: '#ffb454', green: '#5fe3a1', blue: '#6db4ff', red: '#ff6b6b',
        glow: '#ffcf87', sky: ['#0a1730', '#122a4d', '#26507f'],
      },
    },
    poster: {
      id: 'poster', font: "'Space Mono', monospace", fontSize: 0,
      scene: 'sunset', flap: 'full', crt: false, grain: true,
      C: {
        bg: '#f2e6cf', panel: '#1d3a4a', panelHi: '#264d61', line: '#0e2530',
        inner: '#0c2430', ring: '#2a4c3e',
        ink: '#f7efe0', dim: '#c9b48c', faint: '#8a9aa0',
        amber: '#e8a13c', green: '#3fae82', blue: '#2f7f9e', red: '#d1573e',
        glow: '#f2c14e', sky: ['#f4b45f', '#e88a4d', '#c85d4e'],
      },
    },
    crt: {
      id: 'crt', font: "'VT323', monospace", fontSize: 2,
      scene: 'none', flap: 'none', crt: true, grain: false,
      C: {
        bg: '#020604', panel: '#04120b', panelHi: '#07200f', line: '#0d3a1f',
        inner: '#04120b', ring: '#0d3a1f',
        ink: '#7dffb0', dim: '#3fae74', faint: '#1f6b45',
        amber: '#ffcf5c', green: '#7dffb0', blue: '#5fd0ff', red: '#ff7a5c',
        glow: '#7dffb0', sky: ['#03140c', '#062012', '#0a3019'],
      },
    },

    // ---- t2: full-bleed dense landscape, glass panels, 512x288 ----
    night2: {
      id: 'night2', font: "'Space Mono', monospace", fontSize: 0,
      scene: 'none', scene2: 'night', flap: 'subtle', crt: false, grain: true,
      W: 512, H: 288, fullScene: true, glass: true,
      C: {
        bg: '#060a14',
        panel: 'rgba(11,18,34,0.60)', panelHi: 'rgba(28,46,76,0.68)',
        inner: 'rgba(6,11,22,0.55)', glassList: 'rgba(7,13,26,0.46)',
        line: '#2b4168', ring: 'rgba(95,227,161,0.28)',
        ink: '#f4ecd8', dim: '#9fb2d0', faint: '#5a6c90',
        amber: '#ffbe5f', green: '#6bf0ac', blue: '#7cc0ff', red: '#ff7676',
        glow: '#ffd48f', sky: ['#050a18', '#0b1730', '#22406a'],
      },
    },
    poster2: {
      id: 'poster2', font: "'Space Mono', monospace", fontSize: 0,
      scene: 'none', scene2: 'sunset', flap: 'full', crt: false, grain: true,
      W: 512, H: 288, fullScene: true, glass: true,
      C: {
        bg: '#3a2a30',
        panel: 'rgba(18,46,60,0.64)', panelHi: 'rgba(32,66,82,0.72)',
        inner: 'rgba(10,34,44,0.60)', glassList: 'rgba(13,40,52,0.50)',
        line: '#0c2732', ring: 'rgba(63,174,130,0.32)',
        ink: '#fbf3e2', dim: '#e3c896', faint: '#b79a8e',
        amber: '#ffb24a', green: '#5cc79a', blue: '#57b0d4', red: '#e8674a',
        glow: '#ffdf8f', sky: ['#f6c765', '#ef9450', '#cf5f4f'],
      },
    },

    // ---- t3: time-of-day set (palettes live in TOD_KF above) ----
    dawn3: TOD('dawn'),
    day3: TOD('day'),
    dusk3: TOD('dusk'),
    night3: TOD('night'),

    // ---- t4: weather set (time-of-day HUD + weather in scene & ATIS ribbon) ----
    ovc4: WTH('day', 'overcast'),
    rain4: WTH('dusk', 'rain'),
    snow4: WTH('night', 'snow'),
    fog4: WTH('dawn', 'fog'),
  };

  const TAGMAP = (C) => ({
    APPROACH: C.amber, DEPARTURE: C.blue, GA: C.green,
    OVERFLIGHT: C.faint, TRANSIT: C.dim, GROUND: C.faint,
  });
  // Low, near-the-field traffic — the planes you can plausibly spot from the
  // ground. Emphasized on the radar (was the old "visible" flag).
  const NEAR_TAGS = { APPROACH: 1, DEPARTURE: 1, GA: 1 };

  function hexA(hex, a) {
    if (hex[0] !== '#') return hex;
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---- colour blending (hex or rgba() -> interpolated rgba() string) --------
  const lerp = (a, b, f) => a + (b - a) * f;
  const smooth = (f) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f));
  function parseCol(c) {
    if (typeof c !== 'string') return [0, 0, 0, 1];
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 1];
    const p = m[1].split(',').map(Number);
    return [p[0], p[1], p[2], p[3] == null ? 1 : p[3]];
  }
  function mix(c1, c2, f) {
    if (f <= 0) return c1; if (f >= 1) return c2;
    const a = parseCol(c1), b = parseCol(c2);
    return `rgba(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))},${(+lerp(a[3], b[3], f).toFixed(3))})`;
  }
  // blend two TOD scene palettes (TOD_KF[*].S) — numbers lerp, colours mix
  const S_NUM = ['hy', 'winLit', 'lights'];
  const S_COL = ['ground', 'ground2', 'apron', 'far', 'mid', 'near', 'struct', 'structDark', 'roof', 'metal', 'win', 'winOff', 'runway', 'center', 'edge', 'papiR', 'taxi', 'tree', 'plane', 'planeDk', 'tail'];
  function blendScene(A, B, f) {
    const o = {};
    for (const k of S_NUM) o[k] = lerp(A[k], B[k], f);
    for (const k of S_COL) o[k] = mix(A[k], B[k], f);
    o.sky = [mix(A.sky[0], B.sky[0], f), mix(A.sky[1], B.sky[1], f), mix(A.sky[2], B.sky[2], f)];
    return o;
  }
  // blend two glass HUD palettes (TOD_KF[*].C) into a live C for the auto theme
  const C_KEYS = ['bg', 'glow', 'panel', 'panelHi', 'inner', 'glassList', 'line', 'ring'];
  function blendGlass(A, B, f) {
    const o = Object.assign({ sky: ['#000', '#000', '#000'] }, TOD_INK);
    for (const k of C_KEYS) o[k] = mix(A[k], B[k], f);
    return o;
  }

  // ---- local sunrise / sunset (NOAA sunrise equation, no network) -----------
  // Minutes to add to UTC to reach the board's wall clock at `date`.
  function tzOffsetMin(tz, date) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((o) => [o.type, o.value]));
    const h = p.hour === '24' ? 0 : +p.hour;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute, +p.second);
    return Math.round((asUTC - date.getTime()) / 60000);
  }
  // sunrise/sunset for `date` at lat/lon, expressed as minutes past local
  // midnight (using tzMin). Returns null on polar day/night (caller falls back).
  function sunTimesLocal(lat, lon, tzMin, date) {
    const rad = Math.PI / 180;
    const J = date.getTime() / 86400000 + 2440587.5;          // Julian date (UTC)
    const n = Math.round(J - 2451545.0 + 0.0008);
    const Js = n - lon / 360;                                  // mean solar noon
    const M = (357.5291 + 0.98560028 * Js) % 360;             // solar mean anomaly
    const Mr = M * rad;
    const Ceq = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    const L = (M + Ceq + 180 + 102.9372) % 360;               // ecliptic longitude
    const Lr = L * rad;
    const Jtransit = 2451545.0 + Js + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * Lr);
    const decl = Math.asin(Math.sin(Lr) * Math.sin(23.44 * rad));
    const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
    if (cosH >= 1 || cosH <= -1) return null;                 // sun never rises / never sets
    const H = Math.acos(cosH) / rad;
    const toLocalMin = (Jd) => (((Jd + 0.5) % 1) * 1440 + tzMin + 1440) % 1440;  // Julian day .0 = noon UTC
    return { sunrise: toLocalMin(Jtransit - H / 360), sunset: toLocalMin(Jtransit + H / 360) };
  }
  // Which two phase keyframes the sun sits between right now, and the blend
  // fraction. dawn/dusk are ~W-min ramps centred on the real sunrise/sunset;
  // day and night are plateaus. Returns { a, b, f }.
  function mixAt(m, SR, SS, W) {
    let dawnB = SR + W, duskA = SS - W;
    if (dawnB > duskA) { const mid = (SR + SS) / 2; dawnB = duskA = mid; }  // very short day
    if (m < SR - W || m >= SS + W) return { a: 'night', b: 'night', f: 0 };
    if (m < SR)     return { a: 'night', b: 'dawn', f: smooth((m - (SR - W)) / W) };
    if (m < dawnB)  return { a: 'dawn', b: 'day', f: smooth((m - SR) / (dawnB - SR)) };
    if (m < duskA)  return { a: 'day', b: 'day', f: 0 };
    if (m < SS)     return { a: 'day', b: 'dusk', f: smooth((m - duskA) / (SS - duskA)) };
    return { a: 'dusk', b: 'night', f: smooth((m - SS) / W) };
  }

  // ============================ ENGINE ============================
  function mount(canvas, themeId, opts) {
    opts = opts || {};
    // TZ/TZABBR are mutable: the page resolves the *location's* IANA zone
    // asynchronously (from lat/lon) and pushes it in via setTimeZone(), so the
    // clock and "auto" theme run on local-to-the-board time, not the device's.
    let TZ = opts.timeZone || 'America/Los_Angeles';
    // Short zone abbreviation for the footer clock (e.g. PDT, CEST, GMT+9),
    // derived from TZ so it follows the location instead of a hardcoded "PT".
    function zoneAbbr(tz) {
      try {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
          .formatToParts(new Date()).find(o => o.type === 'timeZoneName');
        return p ? p.value : '';
      } catch (e) { return ''; }
    }
    let TZABBR = zoneAbbr(TZ);

    // The board's location drives the local sunrise/sunset used by "auto".
    const LAT = opts.lat != null ? +opts.lat : 47.6199;
    const LON = opts.lon != null ? +opts.lon : -117.5339;
    const RAMP = 55;   // minutes each side of sunrise/sunset for the dawn/dusk blend

    // Today's sun times, recomputed when the local date rolls over. Null on
    // polar day/night, which sends the auto theme to the fixed-hour fallback.
    let sunDay = '', sunT = null;
    function sunTimes() {
      const now = new Date();
      const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      if (key !== sunDay) { sunDay = key; sunT = sunTimesLocal(LAT, LON, tzOffsetMin(TZ, now), now); }
      return sunT;
    }
    function nowMin() {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()).map((o) => [o.type, o.value]));
      return (p.hour === '24' ? 0 : +p.hour) * 60 + +p.minute;
    }
    // Fixed clock-hour phase, used when sun times are unavailable.
    function autoPhase() {
      const h = (nowMin() / 60) | 0;
      if (h >= 5 && h < 8) return 'dawn';
      if (h >= 8 && h < 18) return 'day';
      if (h >= 18 && h < 21) return 'dusk';
      return 'night';
    }
    function autoThemeId() { return autoPhase() + '3'; }
    // The live auto theme: a full-scene glass HUD whose palette + phase blend
    // is recomputed every frame from the sun's position (see loop()).
    const AUTO = TOD('night'); AUTO.id = 'auto';
    let MIX = null;   // { a, b, f } phase blend consumed by P(); null => static theme

    let autoMode = (themeId === 'auto');
    let curId = autoMode ? 'auto' : (THEMES[themeId] ? themeId : 'night');
    let theme = autoMode ? AUTO : (THEMES[curId] || THEMES.night);
    let C = theme.C;
    let TAG = TAGMAP(C);
    let FS = theme.fontSize || 0;

    // UI logical space is always 384x216; the canvas may be larger (finer pixels).
    const W = 384, H = 216;
    // Device supersample: paint the whole board onto a backing store RES× denser
    // than the native pixel grid, so text, radar rings, gradients and every
    // diagonal/curve rasterize at RES× the detail. The rect-based pixel art keeps
    // its on-screen block size (still pixely) — this only sharpens, never reflows.
    // The CSS on #screen upscales the canvas to fill the panel; a denser backing
    // store means that upscale magnifies far less, killing the chunky look.
    // RES 3 lands near-native on a retina iPad (DPR 2) for the crispest text/curves.
    const RES = 3;
    let CW = theme.W || 384, CH = theme.H || 216;
    let uiScale = CW / W;
    const ctx = canvas.getContext('2d');
    canvas.width = CW * RES; canvas.height = CH * RES;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // swap the active theme in place (palette + scene); resize the canvas if the
    // new theme renders at a different internal resolution.
    function applyTheme(id) {
      curId = id; theme = (id === 'auto') ? AUTO : THEMES[id]; C = theme.C; TAG = TAGMAP(C); FS = theme.fontSize || 0;
      const nCW = theme.W || 384, nCH = theme.H || 216;
      if (nCW !== CW || nCH !== CH) { CW = nCW; CH = nCH; canvas.width = CW * RES; canvas.height = CH * RES; uiScale = CW / W; }
    }
    // Recompute the sun-driven phase blend for the current instant. A
    // window.AeroBoardSunTest = { min, sunrise, sunset } override forces a time
    // (used for previewing transitions). Updates MIX + the live AUTO palette.
    function updateAuto() {
      const ov = (typeof window !== 'undefined') && window.AeroBoardSunTest;
      let m, SR, SS;
      if (ov) { m = ov.min; SR = ov.sunrise; SS = ov.sunset; }
      else { const st = sunTimes(); if (st) { m = nowMin(); SR = st.sunrise; SS = st.sunset; } }
      MIX = (SR != null && SS != null) ? mixAt(m, SR, SS, RAMP) : (() => { const ph = autoPhase(); return { a: ph, b: ph, f: 0 }; })();
      AUTO.scene3 = MIX.f < 0.5 ? MIX.a : MIX.b;
      AUTO.C = blendGlass(TOD_KF[MIX.a].C, TOD_KF[MIX.b].C, MIX.f);
      C = AUTO.C; TAG = TAGMAP(C);
    }

    let data = opts.data || SAMPLE;
    let view = 'board';
    let selectedHex = null;
    let sweep = 0, beacon = 0, t = 0, lastT = performance.now();
    let hits = [];

    // ---- flight-list scroll + sort/filter state (board view) ----
    // The main list can hold more flights than fit on screen, so it scrolls
    // (drag / wheel / arrow buttons). A pop-over lets you re-sort and filter it.
    let listScrollY = 0;          // px scrolled down within the list viewport
    let scrollMax = 0;            // max scroll for the current list (0 = no scroll)
    let listBox = null;           // { x, y, w, h } of the scroll viewport, for drag/wheel
    let filterOpen = false;       // is the sort/filter pop-over showing
    const ALL_TAGS = ['APPROACH', 'DEPARTURE', 'GA', 'OVERFLIGHT', 'TRANSIT', 'GROUND'];
    const sortState = { key: 'distance', dir: 1 };   // key: distance|altitude, dir: 1 asc / -1 desc
    const filterState = { tags: {}, airborneOnly: false };
    ALL_TAGS.forEach(tg => { filterState.tags[tg] = true; });
    // Apply the current filter + sort to a flight list (returns a new array).
    function applyView(flights) {
      const out = flights.filter(ac =>
        filterState.tags[ac.tag] !== false && (!filterState.airborneOnly || !ac.on_ground));
      const dir = sortState.dir;
      out.sort((a, b) => {
        let av, bv;
        if (sortState.key === 'altitude') {
          av = a.alt_ft == null ? -Infinity : a.alt_ft;
          bv = b.alt_ft == null ? -Infinity : b.alt_ft;
        } else {
          av = a.distance_nm == null ? Infinity : a.distance_nm;
          bv = b.distance_nm == null ? Infinity : b.distance_nm;
        }
        return av === bv ? 0 : (av < bv ? -1 : 1) * dir;
      });
      return out;
    }
    const filtersActive = () =>
      filterState.airborneOnly || ALL_TAGS.some(tg => filterState.tags[tg] === false);

    const findFlight = (hex) => data.flights.find(f => f.hex === hex);
    const addHit = (x, y, w, h, fn) => hits.push({ x, y, w, h, fn });

    // ---- active weather ---------------------------------------------------
    // A fixed "weather scene" theme (t4) keeps its own baked-in condition. A
    // time-of-day theme (dawn/day/dusk/night, and "auto" which cycles them)
    // instead shows the *live* METAR pushed in via setData, so the sky over the
    // board matches the sky over GEG. Returns null when there's nothing to show.
    const liveWx = () => (data.weather && data.weather.state) ? data.weather : null;
    function wxState() {
      if (theme.weather) return theme.weather;
      if (theme.scene3 && liveWx()) return liveWx().state;
      return null;
    }
    function wxInfo() {
      const st = wxState();
      if (!st) return null;
      if (!theme.weather && liveWx() && liveWx().state === st) return liveWx();
      return WX[st];
    }

    // ---- text (adds a soft shadow over the busy full scene for legibility) ----
    function text(s, x, y, color, size = 11, o = {}) {
      const b = o.bold ? 'bold ' : '';
      ctx.font = `${b}${size + FS}px ${theme.font}`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = color;
      ctx.textAlign = o.center ? 'center' : (o.right ? 'right' : 'left');
      if (o.glow) { ctx.shadowColor = o.glow === true ? color : o.glow; ctx.shadowBlur = 6; }
      else if (theme.fullScene) { ctx.shadowColor = 'rgba(0,0,0,.72)'; ctx.shadowBlur = 2; }
      ctx.fillText(s, x, y);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
    }
    function bearingTri(cx, cy, deg, size, color) {
      const a = deg * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), px = Math.cos(a), py = Math.sin(a);
      ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(cx + dx * size, cy + dy * size);
      ctx.lineTo(cx - dx * size * .7 + px * size * .6, cy - dy * size * .7 + py * size * .6);
      ctx.lineTo(cx - dx * size * .7 - px * size * .6, cy - dy * size * .7 - py * size * .6);
      ctx.fill();
    }
    function vtri(x, y, color, up) {
      ctx.fillStyle = color; ctx.beginPath();
      if (up) { ctx.moveTo(x + 3, y); ctx.lineTo(x, y + 5); ctx.lineTo(x + 6, y + 5); }
      else { ctx.moveTo(x, y); ctx.lineTo(x + 6, y); ctx.lineTo(x + 3, y + 5); }
      ctx.fill();
    }
    const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
    function stroke(x, y, w, h, c) { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); }

    // ---- airline branding -------------------------------------------------
    // ICAO key for an aircraft: adsbdb's airline ICAO when known, else the
    // callsign prefix (SWA284 -> SWA). Returns null unless we have a brand color.
    function brandKey(ac) {
      const icao = ac.airline_icao || ((/^([A-Z]{3})[0-9]/.exec(ac.label || '') || [])[1]);
      return icao && AIRLINE_BRAND[icao] ? icao : null;
    }
    const brandCode = (ac, key) => (ac.airline_iata || AIRLINE_IATA[key] || key || '').slice(0, 3);
    // black or white — whichever is legible on a solid brand color
    function inkOn(hex) {
      const h = hex.replace('#', '');
      const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#101010' : '#f5f5f5';
    }
    // Swept "tail fin" chip: brand primary fill, secondary base stripe, and the
    // IATA/ICAO code in a contrast-safe ink. Evokes an airline tail within the
    // pixel art without shipping any logo assets.
    function tailBadge(x, y, ac, key) {
      const c1 = AIRLINE_BRAND[key][0], c2 = AIRLINE_BRAND[key][1], w = 22, h = 20, skew = 5;
      ctx.fillStyle = c1; ctx.beginPath();
      ctx.moveTo(x + skew, y); ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
      rect(x, y + h - 3, w, 3, c2);   // two-tone base stripe
      text(brandCode(ac, key), x + skew + (w - skew) / 2, y + 5, inkOn(c1), 10, { center: true, bold: true });
    }
    // Vertical brand accent bar down the left edge of the detail header.
    function accentBar(key) {
      rect(4, 20, 3, 40, AIRLINE_BRAND[key][0]);
      rect(4, 60, 3, 13, AIRLINE_BRAND[key][1]);
    }
    function clock() {
      const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const p = Object.fromEntries(f.formatToParts(new Date()).map(o => [o.type, o.value]));
      return { hhmm: `${p.hour}:${p.minute}`, hms: `${p.hour}:${p.minute}:${p.second}` };
    }
    function backButton(label = '‹ BACK') {
      text(label, 5, 3, C.amber, 11, { bold: true });
      addHit(0, 0, 78, 16, () => { view = 'board'; });
    }
    // ---- weather glyph + ATIS ribbon + compact chip ----
    function wxGlyph(x, y, type) {
      const cl = '#c6d0e0';
      if (type === 'clear') {
        rect(x + 3, y + 2, 5, 5, C.amber);
        [[x + 5, y - 1], [x + 5, y + 8], [x - 1, y + 4], [x + 10, y + 4]].forEach(r => rect(r[0], r[1], 1, 1, C.amber));
        return;
      }
      rect(x + 2, y + 1, 7, 2, cl); rect(x + 1, y + 3, 9, 2, cl);
      if (type === 'rain') [2, 5, 8].forEach(dx => rect(x + dx, y + 6, 1, 3, C.blue));
      else if (type === 'snow') [[2, 6], [5, 8], [8, 6]].forEach(d => rect(x + d[0], y + d[1], 1, 1, '#eef4fb'));
      else if (type === 'fog') { rect(x + 1, y + 6, 9, 1, cl); rect(x + 2, y + 8, 7, 1, cl); }
      else if (type === 'overcast') rect(x, y + 3, 5, 2, '#9aa6b8');
    }
    function drawWxRibbon(yy) {
      const w = wxInfo(); if (!w) return;
      const st = wxState();
      const live = !theme.weather;
      rect(0, yy, W, 13, C.panel); rect(0, yy + 13, W, 1, C.line);
      wxGlyph(5, yy + 2, st);
      text(w.label, 18, yy + 3, C.amber, 9, { bold: true });
      if (w.tempF != null) text(w.tempF + '°F', 90, yy + 3, C.ink, 9, { bold: true });
      bearingTri(132, yy + 8, w.windDir, 4, C.green);
      text(w.windDir + '° ' + w.windKt + 'KT', 140, yy + 3, C.green, 9);
      text('VIS ' + w.visSM, 224, yy + 3, C.dim, 9);
      text(live ? 'LIVE WX' : 'WX SCENE', W - 4, yy + 3, C.faint, 8, { right: true });
    }
    function wxMini(x, yy) {
      const w = wxInfo(); if (!w) return;
      wxGlyph(x, yy + 1, wxState());
      text(w.label + (w.tempF != null ? ' ' + w.tempF + '°' : ''), x + 14, yy + 2, C.dim, 9);
    }

    // ---- split-flap tile row ----
    function flapRow(str, x, y, cell, size, color) {
      const chars = String(str).split('');
      chars.forEach((ch, i) => {
        const cx = x + i * (cell + 1);
        rect(cx, y, cell, cell + 3, theme.glass ? 'rgba(5,8,14,0.85)' : '#0a0e16');
        rect(cx, y, cell, 1, 'rgba(255,255,255,.10)');
        rect(cx, y + Math.floor((cell + 3) / 2), cell, 1, 'rgba(0,0,0,.55)');
        text(ch, cx + cell / 2, y + 1, color, size, { center: true, bold: true });
      });
      return chars.length * (cell + 1);
    }

    // ---- radar widget ----
    function drawRadarWidget(d, cx, cy, R, big) {
      ctx.strokeStyle = C.ring; ctx.lineWidth = 1;
      for (const rr of [R, R * 2 / 3, R / 3]) { ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      if (big) {
        ['N', 'E', 'S', 'W'].forEach((lbl, i) => {
          const a = i * Math.PI / 2, x = cx + Math.sin(a) * (R + 6), y = cy - Math.cos(a) * (R + 6);
          text(lbl, x, y - 4, C.faint, 8, { center: true });
        });
      } else {
        text('N', cx, cy - R - 9, C.faint, 8, { center: true });
      }
      const gc = C.green;
      const g = ctx.createLinearGradient(cx, cy, cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R);
      g.addColorStop(0, hexA(gc, .55)); g.addColorStop(1, hexA(gc, 0));
      ctx.strokeStyle = g; ctx.lineWidth = big ? 2 : 1.5;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R); ctx.stroke();
      ctx.fillStyle = hexA(gc, .06); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, sweep - .5, sweep); ctx.closePath(); ctx.fill();
      for (const ac of d.flights) {
        if (!ac.distance_nm) continue;
        const rp = Math.min(1, ac.distance_nm / d.radius_nm) * R, a = ac.bearing * Math.PI / 180;
        const px = cx + rp * Math.sin(a), py = cy - rp * Math.cos(a);
        const near = !!NEAR_TAGS[ac.tag];
        const s = near ? (big ? 3 : 2) : (big ? 2 : 1);
        const col = TAG[ac.tag] || C.dim;
        if (near) { ctx.shadowColor = col; ctx.shadowBlur = 5; }
        rect(Math.round(px) - s / 2, Math.round(py) - s / 2, s, s, col);
        ctx.shadowBlur = 0;
        if (big) addHit(px - 6, py - 6, 12, 12, () => { selectedHex = ac.hex; view = 'detail'; });
      }
      rect(cx - 1, cy - 1, 2, 2, C.amber);
    }

    // ======================================================================
    //  BAND SCENE (t1) — 40px living-airport strip
    // ======================================================================
    function drawScene(x, y, w, h) {
      if (theme.scene === 'none') return;
      const sky = C.sky;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, sky[0]); g.addColorStop(.55, sky[1]); g.addColorStop(1, sky[2]);
      rect(x, y, w, h, '#000'); ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
      if (theme.scene === 'night') {
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        for (let i = 0; i < 26; i++) {
          const sx = x + ((i * 71) % w), sy = y + ((i * 37) % Math.floor(h * .5));
          ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i)); ctx.fillRect(sx, sy, 1, 1);
        }
        ctx.globalAlpha = 1;
      } else {
        const sunX = x + w * 0.16, sunY = y + h * 0.42;
        ctx.fillStyle = C.glow; ctx.beginPath(); ctx.arc(sunX, sunY, 9, 0, 7); ctx.fill();
        ctx.fillStyle = hexA(C.glow, .18); ctx.beginPath(); ctx.arc(sunX, sunY, 15, 0, 7); ctx.fill();
      }
      const gy = y + h - 10;
      rect(x, gy, w, h - (gy - y), theme.scene === 'night' ? '#06120c' : '#3a2a22');
      for (let i = 0; i < 8; i++) { const lx = x + 40 + i * ((w - 70) / 8); rect(lx, gy - 1, 1, 2, i % 2 ? '#ff5b5b' : C.glow); }
      rect(x + 10, gy - 9, 22, 9, theme.scene === 'night' ? '#0d1c2b' : '#5a4236');
      ctx.fillStyle = theme.scene === 'night' ? '#14283c' : '#6e5040';
      ctx.beginPath(); ctx.moveTo(x + 10, gy - 9); ctx.lineTo(x + 21, gy - 13); ctx.lineTo(x + 32, gy - 9); ctx.fill();
      rect(x + 18, gy - 5, 6, 5, hexA(C.glow, .5));
      const tx = x + w - 60;
      rect(tx, gy - 26, 6, 26, theme.scene === 'night' ? '#122236' : '#6b5040');
      rect(tx - 3, gy - 34, 12, 9, theme.scene === 'night' ? '#1b3350' : '#7d5f49');
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 2); rect(tx - 2, gy - 33, 10, 5, C.glow); ctx.globalAlpha = 1;
      const on = Math.sin(beacon) > 0.4;
      rect(tx + 3, gy - 37, 2, 2, on ? '#5fe3a1' : '#183a2a');
      const wx = x + w - 20; rect(wx, gy - 12, 1, 12, '#7a8aa4');
      ctx.fillStyle = C.amber; ctx.beginPath(); ctx.moveTo(wx + 1, gy - 12); ctx.lineTo(wx + 9, gy - 11); ctx.lineTo(wx + 9, gy - 8); ctx.lineTo(wx + 1, gy - 8); ctx.fill();
      const pT = (t * 0.06) % 1, plx = x + w - pT * (w + 30) + 15, ply = y + 14 + Math.sin(t * 0.8) * 2;
      smallPlane(plx, ply, theme.scene === 'night' ? '#cdd9ec' : '#f4ead6');
    }
    function smallPlane(px, py, col) {
      rect(px, py, 12, 2, col); rect(px + 11, py - 1, 2, 1, col);
      rect(px + 5, py - 3, 2, 3, col); rect(px + 5, py + 2, 2, 3, col);
      rect(px, py - 2, 2, 2, col);
      rect(px + 5, py - 4, 1, 1, '#ff5b5b'); rect(px + 5, py + 5, 1, 1, '#5fe3a1');
    }

    // ======================================================================
    //  FULL SCENE (t2) — dense full-bleed airport landscape (native CW x CH)
    // ======================================================================
    // Scene palette for the current instant. In "auto" mode MIX holds two phase
    // keyframes + a blend fraction (the sun crossing a boundary); otherwise the
    // active theme picks a single static phase. Blends interpolate the whole
    // scene palette so the sky, ground, mountains and lights all shift together.
    function P() {
      let a, b, f;
      if (MIX) { a = MIX.a; b = MIX.b; f = MIX.f; }
      else { a = b = theme.scene3 || (theme.scene2 === 'night' ? 'night' : 'dusk'); f = 0; }
      const nightAmt = lerp(a === 'night' ? 1 : 0, b === 'night' ? 1 : 0, f);
      let pp;
      if (a === b || f <= 0) pp = Object.assign({}, TOD_KF[a].S);
      else pp = blendScene(TOD_KF[a].S, TOD_KF[b].S, f);
      pp.tod = f < 0.5 ? a : b;
      pp.nightAmt = nightAmt;
      pp.night = nightAmt > 0.5;
      return pp;
    }
    function ridge(baseY, amp, color, seed) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, CH); ctx.lineTo(0, baseY);
      for (let x = 0; x <= CW; x += 3) {
        const n = Math.sin((x + seed) * 0.055) + Math.sin((x + seed) * 0.017) * 0.9 + Math.sin((x + seed) * 0.11) * 0.4;
        ctx.lineTo(x, Math.round(baseY - (n + 2.3) / 4.3 * amp));
      }
      ctx.lineTo(CW, baseY); ctx.lineTo(CW, CH); ctx.closePath(); ctx.fill();
    }
    function windowGrid(x, y, cols, rows, cw, ch, gap, p) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const baseOn = ((c * 7 + r * 13 + (c === 1 ? 3 : 0)) % 4) !== 0;
        const lit = baseOn && p.winLit > 0 && (((c * 3 + r * 5) % 10) / 10 < p.winLit);
        const flick = lit && Math.sin(t * 1.3 + c * 2 + r) > -0.85;
        rect(x + c * (cw + gap), y + r * (ch + gap), cw, ch, flick ? p.win : p.winOff);
      }
    }
    function bigPlane(x, y, s, p, landing) {
      // side-view airliner, s ~ pixel unit
      const b = p.plane, d = p.planeDk, tl = p.tail;
      rect(x, y, 26 * s, 4 * s, b);                 // fuselage
      rect(x - 3 * s, y + 1 * s, 3 * s, 2 * s, b);  // nose
      rect(x + 26 * s, y - 3 * s, 2 * s, 5 * s, tl);// tailfin
      rect(x + 24 * s, y, 4 * s, 4 * s, b);
      rect(x + 8 * s, y + 3 * s, 8 * s, 3 * s, d);  // wing (near)
      rect(x + 10 * s, y - 3 * s, 6 * s, 3 * s, d); // wing (far)
      rect(x + 12 * s, y + 6 * s, 3 * s, 2 * s, '#2a3240'); // engine
      for (let i = 0; i < 6; i++) rect(x + (3 + i * 3) * s, y + 1 * s, 1 * s, 1 * s, p.night ? '#9fb6d8' : '#c98f5a'); // windows
      if (landing && p.night) { // landing light beam
        ctx.fillStyle = 'rgba(255,240,190,.10)'; ctx.beginPath();
        ctx.moveTo(x - 3 * s, y + 2 * s); ctx.lineTo(x - 26 * s, y + 12 * s); ctx.lineTo(x - 26 * s, y - 4 * s); ctx.closePath(); ctx.fill();
        rect(x - 3 * s, y + 2 * s, 1, 1, '#fff'); // nav
      }
      rect(x + 8 * s, y + 5 * s, 1, 1, '#5fe3a1'); rect(x + 8 * s, y - 3 * s, 1, 1, '#ff5b5b');
    }
    function pine(x, gy, hgt, col) {
      rect(x, gy - 2, 2, 2, '#3a2a1e');
      for (let i = 0; i < hgt; i++) { const w = (hgt - i) * 2 + 1; rect(x - w / 2 + 1, gy - 2 - (i + 1) * 2, w, 2, col); }
    }
    function fuelTruck(x, gy, p) {
      rect(x, gy - 4, 12, 4, p.night ? '#4a5a3a' : '#7a5030'); rect(x + 12, gy - 3, 4, 3, '#2a2a2a');
      rect(x + 1, gy, 2, 1, '#111'); rect(x + 9, gy, 2, 1, '#111');
      rect(x + 3, gy - 6, 6, 2, '#c9302a');
    }
    function drawFullScene() {
      const p = P();
      const wx = wxState() || 'clear';
      // sky
      const sky = p.sky;
      const g = ctx.createLinearGradient(0, 0, 0, p.hy);
      g.addColorStop(0, sky[0]); g.addColorStop(.55, sky[1]); g.addColorStop(1, sky[2]);
      rect(0, 0, CW, CH, sky[0]); ctx.fillStyle = g; ctx.fillRect(0, 0, CW, p.hy);

      // The sun rises from below the horizon at dawn and sinks at dusk; alpha,
      // size, colour and rays all interpolate between the phase keyframes so the
      // whole sky reads as one continuous day rather than four fixed scenes.
      const sunAt = (sx, sy, halo, haloR, core, coreR, rayAmt, alpha) => {
        if (alpha <= 0.01) return;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sx, sy, haloR, 0, 7); ctx.fill();
        if (rayAmt > 0.02) {
          ctx.strokeStyle = `rgba(255,238,180,${(0.10 * rayAmt).toFixed(3)})`; ctx.lineWidth = 3;
          for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6 + t * 0.05; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * 90, sy + Math.sin(a) * 90); ctx.stroke(); }
        }
        ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, coreR, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      };
      const drift = (arr, col2, col1) => arr.forEach((c, i) => {
        const off = (t * (6 + i * 3)) % (CW + 160) - 80;
        cloud(((c[0] + off * 0.25) % (CW + 120)) - 40, c[1], c[2], i % 2 ? col2 : col1);
      });
      // phase pair + blend fraction for the celestial elements
      const phA = MIX ? MIX.a : p.tod, phB = MIX ? MIX.b : p.tod, phF = MIX ? MIX.f : 0;
      const nAmt = p.nightAmt;
      // stars + moon fade in with night
      if (wx === 'clear' && nAmt > 0.02) {
        for (let i = 0; i < 90; i++) {
          const sx = (i * 97) % CW, sy = (i * 53) % (p.hy - 30);
          ctx.globalAlpha = (0.25 + 0.6 * Math.abs(Math.sin(t * 0.8 + i * 1.7))) * nAmt;
          ctx.fillStyle = i % 11 === 0 ? '#bcd0ff' : '#ffffff'; ctx.fillRect(sx, sy, 1, 1);
        }
        const mx = 404, my = 44; ctx.globalAlpha = nAmt;
        ctx.fillStyle = 'rgba(255,240,200,.10)'; ctx.beginPath(); ctx.arc(mx, my, 26, 0, 7); ctx.fill();
        ctx.fillStyle = '#f2ead0'; ctx.beginPath(); ctx.arc(mx, my, 13, 0, 7); ctx.fill();
        ctx.fillStyle = '#d9d0b4'; [[mx - 4, my - 3, 2], [mx + 3, my + 2, 2], [mx - 1, my + 5, 1], [mx + 6, my - 4, 1]].forEach(c => { ctx.beginPath(); ctx.arc(c[0], c[1], c[2], 0, 7); ctx.fill(); });
        ctx.globalAlpha = 1;
      }
      // sun — position/size/colour blended across the phase keyframes
      const SUN = {
        night: { x: 150, y: 250, hr: 40, cr: 10, a: 0, rays: 0, halo: 'rgba(255,190,160,.18)', core: '#ffdcc0' },
        dawn:  { x: 150, y: p.hy - 4, hr: 46, cr: 11, a: 1, rays: 0, halo: 'rgba(255,190,160,.18)', core: '#ffdcc0' },
        day:   { x: 126, y: 52, hr: 44, cr: 16, a: 1, rays: 1, halo: 'rgba(255,250,220,.20)', core: '#fffbe0' },
        dusk:  { x: 128, y: 96, hr: 48, cr: 24, a: 1, rays: 0, halo: 'rgba(255,240,190,.14)', core: '#fff0c0' },
      };
      const sa = SUN[phA] || SUN.night, sb = SUN[phB] || SUN.night;
      sunAt(lerp(sa.x, sb.x, phF), lerp(sa.y, sb.y, phF),
        mix(sa.halo, sb.halo, phF), lerp(sa.hr, sb.hr, phF),
        mix(sa.core, sb.core, phF), lerp(sa.cr, sb.cr, phF),
        lerp(sa.rays, sb.rays, phF), lerp(sa.a, sb.a, phF));
      // clouds — tint blends between phases, fade out toward deep night
      if (nAmt < 0.98) {
        const CLOUD = {
          night: ['rgba(150,165,200,.30)', 'rgba(120,140,180,.25)'],
          dawn:  ['rgba(240,200,190,.5)', 'rgba(210,160,170,.4)'],
          day:   ['rgba(255,255,255,.7)', 'rgba(245,250,255,.85)'],
          dusk:  ['rgba(255,235,205,.6)', 'rgba(247,220,180,.5)'],
        };
        const ca = CLOUD[phA] || CLOUD.night, cb = CLOUD[phB] || CLOUD.night;
        ctx.globalAlpha = 1 - nAmt;
        drift([[280, 44, 1.5], [420, 70, 1.1], [200, 32, 0.9], [360, 96, 1.2]], mix(ca[0], cb[0], phF), mix(ca[1], cb[1], phF));
        ctx.globalAlpha = 1;
      }

      if (wx === 'overcast') {
        ctx.fillStyle = 'rgba(150,158,172,0.32)'; ctx.fillRect(0, 0, CW, p.hy);
        for (let i = 0; i < 6; i++) {
          const yb = 4 + i * 9, off = (t * (4 + i)) % (CW + 160), shade = 176 - i * 7;
          for (let bc = 0; bc < 3; bc++) { const bx = ((bc * 190 + off) % (CW + 200)) - 100; cloud(bx, yb, 2.4, `rgba(${shade},${shade + 6},${shade + 18},0.55)`); }
        }
      }

      // mountain parallax (Spokane ridges)
      ridge(p.hy - 6, 44, p.far, 120);
      ridge(p.hy - 2, 30, p.mid, 40);
      ridge(p.hy + 2, 18, p.near, 260);

      // ground + apron
      rect(0, p.hy, CW, CH - p.hy, p.ground);
      rect(0, p.hy + 22, CW, CH - p.hy - 22, p.ground2);
      rect(0, 254, CW, CH - 254, p.apron);

      // --- perspective runway to a vanishing point near the tower ---
      const vpx = 330, vpy = p.hy + 4;
      ctx.fillStyle = p.runway; ctx.beginPath();
      ctx.moveTo(150, CH); ctx.lineTo(300, CH); ctx.lineTo(vpx + 6, vpy); ctx.lineTo(vpx - 6, vpy); ctx.closePath(); ctx.fill();
      // centerline dashes
      for (let i = 0; i < 9; i++) { const f = i / 9, yy = CH - f * (CH - vpy), xx = 225 + (vpx - 225) * f, w = 4 * (1 - f) + 1; rect(xx - w / 2, yy, w, 3 * (1 - f) + 1, p.center); }
      // runway edge + approach lights (sequenced flash at night)
      for (let i = 0; i < 11; i++) {
        const f = i / 11, yy = CH - f * (CH - vpy);
        const lw = (150 + (vpx - 6 - 150) * f), rw = (300 + (vpx + 6 - 300) * f);
        let lc;
        if (p.lights >= 0.3) lc = (Math.floor(t * 6) % 11 === (10 - i)) ? p.edge : hexA(p.edge, .3);
        else lc = hexA(p.edge, .5);
        rect(lw, yy, 1, 2, lc);
        rect(rw, yy, 1, 2, lc);
      }
      // PAPI (4 lights) left of threshold
      for (let i = 0; i < 4; i++) rect(120 + i * 4, CH - 20, 3, 2, i < 2 ? '#fff' : p.papiR);
      // taxiway edge (blue) curving off
      for (let i = 0; i < 8; i++) rect(60 + i * 10, 262 + Math.sin(i) * 2, 1, 2, p.taxi);

      // --- structures on the horizon ---
      // hangars (left)
      for (let i = 0; i < 2; i++) {
        const hx = 18 + i * 40;
        rect(hx, p.hy - 12, 34, 12, p.structDark);
        ctx.fillStyle = p.roof; ctx.beginPath(); ctx.moveTo(hx, p.hy - 12); ctx.lineTo(hx + 17, p.hy - 18); ctx.lineTo(hx + 34, p.hy - 12); ctx.fill();
        rect(hx + 6, p.hy - 8, 22, 8, p.night ? '#0a141f' : '#33241c');
        rect(hx + 12, p.hy - 6, 10, 6, hexA(p.win, .5));
      }
      // terminal building (center-left) with jet bridges + lit window grid
      const tmx = 96, tmy = p.hy - 20;
      rect(tmx, tmy, 96, 20, p.struct);
      rect(tmx, tmy - 3, 96, 3, p.roof);
      windowGrid(tmx + 4, tmy + 4, 14, 3, 4, 3, 2, p);
      // jet bridges + a parked airliner at a gate
      rect(tmx + 24, p.hy, 10, 3, p.metal);
      parkedLiner(tmx + 20, p.hy + 1, p);
      // control tower (right)
      const twx = 360;
      rect(twx, p.hy - 40, 8, 40, p.struct);
      rect(twx - 1, p.hy - 40, 10, 3, p.roof);
      rect(twx - 4, p.hy - 52, 16, 12, p.structDark); // cab
      if (p.winLit > 0) { const lit = (0.5 + 0.45 * Math.sin(t * 2)) * Math.min(1, p.winLit + 0.25); ctx.globalAlpha = lit; rect(twx - 2, p.hy - 50, 12, 6, p.win); ctx.globalAlpha = 1; }
      else rect(twx - 2, p.hy - 50, 12, 6, p.winOff);
      rect(twx + 3, p.hy - 58, 2, 6, p.metal); // antenna
      const on = Math.sin(beacon) > 0.3;
      rect(twx + 3, p.hy - 60, 2, 2, on ? '#6bf0ac' : '#1a3a2a');
      if (on && p.winLit > 0.4) { ctx.fillStyle = 'rgba(107,240,172,.5)'; ctx.beginPath(); ctx.arc(twx + 4, p.hy - 59, 6, 0, 7); ctx.fill(); }
      // radar dish (rotating) atop a small mast
      const rdx = 420, rdy = p.hy - 22;
      rect(rdx, rdy, 2, 22, p.metal);
      const rw = Math.abs(Math.cos(beacon * 0.7)) * 7 + 3;
      rect(rdx - rw / 2 + 1, rdy - 4, rw, 3, p.metal);

      // windsock (right)
      const wsx = 470; rect(wsx, p.hy - 20, 1, 20, p.metal);
      const swing = Math.sin(t * 1.2) * 2;
      ctx.fillStyle = p.night ? '#ff8a3d' : '#e8a13c';
      ctx.beginPath(); ctx.moveTo(wsx + 1, p.hy - 20); ctx.lineTo(wsx + 12 + swing, p.hy - 19); ctx.lineTo(wsx + 12 + swing, p.hy - 15); ctx.lineTo(wsx + 1, p.hy - 16); ctx.fill();

      // pines dotted around (Spokane pines)
      pine(230, p.hy + 2, 5, p.tree); pine(246, p.hy + 6, 4, p.tree);
      pine(492, p.hy + 4, 6, p.tree); pine(20, 252, 5, p.tree);

      // fuel truck + ground crew near the parked liner
      fuelTruck(tmx + 46, p.hy + 14, p);
      groundCrew(tmx + 8, p.hy + 16, p);

      // --- approaching airliner in the sky (loops across, descending) ---
      const pT = (t * 0.045) % 1.25;
      if (pT < 1) {
        const gx = CW + 40 - pT * (CW + 120);
        const gyy = 40 + pT * 90 + Math.sin(t * 1.5) * 1.5;
        bigPlane(gx, gyy, p.night ? 1 : 1, p, true);
      }

      // ---- weather overlays ----
      if (wx === 'fog') {
        ctx.fillStyle = 'rgba(205,210,220,0.26)'; ctx.fillRect(0, 0, CW, CH);
        ctx.fillStyle = 'rgba(214,218,226,0.14)';
        for (let i = 0; i < 5; i++) { const yb = p.hy - 34 + i * 15 + Math.sin(t * 0.3 + i) * 4; ctx.fillRect(0, yb, CW, 9); }
        const fgg = ctx.createLinearGradient(0, p.hy - 24, 0, CH);
        fgg.addColorStop(0, 'rgba(216,220,228,0)'); fgg.addColorStop(1, 'rgba(220,224,231,0.55)');
        ctx.fillStyle = fgg; ctx.fillRect(0, p.hy - 24, CW, CH - p.hy + 24);
      } else if (wx === 'rain') {
        ctx.fillStyle = 'rgba(16,24,42,0.32)'; ctx.fillRect(0, 0, CW, CH);
        ctx.strokeStyle = 'rgba(178,198,222,0.42)'; ctx.lineWidth = 1;
        for (let i = 0; i < 130; i++) { const s = i * 53; const x = ((s * 1.7 + t * 300) % (CW + 40)) - 20; const y = ((s * 2.3 + t * 560) % (CH + 40)) - 20; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y + 10); ctx.stroke(); }
        if (Math.floor(t * 0.8) % 11 === 0 && ((t * 8) % 1) < 0.1) { ctx.fillStyle = 'rgba(205,218,240,0.22)'; ctx.fillRect(0, 0, CW, CH); }
      } else if (wx === 'snow') {
        ctx.fillStyle = 'rgba(200,210,225,0.08)'; ctx.fillRect(0, 0, CW, p.hy);
        ctx.fillStyle = 'rgba(236,241,249,0.40)'; ctx.fillRect(0, p.hy - 2, CW, 5);
        ctx.fillStyle = '#eef3fa';
        for (let i = 0; i < 80; i++) { const s = i * 37; const x = ((s * 3.1 + t * 34 + Math.sin(t + i) * 9) % (CW + 20)) - 10; const y = ((s * 2.7 + t * 42) % (CH + 20)) - 10; ctx.fillRect(x, y, 1, 1); if (i % 4 === 0) ctx.fillRect(x + 1, y, 1, 1); }
      }
    }
    function cloud(x, y, s, col) {
      ctx.fillStyle = col;
      rect(x, y, 20 * s, 4 * s, col); rect(x + 4 * s, y - 3 * s, 12 * s, 4 * s, col); rect(x + 9 * s, y - 5 * s, 7 * s, 4 * s, col);
    }
    function parkedLiner(x, y, p) {
      rect(x, y, 20, 3, p.plane); rect(x - 2, y, 2, 2, p.plane);
      rect(x + 19, y - 2, 2, 3, p.tail); rect(x + 6, y + 2, 6, 2, p.planeDk);
      rect(x + 6, y - 2, 5, 2, p.planeDk);
    }
    function groundCrew(x, y, p) {
      const wav = Math.sin(t * 4) > 0 ? 1 : -1;
      rect(x, y, 2, 3, p.night ? '#ffbe5f' : '#d1573e'); // hi-vis body
      rect(x, y - 2, 2, 2, '#e8c9a0'); // head
      rect(x - 2, y, 2, 1, '#ff8a3d'); rect(x + 2, y + wav, 2, 1, '#ff8a3d'); // wands
    }

    // ============================ BOARD ============================
    function drawBoard(d) {
      const hasBand = theme.scene !== 'none';
      rect(0, 0, W, 15, C.panel); rect(0, 15, W, 1, C.line);
      // Title comes from the configured location: first word is the big "code",
      // the remainder is the subtitle — so any place in the world reads sensibly.
      const lbl = (d.location_label || 'AeroBoard').trim();
      const sp = lbl.search(/[ ,·]/);
      const code = (sp < 0 ? lbl : lbl.slice(0, sp)).toUpperCase().slice(0, 12);
      const sub = (sp < 0 ? '' : lbl.slice(sp + 1).replace(/^[\s,·]+/, '')).toUpperCase();
      text(code, 5, 3, C.amber, 12, { bold: true, glow: theme.crt ? true : ((theme.id === 'night' || theme.id === 'night2' || theme.id === 'night3') ? C.glow : false) });
      if (sub) {
        ctx.font = `bold ${12 + FS}px ${theme.font}`;   // measure the code to place the subtitle
        const codeW = ctx.measureText(code).width;
        text(sub.slice(0, 22), 5 + codeW + 6, 4, C.dim, 10);
      }
      text(clock().hhmm, W / 2, 3, C.ink, 12, { bold: true, center: true });
      text('TRACKING ' + d.tracking, W - 20, 4, C.dim, 10, { right: true });
      text('⚙', W - 9, 3, C.dim, 12, { center: true });
      addHit(W - 18, 0, 18, 16, () => { if (opts.onSettings) opts.onSettings(); else view = 'settings'; });
      const wxOn = !!wxState();
      if (wxOn) drawWxRibbon(16);
      const hb = wxOn ? 29 : 16;

      const sceneH = hasBand ? 40 : 0;
      const rowH = 25, listX = 3, listW = 248, tbH = 11;
      const top = hb + 2;
      const listTop = top + tbH;                        // rows begin below the toolbar
      const listBottom = H - (hasBand ? sceneH + 2 : 14);
      const visibleH = listBottom - listTop;
      const maxRows = Math.max(1, Math.floor(visibleH / rowH));
      if (theme.id === 'poster') rect(0, hb, 252, listBottom - hb, C.panel);
      else if (theme.glass) rect(0, hb, 253, listBottom - hb, C.glassList);

      // Filter + sort just the list (the radar/counts still reflect every flight).
      const viewFlights = applyView(d.flights);
      const contentH = viewFlights.length * rowH;
      scrollMax = Math.max(0, contentH - visibleH);
      listScrollY = Math.max(0, Math.min(scrollMax, listScrollY));
      listBox = { x: listX, y: listTop, w: listW, h: visibleH };

      // ---- toolbar: shows the active sort, opens the sort/filter pop-over, and
      //      carries the page up/down arrows for the scroll.
      const active = filtersActive();
      const sortLbl = (sortState.key === 'altitude' ? 'ALT' : 'DIST') + (sortState.dir > 0 ? ' ↑' : ' ↓');
      text('SORT ' + sortLbl, listX + 4, top + 1, C.ink, 9, { bold: true });
      text(active ? 'FILTER •' : 'FILTER', listX + 78, top + 1, active ? C.amber : C.dim, 9, { bold: active });
      addHit(listX, top - 1, listW - 34, tbH, () => { filterOpen = true; });
      const canUp = scrollMax > 0 && listScrollY > 0, canDn = scrollMax > 0 && listScrollY < scrollMax;
      const pageStep = Math.max(rowH, (maxRows - 1) * rowH);
      vtri(listX + listW - 26, top + 2, canUp ? C.ink : C.faint, true);
      vtri(listX + listW - 11, top + 2, canDn ? C.ink : C.faint, false);
      addHit(listX + listW - 32, top - 1, 15, tbH + 1, () => { listScrollY = Math.max(0, listScrollY - pageStep); });
      addHit(listX + listW - 16, top - 1, 16, tbH + 1, () => { listScrollY = Math.min(scrollMax, listScrollY + pageStep); });
      rect(listX, listTop - 1, listW, 1, C.line);

      // ---- empty states
      if (!viewFlights.length) {
        const msg = !d.flights.length ? (d.error ? '' : 'quiet skies overhead') : 'no flights match the filter';
        if (msg) text(msg, listX + 8, listTop + 16, C.dim, 12);
      }

      // ---- rows, clipped to the viewport and offset by the scroll position
      const drawRow = (ac, y) => {
        const col = TAG[ac.tag] || C.dim;
        rect(listX, y, 2, rowH - 2, col);
        if (theme.flap === 'full') flapRow(ac.label, listX + 7, y + 1, 8, 9, C.ink);
        else text(ac.label, listX + 7, y + 1, C.ink, 12, { bold: true });
        text(ac.type || '----', listX + 90, y + 2, C.dim, 11);
        if (ac.origin && ac.dest) text(ac.origin + '→' + ac.dest, listX + 127, y + 2, C.blue, 10);
        text(ac.tag, listX + listW - 4, y + 2, col, 9, { right: true });
        const ly = y + 14;
        if (ac.alt_ft !== null) {
          const vr = ac.vrate_fpm || 0;
          if (Math.abs(vr) >= 300) vtri(listX + 7, ly + 2, vr > 0 ? C.green : C.amber, vr > 0);
          text(ac.on_ground ? 'GND' : ac.alt_ft.toLocaleString() + 'FT', listX + 15, ly, C.green, 10);
        }
        if (ac.gs_kt) text(ac.gs_kt + 'KT', listX + 78, ly, C.dim, 10);
        text(ac.distance_nm + 'NM', listX + 128, ly, C.dim, 10);
        text(ac.compass, listX + 186, ly, C.ink, 10);
        if (ac.compass) bearingTri(listX + 212, ly + 5, ac.bearing, 4, col);
      };
      ctx.save();
      ctx.beginPath(); ctx.rect(listX, listTop, listW + 6, visibleH); ctx.clip();
      const first = Math.max(0, Math.floor(listScrollY / rowH));
      const last = Math.min(viewFlights.length, Math.ceil((listScrollY + visibleH) / rowH));
      for (let i = first; i < last; i++) {
        const ac = viewFlights[i];
        const y = listTop + i * rowH - listScrollY;
        drawRow(ac, y);
        const hy = Math.max(listTop, y), hh = Math.min(y + rowH - 2, listBottom) - hy;
        if (hh > 3) addHit(listX, hy, listW, hh, () => { selectedHex = ac.hex; view = 'detail'; });
      }
      ctx.restore();

      // ---- scroll thumb, in the gutter between the list and the radar
      if (scrollMax > 0) {
        const thumbH = Math.max(8, visibleH * visibleH / contentH);
        const thumbY = listTop + (listScrollY / scrollMax) * (visibleH - thumbH);
        rect(listX + listW + 1, listTop, 2, visibleH, C.line);
        rect(listX + listW + 1, thumbY, 2, thumbH, C.amber);
      }

      // The weather ribbon pushes the radar down by 13px (ry 18 -> 31); shrink the
      // radar by the same amount so its bottom edge — and everything stacked under
      // it — stays put whether or not the ribbon is showing.
      const rx = 256, ry = (wxOn ? 31 : 18), rw = W - rx - 3, rh = wxOn ? 105 : 118;
      rect(rx, ry, rw, rh, C.inner); stroke(rx, ry, rw, rh, C.line);
      text('RADAR ' + d.radius_nm + 'NM', rx + 4, ry + 3, C.green, 9);
      text('⤢', rx + rw - 9, ry + 3, C.dim, 9);
      drawRadarWidget(d, rx + rw / 2, ry + rh / 2 + 6, Math.min(rw, rh) / 2 - 11, false);
      addHit(rx, ry, rw, rh, () => { view = 'radar'; });

      let sx = rx + 3, sy = ry + rh + 5;
      if (theme.glass) rect(sx - 3, sy - 3, rw + 3, H - sy - 13, C.glassList);
      text('IN RANGE', sx, sy, C.dim, 9);
      let cyy = sy + 11;
      for (const tag of ['APPROACH', 'DEPARTURE', 'GA', 'OVERFLIGHT']) {
        const n = (d.counts || {})[tag]; if (!n) continue;
        const c = TAG[tag] || C.dim; rect(sx, cyy + 1, 5, 5, c);
        text(tag.slice(0, 4), sx + 9, cyy, C.dim, 9);
        text(String(n), sx + 52, cyy, c, 9, { right: true });
        cyy += 9;
      }

      if (hasBand) drawScene(0, H - sceneH, W, sceneH);
      else footer(d);

      if (filterOpen) drawFilterPanel();   // modal — drawn last, hits registered last
    }

    // ---- sort & filter pop-over (board view) ----
    // A tap-driven modal over the board. Options mutate sortState/filterState in
    // place; the list re-derives from them on the next frame. Hits are added after
    // everything else so they win the pointer scan (which runs newest-first).
    function drawFilterPanel() {
      // dim the board behind the panel, then a full-screen backdrop hit to dismiss
      ctx.fillStyle = hexA(C.bg, .82); ctx.fillRect(0, 0, W, H);
      addHit(0, 0, W, H, () => { filterOpen = false; });

      const px = 8, pw = W - 16, py = 14, ph = H - 28;
      rect(px, py, pw, ph, C.panel); stroke(px, py, pw, ph, C.line);
      text('SORT & FILTER', px + pw / 2, py + 5, C.ink, 12, { bold: true, center: true });
      text('✕', px + pw - 9, py + 4, C.dim, 11, { center: true });
      addHit(px + pw - 20, py, 20, 16, () => { filterOpen = false; });
      rect(px + 6, py + 19, pw - 12, 1, C.line);

      // helper: a tappable row with a left marker (check box / sort dot) + label
      const optRow = (x, y, w, on, label, mark, onTap) => {
        rect(x, y, w, 13, on ? C.panelHi : C.inner); stroke(x, y, w, 13, C.line);
        if (mark) mark(x + 4, y + 2);
        else { stroke(x + 4, y + 3, 7, 7, on ? C.green : C.line); if (on) { rect(x + 6, y + 5, 3, 3, C.green); } }
        text(label, x + 15, y + 2, on ? C.ink : C.dim, 10, { bold: on });
        addHit(x, y, w, 13, onTap);
      };

      // -- left column: SORT + options --
      const colW = (pw - 18) / 2;
      const lx = px + 6; let ly = py + 26;
      text('SORT BY', lx, ly, C.dim, 9); ly += 12;
      [['distance', 'DISTANCE'], ['altitude', 'ALTITUDE']].forEach(([key, name]) => {
        const on = sortState.key === key;
        optRow(lx, ly, colW, on, name + (on ? (sortState.dir > 0 ? '  ↑ up' : '  ↓ down') : ''),
          (mx, my) => vtri(mx + 1, my + 1, on ? C.amber : C.line, on ? sortState.dir > 0 : true),
          () => { if (sortState.key === key) sortState.dir *= -1; else sortState.key = key; });
        ly += 16;
      });
      ly += 6;
      text('OPTIONS', lx, ly, C.dim, 9); ly += 12;
      optRow(lx, ly, colW, filterState.airborneOnly, 'AIRBORNE ONLY', null,
        () => { filterState.airborneOnly = !filterState.airborneOnly; });

      // -- right column: category filters --
      const rxx = px + 6 + colW + 6; let ry2 = py + 26;
      text('SHOW CATEGORIES', rxx, ry2, C.dim, 9); ry2 += 12;
      ALL_TAGS.forEach(tg => {
        const on = filterState.tags[tg] !== false, c = TAG[tg] || C.dim;
        optRow(rxx, ry2, colW, on, tg,
          (mx, my) => { stroke(mx, my + 1, 7, 7, on ? c : C.line); if (on) rect(mx + 2, my + 3, 3, 3, c); },
          () => { filterState.tags[tg] = !on; });
        ry2 += 16;
      });

      // -- footer: reset / done --
      const by = py + ph - 20;
      rect(px + 6, by, 70, 14, C.inner); stroke(px + 6, by, 70, 14, C.line);
      text('RESET', px + 6 + 35, by + 2, C.dim, 10, { center: true, bold: true });
      addHit(px + 6, by, 70, 14, () => {
        sortState.key = 'distance'; sortState.dir = 1;
        filterState.airborneOnly = false; ALL_TAGS.forEach(tg => { filterState.tags[tg] = true; });
      });
      rect(px + pw - 76, by, 70, 14, C.amber);
      text('DONE', px + pw - 76 + 35, by + 2, theme.glass ? '#0a1420' : C.bg, 10, { center: true, bold: true });
      addHit(px + pw - 76, by, 70, 14, () => { filterOpen = false; });
    }

    // ============================ DETAIL ============================
    function fieldRow(x, y, label, value, valColor) {
      text(label, x, y, C.dim, 9);
      text(value, x, y + 9, valColor || C.ink, 13, { bold: true });
    }
    function drawDetail(d) {
      rect(0, 0, W, 16, C.panel); rect(0, 16, W, 1, C.line);
      backButton();
      if (wxState()) wxMini(150, 3);
      const ac = findFlight(selectedHex);
      if (!ac) {
        text('SIGNAL LOST', W / 2, 90, C.red, 14, { bold: true, center: true });
        text('that aircraft left the area', W / 2, 110, C.dim, 10, { center: true });
        text('‹ back to board', W / 2, 130, C.amber, 10, { center: true });
        addHit(0, 0, W, H, () => { view = 'board'; });
        return;
      }
      const col = TAG[ac.tag] || C.dim;
      if (theme.glass) rect(0, 17, W, H - 17, C.glassList);
      text(ac.tag, W - 4, 4, col, 10, { right: true, bold: true });
      const bkey = brandKey(ac);
      let labelX = 12;
      if (bkey) { accentBar(bkey); tailBadge(12, 22, ac, bkey); labelX = 38; }
      if (theme.flap === 'full' || theme.flap === 'subtle') flapRow(ac.label, labelX, 22, 13, 15, C.ink);
      else text(ac.label, labelX, 22, C.ink, 22, { bold: true, glow: theme.crt });
      // airline name from adsbdb (shown for any known carrier; the brand chip
      // above only appears for carriers we have a color for). Country is the
      // ISO code, e.g. "US". Falls back to the route cities when unknown.
      const airlineStr = ac.airline_name
        ? ac.airline_name + (ac.airline_country ? '  ·  ' + ac.airline_country : '')
        : null;
      const typeReg = (ac.type || '—') + ' · ' + (ac.reg || '—');
      const routeStr = (ac.origin && ac.dest) ? ac.origin + ' → ' + ac.dest : null;
      if (routeStr) {
        text(routeStr, 12, 46, C.blue, 15, { bold: true });
        text(typeReg, 232, 50, C.dim, 9, { right: true });   // right of route, clear of it
        const cities = [ac.origin_city, ac.dest_city].filter(Boolean).join(' → ');
        text(airlineStr || cities, 12, 64, C.dim, 9);
      } else {
        text(typeReg, 12, 48, C.dim, 11);
        text(airlineStr || 'scheduled route unavailable', 12, 64, airlineStr ? C.dim : C.faint, 9);
      }
      rect(12, 76, W - 24, 1, C.line);
      const lx = 14; let ly = 82;
      const alt = ac.on_ground ? 'ON GROUND' : (ac.alt_ft != null ? ac.alt_ft.toLocaleString() + ' FT' : '—');
      fieldRow(lx, ly, 'ALTITUDE', alt, C.green);
      if (ac.vrate_fpm && Math.abs(ac.vrate_fpm) >= 100) {
        const up = ac.vrate_fpm > 0; vtri(lx + 96, ly + 13, up ? C.green : C.amber, up);
        text(Math.abs(ac.vrate_fpm) + ' fpm', lx + 106, ly + 11, C.dim, 9);
      }
      ly += 30; fieldRow(lx, ly, 'GROUND SPEED', ac.gs_kt != null ? ac.gs_kt + ' KT' : '—');
      ly += 30; fieldRow(lx, ly, 'HEADING', ac.track != null ? ac.track + '°' : '—');
      if (ac.track != null) bearingTri(lx + 70, ly + 16, ac.track, 5, C.ink);
      ly += 30; fieldRow(lx, ly, 'SQUAWK', ac.squawk || '—');
      const px = 236, pw = W - px - 8;
      rect(px, 78, pw, H - 92, C.inner); stroke(px, 78, pw, H - 92, C.line);
      text('LOOK', px + pw / 2, 84, C.dim, 9, { center: true });
      const cx = px + pw / 2, cyc = 128;
      ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cyc, 26, 0, 7); ctx.stroke();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; rect(Math.round(cx + Math.sin(a) * 26), Math.round(cyc - Math.cos(a) * 26), 1, 1, C.faint); }
      ctx.shadowColor = col; ctx.shadowBlur = 6; bearingTri(cx, cyc, ac.bearing, 20, col); ctx.shadowBlur = 0;
      text(ac.compass || '—', cx, cyc + 30, C.ink, 16, { bold: true, center: true });
      text(Math.round(ac.bearing) + '°  ·  ' + ac.distance_nm + ' NM', cx, cyc + 50, C.dim, 9, { center: true });
      footer(d);
    }

    // ============================ RADAR ============================
    function computeStats(d) {
      const air = d.flights.filter(f => !f.on_ground && f.distance_nm > 0);
      const min = (arr, key) => arr.length ? arr.reduce((a, b) => b[key] < a[key] ? b : a) : null;
      const max = (arr, key) => arr.length ? arr.reduce((a, b) => b[key] > a[key] ? b : a) : null;
      return {
        closest: min(air.filter(f => f.distance_nm != null), 'distance_nm'),
        lowest: min(air.filter(f => f.alt_ft != null), 'alt_ft'),
        fastest: max(air.filter(f => f.gs_kt != null), 'gs_kt'),
        near: d.flights.filter(f => NEAR_TAGS[f.tag]).length,
      };
    }
    function drawRadarView(d) {
      rect(0, 0, W, 16, C.panel); rect(0, 16, W, 1, C.line);
      backButton();
      text('RADAR · ' + d.radius_nm + ' NM', W / 2, 4, C.green, 11, { bold: true, center: true, glow: theme.crt });
      text('TRACKING ' + d.tracking, W - 4, 4, C.dim, 10, { right: true });
      if (theme.glass) { rect(6, 22, 250, H - 32, C.glassList); }
      if (d.location_label) text('◎ ' + d.location_label.slice(0, 22), 132, 19, C.dim, 8, { center: true });
      drawRadarWidget(d, 132, 122, 84, true);
      const sx = 252, pw = W - sx - 6; let sy = 26;
      rect(sx, sy, pw, H - sy - 8, C.inner); stroke(sx, sy, pw, H - sy - 8, C.line);
      const ix = sx + 7; let iy = sy + 7;
      text('IN RANGE', ix, iy, C.dim, 9); iy += 13;
      for (const tag of ['APPROACH', 'DEPARTURE', 'GA', 'OVERFLIGHT', 'GROUND']) {
        const n = (d.counts || {})[tag]; if (!n) continue;
        const c = TAG[tag] || C.dim; rect(ix, iy + 1, 5, 5, c);
        text(tag.slice(0, 4), ix + 9, iy, C.dim, 9);
        text(String(n), ix + pw - 16, iy, c, 9, { right: true });
        iy += 11;
      }
      iy += 4; rect(ix, iy, pw - 14, 1, C.line); iy += 6;
      const st = computeStats(d);
      const line = (lbl, ac, extra) => {
        text(lbl, ix, iy, C.dim, 8); iy += 9;
        text(ac ? ac.label + ' ' + extra(ac) : '—', ix, iy, C.ink, 9); iy += 13;
      };
      line('CLOSEST', st.closest, a => a.distance_nm + 'NM');
      line('LOWEST', st.lowest, a => a.alt_ft.toLocaleString() + 'FT');
      line('FASTEST', st.fastest, a => a.gs_kt + 'KT');
      text('NEAR THE FIELD', ix, iy, C.dim, 8); iy += 9;
      text(String(st.near), ix, iy, C.green, 9, { bold: true });
      text('TAP A BLIP FOR DETAIL', 132, H - 9, C.faint, 8, { center: true });
    }

    // ============================ SETTINGS ============================
    function drawSettings(d) {
      rect(0, 0, W, 16, C.panel); rect(0, 16, W, 1, C.line);
      backButton();
      text('SETTINGS', W / 2, 4, C.ink, 11, { bold: true, center: true });
      if (wxState()) wxMini(292, 3);
      const latS = Math.abs(LAT).toFixed(4) + '° ' + (LAT >= 0 ? 'N' : 'S');
      const lonS = Math.abs(LON).toFixed(4) + '° ' + (LON >= 0 ? 'E' : 'W');
      const rows = [
        ['LOCATION', (d.location_label || '—').slice(0, 22), C.ink],
        ['ADDRESS', 'set via address lookup', C.dim],
        ['LATITUDE', latS, C.green],
        ['LONGITUDE', lonS, C.green],
        ['SEARCH RADIUS', (d.radius_nm || '—') + ' NM', C.amber],
        ['TIMEZONE', TZ, C.dim],
      ];
      let y = 26;
      rows.forEach((r, i) => {
        const rowY = y + i * 24;
        rect(6, rowY, W - 12, 22, i % 2 ? C.panel : C.panelHi);
        stroke(6, rowY, W - 12, 22, C.line);
        text(r[0], 12, rowY + 3, C.dim, 9);
        text(r[1], W - 12, rowY + 3, r[2], 12, { right: true, bold: true });
        if (r[0] === 'SEARCH RADIUS') {
          rect(12, rowY + 15, W - 90, 3, C.line);
          const frac = .35;
          rect(12, rowY + 15, (W - 90) * frac, 3, C.amber);
          rect(12 + (W - 90) * frac - 2, rowY + 13, 4, 7, C.ink);
        }
      });
      const by = y + rows.length * 24 + 4;
      rect(6, by, 150, 16, C.panelHi); stroke(6, by, 150, 16, C.green);
      text('◎ USE MY LOCATION', 14, by + 3, C.green, 10, { bold: true });
      rect(W - 90, by, 84, 16, C.amber);
      text('SAVE', W - 48, by + 3, theme.glass ? '#0a1420' : C.bg, 10, { bold: true, center: true });
    }

    // ---- footer ----
    function footer(d) {
      const y = H - 12; rect(0, y, W, 1, C.line);
      if (d.error) text('NO SIGNAL — retrying', 4, y + 1, C.red, 9);
      else {
        text('SRC ' + d.source, 4, y + 1, C.faint, 9);
        const lv = d.live !== false;
        text(lv ? 'LIVE' : 'SAMPLE', 128, y + 1, lv ? C.green : C.amber, 9);
      }
      text(clock().hms + (TZABBR ? ' ' + TZABBR : ''), W - 4, y + 1, C.dim, 9, { right: true });
    }

    // ---- post fx (native res) ----
    function postFx() {
      if (theme.crt) {
        ctx.fillStyle = 'rgba(0,0,0,.22)';
        for (let y = 0; y < CH; y += 2) ctx.fillRect(0, y, CW, 1);
        const vg = ctx.createRadialGradient(CW / 2, CH / 2, 40, CW / 2, CH / 2, CW * 0.62);
        vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, CW, CH);
        ctx.fillStyle = 'rgba(80,255,170,.03)'; ctx.fillRect(0, 0, CW, CH);
      } else if (theme.grain) {
        const vg = ctx.createRadialGradient(CW / 2, CH / 2, CH * 0.28, CW / 2, CH / 2, CW * 0.7);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, theme.scene2 === 'sunset' ? 'rgba(30,20,30,.35)' : 'rgba(0,0,0,.42)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, CW, CH);
      }
    }

    function draw() {
      hits = [];
      // Base transform carries the RES supersample: scene art + post-fx are authored
      // in native CW×CH space, the UI in 384×216 (scaled by uiScale on top). Every
      // draw call below therefore lands on the RES-denser backing store unchanged.
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, CW, CH);
      if (theme.fullScene) drawFullScene();
      ctx.save();
      if (uiScale !== 1) ctx.scale(uiScale, uiScale);
      if (view === 'detail') drawDetail(data);
      else if (view === 'radar') drawRadarView(data);
      else if (view === 'settings') drawSettings(data);
      else drawBoard(data);
      ctx.restore();
      ctx.setTransform(RES, 0, 0, RES, 0, 0);
      postFx();
    }
    let autoCheck = 1e9;
    function loop(now) {
      const dt = (now - lastT) / 1000; lastT = now; t += dt;
      if (!reduce) { sweep = (sweep + dt * 1.4) % (Math.PI * 2); beacon += dt * 2.2; }
      // Re-derive the sun-driven blend a few times a minute — the phase moves
      // slowly, so this is cheap, and P()/drawFullScene read MIX every frame.
      if (autoMode) { autoCheck += dt; if (autoCheck > 15) { autoCheck = 0; updateAuto(); } }
      draw();
      raf = requestAnimationFrame(loop);
    }

    // Pointer -> UI logical (384×216) coordinates.
    function toLogical(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
    }
    function hitAt(x, y) {
      for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i];
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
      }
      return null;
    }
    const overList = (x, y) => view === 'board' && !filterOpen && listBox &&
      x >= listBox.x && x <= listBox.x + listBox.w && y >= listBox.y && y <= listBox.y + listBox.h;

    // A press that stays put is a tap (runs the hit under it on release); a press
    // that moves vertically over the flight list drags it to scroll. Firing on
    // release — rather than on down — is what lets us tell the two apart.
    let ptr = null;
    canvas.addEventListener('pointerdown', (e) => {
      const p = toLogical(e);
      ptr = { x0: p.x, y0: p.y, dragging: false, scroll0: listScrollY, onList: overList(p.x, p.y) };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not supported */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!ptr) return;
      const p = toLogical(e);
      if (ptr.onList && scrollMax > 0) {
        if (!ptr.dragging && Math.abs(p.y - ptr.y0) > 3) ptr.dragging = true;
        if (ptr.dragging) listScrollY = Math.max(0, Math.min(scrollMax, ptr.scroll0 - (p.y - ptr.y0)));
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!ptr) return;
      const p = toLogical(e);
      const moved = Math.abs(p.x - ptr.x0) > 4 || Math.abs(p.y - ptr.y0) > 4;
      if (!ptr.dragging && !moved) { const h = hitAt(p.x, p.y); if (h) h.fn(); }
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      ptr = null;
    });
    canvas.addEventListener('pointercancel', () => { ptr = null; });
    canvas.addEventListener('wheel', (e) => {
      if (scrollMax <= 0) return;
      const p = toLogical(e);
      if (!overList(p.x, p.y)) return;
      listScrollY = Math.max(0, Math.min(scrollMax, listScrollY + e.deltaY));
      e.preventDefault();
    }, { passive: false });
    canvas.__setView = (v) => { if (v === 'detail' && !selectedHex) selectedHex = data.flights[0].hex; view = v; };

    // The whole board is laid out on a fixed grid tuned for the board fonts
    // (Space Mono, and VT323 for the CRT theme). Those fonts are only ever
    // painted on the canvas, never in the DOM — and WebKit (iPad Safari) won't
    // download an @font-face that isn't matched to DOM text, so the canvas would
    // fall back to a wide system monospace and every label would overflow its box.
    // Ask the Font Loading API to fetch them explicitly (Safari honours this) and
    // hold the first paint until they're ready, with a timeout so a slow/offline
    // font load never leaves the screen blank.
    let raf = 0, destroyed = false;
    function begin() { if (!destroyed && !raf) raf = requestAnimationFrame(loop); }
    const fontsToLoad = ["700 16px 'Space Mono'", "400 16px 'Space Mono'", "400 16px 'VT323'"];
    if (window.document && document.fonts && document.fonts.load) {
      Promise.race([
        Promise.all(fontsToLoad.map(f => document.fonts.load(f).catch(() => {}))),
        new Promise(r => setTimeout(r, 1500)),
      ]).then(begin);
    } else {
      begin();
    }
    return {
      destroy() { destroyed = true; cancelAnimationFrame(raf); },
      setData(nd) { if (nd) data = nd; },
      setTheme(id) {
        if (id === 'auto') { autoMode = true; applyTheme('auto'); autoCheck = 1e9; }
        else if (THEMES[id]) { autoMode = false; MIX = null; applyTheme(id); }
      },
      // Switch the clock / "auto" theme to the board location's IANA zone once
      // the page has resolved it from lat/lon. Resetting sunDay forces the
      // sunrise/sunset table to recompute against the new offset.
      setTimeZone(tz) {
        if (!tz || tz === TZ) return;
        TZ = tz; TZABBR = zoneAbbr(TZ); sunDay = '';
      },
    };
  }

  window.AeroBoard = { mount };
})();
