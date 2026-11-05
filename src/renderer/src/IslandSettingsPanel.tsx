// Settings → Desktop island: make it yours. Where it sits (position, screen,
// a spot per set of screens), its size, what it shows (pill order, panel
// sections, quick chips), when it shows up (rules per kind, hover or click,
// timings, tucking away, full-screen apps), clicks and shortcuts, and its look.
// Everything is saved on this PC and shows right away.
import { useEffect, useRef, useState } from 'react'
import { cleanIslandPrefs, CLICK_LABEL, HIDE_SEC, KIND_LABEL, PILL_LABEL, SECTION_LABEL, SIZE_LIMITS, type AlertKindPref, type AlertRule, type ClickAction, type IslandPrefs } from '@core/islandModel'
import { isAltGrCombo, keyLabel, pressToAccelerator, shortcutClash } from '@core/islandKeys'
import { PROFILE_IDS, PROFILE_LABEL, type IslandControls, type IslandProfileId } from '@core/islandControlPrefs'
import { PLACEMENT_LABEL, PLACEMENTS, type IslandDeskPrefs, type MonitorMode, type Placement } from '../../desktop/islandWin'
import type { IslandAllPrefs } from '../../shared/desktop'
import { Icon } from './Icon'
import { ReorderList, Row, Saved, Segmented, Switch, useSaved } from './settingsUi'
import './islandSettings.css'
import { IslandNudgeSettings } from './IslandNudgeSettings'

type Prefs = IslandAllPrefs
/** An older desktop may not know the newer settings: fill them in so the page always works. */
const norm = (r: IslandAllPrefs): Prefs => ({ ...r, ...cleanIslandPrefs(r) })
type Patch = Partial<IslandPrefs & IslandDeskPrefs> & { place?: Placement; displayId?: number }
type What = 'island' | 'quiet' | 'capture' | 'voice' | 'hide'
type KeyField = 'shortcut' | 'quietShortcut' | 'captureShortcut' | 'voiceShortcut' | 'hideShortcut'
const FIELD_WHAT: Record<KeyField, What> = { shortcut: 'island', quietShortcut: 'quiet', captureShortcut: 'capture', voiceShortcut: 'voice', hideShortcut: 'hide' }

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

/** IF9: press the keys you want. Esc cancels; "None" turns the shortcut off. */
function ShortcutField({ value, label, others, onChange }: { value: string; label: string; others: string[]; onChange: (acc: string) => void }) {
  const [rec, setRec] = useState(false)
  const [live, setLive] = useState('')
  const [err, setErr] = useState('')
  const box = useRef<HTMLButtonElement>(null)
  const start = () => {
    setRec(true)
    setLive('')
    setErr('')
    window.setTimeout(() => box.current?.focus(), 0)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!rec) return
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return setRec(false)
    const r = pressToAccelerator(e.nativeEvent)
    if ('waiting' in r) return setLive([e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Win'].filter(Boolean).join(' + ') + ' + …')
    if ('invalid' in r) {
      setLive(keyLabel(r.text))
      return setErr(r.invalid)
    }
    if (shortcutClash(r.accelerator, others)) {
      setLive(keyLabel(r.accelerator))
      return setErr('Another island shortcut already uses these keys.')
    }
    setRec(false)
    setErr('')
    onChange(r.accelerator)
  }
  return (
    <div className="is-key">
      <button
        ref={box}
        type="button"
        className={`is-key-box ${rec ? 'rec' : ''}`}
        aria-label={`${label}: ${rec ? 'press the keys you want' : keyLabel(value)}`}
        onClick={() => (rec ? setRec(false) : start())}
        onKeyDown={onKey}
        onBlur={() => setRec(false)}
      >
        {rec ? live || 'Press the keys…' : keyLabel(value)}
      </button>
      {!rec && value && (
        <button type="button" className="is-link" onClick={() => onChange('')}>
          None
        </button>
      )}
      {err && <small className="is-err">{err}</small>}
    </div>
  )
}

/** "250, 500" ⇄ [250, 500]: your chip amounts (IF10). Saved when you leave the box. */
function NumberList({ value, label, onChange }: { value: number[]; label: string; onChange: (v: number[]) => void }) {
  const [text, setText] = useState(value.join(', '))
  useEffect(() => setText(value.join(', ')), [value])
  return (
    <input
      className="sx-input is-nums"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = text.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0)
        if (list.length) onChange(list)
        else setText(value.join(', '))
      }}
    />
  )
}

/** A size slider: it shows each step at once but saves only once you pause (~250 ms), so dragging doesn't rewrite the file and move the window on every step. */
function Slider({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void }) {
  const [v, setV] = useState(value)
  const t = useRef<number | null>(null)
  const send = useRef(onChange)
  send.current = onChange
  useEffect(() => {
    if (t.current == null) setV(value)
  }, [value])
  useEffect(() => () => {
    if (t.current != null) clearTimeout(t.current)
  }, [])
  return (
    <span className="is-slider">
      <input
        className="sx-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={v}
        onChange={(e) => {
          const n = Number(e.target.value)
          setV(n)
          if (t.current != null) clearTimeout(t.current)
          t.current = window.setTimeout(() => {
            t.current = null
            send.current(n)
          }, 250)
        }}
        aria-label={label}
      />
      <output>
        {v}
        {unit}
      </output>
    </span>
  )
}

const SIZE_PRESETS: Record<IslandPrefs['size'], { pillHeight: number; peekWidth: number; panelWidth: number }> = {
  compact: { pillHeight: 34, peekWidth: 360, panelWidth: 420 },
  normal: { pillHeight: 38, peekWidth: 400, panelWidth: 460 },
  large: { pillHeight: 42, peekWidth: 440, panelWidth: 520 }
}

export function IslandSettingsPanel() {
  const desk = window.desktop
  const [p, setP] = useState<Prefs | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<Partial<Record<What, string>>>(taken)
  const [screens, setScreens] = useState<{ id: number; label: string; primary: boolean; current: boolean }[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [flash, saved] = useSaved()
  useEffect(() => {
    desk?.getIslandPrefs?.().then((r) => r && setP(norm(r))).catch(() => {})
    desk?.islandDisplays?.().then(setScreens).catch(() => {})
    desk?.islandRecentApps?.().then(setRecent).catch(() => {})
    listenTaken()
    setBusy({ ...taken })
    takenSubs.add(setBusy)
    return () => void takenSubs.delete(setBusy)
  }, [desk])
  if (!desk?.setIslandPrefs || !p) return null

  const save = async (patch: Patch) => {
    setP({ ...p, ...patch })
    // A shortcut you change is checked again.
    const changed = (Object.keys(FIELD_WHAT) as KeyField[]).find((k) => k in patch)
    if (changed) {
      taken = { ...taken, [FIELD_WHAT[changed]]: undefined }
      setBusy({ ...taken })
    }
    const r = await desk.setIslandPrefs!(patch)
    if (r) {
      setP(norm(r.prefs))
      setMsg(r.shortcutOk ? '' : 'That shortcut is taken by another app: pick another one.')
      saved()
      if ('displayId' in patch || 'monitor' in patch) desk.islandDisplays?.().then(setScreens).catch(() => {})
    }
  }
  const opt = <K extends keyof IslandPrefs>(k: K, label: string, opts: [IslandPrefs[K], string][]) => (
    <Segmented label={label} value={p[k] as any} options={opts as any} onChange={(v) => void save({ [k]: v } as Patch)} />
  )

  // ---- shortcuts ----
  const keyRow = (k: KeyField, title: string, base: string) => {
    const value = (p[k] as string | undefined) ?? ''
    const what = FIELD_WHAT[k]
    const others = (Object.keys(FIELD_WHAT) as KeyField[]).filter((x) => x !== k).map((x) => (p[x] as string | undefined) ?? '')
    const hint = busy[what] && busy[what] === value ? `${keyLabel(value)} is taken by another app: pick another one.` : value && isAltGrCombo(value) ? `${base}. Careful: Ctrl + Alt + a letter types special letters (AltGr) on some keyboards.` : base
    return (
      <Row title={title} hint={hint}>
        <ShortcutField value={value} label={title} others={others} onChange={(acc) => void save({ [k]: acc } as Patch)} />
      </Row>
    )
  }
  // IC3, IC11, IC18, IC19: the island's controls.
  const setCtl = (c: Partial<IslandControls>) => save({ controls: { ...p.controls, ...c } })
  const clickRow = (k: 'left' | 'middle' | 'right', title: string) => (
    <Row title={title}>
      <select className="sx-select" aria-label={title} value={p.clicks[k]} onChange={(e) => void save({ clicks: { ...p.clicks, [k]: e.target.value as ClickAction } })}>
        {(Object.keys(CLICK_LABEL) as ClickAction[]).map((c) => (
          <option key={c} value={c}>
            {CLICK_LABEL[c]}
          </option>
        ))}
      </select>
    </Row>
  )

  // ---- where ----
  const monitor = p.monitor ?? 'fixed'
  const screenValue = monitor === 'fixed' ? `d:${screens.find((s) => s.current)?.id ?? p.displayId ?? ''}` : monitor
  const setScreen = (v: string) => (v.startsWith('d:') ? void save({ monitor: 'fixed', displayId: Number(v.slice(2)) }) : void save({ monitor: v as MonitorMode }))
  const offset = p.offset ?? { x: 0, y: 0 }
  const setOffset = (k: 'x' | 'y', v: string) => {
    const n = Math.round(Number(v))
    if (Number.isFinite(n)) void save({ offset: { ...offset, [k]: Math.max(-4000, Math.min(4000, n)) } })
  }
  const hideApps = p.hideApps ?? []
  const pickable = recent.filter((a) => !hideApps.includes(a))
  const rule = (k: AlertKindPref): AlertRule => p.kinds[k].show ?? (p.kinds[k].on ? 'peek' : 'never')

  return (
    <section className="panel is-panel">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> Desktop island
        </h2>
        <Saved show={flash} />
      </header>
      <p className="muted bk-note">Make the island at the edge of your screen yours. Changes show right away and are kept on this PC.</p>

      {desk.islandDisplays && (<>
      <h3 className="is-sec">Where</h3>
      <Row title="Position" hint="Drag the island to move it too: drop it on an edge to dock it">
        <select className="sx-select" aria-label="Position" value={p.place ?? 'top'} onChange={(e) => void save({ place: e.target.value as Placement, offset: { x: 0, y: 0 } })}>
          {PLACEMENTS.map((x) => (
            <option key={x} value={x}>
              {PLACEMENT_LABEL[x]}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Fine-tune" hint="Move it a few pixels right / down (negative: left / up)">
        <span className="is-offset">
          <label>
            → <input className="sx-input" type="number" step={1} value={offset.x} onChange={(e) => setOffset('x', e.target.value)} aria-label="Pixels to the right" />
          </label>
          <label>
            ↓ <input className="sx-input" type="number" step={1} value={offset.y} onChange={(e) => setOffset('y', e.target.value)} aria-label="Pixels down" />
          </label>
          {(offset.x !== 0 || offset.y !== 0) && (
            <button type="button" className="is-link" onClick={() => void save({ offset: { x: 0, y: 0 } })}>
              Reset
            </button>
          )}
        </span>
      </Row>
      <Row title="Screen" hint={monitor === 'mouse' ? 'It moves to the screen your mouse is on (after a second there)' : monitor === 'window' ? 'It moves to the screen of the window you work in' : 'Which screen it lives on'}>
        <select className="sx-select" aria-label="Screen" value={screenValue} onChange={(e) => setScreen(e.target.value)}>
          <option value="main">The main screen</option>
          <option value="mouse">Follow the mouse</option>
          <option value="window">Follow the window you work in</option>
          {screens.map((s) => (
            <option key={s.id} value={`d:${s.id}`}>
              {s.label}
            </option>
          ))}
        </select>
      </Row>
      <Row title="A spot for each screen setup" hint="Laptop alone or with screens plugged in: it remembers where it was for each and goes back there by itself">
        <Switch label="A spot for each screen setup" on={p.perScreen !== false} onChange={(v) => void save({ perScreen: v })} />
      </Row>
      </>)}

      <h3 className="is-sec">Size</h3>
      <Row title="Quick pick" hint="Makes everything a bit smaller or bigger, text too">
        <Segmented
          label="Size"
          value={p.size}
          options={[['compact', 'Compact'], ['normal', 'Normal'], ['large', 'Large']]}
          onChange={(v) => void save({ size: v, ...SIZE_PRESETS[v] })}
        />
      </Row>
      <Row title="Pill height">
        <Slider label="Pill height" value={p.pillHeight} min={SIZE_LIMITS.pillHeight[0]} max={SIZE_LIMITS.pillHeight[1]} unit=" px" onChange={(v) => void save({ pillHeight: v })} />
      </Row>
      <Row title="Peek width" hint="The bigger pill when it drops down">
        <Slider label="Peek width" value={p.peekWidth} min={SIZE_LIMITS.peekWidth[0]} max={SIZE_LIMITS.peekWidth[1]} step={10} unit=" px" onChange={(v) => void save({ peekWidth: v })} />
      </Row>
      <Row title="Panel width" hint="The open island">
        <Slider label="Panel width" value={p.panelWidth} min={SIZE_LIMITS.panelWidth[0]} max={SIZE_LIMITS.panelWidth[1]} step={10} unit=" px" onChange={(v) => void save({ panelWidth: v })} />
      </Row>

      <h3 className="is-sec">What it shows</h3>
      <Row title="The pill" hint="What the small pill shows, first one first (the next one sits beside it). Drag to reorder." />
      <ReorderList
        label="What the pill shows"
        items={p.pillOrder.map((x) => ({ id: x.id, label: PILL_LABEL[x.id], on: x.on }))}
        onChange={(next) => void save({ pillOrder: next.map((x) => ({ id: x.id as any, on: x.on })) })}
      />
      <Row title="The open island" hint="Its sections, in this order. Drag to reorder." />
      <ReorderList
        label="Island sections"
        items={p.sections.map((x) => ({ id: x.id, label: SECTION_LABEL[x.id], on: x.on }))}
        onChange={(next) => void save({ sections: next.map((x) => ({ id: x.id as any, on: x.on })) })}
      />
      <Row title="Water chips" hint="Millilitres, up to four, like 250, 500">
        <NumberList label="Water chips" value={p.chips.water} onChange={(water) => void save({ chips: { ...p.chips, water } })} />
      </Row>
      <Row title="Rep chips" hint="Reps per tap, like 10, 20">
        <NumberList label="Rep chips" value={p.chips.reps} onChange={(reps) => void save({ chips: { ...p.chips, reps } })} />
      </Row>
      <Row title="Focus chips" hint="Minutes, like 25, 50. The first one is also the click-to-start length">
        <NumberList label="Focus chips" value={p.chips.focus} onChange={(focus) => void save({ chips: { ...p.chips, focus } })} />
      </Row>

      <h3 className="is-sec">When it shows up</h3>
      <Row title="Peek when the mouse rests on it" hint={p.openOn === 'click' ? 'Off: it only opens when you click it' : `After ${p.hoverMs} ms`}>
        <Switch label="Peek when the mouse rests on it" on={p.openOn !== 'click'} onChange={(v) => void save({ openOn: v ? 'hover' : 'click' })} />
      </Row>
      <Row title="Wait before peeking" disabled={p.openOn === 'click'}>
        <Slider label="Wait before peeking" value={p.hoverMs} min={100} max={2000} step={50} unit=" ms" onChange={(v) => void save({ hoverMs: v })} />
      </Row>
      <Row title="Reminders" hint="For each kind: drop down, show only a dot (it waits in the island), or never. 🔔 is its sound." />
      <div className="is-kinds is-rules">
        {(Object.keys(KIND_LABEL) as AlertKindPref[]).map((k) => (
          <div key={k} className="is-kind">
            <span>{KIND_LABEL[k]}</span>
            <Segmented
              label={`${KIND_LABEL[k]}: how it shows`}
              value={rule(k)}
              options={[['peek', 'Drop down'], ['dot', 'Dot'], ['never', 'Never']]}
              onChange={(v) => void save({ kinds: { ...p.kinds, [k]: { ...p.kinds[k], show: v, on: v !== 'never' } } })}
            />
            <button type="button" className={`is-snd ${p.kinds[k].sound && rule(k) !== 'never' ? 'on' : ''}`} disabled={rule(k) === 'never'} onClick={() => void save({ kinds: { ...p.kinds, [k]: { ...p.kinds[k], sound: !p.kinds[k].sound } } })} aria-label={`${KIND_LABEL[k]}: sound ${p.kinds[k].sound ? 'on' : 'off'}`} title={p.kinds[k].sound ? 'Sound on' : 'Silent'}>
              {p.kinds[k].sound ? '🔔' : '🔕'}
            </button>
          </div>
        ))}
      </div>
      <Row title="Open before a meeting" hint="The island opens by itself with Join, a few minutes before a meeting you said yes to">
        <select className="sx-select" aria-label="Open before a meeting" value={p.meetingOpenMin} onChange={(e) => void save({ meetingOpenMin: Number(e.target.value) })}>
          {[0, 1, 2, 5, 10, 15].map((m) => (
            <option key={m} value={m}>
              {m ? `${m} min before` : 'Don’t'}
            </option>
          ))}
        </select>
      </Row>
      <Row title="A reminder peeks for">
        <Slider label="A reminder peeks for" value={p.peekSec} min={2} max={30} unit=" s" onChange={(v) => void save({ peekSec: v })} />
      </Row>
      <Row title="Time between reminders" hint="At most one drops down in this time (time-up always does)">
        <Slider label="Time between reminders" value={p.gapMin} min={0} max={30} unit=" min" onChange={(v) => void save({ gapMin: v })} />
      </Row>
      <Row title="The open island stays" hint="After your mouse leaves it">
        <span className="is-stack">
          <Slider label="The open island stays" value={p.leaveSec} min={0.5} max={15} step={0.5} unit=" s" onChange={(v) => void save({ leaveSec: v })} />
          <Segmented
            label="Quick pick"
            value={(Object.keys(HIDE_SEC) as (keyof typeof HIDE_SEC)[]).find((h) => HIDE_SEC[h] === p.leaveSec) ?? ('' as any)}
            options={[['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow']]}
            onChange={(v: keyof typeof HIDE_SEC) => void save({ hide: v, leaveSec: HIDE_SEC[v] })}
          />
        </span>
      </Row>
      <Row title="Tuck away when nothing is on" hint="No timer, block, reminder or message for a while: it shrinks to a tiny dot or fades. The mouse on it brings it back.">
        <span className="is-stack">
          <select className="sx-select" aria-label="Tuck away after" value={p.idleMin} onChange={(e) => void save({ idleMin: Number(e.target.value) })}>
            {[0, 5, 15, 30, 60].map((m) => (
              <option key={m} value={m}>
                {m ? `After ${m} min` : 'Never'}
              </option>
            ))}
          </select>
          {p.idleMin > 0 && opt('idleLook', 'Tucked away as', [['dot', 'Tiny dot'], ['fade', 'Faded']])}
        </span>
      </Row>
      <Row title="In a call or meeting" hint="When your mic or camera is on, or a meeting is in your calendar">
        {opt('callMode', 'In a call', [['hide', 'Hide it'], ['dot', 'Small dot'], ['normal', 'Leave it']])}
      </Row>
      {p.dodge != null && (
        <Row title="Out of the way" hint="When the mouse rushes at it, it slides up for a moment">
          <Segmented label="Out of the way" value={p.dodge ? 'on' : 'off'} options={[['off', 'Off'], ['on', 'On']] as any} onChange={(v) => void save({ dodge: v === 'on' })} />
        </Row>
      )}
      {p.fullscreen && (
        <Row title="Over a full-screen app" hint="A video, game or slides on the island's screen">
          <Segmented label="Over a full-screen app" value={p.fullscreen} options={[['hide', 'Hide it'], ['dot', 'Small dot'], ['show', 'Leave it']] as any} onChange={(v) => void save({ fullscreen: v as IslandDeskPrefs['fullscreen'] })} />
        </Row>
      )}
      {p.hideApps && (
        <>
          <Row title="Always hide over these apps" hint="Games or players that aren't full screen. Pick from apps you used lately; only the ones you pick are kept.">
            <select
              className="sx-select"
              aria-label="Add an app"
              value=""
              onChange={(e) => e.target.value && void save({ hideApps: [...hideApps, e.target.value] })}
              onFocus={() => desk.islandRecentApps?.().then(setRecent).catch(() => {})}
            >
              <option value="">{pickable.length ? 'Add an app…' : 'Use the app, then come back'}</option>
              {pickable.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Row>
          {hideApps.length > 0 && (
            <div className="is-apps">
              {hideApps.map((a) => (
                <span key={a} className="is-app">
                  {a}
                  <button type="button" aria-label={`Stop hiding over ${a}`} onClick={() => void save({ hideApps: hideApps.filter((x) => x !== a) })}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <h3 className="is-sec">Clicks & shortcuts</h3>
      {clickRow('left', 'Click')}
      {clickRow('middle', 'Middle click')}
      {clickRow('right', 'Right click')}
      {msg && <p className="is-err">{msg}</p>}
      {keyRow('shortcut', 'Open the island', 'Opens and closes the island from any app')}
      {keyRow('quietShortcut', 'Quiet', "Quiet for an hour, or back on (also in the tray and the island's 🌙)")}
      {p.captureShortcut != null && keyRow('captureShortcut', 'Add a task', 'A box to add a Todoist task from any app')}
      {p.voiceShortcut != null && keyRow('voiceShortcut', 'Talk to Ben', 'Press to record a voice note to Ben, press again to send it')}
      {p.hideShortcut != null && keyRow('hideShortcut', 'Hide or bring back the island', 'The same keys hide it and bring it back (the tray can too)')}

      <h3 className="is-sec">Controls</h3>
      <Row title="Round menu" hint="Hold the pill for a moment: six quick actions fan out; slide to one and let go">
        <Switch label="Round menu" on={p.controls.ring} onChange={(v) => void setCtl({ ring: v })} />
      </Row>
      <Row title="Break after focus" hint="A timer you start from the island ends in a short break, then the next block from your plan starts (with “Start focus by itself” on). Breaks never count as focus.">
        <Segmented label="Break after focus" value={p.controls.breakMin} options={[[0, 'None'], [5, '5 min'], [10, '10 min'], [15, '15 min']]} onChange={(v) => void setCtl({ breakMin: v })} />
      </Row>
      <Row title="Fade while I type" hint="Typing in another app, far from the island: it fades to 20% until you stop or move the mouse near it">
        <Switch label="Fade while I type" on={p.controls.fadeTyping} onChange={(v) => void setCtl({ fadeTyping: v })} />
      </Row>
      <Row title="Profile" hint="Work, Study, Gaming and Night each change what the pill shows first, which reminders drop down, sound and motion. Also in the tray menu.">
        <select className="sx-select" aria-label="Profile" value={p.controls.profile} onChange={(e) => void setCtl({ profile: e.target.value as IslandProfileId })}>
          {PROFILE_IDS.map((id) => (
            <option key={id} value={id}>
              {PROFILE_LABEL[id]}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Switch the profile by itself" hint="By the time of day (Night 22–06, Work on weekdays 9–18), or by the app in front (e.g. Steam → Gaming)">
        <Segmented label="Switch the profile by itself" value={p.controls.profileAuto} options={[['off', 'No'], ['time', 'Time of day'], ['app', 'App in front']]} onChange={(v) => void setCtl({ profileAuto: v })} />
      </Row>
      {p.controls.profileAuto === 'app' &&
        (['work', 'study', 'gaming'] as const).map((id) => (
          <Row key={id} title={`${PROFILE_LABEL[id]} apps`} hint="Program names, separated by commas (as in Task Manager, without .exe)">
            <input
              className="sx-input"
              aria-label={`${PROFILE_LABEL[id]} apps`}
              defaultValue={(p.controls.profileApps[id] ?? []).join(', ')}
              onBlur={(e) => void setCtl({ profileApps: { ...p.controls.profileApps, [id]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } })}
            />
          </Row>
        ))}

      <IslandNudgeSettings onSaved={saved} />

      <h3 className="is-sec">Look</h3>
      <Row title="Colours" hint="Black like an iPhone, glass, a glow in Ben's mood, or the app's own colours (light or dark)">
        {opt('look', 'Look', [['black', 'Black'], ['glass', 'Glass'], ['mood', 'Mood glow'], ['app', 'Match the app']])}
      </Row>
      <Row title="Animations" hint="Full: springs, water that sloshes, things that fly into the pill. Calm: gentle fades. Off: no motion">
        <select className="sx-select" aria-label="Animations" value={p.motion} onChange={(e) => void save({ motion: e.target.value as IslandPrefs['motion'] })}>
          <option value="full">Full</option>
          <option value="calm">Calm</option>
          <option value="off">Off</option>
        </select>
      </Row>
      <Row title="See-through" hint={`${Math.round(p.opacity * 100)}% solid`}>
        <input className="sx-range" type="range" min={55} max={100} step={5} value={Math.round(p.opacity * 100)} onChange={(e) => void save({ opacity: Number(e.target.value) / 100 })} aria-label="See-through" />
      </Row>
      <Row title="Sounds" hint="A sound when it drops down by itself (each kind has its own above)">
        <Switch label="Sounds" on={!!p.sound} onChange={(v) => void save({ sound: v })} />
      </Row>
      <Row title="Volume" hint={`${Math.round(p.volume * 100)}%`}>
        <input className="sx-range" type="range" min={0} max={100} step={5} value={Math.round(p.volume * 100)} onChange={(e) => void save({ volume: Number(e.target.value) / 100 })} aria-label="Volume" />
      </Row>

      {p.debugUntil != null && (
        <>
          <h3 className="is-sec">Troubleshooting</h3>
          <Row
            title="Debug"
            hint={
              (p.debugUntil ?? 0) > Date.now()
                ? `On until ${new Date(p.debugUntil!).toTimeString().slice(0, 5)}. On the island: green boxes are where it takes clicks, red dashed boxes where the desktop thinks they are. Try "Click test", then "Copy report" and send it to us.`
                : 'Draws where the island takes clicks and how smoothly it runs, right on the island. Only on this PC; it turns itself off after 30 minutes.'
            }
          >
            <Switch label="Island debug" on={(p.debugUntil ?? 0) > Date.now()} onChange={(v) => void save({ debugUntil: v ? Date.now() + 30 * 60_000 : 0 })} />
          </Row>
        </>
      )}
    </section>
  )
}
