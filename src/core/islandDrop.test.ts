import { describe, expect, it } from 'vitest'
import { dropTarget, linkWords, parseDrop, shortLink } from './islandDrop'

describe('the drop zone', () => {
  it('a link: a note by default, its words when the browser gave them', () => {
    const p = parseDrop({ uris: ['https://www.example.com/blog/post-1/'], html: '<a href="https://www.example.com/blog/post-1/">A <b>good</b> read &amp; more</a>' })
    expect(p).toEqual({ kind: 'link', best: 'note', task: 'Read: A good read & more https://www.example.com/blog/post-1/', note: 'A good read & more https://www.example.com/blog/post-1/', preview: 'A good read & more' })
  })
  it('a bare link as text', () => {
    const p = parseDrop({ text: 'https://example.org/a?b=1' })
    expect(p).toMatchObject({ kind: 'link', task: 'Read: example.org/a https://example.org/a?b=1', note: 'https://example.org/a?b=1', preview: 'example.org/a' })
  })
  it('a Todoist link stays a Todoist task; other schemes are refused', () => {
    expect(parseDrop({ uris: ['https://app.todoist.com/app/task/call-the-bank-6X7rM8'] }).kind).toBe('todoist')
    expect(parseDrop({ uris: ['file:///C:/secret.txt'] })).toEqual({ kind: 'refuse', why: 'Only web links can be saved' })
  })
  it('short text is a task, long or several lines a note', () => {
    expect(parseDrop({ text: '  Call the plumber  ' })).toMatchObject({ kind: 'text', best: 'task', task: 'Call the plumber' })
    const long = parseDrop({ text: 'Idea for the essay\nStart with the story about the bike\nThen the numbers' })
    expect(long).toMatchObject({ best: 'note', task: 'Idea for the essay', note: 'Idea for the essay Start with the story about the bike Then the numbers' })
  })
  it('a file is saved by name only', () => {
    expect(parseDrop({ files: [{ name: 'notes/plan.pdf', size: 250_000, type: 'application/pdf' }] })).toEqual({ kind: 'file', best: 'note', task: 'Look at notes_plan.pdf', note: '📎 notes_plan.pdf (250 KB)', preview: 'notes_plan.pdf' })
  })
  it('nothing', () => expect(parseDrop({})).toEqual({ kind: 'refuse', why: 'Nothing to drop' }))
  it('left half is Task, right half Note', () => {
    expect(dropTarget(110, 100, 300)).toBe('task')
    expect(dropTarget(260, 100, 300)).toBe('note')
  })
  it('helpers', () => {
    expect(linkWords('<p>no link</p>')).toBe('')
    expect(shortLink('not a url')).toBe('not a url')
  })
})
