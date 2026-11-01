import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { HudBar } from './HudBar'
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

const isHud = typeof window !== 'undefined' && window.location.search.includes('hud=1')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isHud ? <HudBar /> : <App />}
  </StrictMode>
)

if (typeof window !== 'undefined' && 'serviceWorker' in navigator && !window.life) {
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
