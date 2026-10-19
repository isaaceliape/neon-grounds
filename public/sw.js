// Neon Grounds offline shell. The game itself needs a connection (local server
// or WebRTC room), but the page, art, and code load from cache after the
// first visit, which is also what makes the app installable.
// Bump CACHE on release so updates replace the old shell.
const CACHE = 'neon-grounds-v1'
// Vite build output: flat stable names (see vite.config.js). The landing
// lives at /, the game bundles (play.js/play.css + host-session.js chunk)
// serve /play/; the rest below ships verbatim from public/.
const SHELL = [
  './',
  'index.html',
  'play/',
  'play/index.html',
  'manifest.webmanifest',
  'play.js',
  'play.css',
  'host-session.js',
  'peerjs.min.js',
  'qrcode.min.js',
  'jsqr.min.js',
  'vendor/fontawesome/css/fontawesome.min.css',
  'vendor/fontawesome/css/solid.min.css',
  'vendor/fontawesome/webfonts/fa-solid-900.woff2',
  'vendor/fonts/rocket-clouds-demo.woff2',
  'theme.mp3',
  'shots/picker.png',
  'shots/waiting-room.png',
  'shots/round.png',
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
    // Pages first so deploys show up immediately; offline, fall back to
    // the cached page itself, then the game, then the landing.
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request)
          .then(
            (hit) =>
              hit ||
              caches
                .match('play/index.html')
                .then((game) => game || caches.match('index.html')),
          ),
      ),
    )
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
