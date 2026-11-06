// PL2 / PL8: your widgets, pages, scripts and island look in one synced
// setting (`island_widgets`), so every PC shows the same. Screen positions
// stay on each PC (the desktop's own file). Pure and tested (settings.test.ts).
import { cleanGrants, fullGrants, type WidgetGrants } from './bridge'
import { cleanConfig, type WidgetManifest } from './manifest'
import { cleanPagesPrefs, isPageId, type PagesPrefs } from './pages'
import { cleanScripts, type UserScript } from './scripts'
import { REST_IDLE, type RestIdle } from '../islandRest'

export interface InstalledWidget {
  id: string
  version: string
  /** The hash you installed: code that doesn't match never runs (PL3). */
  sha256: string
  grants: WidgetGrants
  /** The island page it sits on, and its place there. */
  page: string
  config: Record<string, string>
  at: string
}

// ---- The island's look (BrimDeck-style, inspiration only) ----

/** notch: flush with the top edge, round bottom corners; capsule: the floating pill; indicator: a thin bar. */
export type IslandStyle = 'notch' | 'capsule' | 'indicator'
export const ISLAND_STYLES: IslandStyle[] = ['notch', 'capsule', 'indicator']
export const STYLE_LABEL: Record<IslandStyle, string> = { notch: 'Notch (on the top edge)', capsule: 'Capsule (floating pill)', indicator: 'Thin bar' }
export type ClockStyle = 'off' | 'simple' | 'segment' | 'serif'
export const CLOCK_STYLES: ClockStyle[] = ['off', 'simple', 'segment', 'serif']
export const CLOCK_LABEL: Record<ClockStyle, string> = { off: 'Plain, only when idle', simple: 'Simple', segment: 'Seven-segment', serif: 'Serif' }
export type IslandThemeId = 'dark' | 'light' | 'onedark' | 'ghdark' | 'ghlight' | 'dracula' | 'nightowl' | 'cyberpunk'
export const ISLAND_THEMES: IslandThemeId[] = ['dark', 'light', 'onedark', 'ghdark', 'ghlight', 'dracula', 'nightowl', 'cyberpunk']
export const THEME_LABEL: Record<IslandThemeId, string> = { dark: 'Dark', light: 'Light', onedark: 'One Dark Pro', ghdark: 'GitHub Dark', ghlight: 'GitHub Light', dracula: 'Dracula', nightowl: 'Night Owl', cyberpunk: 'Cyberpunk' }

export interface IslandLookPrefs {
  style: IslandStyle
  /** A thin bar while a window is maximized on the island's screen. */
  maxBar: boolean
  clock: ClockStyle
  /** The clock's colour (#rrggbb), or '' for the theme's. */
  clockColor: string
  theme: IslandThemeId
  /** Open the whole panel on hover (not just the peek); moving away or Esc closes it. */
  hoverOpen: boolean
  /** What the closed island shows when nothing is happening (core/islandRest.ts). */
  rest: RestIdle
}
export const DEFAULT_LOOK: IslandLookPrefs = { style: 'notch', maxBar: true, clock: 'off', clockColor: '', theme: 'dark', hoverOpen: false, rest: 'next' }

/** PL8: island settings that follow you to every PC (the rest of the island's settings stay on each PC). */
export interface SyncedLayout {
  pillOrder: { id: string; on: boolean }[] | null
  look: string | null
  /** When it last changed (ms). */
  at: number
}

export interface WidgetsSetting {
  installed: InstalledWidget[]
  pages: PagesPrefs
  scripts: UserScript[]
  look: IslandLookPrefs
  layout: SyncedLayout
}

export const WIDGETS_MAX = 12
export const DEFAULT_WIDGETS: WidgetsSetting = { installed: [], pages: cleanPagesPrefs(null), scripts: [], look: DEFAULT_LOOK, layout: { pillOrder: null, look: null, at: 0 } }

const HEX64 = /^[0-9a-f]{64}$/
const COLOR = /^#[0-9a-f]{6}$/i

export function cleanLook(v: any, fallbackStyle: IslandStyle = 'notch'): IslandLookPrefs {
  return {
    style: ISLAND_STYLES.includes(v?.style) ? v.style : fallbackStyle,
    maxBar: v?.maxBar !== false,
    clock: CLOCK_STYLES.includes(v?.clock) ? v.clock : 'off',
    clockColor: typeof v?.clockColor === 'string' && COLOR.test(v.clockColor) ? v.clockColor.toLowerCase() : '',
    theme: ISLAND_THEMES.includes(v?.theme) ? v.theme : 'dark',
    hoverOpen: v?.hoverOpen === true,
    rest: REST_IDLE.includes(v?.rest) ? v.rest : 'next'
  }
}

function cleanLayout(v: any): SyncedLayout {
  const order = Array.isArray(v?.pillOrder) ? v.pillOrder.filter((x: any) => x && /^[a-z]{1,16}$/.test(String(x.id))).slice(0, 20).map((x: any) => ({ id: String(x.id), on: x.on !== false })) : null
  const look = typeof v?.look === 'string' && /^[a-z]{1,12}$/.test(v.look) ? v.look : null
  return { pillOrder: order, look, at: Number.isFinite(v?.at) ? Number(v.at) : 0 }
}

/**
 * Any saved value → a valid setting. `manifests` are the widgets this app
 * version knows; an installed widget it doesn't know is kept as it is (a newer
 * PC may have it). `fallbackStyle`: the look for someone who never chose one.
 */
export function cleanWidgets(v: any, manifests: Record<string, WidgetManifest> = {}, fallbackStyle: IslandStyle = 'notch'): WidgetsSetting {
  const installed: InstalledWidget[] = []
  for (const w of Array.isArray(v?.installed) ? v.installed : []) {
    if (!w || typeof w.id !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(w.id) || !HEX64.test(String(w.sha256)) || installed.some((x) => x.id === w.id)) continue
    const m = manifests[w.id]
    installed.push({
      id: w.id,
      version: typeof w.version === 'string' ? w.version.slice(0, 12) : '0.0.0',
      sha256: w.sha256,
      grants: m ? cleanGrants(m, w.grants) : { read: w.grants?.read === true, network: Array.isArray(w.grants?.network) ? w.grants.network.filter((h: unknown) => typeof h === 'string').slice(0, 5) : [], add: w.grants?.add === true, sound: w.grants?.sound === true },
      page: isPageId(w.page) ? w.page : 'home',
      config: m ? cleanConfig(m, w.config) : {},
      at: typeof w.at === 'string' ? w.at.slice(0, 30) : ''
    })
    if (installed.length >= WIDGETS_MAX) break
  }
  return { installed, pages: cleanPagesPrefs(v?.pages), scripts: cleanScripts(v?.scripts), look: cleanLook(v?.look, fallbackStyle), layout: cleanLayout(v?.layout) }
}

/** Install from the gallery: pinned to the gallery's hash, with the permissions you just said yes to. */
export function installWidget(s: WidgetsSetting, m: WidgetManifest, sha256: string, page: string, now: Date, grants: WidgetGrants = fullGrants(m)): WidgetsSetting {
  if (!HEX64.test(sha256)) return s
  const rest = s.installed.filter((w) => w.id !== m.id)
  if (rest.length >= WIDGETS_MAX) return s
  return { ...s, installed: [...rest, { id: m.id, version: m.version, sha256, grants: cleanGrants(m, grants), page: isPageId(page) ? page : 'home', config: {}, at: now.toISOString() }] }
}

export function removeWidget(s: WidgetsSetting, id: string): WidgetsSetting {
  return { ...s, installed: s.installed.filter((w) => w.id !== id) }
}

/** Revoke (or give back) one permission. Network: the host list you allow now. */
export function setGrant(s: WidgetsSetting, m: WidgetManifest, id: string, patch: Partial<WidgetGrants>): WidgetsSetting {
  return { ...s, installed: s.installed.map((w) => (w.id === id ? { ...w, grants: cleanGrants(m, { ...w.grants, ...patch }) } : w)) }
}

export function patchWidget(s: WidgetsSetting, m: WidgetManifest, id: string, patch: { page?: string; config?: Record<string, string> }): WidgetsSetting {
  return { ...s, installed: s.installed.map((w) => (w.id === id ? { ...w, page: patch.page && isPageId(patch.page) ? patch.page : w.page, config: patch.config ? cleanConfig(m, patch.config) : w.config } : w)) }
}

/**
 * PL8: a three-way merge of the island layout. `local`: this PC's pill order
 * and look now; `synced`: the setting; `seen`: what this PC last synced.
 * Changed here → push it; changed elsewhere → take it; both → the newer wins.
 */
export function mergeLayout(local: { pillOrder: { id: string; on: boolean }[]; look: string }, synced: SyncedLayout, seen: { pillOrder: { id: string; on: boolean }[] | null; look: string | null } | null, now: number): { push: SyncedLayout | null; apply: { pillOrder?: { id: string; on: boolean }[]; look?: string } | null } {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const localChanged = !seen || !same(seen.pillOrder, local.pillOrder) || seen.look !== local.look
  const remoteChanged = !!seen ? !same(seen.pillOrder, synced.pillOrder) || seen.look !== synced.look : synced.at > 0
  const remoteHas = synced.at > 0 && (synced.pillOrder || synced.look)
  if (!remoteHas) return { push: { pillOrder: local.pillOrder, look: local.look, at: now }, apply: null }
  if (same(synced.pillOrder, local.pillOrder) && synced.look === local.look) return { push: null, apply: null }
  // First time on this PC: the synced layout wins (it's how you set your island up elsewhere).
  if (!seen || (remoteChanged && !localChanged)) return { push: null, apply: { ...(synced.pillOrder ? { pillOrder: synced.pillOrder } : {}), ...(synced.look ? { look: synced.look } : {}) } }
  if (localChanged && !remoteChanged) return { push: { pillOrder: local.pillOrder, look: local.look, at: now }, apply: null }
  // Both changed since the last sync: this PC's change is the newer one.
  return { push: { pillOrder: local.pillOrder, look: local.look, at: now }, apply: null }
}
