// The island's feel (phase 4), pure and tested: your best streak and whether
// it's at risk, the time of day for its colors, today's highlight, and the
// moment a reward unlocks.
import type { IslandAlert } from './islandModel'
import { calendarDay } from './dates'

export type DayPart = 'morning' | 'day' | 'evening' | 'night'
export function dayPart(now: number): DayPart {
  const h = new Date(now).getHours()
  return h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 18 ? 'day' : h >= 18 && h < 22 ? 'evening' : 'night'
}

/** Days in a row (ending yesterday, plus today if done) from per-day values. */
export function runOf(days: { day: string; ok: boolean }[], today: string): { days: number; todayDone: boolean } {
  const map = new Map(days.map((d) => [d.day, d.ok]))
  const todayDone = !!map.get(today)
  let n = todayDone ? 1 : 0
  const d = new Date(`${today}T12:00:00`)
  for (;;) {
    d.setDate(d.getDate() - 1)
    const k = calendarDay(d)
    if (!map.get(k)) break
    n++
  }
  return { days: n, todayDone }
}

/** The streak to show: the longest of sport / focus; at risk after 18:00 if today isn't done yet. */
export function bestStreak(o: { now: number; sport: { days: number; todayDone: boolean }; focus: { days: number; todayDone: boolean } }): { days: number; kind: 'sport' | 'focus'; atRisk: boolean } | null {
  const pick = o.sport.days >= o.focus.days ? { kind: 'sport' as const, ...o.sport } : { kind: 'focus' as const, ...o.focus }
  if (pick.days < 2) return null
  return { days: pick.days, kind: pick.kind, atRisk: !pick.todayDone && new Date(o.now).getHours() >= 18 }
}

export interface HighlightFacts {
  focusMin: number
  /** Focus minutes on each of the days before today this week. */
  focusBefore: number[]
  mustDone: number
  mustTotal: number
  waterMl: number
  waterTarget: number
  workoutDone: boolean
  sportStreak: number
}

/** The single best thing about today, in one line (null on a quiet day). */
export function dayHighlight(f: HighlightFacts): string | null {
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
  const bestBefore = Math.max(0, ...f.focusBefore)
  if (f.focusMin >= 30 && f.focusMin > bestBefore) return `Best focus day this week: ${hm(f.focusMin)} 🔥`
  if (f.mustTotal > 0 && f.mustDone === f.mustTotal) return `Every must-do done (${f.mustDone}/${f.mustTotal}) ✅`
  if (f.workoutDone && f.sportStreak >= 3) return `Training streak: ${f.sportStreak} days in a row 💪`
  if (f.focusMin >= 60) return `${hm(f.focusMin)} of deep focus today 🎯`
  if (f.waterTarget > 0 && f.waterMl >= f.waterTarget) return `Water target hit: ${(f.waterMl / 1000).toFixed(1)} L 💧`
  if (f.workoutDone) return 'You trained today 💪'
  return null
}

export function highlightAlert(text: string | null, now: number, dismissed: Record<string, number>): IslandAlert | null {
  if (!text || new Date(now).getHours() < 20) return null
  const id = `highlight:${new Date(now).toDateString()}`
  if ((dismissed[id] ?? 0) > now) return null
  return { id, kind: 'highlight', title: "Today's highlight", text, face: '🏆', actions: [{ label: 'Nice', action: { kind: 'dismiss', id }, primary: true }] }
}

/** A reward you can now afford (once per reward): a small celebration. */
export function rewardAlert(o: { balance: number; goal: { title: string; price: number } | null; celebrated: string[]; now: number; dismissed: Record<string, number> }): IslandAlert | null {
  if (!o.goal || o.balance < o.goal.price) return null
  const id = `reward:${o.goal.title}:${o.goal.price}`
  if (o.celebrated.includes(id) || (o.dismissed[id] ?? 0) > o.now) return null
  return {
    id,
    kind: 'reward',
    title: 'Reward unlocked 🎉',
    text: `${o.goal.title} · you have ${o.balance} ⭐ (it costs ${o.goal.price})`,
    face: '🎁',
    actions: [
      { label: 'Redeem it', action: { kind: 'open', page: 'shop' }, primary: true },
      { label: 'Keep saving', action: { kind: 'dismiss', id } }
    ]
  }
}
