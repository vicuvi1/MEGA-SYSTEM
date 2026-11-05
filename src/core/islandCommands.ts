// The island's controls, the pure part (tested): the quick buttons on the
// peek (IC1), what a tap is expected to change before the app answers (IC2),
// the round menu (IC3), the command bar's live suggestions (IC4), scrolling to
// adjust (IC6), the right-click menu (IC7), what a drop means (IC8), keyboard
// moves (IC9), what can be undone (IC10) and fading while you type (IC19).
import { parseCapture } from './capture'
import { parseTelegramText, tryParseNaturalExpense } from './botCommands'
import { parseWater } from './sportShared'
import type { Activity, IslandAction, IslandPrefs, IslandSnapshot } from './islandModel'

const MIN = 60_000

// ---- IC1: quick buttons on the peek, for the live thing --------------------

export interface QuickBtn {
  /** The tap's name (data-tap): the same button keeps the same id. */
  id: string
  label: string
  action: IslandAction
  title?: string
  primary?: boolean
  /** A tick box (a must-do, a Todoist task) instead of a button. */
  check?: boolean
}

/** The buttons for the thing the pill shows (empty: the peek keeps its usual button). */
export function quickButtons(a: Activity | null, s: IslandSnapshot, chips: IslandPrefs['chips'], now: number): QuickBtn[] {
  if (!a || s.locked) return []
  const r = s.running
  if (a.kind === 'timer' && r) {
    if (r.brk)
      return [
        ...(r.next ? [{ id: 'q:next', label: `▶ ${r.next.subject.slice(0, 18)}`, action: { kind: 'start', subject: r.next.subject, minutes: r.next.minutes, flow: true } as IslandAction, primary: true, title: `Skip the break: start ${r.next.subject} (${r.next.minutes} min) now` }] : []),
        { id: 'q:ext5', label: '+5', action: { kind: 'extend', minutes: 5 }, title: 'Five more minutes of break' },
        { id: 'q:end', label: '⏹ End', action: { kind: 'stop' }, primary: !r.next, title: 'End the break (nothing starts after it)' }
      ]
    return [
      r.pausedAt
        ? { id: 'q:resume', label: '▶ Resume', action: { kind: 'resume' }, primary: true, title: 'Go on with the timer' }
        : { id: 'q:pause', label: '⏸ Pause', action: { kind: 'pause' }, title: "Pause: this time doesn't count" },
      { id: 'q:ext5', label: '+5', action: { kind: 'extend', minutes: 5 }, title: 'Five more minutes' },
      { id: 'q:done', label: '✓ Done', action: { kind: 'stop' }, primary: !r.pausedAt, title: 'Stop and log the real minutes' }
    ]
  }
  if (a.kind === 'water') return chips.water.slice(0, 2).map((ml, i) => ({ id: `q:w${ml}`, label: `💧 +${ml}`, action: { kind: 'water', ml }, primary: i === 0 }))
  if (a.kind === 'mustdos') {
    const m = s.mustdos.find((x) => !x.done)
    return m ? [{ id: `q:must:${m.i}`, label: m.text, action: { kind: 'mustdo', i: m.i }, check: true, title: 'Done: tick it' }] : []
  }
  if (a.kind === 'tasks') {
    const t = s.tasks?.[0]
    return t ? [{ id: `q:task:${t.id}`, label: t.content, action: { kind: 'todoDone', id: t.id, content: t.content }, check: true, title: 'Done: tick it in Todoist' }] : []
  }
  if (a.kind === 'next' && s.next) {
    const b = s.next
    if (b.call && b.meet) return [{ id: 'q:join', label: '🎥 Join', action: { kind: 'join', url: b.meet }, primary: true }]
    if (b.call) return []
    const minutes = Math.max(5, Math.min(90, Math.round((b.end - now) / MIN)))
    return [{ id: 'q:early', label: '▶ Start early', action: { kind: 'start', subject: b.title, minutes, flow: true }, primary: true, title: `Start ${b.title} now (${minutes} min)` }]
  }
  if (a.kind === 'now' && s.now) {
    const b = s.now
    if (b.call) return b.meet ? [{ id: 'q:join', label: '🎥 Join', action: { kind: 'join', url: b.meet }, primary: true }] : []
    if (r) return []
    const minutes = Math.max(5, Math.min(90, Math.round((b.end - now) / MIN)))
    return [{ id: 'q:start', label: `▶ Start ${minutes}`, action: { kind: 'start', subject: b.title, minutes, flow: true }, primary: true }]
  }
  return []
}

// ---- IC2: what a tap should change, shown before the app answers ------------

export interface Expected {
  /** The tap's id (its answer carries the same id). */
  id: string
  action: IslandAction
  at: number
  /** The answer came (ok): it goes with the next snapshot. */
  ackedAt?: number
}

/** The snapshot with this tap's effect already on it (unknown taps change nothing). */
export function expectPatch(s: IslandSnapshot, a: IslandAction, at: number): IslandSnapshot {
  switch (a.kind) {
    case 'water':
      return { ...s, water: { ...s.water, ml: Math.max(0, s.water.ml + a.ml) } }
    case 'reps': {
      const ex = a.ex ?? a.id
      return { ...s, reps: s.reps.map((r) => (r.id === ex || r.name === a.name ? { ...r, done: r.done + a.n } : r)) }
    }
    case 'mustdo':
      return { ...s, mustdos: s.mustdos.map((m) => (m.i === a.i ? { ...m, done: !m.done } : m)) }
    case 'todoDone':
      return { ...s, tasks: (s.tasks ?? []).filter((t) => t.id !== a.id) }
    case 'pause':
      return s.running && !s.running.pausedAt && !s.running.brk ? { ...s, running: { ...s.running, pausedAt: at } } : s
    case 'resume':
      return s.running?.pausedAt ? { ...s, running: { ...s.running, endsAt: s.running.endsAt + Math.max(0, at - s.running.pausedAt), pausedAt: null } } : s
    case 'extend':
      return s.running ? { ...s, running: { ...s.running, endsAt: s.running.endsAt + a.minutes * MIN } } : s
    case 'setEnd':
      return s.running ? { ...s, running: { ...s.running, endsAt: a.at } } : s
    case 'rename':
      return s.running ? { ...s, running: { ...s.running, subject: a.subject } } : s
    case 'stop':
      return s.running ? { ...s, running: null } : s
    case 'start':
      return s.running ? s : { ...s, running: { subject: a.subject, startedAt: at, endsAt: at + a.minutes * MIN } }
    default:
      return s
  }
}

/** Every tap still waiting (or answered but not yet in a snapshot), in order. */
export function applyExpected(s: IslandSnapshot, list: Expected[]): IslandSnapshot {
  let out = s
  for (const e of list) out = expectPatch(out, e.action, e.at)
  return out
}

/** A new snapshot came: taps already answered are in it now; any older than 15 s are dropped. */
export function settleExpected(list: Expected[], now: number): Expected[] {
  return list.filter((e) => !e.ackedAt && now - e.at < 15_000)
}

// ---- IC3: the round menu ---------------------------------------------------

export interface RingItem {
  id: string
  icon: string
  label: string
  /** A tap for the app window, or something the island does itself. */
  act: IslandAction | 'ask' | 'quiet' | 'move' | 'hide'
  disabled?: boolean
}

/** The six round-menu actions, from your chips: Focus, Water, Reps, Must-do, Ask Ben, Quiet. */
export function ringItems(s: IslandSnapshot, chips: IslandPrefs['chips']): RingItem[] {
  const focus = chips.focus[0] ?? 25
  const ml = chips.water[0] ?? 250
  const n = chips.reps[0] ?? 10
  const rep = s.reps[0]
  const must = s.mustdos.find((m) => !m.done)
  const r = s.running
  return [
    r
      ? r.pausedAt
        ? { id: 'ring:focus', icon: '▶', label: 'Resume', act: { kind: 'resume' } }
        : { id: 'ring:focus', icon: '⏸', label: 'Pause', act: { kind: 'pause' }, disabled: !!r.brk }
      : { id: 'ring:focus', icon: '▶', label: `Focus ${focus}`, act: { kind: 'start', subject: s.now && !s.now.call ? s.now.title : 'Focus', minutes: focus, flow: true } },
    { id: 'ring:water', icon: '💧', label: `+${ml} ml`, act: { kind: 'water', ml } },
    rep ? { id: 'ring:reps', icon: '💪', label: `+${n} ${rep.name}`, act: { kind: 'reps', id: rep.id, ex: rep.id, name: rep.name, n } } : { id: 'ring:reps', icon: '💪', label: 'Reps', act: { kind: 'open', page: 'body' }, disabled: false },
    must ? { id: 'ring:must', icon: '☑️', label: must.text, act: { kind: 'mustdo', i: must.i } } : { id: 'ring:must', icon: '☑️', label: 'Must-dos', act: { kind: 'open', page: 'today' } },
    { id: 'ring:ask', icon: '💬', label: 'Ask Ben', act: 'ask' },
    { id: 'ring:quiet', icon: '🌙', label: 'Quiet', act: 'quiet' }
  ]
}

/**
 * Where item i of n sits around the middle (px). Full: the first at the top,
 * clockwise. Half (the pill sits at the screen's edge): a fan below, from
 * the left through the bottom to the right.
 */
export function ringLayout(n: number, radius: number, half = false): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = half ? Math.PI - (i * Math.PI) / Math.max(1, n - 1) : -Math.PI / 2 + (i * 2 * Math.PI) / n
    return { x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) + 0 }
  })
}

/** The item the pointer points at (dx, dy from the middle), or -1 inside the dead zone (half: or above it). */
export function ringPick(dx: number, dy: number, n: number, dead = 22, half = false): number {
  if (!n || Math.hypot(dx, dy) < dead) return -1
  if (half) {
    if (dy < -dead) return -1
    const a = Math.atan2(Math.max(0, dy), dx)
    return Math.min(n - 1, Math.max(0, Math.round((Math.PI - a) / (Math.PI / Math.max(1, n - 1)))))
  }
  // Angle from the top, clockwise, 0…2π.
  let a = Math.atan2(dy, dx) + Math.PI / 2
  if (a < 0) a += 2 * Math.PI
  return Math.round(a / ((2 * Math.PI) / n)) % n
}

/** Holding still this long opens the round menu; moving this far first makes it a drag. */
export const RING_HOLD_MS = 350
export const RING_MOVE_PX = 6

// ---- IC4: live suggestions in the command bar --------------------------------

export interface Suggestion {
  id: string
  icon: string
  label: string
  /** What Enter does: a tap, or the line sent as it is (the command bar's usual path). */
  action: IslandAction
  hint?: string
}

export interface PreviewCtx {
  now: number
  running: IslandSnapshot['running']
  tasks: { id: string; content: string }[]
  meet: string | null
  chips: IslandPrefs['chips']
  reps: IslandSnapshot['reps']
  /** A focus subject when none is typed (the block now, else "Focus"). */
  subject: string
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/**
 * What the typed line would do, best first (at most 6): the same rules the
 * command bar uses (water, focus, money, reps, sleep) plus the timer, join,
 * your Todoist tasks, and "Ask Ben" last. Enter runs the first one.
 */
export function commandPreview(raw: string, c: PreviewCtx): Suggestion[] {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return []
  const t = norm(text)
  const out: Suggestion[] = []
  const add = (x: Suggestion) => {
    if (out.length < 6 && !out.some((y) => y.id === x.id)) out.push(x)
  }
  const send: IslandAction = { kind: 'chat', text }
  // Water: "water 500", "+250ml", "2 glasses".
  const ml = parseWater(text)
  if (ml) add({ id: `water:${ml}`, icon: '💧', label: `Log ${ml} ml`, action: { kind: 'water', ml } })
  else if (/^(w|wa|wat|wate|water|apa)$/.test(t)) for (const v of c.chips.water.slice(0, 3)) add({ id: `water:${v}`, icon: '💧', label: `Log ${v} ml`, action: { kind: 'water', ml: v } })
  // The running timer.
  if (c.running) {
    if (/^(p|pa|pau|paus|pause|break)$/.test(t) && !c.running.pausedAt && !c.running.brk) add({ id: 'pause', icon: '⏸', label: 'Pause the timer', action: { kind: 'pause' } })
    if (/^(r|re|res|resu|resum|resume|go|go on|continue)$/.test(t) && c.running.pausedAt) add({ id: 'resume', icon: '▶', label: 'Resume the timer', action: { kind: 'resume' } })
    if (/^(s|st|sto|stop|d|do|don|done|finish(ed)?)$/.test(t)) add({ id: 'stop', icon: '✓', label: c.running.brk ? 'End the break' : `Stop & log ${c.running.subject}`, action: { kind: 'stop' } })
    if (c.running.brk && c.running.next && /^(n|ne|nex|next|skip|go)$/.test(t)) add({ id: 'next', icon: '▶', label: `Start ${c.running.next.subject} now`, action: { kind: 'start', subject: c.running.next.subject, minutes: c.running.next.minutes, flow: true } })
    const more = /^\+\s?(\d{1,3})(?:\s?m(?:in)?)?$|^(\d{1,3}) ?(?:more|min more)$/.exec(t)
    if (more) {
      const m = Math.max(1, Math.min(120, Number(more[1] ?? more[2])))
      add({ id: `extend:${m}`, icon: '⏱', label: `+${m} min`, action: { kind: 'extend', minutes: m } })
    }
  }
  // Focus: "focus" alone → your lengths; "focus 50 algebra" → that.
  const cap = parseCapture(text)
  if (cap?.kind === 'focus') add({ id: `focus:${cap.minutes}:${cap.subject}`, icon: '▶', label: `Focus ${cap.minutes} min · ${cap.subject}`, action: { kind: 'start', subject: cap.subject, minutes: cap.minutes, flow: true } })
  else if (!c.running) {
    const f = /^(?:f|fo|foc|focu|focus|start|timer)(?:\s+(\d{1,3}))?(?:\s+(\D.{1,39}))?$/i.exec(text)
    if (f) {
      const n = Number(f[1]) || 0
      const subject = (f[2] ?? '').trim() || c.subject
      const lengths = n ? [n] : [...new Set([...c.chips.focus, 25, 50, 90])].slice(0, 3)
      for (const m of lengths) {
        const min = Math.max(5, Math.min(180, m))
        add({ id: `focus:${min}:${subject}`, icon: '▶', label: `Focus ${min} min · ${subject}`, action: { kind: 'start', subject, minutes: min, flow: true } })
      }
    }
  }
  // Sleep: "bed", "going to bed", "bed 23:40", "woke up 7".
  const p = parseTelegramText(text)
  if (p.type === 'bed' || /^(b|be|bed|bedtime|sleep|going to bed|good night|gn)$/.test(t)) add({ id: `bed:${p.args[0] ?? ''}`, icon: '🌙', label: p.type === 'bed' && p.args[0] ? `Going to bed at ${p.args[0]}` : 'Going to bed', action: { kind: 'bed', ...(p.type === 'bed' && p.args[0] ? { time: p.args[0] } : {}) } })
  if (p.type === 'wake') add({ id: `wake:${p.args[0] ?? ''}`, icon: '☀️', label: p.args[0] ? `Woke up at ${p.args[0]}` : "I'm up", action: { kind: 'wake', ...(p.args[0] ? { time: p.args[0] } : {}) } })
  // Join the meeting.
  if (c.meet && /^(j|jo|joi|join|call|meet|meeting)$/.test(t)) add({ id: 'join', icon: '🎥', label: 'Join the meeting', action: { kind: 'join', url: c.meet } })
  // Reps: "30 pushups" (the rules log it).
  if (p.type === 'workout' && p.exerciseName) {
    const ex = c.reps.find((r) => norm(r.name).replace(/[^a-z]/g, '').startsWith(p.exerciseName!.replace(/s$/, '')))
    add({ id: `reps:${p.exerciseName}:${p.exerciseAmount}`, icon: '💪', label: `Log ${p.exerciseAmount} ${ex?.name ?? p.exerciseName}`, action: send })
  } else if (p.type === 'sport' && p.exerciseName) add({ id: 'sport', icon: '🏋️', label: `Log ${p.exerciseName}`, action: send })
  // Money: "spent 40 taxi", "coffee 35".
  if (!ml) {
    const m = p.type === 'expense' ? p : tryParseNaturalExpense(text)
    if (m?.expenseAmount && m.expenseNote && !/^(focus|f|water)\b/.test(t)) add({ id: `money:${m.expenseAmount}`, icon: m.expenseCategory === 'income' ? '💰' : '💸', label: `${m.expenseCategory === 'income' ? 'Income' : 'Spent'} ${m.expenseAmount} · ${m.expenseNote}`, action: send })
  }
  // A task for Todoist: "task call mom friday".
  if (cap?.kind === 'task') add({ id: 'task', icon: '➕', label: `Todoist: ${cap.text}`, action: send })
  // Your Todoist tasks that match: tick it, or focus on it.
  if (t.length >= 3) {
    const words = t.split(' ').filter((w) => w.length >= 3)
    for (const task of c.tasks) {
      const n = norm(task.content)
      if (!words.length || !words.every((w) => n.includes(w))) continue
      add({ id: `todo:${task.id}`, icon: '✓', label: `Done: ${task.content}`, action: { kind: 'todoDone', id: task.id, content: task.content }, hint: 'Todoist' })
      if (!c.running) add({ id: `todofocus:${task.id}`, icon: '▶', label: `Focus on ${task.content.slice(0, 40)}`, action: { kind: 'start', subject: task.content.slice(0, 40), minutes: c.chips.focus[0] ?? 25, flow: true, task: { kind: 'todoist', ref: task.id, title: task.content } } })
    }
  }
  // Anything else: Ben.
  add({ id: 'ben', icon: '💬', label: out.length ? 'Ask Ben' : `Ask Ben: ${text.slice(0, 60)}`, action: send })
  return out
}

/** Arrow keys in the list: the next index (wraps), -1 for nothing chosen. */
export function moveChoice(i: number, n: number, d: 1 | -1): number {
  if (!n) return -1
  if (i < 0) return d > 0 ? 0 : n - 1
  return (i + d + n) % n
}

// ---- IC6: Shift + wheel adjusts --------------------------------------------

/** One wheel notch (or a trackpad's worth) → +1 / −1; small trackpad moves add up. */
export function wheelSteps(acc: number, delta: number, notch = 50): { steps: number; acc: number } {
  const total = acc + delta
  const steps = Math.trunc(total / notch)
  return { steps: -steps, acc: total - steps * notch }
}
/** The water amount the wheel picks: 50 ml steps, 50…1000. */
export function waterPick(ml: number, steps: number): number {
  return Math.min(1000, Math.max(50, Math.round((ml + steps * 50) / 50) * 50))
}
/** Minutes added to the timer by the wheel: never so far back that it ends before now + 1 min. */
export function timerAdjust(endsAt: number, minutes: number, now: number): number {
  const leftMin = Math.floor((endsAt - now) / MIN)
  return Math.max(-Math.max(0, leftMin - 1), Math.min(120, Math.round(minutes)))
}

// ---- IC7: the menu for one activity (right click) ------------------------------

export interface MenuItem {
  id: string
  label: string
  /** A tap, or something the island does itself. */
  act: IslandAction | 'rename' | 'copyLink' | 'mute' | 'undoWater'
  disabled?: boolean
}

export function menuFor(a: Activity | null, s: IslandSnapshot, chips: IslandPrefs['chips'], canUndoWater: boolean): MenuItem[] {
  if (!a) return []
  const r = s.running
  if (a.kind === 'timer' && r) {
    if (r.brk)
      return [
        ...(r.next ? [{ id: 'm:next', label: `▶ Start ${r.next.subject.slice(0, 24)} now`, act: { kind: 'start', subject: r.next.subject, minutes: r.next.minutes, flow: true } as IslandAction }] : []),
        { id: 'm:ext5', label: '+5 min break', act: { kind: 'extend', minutes: 5 } },
        { id: 'm:end', label: '⏹ End the break', act: { kind: 'stop' } }
      ]
    return [
      r.pausedAt ? { id: 'm:resume', label: '▶ Resume', act: { kind: 'resume' } } : { id: 'm:pause', label: '⏸ Pause', act: { kind: 'pause' } },
      { id: 'm:ext5', label: '+5 min', act: { kind: 'extend', minutes: 5 } },
      { id: 'm:ext15', label: '+15 min', act: { kind: 'extend', minutes: 15 } },
      { id: 'm:stop', label: '⏹ Stop & log', act: { kind: 'stop' } },
      { id: 'm:rename', label: '✎ Rename', act: 'rename' }
    ]
  }
  const meeting = a.kind === 'now' ? s.now : a.kind === 'next' ? s.next : null
  if (meeting?.call)
    return [
      { id: 'm:join', label: '🎥 Join', act: meeting.meet ? { kind: 'join', url: meeting.meet } : 'copyLink', disabled: !meeting.meet },
      { id: 'm:copy', label: '🔗 Copy link', act: 'copyLink', disabled: !meeting.meet },
      { id: 'm:mute', label: '🔕 Mute until it ends', act: 'mute' }
    ]
  if (a.kind === 'water')
    return [
      ...[...new Set([...chips.water, 250, 500, 750])].slice(0, 4).map((ml) => ({ id: `m:w${ml}`, label: `💧 +${ml} ml`, act: { kind: 'water', ml } as IslandAction })),
      { id: 'm:wundo', label: '↶ Undo last', act: 'undoWater' as const, disabled: !canUndoWater }
    ]
  if ((a.kind === 'now' || a.kind === 'next') && meeting && !r) {
    const minutes = Math.max(5, Math.min(90, Math.round((meeting.end - Math.max(Date.now(), meeting.start)) / MIN)))
    return [{ id: 'm:start', label: `▶ Start ${meeting.title.slice(0, 30)}`, act: { kind: 'start', subject: meeting.title, minutes, flow: true } }]
  }
  if (a.kind === 'ben') return [{ id: 'm:open', label: 'Open the chat', act: { kind: 'open', page: 'coach' } }]
  return []
}

// ---- IC8: what a drop means ------------------------------------------------------

/** The biggest file kept in a note (it is stored in the note itself). */
export const DROP_MAX_BYTES = 1_000_000

export type DropKind =
  | { kind: 'todoist'; taskId: string; url: string }
  | { kind: 'link'; url: string }
  | { kind: 'file'; name: string; mime: string; size: number }
  | { kind: 'text'; text: string }
  | { kind: 'refuse'; why: string }

/** What was dropped: a Todoist task link, another link, an image or a PDF, plain text. */
export function classifyDrop(d: { uris?: string[]; text?: string; files?: { name: string; type: string; size: number }[] }): DropKind {
  const f = d.files?.[0]
  if (f) {
    const ok = /^image\/(png|jpe?g|gif|webp)$/.test(f.type) || f.type === 'application/pdf'
    if (!ok) return { kind: 'refuse', why: 'Only images and PDFs can go in a note' }
    if (f.size > DROP_MAX_BYTES) return { kind: 'refuse', why: `Too big for a note (${Math.round(f.size / 100_000) / 10} MB, at most 1 MB)` }
    return { kind: 'file', name: f.name.replace(/[^\w .()-]/g, '_').slice(0, 80) || 'file', mime: f.type, size: f.size }
  }
  const uri = (d.uris ?? []).map((u) => u.trim()).find((u) => u && !u.startsWith('#'))
  const text = (d.text ?? '').trim()
  const url = uri ?? (/^https?:\/\/\S+$/.test(text) ? text : '')
  if (url) {
    if (!/^https?:\/\//i.test(url)) return { kind: 'refuse', why: 'Only web links can be saved' }
    const t = /^https:\/\/(?:app\.)?todoist\.com\/(?:app\/)?(?:task\/|showTask\?id=)(?:[a-z0-9-]*-)?([A-Za-z0-9]+)(?:[/?#]|$)/i.exec(url)
    if (t) return { kind: 'todoist', taskId: t[1], url }
    return { kind: 'link', url: url.slice(0, 500) }
  }
  if (text) return { kind: 'text', text }
  return { kind: 'refuse', why: 'Nothing to drop' }
}

// ---- IC9: keyboard moves ----------------------------------------------------------

/** Arrow keys between sections (wraps); 1–9 fires that chip (index), '/' jumps to the command bar. */
export function keyMove(key: string, i: number, n: number): { focus?: number; chip?: number; command?: true } | null {
  if (key === '/') return { command: true }
  if (/^[1-9]$/.test(key)) return { chip: Number(key) - 1 }
  if (!n) return null
  if (key === 'ArrowDown' || key === 'ArrowRight') return { focus: i < 0 ? 0 : (i + 1) % n }
  if (key === 'ArrowUp' || key === 'ArrowLeft') return { focus: i < 0 ? n - 1 : (i - 1 + n) % n }
  if (key === 'Home') return { focus: 0 }
  if (key === 'End') return { focus: n - 1 }
  return null
}

// ---- IC10: undo the last tap ----------------------------------------------------

/** How long "↶ Undo" shows on the pill, and how long the app window keeps what it can undo. */
export const UNDO_SHOW_MS = 5000
export const UNDO_KEEP_MS = 60_000
/** Taps that log something that can be taken back. */
export function canUndo(a: IslandAction): boolean {
  return a.kind === 'water' || a.kind === 'reps' || a.kind === 'mustdo' || a.kind === 'extend' || a.kind === 'start'
}
export function undoLabel(a: IslandAction): string {
  return a.kind === 'water' ? `+${a.ml} ml` : a.kind === 'reps' ? `+${a.n} ${a.name}` : a.kind === 'mustdo' ? 'the must-do' : a.kind === 'extend' ? `+${a.minutes} min` : a.kind === 'start' ? 'the timer' : a.kind === 'moveBreak' ? `+${a.n} ${a.name}` : 'that'
}

// ---- IC19: fade while you type in another app --------------------------------------

/**
 * Typing elsewhere (input in the last second) and the pointer far from the
 * island (over 160 px): fade. Moving near, or 2 s without input: back.
 */
export function typingFade(o: { idleMs: number; cursorDist: number; faded: boolean; islandActive: boolean }): boolean {
  if (o.islandActive) return false
  if (o.cursorDist < 160) return false
  if (o.idleMs < 1000) return true
  return o.faded && o.idleMs < 2000
}
