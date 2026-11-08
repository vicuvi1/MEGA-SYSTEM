// Custom Center: your set-up as a file. Export writes plain JSON with a
// marker and the version; import reads it back through the migrations and
// `cleanSetup`. A file that is not a set-up, is too big, is from a newer app,
// or holds no usable part is refused with one plain sentence. Nothing in a
// file is ever run: every field is data and unknown fields are dropped.
// Pictures and sounds you uploaded stay on this device and are not in the file.
import { migrateSetup } from './migrate'
import { CUSTOM_MAX_BYTES, CUSTOM_VERSION, type CustomSetup } from './model'
import { cleanSetup } from './validate'

export const EXPORT_KIND = 'life-system/custom-setup'
/** A file over this is refused before it is even read as JSON. */
export const IMPORT_MAX_BYTES = 200_000

export interface SetupFile {
  kind: typeof EXPORT_KIND
  version: number
  exportedAt: string
  setup: CustomSetup
}

/** The file's text. Local picture and sound ids are dropped (they only work on this device). */
export function exportSetup(setup: CustomSetup, now: number): string {
  const json = JSON.stringify(setup).replace(/"local:[a-z0-9_-]{1,40}"/gi, '""')
  const clean = cleanSetup(JSON.parse(json))
  const file: SetupFile = { kind: EXPORT_KIND, version: CUSTOM_VERSION, exportedAt: new Date(now).toISOString(), setup: { ...clean, manual: null } }
  return JSON.stringify(file, null, 2)
}

export const exportName = (now: number) => `life-custom-setup-${new Date(now).toISOString().slice(0, 10)}.json`

export type ImportResult = { ok: true; setup: CustomSetup; counts: { widgets: number; actions: number; reminders: number; modes: number } } | { ok: false; why: string }

/** Reads a file's text into a clean set-up, or says plainly why not. */
export function importSetup(textIn: string): ImportResult {
  const text = String(textIn ?? '')
  if (!text.trim()) return { ok: false, why: 'The file is empty' }
  if (text.length > IMPORT_MAX_BYTES) return { ok: false, why: 'The file is too big for a set-up' }
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, why: "This file isn't a set-up (it isn't JSON)" }
  }
  if (!data || typeof data !== 'object' || data.kind !== EXPORT_KIND || !data.setup || typeof data.setup !== 'object') return { ok: false, why: "This file isn't a Life System Custom Center set-up" }
  const fileVersion = Number(data.version)
  const raw = { ...data.setup, version: Number.isInteger(fileVersion) ? fileVersion : data.setup.version }
  const m = migrateSetup(raw)
  if (!m.ok) return m
  const setup = cleanSetup(m.raw)
  const hasAny = setup.widgets.length || setup.actions.length || setup.reminders.length || setup.modes.some((x) => x.schedule.length || x.layout.pill.length + x.layout.island.length + x.layout.home.length)
  if (!hasAny) return { ok: false, why: 'This set-up has nothing in it that this app can use' }
  if (JSON.stringify(setup).length > CUSTOM_MAX_BYTES) return { ok: false, why: 'This set-up is too big to keep in sync' }
  return { ok: true, setup: { ...setup, manual: null }, counts: { widgets: setup.widgets.length, actions: setup.actions.length, reminders: setup.reminders.length, modes: setup.modes.length } }
}
