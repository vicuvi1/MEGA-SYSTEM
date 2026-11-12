// Sport Track → Workout mode (the approved artboard, docs/design/sport-track/
// WorkoutMode.dc.html): a focused full-window mode for doing the workout.
//  - Header: Pause · Esc (leaves the mode; every set is already saved), the
//    session, time so far and about how long is left, the session rail (every
//    move × set, the current one highlighted; tap a move to do it now), Finish.
//  - Left: the big demo (ExerciseMedia: video, photo frames or "No verified demo
//    yet"), play / pause, repeat, speed, the tempo and three movement cues.
//  - Right: "Move N of M · Set X of Y", the move and its target, then one panel
//    at a time with a short animation: the set (a giant reps number with − / +,
//    Easy / OK / Hard with reps in reserve, Form good / Form broke, "Pain /
//    can't finish", a huge Set done), the rest (a ring timer, −15 s / +30 s /
//    Start the next set, a sound at 0), the pain choices, or Easier / Alternate /
//    Harder with the reason from your data. A safety note for any household
//    object the move uses.
//  - Finish shows Workout done (WorkoutDone.tsx).
// The logic is useWorkoutFlow (WorkoutFlow.tsx) and the engine; nothing here
// pays points (Finish logs the usual workout, from logged sets only).
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SetIssue, PainSpot } from '@core/sportSets'
import { PAIN_SPOTS } from '@core/sportSets'
import { moveChoices, safetyNotes, type Choice, type DoneView } from '@core/trainAdvice'
import { cuesFor, mediaFor, tempoFor } from '@core/trainMedia'
import { trainOf, type Feel } from '@core/trainLog'
import type { TrackerItem } from '@core/sportTrain'
import { ExerciseMedia, MediaBar, useMediaControls } from './ExerciseMedia'
import type { SportTrain } from './useSportTrain'
import { FEELS, mmss, type WorkoutFlowState } from './WorkoutFlow'
import { WorkoutDone } from './WorkoutDone'
import './workout-mode.css'

/** Moves counted per leg or per side. */
const PER_SIDE = new Set(['split_squat', 'bulgarian_squat', 'bss_load', 'box_pistol', 'pistol_squat', 'shrimp_squat', 'single_leg_bridge', 'sl_rdl', 'archer_pushup', 'archer_pullup', 'reverse_lunge', 'lunge', 'dumbbell_row', 'side_plank'])
const LEGS = new Set(['split_squat', 'bulgarian_squat', 'bss_load', 'box_pistol', 'pistol_squat', 'shrimp_squat', 'single_leg_bridge', 'sl_rdl', 'reverse_lunge', 'lunge'])
const unitWord = (it: TrackerItem) => (it.level.unit === 'sec' ? (PER_SIDE.has(it.level.move) ? 'seconds per side' : 'seconds') : PER_SIDE.has(it.level.move) ? (LEGS.has(it.level.move) ? 'reps per leg' : 'reps per side') : 'reps')
const FEEL_NOTE: Record<Feel, string> = { easy: '3+ reps left', ok: '1–2 left', hard: '0–1 left' }
const feelName = (f?: Feel | null) => (f === 'ok' ? 'OK' : f === 'easy' ? 'easy' : f === 'hard' ? 'hard' : 'effort not tapped')
const SPOT_NAME: Record<PainSpot, string> = { wrist: 'Wrist', shoulder: 'Shoulder', elbow: 'Elbow', knee: 'Knee', back: 'Back', other: 'Other' }
const chainName = (n: string) => n.replace(/ \(.*\)$/, '')

interface Saved {
  set: number
  reps: number
  unit: string
  feel: Feel | null
  name: string
  issue?: SetIssue
}

export function WorkoutMode({ t, flow, onClose, onDone }: { t: SportTrain; flow: WorkoutFlowState; onClose: () => void; onDone: () => void }) {
  const { v } = t
  const it = flow.it
  const ctl = useMediaControls()
  const [painOpen, setPainOpen] = useState(false)
  const [choice, setChoice] = useState<Choice['kind'] | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [done, setDone] = useState<DoneView | null>(null)
  const [openedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  // The Done page is a snapshot taken when Finish is done (Apply later doesn't rewrite it).
  useEffect(() => {
    if (flow.report && !done) setDone(t.doneView())
  }, [flow.report]) // eslint-disable-line react-hooks/exhaustive-deps
  // A new move or set closes the side panels.
  const key = it ? `${it.ladder.id}:${it.level.move}:${flow.n}` : ''
  useEffect(() => {
    setChoice(null)
    setPainOpen(false)
  }, [key])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      if (painOpen) setPainOpen(false)
      else if (choice) setChoice(null)
      else if (done) onDone()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [painOpen, choice, done, onClose, onDone])

  const gear = useMemo(() => trainOf(t.st).gear, [t.st])
  const choices = useMemo(() => (it ? moveChoices(it, gear) : null), [it, gear])
  const sessionStart = useMemo(() => {
    const rec = trainOf(t.st).log.find((s) => s.id === v.sessionId)
    return rec?.startedAt ?? openedAt
  }, [t.st, v.sessionId, openedAt])
  const left = v.items.reduce((n, x) => n + (flow.ended.includes(x.ladder.id) ? 0 : Math.max(0, x.sets - x.done.length) * (40 + x.rest)), 0)
  const elapsed = Math.max(0, Math.floor((now - sessionStart) / 1000))

  if (done)
    return createPortal(
      <div className="wm" data-wm="done">
        <WorkoutDone t={t} view={done} title={v.title.replace(/^Done: /, '')} onClose={onDone} />
      </div>,
      document.body
    )

  const media = it ? mediaFor(it.level.move, t.verdicts) : []
  const onSetDone = () => {
    if (!it || !flow.feel || flow.reps < 1) return
    setSaved({ set: flow.n + 1, reps: flow.reps, unit: it.level.unit === 'sec' ? ' s' : '', feel: flow.feel, name: it.name })
    flow.log()
  }
  const onIssue = (issue: SetIssue) => {
    if (!it) return
    setSaved({ set: flow.n + 1, reps: Math.max(1, flow.reps), unit: it.level.unit === 'sec' ? ' s' : '', feel: flow.feel, name: it.name, issue })
    setPainOpen(false)
    flow.logIssue(issue)
  }
  const go = (c: Choice) => {
    if (!it) return
    if (c.kind === 'alternate') t.usePick(it.ladder.id, c.level)
    else t.shiftOne(it, c.kind === 'easier' ? -1 : 1)
    setChoice(null)
    flow.clearHurt()
  }
  const hurt = flow.hurt && it && flow.hurt.ladder === it.ladder.id ? flow.hurt : null
  const stage = !it ? 'none' : painOpen ? 'pain' : hurt ? 'hurt' : choice ? 'choice' : flow.rest ? 'rest' : flow.finished ? 'all' : 'set'

  return createPortal(
    <div className="wm" data-wm={stage} role="dialog" aria-modal="true" aria-label="Workout mode">
      <header className="wm-head">
        <button type="button" className="wm-btn ghost" onClick={onClose} data-tg="mode-pause" title="Leave Workout mode. Every set is already saved.">
          Pause · Esc
        </button>
        <div className="wm-title">
          <b data-tg="mode-title">{v.title}</b>
          <span className="num">
            {mmss(elapsed)} elapsed · {left > 0 ? `about ${Math.max(1, Math.round(left / 60))} min left` : 'all sets done'}
          </span>
        </div>
        <SessionRail flow={flow} />
        <button type="button" className={`wm-btn${flow.finished ? ' primary' : ' ghost'}`} onClick={() => void flow.finish()} disabled={flow.busy || v.setsDone === 0} data-tg="finish-btn">
          Finish
        </button>
      </header>
      {it && (
        <main className="wm-main">
          <section className="wm-media-col">
            <ExerciseMedia move={it.level.move} verdicts={t.verdicts} onVerdict={t.verdict} ctl={ctl} tempo={tempoFor(it.level)} className="wm-media fill" />
            {/* No demo: no dead play / repeat / speed buttons. */}
            {media.length > 0 && <MediaBar ctl={ctl} hasMedia />}
          </section>
          <aside className="wm-side">
            <div className="wm-id">
              <div className="wm-eyebrow" data-tg="flow-pos">
                Move {flow.idx + 1} of {flow.items.length} · Set {Math.min(flow.n + 1, it.sets)} of {it.sets}
                <span className="wm-eyebrow-dim"> · {chainName(it.ladder.name)} path step {it.index + 1}</span>
              </div>
              <h1 data-tg="flow-move">{it.name}</h1>
              <div className="wm-target">
                Target <span data-tg="flow-target">{it.target}</span>
                {PER_SIDE.has(it.level.move) ? (LEGS.has(it.level.move) ? ' per leg' : ' per side') : ''} · {it.effort}
              </div>
              <ul className="wm-cues" data-tg="cues" aria-label="Movement cues">
                {cuesFor(it.level.move).map((c) => (
                  <li key={c}>{c[0].toUpperCase() + c.slice(1)}</li>
                ))}
              </ul>
            </div>
            <div className="wm-stage" key={`${stage}:${key}`}>
              {stage === 'set' && <SetPanel it={it} flow={flow} onDone={onSetDone} onPain={() => setPainOpen(true)} />}
              {stage === 'rest' && <RestPanel flow={flow} saved={saved} it={it} />}
              {stage === 'pain' && <PainPanel it={it} flow={flow} onCancel={() => setPainOpen(false)} onIssue={onIssue} />}
              {stage === 'hurt' && hurt && choices && <HurtPanel hurt={hurt} choices={choices} onGo={go} onEnd={() => flow.endMove(it.ladder.id)} onBack={flow.clearHurt} />}
              {stage === 'choice' && choice && choices && <ChoicePanel kind={choice} choices={choices} onGo={go} onCancel={() => setChoice(null)} />}
              {stage === 'all' && (
                <div className="wm-card wm-all" data-tg="all-done">
                  <b>All {v.setsDone} sets saved.</b>
                  <p>Finish to see what you did against the target and what changes next time.</p>
                  <button type="button" className="wm-btn primary huge" onClick={() => void flow.finish()} disabled={flow.busy} data-tg="finish-big">
                    Finish workout
                  </button>
                </div>
              )}
            </div>
            {choices && stage !== 'hurt' && <ChoicesRow choices={choices} open={choice} onOpen={(k) => setChoice((c) => (c === k ? null : k))} />}
            {safetyNotes(it.level.move, gear).map((s) => (
              <div key={s} role="note" className="wm-safety" data-tg="safety">
                <strong>Safety</strong>
                <span>{s}</span>
              </div>
            ))}
          </aside>
        </main>
      )}
    </div>,
    document.body
  )
}

// ---------------------------------------------------------------- the session rail

function SessionRail({ flow }: { flow: WorkoutFlowState }) {
  return (
    <ol className="wm-rail" aria-label="Session progress" data-tg="rail">
      {flow.items.map((x, i) => {
        const cur = i === flow.idx
        const ended = flow.ended.includes(x.ladder.id)
        const n = Math.max(x.sets, x.done.length)
        return (
          <li key={x.ladder.id} className={`${cur ? 'cur' : ''}${x.done.length >= x.sets || ended ? ' full' : ''}`} data-ladder={x.ladder.id}>
            <button type="button" onClick={() => flow.setPick(i)} aria-current={cur ? 'step' : undefined} title={`${x.name}: ${x.done.length} of ${x.sets} sets`}>
              <span className="wm-rail-name">{x.name}</span>
              <span className="wm-dots" aria-hidden="true">
                {Array.from({ length: n }, (_, k) => (
                  <i key={k} className={k < x.done.length ? (x.done[k].issue?.kind === 'pain' ? 'pain' : 'on') : cur && k === x.done.length ? 'now' : ''} />
                ))}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ---------------------------------------------------------------- the set

function SetPanel({ it, flow, onDone, onPain }: { it: TrackerItem; flow: WorkoutFlowState; onDone: () => void; onPain: () => void }) {
  const { n, unit, step } = flow
  const over = n >= it.sets
  const last = it.last?.reps[Math.min(n, (it.last?.reps.length ?? 1) - 1)]
  const aim = it.aim[Math.min(n, it.aim.length - 1)] ?? it.level.lo
  return (
    <div className="wm-card wm-set" data-tg="flow" data-ladder={it.ladder.id}>
      <div className="wm-set-head">
        <span className="wm-set-n" data-tg="flow-set">
          {over ? `Extra set ${n + 1}` : `Set ${n + 1} of ${it.sets}`}
        </span>
        <span className="wm-muted num">{last != null ? `last time ${last}${unit} · aim ${aim}${unit}` : `aim ${aim}${unit}`}</span>
      </div>
      <div className="wm-stepper">
        <button type="button" className="wm-step" onClick={() => flow.setReps(Math.max(0, flow.reps - step))} aria-label={`One ${it.level.unit === 'sec' ? 'step' : 'rep'} less`} data-tg="reps-minus">
          −
        </button>
        <label className="wm-reps-box">
          <input className="wm-reps num" type="number" inputMode="numeric" min={1} max={600} value={flow.reps} onChange={(e) => flow.setReps(Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))))} data-tg="reps" aria-label={unitWord(it)} />
          <span className="wm-muted">{unitWord(it)}</span>
        </label>
        <button type="button" className="wm-step" onClick={() => flow.setReps(Math.min(600, flow.reps + step))} aria-label={`One ${it.level.unit === 'sec' ? 'step' : 'rep'} more`} data-tg="reps-plus">
          +
        </button>
      </div>
      <div className="wm-grid3" role="radiogroup" aria-label="How hard was it?">
        {FEELS.map((f) => (
          <button key={f.id} type="button" role="radio" aria-checked={flow.feel === f.id} className={`wm-chip${flow.feel === f.id ? ' on' : ''}`} onClick={() => flow.setFeel(f.id)} data-feel={f.id}>
            <b>{f.label}</b>
            <small>{FEEL_NOTE[f.id]}</small>
          </button>
        ))}
      </div>
      <div className="wm-grid3" role="group" aria-label="Form">
        <button type="button" aria-pressed={flow.form === 'good'} className={`wm-chip${flow.form === 'good' ? ' on' : ''}`} onClick={() => flow.setForm(flow.form === 'good' ? null : 'good')} data-form="good">
          <b>Form good</b>
        </button>
        <button type="button" aria-pressed={flow.form === 'off'} className={`wm-chip${flow.form === 'off' ? ' on warn' : ''}`} onClick={() => flow.setForm(flow.form === 'off' ? null : 'off')} data-form="off">
          <b>Form broke</b>
        </button>
        <button type="button" className="wm-chip danger" onClick={onPain} title="Pain, discomfort or can’t finish this set" aria-label="Pain or can’t finish" data-tg="pain-open">
          <b>Pain / stop</b>
        </button>
      </div>
      <p className="wm-hint" data-tg="form-hint">
        {flow.form === 'good' ? 'Form confirmed: this set can count toward a step up.' : flow.form === 'off' ? 'Form broke: saved, it won’t count toward a step up.' : 'No form tap = form unknown: saved, but it won’t count toward a step up.'}
      </p>
      <button type="button" className="wm-btn primary huge" onClick={onDone} disabled={!flow.feel || flow.reps < 1} data-tg="log-set">
        {flow.feel ? 'Set done' : 'Tap how hard it was'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- the rest

function RestPanel({ flow, saved, it }: { flow: WorkoutFlowState; saved: Saved | null; it: TrackerItem }) {
  const { rest, left, running } = flow
  const total = rest?.total ?? it.rest
  const R = 86
  const C = 2 * Math.PI * R
  const frac = rest && total ? Math.max(0, Math.min(1, left / total)) : 1
  const nextN = Math.min(flow.n + 1, it.sets)
  const aim = it.aim[Math.min(flow.n, it.aim.length - 1)] ?? it.level.lo
  const u = it.level.unit === 'sec' ? ' s' : ''
  const sameMove = saved?.name === it.name
  return (
    <div className="wm-card wm-rest" data-tg="rest">
      <div className="wm-eyebrow">
        Rest
        {saved ? ` · set ${saved.set} saved: ${saved.reps}${saved.unit}, ${feelName(saved.feel)}${saved.issue ? ` · ${saved.issue.kind === 'incomplete' ? 'couldn’t finish' : saved.issue.kind}` : ''}` : ''}
      </div>
      <svg className="wm-ring" viewBox="0 0 200 200" role="timer" aria-label={`${mmss(left)} of rest left`}>
        <circle cx="100" cy="100" r={R} className="wm-ring-bg" />
        <circle cx="100" cy="100" r={R} className="wm-ring-fg" strokeDasharray={`${C}`} strokeDashoffset={`${C * (1 - frac)}`} transform="rotate(-90 100 100)" />
        <text x="100" y="116" textAnchor="middle" className="wm-ring-text num" data-tg="rest-left">
          {rest && left === 0 ? 'Go' : mmss(left)}
        </text>
      </svg>
      <div className="wm-next">
        Next: {sameMove ? '' : `${it.name} · `}set {nextN} of {it.sets} · aim {aim}
        {u} · {flow.sound ? 'sound at 0' : 'sound off'}
      </div>
      <div className="wm-rest-btns">
        <button type="button" className="wm-btn ghost" onClick={() => flow.addRest(-15, it.rest)} data-tg="rest-minus">
          −15 s
        </button>
        <button type="button" className="wm-btn ghost" onClick={() => flow.addRest(30, it.rest)} data-tg="rest-plus">
          +30 s
        </button>
        <button type="button" className="wm-btn primary wide" onClick={flow.skipRest} data-tg="rest-skip">
          Start set {nextN}
        </button>
      </div>
      <div className="wm-rest-foot">
        <button type="button" className="wm-link" onClick={() => flow.toggleRest(it.rest)} data-tg="rest-pause">
          {running ? 'Pause timer' : 'Resume timer'}
        </button>
        <button type="button" className="wm-link" onClick={() => flow.setSound(!flow.sound)} aria-pressed={flow.sound} data-tg="rest-sound">
          Sound {flow.sound ? 'on' : 'off'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- pain / can't finish

function PainPanel({ it, flow, onCancel, onIssue }: { it: TrackerItem; flow: WorkoutFlowState; onCancel: () => void; onIssue: (i: SetIssue) => void }) {
  const [kind, setKind] = useState<SetIssue['kind'] | null>(null)
  const [where, setWhere] = useState<PainSpot | null>(null)
  const u = it.level.unit === 'sec' ? ' s' : ' reps'
  return (
    <div className="wm-card wm-pain" role="group" aria-label="Pain or can't finish" data-tg="pain">
      <div className="wm-set-head">
        <span className="wm-set-n">Pain or can’t finish set {flow.n + 1}?</span>
      </div>
      <div className="wm-pain-kinds">
        <button type="button" className={`wm-chip danger${kind === 'pain' ? ' on' : ''}`} onClick={() => setKind('pain')} data-issue="pain" aria-pressed={kind === 'pain'}>
          <b>Pain</b>
          <small>sharp or joint pain: stop</small>
        </button>
        <button type="button" className={`wm-chip${kind === 'discomfort' ? ' on warn' : ''}`} onClick={() => setKind('discomfort')} data-issue="discomfort" aria-pressed={kind === 'discomfort'}>
          <b>Discomfort</b>
          <small>it felt off, not sharp</small>
        </button>
        <button type="button" className={`wm-chip${kind === 'incomplete' ? ' on' : ''}`} onClick={() => setKind('incomplete')} data-issue="incomplete" aria-pressed={kind === 'incomplete'}>
          <b>Couldn’t complete</b>
          <small>you stopped early</small>
        </button>
      </div>
      {kind === 'pain' && (
        <div className="wm-where" role="radiogroup" aria-label="Where does it hurt?">
          <span className="wm-muted">Where?</span>
          {PAIN_SPOTS.map((p) => (
            <button key={p} type="button" role="radio" aria-checked={where === p} className={`wm-pill${where === p ? ' on' : ''}`} onClick={() => setWhere(p)} data-where={p}>
              {SPOT_NAME[p]}
            </button>
          ))}
        </div>
      )}
      <p className="wm-hint">
        Saved on this set with {Math.max(1, flow.reps)}
        {u}
        {flow.feel ? `, ${feelName(flow.feel)}` : ''}. Change the number first if you did fewer.
      </p>
      <div className="wm-rest-btns">
        <button type="button" className="wm-btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="wm-btn primary wide" disabled={!kind || (kind === 'pain' && !where)} onClick={() => kind && onIssue({ kind, ...(kind === 'pain' && where ? { where } : {}) })} data-tg="issue-save">
          {kind === 'pain' ? (where ? `Save: pain in ${SPOT_NAME[where].toLowerCase()}` : 'Where does it hurt?') : kind === 'discomfort' ? 'Save: discomfort' : kind === 'incomplete' ? 'Save: couldn’t complete' : 'Pick one'}
        </button>
      </div>
    </div>
  )
}

function HurtPanel({ hurt, choices, onGo, onEnd, onBack }: { hurt: { issue: SetIssue; set: number }; choices: ReturnType<typeof moveChoices>; onGo: (c: Choice) => void; onEnd: () => void; onBack: () => void }) {
  const where = hurt.issue.where ? ` (${hurt.issue.where})` : ''
  const opts = [choices.easier, ...choices.alternates].filter((c): c is Choice => !!c)
  return (
    <div className="wm-card wm-hurt" data-tg="hurt">
      <div className="wm-eyebrow danger">Pain flagged on set {hurt.set}{where} · saved</div>
      <p className="wm-hurt-line" data-tg="hurt-line">
        No step up while it hurts. Pick an easier step or another move, or end this move. Stop if the pain is sharp.
      </p>
      <ul className="wm-opts">
        {opts.map((c) => (
          <li key={c.move}>
            <button type="button" className="wm-opt" onClick={() => onGo(c)} data-tg={c.kind === 'easier' ? 'hurt-easier' : 'hurt-alt'} data-move={c.move}>
              <span className="wm-opt-kind">{c.kind === 'easier' ? 'Easier' : 'Another move'}</span>
              <b>{c.name}</b>
              <small>
                {c.target} · {c.reason}
              </small>
            </button>
          </li>
        ))}
      </ul>
      <p className="wm-hint" data-tg="no-harder">
        Harder is off: {(choices.noHarder ?? 'not now').replace(/^Not/, 'not')}.
      </p>
      <div className="wm-rest-btns">
        <button type="button" className="wm-btn ghost" onClick={onBack}>
          Back to this move
        </button>
        <button type="button" className="wm-btn primary wide" onClick={onEnd} data-tg="end-move">
          End this move
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- easier / alternate / harder

function ChoicesRow({ choices, open, onOpen }: { choices: ReturnType<typeof moveChoices>; open: Choice['kind'] | null; onOpen: (k: Choice['kind']) => void }) {
  const alt = choices.alternates[0]
  const cell = (kind: Choice['kind'], label: string, sub: string | null, disabled: boolean, title: string, tg: string) => (
    <button type="button" className={`wm-choice${open === kind ? ' on' : ''}`} onClick={() => onOpen(kind)} disabled={disabled} title={title} aria-expanded={open === kind} data-tg={tg}>
      <b>{label}</b>
      <small>{sub ?? '—'}</small>
    </button>
  )
  return (
    <div className="wm-choices" role="group" aria-label="Change this move">
      {cell('easier', 'Easier', choices.easier?.name ?? null, !choices.easier, choices.easier?.reason ?? 'This is the easiest step', 'choice-easier')}
      {cell('alternate', 'Alternate', alt ? alt.name + (choices.alternates.length > 1 ? ` +${choices.alternates.length - 1}` : '') : null, !alt, alt?.reason ?? 'No other move at this level with your gear', 'choice-alt')}
      {cell('harder', 'Harder', choices.harder?.name ?? null, !choices.harder, choices.harder?.reason ?? choices.noHarder ?? '', 'choice-harder')}
    </div>
  )
}

function ChoicePanel({ kind, choices, onGo, onCancel }: { kind: Choice['kind']; choices: ReturnType<typeof moveChoices>; onGo: (c: Choice) => void; onCancel: () => void }) {
  const list = kind === 'alternate' ? choices.alternates : [kind === 'easier' ? choices.easier : choices.harder].filter((c): c is Choice => !!c)
  return (
    <div className="wm-card wm-choice-panel" data-tg="choice" data-kind={kind}>
      <div className="wm-eyebrow">{kind === 'easier' ? 'Easier' : kind === 'harder' ? 'Harder' : 'Another move, same level'}</div>
      <ul className="wm-opts">
        {list.map((c) => (
          <li key={c.move}>
            <button type="button" className="wm-opt" onClick={() => onGo(c)} data-tg="choice-go" data-move={c.move}>
              <b>{c.name}</b>
              <small className="num">{c.target}</small>
              <span className="wm-why" data-tg="choice-why">
                Why: {c.reason}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="wm-hint">{kind === 'alternate' ? 'For today only: your step stays. Every set you logged is kept.' : 'Your step changes now. Every set you logged and the day you reached each step stay.'}</p>
      <div className="wm-rest-btns">
        <button type="button" className="wm-btn ghost wide" onClick={onCancel}>
          Keep {kind === 'harder' ? 'this step' : 'this move'}
        </button>
      </div>
    </div>
  )
}

