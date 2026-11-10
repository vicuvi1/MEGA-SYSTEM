// Sport Track → Exercises and → Progress, for now: the parts Body → Training
// had, each in one place, until the next batch rebuilds them (the exercise
// library with chains and detail; PRs and charts).
//   Exercises: every chain step by step (done, now, next, how to do each one,
//              Move up / Not yet, Edit ladders) and the home program builder
//              (minutes, days, equipment, focus).
//   Progress:  recovery per muscle, calm warnings, strength and streak, the
//              progress dashboard, challenges with badges, and "This week"
//              (sets per muscle, workouts, by-hand logging).
// Nothing here pays new points.
import { useEffect, useMemo, useState } from 'react'
import type { BodyState } from '@shared/api'
import { dayKey } from '@core/dates'
import { doneSessions, trainOf } from '@core/trainLog'
import { gearSummary } from '@core/trainGear'
import { todayPlan } from '@core/trainWeek'
import { life } from '../bridge'
import { readSoreness } from '../body/useBodyPlus'
import { Roadmap } from '../body/training/Roadmap'
import { ProgramBuilder } from '../body/training/ProgramBuilder'
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
function useTrainingSync(st: any, today: string, refresh: () => void) {
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

function SectionHead({ title, line }: { title: string; line: string }) {
  return (
    <header className="sp-sec-head">
      <h2>{title}</h2>
      <p>{line}</p>
    </header>
  )
}

export function SportExercises({ onGear }: { onGear: () => void }) {
  const { st, ht, today, refresh } = useTraining()
  useTrainingSync(st, today, refresh)
  return (
    <div className="body-page sp-more" data-sp="exercises">
      <SectionHead title="Exercises" line="Your chains, step by step: tap a step to see how to do it. The full library with pictures comes next." />
      <p className="sp-gear-link" data-sp="gear-side">
        Your gear: <b>{gearSummary(trainOf(st ?? {}).gear)}</b> ·{' '}
        <button type="button" className="sp-link inline" onClick={onGear} data-sp="edit-gear">
          edit gear
        </button>
      </p>
      <div className="bt">
        <Roadmap st={st ?? {}} today={today} refresh={refresh} />
        <ProgramBuilder st={st} ht={ht} today={today} onChanged={refresh} />
      </div>
    </div>
  )
}

export function SportProgress({ body, onBody, onWallet }: { body: BodyState | null; onBody: (s: BodyState) => void; onWallet: () => void }) {
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
    <div className="body-page sp-more" data-sp="progress">
      <SectionHead title="Progress" line="Strength, streak, sets per muscle, challenges and your workouts. Records and charts in one view come next." />
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
    </div>
  )
}
