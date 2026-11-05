// Desktop only: the app window (it keeps running hidden in the tray) feeds the
// desktop island its snapshot and does what the island's buttons ask. The
// island window itself never opens your data, so there is one owner of it.
import { focusQualityPc, lateNight } from '@core/pcActivity'
import { useCallback, useEffect, useRef } from 'react'
import { MOOD_FACE, type Mood } from '@core/coachKit'
import { EMPTY_ISLAND, blocksFromPlan, nowNext, pickAlert, type IslandAction, type IslandAlert, type IslandBlock, type IslandSnapshot } from '@core/islandModel'
import { bedFromAway, bedLoggedTonight, showBedButton, showWakeButton } from '@core/bedSense'
import { autoStartBlock, blockKey, callNow, focusQuality, GUARD_IDLE_SEC, smartAlert } from '@core/islandSmart'
import { morningAlert, waterAlert, windDown, windDownAlert } from '@core/islandBody'
import { nudgeAct, nudgeIdle, nudgeTick, nudgeWater, nudgeYes } from './islandNudgesFeed'
import { clipAlert, clipWorthSaving, nextFreeSlot, taskMinutes } from '@core/islandActions'
import { dayHighlight, highlightAlert, rewardAlert } from '@core/islandFeel'
import { liveScore } from '@core/liveScore'
import { recapAlert } from '@core/islandMoments'
import { isDeclined, isInvite, isMarker, isRealMeeting, isTentative } from '@core/calResponse'
import type { TodoTask } from '@core/todoist'
import { currentSession, sessionValid } from './web/session'
import { life } from './bridge'
import { startVoiceAskHost } from './voice/voiceAsk'
import { capture } from './capture'
import { parseCapture } from '@core/capture'
import { useLive } from './live'
import { logIsland } from './islandLog'
import { snapshotKey } from '@core/islandClicks'
import { startIslandThemeSync } from './islandTheme'
import { todoistErrorText } from '@core/islandErrors'
import { addWater } from './water'
import { findExercise, readSport, updateSport } from './sportTrack'
import { calendarDay } from '@core/dates'
import { WATER_TARGET_ML } from '@core/defaults'
import { preferSlot, workHours } from '@core/bestHours'
import { doingForBreaks, doingNow, noteAway, realityOf, refresh as refreshSmart, shareGoalWords, smartAct, smartNotice, smartOn, smartSuggestion, smartTick, startSmart } from './smartIsland'
import { breakOverAlert, controlAct, flowTick, islandRunning, loadBreakPref, mustdoUndo, rememberUndo } from './islandControlsFeed'
import { pcAskAct, pcAskAlert, pcAutoTick } from './pcAutomation'
import { kitAct, kitForIsland } from './islandKitFeed'
import { weatherAlert, widgetsForIsland } from './widgets/widgetsFeed'
import { MOVE_CARD_EVENT, moveCardAlert } from '@core/islandMoveCard'

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
/** IS19: the list, when it was last fetched fine, whether the last try failed, and the real tasks (completing passes those). */
let todoCache: { at: number; okAt: number; failed: boolean; list: { id: string; content: string; time: string | null }[]; full: Record<string, TodoTask> } = { at: 0, okAt: 0, failed: false, list: [], full: {} }
/** MF11: today's money left (Finance Helper), read at most once a minute or when money changes. */
let moneyCache: { at: number; v: { left: number; level: string } | null } = { at: 0, v: null }
if (typeof window !== 'undefined') window.addEventListener('life-money-changed', () => (moneyCache.at = 0))
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
  return calendarDay(d)
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
/** IN36: a recipe asked to show the move-break card (the island shows it; you confirm what you did). */
let moveAsk: { at: number; why: string } | null = null
if (typeof window !== 'undefined') {
  window.addEventListener(MOVE_CARD_EVENT, (e) => {
    const d = (e as CustomEvent).detail ?? {}
    moveAsk = { at: Number(d.at) || Date.now(), why: String(d.why ?? '').slice(0, 60) }
    window.dispatchEvent(new Event('life-island-refresh'))
  })
}
/** MC10: drifted 2+ minutes in distracting apps during focus: one word, once per session. */
const DRIFT = 'ls.pcDrift'
function driftAlert(running: { subject: string; startedAt: number } | null, now: number, dismissed: Record<string, number>): IslandAlert | null {
  const d = get<{ startedAt: number; label: string; subject: string; minutes: number; at: number } | null>(DRIFT, null)
  if (!running || !d || d.startedAt !== running.startedAt || now - d.at > 5 * 60_000) return null
  const id = `drift:${d.startedAt}`
  if ((dismissed[id] ?? 0) > now) return null
  return {
    id,
    kind: 'distract',
    title: `${d.minutes} min on ${d.label}`,
    text: `You're drifting from ${running.subject}. Back to it?`,
    face: '👀',
    actions: [
      { label: '↩ Back to it', action: { kind: 'dismiss', id, snoozeMin: 60 * 24 }, primary: true },
      { label: "It's for this", action: { kind: 'pcWork', app: d.label, alertId: id } },
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
  const idlePct = focusQuality(elapsed, g.idle)
  const idleMin = Math.round(g.idle / 60)
  // MC10: what was on screen (work vs distracting apps, sampled every 30 s by the desktop).
  const apps = await window.desktop?.pcFocusApps?.(g.startedAt).catch(() => null)
  const appsPct = apps?.pct ?? null
  const pct = appsPct == null ? idlePct : Math.min(idlePct, focusQualityPc(elapsed, g.idle, (apps!.distractMin ?? 0) * 60))
  put(QUALITY, { id: `q:${g.startedAt}`, pct, idleMin, subject: g.subject, at: Date.now(), ...(apps && appsPct != null ? { workMin: apps.workMin, distractMin: apps.distractMin } : {}) })
  // Ben gets the app totals only if you share them (Settings → Ben on this PC).
  const share = appsPct != null && !!(await window.desktop?.pcGetPrefs?.().catch(() => null))?.prefs.shareTotals
  await life.dayLog
    ?.addFocus(localDayOf(g.startedAt), { at: new Date(g.startedAt).toISOString(), subject: g.subject, minutes: Math.round(elapsed / 60), pct: share ? pct : idlePct, ...(share ? { workMin: apps!.workMin, distractMin: apps!.distractMin } : {}) })
    .catch(() => {})
}

function qualityAlert(dismissed: Record<string, number>, now: number): IslandAlert | null {
  const q = get<{ id: string; pct: number; idleMin: number; subject: string; at: number; workMin?: number; distractMin?: number } | null>(QUALITY, null)
  if (!q || now - q.at > 30 * 60_000 || (dismissed[q.id] ?? 0) > now) return null
  const apps = q.distractMin != null ? ` · work apps ${q.workMin ?? 0} min, distracting ${q.distractMin} min` : ''
  return {
    id: q.id,
    kind: 'quality',
    title: `Focus done · focus quality ${q.pct}%`,
    text: q.pct >= 85 ? `${q.subject}: you were there the whole time. 🔥${apps}` : q.distractMin ? `${q.subject}: ${q.distractMin} min in distracting apps${q.idleMin ? `, away ${q.idleMin} min` : ''}. Next one: close them first?` : `${q.subject}: away ${q.idleMin} min of it. Next one: phone in another room?`,
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

/** Today's calendar as island blocks (IS6): what you said yes to, plus "maybe"s and unanswered invites marked as such. */
async function todayBlocks(): Promise<IslandBlock[]> {
  const d = new Date()
  const day = calendarDay(d)
  const on = !!(await life.google?.status().catch(() => null))?.connected
  if (on) {
    const events = await life.google!.events(new Date(`${day}T00:00:00`).toISOString(), new Date(`${day}T23:59:59`).toISOString()).catch(() => [])
    // Declined, "free" and marker events (working location, out of office) don't count;
    // a call link or other people make it a meeting (Q4, IS11); a maybe or an unanswered invite is greyed (IS6).
    const blocks = events
      .filter((e) => !e.allDay && !isDeclined(e) && !e.free && !isMarker(e))
      .map((e): IslandBlock => ({ title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), id: e.id, calendarId: e.calendarId, call: isRealMeeting(e), meet: e.meet ?? null, ...(isInvite(e) ? { maybe: 'invite' as const } : isTentative(e) ? { maybe: 'tentative' as const } : {}) }))
      .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end))
    if (blocks.length) return blocks
  }
  const rh = await life.coach?.rhythm?.('state').catch(() => null)
  const plan = rh?.state?.briefing?.plan?.blocks ?? []
  return blocksFromPlan(plan, d)
}

let listening = false
/** IC14: your evening review time (Ben's rhythm), checked every 10 minutes. */
let evening = { at: 0, hm: '21:00' }
async function eveningAt(now: number): Promise<string> {
  if (now - evening.at > 10 * 60_000) {
    evening.at = now
    const rh = await life.coach?.rhythm?.('state').catch(() => null)
    if (rh?.prefs?.evening) evening.hm = rh.prefs.evening
  }
  return evening.hm
}

export { ISLAND_LOG, type IslandLogEntry } from './islandLog'

/** Logs the bedtime by itself (once a night), and leaves a note for the island. */
async function onAway(w: { from: string; to: string }): Promise<void> {
  // SI20: with Smart island suggestions on, it asks in the morning instead (logged only on your tap).
  if (noteAway(w)) return
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
  // JV2: what you say to the island's voice goes to Ben from here (the app window).
  useEffect(() => startVoiceAskHost(), [])
  const desk = window.desktop
  const busy = useRef<{ on: boolean; steps: string[] }>({ on: false, steps: [] })
  const last = useRef<IslandSnapshot>(EMPTY_ISLAND)
  // list: what you said yes to (Now, alerts, auto-start); maybe: greyed "maybe"s and invites (IS6).
  const blocks = useRef<{ at: number; list: IslandBlock[]; maybe: IslandBlock[] }>({ at: 0, list: [], maybe: [] })
  const breakPrefAt = useRef(0)

  const build = useCallback(async (): Promise<IslandSnapshot> => {
    const now = Date.now()
    if (!life.coach?.status) return { ...EMPTY_ISLAND, at: now }
    const body = await life.body.state().catch(() => null)
    const [status, focus, log, sleep, shop] = await Promise.all([life.coach.status(), life.focus.state(), life.coach.log().catch(() => []), life.sleep.state().catch(() => null), life.shop?.state().catch(() => null) ?? Promise.resolve(null)])
    if (now - blocks.current.at > 60_000) {
      const all = await todayBlocks().catch(() => null)
      if (all) blocks.current = { at: now, list: all.filter((b) => !b.maybe), maybe: all.filter((b) => !!b.maybe) }
      else blocks.current = { ...blocks.current, at: now - 45_000 }
    }
    // IC11: a flow timer that is up hands off to its break; a break that is over may start the next block.
    if (now - breakPrefAt.current > 60_000) {
      breakPrefAt.current = now
      void loadBreakPref()
    }
    const flowed = await flowTick({ run: focus.running, now, idleSec, blocks: blocks.current.list, autoFocus: get<boolean>(AUTO, false) }).catch(() => null)
    const run = flowed ? (await life.focus.state()).running : focus.running
    // IC1: paused timers keep their time left; a break shows as the timer (never a focus session).
    let running = islandRunning(run, now)
    // Focus guard: start watching a new session; a finished one gets its quality.
    const g = get<Guard | null>(GUARD, null)
    if (g && (!running || running.brk || running.startedAt !== g.startedAt)) await finishGuard(g)
    if (running && !running.brk && (!g || g.startedAt !== running.startedAt)) put(GUARD, { startedAt: running.startedAt, endsAt: running.endsAt, subject: running.subject, idle: 0, last: now })
    // Auto-start (if you turned it on): a work block begins → its focus timer starts.
    if (get<boolean>(AUTO, false)) {
      const started = get<Record<string, true>>(AUTO_DONE, {})
      const b = autoStartBlock(blocks.current.list, now, !!run, started)
      if (b) {
        put(AUTO_DONE, { ...Object.fromEntries(Object.entries(started).slice(-40)), [blockKey(b)]: true })
        const minutes = Math.max(5, Math.min(180, Math.round((b.end - now) / 60000)))
        const f = await life.focus.start(b.title, minutes, null).catch(() => null)
        if (f?.running) {
          running = islandRunning(f.running, now)!
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
      // MC11: minutes on listed sites from the browser history, one line for the evening review (only with that switch on).
      void (async () => {
        const w = await window.desktop!.pcBrowserMinutes?.().catch(() => null)
        const line = [w?.line, w?.todayLine].filter(Boolean).join('; ')
        if (line) await life.dayLog?.setWeb?.(localDayOf(now), line).catch(() => {})
      })()
      // SI8/SI22: the day by kind of doing ("coding 3h10, study 1h05") and minutes per hour, only if you share totals.
      void (async () => {
        const p = await window.desktop!.pcGetPrefs!().catch(() => null)
        if (!p?.prefs.shareTotals || !p.prefs.smart) return
        const d = await window.desktop!.pcDoing?.().catch(() => null)
        if (d?.line) await life.dayLog?.setDoing?.(localDayOf(now), d.line, d.hours).catch(() => {})
      })()
    }
    // Smart island: switches and recipes (once a minute), focus/blocks/meetings into the stream, your goal words to the desktop.
    await refreshSmart().catch(() => {})
    // PC & automation: Ben's asks for this PC, the last hour for Ben (each on its own slow clock).
    await pcAutoTick(now).catch(() => {})
    smartTick({ now, running, blocks: blocks.current.list })
    if (smartOn()) shareGoalWords([...focus.goals.flatMap((g) => [g.title, g.subject]), ...(focus.subjects ?? [])])
    // Focus state for the PC (P19 site blocker, P20 holding notifications).
    // A break (IC11) is not focus: sites aren't blocked during it.
    const focusRun = running && !running.brk ? running : null
    window.desktop?.pcFocus?.({ running: !!focusRun, subject: focusRun?.subject ?? '', endsAt: focusRun?.endsAt ?? 0, startedAt: focusRun?.startedAt ?? 0 })
    const seen = get<number>(SEEN, 0) || now
    const faceOf = (m?: string) => (m && MOOD_FACE[m as Mood]) || status.face
    const coach = log.filter((e) => e.role === 'coach')
    const newest = coach[coach.length - 1]
    const unread = coach.filter((e) => e.via !== 'app' && e.via !== 'mcp' && Date.parse(e.at) > seen).length
    const sport = readSport()
    const reps = (Array.isArray(sport?.exercises) ? sport.exercises : [])
      .filter((e: any) => !e.archived && Number(e.target) > 0)
      .slice(0, 3)
      .map((e: any) => ({ id: String(e.id ?? e.name), name: String(e.name), done: Number(e.doneToday) || 0, target: Number(e.target) || 0 }))
    // This device's Sport Track copy is the synced truth here (a −250 must show, not the higher of two copies: N1).
    const localWater = sport?.water ? Number(sport.water.currentMl) || 0 : status.today.waterMl
    const { now: cur, next } = nowNext(blocks.current.list, now)
    const dismissed = get<Record<string, number>>(DISMISSED, {})
    // Phase 4: the reward you're working toward, today's ring and highlight.
    const rewards = (shop?.rewards ?? []).filter((r) => !r.archived && r.price > 0)
    const goal = shop ? rewards.find((r) => r.pinned) ?? [...rewards].sort((a, b) => a.price - b.price).find((r) => r.price > shop.balance) ?? [...rewards].sort((a, b) => a.price - b.price)[0] ?? null : null
    const todayKey = localDayOf(now)
    const live = liveScore({ mustDone: status.today.mustDone, openMustDos: status.mustdos.filter((x) => !x.done).map((x) => x.text), focusMin: status.today.focusMin, focusGoal: Math.max(50, status.goals.reduce((t, g) => t + g.perDayMin, 0)), waterMl: status.today.waterMl, waterTarget: status.today.waterTarget, workoutDone: !!status.today.workoutDone })
    const highlight = dayHighlight({ focusMin: status.today.focusMin, focusBefore: status.week.filter((d) => d.day < todayKey).map((d) => d.min), mustDone: status.today.mustDone, mustTotal: status.today.mustTotal, waterMl: status.today.waterMl, waterTarget: status.today.waterTarget, workoutDone: !!status.today.workoutDone, sportStreak: body?.streak ?? 0 })
    const celebrated = get<Record<string, number>>(CELEBRATED, {})
    // IC5, IC14: today's focus against its goal (the Today ring, the evening story).
    const focusGoal = Math.max(50, status.goals.reduce((t, g) => t + g.perDayMin, 0))
    const evAt = await eveningAt(now)
    const sportStreak = body?.streak ?? 0
    // IS19: a failed fetch keeps the old list marked stale and tries again soon.
    // CL2: fresh every 5 minutes (it was every minute); ticking a task off refreshes it at once.
    if (now - todoCache.at > (todoCache.failed ? 60_000 : 5 * 60_000) && life.todoist?.today) {
      todoCache.at = now
      const list = await life.todoist.today().catch(() => null)
      if (list) {
        const top = list.slice(0, 3)
        todoCache = { at: now, okAt: now, failed: false, list: top.map((t) => ({ id: t.id, content: t.content, time: t.dueTime ?? null })), full: Object.fromEntries(top.map((t) => [t.id, t])) }
      } else todoCache.failed = true
    }
    if (now - moneyCache.at > 60_000 && life.finance) {
      moneyCache.at = now
      const h = await life.finance.hub().catch(() => null)
      moneyCache.v = h && h.hero.perDay > 0 ? { left: h.hero.leftToday, level: h.hero.dayLevel } : null
    }
    // Island 2: the nudge cards (move breaks, eyes, mood, people…), the movement ring and the challenge.
    const callOn = callNow(blocks.current.list, now)
    const nudges = await nudgeTick({ now, busy: !!running || !!callOn, call: !!callOn, idleSec, activeSince, running: focusRun, blockEnd: cur && !cur.call ? cur.end : null, meetingEnd: callOn?.end ?? (next?.call && next.start - now < 15 * 60_000 ? next.end : null), dismissed, eyeBreaks: get<boolean>(EYES, false), doing: doingForBreaks(now) }).catch(() => ({ early: null, body: null, move: null }))
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
      // IS6: later today, a maybe or an invite (greyed in the Next list).
      maybe: blocks.current.maybe.filter((b) => b.end > now).sort((x, y) => x.start - y.start).slice(0, 3),
      mustdos: status.mustdos,
      water: { ml: localWater, target: status.today.waterTarget || Number(sport?.water?.targetMl) || WATER_TARGET_ML },
      reps,
      alert: (() => {
        // Paused: its time is never up (the end moves on with the pause).
        const pick = pickAlert({ now, running: focusRun?.pausedAt ? { ...focusRun, endsAt: focusRun.endsAt + now - focusRun.pausedAt } : focusRun, blocks: blocks.current.list, log: log.map((e) => ({ ...e, face: faceOf(e.mood) })), seenBen: seen, dismissed })
        if (pick?.kind === 'over') return pick
        const answered = get<Record<string, string>>(ANSWERED, {})
        const smart = smartAlert({ now, blocks: blocks.current.list, running: !!running, idleSec, dismissed, answered, reality: realityOf })
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
        const body = { now, busy, idleSec, activeSince, water: { ml: localWater, target: status.today.waterTarget || WATER_TARGET_ML }, lastWaterAt: get<number>(LAST_WATER, 0), lastMoveAt: get<number>(LAST_MOVE, 0), lastEyesAt: get<number>(LAST_EYES, 0), eyeBreaks: get<boolean>(EYES, false), dismissed, doing: doingForBreaks(now) }
        // Smart island: one suggestion at a time (budget, cooldowns, learning), recipes asking first, the fix-it picker.
        const suggestion = () => {
          if (call) return null
          const last = [...(focus.todaySessions ?? [])].filter((x) => x.endedAt).sort((x, y) => Date.parse(y.endedAt!) - Date.parse(x.endedAt!))[0]
          const unfinished = blocks.current.list.filter((b) => !b.call && !b.maybe && b.start < now && b.end - b.start >= 15 * 60_000 && !answered[blockKey(b)])
          const sg = smartSuggestion({ now, blocks: blocks.current.list, running: !!running, mustdos: status.mustdos, goals: focus.goals.flatMap((g) => [g.title, g.subject]), windDown: wd, last: last ? { subject: last.subject, endedAt: Date.parse(last.endedAt!) } : null, bedLogged: bedLoggedTonight(logs, new Date(now)), unfinished })
          return sg && (dismissed[sg.id] ?? 0) > now ? null : sg
        }
        return (
          pcAskAlert(now, dismissed) ??
          backAlert(focusRun, now, dismissed) ??
          driftAlert(focusRun, now, dismissed) ??
          distractAlert(focusRun, now, dismissed) ??
          bedAlert(dismissed, now, !!running) ??
          breakOverAlert(now, dismissed, !!run) ??
          qualityAlert(dismissed, now) ??
          nudges.early ??
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
          smartNotice(now) ??
          suggestion() ??
          (running ? null : lateAlert(now, target, dismissed)) ??
          windDownAlert(wd, now, dismissed) ??
          (busy ? null : morningAlert({ now, firstActiveAt: first?.day === localDayOf(now) ? first.at : null, wakeLogged, firstBlock, dismissed })) ??
          moveCardAlert(moveAsk, now, dismissed) ??
          // LF1 / LF2: rain in 30 minutes, the light going (weather plugin).
          (call ? null : weatherAlert(now, dismissed, busy)) ??
          nudges.body ??
          nudgeWater(waterAlert(body), now) ??
          (busy ? null : recapAlert({ now, eveningAt: evAt, dismissed, recap: { mustDone: status.today.mustDone, mustTotal: status.today.mustTotal, waterMl: localWater, waterTarget: status.today.waterTarget || WATER_TARGET_ML, focusMin: status.today.focusMin, focusGoal, streak: sportStreak || undefined } })) ??
          highlightAlert(highlight, now, dismissed) ??
          (call ? null : pick)
        )
      })(),
      call: (() => {
        const c = running ? null : callNow(blocks.current.list, now)
        return c ? { title: c.title, end: c.end } : null
      })(),
      inMeeting: !!callNow(blocks.current.list, now),
      doing: doingNow(),
      move: nudges.move,
      // Island 2: your tiles and buttons, today's blocks for the mini calendar, the music's focus pause.
      ...(await kitForIsland(blocks.current.list)),
      // PL1–PL8, LF1/LF2: your widgets and layout, today's rain and sunset.
      ...(await widgetsForIsland(now)),
      autoFocus: get<boolean>(AUTO, false),
      eyeBreaks: get<boolean>(EYES, false),
      tasks: todoCache.list,
      tasksAt: todoCache.okAt || undefined,
      tasksStale: todoCache.failed,
      dayPct: live.score,
      today: { focusMin: status.today.focusMin, focusGoal },
      // IM4: a new best streak is celebrated on the island.
      streak: body && body.streak > 0 ? { days: body.streak, kind: 'sport', atRisk: false, best: Number((body as { bestStreak?: number }).bestStreak) || body.streak } : null,
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
      money: moneyCache.v,
      points: (() => {
        if (!shop) return undefined
        const rewards = shop.rewards.filter((r) => !r.archived && r.price > 0)
        const goal = rewards.find((r) => r.pinned) ?? [...rewards].sort((a, b) => a.price - b.price).find((r) => r.price > shop.balance) ?? null
        return { balance: shop.balance, goal: goal ? { title: goal.title, price: goal.price } : null }
      })()
    }
  }, [])

  // IS16 / IC9: one build at a time, and at most one more waiting (the 15 s
  // tick, live updates, Ben's steps and taps all ask for one). A snapshot
  // that says nothing new isn't sent again: a tiny "still here" goes instead,
  // so the island doesn't say "Reconnecting…" (and the whole snapshot again
  // every 2 minutes, in case the island window reloaded).
  const running = useRef<Promise<void> | null>(null)
  const queued = useRef(false)
  const sent = useRef({ key: '', at: 0 })
  const sendOnce = useCallback(async () => {
    if (!desk?.islandState) return
    let snap: IslandSnapshot
    try {
      snap = await build()
    } catch {
      // IS4: a hiccup keeps the last good picture (marked stale); only a real
      // sign-out (no valid PIN session) shows "Open Life System".
      const gone = !sessionValid(currentSession())
      snap = gone ? { ...last.current, at: Date.now(), locked: true, stale: false } : { ...last.current, stale: true }
    }
    last.current = snap
    const key = snapshotKey(snap)
    const now = Date.now()
    if (key === sent.current.key && now - sent.current.at < 120_000) return desk.islandState({ beat: snap.at || now })
    sent.current = { key, at: now }
    desk.islandState(snap)
  }, [build, desk])
  const send = useCallback((): Promise<void> => {
    if (running.current) {
      queued.current = true
      return running.current
    }
    const run = async () => {
      do {
        queued.current = false
        await sendOnce()
      } while (queued.current)
    }
    running.current = run().finally(() => {
      running.current = null
    })
    return running.current
  }, [sendOnce])

  const act = useCallback(
    async (a: IslandAction) => {
      const t0 = Date.now()
      let error: string | null = null
      let said: string | null = null
      try {
        // Locked (PIN) or still loading: say so instead of doing nothing.
        // IS4: only when the PIN session is really gone (a hiccup is not a lock).
        if (last.current.locked && a.kind !== 'open' && a.kind !== 'dismiss' && a.kind !== 'join' && !sessionValid(currentSession())) throw new Error('Life System is locked: open it and enter your PIN')
        // IC1, IC6–IC8, IC10, IC11: pause, the wheel's end, rename, undo, drops, breaks and flow timers.
        // Island 2: nudge cards and move breaks (islandNudgesFeed.ts); undefined: not theirs.
        const nd = await nudgeAct(a, { moved: () => void (activeSince = Date.now()) })
        const ctl = nd !== undefined ? null : await controlAct(a, { blocks: blocks.current.list, findTask: (id) => todoCache.full[id] ?? null })
        if (nd !== undefined) said = nd
        else if (ctl != null) said = ctl || null
        else switch (a.kind) {
          case 'water': {
            put(LAST_WATER, Date.now())
            // The one shared water path (water.ts, N9): the shared log, then this
            // device's copy set to its answer (never added twice), and every screen told.
            await addWater(a.ml)
            rememberUndo(a.id, { kind: 'water', ml: a.ml })
            nudgeYes('water')
            break
          }
          case 'reps': {
            // The exercise's id (the tap's own id can take `id`'s place on the way).
            const exId = a.ex ?? a.id
            updateSport((d) => {
              const ex = findExercise(d, exId) ?? findExercise(d, a.name)
              if (ex) ex.doneToday = (Number(ex.doneToday) || 0) + a.n
            })
            const w = await life.body.logWorkout({ title: `${a.name} (+${a.n})`, items: [{ exerciseId: exId, name: a.name, amount: a.n, unit: 'reps' as any }], note: 'Logged from the desktop island' })
            rememberUndo(a.id, { kind: 'reps', ex: exId, name: a.name, n: a.n, workoutId: w?.workout?.id ?? null })
            window.dispatchEvent(new CustomEvent('life-body-changed'))
            break
          }
          case 'mustdo': {
            const t = Date.now()
            const r = await life.focus.togglePlan(a.i)
            rememberUndo(a.id, await mustdoUndo(a.i, r?.coins ?? 0, t))
            break
          }
          case 'start': {
            const st = await life.focus.start(a.subject, a.minutes, null)
            rememberUndo(a.id, st.running ? { kind: 'start', startedAt: st.running.startedAt } : null)
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          }
          case 'stop':
            await life.focus.stop()
            window.dispatchEvent(new Event('life-focus-changed'))
            break
          case 'extend':
            await life.focus.extend?.(a.minutes)
            rememberUndo(a.id, { kind: 'extend', minutes: a.minutes })
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
            blocks.current = { ...blocks.current, at: 0 }
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
          case 'pcAsk': {
            // AU7: Allow runs it (the desktop checks it again), Deny says no; the card goes either way.
            const d = get<Record<string, number>>(DISMISSED, {})
            d[a.alertId] = Date.now() + 864e5
            put(DISMISSED, d)
            said = await pcAskAct(a)
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
          case 'todoDone': {
            // IS19: the real task (its priority pays the points), never made-up fields.
            const task = todoCache.full[a.id]
            try {
              if (!task) throw new Error('not found')
              await life.todoist!.complete(task)
            } catch (e) {
              // The list may be stale (a task done elsewhere): fetch it fresh now.
              todoCache.at = 0
              throw new Error(todoistErrorText(e))
            }
            const { [a.id]: _done, ...full } = todoCache.full
            todoCache = { ...todoCache, at: 0, list: todoCache.list.filter((t) => t.id !== a.id), full }
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
            // SI22: with Smart island on, a free slot in one of your best work hours (from this PC's last week) comes first.
            const week = smartOn() ? (await window.desktop?.pcDoing?.().catch(() => null))?.week ?? [] : []
            const best = workHours(week.map((w) => w.hours))
            const slot = best.length ? preferSlot(blocks.current.list, Date.now(), minutes, best) : nextFreeSlot(blocks.current.list, Date.now(), minutes)
            const on = !!(await life.google?.status().catch(() => null))?.connected
            if (!slot || !on) {
              await life.todoist!.quickAdd(`${text} today`)
              said = slot ? `➕ Todoist: ${text} (today) · connect Google Calendar to book times` : `➕ Todoist: ${text} (today) · no free slot left today`
              break
            }
            await life.google!.create({ title: text.replace(/\s*\d{1,3}\s*(?:m|min|mins|minutes|h|hr|hours?)\b/i, '').trim() || text, start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), description: 'Booked from the island' })
            blocks.current = { ...blocks.current, at: 0 }
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
          case 'kit':
          case 'kitCount':
          case 'kitLink':
            said = await kitAct(a)
            break
          case 'join': {
            // IS11: the meeting's video link, through the app window's open-external path.
            if (!/^https:\/\//.test(a.url)) throw new Error('That meeting has no call link')
            window.open(a.url, '_blank', 'noopener')
            said = '🎥 Opening the call'
            break
          }
          case 'suggest':
          case 'ctxFix':
          case 'safe':
          case 'recipeAnswer':
          case 'recipeAdd': {
            // Smart island (smartIsland.ts): answers, fixes, recipes; Accept runs its own action here.
            const r = await smartAct(a)
            if (a.kind === 'suggest' || a.kind === 'recipeAdd') {
              const d = get<Record<string, number>>(DISMISSED, {})
              d[a.kind === 'suggest' ? `sg:${a.sid}` : a.alertId] = Date.now() + (a.kind === 'suggest' && a.answer === 'later' ? (a.laterMin ?? 30) * 60_000 : 864e5)
              put(DISMISSED, d)
            }
            if (r?.run) await actRef.current(r.run)
            said = r?.said ?? null
            break
          }
          case 'closeAll': {
            // SI27: the day in one go: the timer stops (logging the minutes you really did),
            // blocks not checked off go to tomorrow or are dropped, and tonight's note is drafted.
            const now = Date.now()
            const f = await life.focus.state()
            if (f.running) await life.focus.stop()
            const answered = get<Record<string, string>>(ANSWERED, {})
            const open = blocks.current.list.filter((b) => !b.call && !b.maybe && b.start < now && b.end - b.start >= 15 * 60_000 && !answered[blockKey(b)])
            const day = localDayOf(now)
            let moved = 0
            for (const b of open) {
              if (a.blocks === 'move' && b.id && b.calendarId && life.google?.move) {
                await life.google.move(b.calendarId, b.id, new Date(b.start + 864e5).toISOString(), new Date(b.end + 864e5).toISOString()).then(() => moved++, () => {})
              } else {
                await life.dayLog?.addBlock(day, { at: new Date().toISOString(), title: b.title, result: 'no' }).catch(() => {})
                if (b.id) await life.timeline?.mark(day, b.id, 'skip').catch(() => {})
              }
              answered[blockKey(b)] = a.blocks === 'move' ? 'moved' : 'no'
            }
            put(ANSWERED, answered)
            blocks.current = { ...blocks.current, at: 0 }
            // The draft: what really happened (focus, blocks, the day by activity), for you to finish.
            const doingLine = (await window.desktop?.pcDoing?.().catch(() => null))?.line
            const fs = await life.focus.state()
            const lines = [`# Evening ${day}`, '', `- Focus: ${fs.todayMin} min${fs.todayBySubject.length ? ` (${fs.todayBySubject.map((x) => `${x.subject} ${x.minutes}m`).join(', ')})` : ''}`, ...(open.length ? [`- ${a.blocks === 'move' ? 'Moved to tomorrow' : 'Dropped'}: ${open.map((b) => b.title).join(', ')}`] : []), ...(doingLine ? [`- On the PC: ${doingLine}`] : []), '- What went well:', '- What I change tomorrow:', '']
            await life.notes?.save({ title: `Evening ${day}`, body: lines.join('\n') }).catch(() => null)
            window.dispatchEvent(new CustomEvent('life-external-changed'))
            window.dispatchEvent(new Event('life-focus-changed'))
            window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'today' }))
            setTimeout(() => window.dispatchEvent(new CustomEvent('life-close-day')), 600)
            said = `🌇 Day closed${open.length ? ` · ${a.blocks === 'move' ? `${moved} moved to tomorrow` : `${open.length} dropped`}` : ''} · note drafted`
            break
          }
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
      if (a.id) desk?.islandAck?.({ id: a.id, ok: !error, ...(error ? { error } : {}), ...(said ? { text: said } : {}), tookMs: Date.now() - t0 })
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
    // IP4: the island can match the app's colours.
    startIslandThemeSync()
    // IPC listeners can't be removed through the bridge: add them once per window.
    if (!listening) {
      listening = true
      desk.onIslandAction?.((a) => void actRef.current(a))
      // Smart island: title-free activity events from the desktop.
      startSmart(() => void sendRef.current())
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
      // MC10: 2+ minutes in distracting apps during focus (the desktop says it once per session).
      desk.onPcDrift?.((d) => {
        put(DRIFT, { ...d, at: Date.now() })
        void sendRef.current()
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
      // AF1: the app window is slowed down in the tray; the desktop's 15 s
      // clock keeps the island fresh (when visible, our own timer does it).
      desk.onIslandTick?.(() => {
        if (document.hidden) void sendRef.current()
      })
      // Every 15 s from the desktop: how long since your last mouse/keys.
      desk.onIdle?.((sec) => {
        const before = idleSec
        guardTick(sec)
        bodyTick(sec)
        nudgeIdle(sec)
        // Crossing the drift line (or coming back) updates the island at once.
        if (before == null || (before < 480) !== (sec < 480)) void sendRef.current()
      })
    }
    void send()
    // CL11: nobody at the PC (idle 10+ minutes or locked): the island rests; your return wakes it at once.
    const t = setInterval(() => {
      if (lockedAt || (idleSec ?? 0) > 600) return
      void send()
    }, 15_000)
    const on = () => void send()
    window.addEventListener('life-focus-changed', on)
    window.addEventListener('life-sport-changed', on)
    window.addEventListener('life-island-refresh', on)
    return () => {
      clearInterval(t)
      window.removeEventListener('life-focus-changed', on)
      window.removeEventListener('life-sport-changed', on)
      window.removeEventListener('life-island-refresh', on)
    }
  }, [act, desk, send])
  useLive(() => void send())
  return null
}
