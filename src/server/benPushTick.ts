// Ben 2's pushes on the server's tick (no new timer): the check-in when a
// planned block starts and its one follow-up, the morning brief at your wake
// time and the evening shutdown before bed, each sent on Telegram only while
// you're away from the PC (the island shows them while you're at it), and
// drift words the island handed over. The logic is core/benPushes.ts; the
// shared log (one key per push) is web/benPushStore.ts.
import { channelFor, decideBrief, decideCheckin, decideShutdown, isOffDay, outboxTake, pcHere, pushTelegram, toCard, type CheckinBlock, type PushCard, type PushOut, type ShutdownItem } from '@core/benPushes'
import { blockSubject, isFocusBlock, type CalEvent } from '@core/dayTime'
import { targetForDay } from '@core/sleep'
import { bedLoggedTonight } from '@core/bedSense'
import { sharedView, sportToday } from '@core/sportShared'
import { RHYTHM, rhythmFor } from '@core/rhythm'
import { sportNow } from '../main/bodyLog'
import { getSetting } from '../main/settings'
import { readLifeFit, sleepWindow } from '../renderer/src/web/lifeFitStore'
import { todayMode } from '../renderer/src/web/extrasContext'
import { claimPush, readPcSeen, readPushLog, setShutdownItems, writePushLog } from '../renderer/src/web/benPushStore'

type Send = (text: string, markup?: unknown, opts?: { always?: boolean; push?: PushCard; throughQuiet?: boolean }) => Promise<unknown>
interface Ctx {
  mirror: { read<T>(fn: (db: any) => T): Promise<T>; write<T>(fn: (db: any) => T): Promise<T> }
  services: { services(db: any): any }
  calendar: { events(from: string, to: string): Promise<CalEvent[]> } | null
  todoist: (() => Promise<{ id: string; content: string; due?: string | null }[]>) | null
  now: Date
  send: Send
  /** Quiet hours (not yet up), or a paused day ("⏸ Pause today"): no check-ins. */
  quiet: boolean
  /** "⏸ Pause today": nothing at all. */
  paused: boolean
  /** Events around now (the tick's own list: 4 h back, 15 min ahead). */
  events: CalEvent[]
  /** In a class or a meeting now. */
  inEvent: boolean
}

/** Returns whether the check-ins are on (then the tick's older block messages stay quiet). */
export async function pushTick(c: Ctx): Promise<{ checkins: boolean; sent: string[] }> {
  const now = c.now.getTime()
  const sent: string[] = []
  const f = await c.mirror.read((db) => {
    const svc = c.services.services(db)
    const today: string = svc.wallet.today(c.now)
    const fit = readLifeFit(db)
    const focus = svc.focus.state(c.now)
    const sl = svc.sleep
    let water = 0
    try {
      water = sharedView(sportNow(db), sportToday(c.now)).water.target
    } catch {
      water = 0
    }
    let tomorrowTop3: string[] = []
    try {
      const st = rhythmFor(JSON.parse(getSetting(db, RHYTHM) || 'null'), today)
      tomorrowTop3 = st.tomorrow?.day === today ? st.tomorrow.top3 : []
    } catch {
      tomorrowTop3 = []
    }
    const logs = sl.state().recentLogs ?? []
    return {
      today,
      fit,
      log: readPushLog(db, today),
      seen: readPcSeen(db),
      running: !!focus.running,
      plan: focus.plan.items as { text: string; done: boolean; todoistId?: string }[],
      closed: (focus.plan.reasons?.length ?? 0) > 0,
      sessions: (focus.todaySessions ?? []).map((x: { subject: string }) => x.subject) as string[],
      wake: targetForDay(today, sl.weekdayTarget(), sl.weekendTarget()) || sleepWindow(db).wake,
      bed: sl.bedtimeTarget() as string,
      bedLogged: bedLoggedTonight(logs, c.now),
      water,
      tomorrowTop3,
      mode: todayMode(db, today)?.kind ?? null
    }
  })
  const prefs = f.fit.pushes!
  const levels = f.fit.areas!
  const here = pcHere(f.seen, now)
  const go = async (p: PushOut, before?: (db: any) => void): Promise<boolean> => {
    // Claimed first (in one write), so a slow send and the island never both show it.
    const mine = await c.mirror.write((db) => {
      const ok = claimPush(db, f.today, p.key, 'telegram', now)
      if (ok && before) before(db)
      return ok
    })
    if (!mine) return false
    const m = pushTelegram(p, (s) => `fo|${blockSubject(s).slice(0, 28)}`)
    // The brief and the shutdown come at times you set (wake, bed), so quiet hours don't hold them.
    await c.send(m.text, m.keyboard, { always: true, push: toCard(p), throughQuiet: p.type === 'brief' || p.type === 'shutdown' }).catch(() => null)
    sent.push(p.key)
    return true
  }

  // Drift words the island handed over (you weren't looking at it): once each.
  if (f.log.outbox.length) {
    const t = outboxTake(f.log, now)
    await c.mirror.write((db) => writePushLog(db, { ...readPushLog(db, f.today), outbox: [] }))
    for (const o of t.send) {
      const mine = await c.mirror.write((db) => claimPush(db, f.today, o.key, 'telegram', now))
      if (mine) {
        await c.send(o.text, { inline_keyboard: [[{ text: '↩ Back to it', callback_data: `bp|o|${o.key}`.slice(0, 64) }]] }, { always: true }).catch(() => null)
        sent.push(o.key)
      }
    }
  }

  // PR1: a block starts → "ready?"; one firmer word 10 minutes later. Only while you're away from the PC.
  if (prefs.checkins && channelFor(here) === 'telegram') {
    const blocks: CheckinBlock[] = c.events.filter((e) => !e.allDay).map((e) => ({ id: e.id, title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), focus: isFocusBlock(e) }))
    const p = decideCheckin({ now, on: true, blocks, running: f.running, meeting: c.inEvent, quiet: c.quiet || f.bedLogged, levels, log: f.log, here })
    if (p) await go(p)
  }

  // PR3: the morning brief at your wake time (not on days off).
  const off = isOffDay(prefs, f.today, f.mode)
  const mustDos = f.plan.filter((x) => !x.done).map((x) => x.text)
  const briefBase = { now, day: f.today, wake: f.wake, prefs, off, mustDos: mustDos.length ? mustDos : f.tomorrowTop3, waterTargetMl: f.water, levels, log: f.log, here, quiet: c.paused }
  if (decideBrief({ ...briefBase, firstBlock: null }) && !here) {
    const end = new Date(`${f.today}T23:59:59`)
    const evs = c.calendar ? await c.calendar.events(c.now.toISOString(), end.toISOString()).catch(() => [] as CalEvent[]) : []
    const first = evs.filter((e) => !e.allDay && Date.parse(e.start) >= now - 5 * 60_000).sort((a, b) => a.start.localeCompare(b.start))[0]
    const p = decideBrief({ ...briefBase, firstBlock: first ? { title: first.title, start: Date.parse(first.start) } : null })
    if (p) await go(p)
  }

  // PR4: the evening shutdown, ~30 min before bed: done, open (Tomorrow / Drop / Keep today), bed.
  const sdBase = { now, day: f.today, bed: f.bed, prefs, closed: f.closed || c.paused, bedLogged: f.bedLogged, done: [...new Set([...f.plan.filter((x) => x.done).map((x) => x.text), ...f.sessions])], levels, log: f.log, here }
  if (decideShutdown({ ...sdBase, open: [] }) && !here) {
    const tasks = c.todoist ? await c.todoist().catch(() => []) : []
    const open: ShutdownItem[] = [
      ...f.plan.filter((x) => !x.done).map((x): ShutdownItem => ({ id: `m:${x.text}`.slice(0, 80), text: x.text, kind: 'mustdo' })),
      ...tasks.filter((t) => !f.plan.some((x) => x.todoistId === t.id || x.text === t.content)).slice(0, 4).map((t): ShutdownItem => ({ id: `t:${t.id}`, text: t.content, kind: 'todo', ref: t.id }))
    ].slice(0, 6)
    const p = decideShutdown({ ...sdBase, open })
    if (p) await go(p, (db) => setShutdownItems(db, f.today, open))
  }
  return { checkins: prefs.checkins, sent }
}
