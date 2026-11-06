// Ben on your PC (pure, tested). Everything here is opt-in and stays on the
// computer: which sensors are on (P1), what kind of app you're in (P2, P3),
// the day's totals (P8), honest focus quality (P7), real breaks (P11), the
// late-night guard (P13) and the sites a focus block keeps away (P19).
import { cleanContextRules, type ContextRule } from './activityContext'

export interface PcPrefs {
  // ---- Smart island (SI1–SI27): all off until you turn them on ----
  /** Work out what you're doing (coding, study, video…) from the app in front. */
  smart: boolean
  /** Suggestions on the island (Accept / Not now / Never). */
  smartSuggest: boolean
  /** Your recipes run (desktop only). */
  smartRecipes: boolean
  /** SI14: notice when you leave your bank's site (titles on) to offer "log spending". */
  smartBank: boolean
  /** Words for your bank sites (matched on this PC only). */
  bankWords: string[]
  /** Your goals and subjects (the app sends them): the only words a detail can be. */
  goalWords: string[]
  /** "That's not right": your fixes per app. */
  contextRules: ContextRule[]
  /** Suggestions a day at most. */
  suggestBudget: number
  /** SI19: a music link the focus pack opens (allow-listed sites only), or ''. */
  musicLink: string
  /** Idle time (away, breaks, focus quality). */
  idle: boolean
  /** Copied text with a date in it ("save this?"). */
  clipboard: boolean
  /** Which app is in front (process name). Off until you turn it on. */
  activeApp: boolean
  /** Also the window title (to tell YouTube from Docs in a browser). */
  titles: boolean
  /** Keep per-app minutes for the day on this PC. */
  history: boolean
  /** Send only the day's totals (top apps) to Ben's evening review. */
  shareTotals: boolean
  /** Your own lists (process or site words). */
  work: string[]
  distract: string[]
  /** Block distracting sites during focus (with the browser helper, P19). */
  blockSites: boolean
  sites: string[]
  /** Hold Life System's own Windows notifications during focus (P20). */
  holdNotifs: boolean
  /** MC11: minutes on listed sites from the browser's own history (off until you turn it on). */
  browserHistory: boolean
  /** "Let Ben see what I'm doing": the live coach on the island (pcCoach.ts). Off until you turn it on. */
  coach: boolean
}

export const DEFAULT_PC: PcPrefs = {
  smart: false,
  smartSuggest: false,
  smartRecipes: false,
  smartBank: false,
  bankWords: [],
  goalWords: [],
  contextRules: [],
  suggestBudget: 6,
  musicLink: '',
  idle: true,
  clipboard: true,
  activeApp: false,
  titles: false,
  history: false,
  shareTotals: false,
  work: ['code', 'devenv', 'idea64', 'pycharm64', 'webstorm64', 'notion', 'obsidian', 'winword', 'excel', 'powerpnt', 'acrord32', 'windowsterminal', 'docs.google', 'overleaf', 'github'],
  distract: ['steam', 'epicgameslauncher', 'discord', 'spotify', 'netflix', 'tiktok', 'youtube', 'reddit', 'instagram', 'facebook', 'twitch', 'x.com'],
  blockSites: false,
  sites: ['youtube.com', 'reddit.com', 'tiktok.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'netflix.com', 'twitch.tv'],
  holdNotifs: true,
  browserHistory: false,
  coach: false
}

const words = (x: unknown, max = 60) => (Array.isArray(x) ? [...new Set(x.map((v) => String(v).trim().toLowerCase()).filter((v) => v && v.length <= 40))].slice(0, max) : null)
export function cleanPcPrefs(p: any): PcPrefs {
  const b = (k: keyof PcPrefs) => (typeof p?.[k] === 'boolean' ? p[k] : DEFAULT_PC[k])
  const budget = Math.round(Number(p?.suggestBudget))
  const music = typeof p?.musicLink === 'string' && /^https:\/\/[^\s]{4,300}$/.test(p.musicLink) ? p.musicLink : ''
  return {
    smart: b('smart') as boolean,
    smartSuggest: b('smartSuggest') as boolean,
    smartRecipes: b('smartRecipes') as boolean,
    smartBank: b('smartBank') as boolean,
    bankWords: words(p?.bankWords, 20) ?? [],
    goalWords: (Array.isArray(p?.goalWords) ? [...new Set(p.goalWords.map((v: unknown) => String(v).trim()).filter((v: string) => v.length >= 3 && v.length <= 40))] as string[] : []).slice(0, 40),
    contextRules: cleanContextRules(p?.contextRules),
    suggestBudget: Number.isFinite(budget) ? Math.max(0, Math.min(20, budget)) : DEFAULT_PC.suggestBudget,
    musicLink: music,
    idle: b('idle') as boolean,
    clipboard: b('clipboard') as boolean,
    activeApp: b('activeApp') as boolean,
    titles: b('titles') as boolean,
    history: b('history') as boolean,
    shareTotals: b('shareTotals') as boolean,
    work: words(p?.work) ?? DEFAULT_PC.work,
    distract: words(p?.distract) ?? DEFAULT_PC.distract,
    blockSites: b('blockSites') as boolean,
    sites: (words(p?.sites, 80) ?? DEFAULT_PC.sites).map((s) => s.replace(/^https?:\/\//, '').replace(/\/.*$/, '')),
    holdNotifs: b('holdNotifs') as boolean,
    browserHistory: b('browserHistory') as boolean,
    coach: b('coach') as boolean
  }
}

export type AppKind = 'work' | 'distract' | 'neutral'
const BROWSERS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'arc']
const SITE_NAMES: Record<string, string> = { youtube: 'YouTube', reddit: 'Reddit', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', twitch: 'Twitch', netflix: 'Netflix', 'x.com': 'X', github: 'GitHub', 'docs.google': 'Google Docs', overleaf: 'Overleaf', notion: 'Notion' }
const NICE: Record<string, string> = { code: 'VS Code', devenv: 'Visual Studio', idea64: 'IntelliJ', pycharm64: 'PyCharm', webstorm64: 'WebStorm', winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', acrord32: 'Acrobat', msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', windowsterminal: 'Terminal', epicgameslauncher: 'Epic Games', explorer: 'File Explorer' }

const procOf = (p: string) => p.trim().toLowerCase().replace(/\.exe$/, '')
const isBrowser = (p: string) => BROWSERS.includes(procOf(p))

/** What kind of app this is, by your lists: the process first, then (in a browser, with titles on) the site. */
export function classifyApp(proc: string, title: string | null, p: Pick<PcPrefs, 'work' | 'distract'>): AppKind {
  const name = procOf(proc)
  if (!name) return 'neutral'
  const t = (title ?? '').toLowerCase()
  const hit = (list: string[]) => list.some((w) => name === w || (isBrowser(name) && t && t.includes(w)))
  // Your "work" list wins: "It's for this" is your call.
  if (hit(p.work)) return 'work'
  if (hit(p.distract)) return 'distract'
  return 'neutral'
}

/** A friendly name: "YouTube" for a browser on YouTube (titles on), "VS Code" for code.exe. */
export function appLabel(proc: string, title: string | null): string {
  const name = procOf(proc)
  if (isBrowser(name) && title) {
    const t = title.toLowerCase()
    const site = Object.keys(SITE_NAMES).find((k) => t.includes(k))
    if (site) return SITE_NAMES[site]
  }
  return NICE[name] ?? (name ? name[0].toUpperCase() + name.slice(1) : 'Unknown')
}

export interface DayActivity {
  day: string
  apps: Record<string, { sec: number; kind: AppKind }>
  /** Smart island: seconds of each kind of doing (coding, study…). */
  ctx?: Record<string, number>
  /** Smart island: minutes of each kind per hour ("9" → {coding: 40}). */
  hours?: Record<string, Record<string, number>>
}

/** Adds a sample (the watcher looks every few seconds). */
export function addActivity(d: DayActivity | null, day: string, label: string, kind: AppKind, sec: number): DayActivity {
  const base: DayActivity = d && d.day === day ? d : { day, apps: {} }
  const cur = base.apps[label] ?? { sec: 0, kind }
  return { ...base, day, apps: { ...base.apps, [label]: { sec: cur.sec + sec, kind } } }
}

/** Smart island: adds seconds of a kind of doing to the day and to its hour. */
export function addDoing(d: DayActivity | null, day: string, ctx: string, sec: number, hour: number): DayActivity {
  const base: DayActivity = d && d.day === day ? d : { day, apps: {} }
  const h = String(hour)
  const hours = { ...(base.hours ?? {}) }
  hours[h] = { ...(hours[h] ?? {}), [ctx]: Math.round(((hours[h]?.[ctx] ?? 0) + sec / 60) * 10) / 10 }
  return { ...base, ctx: { ...(base.ctx ?? {}), [ctx]: (base.ctx?.[ctx] ?? 0) + sec }, hours }
}

const hm = (sec: number) => {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m}m`
}

/** P8: "VS Code 3h10, Chrome 1h40, YouTube 35m, Discord 25m · work 4h20, distracting 1h" (top 8). */
export function activityLine(d: DayActivity | null): string {
  if (!d) return ''
  const list = Object.entries(d.apps).filter(([, v]) => v.sec >= 120).sort((a, b) => b[1].sec - a[1].sec)
  if (!list.length) return ''
  const sum = (k: AppKind) => list.filter(([, v]) => v.kind === k).reduce((t, [, v]) => t + v.sec, 0)
  const w = sum('work')
  const x = sum('distract')
  return `${list.slice(0, 8).map(([k, v]) => `${k} ${hm(v.sec)}`).join(', ')}${w || x ? ` · work ${hm(w)}, distracting ${hm(x)}` : ''}`
}

/** P7: focus quality counts idle time AND time in distracting apps. */
export function focusQualityPc(totalSec: number, idleSec: number, distractSec: number): number {
  if (totalSec <= 0) return 100
  return Math.max(0, Math.min(100, Math.round(100 * (1 - Math.min(totalSec, idleSec + distractSec) / totalSec))))
}

/** P3: a distraction during focus worth a word: 60+ seconds in a row, not snoozed. */
export function distractWorthSaying(streakSec: number, snoozedUntil: number, now: number): boolean {
  return streakSec >= 60 && snoozedUntil <= now
}

/** P11: a break after 50 minutes of input without a 5-minute pause (never right after you were away). */
export const BREAK_AFTER_MIN = 50

/** P13: after bedtime + 30 min (until 05:00), still using the PC. */
export function lateNight(now: Date, bedTarget: string, idleSec: number | null): boolean {
  if (!/^\d{2}:\d{2}$/.test(bedTarget) || idleSec == null || idleSec > 120) return false
  const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const m = now.getHours() * 60 + now.getMinutes()
  const late = (toM(bedTarget) + 30) % 1440
  // Minutes since "late" started, wrapping past midnight; the guard lasts until 05:00.
  const since = (m - late + 1440) % 1440
  const until5 = (300 - late + 1440) % 1440
  return since < until5
}

/** P19: is this site one a focus block keeps away? ("www.youtube.com" matches "youtube.com"). */
export function siteBlocked(host: string, sites: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return sites.some((s) => h === s || h.endsWith(`.${s}`))
}
