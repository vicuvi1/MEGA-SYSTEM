// Body → Progress tab. One hero (strength per move), then body composition
// (weekly average weight, the target band, waist, fat and muscle estimates,
// calories), the one weekly calorie check (same card as Food), the monthly report (first on the 1st–3rd of a month), the
// records wall and photos side by side. The older
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
import { BodyCompPanel, useBodyComp } from './BodyCompPanel'
import { useBodyLogSheet } from '../BodyLogSheet'
import { monthSummaryDay } from '@core/bodyComp'
import { MonthCard } from './MonthCard'
import { RecordsWall } from './RecordsWall'
import { PhotoCompare } from './PhotoCompare'
import { FoodAdjustCard } from '../FoodAdjustCard'
import './progress.css'

const EVENTS = ['life-sport-changed', 'life-external-changed', 'storage']

export function BodyProgress({ state, onLog }: { state: BodyState; onLog: () => void }) {
  const [sport, setSport] = useState<any>(() => readSport())
  const [plus, setPlus] = useBodyPlus()
  const comp = useBodyComp()
  const bodyLog = useBodyLogSheet(onLog, state.latestWeight)
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
  // The monthly summary opens first on the 1st–3rd of a month; any other day it sits below.
  const monthFirst = monthSummaryDay(today)
  const month = <MonthCard log={log} exercises={exercises} metrics={metrics} workoutDays={workoutDays} today={today} comp={comp?.month ?? null} now={monthFirst} />
  const toMonth = () => {
    const el = document.getElementById('bpg-month')
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    el?.focus({ preventScroll: true })
  }
  return (
    <div className="bpg">
      {monthFirst && month}
      <StrengthHero log={log} exercises={exercises} today={today} />
      {comp ? (
        <>
          <BodyCompPanel v={comp} onLog={bodyLog.open} onMonth={toMonth} />
          <FoodAdjustCard where="progress" />
          {!monthFirst && month}
        </>
      ) : (
        <div className="bpg-grid">
          <TrendPanel metrics={metrics} today={today} onLog={onLog} />
          {!monthFirst && month}
        </div>
      )}
      {!comp && <FoodAdjustCard where="progress" />}
      {bodyLog.sheet}
      <RecordsWall log={log} exercises={exercises} days={sport?.days ?? null} today={today} />
      <PhotoCompare />
      <details className="bpg-more">
        <summary>More: weight advice, measurements, weekly card, take a photo</summary>
        <div className="bpg-more-body">
          {plus && <WeightTrendCard trend={plus.trend} today={plus.day} onLog={bodyLog.open} />}
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
