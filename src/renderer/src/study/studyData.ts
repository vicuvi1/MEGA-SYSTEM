// Study Time on this page: the blocks, the sessions and the running timer,
// read once and kept fresh after a change here, on the island or from
// another device. Writes go through life.study (src/main/studyTime.ts).
// Your study tasks from Todoist are pulled in as blocks (the existing Tasks
// sync: life.todoist.everything, never a second Todoist client).
import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, dayKey } from '@core/dates'
import { cleanStore, prefsOf, resolveBlocks, type StudyRun, type StudySession, type StudyStore, type TodoLite } from '@core/studyTime'
import type { FocusState } from '@shared/api'
import type { TodoTask } from '@core/todoist'
import { life } from '../bridge'

export const EMPTY: StudyStore = { v: 1, blocks: [], categories: [] }
export type Running = NonNullable<FocusState['running']> & Partial<Pick<StudyRun, 'blockId' | 'open' | 'breakMin' | 'pauseKind' | 'brkMs' | 'pomo'>>

/** The days of sessions this page reads (custom ranges reach back further when asked). */
export const SESSION_DAYS = 400

/** Open Todoist tasks from the last read (for Done on a linked block, and the study-task picker). */
let todoCache: TodoTask[] = []
export const todoTasks = () => todoCache

export const toLite = (t: TodoTask): TodoLite => ({ id: t.id, content: t.content, due: t.due, project: t.project, section: t.section ?? null, labels: t.labels ?? [], duration: t.duration ?? null, recurring: t.recurring })

/** Reads your open Todoist tasks and brings your study ones in as blocks (when you chose projects or labels). */
export async function pullTodoist(store: StudyStore | null): Promise<StudyStore | null> {
  const r = await life.todoist?.everything?.().catch(() => null)
  if (!r) return null
  todoCache = r.tasks
  const rule = prefsOf(store ?? EMPTY).todoist
  if (!life.study || (!rule.projects.length && !rule.labels.length)) return null
  return life.study.change({ op: 'todoist', tasks: r.tasks.map(toLite) })
}

export function useStudy() {
  const [store, setStore] = useState<StudyStore | null>(null)
  const [sessions, setSessions] = useState<StudySession[]>([])
  const [run, setRun] = useState<Running | null>(null)
  const [ready, setReady] = useState(false)
  const pulled = useRef(0)
  const load = useCallback(async () => {
    if (!life.study) return setReady(true)
    const today = dayKey(new Date())
    const [b, s, f] = await Promise.all([life.study.blocks().catch(() => null), life.study.sessions(addDays(today, -SESSION_DAYS)).catch(() => []), life.focus.state().catch(() => null)])
    // An empty store gets the made-up starter blocks once (you edit or remove them).
    let st = b ? cleanStore(b) : await life.study.change({ op: 'starter' }).catch(() => EMPTY)
    // Todoist: your study tasks as blocks, at most every 2 minutes.
    if (Date.now() - pulled.current > 120_000) {
      pulled.current = Date.now()
      const next = await pullTodoist(st).catch(() => null)
      if (next) st = cleanStore(next)
    }
    setStore(st)
    // Plain focus sessions take the block of the same name, else count under "No block".
    setSessions(resolveBlocks(s, st))
    setRun((f?.running as Running) ?? null)
    setReady(true)
  }, [])
  useEffect(() => {
    void load()
    const again = () => void load()
    const evs = ['life-focus-changed', 'life-study-changed', 'life-external-changed', 'life-wallet-changed']
    for (const e of evs) window.addEventListener(e, again)
    return () => {
      for (const e of evs) window.removeEventListener(e, again)
    }
  }, [load])
  return { store: store ?? EMPTY, sessions, run, ready, reload: load, setStore }
}

/** The time, every second, while `on` (the big clock). */
export function useTick(on: boolean, ms = 1000): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    setN(Date.now())
    const t = setInterval(() => setN(Date.now()), ms)
    return () => clearInterval(t)
  }, [on, ms])
  return on ? n : Date.now()
}

/** "09:05" */
export const hhmm = (iso: string | number) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
