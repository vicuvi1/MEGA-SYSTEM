import { undoneResets } from '../../../main/discipline'
// Urge / reset history with what set it off (shared by the app, Ben and the
// server). Times come from discipline_events; triggers from a small setting.
import type { TriggerNote, UrgeEvent } from '@core/urgePatterns'
import { getSetting, setSetting } from '../../../main/settings'

export const TRIGGER_KEY = 'discipline_triggers'

export function loadTriggers(db: any): TriggerNote[] {
  try {
    const v = JSON.parse(getSetting(db, TRIGGER_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => x && typeof x.trigger === 'string' && typeof x.at === 'string') : []
  } catch {
    return []
  }
}

export function addTrigger(db: any, note: TriggerNote): void {
  const lvl = (v: unknown) => (typeof v === 'number' && v >= 1 && v <= 10 ? Math.round(v) : undefined)
  const entry: TriggerNote = { at: note.at, kind: note.kind === 'reset' ? 'reset' : 'urge', trigger: String(note.trigger).slice(0, 60) }
  // How strong it was before and after the crusher, and what you did (H11).
  if (lvl(note.before) != null) entry.before = lvl(note.before)
  if (lvl(note.after) != null) entry.after = lvl(note.after)
  if (note.action) entry.action = String(note.action).slice(0, 40)
  const list = [...loadTriggers(db), entry].slice(-300)
  setSetting(db, TRIGGER_KEY, JSON.stringify(list))
}

export function urgeEvents(db: any): UrgeEvent[] {
  try {
    // BG12: a reset taken back in its first 10 minutes isn't a relapse.
    const undone = undoneResets(db)
    return (db.prepare("SELECT id, kind, ts FROM discipline_events WHERE kind IN ('urge', 'reset') ORDER BY id DESC LIMIT 400").all() as { id: number; kind: 'urge' | 'reset'; ts: string }[])
      .filter((r) => !undone.has(r.id))
      .map((r) => ({ kind: r.kind, ts: r.ts }))
  } catch {
    return []
  }
}
