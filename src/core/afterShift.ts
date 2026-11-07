// BD5 After-shift wind-down (pure, tested in afterShift.test.ts). When your
// work window (Settings → Ben → My life) ends late, around or after your
// bedtime, the wind-down starts from the shift's end instead of an hour
// before a bedtime you're still working through:
//
// - from the shift end, 20 minutes: the island goes dim and warm, a short
//   checklist (teeth, skin, alarm, phone away), "no new CTF tabs" if the PC
//   sees one, then lights out;
// - the bedtime wind-down (an hour before bed) stays quiet during the shift,
//   the late-night nudges count from lights out, and the evening shutdown
//   comes at the shift end (one message, not three).
//
// "Short shift tonight" ends it at the short shift's end; "no work tonight"
// means a normal evening (the usual wind-down).
import type { IslandAlert } from './islandModel'
import { workToday, type LifeFit } from './lifeFit'
import { windDownMode, type WindDownMode } from './healthyDay'

export const AFTER_SHIFT_MIN = 20

export const SHIFT_STEPS = [
  { id: 'teeth', label: 'Teeth' },
  { id: 'skin', label: 'Skin' },
  { id: 'alarm', label: 'Alarm set' },
  { id: 'phone', label: 'Phone away' }
] as const
export type ShiftStep = (typeof SHIFT_STEPS)[number]['id']

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const toMin = (t: string) => (t === '24:00' ? 1440 : Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)))
const hmOf = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String((((m % 1440) + 1440) % 1440) % 60).padStart(2, '0')}`
/** Minutes since noon, so one night reads in order: 23:30 (690) < 24:00 (720) < 00:20 (740) < 03:00 (900). */
const night = (m: number) => (m - 720 + 1440) % 1440
const nightOf = (t: string) => (t === '24:00' ? 720 : night(toMin(t)))
const nightNow = (now: number) => {
  const d = new Date(now)
  return night(d.getHours() * 60 + d.getMinutes())
}

export interface AfterShiftPlan {
  /** The shift's end ("HH:MM", 24:00 written 00:00). */
  start: string
  /** Lights out: the end + 20 min. */
  lightsOut: string
  /** The bedtime target it replaces tonight. */
  bed: string
}

/**
 * Tonight's after-shift plan for the app day `day`, or null: no work window
 * today, no work tonight, or the shift ends well before bed (more than an
 * hour: a normal evening, the usual wind-down).
 */
export function afterShiftPlan(fit: LifeFit | null | undefined, day: string, bed: string): AfterShiftPlan | null {
  if (!fit || !HM.test(bed)) return null
  const w = workToday(fit, day)
  if (!w || w.mode === 'off') return null
  const end = w.mode === 'short' && w.busy ? w.busy.to : w.to
  const e = nightOf(end)
  // Only an evening or night end (after noon, before 04:00), from an hour before bed on.
  if (e > 16 * 60 || e < nightOf(bed) - 60) return null
  return { start: hmOf(toMin(end)), lightsOut: hmOf(toMin(end) + AFTER_SHIFT_MIN), bed }
}

/** Tonight's bedtime for the late-night nudges: lights out after the shift when that's later than your target. */
export function effectiveBed(plan: AfterShiftPlan | null, bed: string): string {
  if (!plan) return bed
  return nightOf(plan.lightsOut) > nightOf(bed) ? plan.lightsOut : bed
}

export type ShiftPhase = { phase: 'shift'; minutesLeft: number } | { phase: 'wind'; minutesLeft: number } | null

/**
 * Where tonight is: 'shift' from an hour before bed until the shift ends
 * (the bedtime wind-down stays quiet), 'wind' for the 20 minutes after it.
 */
export function shiftPhase(plan: AfterShiftPlan | null, now: number, bedLogged: boolean): ShiftPhase {
  if (!plan || bedLogged) return null
  const n = nightNow(now)
  const s = nightOf(plan.start)
  const from = Math.min(nightOf(plan.bed) - 60, s)
  if (n >= from && n < s) return { phase: 'shift', minutesLeft: s - n }
  if (n >= s && n < s + AFTER_SHIFT_MIN) return { phase: 'wind', minutesLeft: s + AFTER_SHIFT_MIN - n }
  return null
}

/**
 * Tonight's wind-down mode for the island (it dims): the usual one on a
 * normal night; on an after-shift night nothing during the shift, the 20
 * warm minutes after it, then "past bedtime" from lights out.
 */
export function windModeTonight(plan: AfterShiftPlan | null, now: number, bed: string, bedLogged: boolean): WindDownMode | null {
  if (!plan) return windDownMode(now, bed, bedLogged)
  const p = shiftPhase(plan, now, bedLogged)
  if (p?.phase === 'shift') return null
  if (p?.phase === 'wind') return { phase: 'wind', minutes: p.minutesLeft, bedAt: plan.lightsOut, title: `After the shift · lights out ${plan.lightsOut}`, line: 'Teeth, skin, alarm, phone away. No new tabs.', music: true }
  const w = windDownMode(now, effectiveBed(plan, bed), bedLogged)
  return w?.phase === 'late' ? w : null
}

/** The island's after-shift card: the checklist and the minutes to lights out; first "no new CTF tabs" when the PC sees one. */
export function afterShiftAlert(o: { plan: AfterShiftPlan | null; now: number; day: string; bedLogged: boolean; done: string[]; ctf: boolean; dismissed: Record<string, number> }): IslandAlert | null {
  const p = shiftPhase(o.plan, o.now, o.bedLogged)
  if (!p || p.phase !== 'wind' || !o.plan) return null
  if (o.ctf) {
    const id = `aftershift:ctf:${o.day}`
    if ((o.dismissed[id] ?? 0) <= o.now)
      return {
        id,
        kind: 'winddown',
        title: 'No new CTF tabs',
        text: `Shift's over. Save the challenge link for tomorrow and close the tab: lights out at ${o.plan.lightsOut}.`,
        face: '🚩',
        actions: [
          { label: '✓ Closed it', action: { kind: 'dismiss', id, snoozeMin: 600 }, primary: true },
          { label: '5 min to save', action: { kind: 'dismiss', id, snoozeMin: 5 } }
        ]
      }
  }
  const id = `aftershift:${o.day}`
  if ((o.dismissed[id] ?? 0) > o.now) return null
  const steps = SHIFT_STEPS.map((s) => ({ id: s.id, label: s.label, done: o.done.includes(s.id) }))
  const left = steps.filter((s) => !s.done).length
  return {
    id,
    kind: 'winddown',
    title: `After the shift · lights out ${o.plan.lightsOut}`,
    text: left ? `${p.minutesLeft} min: screens dim, ${left === 4 ? 'teeth, skin, alarm, phone away' : `${left} left`}. No new tabs.` : 'All done. Phone away, lights out.',
    face: '🌙',
    actions: [
      { label: '🌙 Going to bed', action: { kind: 'bed' }, primary: !left },
      { label: 'Later', action: { kind: 'dismiss', id, snoozeMin: 10 } }
    ],
    nudge: { type: 'checklist', kind: 'bed', steps, minutesLeft: p.minutesLeft, lightsOut: o.plan.lightsOut }
  }
}

/**
 * The evening shutdown on an after-shift night: it comes at the shift's end
 * (bed = lights out, due the 20 minutes before it), never in the middle of
 * the shift. Other nights: as it was.
 */
export function shutdownFor<P extends { shutdownBefore: number }>(plan: AfterShiftPlan | null, bed: string, prefs: P): { bed: string; prefs: P } {
  if (!plan) return { bed, prefs }
  return { bed: plan.lightsOut, prefs: { ...prefs, shutdownBefore: AFTER_SHIFT_MIN } }
}

/** One line for Ben's prompt on an after-shift night. */
export function afterShiftLine(plan: AfterShiftPlan | null): string {
  return plan ? `Tonight the shift ends ${plan.start}: wind-down from then (20 min: teeth, skin, alarm, phone away), lights out ${plan.lightsOut}. Don't push the usual bedtime wind-down during the shift.` : ''
}
