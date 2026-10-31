// The phone's bottom bar: Today, Tasks, the quick command, Discipline and
// More (every other page you use, Settings → Today screen & pages).
import { useState } from 'react'
import { Icon } from './Icon'
import { MODULES, SYSTEM_PAGES, type PageId } from './modules'
import { useUiPrefs } from './uiPrefs'

interface Props {
  page: PageId
  onGo: (p: PageId) => void
  onQuickCommand: () => void
}

function haptic(ms = 12) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(ms)
    } catch {}
  }
}

const MAIN: { id: PageId; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { id: 'today', label: 'Today', icon: 'home' },
  { id: 'focus', label: 'Focus', icon: 'clock' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' }
]

export function MobileBottomBar({ page, onGo, onQuickCommand }: Props) {
  const [more, setMore] = useState(false)
  const [ui] = useUiPrefs()
  const hidden = new Set(ui.hiddenPages ?? [])
  const go = (p: PageId) => {
    haptic(10)
    setMore(false)
    onGo(p)
  }
  const main = MAIN.filter((m) => m.id === 'today' || !hidden.has(m.id))
  const rest = [...MODULES, ...SYSTEM_PAGES].filter(
    (m, i, all) => m.phase === 0 && !main.some((x) => x.id === m.id) && (m.id === 'settings' || !hidden.has(m.id)) && all.findIndex((x) => x.id === m.id) === i
  )
  const inMore = rest.some((m) => m.id === page)
  const button = (m: { id: PageId; label: string; icon: any }) => (
    <button key={m.id} type="button" className={`mobile-nav-btn ${page === m.id ? 'active' : ''}`} onClick={() => go(m.id)}>
      <span className="mobile-nav-icon">
        <Icon name={m.icon} size={19} />
      </span>
      <span>{m.label}</span>
    </button>
  )

  return (
    <>
      {more && (
        <div className="mobile-more" role="dialog" aria-label="All pages" onClick={() => setMore(false)}>
          <div className="mobile-more-card" onClick={(e) => e.stopPropagation()}>
            {rest.map((m) => (
              <button key={m.id} type="button" className={`mobile-more-item ${page === m.id ? 'active' : ''}`} onClick={() => go(m.id)} style={{ ['--c' as string]: m.color }}>
                <Icon name={m.icon as any} size={20} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
        {main.slice(0, 2).map(button)}
        <button
          type="button"
          className="mobile-nav-action-btn"
          onClick={() => {
            haptic(18)
            onQuickCommand()
          }}
          title="Quick log: type what you did"
        >
          <span className="mobile-nav-action-icon">⚡</span>
        </button>
        {main.slice(2).map(button)}
        <button type="button" className={`mobile-nav-btn ${more || inMore ? 'active' : ''}`} onClick={() => setMore((o) => !o)} aria-expanded={more}>
          <span className="mobile-nav-icon">
            <Icon name="list" size={19} />
          </span>
          <span>More</span>
        </button>
      </nav>
    </>
  )
}
