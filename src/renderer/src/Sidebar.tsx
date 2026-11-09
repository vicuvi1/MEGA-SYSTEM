import { useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { Icon, Logo } from './Icon'
import { MODULES, SYSTEM_PAGES, type ModuleDef, type PageId } from './modules'
import { useUiPrefs } from './uiPrefs'
import { buildNav, movePin, togglePin } from './navLayout'
import { useNavPrefs } from './navPrefs'

export type Badge = { n?: number; dot?: 'lime' | 'warn' }

interface Props {
  page: PageId
  onPage: (p: PageId) => void
  collapsed: boolean
  onToggle: () => void
  badges: Partial<Record<PageId, Badge>>
}

export function Sidebar({ page, onPage, collapsed, onToggle, badges }: Props) {
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null)
  const [drag, setDrag] = useState<PageId | null>(null)
  const open = !collapsed
  const byId = Object.fromEntries([...MODULES, ...SYSTEM_PAGES].map((m) => [m.id, m])) as Record<PageId, ModuleDef>
  const [ui] = useUiPrefs()
  const [prefs, setPrefs] = useNavPrefs()
  const sections = buildNav(prefs, new Set(ui.hiddenPages ?? []))
  // More stays open while you are on one of its pages.
  const moreOpen = prefs.more || !!sections.find((s) => s.id === 'more')?.ids.includes(page)
  let index = 0

  const showTip = (label: string, el: HTMLElement) => {
    if (open) return
    const r = el.getBoundingClientRect()
    setTip({ label, y: r.top + r.height / 2 })
  }

  const item = (id: PageId, pinned: boolean) => {
    const m = byId[id]
    if (!m) return null
    const n = ++index
    const on = page === id
    const soon = m.phase > 0
    const b = badges[id]
    const isPin = prefs.pins.includes(id)
    return (
      <div
        key={id}
        className={`sb-row ${drag === id ? 'dragging' : ''}`}
        draggable={pinned && open}
        onDragStart={pinned ? (e) => (setDrag(id), e.dataTransfer.setData('text/plain', id), (e.dataTransfer.effectAllowed = 'move')) : undefined}
        onDragOver={pinned && drag ? (e) => e.preventDefault() : undefined}
        onDrop={pinned && drag ? (e) => (e.preventDefault(), setPrefs((p) => movePin(p, drag, id)), setDrag(null)) : undefined}
        onDragEnd={() => setDrag(null)}
      >
        <button
          aria-label={m.label}
          aria-current={on ? 'page' : undefined}
          className={`sb-item ${on ? 'on' : ''} ${soon ? 'soon' : ''}`}
          style={{ ['--c' as string]: m.color }}
          onClick={() => onPage(id)}
          onKeyDown={
            pinned
              ? (e) => {
                  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                  e.preventDefault()
                  setPrefs((p) => movePin(p, id, e.key === 'ArrowUp' ? -1 : 1))
                }
              : undefined
          }
          onMouseEnter={(e) => showTip(`${m.label}${soon ? ' · soon' : ''}${n <= 9 ? `  Alt+${n}` : ''}`, e.currentTarget)}
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
        </button>
        {open && id !== 'today' && (
          <button
            type="button"
            className={`sb-pin ${isPin ? 'on' : ''}`}
            aria-label={isPin ? `Unpin ${m.label}` : `Pin ${m.label} to the top`}
            title={isPin ? 'Unpin (drag pinned pages to reorder; Alt+↑/↓ also moves them)' : 'Pin to the top'}
            aria-pressed={isPin}
            onClick={() => setPrefs((p) => togglePin(p, id))}
          >
            <Icon name="pin" size={13} />
          </button>
        )}
      </div>
    )
  }

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
          {sections.map((g) =>
            g.id === 'more' ? (
              <div key={g.id} className={`sb-group sb-more ${moreOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="sb-more-btn"
                  aria-expanded={moreOpen}
                  aria-label={moreOpen ? 'Show fewer pages' : `More pages: ${g.ids.map((id) => byId[id]?.label).join(', ')}`}
                  onClick={() => setPrefs((p) => ({ ...p, more: !moreOpen }))}
                  onMouseEnter={(e) => showTip(moreOpen ? 'Fewer pages' : 'More pages', e.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                >
                  <span className="sb-tile">
                    <Icon name={moreOpen ? 'chevron' : 'dots'} size={17} />
                  </span>
                  <span className="sb-label sb-name">{g.title}</span>
                  <span className="sb-label sb-more-n">{moreOpen ? '' : g.ids.length}</span>
                </button>
                {moreOpen && g.ids.map((id) => item(id, false))}
              </div>
            ) : (
              <div key={g.id} className={`sb-group sb-g-${g.id}`}>
                {g.title && <div className="sb-group-title sb-label">{g.title}</div>}
                {g.ids.map((id) => item(id, g.id === 'pinned'))}
              </div>
            )
          )}
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
