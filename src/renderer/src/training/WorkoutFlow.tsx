// The set-by-set logic of a workout, shared by Sport Track's Workout section:
// one move at a time (the first with sets left, or the one you pick), the reps
// (− / + or typed), an effort tap (Hard / OK / Easy: required) and the optional
// form check, then Log set. A rest timer follows each set (the engine's rest for
// that level, +30 s, Skip; start / pause by hand too) and plays the "focus end"
// sound at zero (the sound can be turned off, kept on this device). Every set is
// saved the moment it is logged, so leaving never loses anything. Finish logs the
// usual workout (built only from logged sets) and shows what changed in
// FinishOverlay: an unlocked move with Apply / Keep, or what next time looks like.
import { useEffect, useRef, useState } from 'react'
import type { Feel } from '@core/trainLog'
import type { FinishRow, TrackerItem, TrackerView } from '@core/sportTrain'
import { buzz, play } from '../soundKit'

export const FEELS: { id: Feel; label: string; hint: string }[] = [
  { id: 'easy', label: 'Easy', hint: '3+ reps left' },
  { id: 'ok', label: 'OK', hint: '1–2 reps left: the target' },
  { id: 'hard', label: 'Hard', hint: '0–1 reps left' }
]
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`

const SOUND_KEY = 'life_train_rest_sound'
const readSound = () => {
  try {
    return localStorage.getItem(SOUND_KEY) !== '0'
  } catch {
    return true
  }
}

export interface FinishChoice {
  ladder: string
  kind: 'apply' | 'keep'
  line: string
}

interface Rest {
  /** null: paused. */
  endsAt: number | null
  total: number
  /** Seconds left while paused. */
  left: number
}

export interface WorkoutFlowHandlers {
  view: TrackerView
  onLog: (it: TrackerItem, reps: number, feel: Feel, formOff: boolean) => void
  onUndo: (setId: string) => void
  onFinish: () => Promise<FinishRow[] | null>
  onApply: (ladder: string) => string | null
  onKeep: (ladder: string) => string | null
}

export function useWorkoutFlow({ view, onLog, onUndo, onFinish, onApply, onKeep }: WorkoutFlowHandlers) {
  const items = view.items
  const firstOpen = Math.max(0, items.findIndex((it) => it.done.length < it.sets))
  const [pick, setPick] = useState<number | null>(null)
  const idx = Math.min(Math.max(0, items.length - 1), pick ?? firstOpen)
  const it: TrackerItem | undefined = items[idx]
  const n = it ? it.done.length : 0
  const aim = it ? it.aim[Math.min(n, it.aim.length - 1)] ?? it.level.lo : 0
  const [reps, setReps] = useState(aim)
  const [feel, setFeel] = useState<Feel | null>(null)
  const [formOk, setFormOk] = useState(true)
  const [rest, setRest] = useState<Rest | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [sound, setSoundOn] = useState(readSound)
  const [report, setReport] = useState<FinishRow[] | null>(null)
  const [choices, setChoices] = useState<Record<string, FinishChoice>>({})
  const [busy, setBusy] = useState(false)
  const rang = useRef(false)
  // A new set (or another move) starts from its aim, with a fresh effort tap.
  const key = it ? `${it.ladder.id}:${it.level.move}:${n}` : ''
  useEffect(() => {
    setReps(aim)
    setFeel(null)
    setFormOk(true)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const running = rest?.endsAt != null
  useEffect(() => {
    if (!running) return
    rang.current = false
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [running])
  const left = rest ? (rest.endsAt != null ? Math.max(0, Math.ceil((rest.endsAt - now) / 1000)) : rest.left) : 0
  useEffect(() => {
    if (!rest || rest.endsAt == null || left > 0 || rang.current) return
    rang.current = true
    if (sound) {
      try {
        play('focusEnd')
        buzz([180, 90, 180])
      } catch {
        /* sound is a nicety */
      }
    }
    const t = window.setTimeout(() => setRest(null), 1500)
    return () => window.clearTimeout(t)
  }, [left, rest, sound])

  const startRest = (sec: number) => {
    rang.current = false
    setNow(Date.now())
    setRest({ endsAt: Date.now() + sec * 1000, total: sec, left: sec })
  }
  const toggleRest = (idleSec: number) => {
    if (!rest) return startRest(idleSec)
    if (rest.endsAt != null) setRest({ ...rest, endsAt: null, left })
    else {
      rang.current = false
      setNow(Date.now())
      setRest({ ...rest, endsAt: Date.now() + (rest.left || rest.total) * 1000 })
    }
  }
  const addRest = (s: number, idleSec: number) => {
    if (!rest) return setRest({ endsAt: null, total: idleSec + s, left: idleSec + s })
    setRest({ ...rest, total: rest.total + s, left: rest.endsAt == null ? rest.left + s : rest.left, endsAt: rest.endsAt == null ? null : rest.endsAt + s * 1000 })
  }
  const setSound = (on: boolean) => {
    setSoundOn(on)
    try {
      localStorage.setItem(SOUND_KEY, on ? '1' : '0')
    } catch {
      /* this session only */
    }
  }

  const allDone = view.setsDone >= view.setsPlanned && view.setsPlanned > 0
  const unit = it?.level.unit === 'sec' ? ' s' : ''
  const step = it?.level.unit === 'sec' ? 5 : 1

  const log = () => {
    if (!it || !feel || reps < 1) return
    onLog(it, reps, feel, !formOk)
    setPick(null)
    const after = view.setsDone + (n < it.sets ? 1 : 0)
    if (after < view.setsPlanned) startRest(it.rest)
    else setRest(null)
  }
  const finish = async () => {
    setBusy(true)
    setRest(null)
    const rows = await onFinish()
    setBusy(false)
    if (rows) setReport(rows)
  }
  const choose = (ladder: string, kind: 'apply' | 'keep') => {
    const line = kind === 'apply' ? onApply(ladder) : onKeep(ladder)
    if (line) setChoices((m) => ({ ...m, [ladder]: { ladder, kind, line } }))
  }
  return { items, idx, it, n, reps, setReps, feel, setFeel, formOk, setFormOk, rest, left, running, sound, setSound, setPick, startRest, toggleRest, addRest, skipRest: () => setRest(null), allDone, unit, step, log, finish, busy, report, closeReport: () => setReport(null), choices, choose, onUndo }
}

export type WorkoutFlowState = ReturnType<typeof useWorkoutFlow>

/** "Workout done": what changed, per move, with Apply / Keep for an unlocked one. */
export function FinishOverlay({ view, flow, onClose }: { view: TrackerView; flow: WorkoutFlowState; onClose: () => void }) {
  const { report, choices, choose } = flow
  if (!report) return null
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
                    <button type="button" className="tg-btn primary" data-tg="apply" onClick={() => choose(r.ladder, 'apply')}>
                      Apply: {r.offer.name}
                    </button>
                    <button type="button" className="tg-btn" data-tg="keep" onClick={() => choose(r.ladder, 'keep')}>
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
}

/** "Next time: Decline push-ups 3 × 6–12, because 3×12 easy twice." */
export const appliedLine = (o: { name: string; target: string; reason: string }) => `Next time: ${o.name} ${o.target}, because ${o.reason}.`
export const keptLine = (name: string) => `Staying on ${name}. The harder move is offered again after your next session at the top.`
