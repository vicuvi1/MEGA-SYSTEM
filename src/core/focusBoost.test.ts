// Focus boost's pure parts: stalling fixes (DX7), launch kits (DX9), session
// goals and verdicts (DX10), workout-only music (DX12), the morning countdown
// (DX19), Dojo maths (LF14), win clips (LF20) and the settings. Made-up data,
// pinned clocks.
import { describe, expect, it } from 'vitest'
import { addStall, excuseWords, readStallCallback, stallCallback, stallCounts, stallFix, stallKeyboard, stallLine, subjectFromPush } from './stallFix'
import { classifyExcuse } from './benKnows'
import { cleanKit, cleanKits, kitFor, kitReach, kitSummary, kitWorkspace, okFolder, okLink } from './launchKit'
import { blockResultOf, cleanSessions, learnLine, setGoal, setVerdict, statsLine, verdictStats, type SessionRec } from './sessionGoal'
import { cleanOnly, mayPlay, nextOnly, stationFor, timerMode } from './musicOnly'
import { cleanRun, currentStep, launchCard, markStep, morningBegin, secondsLeft, DEFAULT_MORNING } from './morningLaunch'
import { breathAt, cleanDojo, dojoClock, ringStroke, sceneOf, DEFAULT_DOJO } from './dojo'
import { cleanWins, winClip, DEFAULT_WINS, WIN_GAP_MS } from './winMoments'
import { cleanBoost, cleanBoostLog, DEFAULT_BOOST } from './focusBoost'
import { cleanMusicKit } from './music'

const NOW = new Date('2026-03-10T07:00:00').getTime()

describe('DX7 why I am stalling', () => {
  it('gives each reason its own instant fix', () => {
    expect(stallFix('tired', 'Essay intro').action).toEqual({ kind: 'focus', subject: 'Essay intro (light)', minutes: 10 })
    expect(stallFix('unclear', 'Essay intro').action).toMatchObject({ kind: 'focus', minutes: 5 })
    expect(stallFix('big', 'Thesis chapter').action).toEqual({ kind: 'split', subject: 'Thesis chapter' })
    const boring = stallFix('boring', 'Laundry', { boringStation: 'https://soundcloud.com/demo/sets/chores', reward: 'Movie night' })
    expect(boring).toMatchObject({ station: 'https://soundcloud.com/demo/sets/chores', reward: 'Movie night', action: { minutes: 25 } })
    expect(boring.text).toMatch(/Movie night/)
    expect(stallFix('scared', 'Call the bank').action).toMatchObject({ minutes: 5 })
  })

  it('Telegram buttons fit 64 bytes and read back; the block name comes from the push', () => {
    const cb = stallCallback('big', 'A very long block name about a lot of different things to do today ok')
    expect(new TextEncoder().encode(cb).length).toBeLessThanOrEqual(64)
    expect(readStallCallback(cb)?.reason).toBe('big')
    expect(readStallCallback('sl|x|a')).toBeNull()
    expect(stallKeyboard('Lab 4').inline_keyboard.flat()).toHaveLength(5)
    expect(subjectFromPush('🎯 Lab 4 · 10:00\nLab 4 starts now, ready?')).toBe('Lab 4')
  })

  it('counts reasons and tells Ben; tired and boring land on his excuse log', () => {
    let log = addStall([], { at: '2026-03-09T10:00:00Z', reason: 'big', subject: 'Thesis' })
    log = addStall(log, { at: '2026-03-10T10:00:00Z', reason: 'big', subject: 'Thesis' })
    log = addStall(log, { at: '2026-03-10T11:00:00Z', reason: 'tired', subject: 'Gym' })
    expect(stallCounts(log, '2026-03-10')).toEqual([{ reason: 'big', n: 2 }, { reason: 'tired', n: 1 }])
    expect(stallLine(log, '2026-03-10')).toBe('Why he stalls (30 days): too big ×2, tired ×1')
    expect(classifyExcuse(excuseWords('tired', 'Gym')!)).toBe('tired')
    expect(classifyExcuse(excuseWords('boring', 'Laundry')!)).toBe('no mood')
    expect(excuseWords('scared', 'x')).toBeNull()
  })
})

describe('DX9 launch kits', () => {
  const kit = cleanKit({ id: 'code', name: 'Coding', kinds: ['code'], words: ['CTF'], apps: ['VS Code'], folders: ['C:\\Projects\\demo', '../../etc', 'relative/path'], links: ['https://example.com/ctf', 'javascript:alert(1)', 'file:///c:/x'], station: 'https://soundcloud.com/demo/sets/focus', closeOnEnd: true })!

  it('keeps only real paths, http(s) links and SoundCloud stations', () => {
    expect(kit.folders).toEqual(['C:\\Projects\\demo'])
    expect(kit.links).toEqual(['https://example.com/ctf'])
    expect(okLink('ftp://x')).toBe(false)
    expect(okFolder('/home/demo/notes')).toBe(true)
    expect(okFolder('C:\\a\\..\\b')).toBe(false)
    expect(cleanKit({ station: 'https://evil.example/x' })?.station).toBeNull()
    expect(cleanKits([kit, kit, null]).length).toBe(1)
  })

  it('finds the kit by words first, then the kind of work', () => {
    const study = cleanKit({ id: 'study', name: 'Study', kinds: ['study'] }, 1)!
    expect(kitFor([kit, study], 'CTF practice')?.id).toBe('code')
    expect(kitFor([kit, study], 'Debug the login form')?.id).toBe('code')
    expect(kitFor([kit, study], 'Math exam revision')?.id).toBe('study')
    expect(kitFor([kit, study], 'Buy groceries')).toBeNull()
  })

  it('turns into the desktop workspace; the website can only open links (honest)', () => {
    expect(kitWorkspace(kit)).toEqual({ apps: ['VS Code'], links: ['https://example.com/ctf'], files: [], folder: 'C:\\Projects\\demo' })
    expect(kitReach(kit, false)).toEqual({ opens: ['example.com'], skipped: ['VS Code', 'a folder'] })
    expect(kitSummary(kit)).toBe('VS Code, 1 folder, 1 link, music')
  })
})

describe('DX10 session goal and verdict', () => {
  it('saves the goal, then the verdict, and counts finished work (not just minutes)', () => {
    let log: SessionRec[] = []
    log = setGoal(log, { id: '2026-03-10T09:00:00Z', day: '2026-03-10', subject: 'App dev', goal: 'Login form saves' })
    log = setVerdict(log, { id: '2026-03-10T09:00:00Z', day: '2026-03-10', subject: 'App dev', verdict: 'done', minutes: 50, endedAt: '2026-03-10T09:50:00Z' })
    log = setVerdict(log, { id: '2026-03-10T11:00:00Z', day: '2026-03-10', subject: 'Essay', verdict: 'half', minutes: 25, endedAt: 'x' })
    log = setVerdict(log, { id: '2026-03-10T13:00:00Z', day: '2026-03-10', subject: 'Essay', verdict: 'not', minutes: 10, endedAt: 'x' })
    expect(log[0]).toMatchObject({ goal: 'Login form saves', verdict: 'done', kind: 'code' })
    const s = verdictStats(log, '2026-03-10')
    expect(s).toMatchObject({ sessions: 3, done: 1, half: 1, not: 1, minutes: 85, doneMinutes: 50 })
    expect(s.finished).toBeCloseTo(0.5)
    expect(statsLine(s)).toBe('1 of 3 sessions finished (1 half) · 50% finished work')
    expect(blockResultOf('not')).toBe('no')
  })

  it("tells Ben which kinds he finishes once there are 3 answers of a kind", () => {
    const mk = (i: number, subject: string, verdict: 'done' | 'not'): SessionRec => ({ id: `s${i}`, day: '2026-03-09', subject, goal: '', kind: 'other', verdict, minutes: 25 })
    const log = cleanSessions([mk(1, 'Rust code', 'done'), mk(2, 'Rust code', 'done'), mk(3, 'Rust code', 'not'), mk(4, 'Essay write', 'not')])
    expect(learnLine(verdictStats(log, '2026-03-10'))).toBe('Sessions he finishes (7 days, done = 100%, half = 50%): coding 67%')
    expect(learnLine(verdictStats([], '2026-03-10'))).toBeNull()
  })
})

describe('DX12 workout-only music', () => {
  const st = [{ id: 's1', name: 'Gym mix', url: 'https://soundcloud.com/demo/sets/gym', kind: 'playlist' as const }, { id: 's2', name: 'Lo-fi', url: 'https://soundcloud.com/demo/sets/lofi', kind: 'playlist' as const }]
  const only = cleanOnly({ 'https://soundcloud.com/demo/sets/gym': 'workout', 'https://evil.example/x': 'workout', 'https://soundcloud.com/demo/sets/lofi': 'party' })

  it('plays marked music only while that timer runs', () => {
    expect(only).toEqual({ 'https://soundcloud.com/demo/sets/gym': 'workout' })
    expect(timerMode('Gym session')).toBe('workout')
    expect(timerMode('Laundry and dishes')).toBe('boring')
    expect(timerMode('Rust code')).toBe('other')
    expect(timerMode(null)).toBeNull()
    expect(mayPlay(st[0].url, only, 'workout')).toBe(true)
    expect(mayPlay(st[0].url, only, 'other')).toBe(false)
    expect(mayPlay(st[0].url, only, null)).toBe(false)
    expect(mayPlay(st[1].url, only, null)).toBe(true)
    expect(stationFor(st, only, 'workout')?.id).toBe('s1')
    expect(stationFor(st, only, 'boring')).toBeNull()
    expect([nextOnly(undefined), nextOnly('workout'), nextOnly('boring')]).toEqual(['workout', 'boring', undefined])
  })

  it('lives with the stations in the music settings (and stays out when empty)', () => {
    expect(cleanMusicKit({ onlyDuring: { 'https://soundcloud.com/demo/sets/gym': 'boring' } }).onlyDuring).toEqual({ 'https://soundcloud.com/demo/sets/gym': 'boring' })
    expect('onlyDuring' in cleanMusicKit({})).toBe(false)
  })
})

describe('DX19 morning launch countdown', () => {
  it('starts after the wake-up (or the brief), runs water → push-ups → the must-do in 2 minutes, once', () => {
    const woke = NOW - 5 * 60_000
    expect(morningBegin({ run: null, day: '2026-03-10', now: NOW, prefs: DEFAULT_MORNING, wokeAt: null, briefOpenedAt: null })).toBeNull()
    expect(morningBegin({ run: null, day: '2026-03-10', now: NOW, prefs: { ...DEFAULT_MORNING, on: false }, wokeAt: woke, briefOpenedAt: null })).toBeNull()
    expect(morningBegin({ run: null, day: '2026-03-10', now: NOW + 4 * 3600_000, prefs: DEFAULT_MORNING, wokeAt: woke, briefOpenedAt: null })).toBeNull()
    let run = morningBegin({ run: null, day: '2026-03-10', now: NOW, prefs: DEFAULT_MORNING, wokeAt: null, briefOpenedAt: woke })!
    expect(currentStep(run, true)).toBe('water')
    expect(launchCard({ run, now: NOW, prefs: DEFAULT_MORNING, mustdo: 'Essay intro', kit: null })).toMatchObject({ title: 'Launch 1/3 · Water', buttons: [{ op: 'water' }, { op: 'skip' }] })
    run = markStep(run, 'water', 'done', NOW + 60_000)
    expect(currentStep(run, true)).toBe('pushups')
    expect(launchCard({ run, now: NOW, prefs: DEFAULT_MORNING, mustdo: 'Essay intro', kit: null })?.text).toMatch(/Tap only when you did them/)
    run = markStep(run, 'pushups', 'skip', NOW + 120_000)
    expect(run.lastAt).toBe(NOW + 120_000)
    expect(secondsLeft(run, NOW + 150_000, DEFAULT_MORNING)).toBe(90)
    expect(launchCard({ run, now: NOW + 150_000, prefs: DEFAULT_MORNING, mustdo: 'Essay intro', kit: 'Writing' })).toMatchObject({ title: 'Launch 3/3 · 1:30', buttons: [{ label: '▶ Open it + kit' }, { op: 'skip' }] })
    expect(launchCard({ run, now: NOW + 500_000, prefs: DEFAULT_MORNING, mustdo: 'Essay intro', kit: null })?.title).toBe('Launch 3/3 · now')
    run = markStep(run, 'mustdo', 'done', NOW + 160_000)
    expect(currentStep(run, true)).toBeNull()
    expect(cleanRun(run, '2026-03-10')).toEqual(run)
    expect(cleanRun(run, '2026-03-11')).toBeNull()
  })

  it('skips the must-do step when there is none', () => {
    const run = markStep(markStep({ day: 'd', startedAt: NOW, marks: {} }, 'water', 'done', NOW, false), 'pushups', 'done', NOW, false)
    expect(currentStep(run, false)).toBeNull()
    expect(launchCard({ run: { day: 'd', startedAt: NOW, marks: {} }, now: NOW, prefs: DEFAULT_MORNING, mustdo: null, kit: null })?.title).toBe('Launch 1/2 · Water')
  })
})

describe('LF14 Dojo maths', () => {
  it('breathes in and out smoothly, and is still with reduce motion', () => {
    expect(breathAt(0, 5)).toMatchObject({ phase: 'in', scale: 0.94 })
    expect(breathAt(5000, 5)).toMatchObject({ phase: 'out', scale: 1.04 })
    expect(breathAt(2500, 5).scale).toBeCloseTo(0.99, 2)
    expect(breathAt(7000, 5, true)).toEqual({ phase: 'in', t: 0, scale: 1 })
  })
  it('the ink ring empties with the timer; the clock reads well', () => {
    expect(ringStroke(1, 100)).toEqual({ dash: 628.32, offset: 0 })
    expect(ringStroke(0.5, 100).offset).toBeCloseTo(314.16, 1)
    expect(ringStroke(-1, 100).offset).toBe(628.32)
    expect(dojoClock(25 * 60_000)).toBe('25:00')
    expect(dojoClock(3723_000)).toBe('1:02:03')
    expect(sceneOf('city').art).toBe('neon-rain')
    expect(cleanDojo({ scene: 'moon', ambientVol: 500, breath: 1 })).toEqual({ ...DEFAULT_DOJO, ambientVol: 60, breath: 3 })
  })
})

describe('LF20 win music', () => {
  const prefs = cleanWins({ on: true, victory: { url: 'https://soundcloud.com/demo/victory', name: 'Victory' }, clipSec: 99 })
  const base = { prefs, kind: 'levelUp' as const, now: NOW, meeting: false, quiet: false, musicPlaying: false, lastAt: null }
  it('is opt-in, short, never in meetings or quiet hours, never over your music, one per 10 min', () => {
    expect(winClip(base)).toEqual({ play: true, track: { url: 'https://soundcloud.com/demo/victory', name: 'Victory' }, ms: 30_000 })
    expect(winClip({ ...base, prefs: DEFAULT_WINS })).toMatchObject({ play: false, why: 'off' })
    expect(winClip({ ...base, meeting: true })).toMatchObject({ play: false, why: 'in a meeting' })
    expect(winClip({ ...base, quiet: true })).toMatchObject({ play: false })
    expect(winClip({ ...base, musicPlaying: true })).toMatchObject({ play: false })
    expect(winClip({ ...base, lastAt: NOW - WIN_GAP_MS + 1000 })).toMatchObject({ play: false })
    expect(winClip({ ...base, prefs: { ...prefs, kinds: { ...prefs.kinds, levelUp: false } } })).toMatchObject({ play: false })
    expect(cleanWins({ on: true, victory: { url: 'https://evil.example/x' } }).victory).toBeNull()
  })
})

describe('focus boost settings', () => {
  it('cleans everything and falls back to safe defaults', () => {
    expect(cleanBoost(null)).toEqual(DEFAULT_BOOST)
    expect(cleanBoost({ stall: false, goals: 'yes', kits: [{ name: 'Study', kinds: ['study', 'nonsense'] }] })).toMatchObject({ stall: false, goals: true, kits: [{ name: 'Study', kinds: ['study'] }] })
    expect(DEFAULT_BOOST.wins.on).toBe(false)
    expect(cleanBoostLog({ sessions: [{ id: 'x' }], stalls: [{ at: 'a', reason: 'lazy' }] })).toEqual({ sessions: [], stalls: [] })
  })
})
