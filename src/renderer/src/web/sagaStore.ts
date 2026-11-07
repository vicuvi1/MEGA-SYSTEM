// The saga's saved records (seasons, vision board, identity lines, side
// quests, wins, life wheel, Ben's arc) and everything worked out from them:
// the Season page's view and the lines Ben reads. No browser code: the
// server's bot bundle uses this too (lifeContext).
import { getSetting, setSetting } from '../../../main/settings'
import { addDays, daysBetween } from '@core/dates'
import { effective, type LedgerEntry } from '@core/ledger'
import { questState } from '@core/quests'
import { hunterDefFor, nextHunterRank } from '@core/levels'
import { bossHp, cleanSeasonBook, currentSeason, finishedSeasons, questPct, seasonEnd, seasonLine, seasonMoments, seasonProgress, seasonRecap, type BossState, type Season, type SeasonBook, type SeasonProgress, type SeasonRecap } from '@core/season'
import { cardOfDay, cleanVision, cleanVisionPhotos, okVisionPhoto, visionLine, type VisionBook, type VisionCard } from '@core/vision'
import { cleanIdentity, identityLine, identityVotes, type ExtraVote, type IdentityBook, type LineVotes } from '@core/identityVotes'
import { adventureStats, cleanSide, pickInput, pickSideQuest, type SidePick, type SideBook, type Weather } from '@core/sideQuest'
import { cleanWins, collectWins, isLowDay, pickWin, winsLine, type Win, type WinsBook } from '@core/winsWall'
import { cleanWheel, suggestTheme, wheelDue, wheelHistory, wheelLine, type WheelBook } from '@core/lifeWheel'
import { arcLine, arcState, cleanArc, newChapter, type ArcBook, type ArcChapter, type ArcMoment, type ArcState } from '@core/benArc'
import { nextCinematic, rankUp, seasonCinematic, type Cinematic } from '@core/levelCine'
import { cleanConvo } from '@core/benConvo'
import type { Services } from './webServices'

export const SAGA_SEASONS = 'saga_seasons'
export const SAGA_VISION = 'saga_vision'
export const SAGA_VISION_PHOTOS = 'saga_vision_photos'
export const SAGA_IDENTITY = 'saga_identity'
export const SAGA_SIDE = 'saga_side'
export const SAGA_WINS = 'saga_wins'
export const SAGA_WHEEL = 'saga_wheel'
export const SAGA_ARC = 'saga_arc'

const read = (db: any, key: string): any => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}
const yearOf = (today: string) => Number(today.slice(0, 4))

export const loadSeasons = (db: any): SeasonBook => cleanSeasonBook(read(db, SAGA_SEASONS))
export const saveSeasons = (db: any, b: SeasonBook) => setSetting(db, SAGA_SEASONS, JSON.stringify(cleanSeasonBook(b)))
export const loadVision = (db: any, today: string): VisionBook => cleanVision(read(db, SAGA_VISION), yearOf(today))
export const saveVision = (db: any, b: VisionBook, today: string) => setSetting(db, SAGA_VISION, JSON.stringify(cleanVision(b, yearOf(today))))
export const loadVisionPhotos = (db: any, cards: VisionCard[]): Record<string, string> => cleanVisionPhotos(read(db, SAGA_VISION_PHOTOS), cards)
export const loadIdentity = (db: any): IdentityBook => cleanIdentity(read(db, SAGA_IDENTITY))
export const saveIdentity = (db: any, b: IdentityBook) => setSetting(db, SAGA_IDENTITY, JSON.stringify(cleanIdentity(b)))
export const loadSide = (db: any): SideBook => cleanSide(read(db, SAGA_SIDE))
export const saveSide = (db: any, b: SideBook) => setSetting(db, SAGA_SIDE, JSON.stringify(cleanSide(b)))
export const loadWins = (db: any): WinsBook => cleanWins(read(db, SAGA_WINS))
export const saveWins = (db: any, b: WinsBook) => setSetting(db, SAGA_WINS, JSON.stringify(cleanWins(b)))
export const loadWheel = (db: any): WheelBook => cleanWheel(read(db, SAGA_WHEEL))
export const saveWheel = (db: any, b: WheelBook) => setSetting(db, SAGA_WHEEL, JSON.stringify(cleanWheel(b)))
export const loadArc = (db: any): ArcBook => cleanArc(read(db, SAGA_ARC))
export const saveArc = (db: any, b: ArcBook) => setSetting(db, SAGA_ARC, JSON.stringify(cleanArc(b)))

/** A card's picture (null removes it). Kept small, like the wallpaper photo. */
export function saveVisionPhoto(db: any, cardId: string, url: string | null, today: string): VisionBook {
  if (url !== null && !okVisionPhoto(url)) throw new Error('That picture is too big or not an image')
  const v = loadVision(db, today)
  if (!v.cards.some((c) => c.id === cardId)) throw new Error('No such card')
  const photos = { ...loadVisionPhotos(db, v.cards) }
  if (url) photos[cardId] = url
  else delete photos[cardId]
  setSetting(db, SAGA_VISION_PHOTOS, JSON.stringify(photos))
  const next = { ...v, cards: v.cards.map((c) => (c.id === cardId ? { ...c, photo: !!url } : c)) }
  saveVision(db, next, today)
  return next
}

// ------------------------------------------------------------ worked out

export interface SeasonFacts {
  season: Season
  number: number
  progress: SeasonProgress
  boss: BossState
  questPcts: number[]
  /** Linked goals by quest index (title and %), for the quest cards. */
  questGoals: ({ id: number; title: string; pct: number } | null)[]
  perfectDays: number
  xp: number
  /** Today's three daily quests (they hit the boss when all three are done). */
  today: { quests: { title: string; progress: number; goal: number; done: boolean }[]; allDone: boolean }
  recap: SeasonRecap | null
}

export interface SagaView {
  today: string
  level: { level: number; rank: string; title: string; color: string; badge: string; next: { name: string; minLevel: number } | null; progress: number }
  seasons: SeasonBook
  current: SeasonFacts | null
  finished: number
  vision: VisionBook
  photos: Record<string, string>
  cardToday: VisionCard | null
  identity: IdentityBook
  votes: LineVotes[]
  side: SideBook
  sidePick: SidePick | null
  sideStatus: 'open' | 'done' | 'skipped'
  sideStats: ReturnType<typeof adventureStats>
  wins: Win[]
  winsBook: WinsBook
  low: boolean
  winToday: Win | null
  wheel: WheelBook
  wheelDue: ReturnType<typeof wheelDue>
  suggestion: ReturnType<typeof suggestTheme>
  arc: ArcState
  arcBook: ArcBook
  arcNew: ArcChapter | null
  moments: ArcMoment[]
  /** The cinematic waiting to play (a new rank or a season moment), or null. */
  cinematic: Cinematic | null
  /** Goals you can link quests and cards to. */
  goals: { id: number; title: string; pct: number; card: string | null }[]
}

const extraVotes = (wins: WinsBook): ExtraVote[] =>
  wins.mine.map((w) => ({ day: w.day, kinds: w.kind === 'kind' ? ['kind'] : [], text: `${w.title} ${w.detail}` }))

function seasonFacts(s: Season, book: SeasonBook, entries: LedgerEntry[], today: string, goalPct: (id: number) => { title: string; pct: number } | null): SeasonFacts {
  const progress = seasonProgress(s, today)
  const end = seasonEnd(s)
  const to = today < end ? today : end
  const live = effective(entries).filter((e) => e.day >= s.start && e.day <= to)
  let perfectDays = 0
  if (progress.phase !== 'before') for (let d = s.start; d <= to; d = addDays(d, 1)) if (questState(d, live.filter((e) => e.day === d)).allDone) perfectDays++
  const xp = live.reduce((t, e) => t + Math.max(0, e.xp), 0)
  const questGoals = s.quests.map((q) => (q.goalId != null ? ((g) => (g ? { id: q.goalId as number, ...g } : null))(goalPct(q.goalId)) : null))
  const questPcts = s.quests.map((q) => questPct(q, (id) => goalPct(id)?.pct ?? null))
  const boss = bossHp(s, { questPcts, perfectDays, xp })
  const q = questState(today, effective(entries).filter((e) => e.day === today))
  const workouts = live.filter((e) => e.ruleId === 'body.workout_done').length
  return {
    season: s,
    number: book.seasons.findIndex((x) => x.id === s.id) + 1,
    progress,
    boss,
    questPcts,
    questGoals,
    perfectDays,
    xp,
    today: { quests: q.quests.map((x) => ({ title: x.title, progress: x.progress, goal: x.goal, done: x.done })), allDone: q.allDone },
    recap: progress.phase === 'over' || s.boss.result ? seasonRecap(s, { questPcts, perfectDays, xp, workouts }, today) : null
  }
}

function goalsOf(s: Services, finance: any, now: Date): { id: number; title: string; pct: number; card: string | null }[] {
  try {
    return s.goals.cards(now, finance, { paused: true }).map((c) => ({ id: c.goal.id, title: c.goal.title, pct: Math.round(c.pct), card: (c.meta as { card?: string | null } | undefined)?.card ?? null }))
  } catch {
    return []
  }
}

/** Outside facts for the weekly side quest (all optional). */
export interface SideFacts {
  budget?: number | null
  weather?: Weather
  freeEvenings?: number | null
  freeDay?: boolean | null
}

/** The weekend's weather from the weather plugin's saved data (null without it). */
export function weekendWeather(db: any, today: string): Weather {
  try {
    const on = JSON.parse(getSetting(db, 'plugins_on') || '{}')
    if (!on?.weather) return null
    const data = JSON.parse(getSetting(db, 'plugin_weather_data') || 'null')
    const days: { day: string; tmax: number | null; rain: unknown[] }[] = Array.isArray(data?.days) ? data.days : []
    const wknd = days.filter((d) => d.day >= today && [0, 6].includes(new Date(`${d.day}T12:00:00Z`).getUTCDay()))
    if (!wknd.length) return null
    if (wknd.every((d) => (d.rain?.length ?? 0) > 0)) return 'rain'
    if (wknd.every((d) => d.tmax != null && d.tmax < 4)) return 'cold'
    return 'clear'
  } catch {
    return null
  }
}

export function sagaView(s: Services, opts: { finance?: any; side?: SideFacts; now?: Date } = {}): SagaView {
  const now = opts.now ?? new Date()
  const db = s.db
  const today = s.wallet.today(now)
  const entries = s.wallet.entries()
  const sum = s.wallet.summary(now)
  const lv = sum.level.level
  const def = hunterDefFor(lv)
  const nx = nextHunterRank(lv)
  const goals = goalsOf(s, opts.finance, now)
  const goalPct = (id: number) => {
    const g = goals.find((x) => x.id === id)
    return g ? { title: g.title, pct: g.pct } : null
  }
  const seasons = loadSeasons(db)
  const cur = currentSeason(seasons, today)
  const current = cur ? seasonFacts(cur, seasons, entries, today, goalPct) : null
  const done = finishedSeasons(seasons, today)
  const vision = loadVision(db, today)
  const identity = loadIdentity(db)
  const winsBook = loadWins(db)
  const side = loadSide(db)
  let budget = opts.side?.budget
  if (budget === undefined) {
    try {
      budget = s.shop.value({ finance: opts.finance }, now).funLeftLei
    } catch {
      budget = null
    }
  }
  const sidePick = pickSideQuest(pickInput(side, today, { budget: budget ?? null, weather: opts.side?.weather ?? weekendWeather(db, today), freeEvenings: opts.side?.freeEvenings ?? null, freeDay: opts.side?.freeDay ?? null }))
  const week = pickInput(side, today, { budget: null, weather: null, freeEvenings: null, freeDay: null }).week
  const wins = collectWins({
    entries,
    book: winsBook,
    seasons: done.map((x) => ({ id: x.id, name: x.name, boss: x.boss.title, won: x.boss.result === 'won', day: x.boss.resultDay ?? x.closed ?? seasonEnd(x) })),
    adventures: side.log.map((a) => ({ id: a.id, title: a.title, emoji: a.emoji, day: a.day, place: a.place }))
  })
  const low = lowDay(db, entries, today)
  const wheel = loadWheel(db)
  const hist = wheelHistory(wheel)
  const last = hist[hist.length - 1]
  const arcBook = loadArc(db)
  const arc = arcState(done.length, arcBook.outfit)
  const moments = sharedMoments(db)
  // What to celebrate: a new rank since the last one played, then this season's moments.
  const cands: Cinematic[] = []
  const lastRank = arcBook.played.filter((p) => p.startsWith('rank:')).map((p) => Number(p.slice(5))).sort((a, b) => b - a)[0]
  const r = rankUp(lastRank ?? 1, lv)
  if (r && lastRank != null) cands.push(r)
  if (current) for (const m of seasonMoments(current.season, current.progress, current.boss)) cands.push(seasonCinematic(m, current.season.color))
  return {
    today,
    level: { level: lv, rank: def.name, title: def.title, color: def.color, badge: def.badge, next: nx ? { name: nx.name, minLevel: nx.minLevel } : null, progress: sum.level.progress },
    seasons,
    current,
    finished: done.length,
    vision,
    photos: loadVisionPhotos(db, vision.cards),
    cardToday: cardOfDay(vision, today),
    identity,
    votes: identityVotes(identity, entries, today, extraVotes(winsBook)),
    side,
    sidePick,
    sideStatus: side.weeks[week]?.status ?? 'open',
    sideStats: adventureStats(side, today),
    wins,
    winsBook,
    low,
    winToday: low ? pickWin(wins, today) : null,
    wheel,
    wheelDue: wheelDue(wheel, today),
    suggestion: last ? suggestTheme(last.ratings, hist.length > 1 ? hist[hist.length - 2].ratings : null) : null,
    arc,
    arcBook,
    arcNew: newChapter(arcBook, arc),
    moments,
    cinematic: nextCinematic(cands, arcBook.played),
    goals
  }
}

function lowDay(db: any, entries: LedgerEntry[], today: string): boolean {
  try {
    const live = effective(entries)
    const y = addDays(today, -1)
    // A brand-new database (nothing before yesterday) is not a low day.
    if (!live.some((e) => daysBetween(e.day, today) >= 2)) return false
    const yesterday = live.filter((e) => e.day === y).reduce((t, e) => t + Math.max(0, e.coins), 0)
    const slipped = live.some((e) => e.day === y && e.ruleId === 'discipline.reset')
    let mood: number | null = null
    try {
      const desk = JSON.parse(getSetting(db, 'ben_desk') || 'null')
      const m = (Array.isArray(desk?.moods) ? desk.moods : []).filter((x: any) => x?.day === today).pop()
      mood = m && Number.isFinite(Number(m.mood)) ? Number(m.mood) : null
    } catch {
      mood = null
    }
    return isLowDay({ mood, yesterday, score: null, prevScore: null, slipped })
  } catch {
    return false
  }
}

/** Big moments you shared with Ben, from his memory store (ben_convo points kept as moments). */
export function sharedMoments(db: any): ArcMoment[] {
  try {
    const c = cleanConvo(JSON.parse(getSetting(db, 'ben_convo') || 'null'))
    return c.points.filter((p) => p.via === 'moment').map((p) => ({ day: p.day, text: p.text }))
  } catch {
    return []
  }
}

/** Ben's lines about all this (only the parts that have something). */
export function sagaContext(s: Services, db: any, finance: any, now = new Date()): string[] {
  try {
    const v = sagaView(s, { finance, now, side: { budget: null } })
    const c = v.current
    return [
      seasonLine(c?.season ?? null, c?.progress ?? null, c?.boss ?? null, c?.questPcts ?? []),
      visionLine(v.vision),
      identityLine(v.votes),
      winsLine(v.wins, v.low, v.today),
      wheelLine(v.wheel, v.today),
      v.sidePick && v.sideStatus === 'open' ? `This week's side quest (a small offline adventure he can choose to do): ${v.sidePick.quest.title}.` : '',
      arcLine(v.arc, v.moments, v.today)
    ].filter(Boolean)
  } catch {
    return []
  }
}
