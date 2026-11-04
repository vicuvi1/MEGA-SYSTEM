// Offline support for the web app.
// - On install it downloads everything the app needs (precache.json: every
//   built file and the embedded apps), so the phone opens fully offline.
// - The page (HTML) comes from the network first (a new version shows on the
//   next load); the saved copy only when offline.
// - Built files (names change every version) come from the cache; the
//   embedded apps show the saved copy and update it in the background.
// - Each version keeps only its own files; /api/… and other sites are never cached.
const CACHE = 'life-system-files'

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const res = await fetch('/precache.json', { cache: 'no-store' })
        if (res.ok) {
          const { files } = await res.json()
          const cache = await caches.open(CACHE)
          // One by one (a missing file never stops the rest).
          await Promise.all(files.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => null)))
          // Drop what this version no longer uses.
          const keep = new Set(files.map((f) => new URL(f, self.location.origin).href))
          for (const req of await cache.keys()) if (!keep.has(req.url) && !req.url.endsWith('/')) await cache.delete(req)
        }
      } catch {
        /* offline while installing: the cache fills as pages load */
      }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

const put = (req, res) => {
  if (res && res.ok) {
    const copy = res.clone()
    caches.open(CACHE).then((c) => c.put(req, copy))
  }
  return res
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/precache.json' || url.pathname === '/version.json') return

  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(req)
        .then((res) => put('/', res))
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || /\.(png|svg|woff2?|webmanifest|wasm)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))))
    return
  }

  if (url.pathname.startsWith('/apps/')) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        const fresh = fetch(req)
          .then((res) => put(req, res))
          .catch(() => hit || Response.error())
        return hit || fresh
      })
    )
  }
})
