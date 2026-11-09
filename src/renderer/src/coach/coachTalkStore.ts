// The coach talks, on the database (core/coachTalk.ts is the logic): the
// evening check-in's facts and save, the coach nudge due now (inside the one
// daily cap shared with the food pushes), and plan-change proposals with
// Apply / Not now / Undo through the existing setters (food_saved, Sport
// Track's trainWeek, coach_config). No browser code: the app window, the
// server's tick and the Telegram buttons all use it. Nothing pays points.
import { addDays } from '@core/dates'
import { sportToday } from '@core/sportShared'
import { nightsFrom } from '@core/benAsk'
import { cleanCoach } from '@core/coachConfig'
import { dayOf, withCheckin } from '@core/coachPlan'
import { weightRising } from '@core/coachSafety'
import { weeklyAverages } from '@core/bodyComp'
import { doneSessions, trainOf } from '@core/trainLog'
import { TYPE_NAME, todayPlan, type DayType } from '@core/trainWeek'
import type { PushOut } from '@core/benPushes'
import {
  COACH_PROPS,
  addProposal,
  appMinuteOf,
  applyFood,
  applyMove,
  capAllows,
  checkinLines,
  checkinReply,
  cleanProps,
  decideCoachNudge,
  proposalText,
  proteinFoods,
  readProposal,
  type CapState,
  type CheckinFacts,
  type CheckinReply,
  type CheckinTaps,
  type CoachProps,
  type NudgePrefs,
  type PropRec
} from '@core/coachTalk'
import { getSetting, setSetting } from '../../../main/settings'
import { saveSport, sportBlob, sportNow } from '../../../main/bodyLog'
import { listBodyComp } from '../../../main/bodyComp'
import { bodyPoints, foodDayTotals, readFoodSaved, saveFoodSaved } from '../../../main/food'
import { readLifeFit, sleepWindow } from '../web/lifeFitStore'
import { readPushLog } from '../web/benPushStore'
import { coachToday, loadCoach, loadDays, saveCoach, saveDays } from './coachStore'

type DB = any
const safe = <T>(fn: () => T, d: T): T => {
  try {
    return fn()
  } catch {
    return d
  }
}

/** True when the weekly-average weight is rising (cuts are allowed only then). */
export const risingNow = (db: DB, now = new Date()) => safe(() => weightRising(weeklyAverages(bodyPoints(db, sportToday(now), 28), sportToday(now), 3)), false)

/** Last night's sleep (hours) from the sleep log, or null. */
export function sleepLastNight(svc: any, today: string): number | null {
  const logs = safe(() => (svc?.sleep?.logs?.() ?? []).map((l: any) => ({ day: String(l.day), bedTime: l.bedTime ?? null, wakeTime: l.wakeTime ?? null })), [])
  const n = nightsFrom(logs).find((x) => x.day === today)
  return n ? Math.round((n.minutes / 60) * 2) / 2 : null
}

/** The evening check-in's facts: all from the logs. */
export function checkinFacts(db: DB, svc: any, now = new Date(), st?: any): CheckinFacts {
  const t = coachToday(db, st, now)
  const tot = safe(() => foodDayTotals(db, now), { kcal: 0, protein: 0 } as any)
  const tr = t.plan.training
  const training: CheckinFacts['training'] = t.facts.workout || tr.kind === 'done' ? 'done' : tr.kind === 'rest' ? 'rest' : 'missed'
  const session = tr.kind === 'session' ? TYPE_NAME[tr.type] : tr.kind === 'done' && tr.type ? TYPE_NAME[tr.type] : null
  const comp = safe(() => listBodyComp(db, t.today, t.today), [])
  const last = comp.length ? Number((comp[comp.length - 1] as any).weight_kg) : null
  const metric = safe(() => db.prepare('SELECT weight FROM body_metrics WHERE day = ? AND weight IS NOT NULL LIMIT 1').get(t.today) as any, null)
  const weight = last && Number.isFinite(last) ? last : metric?.weight ? Number(metric.weight) : null
  const data = trainOf(st && typeof st === 'object' ? st : safe(() => sportBlob(db), null))
  const done = doneSessions(data.log)
  const tomorrowDay = addDays(t.today, 1)
  const withToday = training === 'done' && !done.some((d) => d.date === t.today) && tr.kind !== 'rest' ? [...done, { date: t.today, type: tr.kind === 'session' ? tr.type : 'upper' } as any] : done
  const tp = safe(() => todayPlan(data.week, withToday, tomorrowDay), null)
  const tomorrow = tp ? (tp.type === 'rest' ? { kind: 'rest' as const, title: TYPE_NAME.rest } : { kind: 'session' as const, title: TYPE_NAME[tp.type as DayType] }) : null
  return {
    date: t.today,
    kcal: Math.round(Number(tot.kcal) || 0),
    kcalGoal: t.plan.food.kcal,
    protein: Math.round(Number(tot.protein) || 0),
    proteinGoal: t.plan.food.protein,
    training,
    session,
    weighed: t.facts.weigh,
    weight,
    sleepH: sleepLastNight(svc, t.today),
    low: t.plan.notes.some((n) => n.id === 'low'),
    tomorrow,
    bed: t.config.sleep.bed,
    lang: t.config.lang
  }
}

export interface CheckinView {
  facts: CheckinFacts
  lines: string[]
  done: { energy: number; soreness: number; sleep: number | null; reply: string } | null
}

export function checkinView(db: DB, svc: any, now = new Date(), st?: any): CheckinView {
  const facts = checkinFacts(db, svc, now, st)
  const c = dayOf(loadDays(db, facts.date), facts.date).checkin
  return { facts, lines: checkinLines(facts), done: c ? { energy: c.energy, soreness: c.soreness, sleep: c.sleep ?? null, reply: c.reply ?? '' } : null }
}

/** Saves the check-in (taps + the reply) in coach_days. */
export function saveCheckin(db: DB, date: string, taps: CheckinTaps, reply: string, now = Date.now()) {
  const today = sportToday(new Date(now))
  saveDays(db, withCheckin(loadDays(db, today), date, { energy: taps.energy, soreness: taps.soreness, sleep: taps.sleep, reply }, now), today)
}

/** The rule reply, then (when `phrase` gives one that passes) the AI's phrasing of it. */
export async function replyFor(f: CheckinFacts, taps: CheckinTaps, phrase?: ((r: CheckinReply) => Promise<string | null>) | null): Promise<{ text: string; src: 'ai' | 'template' }> {
  const r = checkinReply(f, taps)
  if (!phrase) return { text: r.text, src: 'template' }
  const ai = await phrase(r).catch(() => null)
  return ai ? { text: ai, src: 'ai' } : { text: r.text, src: 'template' }
}

// ---------- the nudges' cap ----------

export function nudgePrefs(db: DB): NudgePrefs {
  const p = readLifeFit(db).pushes
  return { morning: p?.coachMorning !== false, protein: p?.coachProtein !== false, checkin: p?.coachCheckin !== false }
}

/** What the one daily cap is decided from, now. */
export function capState(db: DB, svc: any, now = new Date()): CapState {
  const day: string = safe(() => svc.wallet.today(now), sportToday(now))
  const today = sportToday(now)
  const tot = safe(() => foodDayTotals(db, now), { protein: 0, targets: { protein: 0 } } as any)
  return {
    minute: appMinuteOf(now),
    day,
    prefs: nudgePrefs(db),
    log: readPushLog(db, day),
    checkinDone: !!dayOf(loadDays(db, today), today).checkin,
    protein: Math.round(Number(tot.protein) || 0),
    proteinGoal: Math.round(Number(tot.targets?.protein) || 0),
    bed: safe(() => svc.sleep.bedtimeTarget(), null) ?? sleepWindow(db).bed
  }
}

/** A meal reminder or food push may go now (the coach's higher-priority nudges keep their places). */
export const foodCapAllows = (db: DB, svc: any, now = new Date()) => safe(() => capAllows('food', capState(db, svc, now)), true)

/** The coach nudge due now (the check-in, protein or the morning one), or null. */
export function coachNudgeFor(db: DB, svc: any, o: { now: Date; here: boolean; meeting: boolean; quiet: boolean; wake?: string | null; st?: any }): PushOut | null {
  if (o.meeting || o.quiet) return null
  const s = capState(db, svc, o.now)
  if (!s.prefs.morning && !s.prefs.protein && !s.prefs.checkin) return null
  const t = coachToday(db, o.st, o.now)
  const tr = t.plan.training
  const cfg = t.config
  const step = (id: string) => cfg.morning.find((x) => x.id === id)?.label ?? null
  const checkin = s.prefs.checkin && s.minute >= 20 * 60 ? checkinLines(checkinFacts(db, svc, o.now, o.st)) : []
  return decideCoachNudge({
    ...s,
    here: o.here,
    meeting: o.meeting,
    quiet: o.quiet,
    wake: o.wake ?? sleepWindow(db).wake,
    training: { kind: t.facts.workout ? 'done' : tr.kind, title: tr.kind === 'session' ? tr.title : tr.title },
    snack: cfg.train.when === 'morning' ? step('snack') : null,
    wait: step('wait'),
    proteinFoods: proteinFoods(readFoodSaved(db)),
    checkinLines: checkin,
    lang: cfg.lang
  })
}

// ---------- proposals ----------

export const loadProps = (db: DB): CoachProps => cleanProps(safe(() => JSON.parse(getSetting(db, COACH_PROPS) || 'null'), null))
const saveProps = (db: DB, p: CoachProps) => setSetting(db, COACH_PROPS, JSON.stringify(cleanProps(p)))
const pid = () => `cp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** The model's "propose" object checked against his data and kept as an open proposal (null: nothing to offer). */
export function proposeFrom(db: DB, raw: unknown, lang: 'en' | 'ro' = 'en', now = Date.now(), st?: any): PropRec | null {
  const saved = readFoodSaved(db)
  const data = trainOf(st && typeof st === 'object' ? st : safe(() => sportBlob(db), null))
  const p = readProposal(raw, { saved, week: data.week, rising: risingNow(db, new Date(now)) })
  if (!p) return null
  const rec = { id: pid(), at: now, p, text: proposalText(p, saved, lang) }
  saveProps(db, addProposal(loadProps(db), rec))
  return { ...rec, state: 'open' }
}

/**
 * Apply, Not now or Undo on a proposal. Apply goes through the existing setters
 * (food_saved, Sport Track's week, coach_config) and keeps what it replaced;
 * Undo puts that back. Returns the line to show.
 */
export function answerProposal(db: DB, id: string, op: 'apply' | 'skip' | 'undo', device = 'app', now = Date.now()): { ok: boolean; line: string; rec: PropRec | null } {
  const props = loadProps(db)
  const rec = props.list.find((r) => r.id === id) ?? null
  if (!rec) return { ok: false, line: 'That suggestion is no longer open.', rec: null }
  const put = (next: PropRec) => saveProps(db, { v: 1, list: props.list.map((r) => (r.id === id ? next : r)) })
  if (op === 'skip') {
    if (rec.state !== 'open') return { ok: false, line: 'Already answered.', rec }
    put({ ...rec, state: 'skipped' })
    return { ok: true, line: 'OK, nothing changed.', rec: { ...rec, state: 'skipped' } }
  }
  const p = rec.p
  if (op === 'apply') {
    if (rec.state !== 'open') return { ok: false, line: rec.state === 'applied' ? 'Already applied.' : 'That suggestion is closed.', rec }
    let undo: unknown
    if (p.kind === 'swap' || p.kind === 'meal') {
      const saved = readFoodSaved(db)
      const slot = saved.day.slots.find((s) => s.id === p.slotId)
      if (!slot) return { ok: false, line: 'That meal is not in your standard day any more.', rec }
      undo = { slotId: slot.id, items: slot.items }
      saveFoodSaved(db, applyFood(saved, p))
    } else if (p.kind === 'move') {
      const st = safe(() => sportNow(db, new Date(now)), null) ?? safe(() => sportBlob(db), null)
      if (!st) return { ok: false, line: 'Open Body → Training once first.', rec }
      const week = trainOf(st).week
      undo = { days: week.days }
      const m = applyMove(week, p)
      saveSport(db, { ...st, trainWeek: { v: 1, days: m.days, updatedAt: now } }, device, { now: new Date(now) })
    } else {
      const cfg = loadCoach(db)
      undo = { ramp: cfg.ramp }
      const today = sportToday(new Date(now))
      saveCoach(db, cleanCoach({ ...cfg, ramp: p.stop ? { start: null, baseline: null } : { start: today, baseline: p.baseline } }))
    }
    put({ ...rec, state: 'applied', undo })
    return { ok: true, line: `✅ Applied: ${rec.text}.`, rec: { ...rec, state: 'applied', undo } }
  }
  // Undo
  if (rec.state !== 'applied' || rec.undo == null) return { ok: false, line: 'Nothing to undo.', rec }
  const u = rec.undo as any
  if (p.kind === 'swap' || p.kind === 'meal') {
    const saved = readFoodSaved(db)
    saveFoodSaved(db, { ...saved, day: { slots: saved.day.slots.map((s) => (s.id === u.slotId ? { ...s, items: u.items } : s)) } })
  } else if (p.kind === 'move') {
    const st = safe(() => sportNow(db, new Date(now)), null) ?? safe(() => sportBlob(db), null)
    if (st && Array.isArray(u.days)) saveSport(db, { ...st, trainWeek: { v: 1, days: u.days, updatedAt: now } }, device, { now: new Date(now) })
  } else {
    saveCoach(db, cleanCoach({ ...loadCoach(db), ramp: u.ramp }))
  }
  const back: PropRec = { ...rec, state: 'undone' }
  delete back.undo
  put(back)
  return { ok: true, line: `↩ Undone: ${rec.text}.`, rec: back }
}
