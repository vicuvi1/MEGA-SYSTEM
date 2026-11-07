// Sport Track's daily routine (v3: the coach is the default way Today works): your own exercises (push-ups, sit-ups, press, anything you added) are what
// Today shows. The generated plan session and "Build muscle" are opt-in. Pure, so it is tested.

/** Bump when a new routine migration is needed. */
export const ROUTINE_VERSION = 3

/**
 * One time: anyone whose Today turned into the plan (or an empty rest day) gets "My routine" back, with
 * their own exercises and the daily targets they had. A choice made on purpose is kept: "The plan" or
 * "Build muscle" picked after this version (they are stored as `true` / `'grow'` then).
 */
export function migrateRoutine<T extends { exercises?: any[]; sportySettings?: any }>(state: T): T {
  const ss = state.sportySettings ?? {}
  if (Number(ss.routineV) >= ROUTINE_VERSION) return state
  const from = Number(ss.routineV) || 0
  const exercises = (state.exercises ?? []).map((e) => ({ ...e }))
  const settings = { ...ss, routineV: ROUTINE_VERSION }
  if (from < 2) {
  // The plan was on by default (no choice stored): back to your own routine.
  if (settings.planFollow !== true) settings.planFollow = false
  // Build muscle was the default too: without a stored choice, back to the daily totals you had.
  if (settings.progressMode == null || settings.progressMode === 'grow') {
    settings.progressMode = 'endurance'
    for (const e of exercises) {
      if (e.endTarget != null) {
        e.target = e.endTarget
        delete e.endTarget
      }
    }
  }
  }
  // v3: the coach (levels, next targets, feedback on every log) is on for everyone; "Simple totals" in the Plan tab turns it off.
  if (from < 3) settings.progressMode = 'grow'
  // Never an empty routine: if everything of yours is off, your own exercises come back on.
  if (!exercises.some((e) => e.active) && exercises.length) for (const e of exercises) if (!e.plan) e.active = true
  return { ...state, exercises, sportySettings: settings }
}
