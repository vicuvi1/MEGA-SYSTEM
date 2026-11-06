import { describe, expect, it } from 'vitest'
import { alreadySaid, alreadySaidText, fixTypos, matchBlocks, pickChoice, readBlockEdit, saidNo, tidyReply, timeFrame, wantsToSee, whenWords } from './benTalk'

const at = (s: string) => new Date(s)

describe('time in words (after midnight the app day is still yesterday)', () => {
  it('00:31: 07:00 is this morning, in 6 h 29 min, never tomorrow morning', () => {
    const now = at('2026-11-07T00:31:00')
    const f = timeFrame(now)
    expect(f.afterMidnight).toBe(true)
    expect(f.appDay).toBe('2026-11-06')
    expect(f.calDay).toBe('2026-11-07')
    expect(f.text).toContain('AFTER MIDNIGHT')
    expect(f.text).toContain('in 6 h 29 min, this morning')
    expect(f.text).toMatch(/"tonight" = right now/)
    expect(f.text).toMatch(/never "tomorrow morning"/)
    expect(whenWords(at('2026-11-07T07:00:00'), now)).toBe('in 6 h 29 min, this morning')
  })
  it('daytime and evening words', () => {
    expect(timeFrame(at('2026-11-06T21:10:00')).text).toMatch(/"tonight" = this evening[\s\S]*"tomorrow morning" = Sat 7 Nov/)
    expect(timeFrame(at('2026-11-06T09:00:00')).afterMidnight).toBe(false)
    expect(whenWords(at('2026-11-06T09:40:00'), at('2026-11-06T09:00:00'))).toBe('in 40 min')
    expect(whenWords(at('2026-11-07T09:00:00'), at('2026-11-06T21:00:00'))).toBe('in 12 h, tomorrow morning')
    expect(whenWords(at('2026-11-06T08:00:00'), at('2026-11-06T09:00:00'))).toBe('1 h ago')
  })
})

describe('already said: Ben stops repeating himself', () => {
  const lectures = [
    '😤 Look, Sam, you can\'t build a company on 4 hours of sleep.',
    '😤 Look, Sam, sleep first. Bed by 23:00.',
    '😤 Look, Sam, a tired brain makes bad code. Sleep.',
    '😤 Look, Sam, rest is part of the work.'
  ]
  it('lists the theme, the opener and the emoji', () => {
    const a = alreadySaid(lectures, 'how do I fix the login bug?')
    expect(a.themes[0]).toEqual({ theme: 'sleep', times: 4 })
    expect(a.openers).toContain('Look, Sam')
    expect(a.emoji).toContain('😤')
    const text = alreadySaidText(a)
    expect(text).toMatch(/sleep \(4×\)[\s\S]*Do NOT bring these up again/)
    expect(text).toMatch(/Start differently/)
  })
  it('drops a theme when he brings it up himself', () => {
    expect(alreadySaid(lectures, 'ok, how much sleep do I need?').themes.map((t) => t.theme)).not.toContain('sleep')
  })
  it('a plain no is heard', () => {
    for (const s of ['no', 'Nope.', 'not now', 'nu', 'нет', 'no thanks']) expect(saidNo(s), s).toBe(true)
    expect(saidNo('no wait, lunch was 45')).toBe(false)
    expect(saidNo('notes for later')).toBe(false)
  })
})

describe('tidy reply', () => {
  it('drops "Look, <name>," and extra emoji', () => {
    expect(tidyReply('😤 Look, Sam, ship the fix first 🔥💪', [], 'Sam')).toBe('😤 Ship the fix first')
    expect(tidyReply('Listen bro, two blocks left.', [])).toBe('Two blocks left.')
  })
  it('no emoji when the last two replies had one', () => {
    expect(tidyReply('🙂 Nice work.', ['😎 Good', '🔥 Great'])).toBe('Nice work.')
    expect(tidyReply('🙂 Nice work.', ['Good', '🔥 Great'])).toBe('🙂 Nice work.')
  })
})

describe('messy input', () => {
  it('fixes typos of command words, leaves real words alone', () => {
    expect(fixTypos('pls chagne the deep blcok to devolopin my app')).toBe('pls change the deep block to developing my app')
    expect(fixTypos('how can i aporve the paln if i dont see it haha')).toBe('how can i approve the plan if i dont see it haha')
    expect(fixTypos('tommorow morning')).toBe('tomorrow morning')
    expect(fixTypos('I play black chess and plant trees')).toBe('I play black chess and plant trees')
    expect(fixTypos('am cheltuit 120 lei')).toBe('am cheltuit 120 lei')
  })
  it('knows when he wants to SEE something', () => {
    expect(wantsToSee('how can i aporve the paln if i dont see it haha')).toEqual(['plan'])
    expect(wantsToSee('show me my day')).toEqual(['day'])
    expect(wantsToSee('what are my tasks today')).toContain('tasks')
    expect(wantsToSee('arată-mi planul')).toEqual(['plan'])
    expect(wantsToSee('покажи план')).toEqual(['plan'])
    expect(wantsToSee('I planned to sleep early')).toEqual([])
  })
})

describe('block edits: act when one, chips when several', () => {
  const blocks = [
    { ref: 'B1', title: 'Deep block 1', start: '07:00', end: '09:00' },
    { ref: 'B2', title: 'Deep block 2', start: '14:00', end: '16:00' },
    { ref: 'E3', title: 'Gym', start: '19:00', end: '20:00' }
  ]
  it('reads rename and move, in en / ro / ru, with typos', () => {
    expect(readBlockEdit('please chagne the deep block to devolopin my app')).toEqual({ verb: 'rename', target: 'deep', value: 'Developing my app' })
    expect(readBlockEdit('move the first deep block to 11')).toEqual({ verb: 'move', target: 'deep', nth: 0, value: '11:00' })
    expect(readBlockEdit('rename deep block 2 to Reading')).toEqual({ verb: 'rename', target: 'deep', nth: 1, value: 'Reading' })
    expect(readBlockEdit('schimbă blocul gym în fotbal')).toMatchObject({ verb: 'rename', target: 'gym', value: 'Fotbal' })
    expect(readBlockEdit('переименуй блок gym в футбол')).toMatchObject({ verb: 'rename', target: 'gym', value: 'Футбол' })
    expect(readBlockEdit('change my bedtime to 23:00')).toBeNull()
    expect(readBlockEdit('make the deep block longer to 2 hours')).toBeNull()
    expect(readBlockEdit('change the gym block to tomorrow')).toBeNull()
    expect(readBlockEdit('change the gym block to 18:00')).toEqual({ verb: 'move', target: 'gym', value: '18:00' })
    expect(readBlockEdit('the deep block was hard')).toBeNull()
  })
  it('matches the right blocks', () => {
    expect(matchBlocks({ target: 'deep' }, blocks).map((b) => b.ref)).toEqual(['B1', 'B2'])
    expect(matchBlocks({ target: 'deep', nth: 1 }, blocks).map((b) => b.ref)).toEqual(['B2'])
    expect(matchBlocks({ target: 'gym' }, blocks).map((b) => b.ref)).toEqual(['E3'])
    expect(matchBlocks({ target: 'swim' }, blocks)).toEqual([])
  })
  it('understands the pick from the chips', () => {
    const labels = ['Deep block 1 · 07:00', 'Deep block 2 · 14:00']
    expect(pickChoice('first one', labels)).toBe(0)
    expect(pickChoice('Deep block 2 · 14:00', labels)).toBe(1)
    expect(pickChoice('the 14:00 one', labels)).toBe(1)
    expect(pickChoice('2', labels)).toBe(1)
    expect(pickChoice('primul', labels)).toBe(0)
    expect(pickChoice('второй', labels)).toBe(1)
    expect(pickChoice('what do you think about football', labels)).toBeNull()
  })
})
