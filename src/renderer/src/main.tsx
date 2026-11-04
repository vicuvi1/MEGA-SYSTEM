import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './plan.css'
import './discipline.css'
import './shell.css'
import './extras.css'
import './light.css'
import './sidebar.css'
import './bots.css'
import './hud.css'
import './calm.css'
import './design.css'
import { applyTheme } from './uiPrefs'

applyTheme()

const search = typeof window !== 'undefined' ? window.location.search : ''
const isHud = search.includes('hud=1')
const isIsland = search.includes('island=1')
const root = createRoot(document.getElementById('root')!)

// The desktop island is its own small window: it loads only itself (never the
// data layer), so the app window stays the one owner of your data.
if (isIsland) {
  void import('./DesktopIsland').then(({ DesktopIsland }) => root.render(<DesktopIsland />))
} else if (isHud) {
  void import('./HudBar').then(({ HudBar }) => root.render(<StrictMode><HudBar /></StrictMode>))
} else {
  void import('./errorReport').then((m) => m.installErrorReport())
  void Promise.all([import('./App'), import('./DesktopBar'), import('./IslandFeed'), import('./DesktopBackups')]).then(([{ App }, { DesktopBar }, { IslandFeed }, { DesktopAutoBackup }]) =>
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
