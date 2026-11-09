import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme } from './uiPrefs'

applyTheme()

// AF1: nothing animates while the window is hidden (tray, minimized, other tab).
const markHidden = () => document.documentElement.classList.toggle('doc-hidden', document.hidden)
markHidden()
document.addEventListener('visibilitychange', markHidden)

const search = typeof window !== 'undefined' ? window.location.search : ''
const isHud = search.includes('hud=1')
const isIsland = search.includes('island=1')
const isQuick = search.includes('quick=1')
const root = createRoot(document.getElementById('root')!)

// A new version went live while this page was open (its old files are gone):
// load the new one instead of failing (U8).
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  console.warn('preload failed:', (e as any).payload?.message ?? '')
  try {
    if (Date.now() - Number(sessionStorage.getItem('ls.staleReload') || 0) < 60_000) return
    sessionStorage.setItem('ls.staleReload', String(Date.now()))
  } catch {
    /* private window */
  }
  window.location.reload()
})

// The desktop island is its own small window: it loads only itself (never the
// data layer), so the app window stays the one owner of your data.
if (isQuick) {
  // Quick add from anywhere (the desktop's global shortcut): its own small window, no data layer.
  // The app's own style bundle (importing single stylesheets here would change the order of the app's CSS).
  void Promise.all([import('./appStyles'), import('./quick/QuickWindow')]).then(([, { QuickWindow }]) => root.render(<QuickWindow />))
} else if (isIsland && search.includes('dock=1')) {
  // IN38: the island's mini dock (its own small window).
  void import('./IslandDock').then(({ IslandDock }) => root.render(<IslandDock />))
} else if (isIsland) {
  void import('./DesktopIsland').then(({ DesktopIsland }) => root.render(<DesktopIsland />))
} else if (isHud) {
  void Promise.all([import('./appStyles'), import('./HudBar')]).then(([, { HudBar }]) => root.render(<StrictMode><HudBar /></StrictMode>))
} else {
  void import('./errorReport').then((m) => m.installErrorReport())
  // The soak test (e2e/soak.mjs) makes changes through the app's own functions, only when it set this flag in its browser.
  try {
    if (localStorage.getItem('life_soak') === '1') void import('./bridge').then((m) => ((window as any).__life = m.life))
  } catch {
    /* private window */
  }
  // The desktop-only parts (title bar, island feed, auto backups) load only in
  // the desktop app; the website never downloads them.
  const desk = window.desktop
  const none = Promise.resolve(null)
  // When a file fails to preload (the page is being reloaded, or a new version replaced the old files)
  // the `vite:preloadError` handler above swallows the error and the import resolves to `undefined`:
  // reading `.App` of it threw "Cannot read properties of undefined (reading 'App')". Try once more
  // instead, and show nothing (the reload is on its way) if it still fails.
  const load = <T,>(f: () => Promise<T>): Promise<T> => f().then((m) => m ?? new Promise<T>((r) => setTimeout(r, 300)).then(f))
  void Promise.all([
    load(() => import('./App')),
    desk ? load(() => import('./DesktopBar')) : none,
    desk?.islandState ? load(() => import('./IslandFeed')) : none,
    desk?.writeBackup ? load(() => import('./DesktopBackups')) : none,
    load(() => import('./appStyles'))
  ]).then(([appMod, bar, feed, backups]) =>
    appMod &&
    root.render(
      <StrictMode>
        {bar && <bar.DesktopBar />}
        {feed && <feed.IslandFeed />}
        {backups && <backups.DesktopAutoBackup />}
        <appMod.App />
      </StrictMode>
    )
  )
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && !window.life && !window.desktop && !isQuick) {
  window.addEventListener('load', () => {
    // Always check for a newer offline helper; when one takes over (a new
    // version was published), reload once so you see the new version.
    const hadController = !!navigator.serviceWorker.controller
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !sessionStorage.getItem('sw-reloaded')) {
        sessionStorage.setItem('sw-reloaded', '1')
        window.location.reload()
      }
    })
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => {})
  })
}
