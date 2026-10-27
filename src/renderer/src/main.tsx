import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import './plan.css'
import './discipline.css'
import './shell.css'
import './extras.css'
import './light.css'
import './sidebar.css'
import './bots.css'
import './economy.css'
import './hunter.css'
import './soloLeveling.css'
import './todoist.css'
import './gameRules.css'
import { applyTheme } from './uiPrefs'

applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
