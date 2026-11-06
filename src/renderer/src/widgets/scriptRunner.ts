// PL5, the island side: runs your scripts on their own slow clocks, each run
// in a fresh Web Worker (from a blob; locked down before your code runs) that
// is ended after its time limit. A script that keeps running over is paused
// ("slowed down", PL11). Results feed the script tiles on the island pages.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import { widgetData } from '@core/widgets/bridge'
import { budgetStep, FRESH_BUDGET, type Budget } from '@core/widgets/budget'
import { runScript, type WorkerLike } from '@core/widgets/scriptRun'
import { cleanScripts, type UserScript } from '@core/widgets/scripts'
import { askApp, confirmAsk } from './widgetHost'

export interface ScriptTileState { show: { text: string; icon: string } | null; error?: string; at: number; slowed?: string }
let tiles: Record<string, ScriptTileState> = {}
const subs = new Set<() => void>()
const setTile = (id: string, t: ScriptTileState) => {
  tiles = { ...tiles, [id]: t }
  subs.forEach((f) => f())
}
export const useScriptTiles = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => tiles)

const budgets = new Map<string, Budget>()
const lastRun = new Map<string, number>()
const lastNotify = new Map<string, number>()

function blobWorker(source: string): WorkerLike {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  const w = new Worker(url, { name: 'life-user-script' })
  URL.revokeObjectURL(url)
  return { postMessage: (m) => w.postMessage(m), onMessage: (fn) => void (w.onmessage = (e) => fn(e.data)), terminate: () => w.terminate() }
}

/** Runs one script now (also the "Run now" button). */
export async function runNow(s: UserScript, snap: IslandSnapshot): Promise<void> {
  const now = Date.now()
  lastRun.set(s.id, now)
  const d = new Date(now)
  const r = await runScript(s, { now, hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay(), today: widgetData(snap, now, { read: true }).today ?? null }, {
    makeWorker: blobWorker,
    onCall: async (c) => {
      if (c.op === 'addTask') {
        if (!(await confirmAsk({ who: s.name, what: 'add a task', text: c.text }))) throw new Error('You said no')
        return askApp({ kind: 'widget', op: 'addTask', widget: `script:${s.id}`, text: c.text })
      }
      return JSON.parse(await askApp({ kind: 'widget', op: 'fetch', widget: `script:${s.id}`, url: c.url }))
    }
  })
  let b = budgets.get(s.id) ?? FRESH_BUDGET
  if (r.timedOut) b = budgetStep(b, { kind: 'timeout' }, now)
  budgets.set(s.id, b)
  setTile(s.id, { show: r.show, ...(r.error ? { error: r.error } : {}), at: now, ...(b.slowed ? { slowed: b.why } : {}) })
  // notify(): a notice on the island, at most once every 10 minutes per script.
  if (r.notify && now - (lastNotify.get(s.id) ?? 0) > 10 * 60_000) {
    lastNotify.set(s.id, now)
    void askApp({ kind: 'widget', op: 'notify', widget: `script:${s.id}`, text: r.notify }).catch(() => {})
  }
}

/** Try a slowed-down script again. */
export function unslow(id: string): void {
  budgets.delete(id)
  setTile(id, { ...(tiles[id] ?? { show: null, at: 0 }), slowed: undefined })
}

/** The island window's clock for your scripts (one 20 s check; each script runs at its own rate). */
export function useScriptClock(s: IslandSnapshot, tap?: (a: IslandAction) => void): void {
  void tap
  const snap = useRef(s)
  snap.current = s
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || snap.current.locked) return
      const list = cleanScripts((snap.current.widgets as { scripts?: unknown } | undefined)?.scripts)
      const now = Date.now()
      for (const sc of list) {
        if (!sc.on || budgets.get(sc.id)?.slowed) continue
        if (now - (lastRun.get(sc.id) ?? 0) < sc.every * 1000) continue
        void runNow(sc, snap.current)
        break // one script per check: never a burst
      }
    }, 20_000)
    return () => clearInterval(t)
  }, [])
}
