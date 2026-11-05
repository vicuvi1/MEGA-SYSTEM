// Island 2 on the island page: your own tiles (IN34) and one-tap buttons
// (IN35) with an edit mode, your own profiles (IN37), colours (IN40), a
// shortcut per tile or button (IN41), and the switches for the mini dock
// (IN38), the clipboard tray (IN42) and the file shelf (IN48). Your kit comes
// in the snapshot (the app window reads it from your synced settings); edits
// go back as one "kit" tap. Logging uses the normal paths (reps, water) and
// can be undone like every other tap.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { IslandAction, IslandPrefs, IslandSnapshot } from '@core/islandModel'
import {
  addButton, addTile, buttonAction, cleanKit, countOf, DEFAULT_KIT, kitShortcuts, moveItem, PALETTE_LABEL, PALETTES, removeButton, removeTile, TILE_KINDS, TILE_LABEL, TILE_PAGES,
  tileAction, updateButton, updateTile, type ButtonAct, type IslandKit, type KitButton, type ShortcutProblem, type Tile, type TileKind
} from '@core/islandTiles'
import { cleanKitProfile, NUDGE_KINDS, profileFilter, withProfileNudges, type ClipItem, type KitProfile } from '@core/islandKitExtras'
import { normalizeAccelerator } from '@core/islandKeys'
import { calendarDay } from '@core/dates'
import { tp } from './islandTap'
import './islandKit.css'

const desk = () => (typeof window !== 'undefined' ? window.desktop : undefined)
type Tap = (a: IslandAction, lbl?: string) => void

// One listener for the desktop's kit events (IPC listeners can't be removed).
type KitEvent = { type: string; [k: string]: unknown }
const subs = new Set<(ev: KitEvent) => void>()
let wired = false
export function onKitEvent(fn: (ev: KitEvent) => void): () => void {
  if (!wired) {
    wired = true
    desk()?.onIslandKit?.((ev) => subs.forEach((f) => f(ev)))
  }
  subs.add(fn)
  return () => void subs.delete(fn)
}
const kitOp = (op: string, arg?: unknown): Promise<any> => {
  try {
    return Promise.resolve(desk()?.islandKit?.(op, arg)).catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

/** The exercise's id in Sport Track, by its name (so a tile counts toward that exercise). */
const exIdFor = (s: IslandSnapshot, name: string) => s.reps.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id ?? null

export interface KitState {
  kit: IslandKit
  save: (k: IslandKit) => void
  profile: KitProfile | null
  tiles: Tile[]
  buttons: KitButton[]
  problems: ShortcutProblem[]
  clips: ClipItem[]
  fireTile: (t: Tile) => void
  fireButton: (b: KitButton) => void
  /** Your prefs with the profile's own nudges on top. */
  prefsFor: (p: IslandPrefs) => IslandPrefs
}

export function useKit(s: IslandSnapshot, tap: Tap): KitState {
  const key = JSON.stringify(s.kit ?? null)
  const remote = useMemo(() => (s.kit ? cleanKit(s.kit) : DEFAULT_KIT), [key])
  // Shown at once; the next snapshot confirms it (or after 10 s the saved one wins again).
  const [local, setLocal] = useState<{ kit: IslandKit; at: number } | null>(null)
  useEffect(() => {
    if (!local) return
    if (JSON.stringify(local.kit) === JSON.stringify(remote)) return setLocal(null)
    const t = window.setTimeout(() => setLocal(null), Math.max(0, 10_000 - (Date.now() - local.at)))
    return () => clearTimeout(t)
  }, [remote, local])
  const kit = local?.kit ?? remote
  const save = (k: IslandKit) => {
    const clean = cleanKit(k)
    setLocal({ kit: clean, at: Date.now() })
    tap({ kind: 'kit', kit: clean })
  }
  const [profileId, setProfileId] = useState<string | null>(null)
  const [problems, setProblems] = useState<ShortcutProblem[]>([])
  const [clips, setClips] = useState<ClipItem[]>([])
  const kitRef = useRef(kit)
  kitRef.current = kit
  const sRef = useRef(s)
  sRef.current = s

  const fireTile = (t: Tile) => {
    if (t.kind === 'counter') {
      const day = calendarDay(new Date())
      const k = kitRef.current
      setLocal({ kit: { ...k, counts: { ...k.counts, [t.id]: { day, n: countOf(k, t.id, day) + (t.n ?? 1) } } }, at: Date.now() })
    }
    const a = tileAction(t, 'tap', { exId: t.name ? exIdFor(sRef.current, t.name) : null, subject: t.label })
    if (a) tap(a)
  }
  const fireButton = (b: KitButton) => tap(buttonAction(b, 'tap'))
  const fireRef = useRef({ fireTile, fireButton })
  fireRef.current = { fireTile, fireButton }

  useEffect(
    () =>
      onKitEvent((ev) => {
        if (ev.type === 'profile') setProfileId(typeof ev.id === 'string' ? ev.id : null)
        if (ev.type === 'clips' && Array.isArray(ev.list)) setClips(ev.list as ClipItem[])
        // IN41: a tile's or button's own shortcut was pressed.
        if (ev.type === 'shortcut') {
          const k = kitRef.current
          const t = k.tiles.find((x) => x.id === ev.id)
          const b = k.buttons.find((x) => x.id === ev.id)
          if (t) fireRef.current.fireTile(t)
          else if (b) fireRef.current.fireButton(b)
        }
      }),
    []
  )
  // Tell the desktop: the shortcuts, the profiles, the clipboard tray and the dock.
  const keysKey = JSON.stringify(kitShortcuts(kit))
  useEffect(() => {
    void kitOp('shortcuts', JSON.parse(keysKey)).then((r) => setProblems(r?.problems ?? []))
  }, [keysKey])
  const profKey = JSON.stringify(kit.profiles)
  useEffect(() => {
    void kitOp('profiles', JSON.parse(profKey))
  }, [profKey])
  useEffect(() => {
    void kitOp('clipboard', kit.clipboard).then((r) => setClips(r?.list ?? []))
  }, [kit.clipboard])
  useEffect(() => {
    void kitOp('dock', kit.dock.on)
  }, [kit.dock.on])

  const profile = kit.profiles.find((p) => p.id === profileId) ?? null
  return {
    kit,
    save,
    profile,
    tiles: profileFilter(kit.tiles, profile?.tiles),
    buttons: profileFilter(kit.buttons, profile?.buttons),
    problems,
    clips,
    fireTile,
    fireButton,
    prefsFor: (p) => withProfileNudges(p as any, profile) as IslandPrefs
  }
}

// ---- the tiles on the open panel ----

function tileValue(t: Tile, s: IslandSnapshot, kit: IslandKit): string {
  if (t.kind === 'counter') return String(countOf(kit, t.id, calendarDay(new Date())))
  if (t.kind === 'exercise') {
    const r = s.reps.find((x) => x.name.toLowerCase() === (t.name ?? '').toLowerCase())
    return r ? `${r.done}${r.target ? `/${r.target}` : ''}` : `+${t.n}`
  }
  if (t.kind === 'water') return `${Math.round(s.water.ml / 100) / 10} l`
  if (t.kind === 'timer') return `${t.minutes} min`
  return ''
}

export function KitTiles({ k, s }: { k: KitState; s: IslandSnapshot }) {
  const [editing, setEditing] = useState(false)
  const { tiles, buttons } = k
  if (!editing && !tiles.length && !buttons.length) {
    return (
      <button className="di-kit-start" {...tp('kit:start', () => setEditing(true))}>
        ＋ Add your own tiles and buttons
      </button>
    )
  }
  return (
    <section className="di-kit" aria-label="Your tiles">
      <div className="di-kit-head">
        <b>{k.profile ? `${k.profile.icon} ${k.profile.name}` : 'Your tiles'}</b>
        <button className={`di-kit-edit ${editing ? 'on' : ''}`} {...tp('kit:edit', () => setEditing((x) => !x))}>{editing ? 'Done' : '✎ Edit'}</button>
      </div>
      {editing ? (
        <KitEditor k={k} />
      ) : (
        <>
          {!!tiles.length && (
            <div className="di-tiles">
              {tiles.map((t) => (
                <button key={t.id} className={`di-tile kind-${t.kind}`} title={t.kind === 'note' ? t.text : t.shortcut ? `${t.label} · ${t.shortcut.replace('Control', 'Ctrl')}` : t.label} {...tp(`tile:${t.id}`, () => k.fireTile(t))}>
                  <i>{t.icon}</i>
                  <span>{t.kind === 'note' ? t.text || t.label : t.label}</span>
                  {tileValue(t, s, k.kit) && <small>{tileValue(t, s, k.kit)}</small>}
                </button>
              ))}
            </div>
          )}
          {!!buttons.length && (
            <div className="di-kit-btns">
              {buttons.map((b) => (
                <button key={b.id} className="di-kit-btn" {...tp(`kbtn:${b.id}`, () => k.fireButton(b))}>
                  {b.icon} {b.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** IN35: your buttons on the pill (shown while the mouse is on it). */
export function PillKitButtons({ k }: { k: KitState }) {
  const list = k.buttons.filter((b) => b.pill).slice(0, 3)
  if (!list.length) return null
  return (
    <span className="di-pill-kit">
      {list.map((b) => (
        <button key={b.id} className="di-pill-kbtn" title={b.label} aria-label={b.label} onPointerDown={(e) => e.stopPropagation()} {...tp(`pkbtn:${b.id}`, () => k.fireButton(b))}>
          {b.icon}
          <small>{b.act.do === 'reps' ? `+${b.act.n}` : b.act.do === 'hold' ? `${b.act.sec}s` : b.act.do === 'walk' ? `${b.act.min}′` : `+${b.act.ml}`}</small>
        </button>
      ))}
    </span>
  )
}

/** IN35: your buttons in the round menu. */
export const ringKitItems = (k: KitState) =>
  k.buttons.filter((b) => b.ring).slice(0, 2).map((b) => ({ id: `ring:kit:${b.id}`, icon: b.icon, label: b.label, act: buttonAction(b, 'tap') }))

// ---- edit mode ----

const focusKeys = () => desk()?.islandFocus?.()
/** A small text box. `lazy`: saved when you leave it or press Enter (not on every key). */
function Field({ label, value, onChange, placeholder, width, lazy }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; width?: number; lazy?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => { if (v !== value) onChange(v) }
  return (
    <label className="di-kit-field">
      <span>{label}</span>
      <input
        value={lazy ? v : value}
        placeholder={placeholder}
        style={width ? { width } : undefined}
        onPointerDown={focusKeys}
        onChange={(e) => (lazy ? setV(e.target.value) : onChange(e.target.value))}
        onBlur={lazy ? commit : undefined}
        onKeyDown={lazy ? (e) => e.key === 'Enter' && commit() : undefined}
      />
    </label>
  )
}

const PRESETS: { label: string; act: ButtonAct }[] = [
  { label: '+25 squats', act: { do: 'reps', name: 'squats', n: 25 } },
  { label: '+10 push-ups', act: { do: 'reps', name: 'push-ups', n: 10 } },
  { label: 'Plank 60 s', act: { do: 'hold', name: 'Plank', sec: 60 } },
  { label: 'Walk 10 min', act: { do: 'walk', min: 10 } },
  { label: '+250 ml', act: { do: 'water', ml: 250 } }
]

function KitEditor({ k }: { k: KitState }) {
  const { kit, save } = k
  const [kind, setKind] = useState<TileKind>('counter')
  const [label, setLabel] = useState('')
  const [extra, setExtra] = useState('')
  const [num, setNum] = useState('')
  const [tab, setTab] = useState<'tiles' | 'buttons' | 'profiles' | 'look'>('tiles')
  const problem = (id: string) => k.problems.find((p) => p.id === id)
  const add = () => {
    const n = Number(num) || undefined
    const t: Partial<Tile> & { kind: TileKind } = { kind, label: label.trim() || undefined }
    if (kind === 'counter') t.n = n ?? 1
    if (kind === 'timer') t.minutes = n ?? 25
    if (kind === 'exercise') Object.assign(t, { name: extra.trim() || label.trim(), n: n ?? 10 })
    if (kind === 'water') t.n = n ?? 250
    if (kind === 'link') t.url = extra.trim()
    if (kind === 'page') t.page = extra.trim() || 'today'
    if (kind === 'note') t.text = extra.trim()
    const next = addTile(kit, t)
    if (next === kit || next.tiles.length === kit.tiles.length) return
    save(next)
    setLabel('')
    setExtra('')
    setNum('')
  }
  const keyEdit = (cur: string | undefined, apply: (v: string | undefined) => void) => (
    <input
      className="di-kit-key"
      placeholder="Shortcut"
      defaultValue={cur?.replace('Control', 'Ctrl') ?? ''}
      onPointerDown={focusKeys}
      onBlur={(e) => {
        const v = e.target.value.trim()
        apply(v ? normalizeAccelerator(v) ?? undefined : undefined)
      }}
      title="A global shortcut, like Ctrl+Shift+P (empty for none)"
    />
  )
  return (
    <div className="di-kit-editor">
      <div className="di-kit-tabs" role="tablist">
        {(['tiles', 'buttons', 'profiles', 'look'] as const).map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} {...tp(`kit:tab:${x}`, () => setTab(x))}>
            {x === 'tiles' ? 'Tiles' : x === 'buttons' ? 'Buttons' : x === 'profiles' ? 'Profiles' : 'Look & more'}
          </button>
        ))}
      </div>
      {tab === 'tiles' && (
        <>
          <ul className="di-kit-list">
            {kit.tiles.map((t) => (
              <li key={t.id}>
                <span>{t.icon} {t.label}</span>
                {keyEdit(t.shortcut, (v) => save(updateTile(kit, t.id, { shortcut: v })))}
                <label className="di-kit-check" title="Also on the mini dock"><input type="checkbox" checked={!!t.dock} onChange={(e) => save(updateTile(kit, t.id, { dock: e.target.checked }))} /> dock</label>
                <button aria-label="Earlier" {...tp(`kit:up:${t.id}`, () => save({ ...kit, tiles: moveItem(kit.tiles, t.id, -1) }))}>↑</button>
                <button aria-label="Later" {...tp(`kit:down:${t.id}`, () => save({ ...kit, tiles: moveItem(kit.tiles, t.id, 1) }))}>↓</button>
                <button aria-label="Remove" {...tp(`kit:del:${t.id}`, () => save(removeTile(kit, t.id)))}>✕</button>
                {problem(t.id) && <em className="di-kit-warn">{problem(t.id)!.why}</em>}
              </li>
            ))}
          </ul>
          <div className="di-kit-add">
            <select value={kind} onPointerDown={focusKeys} onChange={(e) => setKind(e.target.value as TileKind)} aria-label="Kind of tile">
              {TILE_KINDS.map((x) => <option key={x} value={x}>{TILE_LABEL[x]}</option>)}
            </select>
            <Field label="Name" value={label} onChange={setLabel} placeholder={TILE_LABEL[kind]} width={90} />
            {['counter', 'timer', 'exercise', 'water'].includes(kind) && <Field label={kind === 'timer' ? 'Minutes' : kind === 'water' ? 'ml' : kind === 'counter' ? 'Step' : 'Reps'} value={num} onChange={setNum} width={44} />}
            {kind === 'exercise' && <Field label="Exercise" value={extra} onChange={setExtra} placeholder="push-ups" width={80} />}
            {kind === 'link' && <Field label="https://" value={extra} onChange={setExtra} placeholder="https://example.com" width={140} />}
            {kind === 'note' && <Field label="Text" value={extra} onChange={setExtra} width={140} />}
            {kind === 'page' && (
              <select value={extra || 'today'} onPointerDown={focusKeys} onChange={(e) => setExtra(e.target.value)} aria-label="Page">
                {TILE_PAGES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            <button className="di-kit-plus" {...tp('kit:add', add)}>＋ Add</button>
          </div>
        </>
      )}
      {tab === 'buttons' && (
        <>
          <ul className="di-kit-list">
            {kit.buttons.map((b) => (
              <li key={b.id}>
                <span>{b.icon} {b.label}</span>
                {keyEdit(b.shortcut, (v) => save(updateButton(kit, b.id, { shortcut: v })))}
                <label className="di-kit-check"><input type="checkbox" checked={b.pill} onChange={(e) => save(updateButton(kit, b.id, { pill: e.target.checked }))} /> pill</label>
                <label className="di-kit-check"><input type="checkbox" checked={b.ring} onChange={(e) => save(updateButton(kit, b.id, { ring: e.target.checked }))} /> menu</label>
                <button aria-label="Earlier" {...tp(`kit:bup:${b.id}`, () => save({ ...kit, buttons: moveItem(kit.buttons, b.id, -1) }))}>↑</button>
                <button aria-label="Remove" {...tp(`kit:bdel:${b.id}`, () => save(removeButton(kit, b.id)))}>✕</button>
                {problem(b.id) && <em className="di-kit-warn">{problem(b.id)!.why}</em>}
              </li>
            ))}
          </ul>
          <div className="di-kit-presets">
            {PRESETS.map((p) => (
              <button key={p.label} {...tp(`kit:preset:${p.label}`, () => save(addButton(kit, { act: p.act })))}>＋ {p.label}</button>
            ))}
          </div>
          <CustomButton onAdd={(act) => save(addButton(kit, { act }))} />
        </>
      )}
      {tab === 'profiles' && <ProfilesEditor k={k} />}
      {tab === 'look' && (
        <div className="di-kit-look">
          <div className="di-kit-swatches" role="radiogroup" aria-label="Colour">
            {PALETTES.map((p) => (
              <button key={p} role="radio" aria-checked={kit.look.palette === p} className={`di-swatch acc-${p} ${kit.look.palette === p ? 'on' : ''}`} title={PALETTE_LABEL[p]} {...tp(`kit:pal:${p}`, () => save({ ...kit, look: { ...kit.look, palette: p } }))} />
            ))}
          </div>
          <label className="di-kit-check"><input type="checkbox" checked={kit.look.contrast} onChange={(e) => save({ ...kit, look: { ...kit.look, contrast: e.target.checked } })} /> High contrast</label>
          <label className="di-kit-check"><input type="checkbox" checked={kit.look.seasonal} onChange={(e) => save({ ...kit, look: { ...kit.look, seasonal: e.target.checked } })} /> Seasonal skin</label>
          <label className="di-kit-check"><input type="checkbox" checked={kit.dock.on} onChange={(e) => save({ ...kit, dock: { on: e.target.checked } })} /> Mini dock (tiles marked “dock”, in their own small strip)</label>
          <label className="di-kit-check"><input type="checkbox" checked={kit.clipboard} onChange={(e) => save({ ...kit, clipboard: e.target.checked })} /> Clipboard tray (the last 5 copied texts, never from password managers or banks)</label>
          <label className="di-kit-check"><input type="checkbox" checked={kit.shelf} onChange={(e) => save({ ...kit, shelf: e.target.checked })} /> File shelf (drop files on the island to keep them for later)</label>
        </div>
      )}
    </div>
  )
}

function CustomButton({ onAdd }: { onAdd: (a: ButtonAct) => void }) {
  const [what, setWhat] = useState<ButtonAct['do']>('reps')
  const [name, setName] = useState('')
  const [n, setN] = useState('')
  const go = () => {
    const v = Number(n) || 0
    if (what === 'reps' && name.trim() && v) onAdd({ do: 'reps', name: name.trim(), n: v })
    else if (what === 'hold' && name.trim() && v) onAdd({ do: 'hold', name: name.trim(), sec: v })
    else if (what === 'walk' && v) onAdd({ do: 'walk', min: v })
    else if (what === 'water' && v) onAdd({ do: 'water', ml: v })
    else return
    setName('')
    setN('')
  }
  return (
    <div className="di-kit-add">
      <select value={what} onPointerDown={focusKeys} onChange={(e) => setWhat(e.target.value as ButtonAct['do'])} aria-label="Kind of button">
        <option value="reps">Reps</option>
        <option value="hold">Hold (seconds)</option>
        <option value="walk">Walk (minutes)</option>
        <option value="water">Water (ml)</option>
      </select>
      {(what === 'reps' || what === 'hold') && <Field label="Exercise" value={name} onChange={setName} placeholder="lunges" width={80} />}
      <Field label="How many" value={n} onChange={setN} width={44} />
      <button className="di-kit-plus" {...tp('kit:addbtn', go)}>＋ Add</button>
    </div>
  )
}

function ProfilesEditor({ k }: { k: KitState }) {
  const { kit, save } = k
  const [name, setName] = useState('')
  const set = (id: string, patch: Partial<KitProfile>) => save({ ...kit, profiles: kit.profiles.map((p, i) => (p.id === id ? cleanKitProfile({ ...p, ...patch }, i) ?? p : p)) })
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
  return (
    <div className="di-kit-profiles">
      <p className="di-kit-hint">A profile switches by itself: by the app in front, the Wi-Fi you are on, or the time. It can show only some tiles and buttons, and its own reminders.</p>
      {kit.profiles.map((p) => (
        <fieldset key={p.id} className={`di-kit-profile ${k.profile?.id === p.id ? 'on' : ''}`}>
          <legend>{p.icon} {p.name}{k.profile?.id === p.id ? ' · on now' : ''}</legend>
          <Field lazy label="Apps" value={p.apps.join(', ')} onChange={(v) => set(p.id, { apps: list(v) })} placeholder="code, notion" width={120} />
          <Field lazy label="Wi-Fi" value={p.wifi.join(', ')} onChange={(v) => set(p.id, { wifi: list(v) })} placeholder="Home-Net" width={100} />
          <Field lazy label="From" value={p.from ?? ''} onChange={(v) => set(p.id, { from: v, to: p.to ?? '18:00' })} placeholder="09:00" width={48} />
          <Field lazy label="To" value={p.to ?? ''} onChange={(v) => set(p.id, { to: v, from: p.from ?? '09:00' })} placeholder="17:00" width={48} />
          <div className="di-kit-pick">
            <span>Tiles</span>
            {kit.tiles.map((t) => (
              <label key={t.id} className="di-kit-check">
                <input type="checkbox" checked={!p.tiles || p.tiles.includes(t.id)} onChange={(e) => set(p.id, { tiles: e.target.checked ? [...(p.tiles ?? []), t.id] : (p.tiles ?? kit.tiles.map((x) => x.id)).filter((x) => x !== t.id) })} /> {t.icon}
              </label>
            ))}
            <span>Buttons</span>
            {kit.buttons.map((b) => (
              <label key={b.id} className="di-kit-check">
                <input type="checkbox" checked={!p.buttons || p.buttons.includes(b.id)} onChange={(e) => set(p.id, { buttons: e.target.checked ? [...(p.buttons ?? []), b.id] : (p.buttons ?? kit.buttons.map((x) => x.id)).filter((x) => x !== b.id) })} /> {b.icon}
              </label>
            ))}
          </div>
          <div className="di-kit-pick">
            <span>Reminders</span>
            {NUDGE_KINDS.map((n) => (
              <select key={n} value={p.nudges[n] ?? ''} onPointerDown={focusKeys} onChange={(e) => set(p.id, { nudges: { ...p.nudges, [n]: e.target.value || undefined } })} aria-label={`${n} reminders`}>
                <option value="">{n}: as usual</option>
                <option value="peek">{n}: drop down</option>
                <option value="dot">{n}: a dot</option>
                <option value="never">{n}: never</option>
              </select>
            ))}
          </div>
          <button className="di-kit-del" {...tp(`kit:pdel:${p.id}`, () => save({ ...kit, profiles: kit.profiles.filter((x) => x.id !== p.id) }))}>Remove this profile</button>
        </fieldset>
      ))}
      <div className="di-kit-add">
        <Field label="New profile" value={name} onChange={setName} placeholder="Gym" width={100} />
        <button
          className="di-kit-plus"
          {...tp('kit:padd', () => {
            if (!name.trim()) return
            const used = kit.profiles.map((p) => p.id)
            let i = kit.profiles.length
            while (used.includes(`p${i}`)) i++
            const p = cleanKitProfile({ id: `p${i}`, name: name.trim() })
            if (p) save({ ...kit, profiles: [...kit.profiles, p] })
            setName('')
          })}
        >
          ＋ Add
        </button>
      </div>
    </div>
  )
}
