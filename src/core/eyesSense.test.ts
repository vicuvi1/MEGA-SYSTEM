import { describe, expect, it } from 'vitest'
import { benNowLine, eyesHint, nowText, seenLine, topicOf } from './eyesSense'

const T0 = Date.UTC(2026, 10, 5, 12, 0, 0)

describe('island eyes: what a window is about', () => {
  it('your goal words come first, then known topics', () => {
    expect(topicOf('Graph theory notes', '', ['Graph theory'])).toEqual({ subject: 'Graph theory', label: 'Graph theory' })
    expect(topicOf('Two Sum - LeetCode', '')).toMatchObject({ subject: 'Interview prep' })
    expect(topicOf('Machines | Hack The Box', '')).toMatchObject({ subject: 'CTF' })
    expect(topicOf('Week 3 lecture slides', '')).toMatchObject({ subject: 'Study' })
    expect(topicOf('Funny cats', 'compilation')).toBeNull()
  })
  it('one short line: the title and the app, or the text', () => {
    expect(seenLine({ app: 'Chrome', title: 'Two Sum - LeetCode', text: 'Given an array', kind: 'read' })).toBe('“Two Sum - LeetCode” in Chrome')
    expect(seenLine({ app: 'Notepad', title: 'Notepad', text: 'shopping list milk', kind: 'read' })).toBe('shopping list milk in Notepad')
    expect(seenLine({ app: 'Chrome', title: '', text: '', kind: 'ocr' })).toBe('')
    expect(seenLine({ app: 'Chrome', title: '', text: 'A code editor with a Rust file open', kind: 'caption' })).toBe('A code editor with a Rust file open')
    expect(seenLine({ app: 'Chrome', title: 't '.repeat(300), text: '', kind: 'read' }).length).toBeLessThanOrEqual(120)
  })
})

describe('island eyes: the offer', () => {
  it('interview prep → start a focus block', () => {
    expect(eyesHint({ title: 'System Design Interview prep', text: '', running: false })).toEqual({ kind: 'focus', subject: 'Interview prep', text: 'Looks like interview prep. Start a focus block for it?' })
    // Not while a timer runs.
    expect(eyesHint({ title: 'System Design Interview prep', text: '', running: true })).toBeNull()
  })
  it('a page with a deadline → save it as a task', () => {
    expect(eyesHint({ title: 'Group project brief', text: 'Submit by Friday 18:00', running: false })).toEqual({ kind: 'task', task: 'Group project brief', text: 'There is a date on this. Save it as a task?' })
    expect(eyesHint({ title: 'Cat videos', text: 'watch more', running: false })).toBeNull()
  })
})

describe('island eyes: what Ben is told', () => {
  it('only a fresh line (10 min), said as a hint', () => {
    const l = benNowLine({ at: T0 - 3 * 60_000, line: '“Two Sum - LeetCode” in Chrome' }, T0)
    expect(l).toMatch(/^Right now on his PC \(island eyes, 3 min ago\): “Two Sum - LeetCode” in Chrome\./)
    expect(benNowLine({ at: T0 - 11 * 60_000, line: 'x' }, T0)).toBe('')
    expect(benNowLine({ at: T0, line: '  ' }, T0)).toBe('')
    expect(benNowLine(null, T0)).toBe('')
    expect(benNowLine({ at: T0 + 5 * 60_000, line: 'from the future' }, T0)).toBe('')
    expect(benNowLine({ at: T0, line: 'y '.repeat(500) }, T0).length).toBeLessThan(250)
  })
  it('the island line', () => {
    expect(nowText('“X” in Chrome')).toBe('now: reading “X” in Chrome')
    expect(nowText('')).toBe('')
  })
})
