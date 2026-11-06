// "Suggested for you" (pure, tested): a starter catalogue of rewards across
// four sizes (small daily treats, weekly, monthly, big goals) and a picker
// that ranks them by what you actually do in the app: the areas that earn you
// the most, the kind of focus you put in (coding, security, study), workouts,
// nights on time, water, music you keep, the fun time you take. Each pick
// comes with one line on why ("You coded 9 h this week: a mechanical keyboard
// fits"). Healthy limits and "unlock by doing" come built in where they help.
import type { Activity } from './rewardActivity'
import { hoursText } from './rewardActivity'
import type { RewardCategory, Tier } from './shop'
import type { Unlock } from './unlocks'
import type { RewardRules } from './rewardGuard'

export const SUGGEST_HIDDEN = 'reward_suggest_hidden'

export type Band = 'daily' | 'weekly' | 'monthly' | 'big'
export const BANDS: Record<Band, { label: string; hint: string; tier: Tier }> = {
  daily: { label: 'Small treat', hint: 'up to 150 points', tier: 'bronze' },
  weekly: { label: 'Weekly', hint: '300–800 points', tier: 'silver' },
  monthly: { label: 'Monthly', hint: '1,000–3,000 points', tier: 'gold' },
  big: { label: 'Big goal', hint: 'save up for it', tier: 'legendary' }
}

export type Tag = 'code' | 'security' | 'study' | 'focus' | 'fitness' | 'sleep' | 'water' | 'music' | 'gaming' | 'rest' | 'social' | 'food'

export interface Starter {
  key: string
  title: string
  emoji: string
  category: RewardCategory
  band: Band
  points: number
  /** A typical real price in lei (made up; you change it when you add it). */
  lei: number
  tags: Tag[]
  note?: string
  cooldownDays?: number
  monthLimit?: number
  oneTime?: boolean
  rules?: RewardRules
  unlock?: Unlock
}

const S = (key: string, title: string, emoji: string, category: RewardCategory, band: Band, points: number, lei: number, tags: Tag[], more: Partial<Starter> = {}): Starter => ({ key, title, emoji, category, band, points, lei, tags, ...more })

/** About 50 starter rewards. Made-up typical prices; yours are what you type. */
export const STARTERS: Starter[] = [
  // Small daily treats (up to 150 points)
  S('snack', 'Favourite snack', '🍫', 'food', 'daily', 60, 25, ['food'], { rules: { perDay: 1 } }),
  S('episode', 'An episode of your show', '📺', 'fun', 'daily', 80, 0, ['rest'], { rules: { perDay: 2 } }),
  S('game30', '30 min of gaming', '🎮', 'fun', 'daily', 45, 0, ['gaming'], { rules: { perDay: 2 } }),
  S('game60', 'An hour of gaming', '🕹️', 'fun', 'daily', 90, 0, ['gaming'], { rules: { perDay: 1, pair: 'focus' }, note: 'After a focus session' }),
  S('coffee', 'A fancy coffee', '☕', 'food', 'daily', 70, 45, ['code', 'study', 'focus'], { rules: { perDay: 1 } }),
  S('bubbletea', 'Bubble tea', '🧋', 'food', 'daily', 90, 55, ['food'], { cooldownDays: 2 }),
  S('podcast', 'Podcast or album while you walk', '🎧', 'fun', 'daily', 40, 0, ['music', 'fitness'], { rules: { perDay: 2, pair: 'move' }, note: 'Only while you walk or train' }),
  S('mask', 'Long shower and a face mask', '🧖', 'selfcare', 'daily', 50, 20, ['rest', 'sleep']),
  S('liein', 'Sleep in an hour on the weekend', '😴', 'selfcare', 'daily', 120, 0, ['sleep'], { cooldownDays: 7, unlock: { kind: 'deed', deed: 'sleepNights', target: 5 } }),
  S('stream', '45 min of videos, no guilt', '📱', 'fun', 'daily', 60, 0, ['rest'], { rules: { perDay: 1 } }),
  S('icecream', 'Ice cream', '🍦', 'food', 'daily', 50, 20, ['fitness', 'food']),
  S('smoothie', 'Smoothie after training', '🥤', 'food', 'daily', 70, 40, ['fitness'], { rules: { perDay: 1, pair: 'workout' } }),
  S('functf', 'A CTF just for fun, no notes', '🚩', 'fun', 'daily', 100, 0, ['security'], { cooldownDays: 3 }),
  S('sticker', 'A sticker for your laptop', '💻', 'gear', 'daily', 60, 30, ['code'], { monthLimit: 2 }),
  S('lofi', 'A new playlist to focus to', '🎶', 'fun', 'daily', 30, 0, ['music', 'focus'], { rules: { perDay: 1 } }),
  // Weekly (300–800)
  S('cinema', 'Cinema night', '🎬', 'experience', 'weekly', 400, 120, ['social', 'rest'], { cooldownDays: 7 }),
  S('takeaway', 'Takeaway dinner', '🥡', 'food', 'weekly', 350, 180, ['food'], { cooldownDays: 5 }),
  S('pizza', 'Pizza night', '🍕', 'food', 'weekly', 300, 150, ['food', 'social'], { cooldownDays: 5 }),
  S('musicsub', 'A month of a music subscription', '🎵', 'fun', 'weekly', 500, 60, ['music'], { monthLimit: 1 }),
  S('album', 'Merch or an album from an artist you love', '💿', 'fun', 'weekly', 450, 150, ['music']),
  S('book', 'A new book', '📚', 'gear', 'weekly', 500, 200, ['study', 'code', 'security']),
  S('module', 'One course module', '🎓', 'gear', 'weekly', 700, 250, ['study', 'code'], { unlock: { kind: 'deed', deed: 'focusHours', target: 6 } }),
  S('techbook', 'A tech book (Linux, Rust, security)', '📘', 'gear', 'weekly', 700, 400, ['code', 'security']),
  S('gamenight', 'A long gaming evening (3 h)', '🎮', 'fun', 'weekly', 350, 0, ['gaming'], { cooldownDays: 6, unlock: { kind: 'deed', deed: 'focusHours', target: 10 }, note: 'Unlocks after 10 h of focus this week' }),
  S('bowling', 'Bowling or billiards with friends', '🎳', 'experience', 'weekly', 500, 200, ['social']),
  S('band', 'Resistance bands or gym gloves', '🏋️', 'gear', 'weekly', 400, 200, ['fitness'], { oneTime: true }),
  S('massage', 'A massage', '💆', 'selfcare', 'weekly', 800, 400, ['fitness', 'sleep'], { cooldownDays: 30, unlock: { kind: 'deed', deed: 'workouts', target: 4 } }),
  S('noalarm', 'A morning without the alarm', '🛌', 'selfcare', 'weekly', 300, 0, ['sleep'], { cooldownDays: 7, unlock: { kind: 'deed', deed: 'sleepNights', target: 5 } }),
  S('brunch', 'Brunch out', '🥞', 'food', 'weekly', 450, 220, ['social', 'food']),
  S('indie', 'DLC or a small indie game', '👾', 'fun', 'weekly', 600, 150, ['gaming'], { unlock: { kind: 'deed', deed: 'workouts', target: 4 } }),
  S('bottle', 'A really good water bottle', '🚰', 'gear', 'weekly', 350, 180, ['water'], { oneTime: true, unlock: { kind: 'deed', deed: 'waterDays', target: 5 } }),
  S('keycaps', 'A new keycap set', '⌨️', 'gear', 'weekly', 650, 350, ['code'], { oneTime: true }),
  // Monthly (1,000–3,000)
  S('newgame', 'A new game', '🎮', 'fun', 'monthly', 1500, 700, ['gaming'], { oneTime: true, unlock: { kind: 'streak', streak: 'workout', days: 7 }, note: 'Unlocks at a 7-day workout streak' }),
  S('headphones', 'New headphones', '🎧', 'gear', 'monthly', 2500, 1200, ['music', 'code'], { oneTime: true }),
  S('keyboard', 'A mechanical keyboard', '⌨️', 'gear', 'monthly', 2200, 1100, ['code'], { oneTime: true, unlock: { kind: 'deed', deed: 'codeHours', target: 10 } }),
  S('gymgear', 'Training shoes or a set of weights', '👟', 'gear', 'monthly', 2000, 1000, ['fitness'], { oneTime: true, unlock: { kind: 'streak', streak: 'workout', days: 14 } }),
  S('ctfsub', 'A month of a hacking lab platform', '🚩', 'gear', 'monthly', 1200, 250, ['security'], { monthLimit: 1 }),
  S('certstep', 'A step towards a certification (save 500 lei)', '🛡️', 'big', 'monthly', 3000, 500, ['security', 'study'], { monthLimit: 1 }),
  S('course', 'A full online course', '🎓', 'gear', 'monthly', 2500, 900, ['study', 'code']),
  S('concert', 'A concert ticket', '🎤', 'experience', 'monthly', 2000, 600, ['music', 'social']),
  S('daytrip', 'A day trip somewhere new', '🚆', 'experience', 'monthly', 1800, 500, ['social', 'rest']),
  S('lamp', 'A good desk lamp or a monitor arm', '💡', 'gear', 'monthly', 1400, 600, ['code', 'study']),
  S('tracker', 'A fitness tracker or smart band', '⌚', 'gear', 'monthly', 2800, 1500, ['fitness', 'sleep'], { oneTime: true }),
  S('sleepkit', 'Sleep kit: blackout mask, earplugs, a good pillow', '🌙', 'selfcare', 'monthly', 1000, 450, ['sleep'], { oneTime: true, unlock: { kind: 'deed', deed: 'sleepNights', target: 5 } }),
  S('spa', 'A spa day', '🧖', 'selfcare', 'monthly', 1600, 700, ['rest']),
  // Big goals (save up; milestones on the way)
  S('laptop', 'New laptop fund', '💻', 'big', 'big', 15000, 18000, ['code', 'security'], { oneTime: true }),
  S('trip', 'A weekend trip', '🏔️', 'big', 'big', 8000, 3000, ['social', 'rest'], { oneTime: true }),
  S('certexam', 'Certification exam fund', '🎖️', 'big', 'big', 12000, 6000, ['security', 'study'], { oneTime: true }),
  S('bike', 'A good bike', '🚲', 'big', 'big', 9000, 5000, ['fitness'], { oneTime: true }),
  S('speakers', 'Studio speakers for your music', '🔊', 'big', 'big', 6000, 2500, ['music'], { oneTime: true }),
  S('pcupgrade', 'A PC upgrade', '🖥️', 'big', 'big', 10000, 7000, ['gaming', 'code'], { oneTime: true }),
  S('festival', 'A music festival ticket', '🎪', 'big', 'big', 5000, 2000, ['music', 'social'], { oneTime: true })
]

export const starterByKey = (key: string): Starter | undefined => STARTERS.find((s) => s.key === key)

// ---------- Why it fits you ----------

interface Signal {
  score: number
  why: string | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** How strongly each kind of reward fits what you did, and the line that says so. */
export function signals(a: Activity): Record<Tag, Signal> {
  const h = (min: number) => min / 60
  const code = a.focusByKind.code
  const sec = a.focusByKind.security
  const study = a.focusByKind.study
  const fit = Math.max(a.workoutsWeek / 4, a.workoutStreak / 7)
  return {
    code: { score: Math.min(1, h(code) / 8), why: code >= 30 ? `You coded ${hoursText(code)} h this week` : null },
    security: { score: Math.min(1, h(sec) / 5), why: sec >= 30 ? `${hoursText(sec)} h of security practice this week` : null },
    study: { score: Math.min(1, h(study) / 6), why: study >= 30 ? `You studied ${hoursText(study)} h this week` : null },
    focus: { score: Math.min(1, h(a.focusMinWeek) / 12), why: a.focusMinWeek >= 60 ? `${hoursText(a.focusMinWeek)} h of focus this week` : null },
    fitness: {
      score: Math.min(1, fit),
      why: a.workoutStreak >= 3 ? `A ${a.workoutStreak}-day workout streak` : a.workoutsWeek > 0 ? `${plural(a.workoutsWeek, 'workout')} this week` : null
    },
    sleep: { score: Math.min(1, a.sleepNights7 / 6), why: a.sleepNights7 >= 3 ? `On time ${a.sleepNights7} of the last 7 nights` : null },
    water: { score: Math.min(1, a.waterDays7 / 6), why: a.waterDays7 >= 3 ? `At your water goal ${a.waterDays7} of the last 7 days` : null },
    music: { score: a.musicSaved > 0 ? Math.min(1, 0.45 + a.musicSaved / 30) : 0.15, why: a.musicSaved > 0 ? `You keep ${plural(a.musicSaved, 'track')} and stations saved` : null },
    gaming: { score: a.funTimesWeek > 0 ? Math.min(1, 0.45 + a.funTimesWeek / 6) : 0.3, why: a.funTimesWeek > 0 ? `You took fun time ${a.funTimesWeek}× this week` : null },
    rest: { score: (a.activeDays7 / 7) * 0.6, why: a.activeDays7 >= 5 ? `Active ${a.activeDays7} of the last 7 days: rest is earned` : null },
    social: { score: 0.25, why: null },
    food: { score: 0.3, why: null }
  }
}

export interface SuggestInput {
  activity: Activity
  balance: number
  perDay: number
  /** Titles of rewards you already have (not removed). */
  have: string[]
  /** Suggestions you said "not for me" to. */
  hidden: string[]
  /** You already save for something (a big goal adds less then). */
  hasGoal: boolean
  /** Fun is running ahead of earning: fun picks step back. */
  funOver?: boolean
  /** How many to show (default 8). */
  limit?: number
  /** Only these starters (e.g. the ones you unlock by doing). */
  only?: (s: Starter) => boolean
}

export interface Suggestion {
  starter: Starter
  score: number
  /** "You coded 9 h this week: a mechanical keyboard fits." */
  reason: string
  /** You could get it now with your points. */
  affordable: boolean
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const lowerFirst = (t: string) => (/^[A-Z](?=[a-z ])/.test(t) ? t[0].toLowerCase() + t.slice(1) : t)
/** A small, stable shuffle per week, so the row changes a little each week. */
function jitter(key: string, week: string): number {
  let h = 2166136261
  for (const ch of `${key}|${week}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

function reasonFor(s: Starter, sig: Record<Tag, Signal>, i: SuggestInput): string {
  const best = s.tags.map((t) => sig[t]).filter((x) => x.why).sort((a, b) => b.score - a.score)[0]
  const t = lowerFirst(s.title)
  if (best?.why) return `${best.why}: ${t} fits.`
  if (s.band === 'big') return i.hasGoal ? 'Something big to save for next.' : 'Something big to save for, with milestones on the way.'
  if (i.balance >= s.points) return 'You can get it today with what you have.'
  const days = i.perDay > 0 ? Math.ceil((s.points - i.balance) / i.perDay) : null
  return days != null && days <= 14 ? `About ${plural(days, 'day')} of your usual earning.` : 'A treat worth working towards.'
}

/** The row: the best fit of each size first, then the next best, at most 2 per kind of reward. */
export function suggest(i: SuggestInput): Suggestion[] {
  const sig = signals(i.activity)
  // Fun already runs ahead of earning: taking more fun time is no reason to suggest more.
  if (i.funOver) sig.gaming = { score: 0.1, why: null }
  const have = new Set(i.have.map(norm))
  const hidden = new Set(i.hidden)
  const limit = i.limit ?? 8
  const scored = STARTERS.filter((s) => !hidden.has(s.key) && !have.has(norm(s.title)) && (!i.only || i.only(s))).map((s) => {
    const fit = Math.max(...s.tags.map((t) => sig[t].score))
    let score = fit
    if (s.points <= i.balance) score += 0.3
    else if (i.perDay > 0 && s.points <= i.balance + i.perDay * 7) score += 0.2
    else if (i.perDay > 0 && s.points <= i.perDay * 40) score += 0.1
    if (s.band === 'big') score += i.hasGoal ? -0.15 : 0.2
    if (i.funOver && s.category === 'fun') score -= 0.35
    if (s.unlock) score += 0.05
    score += jitter(s.key, i.activity.week) * 0.08
    const lead = s.tags.reduce((b, t) => (sig[t].score > sig[b].score ? t : b), s.tags[0])
    return { starter: s, score: Math.round(score * 1000) / 1000, reason: reasonFor(s, sig, i), affordable: s.points <= i.balance, lead }
  })
  scored.sort((a, b) => b.score - a.score)
  const out: (Suggestion & { lead: Tag })[] = []
  const perCat = new Map<string, number>()
  const perLead = new Map<string, number>()
  const take = (x: Suggestion & { lead: Tag }) => {
    out.push(x)
    perCat.set(x.starter.category, (perCat.get(x.starter.category) ?? 0) + 1)
    perLead.set(x.lead, (perLead.get(x.lead) ?? 0) + 1)
  }
  for (const band of Object.keys(BANDS) as Band[]) {
    const x = scored.find((y) => y.starter.band === band)
    if (x && out.length < limit) take(x)
  }
  for (const x of scored) {
    if (out.length >= limit) break
    if (out.includes(x) || (perCat.get(x.starter.category) ?? 0) >= 2 || (perLead.get(x.lead) ?? 0) >= 2) continue
    take(x)
  }
  // Too few left after the variety rules: fill up with the next best.
  for (const x of scored) if (out.length < limit && !out.includes(x)) take(x)
  return out.sort((a, b) => b.score - a.score).map(({ lead: _lead, ...x }) => x)
}

/** What "Add to my rewards" saves (the reward itself; its limits and lock are saved beside it). */
export function starterReward(s: Starter) {
  return {
    title: s.title,
    price: s.points,
    tier: BANDS[s.band].tier,
    realCost: s.lei,
    pinned: false,
    note: s.note ?? null,
    imageUrl: null,
    productUrl: null,
    currency: 'MDL',
    emoji: s.emoji,
    category: s.category,
    cooldownDays: s.cooldownDays ?? 0,
    monthLimit: s.monthLimit ?? 0,
    oneTime: !!s.oneTime,
    bundle: null,
    priceLocked: true
  }
}
