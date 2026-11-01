// Today's timeline (07:00–23:00): Google Calendar events and timed Todoist
// tasks in order, the free gaps between them, and "Plan my day": blocks for
// your must-dos, big tasks and urgent Todoist tasks in those gaps, which
// you approve into your calendar with one tap.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { freeGaps, localDay, localHM, suggestBlocks, type Block, type CalEvent } from '@core/dayTime'
import { activePlan } from '@core/weekPlan'
import { sortTasks, type TodoTask } from '@core/todoist'
import { life } from './bridge'
import { Icon } from './Icon'
import type { PageId } from './modules'
import { useFocus } from './pages/Focus'
import { useWeekPlan } from './WeekPlanner'
import { soundSuccess } from './sound'
import { useAction } from './ui'
import { useLive } from './live'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hmNow = () => {
  const d = new Date()
  const m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}
const dur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)

type Row = { kind: 'event' | 'task' | 'gap'; start: string; end: string; title: string; color?: string; minutes?: number }

export function DayTimeline({ onGo }: { onGo: (p: PageId) => void }) {
  const act = useAction()
  const today = ymd(new Date())
  const [events, setEvents] = useState<CalEvent[]>([])
  const [todo, setTodo] = useState<TodoTask[]>([])
  const [connected, setConnected] = useState<boolean | null>(null)
  const [plan, setPlan] = useState<(Block & { on: boolean; taskId?: string })[] | null>(null)
  const [focus] = useFocus()
  const [week] = useWeekPlan()

  const load = useCallback(async () => {
    const on = !!(await life.google?.status().catch(() => null))?.connected
    setConnected(on)
    if (on) setEvents(await life.google!.events(new Date(`${today}T00:00:00`).toISOString(), new Date(`${today}T23:59:59`).toISOString()).catch(() => []))
    if (life.todoist) setTodo(await life.todoist.today().catch(() => []))
  }, [today])
  useEffect(() => {
    void load()
  }, [load])
  useLive(() => void load(), { external: true })

  const rows: Row[] = useMemo(() => {
    const timed: Row[] = [
      ...events.filter((e) => !e.allDay && localDay(e.start) === today).map((e) => ({ kind: 'event' as const, start: localHM(e.start), end: localDay(e.end) > today ? '23:59' : localHM(e.end), title: e.title, color: e.color ?? '#7CC4FF' })),
      ...todo.filter((t) => t.due === today && t.dueTime && !events.some((e) => e.title === t.content)).map((t) => ({ kind: 'task' as const, start: t.dueTime!, end: t.dueTime!, title: t.content, color: '#C8F135' }))
    ].sort((a, b) => a.start.localeCompare(b.start))
    const gaps = freeGaps(events.filter((e) => localDay(e.start) === today), today, { minMinutes: 45 }).map((g) => ({ kind: 'gap' as const, start: g.start, end: g.end, title: 'Free', minutes: g.minutes }))
    return [...timed, ...gaps].sort((a, b) => a.start.localeCompare(b.start) || (a.kind === 'gap' ? 1 : -1))
  }, [events, todo, today])

  const suggest = () => {
    const wp = week ? activePlan(week, today) : null
    const items = [
      ...(focus?.plan.items.filter((p) => !p.done).map((p) => ({ title: p.text, minutes: 50 })) ?? []),
      ...(wp?.big3.filter((b) => !b.done).map((b) => ({ title: b.text, minutes: 50 })) ?? []),
      ...sortTasks(todo.filter((t) => !t.dueTime && (t.priority >= 3 || (t.due && t.due < today))), today).map((t) => ({ title: t.content, minutes: 50, taskId: t.id }))
    ].filter((x, i, all) => all.findIndex((y) => y.title.toLowerCase() === x.title.toLowerCase()) === i)
    const gaps = freeGaps(events.filter((e) => localDay(e.start) === today), today, { after: hmNow(), minMinutes: 30 })
    const blocks = suggestBlocks(gaps, items.slice(0, 5))
    setPlan(blocks.map((b) => ({ ...b, on: true, taskId: (items.find((i) => i.title === b.title) as any)?.taskId })))
  }
  // The morning card's "Plan my day" asks for blocks here.
  const suggestRef = useRef(suggest)
  suggestRef.current = suggest
  const box = useRef<HTMLElement>(null)
  useEffect(() => {
    const on = () => {
      if (!connected) return onGo('settings')
      suggestRef.current()
      box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    window.addEventListener('life-plan-day', on)
    return () => window.removeEventListener('life-plan-day', on)
  }, [connected, onGo])
  const approve = async () => {
    if (!plan) return
    const chosen = plan.filter((b) => b.on)
    const ok = await act(async () => {
      for (const b of chosen) {
        await life.google!.create({ title: b.title, start: new Date(`${today}T${b.start}:00`).toISOString(), end: new Date(`${today}T${b.end}:00`).toISOString(), description: 'Planned in Life System' })
        if (b.taskId) await life.todoist?.update?.(b.taskId, { due: `${today} ${b.start}` }).catch(() => null)
      }
      return true
    }, `${chosen.length} block${chosen.length === 1 ? '' : 's'} added to your calendar`)
    if (ok) {
      soundSuccess()
      setPlan(null)
      void load()
    }
  }

  const nowHM = `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`
  return (
    <section className="card tl" ref={box}>
      <header className="card-head">
        <h2>
          <Icon name="calendar" size={16} /> Your day
        </h2>
        <div className="actions">
          {connected && (
            <button className="btn small primary" onClick={suggest}>
              <Icon name="spark" size={13} /> Plan
            </button>
          )}
          <button className="btn small ghost" onClick={() => onGo(connected === false ? 'settings' : 'calendar')}>
            {connected === false ? 'Connect calendar' : 'Week'}
          </button>
        </div>
      </header>

      {plan && (
        <div className="tl-plan">
          <p className="hint">{plan.length ? 'Coach’s plan for your free time. Untick what you don’t want, then add it.' : 'No free gap left today for your open must-dos and big tasks. Tomorrow, plan in the morning.'}</p>
          {plan.map((b, i) => (
            <label key={i} className="tl-plan-row">
              <input type="checkbox" checked={b.on} onChange={(e) => setPlan(plan.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
              <span className="tl-time">
                {b.start}–{b.end}
              </span>
              <span>{b.title}</span>
            </label>
          ))}
          <div className="row">
            {plan.some((b) => b.on) && (
              <button className="btn small primary" onClick={() => void approve()}>
                <Icon name="check" size={13} /> Add to my calendar
              </button>
            )}
            <button className="btn small ghost" onClick={() => setPlan(null)}>
              Not now
            </button>
          </div>
        </div>
      )}

      {connected === null ? (
        <p className="hint">Loading your day…</p>
      ) : (
        <ol className="tl-list">
          {rows.map((r, i) => {
            const past = r.end < nowHM && r.kind !== 'task'
            return (
              <li key={i} className={`tl-row ${r.kind} ${past ? 'past' : ''} ${r.start <= nowHM && nowHM < r.end ? 'now' : ''}`} style={{ ['--c' as string]: r.color ?? 'var(--line)' }}>
                <span className="tl-time">{r.kind === 'task' ? r.start : `${r.start}–${r.end}`}</span>
                <span className="tl-bar" />
                <span className="tl-title">
                  {r.kind === 'gap' ? (
                    <>
                      Free · <b>{dur(r.minutes ?? 0)}</b>
                    </>
                  ) : (
                    r.title
                  )}
                  {r.kind === 'task' && <small> · Todoist</small>}
                </span>
              </li>
            )
          })}
          {!rows.length && <li className="hint">Nothing planned. A free day: plan it.</li>}
        </ol>
      )}
    </section>
  )
}
