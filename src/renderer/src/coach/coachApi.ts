// life.coach.today: the coach's day and week on this device's copy of the
// database. Writes go through the services' write (synced like everything
// else). A meal tick can log the slot's usual meal through the food counter's
// own addFoodMeal (Undo = toggleFoodMeal). Nothing here pays points.
import { addDays } from '@core/dates'
import { sportToday } from '@core/sportShared'
import { baselineFrom, cleanCoach, type CoachConfig } from '@core/coachConfig'
import { checkinData as checkinOf, coachContext, dayOf, nudgeConditions, toggleManual, withCheckin, type DailyPlan, type Tick } from '@core/coachPlan'
import { dayLineFrom, lineToShow, needsAi, planKey, aiPrompt } from '@core/coachText'
import { redFlag } from '@core/coachSafety'
import { answerDecision, openDecisions, type Decision, type WeekReview } from '@core/coachWeek'
import { itemsOf, itemsText, slotItems } from '@core/foodSaved'
import { answerAdjust, addFoodMeal, foodDayTotals, readFoodSaved, toggleFoodMeal } from '../../../main/food'
import { coachToday, kcalDays, loadCoach, loadDays, loadWeeks, saveCoach, saveDays, saveWeeks, ticksNow, weekReviewOf } from './coachStore'

type Svc = { read<T>(f: (s: any) => T): Promise<T>; write<T>(f: (s: any) => T, event?: string): Promise<T> }
export type AskAi = (prompt: string) => Promise<{ text: string; model: string }>

export interface CoachView {
  today: string
  config: CoachConfig
  plan: DailyPlan
  ticks: Record<string, Tick>
  line: { line: string; tip: string; src: 'ai' | 'template' }
  /** The weekly review has open decisions, or it is Sunday. */
  weekDue: boolean
}

export interface CoachWeekView {
  review: WeekReview
  open: Decision[]
  applied: string[]
}

const changed = (name = 'life-coach-changed') => {
  try {
    window.dispatchEvent(new CustomEvent(name))
  } catch {
    /* not in a page */
  }
}

export function coachApi(svcP: Promise<Svc>, device: () => string, ask?: AskAi) {
  const read = async <T>(f: (db: any) => T) => (await svcP).read((s) => f(s.db))
  const write = async <T>(f: (db: any) => T) => {
    const out = await (await svcP).write((s) => f(s.db))
    changed()
    return out
  }
  const viewOf = (db: any, st: any, save: boolean): CoachView => {
    const t = coachToday(db, st)
    const ticks = ticksNow(db, t, save)
    const day = dayOf(t.days, t.today)
    const dow = new Date(`${t.today}T12:00:00Z`).getUTCDay()
    return { today: t.today, config: t.config, plan: t.plan, ticks, line: lineToShow(t.plan, t.config.lang, day.ai), weekDue: dow === 0 }
  }
  const weekOf = (db: any, st: any): CoachWeekView => {
    const review = weekReviewOf(db, st)
    const w = loadWeeks(db)
    return { review, open: openDecisions(w, review), applied: Object.keys(w.weeks[review.week]?.applied ?? {}) }
  }
  return {
    /** Today's plan, ticks and line. Saves the day's short record when it changed. */
    view: async (st?: any): Promise<CoachView> => {
      const svc = await svcP
      const v = await svc.read((s) => viewOf(s.db, st, false))
      // Write the day's record only when it is new or different (no write on every look).
      const days = await svc.read((s) => loadDays(s.db, v.today))
      const snap = dayOf(days, v.today).snap
      const ticked = Object.values(v.ticks).filter(Boolean).length
      const train = v.plan.training.kind === 'session' ? v.plan.training.type : v.plan.training.kind === 'done' ? 'done' : 'rest'
      if (!snap || snap.ticked !== ticked || snap.train !== train || snap.kcal !== v.plan.food.kcal) await svc.write((s) => viewOf(s.db, st, true))
      return v
    },
    /**
     * The day's line + tip: asked of the AI once a morning (kept in coach_days), the template when the AI
     * fails or the budget is out (tried again after 2 h, twice at most).
     */
    line: async (st?: any): Promise<CoachView['line']> => {
      const t = await read((db) => coachToday(db, st))
      const prev = dayOf(t.days, t.today).ai
      if (!needsAi(prev, Date.now(), t.config.ai && !!ask, planKey(t.plan))) return lineToShow(t.plan, t.config.lang, prev)
      let text: string | null = null
      try {
        text = (await ask!(aiPrompt(t.plan, t.config.lang, coachContext(t.config, t.days, t.plan, t.today)))).text
      } catch {
        text = null
      }
      return write((db) => {
        const days = loadDays(db, t.today)
        const line = dayLineFrom(t.plan, t.config.lang, text, dayOf(days, t.today).ai, Date.now())
        saveDays(db, { ...days, days: { ...days.days, [t.today]: { ...dayOf(days, t.today), ai: line } } }, t.today)
        return lineToShow(t.plan, t.config.lang, line)
      })
    },
    /** Your own tick (meals, bed) on or off. A workout or weigh-in ticks only from a real log. */
    tick: async (id: string, st?: any) =>
      write((db) => {
        const t = coachToday(db, st)
        saveDays(db, toggleManual(t.days, t.plan, t.today, id, Date.now()), t.today)
        return viewOf(db, st, true)
      }),
    /** Logs the slot's usual meal (the standard day's items) now: a real food log, so the tick follows. */
    logMeal: async (slotId: string, st?: any): Promise<{ view: CoachView; ids: string[] }> => {
      const out = await write((db) => {
        const saved = readFoodSaved(db)
        const slot = saved.day.slots.find((x) => x.id === slotId)
        if (!slot) throw new Error('That meal is not in your standard day')
        const items = slotItems(slot)
        const r = addFoodMeal(db, { items: itemsOf(saved, items), name: `${slot.label}: ${itemsText(saved, items)}`.slice(0, 60), type: slot.slot, source: 'saved', slot: slot.id }, device())
        return { view: viewOf(db, st, true), ids: r ? [r.id] : [] }
      })
      changed('life-body-changed')
      return out
    },
    /** Takes a logged meal back (the Undo after logMeal). */
    undoMeal: async (ids: string[], st?: any) => {
      const out = await write((db) => {
        for (const id of ids) toggleFoodMeal(db, id, device())
        return viewOf(db, st, true)
      })
      changed('life-body-changed')
      return out
    },
    config: () => read((db) => loadCoach(db)),
    saveConfig: (patch: Partial<CoachConfig>) =>
      write((db) => {
        saveCoach(db, cleanCoach({ ...loadCoach(db), ...patch }))
        return loadCoach(db)
      }),
    /** Starts the 2-week ramp-up today, from what you logged in the last 14 days (else the number you give). */
    startRamp: (baseline?: number | null) =>
      write((db) => {
        const today = sportToday()
        const b = baseline ?? baselineFrom(kcalDays(db, addDays(today, -14), addDays(today, -1)), today) ?? 1500
        saveCoach(db, cleanCoach({ ...loadCoach(db), ramp: { start: today, baseline: b } }))
        return loadCoach(db)
      }),
    dismissBlood: () =>
      write((db) => {
        saveCoach(db, cleanCoach({ ...loadCoach(db), bloodDismissed: sportToday() }))
        return true as const
      }),
    /** The weekly review (Sunday this week, Monday last week, else this week so far) and its open decisions. */
    week: (st?: any) => read((db) => weekOf(db, st)),
    /**
     * Answers a decision. Calories go through the food counter's own check (re-checked there, the safety
     * rules already applied); a level-up or a lighter week is written by the page in Sport Track's state
     * first (the roadmap's and the warnings' own functions), then recorded here.
     */
    decide: (id: string, apply: boolean, st?: any) =>
      write((db) => {
        const v = weekOf(db, st)
        const d = v.review.decisions.find((x) => x.id === id)
        if (!d) throw new Error('That decision is no longer open')
        if (apply && d.kind === 'kcal') answerAdjust(db, true)
        if (!apply && d.kind === 'kcal') answerAdjust(db, false)
        saveWeeks(db, answerDecision(loadWeeks(db), v.review, id, apply, Date.now()))
        return weekOf(db, st)
      }),
    // ---- for the next step (check-in, nudges, chat) ----
    checkin: (c: { energy: number; soreness: number; note?: string }, date?: string) =>
      write((db) => {
        const today = sportToday()
        const d = date ?? today
        saveDays(db, withCheckin(loadDays(db, today), d, c, Date.now()), today)
        return checkinOf(loadDays(db, today), d)
      }),
    checkinData: (date?: string) => read((db) => checkinOf(loadDays(db, sportToday()), date ?? sportToday())),
    context: (st?: any) =>
      read((db) => {
        const t = coachToday(db, st)
        return coachContext(t.config, t.days, t.plan, t.today)
      }),
    redFlag: (text: string) => read((db) => redFlag(text, loadCoach(db).lang)),
    nudges: (now = new Date(), sent: string[] = [], st?: any) =>
      read((db) => {
        const t = coachToday(db, st, now)
        return nudgeConditions({ minute: now.getHours() * 60 + now.getMinutes(), plan: t.plan, proteinEaten: foodDayTotals(db, now).protein, checkinDone: !!dayOf(t.days, t.today).checkin, sent })
      })
  }
}
export type CoachApi = ReturnType<typeof coachApi>
