// Custom Center: the public API (docs/areas/custom.md). The island and the
// app's home read the set-up through these:
//   cleanSetup(raw) → CustomSetup        (the synced setting `custom_setup`)
//   activeLayout(setup, now)             (mode, pill/island/home widgets, looks, background, reminders)
//   widgetState(widget, ctx)             (plain numbers and text to draw)
//   reminderGate / nextFire              (when a custom reminder may show)
//   counterRoute                         (where a counter tap is logged)
export * from './model'
export * from './validate'
export * from './migrate'
export * from './modes'
export * from './reminders'
export * from './counters'
export * from './layout'
export * from './actions'
export * from './templates'
export * from './exportImport'

import { migrateSetup } from './migrate'
import { defaultSetup, type CustomSetup } from './model'
import { cleanSetup } from './validate'

/** The synced copy (any version, or nothing) as a clean current set-up; a broken one gives the defaults. */
export function readSetup(raw: unknown): CustomSetup {
  if (raw == null) return defaultSetup()
  const m = migrateSetup(raw)
  return m.ok ? cleanSetup(m.raw) : defaultSetup()
}
