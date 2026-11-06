// Today → Now on Sunday (and Monday if you haven't yet): "Pick your top 3 for
// this week", with chips from your goals and projects. The 3 become the week's
// big 3 (the same list as Goals → This week's big 3); the rest are parked:
// still visible, quiet. Telegram asks the same with buttons.
import { useEffect, useState } from 'react'
import { life } from './bridge'
import { dayKey } from '@core/dates'
import { useAction } from './ui'
import { planFromPicks, planWeek, toggleChip, top3AskDue, top3Chips } from '@core/weekPlan'
import { useWeekPlan } from './WeekPlanner'

const appDay = () => dayKey(new Date())
const LATER = 'ls.top3Later'

export function WeekTop3Pick() {
  const act = useAction()
  const [saved, reload] = useWeekPlan()
  const [chips, setChips] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const today = appDay()
  const week = planWeek(today)
  const [later, setLater] = useState(() => {
    try {
      return localStorage.getItem(LATER) === week
    } catch {
      return false
    }
  })
  const due = saved !== undefined && top3AskDue(saved ?? null, today) && !later
  useEffect(() => {
    if (!due || chips) return
    let off = false
    void (async () => {
      const goals = await life.extras?.goals([]).catch(() => null)
      const all = await life.todoist?.everything?.().catch(() => null)
      const projects = [...new Set((all?.areas ?? []).filter((a) => a.kind === 'project').map((a) => a.name))]
      const prev = saved && saved.week === week ? saved.big3.map((b) => b.text) : []
      const list = top3Chips([...(goals?.measures ?? []).map((c) => c.goal.title), ...(goals?.goals ?? []).map((g) => g.title)], projects, prev)
      if (!off) {
        setChips(list)
        setPicked(prev.filter((p) => list.includes(p)).slice(0, 3))
      }
    })()
    return () => void (off = true)
  }, [due, chips, saved, week])
  // Sunday, already picked for the coming week: a quiet line (Today's list shows them from Monday).
  if (!due && saved && saved.week === week && Array.isArray(saved.parked) && new Date(`${today}T12:00:00`).getDay() === 0)
    return (
      <p className="dl-parked wk3-next">
        🎯 Top 3 from Monday: {saved.big3.map((b) => b.text).join(' · ')}
        {saved.parked.length ? ` · parked: ${saved.parked.join(', ')}` : ''}
      </p>
    )
  if (!due || !chips || !life.weekPlan) return null
  const save = async () => {
    const r = await act(() => life.weekPlan!.save(planFromPicks(saved ?? null, week, chips, picked)), `Top ${picked.length} set for this week. The rest are parked.`)
    if (r) {
      window.dispatchEvent(new CustomEvent('life-week-changed'))
      reload()
    }
  }
  const notNow = () => {
    try {
      localStorage.setItem(LATER, week)
    } catch {
      /* private window */
    }
    setLater(true)
  }
  return (
    <section className="wk3" aria-label="Pick your top 3 for this week">
      <h3>🎯 Pick your top 3 for this week</h3>
      <p className="hint">{chips.length ? 'Tap up to 3. The others stay on the list, parked and quiet.' : 'Add a goal or a project first (Goals page or Todoist).'}</p>
      <div className="wk3-chips">
        {chips.map((c) => (
          <button key={c} type="button" className={picked.includes(c) ? 'on' : ''} aria-pressed={picked.includes(c)} onClick={() => setPicked(toggleChip(picked, c))}>
            {picked.includes(c) ? '✓ ' : ''}
            {c}
          </button>
        ))}
      </div>
      <div className="wk3-row">
        <button type="button" className="btn primary small" disabled={!picked.length} onClick={() => void save()}>
          Save my top {picked.length || 3}
        </button>
        <button type="button" className="btn ghost small" onClick={notNow}>
          Not now
        </button>
      </div>
    </section>
  )
}
