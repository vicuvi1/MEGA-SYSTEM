// Sport Track's one training state for every section (Dashboard, Workout,
// Exercises, Progress): Sport Track's saved state (the same store Body used),
// today's readiness and dose, today's session from the engine
// (core/sportTrain.ts on trainWeek / trainLadders / trainLog) in the order you
// dragged the moves into, and every action that changes it: log / undo a set,
// Finish, Apply / Keep an unlocked move, Make easier / harder (one move or the
// whole session), "I can't train today" and "Train anyway". Points: only
// Finish logs the usual workout, built from the sets you logged ("Workout
// done", once a day); nothing else here pays.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BodyState } from '@shared/api'
import { applyOffer, finishReport, keepOffer, orderItems, shiftMove, shiftWorkout, trackerFinish, trackerLog, trackerToday, trackerUndo, type TrackerItem, type TrackerView } from '@core/sportTrain'
import { ensureExercise, sessionItems, trainOf, type Dose, type Feel } from '@core/trainLog'
import { clearPick, pickToday, setGear, type Gear } from '@core/trainGear'
import { makeStep } from '@core/trainSwap'
import type { LadderId, Level } from '@core/trainLadders'
import type { SessionType } from '@core/trainWeek'
import { life } from '../bridge'
import { celebrate } from '../fx'
import { soundFanfare } from '../soundKit'
import { useToast } from '../ui'
import { readSport } from '../sportTrack'
import { saveTraining, useTraining } from '../body/training/trainingStore'
import { useTrainReady } from './useTrainHome'
import { appliedLine, keptLine } from './WorkoutFlow'

const ANYWAY_KEY = 'life_train_anyway'
const ORDER_KEY = 'life_train_order'

const readAnyway = (day: string): SessionType | null => {
  try {
    const v = JSON.parse(localStorage.getItem(ANYWAY_KEY) || 'null')
    return v && v.day === day && (v.type === 'upper' || v.type === 'legs') ? v.type : null
  } catch {
    return null
  }
}
const writeAnyway = (day: string, type: SessionType | null) => {
  try {
    if (type) localStorage.setItem(ANYWAY_KEY, JSON.stringify({ day, type }))
    else localStorage.removeItem(ANYWAY_KEY)
  } catch {
    /* this session only */
  }
}
/** The order you dragged each session's moves into (this device only: it changes nothing else). */
const readOrder = (): Partial<Record<SessionType, string[]>> => {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export interface SportTrain {
  st: any
  today: string
  v: TrackerView
  session: SessionType | null
  readiness: number | null
  thin: boolean
  auto: boolean
  skip: boolean
  setDose: (m: Dose | null) => void
  logSet: (it: TrackerItem, reps: number, feel: Feel, formOff: boolean) => void
  undoSet: (setId: string) => void
  finish: () => Promise<ReturnType<typeof finishReport> | null>
  apply: (ladder: string, type?: SessionType, fromNext?: boolean) => string | null
  /** Use this move today only (null: back to your step). */
  usePick: (ladder: LadderId, level: Level | null) => void
  /** Make this step your level on the chain. */
  makeStep: (ladder: LadderId, index: number) => boolean
  saveGear: (g: Omit<Gear, 'at'>) => void
  keep: (ladder: string, type?: SessionType) => string | null
  shiftAll: (delta: -1 | 1) => void
  shiftOne: (it: TrackerItem, delta: -1 | 1) => void
  restToday: (on: boolean) => Promise<void>
  trainAnyway: (t: SessionType | null) => void
  reorder: (ids: string[]) => void
  refresh: () => void
}

export function useSportTrain(body: BodyState | null, onBody: (s: BodyState) => void, onWallet: () => void): SportTrain {
  const toast = useToast()
  const { st, today, refresh } = useTraining()
  const { tr, thin, setDose } = useTrainReady(today)
  const [anyway, setAnyway] = useState<SessionType | null>(() => readAnyway(today))
  useEffect(() => setAnyway(readAnyway(today)), [today])
  const [order, setOrder] = useState(readOrder)
  const skip = !!body?.restToday
  const dose: Dose = (tr?.mode as Dose) ?? 'full'
  const state = useMemo(() => st ?? {}, [st])
  const v = useMemo(() => {
    const raw = trackerToday(state, today, { dose, anyway, skip })
    return raw.type === 'rest' ? raw : { ...raw, items: orderItems(raw.items, order[raw.type]) }
  }, [state, today, dose, anyway, skip, order])
  const session = v.type === 'rest' ? null : (v.type as SessionType)

  const logSet = useCallback(
    (it: TrackerItem, reps: number, feel: Feel, formOff: boolean) => {
      if (!session) return
      // The exercise first (its own change), so the reps after it reach the log as reps.
      saveTraining((s) => void ensureExercise(s, it.level.move, it.level, it.sets))
      saveTraining((s) => void trackerLog(s, { day: today, type: session, ladder: it.ladder.id, reps, feel, formOff, now: Date.now(), dose }))
      if (v.byChoice) writeAnyway(today, session)
      refresh()
    },
    [session, today, dose, v.byChoice, refresh]
  )
  const undoSet = useCallback(
    (setId: string) => {
      if (!session) return
      saveTraining((s) => void trackerUndo(s, { day: today, type: session, setId, now: Date.now() }))
      refresh()
    },
    [session, today, refresh]
  )
  const finish = useCallback(async () => {
    if (!session) return null
    const box: { w: ReturnType<typeof trackerFinish> } = { w: null }
    saveTraining((s) => {
      box.w = trackerFinish(s, { day: today, type: session, now: Date.now() })
    })
    refresh()
    if (!box.w) {
      toast('Nothing logged yet: log a set first.', 'info')
      return null
    }
    try {
      const r = await life.body.logWorkout(box.w)
      onBody(r.state)
      onWallet()
      window.dispatchEvent(new CustomEvent('life-body-changed'))
      window.dispatchEvent(new CustomEvent('life-wallet-changed'))
      toast(r.awarded ? 'Workout saved. "Workout done" points paid.' : 'Workout saved (today’s workout points were already paid).', 'good')
    } catch {
      toast('Your sets are saved. The workout could not be added to your log right now.', 'info')
    }
    const rows = finishReport(trackerToday(readSport() ?? {}, today, { dose, anyway }))
    if (rows.some((r) => r.offer)) soundFanfare()
    celebrate(null, 'reward')
    return rows
  }, [session, today, dose, anyway, refresh, toast, onBody, onWallet])

  const apply = useCallback(
    (ladder: string, type?: SessionType, fromNext?: boolean): string | null => {
      const t = type ?? session
      if (!t) return null
      const box: { o: ReturnType<typeof applyOffer> } = { o: null }
      saveTraining((s) => {
        box.o = applyOffer(s, { day: today, type: t, ladder: ladder as LadderId, now: Date.now(), fromNext })
      })
      refresh()
      if (!box.o) return null
      toast(fromNext ? `${box.o.name} starts from your next workout. Today stays as planned.` : `${box.o.name} is your step now. Your old sets stay in your history.`, 'good')
      return appliedLine(box.o)
    },
    [session, today, refresh, toast]
  )
  const keep = useCallback(
    (ladder: string, type?: SessionType): string | null => {
      const t = type ?? session
      if (!t) return null
      const it = sessionItems(state, trainOf(state), t, today).find((x) => x.ladder.id === ladder)
      let ok = false
      saveTraining((s) => {
        ok = keepOffer(s, { day: today, type: t, ladder: ladder as LadderId, now: Date.now() })
      })
      refresh()
      return ok && it ? keptLine(it.name) : null
    },
    [session, state, today, refresh]
  )
  const shiftAll = (delta: -1 | 1) => {
    if (!session) return
    const box: { out: ReturnType<typeof shiftWorkout> } = { out: [] }
    saveTraining((s) => {
      box.out = shiftWorkout(s, { day: today, type: session, delta, now: Date.now() })
    })
    refresh()
    if (!box.out.length) return toast(delta > 0 ? 'Every move is already at the top of its chain.' : 'Every move is already at the easiest step.', 'info')
    toast(`${delta > 0 ? 'Harder' : 'Easier'}: ${box.out.map((x) => x.to).join(', ')}. Your history stays.`, 'good')
  }
  const shiftOne = (it: TrackerItem, delta: -1 | 1) => {
    const box: { s: ReturnType<typeof shiftMove> } = { s: null }
    saveTraining((s) => {
      box.s = shiftMove(s, { day: today, ladder: it.ladder.id, delta, now: Date.now() })
    })
    refresh()
    if (!box.s) return toast(delta > 0 ? `${it.name} is the top of this chain.` : `${it.name} is the easiest step.`, 'info')
    toast(`${box.s.from} → ${box.s.to}. Your history stays.`, 'good')
  }
  const restToday = async (on: boolean) => {
    if (!life.body.setRest) return void toast('Rest days need the newest version.', 'info')
    try {
      const next = await life.body.setRest(null, on)
      onBody(next)
      window.dispatchEvent(new CustomEvent('life-body-changed'))
      toast(on ? 'Rest today: your streak stays. Mobility is on your Dashboard if you feel like it.' : 'Rest day taken back.', 'good')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const usePick = (ladder: LadderId, level: Level | null) => {
    saveTraining((s) => {
      if (level) pickToday(s, { day: today, ladder, level, now: Date.now() })
      else clearPick(s, { day: today, ladder, now: Date.now() })
    })
    refresh()
  }
  const makeStepFn = (ladder: LadderId, index: number) => {
    let ok = false
    saveTraining((s) => {
      ok = makeStep(s, { day: today, ladder, index, now: Date.now() })
    })
    refresh()
    return ok
  }
  const saveGear = (g: Omit<Gear, 'at'>) => {
    saveTraining((s) => void setGear(s, g, Date.now()))
    refresh()
  }
  const trainAnyway = (t: SessionType | null) => {
    writeAnyway(today, t)
    setAnyway(t)
  }
  const reorder = (ids: string[]) => {
    if (!session) return
    const next = { ...readOrder(), [session]: ids }
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next))
    } catch {
      /* this session only */
    }
    setOrder(next)
  }
  return {
    st: state,
    today,
    v,
    session,
    readiness: tr && !thin ? tr.score : null,
    thin,
    auto: !!tr?.auto,
    skip,
    setDose: (m) => void setDose(m),
    logSet,
    undoSet,
    finish,
    apply,
    keep,
    shiftAll,
    shiftOne,
    restToday,
    usePick,
    makeStep: makeStepFn,
    saveGear,
    trainAnyway,
    reorder,
    refresh
  }
}
