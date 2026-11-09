// Body → Metrics & Workouts: five tabs (Today · Food · Training · Growth · Progress).
// The shell only: each tab is one component, so each can change on its own.
// Shared look: body/body-theme.css. Sheets (log workout, weight & waist, add
// exercise): body/BodySheets.tsx.
import { useEffect, useState } from 'react'
import type { BodyState } from '@shared/api'
import { dayKey } from '@core/dates'
import { askConfirm } from '../confirmSheet'
import { life } from '../bridge'
import { soundCoin } from '../soundKit'
import { useAction } from '../ui'
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import { FoodCounter } from '../body/FoodCounter'
import { TodayTab } from '../body/today/TodayTab'
import { ExerciseModal, MetricModal, WorkoutModal } from '../body/BodySheets'
import { readSoreness } from '../body/useBodyPlus'
import type { DayProgress } from '@core/foodProgress'
import '../body.css'
import '../body/body-plus.css'
import '../body/body-theme.css'
import { BodyTraining } from '../body/training/BodyTraining'
import { BodyProgress } from '../body/progress/BodyProgress'
import { GrowthTab } from '../body/progress/GrowthTab'

const BODY_TABS = [
  { id: 'today', label: 'Today', title: 'Your plan for today: training, meals and ticks (more under More)' },
  { id: 'food', label: 'Food', title: 'Log food: a photo, your meals or a few words' },
  { id: 'training', label: 'Training', title: 'Strength, home program, challenges, sets per muscle, workouts' },
  { id: 'growth', label: 'Growth', title: 'How much you are growing: the long run, your level, month by month' },
  { id: 'progress', label: 'Progress', title: 'Weight trend, measurements, photos, your week' }
]

export function Body({
  state,
  onState,
  onWallet,
  onOpenSportApp
}: {
  state: BodyState
  onState: (s: BodyState) => void
  onWallet: () => void
  onOpenSportApp?: () => void
}) {
  const act = useAction()
  const [workoutOpen, setWorkoutOpen] = useState(false)
  const [metricOpen, setMetricOpen] = useState(false)
  const [exerciseOpen, setExerciseOpen] = useState(false)
  const [tab, setTab] = usePageTab('body', BODY_TABS.map((t) => t.id), 'today')
  // The Food tab's badge: the same protein numbers as the Food card (eaten and the food goal, foodTargetsNow).
  const protein = useFoodProtein()
  // BD7: progression holds after a short night (the next steps say "repeat").
  const [hold, setHold] = useState(false)
  useEffect(() => {
    const load = () =>
      void life.coach?.bodyPlus
        ?.ready(readSoreness(dayKey(new Date())))
        .then((r) => setHold(r.hold))
        .catch(() => {})
    load()
    window.addEventListener('life-body-changed', load)
    return () => window.removeEventListener('life-body-changed', load)
  }, [])

  const handleUndoLast = async () => {
    if (state.recentWorkouts.length === 0) return
    const last = state.recentWorkouts[0]
    if (!(await askConfirm(`Undo last workout "${last.title}" and give the points back?`))) return
    const next = await act(() => life.body.deleteWorkout(last.id), `Reverted "${last.title}"`)
    if (next) {
      onState(next)
      onWallet()
    }
  }

  return (
    <div className="body-page">
      <PageTabs page="body" label="Body views" tabs={BODY_TABS.map((t) => ({ ...t, count: t.id === 'food' && protein ? `${Math.round(protein.eaten)}/${Math.round(protein.goal)}` : null }))} value={tab} onChange={setTab} />
      <TabPanel page="body" id="today" value={tab} className="body-tab">
        <TodayTab state={state} onOpenSportApp={onOpenSportApp} onOpenFood={() => setTab('food')} onLogMetric={() => setMetricOpen(true)} onLogWorkout={() => setWorkoutOpen(true)} onAddExercise={() => setExerciseOpen(true)} onUndoLast={handleUndoLast} />
      </TabPanel>

      <TabPanel page="body" id="food" value={tab} className="body-tab">
        <FoodCounter />
      </TabPanel>

      <TabPanel page="body" id="training" value={tab} className="body-tab">
        <BodyTraining state={state} onState={onState} onWallet={onWallet} hold={hold} onOpenSportApp={onOpenSportApp} />
      </TabPanel>

      <TabPanel page="body" id="growth" value={tab} className="body-tab">
        {tab === 'growth' && <GrowthTab onLog={() => setMetricOpen(true)} lastWeight={state.latestWeight} />}
      </TabPanel>

      <TabPanel page="body" id="progress" value={tab} className="body-tab">
        <BodyProgress state={state} onLog={() => setMetricOpen(true)} />
      </TabPanel>

      {workoutOpen && (
        <WorkoutModal
          exercises={state.exercises}
          onClose={() => setWorkoutOpen(false)}
          onSave={async (w) => {
            const res = await act(() => life.body.logWorkout(w), 'Workout logged!')
            if (res) {
              if (res.awarded) soundCoin()
              onState(res.state)
              onWallet()
              setWorkoutOpen(false)
            }
          }}
        />
      )}

      {metricOpen && (
        <MetricModal
          currentWeight={state.latestWeight}
          currentWaist={state.latestWaist}
          onClose={() => setMetricOpen(false)}
          onSave={async (m) => {
            const next = await act(() => life.body.logMetric(m), 'Metrics updated!')
            if (next) {
              onState(next)
              setMetricOpen(false)
            }
          }}
        />
      )}

      {exerciseOpen && (
        <ExerciseModal
          onClose={() => setExerciseOpen(false)}
          onSave={async (ex) => {
            const next = await act(() => life.body.saveExercise(ex), 'Exercise added!')
            if (next) {
              onState(next)
              setExerciseOpen(false)
            }
          }}
        />
      )}
    </div>
  )
}

/** Today's protein from the food counter (reloads when food or body change). */
function useFoodProtein(): DayProgress['protein'] | null {
  const [p, setP] = useState<DayProgress['protein'] | null>(null)
  useEffect(() => {
    const api = life.coach?.food
    if (!api) return
    const load = () =>
      void api
        .view()
        .then((v) => setP(v.progress.protein))
        .catch(() => {})
    load()
    const events = ['life-body-changed', 'life-food-changed', 'life-sport-changed', 'life-external-changed']
    for (const e of events) window.addEventListener(e, load)
    return () => {
      for (const e of events) window.removeEventListener(e, load)
    }
  }, [])
  return p
}
