// Settings → Desktop island: size, see-through, look, which sections and in
// what order, sound, how fast it hides, and your shortcut. Saved on this PC.
import { useEffect, useState } from 'react'
import { KIND_LABEL, QUIET_SHORTCUTS, SECTION_LABEL, SHORTCUTS, type AlertKindPref, type IslandPrefs } from '@core/islandModel'
import { CAPTURE_SHORTCUTS, VOICE_SHORTCUTS, type IslandDeskPrefs } from '../../desktop/islandWin'
import { Icon } from './Icon'
import { ReorderList, Row, Saved, Segmented, Switch, useSaved } from './settingsUi'

const keyName = (k: string) => (k ? k.replace('Control', 'Ctrl').replace(/\+/g, ' + ') : 'No shortcut')

type Prefs = IslandPrefs & Partial<IslandDeskPrefs>
type What = 'island' | 'quiet' | 'capture' | 'voice'
/**
 * Shortcuts another app already has: asked once (islandShortcutStatus) and
 * kept up to date by island:shortcutFailed. IPC listeners can't be removed,
 * so one listener feeds whichever panel is showing.
 */
let taken: Partial<Record<What, string>> = {}
const takenSubs = new Set<(t: Partial<Record<What, string>>) => void>()
let takenListening = false
const listenTaken = () => {
  if (takenListening) return
  takenListening = true
  const push = () => takenSubs.forEach((f) => f({ ...taken }))
  window.desktop?.islandShortcutStatus?.().then((r) => {
    for (const f of r?.failed ?? []) taken[f.what as What] = f.accelerator
    push()
  }).catch(() => {})
  window.desktop?.onIslandShortcutFailed?.((f) => {
    taken = { ...taken, [f.what as What]: f.accelerator }
    push()
  })
}

export function IslandSettingsPanel() {
  const desk = window.desktop
  const [p, setP] = useState<Prefs | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<Partial<Record<What, string>>>(taken)
  const [flash, saved] = useSaved()
  useEffect(() => {
    desk?.getIslandPrefs?.().then(setP).catch(() => {})
    listenTaken()
    setBusy({ ...taken })
    takenSubs.add(setBusy)
    return () => void takenSubs.delete(setBusy)
  }, [desk])
  if (!desk?.setIslandPrefs || !p) return null

  const save = async (patch: Partial<IslandPrefs & IslandDeskPrefs>) => {
    setP({ ...p, ...patch })
    // A shortcut you change is checked again.
    const changed = (['shortcut', 'quietShortcut', 'captureShortcut', 'voiceShortcut'] as const).find((k) => k in patch)
    if (changed) {
      taken = { ...taken, [{ shortcut: 'island', quietShortcut: 'quiet', captureShortcut: 'capture', voiceShortcut: 'voice' }[changed]]: undefined }
      setBusy({ ...taken })
    }
    const r = await desk.setIslandPrefs!(patch)
    if (r) {
      setP(r.prefs)
      setMsg(r.shortcutOk ? '' : 'That shortcut is taken by another app: pick another one.')
      saved()
    }
  }
  /** "Taken by another app" under a shortcut that couldn't be set. */
  const hintFor = (what: What, current: string, base: string) => (busy[what] && busy[what] === current ? `${keyName(current)} is taken by another app: pick another one.` : base)
  const shortcutSelect = (k: 'shortcut' | 'quietShortcut' | 'captureShortcut' | 'voiceShortcut', label: string, list: readonly string[]) => (
    <select className="sx-select" value={p[k] ?? ''} onChange={(e) => void save({ [k]: e.target.value })} aria-label={label}>
      {list.map((x) => (
        <option key={x || 'none'} value={x}>
          {keyName(x)}
        </option>
      ))}
    </select>
  )
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
      <Row title="Sounds" hint="A sound when it drops down by itself (each kind has its own)">
        <Switch label="Sounds" on={!!p.sound} onChange={(v) => void save({ sound: v })} />
      </Row>
      <Row title="Volume" hint={`${Math.round(p.volume * 100)}%`}>
        <input className="sx-range" type="range" min={0} max={100} step={5} value={Math.round(p.volume * 100)} onChange={(e) => void save({ volume: Number(e.target.value) / 100 })} aria-label="Volume" />
      </Row>
      <Row title="In a call or meeting" hint="When your mic or camera is on, or a meeting is in your calendar">
        {opt('callMode', 'In a call', [['hide', 'Hide it'], ['dot', 'Small dot'], ['normal', 'Leave it']])}
      </Row>
      {p.fullscreen && (
        <Row title="Over a full-screen app" hint="A video, game or slides on the island's screen">
          <Segmented label="Over a full-screen app" value={p.fullscreen} options={[['hide', 'Hide it'], ['dot', 'Small dot'], ['show', 'Leave it']] as any} onChange={(v) => void save({ fullscreen: v as IslandDeskPrefs['fullscreen'] })} />
        </Row>
      )}
      <Row title="Quiet shortcut" hint={hintFor('quiet', p.quietShortcut, "Quiet for an hour, or back on (also in the tray and the island's 🌙)")}>
        {shortcutSelect('quietShortcut', 'Quiet shortcut', QUIET_SHORTCUTS)}
      </Row>
      <Row title="Reminders" hint="Which ones show, and which make a sound. At most one drops down every 3 minutes." />
      <div className="is-kinds">
        {(Object.keys(KIND_LABEL) as AlertKindPref[]).map((k) => (
          <div key={k} className="is-kind">
            <span>{KIND_LABEL[k]}</span>
            <Switch label={`${KIND_LABEL[k]}: show`} on={p.kinds[k].on} onChange={(v) => void save({ kinds: { ...p.kinds, [k]: { ...p.kinds[k], on: v } } })} />
            <button type="button" className={`is-snd ${p.kinds[k].sound && p.kinds[k].on ? 'on' : ''}`} disabled={!p.kinds[k].on} onClick={() => void save({ kinds: { ...p.kinds, [k]: { ...p.kinds[k], sound: !p.kinds[k].sound } } })} aria-label={`${KIND_LABEL[k]}: sound ${p.kinds[k].sound ? 'on' : 'off'}`} title={p.kinds[k].sound ? 'Sound on' : 'Silent'}>
              {p.kinds[k].sound ? '🔔' : '🔕'}
            </button>
          </div>
        ))}
      </div>
      <Row title="Shortcut" hint={hintFor('island', p.shortcut, msg || 'Opens the island from anywhere')}>
        {shortcutSelect('shortcut', 'Shortcut', SHORTCUTS)}
      </Row>
      {p.captureShortcut != null && (
        <Row title="Add a task shortcut" hint={hintFor('capture', p.captureShortcut, 'A box to add a Todoist task from any app')}>
          {shortcutSelect('captureShortcut', 'Add a task shortcut', CAPTURE_SHORTCUTS)}
        </Row>
      )}
      {p.voiceShortcut != null && (
        <Row title="Talk to Ben shortcut" hint={hintFor('voice', p.voiceShortcut, 'Press to record a voice note to Ben, press again to send it')}>
          {shortcutSelect('voiceShortcut', 'Talk to Ben shortcut', VOICE_SHORTCUTS)}
        </Row>
      )}
      <Row title="Sections" hint="What the open island shows, in this order. Drag to reorder." />
      <ReorderList
        label="Island sections"
        items={p.sections.map((x) => ({ id: x.id, label: SECTION_LABEL[x.id], on: x.on }))}
        onChange={(next) => void save({ sections: next.map((x) => ({ id: x.id as any, on: x.on })) })}
      />
    </section>
  )
}
