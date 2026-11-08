// DP1: the plan's "Also today" list: every task of the day that isn't a
// must-do or in a block (a block's tasks are its own checkboxes), most
// important first, with its time estimate (and its calendar event, if it is one). Ticking one closes it in Todoist the usual way, after a few seconds, so
// Undo really undoes it (no points are paid for a task you take back).
// Tasks moved to tomorrow are listed under it with the reason.
import { useEffect, useState } from 'react'
import type { DayProposal } from '@core/rhythm'
import type { TodoTask } from '@core/todoist'
import { life } from './bridge'
import { useToast } from './ui'
import './planAlso.css'

const UNDO_MS = 5000
/** Ticks waiting to be sent (kept outside React so closing the card doesn't lose them). */
const pending = new Map<string, ReturnType<typeof setTimeout>>()
const closedHere = new Set<string>()

const P_TONE: Record<number, string> = { 4: 'p1', 3: 'p2', 2: 'p3' }
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`)

export function PlanAlso({ plan, startOpen = false }: { plan: Pick<DayProposal, 'also' | 'deferred'>; startOpen?: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(startOpen)
  const [openIds, setOpenIds] = useState<Set<string> | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(() => new Set([...pending.keys(), ...closedHere]))
  // A task in a block is ticked in the block: listing it here too was a duplicate.
  const also = (plan.also ?? []).filter((a) => !a.at)
  const deferred = plan.deferred ?? []

  // Tasks closed somewhere else drop off the list.
  useEffect(() => {
    if (!also.length || !life.todoist) return
    let alive = true
    life.todoist
      .today()
      .then((list) => alive && setOpenIds(new Set(list.map((t) => t.id))))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [also.length])

  if (!also.length && !deferred.length) return null
  const rows = also.filter((a) => !a.id || !openIds || openIds.has(a.id) || pending.has(a.id))
  const left = rows.filter((a) => !(a.id && ticked.has(a.id))).length

  const tick = (a: (typeof also)[number]) => {
    if (!a.id || !life.todoist) return
    const id = a.id
    if (pending.has(id)) return
    setTicked((s) => new Set(s).add(id))
    const task: TodoTask = { id, content: a.title, priority: a.priority, due: null, dueTime: null, project: a.project ?? null, recurring: false }
    const send = () => {
      pending.delete(id)
      closedHere.add(id)
      life.todoist!
        .complete(task)
        .then((r) => toast(`Closed in Todoist: ${a.title}${r.paid ? ' · points added' : ''}`, 'good'))
        .catch((e) => {
          closedHere.delete(id)
          setTicked((s) => {
            const n = new Set(s)
            n.delete(id)
            return n
          })
          toast((e as Error).message || 'Todoist did not answer', 'bad')
        })
    }
    pending.set(id, setTimeout(send, UNDO_MS))
    toast(`Done: ${a.title}`, 'info', {
      label: 'Undo',
      run: () => {
        clearTimeout(pending.get(id))
        pending.delete(id)
        setTicked((s) => {
          const n = new Set(s)
          n.delete(id)
          return n
        })
      }
    })
  }

  return (
    <div className={`pa ${open ? 'open' : ''}`}>
      {rows.length > 0 && (
        <button type="button" className="pa-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="pa-caret" aria-hidden>
            ›
          </span>
          <b>Also today ({left})</b>
          <small>{fmt(rows.filter((a) => !(a.id && ticked.has(a.id))).reduce((t, a) => t + a.minutes, 0))} in all</small>
        </button>
      )}
      {open && rows.length > 0 && (
        <ul className="pa-list">
          {rows.map((a, k) => {
            const done = !!(a.id && ticked.has(a.id))
            return (
              <li key={a.id ?? `${a.title}-${k}`} className={done ? 'done' : ''}>
                <button type="button" className={`pa-tick ${P_TONE[a.priority] ?? ''}`} aria-pressed={done} aria-label={done ? `${a.title}: done` : `Tick ${a.title}`} disabled={!a.id || done} onClick={() => tick(a)}>
                  {done ? '✓' : ''}
                </button>
                <span className="pa-tx">
                  {a.title}
                  <small>
                    {[fmt(a.minutes), a.event ? `at the ${a.event} event` : 'no slot yet', a.project, a.overdue ? 'overdue' : ''].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {open && deferred.length > 0 && (
        <div className="pa-later">
          <small>Moved to tomorrow ({deferred.length})</small>
          <ul>
            {deferred.map((d) => (
              <li key={d.id ?? d.title}>
                {d.title} <small>· {d.why}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!rows.length && deferred.length > 0 && !open && (
        <button type="button" className="pa-head" onClick={() => setOpen(true)}>
          <b>Moved to tomorrow ({deferred.length})</b>
        </button>
      )}
    </div>
  )
}
