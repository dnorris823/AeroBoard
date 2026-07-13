/* AeroBoard service worker — caches the app shell so the installed PWA opens
 * and runs without any server. Live data still comes from the network (the
 * public flight/route/weather APIs); only the static files are cached. */
var CACHE = 'aeroboard-v16';
var SHELL = [
  './', 'index.html', 'settings.html',
  'aeroboard-engine.js', 'aeroboard-data.js', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'favicon-32.png',
  'fonts/spacemono-400.woff2', 'fonts/spacemono-700.woff2', 'fonts/vt323-400.woff2'
];

self.addEventListener('install', function (e) {
  // Fetch each shell file with cache:'reload' so we bypass the browser's HTTP
  // cache. GitHub Pages serves the static files with a ~10-minute max-age, so a
  // plain addAll() right after a release can re-cache the *previous* build's
  // files under the new cache name — the version stamp updates but the page
  // content doesn't. Forcing a network revalidation keeps the two in sync.
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (url) {
      return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
        if (res && res.ok) return c.put(url, res);
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Only serve the app shell from cache; let live API calls hit the network.
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // Cache same-origin static assets as they're fetched.
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () { return caches.match('index.html'); });
    })
  );
});
