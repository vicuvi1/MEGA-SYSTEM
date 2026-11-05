// IC11: focus → break → next block. A timer started from the island can carry
// what comes after it: a short break, then the next block (from your plan or
// calendar). Pure and tested; IslandFeed does the hand-off.
//
// Points stay honest: the focus part is a normal session (logged with its
// real minutes when it ends); a break is never a focus session and never pays.

export interface FocusStage {
  kind: 'break' | 'next'
  minutes: number
  /** For 'next': what the next block is. */
  subject?: string
}

/** Only known stage kinds, sane lengths, at most 4 (anything else is dropped). */
export function cleanStages(v: unknown): FocusStage[] {
  if (!Array.isArray(v)) return []
  const out: FocusStage[] = []
  for (const x of v) {
    if (!x || (x.kind !== 'break' && x.kind !== 'next')) continue
    const minutes = Math.min(180, Math.max(1, Math.round(Number(x.minutes)) || 5))
    const subject = typeof x.subject === 'string' ? x.subject.trim().slice(0, 40) : ''
    out.push({ kind: x.kind, minutes, ...(subject ? { subject } : {}) })
    if (out.length >= 4) break
  }
  return out
}

/** A block the next stage can come from (calendar or plan). */
export interface FlowBlock { title: string; start: number; end: number; call?: boolean; maybe?: unknown }

/**
 * What comes after a break that ends at `breakEnd`: the next block you said
 * yes to that starts within 30 minutes of it (not a meeting: that you join),
 * else the same subject again for the same length.
 */
export function nextBlock(blocks: FlowBlock[], breakEnd: number, again: { subject: string; minutes: number }): { subject: string; minutes: number } {
  const b = blocks
    .filter((x) => !x.call && !x.maybe && x.end > breakEnd && x.start <= breakEnd + 30 * 60_000)
    .sort((a, c) => a.start - c.start)[0]
  if (b) return { subject: b.title.slice(0, 40), minutes: Math.max(5, Math.min(90, Math.round((b.end - Math.max(b.start, breakEnd)) / 60_000))) }
  return { subject: again.subject.slice(0, 40), minutes: Math.max(5, Math.min(180, Math.round(again.minutes))) }
}

/** The stages for an island timer: a break of `breakMin` (0 = none), then the next block. */
export function flowStages(breakMin: number, next: { subject: string; minutes: number } | null): FocusStage[] {
  if (!(breakMin > 0)) return []
  return [{ kind: 'break', minutes: Math.round(breakMin) }, ...(next ? [{ kind: 'next' as const, minutes: next.minutes, subject: next.subject }] : [])]
}

/**
 * The timer is up: hand off to the break now? Only when it carries a break,
 * the time is really up, and you are at the PC (idle under 5 minutes): away,
 * the usual "Time is up" waits for you, so nothing is logged behind your back.
 */
export function shouldHandOff(o: { now: number; endsAt: number; paused: boolean; stages: FocusStage[] | undefined; idleSec: number | null }): boolean {
  if (o.paused || !o.stages?.some((s) => s.kind === 'break')) return false
  if (o.now < o.endsAt) return false
  // Over by more than 10 minutes: you're clearly not following the flow; leave it to you.
  if (o.now - o.endsAt > 10 * 60_000) return false
  return o.idleSec == null || o.idleSec < 300
}

/** A break going on (kept by the app window; never a focus session). */
export interface FocusBreak {
  startedAt: number
  endsAt: number
  /** What starts after it (null: nothing planned, you pick). */
  next: { subject: string; minutes: number } | null
  /** Stage dots: how many parts the flow has and which one is on (0-based). */
  dots: { n: number; at: number }
}

/** The break after a finished timer with these stages. */
export function startBreak(stages: FocusStage[], now: number, fallback: { subject: string; minutes: number }, blocks: FlowBlock[]): FocusBreak | null {
  const brk = stages.find((s) => s.kind === 'break')
  if (!brk) return null
  const endsAt = now + brk.minutes * 60_000
  const planned = stages.find((s) => s.kind === 'next')
  const next = planned?.subject ? { subject: planned.subject, minutes: planned.minutes } : nextBlock(blocks, endsAt, fallback)
  return { startedAt: now, endsAt, next, dots: { n: 3, at: 1 } }
}

/** Stage dots for a running timer (focus is the first of focus · break · next). */
export function stageDots(stages: FocusStage[] | undefined): { n: number; at: number } | null {
  if (!stages?.length) return null
  return { n: 1 + stages.length, at: 0 }
}
