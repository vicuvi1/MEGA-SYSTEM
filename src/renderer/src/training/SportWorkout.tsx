// Sport Track → Workout: today's session to look at and adjust before (or
// between) sets. Each move with its picture, sets × reps, rest and Easier /
// Harder (one step on its chain; history stays); drag the moves (or use the
// arrow keys on the handle) to change their order; how much today (Full /
// Lighter / Short, from readiness unless you pick); a big rest timer; and on
// the right what unlocked and why, with Apply change / Keep for now. Start
// Workout opens the set-by-set flow (WorkoutFlow). Nothing here pays points.
import { useEffect, useMemo, useRef, useState } from 'react'
import { DOSE_LABEL, requirementsOf, type TrackerItem } from '@core/sportTrain'
import type { Dose, PlanItem } from '@core/trainLog'
import { moveInfo, moveName } from '@core/trainLadders'
import { TYPE_NAME } from '@core/trainWeek'
import { buzz, play } from '../soundKit'
import { Icon } from '../Icon'
import { MovePic } from './MovePic'
import type { SportTrain } from './useSportTrain'
import { CardHead, PlayIcon } from './sportBits'

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`
const restText = (s: number) => (s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s / 60}:00`)

export function SportWorkout({ t, onStart, onHow }: { t: SportTrain; onStart: () => void; onHow: (it: PlanItem) => void }) {
  const { v } = t
  if (v.stage === 'rest')
    return (
      <div className="sp-wk" data-sp="workout">
        <section className="sp-card sp-wk-hero">
          <div className="sp-wk-hero-text">
            <h2 data-tg="plan-title">{v.title}</h2>
            <p>{v.line}</p>
          </div>
          <div className="sp-actions tight">
            {v.anyway && (
              <button type="button" className="sp-btn primary big" onClick={() => t.trainAnyway(v.anyway)} data-tg="anyway">
                <PlayIcon /> Train anyway: {TYPE_NAME[v.anyway]}
              </button>
            )}
            {v.skipped && (
              <button type="button" className="sp-btn big" onClick={() => void t.restToday(false)} data-tg="skip-back">
                I can train after all
              </button>
            )}
          </div>
        </section>
        <section className="sp-card">
          <CardHead icon="sun" title="8 minutes of mobility" sub="Slow and easy. Nothing here is needed to keep your streak." />
          <ul className="sp-wk-list">
            {v.mobility.map((m) => (
              <li key={m.id} className="sp-wk-row mob">
                <MovePic move={m.id} size="sm" />
                <span className="sp-wk-name">{m.name}</span>
                <span className="sp-pill num">
                  {m.set} {m.unit === 'sec' ? 's' : m.unit}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    )
  const nextUp = v.items.find((it) => it.done.length < it.sets) ?? v.items[0]
  return (
    <div className="sp-wk" data-sp="workout">
      <section className="sp-card sp-wk-hero">
        <span className="sp-wk-hero-icon" aria-hidden="true">
          <Icon name="bolt" size={26} />
        </span>
        <div className="sp-wk-hero-text">
          <h2>
            Workout · <span data-tg="plan-title">{v.title}</span>
          </h2>
          <p>{v.line}</p>
        </div>
        <div className="sp-wk-chips">
          <span className="sp-chip">
            <Icon name="home" size={14} /> Home workout
          </span>
          <span className="sp-chip num">
            <Icon name="clock" size={14} /> ≈ {v.minutes} min
          </span>
          <span className="sp-chip num">
            <Icon name="chart" size={14} /> {v.setsPlanned} sets
          </span>
        </div>
        {v.stage !== 'done' ? (
          <button type="button" className="sp-btn primary big" onClick={onStart} data-tg="start">
            {v.stage === 'going' ? 'Continue workout' : 'Start Workout'} <PlayIcon />
          </button>
        ) : (
          <span className="sp-done" data-tg="done">
            <Icon name="check" size={16} /> Done for today · {v.setsDone} sets
          </span>
        )}
      </section>

      <div className="sp-wk-grid">
        <div className="sp-wk-main">
          <MoveList t={t} onHow={onHow} />
          <div className="sp-wk-pair">
            <DoseCard t={t} />
            <RestTimerCard seconds={nextUp?.rest ?? 90} label={nextUp ? `Rest after a set of ${nextUp.name}` : 'Rest between sets'} />
          </div>
        </div>
        <aside className="sp-wk-side">
          <UnlockCard t={t} />
          {nextUp && <FormCard it={nextUp} />}
        </aside>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- the moves

function MoveList({ t, onHow }: { t: SportTrain; onHow: (it: PlanItem) => void }) {
  const items = t.v.items
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const ids: string[] = items.map((it) => it.ladder.id)
  const open = items.findIndex((it) => it.done.length < it.sets)
  const move = (id: string, to: number) => {
    const from = ids.indexOf(id)
    if (from < 0 || to < 0 || to >= ids.length || from === to) return
    const next = [...ids]
    next.splice(from, 1)
    next.splice(to, 0, id)
    t.reorder(next)
  }
  return (
    <section className="sp-card sp-wk-moves">
      <CardHead icon="list" title={`Your Workout`} sub={`${items.length} ${items.length === 1 ? 'move' : 'moves'} · drag to change the order`} />
      <ol className="sp-wk-list" data-tg="moves">
        {items.map((it, i) => {
          const full = it.done.length >= it.sets
          const info = moveInfo(it.level.move)
          return (
            <li
              key={it.ladder.id}
              className={`sp-wk-row${full ? ' done' : ''}${drag === it.ladder.id ? ' dragging' : ''}${over === it.ladder.id && drag && drag !== it.ladder.id ? ' over' : ''}${i === open ? ' first' : ''}`}
              data-ladder={it.ladder.id}
              draggable
              onDragStart={(e) => {
                setDrag(it.ladder.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', it.ladder.id)
              }}
              onDragEnd={() => {
                setDrag(null)
                setOver(null)
              }}
              onDragOver={(e) => {
                if (!drag) return
                e.preventDefault()
                setOver(it.ladder.id)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (drag) move(drag, i)
                setDrag(null)
                setOver(null)
              }}
            >
              <button
                type="button"
                className="sp-grip"
                aria-label={`Move ${it.name}: drag, or use the up and down arrow keys`}
                title="Drag to change the order (or ↑ / ↓)"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    move(it.ladder.id, i + (e.key === 'ArrowUp' ? -1 : 1))
                  }
                }}
              >
                <span aria-hidden="true">⋮⋮</span>
              </button>
              <span className="sp-wk-n num" aria-hidden="true">
                {full ? <Icon name="check" size={13} /> : i + 1}
              </span>
              <MovePic move={it.level.move} size="md" />
              <button type="button" className="sp-wk-name" onClick={() => onHow(it)} title="How to do it">
                <b>{it.name}</b>
                <small>
                  {info?.muscles.slice(0, 2).join(' · ') ?? it.ladder.name} · {it.levelText}
                </small>
                {it.done.length > 0 && <small className="sp-wk-today num">Today: {it.done.map((s) => s.reps).join(' · ')}</small>}
              </button>
              <span className="sp-pill num" data-tg="target">
                {it.target.replace(' × ', ' sets × ')}
                {it.level.unit === 'sec' ? '' : ' reps'}
              </span>
              <span className="sp-pill soft num" title="Rest between sets">
                <Icon name="clock" size={13} /> Rest {restText(it.rest)}
              </span>
              <span className="sp-wk-shift">
                <button type="button" className="sp-btn small" onClick={() => t.shiftOne(it, -1)} data-tg="easier" aria-label={`Make ${it.name} easier`}>
                  Easier <span aria-hidden="true">↓</span>
                </button>
                <button type="button" className="sp-btn small up" onClick={() => t.shiftOne(it, 1)} data-tg="harder" aria-label={`Make ${it.name} harder`}>
                  Harder <span aria-hidden="true">↑</span>
                </button>
              </span>
              {it.offer && <span className="sp-wk-offer">Unlocked: {it.offer.name}</span>}
            </li>
          )
        })}
      </ol>
      {t.v.warmup.length > 0 && (
        <p className="sp-small sp-wk-warm">
          <b>Warm-up first:</b> {t.v.warmup.join(' · ')}
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- how much today

function DoseCard({ t }: { t: SportTrain }) {
  const { v, auto } = t
  const what: Record<Dose, string> = { full: 'Every set of the plan.', light: 'One set less on every move.', short: '2 sets a move, for a busy or tired day.' }
  return (
    <section className="sp-card sp-wk-dose" data-tg="customize">
      <CardHead icon="sliders" title="How much today" sub={auto ? 'Set by your readiness. Your pick wins.' : 'Your pick for today.'} />
      <div className="sp-seg" role="radiogroup" aria-label="How much today">
        {(['full', 'light', 'short'] as Dose[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={v.dose === m} className={v.dose === m ? 'on' : ''} onClick={() => t.setDose(m)}>
            {DOSE_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="sp-small">{what[v.dose]} The reps and the effort stay the same: stop 1–2 reps before failure.</p>
      {!auto && (
        <button type="button" className="sp-link" onClick={() => t.setDose(null)}>
          Back to automatic
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- rest timer

function RestTimerCard({ seconds, label }: { seconds: number; label: string }) {
  const [total, setTotal] = useState(seconds)
  const [left, setLeft] = useState(seconds)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const rang = useRef(false)
  // A new move brings its own rest while the timer is not running.
  useEffect(() => {
    if (endsAt == null) {
      setTotal(seconds)
      setLeft(seconds)
    }
  }, [seconds]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (endsAt == null) return
    const id = window.setInterval(() => {
      const l = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      setLeft(l)
      if (l <= 0) {
        setEndsAt(null)
        if (!rang.current) {
          rang.current = true
          play('focusEnd')
          buzz([180, 90, 180])
        }
      }
    }, 250)
    return () => window.clearInterval(id)
  }, [endsAt])
  const running = endsAt != null
  const start = () => {
    rang.current = false
    const from = left > 0 ? left : total
    setLeft(from)
    setEndsAt(Date.now() + from * 1000)
  }
  const pause = () => setEndsAt(null)
  const reset = () => {
    setEndsAt(null)
    setLeft(total)
  }
  const add = (s: number) => {
    setTotal((x) => x + s)
    if (running) setEndsAt((e) => (e ?? Date.now()) + s * 1000)
    else setLeft((x) => x + s)
  }
  const frac = total ? Math.max(0, Math.min(1, 1 - left / total)) : 0
  return (
    <section className="sp-card sp-timer" data-sp="rest-timer">
      <CardHead icon="clock" title="Rest Timer" />
      <div className="sp-timer-big num" data-sp="timer-left" aria-live="off">
        {mmss(left)}
      </div>
      <p className="sp-small sp-timer-label">{left === 0 ? 'Rest is over: next set.' : label}</p>
      <span className="sp-timer-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${frac})` }} />
      </span>
      <div className="sp-timer-btns">
        <button type="button" className="sp-btn primary round" onClick={running ? pause : start} aria-label={running ? 'Pause' : 'Start the rest timer'} data-sp="timer-go">
          {running ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className="sp-btn round" onClick={() => add(15)} aria-label="Add 15 seconds">
          +15
        </button>
        <button type="button" className="sp-btn round" onClick={reset} aria-label="Reset">
          <Icon name="undo" size={16} />
        </button>
      </div>
    </section>
  )
}
const PauseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 2h3v10H3zM8 2h3v10H8z" fill="currentColor" />
  </svg>
)

// ---------------------------------------------------------------- what unlocked, and why

function UnlockCard({ t }: { t: SportTrain }) {
  const { v } = t
  const [said, setSaid] = useState<string | null>(null)
  const offered = v.items.find((it) => it.offer) ?? null
  // No offer: the move closest to its next step.
  const close = useMemo(() => [...v.items].filter((it) => it.next).sort((a, b) => b.status.hits - a.status.hits || b.status.pct - a.status.pct)[0] ?? null, [v.items])
  const it: TrackerItem | null = offered ?? close
  if (!it)
    return (
      <section className="sp-card sp-unlock" data-sp="unlock">
        <CardHead icon="trophy" title="Next variation" />
        <p className="sp-empty">Every move is at the top of its chain. Slow the tempo to keep growing.</p>
      </section>
    )
  const req = requirementsOf(it)
  const nextMove = it.offer ? it.offer.move : it.next?.move ?? it.level.move
  return (
    <section className={`sp-card sp-unlock${it.offer ? ' on' : ''}`} data-sp="unlock">
      <div className="sp-unlock-top">
        <span className="sp-unlock-icon" aria-hidden="true">
          <Icon name="trophy" size={24} />
        </span>
        <div>
          <h2>{it.offer ? 'New variation unlocked!' : 'Next variation'}</h2>
          <p>{it.offer ? `You can now try ${it.offer.name}.` : `${moveName(nextMove)} comes after ${it.name}.`}</p>
        </div>
      </div>
      <MovePic move={nextMove} size="lg" className="sp-unlock-pic" />
      <h3 className="sp-unlock-sub">{it.offer ? 'Why is it unlocked?' : 'What it needs'}</h3>
      <ul className="sp-req big" data-sp="why">
        {req.map((r) => (
          <li key={r.id} className={r.done ? 'ok' : ''} data-req={r.id} data-done={r.done ? '1' : '0'}>
            <span className={`sp-ok${r.done ? ' on' : ''}`} aria-hidden="true">
              <Icon name="check" size={12} />
            </span>
            <span>{r.label}</span>
            <small className="num">{r.detail}</small>
          </li>
        ))}
      </ul>
      {it.offer ? (
        <>
          <div className="sp-unlock-step">
            <small>Next step</small>
            <p>
              Replace <b>{it.name}</b> with <b>{it.offer.name}</b>
            </p>
            <button
              type="button"
              className="sp-btn primary big"
              onClick={() => setSaid(t.apply(it.ladder.id))}
              data-sp="unlock-apply"
            >
              Apply change <span aria-hidden="true">→</span>
            </button>
          </div>
          <button type="button" className="sp-btn big quiet" onClick={() => setSaid(t.keep(it.ladder.id))} data-sp="unlock-keep">
            Or keep {it.name} for now
          </button>
          <p className="sp-small">Keep: it is offered again after your next session at the top.</p>
        </>
      ) : (
        <p className="sp-small">{it.status.line}</p>
      )}
      {said && (
        <p className="sp-said" data-sp="unlock-said">
          {said}
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- form tips

function FormCard({ it }: { it: TrackerItem }) {
  const info = moveInfo(it.level.move)
  if (!info) return null
  return (
    <section className="sp-card sp-form" data-sp="form">
      <CardHead icon="shield" title="Form" sub={info.name} />
      <ul className="sp-form-list">
        {info.steps.slice(0, 3).map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <p className="sp-small">
        <b>Common mistake:</b> {info.mistake} Stop if a joint hurts.
      </p>
    </section>
  )
}
