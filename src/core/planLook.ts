// How a plan block looks in Google Calendar, and how the app keeps exactly one
// event per block. Pure and tested in planLook.test.ts.
//
// - Look: each block gets a kind (deep work, study, chores, sport, break,
//   meal) from its plan kind and its words; the kind gives the event an emoji
//   in front of its title and one of Google's event colours (colorId).
// - One event per block: the event's id is made from the day and the block's
//   id (`planEventId`), so writing the same block twice (the approval and the
//   plan editor at the same moment, a second tap, another device) lands on the
//   same event instead of making a second one.
// - Clean-up: `appDuplicates` finds copies the app itself made today (same
//   title, start and end, marked as made by Life System) and never touches
//   events you made yourself.
import type { CalEvent } from './dayTime'

export type LookKind = 'deep' | 'study' | 'chores' | 'sport' | 'break' | 'meal'

export interface BlockLook {
  kind: LookKind
  emoji: string
  /** Google Calendar's event colour id ("1"–"11"). */
  colorId: string
}

/**
 * Google's palette: 1 Lavender, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana,
 * 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato.
 */
export const LOOKS: Record<LookKind, BlockLook> = {
  deep: { kind: 'deep', emoji: '🎯', colorId: '9' },
  study: { kind: 'study', emoji: '📚', colorId: '7' },
  chores: { kind: 'chores', emoji: '🧹', colorId: '5' },
  sport: { kind: 'sport', emoji: '💪', colorId: '10' },
  break: { kind: 'break', emoji: '☕', colorId: '2' },
  meal: { kind: 'meal', emoji: '🍽️', colorId: '6' }
}

const SPORT = /\b(workout|training|train|gym|run|running|jog|sport|stretch|yoga|swim|bike|cycling|push-?ups?|squats?|lift)\b/i
const BREAK = /\b(break|pause|rest|walk|nap|breather|recharge)\b/i
const MEAL = /\b(lunch|dinner|breakfast|brunch|meal|eat|snack|cook)\b/i
const CHORES = /\b(quick tasks?|chores?|clean|tidy|laundry|dishes|errands?|shopping|groceries|admin|emails?|inbox|bills?|pay)\b/i
const STUDY = /\b(study|learn|revise|revision|exam|homework|lecture|course|chapter|flashcards?|read|reading|notes|practice|essay|thesis)\b/i

/** A block's look from its plan kind and its title. */
export function blockLook(title: string, kind?: string | null, train = false): BlockLook {
  const t = title.replace(LEAD, '')
  if (train || SPORT.test(t)) return LOOKS.sport
  if (MEAL.test(t)) return LOOKS.meal
  if (BREAK.test(t)) return LOOKS.break
  if (kind === 'quick' || CHORES.test(t)) return LOOKS.chores
  if (kind === 'goal' || STUDY.test(t)) return LOOKS.study
  return LOOKS.deep
}

/** Any emoji (with its variation mark) and the spaces after it at the start of a title. */
const LEAD = /^(?:\p{Extended_Pictographic}️?‍?)+\s*/u

/** The event's title: the kind's emoji in front (a title that already starts with an emoji keeps it). */
export function lookTitle(title: string, kind?: string | null, train = false): string {
  const t = title.trim()
  if (LEAD.test(t)) return t
  return `${blockLook(t, kind, train).emoji} ${t}`
}

/** The block's own title from an event title (the emoji the app put in front taken off). */
export function plainTitle(title: string): string {
  return title.replace(LEAD, '').trim()
}

/** Same block title, with or without the emoji in front. */
export const sameTitle = (a: string, b: string) => plainTitle(a) === plainTitle(b)

function fnv(s: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * The Google event id for a block: the same day and block always give the
 * same id. Google takes ids of 5–1024 characters from a–v and 0–9, so this is
 * "ls", the day's digits and 16 hex digits.
 */
export function planEventId(day: string, blockId: string): string {
  const k = `${day}|${blockId}`
  const a = fnv(k, 2166136261).toString(16).padStart(8, '0')
  const b = fnv(k, 0x9e3779b9).toString(16).padStart(8, '0')
  return `ls${day.replace(/\D/g, '')}${a}${b}`
}

/**
 * Copies the app made of the same block (same title, start and end, all marked
 * as made by Life System): every one but the one to keep. The one kept is the
 * event a plan block already points at, else the first. Events you made
 * yourself (not marked) are never in the list.
 */
export function appDuplicates(events: CalEvent[], keep: Set<string> = new Set()): CalEvent[] {
  const groups = new Map<string, CalEvent[]>()
  for (const e of events) {
    if (!e.ours || e.allDay || e.recurringEventId) continue
    const k = `${e.calendarId}|${plainTitle(e.title)}|${Date.parse(e.start)}|${Date.parse(e.end)}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  const out: CalEvent[] = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const kept = list.find((e) => keep.has(e.id)) ?? list[0]
    for (const e of list) if (e !== kept && !keep.has(e.id)) out.push(e)
  }
  return out
}
