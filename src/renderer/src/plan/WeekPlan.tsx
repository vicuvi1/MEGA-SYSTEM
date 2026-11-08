// Today → Week: set the week once (heavy study days, gym days, a light day)
// and see it: planned hours per day against your limits, and whether each
// deadline is covered (core/planWeek.ts, core/planDeadlines.ts). Each morning's
// plan follows it. A change re-plans only draft days: today while its plan is
// still a draft, and the days ahead; never the past or an approved plan.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { dayKey } from '@core/dates'
import { planGoal } from '@core/goalPlan'
import { fromGoalPlans, dayLabel } from '@core/planDeadlines'
import { fmtH, isWork } from '@core/planLimits'
import { draftDays, weekDeadlines, weekIndex, weekSummary, type DayType, type WeekShape } from '@core/planWeek'
import type { CalEvent } from '@core/dayTime'
import type { DayProposal } from '@core/rhythm'
import { life } from '../bridge'
import { useAction, useToast } from '../ui'
import { saveSetup, useSetup } from './planSetup'
import './planEditor.css'

const NEXT: Record<DayType, DayType> = { normal: 'heavy', heavy: 'light', light: 'normal' }
const TYPE_NAME: Record<DayType, string> = { normal: 'Normal', heavy: 'Heavy study', light: 'Light' }
const localToday = () => dayKey(new Date())
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** The week at a glance from your limits, the week plan, the deadlines and the calendar (shared with the Deadlines card). */
export function useWeekView() {
  const setup = useSetup()
  const [data, setData] = useState<{ today: string; goals: ReturnType<typeof planGoal>[]; events: CalEvent[]; plan: DayProposal | null; status: 'proposed' | 'approved' | null; freeShare?: number } | null>(null)
  const load = useCallback(() => {
    const today = localToday()
    const s0 = new Date(`${today}T00:00:00`)
    void Promise.all([
      life.focus?.state?.().catch(() => null),
      life.google ? life.google.events(s0.toISOString(), new Date(s0.getTime() + 21 * 86400000).toISOString()).catch(() => [] as CalEvent[]) : Promise.resolve([] as CalEvent[]),
      life.coach?.rhythm?.('state').catch(() => null),
      life.coach?.lifeFit?.().catch(() => null)
    ]).then(([f, events, r, fit]) => {
      const goals = (f?.goals ?? []).map((g) => planGoal(g, today, (f?.todaySessions ?? []).filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0)))
      const b = r?.state.briefing
      const plan = b && b.plan.day === today ? b.plan : null
      setData({ today, goals, events: events ?? [], plan, status: plan ? b!.status : null, freeShare: typeof fit?.freeShare === 'number' ? fit.freeShare : undefined })
    })
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    window.addEventListener('life-external-changed', load)
    window.addEventListener('life-plan-synced', load)
    return () => {
      window.removeEventListener('life-external-changed', load)
      window.removeEventListener('life-plan-synced', load)
    }
  }, [load])

  const view = useMemo(() => {
    if (!setup || !data) return null
    const plans = weekDeadlines({ today: data.today, now: hm(new Date()), goals: fromGoalPlans(data.goals), events: data.events.filter((e) => !e.ours), week: setup.week, limits: setup.limits, freeShare: data.freeShare })
    const todayMin = data.plan ? data.plan.blocks.filter(isWork).reduce((t, b) => t + b.minutes, 0) : null
    return weekSummary({ today: data.today, week: setup.week, limits: setup.limits, plans, todayMin })
  }, [setup, data])
  return { setup, data, view, load }
}

export function WeekPlanCard() {
  const act = useAction()
  const toast = useToast()
  const { setup, data, view, load } = useWeekView()
  if (!setup || !data || !view) return null

  const change = async (i: number, patch: Partial<WeekShape['days'][number]>) => {
    const week: WeekShape = { ...setup.week, days: setup.week.days.map((d, j) => (j === i ? { ...d, ...patch } : d)) }
    const saved = await act(() => saveSetup({ week }))
    if (!saved) return
    // Only draft days change: today while its plan is a draft (the plan card keeps the new limits), never the past.
    const isToday = weekIndex(data.today) === i
    const d = draftDays(data.today, data.status)
    if (isToday && !d.replanToday) toast("Saved. Today's plan is approved, so it stays: the change counts from next week", 'good')
    else if (isToday && data.status === 'proposed' && life.coach?.rhythm) {
      // Today's plan is still a draft: it is planned again with the new day (pinned blocks stay).
      toast('Week plan saved: re-planning today (still a draft)', 'good')
      await life.coach.rhythm('propose').catch(() => toast("Couldn't re-plan today: Regenerate on the plan card", 'bad'))
    } else toast('Week plan saved: the days ahead follow it', 'good')
    load()
  }
  const total = view.rows.reduce((t, r) => t + r.plannedMin, 0)
  return (
    <section className="panel wp" aria-label="Week plan" data-week-plan>
      <header className="panel-head">
        <h2>Week plan</h2>
        <span className="hint small">Next 7 days · {fmtH(total)} planned{setup.week.setOn ? '' : ' · tap a day to set it'}</span>
      </header>
      <div className="wp-days">
        {view.rows.map((r) => {
          const i = weekIndex(r.day)
          const cap = r.capMin
          const pct = cap ? Math.min(100, (r.plannedMin / cap) * 100) : Math.min(100, (r.plannedMin / 360) * 100)
          return (
            <div key={r.day} className={`wp-day${r.today ? ' today' : ''}${r.over ? ' over' : ''}`} data-week-day={r.day} title={r.sessions.map((s) => `${s.title} · ${s.minutes} min · ${s.why}`).join('\n') || undefined}>
              <b>
                <span>{r.name}</span>
                <small>{Number(r.day.slice(8))}</small>
              </b>
              <button type="button" className={`wp-type ${r.type}`} data-week-type onClick={() => void change(i, { type: NEXT[r.type] })} title="Tap: normal → heavy study → light">
                {TYPE_NAME[r.type]}
              </button>
              <button type="button" className={`wp-gym${r.gym ? ' on' : ''}`} data-week-gym onClick={() => void change(i, { gym: !r.gym })}>
                {r.gym ? '💪 Gym' : 'No gym'}
              </button>
              <span className={`wp-h${r.over ? ' over' : ''}`}>{`${r.plannedMin ? fmtH(r.plannedMin) : '0'}${cap != null ? ` / ${fmtH(cap)}` : ''}`}</span>
              <span className={`wp-bar${r.over ? ' over' : ''}`}>
                <i style={{ width: `${pct}%` }} />
              </span>
              {r.sessions.slice(0, 2).map((s) => (
                <span key={s.title} className="wp-sess" data-week-session>
                  {s.title.split(':')[0]} {s.minutes}m
                </span>
              ))}
            </div>
          )
        })}
      </div>
      {view.deadlines.length > 0 ? (
        <ul className="wp-dl" data-week-deadlines>
          {view.deadlines.map((d) => (
            <li key={d.title + d.deadline} className={d.line ? 'short' : ''}>
              <span>
                <b>{d.title}</b> · {dayLabel(d.deadline)}
              </span>
              <span>{d.line ? d.line.replace(`${d.title}: `, '') : `${fmtH(d.plannedMin)} in ${d.sessions} session${d.sessions === 1 ? '' : 's'}: covered`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint small">No deadlines. Tell Ben: "Etica exam on 20 Nov, needs 8 hours" and the sessions show here.</p>
      )}
    </section>
  )
}
