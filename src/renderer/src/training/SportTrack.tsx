// Sport Track: one app with five sections (the switch in the top bar):
// Dashboard · Workout · Exercises · Progress · Body & Food. This shell draws
// the first four (Body & Food is pages/Body.tsx) on ONE training state
// (useSportTrain), and owns the set-by-set flow and the how-to sheet so every
// section opens the same ones. The old embedded app is the "Classic tracker"
// in the ⋯ menu (SportMenu): its history and badges still count.
import { useState } from 'react'
import type { BodyState } from '@shared/api'
import type { PlanItem } from '@core/trainLog'
import { MoveSheet } from '../body/training/MoveSheet'
import { useSportTrain } from './useSportTrain'
import { SportDashboard } from './SportDashboard'
import { SportWorkout } from './SportWorkout'
import { SportExercises, SportProgress } from './SportMore'
import { WorkoutFlow } from './WorkoutFlow'
import './training-home.css'
import './sport-track.css'

export type SportSection = 'train' | 'workout' | 'exercises' | 'progress'

export function SportTrack({
  section,
  body,
  onBody,
  onWallet,
  onSection,
  onBodyFood
}: {
  section: SportSection
  body: BodyState | null
  onBody: (s: BodyState) => void
  onWallet: () => void
  onSection: (s: SportSection) => void
  onBodyFood: (tab: 'today' | 'food' | 'progress' | 'growth') => void
}) {
  const t = useSportTrain(body, onBody, onWallet)
  const [flow, setFlow] = useState(false)
  const [sheet, setSheet] = useState<PlanItem | null>(null)

  return (
    <div className="sp" data-sp-section={section}>
      {section === 'train' && <SportDashboard t={t} onStart={() => setFlow(true)} onSection={onSection} onBodyFood={onBodyFood} />}
      {section === 'workout' && <SportWorkout t={t} onStart={() => setFlow(true)} onHow={setSheet} />}
      {section === 'exercises' && <SportExercises />}
      {section === 'progress' && <SportProgress body={body} onBody={onBody} onWallet={onWallet} />}
      {flow && t.session && <WorkoutFlow view={t.v} onLog={t.logSet} onUndo={t.undoSet} onFinish={t.finish} onApply={(l) => t.apply(l)} onKeep={(l) => t.keep(l)} onClose={() => setFlow(false)} />}
      {sheet && (
        <div className="body-page sp-sheet-host">
          <MoveSheet level={sheet.level} title={`${sheet.ladder.name.replace(/ \(.*\)$/, '')} · step ${sheet.index + 1} of ${sheet.ladder.levels.length}`} onClose={() => setSheet(null)} />
        </div>
      )}
    </div>
  )
}
