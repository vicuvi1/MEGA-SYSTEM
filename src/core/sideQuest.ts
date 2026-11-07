// The weekly side quest (LF5): one small offline adventure a week, picked to
// fit the fun money left, the weather (when the weather plugin has data) and
// the free evenings. "Did it" adds it to your Adventures: a list and a drawn
// trail map that grows one stop per adventure. Photos stay on the device.
// No points: the memory is the reward. Pure; stored in `saga_side`.
import { addDays } from './dates'
import { mondayOf } from './season'

export type QuestWhen = 'evening' | 'morning' | 'day'
export type QuestTag = 'nature' | 'social' | 'food' | 'faith' | 'learn' | 'body' | 'culture' | 'calm'

export interface SideQuestDef {
  id: string
  title: string
  emoji: string
  /** About how much it costs, in lei. */
  cost: number
  minutes: number
  when: QuestWhen
  outdoor: boolean
  tags: QuestTag[]
  /** One short tip. */
  tip: string
}

export const SIDE_QUESTS: SideQuestDef[] = [
  { id: 'cafe', title: "Try a café you've never been to", emoji: '☕', cost: 60, minutes: 60, when: 'evening', outdoor: false, tags: ['food', 'calm'], tip: 'Bring a notebook, not the laptop.' },
  { id: 'sunrise', title: 'Sunrise walk to the highest point nearby', emoji: '🌅', cost: 0, minutes: 75, when: 'morning', outdoor: true, tags: ['nature', 'body', 'calm'], tip: 'Leave 30 min before sunrise; take tea in a flask.' },
  { id: 'mosque', title: "Pray in a mosque you've never visited", emoji: '🕌', cost: 0, minutes: 60, when: 'day', outdoor: false, tags: ['faith', 'calm'], tip: 'Go for one prayer and stay ten minutes after.' },
  { id: 'meetup', title: 'Go to a tech meetup or a CTF night', emoji: '🚩', cost: 0, minutes: 150, when: 'evening', outdoor: false, tags: ['learn', 'social'], tip: 'Ask one person what they are working on.' },
  { id: 'daytrip', title: 'Cheap day trip to a town you have never seen', emoji: '🚆', cost: 180, minutes: 480, when: 'day', outdoor: true, tags: ['culture', 'nature'], tip: 'Take the earliest bus; eat where the locals eat.' },
  { id: 'cook', title: 'Cook a dish from a country you have never tasted', emoji: '🍜', cost: 90, minutes: 90, when: 'evening', outdoor: false, tags: ['food', 'learn'], tip: 'Pick one with five ingredients or fewer.' },
  { id: 'museum', title: 'Museum or gallery you keep walking past', emoji: '🏛️', cost: 40, minutes: 120, when: 'day', outdoor: false, tags: ['culture', 'learn'], tip: 'Pick one room and read every label in it.' },
  { id: 'lake', title: 'Bike or walk to a lake and back', emoji: '🚲', cost: 0, minutes: 150, when: 'day', outdoor: true, tags: ['nature', 'body'], tip: 'Water, a snack, phone on silent.' },
  { id: 'boardgame', title: 'Board-game evening with a friend', emoji: '🎲', cost: 70, minutes: 150, when: 'evening', outdoor: false, tags: ['social'], tip: 'Invite the friend you have not seen the longest.' },
  { id: 'library', title: 'An afternoon in a library you have never used', emoji: '📚', cost: 0, minutes: 150, when: 'day', outdoor: false, tags: ['learn', 'calm'], tip: 'Read something outside your field for one hour.' },
  { id: 'stars', title: 'Stargazing outside the city lights', emoji: '🌌', cost: 30, minutes: 120, when: 'evening', outdoor: true, tags: ['nature', 'calm'], tip: 'Clear night, warm jacket, a star map app in red mode.' },
  { id: 'climb', title: 'A taster session at a climbing gym', emoji: '🧗', cost: 120, minutes: 120, when: 'evening', outdoor: false, tags: ['body', 'social'], tip: 'Book the beginner slot; they lend the shoes.' },
  { id: 'volunteer', title: 'Volunteer for one hour', emoji: '🤲', cost: 0, minutes: 90, when: 'day', outdoor: false, tags: ['social', 'faith'], tip: 'A food bank or an animal shelter is an easy start.' },
  { id: 'oldfriend', title: 'Meet an old friend for tea', emoji: '🫖', cost: 40, minutes: 90, when: 'evening', outdoor: false, tags: ['social'], tip: 'Message them today; suggest a day, not "sometime".' },
  { id: 'photowalk', title: 'Photo walk: 10 photos of one colour', emoji: '📷', cost: 0, minutes: 60, when: 'day', outdoor: true, tags: ['culture', 'calm'], tip: 'Pick the colour before you leave.' },
  { id: 'market', title: 'Saturday morning at the open-air market', emoji: '🧺', cost: 60, minutes: 75, when: 'morning', outdoor: true, tags: ['food', 'culture'], tip: 'Buy one fruit you have never tried.' },
  { id: 'swim', title: 'Swim at a public pool', emoji: '🏊', cost: 60, minutes: 75, when: 'evening', outdoor: false, tags: ['body'], tip: 'Ten lengths, then just float for five minutes.' },
  { id: 'sunset', title: 'Watch the sunset from a hill or rooftop', emoji: '🌇', cost: 0, minutes: 60, when: 'evening', outdoor: true, tags: ['nature', 'calm'], tip: 'Arrive 20 minutes early; no phone for the last 10.' },
  { id: 'class', title: 'Try one class of a sport you have never done', emoji: '🥋', cost: 100, minutes: 90, when: 'evening', outdoor: false, tags: ['body', 'learn'], tip: 'Tell the coach it is your first time.' },
  { id: 'picnic', title: 'Picnic in a park you rarely go to', emoji: '🧃', cost: 60, minutes: 120, when: 'day', outdoor: true, tags: ['nature', 'social', 'food'], tip: 'Bring a friend or a book. Or both.' },
  { id: 'bookshop', title: 'Browse a second-hand bookshop, buy one book', emoji: '📖', cost: 50, minutes: 60, when: 'day', outdoor: false, tags: ['learn', 'calm'], tip: 'Pick it by the first page, not the cover.' },
  { id: 'monument', title: 'Visit a monument and learn its story', emoji: '🗿', cost: 0, minutes: 60, when: 'day', outdoor: true, tags: ['culture', 'learn'], tip: 'Read about it on the spot, not before.' },
  { id: 'newroute', title: 'Walk a route in your city you have never walked', emoji: '🧭', cost: 0, minutes: 60, when: 'evening', outdoor: true, tags: ['body', 'calm'], tip: 'Turn left whenever you are unsure.' },
  { id: 'workshop', title: 'A hands-on workshop (pottery, wood, a repair café)', emoji: '🏺', cost: 150, minutes: 150, when: 'day', outdoor: false, tags: ['learn', 'social'], tip: 'Make something small you can keep on the desk.' },
  { id: 'hike', title: 'A short hike on a marked trail', emoji: '🥾', cost: 40, minutes: 240, when: 'day', outdoor: true, tags: ['nature', 'body'], tip: 'Check the trail length; turn back at half your energy.' },
  { id: 'concert', title: 'A free concert or open-mic night', emoji: '🎻', cost: 0, minutes: 120, when: 'evening', outdoor: false, tags: ['culture', 'social'], tip: 'Sit near the front.' },
  { id: 'teahouse', title: 'Tea ceremony or a quiet teahouse', emoji: '🍵', cost: 70, minutes: 75, when: 'evening', outdoor: false, tags: ['calm', 'culture'], tip: 'Order the one you cannot pronounce.' },
  { id: 'nightwalk', title: 'Night walk by the river with music off', emoji: '🌉', cost: 0, minutes: 45, when: 'evening', outdoor: true, tags: ['calm', 'nature'], tip: 'Listen for five different sounds.' }
]

export type Weather = 'clear' | 'rain' | 'cold' | null

export interface PickInput {
  /** The Monday of the week (the pick is the same all week). */
  week: string
  /** Fun money left this month (lei), null when unknown. */
  budget: number | null
  /** The weekend's weather (null without the weather plugin). */
  weather: Weather
  /** Evenings this week with nothing in the calendar after 18:00 (null: unknown). */
  freeEvenings: number | null
  /** Is a weekend day mostly free? (null: unknown) */
  freeDay: boolean | null
  /** Quests done in the last 8 weeks (not suggested again). */
  recent: string[]
  /** Quests passed on this week ("Another one"). */
  passed: string[]
}

function hash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** Why a quest doesn't fit this week (null when it does). */
export function unfit(q: SideQuestDef, i: PickInput): string | null {
  if (i.budget != null && q.cost > Math.max(0, i.budget) * 0.5) return 'over budget'
  if (q.outdoor && i.weather === 'rain') return 'rain'
  if (q.when === 'evening' && i.freeEvenings === 0) return 'no free evening'
  if (q.when === 'day' && i.freeDay === false) return 'no free day'
  if (i.recent.includes(q.id)) return 'done lately'
  if (i.passed.includes(q.id)) return 'passed'
  return null
}

export interface SidePick {
  quest: SideQuestDef
  /** "Fits 120 lei of fun money, a dry weekend and your 2 free evenings." */
  why: string
}

/** This week's side quest: the fitting ones in a fixed order for the week; null if nothing fits. */
export function pickSideQuest(i: PickInput, pool: SideQuestDef[] = SIDE_QUESTS): SidePick | null {
  const fits = pool.filter((q) => !unfit(q, i))
  // Cheap, short and calm ones float up when money or time is tight.
  const tight = (i.budget != null && i.budget < 100) || i.freeEvenings === 1
  const ranked = fits
    .map((q) => ({ q, k: hash(`${i.week}:${q.id}`) / 2 ** 32 + (tight && (q.cost > 50 || q.minutes > 120) ? 1 : 0) + (i.weather === 'cold' && q.outdoor ? 0.6 : 0) + (i.weather === 'clear' && q.outdoor ? -0.3 : 0) }))
    .sort((a, b) => a.k - b.k)
  const q = ranked[0]?.q
  if (!q) return null
  const bits = [
    q.cost === 0 ? 'costs nothing' : i.budget != null ? `about ${q.cost} lei of your ${Math.max(0, Math.round(i.budget))} lei fun money` : `about ${q.cost} lei`,
    i.weather === 'clear' && q.outdoor ? 'a dry weekend' : i.weather === 'rain' && !q.outdoor ? 'indoors, away from the rain' : '',
    q.when === 'evening' && i.freeEvenings ? `your ${i.freeEvenings} free evening${i.freeEvenings === 1 ? '' : 's'}` : q.when === 'day' && i.freeDay ? 'a free weekend day' : q.when === 'morning' ? 'one early morning' : ''
  ].filter(Boolean)
  return { quest: q, why: `Fits: ${bits.join(', ')}.` }
}

export interface Adventure {
  id: string
  questId: string | null
  title: string
  emoji: string
  day: string
  place: string
  note: string
  /** A photo is on this device (never synced). */
  photo: boolean
}

export interface SideBook {
  /** Week (its Monday) → what happened with that week's quest. */
  weeks: Record<string, { passed: string[]; status: 'open' | 'done' | 'skipped' }>
  log: Adventure[]
}

export const EMPTY_SIDE: SideBook = { weeks: {}, log: [] }
const DAY = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export function cleanSide(raw: unknown): SideBook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const weeks: SideBook['weeks'] = {}
  for (const k of Object.keys(r.weeks && typeof r.weeks === 'object' ? r.weeks : {}).filter((k) => DAY.test(k)).sort().slice(-26)) {
    const w = r.weeks[k] ?? {}
    weeks[k] = { passed: (Array.isArray(w.passed) ? w.passed : []).map((x: unknown) => str(x, 24)).filter(Boolean).slice(0, 10), status: w.status === 'done' || w.status === 'skipped' ? w.status : 'open' }
  }
  const log: Adventure[] = (Array.isArray(r.log) ? r.log : [])
    .filter((a: any) => a && str(a.title, 90) && DAY.test(String(a.day)))
    .map((a: any, i: number) => ({ id: str(a.id, 24) || `a${i + 1}`, questId: a.questId ? str(a.questId, 24) : null, title: str(a.title, 90), emoji: str(a.emoji, 8) || '🧭', day: String(a.day), place: str(a.place, 60), note: str(a.note, 280), photo: !!a.photo }))
    .sort((a: Adventure, b: Adventure) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .slice(-300)
  return { weeks, log }
}

/** The quests done in the 8 weeks before `today` (not suggested again yet). */
export function recentQuests(book: SideBook, today: string): string[] {
  const from = addDays(today, -56)
  return book.log.filter((a) => a.questId && a.day >= from).map((a) => a.questId as string)
}

/** The input for this week's pick from the book and the outside facts. */
export function pickInput(book: SideBook, today: string, facts: Pick<PickInput, 'budget' | 'weather' | 'freeEvenings' | 'freeDay'>): PickInput {
  const week = mondayOf(today)
  return { week, ...facts, recent: recentQuests(book, today), passed: book.weeks[week]?.passed ?? [] }
}

export function adventureStats(book: SideBook, today: string): { total: number; thisYear: number; weeksInARow: number; tags: Partial<Record<QuestTag, number>> } {
  const year = today.slice(0, 4)
  const weeksWith = new Set(book.log.map((a) => mondayOf(a.day)))
  let n = 0
  let w = mondayOf(today)
  if (!weeksWith.has(w)) w = addDays(w, -7)
  while (weeksWith.has(w)) {
    n++
    w = addDays(w, -7)
  }
  const tags: Partial<Record<QuestTag, number>> = {}
  for (const a of book.log) {
    const def = SIDE_QUESTS.find((q) => q.id === a.questId)
    for (const t of def?.tags ?? []) tags[t] = (tags[t] ?? 0) + 1
  }
  return { total: book.log.length, thisYear: book.log.filter((a) => a.day.startsWith(year)).length, weeksInARow: n, tags }
}

/**
 * The trail on the Adventures map: stop i of n, as x/y in 0..1. The trail
 * winds left and right as it climbs, so every new adventure is the next stop.
 */
export function trailPoint(i: number, seed = ''): { x: number; y: number } {
  const row = Math.floor(i / 4)
  const col = i % 4
  const lr = row % 2 === 0 ? col : 3 - col
  const jx = ((hash(`${seed}:${i}:x`) % 100) / 100 - 0.5) * 0.08
  const jy = ((hash(`${seed}:${i}:y`) % 100) / 100 - 0.5) * 0.06
  return { x: Math.round((0.14 + lr * 0.24 + jx) * 1000) / 1000, y: Math.round((0.84 - (row % 6) * 0.148 + (col % 2) * 0.04 + jy) * 1000) / 1000 }
}
