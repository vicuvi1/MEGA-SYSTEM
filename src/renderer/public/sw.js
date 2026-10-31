// Offline support for the web app. The page itself (HTML) always comes from
// the network first, so a new version shows on the next load; the cached copy
// is only for when you're offline. Built files (/assets/…, names change with
// every version) come from the cache. The server (/api/…) and other sites
// are never cached.
const CACHE_NAME = 'life-system-pwa-v3'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // The page: newest from the network; the saved copy only when offline.
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put('/', copy))
          }
          return res
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    )
    return
  }

  // Built files never change under the same name: cache first.
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|woff2?|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE_NAME).then((c) => c.put(req, copy))
            }
            return res
          })
      )
    )
  }
  // Everything else (the embedded apps' files): straight from the network.
})
