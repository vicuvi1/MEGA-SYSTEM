// TL5: smart reminders. Pure and tested (benSmartRemind.test.ts).
//
// On top of reminders at a time, Ben can remind you:
// - "when I get home": when your PC wakes up after you've been away from it
//   for at least 2 hours (the desktop app sees that), or at 20:00 at the
//   latest. The website alone can't know where you are, so Ben says so.
// - "after the lab" (any event by name): when that event in today's calendar
//   ends (its end time, known when you ask).
// - "after my workout": as soon as a workout is logged today, or at 21:00 at
//   the latest.
// They live with the other reminders (`coach_reminders`, a `when` field); the
// server's tick fires them (armSmart).

import type { Reminder } from './coachKit'
import { similarity } from './benNormalize'

export type SmartWhen = { kind: 'home' } | { kind: 'event'; match: string } | { kind: 'workout' }

export type SmartReminder = Reminder & { when?: SmartWhen & { fallback: string; seen?: number } }

const pad = (n: number) => String(n).padStart(2, '0')

export interface SmartFound {
  text: string
  when: SmartWhen
}

/**
 * "remind me to X when I get home" / "after the lab" / "after my workout"
 * (also "remind me when I get home to X", Romanian and Russian). Null when it
 * isn't one.
 */
export function readSmartRemind(text: string): SmartFound | null {
  const t = String(text ?? '').trim().replace(/[.!]+$/, '')
  const lead = /^(?:please\s+)?(?:remind me|aminteste-?mi|amintește-?mi|напомни(?: мне)?)\s+/i
  if (!lead.test(t)) return null
  const rest = t.replace(lead, '')
  const HOME = /(?:when i (?:get|come|am) (?:back )?home|once i'?m home|when i'?m home|cand ajung acasa|când ajung acasă|когда (?:приду|буду) домой|когда буду дома)/i
  const WORK = /(?:after (?:my |the )?(?:workout|training|gym)|dupa antrenament|după antrenament|после (?:тренировки|зала))/i
  const EVT = /(?:after (?:the |my )?([\p{L}\p{N} :'-]{2,40}?)|dupa (?:ce se termina )?([\p{L}\p{N} :'-]{2,40}?)|после ([\p{L}\p{N} :'-]{2,40}?))(?=$|\s+(?:to|sa|să|чтобы)\s)/iu
  const clean = (s: string) =>
    s
      .replace(/^(?:to|sa|să|чтобы)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim()
  const pick = (re: RegExp): { what: string; m: RegExpExecArray } | null => {
    const m = re.exec(rest)
    if (!m) return null
    const what = clean((rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)).trim())
    return what.length >= 2 ? { what, m } : null
  }
  const home = pick(HOME)
  if (home) return { text: home.what, when: { kind: 'home' } }
  const work = pick(WORK)
  if (work) return { text: work.what, when: { kind: 'workout' } }
  const ev = pick(EVT)
  if (ev) {
    const name = (ev.m[1] ?? ev.m[2] ?? ev.m[3] ?? '').trim()
    if (name && !/^(that|this|it|lunch|dinner|work|school|class|\d)/i.test(name)) return { text: ev.what, when: { kind: 'event', match: name } }
  }
  return null
}

export interface EventLite {
  title: string
  start: string
  end: string
  allDay?: boolean
}

/**
 * When to fire at the latest (ISO) and the plain words for the receipt.
 * An event reminder fires at that event's end (the next one today that
 * matches by name); null when no such event is left today.
 */
export function smartPlan(f: SmartFound, now: Date, events: EventLite[] = []): { at: string; words: string; honest?: string } | null {
  const at = (h: number) => {
    const d = new Date(now)
    d.setHours(h, 0, 0, 0)
    return d.getTime() > now.getTime() ? d : new Date(now.getTime() + 30 * 60000)
  }
  if (f.when.kind === 'home') return { at: at(20).toISOString(), words: 'when you get home', honest: 'I see "home" as your PC waking up after 2+ hours away (desktop app), or 20:00 at the latest.' }
  if (f.when.kind === 'workout') return { at: at(21).toISOString(), words: 'after your workout', honest: 'As soon as a workout is logged today, or 21:00 at the latest.' }
  const match = f.when.match
  const ev = events
    .filter((e) => !e.allDay && Date.parse(e.end) > now.getTime() && new Date(e.start).toDateString() === now.toDateString())
    .map((e) => ({ e, s: similarity(match, e.title) }))
    .filter((x) => x.s >= 0.6)
    .sort((a, b) => b.s - a.s || Date.parse(a.e.start) - Date.parse(b.e.start))[0]?.e
  if (!ev) return null
  const end = new Date(ev.end)
  return { at: end.toISOString(), words: `after ${ev.title} (${pad(end.getHours())}:${pad(end.getMinutes())})` }
}

export interface Signals {
  now: Date
  /** When the desktop app last said it is on (ms), if it ever did. */
  deskAt?: number | null
  /** When the newest workout today was logged, ms. */
  workoutAt?: number | null
}

export const AWAY_MS = 2 * 3600_000

/**
 * Smart reminders whose moment came: their time moves to now, so the usual
 * reminder sending picks them up. "Home": the desktop app had gone quiet for
 * 2+ hours and is back now (each tick keeps the last time it was seen). Others
 * stay at their latest time.
 */
export function armSmart(list: SmartReminder[], s: Signals): SmartReminder[] {
  const now = s.now.getTime()
  return list.map((r) => {
    if (r.done || !r.when || Date.parse(r.at) <= now) return r
    const made = Date.parse(r.createdAt)
    if (r.when.kind === 'workout') return s.workoutAt != null && s.workoutAt > made ? { ...r, at: new Date(now).toISOString() } : r
    if (r.when.kind !== 'home' || s.deskAt == null) return r
    const seen = r.when.seen
    if (seen == null) return { ...r, when: { ...r.when, seen: s.deskAt } }
    const back = s.deskAt - seen >= AWAY_MS && now - s.deskAt < 20 * 60_000 && s.deskAt > made
    if (back) return { ...r, at: new Date(now).toISOString(), when: { ...r.when, seen: s.deskAt } }
    return s.deskAt > seen ? { ...r, when: { ...r.when, seen: s.deskAt } } : r
  })
}
