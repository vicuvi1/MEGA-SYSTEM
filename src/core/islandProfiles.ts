// IC18: island profiles. Work, Study, Gaming and Night each change a few of
// your island settings (what the pill shows first, which reminders drop
// down, sound, motion); everything else stays yours. Picked in the tray menu
// or Settings, or switched by itself by the time of day or the app in front.
import type { IslandControls, IslandProfileId } from './islandControlPrefs'
import { cleanOrder, type AlertKindPref, type AlertRule, type IslandPrefs, type PillItem } from './islandModel'

export interface ProfileOverride {
  /** What the pill shows first (the rest follows in your order). */
  pillFirst?: PillItem[]
  /** Reminders: drops down, a dot only, or never. */
  rules?: Partial<Record<AlertKindPref, AlertRule>>
  sound?: boolean
  volume?: number
  motion?: IslandPrefs['motion']
  opacity?: number
}

export const PROFILES: Record<Exclude<IslandProfileId, 'none'>, ProfileOverride> = {
  // At work: the plan and the next task first, body nudges as a dot.
  work: { pillFirst: ['timer', 'now', 'next', 'tasks'], rules: { water: 'dot', move: 'dot', eyes: 'dot', highlight: 'dot' }, motion: 'calm' },
  // Studying: the timer and must-dos; Ben and highlights wait.
  study: { pillFirst: ['timer', 'mustdos', 'now', 'next'], rules: { ben: 'dot', highlight: 'never', reward: 'dot', water: 'dot' }, motion: 'calm' },
  // Gaming: quiet and light; only time-up, meetings and bedtime drop down.
  gaming: { pillFirst: ['timer', 'next', 'bed'], rules: { block: 'dot', water: 'dot', move: 'dot', eyes: 'never', ben: 'dot', morning: 'dot', highlight: 'never', reward: 'dot' }, sound: false, motion: 'off' },
  // Night: dim and soft; bedtime first, no body nudges.
  night: { pillFirst: ['bed', 'timer', 'next'], rules: { water: 'never', move: 'never', eyes: 'never', highlight: 'never', morning: 'dot' }, volume: 0.3, motion: 'calm', opacity: 0.8 }
}

/** Your settings with a profile on top (the profile only changes what it names). */
export function applyProfile(p: IslandPrefs, id: IslandProfileId): IslandPrefs {
  if (id === 'none') return p
  const o = PROFILES[id]
  if (!o) return p
  const order = cleanOrder(p.pillOrder)
  const first = (o.pillFirst ?? []).map((x) => ({ id: x, on: true }))
  const pillOrder = o.pillFirst ? [...first, ...order.filter((x) => !o.pillFirst!.includes(x.id))] : order
  const kinds = { ...p.kinds }
  for (const [k, rule] of Object.entries(o.rules ?? {}) as [AlertKindPref, AlertRule][]) {
    if (kinds[k]) kinds[k] = { ...kinds[k], show: rule, on: rule !== 'never' }
  }
  return {
    ...p,
    pillOrder,
    kinds,
    ...(o.sound != null ? { sound: o.sound } : {}),
    ...(o.volume != null ? { volume: Math.min(p.volume, o.volume) } : {}),
    ...(o.motion ? { motion: p.motion === 'off' ? 'off' : o.motion } : {}),
    ...(o.opacity != null ? { opacity: Math.min(p.opacity, o.opacity) } : {})
  }
}

/**
 * The profile to use now. By the time of day: Night from 22:00 to 06:00,
 * Work on weekdays 09:00–18:00, else your own pick. By the app in front: a
 * program on a profile's list picks it; any other keeps your pick.
 */
export function autoProfile(c: Pick<IslandControls, 'profile' | 'profileAuto' | 'profileApps'>, o: { now: Date; app: string | null }): IslandProfileId {
  if (c.profileAuto === 'time') {
    const h = o.now.getHours()
    const day = o.now.getDay()
    if (h >= 22 || h < 6) return 'night'
    if (day >= 1 && day <= 5 && h >= 9 && h < 18) return 'work'
    return c.profile
  }
  if (c.profileAuto === 'app' && o.app) {
    const app = o.app.toLowerCase().replace(/\.exe$/, '')
    for (const id of ['gaming', 'study', 'work'] as const) if (c.profileApps[id]?.includes(app)) return id
  }
  return c.profile
}
