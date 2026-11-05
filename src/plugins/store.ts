// Where plugins keep things (all in the settings table, synced to every device):
//   plugins_on          {id: true|false}   which plugins are switched on
//   plugin_<id>         {field: value}     your settings for it (city, user name…)
//   plugin_<id>_data    any                what its job fetched last (the cache)
//   plugins_status      {id: {at, ok, note, need}}  how its last job went
// Never secrets: tokens stay in Vercel environment variables.
import { getSetting, setSetting } from '../main/settings'
import type { PluginDb } from './types'

export const PLUGINS_ON = 'plugins_on'
export const PLUGINS_STATUS = 'plugins_status'
export const configKey = (id: string) => `plugin_${id}`
export const dataKey = (id: string) => `plugin_${id}_data`

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const v = JSON.parse(raw)
    return v == null ? fallback : (v as T)
  } catch {
    return fallback
  }
}

export function pluginsOn(db: PluginDb): Record<string, boolean> {
  const v = parseJson<Record<string, boolean>>(getSetting(db, PLUGINS_ON), {})
  return v && typeof v === 'object' ? v : {}
}

export const isOn = (db: PluginDb, id: string): boolean => pluginsOn(db)[id] === true

export function setOn(db: PluginDb, id: string, on: boolean): void {
  setSetting(db, PLUGINS_ON, JSON.stringify({ ...pluginsOn(db), [id]: on }))
}

export function readConfig<T extends Record<string, unknown>>(db: PluginDb, id: string): Partial<T> {
  const v = parseJson<Partial<T>>(getSetting(db, configKey(id)), {})
  return v && typeof v === 'object' ? v : {}
}

export function readData<T>(db: PluginDb, id: string): T | null {
  return parseJson<T | null>(getSetting(db, dataKey(id)), null)
}

export function writeData(db: PluginDb, id: string, data: unknown): void {
  setSetting(db, dataKey(id), JSON.stringify(data))
}

/** "a, b\nc" → ["a", "b", "c"] (lists in settings may be typed either way). */
export function listOf(v: unknown): string[] {
  const arr = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,\n;]/)
  return arr.map((x) => x.trim()).filter(Boolean)
}

/** Only settings keys that belong to plugins may be read or written through the plugin bridge. */
export const pluginKey = (key: string) => /^plugins?_[a-z0-9_]{1,40}$/.test(key)
