// Custom Center: moving an older set-up to the current version, one step at a
// time. Each step takes the raw JSON of version N and returns version N+1;
// `cleanSetup` runs after the last step. A version newer than this app knows
// is refused (the app must be updated first), never guessed at.
import { CUSTOM_VERSION, DEFAULT_MODE } from './model'

type Raw = Record<string, any>

/**
 * Steps from version N (the index) to N+1.
 * - 0 → 1: no version field at all (the first exports) — nothing to change.
 * - 1 → 2: version 1 had no modes: one `layout` and one `background` at the
 *   top. They become the "Everyday" mode, which is also the base mode.
 */
const STEPS: ((s: Raw) => Raw)[] = [
  (s) => ({ ...s, version: 1 }),
  (s) => {
    const { layout, ...rest } = s
    if (Array.isArray(s.modes) && s.modes.length) return { ...rest, version: 2 }
    return { ...rest, version: 2, modes: [{ ...DEFAULT_MODE, layout: layout ?? DEFAULT_MODE.layout }], baseMode: DEFAULT_MODE.id }
  }
]

export type Migrated = { ok: true; raw: Raw; from: number } | { ok: false; why: string }

/** Brings a raw set-up up to CUSTOM_VERSION (not cleaned yet). */
export function migrateSetup(input: unknown): Migrated {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, why: 'This is not a Custom Center set-up' }
  let s = input as Raw
  const v = s.version == null ? 0 : Number(s.version)
  if (!Number.isInteger(v) || v < 0) return { ok: false, why: 'This set-up has a broken version number' }
  if (v > CUSTOM_VERSION) return { ok: false, why: 'This set-up was made by a newer version of Life System. Update the app first' }
  for (let i = v; i < CUSTOM_VERSION; i++) s = STEPS[i](s)
  return { ok: true, raw: s, from: v }
}
