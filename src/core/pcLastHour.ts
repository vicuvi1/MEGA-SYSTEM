// AU2: "last hour: 35 min YouTube, 10 min VS Code", the short summary Ben may
// see. Two sources, both on this PC:
// - ActivityWatch (free, open source) when it runs locally on port 5600: its
//   window and browser buckets (app names and site domains);
// - otherwise the desktop app's own feed (the Smart island's app events).
// Only app names, site domains and minutes are kept: never window titles,
// never full addresses. Pure and tested.
import type { ActivityEvent } from './activityStream'

export interface UseItem { name: string; min: number }
export interface LastHour { at: number; src: 'activitywatch' | 'built-in'; items: UseItem[]; line: string }

/** An ActivityWatch event: when, how long (s), and its data. */
export interface AwEvent { timestamp: string; duration: number; data: Record<string, unknown> }
/** The buckets list (GET /api/0/buckets/): id → { type }. */
export type AwBuckets = Record<string, { id?: string; type?: string; hostname?: string }>

export const AW_URL = 'http://localhost:5600'
const BROWSERS = /^(chrome|msedge|firefox|brave|opera|vivaldi|arc|google chrome|microsoft edge)(\.exe)?$/i
const NICE: Record<string, string> = { code: 'VS Code', 'code.exe': 'VS Code', devenv: 'Visual Studio', winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', windowsterminal: 'Terminal', explorer: 'File Explorer', msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', discord: 'Discord', spotify: 'Spotify', steam: 'Steam', telegram: 'Telegram', obsidian: 'Obsidian', notion: 'Notion' }
const SITES: Record<string, string> = { 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'reddit.com': 'Reddit', 'tiktok.com': 'TikTok', 'instagram.com': 'Instagram', 'facebook.com': 'Facebook', 'twitch.tv': 'Twitch', 'netflix.com': 'Netflix', 'x.com': 'X', 'twitter.com': 'X', 'github.com': 'GitHub', 'docs.google.com': 'Google Docs', 'overleaf.com': 'Overleaf', 'notion.so': 'Notion', 'chatgpt.com': 'ChatGPT', 'claude.ai': 'Claude' }

/** "Code.exe" → "VS Code"; anything else: its name, short. */
export function niceApp(app: string): string {
  const k = String(app ?? '').trim().toLowerCase().replace(/\.exe$/, '')
  if (!k) return ''
  return NICE[k] ?? (k[0].toUpperCase() + k.slice(1)).slice(0, 30)
}

/** A URL → its friendly site name or bare domain ("www.youtube.com/watch?v=…" → "YouTube"). */
export function siteOf(url: string): string {
  let host = ''
  try {
    host = new URL(String(url)).hostname.toLowerCase()
  } catch {
    return ''
  }
  host = host.replace(/^www\.|^m\./, '')
  if (!host || host === 'newtab' || /^(localhost|127\.|\d+\.\d+\.\d+\.\d+$)/.test(host)) return ''
  const known = Object.keys(SITES).find((d) => host === d || host.endsWith(`.${d}`))
  return known ? SITES[known] : host.slice(0, 40)
}

/** Which ActivityWatch buckets to read: the window watcher and the browser ones. */
export function awBuckets(b: AwBuckets): { window: string[]; web: string[] } {
  const ids = Object.entries(b ?? {}).map(([id, v]) => ({ id, type: String(v?.type ?? '') }))
  return { window: ids.filter((x) => x.type === 'currentwindow').map((x) => x.id), web: ids.filter((x) => x.type === 'web.tab.current').map((x) => x.id) }
}

const add = (m: Map<string, number>, k: string, sec: number) => {
  if (k && sec > 0) m.set(k, (m.get(k) ?? 0) + sec)
}
const clipSec = (e: AwEvent, from: number, to: number) => {
  const a = Date.parse(e.timestamp)
  if (!Number.isFinite(a)) return 0
  const b = a + Math.max(0, Number(e.duration) || 0) * 1000
  return Math.max(0, (Math.min(b, to) - Math.max(a, from)) / 1000)
}

/** The summary line: top 5, 2+ minutes each. */
export function useLine(items: UseItem[]): string {
  return items.map((i) => `${i.min} min ${i.name}`).join(', ')
}
const top = (m: Map<string, number>): UseItem[] =>
  [...m]
    .map(([name, sec]) => ({ name, min: Math.round(sec / 60) }))
    .filter((i) => i.min >= 2)
    .sort((a, b) => b.min - a.min)
    .slice(0, 5)

/**
 * ActivityWatch's last hour: apps from the window bucket; browser time is
 * split by site from the web bucket (the browser itself counts only for what
 * no site covers). Titles are read nowhere.
 */
export function awSummary(win: AwEvent[], web: AwEvent[], from: number, to: number): LastHour {
  const apps = new Map<string, number>()
  let browserSec = 0
  for (const e of win ?? []) {
    const app = String(e?.data?.app ?? '')
    const sec = clipSec(e, from, to)
    if (BROWSERS.test(app.trim())) browserSec += sec
    else add(apps, niceApp(app), sec)
  }
  const sites = new Map<string, number>()
  for (const e of web ?? []) add(sites, siteOf(String(e?.data?.url ?? '')), clipSec(e, from, to))
  const siteSec = [...sites.values()].reduce((t, s) => t + s, 0)
  // Without a browser watcher, the browser counts as itself.
  if (!sites.size && browserSec) add(apps, 'Browser', browserSec)
  else if (browserSec > siteSec + 120) add(apps, 'Browser (other)', browserSec - siteSec)
  for (const [k, v] of sites) add(apps, k, v)
  const items = top(apps)
  return { at: to, src: 'activitywatch', items, line: useLine(items) }
}

/**
 * The desktop's own feed (Smart island events): each app event runs until
 * the next app or away event (idle, lock, sleep). Labels are friendly app
 * names (or a site, like "YouTube", when window titles are on).
 */
export function streamSummary(events: ActivityEvent[], from: number, to: number): LastHour {
  const list = [...(events ?? [])].sort((a, b) => a.at - b.at)
  const m = new Map<string, number>()
  let cur: { label: string; at: number } | null = null
  const close = (at: number) => {
    if (cur) add(m, cur.label, Math.max(0, (Math.min(at, to) - Math.max(cur.at, from)) / 1000))
    cur = null
  }
  let last: string | null = null
  for (const e of list) {
    if (e.at > to) break
    if (e.t === 'app') {
      close(e.at)
      last = e.label
      cur = { label: e.label, at: e.at }
    } else if (e.t === 'idle' || e.t === 'lock' || e.t === 'sleep') close(e.at)
    else if ((e.t === 'active' || e.t === 'unlock' || e.t === 'wake') && !cur && last) cur = { label: last, at: e.at }
  }
  close(to)
  const items = top(m)
  return { at: to, src: 'built-in', items, line: useLine(items) }
}

/** Fresh enough for Ben (written in the last 75 minutes)? */
export const lastHourFresh = (h: { at: number } | null | undefined, now: number) => !!h && Number.isFinite(h.at) && now - h.at < 75 * 60_000 && now - h.at > -5 * 60_000

/** The setting as stored (pc_last_hour), cleaned: short names, small numbers only. */
export function cleanLastHour(v: unknown): LastHour | null {
  const o = v as Partial<LastHour> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.items) || !Number.isFinite(Number(o.at))) return null
  const items = o.items
    .map((i) => ({ name: String(i?.name ?? '').replace(/[\r\n]+/g, ' ').slice(0, 40), min: Math.max(0, Math.min(60, Math.round(Number(i?.min) || 0))) }))
    .filter((i) => i.name && i.min > 0)
    .slice(0, 5)
  return { at: Number(o.at), src: o.src === 'activitywatch' ? 'activitywatch' : 'built-in', items, line: useLine(items) }
}

/** Ben's line: "Last hour on his PC (14:05): 35 min YouTube, 10 min VS Code." */
export function lastHourContext(h: LastHour | null, now: number): string {
  if (!h || !lastHourFresh(h, now) || !h.items.length) return ''
  const hm = new Date(h.at).toTimeString().slice(0, 5)
  return `Last hour on his PC (desktop app, as of ${hm}): ${h.line}. If that doesn't fit what his plan says for now, gently call out the drift in one line (no lecture).`
}
