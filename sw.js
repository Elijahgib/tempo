/* Tempo service worker.
 *
 * TO SHIP A NEW VERSION: bump VERSION here, and bump the matching ?v= strings in
 * index.html. Those two must always agree. Nothing else needs changing.
 *
 * Update flow: a new VERSION means a new cache name and a byte-different sw.js, so
 * the browser installs it, skipWaiting() activates it immediately, old caches are
 * deleted, clients.claim() takes over open pages, and the page reloads itself once
 * (see the controllerchange handler in index.html).
 */
const VERSION = '0.5.5';
const CACHE = 'tempo-shell-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './styles.css?v=' + VERSION,
  './app.js?v=' + VERSION,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first so a fresh deploy is always picked up; cache is the offline fallback.
// Only same-origin GETs are handled — YouTube and i.ytimg.com requests pass straight
// through, so a failed thumbnail can never be answered with the app shell.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
