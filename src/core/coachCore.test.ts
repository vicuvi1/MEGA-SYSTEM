// The coach core: the day's plan, ramp-up, checklist, ticks from real logs,
// the weekly decisions, the safety rules and the day's line. Made-up data,
// fixed dates (2026-11-09 is a Monday).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baselineFrom, cleanCoach, coachWeekNo, DEFAULT_COACH, rampKcal } from './coachConfig'
import { addOnsFor, bloodTestDue, KCAL_FLOOR, lowIntake, redFlag, safeKcalChange, safeText, weightRising } from './coachSafety'
import { changeLine, checkinData, cleanDays, coachContext, dailyPlan, DAYS_KEEP, nudgeConditions, snapOf, ticksOf, toggleManual, withCheckin, withSnap, type PlanInputs } from './coachPlan'
import { aiPrompt, dayLineFrom, lineToShow, needsAi, parseAiLine, planKey, templateLine, AI_RETRY_MS } from './coachText'
import { answerDecision, cleanWeeks, openDecisions, reviewWeek, summaryLine, weeklyReview, type WeekInput } from './coachWeek'
import { cleanWeek } from './trainWeek'
import { seedSaved } from './foodSaved'
import type { AdjustCheck } from './foodAdjust'
import type { WeekRow } from './bodyComp'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T08:30:00Z'))
})
afterEach(() => vi.useRealTimers())

const moves = {
  upper: [
    { name: 'Push-ups', sets: 4, last: 'Last time: 12 · 11 · 10 · 10 → aim to beat it' },
    { name: 'Table rows', sets: 3, last: 'Last time: 10 · 9 · 9 → aim to beat it' }
  ],
  legs: [{ name: 'Split squats', sets: 3, last: 'First time: 8–12 reps' }]
}
const base = (over: Partial<PlanInputs> = {}): PlanInputs => ({
  date: '2026-11-10',
  config: cleanCoach(null),
  week: cleanWeek(null),
  done: [],
  moves,
  minutes: { upper: 28, legs: 26 },
  food: { goal: 2700, protein: 125, saved: seedSaved(), adjLog: [] },
  intake: [],
  ...over
})

describe('training: session, rest, missed', () => {
  it('Tuesday is upper body with beat-last-time targets', () => {
    const p = dailyPlan(base())
    expect(p.training.kind).toBe('session')
    if (p.training.kind !== 'session') return
    expect(p.training.type).toBe('upper')
    expect(p.training.minutes).toBe(28)
    expect(p.training.moves[0].last).toMatch(/beat it/)
    expect(p.training.line).toMatch(/6–12 reps, stop with 1–3 reps left/)
    expect(p.checks.map((c) => c.id)).toContain('workout')
    expect(p.focus).toBe('beat-last')
  })
  it('never more than the max minutes', () => {
    const p = dailyPlan(base({ minutes: { upper: 45, legs: 40 } }))
    expect(p.training.kind === 'session' && p.training.minutes).toBe(30)
  })
  it('Monday is a rest day: walk and eat; no workout check, no warm-up in the routine', () => {
    const p = dailyPlan(base({ date: '2026-11-09' }))
    expect(p.training.kind).toBe('rest')
    expect(p.training.line).toBe('Rest day: walk 20 min, eat everything.')
    expect(p.checks.some((c) => c.kind === 'workout')).toBe(false)
    expect(p.morning.map((s) => s.id)).toEqual(['snack', 'wait', 'shower', 'breakfast'])
  })
  it('a missed session moves to a rest day when it keeps 48 h', () => {
    // Fri 13th is rest; Thu 12th's upper didn't happen; upper last on Tue 10th.
    const p = dailyPlan(base({ date: '2026-11-13', done: [{ date: '2026-11-10', type: 'upper' }, { date: '2026-11-11', type: 'legs' }] }))
    expect(p.training.kind === 'session' && p.training.catchUp).toBe(true)
    expect(p.training.kind === 'session' && p.training.type).toBe('upper')
    expect(p.focus).toBe('catch-up')
  })
  it('the 48 h rule: legs yesterday → upper today instead', () => {
    const p = dailyPlan(base({ date: '2026-11-14', done: [{ date: '2026-11-13', type: 'legs' }] }))
    expect(p.training.kind === 'session' && p.training.type).toBe('upper')
  })
  it('done for today once a session is logged', () => {
    const p = dailyPlan(base({ done: [{ date: '2026-11-10', type: 'upper' }] }))
    expect(p.training.kind).toBe('done')
    expect(p.checks.some((c) => c.kind === 'workout')).toBe(true)
  })
})

describe('food: ramp-up, floor, checklist', () => {
  it('week 1 = baseline + half the gap, week 2 = the goal, never under 2,200', () => {
    const cfg = { ramp: { start: '2026-11-09', baseline: 1900 } }
    expect(rampKcal(cfg, 2700, '2026-11-08')).toEqual({ kcal: 2700, week: null })
    expect(rampKcal(cfg, 2700, '2026-11-10')).toEqual({ kcal: 2300, week: 1 })
    expect(rampKcal(cfg, 2700, '2026-11-16')).toEqual({ kcal: 2700, week: 2 })
    expect(rampKcal(cfg, 2700, '2026-11-23')).toEqual({ kcal: 2700, week: null })
    expect(rampKcal({ ramp: { start: '2026-11-09', baseline: 1100 } }, 2700, '2026-11-10').kcal).toBe(KCAL_FLOOR)
    expect(rampKcal({ ramp: { start: null, baseline: null } }, 1800, '2026-11-10').kcal).toBe(KCAL_FLOOR)
  })
  it('the baseline is the average of logged days before the start', () => {
    expect(baselineFrom([{ day: '2026-11-01', kcal: 1100 }, { day: '2026-11-03', kcal: 1300 }, { day: '2026-11-05', kcal: 1200 }, { day: '2026-11-09', kcal: 3000 }], '2026-11-09')).toBe(1200)
    expect(baselineFrom([{ day: '2026-11-01', kcal: 1100 }], '2026-11-09')).toBeNull()
    expect(coachWeekNo({ ramp: { start: '2026-11-01', baseline: 1200 } }, '2026-11-15')).toBe(3)
  })
  it('meals come from the standard day; add-ons fill the gap to the goal', () => {
    const p = dailyPlan(base())
    expect(p.food.meals.map((m) => m.id)).toEqual(['ds-morning', 'ds-lunch', 'ds-afternoon', 'ds-evening', 'ds-anytime'])
    expect(p.food.standard).toBe(2332)
    expect(p.food.extras).toEqual(['+1 glass of milk', '+1 spoon of peanut butter', '+1 banana'])
    expect(p.checks.filter((c) => c.kind === 'meal')).toHaveLength(5)
  })
  it('an accepted +200 shows as this week\'s change', () => {
    const adjLog = [{ day: '2026-11-08', delta: 200, after: 200, reason: 'Weight flat for 2 weeks' }]
    const p = dailyPlan(base({ food: { goal: 2900, protein: 125, saved: seedSaved(), adjLog } }))
    expect(p.food.change).toBe('+200 kcal this week: 1 glass of milk + 1 spoon of peanut butter a day')
    expect(p.food.kcal).toBe(2900)
    expect(changeLine(adjLog, '2026-11-20')).toBeNull()
  })
  it('without a standard day: generic meals from the config', () => {
    const saved = { ...seedSaved(), day: { slots: [] } }
    const p = dailyPlan(base({ food: { goal: 2700, protein: 125, saved, adjLog: [] } }))
    expect(p.food.meals.map((m) => m.label)).toEqual(['Breakfast', 'Lunch', 'Snack', 'Dinner'])
  })
})

describe('ticks follow real logs; ticks pay nothing', () => {
  const plan = dailyPlan(base())
  it('logged meals tick their slot, then a free slot of the same type', () => {
    const t = ticksOf(plan, { workout: true, meals: [{ slot: 'ds-morning', type: 'breakfast' }, { type: 'lunch' }, { type: 'snack' }], weigh: false, bed: null })
    expect(t.workout).toBe('auto')
    expect(t['meal:ds-morning']).toBe('auto')
    expect(t['meal:ds-lunch']).toBe('auto')
    expect(t['meal:ds-afternoon']).toBe('auto')
    expect(t['meal:ds-anytime']).toBeNull()
    expect(t.weigh).toBeNull()
  })
  it('your own tick only where allowed (meals, bed), never a workout or weigh-in', () => {
    const t = ticksOf(plan, { workout: false, meals: [], weigh: false, bed: null }, { 'meal:ds-evening': 1, bed: 1, workout: 1, weigh: 1 })
    expect(t['meal:ds-evening']).toBe('manual')
    expect(t.bed).toBe('manual')
    expect(t.workout).toBeNull()
    expect(t.weigh).toBeNull()
    let d = cleanDays(null)
    d = toggleManual(d, plan, '2026-11-10', 'workout', 5)
    expect(d.days['2026-11-10']).toBeUndefined()
    d = toggleManual(d, plan, '2026-11-10', 'meal:ds-lunch', 5)
    expect(d.days['2026-11-10'].manual).toEqual({ 'meal:ds-lunch': 5 })
    d = toggleManual(d, plan, '2026-11-10', 'meal:ds-lunch', 6)
    expect(d.days['2026-11-10'].manual).toEqual({})
  })
  it('the day store keeps 120 days and stays under the size cap', () => {
    const days: Record<string, any> = {}
    for (let i = 0; i < 200; i++) days[new Date(Date.UTC(2026, 4, 1) + i * 864e5).toISOString().slice(0, 10)] = { manual: { bed: 1 }, ai: { line: 'x'.repeat(500), tip: 'y'.repeat(250), src: 'ai', at: 1, tries: 1 } }
    const d = cleanDays({ days }, '2026-11-16')
    expect(Object.keys(d.days).length).toBeLessThanOrEqual(DAYS_KEEP)
    expect(JSON.stringify(d).length).toBeLessThanOrEqual(120_000)
    expect(Object.keys(d.days).sort().pop()).toBe('2026-11-16')
  })
  it('snapshot written only when it changes; check-in kept', () => {
    let d = cleanDays(null)
    const s = snapOf(plan, {})
    const next = withSnap(d, '2026-11-10', s)
    expect(next).not.toBeNull()
    d = next!
    expect(withSnap(d, '2026-11-10', s)).toBeNull()
    d = withCheckin(d, '2026-11-10', { energy: 9, soreness: 2 }, 7)
    expect(checkinData(d, '2026-11-10').checkin).toEqual({ energy: 5, soreness: 2, at: 7 })
    expect(coachContext(DEFAULT_COACH, d, plan, '2026-11-11')).toMatch(/Last days: 11-10 upper/)
  })
})

describe('safety rules', () => {
  it('never under 2,200; no cut while the weight is not rising', () => {
    expect(safeKcalChange({ delta: -150, target: 2700, rising: false }).delta).toBe(0)
    expect(safeKcalChange({ delta: -150, target: 2300, rising: true }).delta).toBe(0)
    expect(safeKcalChange({ delta: -150, target: 2700, rising: true }).delta).toBe(-150)
    expect(safeKcalChange({ delta: 200, target: 2000, rising: false }).delta).toBe(200)
    const w = (avg: number): WeekRow => ({ week: '', avg, n: 4, enough: true, kcal: null, kcalDays: 0 })
    expect(weightRising([w(70), w(70.05)])).toBe(false)
    expect(weightRising([w(70), w(70.3)])).toBe(true)
  })
  it('under 1,600 kcal on 3+ recent days → a gentle note with easy add-ons', () => {
    const days = ['2026-11-04', '2026-11-05', '2026-11-07'].map((day) => ({ day, kcal: 1200 }))
    const n = lowIntake([...days, { day: '2026-11-10', kcal: 300 }], '2026-11-10')
    expect(n?.days).toBe(3)
    expect(n?.text).toMatch(/glass of milk.*banana/)
    expect(n?.text).not.toMatch(/should|must|bad|fail/i)
    expect(lowIntake(days.slice(0, 2), '2026-11-10')).toBeNull()
    const p = dailyPlan(base({ intake: days }))
    expect(p.focus).toBe('eat-more')
    expect(p.notes.some((x) => x.id === 'low')).toBe(true)
    expect(addOnsFor(30)).toEqual([])
  })
  it('red flags in English and Romanian; soreness is not one', () => {
    expect(redFlag('felt dizzy after push-ups').hit).toBe(true)
    expect(redFlag('I have chest pain when I train').words).toEqual(['chest pain'])
    expect(redFlag('almost fainted in the shower').hit).toBe(true)
    expect(redFlag('sharp pain in my knee').hit).toBe(true)
    expect(redFlag('my muscles are sore, legs hurt a bit').hit).toBe(false)
    expect(redFlag('no dizziness today, all good').hit).toBe(false)
    expect(redFlag('am fost ametit dupa antrenament').hit).toBe(true)
    expect(redFlag('am avut ameteală azi').reply).toMatch(/medic/)
    expect(redFlag('durere în piept la flotări').hit).toBe(true)
    expect(redFlag('am leșinat').words).toEqual(['fainting'])
    expect(redFlag('am febră musculară').hit).toBe(false)
    expect(redFlag('felt dizzy').reply).toMatch(/Stop training.*doctor/)
    expect(redFlag('felt dizzy').reply).not.toMatch(/\breps?\b|\bset\b/)
  })
  it('no body put-downs, no fat burners, no cut talk', () => {
    expect(safeText('Great week. You look skinny. Keep eating.')).toBe('Great week. Keep eating.')
    expect(safeText('Try a fat burner. Drink water.')).toBe('Drink water.')
    expect(safeText('Eat less bread. Sleep well.')).toBe('Sleep well.')
    expect(safeText('Aim for 1,900 kcal today. Sleep well.')).toBe('Sleep well.')
    expect(safeText('Add 1 spoon of peanut butter.')).toBe('Add 1 spoon of peanut butter.')
  })
  it('blood test: from the start until dismissed, then monthly', () => {
    expect(bloodTestDue({ bloodDismissed: null, ramp: { start: '2026-11-09' } }, '2026-11-10')).toBe(true)
    expect(bloodTestDue({ bloodDismissed: null, ramp: { start: '2026-11-12' } }, '2026-11-10')).toBe(false)
    expect(bloodTestDue({ bloodDismissed: '2026-11-10', ramp: { start: '2026-11-09' } }, '2026-11-20')).toBe(false)
    expect(bloodTestDue({ bloodDismissed: '2026-11-10', ramp: { start: '2026-11-09' } }, '2026-12-10')).toBe(true)
    const p = dailyPlan(base({ config: cleanCoach({ ramp: { start: '2026-11-09', baseline: 1500 } }) }))
    expect(p.notes.find((n) => n.id === 'blood')?.text).toMatch(/hemogram, ferritin, vitamin D and B12/)
  })
})

describe('the day line: AI once a morning, template on failure', () => {
  const plan = dailyPlan(base())
  it('AI failure → template from the plan numbers', () => {
    const l = dayLineFrom(plan, 'en', null, undefined, 1000)
    expect(l.src).toBe('template')
    expect(l.line).toBe('Today: Upper body, 28 min. Eat 2,700 kcal over 5 meals.')
    expect(l.tries).toBe(1)
    expect(templateLine(plan, 'ro').line).toMatch(/^Azi: Upper body, 28 min\. Mănâncă 2,700 kcal în 5 mese\.$/)
  })
  it('the AI text is used only when every number is from the plan and it is short and safe', () => {
    expect(parseAiLine('{"line":"Upper body today, 28 min.","tip":"Beat 12 push-ups on set one."}', plan)).toEqual({ line: 'Upper body today, 28 min.', tip: 'Beat 12 push-ups on set one.' })
    expect(parseAiLine('{"line":"Do 45 min today.","tip":"Go."}', plan)).toBeNull()
    expect(parseAiLine('not json', plan)).toBeNull()
    expect(parseAiLine(JSON.stringify({ line: 'word '.repeat(90), tip: 'x' }), plan)).toBeNull()
    expect(parseAiLine('{"line":"You look skinny.","tip":"Eat."}', plan)).toBeNull()
    const ok = dayLineFrom(plan, 'en', '{"line":"Upper body today, 28 min.","tip":"Eat all 5 meals."}', undefined, 5)
    expect(ok.src).toBe('ai')
    expect(aiPrompt(plan, 'ro', '')).toMatch(/Romanian/)
  })
  it('a kept AI line is shown only while the plan is the same', () => {
    const ai = dayLineFrom(plan, 'en', '{"line":"Upper body today, 28 min.","tip":"Eat all 5 meals."}', undefined, 5)
    expect(ai.key).toBe(planKey(plan))
    expect(lineToShow(plan, 'en', ai).src).toBe('ai')
    const rest = dailyPlan(base({ date: '2026-11-09' }))
    expect(lineToShow(rest, 'en', ai)).toEqual({ ...templateLine(rest, 'en'), src: 'template' })
    expect(needsAi(ai, 6, true, planKey(rest))).toBe(true)
    expect(needsAi({ ...ai, tries: 3 }, 6, true, planKey(rest))).toBe(false)
  })
  it('asked once a day: an AI line is kept; a template is retried after 2 h, twice at most', () => {
    const now = 10 * AI_RETRY_MS
    expect(needsAi(undefined, now, true)).toBe(true)
    expect(needsAi(undefined, now, false)).toBe(false)
    expect(needsAi({ line: 'a', tip: 'b', src: 'ai', lang: 'en', at: now - 9 * AI_RETRY_MS, tries: 1 }, now, true)).toBe(false)
    expect(needsAi({ line: 'a', tip: 'b', src: 'template', lang: 'en', at: now - 1000, tries: 1 }, now, true)).toBe(false)
    expect(needsAi({ line: 'a', tip: 'b', src: 'template', lang: 'en', at: now - AI_RETRY_MS, tries: 1 }, now, true)).toBe(true)
    expect(needsAi({ line: 'a', tip: 'b', src: 'template', lang: 'en', at: now - AI_RETRY_MS, tries: 2 }, now, true)).toBe(false)
  })
})

describe('nudges', () => {
  const plan = dailyPlan(base())
  it('morning, midday protein under 40% by 14:00, evening check-in', () => {
    const at = (h: number, m = 0) => h * 60 + m
    expect(nudgeConditions({ minute: at(7), plan, proteinEaten: 0, checkinDone: false, sent: [] }).morning).toBe(true)
    expect(nudgeConditions({ minute: at(7), plan, proteinEaten: 0, checkinDone: false, sent: ['morning'] }).morning).toBe(false)
    expect(nudgeConditions({ minute: at(14), plan, proteinEaten: 40, checkinDone: false, sent: [] }).protein).toBe(true)
    expect(nudgeConditions({ minute: at(14), plan, proteinEaten: 60, checkinDone: false, sent: [] }).protein).toBe(false)
    expect(nudgeConditions({ minute: at(13, 59), plan, proteinEaten: 0, checkinDone: false, sent: [] }).protein).toBe(false)
    expect(nudgeConditions({ minute: at(21), plan, proteinEaten: 0, checkinDone: false, sent: [] }).checkin).toBe(true)
    expect(nudgeConditions({ minute: at(21), plan, proteinEaten: 0, checkinDone: true, sent: [] }).checkin).toBe(false)
  })
})

describe('weekly review', () => {
  const row = (week: string, avg: number | null, n = 4): WeekRow => ({ week, avg, n, enough: n >= 3, kcal: null, kcalDays: 0 })
  const suggest = (delta: number): AdjustCheck => ({ state: 'suggest', title: 't', why: 'w', perWeek: 0, suggestion: { delta, perWeek: 0, after: delta, title: delta > 0 ? `Eat ${delta} kcal more a day` : `Eat ${-delta} kcal less a day`, why: 'Because.', tip: 'Milk.', reason: 'r' } })
  const input = (over: Partial<WeekInput> = {}): WeekInput => ({
    week: '2026-11-09',
    weights: [row('2026-10-26', 70), row('2026-11-02', 70.2), row('2026-11-09', 70.5)],
    waist: 0.3,
    food: [1, 2, 3, 4, 5].map((i) => ({ day: `2026-11-1${i}`, kcal: 2600, protein: 120 })),
    sessions: { done: 5, planned: 5 },
    levelUps: ['Archer push-ups'],
    ready: [],
    checkins: [],
    adjust: { state: 'none', kind: 'ontrack', title: 'On track', why: '', perWeek: 0.3 },
    target: 2700,
    tired: false,
    lighterOn: false,
    weekNo: 3,
    ...over
  })
  it('the summary line', () => {
    const r = weeklyReview(input())
    expect(r.summary).toBe('Week 3: +0.3 kg, 5/5 workouts, archer push-ups unlocked. Keep going.')
    expect(r.stats.kcal).toBe(2600)
    expect(r.stats.change).toBe(0.3)
    expect(summaryLine({ weekNo: null, sessions: { done: 3, planned: 5 }, levelUps: [] }, -0.3)).toBe('This week: −0.3 kg (eat a bit more), 3/5 workouts. Next week: one more session.')
  })
  it('+200 is a decision; a cut needs a rising weight and the 2,200 floor', () => {
    expect(weeklyReview(input({ adjust: suggest(200) })).decisions.map((d) => d.id)).toEqual(['kcal'])
    const flat = input({ adjust: suggest(-150), weights: [row('2026-11-02', 70.2), row('2026-11-09', 70.2)] })
    expect(weeklyReview(flat).decisions).toEqual([])
    expect(weeklyReview(flat).notes[0]).toMatch(/No cut/)
    const floor = weeklyReview(input({ adjust: suggest(-150), target: 2300 }))
    expect(floor.decisions).toEqual([])
    expect(floor.notes[0]).toMatch(/2,200/)
    expect(weeklyReview(input({ adjust: suggest(-150) })).decisions[0].delta).toBe(-150)
  })
  it('level ups and a lighter week; answered decisions close', () => {
    const r = weeklyReview(input({ ready: [{ ladder: 'push', index: 4, name: 'Archer push-ups' }], tired: true }))
    expect(r.decisions.map((d) => d.id)).toEqual(['level:push', 'lighter'])
    let w = cleanWeeks(null)
    w = answerDecision(w, r, 'level:push', true, 9)
    expect(openDecisions(w, r).map((d) => d.id)).toEqual(['lighter'])
    expect(w.weeks['2026-11-09'].summary).toBe(r.summary)
    expect(weeklyReview(input({ tired: true, lighterOn: true })).decisions).toEqual([])
    expect(weeklyReview(input({ checkins: [5, 5, 5].map(() => ({ energy: 2, soreness: 4 })) })).decisions.map((d) => d.id)).toEqual(['lighter'])
  })
  it('low weekly intake → a note, never guilt', () => {
    const r = weeklyReview(input({ food: [1, 2, 3].map((i) => ({ day: `2026-11-1${i}`, kcal: 1300, protein: 60 })) }))
    expect(r.notes.join(' ')).toMatch(/about 1,300 kcal.*glass of milk/)
  })
  it('which week: Sunday this week, Monday last week', () => {
    expect(reviewWeek('2026-11-15')).toBe('2026-11-09')
    expect(reviewWeek('2026-11-16')).toBe('2026-11-09')
    expect(reviewWeek('2026-11-18')).toBe('2026-11-16')
  })
})
