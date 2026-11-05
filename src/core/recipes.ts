// Smart island (SI7, SI19, SI24): recipes, your own small automations:
// "When I open VS Code on weekdays 9–12 → start a focus timer called Coding".
// A recipe can only do things from a short WHITELIST (start/stop a timer,
// keep sites away, open Windows' Do Not Disturb page, quiet the island, a
// notebook line, a task, open a page of the app or an allow-listed link):
// never a script, never a program, never logging a habit, water or a reward.
// The first run asks (Always / Just now / Turn off). Recipes run only in the
// desktop app. Stored in the synced setting island_recipes. Pure and tested.
import type { ContextKind } from './activityContext'
import { CONTEXT_KINDS, CONTEXT_LABEL } from './activityContext'

export type RecipeOn = 'context' | 'time' | 'focus:start' | 'focus:end' | 'meeting:start' | 'meeting:end' | 'block:start'
export const RECIPE_ON: RecipeOn[] = ['context', 'time', 'focus:start', 'focus:end', 'meeting:start', 'meeting:end', 'block:start']
export const RECIPE_ON_LABEL: Record<RecipeOn, string> = { context: 'I start…', time: 'It is…', 'focus:start': 'A focus timer starts', 'focus:end': 'A focus timer ends', 'meeting:start': 'A meeting starts', 'meeting:end': 'A meeting ends', 'block:start': 'A planned block starts' }

/** The pages a recipe may open (the app's own). */
export const SAFE_PAGES = ['today', 'calendar', 'tasks', 'goals', 'focus', 'coach', 'sleep', 'discipline', 'money', 'body', 'rewards', 'notebook', 'insights'] as const
export type SafePage = (typeof SAFE_PAGES)[number]
/** Links a recipe may open: https, and only these sites (music to focus with, your course sites). */
export const LINK_HOSTS = ['open.spotify.com', 'music.youtube.com', 'music.apple.com', 'soundcloud.com', 'www.soundcloud.com', 'lofi.cafe', 'www.lofi.cafe', 'mynoise.net', 'www.mynoise.net', 'brain.fm', 'www.brain.fm', 'tidal.com', 'listen.tidal.com', 'deezer.com', 'www.deezer.com']

export type SafeAction =
  | { do: 'focus'; subject: string; minutes: number }
  | { do: 'stopFocus' }
  | { do: 'blockSites' }
  | { do: 'dnd' }
  | { do: 'quiet'; minutes: number }
  | { do: 'note'; text: string }
  | { do: 'task'; text: string }
  | { do: 'open'; page: SafePage }
  | { do: 'link'; url: string }
  /** SI19: keep sites away + Do Not Disturb page + quiet island (+ your music link). */
  | { do: 'focusPack'; minutes?: number }
  /** A Windows notification: "Wind down · bed at …". */
  | { do: 'windDown' }
  /** A meeting ended: offer a note (a suggestion, never writes by itself). */
  | { do: 'offerNote' }

export const SAFE_LABEL: Record<SafeAction['do'], string> = {
  focus: 'Start a focus timer',
  stopFocus: 'Stop the focus timer',
  blockSites: 'Keep distracting sites away',
  dnd: "Open Windows' Do Not Disturb",
  quiet: 'Quiet the island',
  note: 'Add a line to the notebook',
  task: 'Add a task',
  open: 'Open a page of the app',
  link: 'Open an allowed link',
  focusPack: 'Focus pack (sites away, Do Not Disturb, quiet)',
  windDown: 'Wind-down reminder',
  offerNote: 'Offer a meeting note'
}

export interface RecipeWhen { on: RecipeOn; ctx?: ContextKind; at?: string }
export interface RecipeIf { days?: number[]; from?: string; to?: string; noTimer?: boolean }
export interface Recipe {
  id: string
  name: string
  on: boolean
  when: RecipeWhen
  if?: RecipeIf
  then: SafeAction[]
  /** Ask every time before running. */
  confirmFirst: boolean
  /** It has run once (the first run always asks). */
  ranOnce: boolean
  /** Made by Ben (SI24): starts off until you turn it on. */
  byBen?: boolean
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n)

export function safeLink(url: unknown): string | null {
  try {
    const u = new URL(String(url ?? ''))
    return u.protocol === 'https:' && LINK_HOSTS.includes(u.hostname.toLowerCase()) ? u.toString() : null
  } catch {
    return null
  }
}

/** One action → the safe version, or null when it isn't on the whitelist. */
export function cleanAction(a: any): SafeAction | null {
  switch (a?.do) {
    case 'focus': {
      const subject = clip(a.subject, 60) || 'Focus'
      const minutes = Math.round(Number(a.minutes))
      return { do: 'focus', subject, minutes: Number.isFinite(minutes) ? Math.max(5, Math.min(180, minutes)) : 25 }
    }
    case 'quiet': {
      const m = Math.round(Number(a.minutes))
      return { do: 'quiet', minutes: Number.isFinite(m) ? Math.max(5, Math.min(240, m)) : 60 }
    }
    case 'focusPack': {
      const m = Math.round(Number(a.minutes))
      return Number.isFinite(m) ? { do: 'focusPack', minutes: Math.max(5, Math.min(240, m)) } : { do: 'focusPack' }
    }
    case 'note':
    case 'task': {
      const text = clip(a.text, 160)
      return text ? { do: a.do, text } : null
    }
    case 'open':
      return (SAFE_PAGES as readonly string[]).includes(a.page) ? { do: 'open', page: a.page } : null
    case 'link': {
      const url = safeLink(a.url)
      return url ? { do: 'link', url } : null
    }
    case 'stopFocus':
    case 'blockSites':
    case 'dnd':
    case 'windDown':
    case 'offerNote':
      return { do: a.do }
    default:
      return null
  }
}

/** A saved (or Ben-made) recipe → a valid one, or null. */
export function cleanRecipe(r: any, i = 0): Recipe | null {
  if (!r || typeof r !== 'object') return null
  const on = RECIPE_ON.includes(r.when?.on) ? (r.when.on as RecipeOn) : null
  if (!on) return null
  const when: RecipeWhen = { on }
  if (on === 'context') {
    if (!CONTEXT_KINDS.includes(r.when.ctx) || r.when.ctx === 'idle') return null
    when.ctx = r.when.ctx
  }
  if (on === 'time') {
    if (!HM.test(String(r.when.at ?? ''))) return null
    when.at = r.when.at
  }
  const then = (Array.isArray(r.then) ? r.then : []).map(cleanAction).filter((x: SafeAction | null): x is SafeAction => !!x).slice(0, 5)
  if (!then.length) return null
  const iff: RecipeIf = {}
  if (Array.isArray(r.if?.days)) {
    const days = [...new Set<number>(r.if.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    if (days.length && days.length < 7) iff.days = days
  }
  if (HM.test(String(r.if?.from ?? '')) && HM.test(String(r.if?.to ?? ''))) {
    iff.from = r.if.from
    iff.to = r.if.to
  }
  if (r.if?.noTimer) iff.noTimer = true
  const id = clip(r.id, 40) || `r${Date.now().toString(36)}${i}`
  return {
    id,
    name: clip(r.name, 60) || recipeText({ when, if: iff, then }),
    on: r.on === true,
    when,
    ...(Object.keys(iff).length ? { if: iff } : {}),
    then,
    confirmFirst: r.confirmFirst === true,
    ranOnce: r.ranOnce === true,
    ...(r.byBen ? { byBen: true } : {})
  }
}

export function cleanRecipes(x: unknown): Recipe[] {
  if (!Array.isArray(x)) return []
  const out: Recipe[] = []
  for (const [i, r] of x.entries()) {
    const c = cleanRecipe(r, i)
    if (c && !out.some((o) => o.id === c.id)) out.push(c)
  }
  return out.slice(0, 30)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const actionText = (a: SafeAction): string => {
  switch (a.do) {
    case 'focus':
      return `focus “${a.subject}” ${a.minutes} min`
    case 'quiet':
      return `quiet ${a.minutes} min`
    case 'note':
      return `note “${a.text}”`
    case 'task':
      return `task “${a.text}”`
    case 'open':
      return `open ${a.page}`
    case 'link':
      return `open ${new URL(a.url).hostname}`
    case 'focusPack':
      return 'focus pack'
    default:
      return SAFE_LABEL[a.do].toLowerCase()
  }
}
/** "When coding · Mon–Fri 09:00–12:00 → focus “Coding” 50 min". */
export function recipeText(r: Pick<Recipe, 'when' | 'then'> & { if?: RecipeIf }): string {
  const w = r.when.on === 'context' ? `When ${CONTEXT_LABEL[r.when.ctx!].toLowerCase()}` : r.when.on === 'time' ? `At ${r.when.at}` : `When ${RECIPE_ON_LABEL[r.when.on].toLowerCase()}`
  const days = r.if?.days?.length ? (r.if.days.join(',') === '1,2,3,4,5' ? 'weekdays' : r.if.days.join(',') === '0,6' ? 'weekends' : r.if.days.map((d) => DAYS[d]).join(' ')) : ''
  const hours = r.if?.from ? `${r.if.from}–${r.if.to}` : ''
  const cond = [days, hours, r.if?.noTimer ? 'no timer' : ''].filter(Boolean).join(' ')
  return `${w}${cond ? ` · ${cond}` : ''} → ${r.then.map(actionText).join(', ')}`
}

// ---- running them ----

export type RecipeEvent =
  | { t: 'context'; at: number; ctx: ContextKind; conf: number }
  | { t: 'tick'; at: number }
  | { t: 'focus:start' | 'focus:end' | 'meeting:start' | 'meeting:end' | 'block:start'; at: number }

export interface RecipeState {
  running: boolean
  /** recipe id → last fired (ms). */
  fired: Record<string, number>
}

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const inHours = (m: number, from: string, to: string) => {
  const a = toMin(from)
  const b = toMin(to)
  return a <= b ? m >= a && m < b : m >= a || m < b
}
const dayStart = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Which recipes this event starts, and whether to ask first. */
export function evaluate(recipes: Recipe[], e: RecipeEvent, st: RecipeState): { recipe: Recipe; acts: SafeAction[]; ask: boolean }[] {
  const d = new Date(e.at)
  const m = d.getHours() * 60 + d.getMinutes()
  const out: { recipe: Recipe; acts: SafeAction[]; ask: boolean }[] = []
  for (const r of recipes) {
    if (!r.on) continue
    const last = st.fired[r.id] ?? 0
    if (r.when.on === 'context') {
      if (e.t !== 'context' || e.ctx !== r.when.ctx || e.conf < 0.5) continue
      // Once an hour at most (a quick look away and back isn't a new start).
      if (e.at - last < 60 * 60_000) continue
    } else if (r.when.on === 'time') {
      if (e.t !== 'tick') continue
      const at = toMin(r.when.at!)
      // At the time, or within 30 min after it (the PC was asleep), once a day.
      if (m < at || m - at > 30 || last >= dayStart(e.at)) continue
    } else {
      if (e.t !== r.when.on) continue
      if (e.at - last < 2 * 60_000) continue
    }
    if (r.if?.days && !r.if.days.includes(d.getDay())) continue
    if (r.if?.from && r.if.to && !inHours(m, r.if.from, r.if.to)) continue
    if (r.if?.noTimer && st.running) continue
    // A timer already running: a second "start focus" does nothing.
    const acts = r.then.filter((a) => !(st.running && a.do === 'focus'))
    if (!acts.length) continue
    out.push({ recipe: r, acts, ask: r.confirmFirst || !r.ranOnce })
  }
  return out
}

/** Starter templates (the editor's "Add from a template"); they start off. */
export const RECIPE_TEMPLATES: Recipe[] = [
  { id: 't-coding', name: 'Coding mornings', on: false, when: { on: 'context', ctx: 'coding' }, if: { days: [1, 2, 3, 4, 5], from: '09:00', to: '12:00', noTimer: true }, then: [{ do: 'focus', subject: 'Coding', minutes: 50 }], confirmFirst: false, ranOnce: false },
  { id: 't-pack', name: 'Focus pack with every timer', on: false, when: { on: 'focus:start' }, then: [{ do: 'focusPack' }], confirmFirst: false, ranOnce: false },
  { id: 't-meet', name: 'Quiet in meetings', on: false, when: { on: 'meeting:start' }, then: [{ do: 'quiet', minutes: 60 }], confirmFirst: false, ranOnce: false },
  { id: 't-meet-end', name: 'A note after meetings', on: false, when: { on: 'meeting:end' }, then: [{ do: 'offerNote' }], confirmFirst: false, ranOnce: false },
  { id: 't-night', name: 'Wind down at 22:30', on: false, when: { on: 'time', at: '22:30' }, then: [{ do: 'windDown' }, { do: 'quiet', minutes: 90 }], confirmFirst: false, ranOnce: false }
]

/**
 * SI24: Ben's line "RECIPE: {json}" → a recipe to offer (always off, made by
 * Ben, asks on its first run). Anything outside the whitelist is dropped.
 */
export function parseRecipeLine(line: string): Recipe | null {
  const m = /^\s*RECIPE:\s*(\{.*\})\s*$/i.exec(line)
  if (!m) return null
  try {
    const r = cleanRecipe({ ...JSON.parse(m[1]), on: false, ranOnce: false, byBen: true, id: `ben${Date.now().toString(36)}` })
    return r
  } catch {
    return null
  }
}
