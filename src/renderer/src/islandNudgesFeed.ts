// Island 2, the app window's side: it builds the nudge cards for the island's
// snapshot (src/core/islandNudges.ts decides what and when) and does what
// their buttons ask. Move breaks go into Sport Track, the workout log and
// the ledger (body.move_break, capped), and an undo or "I only did 12" takes
// back exactly that. Tallies (eyes, posture, calm) are quiet records.
import { calendarDay, dayKey } from '@core/dates'
import type { IslandAction } from '@core/islandModel'
import {
  addFocusCheck,
  addMove,
  challengeBonus,
  challengeDone,
  challengeLine,
  CHALLENGE_RULE,
  cleanNudgeStore,
  dayOf,
  EMPTY_NUDGES,
  EYES_RULE,
  fixMove,
  makeChallenge,
  movePill,
  moveStreak,
  MOVE_RULE,
  noteAnswer,
  noteIdle,
  personCalled,
  postpone,
  setLog,
  snoozeUntil,
  tally,
  touched,
  undoMove,
  type ExerciseLine,
  type MovePill,
  type NudgeKind,
  type NudgeOp,
  type NudgePrefs,
  type NudgeStore,
  type SnoozeCtx
} from '@core/islandNudges'
import { HEALTHY_RULE, healthyBonus, healthyDay, healthyStreak, healthyView, screenBreaks, type HealthyView, type WeeklyHealth } from '@core/healthyDay'
import { life } from './bridge'
import { addWater } from './water'
import { findExercise, readSport, updateSport } from './sportTrack'

const LOCAL = 'ls.islandNudges'
const DISMISSED = 'ls.islandDismissed'
const LAST_MOVE = 'ls.lastMoveAt'
const LAST_EYES = 'ls.lastEyesAt'
const LAST_WATER = 'ls.lastWaterAt'

const lsGet = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const lsPut = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* fine */
  }
}
const today = (t = Date.now()) => dayKey(new Date(t))

// ---- The store: synced (life.nudges), with this device's copy as a fallback ----

let store: NudgeStore | null = null
let loadedAt = 0
let saveT: ReturnType<typeof setTimeout> | null = null
const subs = new Set<(s: NudgeStore) => void>()

async function load(force = false): Promise<NudgeStore> {
  if (store && !force && Date.now() - loadedAt < 2 * 60_000) return store
  loadedAt = Date.now()
  const fromDb = await life.nudges?.get().catch(() => null)
  // A change waiting to be saved wins over the copy we just read.
  if (saveT && store) return store
  store = fromDb ?? cleanNudgeStore(lsGet<unknown>(LOCAL, null), today())
  return store
}
function save(next: NudgeStore): NudgeStore {
  store = next
  lsPut(LOCAL, next)
  subs.forEach((f) => f(next))
  if (saveT) clearTimeout(saveT)
  saveT = setTimeout(() => {
    saveT = null
    void life.nudges?.save(store!).catch(() => {})
  }, 800)
  return next
}

/** Settings → Desktop island → Nudges: read and change your nudge settings. */
export async function nudgePrefs(): Promise<NudgeStore> {
  return load(true)
}
export async function setNudgePrefs(patch: Partial<NudgePrefs>): Promise<NudgeStore> {
  const s = await load()
  return save(cleanNudgeStore({ ...s, prefs: { ...s.prefs, ...patch } }, today()))
}
/** Settings: learning starts over for every nudge. */
export async function resetNudgeLearning(): Promise<NudgeStore> {
  const s = await load()
  return save({ ...s, stats: Object.fromEntries(Object.entries(s.stats).filter(([k]) => !k.startsWith('n:'))) })
}
export function onNudges(f: (s: NudgeStore) => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}

// ---- Time away (IN32) --------------------------------------------------------

let idle = { maxIdle: 0 }
/** Every 15 s from the desktop: how long since your last mouse/keys. */
export function nudgeIdle(sec: number): void {
  const r = noteIdle(idle, sec, Date.now())
  idle = { maxIdle: r.maxIdle }
  if (r.back && store) save({ ...store, away: r.back })
}

// ---- The snapshot: which card, and the pill's ring ----------------------------

export interface NudgeTickInput {
  now: number
  /** A focus timer or a call. */
  busy: boolean
  call: boolean
  idleSec: number | null
  activeSince: number | null
  running: { subject: string; startedAt: number; endsAt: number; pausedAt?: number | null; brk?: boolean } | null
  blockEnd: number | null
  meetingEnd: number | null
  dismissed: Record<string, number>
  eyeBreaks: boolean
  doing?: { ctx: string; pause: boolean } | null
}

export interface NudgeTick {
  move: MovePill | null
  /** HD: what the island's healthy-day chain needs (core/dayNudges.ts decides the card). */
  store: NudgeStore
  exercises: ExerciseLine[]
  coins: number
  moodSlots: ('noon' | 'evening')[]
  lowMood: boolean
  lastMoveAt: number
  lastEyesAt: number
  snooze: SnoozeCtx
}

let ctx: SnoozeCtx = { now: 0 }
let rulesCache: { at: number; coins: Record<string, number> } = { at: 0, coins: {} }
async function ruleCoins(id: string): Promise<number> {
  if (Date.now() - rulesCache.at > 10 * 60_000) {
    const list = await life.rules?.list().catch(() => null)
    if (list) rulesCache = { at: Date.now(), coins: Object.fromEntries(list.filter((r) => r.enabled).map((r) => [r.id, r.coins])) }
  }
  return rulesCache.coins[id] ?? 0
}
let moodCache: { at: number; day: string; slots: ('noon' | 'evening')[]; low: boolean } = { at: 0, day: '', slots: [], low: false }
async function moods(now: number): Promise<{ slots: ('noon' | 'evening')[]; low: boolean }> {
  const day = calendarDay(new Date(now))
  const h = new Date(now).getHours()
  // Only in the check-in hours, and at most every 10 minutes.
  if (((h >= 11 && h < 15) || (h >= 18 && h < 22)) && (now - moodCache.at > 10 * 60_000 || moodCache.day !== day)) {
    moodCache.at = now
    const v = await life.coach?.desk?.().catch(() => null)
    const mine = (v?.moods ?? []).filter((m) => m.day === calendarDay(new Date(now)))
    moodCache = { at: now, day, slots: mine.map((m) => m.slot), low: mine.some((m) => m.mood <= 2) }
  }
  return moodCache
}

export function exerciseLines(): ExerciseLine[] {
  const sport = readSport()
  return (Array.isArray(sport?.exercises) ? sport.exercises : [])
    .filter((e: any) => !e.archived && Number(e.target) > 0)
    .map((e: any) => ({ id: String(e.id ?? e.name), name: String(e.name), done: Number(e.doneToday) || 0, target: Number(e.target) || 0, ...(e.unit ? { unit: String(e.unit) } : {}) }))
}

export async function nudgeTick(i: NudgeTickInput): Promise<NudgeTick> {
  let s = await load()
  const day = today(i.now)
  ctx = { now: i.now, taskEnd: i.running && !i.running.brk ? i.running.endsAt : i.blockEnd, meetingEnd: i.meetingEnd }
  const exs = exerciseLines()
  // IN49: today's challenge is made once, from your Sport Track targets.
  const d = dayOf(s, day)
  const made = s.prefs.challenge && !d.challenge && exs.length ? makeChallenge(exs) : null
  if (made) s = save({ ...s, days: { ...s.days, [day]: { ...d, challenge: made } } })
  // IN51: a new best move streak is kept.
  const streak = moveStreak(s, day)
  if (streak > s.best) s = save({ ...s, best: streak })
  const move = movePill(s, day, i.now)
  const md = await moods(i.now)
  return { move: s.prefs.on.move ? move : null, store: s, exercises: exs, coins: await ruleCoins(MOVE_RULE), moodSlots: md.slots, lowMood: md.low, lastMoveAt: lsGet<number>(LAST_MOVE, 0), lastEyesAt: lsGet<number>(LAST_EYES, 0), snooze: { ...ctx, now: i.now } }
}

/** HD: a card reached you: its time goes into the synced store (Telegram reads it: no second water or wind-down nudge). */
export function nudgeTouched(kind: string, now: number): void {
  if (store) save(touched(store, today(now), kind, now))
}

/**
 * HD: today's Healthy day ring: water (saved for the weekly card), moves,
 * screen breaks and last night's bedtime. All four met pays the small bonus
 * once (body.healthy_day); a break undone the same day takes it back.
 */
export async function healthTick(now: number, water: { ml: number; target: number }, slept: boolean | null): Promise<{ today: HealthyView; week: WeeklyHealth | null; beds?: undefined } | null> {
  if (!store) return null
  const day = today(now)
  let s = store
  const d = dayOf(s, day)
  const h = healthyDay({ waterMl: water.ml, waterTarget: water.target, moves: d.moves, breaks: screenBreaks(d), sleptOnTime: slept })
  let paid = d.healthyPaid ?? null
  const b = healthyBonus(h, paid)
  if (b === 'pay') paid = (await payOnce(HEALTHY_RULE, `healthy:${day}`, 'Healthy day: water, moves, breaks, bed on time')) || null
  if (b === 'undo' && paid) {
    await life.wallet.undo(paid, 'Healthy day no longer complete').catch(() => {})
    paid = null
  }
  s = store
  const cur = dayOf(s, day)
  if (cur.water !== water.ml || cur.waterTarget !== water.target || !!cur.healthy !== h.all || (cur.healthyPaid ?? null) !== paid) {
    s = save({ ...s, days: { ...s.days, [day]: { ...cur, water: water.ml, waterTarget: water.target, healthy: h.all, healthyPaid: paid } } })
    if (b) window.dispatchEvent(new CustomEvent('life-wallet-changed'))
  }
  const streak = healthyStreak(s.days, day)
  return { today: healthyView(h, streak, !!paid), week: null }
}

/**
 * Today's Healthy day ring, read only (Today → Body): the same numbers as the
 * island's ring, but it never pays or takes back the bonus (only healthTick does).
 */
export async function healthPeek(now: number, water: { ml: number; target: number }, slept: boolean | null): Promise<HealthyView> {
  const s = await load()
  const day = today(now)
  const d = dayOf(s, day)
  const h = healthyDay({ waterMl: water.ml, waterTarget: water.target, moves: d.moves, breaks: screenBreaks(d), sleptOnTime: slept })
  return healthyView(h, healthyStreak(s.days, day), !!d.healthyPaid)
}

/** You took a water reminder (learning: a yes at this hour). */
export function nudgeYes(kind: NudgeKind): void {
  if (store) save({ ...store, stats: noteAnswer(store.stats, kind, true, new Date().getHours()) })
}

// ---- Taps ----------------------------------------------------------------------

/** The island's tap id → the move break it logged (for its 5-second ↶ Undo). */
const taps = new Map<string, string>()

const dismiss = (id: string, until: number) => {
  const d = lsGet<Record<string, number>>(DISMISSED, {})
  const now = Date.now()
  for (const k of Object.keys(d)) if (d[k] < now) delete d[k]
  d[id] = until
  lsPut(DISMISSED, d)
}

async function payOnce(rule: string, ref: string, note: string): Promise<number> {
  if (!life.wallet.payOnce) return 0
  return (await life.wallet.payOnce(rule, ref, note).catch(() => 0)) || 0
}

/** IN49: pay the challenge's bonus once it's complete, or take it back when an undo drops below it. */
async function checkChallenge(day: string): Promise<string | null> {
  let s = store!
  const ch = dayOf(s, day).challenge
  if (!ch || !s.prefs.challenge) return null
  const done = challengeDone(s, day, ch)
  const b = challengeBonus(ch, done)
  let paid = ch.paid ?? null
  if (b === 'pay') paid = (await payOnce(CHALLENGE_RULE, `challenge:${day}`, `${ch.target} ${ch.name} in breaks`)) || null
  if (b === 'undo' && ch.paid) {
    await life.wallet.undo(ch.paid, 'Challenge no longer complete (a break was undone)').catch(() => {})
    paid = null
  }
  const line = challengeLine(ch, done)
  s = store!
  const d = dayOf(s, day)
  save({ ...s, days: { ...s.days, [day]: { ...d, challenge: { ...ch, paid, said: line ? [...(ch.said ?? []), line.mark] : ch.said } } } })
  window.dispatchEvent(new CustomEvent('life-wallet-changed'))
  return line?.line ?? null
}

async function logMove(op: Extract<NudgeOp, { op: 'move' }>, tapId: string | undefined, moved: () => void): Promise<string> {
  const now = Date.now()
  const day = today(now)
  const n = Math.max(1, Math.min(300, Math.round(op.n)))
  // Into Sport Track's checklist when it has that exercise, and the workout log.
  let id = op.ex || op.name.toLowerCase()
  updateSport((d) => {
    const ex = findExercise(d, op.ex) ?? findExercise(d, op.name)
    if (ex) {
      ex.doneToday = (Number(ex.doneToday) || 0) + n
      id = String(ex.id)
    }
  }, { source: 'island' })
  const w = await life.body.logWorkout({ title: `${op.name} (+${n}) · movement break`, items: [{ exerciseId: id, name: op.name, amount: n, unit: 'reps' as any }], note: 'From the island' })
  const logId = `mv${now.toString(36)}`
  // Points: only for this confirmed break, at most the rule's daily cap.
  const ledgerId = await payOnce(MOVE_RULE, `move:${logId}`, `${n} ${op.name}`)
  const coins = ledgerId ? await ruleCoins(MOVE_RULE) : 0
  let s = await load()
  s = addMove(s, { id: logId, at: now, day, ex: id, name: op.name, n, workoutId: w?.workout?.id ?? null, ledgerId: ledgerId || null, coins })
  s = { ...s, stats: noteAnswer(s.stats, 'move', true, new Date(now).getHours()) }
  save(s)
  if (tapId) taps.set(tapId, logId)
  lsPut(LAST_MOVE, now)
  moved()
  dismiss(op.alertId, now + 864e5)
  window.dispatchEvent(new CustomEvent('life-body-changed'))
  window.dispatchEvent(new CustomEvent('life-wallet-changed'))
  const line = await checkChallenge(day)
  return `💪 ${n} ${op.name}${coins ? ` · +${coins}` : ''}${line ? ` · ${line}` : ''}`
}

async function undoLog(logId: string): Promise<string> {
  const s = await load()
  const r = undoMove(s, logId)
  if (!r.log) throw new Error('That break is already undone')
  const log = r.log
  updateSport((d) => {
    const ex = findExercise(d, log.ex) ?? findExercise(d, log.name)
    if (ex) ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) - log.n)
  }, { source: 'island' })
  // Only that set leaves the day's workout (the rest of the day stays).
  if (log.workoutId != null && life.body.takeBackSet) await life.body.takeBackSet(log.workoutId, log.name, log.n).catch(() => {})
  if (log.ledgerId != null) await life.wallet.undo(log.ledgerId, 'Move break undone on the island').catch(() => {})
  save(r.store)
  await checkChallenge(log.day)
  window.dispatchEvent(new CustomEvent('life-body-changed'))
  window.dispatchEvent(new CustomEvent('life-wallet-changed'))
  return `↶ Took back ${log.n} ${log.name}${log.coins ? ` and +${log.coins}` : ''}`
}

async function fixLog(logId: string, n: number): Promise<string> {
  const s = await load()
  const old = s.logs.find((l) => l.id === logId && !l.undone)
  if (!old) throw new Error('That break is gone')
  const r = fixMove(s, logId, n)
  if (!r.log) return `${old.n} ${old.name}: no change`
  const log = r.log
  updateSport((d) => {
    const ex = findExercise(d, log.ex) ?? findExercise(d, log.name)
    if (ex) ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) + r.delta)
  }, { source: 'island' })
  // The workout gets the right number: the old set out, the real one in (no new points: the day's workout already counted).
  let workoutId = old.workoutId
  if (old.workoutId != null && life.body.takeBackSet) {
    await life.body.takeBackSet(old.workoutId, old.name, old.n).catch(() => {})
    const w = await life.body.logWorkout({ title: `${log.name} (+${log.n}) · movement break`, items: [{ exerciseId: log.ex, name: log.name, amount: log.n, unit: 'reps' as any }], note: 'From the island (count fixed)' }).catch(() => null)
    workoutId = w?.workout?.id ?? workoutId
  }
  save(setLog(r.store, logId, { workoutId }))
  await checkChallenge(log.day)
  window.dispatchEvent(new CustomEvent('life-body-changed'))
  return `✓ Fixed: ${log.n} ${log.name}`
}

/**
 * A tap on a nudge card (or the 5-second ↶ Undo of a move break). Returns
 * what happened in words, null for nothing to say, or undefined when it's
 * not a nudge tap (IslandFeed handles it).
 */
export async function nudgeAct(a: IslandAction, o: { moved: () => void }): Promise<string | null | undefined> {
  if (a.kind === 'undo') {
    const logId = taps.get(a.of)
    if (!logId) return undefined
    taps.delete(a.of)
    return undoLog(logId)
  }
  if (a.kind === 'moveBreak') return logMove({ op: 'move', ex: a.name, name: a.name, n: a.n, alertId: a.alertId }, a.id, o.moved)
  if (a.kind !== 'nudge') return undefined
  const op = a.op
  const now = Date.now()
  const day = today(now)
  const hour = new Date(now).getHours()
  let s = await load()
  const no = (kind: string) => (s = { ...s, stats: noteAnswer(s.stats, kind, false, hour) })
  const yes = (kind: string) => (s = { ...s, stats: noteAnswer(s.stats, kind, true, hour) })
  switch (op.op) {
    case 'move':
      return logMove(op, a.id, o.moved)
    case 'undo':
      return undoLog(op.logId)
    case 'fix':
      return fixLog(op.logId, op.n)
    case 'water': {
      lsPut(LAST_WATER, now)
      await addWater(op.ml, { source: 'island' })
      save(setLog(s, op.logId, { water: true }))
      return `💧 +${op.ml} ml too`
    }
    case 'snooze': {
      const until = snoozeUntil(op.choice, { ...ctx, now })
      no(op.kind)
      save((s = postpone(s, day, op.kind, until)))
      dismiss(op.alertId, until)
      const n = dayOf(s, day).postponed[op.kind] ?? 1
      return `⏰ Until ${new Date(until).toTimeString().slice(0, 5)}${n > 1 ? ` · postponed ${n}× today` : ''}`
    }
    case 'skip':
      no(op.kind)
      save(touched(s, day, op.kind, now))
      dismiss(op.alertId, now + (op.kind === 'mood' || op.kind === 'gratitude' ? 864e5 : 3 * 3600_000))
      return null
    case 'close':
      dismiss(op.alertId, now + 864e5)
      return null
    case 'tally': {
      dismiss(op.alertId, now + 864e5)
      yes(op.kind)
      if (op.kind === 'eyes') {
        lsPut(LAST_EYES, now)
        s = tally(s, day, 'eyes', now)
        save(s)
        // A tiny thank-you, at most 3 a day (the rule's cap).
        const paid = await payOnce(EYES_RULE, `eyes:${op.alertId}`, '20-20-20')
        if (paid) window.dispatchEvent(new CustomEvent('life-wallet-changed'))
        return `👁️ Eye break done${paid ? ` · +${await ruleCoins(EYES_RULE)}` : ''}`
      }
      if (op.kind === 'posture') {
        save(tally(s, day, op.ok ? 'posture' : 'postureFix', now))
        return op.ok ? '🪑 Good posture, noted' : '🪑 Fixed: shoulders back, feet flat'
      }
      if (op.kind === 'breathe') {
        save(tally(s, day, 'calm', now))
        return '🫧 Calm minute noted'
      }
      save(tally(s, day, 'tidy', now))
      return '🧹 Desk tidy, noted'
    }
    case 'drill': {
      // BD11: the 60-second desk drill, logged because you tapped Done (no points: a quiet tally, a minute moved).
      dismiss(op.alertId, now + 864e5)
      yes('posture')
      save(tally(s, day, 'drill', now))
      return '🧍 Desk drill done: chest, hips and neck opened up'
    }
    case 'mood': {
      const mood = Math.max(1, Math.min(5, Math.round(op.mood)))
      if (!life.coach?.deskDo) throw new Error('Mood check-ins are not available here')
      await life.coach.deskDo({ op: 'mood', mood })
      moodCache.at = 0
      yes('mood')
      save(tally(s, day, 'mood', now))
      dismiss(op.alertId, now + 864e5)
      return 'Mood noted · Ben sees it'
    }
    case 'gratitude': {
      const text = op.text.replace(/\s+/g, ' ').trim().slice(0, 200)
      if (!text) throw new Error('Write one short line first')
      if (!life.notes) throw new Error('The Notebook is not available here')
      const title = 'Good things'
      const notes = await life.notes.list()
      const n = notes.find((x) => x.title.toLowerCase() === title.toLowerCase())
      const line = `- ${day}: ${text}`
      await life.notes.save(n ? { id: n.id, title: n.title, body: `${n.body.replace(/\s*$/, '')}\n${line}\n` } : { title, body: `# ${title}\n\nOne good thing a day, from the island.\n\n${line}\n` })
      yes('gratitude')
      save(tally(s, day, 'gratitude', now))
      dismiss(op.alertId, now + 864e5)
      return '🌱 Saved in Notebook → Good things'
    }
    case 'focus': {
      s = addFocusCheck(s, day, { at: now, subject: op.subject, answer: op.answer })
      if (op.answer === 'yes') yes('focus')
      save(s)
      dismiss(op.alertId, now + 864e5)
      await life.dayLog?.addCheck?.(day, { at: new Date(now).toISOString(), subject: op.subject, answer: op.answer }).catch(() => {})
      if (op.answer === 'switch') {
        await life.focus.stop()
        window.dispatchEvent(new Event('life-focus-changed'))
        return `⏹ ${op.subject} logged. Start the next thing.`
      }
      return op.answer === 'yes' ? `🎯 Still on ${op.subject}. Keep going.` : `Noted. Back to ${op.subject}: close what pulled you away.`
    }
    case 'person': {
      dismiss(op.alertId, now + 864e5)
      if (!op.done) {
        no('people')
        save(s)
        return null
      }
      yes('people')
      const p = s.prefs.people.find((x) => x.id === op.personId)
      save(personCalled(s, op.personId, day))
      return `📞 ${p?.name ?? 'Call'}: noted today`
    }
    case 'away': {
      dismiss(op.alertId, now + 864e5)
      s = { ...s, away: null }
      if (!op.yes) {
        save(s)
        return null
      }
      // You said you moved: a short walk in the workout log (minutes, honest by your word).
      const min = Math.max(1, Math.min(60, Math.round(op.min)))
      await life.body.logWorkout({ title: `Walk (${min} min)`, items: [{ exerciseId: 'walk', name: 'Walk', amount: min, unit: 'min' as any }], note: 'From the island: you said you moved while away' })
      yes('away')
      save(tally(s, day, 'walk', now, min))
      window.dispatchEvent(new CustomEvent('life-body-changed'))
      return `🚶 ${min} min walk logged`
    }
  }
}

export { EMPTY_NUDGES }
