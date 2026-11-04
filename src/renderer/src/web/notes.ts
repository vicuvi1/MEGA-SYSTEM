// The notebook's storage: one synced table (notes), so a note written on the
// phone, on the PC or by Ben on the server shows everywhere.
import { appendLine, journalNote, noteKey, STARTER_NOTES, type Note } from '@core/notebook'

interface Db {
  prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
}

const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const row = (r: any): Note => ({ id: String(r.id), title: String(r.title), body: String(r.body ?? ''), author: r.author === 'ben' ? 'ben' : 'me', pinned: !!Number(r.pinned), createdAt: String(r.created_at), updatedAt: String(r.updated_at) })

export function listNotes(db: Db): Note[] {
  return (db.prepare('SELECT id, title, body, author, pinned, created_at, updated_at FROM notes ORDER BY pinned DESC, updated_at DESC').all() as any[]).map(row)
}

/** The first time: the starter notes (About me, Goals, People, Ben's notes). */
export function seedNotes(db: Db, now = new Date()): void {
  if ((db.prepare('SELECT COUNT(*) AS n FROM notes').all()[0] as any)?.n > 0) return
  for (const s of STARTER_NOTES) {
    db.prepare('INSERT OR IGNORE INTO notes (id, title, body, author, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(newId(), s.title, s.body, 'me', s.pinned ? 1 : 0, now.toISOString(), now.toISOString())
  }
}

const byTitle = (db: Db, title: string): Note | null => {
  const r = db.prepare('SELECT id, title, body, author, pinned, created_at, updated_at FROM notes WHERE lower(title) = ?').all(noteKey(title))[0]
  return r ? row(r) : null
}

/** Saves a note you wrote (new or edited). A title another note has is refused. */
export function saveNote(db: Db, n: { id?: string; title: string; body: string; pinned?: boolean }, now = new Date()): Note {
  const title = n.title.trim().slice(0, 120) || 'Untitled'
  const clash = byTitle(db, title)
  if (clash && clash.id !== n.id) throw new Error(`There is already a note called “${clash.title}”`)
  const at = now.toISOString()
  if (n.id) {
    db.prepare('UPDATE notes SET title = ?, body = ?, pinned = COALESCE(?, pinned), updated_at = ? WHERE id = ?').run(title, n.body, n.pinned == null ? null : n.pinned ? 1 : 0, at, n.id)
    return byTitle(db, title)!
  }
  const id = newId()
  db.prepare('INSERT INTO notes (id, title, body, author, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, title, n.body, 'me', n.pinned ? 1 : 0, at, at)
  return byTitle(db, title)!
}

export function removeNote(db: Db, id: string): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}

/** Ben adds a dated line under a note (made if it doesn't exist). Returns the "done" line, or null. */
export function benNote(db: Db, title: string, line: string, day: string, now = new Date()): string | null {
  const cur = byTitle(db, title)
  const next = appendLine(cur, cur?.title ?? title.trim().slice(0, 120), line.slice(0, 400), day, now.toISOString(), cur?.id ?? newId())
  if (cur && next === cur) return null
  if (cur) db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(next.body, next.updatedAt, cur.id)
  else db.prepare('INSERT INTO notes (id, title, body, author, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)').run(next.id, next.title, next.body, 'ben', next.createdAt, next.updatedAt)
  return `📓 Noted in “${next.title}”: ${line.slice(0, 80)}`
}

/** The evening journal page (Journal/YYYY-MM-DD), written or replaced by Ben. */
export function writeJournal(db: Db, day: string, r: { score: number; result: string; lesson: string; top3: string[] }, now = new Date()): void {
  const j = journalNote(day, r)
  const cur = byTitle(db, j.title)
  if (cur) db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(j.body, now.toISOString(), cur.id)
  else db.prepare('INSERT INTO notes (id, title, body, author, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)').run(newId(), j.title, j.body, 'ben', now.toISOString(), now.toISOString())
}
