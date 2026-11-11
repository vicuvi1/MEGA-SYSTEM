import { describe, expect, it } from 'vitest'
import { EMPTY_ISLAND, type IslandSnapshot } from './islandModel'
import { restingView, threeRest, waitingDot, type RestInput } from './islandRest'

const at = (h: number, m = 0) => new Date(2026, 10, 6, h, m).getTime()
const NOW = at(10, 30)
const snap = (p: Partial<IslandSnapshot> = {}): IslandSnapshot => ({ ...EMPTY_ISLAND, at: NOW, locked: false, water: { ml: 1300, target: 2700 }, ...p })
const run = (p: Partial<RestInput> = {}) => restingView({ s: snap(), now: NOW, music: null, captions: false, idle: 'next', ...p })
const ben = (unread: number) => ({ ...EMPTY_ISLAND.ben, unread, last: { text: 'Hi', at: '2026-11-06T09:00:00Z', face: '🙂' } })

describe('the resting island', () => {
  it('shows the time when nothing is on and no event is left today', () => {
    const v = run()
    expect(v.primary.kind).toBe('time')
    expect(v.secondary).toBeNull()
    expect(v.hint).toMatch(/Water 1\.3 \/ 2\.7 L/)
  })

  it('shows the next event today by default, with its start time', () => {
    const v = run({ s: snap({ next: { title: 'Analiza', start: at(11, 30), end: at(13) } }) })
    expect(v.primary).toMatchObject({ kind: 'next', text: 'Analiza', time: '11:30' })
    expect(v.hint).toBe('in 1 h 00')
  })

  it('never shows tomorrow’s event as "next"', () => {
    expect(run({ s: snap({ next: { title: 'Gym', start: at(10, 30) + 86_400_000, end: at(12) + 86_400_000 } }) }).primary.kind).toBe('time')
  })

  it('shows what is on now, until when', () => {
    const v = run({ s: snap({ now: { title: 'Programarea', start: at(9, 45), end: at(11, 15) } }) })
    expect(v.primary).toMatchObject({ kind: 'now', text: 'Programarea', time: 'until 11:15' })
  })

  it('follows your pick for the calm state', () => {
    const s = snap({ next: { title: 'Analiza', start: at(11, 30), end: at(13) } })
    expect(run({ s, idle: 'time' }).primary.kind).toBe('time')
    expect(run({ s, idle: 'nothing' }).primary.kind).toBe('nothing')
  })

  it('shows the healthy-day ring only with something to show (never an empty ring)', () => {
    const health = (score: number, met: number) => ({ today: { score, met, parts: [{ id: 'water', icon: '💧', label: 'Water', done: false, pct: 0.5, text: '' }], streak: 0, bonus: false, line: '' } as never, week: null })
    expect(run({ idle: 'health', s: snap({ health: health(62, 2) }) }).primary).toMatchObject({ kind: 'health', text: '2/4', pct: 0.62 })
    expect(run({ idle: 'health', s: snap({ health: health(0, 0) }) }).primary.kind).toBe('time')
    expect(run({ idle: 'health' }).primary.kind).toBe('time')
  })

  it('puts a live timer first, then music, then an event soon, then captions, then something waiting', () => {
    const s = snap({
      running: { subject: 'Write the CV', startedAt: NOW - 600_000, endsAt: NOW + 900_000 },
      next: { title: 'Analiza', start: NOW + 8 * 60_000, end: NOW + 3_600_000 },
      ben: ben(1)
    })
    const music = { playing: true, title: 'Made-up track' }
    expect(run({ s, music, captions: true }).primary.kind).toBe('timer')
    expect(run({ s: { ...s, running: null }, music, captions: true }).primary.kind).toBe('music')
    expect(run({ s: { ...s, running: null }, captions: true }).primary.kind).toBe('soon')
    expect(run({ s: { ...s, running: null, next: null }, captions: true }).primary.kind).toBe('captions')
    expect(run({ s: { ...s, running: null, next: null } }).primary.kind).toBe('alert')
  })

  it('keeps at most one small extra beside the main thing', () => {
    const s = snap({ running: { subject: 'Essay', startedAt: NOW - 60_000, endsAt: NOW + 600_000 }, next: { title: 'Dentist', start: NOW + 5 * 60_000, end: NOW + 3_600_000 }, ben: ben(1) })
    const v = run({ s, music: { playing: true, title: 'x' }, captions: true })
    expect(v.primary.kind).toBe('timer')
    expect(v.secondary?.kind).toBe('soon')
    expect(v.hint).toBe('Essay')
  })

  it('an event more than 15 minutes away is calm, not live', () => {
    const v = run({ s: snap({ next: { title: 'Analiza', start: NOW + 16 * 60_000, end: NOW + 3_600_000 } }) })
    expect(v.primary.kind).toBe('next')
  })

  it('paused music is not "playing"', () => {
    expect(run({ music: { playing: false, title: 'x' } }).primary.kind).toBe('time')
  })

  it('the red dot means something: Ben’s new message or a reminder waiting, with words for the tooltip', () => {
    expect(waitingDot(snap()).on).toBe(false)
    expect(waitingDot(snap({ ben: ben(2) })).tip).toBe('2 new messages from Ben')
    const alert = { id: 'remind:1', kind: 'remind' as const, title: 'call mom', text: '', actions: [] }
    expect(waitingDot(snap({ alert })).tip).toBe('Waiting for you: call mom')
    const v = run({ s: snap({ running: { subject: 'Essay', startedAt: NOW, endsAt: NOW + 600_000 }, ben: ben(1) }) })
    expect(v.secondary).toMatchObject({ kind: 'alert', tip: '1 new message from Ben' })
  })

  it('leaves out what you switched off in Edit the pill', () => {
    const s = snap({ running: { subject: 'Essay', startedAt: NOW, endsAt: NOW + 600_000 }, next: { title: 'Analiza', start: at(11, 30), end: at(13) } })
    expect(run({ s, off: new Set(['timer']) }).primary.kind).toBe('next')
    expect(run({ s, off: new Set(['timer', 'next']) }).primary.kind).toBe('time')
  })

  it('the hour before bed counts down', () => {
    const v = run({ s: snap({ windDown: { bedAt: '23:00', minutesLeft: 42 } }) })
    expect(v.primary).toMatchObject({ kind: 'winddown', time: '0:42' })
  })

  it('the clock you switched on takes the small spot only when nothing live wants it', () => {
    expect(run({ clock: true, music: { playing: true, title: 'x' } }).secondary?.kind).toBe('clock')
    expect(run({ clock: true }).secondary).toBeNull()
    expect(run({ clock: false, music: { playing: true, title: 'x' } }).secondary).toBeNull()
  })
})

describe('the resting island in Simple mode (a quiet helper)', () => {
  const three = { sleep: 'none' as const, blocks: 1, mustDone: 1 }
  it('shows the 3 numbers, and nothing live but a running timer', () => {
    const quiet = run({ s: snap({ simple: true, three, ben: ben(2), next: { title: 'Lab', start: at(10, 40), end: at(12) } }), music: { playing: true, title: 'Song' } })
    expect(quiet.primary).toMatchObject({ kind: 'three', text: 'Bed 23:30 · 1 block · 1/3' })
    expect(quiet.secondary).toBeNull()
    const timer = run({ s: snap({ simple: true, three, running: { subject: 'Essay', startedAt: at(10), endsAt: at(10, 50) } }) })
    expect(timer.primary.kind).toBe('timer')
  })
  it('says last night as a tick or a cross', () => {
    expect(threeRest({ sleep: 'ok', blocks: 3, mustDone: 3 }).text).toBe('Sleep ✓ · 3 blocks · 3/3')
    expect(threeRest({ sleep: 'off', blocks: 0, mustDone: 5 }).text).toBe('Sleep ✗ · 0 blocks · 3/3')
  })
})
