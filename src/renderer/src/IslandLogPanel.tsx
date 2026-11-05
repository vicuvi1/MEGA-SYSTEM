// Settings → Island log (desktop): the last 30 taps on the island and what
// happened, and what the island itself saw (IS23: views, the pointer, the
// click area, zoom, why it hid, the desktop's own lines), so a screenshot
// shows exactly what didn't work and why.
import { useEffect, useState } from 'react'
import { readIslandLog, readIslandUiLog, type IslandLogEntry, type IslandUiLogEntry } from './islandLog'
import { Icon } from './Icon'

const keyName = (k: string) => (k ? k.replace('Control', 'Ctrl').replace(/\+/g, '+') : '')

export function IslandLogPanel() {
  const [list, setList] = useState<IslandLogEntry[]>(readIslandLog)
  const [seen, setSeen] = useState<IslandUiLogEntry[]>(readIslandUiLog)
  const [more, setMore] = useState(false)
  const [shortcut, setShortcut] = useState<string | null>(null)
  useEffect(() => {
    // The desktop keeps its own lines and the island page's together; an older desktop: what the page saved here.
    const load = () => {
      setList(readIslandLog())
      const get = window.desktop?.islandGetLog
      if (!get) return setSeen(readIslandUiLog())
      get()
        .then((l) => setSeen((l ?? []).map((x) => ({ at: x.at, kind: x.from === 'main' ? 'desktop' : 'island', text: x.line }))))
        .catch(() => setSeen(readIslandUiLog()))
    }
    load()
    const t = setInterval(load, 3000)
    window.desktop?.getIslandPrefs?.().then((p) => setShortcut(p?.shortcut ?? '')).catch(() => {})
    return () => clearInterval(t)
  }, [])
  if (!window.desktop?.islandState) return null
  const fails = list.filter((e) => !e.ok).length
  const key = shortcut == null ? null : keyName(shortcut)
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="list" /> Island log
        </h2>
        <span className={`sporty-dot ${fails ? 'idle' : list.length ? 'on' : 'off'}`}>{fails ? `${fails} didn't work` : list.length ? 'All taps worked' : 'No taps yet'}</span>
      </header>
      <p className="muted bk-note">
        The last 30 taps on the desktop island and what happened. {key ? `${key} opens the island; ` : key === '' ? 'No shortcut is set to open the island; ' : ''}tray → Island position moves it.
      </p>
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
      {seen.length > 0 && (
        <>
          <p className="muted bk-note">
            What the island saw: opening and closing, the mouse, its click area, zoom, and why it hid.{' '}
            <button className="btn small ghost" onClick={() => setMore((x) => !x)}>
              {more ? 'Show less' : `Show all ${seen.length}`}
            </button>
          </p>
          <ul className="bk-list">
            {[...seen].reverse().slice(0, more ? 200 : 12).map((e, i) => (
              <li key={i}>
                <span>{new Date(e.at).toLocaleTimeString()}</span>
                <small>{e.kind}</small>
                <small style={{ margin: 0 }}>{e.text}</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
