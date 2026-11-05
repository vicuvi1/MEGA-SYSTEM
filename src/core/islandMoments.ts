// The desktop island's small moments (pure, tested): what to celebrate when
// a new snapshot arrives (IM4), today's three rings (IC5) and the evening
// story (IC14). The island page draws them; nothing here touches the DOM.
import type { IslandAlert, IslandRecap, IslandSnapshot } from './islandModel'

/** IM4: something worth a short burst and a wide pill. */
export interface Moment {
  id: string
  kind: 'mustdos' | 'water' | 'focus' | 'streak'
  icon: string
  text: string
  /** The burst's colours. */
  colors: string[]
}

const LIME = ['#d4ff3f', '#f1ffb8', '#ffffff']
const WATER = ['#47b5ff', '#8fdcff', '#ffffff']
const GOLD = ['#ffd451', '#ffb547', '#ffffff']

/**
 * IM4: what just happened between two snapshots: all must-dos done, the
 * day's water reached, a focus timer stopped on time (from a minute before
 * its end to three minutes after), a new best streak. Only real pictures
 * count (never the first one, a locked one or the empty one).
 */
export function momentsFrom(prev: IslandSnapshot | null, cur: IslandSnapshot, now: number): Moment[] {
  if (!prev || !prev.at || prev.locked || !cur.at || cur.locked) return []
  const out: Moment[] = []
  const day = new Date(now).toDateString()
  const total = cur.mustdos.length
  const openBefore = prev.mustdos.filter((m) => !m.done).length
  if (total > 0 && openBefore > 0 && prev.mustdos.length === total && cur.mustdos.every((m) => m.done))
    out.push({ id: `mustdos:${day}`, kind: 'mustdos', icon: '✓', text: total === 1 ? 'Must-do done' : total === 2 ? 'Both done' : `All ${total} done`, colors: LIME })
  const t = cur.water.target
  if (t > 0 && prev.water.ml < t && cur.water.ml >= t) out.push({ id: `water:${day}`, kind: 'water', icon: '💧', text: `${(t / 1000).toFixed(1).replace(/\.0$/, '')} L today`, colors: WATER })
  const r = prev.running
  if (r && !cur.running && now >= r.endsAt - 60_000 && now <= r.endsAt + 3 * 60_000) {
    const min = Math.round((r.endsAt - r.startedAt) / 60_000)
    out.push({ id: `focus:${r.startedAt}`, kind: 'focus', icon: '🎯', text: `${min} min, on time`, colors: LIME })
  }
  const a = prev.streak
  const b = cur.streak
  if (a && b && a.best != null && b.best != null && b.best > a.best && b.days >= b.best && b.days > 1) out.push({ id: `streak:${b.kind}:${b.days}`, kind: 'streak', icon: '🔥', text: `Best streak: ${b.days} days`, colors: GOLD })
  return out
}

/** IC5: today's three rings, 0..1 each: must-dos, water, focus. */
export function todayRings(s: IslandSnapshot): { must: number; water: number; focus: number } {
  const clamp = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
  const must = s.mustdos.length ? s.mustdos.filter((m) => m.done).length / s.mustdos.length : 0
  const water = s.water.target > 0 ? s.water.ml / s.water.target : 0
  const focus = s.today && s.today.focusGoal > 0 ? s.today.focusMin / s.today.focusGoal : 0
  return { must: clamp(must), water: clamp(water), focus: clamp(focus) }
}

const toMin = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * IC14: the evening story, once a day, in the hour after your evening review
 * time (21:00 unless you changed it). It tells the day in numbers for about
 * 10 seconds; tap to skip.
 */
export function recapAlert(o: { now: number; eveningAt?: string; recap: IslandRecap; dismissed: Record<string, number> }): IslandAlert | null {
  const at = toMin(o.eveningAt ?? '21:00') ?? 21 * 60
  const d = new Date(o.now)
  const cur = d.getHours() * 60 + d.getMinutes()
  if (cur < at || cur >= at + 60) return null
  const id = `recap:${d.toDateString()}`
  if ((o.dismissed[id] ?? 0) > o.now) return null
  return {
    id,
    kind: 'recap',
    title: 'Your day',
    text: recapLine(o.recap),
    face: '🌆',
    recap: o.recap,
    actions: [
      { label: 'Close my day', action: { kind: 'closeDay' }, primary: true },
      { label: 'Nice', action: { kind: 'dismiss', id, snoozeMin: 60 * 20 } }
    ]
  }
}

/** One plain line for the recap (also what a screen reader hears). */
export function recapLine(r: IslandRecap): string {
  const parts = [
    r.mustTotal ? `${r.mustDone} of ${r.mustTotal} must-dos` : null,
    r.waterTarget ? `${(r.waterMl / 1000).toFixed(1)} of ${(r.waterTarget / 1000).toFixed(1)} L water` : null,
    `${r.focusMin} min focus`
  ].filter(Boolean)
  return parts.join(' · ')
}
