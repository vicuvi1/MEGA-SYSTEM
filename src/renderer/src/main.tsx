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
const root = createRoot(document.getElementById('root')!)

// A new version went live while this page was open (its old files are gone):
// load the new one instead of failing (U8).
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
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
if (isIsland) {
  void import('./DesktopIsland').then(({ DesktopIsland }) => root.render(<DesktopIsland />))
} else if (isHud) {
  void Promise.all([import('./appStyles'), import('./HudBar')]).then(([, { HudBar }]) => root.render(<StrictMode><HudBar /></StrictMode>))
} else {
  void import('./errorReport').then((m) => m.installErrorReport())
  // The desktop-only parts (title bar, island feed, auto backups) load only in
  // the desktop app; the website never downloads them.
  const desk = window.desktop
  const none = Promise.resolve(null)
  void Promise.all([
    import('./App'),
    desk ? import('./DesktopBar') : none,
    desk?.islandState ? import('./IslandFeed') : none,
    desk?.writeBackup ? import('./DesktopBackups') : none,
    import('./appStyles')
  ]).then(([{ App }, bar, feed, backups]) =>
    root.render(
      <StrictMode>
        {bar && <bar.DesktopBar />}
        {feed && <feed.IslandFeed />}
        {backups && <backups.DesktopAutoBackup />}
        <App />
      </StrictMode>
    )
  )
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && !window.life && !window.desktop) {
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
