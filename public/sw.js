// Territory offline shell. The game itself needs a connection (local server
// or WebRTC room), but the page, art, and code load from cache after the
// first visit, which is also what makes the app installable.
// Bump CACHE on release so updates replace the old shell.
const CACHE = 'territory-v2'
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'client.js',
  'fx.js',
  'game.js',
  'host-session.js',
  'p2p.js',
  'peerjs.min.js',
  'sfx.js',
  'style.css',
  'view-helpers.js',
  'icon-192.png',
  'icon-512.png',
  'maskable-512.png',
  'apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    // Pages first so deploys show up immediately; the cached shell is the
    // fallback when offline.
    event.respondWith(fetch(request).catch(() => caches.match('index.html')))
    return
  }
  // Assets: serve the cache now, refresh it in the background.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => hit)
      return hit || fresh
    }),
  )
})
