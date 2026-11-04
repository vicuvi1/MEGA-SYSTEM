import { describe, expect, it } from 'vitest'
import { appendLine, backlinks, journalNote, linksOf, notesForBen, readNoteOp, searchNotes, type Note } from './notebook'

const n = (title: string, body: string, extra: Partial<Note> = {}): Note => ({ id: title, title, body, author: 'me', pinned: false, createdAt: '2026-11-01', updatedAt: '2026-11-01', ...extra })

describe('the notebook', () => {
  it('finds [[links]] and backlinks', () => {
    const notes = [n('About me', 'I study at [[University]] and train with [[Sport|gym]].'), n('University', 'Lab 4 with Maxim'), n('Sport', '')]
    expect(linksOf(notes[0].body)).toEqual(['University', 'Sport'])
    expect(backlinks(notes, 'university').map((x) => x.title)).toEqual(['About me'])
  })
  it('searches titles first, then text, ignoring accents', () => {
    const notes = [n('Exams', 'etica on Friday'), n('Etica', 'teacher is strict', { updatedAt: '2026-11-02' }), n('Food', 'pasta')]
    expect(searchNotes(notes, 'etică').map((x) => x.title)).toEqual(['Etica', 'Exams'])
  })
  it("Ben reads About me always, the matching notes and the latest journal, within the budget", () => {
    const notes = [n('About me', 'Victor, 19, studies CS.', { pinned: true }), n('Etica', 'exam on Friday'), n('Food', 'pasta'), n('Journal/2026-11-03', 'score 34', { author: 'ben' })]
    const t = notesForBen(notes, 'help me prepare etica')
    expect(t).toContain('### About me')
    expect(t).toContain('### Etica')
    expect(t).toContain('### Journal/2026-11-03')
    expect(t).not.toContain('pasta')
    expect(notesForBen([n('Big', 'x'.repeat(9000), { pinned: true })], 'hi', 1000).length).toBeLessThan(1100)
  })
  it('reads Ben\'s "note:" action and adds a dated line once', () => {
    expect(readNoteOp('note: People | Maxim is his lab partner')).toEqual({ title: 'People', line: 'Maxim is his lab partner' })
    expect(readNoteOp('move: E1 | 11:00')).toBeNull()
    const made = appendLine(null, 'People', 'Maxim is his lab partner', '2026-11-04', 't1', 'id1')
    expect(made.body).toContain('- Maxim is his lab partner _(Ben, 2026-11-04)_')
    expect(made.author).toBe('ben')
    const again = appendLine(made, 'People', 'Maxim is his lab partner', '2026-11-05', 't2', 'id1')
    expect(again).toBe(made)
    expect(appendLine(made, 'People', 'Ana is his sister', '2026-11-05', 't2', 'id1').body.split('\n').filter((l) => l.startsWith('- ')).length).toBe(2)
  })
  it('writes the evening journal page', () => {
    const j = journalNote('2026-11-04', { score: 34, result: 'Must-dos 1/3, focus 0/95 min.', lesson: 'Start before noon.', top3: ['Sport 20 min', 'Read 10 min'] })
    expect(j.title).toBe('Journal/2026-11-04')
    expect(j.body).toContain('**Day score:** 34/100')
    expect(j.body).toContain('1. Sport 20 min')
  })
})
