import { describe, expect, it } from 'vitest'
import { cardSoundKey, cardSoundLine, cardSoundName, cardSoundPlan, isTestSound, TEST_SOUND_PREFIX, type CardSoundIn } from './islandCardSound'
import { cleanReminderSounds, DEFAULT_REMINDER_SOUNDS, reminderGain } from './islandReminderSound'

const base = (alert: CardSoundIn['alert'], x: Partial<CardSoundIn> = {}): CardSoundIn => ({
  alert, gate: 'peek', islandSound: true, kindSound: true, on: DEFAULT_REMINDER_SOUNDS.on, volume: 80, hush: null, quiet: false, call: false, blocked: null, played: false, ...x
})

describe('which switch and sound each notification uses', () => {
  it('maps every kind of card', () => {
    expect(cardSoundKey({ kind: 'water', id: 'water:1' })).toBe('water')
    expect(cardSoundKey({ kind: 'eyes', id: 'eyes:1' })).toBe('eyes')
    expect(cardSoundKey({ kind: 'move', id: 'move:1' })).toBe('move')
    expect(cardSoundKey({ kind: 'move', id: 'coach:break:1' })).toBe('screen')
    expect(cardSoundKey({ kind: 'ben', id: 'ben:1' })).toBe('ben')
    expect(cardSoundKey({ kind: 'push2', id: 'p' })).toBe('plan')
    expect(cardSoundKey({ kind: 'launch', id: 'l' })).toBe('ben')
    expect(cardSoundKey({ kind: 'remind', id: 'custom:r:1' })).toBe('remind')
    expect(cardSoundKey({ kind: 'over', id: 'over:1' })).toBe('timer')
    expect(cardSoundKey({ kind: 'block', id: 'b', meeting: true })).toBe('meeting')
    expect(cardSoundKey({ kind: 'winddown', id: 'w' })).toBe('bed')
    expect(cardSoundKey({ kind: 'weather', id: 'w' })).toBe('other')
  })
  it('picks the kit sound', () => {
    expect(cardSoundName({ kind: 'water', id: 'water:1' })).toBe('remindWater')
    expect(cardSoundName({ kind: 'move', id: 'coach:break:1' })).toBe('remindScreen')
    // Study Time's notices ring the sound you picked there (still under the time's-up switch).
    expect(cardSoundName({ kind: 'over', id: 'study:pomo:1', sound: 'levelUp' })).toBe('levelUp')
    expect(cardSoundKey({ kind: 'over', id: 'study:pomo:1' })).toBe('timer')
    expect(cardSoundName({ kind: 'remind', id: 'custom:x:1' })).toBe('remind')
    expect(cardSoundName({ kind: 'ben', id: 'ben:1' })).toBe('ben')
    expect(cardSoundName({ kind: 'over', id: 'o' })).toBe('focusEnd')
    expect(cardSoundName({ kind: 'block', id: 'm', meeting: true })).toBe('remindMeeting')
  })
})

describe('the sound gate per notification', () => {
  const kinds: CardSoundIn['alert'][] = [
    { kind: 'water', id: 'water:1' }, { kind: 'eyes', id: 'eyes:1' }, { kind: 'move', id: 'move:1' }, { kind: 'ben', id: 'ben:1' },
    { kind: 'remind', id: 'custom:r:1' }, { kind: 'over', id: 'over:1' }, { kind: 'push1', id: 'push1:1' }, { kind: 'winddown', id: 'w' }
  ]
  it('every notification that drops down rings, loud enough (the old ones were ~5 %)', () => {
    for (const a of kinds) {
      const p = cardSoundPlan(base(a))
      expect(p.ring, a.kind).toBe(true)
      expect(p.loud).toBeCloseTo(reminderGain(80))
      expect(p.loud).toBeGreaterThan(1.5)
    }
  })
  it('a dot or a hidden one stays silent and says why', () => {
    expect(cardSoundPlan(base(kinds[3], { gate: 'silent' }))).toMatchObject({ ring: false, why: expect.stringContaining('dot') })
    expect(cardSoundPlan(base(kinds[3], { gate: 'drop' }))).toMatchObject({ ring: false, why: 'not shown' })
  })
  it('rings once', () => {
    expect(cardSoundPlan(base(kinds[0], { played: true })).why).toBe('already rang')
  })
  it('the switches: island sounds, the kind, the per-kind sound switch, the volume', () => {
    expect(cardSoundPlan(base(kinds[3], { islandSound: false })).why).toMatch(/island sounds are off/)
    expect(cardSoundPlan(base(kinds[3], { kindSound: false })).why).toMatch(/this kind has no sound/)
    expect(cardSoundPlan(base(kinds[3], { on: { ...DEFAULT_REMINDER_SOUNDS.on, ben: false } })).why).toMatch(/Ben and his pushes/)
    expect(cardSoundPlan(base(kinds[0], { on: { ...DEFAULT_REMINDER_SOUNDS.on, ben: false } })).ring).toBe(true)
    expect(cardSoundPlan(base(kinds[3], { volume: 0 })).why).toMatch(/volume is 0/)
  })
  it('calls, quiet, focus, classes, bed and the kit stop it; time-up still rings in focus', () => {
    expect(cardSoundPlan(base(kinds[0], { call: true })).why).toMatch(/in a call/)
    expect(cardSoundPlan(base(kinds[5], { call: true })).ring).toBe(true)
    expect(cardSoundPlan(base(kinds[0], { quiet: true })).why).toMatch(/quiet/)
    expect(cardSoundPlan(base(kinds[0], { hush: 'focus' })).why).toMatch(/focus timer/)
    expect(cardSoundPlan(base(kinds[5], { hush: 'focus' })).ring).toBe(true)
    expect(cardSoundPlan(base(kinds[5], { hush: 'bed' })).why).toBe('after bed')
    expect(cardSoundPlan(base(kinds[0], { hush: 'class' })).why).toBe('in a class')
    expect(cardSoundPlan(base(kinds[0], { blocked: 'quiet hours' })).why).toBe('quiet hours')
  })
  it('the Settings test rings through gaps, repeats and quiet, and says what would stop a real one', () => {
    const t = { kind: 'remind', id: `${TEST_SOUND_PREFIX}1` }
    expect(isTestSound(t.id)).toBe(true)
    expect(cardSoundPlan(base(t, { gate: 'silent', played: true }))).toMatchObject({ ring: true, why: null })
    expect(cardSoundPlan(base(t, { blocked: 'quiet hours' }))).toMatchObject({ ring: true, why: 'a real one would be silent now: quiet hours' })
    expect(cardSoundPlan(base(t, { islandSound: false })).ring).toBe(false)
  })
  it('writes one log line either way', () => {
    expect(cardSoundLine('ben:1', cardSoundPlan(base(kinds[3])))).toBe('ben:1: ben and his pushes sound played')
    expect(cardSoundLine('ben:1', cardSoundPlan(base(kinds[3], { call: true })))).toBe('ben:1: skipped, in a call (mic or camera in use)')
  })
})

describe('saved sound switches', () => {
  it('older saves get the new kinds on', () => {
    const r = cleanReminderSounds({ on: { water: false }, volume: 60 })
    expect(r.on).toMatchObject({ water: false, eyes: true, ben: true, timer: true, other: true })
    expect(r.volume).toBe(60)
    expect(cleanReminderSounds({ on: { ben: false } }).on.ben).toBe(false)
  })
})
