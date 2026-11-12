// Sport Track → Workout done (the approved artboard, docs/design/sport-track/
// WorkoutDone.dc.html): what you actually did against the target per move
// (reps per set, effort, form, vs last time, records, pain flags), and ONE
// recommended change for next time with its reasons from your data: Apply
// next time / Ask me later, then Undo (your old step comes back, every logged
// set stays). Points are the usual "Workout done" from logged sets only; they
// never decide how hard the next workout is.
import { useState } from 'react'
import type { DoneView } from '@core/trainAdvice'
import type { SportTrain } from './useSportTrain'

export function WorkoutDone({ t, view, title, onClose }: { t: SportTrain; view: DoneView; title: string; onClose: () => void }) {
  const a = view.adjust
  const [said, setSaid] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const apply = () => {
    if (!a) return
    if (a.kind === 'up') {
      const line = t.apply(a.ladder)
      setSaid(line ?? `${a.to} is your step from next time.`)
      setApplied(!!line)
    } else if (a.kind === 'down' && a.toIndex != null) {
      const ok = t.makeStep(a.ladder, a.toIndex)
      setSaid(ok ? `Next time: ${a.to}. Your history stays.` : 'That step could not be set.')
      setApplied(ok)
    }
  }
  const later = () => {
    if (!a) return
    if (a.kind === 'up') setSaid(t.keep(a.ladder) ?? 'Asked again after your next session.')
    else setSaid('Asked again after your next session.')
  }
  const undo = () => {
    if (!a) return
    if (t.makeStep(a.ladder, a.fromIndex)) {
      setSaid(`Back on ${a.from}. Every set you logged stays, and the harder step is offered again after a newer session.`)
      setApplied(false)
    }
  }
  return (
    <div className="wdn" data-tg="finish">
      <header className="wdn-head">
        <div>
          <div className="wdn-eyebrow">Workout complete</div>
          <h1>
            {title}
            {view.minutes ? ` · ${view.minutes} min` : ''}
          </h1>
        </div>
        <div className="wdn-tiles">
          <div className="wdn-tile" data-wd="sets">
            <small>Working sets</small>
            <b className="num">
              {view.setsDone} / {view.setsPlanned}
            </b>
          </div>
          <div className="wdn-tile" data-wd="records">
            <small>New records</small>
            <b className={`num${view.records ? ' lime' : ''}`}>{view.records}</b>
          </div>
          <div className="wdn-tile" data-wd="pains">
            <small>Pain flags</small>
            <b className={`num${view.pains ? ' danger' : ''}`}>{view.pains}</b>
          </div>
        </div>
      </header>
      <section className="wdn-body">
        <article className="wdn-card wdn-table-card">
          <h2>What you actually did</h2>
          <table className="wdn-table">
            <thead>
              <tr>
                <th>Move</th>
                <th>Target</th>
                <th>Reps per set</th>
                <th>Effort</th>
                <th className="r">vs last time</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.ladder} className={r.setsDone ? '' : 'skip'} data-tg="finish-row" data-ladder={r.ladder}>
                  <td className="wdn-move">
                    {r.name}
                    {r.pain && (
                      <span className="wdn-pain" data-tg="row-pain">
                        {r.pain.kind === 'pain' ? `Pain on set ${r.pain.set}${r.pain.where ? ` · ${r.pain.where}` : ''}` : r.pain.kind}
                      </span>
                    )}
                  </td>
                  <td className="wdn-muted num">{r.target}</td>
                  <td className="wdn-reps num" data-tg="row-reps">
                    {r.reps}
                    {r.setsDone > 0 && r.setsDone < r.setsPlanned && <small className="wdn-muted"> ({r.setsDone} of {r.setsPlanned} sets)</small>}
                  </td>
                  <td>
                    {r.effort}
                    {r.form && (
                      <small className={`wdn-form${r.form === 'form good' ? '' : ' warn'}`} data-tg="row-form">
                        {r.form}
                      </small>
                    )}
                  </td>
                  <td className={`r wdn-delta ${r.tone}`} data-tg="row-delta">
                    {r.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="wdn-note">Everything above is saved. Sets with no form tap say “form unknown”: they count for volume, not for a step up. Points are the usual “Workout done”, paid once a day for logged sets; they never set how hard it gets.</p>
        </article>
        <aside className="wdn-side">
          {a && (
            <article className={`wdn-card wdn-adjust ${a.kind}`} data-tg="adjust" data-kind={a.kind}>
              <div className="wdn-eyebrow">{a.kind === 'hold' ? 'Next time' : 'Recommended next time'}</div>
              <h2 data-tg="adjust-title">{a.kind === 'hold' ? `${a.from}: hold steady` : `${a.from} → ${a.to}`}</h2>
              <ul className="wdn-reasons" data-tg="adjust-reasons">
                {a.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              {said && (
                <p className="wdn-said" data-tg="adjust-said">
                  {said}
                </p>
              )}
              {(a.kind === 'up' || a.kind === 'down') && !said && (
                <div className="wdn-actions">
                  <button type="button" className="wdn-btn primary" onClick={apply} data-tg="apply">
                    Apply next time
                  </button>
                  <button type="button" className="wdn-btn" onClick={later} data-tg="keep">
                    Ask me later
                  </button>
                </div>
              )}
              {applied && (
                <button type="button" className="wdn-btn" onClick={undo} data-tg="undo">
                  Undo
                </button>
              )}
              {a.kind === 'alt' && <p className="wdn-small">Pick it from Change › on your next workout: for that day only, your step stays.</p>}
              <p className="wdn-small">You can undo a step any time in Exercises. Your history stays.</p>
            </article>
          )}
          {view.holding.length > 0 && (
            <article className="wdn-card wdn-hold" data-tg="holding">
              <h3>Holding steady</h3>
              {view.holding.map((h) => (
                <p key={h}>{h}</p>
              ))}
            </article>
          )}
          {/* The one main button, unless "Apply next time" is waiting (Esc closes too). */}
          <button type="button" className={`wdn-btn big ${(a?.kind === 'up' || a?.kind === 'down') && !said ? '' : 'primary'}`} onClick={onClose} data-tg="finish-close">
            Done
          </button>
        </aside>
      </section>
    </div>
  )
}
