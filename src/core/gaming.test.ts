import { describe, expect, it } from 'vitest'
import { inferContext } from './activityContext'
import { DEFAULT_GAMING, EMPTY_GAMING, cleanGaming, counterText, endedAlert, gameOf, gamingLine, gamingStep, gamingView, limitAlert, markWarned, timeText, todayMin, weekMin, weekStart, type GamingState } from './gaming'
import { recapLine } from './islandMoments'

// Monday 9 Nov 2026
const at = (h: number, m = 0, s = 0, day = 9) => new Date(2026, 10, day, h, m, s).getTime()

/** Plays `game` from `from` for `min` minutes, looking every 15 s. */
function play(st: GamingState, game: string | null, from: number, min: number) {
  let s = st
  let ended = null
  for (let t = from; t <= from + min * 60_000; t += 15_000) {
    const r = gamingStep(s, { now: t, game })
    s = r.state
    ended = r.ended ?? ended
  }
  return { s, ended }
}

describe('which program is a game', () => {
  it('knows Fortnite by its process name, with variants', () => {
    expect(gameOf('FortniteClient-Win64-Shipping.exe')).toBe('Fortnite')
    expect(gameOf('FortniteClient-Win64-Shipping_BE')).toBe('Fortnite')
    expect(gameOf('fortniteclient-win64-shipping_eac')).toBe('Fortnite')
  })
  it('knows the common games', () => {
    expect(gameOf('VALORANT-Win64-Shipping')).toBe('Valorant')
    expect(gameOf('cs2.exe')).toBe('Counter-Strike 2')
    expect(gameOf('League of Legends')).toBe('League of Legends')
    expect(gameOf('Minecraft.Windows')).toBe('Minecraft')
  })
  it('launchers are not games by themselves', () => {
    for (const l of ['EpicGamesLauncher', 'steam', 'steamwebhelper', 'RiotClientServices', 'Battle.net']) expect(gameOf(l, [], 'gaming')).toBeNull()
  })
  it('your list and the app\'s own gaming sort count; other apps do not', () => {
    expect(gameOf('hades2', ['hades2'])).toBe('Hades2')
    expect(gameOf('hades2', [])).toBeNull()
    expect(gameOf('somegame', [], 'gaming')).toBe('Somegame')
    expect(gameOf('code', [], 'coding')).toBeNull()
    expect(gameOf(null)).toBeNull()
  })
  it('the activity sorter already calls the Fortnite process gaming', () => {
    expect(inferContext({ proc: 'FortniteClient-Win64-Shipping.exe' } as never).kind).toBe('gaming')
    expect(inferContext({ proc: 'FortniteClient-Win64-Shipping_EAC.exe' } as never).kind).toBe('gaming')
  })
})

describe('session and totals', () => {
  it('counts minutes while a game is in front', () => {
    const { s } = play(EMPTY_GAMING, 'Fortnite', at(18), 42)
    expect(s.session?.label).toBe('Fortnite')
    expect(Math.round(s.session!.sec / 60)).toBe(42)
    expect(todayMin(s, at(18, 42))).toBe(42)
    expect(gamingView(s, { ...DEFAULT_GAMING, on: true }, at(18, 42))).toMatchObject({ on: true, app: 'Fortnite', sessionMin: 42, todayMin: 42 })
    expect(counterText({ app: 'Fortnite', sessionMin: 42 })).toBe('🎮 Fortnite · 42 min')
  })
  it('a short look at something else keeps the session; a long one ends it with a summary', () => {
    let { s } = play(EMPTY_GAMING, 'Fortnite', at(18), 30)
    // 2 minutes on Discord: still the same session, not counted.
    let r = play(s, null, at(18, 30, 15), 2)
    expect(r.s.session).not.toBeNull()
    expect(r.ended).toBeNull()
    r = play(r.s, 'Fortnite', at(18, 33), 10)
    expect(Math.round(r.s.session!.sec / 60)).toBeGreaterThanOrEqual(40)
    // Then away for good.
    const end = play(r.s, null, at(18, 44), 5)
    expect(end.ended).toMatchObject({ label: 'Fortnite' })
    expect(end.ended!.sessionMin).toBeGreaterThanOrEqual(40)
    expect(end.ended!.todayMin).toBe(end.ended!.sessionMin)
    expect(end.s.session).toBeNull()
    expect(endedAlert({ label: 'Fortnite', sessionMin: 40, todayMin: 40, weekMin: 40 }, at(18, 49)).title).toBe('🎮 40 min today · 40 min this week')
  })
  it('the first look and a long gap (sleep) credit nothing', () => {
    const a = gamingStep(EMPTY_GAMING, { now: at(18), game: 'Fortnite' })
    expect(todayMin(a.state, at(18))).toBe(0)
    const b = gamingStep(a.state, { now: at(20), game: 'Fortnite' })
    expect(b.state.days['2026-11-09']).toBe(90)
  })
  it('keeps days apart and sums the week from Monday', () => {
    expect(weekStart(at(12, 0, 0, 8))).toBe('2026-11-02')
    expect(weekStart(at(12))).toBe('2026-11-09')
    const st: GamingState = { ...EMPTY_GAMING, days: { '2026-11-02': 3600, '2026-11-08': 600, '2026-11-09': 1200 } }
    expect(todayMin(st, at(20))).toBe(20)
    expect(weekMin(st, at(20))).toBe(20)
    expect(weekMin(st, at(20, 0, 0, 10))).toBe(20)
    expect(weekMin({ ...st, days: { ...st.days, '2026-11-10': 600 } }, at(20, 0, 0, 11))).toBe(30)
    expect(timeText(70)).toBe('1h 10m')
  })
  it('the counter is off until switched on', () => {
    expect(gamingView(EMPTY_GAMING, DEFAULT_GAMING, at(12))).toBeNull()
    expect(cleanGaming(null)).toEqual(DEFAULT_GAMING)
    expect(cleanGaming({ on: true, extra: ['Hades2.exe', '', 'x'.repeat(100)], dayLimitMin: 5 }).dayLimitMin).toBeNull()
  })
})

describe('limits', () => {
  const prefs = { ...DEFAULT_GAMING, on: true, dayLimitMin: 180 }
  const st = (min: number): GamingState => ({ ...EMPTY_GAMING, days: { '2026-11-09': min * 60 } })
  it('80% then 100%, once each, calm words', () => {
    expect(limitAlert({ st: st(100), prefs, push: 'firm', now: at(20) })).toBeNull()
    const a = limitAlert({ st: st(145), prefs, push: 'firm', now: at(20) })!
    expect(a.alert.title).toBe("🎮 80% of today's game time")
    expect(a.alert.text).not.toMatch(/stop|bad|shame|waste/i)
    const warned = markWarned(st(145), a.key, at(20))
    expect(limitAlert({ st: warned, prefs, push: 'firm', now: at(20, 5) })).toBeNull()
    const b = limitAlert({ st: { ...warned, days: { '2026-11-09': 181 * 60 } }, prefs, push: 'firm', now: at(21) })!
    expect(b.alert.title).toBe('🎮 Daily game time reached')
    expect(limitAlert({ st: markWarned(warned, b.key, at(21)), prefs, push: 'firm', now: at(21, 5) })).toBeNull()
  })
  it('gentle only says the 100% one; a jump past 100% says only that', () => {
    expect(limitAlert({ st: st(150), prefs, push: 'gentle', now: at(20) })).toBeNull()
    expect(limitAlert({ st: st(190), prefs, push: 'gentle', now: at(20) })?.alert.title).toBe('🎮 Daily game time reached')
    expect(limitAlert({ st: st(190), prefs, push: 'push', now: at(20) })?.key).toBe('day:2026-11-09:100')
  })
  it('a weekly limit, and no limit means no warning', () => {
    expect(limitAlert({ st: st(500), prefs: { ...prefs, dayLimitMin: null }, push: 'firm', now: at(20) })).toBeNull()
    const w = limitAlert({ st: { ...EMPTY_GAMING, days: { '2026-11-09': 300 * 60 } }, prefs: { ...prefs, dayLimitMin: null, weekLimitMin: 240 }, push: 'firm', now: at(20, 0, 0, 9) })
    expect(w?.alert.title).toBe('🎮 Weekly game time reached')
  })
  it('a new day warns again', () => {
    const warned = markWarned(st(190), 'day:2026-11-09:100', at(20))
    expect(limitAlert({ st: { ...warned, days: { '2026-11-10': 190 * 60 } }, prefs, push: 'firm', now: at(20, 0, 0, 10) })).not.toBeNull()
  })
})

describe('totals for Ben and the recap', () => {
  it('totals only', () => {
    const st: GamingState = { ...EMPTY_GAMING, days: { '2026-11-09': 70 * 60, '2026-11-07': 130 * 60 } }
    expect(gamingLine(st, { ...DEFAULT_GAMING, on: true }, at(21))).toBe('gaming 1h 10m today, 1h 10m this week')
    expect(gamingLine(st, DEFAULT_GAMING, at(21))).toBeNull()
    expect(gamingLine(EMPTY_GAMING, { ...DEFAULT_GAMING, on: true }, at(21))).toBeNull()
    expect(recapLine({ mustDone: 1, mustTotal: 2, waterMl: 1000, waterTarget: 2000, focusMin: 30, focusGoal: 60, gamingMin: 70 })).toContain('1h 10m gaming')
  })
})
