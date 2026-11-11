// The set-by-set logic of a workout, shared by Sport Track's Workout section and
// Workout mode: one move at a time (the first with sets left, or the one you
// pick), the reps (− / + or typed), an effort tap (Hard / OK / Easy: required)
// and the form check (Form good / Form broke; not tapped is "form unknown",
// which never counts toward a step up), then Set done. "Pain / can't finish"
// logs the set with the issue; a pain flag offers easier or another move and
// can end the move. A rest timer follows each set (the engine's rest for
// that level, +30 s, Skip; start / pause by hand too) and plays the "focus end"
// sound at zero (the sound can be turned off, kept on this device). Every set is
// saved the moment it is logged, so leaving never loses anything. Finish logs the
// usual workout (built only from logged sets); Workout mode then shows Workout
// done (WorkoutDone.tsx).
import { useEffect, useRef, useState } from 'react'
import type { Feel } from '@core/trainLog'
import type { SetIssue } from '@core/sportSets'
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

export type FormTap = 'good' | 'off' | null

export interface WorkoutFlowHandlers {
  view: TrackerView
  onLog: (it: TrackerItem, reps: number, feel: Feel | null, form: FormTap, issue?: SetIssue | null) => void
  onUndo: (setId: string) => void
  onFinish: () => Promise<FinishRow[] | null>
  onApply: (ladder: string) => string | null
  onKeep: (ladder: string) => string | null
}

export function useWorkoutFlow({ view, onLog, onUndo, onFinish, onApply, onKeep }: WorkoutFlowHandlers) {
  const items = view.items
  // Moves you ended early (after pain): the flow skips them; their sets stay logged.
  const [ended, setEnded] = useState<string[]>([])
  const firstOpen = Math.max(0, items.findIndex((it) => it.done.length < it.sets && !ended.includes(it.ladder.id)))
  const [pick, setPick] = useState<number | null>(null)
  const idx = Math.min(Math.max(0, items.length - 1), pick ?? firstOpen)
  const it: TrackerItem | undefined = items[idx]
  const n = it ? it.done.length : 0
  const aim = it ? it.aim[Math.min(n, it.aim.length - 1)] ?? it.level.lo : 0
  const [reps, setReps] = useState(aim)
  const [feel, setFeel] = useState<Feel | null>(null)
  const [form, setForm] = useState<FormTap>(null)
  /** The pain flag just logged on this move (shows the easier / alternate / end choices). */
  const [hurt, setHurt] = useState<{ ladder: string; issue: SetIssue; set: number } | null>(null)
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
    setForm(null)
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
    if (!rest) return setRest({ endsAt: null, total: Math.max(5, idleSec + s), left: Math.max(5, idleSec + s) })
    // Never below 0 left (−15 s near the end just ends the rest at 0).
    const cut = s < 0 ? -Math.min(-s, left) : s
    setRest({ ...rest, total: Math.max(1, rest.total + cut), left: rest.endsAt == null ? Math.max(0, rest.left + cut) : rest.left, endsAt: rest.endsAt == null ? null : rest.endsAt + cut * 1000 })
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
    onLog(it, reps, feel, form)
    setPick(null)
    const after = view.setsDone + (n < it.sets ? 1 : 0)
    if (after < view.setsPlanned) startRest(it.rest)
    else setRest(null)
  }
  /** "Pain / can't finish": the set is logged with the reps you did and the issue. Pain stops here and offers choices. */
  const logIssue = (issue: SetIssue) => {
    if (!it) return
    onLog(it, Math.max(1, reps), feel, form, issue)
    if (issue.kind === 'pain') {
      setRest(null)
      setHurt({ ladder: it.ladder.id, issue, set: n + 1 })
      setPick(idx)
      return
    }
    setPick(null)
    const after = view.setsDone + (n < it.sets ? 1 : 0)
    if (after < view.setsPlanned) startRest(it.rest)
  }
  /** Ends a move early (its logged sets stay): the next move with sets left comes up. */
  const endMove = (ladder: string) => {
    setEnded((e) => (e.includes(ladder) ? e : [...e, ladder]))
    setHurt(null)
    setPick(null)
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
  const finished = items.every((x) => x.done.length >= x.sets || ended.includes(x.ladder.id)) && view.setsDone > 0
  return { items, idx, it, n, reps, setReps, feel, setFeel, form, setForm, hurt, clearHurt: () => setHurt(null), logIssue, ended, endMove, finished, rest, left, running, sound, setSound, setPick, startRest, toggleRest, addRest, skipRest: () => setRest(null), allDone, unit, step, log, finish, busy, report, closeReport: () => setReport(null), choices, choose, onUndo }
}

export type WorkoutFlowState = ReturnType<typeof useWorkoutFlow>

/** "Next time: Decline push-ups 3 × 6–12, because 3×12 easy twice." */
export const appliedLine = (o: { name: string; target: string; reason: string }) => `Next time: ${o.name} ${o.target}, because ${o.reason}.`
export const keptLine = (name: string) => `Staying on ${name}. The harder move is offered again after your next session at the top.`
