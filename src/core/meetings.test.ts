import { describe, expect, it } from 'vitest'
import { DEFAULT_DENY } from './eyesGuard'
import { CAPTION_KEEP_MS, callApp, captionDiff, captionStep, captionWords, consentMessage, liveLines, meetingNoteTitle, meetingPrivate, newCaptions, pruneCaptions, transcriptNote, type CaptionState } from './meetings'

const w = captionWords
const feed = (reads: string[], start = 1_000_000, every = 1000) => {
  let st: CaptionState = newCaptions(start)
  const added: string[][] = []
  reads.forEach((r, i) => {
    const s = captionStep(st, r, start + i * every)
    st = s.state
    added.push(s.added)
  })
  return { st, added, text: st.lines.map((l) => l.words.join(' ')).join(' ') }
}

describe('captionDiff', () => {
  it('takes only the new words when the text grows', () => {
    expect(captionDiff(w('so the plan'), w('so the plan for this week'))).toEqual({ drop: 0, add: w('for this week') })
  })
  it('nothing new when nothing changed', () => {
    expect(captionDiff(w('hello there'), w('hello there'))).toEqual({ drop: 0, add: [] })
  })
  it('follows the box when old lines scroll off the start', () => {
    expect(captionDiff(w('one two three four five six'), w('four five six seven eight'))).toEqual({ drop: 0, add: w('seven eight') })
  })
  it('takes back the last words Live Captions corrected', () => {
    expect(captionDiff(w('we will meet at ten'), w('we will meet at 10 tomorrow'))).toEqual({ drop: 1, add: w('10 tomorrow') })
  })
  it('fixes punctuation and capitals of the last words', () => {
    expect(captionDiff(w('how are you'), w('how are you? Good'))).toEqual({ drop: 1, add: w('you? Good') })
  })
  it('all new when nothing lines up (the box was cleared)', () => {
    expect(captionDiff(w('the old sentence here'), w('something else entirely'))).toEqual({ drop: 0, add: w('something else entirely') })
  })
  it('the first read is all new', () => {
    expect(captionDiff([], w('hi all'))).toEqual({ drop: 0, add: w('hi all') })
  })
  it('a single repeated word at the end is not taken as a scroll', () => {
    expect(captionDiff(w('this is the'), w('the end of something new'))).toEqual({ drop: 0, add: w('the end of something new') })
  })
})

describe('captionStep and the transcript', () => {
  it('builds the transcript from rolling reads without repeats', () => {
    const r = feed(['Good morning', 'Good morning everyone, thanks', 'everyone, thanks for joining today', 'thanks for joining today. Let us start'])
    expect(r.text).toBe('Good morning everyone, thanks for joining today. Let us start')
    expect(r.added[3]).toEqual(w('today. Let us start'))
  })
  it('a correction replaces the words, not adds them', () => {
    const r = feed(['we meet at ten', 'we meet at 10 tomorrow'])
    expect(r.text).toBe('we meet at 10 tomorrow')
  })
  it('a pause starts a new timestamped line', () => {
    let st = newCaptions(0)
    st = captionStep(st, 'first part', 1000).state
    st = captionStep(st, 'first part and more', 2000).state
    st = captionStep(st, 'first part and more after a pause', 9000).state
    expect(st.lines.map((l) => [l.at, l.words.join(' ')])).toEqual([
      [1000, 'first part and more'],
      [9000, 'after a pause']
    ])
  })
  it('a long sentence ends its line', () => {
    const long = 'This sentence is long enough to be a whole line in the notes today.'
    const st = captionStep(newCaptions(0), `${long} Next one`, 1000).state
    expect(st.lines.map((l) => l.words.join(' '))).toEqual([long, 'Next one'])
  })
  it('keeps at most 2 hours', () => {
    const lines = [{ at: 0, words: ['old'] }, { at: CAPTION_KEEP_MS + 5000, words: ['new'] }]
    expect(pruneCaptions(lines, CAPTION_KEEP_MS + 10_000).map((l) => l.words[0])).toEqual(['new'])
  })
  it('liveLines: the newest two lines, cut from the start', () => {
    const lines = [{ at: 0, words: w('a b') }, { at: 1, words: w('c d') }, { at: 2, words: w('one two three four five six seven eight nine ten') }]
    expect(liveLines(lines, 20)).toEqual(['c d', '…eight nine ten'])
  })
})

describe('meeting names and privacy', () => {
  it('private meetings: doctor, HR, therapy, the eyes list', () => {
    expect(meetingPrivate('Doctor appointment', DEFAULT_DENY)).toBe(true)
    expect(meetingPrivate('Chat with HR', DEFAULT_DENY)).toBe(true)
    expect(meetingPrivate('Therapy session', DEFAULT_DENY)).toBe(true)
    expect(meetingPrivate('Bank call about the loan', DEFAULT_DENY)).toBe(true)
    expect(meetingPrivate('Weekly sync', DEFAULT_DENY)).toBe(false)
    expect(meetingPrivate('Chrome extensions demo', DEFAULT_DENY)).toBe(false)
    expect(meetingPrivate('', DEFAULT_DENY)).toBe(false)
  })
  it('the call app from the program in front', () => {
    expect(callApp('Zoom')).toBe('Zoom')
    expect(callApp('ms-teams')).toBe('Teams')
    expect(callApp('notepad')).toBeNull()
  })
  it('the note title uses the calendar, else the app, else only the date', () => {
    const at = new Date(2026, 10, 5, 14, 2, 10).getTime()
    expect(meetingNoteTitle({ title: 'Study group', at })).toBe('Meeting Study group 2026-11-05')
    expect(meetingNoteTitle({ app: 'Zoom', at })).toBe('Meeting Zoom 2026-11-05')
    expect(meetingNoteTitle({ at })).toBe('Meeting 2026-11-05')
  })
  it('the transcript note has a header and timestamped lines', () => {
    const at = new Date(2026, 10, 5, 14, 2, 10).getTime()
    const n = transcriptNote({ title: 'Study group', startedAt: at, now: at + 60_000, lines: [{ at, words: w('Hi all.') }, { at: at + 30_000, words: w('Let us start.') }] })
    expect(n.title).toBe('Meeting Study group 2026-11-05')
    expect(n.body).toContain('# Meeting Study group 2026-11-05')
    expect(n.body).toContain('14:02–14:03')
    expect(n.body).toContain('- **14:02:10** Hi all.')
    expect(n.body).toContain('- **14:02:40** Let us start.')
  })
  it('the consent message is short and plain', () => {
    expect(consentMessage().length).toBeLessThan(220)
    expect(consentMessage()).toMatch(/captions/)
  })
})
