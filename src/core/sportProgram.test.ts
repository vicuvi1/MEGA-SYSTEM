import { describe, expect, it } from 'vitest'
import { buildSession, estimateMinutes, growTips, splitOf, todaysSession, weekPlan } from './sportProgram'
import { figureShapes } from './sportDraw'
import { MOVES } from './sportMoves'
import { stillFrame } from './sportFigure'
import { PHOTOS, photoOf } from './sportPhotos'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const EX = [
  { id: 'p', name: 'Push-ups', target: 45, move: 'decline_pushup' },
  { id: 's', name: 'Squats', target: 60, move: 'bulgarian_squat' },
  { id: 'o', name: 'Old', target: 10, move: 'incline_pushup', active: false }
]

describe('weekly program', () => {
  it.each([20, 30, 45])('a %i-minute session fits, with 4–6 exercises of 3 sets and 60–120 s rest', (min) => {
    for (const kind of ['full_a', 'full_b', 'upper', 'lower'] as const) {
      const s = buildSession(kind, EX, { minutes: min, perWeek: 3, mode: 'grow' })
      expect(s.minutes).toBeLessThanOrEqual(min)
      expect(s.items.length).toBeGreaterThanOrEqual(4)
      expect(s.items.length).toBeLessThanOrEqual(6)
      for (const it of s.items) {
        expect(it.sets).toBe(3)
        expect(it.rest).toBeGreaterThanOrEqual(60)
        expect(it.rest).toBeLessThanOrEqual(120)
      }
      expect(s.warmup).toBe(3)
    }
  })

  it('more time, more exercises; your own step on each ladder is used', () => {
    const short = buildSession('full_a', EX, { minutes: 20, perWeek: 3 })
    const long = buildSession('full_a', EX, { minutes: 45, perWeek: 3 })
    expect(long.items.length).toBeGreaterThan(short.items.length)
    expect(long.items[0].move.id).toBe('decline_pushup')
    expect(long.items[0].exId).toBe('p')
    expect(long.items.some((i) => i.move.id === 'bulgarian_squat')).toBe(true)
    expect(long.items.some((i) => i.move.id === 'incline_pushup')).toBe(false)
  })

  it('a cool-down adds its minutes', () => {
    const a = buildSession('upper', EX, { minutes: 45, perWeek: 4 })
    const b = buildSession('upper', EX, { minutes: 45, perWeek: 4, coolDown: true })
    expect(b.cooldown).toBe(3)
    expect(b.minutes).toBeLessThanOrEqual(45)
    expect(estimateMinutes(a.items, 3, 3)).toBe(estimateMinutes(a.items) + 3)
  })

  it('3 a week: full body on Mon, Wed, Fri; 4 a week: upper / lower; rest days between', () => {
    const w3 = weekPlan(EX, { minutes: 30, perWeek: 3 }, '2026-03-11')
    expect(w3.map((d) => d.day)).toEqual(['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15'])
    expect(w3.map((d) => (d.session ? d.session.kind.slice(0, 4) : '-'))).toEqual(['full', '-', 'full', '-', 'full', '-', '-'])
    expect(w3[0].session!.kind).not.toBe(w3[2].session!.kind)
    const w4 = weekPlan(EX, { minutes: 30, perWeek: 4 }, '2026-03-11')
    expect(w4.filter((d) => d.session).map((d) => d.session!.kind)).toEqual(['upper', 'lower', 'upper', 'lower'])
    expect(splitOf({ minutes: 30, perWeek: 4, split: 'full' })).toBe('full')
    expect(todaysSession(EX, { minutes: 30, perWeek: 3 }, '2026-03-10')).toBeNull()
  })

  it('short tips with protein for your weight', () => {
    expect(growTips(75)[0]).toMatch(/120 g/)
    expect(growTips(null)[0]).toMatch(/1.6 g per kg/)
  })
})

describe('demos', () => {
  it('every move has a photo pair on disk or a drawn figure with real shapes', () => {
    const dir = resolve(__dirname, '../renderer/public/apps/sport')
    for (const m of MOVES) {
      const ph = photoOf(m.id)
      if (ph) {
        expect(existsSync(resolve(dir, ph.start)), ph.start).toBe(true)
        expect(existsSync(resolve(dir, ph.end)), ph.end).toBe(true)
      }
      const s = figureShapes(stillFrame(m.anim))
      for (const d of Object.values(s)) expect(d).toMatch(/^M[-\d.]+ [-\d.]+/)
    }
    expect(Object.keys(PHOTOS).length).toBeGreaterThanOrEqual(25)
    expect(photoOf('archer_pushup')).toBeNull()
    expect(existsSync(resolve(dir, 'photos/NOTICE.md'))).toBe(true)
  })
})
