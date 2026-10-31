// Settings → Today screen & pages: which Today sections show, in what order,
// and which pages appear in the menus. Kept on this device (uiPrefs).
import { MODULES, SYSTEM_PAGES } from './modules'
import { Icon } from './Icon'
import { TODAY_SECTIONS, todayLayout, useUiPrefs } from './uiPrefs'

export function LayoutEditor() {
  const [ui, setUi] = useUiPrefs()
  const layout = todayLayout(ui)
  const info = (id: string) => TODAY_SECTIONS.find((x) => x.id === id)!

  const move = (i: number, d: -1 | 1) => {
    const next = layout.slice()
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setUi({ today: next })
  }
  const toggle = (i: number) => setUi({ today: layout.map((x, k) => (k === i ? { ...x, on: !x.on } : x)) })
  const hidden = new Set(ui.hiddenPages ?? [])
  const togglePage = (id: string) => {
    const next = new Set(hidden)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setUi({ hiddenPages: [...next] })
  }
  const pages = [...MODULES, ...SYSTEM_PAGES].filter((m, i, all) => m.phase === 0 && m.id !== 'today' && m.id !== 'settings' && all.findIndex((x) => x.id === m.id) === i)

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="sliders" /> Today screen & pages
        </h2>
        <button className="btn small ghost" onClick={() => setUi({ today: [], hiddenPages: [] })}>
          Reset
        </button>
      </header>
      <p className="hint block">Show only what you use. The order here is the order on Today.</p>
      <ul className="layout-list">
        {layout.map((x, i) => (
          <li key={x.id} className={x.on ? '' : 'off'}>
            <label className="check">
              <input type="checkbox" checked={x.on} onChange={() => toggle(i)} />
              <span>
                {info(x.id).label}
                <small>{info(x.id).hint}</small>
              </span>
            </label>
            <span className="layout-move">
              <button className="icon-btn" aria-label={`Move ${info(x.id).label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ▲
              </button>
              <button className="icon-btn" aria-label={`Move ${info(x.id).label} down`} disabled={i === layout.length - 1} onClick={() => move(i, 1)}>
                ▼
              </button>
            </span>
          </li>
        ))}
      </ul>
      <h3 className="layout-sub">Pages in the menu</h3>
      <div className="layout-pages">
        {pages.map((m) => (
          <label key={m.id} className="check">
            <input type="checkbox" checked={!hidden.has(m.id)} onChange={() => togglePage(m.id)} />
            <span>{m.label}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
