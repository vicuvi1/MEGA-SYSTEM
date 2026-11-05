// Desktop only: the app window (it keeps running hidden in the tray) feeds the
// desktop island its snapshot and does what the island's buttons ask. The
// island window itself never opens your data, so there is one owner of it.
import { focusQualityPc, lateNight } from '@core/pcActivity'
import { useCallback, useEffect, useRef } from 'react'
import { MOOD_FACE, type Mood } from '@core/coachKit'
import { EMPTY_ISLAND, blocksFromPlan, nowNext, pickAlert, type IslandAction, type IslandAlert, type IslandBlock, type IslandSnapshot } from '@core/islandModel'
import { bedFromAway, bedLoggedTonight, showBedButton, showWakeButton } from '@core/bedSense'
import { autoStartBlock, blockKey, callNow, focusQuality, GUARD_IDLE_SEC, smartAlert } from '@core/islandSmart'
import { eyesAlert, morningAlert, moveAlert, waterAlert, windDown, windDownAlert } from '@core/islandBody'
import { clipAlert, clipWorthSaving, nextFreeSlot, taskMinutes } from '@core/islandActions'
import { bestStreak, dayHighlight, highlightAlert, rewardAlert, runOf } from '@core/islandFeel'
import { liveScore } from '@core/liveScore'
import { life } from './bridge'
import { capture } from './capture'
import { parseCapture } from '@core/capture'
import { useLive } from './live'
import { addWater } from './water'
import { findExercise, readSport, updateSport } from './sportTrack'

const SEEN = 'ls.coachSeen'
const DISMISSED = 'ls.islandDismissed'
/** The bedtime logged by itself after a night away from the PC (shown once on the island). */
const BED_AUTO = 'ls.bedAuto'
/** Island phase 1: focus guard, what you said when blocks ended, auto-start. */
const GUARD = 'ls.focusGuard'
const QUALITY = 'ls.focusQualityNote'
const ANSWERED = 'ls.blockAnswers'
const AUTO = 'ls.autoFocus'
const AUTO_DONE = 'ls.autoStarted'
/** Seconds since the last mouse/keys on the PC (from the desktop, every 15 s). */
let idleSec: number | null = null
/** Island phase 2 (your body): at the PC since (no 5-min break), first minute today, last nudges. */
let activeSince: number | null = null
const FIRST = 'ls.firstActive'
const LAST_WATER = 'ls.lastWaterAt'
const LAST_MOVE = 'ls.lastMoveAt'
const LAST_EYES = 'ls.lastEyesAt'
const EYES = 'ls.eyeBreaks'
/** Phase 3: the last copied dated text, and today's Todoist (cached a minute). */
const CLIP = 'ls.islandClip'
/** Phase 4: rewards already celebrated (id → first shown). */
const CELEBRATED = 'ls.rewardCelebrated'
let todoCache: { at: number; list: { id: string; content: string; time: string | null }[] } = { at: 0, list: [] }
function bodyTick(sec: number) {
  const now = Date.now()
  if (sec >= 300) activeSince = null
  else if (sec < 60 && !activeSince) activeSince = now - sec * 1000
  if (sec < 60 && new Date(now).getHours() >= 5) {
    const day = localDayOf(now)
    if (get<{ day: string } | null>(FIRST, null)?.day !== day) put(FIRST, { day, at: now - sec * 1000 })
  }
}
const localDayOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
interface Guard { startedAt: number; endsAt: number; subject: string; idle: number; last: number; distract?: number }

// ---- Ben on this PC (P3, P6, P7, P12, P13, P16) ----
/** The app in front (only with the sensor on), and how long you've been in a distracting one. */
let pcNow: { label: string; kind: 'work' | 'distract' | 'neutral'; since: number } | null = null
const PC_SNOOZE = 'ls.pcDistractSnooze'
/** The PC was locked during focus: when (P6). */
let lockedAt: number | null = null
const BACK = 'ls.pcBack'
const LATE = 'ls.lateNightAsked'
const BLOCK_NOTIFIED = 'ls.blockNotified'
/** P16: messages to Ben typed while offline, sent when the internet is back. */
const OUTBOX = 'ls.islandOutbox'
function pcSample(a: { label: string; kind: 'work' | 'distract' | 'neutral'; seconds: number }) {
  const now = Date.now()
  pcNow = pcNow && pcNow.label === a.label ? pcNow : { label: a.label, kind: a.kind, since: now }
  // P7: time in a distracting app counts against the running focus.
  if (a.kind === 'distract') {
    const g = get<Guard | null>(GUARD, null)
    if (g) {
      g.distract = (g.distract ?? 0) + a.seconds
      put(GUARD, g)
    }
  }
}
/** P3: in a distracting app for a minute during a focus timer. */
function distractAlert(running: { subject: string; startedAt: number } | null, now: number, dismissed: Record<string, number>): IslandAlert | null {
  if (!running || !pcNow || pcNow.kind !== 'distract' || now - pcNow.since < 60_000) return null
  if (get<number>(PC_SNOOZE, 0) > now) return null
  const id = `distract:${running.startedAt}:${pcNow.label}`
  if ((dismissed[id] ?? 0) > now) return null
  const into = Math.max(1, Math.round((now - running.startedAt) / 60000))
  return {
    id,
    kind: 'distract',
    title: `That's ${pcNow.label}`,
    text: `${into} min into ${running.subject}. Back to it?`,
    face: '👀',
    actions: [
      { label: '↩ Back', action: { kind: 'dismiss', id, snoozeMin: 10 }, primary: true },
      { label: "It's for this", action: { kind: 'pcWork', app: pcNow.label, alertId: id } },
      { label: '⏹ Stop & log', action: { kind: 'stop' } }
    ]
  }
}
/** P6: back after locking the PC during focus: add the time away, or stop. */
function backAlert(running: { subject: string } | null, now: number, dismissed: Record<string, number>): IslandAlert | null {
  const b = get<{ at: number; away: number } | null>(BACK, null)
  if (!b || !running || now - b.at > 10 * 60_000 || b.away < 2) return null
  const id = `back:${b.at}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'back',
    title: 'Welcome back',
    text: `You were away ${b.away} min during ${running.subject}. Keep going?`,
    face: '👋',
    actions: [
      { label: `▶ Add ${Math.min(60, b.away)} min`, action: { kind: 'extend', minutes: Math.min(60, b.away) }, primary: true },
      { label: '▶ Keep going', action: { kind: 'dismiss', id } },
      { label: '⏹ Stop & log', action: { kind: 'stop' } }
    ]
  }
}
/** P13: still at the PC half an hour after bedtime. */
function lateAlert(now: number, bedTarget: string, dismissed: Record<string, number>): IslandAlert | null {
  if (!lateNight(new Date(now), bedTarget, idleSec)) return null
  const day = localDayOf(now - 6 * 3600_000)
  const id = `late:${day}`
  if ((dismissed[id] ?? 0) > now || get<string>(LATE, '') === `${day}:done`) return null
  return {
    id,
    kind: 'late',
    title: 'Still up?',
    text: `It's ${new Date(now).toTimeString().slice(0, 5)} and your bedtime was ${bedTarget}. Close the day: tomorrow starts tonight.`,
    face: '🌙',
    actions: [
      { label: '🌙 Going to bed', action: { kind: 'bed' }, primary: true },
      { label: 'Close the day', action: { kind: 'closeDay' } },
      { label: '20 min more', action: { kind: 'dismiss', id, snoozeMin: 20 } }
    ]
  }
}

/** While a focus timer runs: time away from the PC counts against its quality. */
function guardTick(sec: number) {
  idleSec = sec
  const g = get<Guard | null>(GUARD, null)
  if (!g) return
  if (sec >= GUARD_IDLE_SEC) g.idle += 15
  g.last = Date.now()
  put(GUARD, g)
}

/** A focus session ended: its quality goes to the day log (Ben reads it) and a note to the island. */
async function finishGuard(g: Guard) {
  put(GUARD, null)
  const elapsed = Math.max(0, (Math.min(g.last || Date.now(), Date.now()) - g.startedAt) / 1000)
  if (elapsed < 5 * 60) return
  const pct = focusQuality(elapsed, g.idle)
  const idleMin = Math.round(g.idle / 60)
  put(QUALITY, { id: `q:${g.startedAt}`, pct, idleMin, subject: g.subject, at: Date.now() })
  await life.dayLog?.addFocus(localDayOf(g.startedAt), { at: new Date(g.startedAt).toISOString(), subject: g.subject, minutes: Math.round(elapsed / 60), pct }).catch(() => {})
}

function qualityAlert(dismissed: Record<string, number>, now: number): IslandAlert | null {
  const q = get<{ id: string; pct: number; idleMin: number; subject: string; at: number } | null>(QUALITY, null)
  if (!q || now - q.at > 30 * 60_000 || (dismissed[q.id] ?? 0) > now) return null
  return {
    id: q.id,
    kind: 'quality',
    title: `Focus done · ${q.pct}% quality`,
    text: q.pct >= 85 ? `${q.subject}: you were there the whole time. 🔥` : `${q.subject}: away ${q.idleMin} min of it. Next one: phone in another room?`,
    face: q.pct >= 85 ? '🎯' : '🤏',
    actions: [{ label: 'Got it', action: { kind: 'dismiss', id: q.id }, primary: true }]
  }
}
const get = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const put = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}

async function todayBlocks(): Promise<IslandBlock[]> {
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const on = !!(await life.google?.status().catch(() => null))?.connected
  if (on) {
    const events = await life.google!.events(new Date(`${day}T00:00:00`).toISOString(), new Date(`${day}T23:59:59`).toISOString()).catch(() => [])
    // Declined and "free" events don't count; a call link or other people make it a meeting (Q4).
    const blocks = events
      .filter((e) => !e.allDay && !e.declined && !e.free)
      .map((e) => ({ title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), id: e.id, calendarId: e.calendarId, call: !!e.meet || (e.attendees ?? 0) > 1 }))
      .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    if (blocks.length) return blocks
  }
  const rh = await life.coach?.rhythm?.('state').catch(() => null)
  const plan = rh?.state?.briefing?.plan?.blocks ?? []
  return blocksFromPlan(plan, d)
}

let listening = false

export const ISLAND_LOG = 'ls.islandLog'
export interface IslandLogEntry { at: string; kind: string; ok: boolean; error?: string }
function logIsland(e: IslandLogEntry) {
  try {
    const list: IslandLogEntry[] = JSON.parse(localStorage.getItem(ISLAND_LOG) || '[]')
    localStorage.setItem(ISLAND_LOG, JSON.stringify([...list, e].slice(-30)))
  } catch {
    /* fine */
  }
}

/** Logs the bedtime by itself (once a night), and leaves a note for the island. */
async function onAway(w: { from: string; to: string }): Promise<void> {
  const st = await life.sleep.state().catch(() => null)
  if (!st) return
  const from = new Date(w.from)
  const to = new Date(w.to)
  const time = bedFromAway(from, to, bedLoggedTonight(st.recentLogs, to))
  if (!time) return
  await life.sleep.logBed(time)
  put(BED_AUTO, { time, at: w.to })
  window.dispatchEvent(new CustomEvent('life-sleep-changed'))
}

/** "You went to bed at 00:40": once, until you confirm or fix it (not over a time-up). */
function bedAlert(dismissed: Record<string, number>, now: number, running: boolean): IslandAlert | null {
  const b = get<{ time: string; at: string } | null>(BED_AUTO, null)
  if (!b || running || now - Date.parse(b.at) > 6 * 3600_000) return null
  const id = `sleep:${b.at}`
  if (dismissed[id] && dismissed[id] > now) return null
  return {
    id,
    kind: 'sleep',
    title: 'Good morning ☀️',
    text: `You went to bed at ${b.time}: that's when the PC was last used. It's in Waky now.`,
    face: '😴',
    actions: [
      { label: '✓ Right', action: { kind: 'dismiss', id }, primary: true },
      { label: 'Fix the time', action: { kind: 'open', page: 'sleep' } },
      { label: "☀️ I'm up", action: { kind: 'wake' } }
    ]
  }
}

export function IslandFeed() {
  const desk = window.desktop
  const busy = useRef<{ on: boolean; steps: string[] }>({ on: false, steps: [] })
  const last = useRef<IslandSnapshot>(EMPTY_ISLAND)
  const blocks = useRef<{ at: number; list: IslandBlock[] }>({ at: 0, list: [] })

  const build = useCallback(async (): Promise<IslandSnapshot> => {
    const now = Date.now()
    if (!life.coach?.status) return { ...EMPTY_ISLAND, at: now }
    const body = await life.body.state().catch(() => null)
    const [status, focus, log, sleep, shop] = await Promise.all([life.coach.status(), life.focus.state(), life.coach.log().catch(() => []), life.sleep.state().catch(() => null), life.shop?.state().catch(() => null) ?? Promise.resolve(null)])
    if (now - blocks.current.at > 60_000) blocks.current = { at: now, list: await todayBlocks().catch(() => blocks.current.list) }
    const run = focus.running
    let running = run ? { subject: run.subject, startedAt: Date.parse(run.startedAt), endsAt: Date.parse(run.startedAt) + run.planned * 60000 } : null
    // Focus guard: start watching a new session; a finished one gets its quality.
    const g = get<Guard | null>(GUARD, null)
    if (g && (!running || running.startedAt !== g.startedAt)) await finishGuard(g)
    if (running && (!g || g.startedAt !== running.startedAt)) put(GUARD, { startedAt: running.startedAt, endsAt: running.endsAt, subject: running.subject, idle: 0, last: now })
    // Auto-start (if you turned it on): a work block begins → its focus timer starts.
    if (get<boolean>(AUTO, false)) {
      const started = get<Record<string, true>>(AUTO_DONE, {})
      const b = autoStartBlock(blocks.current.list, now, !!running, started)
      if (b) {
        put(AUTO_DONE, { ...Object.fromEntries(Object.entries(started).slice(-40)), [blockKey(b)]: true })
        const minutes = Math.max(5, Math.min(180, Math.round((b.end - now) / 60000)))
        const f = await life.focus.start(b.title, minutes, null).catch(() => null)
        if (f?.running) {
          running = { subject: f.running.subject, startedAt: Date.parse(f.running.startedAt), endsAt: Date.parse(f.running.startedAt) + f.running.planned * 60000 }
          put(GUARD, { startedAt: running.startedAt, endsAt: running.endsAt, subject: running.subject, idle: 0, last: now })
          window.dispatchEvent(new Event('life-focus-changed'))
        }
      }
    }
    // P12: a block starts and no timer runs: a Windows notification with [Start] [5 min] [Skip], once.
    if (!running && window.desktop?.notify) {
      const b = blocks.current.list.find((x) => x.start <= now && now - x.start < 3 * 60_000 && x.end - now >= 15 * 60_000)
      const notified = get<Record<string, number>>(BLOCK_NOTIFIED, {})
      if (b && !notified[blockKey(b)]) {
        put(BLOCK_NOTIFIED, { ...Object.fromEntries(Object.entries(notified).slice(-40)), [blockKey(b)]: now })
        const mins = Math.round((b.end - now) / 60000)
        void window.desktop.notify({ id: `block:${blockKey(b)}|${encodeURIComponent(b.title)}|${mins}`, title: `▶ ${b.title}`, body: `Starts now · ${mins} min`, actions: [{ id: 'start', label: '▶ Start' }, { id: 'later5', label: 'In 5 min' }, { id: 'skip', label: 'Skip' }] }).catch(() => {})
      }
    }
    // P8: if you share them, the day's PC totals go to the day log (Ben reads it in the evening), every 30 min.
    if (now - get<number>('ls.pcShareAt', 0) > 30 * 60_000 && window.desktop?.pcGetPrefs) {
      put('ls.pcShareAt', now)
      void (async () => {
        const p = await window.desktop!.pcGetPrefs!().catch(() => null)
        if (!p?.prefs.shareTotals) return
        const t = await window.desktop!.pcToday?.().catch(() => null)
        if (t?.line) await life.dayLog?.setPc?.(localDayOf(now), t.line).catch(() => {})
      })()
    }
    // Focus state for the PC (P19 site blocker, P20 holding notifications).
    window.desktop?.pcFocus?.({ running: !!running, subject: running?.subject ?? '', endsAt: running?.endsAt ?? 0 })
    const seen = get<number>(SEEN, 0) || now
    const faceOf = (m?: string) => (m && MOOD_FACE[m as Mood]) || status.face
    const coach = log.filter((e) => e.role === 'coach')
    const newest = coach[coach.length - 1]
    const unread = coach.filter((e) => e.via !== 'app' && Date.parse(e.at) > seen).length
    const sport = readSport()
    const reps = (Array.isArray(sport?.exercises) ? sport.exercises : [])
      .filter((e: any) => !e.archived && Number(e.target) > 0)
      .slice(0, 3)
      .map((e: any) => ({ id: String(e.id ?? e.name), name: String(e.name), done: Number(e.doneToday) || 0, target: Number(e.target) || 0 }))
    // This device's Sport Track copy is the synced truth here (a −250 must show, not the higher of two copies: N1).
    const localWater = sport?.water ? Number(sport.water.currentMl) || 0 : status.today.waterMl
    const { now: cur, next } = nowNext(blocks.current.list, now)
    const dismissed = get<Record<string, number>>(DISMISSED, {})
    // Phase 4: the reward you're working toward, your best streak, today's ring and highlight.
    const rewards = (shop?.rewards ?? []).filter((r) => !r.archived && r.price > 0)
    const goal = shop ? rewards.find((r) => r.pinned) ?? [...rewards].sort((a, b) => a.price - b.price).find((r) => r.price > shop.balance) ?? [...rewards].sort((a, b) => a.price - b.price)[0] ?? null : null
    const todayKey = localDayOf(now)
    const streak = bestStreak({
      now,
      sport: { days: body?.streak ?? 0, todayDone: !!body?.workoutDoneToday || !!body?.restToday },
      focus: runOf(status.week.map((d) => ({ day: d.day, ok: d.min >= 25 })), todayKey)
    })
    const live = liveScore({ mustDone: status.today.mustDone, openMustDos: status.mustdos.filter((x) => !x.done).map((x) => x.text), focusMin: status.today.focusMin, focusGoal: Math.max(50, status.goals.reduce((t, g) => t + g.perDayMin, 0)), waterMl: status.today.waterMl, waterTarget: status.today.waterTarget, workoutDone: !!status.today.workoutDone })
    const highlight = dayHighlight({ focusMin: status.today.focusMin, focusBefore: status.week.filter((d) => d.day < todayKey).map((d) => d.min), mustDone: status.today.mustDone, mustTotal: status.today.mustTotal, waterMl: status.today.waterMl, waterTarget: status.today.waterTarget, workoutDone: !!status.today.workoutDone, sportStreak: body?.streak ?? 0 })
    const celebrated = get<Record<string, number>>(CELEBRATED, {})
    if (now - todoCache.at > 60_000 && life.todoist?.today) {
      todoCache = { at: now, list: todoCache.list }
      const list = await life.todoist.today().catch(() => null)
      if (list) todoCache.list = list.slice(0, 3).map((t) => ({ id: t.id, content: t.content, time: t.dueTime ?? null }))
    }
    return {
      at: now,
      locked: false,
      ben: {
        face: status.face,
        mood: status.mood,
        why: status.why,
        move: status.move.kind === 'ask' ? null : { title: status.move.title, sub: status.move.sub },
        last: newest ? { text: newest.text, at: newest.at, face: faceOf(newest.mood) } : null,
        unread,
        busy: busy.current.on,
        steps: busy.current.steps
      },
      running,
      now: cur,
      next,
      mustdos: status.mustdos,
      water: { ml: localWater, target: status.today.waterTarget || Number(sport?.water?.targetMl) || 2700 },
      reps,
      alert: (() => {
        const pick = pickAlert({ now, running, blocks: blocks.current.list, log: log.map((e) => ({ ...e, face: faceOf(e.mood) })), seenBen: seen, dismissed })
        if (pick?.kind === 'over') return pick
        const smart = smartAlert({ now, blocks: blocks.current.list, running: !!running, idleSec, dismissed, answered: get<Record<string, string>>(ANSWERED, {}) })
        // In a call: only what you must see (time up); the rest waits.
        const call = callNow(blocks.current.list, now)
        // Your body and your day's edges (phase 2): never during a call or a focus timer.
        const busy = !!running || !!call
        const logs = sleep?.recentLogs ?? []
        const target = sleep?.todayLog?.bedTarget ?? logs.find((l) => l.bedTarget)?.bedTarget ?? '23:00'
        const wd = busy ? null : windDown(now, target, bedLoggedTonight(logs, new Date(now)))
        const wakeLogged = !!sleep?.todayLog && sleep.todayLog.createdAt.slice(0, 10) === sleep.today && sleep.todayLog.wakeTime !== '07:00'
        const first = get<{ day: string; at: number } | null>(FIRST, null)
        const firstBlock = blocks.current.list.filter((b) => b.end > now).sort((x, y) => x.start - y.start)[0] ?? null
        const body = { now, busy, idleSec, activeSince, water: { ml: localWater, target: status.today.waterTarget || 2700 }, lastWaterAt: get<number>(LAST_WATER, 0), lastMoveAt: get<number>(LAST_MOVE, 0), lastEyesAt: get<number>(LAST_EYES, 0), eyeBreaks: get<boolean>(EYES, false), dismissed }
        return (
          backAlert(running, now, dismissed) ??
          distractAlert(running, now, dismissed) ??
          bedAlert(dismissed, now, !!running) ??
          qualityAlert(dismissed, now) ??
          (() => {
            // A reward you can now afford: celebrate it (for 3 minutes, once).
            const r = rewardAlert({ balance: shop?.balance ?? 0, goal: goal ? { title: goal.title, price: goal.price } : null, celebrated: Object.keys(celebrated).filter((k) => now - celebrated[k] > 3 * 60_000), now, dismissed })
            if (r && !celebrated[r.id]) put(CELEBRATED, { ...celebrated, [r.id]: now })
            return r
          })() ??
          (() => {
            const c = get<{ text: string; at: number } | null>(CLIP, null)
            return c && !call ? clipAlert(c.text, c.at, dismissed, now) : null
          })() ??
          smart ??
          (running ? null : lateAlert(now, target, dismissed)) ??
          windDownAlert(wd, now, dismissed) ??
          (busy ? null : morningAlert({ now, firstActiveAt: first?.day === localDayOf(now) ? first.at : null, wakeLogged, firstBlock, dismissed })) ??
          moveAlert(body) ??
          waterAlert(body) ??
          eyesAlert(body) ??
          highlightAlert(highlight, now, dismissed) ??
          (call ? null : pick)
        )
      })(),
      call: (() => {
        const c = running ? null : callNow(blocks.current.list, now)
        return c ? { title: c.title, end: c.end } : null
      })(),
      autoFocus: get<boolean>(AUTO, false),
      eyeBreaks: get<boolean>(EYES, false),
      tasks: todoCache.list,
      streak,
      dayPct: live.score,
      windDown: (() => {
        const logs = sleep?.recentLogs ?? []
        const target = sleep?.todayLog?.bedTarget ?? logs.find((l) => l.bedTarget)?.bedTarget ?? '23:00'
        return windDown(now, target, bedLoggedTonight(logs, new Date(now)))
      })(),
      focusGuard: (() => {
        const gg = get<Guard | null>(GUARD, null)
        if (!running || !gg || gg.startedAt !== running.startedAt) return null
        return { pct: focusQualityPc((now - gg.startedAt) / 1000, gg.idle, gg.distract ?? 0), idleMin: Math.round((gg.idle + (gg.distract ?? 0)) / 60) }
      })(),
      sleep: (() => {
        const d = new Date(now)
        const logs = sleep?.recentLogs ?? []
        const target = sleep?.todayLog?.bedTarget ?? logs.find((l) => l.bedTarget)?.bedTarget ?? '23:00'
        const wakeLogged = !!sleep?.todayLog && sleep.todayLog.createdAt.slice(0, 10) === sleep.today && sleep.todayLog.wakeTime !== '07:00'
        return { bed: showBedButton(d, target, bedLoggedTonight(logs, d)), wake: showWakeButton(d, wakeLogged), target }
      })(),
      points: (() => {
        if (!shop) return undefined
        const rewards = shop.rewards.filter((r) => !r.archived && r.price > 0)
        const goal = rewards.find((r) => r.pinned) ?? [...rewards].sort((a, b) => a.price - b.price).find((r) => r.price > shop.balance) ?? null
        return { balance: shop.balance, goal: goal ? { title: goal.title, price: goal.price } : null }
      })()
    }
  }, [])

  const send = useCallback(async () => {
    if (!desk?.islandState) return
    try {
      last.current = await build()
    } catch {
      last.current = { ...last.current, at: Date.now(), locked: true }
    }
    desk.islandState(last.current)
  }, [build, desk])

  const act = useCallback(
    async (a: IslandAction) => {
      let error: string | null = null
      let said: string | null = null
      try {
        // Locked (PIN) or still loading: say so instead of doing nothing.
        if (last.current.locked && a.kind !== 'open' && a.kind !== 'dismiss') throw new Error('Life System is locked: open it and enter your PIN')
        switch (a.kind) {
          case 'water': {
            put(LAST_WATER, Date.now())
            // The one shared water path (water.ts, N9): the shared log, then this
            // device's copy set to its answer (never added twice), and every screen told.
            await addWater(a.ml)
            break
          }
          case 'reps': {
            updateSport((d) => {
              const ex = findExercise(d, a.id) ?? findExercise(d, a.name)
              if (ex) ex.doneToday = (Number(ex.doneToday) || 0) + a.n
            })
            await life.body.logWorkout({ title: `${a.name} (+${a.n})`, items: [{ exerciseId: a.id, name: a.name, amount: a.n, unit: 'reps' as any }], note: 'Logged from the desktop island' })
            window.dispatchEvent(new CustomEvent('life-body-changed'))
            break
          }
          case 'mustdo':
            await life.focus.togglePlan(a.i)
            break
          case 'start':
            await life.focus.start(a.subject, a.minutes, null)
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          case 'stop':
            await life.focus.stop()
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          case 'extend':
            await life.focus.extend?.(a.minutes)
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          case 'dismiss': {
            const d = get<Record<string, number>>(DISMISSED, {})
            const now = Date.now()
            for (const k of Object.keys(d)) if (d[k] < now) delete d[k]
            d[a.id] = a.snoozeMin ? now + a.snoozeMin * 60000 : now + 7 * 864e5
            put(DISMISSED, d)
            // Seeing Ben's message counts as read.
            if (a.id.startsWith('ben:')) put(SEEN, Math.max(get<number>(SEEN, 0), Date.parse(a.id.slice(4)) || now))
            if (a.id.startsWith('eyes:')) put(LAST_EYES, now)
            break
          }
          case 'bed': {
            const r = await life.sleep.logBed(a.time)
            window.dispatchEvent(new CustomEvent('life-sleep-changed'))
            if (!a.time) put(BED_AUTO, null)
            void r
            break
          }
          case 'push': {
            const b = a.block
            if (!b.id || !b.calendarId || !life.google?.move) throw new Error('Only blocks from Google Calendar can be moved')
            await life.google.move(b.calendarId, b.id, new Date(b.start + a.minutes * 60000).toISOString(), new Date(b.end + a.minutes * 60000).toISOString())
            blocks.current = { at: 0, list: blocks.current.list }
            const d = get<Record<string, number>>(DISMISSED, {})
            d[`drift:${blockKey(b)}`] = Date.now() + 15 * 60000
            put(DISMISSED, d)
            window.dispatchEvent(new CustomEvent('life-external-changed'))
            break
          }
          case 'blockResult': {
            const k = blockKey(a.block)
            put(ANSWERED, { ...Object.fromEntries(Object.entries(get<Record<string, string>>(ANSWERED, {})).slice(-60)), [k]: a.result })
            const d = get<Record<string, number>>(DISMISSED, {})
            d[a.alertId] = Date.now() + 7 * 864e5
            put(DISMISSED, d)
            const day = localDayOf(a.block.start)
            await life.dayLog?.addBlock(day, { at: new Date().toISOString(), title: a.block.title, result: a.result }).catch(() => {})
            if (a.block.id) await life.timeline?.mark(day, a.block.id, a.result === 'no' ? 'skip' : 'done').catch(() => {})
            break
          }
          case 'autoFocus':
            put(AUTO, a.on)
            break
          case 'pcWork': {
            // P3: "It's for this": this app is work from now on (your list in Settings → Ben on this PC).
            const cur = await window.desktop?.pcGetPrefs?.()
            if (cur) await window.desktop!.pcSetPrefs!({ work: [...cur.prefs.work, a.app.toLowerCase()] })
            put(PC_SNOOZE, Date.now() + 30 * 60_000)
            const d = get<Record<string, number>>(DISMISSED, {})
            d[a.alertId] = Date.now() + 864e5
            put(DISMISSED, d)
            said = `✓ ${a.app} counts as work now`
            break
          }
          case 'lockPc': {
            const d = get<Record<string, number>>(DISMISSED, {})
            d[a.alertId] = Date.now() + 864e5
            put(DISMISSED, d)
            put(LAST_MOVE, Date.now())
            if (!(await window.desktop?.pcLock?.())) throw new Error('Locking works on Windows only')
            break
          }
          case 'eyeBreaks':
            put(EYES, a.on)
            break
          case 'moveBreak': {
            // Into Sport Track's checklist when it has that exercise, and the workout log.
            let id = a.name.toLowerCase()
            updateSport((d) => {
              const ex = findExercise(d, a.name)
              if (ex) {
                ex.doneToday = (Number(ex.doneToday) || 0) + a.n
                id = String(ex.id)
              }
            })
            await life.body.logWorkout({ title: `${a.name} (+${a.n}) · movement break`, items: [{ exerciseId: id, name: a.name, amount: a.n, unit: 'reps' as any }], note: 'From the island' })
            window.dispatchEvent(new CustomEvent('life-body-changed'))
            put(LAST_MOVE, Date.now())
            activeSince = Date.now()
            const d = get<Record<string, number>>(DISMISSED, {})
            d[a.alertId] = Date.now() + 864e5
            put(DISMISSED, d)
            break
          }
          case 'todoDone': {
            try {
              await life.todoist!.complete({ id: a.id, content: a.content, priority: 1, due: null, dueTime: null, project: null, recurring: false } as any)
            } catch (e) {
              // The list may be stale (a task done elsewhere): fetch it fresh next time.
              todoCache.at = 0
              throw e
            }
            todoCache = { at: 0, list: todoCache.list.filter((t) => t.id !== a.id) }
            window.dispatchEvent(new CustomEvent('life-external-changed'))
            said = `✓ ${a.content}`
            break
          }
          case 'clipSave': {
            const d = get<Record<string, number>>(DISMISSED, {})
            d[a.alertId] = Date.now() + 864e5
            put(DISMISSED, d)
            if (a.to === 'task') {
              const t = await life.todoist!.quickAdd(a.text)
              todoCache.at = 0
              said = `➕ Todoist: ${t?.content ?? a.text}${t?.due ? ` (${t.due})` : ''}`
            } else {
              // Into the notebook's Inbox note (made if needed), with today's date.
              const notes = await life.notes!.list()
              const inbox = notes.find((n) => n.title.toLowerCase() === 'inbox')
              const line = `- ${a.text} _(${localDayOf(Date.now())})_`
              await life.notes!.save(inbox ? { id: inbox.id, title: inbox.title, body: `${inbox.body.replace(/\s*$/, '')}\n${line}\n` } : { title: 'Inbox', body: `# Inbox\n\nThings you saved from the island.\n\n${line}\n` })
              said = '📓 Saved in Notebook → Inbox'
            }
            break
          }
          case 'book': {
            // A task dropped on the island: the next free slot today, in your calendar.
            const text = a.text.trim().split('\n')[0].slice(0, 120)
            if (!text) throw new Error('Nothing to book')
            const minutes = taskMinutes(text)
            const slot = nextFreeSlot(blocks.current.list, Date.now(), minutes)
            const on = !!(await life.google?.status().catch(() => null))?.connected
            if (!slot || !on) {
              await life.todoist!.quickAdd(`${text} today`)
              said = slot ? `➕ Todoist: ${text} (today) · connect Google Calendar to book times` : `➕ Todoist: ${text} (today) · no free slot left today`
              break
            }
            await life.google!.create({ title: text.replace(/\s*\d{1,3}\s*(?:m|min|mins|minutes|h|hr|hours?)\b/i, '').trim() || text, start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), description: 'Booked from the island' })
            blocks.current = { at: 0, list: blocks.current.list }
            window.dispatchEvent(new CustomEvent('life-external-changed'))
            const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5)
            said = `📅 Booked ${hhmm(slot.start)}–${hhmm(slot.end)}: ${text}`
            break
          }
          case 'voice': {
            if (!life.coach) throw new Error('Ben is not available here')
            if (busy.current.on) throw new Error('Ben is still answering your last message')
            busy.current = { on: true, steps: ['Listening to your voice note'] }
            void send()
            try {
              const r = await life.coach.chat('', (st) => {
                if (!busy.current.steps.includes(st)) busy.current.steps = [...busy.current.steps, st]
                void send()
              }, { mime: a.mime, data: a.data })
              said = r.reply.replace(/<[^>]+>/g, '').slice(0, 140)
            } finally {
              busy.current = { on: false, steps: [] }
              put(SEEN, Date.now())
            }
            break
          }
          case 'closeDay':
            window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'today' }))
            setTimeout(() => window.dispatchEvent(new CustomEvent('life-close-day')), 600)
            break
          case 'wake':
            await life.sleep.logWake(a.time)
            window.dispatchEvent(new CustomEvent('life-sleep-changed'))
            break
          case 'open':
            if (a.page === 'coach') put(SEEN, Date.now())
            if (a.page) window.dispatchEvent(new CustomEvent('life-open-page', { detail: a.page }))
            break
          case 'chat': {
            // The command bar: "focus 50 algebra" starts a timer; the rules do
            // money, water, reps, sleep (free, instant); only the rest goes to Ben.
            // Everything but Ben's answer goes through the one capture pipeline (capture.ts).
            const c = parseCapture(a.text)
            if (c && c.kind !== 'free') {
              said = (await capture(a.text)).said
              break
            }
            const q = await life.coach?.quick?.(a.text.trim()).catch(() => null)
            if (q && !('unknown' in q)) {
              if (!q.ok) throw new Error(q.reply.replace(/^⚠️\s*/, ''))
              said = q.reply.split('\n').slice(0, 3).join(' · ').slice(0, 140)
              window.dispatchEvent(new CustomEvent('life-body-changed'))
              window.dispatchEvent(new CustomEvent('life-external-changed'))
              break
            }
            if (!life.coach) throw new Error('Ben is not available here')
            // P16: no internet: it waits and goes to Ben when you're back online.
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
              put(OUTBOX, [...get<string[]>(OUTBOX, []), a.text].slice(-10))
              said = "📴 Offline: Ben will answer when you're back online"
              break
            }
            if (busy.current.on) throw new Error('Ben is still answering your last message')
            busy.current = { on: true, steps: [] }
            void send()
            try {
              await life.coach.chat(a.text, (st) => {
                if (!busy.current.steps.includes(st)) busy.current.steps = [...busy.current.steps, st]
                void send()
              })
            } finally {
              busy.current = { on: false, steps: [] }
              put(SEEN, Date.now())
            }
            break
          }
        }
      } catch (e) {
        error = (e as Error)?.message || 'It did not work'
      }
      // The island shows ✓ or the reason; the log (Settings → Island log) keeps it.
      if (a.id) desk?.islandAck?.({ id: a.id, ok: !error, ...(error ? { error } : {}), ...(said ? { text: said } : {}) })
      logIsland({ at: new Date().toISOString(), kind: a.kind, ok: !error, error: error ?? undefined })
      if (error) void life.system?.logError('island', `${a.kind}: ${error}`).catch(() => {})
      await send()
    },
    [send]
  )

  const sendRef = useRef(send)
  sendRef.current = send
  const actRef = useRef(act)
  actRef.current = act
  useEffect(() => {
    if (!desk?.islandState) return
    // IPC listeners can't be removed through the bridge: add them once per window.
    if (!listening) {
      listening = true
      desk.onIslandAction?.((a) => void actRef.current(a))
      desk.onNavigate?.((page) => window.dispatchEvent(new CustomEvent('life-open-page', { detail: page })))
      // Back after a night away from the PC: that's when you went to bed.
      desk.onAway?.((w) => void onAway(w).then(() => void sendRef.current()))
      // Copied a dated thing: offer to save it (island phase 3).
      desk.onClip?.((t) => {
        const text = clipWorthSaving(t)
        if (!text) return
        put(CLIP, { text, at: Date.now() })
        void sendRef.current()
      })
      // Ben on this PC: the app in front (P2/P3/P7), lock/unlock (P6), taskbar shortcuts (P17), block buttons (P12).
      desk.onPcApp?.((a) => {
        const before = pcNow?.kind
        pcSample(a)
        if (before !== pcNow?.kind) void sendRef.current()
      })
      desk.onLock?.((l) => {
        if (l.locked) lockedAt = l.at
        else if (lockedAt) {
          put(BACK, { at: l.at, away: Math.round((l.at - lockedAt) / 60000) })
          lockedAt = null
          void sendRef.current()
        }
      })
      desk.onJump?.((j) => {
        if (j === 'focus25') void actRef.current({ kind: 'start', subject: 'Focus', minutes: 25 })
      })
      desk.onNotifAction?.((n) => {
        if (!n.id.startsWith('block:')) return
        const [, title = 'Focus', mins = '25'] = n.id.slice(6).split('|')
        const subject = decodeURIComponent(title)
        if (n.action === 'start' || n.action === 'open') void actRef.current({ kind: 'start', subject, minutes: Math.max(5, Math.min(180, Number(mins) || 25)) })
        else if (n.action === 'later5')
          setTimeout(() => {
            void window.desktop?.notify?.({ id: n.id, title: `▶ ${subject}`, body: 'Ready now?', actions: [{ id: 'start', label: '▶ Start' }, { id: 'skip', label: 'Skip' }] })
          }, 5 * 60_000)
      })
      // P16: back online: what you typed offline goes to Ben, one by one.
      window.addEventListener('online', () => {
        const list = get<string[]>(OUTBOX, [])
        if (!list.length) return
        put(OUTBOX, [])
        void (async () => {
          for (const t of list) await actRef.current({ kind: 'chat', text: t })
        })()
      })
      // Every 15 s from the desktop: how long since your last mouse/keys.
      desk.onIdle?.((sec) => {
        const before = idleSec
        guardTick(sec)
        bodyTick(sec)
        // Crossing the drift line (or coming back) updates the island at once.
        if (before == null || (before < 480) !== (sec < 480)) void sendRef.current()
      })
    }
    void send()
    const t = setInterval(() => void send(), 15_000)
    const on = () => void send()
    window.addEventListener('life-focus-changed', on)
    window.addEventListener('life-sport-changed', on)
    return () => {
      clearInterval(t)
      window.removeEventListener('life-focus-changed', on)
      window.removeEventListener('life-sport-changed', on)
    }
  }, [act, desk, send])
  useLive(() => void send())
  return null
}
