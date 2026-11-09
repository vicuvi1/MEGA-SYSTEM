// What the goal ladder screens call (life.saga.ladder): read the view, and the
// few writes (critical goals and "Not now", targets, milestones, reviews).
// Every write goes through the core cleaners. Reviews pay no points; picking
// next week's top 3 saves the existing week plan (big 3 + parked).
import { activate, confirmMilestones, milestonesOf, quarterLine, markMonthReviewed, markReviewed, monthKey, monthlyReviewData, monthToReview, park, setResultTarget, setTarget, swap, weeklyReviewData, weeklyReviewDue, type LadderMilestone, type Metric, type TemplateId } from '@core/goalLadder'
import { placeWeekSteps } from '@core/ladderPlan'
import { cleanWeek, dayRooms, PLAN_WEEK } from '@core/planWeek'
import { cleanLimits, PLAN_LIMITS } from '@core/planLimits'
import { addDays } from '@core/dates'
import { planFromPicks, type WeekPlan } from '@core/weekPlan'
import { getSetting } from '../../../main/settings'
import { sportBlob } from '../../../main/bodyLog'
import { trainOf } from '@core/trainLog'
import { financeStateFrom } from './botBrain'
import { ladderView, loadLadder, saveLadder, type LadderView } from './ladderStore'
import type { Services, WebServices } from './webServices'

const readJson = (db: any, key: string): any => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}

/** The week's steps placed as drafts (study sessions in your week plan's room, workouts on your split). */
function weekSteps(s: Services, v: LadderView) {
  const limits = cleanLimits(readJson(s.db, PLAN_LIMITS))
  const week = cleanWeek(readJson(s.db, PLAN_WEEK))
  const days = 7 - ((new Date(`${v.today}T12:00:00Z`).getUTCDay() + 6) % 7)
  const rooms = dayRooms({ today: v.today, now: '08:00', days, events: [], week, limits })
  const split = trainOf(sportBlob(s.db)).week.days
  return placeWeekSteps({ ladder: v.ladder, facts: v.facts, today: v.today, rooms, existing: [], split })
}

export function createLadder(svcP: Promise<WebServices>) {
  const fin = (s: Services) => financeStateFrom(s.db, typeof localStorage !== 'undefined' ? localStorage : null)
  const read = async <T>(fn: (s: Services) => T) => (await svcP).read(fn)
  const write = async <T>(fn: (s: Services) => T) => (await svcP).write(fn, 'life-saga-changed')
  const edit = (fn: (l: ReturnType<typeof loadLadder>) => ReturnType<typeof loadLadder>) =>
    write((s) => {
      saveLadder(s.db, fn(loadLadder(s.db)))
      return true as const
    })
  return {
    view: () =>
      read((s) => {
        const v = ladderView(s, { finance: fin(s) })
        const month = monthToReview(v.quarter)
        return {
          ...v,
          steps: weekSteps(s, v),
          /** Every month's milestone per critical goal (confirmed, else the suggestion), for the edit. */
          milestones: Object.fromEntries(v.cards.map((c) => [c.goal.id, milestonesOf(c.goal, v.facts, v.quarter)])) as Partial<Record<TemplateId, LadderMilestone[]>>,
          weekly: weeklyReviewData(v.ladder, v.facts, v.today),
          weeklyDue: weeklyReviewDue(v.ladder, v.today),
          monthly: month ? monthlyReviewData(v.ladder, v.facts, v.quarter, month, v.today) : null
        }
      }),
    activate: (id: TemplateId) => edit((l) => activate(l, id)),
    park: (id: TemplateId) => edit((l) => park(l, id)),
    swap: (outId: TemplateId, inId: TemplateId) => edit((l) => swap(l, outId, inId)),
    setTarget: (id: TemplateId, metric: Metric, n: number) => edit((l) => setTarget(l, id, metric, n)),
    setResultTarget: (id: TemplateId, n: number | null) => edit((l) => setResultTarget(l, id, n)),
    confirmMilestones: (id: TemplateId, ms: LadderMilestone[]) => edit((l) => confirmMilestones(l, id, ms)),
    /** The Sunday review's end: next week's top 3 become the week plan's big 3 (the rest parked), and the week is marked reviewed. */
    finishWeek: (week: string, chips: string[], picked: string[]) =>
      write((s): WeekPlan => {
        const next = addDays(week, 7)
        const plan = s.weekPlan.save(planFromPicks(s.weekPlan.saved(), next, chips, picked))
        saveLadder(s.db, markReviewed(loadLadder(s.db), week))
        return plan
      }).then((p) => {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-week-changed'))
        return p
      }),
    /** The monthly review's end (the milestone edits are saved with confirmMilestones first). */
    finishMonth: (month: number) =>
      write((s) => {
        const l = loadLadder(s.db)
        const v = ladderView(s, { finance: fin(s) })
        saveLadder(s.db, markMonthReviewed(l, monthKey(v.quarter, month)))
        return true as const
      }),
    /** The one line on Today ("Quarter goal: … · this week 3/5 workouts, 5/7 protein days"), and its light. */
    line: () =>
      read((s) => {
        const v = ladderView(s, { finance: fin(s) })
        const c = v.cards.find((x) => quarterLine([x]) === quarterLine(v.cards)) ?? v.cards[0]
        return { text: quarterLine(v.cards), light: c?.week.light ?? 'none', fix: c?.fix ?? null }
      }),
    /** Next week's top 3 from the ladder, for the Sunday pick on Today. */
    top3: () => read((s) => weeklyReviewData(loadLadder(s.db), ladderView(s, { finance: fin(s) }).facts, s.wallet.today()).top3)
  }
}
export type LadderApi = ReturnType<typeof createLadder>
export type LadderScreen = Awaited<ReturnType<LadderApi['view']>>
