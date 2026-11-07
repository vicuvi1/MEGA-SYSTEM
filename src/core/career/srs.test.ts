import { describe, expect, it } from 'vitest'
import { cardPrompt, cleanCards, deckStats, dueCards, grade, ivlText, newCard, newSeenToday, nextIvl, parseCards, type Card, type ReviewMark } from './srs'

const T = '2026-11-07'
const card = (id = 'c1', over: Partial<Card> = {}): Card => ({ ...newCard('Port for SSH?', '22', 'Ports', T, id), ...over })

describe('SM-2 scheduling', () => {
  it('a new card: again 1 day, hard 1, good 1, easy 3', () => {
    const c = card()
    expect([nextIvl(c, 'again', T), nextIvl(c, 'hard', T), nextIvl(c, 'good', T), nextIvl(c, 'easy', T)]).toEqual([1, 1, 1, 3])
  })
  it('good answers grow: 1 → 3 → 8 → 20 days', () => {
    let c = card()
    let day = T
    const ivls: number[] = []
    for (let i = 0; i < 4; i++) {
      c = grade(c, 'good', day)
      ivls.push(c.ivl)
      day = c.due
    }
    expect(ivls).toEqual([1, 3, 8, 20])
    expect(c.reps).toBe(4)
    expect(c.ease).toBe(2.5)
  })
  it('again resets the run, counts a lapse, lowers the ease and comes back tomorrow', () => {
    const c = grade({ ...card(), reps: 3, ivl: 20, due: T, last: '2026-10-18' }, 'again', T)
    expect(c).toMatchObject({ reps: 0, lapses: 1, ivl: 1, due: '2026-11-08', ease: 2.3, last: T })
  })
  it('the ease never drops below 1.3; hard grows slower than good; easy faster', () => {
    let c = card()
    for (let i = 0; i < 10; i++) c = grade(c, 'again', T)
    expect(c.ease).toBe(1.3)
    const base = { ...card(), reps: 2, ivl: 10, due: T, last: '2026-10-28' }
    expect(nextIvl(base, 'hard', T)).toBeLessThan(nextIvl(base, 'good', T))
    expect(nextIvl(base, 'good', T)).toBeLessThan(nextIvl(base, 'easy', T))
  })
  it('a late review gets a little credit for remembering longer', () => {
    const base = { ...card(), reps: 2, ivl: 10, due: '2026-10-28', last: '2026-10-18' }
    expect(nextIvl(base, 'good', T)).toBeGreaterThan(nextIvl({ ...base, due: T }, 'good', T))
  })
  it('intervals cap at a year and read as days, weeks, months', () => {
    expect(nextIvl({ ...card(), reps: 9, ivl: 300, due: T, last: '2026-01-01', ease: 3 }, 'easy', T)).toBe(365)
    expect([ivlText(3), ivlText(21), ivlText(90)]).toEqual(['3d', '3w', '3mo'])
  })
})

describe('the review queue', () => {
  it('due cards come first (oldest first), then new ones up to the daily limit', () => {
    const cards = [card('n1'), card('n2'), card('n3'), { ...card('d1'), reps: 1, ivl: 1, last: '2026-11-05', due: '2026-11-06' }, { ...card('d2'), reps: 2, ivl: 3, last: '2026-11-01', due: '2026-11-04' }, { ...card('later'), reps: 1, ivl: 5, last: T, due: '2026-11-12' }, { ...card('off'), off: true }]
    expect(dueCards(cards, T, { newLimit: 2 }).map((c) => c.id)).toEqual(['d2', 'd1', 'n1', 'n2'])
    expect(dueCards(cards, T, { newLimit: 2, newSeen: 2 }).map((c) => c.id)).toEqual(['d2', 'd1'])
  })
  it('counts new cards first seen today, and the stats', () => {
    const log: ReviewMark[] = [
      { day: '2026-11-06', id: 'a', grade: 'good' },
      { day: T, id: 'a', grade: 'good' },
      { day: T, id: 'b', grade: 'again' },
      { day: T, id: 'b', grade: 'good' }
    ]
    expect(newSeenToday(log, T)).toBe(1)
    const s = deckStats([card('x'), { ...card('y'), ivl: 30, reps: 4, last: T, due: '2026-12-07' }], log, T)
    expect(s).toMatchObject({ total: 2, fresh: 1, due: 0, mature: 1, reviewedToday: 3, streak: 2, retention: null })
    const many = Array.from({ length: 10 }, (_, i): ReviewMark => ({ day: T, id: `z${i}`, grade: i < 2 ? 'again' : 'good' }))
    expect(deckStats([], many, T).retention).toBe(0.8)
  })
})

describe('cards from your notes', () => {
  it('reads "::", dashes, tabs, "=" and Q/A pairs, skipping headings and duplicates', () => {
    const got = parseCards(['# Ports', '- SSH :: 22', 'HTTPS - 443', 'DNS\t53', 'XOR of a and a = 0', 'ssh :: 2222', '', 'Q: What does AES stand for?', 'A: Advanced Encryption Standard', 'just a sentence'].join('\n'))
    expect(got).toEqual([
      { front: 'SSH', back: '22' },
      { front: 'HTTPS', back: '443' },
      { front: 'DNS', back: '53' },
      { front: 'XOR of a and a', back: '0' },
      { front: 'What does AES stand for?', back: 'Advanced Encryption Standard' }
    ])
  })
  it("Ben's prompt asks for the same format", () => {
    expect(cardPrompt('RSA uses two primes', 'Crypto')).toMatch(/question :: answer/)
  })
  it('cleans saved cards', () => {
    expect(cleanCards([{ id: 'a', front: 'f', back: 'b', created: T, ease: 9, ivl: -3 }, { nope: 1 }])).toEqual([{ id: 'a', front: 'f', back: 'b', deck: 'General', created: T, due: T, ivl: 0, ease: 3.2, reps: 0, lapses: 0, last: null }])
  })
})
