// Body → Training: today's session from your weekly split (log sets right
// here), the progression roadmap, the program builder (moves, sets and
// equipment for Sport Track's Today), challenges with badges, and "This week"
// (sets per muscle, next steps, strength, workouts). Nothing on this tab pays
// new points: a finished workout pays the usual "Workout done", once a day.
import { useEffect } from 'react'
import type { BodyState } from '@shared/api'
import { celebrate } from '../../fx'
import { useToast } from '../../ui'
import { ProgramBuilder } from './ProgramBuilder'
import { Challenges } from './Challenges'
import { ThisWeek } from './ThisWeek'
import { TodaySession } from './TodaySession'
import { Roadmap } from './Roadmap'
import { syncTraining, useTraining } from './trainingStore'
import './training.css'

export function BodyTraining({ state, onState, onWallet, hold, onOpenSportApp }: { state: BodyState; onState: (s: BodyState) => void; onWallet: () => void; hold: boolean; onOpenSportApp?: () => void }) {
  const toast = useToast()
  const { st, ht, today, refresh } = useTraining()

  // Targets follow the week of the block, today's totals go into challenges, finished ones get a badge.
  useEffect(() => {
    const fresh = syncTraining(today)
    if (fresh.length) {
      refresh()
      celebrate(null, 'reward')
      toast(`Badge earned: ${fresh.map((b) => b.name).join(', ')}. Badges pay no points.`, 'good')
    }
  }, [st, today, refresh, toast])

  return (
    <div className="bt">
      <TodaySession
        st={st ?? {}}
        today={today}
        refresh={refresh}
        onOpenSportApp={onOpenSportApp}
        onLogged={(s) => {
          onState(s)
          onWallet()
        }}
      />
      <Roadmap st={st ?? {}} today={today} refresh={refresh} />
      <ProgramBuilder st={st} ht={ht} today={today} onChanged={refresh} />
      <Challenges st={st} ht={ht} today={today} onChanged={refresh} />
      <ThisWeek state={state} onState={onState} onWallet={onWallet} hold={hold} />
    </div>
  )
}
