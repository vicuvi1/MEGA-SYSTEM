// Small pieces of the Today list (LT11: split out of DayFlow.tsx): add an area, the task tabs, the running clock.
import { useEffect, useState } from 'react'
import type { TodoTask } from '@core/todoist'
import { useTicker } from '../useTicker'
import { clock } from './util'
import { barFill } from '../motionKit'

/** A quick "+ Add to University" under each area (due today unless you say when). */
export function AreaAdd({ name, onAdd }: { name: string; onAdd: (v: string) => Promise<boolean> }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="dl-area-add"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!v.trim() || busy) return
        setBusy(true)
        if (await onAdd(v)) setV('')
        setBusy(false)
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`+ Add to ${name} (today, or "fri 18:00")`} maxLength={300} disabled={busy} />
    </form>
  )
}

export type TodoTab = 'today' | 'tomorrow' | 'nodate' | 'week' | 'all'

/** Every task of a tab, numbered and grouped by area (with a count per area). */
export function TabList({ tasks, empty, groupOf, row, quick }: { tasks: TodoTask[]; empty: string; groupOf: (t: TodoTask) => { key: string; name: string; color: string }; row: (t: TodoTask, group: string, extra: React.ReactNode) => React.ReactNode; quick: (t: TodoTask) => React.ReactNode }) {
  if (!tasks.length) return <p className="hint dl-empty">{empty}</p>
  const groups: { key: string; name: string; color: string; items: TodoTask[] }[] = []
  for (const t of tasks) {
    const g = groupOf(t)
    let x = groups.find((y) => y.key === g.key)
    if (!x) groups.push((x = { ...g, items: [] }))
    x.items.push(t)
  }
  return (
    <div className="dl-tablist">
      {groups.map((g) => (
        <div key={g.key} className="dl-group" style={{ ['--c' as string]: g.color }}>
          <h3 className="dl-head">
            <i /> {g.name} <small>{g.items.length}</small>
          </h3>
          <ul className="dl">{g.items.map((t) => row(t, g.key, quick(t)))}</ul>
        </div>
      ))}
    </div>
  )
}

/** The running timer's moving parts, each redrawing itself every second (the list around them doesn't). */
export function RunningClock({ run, part }: { run: { startedAt: string; planned: number; pausedAt?: string | null; pausedMs?: number }; part: 'left' | 'clock' | 'bar' }) {
  const tick = useTicker(!run.pausedAt)
  // IC1: paused time doesn't count; while paused the clock stands still.
  const elapsed = (run.pausedAt ? Date.parse(run.pausedAt) : tick) - new Date(run.startedAt).getTime() - Math.max(0, Number(run.pausedMs) || 0)
  const leftMs = run.planned * 60000 - elapsed
  if (part === 'clock') return <span className="now-clock">{run.pausedAt ? `⏸ ${clock(elapsed)}` : clock(elapsed)}</span>
  if (part === 'left' && run.pausedAt) return <>Paused · {clock(Math.max(0, leftMs))} left of {run.planned} min</>
  if (part === 'bar')
    return (
      <div className="now-bar pbar">
        <i style={barFill(elapsed / (run.planned * 60000))} />
      </div>
    )
  return <>{leftMs > 0 ? `${clock(leftMs)} left of ${run.planned} min` : `${run.planned} min done — stop to log it`}</>
}

/** A tick every 30 s while `on` (enough for "which block is on now"). */
export function useSlowTick(on: boolean): number {
  const [t, setT] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setT(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [on])
  return t
}
