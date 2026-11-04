// Settings → Island log (desktop): the last 30 taps on the island and what
// happened, so a screenshot shows exactly what didn't work and why.
import { useEffect, useState } from 'react'
import { ISLAND_LOG, type IslandLogEntry } from './IslandFeed'
import { Icon } from './Icon'

const read = (): IslandLogEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(ISLAND_LOG) || '[]')
  } catch {
    return []
  }
}

export function IslandLogPanel() {
  const [list, setList] = useState<IslandLogEntry[]>(read)
  useEffect(() => {
    const t = setInterval(() => setList(read()), 3000)
    return () => clearInterval(t)
  }, [])
  if (!window.desktop?.islandState) return null
  const fails = list.filter((e) => !e.ok).length
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="list" /> Island log
        </h2>
        <span className={`sporty-dot ${fails ? 'idle' : list.length ? 'on' : 'off'}`}>{fails ? `${fails} didn't work` : list.length ? 'All taps worked' : 'No taps yet'}</span>
      </header>
      <p className="muted bk-note">The last 30 taps on the desktop island and what happened. Ctrl+Alt+Space opens the island; tray → Island position moves it.</p>
      {list.length > 0 && (
        <ul className="bk-list">
          {[...list].reverse().map((e, i) => (
            <li key={i}>
              <span>{new Date(e.at).toLocaleTimeString()}</span>
              <small>{e.kind}</small>
              <small className={e.ok ? '' : 'bk-error'} style={{ margin: 0 }}>
                {e.ok ? '✓ done' : `⚠ ${e.error}`}
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
