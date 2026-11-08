// Body reminders (water, eye break, move break, screen break): an allowed one
// opens as the real card with its own sound, once; every protection keeps the
// sound silent. The clock is pinned (Sunday 2026-11-08, 15:00).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bodyReminderOf, BODY_REMINDER_SOUND, cleanReminderSounds, DEFAULT_REMINDER_SOUNDS, EYE_BREAKS_DEFAULT, hushOf, reminderGain, reminderPlan } from './islandReminderSound'
import { modeGate, DEFAULT_PEEK_FOR, cleanPeekFor } from './islandCalm'
import { alertGate, DEFAULT_ISLAND_PREFS } from './islandModel'
import { eyesNudge } from './islandNudges'
import { cleanNudgeStore } from './islandNudges'
import { cleanSoundPrefs, SOUND_CATEGORY } from './sounds'
import { DEFAULT_MOMENTS, momentForSound } from './soundMoments'

const NOW = new Date(2026, 10, 8, 15, 0).getTime()
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const water = { id: 'water:15', kind: 'water' }
const eyes = { id: 'eyes:2400', kind: 'eyes' }
const move = { id: 'move:2026-11-08:14:peek', kind: 'move' }
const screen = { id: 'coach:break:2026-11-08:3', kind: 'move' }
const base = { mode: 'calm' as const, gate: 'peek' as const, islandSound: true, kindSound: true, prefs: DEFAULT_REMINDER_SOUNDS, hush: null, quiet: false, call: false, blocked: null, played: false }

describe('which body reminder', () => {
  it('knows water, eyes, the move break and the screen break; not posture or tidy', () => {
    expect(bodyReminderOf(water)).toBe('water')
    expect(bodyReminderOf(eyes)).toBe('eyes')
    expect(bodyReminderOf(move)).toBe('move')
    expect(bodyReminderOf(screen)).toBe('screen')
    expect(bodyReminderOf({ id: 'posture:3', kind: 'move' })).toBeNull()
    expect(bodyReminderOf({ id: 'remind:1', kind: 'remind' })).toBeNull()
  })
  it('each has its own sound in the kit, under its own "which sound for what"', () => {
    const names = Object.values(BODY_REMINDER_SOUND)
    expect(new Set(names).size).toBe(4)
    for (const n of names) expect(SOUND_CATEGORY[n]).toBe('alerts')
    const moments = names.map((n) => momentForSound(n)!)
    expect(moments).toEqual(['water', 'eyes', 'move', 'screen'])
    expect(new Set(moments.map((m) => DEFAULT_MOMENTS[m])).size).toBe(4)
    expect(DEFAULT_MOMENTS.water).toBe('drop')
    expect(DEFAULT_MOMENTS.screen).toBe('calmbell')
  })
})

describe('an allowed reminder expands and rings', () => {
  it('in Calm and Balanced: {expand: true, sound: <kind>} for each kind', () => {
    for (const mode of ['calm', 'balanced', 'lively'] as const)
      for (const [a, k] of [[water, 'water'], [eyes, 'eyes'], [move, 'move'], [screen, 'screen']] as const) {
        const gate = modeGate({ mode, kind: a.kind, id: a.id, peekFor: DEFAULT_PEEK_FOR, base: alertGate({ kind: a.kind, prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: false, lastPeekAt: 0, now: NOW }) })
        expect(reminderPlan({ ...base, mode, alert: a, gate })).toEqual({ expand: true, sound: k, why: null })
      }
  })
  it('eye breaks are on by default (the generator and "Peek for"), and an old saved "off" in Peek for turns on', () => {
    expect(EYE_BREAKS_DEFAULT).toBe(true)
    expect(DEFAULT_PEEK_FOR.eyes).toBe(true)
    expect(cleanPeekFor({ eyes: false }).eyes).toBe(true)
    // The real eye-break card after 25 min at the PC, with the default switch.
    const a = eyesNudge({ now: NOW, day: '2026-11-08', busy: false, idleSec: 5, activeSince: NOW - 25 * 60_000, store: cleanNudgeStore(null), dismissed: {}, snooze: { now: NOW }, eyeBreaks: EYE_BREAKS_DEFAULT, lastEyesAt: 0 })
    expect(a?.kind).toBe('eyes')
    expect(a?.nudge).toMatchObject({ type: 'timer', seconds: 20 })
    const gate = modeGate({ mode: 'calm', kind: 'eyes', id: a!.id, peekFor: DEFAULT_PEEK_FOR, base: 'peek' })
    expect(reminderPlan({ ...base, alert: a!, gate })).toMatchObject({ expand: true, sound: 'eyes' })
  })
  it('the volume lifts the soft kit notes (80 % ≈ twice the old island reminder)', () => {
    expect(reminderGain(80)).toBeCloseTo(1.92)
    expect(reminderGain(0)).toBe(0)
    expect(reminderGain(500)).toBeCloseTo(2.4)
  })
})

describe('no sound when it must stay quiet', () => {
  it('blocked by a gate: a dot or not shown makes no sound', () => {
    expect(reminderPlan({ ...base, alert: water, gate: 'silent' })).toMatchObject({ expand: false, sound: null })
    expect(reminderPlan({ ...base, alert: water, gate: 'drop' })).toMatchObject({ expand: false, sound: null })
    // Peek for → Eye breaks off: a dot, silent.
    const gate = modeGate({ mode: 'calm', kind: 'eyes', id: eyes.id, peekFor: { ...DEFAULT_PEEK_FOR, eyes: false }, base: 'peek' })
    expect(reminderPlan({ ...base, alert: eyes, gate }).sound).toBeNull()
    // Quiet hours and calls already make the gate a dot / drop.
    expect(alertGate({ kind: 'water', prefs: DEFAULT_ISLAND_PREFS, quiet: true, call: false, lastPeekAt: 0, now: NOW })).toBe('drop')
    expect(alertGate({ kind: 'eyes', prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: true, lastPeekAt: 0, now: NOW })).toBe('silent')
  })
  it('a call, a focus timer, a class, after bed, quiet, a muted system', () => {
    for (const hush of ['call', 'focus', 'class', 'bed'] as const) expect(reminderPlan({ ...base, alert: water, hush })).toMatchObject({ expand: true, sound: null })
    expect(reminderPlan({ ...base, alert: water, call: true }).sound).toBeNull()
    expect(reminderPlan({ ...base, alert: water, quiet: true }).sound).toBeNull()
    expect(reminderPlan({ ...base, alert: water, blocked: 'quiet hours' })).toMatchObject({ sound: null, why: 'quiet hours' })
    expect(reminderPlan({ ...base, alert: water, blocked: 'the system is muted' }).sound).toBeNull()
  })
  it('your switches: per kind off, volume 0, island sounds off, the kind 🔔 off', () => {
    const off = cleanReminderSounds({ on: { eyes: false } })
    expect(reminderPlan({ ...base, alert: eyes, prefs: off }).sound).toBeNull()
    expect(reminderPlan({ ...base, alert: water, prefs: off }).sound).toBe('water')
    expect(reminderPlan({ ...base, alert: water, prefs: { ...off, volume: 0 } }).sound).toBeNull()
    expect(reminderPlan({ ...base, alert: water, islandSound: false }).sound).toBeNull()
    expect(reminderPlan({ ...base, alert: water, kindSound: false }).sound).toBeNull()
  })
  it('once per reminder: no repeat when it rang already', () => {
    expect(reminderPlan({ ...base, alert: move, played: true })).toMatchObject({ expand: true, sound: null, why: 'already rang' })
  })
  it('the snapshot says why it is hushed, call first', () => {
    expect(hushOf({ call: false, focus: false, event: false, asleep: false })).toBeNull()
    expect(hushOf({ call: true, focus: true, event: true, asleep: true })).toBe('call')
    expect(hushOf({ call: false, focus: true, event: false, asleep: false })).toBe('focus')
    expect(hushOf({ call: false, focus: false, event: true, asleep: false })).toBe('class')
    expect(hushOf({ call: false, focus: false, event: false, asleep: true })).toBe('bed')
  })
  it('settings clean up: all on at 80 % by default, kept when saved', () => {
    expect(cleanReminderSounds(null)).toEqual(DEFAULT_REMINDER_SOUNDS)
    expect(cleanReminderSounds({ on: { water: false, junk: true }, volume: 140 })).toEqual({ on: { ...DEFAULT_REMINDER_SOUNDS.on, water: false }, volume: 100 })
    expect(cleanSoundPrefs({}).reminders).toEqual(DEFAULT_REMINDER_SOUNDS)
  })
})
