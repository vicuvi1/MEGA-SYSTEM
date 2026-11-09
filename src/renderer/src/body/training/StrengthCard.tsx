// Body → Training: your strength score (0–100, from your best sets) and your
// workout streak. Called "Strength", never a "level": the app has ONE level,
// the Growth level (Body → Growth, the chip in the header). Read only.
import type { BodyState } from '@shared/api'
import { useSportToday } from '../today/useSportToday'

export function StrengthCard({ state }: { state: BodyState }) {
  const sport = useSportToday()
  const rank = sport?.rank ?? null
  const score = rank?.score ?? 0
  return (
    <section className="bdy-card bt-strength" aria-label="Strength and streak">
      <div className="bt-strength-stat">
        <span className="bdy-eyebrow">Strength</span>
        <b className="bdy-num xl">
          {score}
          <span className="bdy-unit">/ 100</span>
        </b>
        <span className="bdy-bar" role="progressbar" aria-label="Strength score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
          <i style={{ ['--p' as string]: score / 100 }} />
        </span>
        {rank?.hint && <span className="bdy-note">{rank.hint.replace(/Level (\d+)/, 'step $1')}</span>}
      </div>
      <div className="bt-strength-stat">
        <span className="bdy-eyebrow">Streak</span>
        <b className="bdy-num xl">
          {state.streak}
          <span className="bdy-unit">{state.streak === 1 ? 'day' : 'days'}</span>
        </b>
        <span className="bdy-note">Best {state.bestStreak}</span>
      </div>
    </section>
  )
}
