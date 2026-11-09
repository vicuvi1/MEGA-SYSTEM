// Body → Today: ONE card is the whole plan for today (the coach card, from the
// training split): the session with Start, or "Rest day" with mobility and
// "Train anyway" (then the routine and Start); a one-line readiness with
// "Adjust"; meals as a checklist with a Log tap each; weigh-in and bed ticks;
// the day's tip. Everything else sits under "More" (closed): the readiness
// card, food rings, water and supplements, weight and waist, the body map and
// the by-hand buttons. Strength and streak live on Training. Nothing here pays
// new points.
import { useEffect, useRef, useState } from 'react'
import type { BodyState } from '@shared/api'
import { trainReadiness } from '@core/trainReadiness'
import { verdictOf, type Verdict } from '@core/readinessDay'
import { mobilityRoutine } from '@core/bodyMap'
import { dayRings } from '@core/foodDisplay'
import { SUPP_PRESETS } from '@core/foodSupps'
import type { FoodView } from '../../../../main/food'
import { life } from '../../bridge'
import { useAction } from '../../ui'
import { useWater, toggleWaterEntry, waterEntries } from '../../water'
import { WaterHistory } from '../../WaterHistory'
import { ReadinessCard, useReadiness, type ReadinessState } from '../../ReadinessCard'
import { useRest } from '../../RestDay'
import { FigureSvg } from '../../DrillFigure'
import { Rings } from '../FoodViz'
import { FoodBars } from '../FoodFast'
import { useBodyPlus } from '../useBodyPlus'
import { BodyMapCard } from './BodyMapCard'
import { useBodyLogSheet } from '../BodyLogSheet'
import { useSportToday, type SportToday } from './useSportToday'
import { requestSportStart } from '../../sportStart'
import { CoachToday } from '../../coach/CoachToday'
import '../food.css'
import './today.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const MORE_KEY = 'ls.bodyTodayMore'
const readMore = () => {
  try {
    return localStorage.getItem(MORE_KEY) === '1'
  } catch {
    return false
  }
}

export function TodayTab({
  state,
  onOpenSportApp,
  onOpenFood,
  onLogMetric,
  onLogWorkout,
  onAddExercise,
  onUndoLast
}: {
  state: BodyState
  onOpenSportApp?: () => void
  onOpenFood: () => void
  onLogMetric: () => void
  onLogWorkout: () => void
  onAddExercise: () => void
  onUndoLast?: () => void
}) {
  const sport = useSportToday()
  const bodyLog = useBodyLogSheet(onLogMetric, state.latestWeight)
  const [rest, setRest] = useRest()
  const restTapped = !!(rest?.restToday ?? state.restToday)
  // The grit bonus keeps its old trigger (a logged workout), so nothing new pays points.
  const r = useReadiness(!!(rest?.workoutDoneToday ?? state.workoutDoneToday))
  const [more, setMore] = useState(readMore)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const toggleMore = (open: boolean) => {
    setMore(open)
    try {
      localStorage.setItem(MORE_KEY, open ? '1' : '0')
    } catch {
      /* private window */
    }
  }
  const start = () => {
    requestSportStart()
    onOpenSportApp?.()
  }
  // "Adjust" on the readiness line opens More and shows the readiness card.
  const adjust = () => {
    toggleMore(true)
    requestAnimationFrame(() => moreRef.current?.querySelector('.rdy-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  return (
    <div className="bdy-today">
      <CoachToday onStart={start} readiness={<ReadinessLine r={r} ydaySets={sport?.ydaySets ?? 0} onAdjust={adjust} />} rest={<RestBlock sport={sport} onStart={start} />} />
      <details className="bdy-today-more" ref={moreRef} open={more} onToggle={(e) => toggleMore((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span>More</span>
          <small>Readiness, food, water, weight and the body map</small>
        </summary>
        <div className="bdy-today-more-body">
          <div className="bdy-grid two">
            <ReadinessCard r={r} ydaySets={sport?.ydaySets ?? 0} />
            <FoodRingsCard onOpen={onOpenFood} />
          </div>
          <div className="bdy-grid two">
            <WaterSuppCard />
            <WeightCard state={state} onLog={bodyLog.open} />
          </div>
          <BodyMapCard sport={sport} />
          <div className="bdy-more" aria-label="By hand">
            <button type="button" className="bdy-btn quiet" onClick={onLogWorkout}>
              Log a workout by hand
            </button>
            <button type="button" className="bdy-btn quiet" onClick={onAddExercise}>
              Add exercise
            </button>
            <button type="button" className="bdy-btn quiet wo-rest-btn" onClick={() => void setRest(null, !restTapped)}>
              {restTapped ? 'Take the rest day back' : 'Rest today'}
            </button>
            {onUndoLast && state.recentWorkouts.length > 0 && (
              <button type="button" className="bdy-btn quiet body-undo" onClick={onUndoLast} title={`Undo last workout: "${state.recentWorkouts[0]?.title}"`}>
                Undo last workout
              </button>
            )}
            {onOpenSportApp && (
              <button type="button" className="bdy-btn quiet" onClick={onOpenSportApp}>
                Open the tracker
              </button>
            )}
          </div>
        </div>
      </details>
      {bodyLog.sheet}
    </div>
  )
}

// ---------------------------------------------------------------- readiness, one line

const VERDICT_LINE: Record<Verdict, string> = { go: 'ready, go full today', lighter: 'go lighter today', rest: 'rest or mobility today' }

/** "Readiness 75: go lighter today" with Adjust (the same number as the readiness card under More). */
function ReadinessLine({ r, ydaySets, onAdjust }: { r: ReadinessState; ydaySets: number; onAdjust: () => void }) {
  const score = r.tr ? r.tr.score : trainReadiness({ sleptMin: r.sleptMin, needMin: r.needMin, soreness: r.sore, ydaySets }).score
  const verdict = r.tr ? r.verdict : verdictOf(score)
  return (
    <p className={`ct-ready rdy-line ${verdict}`}>
      <span>
        Readiness <b className="num">{score}</b>: {VERDICT_LINE[verdict]}
      </span>
      <button type="button" className="ct-link rdy-adjust" onClick={onAdjust}>
        Adjust
      </button>
    </p>
  )
}

// ---------------------------------------------------------------- a rest day

/** A rest day: 8 minutes of mobility, and "Train anyway" shows your routine with Start. */
function RestBlock({ sport, onStart }: { sport: SportToday | null; onStart: () => void }) {
  const [anyway, setAnyway] = useState(false)
  const moves = mobilityRoutine()
  const items = sport?.session
    ? sport.session.items.map((it) => ({ id: it.move.id, name: it.move.name, meta: `${it.sets} × ${it.lo}–${it.hi}${it.unit === 'sec' ? ' s' : ''}` }))
    : (sport?.routine ?? []).map((it) => ({ id: it.id, name: it.name, meta: `${fmt(it.done)} / ${fmt(it.target)} ${it.unit}` }))
  if (anyway)
    return (
      <div className="wo-anyway" aria-label="Your routine">
        {items.length > 0 ? (
          <ul className="wo-list">
            {items.slice(0, 6).map((it) => (
              <li key={it.id}>
                <span>{it.name}</span>
                <b>{it.meta}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="bdy-note">Add your exercises in the tracker to see them here.</p>
        )}
        <div className="wo-actions">
          <button type="button" className="bdy-btn primary big wo-start" onClick={onStart}>
            Start workout
          </button>
          <button type="button" className="bdy-btn quiet" onClick={() => setAnyway(false)}>
            Rest after all
          </button>
        </div>
      </div>
    )
  return (
    <div className="wo-rest" aria-label="Rest day mobility">
      <span className="ct-sec">Mobility · about 8 min</span>
      <ol className="wo-mobility">
        {moves.map(({ move, amount }) => (
          <li key={move.id}>
            <FigureSvg anim={move.anim} size={40} />
            <span>
              <b>{move.name}</b>
              <small>{amount}</small>
            </span>
          </li>
        ))}
      </ol>
      <div className="wo-actions">
        <button type="button" className="bdy-btn wo-anyway-btn" onClick={() => setAnyway(true)}>
          Train anyway
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- food

function useFood(): FoodView | null {
  const [v, setV] = useState<FoodView | null>(null)
  useEffect(() => {
    const api = life.coach?.food
    if (!api) return
    const load = () => void api.view().then(setV).catch(() => {})
    load()
    window.addEventListener('life-body-changed', load)
    window.addEventListener('focus', load)
    return () => {
      window.removeEventListener('life-body-changed', load)
      window.removeEventListener('focus', load)
    }
  }, [])
  return v
}

function FoodRingsCard({ onOpen }: { onOpen: () => void }) {
  const v = useFood()
  const t = v?.totals
  const rings = v && t ? dayRings({ protein: t.protein, kcal: t.kcal, carbs: v.carbs, fat: v.fat }, { protein: t.targets.protein, kcal: t.targets.kcal, carbs: t.targets.carbs, fat: t.targets.fat }) : null
  return (
    <button type="button" className="bdy-card tap fr-card" onClick={onOpen} aria-label="Food today. Opens the Food tab.">
      <span className="bdy-head">
        <span className="bdy-title">Food</span>
        <span className="bdy-note">Open ›</span>
      </span>
      {v?.progress && <FoodBars progress={v.progress} behind={v.behind} compact />}
      {rings ? <Rings rings={rings} /> : <span className="bdy-note">Loading…</span>}
      {v?.adjust?.state === 'suggest' && (
        <span className="fr-check">
          <b>Weekly check:</b> {v.adjust.suggestion.title.toLowerCase()}. Open to apply.
        </span>
      )}
      {v?.next?.line && !v.behind?.behind && (
        <span className="fr-next">
          <b>Next:</b> {v.next.line}
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- water and supplements

function Bottle({ frac }: { frac: number }) {
  const f = Math.max(0, Math.min(1, frac))
  return (
    <svg className="ws-bottle" viewBox="0 0 60 120" width="54" height="108" aria-hidden="true">
      <defs>
        <clipPath id="ws-bottle-clip">
          <path d="M22 4 h16 v12 q0 4 4 8 q8 8 8 18 v66 q0 8 -8 8 h-24 q-8 0 -8 -8 v-66 q0 -10 8 -18 q4 -4 4 -8 z" />
        </clipPath>
      </defs>
      <path className="ws-bottle-glass" d="M22 4 h16 v12 q0 4 4 8 q8 8 8 18 v66 q0 8 -8 8 h-24 q-8 0 -8 -8 v-66 q0 -10 8 -18 q4 -4 4 -8 z" />
      <g clipPath="url(#ws-bottle-clip)">
        <rect className="ws-bottle-fill" x="0" y="18" width="60" height="102" style={{ transform: `scaleY(${f})` }} />
      </g>
    </svg>
  )
}

function WaterSuppCard() {
  const act = useAction()
  const water = useWater()
  const food = useFood()
  const [plus, setPlus] = useBodyPlus()
  const [details, setDetails] = useState(false)
  const target = water.target || 2500
  const undo = async () => {
    const list = await waterEntries()
    const last = [...list].reverse().find((e) => !e.removed && e.amount > 0)
    if (!last) return
    await act(async () => (await toggleWaterEntry(last.id)) ?? null, `Took back ${last.amount} ml`)
  }
  const taken = (id: string) => {
    const name = SUPP_PRESETS.find((p) => p.id === id)?.items[0]?.name
    return food?.meals.find((m) => m.supp && !m.removed && m.items[0]?.name === name) ?? null
  }
  const creatine = plus?.supps.find((s) => s.id === 'creatine')
  const tapSupp = async (id: string) => {
    const api = life.coach?.food
    if (!api) return
    const meal = taken(id)
    const label = SUPP_PRESETS.find((p) => p.id === id)?.label ?? id
    if (meal) {
      await act(() => api.toggle(meal.id), `${label}: taken back`)
      if (id === 'creatine' && creatine?.taken) {
        const next = await act(() => life.coach!.bodyPlus!.supp('creatine'))
        if (next) setPlus(next)
      }
    } else await act(() => api.supp(id), `${label} logged`)
  }
  return (
    <section className="bdy-card ws-card" aria-label="Water and supplements">
      <div className="bdy-head">
        <h2 className="bdy-title">Water</h2>
        <button type="button" className="bdy-btn quiet ws-details" onClick={() => setDetails(true)}>
          Details
        </button>
      </div>
      <div className="ws-main">
        <Bottle frac={water.ml / target} />
        <div className="ws-nums">
          <b className="bdy-num ws-total">
            {fmt(water.ml)}
            <span className="bdy-unit">ml</span>
          </b>
          <span className="bdy-note">of {fmt(target)} ml</span>
          <div className="ws-btns">
            <button type="button" className="bdy-chip ws-add" onClick={() => void water.add(250)}>
              +250
            </button>
            <button type="button" className="bdy-chip ws-add" onClick={() => void water.add(500)}>
              +500
            </button>
            <button type="button" className="bdy-chip ws-undo" onClick={() => void undo()} disabled={water.ml <= 0}>
              Undo
            </button>
          </div>
        </div>
      </div>
      <div className="ws-supps" role="group" aria-label="Supplements today">
        {SUPP_PRESETS.map((p) => {
          const on = !!taken(p.id)
          return (
            <button key={p.id} type="button" className={`bdy-chip ws-supp ws-supp-${p.id}${on ? ' on' : ''}`} aria-pressed={on} onClick={() => void tapSupp(p.id)}>
              {on ? '✓ ' : ''}
              {p.id === 'creatine' ? 'Creatine' : p.id === 'shake' ? 'Shake' : 'Vitamins'}
              {p.id === 'creatine' && creatine && creatine.streak > 0 && <small>{creatine.streak} d</small>}
            </button>
          )
        })}
      </div>
      {details && (
        <div className="sheet" role="dialog" aria-label="Water today">
          <div className="sheet-card" style={{ maxWidth: 440 }}>
            <WaterHistory />
            <div className="sheet-actions">
              <button type="button" className="btn primary" onClick={() => setDetails(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- weight and waist

function WeightCard({ state, onLog }: { state: BodyState; onLog: () => void }) {
  const w = state.latestWeight
  const waist = state.latestWaist
  if (w == null && waist == null) {
    return (
      <section className="bdy-card wt-prompt" aria-label="Weight and waist">
        <h2 className="bdy-title">Weight & waist</h2>
        <p className="bdy-sub">Log them once a week in the morning. It shows if you are gaining muscle, not fat.</p>
        <button type="button" className="bdy-btn primary wt-log" onClick={onLog}>
          Log weight & waist
        </button>
      </section>
    )
  }
  const diff = w != null && state.previousWeight != null ? Math.round((w - state.previousWeight) * 10) / 10 : null
  const avg = state.weeklyAverages.length ? state.weeklyAverages[state.weeklyAverages.length - 1].avg : null
  return (
    <section className="bdy-card wt-values" aria-label="Weight and waist">
      <div className="bdy-head">
        <h2 className="bdy-title">Weight & waist</h2>
        <button type="button" className="bdy-btn quiet wt-log" onClick={onLog}>
          Update
        </button>
      </div>
      <div className="wt-row">
        {w != null && (
          <div className="bdy-stat">
            <span>Weight</span>
            <b className="bdy-num">
              {w}
              <span className="bdy-unit">kg</span>
            </b>
            <span className="bdy-note">
              {diff != null ? `${diff > 0 ? '+' : ''}${diff} kg since last` : avg ? `Week average ${avg} kg` : 'First log'}
            </span>
          </div>
        )}
        {waist != null && (
          <div className="bdy-stat">
            <span>Waist</span>
            <b className="bdy-num">
              {waist}
              <span className="bdy-unit">cm</span>
            </b>
            <span className="bdy-note">Morning measure</span>
          </div>
        )}
      </div>
      {(w == null || waist == null) && (
        <button type="button" className="bdy-btn wt-missing" onClick={onLog}>
          Add {w == null ? 'weight' : 'waist'}
        </button>
      )}
    </section>
  )
}
