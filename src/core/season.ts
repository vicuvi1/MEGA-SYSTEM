// Seasons (LF1): life in named 8-week story arcs. Each season has a theme,
// three main quests (linked to goals or ticked by hand) and a final "boss":
// a real test on a real day (an exam, a CTF, a fitness test). The boss's HP
// is how ready you are: finishing quests, perfect daily-quest days and the
// XP you earn this season wear it down, but the last blow is always the real
// thing, so it never reads as beaten before you actually did it.
// Pure: no DOM, no database. Stored in the synced setting `saga_seasons`.
import { addDays, daysBetween } from './dates'

export const SEASON_WEEKS = 8
export const SEASON_DAYS = SEASON_WEEKS * 7
export const SEASONS_MAX = 24
/** The HP only the real boss fight can take: preparation stops here. */
export const FINAL_BLOW = 10
export const BOSS_HP = 100

export type BossKind = 'exam' | 'ctf' | 'fitness' | 'project' | 'other'
export const BOSS_KINDS: { id: BossKind; label: string; icon: string }[] = [
  { id: 'exam', label: 'An exam', icon: '📜' },
  { id: 'ctf', label: 'A CTF', icon: '🚩' },
  { id: 'fitness', label: 'A fitness test', icon: '💪' },
  { id: 'project', label: 'A launch or project', icon: '🚀' },
  { id: 'other', label: 'Something else', icon: '⚔️' }
]

export interface MainQuest {
  id: string
  title: string
  /** A measurable goal (focus_goals id) whose progress this quest follows. */
  goalId: number | null
  /** A vision card it serves (LF4), or null. */
  cardId: string | null
  /** Done by hand (the day), for quests without a goal. */
  done: string | null
}

export interface Boss {
  title: string
  kind: BossKind
  /** The day of the real fight (inside the season, usually its last week). */
  day: string
  /** What happened on the day: only you can say. */
  result: 'won' | 'lost' | null
  resultDay: string | null
}

export interface Season {
  id: string
  name: string
  theme: string
  /** A wallpaper picture id used as the cover art (src/core/wallpaper.ts). */
  cover: string
  /** The season's colour (a hex). */
  color: string
  /** The life area it grew out of (life wheel), or null. */
  area: string | null
  /** First day (a Monday). */
  start: string
  quests: MainQuest[]
  boss: Boss
  /** Closed early or after the recap. */
  closed: string | null
}

export interface SeasonBook {
  seasons: Season[]
}

export const EMPTY_SEASONS: SeasonBook = { seasons: [] }

/** Ready-made season themes, one per life-wheel area (used by "suggest a theme"). */
export interface SeasonTheme {
  id: string
  area: string
  name: string
  theme: string
  cover: string
  color: string
  boss: { title: string; kind: BossKind }
  quests: string[]
}

export const SEASON_THEMES: SeasonTheme[] = [
  { id: 'iron', area: 'body', name: 'The Iron Path', theme: 'Forge a body that keeps up with your mind.', cover: 'dojo-dawn', color: '#ff9f43', boss: { title: 'Fitness test: 50 push-ups in one go', kind: 'fitness' }, quests: ['Train 3 times a week', 'Sleep before midnight', 'Walk 8,000 steps a day'] },
  { id: 'shadow', area: 'career', name: 'Shadow Code', theme: 'Become the hacker you keep reading about.', cover: 'neon-rain', color: '#ff3ea5', boss: { title: 'Finish a weekend CTF in the top half', kind: 'ctf' }, quests: ['Solve 20 practice boxes', 'Write up every solve', 'Ship one security tool'] },
  { id: 'temple', area: 'faith', name: 'The Quiet Temple', theme: 'Make faith the steady centre of the day.', cover: 'torii-mist', color: '#d0442c', boss: { title: 'A full month without missing the daily practice', kind: 'other' }, quests: ['Daily practice on time', 'Read a little every day', 'One act of service a week'] },
  { id: 'clan', area: 'family', name: 'The Clan', theme: 'Show up for the people who raised you.', cover: 'sakura-hill', color: '#ec8db0', boss: { title: 'Plan and host a family day', kind: 'project' }, quests: ['Call home twice a week', 'One family meal a week', 'Help with one real problem'] },
  { id: 'bonds', area: 'friends', name: 'Bonds of the Road', theme: 'Fewer screens, more people.', cover: 'train-crossing', color: '#ff9a6a', boss: { title: 'Organise a trip with friends', kind: 'project' }, quests: ['Meet a friend every week', 'Reach out to one old friend', 'Join one group or club'] },
  { id: 'library', area: 'mind', name: 'The Night Library', theme: 'Read, think and learn on purpose.', cover: 'lofi-room', color: '#ffb066', boss: { title: 'Pass the end-of-term exam', kind: 'exam' }, quests: ['Study 2 focused blocks a day', 'Finish 2 books', 'Teach one topic to someone'] },
  { id: 'gold', area: 'money', name: 'The Gold Road', theme: 'Every lei with a job, savings that grow.', cover: 'katana-sun', color: '#f5c84b', boss: { title: 'Hit the savings target', kind: 'project' }, quests: ['Log every spend', 'Cook at home 4 days a week', 'Find one new income stream'] },
  { id: 'wanderer', area: 'fun', name: 'The Wanderer', theme: 'Collect real adventures, not just scrolls.', cover: 'floating-island', color: '#3b8fe8', boss: { title: 'A cheap trip somewhere new', kind: 'other' }, quests: ['One side quest every week', 'Learn a fun skill', 'Phone-free Sunday'] },
  { id: 'starfall', area: 'career', name: 'Starfall', theme: 'Ship the thing that changes your next year.', cover: 'twin-suns', color: '#f4c27c', boss: { title: 'Launch day', kind: 'project' }, quests: ['Build every weekday', 'Show it to 10 people', 'Fix the top 5 problems they find'] }
]

export const CHAPTERS = ['The Call', 'First Steps', 'Training Arc', 'The Trial', 'Turning Point', 'Darkest Hour', 'The Climb', 'Final Battle']

const DAY = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d)
const day = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v : null)

/** The Monday of the week holding `d` (or `d` itself on a Monday). */
export function mondayOf(d: string): string {
  const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
  return addDays(d, -((wd + 6) % 7))
}

/** The next Monday after `d` (today when it is a Monday and `allowToday`). */
export function nextMonday(d: string, allowToday = true): string {
  const m = mondayOf(d)
  return allowToday && m === d ? d : addDays(m, 7)
}

export const seasonEnd = (s: Pick<Season, 'start'>): string => addDays(s.start, SEASON_DAYS - 1)

function cleanQuest(q: any, i: number): MainQuest | null {
  const title = str(q?.title, 80)
  if (!title) return null
  const gid = Number(q?.goalId)
  return { id: str(q?.id, 24) || `q${i + 1}`, title, goalId: Number.isInteger(gid) && gid > 0 ? gid : null, cardId: q?.cardId ? str(q.cardId, 24) : null, done: day(q?.done) }
}

export function cleanSeason(raw: unknown): Season | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const name = str(r.name, 48)
  const start = day(r.start)
  if (!name || !start) return null
  const b = (r.boss && typeof r.boss === 'object' ? r.boss : {}) as Record<string, any>
  const kind: BossKind = BOSS_KINDS.some((k) => k.id === b.kind) ? b.kind : 'other'
  const end = seasonEnd({ start })
  let bossDay = day(b.day) ?? addDays(start, SEASON_DAYS - 2)
  if (bossDay < start) bossDay = start
  if (bossDay > end) bossDay = end
  const quests = (Array.isArray(r.quests) ? r.quests : []).map(cleanQuest).filter((q): q is MainQuest => !!q).slice(0, 3)
  return {
    id: str(r.id, 24) || `s${start.replace(/-/g, '')}`,
    name,
    theme: str(r.theme, 160),
    cover: str(r.cover, 32) || 'ronin-moon',
    color: hex(r.color, '#c8f135'),
    area: r.area ? str(r.area, 16) : null,
    start,
    quests,
    boss: { title: str(b.title, 80) || 'The final test', kind, day: bossDay, result: b.result === 'won' || b.result === 'lost' ? b.result : null, resultDay: day(b.resultDay) },
    closed: day(r.closed)
  }
}

export function cleanSeasonBook(raw: unknown): SeasonBook {
  const list = Array.isArray((raw as any)?.seasons) ? (raw as any).seasons : []
  const seen = new Set<string>()
  const seasons = list
    .map(cleanSeason)
    .filter((s: Season | null): s is Season => !!s && !seen.has(s.id) && !!seen.add(s.id))
    .sort((a: Season, b: Season) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  return { seasons: seasons.slice(-SEASONS_MAX) }
}

/** A new season from a theme (or your own words), starting on `start`. */
export function newSeason(p: { name: string; theme?: string; cover?: string; color?: string; area?: string | null; start: string; quests?: string[]; boss?: { title: string; kind: BossKind; day?: string } }, id?: string): Season {
  const start = mondayOf(p.start)
  const s = cleanSeason({
    id: id ?? `s${start.replace(/-/g, '')}`,
    name: p.name,
    theme: p.theme ?? '',
    cover: p.cover,
    color: p.color,
    area: p.area ?? null,
    start,
    quests: (p.quests ?? []).slice(0, 3).map((title, i) => ({ id: `q${i + 1}`, title })),
    boss: { title: p.boss?.title ?? 'The final test', kind: p.boss?.kind ?? 'other', day: p.boss?.day ?? addDays(start, SEASON_DAYS - 2) }
  })
  if (!s) throw new Error('A season needs a name')
  return s
}

/** The season you are in (or the latest one that hasn't been closed), else null. */
export function currentSeason(book: SeasonBook, today: string): Season | null {
  const open = book.seasons.filter((s) => !s.closed && s.start <= addDays(today, 7))
  const inside = open.filter((s) => s.start <= today && today <= seasonEnd(s))
  if (inside.length) return inside[inside.length - 1]
  // A season starting next week, or one that just ended and waits for its recap.
  return open.length ? open[open.length - 1] : null
}

/** Seasons finished: closed, or past their last day. */
export function finishedSeasons(book: SeasonBook, today: string): Season[] {
  return book.seasons.filter((s) => s.closed || seasonEnd(s) < today)
}

export interface SeasonProgress {
  phase: 'before' | 'active' | 'boss-week' | 'over'
  /** 1..8 (0 before the start, 8 after the end). */
  week: number
  chapter: string
  dayIndex: number
  daysLeft: number
  /** Share of the season's time gone, 0..1. */
  time: number
  daysToBoss: number
}

export function seasonProgress(s: Season, today: string): SeasonProgress {
  const end = seasonEnd(s)
  const idx = daysBetween(s.start, today)
  const daysToBoss = daysBetween(today, s.boss.day)
  if (idx < 0) return { phase: 'before', week: 0, chapter: 'Coming soon', dayIndex: idx, daysLeft: SEASON_DAYS, time: 0, daysToBoss }
  if (today > end || s.closed) return { phase: 'over', week: SEASON_WEEKS, chapter: 'The end', dayIndex: Math.min(idx, SEASON_DAYS - 1), daysLeft: 0, time: 1, daysToBoss }
  const week = Math.floor(idx / 7) + 1
  return { phase: week === SEASON_WEEKS || daysToBoss <= 6 ? 'boss-week' : 'active', week, chapter: CHAPTERS[week - 1], dayIndex: idx, daysLeft: daysBetween(today, end) + 1, time: (idx + 1) / SEASON_DAYS, daysToBoss }
}

/** What wears the boss down (all of it measured, none of it typed in as HP). */
export interface BossInput {
  /** Each main quest's progress, 0..100 (a linked goal's %, or 100 when ticked). */
  questPcts: number[]
  /** Days in the season with all three daily quests done (the quest bonus claimed). */
  perfectDays: number
  /** XP earned since the season started. */
  xp: number
}

export const BOSS_WEIGHTS = { quests: 55, perfectDays: 20, xp: 15 }
/** 20 perfect days and 2,000 XP max out their parts. */
export const BOSS_TARGETS = { perfectDays: 20, xp: 2000 }

export interface BossState {
  hp: number
  max: number
  /** The hits so far, biggest first ("Main quests −31"). */
  hits: { id: 'quests' | 'days' | 'xp'; label: string; hp: number }[]
  /** Only the real fight is left (preparation can do no more). */
  ready: boolean
  result: Boss['result']
}

/** The boss's HP: 100 minus the hits from quests, perfect days and XP; never below the final blow until you win. */
export function bossHp(s: Season, input: BossInput): BossState {
  if (s.boss.result === 'won') return { hp: 0, max: BOSS_HP, hits: [], ready: true, result: 'won' }
  const qs = input.questPcts.slice(0, 3)
  while (qs.length < 3) qs.push(0)
  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0)
  const quests = (qs.reduce((t, p) => t + clamp01(p / 100), 0) / 3) * BOSS_WEIGHTS.quests
  const days = clamp01(input.perfectDays / BOSS_TARGETS.perfectDays) * BOSS_WEIGHTS.perfectDays
  const xp = clamp01(input.xp / BOSS_TARGETS.xp) * BOSS_WEIGHTS.xp
  const hits = [
    { id: 'quests' as const, label: 'Main quests', hp: Math.round(quests) },
    { id: 'days' as const, label: 'Perfect quest days', hp: Math.round(days) },
    { id: 'xp' as const, label: 'XP this season', hp: Math.round(xp) }
  ]
    .filter((h) => h.hp > 0)
    .sort((a, b) => b.hp - a.hp)
  const dealt = hits.reduce((t, h) => t + h.hp, 0)
  const hp = Math.max(FINAL_BLOW, BOSS_HP - dealt)
  return { hp, max: BOSS_HP, hits, ready: hp <= FINAL_BLOW, result: s.boss.result }
}

/** A quest's progress from its goal's % (or its tick). */
export function questPct(q: MainQuest, goalPct: (id: number) => number | null): number {
  if (q.done) return 100
  if (q.goalId != null) {
    const p = goalPct(q.goalId)
    return p == null ? 0 : Math.max(0, Math.min(100, p))
  }
  return 0
}

/** The season moments worth a cinematic (each id plays once). */
export interface SeasonMoment {
  id: string
  kind: 'season-start' | 'season-half' | 'boss-ready' | 'boss-won' | 'season-end'
  title: string
  sub: string
}

export function seasonMoments(s: Season, p: SeasonProgress, boss: BossState): SeasonMoment[] {
  const out: SeasonMoment[] = []
  if (p.phase === 'before') return out
  out.push({ id: `season:${s.id}:start`, kind: 'season-start', title: s.name, sub: s.theme || 'A new season begins' })
  if (p.week >= 5) out.push({ id: `season:${s.id}:half`, kind: 'season-half', title: 'Halfway', sub: `${s.name} · chapter ${p.week}: ${p.chapter}` })
  if (boss.ready && !boss.result) out.push({ id: `season:${s.id}:ready`, kind: 'boss-ready', title: 'The boss is weak', sub: `Only the real fight is left: ${s.boss.title}` })
  if (boss.result === 'won') out.push({ id: `season:${s.id}:won`, kind: 'boss-won', title: 'Boss defeated', sub: s.boss.title })
  return out
}

export interface SeasonRecap {
  name: string
  weeks: number
  questsDone: number
  questsTotal: number
  perfectDays: number
  xp: number
  boss: Boss['result']
  bossTitle: string
  /** One line per highlight, plain words. */
  lines: string[]
  /** "Legend", "Hero", "Survivor": how the arc ended. */
  verdict: string
}

export function seasonRecap(s: Season, input: BossInput & { workouts?: number; focusHours?: number; adventures?: number }, today: string): SeasonRecap {
  const pcts = input.questPcts.slice(0, s.quests.length)
  const questsDone = pcts.filter((p) => p >= 100).length
  const weeks = Math.min(SEASON_WEEKS, Math.max(0, Math.ceil((Math.min(daysBetween(s.start, today), SEASON_DAYS - 1) + 1) / 7)))
  const lines = [
    `${questsDone} of ${s.quests.length} main quests done`,
    `${input.perfectDays} perfect daily-quest days`,
    `${input.xp.toLocaleString('en-GB')} XP earned`,
    input.workouts ? `${input.workouts} workouts` : '',
    input.focusHours ? `${Math.round(input.focusHours)} h of focus` : '',
    input.adventures ? `${input.adventures} side quest${input.adventures === 1 ? '' : 's'} lived` : '',
    s.boss.result === 'won' ? `Boss defeated: ${s.boss.title}` : s.boss.result === 'lost' ? `The boss won this time: ${s.boss.title}. Rematch next season.` : `Boss not fought yet: ${s.boss.title}`
  ].filter(Boolean)
  const score = questsDone * 2 + (s.boss.result === 'won' ? 3 : 0) + Math.min(2, Math.floor(input.perfectDays / 10))
  const verdict = score >= 8 ? 'Legend' : score >= 5 ? 'Hero' : score >= 2 ? 'Survivor' : 'Wanderer'
  return { name: s.name, weeks, questsDone, questsTotal: s.quests.length, perfectDays: input.perfectDays, xp: input.xp, boss: s.boss.result, bossTitle: s.boss.title, lines, verdict }
}

/** One line for Ben's prompt (empty without a season). */
export function seasonLine(s: Season | null, p: SeasonProgress | null, boss: BossState | null, questPcts: number[] = []): string {
  if (!s || !p || !boss) return ''
  if (p.phase === 'before') return `Season "${s.name}" starts ${s.start} (theme: ${s.theme}).`
  const qs = s.quests.map((q, i) => `${q.title} ${Math.round(questPcts[i] ?? 0)}%`).join('; ')
  return `Season "${s.name}" (8-week arc, theme: ${s.theme}): week ${p.week} "${p.chapter}", ${p.daysLeft} days left. Main quests: ${qs || 'none set'}. Boss: ${s.boss.title} on ${s.boss.day} (${boss.result === 'won' ? 'DEFEATED' : boss.result === 'lost' ? 'lost this time' : `HP ${boss.hp}/${boss.max}${boss.ready ? ', only the real fight left' : ''}`}). Talk about his effort as chapters of this arc when it fits; never invent progress.`
}
