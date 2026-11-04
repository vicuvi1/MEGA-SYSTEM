// "Rest day": one tap marks today (or another day) as a planned rest day.
// The workout streak stays alive, Ben doesn't nudge you to train, and Today's
// Workout habit counts as done. Tap again to take it back.
import { useEffect, useState } from 'react'
import type { BodyState } from '@shared/api'
import { life } from './bridge'
import { useLive } from './live'
import { soundSuccess } from './sound'
import { useToast } from './ui'

export function useRest(): [BodyState | null, (day: string | null, on: boolean) => Promise<void>] {
  const toast = useToast()
  const [st, setSt] = useState<BodyState | null>(null)
  const load = () => void life.body.state().then(setSt).catch(() => {})
  useEffect(load, [])
  useLive(load)
  const set = async (day: string | null, on: boolean) => {
    if (!life.body.setRest) return toast('Rest days need the newest version', 'bad')
    try {
      const next = await life.body.setRest(day, on)
      setSt(next)
      if (on) soundSuccess()
      toast(on ? `😴 ${day && day !== next.today ? day : 'Today'} is a rest day: your streak stays (${next.streak} days)` : 'Rest day taken back', 'good', on ? { label: 'Undo', run: () => void set(day, false) } : undefined)
      window.dispatchEvent(new CustomEvent('life-body-changed'))
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return [st, set]
}

/** The top-bar button on the Sport section (also over the Sport Track app). */
export function RestDayButton() {
  const [st, set] = useRest()
  if (!st || st.workoutDoneToday) return null
  const on = !!st.restToday
  return (
    <button className={`chip rest-chip ${on ? 'on' : ''}`} onClick={() => void set(null, !on)} title={on ? 'Today is a rest day. Click to take it back.' : 'Mark today as a rest day: your streak stays, no training nudges'}>
      😴 <span className="rest-text">{on ? "Rest day ✓" : "Rest day"}</span>
    </button>
  )
}

/** On the Sport page: today, or pick another day. */
export function RestDayCard() {
  const [st, set] = useRest()
  const [day, setDay] = useState('')
  if (!st) return null
  const on = !!st.restToday
  const recent = (st.restDays ?? []).slice(-5).reverse()
  return (
    <div className={`rest-card ${on ? 'on' : ''}`}>
      <div>
        <b>😴 Rest day</b>
        <small>{on ? 'Today is a rest day. Your streak stays, Ben lets you recover.' : st.workoutDoneToday ? 'You trained today.' : 'Resting today? Keep your streak and skip the training nudges.'}</small>
      </div>
      {!st.workoutDoneToday && (
        <button className={`btn small ${on ? '' : 'primary'}`} onClick={() => void set(null, !on)}>
          {on ? 'Take it back' : 'Rest today'}
        </button>
      )}
      <form
        className="rest-other"
        onSubmit={(e) => {
          e.preventDefault()
          if (day) void set(day, true)
        }}
      >
        <input type="date" value={day} max={st.today} onChange={(e) => setDay(e.target.value)} aria-label="Another rest day" />
        <button className="btn small ghost" disabled={!day}>
          Mark day
        </button>
      </form>
      <ShieldYesterday st={st} onDone={() => window.dispatchEvent(new CustomEvent('life-body-changed'))} />
      {recent.length > 0 && (
        <small className="rest-list">
          Rest days:{' '}
          {recent.map((d) => (
            <button key={d} className="rest-day" title="Take this rest day back" onClick={() => void set(d, false)}>
              {d.slice(5)} ✕
            </button>
          ))}
        </small>
      )}
    </div>
  )
}

/** Missed yesterday? A streak shield turns it into a rest day (the streak lives on). */
function ShieldYesterday({ st, onDone }: { st: BodyState; onDone: () => void }) {
  const toast = useToast()
  const [n, setN] = useState<number | null>(null)
  useEffect(() => void life.shields.count().then(setN).catch(() => setN(0)), [])
  const y = new Date(Date.parse(`${st.today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
  const covered = (st.restDays ?? []).includes(y) || (st.recentWorkouts ?? []).some((w) => w.day === y)
  if (covered || !n || !life.shields.protect) return null
  return (
    <button
      className="btn small ghost"
      title="Spend a streak shield: yesterday counts as a rest day"
      onClick={async () => {
        try {
          await life.shields.protect!(y)
          setN((x) => (x ?? 1) - 1)
          toast(`🛡 Shield used: yesterday counts as a rest day (${n - 1} left)`, 'good')
          onDone()
        } catch (e) {
          toast((e as Error).message, 'bad')
        }
      }}
    >
      🛡 Save yesterday ({n} shield{n === 1 ? '' : 's'})
    </button>
  )
}
