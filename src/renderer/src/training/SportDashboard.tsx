// Sport Track → Dashboard: one screen that answers "what do I do today and am I
// growing?". A greeting with 4 numbers (streak, workouts this week, the week's
// planned sets done, weight over 4 weeks) and the ONE level (the Growth level,
// the same as the header chip); Today's Workout with pictures and one big
// Start; the main chain's Progression Path (5 steps at most) and what the next
// step needs; the Coach (Make it harder / easier / I can't train today); the
// week's bars; small Body and Food tiles that open Body & Food; the 12-week
// Program Roadmap. Every number is real data; anything not logged shows one
// friendly line with a button. Nothing here pays points.
import { useMemo } from 'react'
import { coachLine, DOSE_LABEL, programPhases, requirementsOf, stepWindow, weekBars } from '@core/sportTrain'
import { doneSessions, sessionItems, trainOf } from '@core/trainLog'
import { moveName, type LadderId } from '@core/trainLadders'
import { TYPE_NAME } from '@core/trainWeek'
import { sessionsPerWeek, trainStreak } from '@core/trainStreak'
import { Icon } from '../Icon'
import { useBodyComp } from '../body/progress/BodyCompPanel'
import { useGrowth } from '../body/progress/useGrowth'
import { MovePic } from './MovePic'
import { useTodayFood } from './useTrainHome'
import type { SportTrain } from './useSportTrain'
import { CardHead, PlayIcon, Ring, sign } from './sportBits'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const greeting = (h: number) => (h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening')

export function SportDashboard({ t, onStart, onSection, onBodyFood }: { t: SportTrain; onStart: () => void; onSection: (s: 'workout' | 'exercises' | 'progress') => void; onBodyFood: (tab: 'today' | 'food' | 'progress' | 'growth') => void }) {
  const { v, st, today } = t
  const data = useMemo(() => trainOf(st), [st])
  const done = useMemo(() => doneSessions(data.log), [data])
  const streak = useMemo(() => trainStreak(data.week, done, today), [data, done, today])
  const thisWeek = useMemo(() => sessionsPerWeek(data.week, done, today, 1)[0] ?? { done: 0, planned: 0 }, [data, done, today])
  const week = useMemo(() => weekBars(st, today), [st, today])
  const program = useMemo(() => programPhases(st, today), [st, today])
  const comp = useBodyComp()
  const food = useTodayFood()
  const growth = useGrowth()
  const lvl = growth?.level ?? null
  const four = comp?.fourWeeks ?? null

  return (
    <div className="sp-dash" data-tg="home">
      <section className="sp-hero" data-sp="hero">
        <Mountains />
        <div className="sp-hero-main">
          <h2 className="sp-hello">{greeting(new Date().getHours())}</h2>
          <p className="sp-hello-sub">{v.stage === 'rest' ? 'Rest day: muscles grow while you rest.' : v.stage === 'done' ? 'Done for today. Eat well and sleep: that is when muscle grows.' : 'Small steps today, big results later. One rep more than last time.'}</p>
          <div className="sp-kpis">
            <Kpi icon="bolt" value={streak.sessions ? `${streak.sessions}` : '0'} unit={streak.sessions === 1 ? 'session' : 'sessions'} label="Streak, in a row" data="streak" />
            <Kpi icon="calendar" value={`${thisWeek.done} / ${thisWeek.planned}`} label="Workouts this week" data="workouts" />
            <Kpi icon="chart" value={week.pct != null ? `${Math.round(week.pct * 100)}%` : '—'} label="Weekly goal (sets)" data="goal" />
            <Kpi icon="spark" value={four ? `${sign(four.kg)} kg` : '—'} label={four ? `Weight, last ${four.weeks} weeks` : 'Weight: no weigh-ins yet'} data="weight" />
          </div>
        </div>
        <button type="button" className="sp-level" onClick={() => onBodyFood('growth')} data-sp="level" title="Your one level: it grows from real progress you log (workouts, steps up a chain, weigh-ins, food). Open Growth">
          <Ring value={lvl?.progress ?? 0} size={104} stroke={9}>
            <small>Level</small>
            <b className="num">{lvl ? lvl.index + 1 : '—'}</b>
          </Ring>
          <span className="sp-level-text">
            <b>{lvl?.name ?? 'Your level'}</b>
            <span className="sp-level-bar" aria-hidden="true">
              <i style={{ transform: `scaleX(${lvl?.progress ?? 0})` }} />
            </span>
            <small>{lvl ? (lvl.next ? `${fmt(lvl.toNext)} XP to ${lvl.next.name}` : 'The top level') : 'Loading…'}</small>
          </span>
        </button>
      </section>

      <div className="sp-dash-grid">
        <TodayCard t={t} onStart={onStart} onCustomize={() => onSection('workout')} />
        <PathCard t={t} onAll={() => onSection('exercises')} />
        <CoachCard t={t} />
        <WeekCard week={week} />
        <BodyTile comp={comp} onOpen={() => onBodyFood('progress')} />
        <FoodTile food={food} onOpen={() => onBodyFood('food')} />
        <RoadmapCard program={program} />
      </div>
    </div>
  )
}

function Kpi({ icon, value, unit, label, data }: { icon: Parameters<typeof Icon>[0]['name']; value: string; unit?: string; label: string; data: string }) {
  return (
    <div className="sp-kpi" data-kpi={data}>
      <span className="sp-kpi-icon" aria-hidden="true">
        <Icon name={icon} size={20} />
      </span>
      <span className="sp-kpi-text">
        <b className="num">
          {value}
          {unit && <small> {unit}</small>}
        </b>
        <span>{label}</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- Today's Workout

function TodayCard({ t, onStart, onCustomize }: { t: SportTrain; onStart: () => void; onCustomize: () => void }) {
  const { v } = t
  if (v.stage === 'rest')
    return (
      <section className="sp-card sp-today rest" data-tg="plan">
        <CardHead icon="calendar" title="Today's Workout" sub={v.skipped ? 'You said you can’t train today' : 'Rest day · 8 minutes of mobility'} />
        <div className="sp-today-body">
          <MovePic move={v.mobility[0]?.id ?? 'cat_cow'} size="xl" className="sp-today-pic" />
          <div className="sp-today-main">
            <h3 className="sp-today-title" data-tg="plan-title">
              {v.title}
            </h3>
            <p className="sp-line" data-tg="plan-line">
              {v.line}
            </p>
            <ul className="sp-moves" data-tg="mobility">
              {v.mobility.map((m) => (
                <li key={m.id}>
                  <span className="sp-move-name">{m.name}</span>
                  <b className="num">
                    {m.set} {m.unit === 'sec' ? 's' : m.unit}
                  </b>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="sp-actions">
          {v.anyway && (
            <button type="button" className="sp-btn primary big grow" onClick={() => t.trainAnyway(v.anyway)} data-tg="anyway">
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
    )
  const first = v.items.find((it) => it.done.length < it.sets) ?? v.items[0]
  return (
    <section className="sp-card sp-today" data-tg="plan">
      <CardHead icon="calendar" title="Today's Workout" sub={`≈ ${v.minutes} min · Home workout · ${DOSE_LABEL[v.dose]}`} />
      <div className="sp-today-body">
        {first && <MovePic move={first.level.move} size="xl" className="sp-today-pic" />}
        <div className="sp-today-main">
          <div className="sp-today-row">
            <h3 className="sp-today-title" data-tg="plan-title">
              {v.title}
            </h3>
            {v.byChoice && (
              <button type="button" className="sp-link" onClick={() => t.trainAnyway(null)}>
                Take the rest day back
              </button>
            )}
          </div>
          <ul className="sp-moves" data-tg="moves">
            {v.items.map((it) => {
              const full = it.done.length >= it.sets
              return (
                <li key={it.ladder.id} className={full ? 'done' : ''} data-ladder={it.ladder.id}>
                  <span className={`sp-ok${full ? ' on' : ''}`} aria-hidden="true">
                    <Icon name="check" size={13} />
                  </span>
                  <span className="sp-move-name">
                    {it.name}
                    <small>
                      {it.ladder.name.replace(/ \(.*\)$/, '')} · {it.levelText}
                      {it.done.length ? ` · ${it.done.length} of ${it.sets} sets done` : ''}
                    </small>
                  </span>
                  <b className="num" data-tg="target">
                    {it.target}
                  </b>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
      <div className="sp-actions">
        {v.stage !== 'done' ? (
          <button type="button" className="sp-btn primary big grow" onClick={onStart} data-tg="start">
            {v.stage === 'going' ? 'Continue workout' : 'Start Workout'} <PlayIcon />
          </button>
        ) : (
          <span className="sp-done grow" data-tg="done">
            <Icon name="check" size={16} /> Done for today · {v.setsDone} sets
          </span>
        )}
        <button type="button" className="sp-btn big" onClick={onCustomize} data-tg="customize-btn">
          <Icon name="sliders" size={16} /> Customize
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Progression Path (main chain)

function PathCard({ t, onAll }: { t: SportTrain; onAll: () => void }) {
  const { st, today, v } = t
  const data = useMemo(() => trainOf(st), [st])
  // The main chain: today's first move's chain (Push on a rest day).
  const chain: LadderId = (v.items[0]?.ladder.id as LadderId) ?? 'push'
  const ladder = data.ladders.find((l) => l.id === chain) ?? data.ladders[0]
  const it = useMemo(() => (ladder ? sessionItems(st, data, ladder.type, today).find((x) => x.ladder.id === ladder.id) ?? null : null), [st, data, ladder, today])
  if (!ladder || !it) return null
  const [from, to] = stepWindow(ladder.levels.length, it.index, 5)
  const req = requirementsOf(it)
  const next = it.next
  const name = ladder.name.replace(/ \(.*\)$/, '')
  return (
    <section className="sp-card sp-path" data-tg="path">
      <CardHead
        icon="chart"
        title="Progression Path"
        sub={`${name} chain · step ${it.index + 1} of ${ladder.levels.length}`}
        right={
          <button type="button" className="sp-link" onClick={onAll} data-sp="all-chains">
            All chains
          </button>
        }
      />
      <ol className="sp-steps" data-tg="steps" style={{ ['--n' as string]: to - from }}>
        {ladder.levels.slice(from, to).map((lv, k) => {
          const i = from + k
          const state = i < it.index ? 'done' : i === it.index ? 'current' : 'locked'
          return (
            <li key={lv.move} className={state} data-state={state}>
              <span className="sp-step-dot" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={14} /> : state === 'locked' ? <Icon name="lock" size={12} /> : null}
              </span>
              <b>Step {i + 1}</b>
              <small>{moveName(lv.move)}</small>
            </li>
          )
        })}
      </ol>
      <div className="sp-next" data-tg="next-level">
        {next ? (
          <>
            <p className="sp-next-title">
              <Icon name="bolt" size={16} /> Next step: <b>{moveName(next.move)}</b>
              <span> · after 2 good sessions in a row</span>
            </p>
            <ul className="sp-req" data-tg="requirements">
              {req.map((r) => (
                <li key={r.id} className={r.done ? 'ok' : ''} data-req={r.id} data-done={r.done ? '1' : '0'}>
                  <span className={`sp-ok small${r.done ? ' on' : ''}`} aria-hidden="true">
                    <Icon name="check" size={11} />
                  </span>
                  <span>{r.label}</span>
                  <small className="num">{r.detail}</small>
                </li>
              ))}
            </ul>
            {it.offer && (
              <div className="sp-actions tight">
                <button type="button" className="sp-btn primary" onClick={() => t.apply(ladder.id, ladder.type)} data-tg="path-apply">
                  Apply: {it.offer.name}
                </button>
                <button type="button" className="sp-btn" onClick={() => t.keep(ladder.id, ladder.type)}>
                  Keep {it.name} for now
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="sp-next-title">
            <b>Top of this chain.</b> <span>Slow the tempo (3 s down, 1 s pause) to keep growing.</span>
          </p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Coach

function CoachCard({ t }: { t: SportTrain }) {
  const { v, readiness, thin, skip } = t
  const line = coachLine(v, readiness)
  const offer = v.items.find((it) => it.offer)
  const canShift = v.type !== 'rest' && v.stage !== 'done'
  return (
    <section className="sp-card sp-coach" data-tg="coach">
      <CardHead icon="spark" title="Coach" right={<span className="sp-chip">From your sets</span>} />
      <div className="sp-coach-say">
        <p data-tg="coach-line">{line}</p>
        <small data-tg="readiness">
          {readiness != null ? (
            <>
              Readiness <b className="num">{readiness}</b> · today is {DOSE_LABEL[v.dose]}
            </>
          ) : thin ? (
            'Readiness: log sleep or tap soreness (Body & Food → Today) for a real score.'
          ) : (
            `Today is ${DOSE_LABEL[v.dose]}.`
          )}
        </small>
      </div>
      {offer?.offer && (
        <div className="sp-actions tight">
          <button type="button" className="sp-btn primary" onClick={() => t.apply(offer.ladder.id)} data-tg="coach-apply">
            Apply: {offer.offer.name}
          </button>
          <button type="button" className="sp-btn" onClick={() => t.keep(offer.ladder.id)} data-tg="coach-keep">
            Keep
          </button>
        </div>
      )}
      <div className="sp-coach-btns">
        <button type="button" className="sp-btn primary big" onClick={() => t.shiftAll(1)} disabled={!canShift} data-tg="harder-all">
          Make it harder <span aria-hidden="true">↑</span>
        </button>
        <button type="button" className="sp-btn big" onClick={() => t.shiftAll(-1)} disabled={!canShift} data-tg="easier-all">
          Make it easier <span aria-hidden="true">↓</span>
        </button>
        <button type="button" className="sp-btn big" onClick={() => void t.restToday(!skip)} disabled={v.stage === 'going' || v.stage === 'done'} data-tg="cant-train">
          {skip ? 'I can train today after all' : "I can't train today"}
        </button>
      </div>
      <p className="sp-small">Harder or easier moves every move of today one step. Your sets and history stay.</p>
    </section>
  )
}

// ---------------------------------------------------------------- Weekly bars

function WeekCard({ week }: { week: ReturnType<typeof weekBars> }) {
  return (
    <section className="sp-card sp-week" data-tg="week">
      <CardHead icon="chart" title="This Week" right={week.pct != null ? <span className="sp-chip strong" data-tg="week-pct">{Math.round(week.pct * 100)}%</span> : null} />
      <div className="sp-bars" role="img" aria-label={`This week: ${week.done} of ${week.planned} planned sets`}>
        {week.days.map((d) => (
          <div key={d.day} className={`sp-bar${d.today ? ' today' : ''}${d.type === 'rest' ? ' rest' : ''}`} title={`${d.short}: ${d.type === 'rest' ? 'rest' : `${d.done} of ${d.planned} sets`}`}>
            <span className="sp-bar-track">
              <span className="sp-bar-fill" style={{ transform: `scaleY(${d.pct})` }} />
            </span>
            <small>{d.short}</small>
          </div>
        ))}
      </div>
      <p className="sp-small" data-tg="week-line">
        {week.done === 0 ? 'No sets this week yet. Your first set fills today’s bar.' : `${week.done} of ${week.planned} planned sets done.`}
      </p>
    </section>
  )
}

// ---------------------------------------------------------------- Body and food tiles

function BodyTile({ comp, onOpen }: { comp: ReturnType<typeof useBodyComp>; onOpen: () => void }) {
  const l = comp?.latest
  const four = comp?.fourWeeks
  return (
    <section className="sp-card sp-tile" data-tg="body">
      <CardHead icon="face" title="Body" right={l ? <small className="sp-muted">Last: {new Date(`${l.day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small> : null} />
      {!l ? (
        <p className="sp-empty" data-tg="body-empty">
          No weigh-ins yet.
          <button type="button" className="sp-btn small" onClick={onOpen}>
            Log weight
          </button>
        </p>
      ) : (
        <div className="sp-stats">
          <Stat label="Weight" value={`${l.weight_kg.toFixed(1)}`} unit="kg" delta={four ? `${sign(four.kg)} kg` : null} />
          <Stat label="Body fat" value={l.body_fat_pct != null ? l.body_fat_pct.toFixed(1) : '—'} unit={l.body_fat_pct != null ? '%' : ''} delta={null} />
          <Stat label="Muscle" value={l.muscle_kg != null ? l.muscle_kg.toFixed(1) : '—'} unit={l.muscle_kg != null ? 'kg' : ''} delta={null} />
        </div>
      )}
      {l && (
        <button type="button" className="sp-link" onClick={onOpen}>
          Open Body & Food
        </button>
      )}
    </section>
  )
}
function Stat({ label, value, unit, delta }: { label: string; value: string; unit: string; delta: string | null }) {
  return (
    <div className="sp-stat">
      <small>{label}</small>
      <b className="num">
        {value}
        {unit && <span> {unit}</span>}
      </b>
      {delta && <span className="sp-delta num">{delta}</span>}
    </div>
  )
}

function FoodTile({ food, onOpen }: { food: ReturnType<typeof useTodayFood>; onOpen: () => void }) {
  if (!food)
    return (
      <section className="sp-card sp-tile" data-tg="food">
        <CardHead icon="list" title="Today's Food" />
        <p className="sp-empty">The food counter is not available here.</p>
      </section>
    )
  const k = food.progress.kcal
  const bar = (label: string, eaten: number, goal: number, cls: string) => (
    <li className={cls}>
      <span>{label}</span>
      <span className="sp-fbar" aria-hidden="true">
        <span style={{ width: `${goal ? Math.min(100, (100 * eaten) / goal) : 0}%` }} />
      </span>
      <small className="num">
        {fmt(eaten)}/{fmt(goal)} g
      </small>
    </li>
  )
  return (
    <section className="sp-card sp-tile sp-food" data-tg="food">
      <CardHead icon="list" title="Today's Food" right={<small className="sp-muted">{food.meals ? `${food.meals} ${food.meals === 1 ? 'meal' : 'meals'}` : 'Nothing logged yet'}</small>} />
      <div className="sp-food-row">
        <Ring value={k.frac} size={96} stroke={8}>
          <b className="num" data-tg="kcal">
            {fmt(k.eaten)}
          </b>
          <small className="num">/ {fmt(k.goal)} kcal</small>
        </Ring>
        <ul className="sp-fbars">
          {bar('Protein', food.progress.protein.eaten, food.progress.protein.goal, 'p')}
          {bar('Carbs', food.carbs.eaten, food.carbs.goal, 'c')}
          {bar('Fat', food.fat.eaten, food.fat.goal, 'f')}
        </ul>
      </div>
      <button type="button" className={food.meals ? 'sp-link' : 'sp-btn small'} onClick={onOpen} data-sp="log-food">
        {food.meals ? 'Open Body & Food' : 'Log food'}
      </button>
    </section>
  )
}

// ---------------------------------------------------------------- Program Roadmap

const PHASE_ICON: Record<string, Parameters<typeof Icon>[0]['name']> = { foundation: 'home', build: 'chart', strength: 'bolt', advanced: 'trophy', athlete: 'spark' }

function RoadmapCard({ program }: { program: ReturnType<typeof programPhases> }) {
  return (
    <section className="sp-card sp-road" data-tg="roadmap">
      <CardHead
        icon="trophy"
        title="Program Roadmap"
        sub={program.week ? `12-week home program · week ${program.week}${program.levelsUp ? ` · ${program.levelsUp} ${program.levelsUp === 1 ? 'step' : 'steps'} up since you started` : ''}` : 'The 12-week home program starts with your first workout.'}
      />
      <ol className="sp-phases">
        {program.phases.map((p) => (
          <li key={p.id} className={p.state} data-state={p.state} title={p.what}>
            <span className="sp-phase-icon" aria-hidden="true">
              <Icon name={p.state === 'next' ? 'lock' : p.state === 'done' ? 'check' : PHASE_ICON[p.id] ?? 'bolt'} size={16} />
            </span>
            <span className="sp-phase-text">
              <b>{p.name}</b>
              <small>
                Weeks {p.weeks[0]}–{p.weeks[1]}
                {p.state === 'current' ? ' · now' : p.state === 'done' ? ' · done' : ''}
              </small>
              <span>{p.what}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** A quiet mountain line behind the greeting (drawn, no photo). */
function Mountains() {
  return (
    <svg className="sp-hero-art" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path d="M0 220 L0 150 L120 90 L210 135 L330 50 L450 130 L560 80 L690 150 L800 70 L930 140 L1040 95 L1200 150 L1200 220 Z" className="far" />
      <path d="M0 220 L0 185 L160 130 L300 175 L420 120 L560 180 L700 125 L860 185 L980 140 L1200 190 L1200 220 Z" className="near" />
    </svg>
  )
}
