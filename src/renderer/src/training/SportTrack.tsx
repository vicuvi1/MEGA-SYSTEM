// Sport Track: one app with five sections (the switch in the top bar):
// Dashboard · Workout · Exercises · Progress · Body & Food. This shell draws
// the first four (Body & Food is pages/Body.tsx) on ONE training state
// (useSportTrain), and owns the set-by-set flow and the how-to sheet so every
// section opens the same ones. The old embedded app is the "Classic tracker"
// in the ⋯ menu (SportMenu): its history and badges still count.
import { useState } from 'react'
import type { BodyState } from '@shared/api'
import type { PlanItem } from '@core/trainLog'
import type { LadderId } from '@core/trainLadders'
import { MoveSheet } from '../body/training/MoveSheet'
import { useSportTrain } from './useSportTrain'
import { SportDashboard } from './SportDashboard'
import { SportWorkout } from './SportWorkout'
import { SportExercises, SportProgress } from './SportMore'
import { SwapSheet } from './SwapSheet'
import { GearView } from './GearView'
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
  const [sheet, setSheet] = useState<PlanItem | null>(null)
  const [swap, setSwap] = useState<LadderId | null>(null)
  const [gear, setGear] = useState(false)

  return (
    <div className="sp" data-sp-section={gear ? 'gear' : section}>
      {gear && <GearView t={t} onBack={() => setGear(false)} />}
      {!gear && section === 'train' && <SportDashboard t={t} onStart={() => onSection('workout')} onSection={onSection} onBodyFood={onBodyFood} onSwap={setSwap} onGear={() => setGear(true)} />}
      {!gear && section === 'workout' && <SportWorkout t={t} onHow={setSheet} onSwap={setSwap} />}
      {!gear && section === 'exercises' && <SportExercises onGear={() => setGear(true)} />}
      {!gear && section === 'progress' && <SportProgress body={body} onBody={onBody} onWallet={onWallet} />}
      {swap && <SwapSheet t={t} ladder={swap} onClose={() => setSwap(null)} onGear={() => setGear(true)} />}
      {sheet && (
        <div className="body-page sp-sheet-host">
          <MoveSheet level={sheet.level} title={`${sheet.ladder.name.replace(/ \(.*\)$/, '')} · step ${sheet.index + 1} of ${sheet.ladder.levels.length}`} onClose={() => setSheet(null)} />
        </div>
      )}
    </div>
  )
}
