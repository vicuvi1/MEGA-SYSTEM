// How the desktop island behaves (Settings → Desktop & island → "How the
// island behaves"):
// - Calm (the default): hidden until you put the mouse on it. At rest only a
//   faint line (or nothing) sits at its spot on the top edge; resting the
//   mouse there for a moment slides the pill down, staying opens the panel,
//   moving away hides it again. Something new does a short one-line peek (only
//   the kinds you keep on), then waits as a small coloured dot on the line.
// - Balanced: the resting pill is always there; only important things peek.
// - Lively: everything peeks, as before.
// Pure logic (no DOM): which events may peek, the dots, the hover zone and
// the hover state machine. Drawn in DesktopIsland.tsx.
import type { AlertGate } from './islandModel'

export type IslandMode = 'calm' | 'balanced' | 'lively'
export const ISLAND_MODES: readonly IslandMode[] = ['calm', 'balanced', 'lively']
export const MODE_LABEL: Record<IslandMode, string> = { calm: 'Calm', balanced: 'Balanced', lively: 'Lively' }
export const MODE_HINT: Record<IslandMode, string> = {
  calm: 'Hidden until you rest the mouse on it. New things peek briefly, then wait as a dot.',
  balanced: 'The small pill is always there. Only important things drop down by themselves.',
  lively: 'The pill is always there and every reminder drops down by itself.'
}
export const isIslandMode = (v: unknown): v is IslandMode => typeof v === 'string' && (ISLAND_MODES as readonly string[]).includes(v)

/** What Calm shows at rest: a faint short line at its spot, or nothing at all (the spot still works). */
export type CalmRest = 'line' | 'none'

/** The kinds of things that may peek by themselves in Calm and Balanced. */
export type PeekKind = 'ben' | 'remind' | 'water' | 'move' | 'eyes' | 'timer' | 'meeting' | 'bed' | 'coach'
export const PEEK_KINDS: readonly PeekKind[] = ['ben', 'remind', 'water', 'move', 'eyes', 'timer', 'meeting', 'bed', 'coach']
export const PEEK_LABEL: Record<PeekKind, string> = {
  ben: "Ben's messages",
  remind: 'Reminders you set',
  water: 'Water',
  move: 'Move breaks',
  eyes: 'Eye breaks',
  timer: 'Timer ending',
  meeting: 'Meeting starting',
  bed: 'Bedtime wind-down',
  coach: 'Ben on your PC (praise, back to it)'
}
/** All on, except eye breaks (every 20 minutes is a lot): they wait as a dot. */
export const DEFAULT_PEEK_FOR: Record<PeekKind, boolean> = { ben: true, remind: true, water: true, move: true, eyes: false, timer: true, meeting: true, bed: true, coach: true }
/** What Balanced lets drop down by itself (and only when it's on in "Peek for"). */
export const BALANCED_PEEKS: ReadonlySet<PeekKind> = new Set<PeekKind>(['remind', 'timer', 'meeting', 'bed'])

export function cleanPeekFor(p: unknown): Record<PeekKind, boolean> {
  const src = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>
  return Object.fromEntries(PEEK_KINDS.map((k) => [k, typeof src[k] === 'boolean' ? (src[k] as boolean) : DEFAULT_PEEK_FOR[k]])) as Record<PeekKind, boolean>
}

/** Which "Peek for" switch an island alert falls under (null: none, it only ever waits as a dot in Calm). */
export function peekKind(kind: string, meeting = false): PeekKind | null {
  if (kind === 'block') return meeting ? 'meeting' : null
  if (kind === 'ben' || kind === 'checkin' || kind === 'brief') return 'ben'
  if (kind === 'shutdown') return 'bed'
  if (kind === 'remind') return 'remind'
  if (kind === 'water') return 'water'
  if (kind === 'move' || kind === 'back') return 'move'
  if (kind === 'eyes') return 'eyes'
  if (kind === 'over' || kind === 'end') return 'timer'
  if (kind === 'winddown' || kind === 'bed' || kind === 'late' || kind === 'sleep') return 'bed'
  if (kind === 'praise' || kind === 'refocus' || kind === 'coach') return 'coach'
  return null
}

/**
 * The mode on top of the usual rule (`base`: your rule per kind, quiet, calls,
 * focus, the gap between two, and the healthy-day caps already made it a dot
 * or not). The mode can only make it quieter: a dot instead of a peek.
 */
export function modeGate(o: { mode: IslandMode; kind: string; meeting?: boolean; peekFor: Record<PeekKind, boolean>; base: AlertGate }): AlertGate {
  if (o.base !== 'peek' || o.mode === 'lively') return o.base
  const k = peekKind(o.kind, !!o.meeting)
  if (!k || !o.peekFor[k]) return 'silent'
  if (o.mode === 'balanced' && !BALANCED_PEEKS.has(k)) return 'silent'
  return 'peek'
}

// ---- The dots on the line (Calm) ----

export type DotColor = 'blue' | 'green' | 'amber' | 'lime' | 'grey'
/** Water blue, moving (and eyes) green, reminders and anything with a time amber, Ben lime. */
export function dotColor(kind: string, meeting = false): DotColor {
  const k = peekKind(kind, meeting)
  if (k === 'water') return 'blue'
  if (k === 'move' || k === 'eyes') return 'green'
  if (k === 'ben' || k === 'coach') return 'lime'
  if (k === 'remind' || k === 'meeting' || k === 'timer' || k === 'bed' || kind === 'block') return 'amber'
  return 'grey'
}
export interface CalmDot { key: string; color: DotColor; label: string; /** 'alert': opens that card; 'ben': opens the panel at Ben. */ open: 'alert' | 'ben' }

/** What waits: the alert that's showing (a peek ended or it was a dot) and Ben's unread message. At most 3. */
export function calmDots(o: { alert: { id: string; kind: string; title: string; meeting?: boolean } | null; benUnread: number }): CalmDot[] {
  const out: CalmDot[] = []
  if (o.alert) out.push({ key: o.alert.id, color: dotColor(o.alert.kind, !!o.alert.meeting), label: o.alert.title || 'Something new', open: 'alert' })
  if (o.benUnread > 0 && o.alert?.kind !== 'ben') out.push({ key: 'ben', color: 'lime', label: o.benUnread === 1 ? 'A new message from Ben' : `${o.benUnread} new messages from Ben`, open: 'ben' })
  return out.slice(0, 3)
}

// ---- Where the mouse wakes it (Calm) ----

export interface ZoneRect { x: number; y: number; w: number; h: number }
/** How long the mouse must rest before the pill slides down, and how long after it left before it hides again. */
export const CALM_TIMING = { dwellMs: 200, dwellTitleBarMs: 400, leaveMs: 600 }
export function calmTiming(overTitleBar: boolean): { dwellMs: number; leaveMs: number } {
  return { dwellMs: overTitleBar ? CALM_TIMING.dwellTitleBarMs : CALM_TIMING.dwellMs, leaveMs: CALM_TIMING.leaveMs }
}

/**
 * The hover zone around the line: the island's resting width plus a small
 * margin. Over a maximized app (its tab strip and window buttons are right
 * there) it stays tiny: just the line and a few pixels.
 */
export function calmZone(nub: ZoneRect, o: { overTitleBar: boolean; restW: number; vertical?: boolean }): ZoneRect {
  const cx = nub.x + nub.w / 2
  const cy = nub.y + nub.h / 2
  if (o.overTitleBar) {
    const w = (o.vertical ? nub.w : nub.w + 8)
    const h = (o.vertical ? nub.h + 8 : nub.h + 5)
    return { x: cx - w / 2, y: o.vertical ? cy - h / 2 : nub.y, w, h }
  }
  const pad = 8
  if (o.vertical) {
    const h = Math.max(nub.h, Math.min(o.restW, 200)) + pad * 2
    const w = nub.w + 14
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }
  const w = Math.max(nub.w, Math.min(o.restW, 320)) + pad * 2
  return { x: cx - w / 2, y: nub.y, w, h: nub.h + 14 }
}
export const inZone = (x: number, y: number, z: ZoneRect) => z.w > 0 && z.h > 0 && x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h

// ---- The hover state machine (Calm) ----

/** rest: only the line; arming: the mouse is in the zone, waiting; shown: the pill; leaving: the mouse left, it hides soon. */
export type CalmPhase = 'rest' | 'arming' | 'shown' | 'leaving'
export type CalmEvent =
  /** The mouse is in the zone (or on the pill). */
  | { type: 'enter' }
  /** The mouse is out of the zone (or off the pill). */
  | { type: 'leave' }
  /** The timer it asked for ran out. */
  | { type: 'timer' }
  /** Something opened it (a peek, the panel, the shortcut): shown, no timer. */
  | { type: 'hold' }
  /** Back to the line at once. */
  | { type: 'reset' }
/** null timer: cancel it; undefined: keep the one running. */
export interface CalmStep { phase: CalmPhase; timer?: { ms: number } | null }

export function calmStep(phase: CalmPhase, e: CalmEvent, t: { dwellMs: number; leaveMs: number }): CalmStep {
  switch (e.type) {
    case 'enter':
      if (phase === 'rest') return { phase: 'arming', timer: { ms: t.dwellMs } }
      if (phase === 'leaving') return { phase: 'shown', timer: null }
      return { phase }
    case 'leave':
      if (phase === 'arming') return { phase: 'rest', timer: null }
      if (phase === 'shown') return { phase: 'leaving', timer: { ms: t.leaveMs } }
      return { phase }
    case 'timer':
      if (phase === 'arming') return { phase: 'shown', timer: null }
      if (phase === 'leaving') return { phase: 'rest', timer: null }
      return { phase }
    case 'hold':
      return { phase: 'shown', timer: phase === 'arming' || phase === 'leaving' ? null : undefined }
    case 'reset':
      return { phase: 'rest', timer: null }
  }
}
/** The pill is out (shown, or about to hide). */
export const calmRevealed = (p: CalmPhase) => p === 'shown' || p === 'leaving'
