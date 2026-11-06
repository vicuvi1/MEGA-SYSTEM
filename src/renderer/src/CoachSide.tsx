// "Ben's view of today": a side panel next to the chat on wide screens
// (1280 px and up). Coach UI v3: the plan as a timeline, must-dos, focus this
// week, water and points; it grows on very wide screens instead of leaving
// empty space. It can be folded away; the choice is remembered on this device.
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { CoachStatus } from './web/coachStatus'
import type { RhythmState } from '@core/rhythm'
import { fmtMinutes, planTimeline } from '@core/planView'
import { GlyphIcon, Ring } from './CoachFeed'
import { PlanTrack } from './CoachCards'
import { barFill } from './motionKit'
import { life } from './bridge'
import { useLive } from './live'

const fmtMin = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n} min`)
const nowMin = () => new Date().getHours() * 60 + new Date().getMinutes()

export function CoachSide({ status, onClose, onOpen, onPlan, onWater, onFocus }: { status: CoachStatus; onClose: () => void; onOpen: (tab: 'plan' | 'today' | 'goals') => void; onPlan?: () => void; onWater: () => void; onFocus: () => void }) {
  const t = status.today
  const max = Math.max(30, ...status.week.map((d) => d.min))
  const weekMin = status.week.reduce((a, d) => a + d.min, 0)
  const plan = status.plan
  const [rh, setRh] = useState<RhythmState | null>(null)
  const [points, setPoints] = useState<{ balance: number; today: number } | null>(null)
  const load = useCallback(() => {
    life.coach?.rhythm?.('state').then((r) => setRh(r.state)).catch(() => {})
    life.wallet
      ?.summary()
      .then((s) => setPoints({ balance: s.balance, today: s.todayCoins }))
      .catch(() => {})
  }, [])
  useEffect(load, [load, status])
  useLive(load)
  const tl = rh?.briefing ? planTimeline(rh.briefing.plan, nowMin()) : null
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <aside className="cf-side" aria-label="Ben's view of today">
      <header>
        <span>
          <b>Today</b>
          <small>{date}</small>
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide this panel" title="Hide this panel">
          ›
        </button>
      </header>

      <section className={`cf-side-card plan s-${plan.status}`}>
        <button type="button" className="as-btn" onClick={() => (onPlan ? onPlan() : onOpen('plan'))} title="Show the plan in the chat">
          <span className="ic">
            <GlyphIcon kind="plan" size={16} />
          </span>
          <span className="tx">
            <small>Plan</small>
            <b>{plan.status === 'approved' ? 'Approved' : plan.status === 'proposed' ? 'Waiting for you' : 'Not made yet'}</b>
          </span>
          <em className={`pill s-${plan.status}`}>{plan.score != null ? `${plan.score}/100` : plan.status === 'proposed' ? 'Review' : plan.status === 'approved' ? '✓' : 'Plan it'}</em>
        </button>
        {tl && tl.items.length > 0 ? (
          <>
            <PlanTrack items={tl.items} now={tl.now} from={tl.from} to={tl.to} />
            <ol className="cf-side-plan">
              {tl.items.map((x, k) => (
                <li key={k} className={`tone-${x.tone} s-${x.state}`} style={{ '--k': k } as CSSProperties}>
                  <span className="tm">{x.start}</span>
                  <i className="dot" aria-hidden />
                  <span className="tt">{x.train ? `💪 ${x.title}` : x.title}</span>
                  <small>{x.state === 'now' ? 'now' : x.train ? '' : fmtMinutes(x.minutes)}</small>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="cf-side-empty">{plan.status === 'none' ? 'Ask Ben to plan your day: blocks in your free time, must-dos, training.' : `${plan.mustdos} must-dos · ${plan.blocks} blocks`}</p>
        )}
      </section>

      <section className="cf-side-card">
        <div className="hd">
          <span className="ic">
            <GlyphIcon kind="done" size={16} />
          </span>
          <b>Must-dos</b>
          <small>{t.mustTotal ? `${t.mustDone} of ${t.mustTotal}` : 'none'}</small>
        </div>
        {t.mustTotal > 0 && (
          <div className="cf-bar pbar">
            <i style={barFill(t.mustDone / t.mustTotal)} />
          </div>
        )}
        {status.mustdos.length > 0 ? (
          <ul className="cf-side-list">
            {status.mustdos.slice(0, 6).map((x) => (
              <li key={x.i} className={x.done ? 'done' : ''}>
                <i aria-hidden>{x.done ? '✓' : ''}</i>
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cf-side-empty">No must-dos yet. Approve a plan and they land here.</p>
        )}
      </section>

      <div className="cf-side-duo">
        {!!t.waterTarget && (
          <section className="cf-side-card water">
            <Ring value={t.waterMl / t.waterTarget} size={58} tone="water">
              {Math.round((t.waterMl / t.waterTarget) * 100)}%
            </Ring>
            <span className="tx">
              <small>Water</small>
              <b>
                {(t.waterMl / 1000).toFixed(1)} / {(t.waterTarget / 1000).toFixed(1)} L
              </b>
              <button type="button" className="cf-side-btn" onClick={onWater}>
                + 250 ml
              </button>
            </span>
          </section>
        )}
        {points && (
          <section className="cf-side-card points">
            <span className="coin" aria-hidden>
              ●
            </span>
            <span className="tx">
              <small>Points</small>
              <b>{points.balance.toLocaleString('en-GB')}</b>
              <em>{points.today > 0 ? `+${points.today} today` : points.today < 0 ? `${points.today} today` : 'Nothing yet today'}</em>
            </span>
          </section>
        )}
      </div>

      <section className="cf-side-card">
        <div className="hd">
          <span className="ic ic-focus">
            <GlyphIcon kind="focus" size={16} />
          </span>
          <b>Focus</b>
          <small>
            {fmtMin(t.focusMin)} today · {fmtMin(weekMin)} this week
          </small>
        </div>
        <div className="cf-week" aria-label={`Focus this week: ${fmtMin(weekMin)}`}>
          {status.week.map((d, k) => (
            <span key={d.day} className={k === status.week.length - 1 ? 'today' : ''} title={`${d.day}: ${fmtMin(d.min)}`}>
              <i style={{ transform: `scaleY(${Math.max(0.04, d.min / max)})` }} />
              <small>{new Date(`${d.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' })}</small>
            </span>
          ))}
        </div>
        <button type="button" className="cf-side-btn" onClick={onFocus}>
          {status.move.kind === 'running' ? 'Stop & log' : '▶ Start a focus block'}
        </button>
      </section>
    </aside>
  )
}
