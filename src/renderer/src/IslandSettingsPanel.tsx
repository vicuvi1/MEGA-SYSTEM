// Settings → Desktop island: size, see-through, look, which sections and in
// what order, sound, how fast it hides, and your shortcut. Saved on this PC.
import { useEffect, useState } from 'react'
import { SECTION_LABEL, SHORTCUTS, type IslandPrefs } from '@core/islandModel'
import { Icon } from './Icon'
import { ReorderList, Row, Saved, Segmented, Switch, useSaved } from './settingsUi'

const keyName = (k: string) => (k ? k.replace('Control', 'Ctrl').replace(/\+/g, ' + ') : 'No shortcut')

export function IslandSettingsPanel() {
  const desk = window.desktop
  const [p, setP] = useState<IslandPrefs | null>(null)
  const [msg, setMsg] = useState('')
  const [flash, saved] = useSaved()
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
      saved()
    }
  }
  const opt = <K extends keyof IslandPrefs>(k: K, label: string, opts: [IslandPrefs[K], string][]) => (
    <Segmented label={label} value={p[k] as any} options={opts as any} onChange={(v) => void save({ [k]: v } as Partial<IslandPrefs>)} />
  )

  return (
    <section className="panel is-panel">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Desktop island
        </h2>
        <Saved show={flash} />
      </header>
      <p className="muted bk-note">How the island at the edge of your screen looks and behaves. Changes show right away.</p>
      <Row title="Size" hint="The pill, the card and their click areas">
        {opt('size', 'Size', [['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']])}
      </Row>
      <Row title="Look" hint="Black like an iPhone, glass, or a glow in Ben's mood">
        {opt('look', 'Look', [['black', 'Black'], ['glass', 'Glass'], ['mood', 'Mood glow']])}
      </Row>
      <Row title="See-through" hint={`${Math.round(p.opacity * 100)}% solid`}>
        <input className="sx-range" type="range" min={55} max={100} step={5} value={Math.round(p.opacity * 100)} onChange={(e) => void save({ opacity: Number(e.target.value) / 100 })} aria-label="See-through" />
      </Row>
      <Row title="Tucks away" hint="How fast it hides after you move away">
        {opt('hide', 'Tucks away', [['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow']])}
      </Row>
      <Row title="Chime" hint="A soft sound when it drops down by itself">
        <Switch label="Chime" on={!!p.sound} onChange={(v) => void save({ sound: v })} />
      </Row>
      <Row title="Shortcut" hint={msg || 'Opens the island from anywhere'}>
        <select className="sx-select" value={p.shortcut} onChange={(e) => void save({ shortcut: e.target.value })} aria-label="Shortcut">
          {SHORTCUTS.map((k) => (
            <option key={k || 'none'} value={k}>
              {keyName(k)}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Sections" hint="What the open island shows, in this order. Drag to reorder." />
      <ReorderList
        label="Island sections"
        items={p.sections.map((x) => ({ id: x.id, label: SECTION_LABEL[x.id], on: x.on }))}
        onChange={(next) => void save({ sections: next.map((x) => ({ id: x.id as any, on: x.on })) })}
      />
    </section>
  )
}
