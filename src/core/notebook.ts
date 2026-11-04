// The notebook: notes in Markdown, like Obsidian. You write about yourself
// ("About me", people, goals); Ben writes what he learns (a dated line under
// the right note) and a short journal page each evening. [[Title]] links
// notes; each note shows what links to it. Ben reads the notes that matter
// for what you just said, plus "About me" always.

export type NoteAuthor = 'me' | 'ben'

export interface Note {
  id: string
  title: string
  body: string
  author: NoteAuthor
  pinned: boolean
  createdAt: string
  updatedAt: string
}

/** Notes you start with (empty, for you to fill). */
export const STARTER_NOTES: { title: string; body: string; pinned?: boolean }[] = [
  { title: 'About me', pinned: true, body: '# About me\n\nWrite what Ben should always know: who you are, what you study or work on, your goals, what motivates you, what makes you procrastinate.\n\n- \n' },
  { title: 'Goals', body: '# Goals\n\n- \n' },
  { title: 'People', body: '# People\n\nThe people in your life Ben should know about.\n\n- \n' },
  { title: "Ben's notes", body: "# Ben's notes\n\nWhat Ben learned about you. He adds a dated line here; you can edit or delete any of it.\n" }
]

export const noteKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ')

/** [[Links]] in a note (titles, as written). */
export function linksOf(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(/\[\[([^\]|#]{1,120})(?:[|#][^\]]*)?\]\]/g)) {
    const t = m[1].trim()
    if (t && !out.some((x) => noteKey(x) === noteKey(t))) out.push(t)
  }
  return out
}

/** Notes that link to this one. */
export function backlinks(notes: Note[], title: string): Note[] {
  const k = noteKey(title)
  return notes.filter((n) => noteKey(n.title) !== k && linksOf(n.body).some((l) => noteKey(l) === k))
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2)

/** Search: title words count most, then body; newest first on a tie. */
export function searchNotes(notes: Note[], q: string): Note[] {
  const w = words(q)
  if (!w.length) return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
  return notes
    .map((n) => {
      const t = new Set(words(n.title))
      const b = words(n.body)
      const score = w.reduce((s, x) => s + (t.has(x) ? 5 : 0) + (b.filter((y) => y.startsWith(x)).length ? 1 + Math.min(3, b.filter((y) => y.startsWith(x)).length) / 3 : 0), 0)
      return { n, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.n.updatedAt.localeCompare(a.n.updatedAt))
    .map((x) => x.n)
}

/**
 * What Ben reads before he answers: pinned notes (About me) and the notes
 * that match the message, then the latest journal days; within `budget` chars.
 */
export function notesForBen(notes: Note[], message: string, budget = 3500): string {
  const picked: Note[] = []
  const add = (n: Note | undefined) => n && !picked.includes(n) && picked.push(n)
  notes.filter((n) => n.pinned).forEach(add)
  searchNotes(notes, message).slice(0, 4).forEach(add)
  notes
    .filter((n) => /^journal\//i.test(n.title))
    .sort((a, b) => b.title.localeCompare(a.title))
    .slice(0, 2)
    .forEach(add)
  let left = budget
  const parts: string[] = []
  for (const n of picked) {
    if (left < 120) break
    const body = n.body.replace(/\n{3,}/g, '\n\n').trim()
    const cut = body.length > left - 40 ? `${body.slice(0, left - 60)}…` : body
    parts.push(`### ${n.title}${n.author === 'me' ? ' (written by Victor)' : ''}\n${cut}`)
    left -= cut.length + n.title.length + 8
  }
  return parts.join('\n\n')
}

/** Ben's notebook actions: "note: <Title> | <line>" adds a dated line (creates the note if needed). */
export function readNoteOp(action: string): { title: string; line: string } | null {
  const m = /^\s*note\s*:\s*([^|]{1,80})\|\s*([\s\S]{1,500})$/i.exec(action)
  if (!m) return null
  const title = m[1].trim()
  const line = m[2].trim().replace(/\s+/g, ' ')
  if (!title || !line) return null
  return { title, line }
}

/** The note after Ben adds a line (new note when it doesn't exist yet). */
export function appendLine(note: Note | null, title: string, line: string, day: string, now: string, id: string): Note {
  const entry = `- ${line} _(Ben, ${day})_`
  if (!note) return { id, title, body: `# ${title}\n\n${entry}\n`, author: 'ben', pinned: false, createdAt: now, updatedAt: now }
  if (note.body.includes(line)) return note
  return { ...note, body: `${note.body.replace(/\s*$/, '')}\n${entry}\n`, updatedAt: now }
}

/** The evening journal page, from Ben's review of the day. */
export function journalNote(day: string, lines: { score: number; result: string; lesson: string; top3: string[] }): { title: string; body: string } {
  return {
    title: `Journal/${day}`,
    body: [`# ${day}`, '', `**Day score:** ${lines.score}/100`, '', lines.result.trim(), '', `**Lesson:** ${lines.lesson.trim()}`, '', lines.top3.length ? `**Tomorrow's top 3:**\n${lines.top3.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : '']
      .join('\n')
      .trim()
  }
}
