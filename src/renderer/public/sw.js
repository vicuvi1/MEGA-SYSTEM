// Offline support for the web app, and "Go back one version".
// - On install it downloads everything the app needs (precache.json: every
//   built file and the embedded apps), so the phone opens fully offline.
// - The page (HTML) comes from the network first (a new version shows on the
//   next load); the saved copy only when offline.
// - When a new version is seen, its files are saved too, and the previous
//   version's page and files are kept (one version back), so the crash screen
//   can go back to it: the page asks with {type: 'rollback', bad: <build id>}
//   and the previous version is served until a version other than the bad
//   one is published.
// - Built files (names change every version) come from the cache; the
//   embedded apps show the saved copy and update it in the background.
// - /api/… and other sites are never cached.
const CACHE = 'life-system-files'
const PREV = '/__prev'
const PREV_FILES = '/__prev-files'
const FILES = '/__files'
const ROLLBACK = '/__rollback'
const SPECIAL = new Set(['/', PREV, PREV_FILES, FILES, ROLLBACK])

const abs = (p) => new URL(p, self.location.origin).href
const readJson = async (cache, key) => {
  try {
    const r = await cache.match(key)
    return r ? await r.json() : null
  } catch {
    return null
  }
}
const putJson = (cache, key, v) => cache.put(key, new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } }))

/** Save every file of the published version; keep only it and the one before. */
async function saveVersion() {
  const res = await fetch('/precache.json', { cache: 'no-store' })
  if (!res.ok) return
  const { files } = await res.json()
  const cache = await caches.open(CACHE)
  // One by one (a missing file never stops the rest).
  await Promise.all(files.map((f) => cache.match(f).then((hit) => hit || cache.add(new Request(f, { cache: 'reload' }))).catch(() => null)))
  await putJson(cache, FILES, files)
  const prev = (await readJson(cache, PREV_FILES)) ?? []
  const keep = new Set([...files, ...prev].map(abs))
  for (const p of SPECIAL) keep.add(abs(p))
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req)
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      try {
        await saveVersion()
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

// A tap on a notification: bring the app forward and run that notification's action (M6).
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const id = e.notification.data && e.notification.data.id
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const c = list[0]
      if (c) {
        c.postMessage({ type: 'notif-click', id })
        return c.focus()
      }
      return self.clients.openWindow('/')
    })
  )
})

self.addEventListener('message', (e) => {
  const d = e.data || {}
  if (d.type === 'rollback' && d.bad) {
    e.waitUntil(
      caches.open(CACHE).then(async (c) => {
        const ok = !!(await c.match(PREV))
        if (ok) await putJson(c, ROLLBACK, { bad: String(d.bad), at: Date.now() })
        e.source?.postMessage({ type: 'rollback', ok })
      })
    )
  }
  if (d.type === 'rollback-off') e.waitUntil(caches.open(CACHE).then((c) => c.delete(ROLLBACK)))
})

const put = (req, res) => {
  if (res && res.ok) {
    const copy = res.clone()
    caches.open(CACHE).then((c) => c.put(req, copy))
  }
  return res
}

/** The page: the previous version while a rollback holds, else network first. */
async function page(e) {
  const cache = await caches.open(CACHE)
  const back = await readJson(cache, ROLLBACK)
  if (back) {
    const v = await fetch('/version.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    // A newer version than the broken one is out: back to normal.
    if (v && v.build && String(v.build) !== back.bad) await cache.delete(ROLLBACK)
    else {
      const old = await cache.match(PREV)
      if (old) return old
    }
  }
  try {
    const res = await fetch(e.request)
    if (res.ok) {
      const before = await cache.match('/')
      const html = await res.clone().text()
      const was = before ? await before.text() : null
      if (was !== null && was !== html) {
        // A new version: keep the one before (page + its files), save the new one's files.
        await cache.put(PREV, new Response(was, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        await putJson(cache, PREV_FILES, (await readJson(cache, FILES)) ?? [])
        e.waitUntil(saveVersion().catch(() => null))
      }
      await cache.put('/', new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
    }
    return res
  } catch {
    return (await cache.match('/')) || Response.error()
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/precache.json' || url.pathname === '/version.json' || url.pathname.startsWith('/__')) return

  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(page(e))
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
