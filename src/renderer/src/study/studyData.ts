// Study Time on this page: the blocks, the sessions and the running timer,
// read once and kept fresh after a change here, on the island or from
// another device. Writes go through life.study (src/main/studyTime.ts).
import { useCallback, useEffect, useState } from 'react'
import { addDays, dayKey } from '@core/dates'
import { cleanStore, type StudySession, type StudyStore } from '@core/studyTime'
import type { FocusState } from '@shared/api'
import { life } from '../bridge'

export const EMPTY: StudyStore = { v: 1, blocks: [], categories: [] }
export type Running = NonNullable<FocusState['running']> & { blockId?: string | null; open?: boolean; breakMin?: number | null }

/** The days of sessions this page reads (custom ranges reach back further when asked). */
export const SESSION_DAYS = 400

export function useStudy() {
  const [store, setStore] = useState<StudyStore | null>(null)
  const [sessions, setSessions] = useState<StudySession[]>([])
  const [run, setRun] = useState<Running | null>(null)
  const [ready, setReady] = useState(false)
  const load = useCallback(async () => {
    if (!life.study) return setReady(true)
    const today = dayKey(new Date())
    const [b, s, f] = await Promise.all([life.study.blocks().catch(() => null), life.study.sessions(addDays(today, -SESSION_DAYS)).catch(() => []), life.focus.state().catch(() => null)])
    // An empty store gets the made-up starter blocks once (you edit or remove them).
    setStore(b ? cleanStore(b) : await life.study.change({ op: 'starter' }).catch(() => EMPTY))
    setSessions(s)
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
