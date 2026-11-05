import { describe, expect, it } from 'vitest'
import { addLearn, cleanLearn, learnLadders, learnLine, nextSubject, removeLearn, type LearnEntry } from './learnPath'

const now = new Date('2026-11-05T10:00:00Z')

describe('cyber security learning path (FT8)', () => {
  it('adds entries with a tag and an optional https link', () => {
    let l = addLearn([], { track: 'ctf', title: 'Warm-up: base64', tag: '#Web', link: 'https://example.com/ctf/1' }, '2026-11-05', now)
    expect(l[0]).toMatchObject({ track: 'ctf', tag: 'web', link: 'https://example.com/ctf/1', day: '2026-11-05' })
    expect(() => addLearn(l, { track: 'rust', title: ' ' }, '2026-11-05', now)).toThrow(/Say what you did/)
    expect(() => addLearn(l, { track: 'rust', title: 'Ch 1', link: 'ftp://x' }, '2026-11-05', now)).toThrow(/https/)
    l = removeLearn(l, l[0].id)
    expect(l).toEqual([])
  })
  it('climbs a ladder per track at set counts', () => {
    const l: LearnEntry[] = Array.from({ length: 5 }, (_, k) => ({ id: `c${k}`, track: 'ctf' as const, title: `Challenge ${k}`, tag: k % 2 ? 'web' : 'pwn', link: null, day: `2026-11-0${k + 1}` }))
    const ctf = learnLadders(l).find((v) => v.track === 'ctf')!
    expect(ctf).toMatchObject({ count: 5, level: 2, current: 'Warm-up solver', next: { at: 15, name: 'Regular' }, lastDay: '2026-11-05' })
    expect(ctf.tags[0]).toBe('pwn')
    expect(learnLadders(l).find((v) => v.track === 'rust')).toMatchObject({ count: 0, level: 0, current: null })
  })
  it('suggests the track left alone the longest (a new one first)', () => {
    const l: LearnEntry[] = [
      { id: 'a', track: 'ctf', title: 'x', tag: '', link: null, day: '2026-11-04' },
      { id: 'b', track: 'rust', title: 'Ch 1', tag: '', link: null, day: '2026-10-28' }
    ]
    expect(nextSubject(l, '2026-11-05')).toMatchObject({ track: 'crypto', subject: 'Crypto' })
    const all = [...l, { id: 'c', track: 'crypto' as const, title: 'RSA', tag: '', link: null, day: '2026-11-01' }]
    expect(nextSubject(all, '2026-11-05')).toMatchObject({ track: 'rust', why: expect.stringMatching(/8 days ago/) })
    expect(learnLine(all, '2026-11-05')).toMatch(/next study block's subject: Rust/)
    expect(nextSubject([], '2026-11-05')).toBeNull()
  })
  it('cleans what was saved', () => {
    expect(cleanLearn([{ track: 'nope', title: 'x', day: '2026-11-01' }, { id: 'k', track: 'rust', title: 'Ch 2', day: '2026-11-01', link: 'javascript:alert(1)' }])).toEqual([{ id: 'k', track: 'rust', title: 'Ch 2', tag: '', link: null, day: '2026-11-01' }])
  })
})
