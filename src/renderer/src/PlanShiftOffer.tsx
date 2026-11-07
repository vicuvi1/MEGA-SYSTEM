// The plan came back late: "You're starting at 10:00, shift the plan?" with
// Shift / Keep. Shift moves the past blocks that weren't started into the time
// left (fixed events stay; an approved plan's calendar blocks move too). Keep
// hides the offer for this version of the plan (on this device).
import { useState } from 'react'
import type { RhythmPrefs, RhythmState } from '@core/rhythm'
import { life } from './bridge'
import { useAction } from './ui'
import './planAlso.css'

const KEY = 'ls.planShiftKeep'
const nowHm = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const kept = (id: string) => {
  try {
    return localStorage.getItem(KEY) === id
  } catch {
    return false
  }
}

export function PlanShiftOffer({ state, late, onDone }: { state: RhythmState; late?: number; onDone: (r: { state: RhythmState; prefs: RhythmPrefs }) => void }) {
  const act = useAction()
  const [busy, setBusy] = useState(false)
  const b = state.briefing
  const id = b ? `${state.day}:${b.version}` : ''
  const [hidden, setHidden] = useState(() => kept(id))
  if (!b || !late || hidden || kept(id) || !life.coach?.rhythm) return null
  const shift = async () => {
    setBusy(true)
    const r = await act(() => life.coach!.rhythm!('shift'), 'The plan starts from now')
    setBusy(false)
    if (r) onDone({ state: r.state, prefs: r.prefs })
  }
  const keep = () => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* private window: hidden until reload */
    }
    setHidden(true)
  }
  return (
    <div className="plan-shift" role="status">
      <span>
        You're starting at {nowHm()}: {late} block{late === 1 ? ' is' : 's are'} already past. Shift the plan?
      </span>
      <span className="plan-shift-btns">
        <button type="button" className="p" disabled={busy} onClick={() => void shift()}>
          {busy ? 'Shifting…' : 'Shift'}
        </button>
        <button type="button" disabled={busy} onClick={keep}>
          Keep
        </button>
      </span>
    </div>
  )
}
