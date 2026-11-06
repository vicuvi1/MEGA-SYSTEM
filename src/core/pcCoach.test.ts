import { describe, expect, it } from 'vitest'
import { sessionize, type ActivityEvent } from './activityStream'
import type { ContextKind } from './activityContext'
import { answerCoach, bedPhase, cleanCoachState, coachAlert, coachMuted, coachOffPatch, coachOnPatch, coachReady, coachResume, coachTuning, decideCoach, newCoachState, workLine, type CoachInput, type CoachState } from './pcCoach'
import { cleanPcPrefs } from './pcActivity'
import { momentForAlert } from './soundMoments'
import { modeGate, peekKind, DEFAULT_PEEK_FOR } from './islandCalm'

// A made-up weekday (local time).
const DAY = '2026-11-04'
const at = (hm: string, day = DAY) => Date.parse(`${day}T${hm}:00`)
const min = (n: number) => n * 60_000
const app = (t: number, context: ContextKind, label = 'VS Code'): ActivityEvent => ({ t: 'app', at: t, label, kind: context === 'video' || context === 'gaming' ? 'distract' : 'work', context, conf: 0.9 })

const base = (now: number, events: ActivityEvent[], more: Partial<CoachInput> = {}): CoachInput => ({
  now,
  day: DAY,
  on: true,
  desktop: true,
  sessions: sessionize(events, now),
  idleSec: 5,
  activeSince: now - min(20),
  dayWork: { min: 0, by: {}, distractMin: 0 },
  workGoalMin: 120,
  push: 'push',
  focus: null,
  block: null,
  workHour: false,
  meeting: false,
  bedTarget: '23:30',
  latestBed: '00:00',
  wakeTime: '06:30',
  bedLogged: false,
  nextUp: null,
  lastMoveAt: 0,
  morningShown: true,
  eveningAt: '21:00',
  ...more
})
const fresh = (): CoachState => ({ ...newCoachState(DAY), morning: true })

describe('Ben on your PC: the switch', () => {
  it('turns on what it needs (titles stay your own choice) and off again', () => {
    const on = cleanPcPrefs(coachOnPatch())
    expect(coachReady(on)).toBe(true)
    expect(on.titles).toBe(false)
    expect(on.history && on.idle && on.smart && on.activeApp).toBe(true)
    expect(coachReady(cleanPcPrefs({ ...on, ...coachOffPatch() }))).toBe(false)
    expect(cleanPcPrefs(null).coach).toBe(false)
  })
  it('asks once on the desktop, in a calm moment, and remembers the answer', () => {
    const now = at('10:00')
    const r = decideCoach(base(now, [], { on: false }), fresh())
    expect(r.reaction?.kind).toBe('setup')
    expect(r.reaction?.buttons.map((b) => b.op)).toEqual(['enable', 'later', 'never'])
    expect(decideCoach(base(now, [], { on: false, meeting: true }), fresh()).reaction).toBeNull()
    expect(decideCoach(base(now, [], { on: false, desktop: false }), fresh()).reaction).toBeNull()
    const no = answerCoach(r.state, 'setup', 'never', now).state
    expect(decideCoach(base(now + min(60), [], { on: false }), no).reaction).toBeNull()
    // "Not now": not again for 3 days.
    const later = answerCoach(r.state, 'setup', 'later', now).state
    expect(decideCoach(base(now + min(60), [], { on: false, day: '2026-11-05' }), { ...later, day: '2026-11-05' }).reaction).toBeNull()
  })
})

describe('praise for real work', () => {
  const start = at('14:00')
  const coding = [app(start, 'coding')]
  it('25, 50 and 90 minutes of coding, each once, with varied lines', () => {
    let s = fresh()
    const seen: string[] = []
    for (let t = start; t <= start + min(95); t += 15_000) {
      const r = decideCoach(base(t, coding), s)
      s = r.state
      if (r.reaction && !seen.includes(r.reaction.id)) seen.push(r.reaction.id)
      if (r.reaction) s = answerCoach(s, r.reaction.kind, 'ok', t).state
    }
    const praise = seen.filter((x) => x.startsWith('coach:praise'))
    expect(praise.map((x) => x.split(':').pop())).toEqual(['25', '50', '90'])
  })
  it('a short look elsewhere does not break it; a real switch does', () => {
    const ev = [app(start, 'coding'), app(start + min(20), 'browsing', 'Chrome'), app(start + min(21), 'coding')]
    const r = decideCoach(base(start + min(26), ev), fresh())
    expect(r.reaction?.id).toMatch(/:25$/)
    expect(r.reaction?.title).toBe('Locked in')
    expect(r.reaction?.text).toMatch(/^25 min/)
    const broken = [app(start, 'coding'), app(start + min(10), 'video', 'YouTube'), app(start + min(20), 'coding')]
    expect(decideCoach(base(start + min(26), broken), fresh()).reaction).toBeNull()
  })
  it('names what you did most (study, CTF)', () => {
    const ev = [app(start, 'study', 'Acrobat'), app(start + min(30), 'ctf', 'VirtualBox')]
    const r = decideCoach(base(start + min(51), ev), { ...fresh(), session: { start, steps: [25] } })
    expect(r.reaction?.title).toBe('On fire')
    expect(r.reaction?.text).toMatch(/^50 min (of (study|CTF and lab work)|of solid (study|CTF and lab work)|in and still|of real work)/)
  })
  it('the day goal hit, once', () => {
    const r = decideCoach(base(start + min(5), coding, { dayWork: { min: 125, by: { coding: 90, study: 35 }, distractMin: 0 } }), fresh())
    expect(r.reaction?.kind).toBe('milestone')
    expect(r.reaction?.text).toMatch(/2 h 5 min of real work today/)
    const again = decideCoach(base(start + min(40), coding, { dayWork: { min: 150, by: {}, distractMin: 0 } }), answerCoach(r.state, 'milestone', 'ok', start).state)
    expect(again.reaction?.kind).not.toBe('milestone')
  })
  it('"Less of this": first rarer (only 50 and 90), then off, and Settings turns it back on', () => {
    let s = answerCoach(fresh(), 'praise', 'less', start).state
    expect(decideCoach(base(start + min(26), coding), s).reaction).toBeNull()
    expect(decideCoach(base(start + min(51), coding), s).reaction?.id).toMatch(/:50$/)
    s = answerCoach(s, 'praise', 'less', start).state
    expect(decideCoach(base(start + min(51), coding), s).reaction).toBeNull()
    expect(coachMuted(s)).toEqual(['praise'])
    expect(decideCoach(base(start + min(51), coding), coachResume(s, 'praise')).reaction?.kind).toBe('praise')
  })
})

describe('rate limits', () => {
  it('one reaction per gap (by push level), and a daily cap', () => {
    const start = at('14:00')
    const s = { ...fresh(), lastAt: start + min(20) }
    // Gentle waits 25 min after the last one; push 15.
    expect(decideCoach(base(start + min(26), [app(start, 'coding')], { push: 'push' }), s).reaction).toBeNull()
    expect(decideCoach(base(start + min(51), [app(start, 'coding')], { push: 'gentle' }), s).reaction?.kind).toBe('praise')
    expect(decideCoach(base(start + min(51), [app(start, 'coding')]), { ...fresh(), count: coachTuning('push').dailyCap }).reaction).toBeNull()
    expect(coachTuning('gentle').gapMin).toBeGreaterThan(coachTuning('push').gapMin)
  })
  it('nothing in a meeting, nothing while away', () => {
    const start = at('14:00')
    expect(decideCoach(base(start + min(26), [app(start, 'coding')], { meeting: true }), fresh()).reaction).toBeNull()
    expect(decideCoach(base(start + min(26), [app(start, 'coding')], { idleSec: 600 }), fresh()).reaction).toBeNull()
  })
})

describe('drift', () => {
  const start = at('15:00')
  const yt = [app(start, 'coding'), app(start + min(20), 'video', 'YouTube')]
  const block = { title: 'Rust exercises', end: start + min(90) }
  it('10+ min of video during a planned block: back to it, with the block’s name', () => {
    expect(decideCoach(base(start + min(29), yt, { block }), fresh()).reaction).toBeNull()
    const r = decideCoach(base(start + min(31), yt, { block }), { ...fresh(), lastAt: start + min(24) })
    expect(r.reaction?.kind).toBe('drift')
    expect(r.reaction?.title).toBe('Back to Rust exercises?')
    expect(r.reaction?.buttons.map((b) => b.op)).toEqual(['start', 'more5', 'onBreak'])
    expect(coachAlert(r.reaction!).kind).toBe('refocus')
  })
  it('not when nothing was planned; the work window counts as planned', () => {
    expect(decideCoach(base(start + min(31), yt), fresh()).reaction).toBeNull()
    expect(decideCoach(base(start + min(31), yt, { workHour: true }), fresh()).reaction?.title).toBe('Back to work?')
  })
  it('"5 more min" is checked, then a firmer line; "I’m on a break" is respected', () => {
    const r = decideCoach(base(start + min(31), yt, { focus: { subject: 'Algorithms' } }), fresh())
    expect(r.reaction?.buttons[0].op).toBe('back')
    const s = answerCoach(r.state, 'drift', 'more5', start + min(31)).state
    expect(decideCoach(base(start + min(34), yt, { focus: { subject: 'Algorithms' } }), s).reaction).toBeNull()
    const again = decideCoach(base(start + min(37), yt, { focus: { subject: 'Algorithms' } }), s)
    expect(again.reaction?.kind).toBe('drift')
    expect(again.reaction?.face).toBe('😠')
    const brk = answerCoach(r.state, 'drift', 'onBreak', start + min(31)).state
    expect(decideCoach(base(start + min(45), yt, { focus: { subject: 'Algorithms' } }), brk).reaction).toBeNull()
  })
  it('the card goes once you are back at work', () => {
    const r = decideCoach(base(start + min(31), yt, { block }), fresh())
    const back = [...yt, app(start + min(32), 'coding')]
    expect(decideCoach(base(start + min(33), back, { block }), r.state).reaction).toBeNull()
  })
})

describe('breaks tied to sitting', () => {
  it('after ~50 min at the PC: water, push-ups, stretch, snooze (each logged by the island only on a tap)', () => {
    const now = at('16:00')
    const r = decideCoach(base(now, [app(now - min(55), 'browsing', 'Chrome')], { activeSince: now - min(52) }), fresh())
    expect(r.reaction?.kind).toBe('break')
    expect(r.reaction?.buttons.map((b) => b.op)).toEqual(['water', 'pushups', 'stretch', 'snooze'])
    const a = coachAlert(r.reaction!)
    expect(a.kind).toBe('move')
    expect(a.actions[1].action).toMatchObject({ kind: 'coach', op: 'pushups', ck: 'break', alertId: a.id })
    // Gentle waits until an hour; a move break from elsewhere resets it; never in a focus timer.
    expect(decideCoach(base(now, [], { activeSince: now - min(52), push: 'gentle' }), fresh()).reaction).toBeNull()
    expect(decideCoach(base(now, [], { activeSince: now - min(52), lastMoveAt: now - min(10) }), fresh()).reaction).toBeNull()
    expect(decideCoach(base(now, [], { activeSince: now - min(52), focus: { subject: 'X' } }), fresh()).reaction).toBeNull()
    // Snoozed 15 min.
    const sn = answerCoach(r.state, 'break', 'snooze', now, 15).state
    expect(decideCoach(base(now + min(10), [], { activeSince: now - min(62) }), sn).reaction).toBeNull()
  })
})

describe('bedtime and morning', () => {
  it('the phases of the night, past midnight too', () => {
    expect(bedPhase(at('22:50'), '23:30', '00:00')).toBeNull()
    expect(bedPhase(at('23:05'), '23:30', '00:00')?.phase).toBe('soon')
    expect(bedPhase(at('23:40'), '23:30', '00:00')?.phase).toBe('now')
    expect(bedPhase(at('00:20', '2026-11-05'), '23:30', '00:00')?.phase).toBe('late')
    expect(bedPhase(at('06:00', '2026-11-05'), '23:30', '00:00')).toBeNull()
    expect(bedPhase(at('00:10', '2026-11-05'), '00:00', '00:30')?.phase).toBe('now')
  })
  it('wind down from 30 min before, firmer after bedtime, direct when gaming late; even past the gap and the cap', () => {
    const t1 = at('23:05')
    const s0 = { ...fresh(), lastAt: t1 - min(6), count: 99 }
    const r1 = decideCoach(base(t1, [app(t1 - min(30), 'coding')]), s0)
    expect(r1.reaction?.kind).toBe('bed')
    expect(r1.reaction?.title).toBe('Bed in 25 min')
    expect(coachAlert(r1.reaction!).kind).toBe('late')
    // Only one "soon" line.
    expect(decideCoach(base(t1 + min(15), [app(t1 - min(30), 'coding')]), answerCoach(r1.state, 'bed', 'ok', t1).state).reaction).toBeNull()
    const t2 = at('00:20', '2026-11-05')
    const r2 = decideCoach(base(t2, [app(t2 - min(40), 'gaming', 'Steam')], { day: '2026-11-05' }), { ...r1.state, active: null, lastAt: t2 - min(30) })
    expect(r2.reaction?.title).toBe('Way past bedtime')
    expect(r2.reaction?.text).toMatch(/00:20 and you.re gaming/)
    expect(decideCoach(base(t2, [], { day: '2026-11-05', bedLogged: true }), { ...r1.state, active: null }).reaction).toBeNull()
  })
  it('good morning on the first use after your wake time, with today’s first thing', () => {
    const t = at('06:45')
    const r = decideCoach(base(t, [], { morningShown: false, nextUp: { title: 'Linear algebra' } }), newCoachState(DAY))
    expect(r.reaction?.kind).toBe('morning')
    expect(r.reaction?.text).toMatch(/water.*Linear algebra/i)
    expect(r.reaction?.buttons[0].op).toBe('water')
    expect(decideCoach(base(at('06:10'), [], { morningShown: false }), newCoachState(DAY)).reaction).toBeNull()
    expect(decideCoach(base(t + min(30), [], { morningShown: false }), answerCoach(r.state, 'morning', 'ok', t).state).reaction?.kind).not.toBe('morning')
  })
})

describe('welcome back and the evening recap', () => {
  it('back after 15+ min away: next up', () => {
    const t = at('11:00')
    const ev: ActivityEvent[] = [app(t - min(60), 'coding'), { t: 'idle', at: t - min(40) }, { t: 'active', at: t - min(1) }]
    const r = decideCoach(base(t, ev, { nextUp: { title: 'Physics', minutes: 50 } }), fresh())
    expect(r.reaction?.kind).toBe('back')
    expect(r.reaction?.text).toMatch(/Next up: Physics|Physics is next/)
    expect(r.reaction?.buttons[0]).toMatchObject({ op: 'start', subject: 'Physics', minutes: 50 })
    // Once for that time away.
    expect(decideCoach(base(t + min(1), ev), answerCoach(r.state, 'back', 'ok', t).state).reaction).toBeNull()
    // A short pause is nothing.
    const short: ActivityEvent[] = [app(t - min(60), 'coding'), { t: 'idle', at: t - min(8) }, { t: 'active', at: t - min(1) }]
    expect(decideCoach(base(t, short), fresh()).reaction).toBeNull()
  })
  it('one recap in the evening, before the bedtime guard', () => {
    const t = at('21:10')
    const r = decideCoach(base(t, [], { dayWork: { min: 130, by: { coding: 90, study: 40 }, distractMin: 35 } }), { ...fresh(), milestone: true })
    expect(r.reaction?.kind).toBe('recap')
    expect(r.reaction?.text).toBe('2h10 of real work (coding 1h30, study 40m) · 35m on video, games and social. Good day. Now wind down on time 🌙')
    expect(workLine({ ctf: 50, video: 90, coding: 3 })).toBe('CTF 50m')
  })
})

describe('the island side', () => {
  it('each kind of reaction has its own sound and peeks in Calm', () => {
    expect(momentForAlert('praise')).toBe('praise')
    expect(momentForAlert('refocus')).toBe('drift')
    expect(momentForAlert('move')).toBe('move')
    expect(momentForAlert('late')).toBe('bed')
    for (const k of ['praise', 'refocus', 'coach']) {
      expect(peekKind(k)).toBe('coach')
      expect(modeGate({ mode: 'calm', kind: k, peekFor: DEFAULT_PEEK_FOR, base: 'peek' })).toBe('peek')
    }
  })
  it('a saved state survives a new day with only your answers', () => {
    const s = { ...fresh(), count: 9, milestone: true, less: { drift: 1 }, setup: { asked: [DAY], answered: true, later: 0 } }
    const next = cleanCoachState(JSON.parse(JSON.stringify(s)), '2026-11-05')
    expect(next.count).toBe(0)
    expect(next.milestone).toBe(false)
    expect(next.less).toEqual({ drift: 1 })
    expect(next.setup.answered).toBe(true)
    expect(cleanCoachState('junk', DAY).count).toBe(0)
  })
})
