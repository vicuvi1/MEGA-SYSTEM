// life.coach.bodyComp: smart-scale and typed weigh-ins (body_comp) on this
// device's copy of the database (src/main/bodyComp.ts). Writes go through the
// services' write, so they sync through the mirror like every other table.
// No points for any of it.
import { addBodyMeasurement, bodyCompView, removeBodyMeasurement, type AddResult, type BodyCompView } from '../../../main/bodyComp'
import type { CompInput, CompSource } from '@core/bodyComp'
import { growthData, type GrowthData } from '../../../main/growthData'

export interface BodyCompApi {
  view(): Promise<BodyCompView>
  /** Body → Growth: every weigh-in, food day, rep day and night, with an on-time flag (read only). */
  history?(): Promise<GrowthData>
  /** Saves a weigh-in (the same one twice is one row). */
  add(input: CompInput, source?: CompSource): Promise<AddResult>
  /** Undo: removes it and puts that day's weight & waist back. */
  undo(id: string, prev: AddResult['prev']): Promise<boolean>
}

type Svc = { read<T>(f: (s: any) => T): Promise<T>; write<T>(f: (s: any) => T): Promise<T> }

const changed = () => {
  try {
    window.dispatchEvent(new CustomEvent('life-body-changed'))
  } catch {
    /* not in a page */
  }
}

export function bodyCompBridge(svcP: Promise<Svc>): BodyCompApi {
  const write = async <T>(f: (db: any) => T): Promise<T> => {
    const out = await (await svcP).write((s) => f(s.db))
    changed()
    return out
  }
  return {
    view: async () => (await svcP).read((s) => bodyCompView(s.db)),
    history: async () => (await svcP).read((s) => growthData(s.db)),
    add: async (input, source = 'manual') => write((db) => addBodyMeasurement(db, input, source)),
    undo: async (id, prev) => write((db) => removeBodyMeasurement(db, id, prev))
  }
}
