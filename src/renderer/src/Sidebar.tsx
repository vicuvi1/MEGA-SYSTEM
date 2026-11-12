import { useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { Icon, Logo } from './Icon'
import { MODULES, type ModuleDef, type PageId } from './modules'
import { useUiPrefs } from './uiPrefs'
import { useModules } from './useModules'
import { menuPages } from '@core/modules'

export type Badge = { n?: number; dot?: 'lime' | 'warn' }

interface Props {
  page: PageId
  onPage: (p: PageId) => void
  collapsed: boolean
  onToggle: () => void
  badges: Partial<Record<PageId, Badge>>
}

/** Every page the sidebar can draw (core/modules.ts decides which show and in what order). */
export const SIDEBAR_PAGES: PageId[] = MODULES.map((x) => x.id)

export function Sidebar({ page, onPage, collapsed, onToggle, badges }: Props) {
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null)
  const open = !collapsed
  const byId = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<PageId, ModuleDef>
  const [ui] = useUiPrefs()
  // The module switch (Settings → Modules): only the pages of modules that are on, in module order.
  // A module that is off is not here at all (no Archive); its data waits untouched until it is on again.
  const mods = useModules()
  const ids = menuPages(mods, SIDEBAR_PAGES, ui.hiddenPages ?? []) as PageId[]
  let index = 0

  const showTip = (label: string, el: HTMLElement) => {
    if (open) return
    const r = el.getBoundingClientRect()
    setTip({ label, y: r.top + r.height / 2 })
  }

  const go = (p: PageId) => onPage(p)

  return (
    <div className="side-cell">
      <aside
        className={`sb ${collapsed ? 'collapsed' : ''}`}
        onMouseLeave={() => setTip(null)}
      >
        <div className="sb-glow" aria-hidden="true" />

        <div className="sb-brand" title="LIFE — Real Growth">
          <span className="sb-mark" aria-hidden="true">
            <Logo size={22} />
          </span>
          <div className="sb-brand-info">
            <span className="sb-label sb-word">LIFE</span>
            <span className="sb-label sb-tagline">REAL GROWTH</span>
          </div>
        </div>

        <nav className="sb-nav" aria-label="Sections">
          <div className="sb-group" data-testid="sb-modules">
            {ids.map((id) => {
              const m = byId[id]
              if (!m) return null
              // Alt+number goes to the n-th page here, the same as App's shortcut (core/modules.ts altPage).
              const n = ++index
              const on = page === id
              const soon = m.phase > 0
              const b = badges[id]
              return (
                <button
                  key={id}
                  aria-label={m.label}
                  aria-current={on ? 'page' : undefined}
                  className={`sb-item ${on ? 'on' : ''} ${soon ? 'soon' : ''}`}
                  style={{ ['--c' as string]: m.color }}
                  onClick={() => go(id)}
                  onMouseEnter={(e) => showTip(`${m.label}${soon ? ' · soon' : ''}${n < 10 ? `  Alt+${n}` : ''}`, e.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                >
                  {on && <span className="sb-active" />}
                  <span className="sb-tile">
                    <Icon name={m.icon} size={17} duo={on} />
                    {b && <i className={`sb-dot ${b.dot ?? ''}`} />}
                  </span>
                  <span className="sb-label sb-name">{m.label}</span>
                  {soon && (
                    <span className="sb-label sb-lock" title="Coming soon">
                      <Icon name="lock" size={12} />
                    </span>
                  )}
                  {!soon && b?.n ? <span className="sb-label sb-count">{b.n}</span> : null}
                  {!soon && !b?.n && open && n < 10 && <kbd className="sb-label sb-key">{n}</kbd>}
                </button>
              )
            })}
          </div>
          <button
            className="sb-item sb-more"
            style={{ ['--c' as string]: 'var(--muted)' }}
            data-testid="sb-modules-link"
            onClick={() => {
              try {
                localStorage.setItem('ls.settingsTab', 'modules')
              } catch {
                /* this visit only */
              }
              go('settings')
              window.dispatchEvent(new CustomEvent('life-settings-tab', { detail: 'modules' }))
            }}
            onMouseEnter={(e) => showTip('Modules: turn parts of the app on or off', e.currentTarget)}
            onMouseLeave={() => setTip(null)}
            title="Turn parts of the app on or off (Settings → Modules)"
          >
            <span className="sb-tile">
              <Icon name="sliders" size={17} />
            </span>
            <span className="sb-label sb-name">Modules</span>
          </button>
        </nav>

        <button className="sb-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'} title={collapsed ? 'Expand (Ctrl+B)' : 'Collapse (Ctrl+B)'}>
          <span className={collapsed ? 'flip' : ''}>‹</span>
        </button>
      </aside>

      <AnimatePresence>
        {tip && !open && (
          <m.div className="sb-tip" style={{ top: tip.y }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {tip.label}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
