import { describe, expect, it } from 'vitest'
import { cleanVoice, voiceKind, voicePrompt } from './benVoice'

const water = '💧 Water 0.5 of 2.7 L and the day is going. Drink 3 glasses now. Send "water 250" after each.'

describe("Ben's own words for his nudges", () => {
  it('knows which messages are nudges', () => {
    expect(voiceKind(water)).toBe('water')
    expect(voiceKind('💪 No training today yet. 20 minutes counts')).toBe('training')
    expect(voiceKind('😤 Nothing done for 2h 5m. Your must-do: <b>etica</b>.')).toBe('idle')
    expect(voiceKind('☀️ Your plan for today')).toBeNull()
    expect(voiceKind('🔔 Call mom')).toBeNull()
  })
  it('the prompt carries the facts and his day', () => {
    const p = voicePrompt('water', water, { time: '15:10', focusMin: 25, mustDos: ['etica'], nextEvent: 'Lab at 16:00', tasks: ['sport'], water: '0.5 / 2.7 L', tone: 3 })
    expect(p).toContain('0.5 of 2.7 L')
    expect(p).toContain('Lab at 16:00')
    expect(p).toContain('etica')
  })
  it('keeps a good rewrite, adds the emoji if missing', () => {
    expect(cleanVoice('Water 0.5 of 2.7 L, Lab at 16:00. Drink 3 glasses before you go ("water 250" after each, 250 ml).', water)).toMatch(/^💧 Water 0\.5 of 2\.7 L/)
  })
  it('refuses made-up or lost numbers, JSON, or empty answers', () => {
    expect(cleanVoice('💧 Drink some water now!', water)).toBeNull()
    expect(cleanVoice('💧 Water 1.5 of 2.7 L, drink 3 glasses, water 250.', water)).toBeNull()
    expect(cleanVoice('{"reply":"x"}', water)).toBeNull()
    expect(cleanVoice('', water)).toBeNull()
  })
  it('strips HTML other than bold/italic', () => {
    expect(cleanVoice('💪 <a href="x">Train</a> <b>20 minutes</b> now.', '💪 No training yet. 20 minutes counts.')).toBe('💪 Train <b>20 minutes</b> now.')
  })
})

describe('safe HTML from the model (T6)', () => {
  it('escapes a stray < and &, keeps <b>', () => {
    const t = cleanVoice('💧 <b>2</b> glasses < goal & R&D', '💧 <b>2</b> glasses')
    expect(t).toBe('💧 <b>2</b> glasses &lt; goal &amp; R&amp;D')
  })
})
