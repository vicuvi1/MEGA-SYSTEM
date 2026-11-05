import { describe, expect, it } from 'vitest'
import { findDate, gmailLine, gmailQuery, heuristicDigest, parseDigest, readMessage } from './gmail'

describe('Gmail digest plugin', () => {
  it('builds a search only for allowed senders and labels', () => {
    expect(gmailQuery([], [])).toBeNull()
    expect(gmailQuery(['uni.example', 'bad"; DROP'], ['My Classes'])).toBe('is:unread newer_than:2d (from:uni.example OR from:badDROP OR label:"My Classes")')
  })

  it('reads sender, subject and snippet only', () => {
    const m = readMessage({ snippet: 'Your exam moved to 12.11 &amp; room 4', payload: { headers: [{ name: 'From', value: '"Test University" <office@uni.example>' }, { name: 'Subject', value: 'Exam change' }] } })
    expect(m).toEqual({ from: 'Test University', subject: 'Exam change', snippet: 'Your exam moved to 12.11 & room 4' })
  })

  it('finds dates in many forms', () => {
    expect(findDate('due 2026-11-20', '2026-11-05')).toBe('2026-11-20')
    expect(findDate('on 12.11', '2026-11-05')).toBe('2026-11-12')
    expect(findDate('by 3 Jan', '2026-11-05')).toBe('2027-01-03')
    expect(findDate('no date here', '2026-11-05')).toBeNull()
  })

  it('finds deadlines, exams and bills without a model', () => {
    const items = heuristicDigest(
      [
        { from: 'Test University', subject: 'Exam moved to 12.11', snippet: '' },
        { from: 'Internet Co', subject: 'Your invoice', snippet: 'Payment due 2026-11-15' },
        { from: 'Shop', subject: 'Big sale this week', snippet: '50% off' }
      ],
      '2026-11-05'
    )
    expect(items).toEqual([
      { kind: 'exam', title: 'Exam moved to 12.11', date: '2026-11-12', from: 'Test University' },
      { kind: 'bill', title: 'Your invoice', date: '2026-11-15', from: 'Internet Co' }
    ])
  })

  it("cleans the model's answer and drops odd items", () => {
    const out = parseDigest('```json\n{"items":[{"kind":"deadline","title":"Essay <b>draft</b>","date":"2026-11-10","from":"Prof"},{"kind":"spam","title":"x"},{"kind":"bill","title":"Phone","date":"soon"}]}\n```')
    expect(out).toEqual([
      { kind: 'deadline', title: 'Essay bdraft/b', date: '2026-11-10', from: 'Prof' },
      { kind: 'bill', title: 'Phone', date: null, from: '' }
    ])
    expect(parseDigest('not json')).toEqual([])
  })

  it('gives Ben proposals only while fresh', () => {
    const d = { day: '2026-11-05', at: '', checked: 3, items: [{ kind: 'bill' as const, title: 'Phone', date: '2026-11-15', from: 'Phone Co' }] }
    expect(gmailLine(d, '2026-11-05', '2026-11-04')).toContain('ONLY after he says yes')
    expect(gmailLine(d, '2026-11-07', '2026-11-06')).toBeNull()
  })
})
