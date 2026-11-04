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
  const list = [...loadTriggers(db), { at: note.at, kind: note.kind === 'reset' ? 'reset' : 'urge', trigger: String(note.trigger).slice(0, 60) }].slice(-300)
  setSetting(db, TRIGGER_KEY, JSON.stringify(list))
}

export function urgeEvents(db: any): UrgeEvent[] {
  try {
    return (db.prepare("SELECT kind, ts FROM discipline_events WHERE kind IN ('urge', 'reset') ORDER BY id DESC LIMIT 400").all() as { kind: 'urge' | 'reset'; ts: string }[]).map((r) => ({ kind: r.kind, ts: r.ts }))
  } catch {
    return []
  }
}
