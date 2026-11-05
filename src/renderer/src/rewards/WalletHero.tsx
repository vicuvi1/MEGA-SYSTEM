// The hero wallet (RW1): the balance counting up, "+X today", this week's
// earned and spent, the streak flame (RW8), what a point is worth, and the
// goal you're saving for with its photo in a progress ring and the day you'll
// reach it at your pace (RG1).
import { useState } from 'react'
import type { Reward } from '@core/shop'
import { pointValueLine } from '@core/pointValue'
import { readyLine, soonerWith } from '@core/rewardsKit'
import { useCountUp } from '../motionKit'
import { Cover } from './RewardCard'
import { useGrowFrom, type ValueInfo } from './useRewards'
import type { RewardsInsights } from '../../../main/shop'

const FLAME_TEXT = ['', 'On a roll', 'On fire', 'Unstoppable']

export function Balance({ n, className = '' }: { n: number; className?: string }) {
  const v = Math.round(useCountUp(n, 400))
  return <span className={`num ${className}`}>{v.toLocaleString()}</span>
}

function Ring({ frac, children }: { frac: number; children: React.ReactNode }) {
  const R = 46
  const C = 2 * Math.PI * R
  const f = Math.max(0, Math.min(1, frac))
  return (
    <div className="rx-ring">
      <svg viewBox="0 0 104 104" aria-hidden>
        <defs>
          <linearGradient id="rxRingG" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
        <circle cx="52" cy="52" r={R} className="bg" />
        <circle cx="52" cy="52" r={R} className="fg" strokeDasharray={C} strokeDashoffset={C * (1 - f)} />
      </svg>
      <div className="rx-ring-in">{children}</div>
    </div>
  )
}

export function WalletHero({
  balance,
  goals,
  perDay,
  today,
  insights,
  value,
  onFun,
  onHow,
  onAdd
}: {
  balance: number
  goals: Reward[]
  perDay: number
  today: string
  insights: RewardsInsights | null
  value: ValueInfo
  onFun: (min: number) => void
  onHow: () => void
  onAdd: () => void
}) {
  const goal = goals[0] ?? null
  const have = goal ? balance + (goal.jar ?? 0) : 0
  const left = goal ? Math.max(0, goal.price - have) : 0
  const frac = goal ? have / Math.max(1, goal.price) : 0
  const grown = useGrowFrom(goal ? `g${goal.id}` : 'g', frac)
  const sooner = goal && left > 0 ? soonerWith(left, perDay, 2) : null
  const ready = goal ? readyLine(today, left, perDay) : null
  const e = insights?.earnings
  const flame = insights?.flame ?? 0
  const [fun, setFun] = useState(false)

  return (
    <section className="rx-hero">
      <div className="rx-wallet">
        <span className="rx-kicker">Points to spend</span>
        <div className="rx-balance">
          <i className="rx-coin" aria-hidden />
          <Balance n={balance} />
        </div>
        <div className="rx-pills">
          <span className={`rx-pill today ${e && e.today > 0 ? 'on' : ''}`}>+{(e?.today ?? 0).toLocaleString()} today</span>
          {e && (
            <span className="rx-pill" title="This week, from Monday">
              Week <b className="up">+{e.thisWeek.earned.toLocaleString()}</b> <b className="down">−{e.thisWeek.spent.toLocaleString()}</b>
            </span>
          )}
          {flame > 0 && (
            <span className={`rx-pill rx-flame f${flame}`} title={`${insights!.focusStreak} days of focus in a row${insights!.focusStreak >= 7 ? ': +10% on focus points' : ''}`}>
              <i aria-hidden>🔥</i> {insights!.focusStreak} days · {FLAME_TEXT[flame]}
            </span>
          )}
        </div>
        <p className="rx-worth">
          {pointValueLine(value.value)}
          {value.value.source === 'default' ? ' (set a fun budget in Settings → Rewards to make it yours)' : ''}
        </p>
        <div className="rx-hero-acts">
          <button type="button" className="rx-btn primary" onClick={onAdd}>
            + Add a reward
          </button>
          <button type="button" className="rx-btn" onClick={onHow}>
            How to earn
          </button>
          <button type="button" className={`rx-btn ${fun ? 'on' : ''}`} aria-expanded={fun} onClick={() => setFun((f) => !f)}>
            🎮 Fun time
          </button>
        </div>
        {fun && (
          <div className="rx-fun">
            <span>Guilt-free fun · 1 point a minute</span>
            {[15, 30, 60].map((min) => (
              <button key={min} type="button" className="rx-chip" disabled={balance < min} onClick={() => onFun(min)}>
                {min} min
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rx-goal">
        {goal ? (
          <>
            <Ring frac={grown}>
              <Cover r={goal} small />
            </Ring>
            <div className="rx-goal-text">
              <span className="rx-kicker">Saving for</span>
              <b className="rx-goal-title">{goal.title}</b>
              <span className="rx-goal-left">{left > 0 ? `${left.toLocaleString()} to go · ${Math.floor(frac * 100)}%` : 'You can get it now 🎉'}</span>
              {ready && left > 0 && <span className="rx-goal-eta">{ready} at your pace</span>}
              {sooner && sooner.days > 0 && (
                <span className="rx-goal-tip">
                  {sooner.blocks} focus blocks a day → {sooner.days} day{sooner.days > 1 ? 's' : ''} sooner
                </span>
              )}
              {sooner && !ready && <span className="rx-goal-tip">{sooner.blocks} focus blocks a day → ready in {sooner.alone} days</span>}
              {goals.length > 1 && (
                <span className="rx-goal-more">
                  Next:{' '}
                  {goals.slice(1).map((g) => (
                    <i key={g.id}>{g.title}</i>
                  ))}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="rx-goal-empty">
            <span className="rx-kicker">Saving for</span>
            <b>Pick something worth working for</b>
            <span>Open a reward's ⋯ menu and choose "Save for this".</span>
          </div>
        )}
      </div>
    </section>
  )
}
