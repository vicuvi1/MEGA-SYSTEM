const CACHE_NAME = 'life-system-pwa-v2'
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon.png'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // Never cache external API endpoints or real-time database queries
  if (
    url.hostname.includes('turso.io') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('openrouter.ai') ||
    url.hostname.includes('telegram.org') ||
    url.hostname.includes('er-api.com') ||
    url.hostname.includes('binance.com') ||
    e.request.method !== 'GET'
  ) {
    return
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) {
        // Stale-while-revalidate for local assets
        fetch(e.request).then((networkRes) => {
          if (networkRes.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkRes))
          }
        }).catch(() => {})
        return cached
      }
      return fetch(e.request).then((res) => {
        if (res.status === 200 && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.png') || url.pathname.endsWith('.html'))) {
          const resClone = res.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone))
        }
        return res
      })
    })
  )
})
