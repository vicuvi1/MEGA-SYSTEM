// Adds the System and AI usage pages to the opened island (only in the
// desktop app, and only the ones switched on in Settings → Desktop island).
import { registerIslandPage } from '../widgets/islandPages'
import { AiUsagePage } from './AiUsagePage'
import { SystemPage } from './SystemPage'
import { hasSysmon, onSysmonPrefs } from './sysmonFeed'
import './sysmon.css'

let offSystem: (() => void) | null = null
let offAi: (() => void) | null = null

if (hasSysmon()) {
  onSysmonPrefs((p) => {
    if (p.pages.system && !offSystem) offSystem = registerIslandPage({ id: 'system', title: 'System', icon: '🖥️', order: 40, render: (ctx) => <SystemPage tap={ctx.tap} /> })
    if (!p.pages.system && offSystem) offSystem = (offSystem(), null)
    if (p.pages.ai && !offAi) offAi = registerIslandPage({ id: 'ai', title: 'AI usage', icon: '🤖', order: 45, render: () => <AiUsagePage /> })
    if (!p.pages.ai && offAi) offAi = (offAi(), null)
  })
}
