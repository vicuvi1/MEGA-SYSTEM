// Body → Today: a calm athlete page with the game parts in the hero only.
// 1. Hero: strength rank, a bar to the next rank, streak, today's quest.
// 2. Today's workout (or "Done for today", or a rest day with mobility) and one Start.
// 3. Readiness 0–100 and the dose. 4. Food rings. 5. Water and supplements.
// 6. Weight & waist. 7. The body map. Nothing here pays new points.
import { useEffect, useState } from 'react'
import type { BodyState } from '@shared/api'
import { DOSE_LABEL, doseMinutes } from '@core/trainReadiness'
import { dayState } from '@core/readinessDay'
import { mobilityRoutine } from '@core/bodyMap'
import { dayRings } from '@core/foodDisplay'
import { SUPP_PRESETS } from '@core/foodSupps'
import type { FoodView } from '../../../../main/food'
import { life } from '../../bridge'
import { useAction } from '../../ui'
import { useWater, toggleWaterEntry, waterEntries } from '../../water'
import { WaterHistory } from '../../WaterHistory'
import { ReadinessCard, useReadiness } from '../../ReadinessCard'
import { useRest } from '../../RestDay'
import { FigureSvg } from '../../DrillFigure'
import { Rings } from '../FoodViz'
import { FoodBars } from '../FoodFast'
import { useBodyPlus } from '../useBodyPlus'
import { BodyMapCard } from './BodyMapCard'
import { useSportToday, type SportToday } from './useSportToday'
import { requestSportStart } from '../../sportStart'
import '../food.css'
import './today.css'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

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
  const [rest, setRest] = useRest()
  const restTapped = !!(rest?.restToday ?? state.restToday)
  const trainedToday = !!(rest?.workoutDoneToday ?? state.workoutDoneToday) || !!sport?.setsToday
  // The grit bonus keeps its old trigger (a logged workout), so nothing new pays points.
  const r = useReadiness(!!(rest?.workoutDoneToday ?? state.workoutDoneToday))
  const [anyway, setAnyway] = useState(false)
  const day = dayState({ trainedToday, restTapped, plannedRest: !!sport?.plannedRest, verdict: r.verdict })
  // "Train anyway" on a suggested rest day shows the workout (a tapped rest day is taken back instead).
  const shown = day.kind === 'rest' && day.reason !== 'tapped' && anyway ? dayState({ trainedToday, restTapped: false, plannedRest: false, verdict: 'lighter' }) : day
  const start = () => {
    requestSportStart()
    onOpenSportApp?.()
  }
  return (
    <div className="bdy-today">
      <Hero state={state} sport={sport} day={shown} minutes={workoutMinutes(sport, r.mode)} />
      <div className="bdy-grid wide-left">
        <WorkoutCard
          sport={sport}
          day={shown}
          doseLabel={DOSE_LABEL[r.mode]}
          minutes={workoutMinutes(sport, r.mode)}
          onStart={start}
          onOpen={onOpenSportApp}
          onRest={() => void setRest(null, true)}
          onTrainAnyway={() => (day.reason === 'tapped' ? void setRest(null, false) : setAnyway(true))}
        />
        <ReadinessCard r={r} ydaySets={sport?.ydaySets ?? 0} />
      </div>
      <div className="bdy-grid three">
        <FoodRingsCard onOpen={onOpenFood} />
        <WaterSuppCard />
        <WeightCard state={state} onLog={onLogMetric} />
      </div>
      <BodyMapCard sport={sport} />
      <div className="bdy-more" aria-label="More">
        <button type="button" className="bdy-btn quiet" onClick={onLogWorkout}>
          Log a workout by hand
        </button>
        <button type="button" className="bdy-btn quiet" onClick={onAddExercise}>
          Add exercise
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
  )
}

/** About how long today's workout takes at today's dose (20–45 min). */
function workoutMinutes(sport: SportToday | null, mode: 'full' | 'light' | 'short'): number {
  const base = sport?.session?.minutes ?? sport?.planMinutes ?? 30
  return Math.min(45, Math.max(20, doseMinutes(base, mode)))
}

// ---------------------------------------------------------------- hero

function Hero({ state, sport, day, minutes }: { state: BodyState; sport: SportToday | null; day: ReturnType<typeof dayState>; minutes: number }) {
  const rank = sport?.rank ?? null
  const name = rank?.rank.name ?? 'Recruit'
  const score = rank?.score ?? 0
  const from = rank?.rank.from ?? 0
  const to = rank?.next?.from ?? 100
  const frac = rank?.next ? Math.max(0, Math.min(1, (score - from) / Math.max(1, to - from))) : 1
  const quest =
    day.kind === 'done'
      ? 'Workout done. Quest complete.'
      : day.kind === 'rest'
        ? 'Rest day: 8 minutes of mobility.'
        : `${sport?.session?.name ?? 'Your routine'}, about ${minutes} min.`
  return (
    <section className="bdy-card bdy-hero" aria-label="Your strength rank and today's quest">
      <div className="bdy-hero-rank">
        <span className="bdy-hero-badge" aria-hidden="true">
          {name[0]}
        </span>
        <div className="bdy-hero-who">
          <span className="bdy-eyebrow">Strength rank</span>
          <b className="bdy-hero-name">
            {name} <span className="bdy-hero-score">{score}/100</span>
          </b>
          <div className="bdy-hero-xp">
            <span className="bdy-bar" role="progressbar" aria-label={rank?.next ? `Progress to ${rank.next.name}` : 'Top rank'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)}>
              <i style={{ ['--p' as any]: frac }} />
            </span>
            <span className="bdy-note">{rank?.next ? `${rank.need} to ${rank.next.name}` : 'Top rank'}</span>
          </div>
        </div>
      </div>
      <div className="bdy-hero-stat">
        <span className="bdy-eyebrow">Streak</span>
        <b className="bdy-num xl">
          {state.streak}
          <span className="bdy-unit">{state.streak === 1 ? 'day' : 'days'}</span>
        </b>
        <span className="bdy-note">Best {state.bestStreak}</span>
      </div>
      <div className={`bdy-hero-quest ${day.kind}`}>
        <span className="bdy-eyebrow">Today's quest</span>
        <b className="bdy-hero-quest-text">{quest}</b>
        {rank?.hint && day.kind !== 'done' && <span className="bdy-note">{rank.hint}</span>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- workout

function WorkoutCard({
  sport,
  day,
  doseLabel,
  minutes,
  onStart,
  onOpen,
  onRest,
  onTrainAnyway
}: {
  sport: SportToday | null
  day: ReturnType<typeof dayState>
  doseLabel: string
  minutes: number
  onStart: () => void
  onOpen?: () => void
  onRest: () => void
  onTrainAnyway: () => void
}) {
  if (day.kind === 'rest') {
    const moves = mobilityRoutine()
    return (
      <section className="bdy-card wo-card wo-rest" aria-label="Rest day">
        <div className="bdy-head">
          <h2 className="bdy-title">{day.title}</h2>
          <span className="bdy-note">Mobility · about 8 min</span>
        </div>
        <p className="bdy-sub">{day.line}</p>
        <ol className="wo-mobility">
          {moves.map(({ move, amount }) => (
            <li key={move.id}>
              <FigureSvg anim={move.anim} size={44} />
              <span>
                <b>{move.name}</b>
                <small>{amount}</small>
              </span>
            </li>
          ))}
        </ol>
        <div className="wo-actions">
          <button type="button" className="bdy-btn" onClick={onTrainAnyway}>
            {day.reason === 'tapped' ? 'Take the rest day back' : 'Train anyway'}
          </button>
        </div>
      </section>
    )
  }
  const items = sport?.session
    ? sport.session.items.map((it) => ({ id: it.move.id, name: it.move.name, meta: `${it.sets} × ${it.lo}–${it.hi}${it.unit === 'sec' ? ' s' : ''}`, done: false }))
    : (sport?.routine ?? []).map((it) => ({ id: it.id, name: it.name, meta: `${fmt(it.done)} / ${fmt(it.target)} ${it.unit}`, done: it.target > 0 && it.done >= it.target }))
  const done = day.kind === 'done'
  return (
    <section className={`bdy-card wo-card${done ? ' wo-done' : ''}`} aria-label={day.title}>
      <div className="bdy-head">
        <h2 className="bdy-title">{day.title}</h2>
        {!done && (
          <span className="wo-meta">
            <b>~{minutes} min</b> · {doseLabel}
          </span>
        )}
      </div>
      {done ? <p className="bdy-sub">{day.line}</p> : <p className="bdy-sub wo-name">{sport?.session?.name ?? 'Your routine'}</p>}
      {items.length > 0 ? (
        <ul className="wo-list">
          {items.slice(0, 6).map((it) => (
            <li key={it.id} className={it.done ? 'done' : ''}>
              <span>{it.name}</span>
              <b>{it.meta}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="bdy-note">Add your exercises in the tracker to see them here.</p>
      )}
      {!done && sport?.harder && (
        <p className="wo-harder">
          <span className="bdy-eyebrow">Next harder move</span>
          <b>{sport.harder.to.name}</b>
          <span className="bdy-note">{sport.harder.ready ? `You are ready: you hit your ${sport.harder.from.toLowerCase()} target 3 times in a row.` : `After ${sport.harder.from.toLowerCase()}.`}</span>
        </p>
      )}
      <div className="wo-actions">
        {done ? (
          onOpen && (
            <button type="button" className="bdy-btn" onClick={onOpen}>
              Open the tracker
            </button>
          )
        ) : (
          <>
            <button type="button" className="bdy-btn primary big wo-start" onClick={onStart}>
              Start workout
            </button>
            <button type="button" className="bdy-btn quiet wo-rest-btn" onClick={onRest}>
              Rest today
            </button>
          </>
        )}
      </div>
    </section>
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
