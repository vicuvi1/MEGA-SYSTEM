import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyOffer, requirementsOf, trackerLog, trackerToday } from './sportTrain'
import { moveChoices, safetyNotes, workoutDone } from './trainAdvice'
import { ALL_GEAR, type Gear } from './trainGear'
import { levelStatus, mergeTrain, sessionFromSets, trainOf, type MoveSession } from './trainLog'
import type { SetEntry } from './sportSets'
import { makeStep } from './trainSwap'

// Made-up data only, the clock pinned. 2026-11-10 is a Tuesday (Upper), 2026-11-12 a Thursday (Upper),
// 2026-11-15 a Sunday (Upper) in the default week.
const TUE = '2026-11-10'
const THU = '2026-11-12'
const SUN = '2026-11-15'

/** Diamond push-ups (push step 3) from a saved level, nothing logged yet. */
const setup = (): any => ({ lastDate: TUE, exercises: [], days: {}, sets: {}, trainLevels: { push: { level: 2, reached: { 2: '2026-11-01' }, at: 1 } } })

type Opts = { form?: 'good' | 'off' | null; issue?: SetEntry['issue'] | null; issueOn?: number; reps?: number[] }
/** Logs every planned push set on a day at these reps and effort (form good unless told otherwise). */
function logPush(st: any, day: string, reps: number, feel: 'easy' | 'ok' | 'hard', o: Opts = {}) {
  const n = trackerToday(st, day).items.find((i) => i.ladder.id === 'push')!.sets
  for (let i = 0; i < n; i++)
    trackerLog(st, {
      day,
      type: 'upper',
      ladder: 'push',
      reps: o.reps?.[i] ?? reps,
      feel,
      form: o.form === undefined ? 'good' : o.form,
      issue: o.issueOn === i + 1 ? (o.issue ?? null) : null,
      now: Date.parse(`${day}T18:00:00Z`) + i,
      salt: `${day}${i}`
    })
}
const push = (st: any, day: string) => trackerToday(st, day).items.find((i) => i.ladder.id === 'push')!

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-10T08:30:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('form must be confirmed: never assumed', () => {
  it('sets with no form check ("form unknown") are saved but never count toward a step up', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok', { form: null })
    logPush(st, THU, 12, 'ok', { form: null })
    const it = push(st, THU)
    expect(it.status.state).toBe('building')
    expect(it.status.hits).toBe(0)
    expect(it.offer).toBeNull()
    expect(it.status.line).toMatch(/form was not confirmed on 3 sets/)
    // Saved for volume: every set is in the log with no form field.
    expect(st.sets[THU][it.exId!].map((s: SetEntry) => s.form ?? 'unknown')).toEqual(['unknown', 'unknown', 'unknown'])
    const req = requirementsOf(it)
    expect(req.find((r) => r.id === 'form')).toMatchObject({ done: false, detail: 'form unknown on 3' })
  })

  it('the same sets with "Form good" tapped on every set unlock the next step', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok')
    logPush(st, THU, 12, 'ok')
    const it = push(st, THU)
    expect(it.status.state).toBe('complete')
    expect(it.offer?.name).toBe('Decline push-ups')
  })

  it('one set without the check in an otherwise good session stops it counting', () => {
    const ses = (day: string, forms: (SetEntry['form'] | undefined)[]): MoveSession => ({ day, reps: [12, 12, 12], sets: forms.map((f, i) => ({ reps: 12, at: i, id: `${day}${i}`, feel: 'ok', ...(f ? { form: f } : {}) })) })
    const lv = { move: 'diamond_pushup', lo: 6, hi: 12, unit: 'reps' as const }
    expect(levelStatus([ses('2026-11-08', ['good', 'good', 'good']), ses('2026-11-10', ['good', undefined, 'good'])], lv, 3).state).toBe('building')
    expect(levelStatus([ses('2026-11-08', ['good', 'good', 'good']), ses('2026-11-10', ['good', 'good', 'good'])], lv, 3).state).toBe('complete')
  })
})

describe('Pain / can’t finish', () => {
  it('pain is saved on the set, blocks the step up, and offers easier or another move, never harder', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok')
    logPush(st, THU, 12, 'ok', { issue: { kind: 'pain', where: 'wrist' }, issueOn: 2 })
    const it = push(st, THU)
    // Persisted on the set and in the session record.
    const saved = st.sets[THU][it.exId!] as SetEntry[]
    expect(saved[1].issue).toEqual({ kind: 'pain', where: 'wrist' })
    expect(st.trainLog[0].exercises.find((e: any) => e.ladder === 'push').sets[1].issue).toEqual({ kind: 'pain', where: 'wrist' })
    // The step up is blocked.
    expect(it.status.state).toBe('hurt')
    expect(it.status.pain).toMatchObject({ set: 2, kind: 'pain', where: 'wrist', day: THU })
    expect(it.offer).toBeNull()
    expect(it.nextTime).toMatchObject({ kind: 'down', move: 'pushup' })
    expect(it.nextTime!.line).toBe('Next time: an easier step (Push-ups) or another move, because pain flagged on set 2 (wrist). Never harder until it is gone.')
    expect(requirementsOf(it).find((r) => r.id === 'pain')).toMatchObject({ done: false, detail: 'pain flagged on set 2 (wrist)' })
    // Choices: easier with the reason, alternates at the same level, no harder.
    const ch = moveChoices(it, null)
    expect(ch.harder).toBeNull()
    expect(ch.noHarder).toBe('Not while pain flagged on set 2 (wrist)')
    expect(ch.easier).toMatchObject({ move: 'pushup', reason: 'pain flagged on set 2 (wrist): go easier' })
    expect(ch.alternates.map((a) => a.move)).toEqual(['wide_pushup'])
    expect(ch.alternates[0].reason).toBe('less bend in the wrists and elbows; pain flagged on set 2 (wrist)')
  })

  it('discomfort is saved and the session does not count; two clean sessions later the step up comes back', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok')
    logPush(st, THU, 12, 'ok', { issue: { kind: 'discomfort' }, issueOn: 3 })
    expect(push(st, THU).status.state).toBe('building')
    expect(push(st, THU).offer).toBeNull()
    logPush(st, SUN, 12, 'ok')
    expect(push(st, SUN).status.hits).toBe(1)
    logPush(st, '2026-11-17', 12, 'ok')
    expect(push(st, '2026-11-17').offer?.name).toBe('Decline push-ups')
  })

  it('"couldn’t complete" is saved with the reps you did', () => {
    const st = setup()
    logPush(st, TUE, 12, 'hard', { reps: [12, 12, 7], issue: { kind: 'incomplete' }, issueOn: 3 })
    const s = st.sets[TUE][push(st, TUE).exId!] as SetEntry[]
    expect(s.map((x) => x.reps)).toEqual([12, 12, 7])
    expect(s[2].issue).toEqual({ kind: 'incomplete' })
    expect(push(st, TUE).status.state).toBe('building')
  })

  it('sessionFromSets keeps form and the issue; bad issue data is dropped', () => {
    const st: any = { sets: { [TUE]: { ex: [{ reps: 5, at: 1, id: 'a', session: 's', form: 'good', issue: { kind: 'pain', where: 'knee' } }, { reps: 4, at: 2, id: 'b', session: 's', issue: { kind: 'nope' } }] } } }
    const rec = sessionFromSets(st, { id: 's', date: TUE, type: 'upper', items: [{ ladder: 'push', move: 'pushup', exId: 'ex' }], startedAt: 0, now: 1000 })
    expect(rec.exercises[0].sets).toEqual([{ reps: 5, form: 'good', issue: { kind: 'pain', where: 'knee' } }, { reps: 4 }])
  })
})

describe('Easier / Alternate / Harder, each with the reason from your data', () => {
  it('Harder after two good sessions: "you hit 3×12 at OK twice, form confirmed"', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok')
    logPush(st, THU, 12, 'ok')
    const ch = moveChoices(push(st, THU), null)
    expect(ch.harder).toMatchObject({ move: 'decline_pushup', index: 3, reason: 'you hit 3×12 at OK twice, form confirmed' })
    expect(ch.easier).toMatchObject({ move: 'pushup', index: 1 })
  })

  it('missing the bottom of the range twice is the reason to go easier', () => {
    const st = setup()
    logPush(st, TUE, 4, 'hard')
    logPush(st, THU, 5, 'hard')
    const ch = moveChoices(push(st, THU), null)
    expect(ch.easier?.reason).toBe('missed the bottom of the range (6) twice')
    expect(ch.harder?.reason).toBe('not earned yet: 0 of 2 sessions at the top (your history stays)')
  })

  it('branches follow the gear: Bulgarian ↔ reverse lunge, decline ↔ wide', () => {
    const legs: any = { exercises: [], days: {}, sets: {}, trainLevels: { single: { level: 2, reached: {}, at: 1 } } }
    const wed = '2026-11-11'
    const b = trackerToday(legs, wed).items.find((i) => i.ladder.id === 'single')!
    expect(b.level.move).toBe('bulgarian_squat')
    expect(moveChoices(b, null).alternates.map((a) => a.move)).toEqual(['reverse_lunge', 'lunge'])
    const dec: any = { exercises: [], days: {}, sets: {}, trainLevels: { push: { level: 3, reached: {}, at: 1 } } }
    expect(moveChoices(push(dec, TUE), null).alternates[0]).toMatchObject({ move: 'wide_pushup', reason: 'flat on the floor, less load on the shoulders' })
    // No table: table rows are never the plan, the door towel row is the branch only with a towel.
    const noTowel: Gear = { ...ALL_GEAR, towel: false }
    const pull: any = { exercises: [], days: {}, sets: {}, trainLevels: { pull: { level: 0, reached: {}, at: 1 } } }
    const row = trackerToday(pull, TUE).items.find((i) => i.ladder.id === 'pull')!
    expect(moveChoices(row, null).alternates.map((a) => a.move)).toEqual(['towel_row'])
    expect(moveChoices(row, noTowel).alternates).toEqual([])
  })
})

describe('safety notes for household objects', () => {
  it('every move on a chair, bed, door or backpack says how to make it stable', () => {
    expect(safetyNotes('bulgarian_squat', ALL_GEAR)[0]).toMatch(/against a wall.*No chairs on wheels/)
    expect(safetyNotes('bulgarian_squat', { ...ALL_GEAR, chair: false })[0]).toMatch(/Bed or sofa edge/)
    expect(safetyNotes('towel_row', ALL_GEAR)[0]).toMatch(/close toward you and be locked/)
    expect(safetyNotes('bss_load', ALL_GEAR).join(' ')).toMatch(/Backpack: start light/)
    expect(safetyNotes('table_row', ALL_GEAR)[0]).toMatch(/full weight/)
    expect(safetyNotes('pushup', ALL_GEAR)).toEqual([])
  })
})

describe('Workout done: actual vs target, records, pain, one adjustment', () => {
  it('an unlocked step is the recommendation, with its reasons; a new best is a record', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok')
    logPush(st, THU, 12, 'ok', { reps: [13, 12, 12] })
    const v = trackerToday(st, THU)
    const d = workoutDone(st, v, Date.parse(`${THU}T18:30:00Z`))
    const row = d.rows.find((r) => r.ladder === 'push')!
    expect(row).toMatchObject({ target: '3 × 6–12', reps: '13 · 12 · 12', effort: 'OK', form: 'form good', delta: 'Record ✓', record: true, pain: null })
    // The moves you didn't do today are listed too, as not done.
    expect(d.rows.find((r) => r.ladder === 'pull')).toMatchObject({ reps: '—', effort: 'Not done', delta: 'not done', setsDone: 0 })
    expect(d.setsDone).toBe(3)
    expect(d.records).toBe(1)
    expect(d.adjust).toMatchObject({ kind: 'up', from: 'Diamond push-ups', to: 'Decline push-ups', toIndex: 3, fromIndex: 2 })
    expect(d.adjust!.reasons).toEqual(['3 × 12 at the top of the range, 2 sessions running', 'Effort OK, form confirmed good, no pain'])
  })

  it('a pain flag makes the recommendation an easier step and counts the flag', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok')
    logPush(st, THU, 10, 'hard', { issue: { kind: 'pain', where: 'shoulder' }, issueOn: 1 })
    const d = workoutDone(st, trackerToday(st, THU), Date.parse(`${THU}T18:30:00Z`))
    expect(d.pains).toBe(1)
    expect(d.rows[0]).toMatchObject({ delta: '−6 reps', tone: 'down' })
    expect(d.adjust).toMatchObject({ kind: 'down', to: 'Push-ups', toIndex: 1 })
    expect(d.adjust!.reasons[0]).toBe('Pain flagged on set 1 (shoulder)')
  })

  it('Apply next time, then Undo: the old step comes back and every logged set stays', () => {
    const st = setup()
    logPush(st, TUE, 12, 'ok')
    logPush(st, THU, 12, 'ok')
    const setsBefore = JSON.stringify(st.sets)
    expect(applyOffer(st, { day: THU, type: 'upper', ladder: 'push', now: 5 })?.name).toBe('Decline push-ups')
    expect(trainOf(st).levels.push?.level).toBe(3)
    expect(makeStep(st, { day: THU, ladder: 'push', index: 2, now: 6 })).toBe(true)
    expect(trainOf(st).levels.push).toMatchObject({ level: 2, reached: { 2: '2026-11-01', 3: THU }, declinedOn: THU })
    expect(JSON.stringify(st.sets)).toBe(setsBefore)
  })
})

describe('merging the owner’s demo answers', () => {
  it('per demo, the newer answer wins', () => {
    const out = mergeTrain({ trainMediaOk: { a: { ok: true, at: 5 }, b: { ok: true, at: 1 } } }, { trainMediaOk: { a: { ok: false, at: 2 }, b: { ok: false, at: 9 } } })
    expect(out.trainMediaOk).toEqual({ a: { ok: true, at: 5 }, b: { ok: false, at: 9 } })
  })
})
