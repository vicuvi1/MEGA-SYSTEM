// Sport Track → Workout (the approved design, docs/design/sport-track/Workout.dc.html):
// the workout as you do it. The current move in a big card (a large looping
// demo you can tap to change the move, Easier / Harder one step, a tile for every
// set, the reps, an Easy / OK / Hard tap and Log set); the moves after it with
// thumbnails (drag the handle, or ↑ / ↓ on it, to change the order; Change ›
// opens the swap sheet); a big rest timer that starts after every set (+30 s,
// Skip, a sound at zero); "Ready to unlock" with Apply from next workout / Keep;
// the form check; and how much today (Full / Lighter / Short). The set-by-set
// logic is useWorkoutFlow (WorkoutFlow.tsx), every set is saved at once. Only
// Finish logs the usual workout, from logged sets (no extra points here).
import { useMemo, useState } from 'react'
import { DOSE_LABEL, requirementsOf, type TrackerItem } from '@core/sportTrain'
import type { Dose, PlanItem } from '@core/trainLog'
import { moveInfo, moveName, type LadderId } from '@core/trainLadders'
import { swapView } from '@core/trainSwap'
import { TYPE_NAME } from '@core/trainWeek'
import { Icon } from '../Icon'
import { DemoPic, MovePic } from './MovePic'
import type { SportTrain } from './useSportTrain'
import { FinishOverlay, FEELS, mmss, useWorkoutFlow, type WorkoutFlowState } from './WorkoutFlow'
import { CardHead, PlayIcon } from './sportBits'

const chainName = (n: string) => n.replace(/ \(.*\)$/, '')

export function SportWorkout({ t, onHow, onSwap }: { t: SportTrain; onHow: (it: PlanItem) => void; onSwap: (l: LadderId) => void }) {
  const { v } = t
  const flow = useWorkoutFlow({ view: v, onLog: t.logSet, onUndo: t.undoSet, onFinish: t.finish, onApply: (l) => t.apply(l), onKeep: (l) => t.keep(l) })
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
  const nextUp = flow.it ?? v.items[0]
  return (
    <div className="sp-wk" data-sp="workout">
      <div className="sp-wk-grid">
        <section className="sp-wk-main">
          <div className="sp-wk-top">
            <h2>
              Today&rsquo;s workout <small data-tg="plan-title">{v.title}</small>
            </h2>
            <div className="sp-wk-top-btns">
              {v.stage !== 'done' && (
                <button type="button" className="sp-btn" onClick={() => t.shiftAll(-1)} data-tg="easier-all">
                  Whole workout easier
                </button>
              )}
              {v.stage !== 'done' && (
                <button type="button" className="sp-btn" onClick={() => t.shiftAll(1)} data-tg="harder-all">
                  Harder
                </button>
              )}
              <button type="button" className={`sp-btn${flow.allDone ? ' primary' : ''}`} onClick={() => void flow.finish()} disabled={flow.busy || v.setsDone === 0} data-tg="finish-btn">
                Finish workout
              </button>
            </div>
          </div>
          {v.stage === 'done' && (
            <p className="sp-said" data-tg="done">
              <Icon name="check" size={14} /> Done for today · {v.setsDone} sets. Eat well and sleep: that is when muscle grows.
            </p>
          )}
          {flow.it && <CurrentCard t={t} flow={flow} onHow={onHow} onSwap={onSwap} />}
          <MoveList t={t} flow={flow} onSwap={onSwap} />
          {v.warmup.length > 0 && (
            <p className="sp-small sp-wk-warm">
              <b>Warm-up first:</b> {v.warmup.join(' · ')}
            </p>
          )}
        </section>
        <aside className="sp-wk-side">
          <RestCard flow={flow} seconds={nextUp?.rest ?? 90} nextSet={flow.it ? Math.min(flow.it.sets, flow.n + 1) : 1} sets={flow.it?.sets ?? 0} name={nextUp?.name} />
          <UnlockCard t={t} />
          {nextUp && <FormCard it={nextUp} />}
          <DoseCard t={t} />
        </aside>
      </div>
      <FinishOverlay view={v} flow={flow} onClose={flow.closeReport} />
    </div>
  )
}

// ---------------------------------------------------------------- the current move

function CurrentCard({ t, flow, onHow, onSwap }: { t: SportTrain; flow: WorkoutFlowState; onHow: (it: PlanItem) => void; onSwap: (l: LadderId) => void }) {
  const it = flow.it!
  const { n, unit } = flow
  const view = useMemo(() => swapView(t.st, it.ladder.id, t.today, t.v.dose), [t.st, it.ladder.id, t.today, t.v.dose])
  const easier = view ? [...view.options].reverse().find((o) => o.kind === 'easier') : null
  const harder = view?.options.find((o) => o.kind === 'next') ?? null
  const ofN = it.sets
  const over = n >= ofN
  return (
    <article className="sp-now" data-tg="flow" data-ladder={it.ladder.id}>
      <div className="sp-now-top">
        <div className="sp-now-id">
          <button type="button" className="sp-now-pic" onClick={() => onSwap(it.ladder.id)} title="Tap to pick easier or harder" aria-label={`Change ${it.name}`} data-tg="change">
            <DemoPic move={it.level.move} />
          </button>
          <div>
            <div className="sp-now-eyebrow" data-tg="flow-set">
              {over ? 'Extra set' : `NOW · Set ${n + 1} of ${ofN}`} · move {flow.idx + 1} of {flow.items.length}
            </div>
            <h3 data-tg="flow-move">{it.name}</h3>
            <p className="sp-now-line">
              <span data-tg="flow-target">{it.target}</span> · {it.effort} · rest {it.rest} s
            </p>
            <p className="sp-now-line">
              {chainName(it.ladder.name)} · {it.levelText}
              {it.needs !== 'floor' ? ` · ${it.needs}` : ''} ·{' '}
              <button type="button" className="sp-link inline" onClick={() => onHow(it)}>
                How to do it
              </button>
            </p>
          </div>
        </div>
        <div className="sp-now-shift">
          <button type="button" className="sp-btn" onClick={() => t.shiftOne(it, -1)} disabled={!easier} data-tg="easier" aria-label={`Make ${it.name} easier`}>
            {easier ? `Easier: ${easier.name}` : 'Easier'}
          </button>
          <button type="button" className="sp-btn" onClick={() => t.shiftOne(it, 1)} disabled={!harder} data-tg="harder" aria-label={`Make ${it.name} harder`}>
            {harder ? `Harder: ${harder.name.replace(/ push-ups$/, '')}` : 'Harder'}
          </button>
        </div>
      </div>
      <div className="sp-sets" style={{ ['--n' as string]: Math.min(6, Math.max(ofN, it.done.length)) }}>
        {Array.from({ length: Math.max(ofN, it.done.length) }, (_, i) => {
          const s = it.done[i]
          const now = !s && i === n
          return s ? (
            <button key={s.id ?? i} type="button" className="sp-set done" onClick={() => s.id && flow.onUndo(s.id)} title="Logged. Tap to take it back." data-tg="flow-chip">
              <small>Set {i + 1}</small>
              <b className="num">
                {s.reps}
                {unit}
              </b>
              <small className="ok">{s.feel ? `${s.feel === 'ok' ? 'OK' : s.feel[0].toUpperCase() + s.feel.slice(1)} · logged` : 'logged'}{s.form === 'off' ? ' · form' : ''}</small>
            </button>
          ) : (
            <div key={i} className={`sp-set${now ? ' now' : ''}`}>
              <small>Set {i + 1}</small>
              <b className="num">—</b>
              <small>{now ? 'Now' : `aim ${it.aim[i] ?? it.level.lo}${unit}`}</small>
            </div>
          )
        })}
      </div>
      <form
        className="sp-logbar"
        onSubmit={(e) => {
          e.preventDefault()
          flow.log()
        }}
      >
        <label htmlFor="sp-reps">{over ? 'Extra set' : `Set ${n + 1}`} {it.level.unit === 'sec' ? 'seconds' : 'reps'}</label>
        <input id="sp-reps" className="sp-reps num" type="number" inputMode="numeric" min={1} max={600} value={flow.reps} onChange={(e) => flow.setReps(Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))))} data-tg="reps" />
        <span className="sp-how">How hard?</span>
        <span className="sp-feels" role="radiogroup" aria-label="How hard was it?">
          {FEELS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={flow.feel === f.id} className={flow.feel === f.id ? 'on' : ''} onClick={() => flow.setFeel(f.id)} data-feel={f.id} title={f.hint}>
              {f.label}
            </button>
          ))}
        </span>
        <label className="sp-formok">
          <input type="checkbox" checked={flow.formOk} onChange={(e) => flow.setFormOk(e.target.checked)} data-tg="form" /> Form stayed good
        </label>
        <button type="submit" className="sp-btn primary big sp-logbtn" disabled={!flow.feel || flow.reps < 1} data-tg="log-set">
          {flow.feel ? `Log set: ${flow.reps}${unit}` : 'Log set'}
        </button>
      </form>
      {it.nextTime && <p className={`sp-said tg-next ${it.nextTime.kind}`}>{it.nextTime.line}</p>}
      {flow.allDone && (
        <p className="sp-said" data-tg="all-done">
          All {t.v.setsPlanned} sets done. Tap Finish workout to see what changes next time.
        </p>
      )}
    </article>
  )
}

// ---------------------------------------------------------------- the moves after it

function MoveList({ t, flow, onSwap }: { t: SportTrain; flow: WorkoutFlowState; onSwap: (l: LadderId) => void }) {
  const items = t.v.items
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const all: string[] = items.map((it) => it.ladder.id)
  const cur = flow.it?.ladder.id ?? null
  const rest = items.filter((it) => it.ladder.id !== cur)
  const restIds: string[] = rest.map((it) => it.ladder.id)
  // The order of the moves after the current one; the current one keeps its place in the whole list.
  const move = (id: string, to: number) => {
    const from = restIds.indexOf(id)
    if (from < 0 || to < 0 || to >= restIds.length || from === to) return
    const next = [...restIds]
    next.splice(from, 1)
    next.splice(to, 0, id)
    const at = cur ? all.indexOf(cur) : -1
    if (cur && at >= 0) next.splice(at, 0, cur)
    t.reorder(next)
  }
  if (!rest.length) return null
  return (
    <ol className="sp-wk-list" data-tg="moves" aria-label="The moves after this one">
      {rest.map((it, i) => {
        const full = it.done.length >= it.sets
        const info = moveInfo(it.level.move)
        return (
          <li
            key={it.ladder.id}
            className={`sp-wk-row${full ? ' done' : ''}${drag === it.ladder.id ? ' dragging' : ''}${over === it.ladder.id && drag && drag !== it.ladder.id ? ' over' : ''}`}
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
            <MovePic move={it.level.move} size="md" className="sp-wk-pic" />
            <button type="button" className="sp-wk-name" onClick={() => flow.setPick(items.indexOf(it))} title="Do this move now">
              <b>{it.name}</b>
              <small>
                {chainName(it.ladder.name)} · {it.levelText}
                {it.needs !== 'floor' ? ` · ${it.needs}` : ''}
                {info && it.done.length ? ` · today ${it.done.map((s) => s.reps).join(' · ')}` : ''}
              </small>
            </button>
            <b className="sp-wk-target num" data-tg="target">
              {it.target}
            </b>
            <span className="sp-wk-rest">rest {it.rest} s</span>
            <button type="button" className="sp-link inline" onClick={() => onSwap(it.ladder.id)} data-tg="change">
              Change ›
            </button>
            {it.offer && <span className="sp-wk-offer">Unlocked: {it.offer.name}</span>}
          </li>
        )
      })}
    </ol>
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

function RestCard({ flow, seconds, nextSet, sets, name }: { flow: WorkoutFlowState; seconds: number; nextSet: number; sets: number; name?: string }) {
  const { rest, left, running } = flow
  const total = rest?.total ?? seconds
  const shown = rest ? left : seconds
  const frac = rest && total ? Math.max(0, Math.min(1, 1 - left / total)) : 0
  return (
    <section className="sp-card sp-timer" data-sp="rest-timer" data-tg={rest ? 'rest' : undefined} aria-label="Rest timer">
      <small className="sp-eyebrow">Rest</small>
      <div className="sp-timer-big num" data-sp="timer-left" data-tg="rest-left" role="timer" aria-live="off">
        {rest && left === 0 ? 'Go' : mmss(shown)}
      </div>
      <span className="sp-timer-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${frac})` }} />
      </span>
      <p className="sp-small sp-timer-label">{rest && left === 0 ? 'Rest is over: next set.' : `${name ? `Then set ${nextSet} of ${sets}` : 'Rest between sets'} · ${flow.sound ? 'a sound plays at 0' : 'sound is off'}`}</p>
      <div className="sp-timer-btns">
        <button type="button" className="sp-btn" onClick={() => flow.toggleRest(seconds)} data-sp="timer-go">
          {running ? 'Pause' : rest ? 'Resume' : 'Start'}
        </button>
        <button type="button" className="sp-btn" onClick={() => flow.addRest(30, seconds)}>
          +30 s
        </button>
        <button type="button" className="sp-btn" onClick={flow.skipRest} data-tg="rest-skip">
          Skip rest
        </button>
        <button type="button" className="sp-btn quiet" onClick={() => flow.setSound(!flow.sound)} aria-pressed={flow.sound} title="The sound at zero" data-sp="timer-sound">
          Sound {flow.sound ? 'on' : 'off'}
        </button>
      </div>
    </section>
  )
}

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
      <small className="sp-unlock-eyebrow">{it.offer ? 'Ready to unlock' : 'Next variation'}</small>
      <h3 className="sp-unlock-name">{moveName(nextMove)}</h3>
      {!it.offer && <p className="sp-small">{moveName(nextMove)} comes after {it.name}.</p>}
      <ul className="sp-req big" data-sp="why">
        {req.map((r) => (
          <li key={r.id} className={r.done ? 'ok' : ''} data-req={r.id} data-done={r.done ? '1' : '0'}>
            <span>{r.label}</span>
            <small className="num">{r.done ? 'done' : r.detail}</small>
          </li>
        ))}
      </ul>
      {it.offer ? (
        <>
          <button type="button" className="sp-btn primary big" onClick={() => setSaid(t.apply(it.ladder.id, undefined, true))} data-sp="unlock-apply">
            Apply from next workout
          </button>
          <button type="button" className="sp-btn big unlock-keep" onClick={() => setSaid(t.keep(it.ladder.id))} data-sp="unlock-keep">
            Keep {it.name} a bit longer
          </button>
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
      <h3>Form check</h3>
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
