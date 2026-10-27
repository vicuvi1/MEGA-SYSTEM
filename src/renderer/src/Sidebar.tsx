import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LevelInfo } from '@shared/api'
import { Icon, Logo } from './Icon'
import { MODULES, SYSTEM_PAGES, type ModuleDef, type PageId } from './modules'

export type Badge = { n?: number; dot?: 'lime' | 'warn' }

interface Props {
  page: PageId
  onPage: (p: PageId) => void
  collapsed: boolean
  onToggle: () => void
  badges: Partial<Record<PageId, Badge>>
  level: LevelInfo | null
  balance: number
  name: string
}

// Sections in groups, in the order they appear.
const GROUPS: { title: string; ids: PageId[] }[] = [
  { title: 'Plan', ids: ['today', 'tasks', 'schedule'] },
  { title: 'Life', ids: ['sleep', 'discipline', 'money'] },
  { title: 'Rewards', ids: ['shop', 'journey'] }
]
const SHORT: Partial<Record<PageId, string>> = { rules: 'Rules', connected: 'Apps' }

export function Sidebar({ page, onPage, collapsed, onToggle, badges, level, balance, name }: Props) {
  const [peek, setPeek] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const [tip, setTip] = useState<{ label: string; y: number } | null>(null)
  const open = !collapsed || peek
  const byId = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<PageId, ModuleDef>
  let index = 0

  const showTip = (label: string, el: HTMLElement) => {
    if (open) return
    const r = el.getBoundingClientRect()
    setTip({ label, y: r.top + r.height / 2 })
  }

  const go = (p: PageId) => {
    onPage(p)
    setPeek(false)
  }

  return (
    <div className="side-cell">
      <aside
        className={`sb ${collapsed ? 'collapsed' : ''} ${collapsed && peek ? 'peek' : ''}`}
        onMouseEnter={() => {
          if (!collapsed) return
          clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            setTip(null)
            setPeek(true)
          }, 380)
        }}
        onMouseLeave={() => {
          clearTimeout(timer.current)
          setPeek(false)
          setTip(null)
        }}
      >
        <div className="sb-glow" aria-hidden="true" />

        <div className="sb-brand" title="LIFE — Real Growth RPG">
          <span className="sb-mark" aria-hidden="true">
            <Logo size={22} />
          </span>
          <div className="sb-brand-info">
            <span className="sb-label sb-word">LIFE</span>
            <span className="sb-label sb-tagline">REAL GROWTH</span>
          </div>
        </div>

        <nav className="sb-nav" aria-label="Sections">
          {GROUPS.map((g) => (
            <div key={g.title} className="sb-group">
              <div className="sb-group-title sb-label">{g.title}</div>
              {g.ids.map((id) => {
                const m = byId[id]
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
                    onMouseEnter={(e) => showTip(`${m.label}${soon ? ' · soon' : ''}  Alt+${n}`, e.currentTarget)}
                    onMouseLeave={() => setTip(null)}
                  >
                    {on && <motion.span layoutId="sb-active" className="sb-active" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
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
                    {!soon && !b?.n && open && <kbd className="sb-label sb-key">{n}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <div className="sb-tools" role="group" aria-label="System">
            {SYSTEM_PAGES.map((m) => {
              const on = page === m.id
              const b = badges[m.id]
              return (
                <button
                  key={m.id}
                  aria-label={m.label}
                  className={`sb-tool ${on ? 'on' : ''}`}
                  onClick={() => go(m.id)}
                  onMouseEnter={(e) => showTip(m.label, e.currentTarget)}
                  onMouseLeave={() => setTip(null)}
                  title={open ? m.label : undefined}
                >
                  <Icon name={m.icon} size={16} duo={on} />
                  {b && <i className={`sb-dot ${b.dot ?? ''}`} />}
                  <span className="sb-label sb-tool-name">{SHORT[m.id] ?? m.label}</span>
                </button>
              )
            })}
          </div>

          {level && (
            <button className="sb-me" onClick={() => go('today')} onMouseEnter={(e) => showTip(`Level ${level.level} · ${level.rank}`, e.currentTarget)} onMouseLeave={() => setTip(null)}>
              <span className="sb-ring" style={{ ['--p' as string]: `${Math.round(level.progress * 100)}` }}>
                <span>{level.level}</span>
              </span>
              <span className="sb-label sb-me-text">
                <b>{name || 'You'}</b>
                <small>{level.rank}</small>
              </span>
              <span className="sb-label sb-me-coins">
                <i className="coin-dot" />
                {balance.toLocaleString()}
              </span>
            </button>
          )}
        </div>

        <button className="sb-toggle" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'} title={collapsed ? 'Expand (Ctrl+B)' : 'Collapse (Ctrl+B)'}>
          <span className={collapsed ? 'flip' : ''}>‹</span>
        </button>
      </aside>

      <AnimatePresence>
        {tip && !open && (
          <motion.div className="sb-tip" style={{ top: tip.y }} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {tip.label}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
