import { describe, expect, it } from 'vitest'
import { buildPack, cleanQueue, inShift, packsDone, packText, type QueueItem } from './studyPack'

const q = (id: string, kind: QueueItem['kind'], text: string): QueueItem => ({ id, kind, text, link: null, done: false, added: '2026-11-01' })
const queue = [q('c1', 'ctf', 'Made-up web challenge: login bypass'), q('c2', 'ctf', 'Made-up crypto challenge: weak RSA'), q('r1', 'reading', 'OWASP Top 10: injection')]

describe('shift study pack', () => {
  it('fits the minutes: cards, an essay paragraph, a CTF hint, a reading', () => {
    const p = buildPack({ dueCards: 14, queue, essaySteps: [{ title: 'Privacy essay', kind: 'draft', ref: 'e1-2' }], minutes: 25 })
    expect(p.items.map((i) => [i.kind, i.minutes])).toEqual([
      ['cards', 7],
      ['essay', 10],
      ['ctf', 8]
    ])
    expect(p.minutes).toBe(25)
  })
  it('a short pack still has something; the queue rotates by turn', () => {
    const p0 = buildPack({ dueCards: 0, queue, essaySteps: [], minutes: 10 })
    const p1 = buildPack({ dueCards: 0, queue, essaySteps: [], minutes: 10, turn: 1 })
    expect(p0.items[0].text).toContain('login bypass')
    expect(p1.items[0].text).toContain('weak RSA')
    expect(p0.minutes).toBe(10)
  })
  it('with nothing queued: reread notes and make cards', () => {
    const p = buildPack({ dueCards: 0, queue: [], essaySteps: [] })
    expect(p.items).toEqual([{ kind: 'notes', text: 'Reread your latest notes and turn 3 facts into flashcards', minutes: 10 }])
    expect(packText(p)).toBe('📚 10-min study pack for a quiet moment:\n🗒️ Reread your latest notes and turn 3 facts into flashcards · 10 min')
  })
  it('only during the shift, never when it is off', () => {
    const w = { from: '17:00', to: '24:00', mode: 'normal' }
    expect(inShift(w, 18 * 60)).toBe(true)
    expect(inShift(w, 16 * 60)).toBe(false)
    expect(inShift({ ...w, mode: 'off' }, 18 * 60)).toBe(false)
    expect(inShift(null, 18 * 60)).toBe(false)
  })
  it('finished packs are focus sessions named Study pack', () => {
    expect(packsDone([{ day: '2026-11-06', subject: 'Study pack', minutes: 20 }, { day: '2026-11-06', subject: 'Rust', minutes: 50 }, { day: '2026-10-01', subject: 'study pack', minutes: 15 }], '2026-11-01', '2026-11-07')).toEqual({ count: 1, minutes: 20 })
  })
  it('cleans the queue', () => {
    expect(cleanQueue([{ id: 'a', kind: 'ctf', text: 't', link: 'ftp://x' }, { id: 'b', kind: 'zzz', text: 't' }])).toEqual([{ id: 'a', kind: 'ctf', text: 't', link: null, done: false, added: '2026-01-01' }])
  })
})
