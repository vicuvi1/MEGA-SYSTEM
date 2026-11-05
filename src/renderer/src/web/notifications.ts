// The notification center's storage: a small synced table, so every device
// shows the same list and "read" on one is read everywhere.
import { neutral } from '@core/stealth'
import type { Notif } from '@core/notify'

interface Db {
  prepare(sql: string): { run(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] }
}

/** Adds one (once per id), and keeps the newest 200 from the last 30 days. */
export function addNotif(db: Db, n: Omit<Notif, 'readAt'>): void {
  // Stealth mode: the bell uses neutral words too (H14).
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'discipline_stealth'").all()[0] as { value?: string } | undefined
    if (row?.value === '1') n = { ...n, title: neutral(n.title), body: n.body ? neutral(n.body) : n.body }
  } catch {
    /* no settings table yet */
  }
  db.prepare('INSERT OR IGNORE INTO notifications (id, at, kind, title, body, action) VALUES (?, ?, ?, ?, ?, ?)').run(n.id, n.at, n.kind, n.title, n.body, n.action ? JSON.stringify(n.action) : null)
  const cut = new Date(Date.parse(n.at) - 30 * 86400000).toISOString()
  db.prepare('DELETE FROM notifications WHERE at < ? OR id IN (SELECT id FROM notifications ORDER BY at DESC LIMIT -1 OFFSET 200)').run(cut)
}

/** The list, newest first; snoozed ones (dated later) appear when their time comes (N4). */
export function listNotifs(db: Db, now = new Date()): Notif[] {
  return (db.prepare('SELECT id, at, kind, title, body, action, read_at FROM notifications WHERE dismissed_at IS NULL AND at <= ? ORDER BY at DESC LIMIT 100').all(now.toISOString()) as any[]).map((r) => {
    let action = null
    try {
      action = r.action ? JSON.parse(r.action) : null
    } catch {
      action = null
    }
    return { id: String(r.id), at: String(r.at), kind: r.kind, title: String(r.title), body: r.body ?? null, action, readAt: r.read_at ?? null }
  })
}

/** Marks these (or all) as read. */
export function readNotifs(db: Db, ids: string[] | null, now = new Date()): void {
  if (ids === null) db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(now.toISOString())
  else for (const id of ids) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL').run(now.toISOString(), id)
}

/** Snooze (N4): this one goes, a copy comes back at `until` (it pops up then, on every device). */
export function snoozeNotif(db: Db, id: string, until: number, now = new Date()): void {
  const r = db.prepare('SELECT id, kind, title, body, action FROM notifications WHERE id = ?').all(id)[0] as any
  if (!r) return
  dismissNotif(db, id, now)
  const base = String(r.id).replace(/~s\d+$/, '')
  db.prepare('INSERT OR IGNORE INTO notifications (id, at, kind, title, body, action) VALUES (?, ?, ?, ?, ?, ?)').run(`${base}~s${until}`, new Date(until).toISOString(), r.kind, r.title, r.body, r.action)
}

export function dismissNotif(db: Db, id: string, now = new Date()): void {
  db.prepare('UPDATE notifications SET dismissed_at = ?, read_at = COALESCE(read_at, ?) WHERE id = ?').run(now.toISOString(), now.toISOString(), id)
}
