// Body → Training: today's session from your home program (Start opens Sport
// Track's Today, which follows it), the program builder, challenges with
// badges, and "This week" (sets per muscle, next steps, strength, workouts).
// Nothing on this tab pays points: points stay with the workouts you log.
import { useEffect } from 'react'
import type { BodyState } from '@shared/api'
import { sessionOn } from '@core/homeProgram'
import { addDays } from '@core/dates'
import { celebrate } from '../../fx'
import { useToast } from '../../ui'
import { ProgramBuilder } from './ProgramBuilder'
import { Challenges } from './Challenges'
import { ThisWeek } from './ThisWeek'
import { Ring } from './Ring'
import { syncTraining, useTraining } from './trainingStore'
import './training.css'

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dayName = (d: string) => DAY[new Date(d + 'T12:00:00Z').getUTCDay()]

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

  const active = ht.active
  const now = active ? sessionOn(active.program, active.startedOn, today) : null
  let next: { day: string; name: string } | null = null
  if (active && !now)
    for (let i = 1; i <= 7 && !next; i++) {
      const d = addDays(today, i)
      const s = sessionOn(active.program, active.startedOn, d)
      if (s) next = { day: d, name: s.session.name }
    }
  const running = ht.challenges.length

  return (
    <div className="bt">
      <section className="card bt-hero" aria-label="Today's training">
        {active ? (
          <>
            <Ring pct={active.week / 4} size={76} stroke={7} label={`Week ${active.week} of 4`}>
              <span className="bt-hero-week">
                <b>{active.week}</b>
                <small>of 4</small>
              </span>
            </Ring>
            <div className="bt-hero-text">
              <small className="bt-eyebrow">{active.week === 4 ? 'Lighter week' : `Week ${active.week} · build`}</small>
              {now ? (
                <>
                  <h2>{now.session.name}</h2>
                  <p className="muted">
                    {now.session.items.length} moves · about {now.session.minutes} min · {now.session.items.slice(0, 3).map((i) => i.move.name).join(', ')}
                    {now.session.items.length > 3 ? '…' : ''}
                  </p>
                </>
              ) : (
                <>
                  <h2>Rest day</h2>
                  <p className="muted">{next ? `Next: ${next.name} on ${dayName(next.day)}.` : 'Recover: sleep and protein do the growing.'}</p>
                </>
              )}
            </div>
            {onOpenSportApp && (
              <button type="button" className="btn primary bt-start" data-bt="start" onClick={onOpenSportApp}>
                {now ? 'Start workout' : 'Open Today'}
              </button>
            )}
          </>
        ) : (
          <div className="bt-hero-text">
            <small className="bt-eyebrow">Home training</small>
            <h2>Build your home program</h2>
            <p className="muted">Pick your minutes, days and what you own. Moves start at your level, and Sport Track's Today follows it.</p>
          </div>
        )}
        <div className="bt-hero-stats">
          <span>
            <b>{running}</b> {running === 1 ? 'challenge' : 'challenges'}
          </span>
          <span>
            <b>{ht.badges.length}</b> {ht.badges.length === 1 ? 'badge' : 'badges'}
          </span>
        </div>
      </section>

      <ProgramBuilder st={st} ht={ht} today={today} onChanged={refresh} />
      <Challenges st={st} ht={ht} today={today} onChanged={refresh} />
      <ThisWeek state={state} onState={onState} onWallet={onWallet} hold={hold} />
    </div>
  )
}
