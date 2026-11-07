// Game time (pure, tested in gaming.test.ts with pinned clocks).
//
// Counts how long you play. It uses only the name of the program in front
// (the active-app sensor of "Let Ben see what I'm doing"), never a window
// title or a screenshot, and keeps minutes per day on this PC only.
//
// A game is: a program in the known list (Fortnite's `FortniteClient-Win64-
// Shipping`, Valorant, CS2, League, Minecraft…), a program you added in
// Settings, or something the app already sorts as gaming that is not a
// launcher. A launcher (Epic Games, Steam, Riot, Battle.net…) counts only while
// a game runs, never by itself. A short look at Discord or the browser
// (under 3 minutes) does not end the session.
import { calendarDay } from './dates'
import type { PushLevel } from './lifeFit'
import type { IslandAlert } from './islandModel'

/** Program name (lowercase, no .exe) → what the island calls it. */
export const KNOWN_GAMES: Record<string, string> = {
  'fortniteclient-win64-shipping': 'Fortnite',
  'fortniteclient-win64-shipping_be': 'Fortnite',
  'fortniteclient-win64-shipping_eac': 'Fortnite',
  fortnitelauncher: 'Fortnite',
  'valorant-win64-shipping': 'Valorant',
  valorant: 'Valorant',
  cs2: 'Counter-Strike 2',
  csgo: 'Counter-Strike',
  leagueoflegends: 'League of Legends',
  'league of legends': 'League of Legends',
  dota2: 'Dota 2',
  r5apex: 'Apex Legends',
  overwatch: 'Overwatch',
  rocketleague: 'Rocket League',
  gta5: 'GTA V',
  eldenring: 'Elden Ring',
  robloxplayerbeta: 'Roblox',
  'minecraft.windows': 'Minecraft',
  minecraft: 'Minecraft',
  javaw: 'Minecraft'
}
/** Launchers and stores: they count only while a game runs. */
export const LAUNCHERS = ['steam', 'steamwebhelper', 'epicgameslauncher', 'epicwebhelper', 'battle.net', 'riotclientservices', 'riotclientux', 'riotclientuxrender', 'leagueclient', 'leagueclientux', 'eadesktop', 'origin', 'ubisoftconnect', 'gog galaxy', 'galaxyclient', 'xboxapp', 'gamebar', 'minecraftlauncher']

const norm = (s: string) => s.trim().toLowerCase().replace(/\.exe$/, '')
export const isLauncher = (app: string) => LAUNCHERS.includes(norm(app))
const clean = (s: unknown) => (typeof s === 'string' ? norm(s).replace(/[^\p{L}\p{N}._ +-]/gu, '').slice(0, 60) : '')

/** The game's name for the program in front, or null (not a game, or only a launcher). `ctx`: what the app already sorted it as. */
export function gameOf(app: string | null | undefined, extra: string[] = [], ctx?: string | null): string | null {
  if (!app) return null
  const a = norm(app)
  if (!a || LAUNCHERS.includes(a)) return null
  if (KNOWN_GAMES[a]) return KNOWN_GAMES[a]
  // Process names of one game come in variants (…-Shipping_EAC, …Win64-Shipping-BE).
  if (a.startsWith('fortniteclient') || a.includes('fortnite')) return 'Fortnite'
  for (const e of extra) {
    const x = norm(e)
    if (x && (a === x || (x.length >= 4 && a.startsWith(x)))) return display(a)
  }
  if (ctx === 'gaming') return display(a)
  return null
}
const display = (a: string) => a.replace(/-win64-shipping.*$/, '').replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 30)

// ---- Prefs ----

export interface GamingPrefs {
  /** Count game time (needs the active-app sensor). */
  on: boolean
  /** Programs you added (names only). */
  extra: string[]
  dayLimitMin: number | null
  weekLimitMin: number | null
}
export const DEFAULT_GAMING: GamingPrefs = { on: false, extra: [], dayLimitMin: null, weekLimitMin: null }
export function cleanGaming(raw: unknown): GamingPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<GamingPrefs>
  const lim = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 10 ? Math.min(max, Math.round(v)) : null)
  return {
    on: o.on === true,
    extra: [...new Set((Array.isArray(o.extra) ? o.extra : []).map(clean).filter(Boolean))].slice(0, 30),
    dayLimitMin: lim(o.dayLimitMin, 1440),
    weekLimitMin: lim(o.weekLimitMin, 10080)
  }
}

// ---- Time ----

export const dayOfMs = (t: number) => calendarDay(new Date(t))
/** Monday of the week of `t`, as a day key. */
export const weekStart = (t: number) => {
  const d = new Date(t)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayOfMs(d.getTime())
}
export const GRACE_MS = 3 * 60_000
/** One look at the clock is at most this long (a sleeping PC doesn't count as play). */
export const MAX_STEP_MS = 90_000

export interface GameSession { label: string; startedAt: number; lastSeen: number; sec: number }
export interface GamingState {
  /** Seconds per day (35 days kept). */
  days: Record<string, number>
  session: GameSession | null
  lastTickAt: number
  /** Warnings already given: `day:80`, `week:100`… */
  warned: Record<string, number>
}
export const EMPTY_GAMING: GamingState = { days: {}, session: null, lastTickAt: 0, warned: {} }
export function cleanGamingState(raw: unknown): GamingState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<GamingState>
  const days = Object.fromEntries(Object.entries(o.days && typeof o.days === 'object' ? o.days : {}).filter(([k, v]) => /^\d{4}-\d\d-\d\d$/.test(k) && typeof v === 'number' && v >= 0))
  return { days, session: null, lastTickAt: 0, warned: o.warned && typeof o.warned === 'object' ? (o.warned as Record<string, number>) : {} }
}

export const todayMin = (s: GamingState, now: number) => Math.round((s.days[dayOfMs(now)] ?? 0) / 60)
export function weekMin(s: GamingState, now: number): number {
  const from = weekStart(now)
  let sec = 0
  for (const [k, v] of Object.entries(s.days)) if (k >= from && k <= dayOfMs(now)) sec += v
  return Math.round(sec / 60)
}
export const sessionMin = (s: GamingState) => Math.round((s.session?.sec ?? 0) / 60)

export interface GamingSummary { label: string; sessionMin: number; todayMin: number; weekMin: number }
/**
 * One look (the island's 15 s build): `game` is what gameOf says about the
 * program in front (null when it is not a game or you are away).
 * Returns the new state and, when a session just ended, its summary.
 */
export function gamingStep(st: GamingState, i: { now: number; game: string | null }): { state: GamingState; ended: GamingSummary | null } {
  const { now } = i
  const dt = st.lastTickAt ? Math.min(MAX_STEP_MS, Math.max(0, now - st.lastTickAt)) : 0
  let s: GamingState = { ...st, lastTickAt: now }
  if (i.game) {
    const sec = st.session ? dt / 1000 : 0
    const day = dayOfMs(now)
    const days = { ...s.days, [day]: (s.days[day] ?? 0) + sec }
    // Keep 35 days.
    for (const k of Object.keys(days)) if (now - new Date(`${k}T12:00:00`).getTime() > 35 * 86_400_000) delete days[k]
    s = { ...s, days, session: { label: i.game, startedAt: st.session?.startedAt ?? now, lastSeen: now, sec: (st.session?.sec ?? 0) + sec } }
    return { state: s, ended: null }
  }
  if (st.session && now - st.session.lastSeen > GRACE_MS) {
    const ended: GamingSummary = { label: st.session.label, sessionMin: Math.round(st.session.sec / 60), todayMin: todayMin(st, now), weekMin: weekMin(st, now) }
    return { state: { ...s, session: null }, ended }
  }
  return { state: s, ended: null }
}

// ---- What the island shows ----

export interface GamingView { on: boolean; app: string; sessionMin: number; todayMin: number; weekMin: number; limitMin?: number }
export function gamingView(st: GamingState, p: GamingPrefs, now: number): GamingView | null {
  if (!p.on) return null
  const live = !!st.session && now - st.session.lastSeen <= GRACE_MS
  const t = todayMin(st, now)
  const w = weekMin(st, now)
  // The limit that is closer to being used up.
  const lims = [p.dayLimitMin != null ? { min: p.dayLimitMin, used: t } : null, p.weekLimitMin != null ? { min: p.weekLimitMin, used: w } : null].filter(Boolean) as { min: number; used: number }[]
  const lim = lims.sort((a, b) => b.used / b.min - a.used / a.min)[0]
  return { on: live, app: live ? st.session!.label : '', sessionMin: live ? sessionMin(st) : 0, todayMin: t, weekMin: w, ...(lim ? { limitMin: lim.min } : {}) }
}
export const timeText = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${Math.max(0, Math.round(m))} min`)
/** "🎮 Fortnite · 42 min". */
export const counterText = (v: Pick<GamingView, 'app' | 'sessionMin'>) => `🎮 ${v.app} · ${timeText(v.sessionMin)}`

/** The short peek when a session ends. */
export function endedAlert(e: GamingSummary, now: number): IslandAlert {
  const id = `gaming:end:${now}`
  return { id, kind: 'gaming', title: `🎮 ${timeText(e.todayMin)} today · ${timeText(e.weekMin)} this week`, text: `${e.label}, this session ${timeText(e.sessionMin)}`, face: '🎮', peekMs: 4000, actions: [{ label: 'OK', action: { kind: 'dismiss', id }, primary: true }] }
}

// ---- Limits ----

/**
 * A gentle note at 80% and at 100% of a limit you set. Gentle pushes only say
 * the 100% one; firm and push also say 80%. Once each per day or week, never
 * blocks anything, never shames. `null` when nothing is due.
 */
export function limitAlert(o: { st: GamingState; prefs: GamingPrefs; push: PushLevel; now: number }): { alert: IslandAlert; key: string } | null {
  const { st, prefs, now } = o
  const scopes: { scope: 'day' | 'week'; used: number; limit: number | null; id: string }[] = [
    { scope: 'day', used: todayMin(st, now), limit: prefs.dayLimitMin, id: dayOfMs(now) },
    { scope: 'week', used: weekMin(st, now), limit: prefs.weekLimitMin, id: weekStart(now) }
  ]
  for (const sc of scopes) {
    if (sc.limit == null) continue
    const pct = sc.used / sc.limit
    const steps: (80 | 100)[] = o.push === 'gentle' ? [100] : [80, 100]
    for (const step of [...steps].reverse()) {
      if (pct < step / 100) continue
      const key = `${sc.scope}:${sc.id}:${step}`
      if (st.warned[key]) break
      const word = sc.scope === 'day' ? "today's" : "this week's"
      const text =
        step === 100
          ? `You reached ${word} game time (${timeText(sc.limit)}). Your call from here.`
          : `${timeText(sc.used)} of ${word} ${timeText(sc.limit)} game time. A good moment to think about the next game.`
      const id = `gaming:${key}`
      return { key, alert: { id, kind: 'gaming', title: step === 100 ? `🎮 ${sc.scope === 'day' ? 'Daily' : 'Weekly'} game time reached` : `🎮 ${step}% of ${word} game time`, text, face: '🎮', actions: [{ label: 'OK', action: { kind: 'dismiss', id }, primary: true }, { label: 'Snooze 30 min', action: { kind: 'dismiss', id, snoozeMin: 30 } }] } }
    }
  }
  return null
}
export const markWarned = (st: GamingState, key: string, now: number): GamingState => ({ ...st, warned: { ...Object.fromEntries(Object.entries(st.warned).slice(-40)), [key]: now } })

/** One short line of totals for Ben's context (totals only: no app, no title). */
export function gamingLine(st: GamingState, p: GamingPrefs, now: number): string | null {
  if (!p.on) return null
  const t = todayMin(st, now)
  const w = weekMin(st, now)
  return t > 0 || w > 0 ? `gaming ${timeText(t)} today, ${timeText(w)} this week` : null
}
