import { describe, expect, it } from 'vitest'
import { RULES, bodyLines, coachCard, deloadCheck, muscleLoad, overload, priority, restFor, sessionPlan, trainedWeeks } from './sportCoachRules'
import { adjustAfterSession } from './sportAdjust'
import { baseProgram, enforce, reviewDue, reviewFacts, weeklyReview } from './sportReview'
import { answerTraining, isTrainingQuestion } from './sportAsk'
import { QUESTIONS, placeAll, placeBest, strongerThan, testDue } from './sportOnboard'
import { mergeTelegramDays } from './sportTelegramImport'
import { placeFamily } from './sportLevels'
import { logBotSets, parseSportSay } from './sportBot'
import { parseTelegramText } from './botCommands'
import { addSets, type SetLog } from './sportSets'
import { MOVES, moveById } from './sportMoves'

// A made-up week: Wednesday 2026-03-11 (Monday is 2026-03-09).
const TODAY = '2026-03-11'
const T = Date.parse('2026-03-11T09:00:00Z')
const ex = [
  { id: 'p', name: 'Push-ups', target: 40, active: true },
  { id: 'r', name: 'Door rows', move: 'door_row', target: 30, active: true },
  { id: 's', name: 'Squats', target: 30, active: true }
]
const log = (rows: [string, string, number[]][]): SetLog => rows.reduce<SetLog>((l, [d, id, reps]) => addSets(l, d, id, reps, T), {})
const ctx = (sets: SetLog, extra: object = {}) => ({ exercises: ex, days: {}, sets, today: TODAY, strength: true, ...extra })

describe('the rules', () => {
  it('counts hard sets per muscle over 7 days and flags low volume and frequency', () => {
    const l = muscleLoad(ctx(log([['2026-03-09', 'p', [8, 8, 8, 8]], ['2026-03-10', 'p', [8, 8, 8]], ['2026-03-10', 's', [20, 20]]])))
    const push = l.find((x) => x.id === 'push')!
    expect(push).toMatchObject({ sets: 7, days: 2, status: 'low', freqLow: false })
    expect(l.find((x) => x.id === 'pull')!.sets).toBe(0)
    expect(l.find((x) => x.id === 'legs')).toMatchObject({ sets: 2, days: 1, freqLow: true })
  })

  it('rest suits the rep range', () => {
    const push = moveById('pushup')!
    expect(restFor(push, 6)).toBe(150)
    expect(restFor(moveById('archer_pushup')!, 6)).toBe(180)
    expect(restFor(push, 10)).toBe(105)
    expect(restFor(push, 15)).toBe(75)
    expect(restFor(moveById('plank')!, 45)).toBe(60)
  })

  it('progresses in the fixed order: reps, then the harder move, then weight at the top of the ladder', () => {
    const early = overload(ctx(log([['2026-03-09', 'p', [6, 6, 6, 6]]])), 'p')!
    expect(early.kind).toBe('reps')
    expect(early.reps).toBe(7)
    // 4×8 on the top of the range → the next variation back at the bottom of its range.
    const top = overload(ctx(log([['2026-03-09', 'p', [8, 8, 8, 8]]])), 'p')!
    expect(top.kind).toBe('harder')
    expect(top.move.id).toBe('wide_pushup')
    expect(top.reps).toBe(5)
    // The top of the ladder has no harder move: add weight, back to the bottom.
    const exTop = [{ id: 'o', name: 'One-arm-assisted push-ups', move: 'onearm_assist_pushup', target: 20, active: true }]
    const w = overload({ ...ctx(log([['2026-03-09', 'o', [8, 8, 8, 8]]])), exercises: exTop }, 'o')!
    expect(w.kind).toBe('weight')
    expect(w.kg).toBe(RULES.kgFirst)
    expect(w.reps).toBe(5)
    // …and the next time at that weight: two more kg.
    const l2 = addSets(log([['2026-03-09', 'o', [8, 8, 8, 8]]]), '2026-03-10', 'o', [8, 8, 8, 8], T, { kg: 5 })
    expect(overload({ ...ctx(l2), exercises: exTop }, 'o')!.kg).toBe(5 + RULES.kgStep)
  })

  it('two tough sessions step back with a slow tempo', () => {
    const o = overload(ctx(log([['2026-03-05', 'p', [3, 3, 2, 2]], ['2026-03-07', 'p', [4, 3, 2, 2]]])), 'p')!
    expect(o.kind).toBe('back')
    expect(o.tempo).toBe('3-1-1')
  })

  it('a deload is due after 6 hard weeks, or 4 with a stall', () => {
    const weeks = (n: number) => log(Array.from({ length: n }, (_, k) => [[`2026-03-${String(9 - 7 * k).padStart(2, '0')}`, 'p', [8, 8, 8]], [`2026-03-${String(10 - 7 * k).padStart(2, '0')}`, 'p', [8, 8, 8]]] as [string, string, number[]][]).flat())
    // Dates before March: build them with real day maths.
    const day = (k: number, d: number) => new Date(Date.parse('2026-03-09T12:00:00Z') - k * 7 * 86400000 + d * 86400000).toISOString().slice(0, 10)
    const l = log(Array.from({ length: 6 }, (_, k) => [[day(k, 0), 'p', [8, 8, 8]], [day(k, 1), 'p', [8, 8, 8]]] as [string, string, number[]][]).flat())
    expect(weeks).toBeTypeOf('function')
    expect(trainedWeeks(l, TODAY)).toBe(6)
    expect(deloadCheck(ctx(l)).due).toBe(true)
    const four = log(Array.from({ length: 4 }, (_, k) => [[day(k, 0), 'p', [5 + (3 - k), 5, 5]], [day(k, 1), 'p', [6 + (3 - k), 6, 5]]] as [string, string, number[]][]).flat())
    expect(deloadCheck(ctx(four)).due).toBe(false)
    // 4 weeks and a stall: due.
    expect(deloadCheck(ctx(log(Array.from({ length: 4 }, (_, k) => [[day(k, 0), 'p', [8, 8, 8]], [day(k, 1), 'p', [8, 8, 8]]] as [string, string, number[]][]).flat()))).due).toBe(true)
    expect(deloadCheck(ctx(l, { deload: true })).due).toBe(false)
  })

  it('links protein and sleep to the Body data', () => {
    const b = bodyLines({ protein: { avg: 80, days: 5, goal: 140 }, sleep: { avgMin: 380, nights: 6 } })
    expect(b.low).toEqual(['protein', 'sleep'])
    expect(b.lines[0]).toMatch(/80 g .*140 g/)
    expect(b.lines[1]).toMatch(/6h20/)
    expect(bodyLines({ protein: { avg: 140, days: 5, goal: 140 }, sleep: { avgMin: 460, nights: 6 } }).lines).toEqual([])
    expect(bodyLines(null).lines).toEqual([])
  })
})

describe('the coach card', () => {
  const sets = log([['2026-03-09', 'p', [8, 8, 7, 7]], ['2026-03-10', 'p', [8, 7, 7, 6]], ['2026-03-10', 's', [20, 20, 20]], ['2026-03-09', 's', [20, 20, 20]]])
  it('names the single most important thing: the muscle that is behind', () => {
    const f = priority(ctx(sets))
    expect(f.muscle).toBe('pull')
    expect(f.text).toMatch(/Add \d sets of pulling: your back is behind/)
  })
  it("builds today's exact session with variation, sets × reps, weight or tempo and rest", () => {
    const card = coachCard(ctx(sets))
    const push = card.session.find((s) => s.exId === 'p')!
    expect(push.line).toMatch(/^\d×\d+ push-ups, rest 2\.5 min/)
    const row = card.session.find((s) => s.exId === 'r')!
    expect(row.added).toBe(1)
    expect(card.why.length).toBeGreaterThan(20)
    expect(sessionPlan(ctx(sets)).length).toBe(3)
  })
  it('asks for the first session when nothing is logged', () => {
    expect(priority(ctx({})).text).toMatch(/log every set/)
  })
  it('puts protein first when volume is fine and protein is low', () => {
    const full = log([['2026-03-09', 'p', [8, 8, 8, 8, 8]], ['2026-03-10', 'p', [8, 8, 8, 8, 8]], ['2026-03-09', 'r', [12, 12, 12, 12, 12]], ['2026-03-10', 'r', [12, 12, 12, 12, 12]], ['2026-03-09', 's', [20, 20, 20, 20, 20]], ['2026-03-10', 's', [20, 20, 20, 20, 20]]])
    const c = { exercises: [...ex, { id: 'c', name: 'Plank', target: 90, active: true }], days: {}, sets: addSets(addSets(full, '2026-03-09', 'c', [40, 40, 40, 40, 40], T), '2026-03-10', 'c', [40, 40, 40, 40, 40], T), today: TODAY, body: { protein: { avg: 70, days: 5, goal: 150 }, sleep: null } }
    expect(priority(c).text).toMatch(/Protein averaged 70 g/)
  })
})

describe('after every session Ben adjusts the next one', () => {
  it('adds a rep, steps up, and adds a set where a muscle is under 10', () => {
    const sets = log([['2026-03-09', 'p', [8, 8, 8, 8]], ['2026-03-11', 'p', [8, 8, 8, 8]], ['2026-03-11', 'r', [12, 12, 12]]])
    const a = adjustAfterSession(ctx(sets))
    const push = a.adjustments.find((x) => x.exId === 'p')!
    expect(push.kind).toBe('harder')
    expect(push.toMove).toBe('wide_pushup')
    const pull = a.adjustments.find((x) => x.exId === 'r')!
    expect(pull.next.sets).toBe(5)
    expect(a.volume.map((v) => v.muscle)).toContain('pull')
    expect(a.lines.length).toBe(2)
    // Only exercises with sets today.
    expect(adjustAfterSession(ctx(log([['2026-03-09', 'p', [8, 8]]]))).adjustments).toEqual([])
  })
})

describe('the weekly AI review stays inside the rules and the facts', () => {
  const sets = log([['2026-03-09', 'p', [8, 8, 8, 8]], ['2026-03-10', 'p', [8, 8, 8, 8]], ['2026-03-10', 's', [20, 20]]])
  const c = ctx(sets, { body: { protein: { avg: 120, days: 5, goal: 150 }, sleep: { avgMin: 450, nights: 5 } } })
  it('clamps targets to 10–20 sets and 2+ sessions, and drops invented numbers', async () => {
    const reply = JSON.stringify({ target: { push: 40, pull: 2, legs: 12, core: 15 }, sessions: 1, lines: ['Pulling goes to 10 sets because it had 0.', 'You will gain 13 kg of muscle in 9 weeks.', 'Meet me at 19:50 for the session.', 'Eat at least 150 g protein.'] })
    const p = await weeklyReview(c, async () => reply, new Date('2026-03-11T09:00:00Z'))
    expect(p.target).toMatchObject({ push: 20, pull: 10, legs: 12, core: 15 })
    expect(p.sessions).toBe(2)
    expect(p.source).toBe('ai')
    expect(p.lines.join(' ')).not.toMatch(/13 kg|19:50/)
    expect(p.lines.join(' ')).toMatch(/Pulling goes to 10 sets/)
    expect(p.lines.length).toBeLessThanOrEqual(4)
  })
  it('cannot skip a due deload or train to failure', () => {
    const day = (k: number, d: number) => new Date(Date.parse('2026-03-09T12:00:00Z') - k * 7 * 86400000 + d * 86400000).toISOString().slice(0, 10)
    const l = log(Array.from({ length: 6 }, (_, k) => [[day(k, 0), 'p', [8, 8, 8]], [day(k, 1), 'p', [8, 8, 8]]] as [string, string, number[]][]).flat())
    const p = enforce({ lines: ['Skip the deload and go to failure.'], target: { push: 12 } }, ctx(l), reviewFacts(ctx(l)), new Date())
    expect(p.deload).toBe(true)
    expect(p.lines.join(' ')).toMatch(/easy week/i)
    expect(p.lines.join(' ')).not.toMatch(/failure/)
  })
  it('falls back to the rules with no model, a failing model or an empty answer', async () => {
    expect((await weeklyReview(c, null)).source).toBe('code')
    expect((await weeklyReview(c, async () => { throw new Error('down') })).source).toBe('code')
    expect((await weeklyReview(c, async () => '{"lines":["It is 13:45 now."]}')).source).toBe('code')
    expect(baseProgram(c).week).toBe('2026-03-09')
  })
  it('is due once a week', () => {
    expect(reviewDue(null, TODAY)).toBe(true)
    expect(reviewDue({ week: '2026-03-09' }, TODAY)).toBe(false)
    expect(reviewDue({ week: '2026-03-02' }, TODAY)).toBe(true)
    expect(reviewFacts(c)).toMatch(/Protein averaged 120 g/)
  })
})

describe('ask Ben about training', () => {
  const sets = log([['2026-03-10', 'p', [8, 8, 8, 8]], ['2026-03-10', 's', [20, 20]]])
  it('only takes training questions', () => {
    expect(isTrainingQuestion('why am I not growing?')).toBe(true)
    expect(isTrainingQuestion('is 4×8 archer enough?')).toBe(true)
    expect(isTrainingQuestion('how much did I spend on sets?')).toBe(false)
    expect(isTrainingQuestion('/start')).toBe(false)
    expect(isTrainingQuestion('3x15 push-ups')).toBe(false)
    expect(answerTraining('what time is it?', ctx(sets))).toBeNull()
  })
  it('explains why from his data and the rules', () => {
    const a = answerTraining('why am I not growing?', ctx(sets, { body: { protein: { avg: 60, days: 4, goal: 150 }, sleep: null } }))!
    expect(a).toMatch(/Volume is low: .*back 0/)
    expect(a).toMatch(/Protein averaged 60 g/)
    expect(a).toMatch(/First fix:/)
  })
  it('answers "is 4×8 archer enough?" with sets per week', () => {
    const a = answerTraining('is 4×8 archer enough?', ctx(sets))!
    expect(a).toMatch(/4×8 archer push-ups is 32 reps/)
    expect(a).toMatch(/hard sets in the last 7 days/)
    expect(a).toMatch(/10–20/)
  })
  it('answers rest, deload and protein from the rules', () => {
    expect(answerTraining('how long should I rest between sets?', ctx(sets))).toMatch(/5–8 reps need 2\.5–3 min/)
    expect(answerTraining('do I need a deload?', ctx(sets))).toMatch(/Not yet/)
    expect(answerTraining('how much protein for muscle?', ctx(sets))).toMatch(/1\.6–2\.2 g per kg/)
  })
  it('asks you to log when there is nothing to read', () => {
    expect(answerTraining('why am I not growing?', ctx({}))).toMatch(/no sets from you/)
  })
})

describe('best-set onboarding and imported days', () => {
  it('a best set of 50 push-ups starts on archer push-ups at 4×5–8', () => {
    const p = placeBest('pushup', 'pushup', 50)!
    expect(p.move.id).toBe('archer_pushup')
    expect(p.sets).toBe(4)
    expect(p.reps).toBeGreaterThanOrEqual(5)
    expect(p.reps).toBeLessThanOrEqual(8)
    expect(placeBest('pushup', 'pushup', 20)!.move.id).toBe('wide_pushup')
    expect(placeBest('pushup', 'pushup', 8)!.move.id).toBe('knee_pushup')
    expect(placeBest('plank', 'plank', 45)!.move.id).toBe('plank')
    expect(placeBest('plank', 'plank', 45)!.reps).toBe(25)
    expect(QUESTIONS.map((q) => q.family)).toEqual(['pushup', 'squat', 'core', 'row', 'plank'])
    expect(placeAll({ pushup: 50, squat: '', row: 0 }).map((x) => x.family)).toEqual(['pushup', 'row'])
  })
  it('imported totals never raise a level', () => {
    const base = { exercises: [{ id: 'p', name: 'Push-ups', target: 40, active: true }], days: { '2026-03-09': { p: 300 }, '2026-03-10': { p: 300 } } as any, sets: {}, today: TODAY }
    expect(placeFamily(base, 'pushup')!.level).toBeGreaterThan(5)
    const imported = placeFamily({ ...base, imported: { '2026-03-09': ['p'], '2026-03-10': ['p'] } }, 'pushup')
    expect(imported === null || imported.level === 0).toBe(true)
    // …but a real best set places you.
    const withBest = placeFamily({ ...base, imported: { '2026-03-09': ['p'], '2026-03-10': ['p'] }, best: { pushup: { move: 'pushup', reps: 50, day: TODAY } } }, 'pushup')!
    expect(withBest.level).toBeGreaterThan(10)
  })
  it('the Telegram import marks its days', () => {
    const r = mergeTelegramDays({ exercises: [{ id: 'p', name: 'Push-ups', target: 40, active: true }], days: {}, sets: {} }, { '2026-03-05': { pushups: { name: 'Push-ups', done: 120, target: 117, unit: 'reps' } } } as any, ['2026-03-05'], TODAY)
    expect(r.st.importedDays['2026-03-05']).toEqual(['p'])
  })
  it('the weekly test is offered once a week and flags its sets', () => {
    expect(testDue({}, TODAY)).toBe(false)
    const l = addSets({}, '2026-03-02', 'p', [30], T, { test: true })
    expect(testDue(l, TODAY)).toBe(true)
    expect(testDue(l, '2026-03-05')).toBe(false)
    expect(l['2026-03-02'].p[0].test).toBe(true)
    expect(strongerThan([{ day: '2026-02-11', reps: 20, move: 'pushup', score: 100 }, { day: '2026-03-10', reps: 30, move: 'pushup', score: 130 }], TODAY)).toEqual({ pct: 30, weeks: 4 })
    expect(strongerThan([{ day: '2026-03-10', reps: 20, move: 'pushup', score: 100 }], TODAY)).toBeNull()
  })
})

describe('Ben logs sport', () => {
  it('reads sets, weights and best sets', () => {
    expect(parseSportSay('8 push-ups +10 kg')).toMatchObject({ kind: 'sets', name: 'push-ups', reps: [8], kg: 10 })
    expect(parseSportSay('3x8 push-ups +5kg')).toMatchObject({ reps: [8, 8, 8], kg: 5 })
    expect(parseSportSay('best set push-ups 50')).toMatchObject({ kind: 'best', name: 'push-ups', reps: [50] })
    expect(parseSportSay('plank 3x45s')).toMatchObject({ unit: 'sec', reps: [45, 45, 45], kg: 0 })
    expect(parseSportSay('50 pushups')).toBeNull()
    expect(parseTelegramText('best set push-ups 50')).toMatchObject({ type: 'workout', exerciseBest: true, exerciseSets: [50] })
    expect(parseTelegramText('8 push-ups +10 kg')).toMatchObject({ type: 'workout', exerciseKg: 10, exerciseSets: [8] })
  })
  it('replies with a receipt: logged, best, level, next target', () => {
    const st = { exercises: [{ id: 'p', name: 'Push-ups', target: 40 }], sets: addSets({}, '2026-03-08', 'p', [12, 11, 10], T) }
    const r = logBotSets(st, 'push-ups', [10, 10], TODAY, T, { kg: 10 })!
    expect(r.line).toMatch(/Logged <b>.*push-ups \+10 kg<\/b>/)
    expect(r.line).toMatch(/Level <b>\d+<\/b> of \d+/)
    expect(r.line).toMatch(/Next time:/)
    expect(r.st.sets[TODAY].p[0].kg).toBe(10)
  })
})

describe('the harder moves', () => {
  it('are in the library and on the ladders', () => {
    for (const id of ['onearm_assist_pushup', 'planche_lean', 'feet_row', 'onearm_row', 'dragon_neg', 'hollow_rock', 'box_pistol', 'archer_pushup', 'shrimp_squat']) expect(MOVES.some((m) => m.id === id), id).toBe(true)
    expect(moveById('dragon_neg')!.name).toBe('Dragon flag negatives')
  })
})
