// Island 2: the nudge cards on the island (move break with its count picker,
// eye break and tidy minute countdowns, posture, breathing, mood faces, one
// good thing, focus check-in, people, "Moved?"), the pill while a countdown
// or a breathing minute runs, and the little movement ring on the pill.
// Light on the PC: only transform and opacity move, and the countdown ticks
// with requestAnimationFrame (it stops by itself in a hidden window).
import { useEffect, useRef, useState } from 'react'
import { breathAt, breathSteps, stepCount, type MovePill, type Nudge, type NudgeOp } from '@core/islandNudges'
import type { IslandAction, IslandAlert } from '@core/islandModel'
import { tp } from './islandTap'
import { barFill, reducedMotion } from './motionKit'
import { DRILL, DRILL_SECONDS, drillAt } from '@core/deskMobility'
import { stillFrame } from '@core/sportFigure'
import { FigureSvg, useClock } from './DrillFigure'
import './islandNudges.css'

export type NudgeRun = { kind: 'eyes' | 'tidy' | 'breathe'; seconds: number; alertId: string; pattern?: 'box' | '478'; startedAt: number }
type Tap = (a: IslandAction, label?: string) => void
const nudge = (op: NudgeOp): IslandAction => ({ kind: 'nudge', op })
const MOOD_FACES = ['😫', '😕', '😐', '🙂', '😄']

/** A "Later ▾" button that opens the snooze choices (IN30). */
function Later({ id, kind, alertId, choices, tap, label = 'Later' }: { id: string; kind: Extract<NudgeOp, { op: 'snooze' }>['kind']; alertId: string; choices: { c: Extract<NudgeOp, { op: 'snooze' }>['choice']; label: string }[]; tap: Tap; label?: string }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button {...tp(`nd:${id}:later`, () => setOpen(true))}>{label} ▾</button>
  return (
    <span className="nd-snooze" role="group" aria-label="Snooze for">
      {choices.map((c) => (
        <button key={c.c} {...tp(`nd:${id}:sn:${c.c}`, () => tap(nudge({ op: 'snooze', kind, alertId, choice: c.c })))}>
          {c.label}
        </button>
      ))}
    </span>
  )
}

/** −/+ around the number (IN1, IN7). */
function Count({ id, n, set }: { id: string; n: number; set: (n: number) => void }) {
  return (
    <span className="nd-count" role="group" aria-label="How many">
      <button aria-label="Fewer" {...tp(`nd:${id}:minus`, () => set(stepCount(n, -1)))}>−</button>
      <b aria-live="polite">{n}</b>
      <button aria-label="More" {...tp(`nd:${id}:plus`, () => set(stepCount(n, 1)))}>+</button>
    </span>
  )
}

function MoveCard({ a, n: d, tap, onRun }: { a: IslandAlert; n: Extract<Nudge, { type: 'move' }>; tap: Tap; onRun: (r: NudgeRun) => void }) {
  const [pick, setPick] = useState(d.pick)
  const opt = d.options.find((o) => o.ex === pick) ?? d.options[0]
  const [count, setCount] = useState(d.count)
  // Picking another exercise starts from its own suggested number.
  const choose = (ex: string) => {
    setPick(ex)
    setCount(d.options.find((o) => o.ex === ex)?.n ?? count)
  }
  return (
    <>
      {d.hint && <p className="nd-hint">{d.hint}</p>}
      {d.challenge && <p className="nd-hint nd-ch">🏆 {d.challenge}</p>}
      {d.options.length > 1 && (
        <div className="nd-ex" role="radiogroup" aria-label="Exercise">
          {d.options.map((o) => (
            <button key={o.ex} role="radio" aria-checked={o.ex === opt.ex} className={o.ex === opt.ex ? 'on' : ''} {...tp(`nd:${a.id}:ex:${o.ex}`, () => choose(o.ex))}>
              {o.name}
              {o.left > 0 && <small>{o.left} left</small>}
            </button>
          ))}
        </div>
      )}
      <div className="di-actions nd-row">
        <Count id={a.id} n={count} set={setCount} />
        <button className="primary" {...tp(`nd:${a.id}:log`, () => tap(nudge({ op: 'move', ex: opt.ex, name: opt.name, n: count, alertId: a.id })))}>
          ✓ {count} {opt.name}
          {d.coins > 0 && <em className="nd-plus">+{d.coins}</em>}
        </button>
      </div>
      <div className="di-actions nd-row">
        {d.tidy && <button {...tp(`nd:${a.id}:tidy`, () => onRun({ kind: 'tidy', seconds: 60, alertId: `tidy:${a.id}`, startedAt: Date.now() }))}>🧹 Tidy 60 s</button>}
        <button {...tp(`nd:${a.id}:lock`, () => tap({ kind: 'lockPc', alertId: a.id }))}>🔒 Lock PC 5 min</button>
        <Later id={a.id} kind="move" alertId={a.id} choices={d.snooze} tap={tap} />
      </div>
    </>
  )
}

function MoveDone({ a, n: d, tap }: { a: IslandAlert; n: Extract<Nudge, { type: 'moveDone' }>; tap: Tap }) {
  const [fix, setFix] = useState<number | null>(null)
  return (
    <>
      {d.line && <p className="nd-hint nd-ch">🏆 {d.line}</p>}
      {fix == null ? (
        <div className="di-actions nd-row">
          {d.water && <button className="primary" {...tp(`nd:${a.id}:water`, () => tap(nudge({ op: 'water', logId: d.logId, ml: 250 })))}>💧 +250 ml too?</button>}
          <button {...tp(`nd:${a.id}:fewer`, () => setFix(Math.max(1, d.n - 2)))}>I did fewer</button>
          <button {...tp(`nd:${a.id}:undo`, () => tap(nudge({ op: 'undo', logId: d.logId })))}>↶ Undo</button>
          <button {...tp(`nd:${a.id}:done`, () => tap(nudge({ op: 'close', alertId: a.id })))}>Done</button>
        </div>
      ) : (
        <div className="di-actions nd-row">
          <span className="nd-say">Only did</span>
          <Count id={`${a.id}:fix`} n={fix} set={setFix} />
          <button className="primary" {...tp(`nd:${a.id}:fixsave`, () => (tap(nudge({ op: 'fix', logId: d.logId, n: fix })), setFix(null)))}>✓ {fix} {d.name}</button>
          <button {...tp(`nd:${a.id}:fixno`, () => setFix(null))}>Cancel</button>
        </div>
      )}
    </>
  )
}

function Gratitude({ a, tap }: { a: IslandAlert; tap: Tap }) {
  const [t, setT] = useState('')
  const send = () => t.trim() && tap(nudge({ op: 'gratitude', text: t.trim(), alertId: a.id }))
  return (
    <form
      className="nd-grat"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <input value={t} maxLength={200} placeholder="One good thing today…" aria-label="One good thing today" onChange={(e) => setT(e.target.value)} onPointerDown={() => window.desktop?.islandFocus?.()} />
      <button type="button" className="primary" disabled={!t.trim()} {...tp(`nd:${a.id}:save`, send)}>Save</button>
    </form>
  )
}

/**
 * BD11: the 60-second desk drill. Start → the figure moves through the four
 * moves (15 s each) with the cue and the seconds; at the end it asks, and
 * only "✓ Done" logs it (it pays nothing). Stop takes you back, nothing noted.
 */
// A running drill survives the card folding to the pill and coming back (by its card's id).
const drillStarts = new Map<string, number>()

function DrillCard({ a, tap }: { a: IslandAlert; tap: Tap }) {
  const [start, setStartRaw] = useState<number | null>(() => drillStarts.get(a.id) ?? null)
  const setStart = (v: number | null) => {
    if (v == null) drillStarts.delete(a.id)
    else drillStarts.set(a.id, v)
    setStartRaw(v)
  }
  const [ended, setEnded] = useState(false)
  const t = useClock(start != null && !ended ? start : null)
  const d = drillAt(start != null ? t : 0)
  useEffect(() => {
    if (start != null && d.done && !ended) setEnded(true)
  }, [d.done, start, ended])
  if (ended)
    return (
      <div className="dr dr-end">
        <p className="nd-hint">All four done? It counts only if you did them.</p>
        <div className="di-actions nd-row">
          <button className="primary" {...tp(`nd:${a.id}:drilldone`, () => tap(nudge({ op: 'drill', alertId: a.id })))}>✓ Done</button>
          <button {...tp(`nd:${a.id}:drillno`, () => tap(nudge({ op: 'skip', kind: 'posture', alertId: a.id })))}>Not this time</button>
        </div>
      </div>
    )
  if (start == null)
    return (
      <div className="dr">
        <div className="dr-strip" aria-label="Chin tucks, doorway chest stretch, hip-flexor stretch, wall angels">
          {DRILL.map((m) => (
            <figure key={m.id}>
              <FigureSvg anim={m.anim} size={50} />
              <figcaption>{m.name}</figcaption>
            </figure>
          ))}
        </div>
        <div className="di-actions nd-row">
          <button className="primary" {...tp(`nd:${a.id}:drill`, () => setStart(Date.now()))}>▶ Start {DRILL_SECONDS} s</button>
          <button {...tp(`nd:${a.id}:straight`, () => tap(nudge({ op: 'tally', kind: 'posture', ok: true, alertId: a.id })))}>✓ Sitting straight</button>
          <button {...tp(`nd:${a.id}:later`, () => tap(nudge({ op: 'skip', kind: 'posture', alertId: a.id })))}>Later</button>
        </div>
      </div>
    )
  const still = reducedMotion()
  return (
    <div className="dr dr-run" aria-live="polite">
      <div className="dr-stage">
        <FigureSvg anim={d.move.anim} frame={still ? stillFrame(d.move.anim) : d.frame} size={124} />
        <div className="dr-say">
          <span className="dr-steps" aria-hidden>
            {DRILL.map((m, i) => (
              <i key={m.id} className={i < d.index ? 'done' : i === d.index ? 'on' : ''} />
            ))}
          </span>
          <b>{d.move.name}</b>
          <p>{d.move.cue}</p>
          <span className="dr-left">
            {d.left}s <small>· {d.total}s left</small>
          </span>
        </div>
      </div>
      <div className="di-actions nd-row">
        <button {...tp(`nd:${a.id}:drillstop`, () => setStart(null))}>Stop</button>
      </div>
    </div>
  )
}

/** BD5: the after-shift checklist (teeth, skin, alarm, phone away); each tap ticks or unticks a step. */
function Checklist({ a, n: d, tap }: { a: IslandAlert; n: Extract<Nudge, { type: 'checklist' }>; tap: Tap }) {
  return (
    <div className="nd-check" role="group" aria-label="After-shift checklist">
      {d.steps.map((s) => (
        <button key={s.id} role="checkbox" aria-checked={s.done} className={s.done ? 'on' : ''} {...tp(`nd:${a.id}:st:${s.id}`, () => tap({ kind: 'care', op: { op: 'shiftStep', step: s.id, on: !s.done }, alertId: a.id }))}>
          <i aria-hidden>{s.done ? '✓' : ''}</i>
          {s.label}
        </button>
      ))}
      <div className="di-actions nd-row">
        {a.actions.map((x) => (
          <button key={x.label} className={x.primary ? 'primary' : ''} {...tp(`nd:${a.id}:${x.label}`, () => tap(x.action, x.label))}>
            {x.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The card's body for an alert with a nudge (under its title and text).
 * `onRun` starts a countdown or a breathing minute on the pill.
 */
// The card's own sound is played once by the island when it drops down (core/islandReminderSound.ts), not here.
export function IslandNudgeCard({ a, tap, onRun }: { a: IslandAlert; tap: Tap; onRun: (r: NudgeRun) => void; sound?: boolean; volume?: number }) {
  const d = a.nudge!
  const row = (btns: [string, string, IslandAction | (() => void), boolean?][]) => (
    <div className="di-actions nd-row">
      {btns.map(([k, label, act, primary]) => (
        <button key={k} className={primary ? 'primary' : ''} {...tp(`nd:${a.id}:${k}`, () => (typeof act === 'function' ? act() : tap(act)))}>
          {label}
        </button>
      ))}
    </div>
  )
  return (
    <div className={`nd nd-${d.type}`}>
      {d.type === 'move' && <MoveCard a={a} n={d} tap={tap} onRun={onRun} />}
      {d.type === 'moveDone' && <MoveDone a={a} n={d} tap={tap} />}
      {d.type === 'timer' && (
        <div className="di-actions nd-row">
          <button className="primary" {...tp(`nd:${a.id}:go`, () => onRun({ kind: d.kind, seconds: d.seconds, alertId: a.id, startedAt: Date.now() }))}>▶ Start {d.seconds} s</button>
          {d.tip === 'warm' && <button {...tp(`nd:${a.id}:warm`, () => tap({ kind: 'care', op: { op: 'warm' }, alertId: a.id }))}>✓ Night light on</button>}
          <Later id={a.id} kind={d.kind} alertId={a.id} choices={d.snooze} tap={tap} />
        </div>
      )}
      {d.type === 'drill' && <DrillCard a={a} tap={tap} />}
      {d.type === 'checklist' && <Checklist a={a} n={d} tap={tap} />}
      {d.type === 'posture' &&
        row([
          ['yes', '✓ Yes', nudge({ op: 'tally', kind: 'posture', ok: true, alertId: a.id }), true],
          ['fix', 'Fix it', nudge({ op: 'tally', kind: 'posture', ok: false, alertId: a.id })]
        ])}
      {d.type === 'breathe' &&
        row([
          ['go', `▶ Breathe 1 min`, () => onRun({ kind: 'breathe', seconds: d.seconds, alertId: a.id, pattern: d.pattern, startedAt: Date.now() }), true],
          ['no', 'Not now', nudge({ op: 'skip', kind: 'breathe', alertId: a.id })]
        ])}
      {d.type === 'mood' && (
        <div className="di-actions nd-row nd-faces" role="group" aria-label="Your mood">
          {MOOD_FACES.map((f, i) => (
            <button key={f} aria-label={`Mood ${i + 1} of 5`} {...tp(`nd:${a.id}:m${i + 1}`, () => tap(nudge({ op: 'mood', mood: i + 1, alertId: a.id })))}>
              {f}
            </button>
          ))}
          <button {...tp(`nd:${a.id}:later`, () => tap(nudge({ op: 'skip', kind: 'mood', alertId: a.id })))}>Later</button>
        </div>
      )}
      {d.type === 'gratitude' && (
        <>
          <Gratitude a={a} tap={tap} />
          {row([['no', 'Not tonight', nudge({ op: 'skip', kind: 'gratitude', alertId: a.id })]])}
        </>
      )}
      {d.type === 'focus' &&
        row([
          ['yes', '✓ Yes', nudge({ op: 'focus', answer: 'yes', subject: d.subject, startedAt: d.startedAt, alertId: a.id }), true],
          ['drift', 'Drifted', nudge({ op: 'focus', answer: 'drifted', subject: d.subject, startedAt: d.startedAt, alertId: a.id })],
          ['switch', 'Switch', nudge({ op: 'focus', answer: 'switch', subject: d.subject, startedAt: d.startedAt, alertId: a.id })]
        ])}
      {d.type === 'people' && (
        <div className="di-actions nd-row">
          <button className="primary" {...tp(`nd:${a.id}:done`, () => tap(nudge({ op: 'person', personId: d.personId, done: true, alertId: a.id })))}>✓ Done</button>
          <Later id={a.id} kind="people" alertId={a.id} choices={d.snooze} tap={tap} />
        </div>
      )}
      {d.type === 'away' &&
        row([
          ['yes', `✓ Walked ${d.min} min`, nudge({ op: 'away', yes: true, min: d.min, alertId: a.id }), true],
          ['no', 'No', nudge({ op: 'away', yes: false, min: d.min, alertId: a.id })]
        ])}
    </div>
  )
}

/** Seconds since `startedAt`, ticked by requestAnimationFrame (only when the shown second changes). */
function useSeconds(startedAt: number): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    let id = 0
    let last = -1
    const step = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000)
      if (s !== last) {
        last = s
        setT(s)
      }
      id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [startedAt])
  return t
}

/** The pill while a countdown (IN11, IN25) or a breathing minute (IN16) runs. Tap it to stop (nothing is noted). */
export function IslandNudgePill({ run, onEnd }: { run: NudgeRun; onEnd: (done: boolean) => void }) {
  const t = useSeconds(run.startedAt)
  const left = Math.max(0, run.seconds - t)
  const ended = useRef(false)
  useEffect(() => {
    if (left <= 0 && !ended.current) {
      ended.current = true
      onEnd(true)
    }
  }, [left]) // eslint-disable-line react-hooks/exhaustive-deps
  // The bar drains in one smooth transform from the start (set once, not every frame).
  const [drain, setDrain] = useState(1)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrain(0))
    return () => cancelAnimationFrame(id)
  }, [])
  if (run.kind === 'breathe') {
    const b = breathAt(run.pattern ?? 'box', t)
    const sec = breathSteps(run.pattern ?? 'box').find((x) => x.say === b.say)?.sec ?? 4
    return (
      <div className="di-pill nd-pill nd-breathe" role="button" tabIndex={0} aria-label="Breathing: tap to stop" {...tp('nd:pill:stop', () => onEnd(false))}>
        <span className="nd-bubble" style={{ transform: `scale(${b.grow ? 1 : 0.55})`, transitionDuration: `${b.say === 'Hold' ? 0.2 : sec}s` }} aria-hidden />
        <span className="di-pill-text">{b.say} · {b.left}</span>
        <span className="di-pill-time">{left}s</span>
      </div>
    )
  }
  return (
    <div className="di-pill nd-pill nd-count-pill" role="button" tabIndex={0} aria-label="Countdown: tap to stop" {...tp('nd:pill:stop', () => onEnd(false))}>
      {run.kind === 'eyes' ? (
        <span className="nd-eye" aria-hidden>
          <svg width="22" height="14" viewBox="0 0 22 14">
            <path className="nd-eye-white" d="M1 7C4.5 1.5 17.5 1.5 21 7C17.5 12.5 4.5 12.5 1 7Z" />
            <circle className="nd-eye-iris" cx="11" cy="7" r="3.4" />
          </svg>
          <i className="nd-lid" />
        </span>
      ) : (
        <span className="di-face-sm">🧹</span>
      )}
      <span className="di-pill-text">{run.kind === 'eyes' ? (t < 8 ? 'Blink slowly…' : 'Look 6 m away') : 'Tidy the desk'}</span>
      <span className="di-pill-time">{left}s</span>
      <span className="pbar nd-drain" aria-hidden>
        <i style={{ ...barFill(drain), transitionDuration: `${run.seconds}s` }} />
      </span>
    </div>
  )
}

/** IN15, IN49, IN51: today's movement ring, the challenge bar, the move streak and "+3" right after a paid break. */
export function IslandMoveBadge({ move, now }: { move: MovePill | null | undefined; now: number }) {
  if (!move || (move.done <= 0 && !move.challenge && move.streak <= 0 && !move.plus)) return null
  const pct = Math.min(1, move.goal > 0 ? move.done / move.goal : 0)
  const r = 7
  const c = 2 * Math.PI * r
  const plus = move.plus && now - move.plus.at < 8000 ? move.plus.coins : 0
  return (
    <span className="nd-badge" title={`Moved today: ${move.done}/${move.goal} ${move.unit === 'min' ? 'min' : 'reps'}${move.challenge ? ` · challenge ${move.challenge.done}/${move.challenge.target} ${move.challenge.name}` : ''}${move.streak ? ` · move streak ${move.streak} days` : ''}`}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={r} className="nd-ring-bg" />
        <circle cx="9" cy="9" r={r} className="nd-ring" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 9 9)" />
      </svg>
      {move.challenge && (
        <span className="pbar nd-chbar" aria-hidden>
          <i style={barFill(move.challenge.done / Math.max(1, move.challenge.target))} />
        </span>
      )}
      {move.streak > 1 && <small className="nd-streak">🔥{move.streak}</small>}
      {plus > 0 && <em className="nd-plus nd-plus-pop">+{plus}</em>}
    </span>
  )
}
