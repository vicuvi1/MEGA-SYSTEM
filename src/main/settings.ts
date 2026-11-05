// Key/value settings on any database with the better-sqlite3 API (the desktop
// file, or the web app's in-browser copy). No native imports, so the web app
// can use the same services.
import type { DB } from './db'
import { parseSetting, serializeSetting, type SettingKey, type SettingValue } from '../core/settingsKeys'

/** The raw text of a key (prefer readSetting for a listed key). */
export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

/** Saves raw text under a key (prefer writeSetting for a listed key). */
export function setSetting(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

/** LT5: a listed key, parsed to its type (its default when missing or unreadable). */
export function readSetting<K extends SettingKey>(db: DB, key: K): SettingValue<K> {
  return parseSetting(key, getSetting(db, key))
}

/** LT5: saves a listed key in its own format (JSON, '1'/'0', a number or text). */
export function writeSetting<K extends SettingKey>(db: DB, key: K, value: SettingValue<K>): void {
  setSetting(db, key, serializeSetting(key, value))
}
