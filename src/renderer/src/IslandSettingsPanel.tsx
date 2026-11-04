// Settings → Desktop island: size, see-through, look, which sections and in
// what order, sound, how fast it hides, and your shortcut. Saved on this PC.
import { useEffect, useState } from 'react'
import { SECTION_LABEL, SHORTCUTS, type IslandPrefs } from '@core/islandModel'
import { Icon } from './Icon'

const keyName = (k: string) => (k ? k.replace('Control', 'Ctrl').replace(/\+/g, ' + ') : 'No shortcut')

export function IslandSettingsPanel() {
  const desk = window.desktop
  const [p, setP] = useState<IslandPrefs | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    desk?.getIslandPrefs?.().then(setP).catch(() => {})
  }, [desk])
  if (!desk?.setIslandPrefs || !p) return null

  const save = async (patch: Partial<IslandPrefs>) => {
    setP({ ...p, ...patch })
    const r = await desk.setIslandPrefs!(patch)
    if (r) {
      setP(r.prefs)
      setMsg(r.shortcutOk ? '' : 'That shortcut is taken by another app: pick another one.')
    }
  }
  const move = (i: number, d: -1 | 1) => {
    const list = [...p.sections]
    const j = i + d
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    void save({ sections: list })
  }
  const seg = <K extends keyof IslandPrefs>(k: K, opts: [IslandPrefs[K], string][]) => (
    <div className="seg-row">
      {opts.map(([v, label]) => (
        <button key={String(v)} className={`chip ${p[k] === v ? 'on' : ''}`} onClick={() => void save({ [k]: v } as Partial<IslandPrefs>)}>
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <section className="panel is-panel">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Desktop island
        </h2>
      </header>
      <p className="muted bk-note">How the island at the top (or side) of your screen looks and behaves. Changes show right away.</p>
      <div className="is-grid">
        <label>Size</label>
        {seg('size', [['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']])}
        <label>Look</label>
        {seg('look', [['black', 'Black'], ['glass', 'Glass'], ['mood', "Ben's mood glow"]])}
        <label>See-through</label>
        <div className="is-range">
          <input type="range" min={55} max={100} step={5} value={Math.round(p.opacity * 100)} onChange={(e) => void save({ opacity: Number(e.target.value) / 100 })} />
          <span>{Math.round(p.opacity * 100)}%</span>
        </div>
        <label>Tucks away</label>
        {seg('hide', [['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow']])}
        <label>Sound</label>
        {seg('sound', [[true, 'Chime when it drops down'], [false, 'Silent']])}
        <label>Shortcut</label>
        <div className="seg-row">
          {SHORTCUTS.map((k) => (
            <button key={k || 'none'} className={`chip ${p.shortcut === k ? 'on' : ''}`} onClick={() => void save({ shortcut: k })}>
              {keyName(k)}
            </button>
          ))}
        </div>
        <label>Sections</label>
        <ul className="is-sections">
          {p.sections.map((x, i) => (
            <li key={x.id} className={x.on ? '' : 'off'}>
              <label>
                <input type="checkbox" checked={x.on} onChange={() => void save({ sections: p.sections.map((y) => (y.id === x.id ? { ...y, on: !y.on } : y)) })} />
                {SECTION_LABEL[x.id]}
              </label>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                ↑
              </button>
              <button className="icon-btn" disabled={i === p.sections.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                ↓
              </button>
            </li>
          ))}
        </ul>
      </div>
      {msg && <p className="bk-error">{msg}</p>}
    </section>
  )
}
