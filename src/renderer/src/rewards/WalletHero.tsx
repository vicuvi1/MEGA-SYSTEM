// The hero (RW1, Rewards 2): one band with the balance counting up and what
// it is worth in lei, what you earned today, the streak flame (RW8), your
// coupons, and the next reward you'll have at your pace. Your goals and their
// milestones live in "Saving for" on the For you tab.
import { useState } from 'react'
import { leiForPoints, pointValueLine } from '@core/pointValue'
import { useCountUp } from '../motionKit'
import { Cover } from './RewardCard'
import type { ValueInfo } from './useRewards'
import type { Reward } from '@core/shop'
import type { RewardsInsights } from '../../../main/shop'
import { useSimple } from '../useSimple'

const FLAME_TEXT = ['', 'On a roll', 'On fire', 'Unstoppable']

export function Balance({ n, className = '' }: { n: number; className?: string }) {
  const v = Math.round(useCountUp(n, 400))
  return <span className={`num ${className}`}>{v.toLocaleString()}</span>
}

const fmtLei = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(n < 10 ? 1 : 0))

export interface NextUp {
  reward: Reward
  /** "Ready tomorrow" / "40 to go" / "Ready now". */
  line: string
}

export function WalletHero({
  balance,
  insights,
  value,
  next,
  hideEmptyNext,
  coupons,
  onFun,
  onHow,
  onAdd,
  ben
}: {
  balance: number
  insights: RewardsInsights | null
  value: ValueInfo
  next: NextUp | null
  /** No "Add something you want" box when a main goal already has its row. */
  hideEmptyNext?: boolean
  coupons: number
  onFun: (min: number) => void
  onHow: () => void
  onAdd: () => void
  /** Ben's one line, along the bottom of the hero. */
  ben?: React.ReactNode
}) {
  // Simple mode hides the inventory (coupons); they are kept.
  const simple = useSimple()
  const e = insights?.earnings
  const flame = insights?.flame ?? 0
  const [fun, setFun] = useState(false)
  const lei = leiForPoints(balance, value.value)

  return (
    <section className="rx-hero">
      <div className="rx-wallet">
        <span className="rx-kicker">Points to spend</span>
        <div className="rx-balance">
          <i className="rx-coin" aria-hidden />
          <Balance n={balance} />
          <span className="rx-bal-lei" title={`${pointValueLine(value.value)}${value.value.source === 'default' ? ' (set a fun budget in Settings → Rewards to make it yours)' : ''}`}>
            ≈ {fmtLei(lei)} lei
          </span>
        </div>
        <div className="rx-pills">
          <span className={`rx-pill today ${e && e.today > 0 ? 'on' : ''}`}>+{(e?.today ?? 0).toLocaleString()} today</span>
          {flame > 0 && (
            <span className={`rx-pill rx-flame f${flame}`} title={`${insights!.focusStreak} days of focus in a row${insights!.focusStreak >= 7 ? ': +10% on focus points' : ''}`}>
              <i aria-hidden>🔥</i> {insights!.focusStreak} days · {FLAME_TEXT[flame]}
            </span>
          )}
          {coupons > 0 && !simple.on && (
            <span className="rx-pill rx-coupon-pill" title="Coupons from chests and the mystery reward: they make a buy cheaper or free">
              🎟️ {coupons} coupon{coupons > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {(next || !hideEmptyNext) && <div className="rx-next">
        {next ? (
          <>
            <Cover r={next.reward} small />
            <span className="rx-next-text">
              <span className="rx-kicker">Next reward</span>
              <b>{next.reward.title}</b>
              <small className={next.line.startsWith('Ready') ? 'ok' : ''}>{next.line}</small>
            </span>
          </>
        ) : (
          <span className="rx-next-text">
            <span className="rx-kicker">Next reward</span>
            <b>Add something you want</b>
            <small>Pick one from Suggested for you</small>
          </span>
        )}
      </div>}

      <div className="rx-hero-acts">
        <button type="button" className="rx-btn primary" onClick={onAdd}>
          + Add
        </button>
        <button type="button" className="rx-btn" onClick={onHow}>
          How to earn
        </button>
        <button type="button" className={`rx-btn ${fun ? 'on' : ''}`} aria-expanded={fun} onClick={() => setFun((f) => !f)}>
          🎮 Fun time
        </button>
      </div>
      {ben && <div className="rx-hero-ben">{ben}</div>}
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
    </section>
  )
}

function Ring({ frac, children, size = 64 }: { frac: number; children: React.ReactNode; size?: number }) {
  const R = 46
  const C = 2 * Math.PI * R
  const f = Math.max(0, Math.min(1, frac))
  return (
    <div className="rx-ring" style={{ width: size, height: size }}>
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
export { Ring }
