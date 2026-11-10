// Sport Track → Progress, the parts that stay below the new Progress view (folded under "More"):
// recovery per muscle, calm warnings, strength and streak, the progress dashboard, challenges with
// badges, and "This week" (sets per muscle, workouts, by-hand logging). Also the badge sync
// (useTrainingSync) that Exercises and Progress both run. Nothing here pays new points.
import { useEffect, useMemo, useState } from 'react'
import type { BodyState } from '@shared/api'
import { dayKey } from '@core/dates'
import { doneSessions, trainOf } from '@core/trainLog'
import { todayPlan } from '@core/trainWeek'
import { life } from '../bridge'
import { readSoreness } from '../body/useBodyPlus'
import { Challenges } from '../body/training/Challenges'
import { ThisWeek } from '../body/training/ThisWeek'
import { StrengthCard } from '../body/training/StrengthCard'
import { ProgressDash } from '../body/training/ProgressDash'
import { RecoveryPanel } from '../body/training/RecoveryPanel'
import { TrainWarnings, type FoodDays } from '../body/training/TrainWarnings'
import { syncTraining, useTraining } from '../body/training/trainingStore'
import { celebrate } from '../fx'
import { useToast } from '../ui'
import '../body/bodyLook.css'
import '../body.css'
import '../body/body-plus.css'
import '../body/body-theme.css'
import '../body/training/training.css'

/** As on Body → Training before: targets follow the week of the block, today's totals go into challenges, finished ones get a badge. */
export function useTrainingSync(st: any, today: string, refresh: () => void) {
  const toast = useToast()
  useEffect(() => {
    const fresh = syncTraining(today)
    if (fresh.length) {
      refresh()
      celebrate(null, 'reward')
      toast(`Badge earned: ${fresh.map((b) => b.name).join(', ')}. Badges pay no points.`, 'good')
    }
  }, [st, today, refresh, toast])
}

export function ProgressMore({ body, onBody, onWallet }: { body: BodyState | null; onBody: (s: BodyState) => void; onWallet: () => void }) {
  const { st, ht, today, refresh } = useTraining()
  useTrainingSync(st, today, refresh)
  const state = st ?? {}
  const data = useMemo(() => trainOf(state), [state])
  const done = useMemo(() => doneSessions(data.log), [data])
  const plan = useMemo(() => todayPlan(data.week, done, today), [data, done, today])
  // The food counter's last 7 days, read only (for the "not eating enough to grow" note).
  const [food, setFood] = useState<FoodDays>(null)
  // Progression holds after a short night (the next steps say "repeat").
  const [hold, setHold] = useState(false)
  useEffect(() => {
    let live = true
    const load = () => {
      void life.coach?.food
        ?.view()
        .then((v) => live && setFood(v.week.perDay.map((d) => ({ day: d.day, kcal: d.kcal }))))
        .catch(() => {})
      void life.coach?.bodyPlus
        ?.ready(readSoreness(dayKey(new Date())))
        .then((r) => live && setHold(r.hold))
        .catch(() => {})
    }
    load()
    window.addEventListener('life-body-changed', load)
    return () => {
      live = false
      window.removeEventListener('life-body-changed', load)
    }
  }, [])
  return (
    <details className="sp-fold" data-sp="progress-more">
      <summary>
        <b>More: recovery, warnings, strength, challenges and this week</b>
        <small>Recovery per muscle, calm warnings, the progress dashboard, challenges with badges, sets per muscle and logging by hand</small>
      </summary>
      <div className="bt">
        <section className="bdy-card" aria-label="Recovery">
          <h3 className="bdy-title">Recovery</h3>
          <RecoveryPanel st={state} plan={plan} week={data.week} done={done} today={today} started onSwap={() => {}} />
        </section>
        <TrainWarnings st={state} today={today} food={food} refresh={refresh} />
        {body && <StrengthCard state={body} />}
        <ProgressDash st={state} today={today} />
        <Challenges st={st} ht={ht} today={today} onChanged={refresh} />
        {body && <ThisWeek state={body} onState={onBody} onWallet={onWallet} hold={hold} />}
      </div>
    </details>
  )
}
