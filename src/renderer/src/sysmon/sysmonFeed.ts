// The island window's side of the System and AI usage pages: your settings
// for them (kept by the desktop, this PC only), Ben's AI numbers (from
// /api/ai, the same ones Settings → Ben's brain shows) and this PC's coding
// tools (read by the desktop from their log files). Everything is asked for
// only when a page or a reading that needs it is on.
import { useEffect, useState } from 'react'
import { benUsage, type BenUsageReport, type ToolUsage } from '@core/aiUsage'
import { cleanSysmonPrefs, DEFAULT_SYSMON, readsLocalUsage, type SysmonPrefs } from '@core/sysmon'
import { currentSession } from '../web/session'

const desk = () => (typeof window !== 'undefined' ? window.desktop : undefined)
export const hasSysmon = () => !!desk()?.sysmon

let prefs: SysmonPrefs = DEFAULT_SYSMON
let loaded = false
const subs = new Set<(p: SysmonPrefs) => void>()
const setPrefsLocal = (p: SysmonPrefs) => {
  prefs = p
  loaded = true
  subs.forEach((f) => f(p))
}
let listening = false
function listen() {
  if (listening || !hasSysmon()) return
  listening = true
  desk()!.onSysmonPrefs?.((p) => setPrefsLocal(cleanSysmonPrefs(p)))
  void desk()!.sysmon!('prefs').then((p) => setPrefsLocal(cleanSysmonPrefs(p))).catch(() => {})
}

/** Your settings for these pages, kept up to date. */
export function onSysmonPrefs(fn: (p: SysmonPrefs) => void): () => void {
  listen()
  subs.add(fn)
  if (loaded) fn(prefs)
  return () => void subs.delete(fn)
}
export function useSysmonPrefs(): SysmonPrefs | null {
  const [p, setP] = useState<SysmonPrefs | null>(loaded ? prefs : null)
  useEffect(() => onSysmonPrefs(setP), [])
  return p
}
export async function saveSysmonPrefs(patch: Partial<SysmonPrefs>): Promise<SysmonPrefs | null> {
  const r = await desk()?.sysmon?.('setPrefs', { ...prefs, ...patch }).catch(() => null)
  if (r) setPrefsLocal(cleanSysmonPrefs(r))
  return r ? prefs : null
}

/** AI usage is in use: the page or the rings. */
export const aiOn = (p: SysmonPrefs) => p.pages.ai || p.readings.rings

// ---- Ben's AI (cached: at most every 5 minutes, or 15 when only the rings ask) ----
let ben: { at: number; v: ToolUsage | null } = { at: 0, v: null }
export async function benColumn(maxAgeMs: number): Promise<ToolUsage | null> {
  const now = Date.now()
  if (now - ben.at < maxAgeMs) return ben.v
  ben.at = now
  try {
    const r = await fetch('/api/ai', { method: 'POST', headers: { Authorization: `Bearer ${currentSession() ?? ''}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'usage' }), signal: AbortSignal.timeout(10_000) })
    if (!r.ok) return ben.v
    ben.v = benUsage((await r.json()) as BenUsageReport, now)
  } catch {
    /* keep the last numbers */
  }
  return ben.v
}

/** All columns: this PC's coding tools, then Ben (each only when switched on). */
export async function usageColumns(p: SysmonPrefs, o: { fresh?: boolean; benMaxAge: number }): Promise<{ tools: ToolUsage[]; found: { claude: boolean; codex: boolean } }> {
  const local = readsLocalUsage(p) ? await desk()?.sysmon?.('usage', { fresh: o.fresh }).catch(() => null) : null
  const tools: ToolUsage[] = [...(local?.tools ?? [])]
  if (p.tools.ben) {
    const b = await benColumn(o.benMaxAge)
    if (b) tools.push(b)
  }
  return { tools: tools.slice(0, 7), found: local?.found ?? { claude: false, codex: false } }
}

// ---- Alerts: told once per window (this PC's island only) ----
const TOLD = 'ls.sysmonTold'
export function readTold(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(TOLD) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function saveTold(list: string[]) {
  try {
    localStorage.setItem(TOLD, JSON.stringify(list.slice(-40)))
  } catch {
    /* fine */
  }
}
