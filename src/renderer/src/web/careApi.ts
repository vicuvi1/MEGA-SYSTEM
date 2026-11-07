// `life.care` for the web app (BD4–BD6, BD12, BD15): each call runs on the
// browser's copy of the database (careStore.ts) and tells the open pages.
import type { LifeApi } from '@shared/api'
import type { WebServices } from './webServices'
import { careLight, carePrefs, careView, careWarm, groomRhythm, groomStep, groomView, groomWeekly, logCoffee, shiftStep, takeBackCoffee } from './careStore'

const tell = (...names: string[]) => {
  if (typeof window === 'undefined') return
  for (const n of names) window.dispatchEvent(new CustomEvent(n))
}
const CARE = 'life-care-changed'

export function careApi(svcP: Promise<WebServices>): NonNullable<LifeApi['care']> {
  const read = async <T>(fn: (s: any, db: any) => T) => (await svcP).read((s) => fn(s, s.db))
  const write = async <T>(fn: (s: any, db: any) => T, ...events: string[]) => {
    const r = await (await svcP).write((s) => fn(s, s.db))
    tell(CARE, ...events)
    return r
  }
  return {
    state: () => read((s, db) => careView(s, db)),
    coffee: (cups = 1) => write((s, db) => logCoffee(s, db, cups)),
    undoCoffee: () => write((s, db) => takeBackCoffee(s, db)),
    light: () => write((s, db) => careLight(s, db)),
    warm: () => write((s, db) => careWarm(s, db)),
    prefs: (p) => write((s, db) => carePrefs(s, db, p)),
    shiftStep: (step, on) => write((s, db) => shiftStep(s, db, step, on), 'life-habits-changed', 'life-wallet-changed'),
    groom: (sunny) => read((s, db) => groomView(s, db, sunny)),
    groomStep: (id, on, sunny) => write((s, db) => groomStep(s, db, id, on, sunny), 'life-habits-changed', 'life-wallet-changed'),
    groomWeekly: (id, done, sunny) => write((s, db) => groomWeekly(s, db, id, done, sunny), 'life-habits-changed'),
    groomRhythm: (weeks, sunny) => write((s, db) => groomRhythm(s, db, weeks, sunny))
  }
}
