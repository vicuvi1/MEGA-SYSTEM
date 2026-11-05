import { describe, expect, it } from 'vitest'
import { backToBlock, bedtimeFromClose, comeBack, contextPicker, emailBox, gamingBedtime, nextMustdo, spendAfterBank, startFromOpened, streakIn } from './smartSuggest'
import { blockDrift, blockReality, realityLine, smartAlert } from './islandSmart'

const T = Date.parse('2026-11-04T10:00:00')
const m = (n: number) => T + n * 60_000
const blk = (title: string, s: number, e: number, extra: object = {}) => ({ title, start: m(s), end: m(e), ...extra })
const span = (context: string, s: number, e: number) => ({ context, start: m(s), end: m(e) })
const base = { now: T, blocks: [] as any[], running: false, spans: [] as any[], doing: null as any }

describe('smart moments', () => {
  it('SI3: back to your block after 3 min of video, once per block, never for CTF work', () => {
    const o = { ...base, blocks: [blk('Algorithms', -25, 20, { id: 'a1', calendarId: 'c' })], spans: [span('coding', -25, -4), span('video', -4, 0)], doing: { ctx: 'video' as const, conf: 0.9 } }
    const s = backToBlock(o)
    expect(s).toMatchObject({ id: 'back:a1', sk: 'back', title: 'Algorithms block · 20 min left', text: '4 min of video. Back to it?' })
    expect(s?.accept.action).toEqual({ kind: 'start', subject: 'Algorithms', minutes: 20 })
    expect(s?.extra?.label).toBe('Push 15')
    expect(backToBlock({ ...o, running: true })).toBeNull()
    expect(backToBlock({ ...o, spans: [span('video', -2, 0)] })).toBeNull()
    expect(backToBlock({ ...o, spans: [span('ctf', -30, 0)] })).toBeNull()
    expect(blockDrift({ now: T, blocks: [blk('Sync', -5, 30, { call: true })], running: false, spans: [span('video', -10, 0)] })).toBeNull()
  })
  it('SI4: opened your course, no timer and no block: start one, sized to the free time', () => {
    const o = { ...base, blocks: [blk('Gym', 40, 100)], spans: [span('study', -3, 0)], doing: { ctx: 'study' as const, detail: 'Algorithms', conf: 0.85 }, goals: ['Algorithms'] }
    const s = startFromOpened(o)
    expect(s?.title).toBe('Start 35 min · Algorithms?')
    expect(s?.accept.action).toEqual({ kind: 'start', subject: 'Algorithms', minutes: 35 })
    expect(startFromOpened({ ...o, goals: ['Rust'] })).toBeNull()
    expect(startFromOpened({ ...o, spans: [span('study', -1, 0)] })).toBeNull()
    expect(startFromOpened({ ...o, blocks: [blk('Gym', 10, 60)] })).toBeNull()
    expect(startFromOpened({ ...o, blocks: [blk('Algorithms', -5, 60)] })).toBeNull()
  })
  it('SI13: gaming in the last hour before bed', () => {
    const s = gamingBedtime({ ...base, doing: { ctx: 'gaming' as const, conf: 0.9 }, windDown: { bedAt: '23:00', minutesLeft: 40 } })
    expect(s?.title).toBe('Bed in 40 min')
    expect(s?.text).toContain('One more match')
    expect(gamingBedtime({ ...base, doing: { ctx: 'coding' as const, conf: 0.9 }, windDown: { bedAt: '23:00', minutesLeft: 40 } })).toBeNull()
  })
  it('SI14: just left the bank: log spending (opens Money)', () => {
    expect(spendAfterBank({ now: T, bankLeftAt: m(-1) })?.accept.action).toEqual({ kind: 'open', page: 'money' })
    expect(spendAfterBank({ now: T, bankLeftAt: m(-10) })).toBeNull()
  })
  it('SI15: 10 min drifting with nothing on: the next must-do', () => {
    const o = { ...base, spans: [span('browsing', -6, -3), span('video', -3, 0)], mustdos: [{ text: 'Essay intro', done: false }] }
    expect(nextMustdo(o)).toBeNull()
    const s = nextMustdo({ ...o, spans: [span('browsing', -12, 0)] })
    expect(s?.title).toBe('Next must-do: Essay intro')
    expect(s?.accept.action).toEqual({ kind: 'start', subject: 'Essay intro', minutes: 25 })
    expect(nextMustdo({ ...o, spans: [span('browsing', -12, 0)], running: true })).toBeNull()
  })
  it('SI16: 15 min of email outside a block', () => {
    expect(emailBox({ ...base, spans: [span('email', -16, 0)] })?.accept.action).toEqual({ kind: 'start', subject: 'Email', minutes: 10 })
    expect(emailBox({ ...base, spans: [span('email', -16, 0)], blocks: [blk('Admin', -20, 20)] })).toBeNull()
  })
  it('SI18: back after 20 min of video in work hours', () => {
    const s = comeBack({ ...base, spans: [span('video', -22, 0)], last: { subject: 'Essay intro', endedAt: m(-40) } })
    expect(s?.title).toBe('Last: Essay intro (40 min ago)')
    expect(s?.accept.label).toBe('▶ Resume · 25 min')
    expect(comeBack({ ...base, now: Date.parse('2026-11-04T21:00:00'), spans: [{ context: 'video', start: Date.parse('2026-11-04T20:30:00'), end: Date.parse('2026-11-04T21:00:00') }], last: { subject: 'x', endedAt: Date.parse('2026-11-04T20:00:00') } })).toBeNull()
  })
  it('SI20: closed the laptop late: bedtime to confirm (logs only on the tap)', () => {
    const from = Date.parse('2026-11-04T00:40:00')
    const s = bedtimeFromClose({ now: Date.parse('2026-11-04T08:10:00'), away: { from, to: Date.parse('2026-11-04T08:00:00') }, bedLogged: false })
    expect(s?.title).toBe('Bed at 00:40?')
    expect(s?.accept.action).toEqual({ kind: 'bed', time: '00:40' })
    expect(bedtimeFromClose({ now: T, away: { from: m(-60), to: m(-1) }, bedLogged: false })).toBeNull()
  })
  it('SI1: the picker offers the other kinds', () => {
    const p = contextPicker('Obsidian', 'writing')
    expect(p.title).toBe('What is Obsidian for?')
    expect(p.options.map((o) => o.ctx)).not.toContain('writing')
  })
  it('SI10: plan vs reality at the end of a block', () => {
    const r = blockReality([span('coding', -50, -12), span('video', -12, -5), span('coding', -5, 0)], { start: m(-45), end: m(0) })
    expect(r).toMatchObject({ kind: 'coding', minutes: 38, of: 45 })
    expect(realityLine(r)).toBe('You were coding 38 of 45 min.')
    const a = smartAlert({ now: m(5), blocks: [blk('Algorithms', -45, 0)], running: false, idleSec: 0, dismissed: {}, answered: {}, reality: () => 'You were coding 38 of 45 min.' })
    expect(a?.text).toBe('You were coding 38 of 45 min. Did you finish “Algorithms”?')
  })
  it('counts minutes in a row', () => {
    expect(streakIn([span('coding', -30, -10), span('video', -10, 0)], ['video'], T)).toBe(10)
  })
})
