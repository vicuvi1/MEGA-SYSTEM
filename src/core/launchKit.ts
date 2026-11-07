// DX9: a launch kit for each kind of focus block. A kit remembers what that
// work needs (apps, folders, links, a music station); one tap on Start opens
// all of it, so the 5 minutes of setup where people drift off are gone.
//
// What is and isn't possible, plainly:
// - Desktop app: apps, folders and links open through the automation hub's
//   checked "workspace" call (src/desktop/automations.ts: the never-list,
//   https/http links only, real paths only). "End kit" asks only the apps the
//   kit itself opened to close; your other apps are never touched.
// - Website: only links can open (a browser can't start apps or open
//   folders), and a pop-up blocker may allow just the first one.
// - Closing distracting browser tabs is not possible: Life System has no
//   browser extension, and a page can't see or close another site's tabs.
// Pure and tested (launchKit.test.ts).
import { cleanWorkspace, type Workspace } from './automations'
import { kindOf, type TaskKind } from './benLearn'

export interface LaunchKit {
  id: string
  name: string
  /** Which blocks it is for: a kind of work (code, study, write…) and/or words in the title. */
  kinds: TaskKind[]
  words: string[]
  apps: string[]
  folders: string[]
  links: string[]
  /** A SoundCloud address (a station from your Music page), or null. */
  station: string | null
  /** When the timer ends, ask the apps this kit opened to close (desktop only). */
  closeOnEnd: boolean
  /** Open by itself when a matching timer starts (otherwise a button asks). */
  auto: boolean
}

export const KIT_KINDS: { id: TaskKind; label: string }[] = [
  { id: 'code', label: 'Coding' },
  { id: 'study', label: 'Study' },
  { id: 'write', label: 'Writing' },
  { id: 'read', label: 'Reading' },
  { id: 'admin', label: 'Admin' },
  { id: 'chores', label: 'Chores' },
  { id: 'sport', label: 'Workout' },
  { id: 'other', label: 'Anything else' }
]
const KIND_IDS = new Set<string>(KIT_KINDS.map((k) => k.id))
export const KITS_MAX = 8

const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, n)
const list = (v: unknown, n: number, len: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean))].slice(0, n)

/** A link that may open: http(s) only. */
export function okLink(u: string): boolean {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' || x.protocol === 'http:'
  } catch {
    return false
  }
}
/** A folder that looks like a real full path (C:\…, \\server\…, /home/…), never one that climbs up. */
export const okFolder = (p: string) => (/^([a-z]:\\|\\\\)/i.test(p) || p.startsWith('/')) && !/\.\.[\\/]/.test(p)
const okSc = (u: string) => /^https:\/\/(www\.|m\.)?soundcloud\.com\//i.test(u)

export function cleanKit(raw: unknown, i = 0): LaunchKit | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Partial<LaunchKit> | null
  if (!o) return null
  const name = clip(o.name, 40) || `Kit ${i + 1}`
  const id = /^[a-z0-9_-]{1,24}$/i.test(String(o.id ?? '')) ? String(o.id) : `kit${i + 1}`
  const kinds = (Array.isArray(o.kinds) ? o.kinds : []).filter((k): k is TaskKind => KIND_IDS.has(String(k))).slice(0, 4)
  const station = typeof o.station === 'string' && okSc(o.station) ? o.station.slice(0, 300) : null
  return {
    id,
    name,
    kinds,
    words: list(o.words, 6, 30).map((w) => w.toLowerCase()),
    apps: list(o.apps, 8, 40),
    folders: list(o.folders, 4, 300).filter(okFolder),
    links: list(o.links, 8, 500).filter(okLink),
    station,
    closeOnEnd: o.closeOnEnd === true,
    auto: o.auto === true
  }
}
export function cleanKits(raw: unknown): LaunchKit[] {
  const seen = new Set<string>()
  return (Array.isArray(raw) ? raw : [])
    .map((k, i) => cleanKit(k, i))
    .filter((k): k is LaunchKit => !!k && !seen.has(k.id) && (seen.add(k.id), true))
    .slice(0, KITS_MAX)
}
export const newKit = (n: number, kind: TaskKind = 'code'): LaunchKit => ({ id: `kit${Date.now().toString(36).slice(-5)}${n}`, name: KIT_KINDS.find((k) => k.id === kind)?.label ?? 'My kit', kinds: [kind], words: [], apps: [], folders: [], links: [], station: null, closeOnEnd: false, auto: false })

/** The kit for a block or timer title: a word match first, then its kind of work. */
export function kitFor(kits: LaunchKit[], title: string): LaunchKit | null {
  const t = String(title ?? '').toLowerCase()
  if (!t.trim()) return null
  const byWord = kits.find((k) => k.words.some((w) => w && t.includes(w)))
  if (byWord) return byWord
  const kind = kindOf(t)
  return kits.find((k) => k.kinds.includes(kind)) ?? null
}

/** The desktop's checked workspace for this kit (null: nothing for the desktop to open). Folders beyond the first open as files. */
export function kitWorkspace(k: LaunchKit): Workspace | null {
  const [folder, ...more] = k.folders
  return cleanWorkspace({ apps: k.apps, links: k.links, files: more, folder })
}
/** What the website can open: links only. */
export const webLinks = (k: LaunchKit) => k.links.filter(okLink)
export const kitEmpty = (k: LaunchKit) => !k.apps.length && !k.folders.length && !k.links.length && !k.station

/** "VS Code, 1 folder, 2 links, music" for a button. */
export function kitSummary(k: LaunchKit): string {
  const parts = [...k.apps.slice(0, 2), k.apps.length > 2 ? `+${k.apps.length - 2} apps` : '', k.folders.length ? `${k.folders.length} folder${k.folders.length > 1 ? 's' : ''}` : '', k.links.length ? `${k.links.length} link${k.links.length > 1 ? 's' : ''}` : '', k.station ? 'music' : ''].filter(Boolean)
  return parts.join(', ') || 'empty'
}

/** What this kit can open where you are (honest about the website). */
export function kitReach(k: LaunchKit, desktop: boolean): { opens: string[]; skipped: string[] } {
  if (desktop) return { opens: [...k.apps, ...k.folders.map((f) => f.split(/[\\/]/).filter(Boolean).pop() ?? f), ...k.links.map((l) => new URL(l).hostname)], skipped: [] }
  return { opens: webLinks(k).map((l) => new URL(l).hostname), skipped: [...k.apps, ...k.folders.map(() => 'a folder')] }
}

export const KIT_LIMITS = 'Apps and folders open only in the desktop app. Closing other browser tabs is not possible (no browser extension), and End kit closes only the apps this kit opened.'
