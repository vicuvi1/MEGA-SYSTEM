// "Ben's view of today": a side panel next to the chat on wide screens
// (1280 px and up): the plan, must-dos, focus this week and the water ring.
// It can be folded away; the choice is remembered on this device.
import type { CoachStatus } from './web/coachStatus'
import { GlyphIcon, Ring } from './CoachFeed'

const fmtMin = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n} min`)

export function CoachSide({ status, onClose, onOpen, onWater, onFocus }: { status: CoachStatus; onClose: () => void; onOpen: (tab: 'plan' | 'today' | 'goals') => void; onWater: () => void; onFocus: () => void }) {
  const t = status.today
  const max = Math.max(30, ...status.week.map((d) => d.min))
  const weekMin = status.week.reduce((a, d) => a + d.min, 0)
  const plan = status.plan
  return (
    <aside className="cf-side" aria-label="Ben's view of today">
      <header>
        <b>Ben's view of today</b>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Hide this panel" title="Hide this panel">
          ›
        </button>
      </header>

      <button type="button" className={`cf-side-card plan s-${plan.status}`} onClick={() => onOpen('plan')}>
        <span className="ic">
          <GlyphIcon kind="plan" size={16} />
        </span>
        <span className="tx">
          <small>Plan</small>
          <b>{plan.status === 'approved' ? 'Approved' : plan.status === 'proposed' ? 'Waiting for you' : 'Not made yet'}</b>
          <em>{plan.score != null ? `Day score ${plan.score}/100` : plan.status === 'none' ? 'Ask Ben to plan your day' : `${plan.mustdos} must-dos · ${plan.blocks} blocks`}</em>
        </span>
      </button>

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
            <i style={{ '--p': t.mustDone / t.mustTotal } as React.CSSProperties} />
          </div>
        )}
        {status.mustdos.length > 0 ? (
          <ul className="cf-side-list">
            {status.mustdos.slice(0, 5).map((x) => (
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

      <section className="cf-side-card">
        <div className="hd">
          <span className="ic">
            <GlyphIcon kind="focus" size={16} />
          </span>
          <b>Focus</b>
          <small>{fmtMin(t.focusMin)} today</small>
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
          {status.move.kind === 'running' ? 'Stop & log' : 'Start a focus block'}
        </button>
      </section>

      {!!t.waterTarget && (
        <section className="cf-side-card water">
          <Ring value={t.waterMl / t.waterTarget} size={64} tone="water">
            {Math.round((t.waterMl / t.waterTarget) * 100)}%
          </Ring>
          <span className="tx">
            <small>Water</small>
            <b>
              {(t.waterMl / 1000).toFixed(1)} of {(t.waterTarget / 1000).toFixed(1)} L
            </b>
            <button type="button" className="cf-side-btn" onClick={onWater}>
              + 250 ml
            </button>
          </span>
        </section>
      )}
    </aside>
  )
}
