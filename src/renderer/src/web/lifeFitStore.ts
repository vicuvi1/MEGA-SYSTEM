// My life (core/lifeFit.ts) on the database: read, save, tonight's shift, and
// the sleep window it shares with the sleep targets (sleep_bed_target and
// sleep_weekday_target stay the one place for bedtime and wake time).
import { cleanLifeFit, DEFAULT_BED, DEFAULT_WAKE, LIFE_FIT_KEY, setTonight, type LifeFit, type ShiftMode } from '@core/lifeFit'
import { AREAS, levelFromPush } from '@core/benPushes'
import { getSetting, setSetting } from '../../../main/settings'

const HM = /^([01]\d|2[0-3]):[0-5]\d$/

export function readLifeFit(db: any): LifeFit {
  try {
    return cleanLifeFit(JSON.parse(getSetting(db, LIFE_FIT_KEY) || 'null'))
  } catch {
    return cleanLifeFit(null)
  }
}

/** Bedtime and wake time: your sleep targets, or the My life defaults when none is set yet. */
export function sleepWindow(db: any): { bed: string; wake: string } {
  const bed = getSetting(db, 'sleep_bed_target')
  const wake = getSetting(db, 'sleep_weekday_target')
  return { bed: bed && HM.test(bed) ? bed : DEFAULT_BED, wake: wake && HM.test(wake) ? wake : DEFAULT_WAKE }
}

export interface LifeFitView extends LifeFit {
  bed: string
  wake: string
}

export const lifeFitView = (db: any): LifeFitView => ({ ...readLifeFit(db), ...sleepWindow(db) })

/** Saves a change; bedtime and wake time go to the sleep targets. */
export function saveLifeFit(db: any, patch: Partial<LifeFitView>): LifeFitView {
  const { bed, wake, ...rest } = patch
  const cur = readLifeFit(db)
  // Ben 2: the one "how hard Ben pushes" sets every area at once; an area changed by itself keeps its own.
  const areas = rest.areas ? { ...cur.areas, ...rest.areas } : rest.push ? Object.fromEntries(AREAS.map((a) => [a, levelFromPush(rest.push)])) : cur.areas
  const next = cleanLifeFit({ ...cur, ...rest, areas, pushes: { ...cur.pushes, ...(rest.pushes ?? {}) }, work: { ...cur.work, ...(rest.work ?? {}) } })
  setSetting(db, LIFE_FIT_KEY, JSON.stringify(next))
  if (bed && HM.test(bed)) setSetting(db, 'sleep_bed_target', bed)
  if (wake && HM.test(wake)) {
    setSetting(db, 'sleep_weekday_target', wake)
    // The rule's name follows your target (as the Sleep page does).
    try {
      db.prepare("UPDATE rules SET title = ? WHERE id = 'sleep.up_on_time'").run(`Up by ${wake}`)
    } catch {
      /* no rules table here */
    }
  }
  return lifeFitView(db)
}

/** "Short shift tonight" / "no work tonight" / "normal shift" for the app day `day`. */
export function saveTonight(db: any, day: string, mode: ShiftMode): LifeFit {
  const next = setTonight(readLifeFit(db), day, mode)
  setSetting(db, LIFE_FIT_KEY, JSON.stringify(next))
  return next
}
