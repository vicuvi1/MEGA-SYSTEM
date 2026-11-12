import { useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { Icon, Logo } from './Icon'
import { MODULES, type ModuleDef, type PageId } from './modules'
import { useUiPrefs } from './uiPrefs'
import { useSimple } from './useSimple'
import { simpleMenu } from '@core/simpleMode'

export type Badge = { n?: number; dot?: 'lime' | 'warn' }

interface Props {
  page: PageId
  onPage: (p: PageId) => void
  collapsed: boolean
  onToggle: () => void
  badges: Partial<Record<PageId, Badge>>
}

// Sections in groups, in the order they appear (the full menu, Simple mode off).
const GROUPS: { title: string; ids: PageId[] }[] = [
  { title: 'Plan', ids: ['today', 'calendar', 'tasks', 'study', 'coach', 'goals', 'season', 'career', 'progress', 'shop'] },
  { title: 'Life', ids: ['sleep', 'body', 'locker', 'money', 'discipline', 'music', 'custom'] }
]
/** The full menu's order (for Alt+number when Simple mode is off). */
export const FULL_MENU: PageId[] = GROUPS.flatMap((g) => g.ids)

// Simple mode's Archive group: closed unless you opened it (this device), or you are on one of its pages.
const ARCHIVE_OPEN = 'ls.sbArchive'
const readOpen = () => {
  try {
    return localStorage.getItem(ARCHIVE_OPEN) === '1'
  } catch {
    return false
  }
}

export function Sidebar({ page, onPage, collapsed, onToggle, badges }: Props) {
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null)
  const open = !collapsed
  const byId = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<PageId, ModuleDef>
  const [ui] = useUiPrefs()
  // Simple mode: Today, Study Time, Sport Track (plus pages you brought back); the rest under Archive (core/simpleMode.ts).
  const simple = useSimple()
  const menu = simpleMenu(simple)
  const hiddenPages = new Set(ui.hiddenPages ?? [])
  const [archiveOpen, setArchiveOpen] = useState(readOpen)
  const onArchivePage = !!menu && (menu.archive as string[]).includes(page)
  const showArchive = archiveOpen || onArchivePage
  const toggleArchive = () => {
    const next = !showArchive
    setArchiveOpen(next)
    try {
      localStorage.setItem(ARCHIVE_OPEN, next ? '1' : '0')
    } catch {
      /* private window: stays for this visit */
    }
  }
  const groups: { title: string; ids: PageId[]; archive?: boolean }[] = menu
    ? [
        { title: 'Daily', ids: menu.main as PageId[] },
        { title: 'Archive', ids: menu.archive as PageId[], archive: true }
      ]
    : GROUPS.map((g) => ({ ...g, ids: g.ids.filter((id) => !hiddenPages.has(id)) }))
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
          {groups.map((g) => (
            <div key={g.title} className={`sb-group ${g.archive ? 'sb-archive' : ''}`} data-testid={g.archive ? 'sb-archive' : undefined}>
              {g.archive ? (
                <button
                  className="sb-item sb-archive-toggle"
                  style={{ ['--c' as string]: 'var(--muted)' }}
                  aria-expanded={showArchive}
                  data-testid="sb-archive-toggle"
                  onClick={toggleArchive}
                  title={showArchive ? 'Close the Archive' : `Archive: ${g.ids.length} pages you don't use every day (nothing is deleted)`}
                  onMouseEnter={(e) => showTip(`Archive · ${g.ids.length} pages`, e.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                >
                  <span className="sb-tile">
                    <Icon name="grid" size={17} />
                  </span>
                  <span className="sb-label sb-name">Archive</span>
                  <span className="sb-label sb-count">{showArchive ? '▾' : `${g.ids.length} ▸`}</span>
                </button>
              ) : (
                <div className="sb-group-title sb-label">{g.title}</div>
              )}
              {(!g.archive || showArchive) && g.ids.map((id) => {
                const m = byId[id]
                if (!m) return null
                // Alt+number goes to the pages in the menu (not the archive), the same as App's shortcut.
                const n = g.archive ? 0 : ++index
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
                    onMouseEnter={(e) => showTip(`${m.label}${soon ? ' · soon' : ''}${n && n < 10 ? `  Alt+${n}` : ''}`, e.currentTarget)}
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
                    {!soon && !b?.n && open && n > 0 && n < 10 && <kbd className="sb-label sb-key">{n}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        {menu && (
          <button
            aria-label="Settings"
            aria-current={page === 'settings' ? 'page' : undefined}
            className={`sb-item sb-settings ${page === 'settings' ? 'on' : ''}`}
            style={{ ['--c' as string]: 'var(--muted)' }}
            onClick={() => go('settings')}
            onMouseEnter={(e) => showTip('Settings', e.currentTarget)}
            onMouseLeave={() => setTip(null)}
          >
            {page === 'settings' && <span className="sb-active" />}
            <span className="sb-tile">
              <Icon name="gear" size={17} duo={page === 'settings'} />
            </span>
            <span className="sb-label sb-name">Settings</span>
          </button>
        )}

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
