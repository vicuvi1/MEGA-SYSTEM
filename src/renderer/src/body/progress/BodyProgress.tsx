// Body → Progress tab. One hero (strength per move), then weight and waist,
// the monthly report, the records wall and photos side by side. The older
// cards (weight nudge, measurements, weekly card, taking a photo) are folded
// under "More". Reads Sport Track's data on this device; writes nothing.
import { useEffect, useState } from 'react'
import { dayKey } from '@core/dates'
import type { BodyState } from '../../../../shared/api'
import { readSport } from '../../sportTrack'
import { useBodyPlus } from '../useBodyPlus'
import { WeightTrendCard } from '../WeightTrendCard'
import { TapeCard } from '../TapeCard'
import { BodyWeekCard } from '../BodyWeekCard'
import { PhotoCheckin } from '../PhotoCheckin'
import { StrengthHero } from './StrengthHero'
import { TrendPanel } from './TrendPanel'
import { MonthCard } from './MonthCard'
import { RecordsWall } from './RecordsWall'
import { PhotoCompare } from './PhotoCompare'
import './progress.css'

const EVENTS = ['life-sport-changed', 'life-external-changed', 'storage']

export function BodyProgress({ state, onLog }: { state: BodyState; onLog: () => void }) {
  const [sport, setSport] = useState<any>(() => readSport())
  const [plus, setPlus] = useBodyPlus()
  useEffect(() => {
    const load = () => setSport(readSport())
    for (const e of EVENTS) window.addEventListener(e, load)
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, load)
    }
  }, [])
  const today = dayKey(new Date())
  const exercises = Array.isArray(sport?.exercises) ? sport.exercises : []
  const log = sport?.sets ?? null
  const metrics = state.metrics ?? []
  const workoutDays = (state.recentWorkouts ?? []).map((w) => w.day)
  return (
    <div className="bpg">
      <StrengthHero log={log} exercises={exercises} today={today} />
      <div className="bpg-grid">
        <TrendPanel metrics={metrics} today={today} onLog={onLog} />
        <MonthCard log={log} exercises={exercises} metrics={metrics} workoutDays={workoutDays} today={today} />
      </div>
      <RecordsWall log={log} exercises={exercises} days={sport?.days ?? null} today={today} />
      <PhotoCompare />
      <details className="bpg-more">
        <summary>More: weight advice, measurements, weekly card, take a photo</summary>
        <div className="bpg-more-body">
          {plus && <WeightTrendCard trend={plus.trend} today={plus.day} onLog={onLog} />}
          <div className="bp-grid">
            {plus && <TapeCard v={plus} waist={state.latestWaist} onView={setPlus} />}
            <BodyWeekCard />
          </div>
          <PhotoCheckin every={plus?.prefs.photoEvery ?? 14} />
        </div>
      </details>
    </div>
  )
}
