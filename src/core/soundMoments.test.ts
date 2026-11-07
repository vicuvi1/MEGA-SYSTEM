// Which sound for what: distinct defaults, the mapping from the app's and the
// island's sounds, None, and cleaning what was saved.
import { describe, expect, it } from 'vitest'
import { cleanMoments, DEFAULT_MOMENTS, MOMENT_SOUNDS, MOMENTS, momentForAlert, momentForNotif, momentForSound, momentRecipe, pickFor } from './soundMoments'
import { cleanSoundPrefs, DEFAULT_SOUND_PREFS, remindSound, SOUND_NAMES, soundLength } from './sounds'
import { islandRecipe, islandVoices, ISLAND_PICK_GAIN } from './islandSound'

describe('which sound for what', () => {
  it('has the eleven things, each with its own default sound', () => {
    expect(MOMENTS.map((m) => m.id)).toEqual(['ben', 'reminder', 'water', 'move', 'eyes', 'timer', 'meeting', 'done', 'points', 'bed', 'error', 'praise', 'drift', 'checkin'])
    const defaults = Object.values(DEFAULT_MOMENTS)
    expect(new Set(defaults).size).toBe(defaults.length)
    expect(defaults).not.toContain('none')
  })

  it('every built-in sound is real, short enough and quiet; None is silent', () => {
    const recipes = new Set<string>()
    for (const s of MOMENT_SOUNDS) {
      const v = momentRecipe(s.id)
      if (s.id === 'none') {
        expect(v).toEqual([])
        continue
      }
      expect(v.length).toBeGreaterThan(0)
      expect(soundLength(v)).toBeLessThan(4)
      expect(Math.max(...v.map((x) => x.gain))).toBeLessThanOrEqual(0.2)
      recipes.add(JSON.stringify(v))
    }
    // All different.
    expect(recipes.size).toBe(MOMENT_SOUNDS.length - 1)
  })

  it("maps the app's sounds, the island's cards and the notifications to a moment", () => {
    expect(momentForSound('remindWater')).toBe('water')
    expect(momentForSound('water')).toBe('water')
    expect(momentForSound('focusEnd')).toBe('timer')
    expect(momentForSound('remindMeeting')).toBe('meeting')
    expect(momentForSound('mustDo')).toBe('done')
    expect(momentForSound('coin')).toBe('points')
    expect(momentForSound('click')).toBeNull()
    expect(momentForSound('focusStart')).toBeNull()
    expect(momentForAlert('move')).toBe('move')
    expect(momentForAlert('eyes')).toBe('eyes')
    expect(momentForAlert('block', true)).toBe('meeting')
    expect(momentForAlert('winddown')).toBe('bed')
    expect(momentForAlert('ben')).toBe('ben')
    expect(momentForNotif('event')).toBe('meeting')
    expect(momentForNotif('bedtime')).toBe('bed')
    expect(momentForNotif('ben')).toBe('ben')
    expect(remindSound('block', true)).toBe('remindMeeting')
    expect(remindSound('ben')).toBe('ben')
    expect(remindSound('late')).toBe('remindBed')
    // Every moment is reachable from some sound the app plays.
    for (const m of MOMENTS) expect(SOUND_NAMES.some((n) => momentForSound(n) === m.id), m.id).toBe(true)
  })

  it('plays your pick, nothing for None, and keeps the climbing habit pluck on the default', () => {
    const mine = { ...DEFAULT_MOMENTS, water: 'pop' as const, eyes: 'none' as const }
    expect(pickFor('remindWater', mine)).toBe('pop')
    expect(pickFor('remindEyes', mine)).toBeNull()
    expect(pickFor('click', mine)).toBe('own')
    expect(pickFor('habit', DEFAULT_MOMENTS)).toBe('own')
    expect(pickFor('habit', { ...DEFAULT_MOMENTS, done: 'marimba' })).toBe('marimba')
    expect(pickFor('mustDo', DEFAULT_MOMENTS)).toBe('chime')
  })

  it('the island keeps its own soft notes on the default, plays your pick quieter, or nothing', () => {
    expect(islandVoices('done', DEFAULT_MOMENTS)).toEqual({ voices: islandRecipe('done'), gain: 1 })
    expect(islandVoices('done', { ...DEFAULT_MOMENTS, done: 'coin' })).toEqual({ voices: momentRecipe('coin'), gain: ISLAND_PICK_GAIN })
    expect(islandVoices('notify', { ...DEFAULT_MOMENTS, reminder: 'none' })).toBeNull()
    expect(islandVoices('tap', { ...DEFAULT_MOMENTS, done: 'none' })).toEqual({ voices: islandRecipe('tap'), gain: 1 })
  })

  it('cleans what was saved and lives in the sound settings', () => {
    expect(cleanMoments({ water: 'pop', eyes: 'trumpet', ben: 5 })).toEqual({ ...DEFAULT_MOMENTS, water: 'pop' })
    expect(DEFAULT_SOUND_PREFS.moments).toEqual(DEFAULT_MOMENTS)
    expect(cleanSoundPrefs({ moments: { timer: 'none' } }).moments.timer).toBe('none')
    expect(cleanSoundPrefs(null).moments).toEqual(DEFAULT_MOMENTS)
  })
})
