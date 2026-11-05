import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyTheme } from './uiPrefs'

applyTheme()

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
  void Promise.all([import('./App'), import('./DesktopBar'), import('./IslandFeed'), import('./DesktopBackups'), import('./appStyles')]).then(([{ App }, { DesktopBar }, { IslandFeed }, { DesktopAutoBackup }]) =>
    root.render(
      <StrictMode>
        <DesktopBar />
        {window.desktop?.islandState && <IslandFeed />}
        {window.desktop?.writeBackup && <DesktopAutoBackup />}
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
