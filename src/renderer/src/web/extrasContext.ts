// The saved records behind your own habits, life modes, the learning path and
// the month aim (settings keys), plus the short lines Ben reads about them.
// No browser code: the server's bot bundle uses this too.
import { getSetting, setSetting } from '../../../main/settings'
import { cleanBook, habitsLine, MY_HABITS, type HabitBook } from '@core/myHabits'
import { cleanModes, LIFE_MODE, modeLine, modeRestDays, modeRules, type ModeBook } from '@core/lifeMode'
import { cleanLearn, LEARN_LOG, learnLine, type LearnEntry } from '@core/learnPath'
import { aimLine, cleanAims, MONTH_AIMS, type MonthAim } from '@core/monthReview'

const read = (db: any, key: string): any => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}

export const loadHabits = (db: any): HabitBook => cleanBook(read(db, MY_HABITS))
export const saveHabits = (db: any, b: HabitBook) => setSetting(db, MY_HABITS, JSON.stringify(b))

export const loadModes = (db: any, today: string): ModeBook => cleanModes(read(db, LIFE_MODE), today)
export const saveModes = (db: any, b: ModeBook) => setSetting(db, LIFE_MODE, JSON.stringify(b))
/** Today's mode rules (or null on a normal day). */
export const todayMode = (db: any, today: string) => modeRules(loadModes(db, today), today)
/** Sick and travel days: they keep the workout streak. */
export const modeRest = (db: any, today: string): string[] => modeRestDays(loadModes(db, today), today)

export const loadLearn = (db: any): LearnEntry[] => cleanLearn(read(db, LEARN_LOG))
export const saveLearn = (db: any, l: LearnEntry[]) => setSetting(db, LEARN_LOG, JSON.stringify(l))

export const loadAims = (db: any): MonthAim[] => cleanAims(read(db, MONTH_AIMS))
export const saveAims = (db: any, l: MonthAim[]) => setSetting(db, MONTH_AIMS, JSON.stringify(l))

/** What Ben adds to his context from these (only lines that have something). */
export function extrasContext(db: any, today: string, restDays: string[] = []): string[] {
  const out: string[] = []
  try {
    const modes = loadModes(db, today)
    out.push(modeLine(modes, today))
    out.push(habitsLine(loadHabits(db), today, [...restDays, ...modeRestDays(modes, today)]))
    out.push(learnLine(loadLearn(db), today))
    out.push(aimLine(loadAims(db), today))
  } catch {
    /* an older database: nothing to add */
  }
  return out.filter(Boolean)
}
