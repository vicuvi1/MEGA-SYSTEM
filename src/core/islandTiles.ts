// Island 2: your own tiles (IN34), your own one-tap buttons (IN35), shortcuts
// for them (IN41), the mini dock's list (IN38) and the island's colours
// (IN40). All of it lives in one small "island kit" that is saved in your
// synced settings (settings key `island_kit`), so every PC shows the same.
// Pure and tested (islandTiles.test.ts).
//
// Points stay honest: a button only logs what you did through the normal
// paths (reps, water, the workout log), each tap can be undone, and a counter
// is only a counter (it pays nothing).
import type { IslandAction } from './islandModel'
import { isAltGrCombo, normalizeAccelerator } from './islandKeys'
import { cleanKitProfiles, type KitProfile } from './islandKitExtras'
import { cleanMusicKit, DEFAULT_MUSIC, type MusicKit } from './music'

export type TileKind = 'counter' | 'timer' | 'exercise' | 'water' | 'link' | 'page' | 'note' | 'music'
export const TILE_KINDS: TileKind[] = ['counter', 'timer', 'exercise', 'water', 'link', 'page', 'note', 'music']
export const TILE_LABEL: Record<TileKind, string> = { counter: 'Counter', timer: 'Timer', exercise: 'Exercise +N', water: 'Water', link: 'Link', page: 'App page', note: 'Note', music: 'Music' }
const TILE_ICON: Record<TileKind, string> = { counter: '🔢', timer: '⏱', exercise: '💪', water: '💧', link: '🔗', page: '📄', note: '📝', music: '♫' }

/** App pages a tile may open. */
export const TILE_PAGES = ['today', 'calendar', 'tasks', 'insights', 'sleep', 'discipline', 'money', 'body', 'rewards', 'notebook', 'coach'] as const

export interface Tile {
  id: string
  kind: TileKind
  label: string
  icon: string
  /** counter: step; exercise: reps per tap; water: ml per tap. */
  n?: number
  /** timer: minutes. */
  minutes?: number
  /** exercise: the exercise's name (matched to Sport Track by name). */
  name?: string
  /** link: an https address. */
  url?: string
  /** page: an app page. */
  page?: string
  /** note: a short line of text. */
  text?: string
  /** IN41: a global shortcut ("Control+Alt+P"), or none. */
  shortcut?: string
  /** IN38: also on the mini dock. */
  dock?: boolean
}

export type ButtonAct =
  | { do: 'reps'; name: string; n: number }
  /** Held for a time (a plank): logged as seconds. */
  | { do: 'hold'; name: string; sec: number }
  /** A walk: logged as minutes. */
  | { do: 'walk'; min: number }
  | { do: 'water'; ml: number }

export interface KitButton {
  id: string
  label: string
  icon: string
  act: ButtonAct
  /** On the pill (beside it, on hover). */
  pill: boolean
  /** In the round menu. */
  ring: boolean
  shortcut?: string
}

export type Palette = 'lime' | 'ocean' | 'rose' | 'amber' | 'violet' | 'mint'
export const PALETTES: Palette[] = ['lime', 'ocean', 'rose', 'amber', 'violet', 'mint']
export const PALETTE_LABEL: Record<Palette, string> = { lime: 'Lime', ocean: 'Ocean', rose: 'Rose', amber: 'Amber', violet: 'Violet', mint: 'Mint' }

export interface IslandKit {
  tiles: Tile[]
  buttons: KitButton[]
  /** IN37: your own profiles. */
  profiles: KitProfile[]
  /** IN40: colours on top of the look you picked (Settings → Desktop island). */
  look: { palette: Palette; contrast: boolean; seasonal: boolean }
  /** IN38: the mini dock. */
  dock: { on: boolean }
  /** IN42: the clipboard tray (off by default). */
  clipboard: boolean
  /** IN48: drop files on the island to keep them for later. */
  shelf: boolean
  /** IN-SC / MU: SoundCloud stations, starred tracks, the focus mix, Ben may see what plays. */
  music: MusicKit
  /** Counters: today's count per tile. */
  counts: Record<string, { day: string; n: number }>
}

export const TILES_MAX = 16
export const BUTTONS_MAX = 10

export const DEFAULT_KIT: IslandKit = {
  tiles: [],
  buttons: [],
  profiles: [],
  look: { palette: 'lime', contrast: false, seasonal: false },
  dock: { on: false },
  clipboard: false,
  shelf: false,
  music: DEFAULT_MUSIC,
  counts: {}
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n)
const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}
const ID = /^[a-z0-9:_-]{1,40}$/i
const cleanId = (v: unknown, fallback: string) => (typeof v === 'string' && ID.test(v) ? v : fallback)
const cleanKey = (v: unknown) => (typeof v === 'string' && v ? normalizeAccelerator(v) ?? undefined : undefined)

/** An https link, or null. */
export function safeHttps(url: unknown): string | null {
  try {
    const u = new URL(String(url ?? ''))
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null
  } catch {
    return null
  }
}

export function cleanTile(t: any, i = 0): Tile | null {
  if (!t || !TILE_KINDS.includes(t.kind)) return null
  const kind = t.kind as TileKind
  const base: Tile = { id: cleanId(t.id, `t${i}`), kind, label: clip(t.label, 30) || TILE_LABEL[kind], icon: clip(t.icon, 4) || TILE_ICON[kind] }
  const key = cleanKey(t.shortcut)
  if (key) base.shortcut = key
  if (t.dock === true) base.dock = true
  switch (kind) {
    case 'counter': return { ...base, n: int(t.n, 1, 100, 1) }
    case 'timer': return { ...base, minutes: int(t.minutes, 1, 180, 25) }
    case 'exercise': {
      const name = clip(t.name, 30)
      return name ? { ...base, name, n: int(t.n, 1, 500, 10) } : null
    }
    case 'water': return { ...base, n: int(t.n, 50, 1000, 250) }
    case 'link': {
      const url = safeHttps(t.url)
      return url ? { ...base, url } : null
    }
    case 'page': return (TILE_PAGES as readonly string[]).includes(t.page) ? { ...base, page: t.page } : null
    case 'note': return { ...base, text: clip(t.text, 140) }
    // MU: play / pause your music (the island does it itself).
    case 'music': return base
  }
}

export function cleanButtonAct(a: any): ButtonAct | null {
  switch (a?.do) {
    case 'reps': {
      const name = clip(a.name, 30)
      return name ? { do: 'reps', name, n: int(a.n, 1, 500, 10) } : null
    }
    case 'hold': {
      const name = clip(a.name, 30)
      return name ? { do: 'hold', name, sec: int(a.sec, 5, 600, 60) } : null
    }
    case 'walk': return { do: 'walk', min: int(a.min, 1, 120, 10) }
    case 'water': return { do: 'water', ml: int(a.ml, 50, 1000, 250) }
    default: return null
  }
}

/** What a button says by itself: "+25 squats", "Plank 60 s", "Walk 10 min", "+250 ml". */
export function buttonText(a: ButtonAct): string {
  return a.do === 'reps' ? `+${a.n} ${a.name}` : a.do === 'hold' ? `${a.name} ${a.sec} s` : a.do === 'walk' ? `Walk ${a.min} min` : `+${a.ml} ml`
}
const ACT_ICON: Record<ButtonAct['do'], string> = { reps: '💪', hold: '🧘', walk: '🚶', water: '💧' }

export function cleanButton(b: any, i = 0): KitButton | null {
  const act = cleanButtonAct(b?.act)
  if (!act) return null
  const key = cleanKey(b.shortcut)
  return { id: cleanId(b.id, `b${i}`), label: clip(b.label, 30) || buttonText(act), icon: clip(b.icon, 4) || ACT_ICON[act.do], act, pill: b.pill !== false, ring: b.ring === true, ...(key ? { shortcut: key } : {}) }
}

const uniqueIds = <T extends { id: string }>(list: T[]): T[] => {
  const seen = new Set<string>()
  return list.filter((x) => !seen.has(x.id) && (seen.add(x.id), true))
}

/** Any saved value → a valid kit (missing → defaults). */
export function cleanKit(v: any): IslandKit {
  const d = DEFAULT_KIT
  const tiles = uniqueIds((Array.isArray(v?.tiles) ? v.tiles : []).map(cleanTile).filter(Boolean) as Tile[]).slice(0, TILES_MAX)
  const buttons = uniqueIds((Array.isArray(v?.buttons) ? v.buttons : []).map(cleanButton).filter(Boolean) as KitButton[]).slice(0, BUTTONS_MAX)
  const counts: IslandKit['counts'] = {}
  if (v?.counts && typeof v.counts === 'object') {
    for (const t of tiles) {
      const c = v.counts[t.id]
      if (t.kind === 'counter' && c && /^\d{4}-\d{2}-\d{2}$/.test(c.day)) counts[t.id] = { day: c.day, n: int(c.n, 0, 100_000, 0) }
    }
  }
  return {
    tiles,
    buttons,
    profiles: cleanKitProfiles(v?.profiles),
    look: { palette: PALETTES.includes(v?.look?.palette) ? v.look.palette : d.look.palette, contrast: v?.look?.contrast === true, seasonal: v?.look?.seasonal === true },
    dock: { on: v?.dock?.on === true },
    clipboard: v?.clipboard === true,
    shelf: v?.shelf === true,
    music: cleanMusicKit(v?.music),
    counts
  }
}

// ---- Edit mode: add, reorder, remove ----

/** A fresh id that isn't used yet. */
export function newId(prefix: string, used: string[], rand: () => number = Math.random): string {
  for (let i = 0; i < 50; i++) {
    const id = `${prefix}${Math.floor(rand() * 1e6).toString(36)}`
    if (!used.includes(id)) return id
  }
  return `${prefix}${used.length + 1}x`
}

export function addTile(kit: IslandKit, t: Partial<Tile> & { kind: TileKind }, rand?: () => number): IslandKit {
  if (kit.tiles.length >= TILES_MAX) return kit
  const tile = cleanTile({ ...t, id: newId('t', kit.tiles.map((x) => x.id), rand) })
  return tile ? { ...kit, tiles: [...kit.tiles, tile] } : kit
}
export function addButton(kit: IslandKit, b: { act: ButtonAct; label?: string; pill?: boolean; ring?: boolean }, rand?: () => number): IslandKit {
  if (kit.buttons.length >= BUTTONS_MAX) return kit
  const btn = cleanButton({ ...b, id: newId('b', kit.buttons.map((x) => x.id), rand) })
  return btn ? { ...kit, buttons: [...kit.buttons, btn] } : kit
}
/** Move item `id` by `by` places (−1 = earlier). */
export function moveItem<T extends { id: string }>(list: T[], id: string, by: number): T[] {
  const i = list.findIndex((x) => x.id === id)
  if (i < 0) return list
  const j = Math.max(0, Math.min(list.length - 1, i + by))
  if (i === j) return list
  const out = list.slice()
  const [x] = out.splice(i, 1)
  out.splice(j, 0, x)
  return out
}
export function removeTile(kit: IslandKit, id: string): IslandKit {
  const { [id]: _gone, ...counts } = kit.counts
  return { ...kit, tiles: kit.tiles.filter((t) => t.id !== id), counts, profiles: kit.profiles.map((p) => (p.tiles ? { ...p, tiles: p.tiles.filter((x) => x !== id) } : p)) }
}
export function removeButton(kit: IslandKit, id: string): IslandKit {
  return { ...kit, buttons: kit.buttons.filter((b) => b.id !== id), profiles: kit.profiles.map((p) => (p.buttons ? { ...p, buttons: p.buttons.filter((x) => x !== id) } : p)) }
}
export function updateTile(kit: IslandKit, id: string, patch: Partial<Tile>): IslandKit {
  return { ...kit, tiles: kit.tiles.map((t, i) => (t.id === id ? cleanTile({ ...t, ...patch, id, kind: t.kind }, i) ?? t : t)) }
}
export function updateButton(kit: IslandKit, id: string, patch: Partial<KitButton>): IslandKit {
  return { ...kit, buttons: kit.buttons.map((b, i) => (b.id === id ? cleanButton({ ...b, ...patch, id }, i) ?? b : b)) }
}

// ---- Counters ----

/** Today's count of a counter tile (a new day starts at 0). */
export const countOf = (kit: IslandKit, id: string, day: string) => (kit.counts[id]?.day === day ? kit.counts[id].n : 0)
export function bumpCount(kit: IslandKit, id: string, by: number, day: string): IslandKit {
  const t = kit.tiles.find((x) => x.id === id && x.kind === 'counter')
  if (!t) return kit
  const n = Math.max(0, countOf(kit, id, day) + by)
  return { ...kit, counts: { ...kit.counts, [id]: { day, n } } }
}

// ---- What a tap does ----

/** "Push-ups" → "push-ups": the exercise's id when Sport Track has none by that name. */
export const exSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'exercise'

/**
 * The island action for a tile (null when it does something on the island
 * itself, like a note or a counter, or isn't possible). `tapId` makes it undoable.
 */
export function tileAction(t: Tile, tapId: string, o: { exId?: string | null; subject?: string } = {}): IslandAction | null {
  switch (t.kind) {
    case 'timer': return { id: tapId, kind: 'start', subject: o.subject || t.label, minutes: t.minutes ?? 25 }
    case 'exercise': return { id: tapId, kind: 'reps', ex: o.exId || exSlug(t.name!), name: t.name!, n: t.n ?? 10 }
    case 'water': return { id: tapId, kind: 'water', ml: t.n ?? 250 }
    case 'page': return { kind: 'open', page: t.page }
    case 'link': return t.url ? { kind: 'kitLink', url: t.url } : null
    case 'counter': return { kind: 'kitCount', tile: t.id, by: t.n ?? 1 }
    case 'note': return null
    case 'music': return null
  }
}

/** A button's island action: through the normal logging paths (reps / water), undoable by `tapId`. */
export function buttonAction(b: KitButton, tapId: string): IslandAction {
  const a = b.act
  if (a.do === 'water') return { id: tapId, kind: 'water', ml: a.ml }
  if (a.do === 'reps') return { id: tapId, kind: 'reps', ex: exSlug(a.name), name: a.name, n: a.n }
  if (a.do === 'hold') return { id: tapId, kind: 'reps', ex: exSlug(a.name), name: `${a.name} (seconds)`, n: a.sec }
  return { id: tapId, kind: 'reps', ex: 'walk', name: 'Walk (minutes)', n: a.min }
}

// ---- IN41: a shortcut per tile or button ----

export interface KitShortcut { id: string; accelerator: string }
export interface ShortcutProblem { id: string; accelerator: string; why: string }

/** Every shortcut on tiles and buttons. */
export function kitShortcuts(kit: IslandKit): KitShortcut[] {
  return [...kit.tiles, ...kit.buttons].filter((x) => x.shortcut).map((x) => ({ id: x.id, accelerator: x.shortcut! }))
}

/**
 * Clashes before anything is registered: two of yours on the same keys, one
 * of the island's own shortcuts, or Ctrl+Alt+letter (that types a letter
 * with AltGr on some keyboards: a warning, it still works).
 */
export function shortcutConflicts(list: KitShortcut[], reserved: { accelerator: string; what: string }[]): ShortcutProblem[] {
  const out: ShortcutProblem[] = []
  const norm = (a: string) => (normalizeAccelerator(a) ?? a).toLowerCase()
  const seen = new Map<string, string>()
  for (const s of list) {
    const k = norm(s.accelerator)
    const r = reserved.find((x) => x.accelerator && norm(x.accelerator) === k)
    if (r) out.push({ ...s, why: `already the island's "${r.what}" shortcut` })
    else if (seen.has(k)) out.push({ ...s, why: 'used by another tile or button' })
    else if (isAltGrCombo(s.accelerator)) out.push({ ...s, why: 'Ctrl+Alt+letter may type a letter on some keyboards (AltGr)' })
    if (!seen.has(k)) seen.set(k, s.id)
  }
  return out
}

/** The ones safe to register (AltGr ones are only warned about). */
export function registrable(list: KitShortcut[], problems: ShortcutProblem[]): KitShortcut[] {
  const bad = new Set(problems.filter((p) => !p.why.startsWith('Ctrl+Alt')).map((p) => `${p.id}|${p.accelerator}`))
  return list.filter((s) => !bad.has(`${s.id}|${s.accelerator}`))
}

// ---- IN40: colours ----

export type Season = 'winter' | 'spring' | 'summer' | 'autumn'
export const seasonOf = (d: Date): Season => {
  const m = d.getMonth()
  return m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn'
}
/** The classes the island's root gets for your colours. */
export function lookClasses(look: IslandKit['look'], now: Date): string {
  return [look.palette !== 'lime' ? `acc-${look.palette}` : '', look.contrast ? 'hi-contrast' : '', look.seasonal ? `season-${seasonOf(now)}` : ''].filter(Boolean).join(' ')
}
