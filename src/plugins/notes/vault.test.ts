import { describe, expect, it } from 'vitest'
import { noteSummary, notesLine, notionTitle, skipDir } from './vault'

describe('notes from the vault', () => {
  it('keeps the title, headings and first lines of a note', () => {
    const md = ['---', 'tags: [study]', '---', '# Rust plan', 'Learn [[Ownership|ownership]] first.', '', '```rust', 'fn main() {}', '```', '## Week 1', '- [ ] Read chapter 4 of the [book](https://example.com)', '> A quote', 'More text'].join('\n')
    const n = noteSummary('Study/Rust plan.md', md, new Date('2026-11-01T10:00:00Z'))
    expect(n).toEqual({ title: 'Rust plan', folder: 'Study', headings: ['Rust plan', 'Week 1'], lines: ['Learn ownership first.', 'Read chapter 4 of the book', 'A quote'], edited: '2026-11-01T10:00:00.000Z' })
  })

  it('skips hidden folders and templates', () => {
    expect(skipDir('.obsidian')).toBe(true)
    expect(skipDir('Templates')).toBe(true)
    expect(skipDir('Study')).toBe(false)
  })

  it("writes Ben's line, kept short", () => {
    const vault = { folder: 'Vault', at: '', count: 2, notes: [noteSummary('a.md', '# A\nfirst', new Date(0)), noteSummary('b.md', 'just text', new Date(0))] }
    expect(notesLine(vault, { at: '', pages: [{ title: 'CTF ideas', edited: '', url: '' }] })).toBe('His own notes (read-only, 3 notes, newest first; use them to plan, never edit them): a (A): first; b: just text; CTF ideas (Notion).')
    expect(notesLine(null, null)).toBeNull()
    const many = { ...vault, notes: Array.from({ length: 50 }, (_, i) => noteSummary(`note ${i}.md`, 'x'.repeat(100), new Date(0))) }
    expect(notesLine(many, null)!.length).toBeLessThan(820)
  })

  it("reads a Notion page's title", () => {
    expect(notionTitle({ properties: { Name: { type: 'title', title: [{ plain_text: 'Reading ' }, { plain_text: 'list' }] } } })).toBe('Reading list')
    expect(notionTitle({})).toBe('Untitled')
  })
})
