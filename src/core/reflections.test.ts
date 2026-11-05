import { describe, expect, it } from 'vitest'
import { addReflection, lastReflections, reflectionPrompt, REFLECTION_PROMPTS } from './reflections'

describe('reflections (MN14)', () => {
  it('one prompt a day', () => {
    expect(REFLECTION_PROMPTS).toContain(reflectionPrompt('2026-11-05'))
    expect(reflectionPrompt('2026-11-05')).toBe(reflectionPrompt('2026-11-05'))
    expect(reflectionPrompt('2026-11-05')).not.toBe(reflectionPrompt('2026-11-06'))
  })
  it('newest entry goes on top', () => {
    let b = addReflection('', '2026-11-04', 'Q1?', 'Went for a walk.')
    b = addReflection(b, '2026-11-05', 'Q2?', 'Phone out of the room.')
    expect(b.startsWith('# Reflections')).toBe(true)
    expect(b.indexOf('2026-11-05')).toBeLessThan(b.indexOf('2026-11-04'))
    expect(lastReflections(b)).toEqual([
      { day: '2026-11-05', text: 'Phone out of the room.' },
      { day: '2026-11-04', text: 'Went for a walk.' }
    ])
  })
  it('an empty note has no entries', () => {
    expect(lastReflections(null)).toEqual([])
  })
})
