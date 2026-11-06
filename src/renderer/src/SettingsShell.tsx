// Settings as sections: a menu on the left (chips on a phone), the chosen
// section on the right using the full width, a search box that jumps to the
// right section, and the developer things folded under Advanced.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import { SectionJump, SectionTabs, type SectionTab } from './SettingsTabs'
import './settingsLook.css'

export interface SettingsGroup {
  id: string
  label: string
  icon: string
  /** One line under the title. */
  hint: string
  /** Words the search knows this section by. */
  keywords: string
  body: ReactNode
  /** Shown under "Advanced" at the bottom of the menu. */
  advanced?: boolean
  /** A long section: a switch between its cards (by their headings). */
  tabs?: SectionTab[]
  /** One long card: a jump bar to the headings this selector finds. */
  jump?: string
}

const KEY = 'ls.settingsTab'
const read = () => {
  try {
    return localStorage.getItem(KEY) || ''
  } catch {
    return ''
  }
}

export function SettingsShell({ groups, initial }: { groups: SettingsGroup[]; initial?: string }) {
  const [tab, setTabRaw] = useState(() => initial || read() || groups[0]?.id)
  const [q, setQ] = useState('')
  const setTab = (id: string) => {
    setTabRaw(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private window */
    }
  }
  // Settings → Updates and similar links from elsewhere in the app.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent).detail
      if (groups.some((g) => g.id === id)) setTab(id)
    }
    window.addEventListener('life-settings-tab', on)
    return () => window.removeEventListener('life-settings-tab', on)
  }, [groups])
  const words = q.trim().toLowerCase()
  const matches = useMemo(() => (words ? groups.filter((g) => `${g.label} ${g.hint} ${g.keywords}`.toLowerCase().includes(words)) : groups), [groups, words])
  const current = groups.find((g) => g.id === tab) ?? groups[0]
  const main = matches.filter((g) => !g.advanced)
  const adv = matches.filter((g) => g.advanced)
  const item = (g: SettingsGroup) => (
    <button key={g.id} className={`st-item ${g.id === current?.id ? 'on' : ''}`} onClick={() => setTab(g.id)} aria-current={g.id === current?.id ? 'page' : undefined} title={g.hint}>
      <Icon name={g.icon as any} size={16} />
      <b>{g.label}</b>
    </button>
  )
  return (
    <div className="st">
      <nav className="st-nav" aria-label="Settings sections">
        <label className="st-search">
          <Icon name="search" size={14} />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              const w = e.target.value.trim().toLowerCase()
              const first = w && groups.find((g) => `${g.label} ${g.hint} ${g.keywords}`.toLowerCase().includes(w))
              if (first) setTab(first.id)
            }}
            placeholder="Search settings"
            aria-label="Search settings"
          />
        </label>
        {main.map(item)}
        {adv.length > 0 && (
          <>
            <span className="st-sep">Advanced</span>
            {adv.map(item)}
          </>
        )}
        {!matches.length && <p className="hint st-none">Nothing called “{q}”.</p>}
      </nav>
      {current && (
        <section className="st-body" key={current.id} aria-label={current.label}>
          <header className="st-head">
            <h1>{current.label}</h1>
            <p>{current.hint}</p>
          </header>
          {current.tabs ? (
            <SectionTabs section={current.id} tabs={current.tabs}>
              {current.body}
            </SectionTabs>
          ) : current.jump ? (
            <SectionJump section={current.id} selector={current.jump}>
              {current.body}
            </SectionJump>
          ) : (
            <div className="st-grid">{current.body}</div>
          )}
        </section>
      )}
    </div>
  )
}
