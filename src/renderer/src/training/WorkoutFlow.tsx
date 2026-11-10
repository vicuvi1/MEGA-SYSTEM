// Start Workout: a focused, set-by-set flow over the Training home. One set at
// a time: the move, its level and target, last time, the reps (− / + or type
// them), an effort tap (Hard / OK / Easy) and the optional form check, then
// Log set. A rest timer follows each set (the engine's rest for that level,
// +15 s, Skip) and plays the "focus end" sound at zero. Every set is saved
// the moment it is logged, so closing never loses anything. Finish logs the
// usual workout (built only from logged sets) and shows what changed: an
// unlocked move with Apply / Keep, or what next time looks like.
import { useEffect, useRef, useState } from 'react'
import type { Feel } from '@core/trainLog'
import type { FinishRow, TrackerItem, TrackerView } from '@core/sportTrain'
import { buzz, play } from '../soundKit'

const FEELS: { id: Feel; label: string; hint: string }[] = [
  { id: 'hard', label: 'Hard', hint: '0–1 reps left' },
  { id: 'ok', label: 'OK', hint: '1–2 reps left: the target' },
  { id: 'easy', label: 'Easy', hint: '3+ reps left' }
]
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`

export interface FinishChoice {
  ladder: string
  kind: 'apply' | 'keep'
  line: string
}

export function WorkoutFlow({
  view,
  onLog,
  onUndo,
  onFinish,
  onApply,
  onKeep,
  onClose
}: {
  view: TrackerView
  onLog: (it: TrackerItem, reps: number, feel: Feel, formOff: boolean) => void
  onUndo: (setId: string) => void
  onFinish: () => Promise<FinishRow[] | null>
  onApply: (ladder: string) => string | null
  onKeep: (ladder: string) => string | null
  onClose: () => void
}) {
  const items = view.items
  const firstOpen = Math.max(0, items.findIndex((it) => it.done.length < it.sets))
  const [pick, setPick] = useState<number | null>(null)
  const idx = Math.min(items.length - 1, pick ?? firstOpen)
  const it = items[idx]
  const n = it ? it.done.length : 0
  const aim = it ? it.aim[Math.min(n, it.aim.length - 1)] ?? it.level.lo : 0
  const [reps, setReps] = useState(aim)
  const [feel, setFeel] = useState<Feel | null>(null)
  const [formOk, setFormOk] = useState(true)
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [report, setReport] = useState<FinishRow[] | null>(null)
  const [choices, setChoices] = useState<Record<string, FinishChoice>>({})
  const [busy, setBusy] = useState(false)
  const rang = useRef(false)
  // A new set (or another move) starts from its aim, with a fresh effort tap.
  const key = it ? `${it.ladder.id}:${n}` : ''
  useEffect(() => {
    setReps(aim)
    setFeel(null)
    setFormOk(true)
  }, [key])
  useEffect(() => {
    if (!rest) return
    rang.current = false
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [rest])
  const left = rest ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : 0
  useEffect(() => {
    if (!rest || left > 0 || rang.current) return
    rang.current = true
    try {
      play('focusEnd')
      buzz([180, 90, 180])
    } catch {
      /* sound is a nicety */
    }
    const t = window.setTimeout(() => setRest(null), 1200)
    return () => window.clearTimeout(t)
  }, [left, rest])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const allDone = view.setsDone >= view.setsPlanned && view.setsPlanned > 0
  const unit = it?.level.unit === 'sec' ? ' s' : ''
  const step = it?.level.unit === 'sec' ? 5 : 1

  const log = () => {
    if (!it || !feel || reps < 1) return
    onLog(it, reps, feel, !formOk)
    setPick(null)
    const after = view.setsDone + (n < it.sets ? 1 : 0)
    if (after < view.setsPlanned) setRest({ endsAt: Date.now() + it.rest * 1000, total: it.rest })
    else setRest(null)
  }

  const finish = async () => {
    setBusy(true)
    setRest(null)
    const rows = await onFinish()
    setBusy(false)
    if (rows) setReport(rows)
  }

  const pctRing = rest && rest.total ? left / rest.total : 0
  const ringC = 2 * Math.PI * 54

  if (report)
    return (
      <div className="tg-flow" role="dialog" aria-modal="true" aria-label="Workout finished" data-tg="finish">
        <div className="tg-flow-card tg-finish">
          <header className="tg-flow-head">
            <div>
              <small className="tg-eyebrow">Workout done</small>
              <h2 className="tg-flow-title">{view.title.replace(/^Done: /, '')}</h2>
            </div>
          </header>
          <p className="tg-finish-stats">
            <span>
              <b className="num">{view.setsDone}</b> sets
            </span>
            <span>
              <b className="num">{view.items.reduce((t, x) => t + x.done.reduce((a, s) => a + s.reps, 0), 0)}</b> reps
            </span>
          </p>
          <h3 className="tg-finish-h">What changed</h3>
          {report.length === 0 && <p className="tg-muted">No sets were logged, so nothing changes.</p>}
          <ul className="tg-finish-list">
            {report.map((r) => {
              const c = choices[r.ladder]
              return (
                <li key={r.ladder} className={`tg-finish-row${r.offer && !c ? ' offer' : ''}`} data-tg="finish-row" data-ladder={r.ladder}>
                  <div className="tg-finish-move">
                    <b>{r.name}</b>
                    <span className="num">{r.sets}</span>
                  </div>
                  <p className="tg-finish-line" data-tg="finish-line">
                    {c ? c.line : r.line}
                  </p>
                  {r.offer && !c && (
                    <div className="tg-finish-actions">
                      <button
                        type="button"
                        className="tg-btn primary"
                        data-tg="apply"
                        onClick={() => {
                          const line = onApply(r.ladder)
                          if (line) setChoices((m) => ({ ...m, [r.ladder]: { ladder: r.ladder, kind: 'apply', line } }))
                        }}
                      >
                        Apply: {r.offer.name}
                      </button>
                      <button
                        type="button"
                        className="tg-btn"
                        data-tg="keep"
                        onClick={() => {
                          const line = onKeep(r.ladder)
                          if (line) setChoices((m) => ({ ...m, [r.ladder]: { ladder: r.ladder, kind: 'keep', line } }))
                        }}
                      >
                        Keep {r.name}
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="tg-flow-foot">
            <button type="button" className="tg-btn primary big" onClick={onClose} data-tg="finish-close">
              Done
            </button>
          </div>
        </div>
      </div>
    )

  return (
    <div className="tg-flow" role="dialog" aria-modal="true" aria-label="Workout" data-tg="flow">
      <div className="tg-flow-card">
        <header className="tg-flow-head">
          <div>
            <small className="tg-eyebrow">
              {view.title} · {view.setsDone} of {view.setsPlanned} sets
            </small>
            <div className="tg-flow-bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${view.setsPlanned ? view.setsDone / view.setsPlanned : 0})` }} />
            </div>
          </div>
          <div className="tg-flow-head-actions">
            <button type="button" className={`tg-btn${allDone ? ' primary' : ''}`} onClick={() => void finish()} disabled={busy || view.setsDone === 0} data-tg="finish-btn">
              Finish workout
            </button>
            <button type="button" className="tg-btn quiet" onClick={onClose} aria-label="Close (every set is already saved)" title="Close: every set is already saved" data-tg="flow-close">
              Close
            </button>
          </div>
        </header>
        <div className="tg-flow-body">
          <ol className="tg-flow-moves" aria-label="Moves">
            {items.map((x, i) => (
              <li key={x.ladder.id}>
                <button type="button" className={`${i === idx ? 'on' : ''}${x.done.length >= x.sets ? ' done' : ''}`} onClick={() => setPick(i)} aria-current={i === idx ? 'step' : undefined}>
                  <span className="tg-flow-move-name">{x.name}</span>
                  <span className="num">
                    {Math.min(x.done.length, x.sets)}/{x.sets}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {it && (
            <section className="tg-flow-main" aria-live="polite">
              <small className="tg-eyebrow" data-tg="flow-set">
                {n >= it.sets ? 'Extra set' : `Set ${n + 1} of ${it.sets}`} · {it.ladder.name} · {it.levelText}
              </small>
              <h2 className="tg-flow-title" data-tg="flow-move">
                {it.name}
              </h2>
              <p className="tg-flow-target">
                <b className="num">{it.target}</b> · {it.effort}
              </p>
              <p className="tg-muted">{it.lastLine}</p>
              <div className="tg-flow-chips" aria-label="Today's sets">
                {it.done.map((s) => (
                  <button key={s.id} type="button" className={`tg-chip got${s.reps >= it.level.hi ? ' top' : ''}`} onClick={() => s.id && onUndo(s.id)} title="Logged. Tap to take it back." data-tg="flow-chip">
                    {s.reps}
                    {unit}
                    {s.feel ? <small> {s.feel}</small> : null}
                    {s.form === 'off' ? <small> form</small> : null}
                  </button>
                ))}
                {Array.from({ length: Math.max(0, it.sets - n) }, (_, k) => (
                  <span key={k} className="tg-chip">
                    {it.aim[n + k] ?? it.level.lo}
                    {unit}
                  </span>
                ))}
              </div>
              {rest ? (
                <div className={`tg-rest${left === 0 ? ' over' : ''}`} role="timer" aria-label={left ? `Rest: ${left} seconds left` : 'Rest over'} data-tg="rest">
                  <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden="true">
                    <circle cx="64" cy="64" r="54" className="tg-rest-bg" />
                    <circle cx="64" cy="64" r="54" className="tg-rest-fg" strokeDasharray={ringC} strokeDashoffset={ringC * (1 - pctRing)} transform="rotate(-90 64 64)" />
                  </svg>
                  <div className="tg-rest-text">
                    <small>{left ? 'Rest' : 'Go'}</small>
                    <b className="num" data-tg="rest-left">
                      {left ? mmss(left) : 'Next set'}
                    </b>
                  </div>
                  <div className="tg-rest-actions">
                    <button type="button" className="tg-btn" onClick={() => setRest((r) => (r ? { endsAt: r.endsAt + 15000, total: r.total + 15 } : r))}>
                      +15 s
                    </button>
                    <button type="button" className="tg-btn primary" onClick={() => setRest(null)} data-tg="rest-skip">
                      Skip rest
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  className="tg-flow-log"
                  onSubmit={(e) => {
                    e.preventDefault()
                    log()
                  }}
                >
                  <div className="tg-reps">
                    <button type="button" className="tg-btn big" onClick={() => setReps((r) => Math.max(1, r - step))} aria-label={`${step} less`}>
                      −
                    </button>
                    <input className="tg-reps-num num" type="number" inputMode="numeric" min={1} max={600} value={reps} onChange={(e) => setReps(Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))))} aria-label={`${it.name}, ${it.level.unit === 'sec' ? 'seconds' : 'reps'}`} data-tg="reps" />
                    <button type="button" className="tg-btn big" onClick={() => setReps((r) => Math.min(600, r + step))} aria-label={`${step} more`}>
                      +
                    </button>
                    <span className="tg-muted">{it.level.unit === 'sec' ? 'seconds' : 'reps'}</span>
                  </div>
                  <div className="tg-seg tg-feel" role="radiogroup" aria-label="How hard was it?">
                    {FEELS.map((f) => (
                      <button key={f.id} type="button" role="radio" aria-checked={feel === f.id} className={feel === f.id ? 'on' : ''} onClick={() => setFeel(f.id)} data-feel={f.id}>
                        <b>{f.label}</b>
                        <small>{f.hint}</small>
                      </button>
                    ))}
                  </div>
                  <label className="tg-form-check">
                    <input type="checkbox" checked={formOk} onChange={(e) => setFormOk(e.target.checked)} data-tg="form" />
                    Form stayed good (optional check: a set with broken form does not count toward the next move)
                  </label>
                  <button type="submit" className="tg-btn primary big" disabled={!feel || reps < 1} data-tg="log-set">
                    {feel ? `Log set: ${reps}${unit}` : 'Tap how it felt'}
                  </button>
                </form>
              )}
              {it.nextTime && <p className={`tg-next ${it.nextTime.kind}`}>{it.nextTime.line}</p>}
              {allDone && !rest && (
                <p className="tg-flow-alldone" data-tg="all-done">
                  All {view.setsPlanned} sets done. Tap Finish workout to see what changes next time.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

/** "Next time: Decline push-ups 3 × 6–12, because 3×12 easy twice." */
export const appliedLine = (o: { name: string; target: string; reason: string }) => `Next time: ${o.name} ${o.target}, because ${o.reason}.`
export const keptLine = (name: string) => `Staying on ${name}. The harder move is offered again after your next session at the top.`
