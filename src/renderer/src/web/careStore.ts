// Sleep care and grooming on the database (BD4, BD5, BD6, BD12, BD15): the
// synced settings `sleep_care` and `grooming`, the coffee log shared by the
// Sleep page, the island and Telegram, the after-shift checklist (its teeth
// and skin also tick the grooming night steps: one routine, not two), and
// the grooming habit's one honest payment. The pure rules are in
// src/core/sleepCare.ts, afterShift.ts and grooming.ts.
import { addCoffee, caffeineView, cleanCare, coffeeReply, debtAdvice, debtLine, markLight, markWarm, setCarePrefs, SLEEP_CARE_KEY, sleepDebt, toggleShiftStep, undoCoffee, type CareView, type SleepCare } from '@core/sleepCare'
import { afterShiftLine, afterShiftPlan } from '@core/afterShift'
import { cleanGrooming, GROOM_RULE, groomDay, groomPay, groomRef, GROOMING_KEY, markWeekly, setPaid, toggleStep, weeklyItems, type Grooming, type GroomView } from '@core/grooming'
import { workToday } from '@core/lifeFit'
import { LedgerError } from '@core/ledger'
import { readSetting, writeSetting } from '../../../main/settings'
import { readLifeFit, sleepWindow } from './lifeFitStore'
import type { Services } from './webServices'

export const readCare = (db: any): SleepCare => cleanCare(readSetting(db, SLEEP_CARE_KEY))
export const saveCare = (db: any, c: SleepCare): SleepCare => {
  const clean = cleanCare(c)
  writeSetting(db, SLEEP_CARE_KEY, clean as unknown as Record<string, unknown>)
  return clean
}
export const readGrooming = (db: any): Grooming => cleanGrooming(readSetting(db, GROOMING_KEY))
const saveGrooming = (db: any, g: Grooming): Grooming => {
  const clean = cleanGrooming(g)
  writeSetting(db, GROOMING_KEY, clean as unknown as Record<string, unknown>)
  return clean
}

/** Tonight's bedtime target (the sleep targets, My life's default when none is set). */
const bedOf = (s: Services, db: any): string => {
  try {
    return s.sleep.bedtimeTarget() || sleepWindow(db).bed
  } catch {
    return sleepWindow(db).bed
  }
}

export function careView(s: Services, db: any, now = new Date()): CareView {
  const today = s.wallet.today(now)
  const care = readCare(db)
  const bed = bedOf(s, db)
  const fit = readLifeFit(db)
  const logs = s.sleep.logs()
  const debt = sleepDebt(logs, today, care.needH)
  const advice = debtAdvice(debt, { now: now.getTime(), today, bed, free: (day) => !workToday(fit, day) || workToday(fit, day)?.mode === 'off' })
  const plan = afterShiftPlan(fit, today, bed)
  return { today, care, bed, caffeine: caffeineView(care, today, now.getTime(), bed), debt, advice, shift: plan ? { start: plan.start, lightsOut: plan.lightsOut, done: care.days[today]?.shift ?? [] } : null }
}

/** A coffee logged (☕ on Sleep, the island, "coffee" on Telegram or in Ben's chat); the reply says the curfew. */
export function logCoffee(s: Services, db: any, cups = 1, now = new Date()): { reply: string; view: CareView } {
  const today = s.wallet.today(now)
  saveCare(db, addCoffee(readCare(db), today, now.getTime(), cups))
  const view = careView(s, db, now)
  return { reply: coffeeReply(view.caffeine, view.bed), view }
}

export function takeBackCoffee(s: Services, db: any, now = new Date()): CareView {
  saveCare(db, undoCoffee(readCare(db), s.wallet.today(now)))
  return careView(s, db, now)
}

export function careLight(s: Services, db: any, now = new Date()): CareView {
  saveCare(db, markLight(readCare(db), s.wallet.today(now), now.getTime()))
  return careView(s, db, now)
}

export function careWarm(s: Services, db: any, now = new Date()): CareView {
  saveCare(db, markWarm(readCare(db), s.wallet.today(now), now.getTime()))
  return careView(s, db, now)
}

export function carePrefs(s: Services, db: any, p: { needH?: number; curfewH?: number }, now = new Date()): CareView {
  saveCare(db, setCarePrefs(readCare(db), p))
  return careView(s, db, now)
}

/** The after-shift checklist; teeth and skin also tick tonight's grooming steps (teeth, wash face, moisturiser). */
export function shiftStep(s: Services, db: any, step: string, on: boolean, now = new Date()): CareView {
  const today = s.wallet.today(now)
  saveCare(db, toggleShiftStep(readCare(db), today, step, on))
  const link = step === 'teeth' ? ['teeth_pm'] : step === 'skin' ? ['wash_pm', 'moist_pm'] : []
  if (link.length && on) {
    let g = readGrooming(db)
    for (const id of link) g = toggleStep(g, today, id, true)
    saveGrooming(db, g)
    settleGrooming(s, db, today, null)
  }
  return careView(s, db, now)
}

// ---- grooming ----

export function groomView(s: Services, db: any, sunny: boolean | null, now = new Date()): GroomView {
  const today = s.wallet.today(now)
  const g = readGrooming(db)
  const paidId = g.paid[today]
  let paid = 0
  if (paidId) {
    try {
      paid = (db.prepare('SELECT coins FROM ledger WHERE id = ?').get(paidId) as { coins: number } | undefined)?.coins ?? 0
    } catch {
      paid = 0
    }
  }
  return { today, grooming: g, day: groomDay(g, today, sunny), weekly: weeklyItems(g, today), paid }
}

/** Pays the day once every step is ticked, takes it back when one is unticked. Returns the coins paid now (0 otherwise). */
function settleGrooming(s: Services, db: any, today: string, sunny: boolean | null): number {
  let g = readGrooming(db)
  const d = groomDay(g, today, sunny)
  const act = groomPay(d, g.paid[today])
  if (act === 'pay') {
    const id = s.wallet.payOnce(GROOM_RULE, { day: today, ref: groomRef(today), note: 'Grooming: morning and night routine done' })
    if (id) {
      g = setPaid(g, today, id)
      saveGrooming(db, g)
      return (db.prepare('SELECT coins FROM ledger WHERE id = ?').get(id) as { coins: number } | undefined)?.coins ?? 0
    }
  } else if (act === 'undo') {
    try {
      s.wallet.undo(g.paid[today], 'Grooming: a step was taken back')
    } catch (e) {
      if (!(e instanceof LedgerError)) throw e
    }
    saveGrooming(db, setPaid(g, today, null))
  }
  return 0
}

export function groomStep(s: Services, db: any, id: string, on: boolean, sunny: boolean | null, now = new Date()): GroomView & { coins: number } {
  const today = s.wallet.today(now)
  saveGrooming(db, toggleStep(readGrooming(db), today, id, on))
  const coins = settleGrooming(s, db, today, sunny)
  return { ...groomView(s, db, sunny, now), coins }
}

export function groomWeekly(s: Services, db: any, id: 'nails' | 'haircut', done: boolean, sunny: boolean | null, now = new Date()): GroomView {
  saveGrooming(db, markWeekly(readGrooming(db), id, done ? s.wallet.today(now) : null))
  return groomView(s, db, sunny, now)
}

export function groomRhythm(s: Services, db: any, weeks: number, sunny: boolean | null, now = new Date()): GroomView {
  saveGrooming(db, { ...readGrooming(db), haircutWeeks: weeks })
  return groomView(s, db, sunny, now)
}

/** Ben's prompt: the sleep debt (and what to do) and tonight's after-shift plan. */
export function careContext(s: Services, db: any, now = new Date()): string[] {
  try {
    const v = careView(s, db, now)
    const fit = readLifeFit(db)
    return [debtLine(v.debt, v.advice), afterShiftLine(afterShiftPlan(fit, v.today, v.bed)), v.caffeine.cups ? `Caffeine today: ${v.caffeine.line}.` : ''].filter(Boolean)
  } catch {
    return []
  }
}
