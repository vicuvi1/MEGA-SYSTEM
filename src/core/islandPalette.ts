// The opened island's "power": the one-tap row on the Day page (four slots
// you pick) and the "/" palette that can reach everything (pages,
// automations, music stations, quick logs, Ben, island settings). Pure: the
// island turns each entry's `run` into a tap, a page change or a UI step.
import type { IslandAction } from './islandModel'

// ---- The power row ----

export type PowerId = 'focus' | 'water' | 'note' | 'auto' | 'reps' | 'music' | 'ben' | 'quiet' | 'task'
export const POWER_IDS: PowerId[] = ['focus', 'water', 'note', 'auto', 'reps', 'music', 'ben', 'quiet', 'task']
export const POWER_DEFAULT: PowerId[] = ['focus', 'water', 'note', 'auto']
export const POWER_SLOTS = 4
export const POWER_LABEL: Record<PowerId, string> = {
  focus: 'Focus',
  water: 'Water',
  note: 'Quick note',
  auto: 'Automation',
  reps: 'Reps',
  music: 'Music',
  ben: 'Ask Ben',
  quiet: 'Quiet 1 h',
  task: 'Add task'
}

/** Four different slots, from what was saved (anything odd gets the default). */
export function cleanPower(v: unknown): PowerId[] {
  const out: PowerId[] = []
  if (Array.isArray(v)) for (const x of v) if (POWER_IDS.includes(x as PowerId) && !out.includes(x as PowerId)) out.push(x as PowerId)
  for (const d of POWER_DEFAULT) if (out.length < POWER_SLOTS && !out.includes(d)) out.push(d)
  for (const d of POWER_IDS) if (out.length < POWER_SLOTS && !out.includes(d)) out.push(d)
  return out.slice(0, POWER_SLOTS)
}

/** Editing: the slot takes the next action that isn't already in the row. */
export function cyclePower(row: PowerId[], slot: number): PowerId[] {
  const cur = row[slot]
  if (cur == null) return row
  let i = POWER_IDS.indexOf(cur)
  for (let n = 0; n < POWER_IDS.length; n++) {
    i = (i + 1) % POWER_IDS.length
    const next = POWER_IDS[i]
    if (next === cur || !row.includes(next)) return row.map((x, k) => (k === slot ? next : x))
  }
  return row
}

// ---- The palette ----

export type PaletteRun =
  | { kind: 'tap'; action: IslandAction; label: string }
  | { kind: 'page'; id: string }
  | { kind: 'ui'; op: 'quiet' | 'pin' | 'app' | 'editPill' | 'editPower' | 'note' | 'task' | 'close' }
  | { kind: 'music'; op: 'toggle' | 'next' }
  | { kind: 'station'; id: string }

export interface PaletteItem {
  id: string
  icon: string
  label: string
  group: 'Pages' | 'Do' | 'Automations' | 'Music' | 'Island'
  hint?: string
  /** More words that find it. */
  words?: string
  run: PaletteRun
}

export interface PaletteCtx {
  pages: { id: string; title: string; icon: string }[]
  autos: { id: string; name: string; icon: string; fields: number }[]
  stations: { id: string; name: string }[]
  chips: { water: number[]; reps: number[]; focus: number[] }
  reps: { id: string; name: string }[]
  running: boolean
  playing: boolean
  musicLoaded: boolean
}

/** Every entry the palette offers right now. */
export function paletteItems(c: PaletteCtx): PaletteItem[] {
  const out: PaletteItem[] = []
  c.pages.forEach((p, i) => out.push({ id: `page:${p.id}`, icon: p.icon, label: p.title, group: 'Pages', hint: i < 9 ? String(i + 1) : undefined, words: 'page go open', run: { kind: 'page', id: p.id } }))
  if (c.running) {
    out.push({ id: 'do:stop', icon: '⏹', label: 'Stop & log the timer', group: 'Do', words: 'focus timer end', run: { kind: 'tap', action: { kind: 'stop' }, label: 'Stop & log' } })
    out.push({ id: 'do:extend', icon: '⏩', label: '+5 min on the timer', group: 'Do', words: 'focus extend more', run: { kind: 'tap', action: { kind: 'extend', minutes: 5 }, label: '+5 min' } })
  } else {
    for (const m of c.chips.focus) out.push({ id: `do:focus${m}`, icon: '▶', label: `Focus ${m} min`, group: 'Do', words: 'start timer pomodoro', run: { kind: 'tap', action: { kind: 'start', subject: 'Focus', minutes: m }, label: `Focus ${m}` } })
  }
  for (const ml of c.chips.water) out.push({ id: `do:water${ml}`, icon: '💧', label: `Log ${ml} ml water`, group: 'Do', words: 'drink glass', run: { kind: 'tap', action: { kind: 'water', ml }, label: `+${ml} ml` } })
  const rep = c.reps[0]
  if (rep) for (const n of c.chips.reps) out.push({ id: `do:reps${n}`, icon: '💪', label: `Log ${n} ${rep.name}`, group: 'Do', words: 'reps exercise sport', run: { kind: 'tap', action: { kind: 'reps', id: rep.id, name: rep.name, n }, label: `+${n} ${rep.name}` } })
  out.push({ id: 'do:note', icon: '📝', label: 'Quick note', group: 'Do', words: 'notebook write idea', run: { kind: 'ui', op: 'note' } })
  out.push({ id: 'do:task', icon: '✅', label: 'Add a task', group: 'Do', words: 'todoist todo', run: { kind: 'ui', op: 'task' } })
  for (const a of c.autos) out.push({ id: `auto:${a.id}`, icon: a.icon || '⚡', label: a.name, group: 'Automations', hint: a.fields ? 'asks' : undefined, words: 'automation run flow', run: a.fields ? { kind: 'page', id: 'day' } : { kind: 'tap', action: { kind: 'auto', op: 'run', id: a.id }, label: a.name } })
  if (c.musicLoaded) {
    out.push({ id: 'mu:toggle', icon: c.playing ? '⏸' : '▶', label: c.playing ? 'Pause music' : 'Play music', group: 'Music', words: 'song track resume', run: { kind: 'music', op: 'toggle' } })
    out.push({ id: 'mu:next', icon: '⏭', label: 'Next song', group: 'Music', words: 'skip track', run: { kind: 'music', op: 'next' } })
  }
  for (const s of c.stations) out.push({ id: `st:${s.id}`, icon: '📻', label: `Play ${s.name}`, group: 'Music', words: 'station soundcloud playlist', run: { kind: 'station', id: s.id } })
  out.push({ id: 'ui:quiet', icon: '🌙', label: 'Quiet for an hour', group: 'Island', words: 'mute silence do not disturb', run: { kind: 'ui', op: 'quiet' } })
  out.push({ id: 'ui:pin', icon: '📌', label: 'Keep the island open', group: 'Island', words: 'pin stay', run: { kind: 'ui', op: 'pin' } })
  out.push({ id: 'ui:app', icon: '⤢', label: 'Open Life System', group: 'Island', words: 'app window', run: { kind: 'ui', op: 'app' } })
  out.push({ id: 'ui:power', icon: '⚡', label: 'Change the one-tap row', group: 'Island', words: 'edit buttons power', run: { kind: 'ui', op: 'editPower' } })
  out.push({ id: 'ui:pill', icon: '✎', label: 'Edit the pill', group: 'Island', words: 'closed notch items', run: { kind: 'ui', op: 'editPill' } })
  return out
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

/**
 * The entries for what you typed: every word must start a word of the entry
 * (or be inside its label). Label matches first, then by group order.
 * Nothing typed: pages and the "Do" entries.
 */
export function filterPalette(items: PaletteItem[], query: string, max = 8): PaletteItem[] {
  const q = norm(query)
  if (!q) return items.filter((x) => x.group === 'Pages' || x.group === 'Do' || x.group === 'Automations').slice(0, max)
  const words = q.split(/\s+/)
  const scored: { x: PaletteItem; score: number; i: number }[] = []
  items.forEach((x, i) => {
    const label = norm(x.label)
    const all = `${label} ${norm(x.words ?? '')} ${norm(x.group)}`
    const tokens = all.split(/[^a-z0-9]+/)
    let score = 0
    for (const w of words) {
      if (label.startsWith(w)) score += 3
      else if (tokens.some((t) => t.startsWith(w))) score += label.includes(w) ? 2 : 1
      else if (label.includes(w)) score += 1
      else return
    }
    scored.push({ x, score, i })
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, max).map((s) => s.x)
}

/** 1–9 jump to that page; anything else is not a page key. */
export function pageKey(key: string, count: number): number | null {
  if (!/^[1-9]$/.test(key)) return null
  const i = Number(key) - 1
  return i < count ? i : null
}

/**
 * A key typed while the island is open and nothing has focus: does it start
 * the command bar? Printable characters only, never digits (pages), "/"
 * (the palette), "[" "]" (page steps) or with Ctrl / Alt / Cmd.
 */
export function startsTyping(key: string, mods: { ctrl: boolean; alt: boolean; meta: boolean }): boolean {
  if (mods.ctrl || mods.alt || mods.meta) return false
  if (key.length !== 1 || key === ' ') return false
  return !/^[0-9/[\]]$/.test(key)
}
