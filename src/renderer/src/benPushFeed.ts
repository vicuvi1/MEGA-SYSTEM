// Ben 2's pushes, the app window's side (core/benPushes.ts): on every island
// build (no new timer) it tells the shared log whether you're at the PC (only
// when that changes, or every 5 minutes while you are), and while you are it
// shows the block check-in, the morning brief and the evening shutdown as
// island cards, each claimed by its one key so Telegram never sends it too.
// The server's tick sends them on Telegram when you're away. A drift word the
// island wouldn't show (Calm keeps it as a dot) is handed to Telegram.
import { afterShiftPlan, shutdownFor } from '@core/afterShift'
import { atPc, channelFor, pushAlert, decideBrief, decideCheckin, decideShutdown, driftToTelegram, isOffDay, pcSeenNext, type CheckinBlock, type PcSeen, type PushLog, type PushOp, type PushOut, type ShutdownItem } from '@core/benPushes'
import type { IslandAction, IslandAlert, IslandBlock } from '@core/islandModel'
export { pushAlert }
import { modeGate } from '@core/islandCalm'
import { targetForDay } from '@core/sleep'
import { dayKey } from '@core/dates'
import { life } from './bridge'
import type { LifeFitView } from './web/lifeFitStore'

let seen: PcSeen | null = null
let logCache: { at: number; day: string; log: PushLog | null } = { at: 0, day: '', log: null }
let active: { alert: IslandAlert; key: string; until: number } | null = null
let prefsCache: { at: number; mode: string; peekFor: Record<string, boolean> | null } = { at: 0, mode: 'calm', peekFor: null }

const TTL: Record<PushOut['type'], number> = { checkin: 10, brief: 45, shutdown: 30, weekly: 30, drift: 10 }

async function readLog(now: number, day: string, fresh = false): Promise<PushLog | null> {
  if (!life.coach?.pushes) return null
  if (fresh || now - logCache.at > 20_000 || logCache.day !== day) {
    const l = await life.coach.pushes.log().catch(() => null)
    logCache = { at: now, day, log: l ?? logCache.log }
  }
  return logCache.log
}

export interface PushIslandInput {
  now: number
  idleSec: number | null
  blocks: IslandBlock[]
  running: boolean
  meeting: boolean
  bedLogged: boolean
  fit: LifeFitView | null
  sleep: { weekdayTarget?: string; weekendTarget?: string } | null
  mustdos: { text: string; done: boolean }[]
  waterTarget: number
  dayClosed: boolean
  todo: { id: string; content: string }[]
  done: string[]
}

/** The push card for the island now, or null. Also keeps "at the PC" up to date for the server. */
export async function pushTick(o: PushIslandInput): Promise<IslandAlert | null> {
  if (!life.coach?.pushes || !window.desktop) return null
  const here = atPc(o.idleSec)
  const next = pcSeenNext(seen, here, o.now)
  if (next) {
    seen = next
    void life.coach.pushes.seen(next).catch(() => {})
  }
  if (active && (active.until <= o.now || !here)) active = here ? null : active
  if (!here || !o.fit) return null
  const day = dayKey(new Date(o.now))
  const log = await readLog(o.now, day)
  if (!log) return null
  if (active) {
    if (!log.recs[active.key]?.ans) return active.alert
    active = null
  }
  const prefs = o.fit.pushes
  const levels = o.fit.areas
  if (!prefs || !levels) return null
  const show = async (p: PushOut | null, before?: () => Promise<void>): Promise<IslandAlert | null> => {
    if (!p || p.channel !== channelFor(true)) return null
    if (before) await before()
    if (!(await life.coach!.pushes!.claim(p.key).catch(() => false))) return null
    logCache.at = 0
    const alert = pushAlert(p)
    active = { alert, key: p.key, until: o.now + TTL[p.type] * 60_000 }
    return alert
  }
  // PR1: a block that just started (the same ids as the calendar, so the server sees the same key).
  if (prefs.checkins) {
    const blocks: CheckinBlock[] = o.blocks.filter((b) => !b.maybe).map((b) => ({ id: b.id ?? `${b.title}@${b.start}`, title: b.title, start: b.start, end: b.end, focus: b.kind !== 'event' && !b.call }))
    const a = await show(decideCheckin({ now: o.now, on: true, blocks, running: o.running, meeting: o.meeting, quiet: o.bedLogged, levels, log, here: true }))
    if (a) return a
  }
  // PR3: the morning brief at your wake time.
  const wake = o.sleep?.weekdayTarget ? targetForDay(day, o.sleep.weekdayTarget, o.sleep.weekendTarget ?? o.sleep.weekdayTarget) : o.fit.wake
  const first = o.blocks.filter((b) => !b.maybe && b.start >= o.now - 5 * 60_000).sort((x, y) => x.start - y.start)[0]
  const brief = await show(decideBrief({ now: o.now, day, wake, prefs, off: isOffDay(prefs, day), mustDos: o.mustdos.filter((m) => !m.done).map((m) => m.text), firstBlock: first ? { title: first.title, start: first.start } : null, waterTargetMl: o.waterTarget, levels, log, here: true, quiet: o.bedLogged }))
  if (brief) return brief
  // PR4: the evening shutdown, ~30 min before bed (the same items as Today's Shut down).
  const open: ShutdownItem[] = [
    ...o.mustdos.filter((m) => !m.done).map((m): ShutdownItem => ({ id: `m:${m.text}`.slice(0, 80), text: m.text, kind: 'mustdo' })),
    ...o.todo.filter((t) => !o.mustdos.some((m) => m.text === t.content)).slice(0, 4).map((t): ShutdownItem => ({ id: `t:${t.id}`, text: t.content, kind: 'todo', ref: t.id }))
  ].slice(0, 6)
  // BD5: after a late shift the shutdown comes at the shift's end, not in the middle of it.
  const sdAt = shutdownFor(afterShiftPlan(o.fit, day, o.fit.bed), o.fit.bed, prefs)
  const sd = decideShutdown({ now: o.now, day, bed: sdAt.bed, prefs: sdAt.prefs, closed: o.dayClosed, bedLogged: o.bedLogged, done: o.done, open, levels, log, here: true })
  return show(sd, async () => void (await life.coach!.pushes!.shutdown(open).catch(() => {})))
}

/** The brief already came today (anywhere): the PC coach's own "good morning" stays quiet. */
export const briefShownToday = (now: number) => !!logCache.log?.recs[`brief:${dayKey(new Date(now))}`]

/**
 * PR2: the PC coach's drift card names the block ("25 min of video during
 * English essay"). When the island wouldn't show it by itself (Calm or
 * Balanced with "Ben on your PC" peeks off), it goes to Telegram once.
 */
export async function driftAway(card: IslandAlert | null, now: number): Promise<void> {
  if (!card || card.kind !== 'refocus' || !life.coach?.pushes) return
  if (now - prefsCache.at > 60_000) {
    prefsCache.at = now
    const p = (await window.desktop?.getIslandPrefs?.().catch(() => null)) as { mode?: string; peekFor?: Record<string, boolean> } | null
    if (p) prefsCache = { at: now, mode: p.mode ?? 'calm', peekFor: p.peekFor ?? null }
  }
  if (!prefsCache.peekFor) return
  const gate = modeGate({ mode: prefsCache.mode as 'calm', kind: 'refocus', peekFor: prefsCache.peekFor as never, base: 'peek' })
  const log = await readLog(now, dayKey(new Date(now)))
  if (!log) return
  const item = driftToTelegram({ alertId: card.id, title: card.title, text: card.text, islandShows: gate === 'peek', log, now })
  if (item) {
    logCache.log = { ...log, outbox: [...log.outbox, item] }
    await life.coach.pushes.queue(item).catch(() => {})
  }
}

/** A tap on a push card. Returns what to say, and a follow-up island action (Plan my day, Shut down). */
export async function pushAct(a: Extract<IslandAction, { kind: 'benPush' }>): Promise<{ said: string | null; then?: IslandAction }> {
  const p = life.coach?.pushes
  if (!p) throw new Error('Open Life System first')
  if (active?.key === a.key && a.op !== 'tomorrow' && a.op !== 'drop' && a.op !== 'keep') active = null
  logCache.at = 0
  const answer = (op: PushOp) => p.answer(a.key, op, a.minutes)
  switch (a.op) {
    case 'start': {
      const subject = (a.arg ?? 'Focus').slice(0, 40)
      await life.focus.start(subject, Math.max(5, Math.min(180, a.minutes ?? 25)), null)
      window.dispatchEvent(new Event('life-focus-changed'))
      await answer('start')
      return { said: `▶ ${subject}` }
    }
    case 'later':
      await answer('later')
      return { said: '⏰ OK, again in 10 min' }
    case 'skip':
      await answer('skip')
      return { said: 'Skipped for today' }
    case 'plan':
      await answer('plan')
      return { said: '🗓 Planning your day…', then: { kind: 'chat', text: 'Plan my day' } }
    case 'shutdown':
      await answer('shutdown')
      if (active?.key === a.key) active = null
      return { said: '🌙 Shut down: Today is open', then: { kind: 'closeDay' } }
    case 'tomorrow':
    case 'drop':
    case 'keep': {
      const line = await p.mark(a.arg ?? '*', a.op)
      if (a.arg === '*' || !a.arg) {
        await answer('ok')
        if (active?.key === a.key) active = null
      }
      return { said: line }
    }
    default:
      await answer('ok')
      return { said: null }
  }
}
