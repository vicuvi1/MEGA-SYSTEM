// life.coach.bodyPlus: protein, saved meals, supplements, tape measurements,
// today's training dose and the weekly body report, on this device's copy
// of the database (src/main/bodyPlus.ts). Writes go through the services'
// write (synced like everything else); photos are NOT here: they stay on
// this device only (bodyPhotos.ts).
import { bodyPlusView, bodyWeekReport, sportInsightNow, sportBodyNow, logMeal, logProtein, readinessNow, savePrefs, saveTape, tickSupp, type BodyPlusView, type BodyPrefs, type Tape } from '../../../main/bodyPlus'
import { toggleEntry } from '../../../main/bodyLog'
import type { DoseMode, TrainReady } from '@core/trainReadiness'
import type { BodyWeek } from '@core/bodyReport'
import type { Insight, InsightData } from '@core/sportInsight'
import { sportToday } from '@core/sportShared'

export interface BodyPlusApi {
  view(): Promise<BodyPlusView>
  protein(log: { food: string; g: number }, source?: string): Promise<BodyPlusView>
  meal(id: string): Promise<BodyPlusView>
  /** Removes an entry, or brings a removed one back (a row each time, nothing deleted). */
  toggle(id: string): Promise<BodyPlusView>
  prefs(patch: Partial<BodyPrefs>): Promise<BodyPlusView>
  tape(row: Omit<Tape, 'day'> & { day?: string }): Promise<BodyPlusView>
  /** Ticks a supplement for today, or takes today's tick back. */
  supp(id: string): Promise<BodyPlusView>
  ready(soreness: number | null, quality?: number | null): Promise<TrainReady>
  /** Your dose for today (null: back to automatic). */
  setDose(mode: DoseMode | null, soreness: number | null): Promise<TrainReady>
  week(): Promise<BodyWeek>
  /** PG4: why a move stalled (null: nothing stalled). */
  insight(): Promise<Insight | null>
  /** Sport coach: protein, sleep and readiness as data. */
  sportBody(): Promise<InsightData>
}

type Svc = { read<T>(f: (s: any) => T): Promise<T>; write<T>(f: (s: any) => T): Promise<T> }

const changed = () => {
  try {
    window.dispatchEvent(new CustomEvent('life-body-changed'))
  } catch {
    /* not in a page */
  }
}

export function bodyPlusBridge(svcP: Promise<Svc>, device: () => string): BodyPlusApi {
  const write = async <T>(f: (db: any) => T): Promise<T> => {
    const out = await (await svcP).write((s) => f(s.db))
    changed()
    return out
  }
  const view = async () => (await svcP).read((s) => bodyPlusView(s.db))
  return {
    view,
    protein: async (log, source) => write((db) => (logProtein(db, log, source || device()), bodyPlusView(db))),
    meal: async (id) => write((db) => (logMeal(db, id, device()), bodyPlusView(db))),
    toggle: async (id) => write((db) => (toggleEntry(db, id, device()), bodyPlusView(db))),
    prefs: async (patch) => write((db) => (savePrefs(db, patch), bodyPlusView(db))),
    tape: async (row) => write((db) => (saveTape(db, row), bodyPlusView(db))),
    supp: async (id) =>
      write((db) => {
        const v = bodyPlusView(db)
        const s = v.supps.find((x) => x.id === id)
        if (s?.tickId) toggleEntry(db, s.tickId, device())
        else tickSupp(db, id, device())
        return bodyPlusView(db)
      }),
    ready: async (soreness, quality = null) => (await svcP).read((s) => readinessNow(s.db, soreness, new Date(), quality)),
    setDose: async (mode, soreness) =>
      write((db) => {
        savePrefs(db, { ready: mode ? { day: sportToday(), mode } : null })
        return readinessNow(db, soreness)
      }),
    week: async () => (await svcP).read((s) => bodyWeekReport(s.db)),
    insight: async () => (await svcP).read((s) => sportInsightNow(s.db)),
    sportBody: async () => (await svcP).read((s) => sportBodyNow(s.db))
  }
}
