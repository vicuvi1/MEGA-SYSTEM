// The island's side of widget calls: asks you to confirm (drawn by the
// island, outside any widget's box, so a widget can't click it), plays the
// sounds, and passes network / add calls to the app window, which checks
// them again before doing them.
import { useSyncExternalStore } from 'react'
import type { IslandAction } from '@core/islandModel'
import type { WidgetCall, WidgetSound } from '@core/widgets/bridge'
import { play } from '../soundKit'

// ---- Confirm ----

export interface ConfirmAsk { who: string; what: string; text: string }
let asking: (ConfirmAsk & { answer: (yes: boolean) => void }) | null = null
const subs = new Set<() => void>()
const changed = () => subs.forEach((f) => f())
let shown = 0
/** The confirm card is on screen (it counts itself in and out). */
export function confirmShown(on: boolean): void {
  shown = Math.max(0, shown + (on ? 1 : -1))
  if (!shown && asking) asking.answer(false)
}
export const useConfirmAsk = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => asking)

/** Shows "<who> wants to <what>: “text”" with Add / No. One at a time; a second ask while one is open is a no. */
export function confirmAsk(a: ConfirmAsk): Promise<boolean> {
  // Nobody can see the question (the island is closed): no.
  if (asking || shown === 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => answer(false), 60_000)
    const answer = (yes: boolean) => {
      clearTimeout(timer)
      asking = null
      changed()
      resolve(yes)
    }
    asking = { ...a, answer }
    changed()
  })
}

// ---- The app window ----

type Ack = { id: string; ok: boolean; error?: string; text?: string }
const waits = new Map<string, { ok: (t: string) => void; no: (e: Error) => void }>()
let listening = false

/** Sends a widget action to the app window and waits for its answer (the ack's text). */
export function askApp(a: Extract<IslandAction, { kind: 'widget' }>): Promise<string> {
  const desk = window.desktop
  if (!desk?.islandAction) return Promise.reject(new Error('This works in the Windows app'))
  if (!listening && desk.onIslandAck) {
    listening = true
    desk.onIslandAck((ack: Ack) => {
      const w = waits.get(ack.id)
      if (!w) return
      waits.delete(ack.id)
      ack.ok ? w.ok(ack.text ?? '') : w.no(new Error(ack.error || 'Refused'))
    })
  }
  const id = `wg${Math.random().toString(36).slice(2, 10)}`
  return new Promise((ok, no) => {
    const t = window.setTimeout(() => (waits.delete(id), no(new Error('The app didn’t answer'))), 15_000)
    waits.set(id, { ok: (v) => (clearTimeout(t), ok(v)), no: (e) => (clearTimeout(t), no(e)) })
    desk.islandAction!({ ...a, id })
  })
}

const SOUND: Record<WidgetSound, Parameters<typeof play>[0]> = { done: 'success', tick: 'tick', chime: 'focusEnd' }

/** What a checked call from widget `id` does on the island. */
export function islandCall(id: string, name: string): (c: WidgetCall) => Promise<unknown> {
  return async (c) => {
    if (c.op === 'sound') {
      play(SOUND[c.name])
      return true
    }
    if (c.op === 'addTask' || c.op === 'addNote') {
      if (!(await confirmAsk({ who: name, what: c.op === 'addTask' ? 'add a task' : 'add a note', text: c.text }))) throw new Error('You said no')
      await askApp({ kind: 'widget', op: c.op, widget: id, text: c.text })
      return true
    }
    return JSON.parse(await askApp({ kind: 'widget', op: 'fetch', widget: id, url: c.url }))
  }
}

/** The island's colours, for inside the widgets' boxes. */
export function themeVars(): Record<string, string> {
  const el = document.querySelector('.di') ?? document.documentElement
  const cs = getComputedStyle(el)
  const v = (k: string) => cs.getPropertyValue(k).trim()
  return { fg: v('--fg') || '#f5f5f6', sub: v('--sub') || '#9a9aa0', acc: v('--lime') || v('--accent') || '#d4ff3f', line: v('--line') || 'rgb(255 255 255 / 0.1)' }
}
