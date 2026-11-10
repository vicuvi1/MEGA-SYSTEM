// Sport Track → Training: the default view of the section (the embedded app
// stays one tap away as "Classic tracker"). One engine with Body → Training
// (src/core/sportTrain.ts on trainWeek / trainLadders / trainLog): today's
// split session as sets × reps at an effort target, the progression path of
// a chain with what the next level needs, one honest coach line with Make it
// harder / easier / I can't train today, this week's sets, body numbers and
// today's food (read only), and the 12-week program. Start Workout opens the
// focused set-by-set flow (WorkoutFlow). Only real data: every card has an
// empty state. Points: only Finish logs the usual workout, built from the
// sets you logged ("Workout done", once a day); nothing else here pays.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BodyState } from '@shared/api'
import { applyOffer, coachLine, DOSE_LABEL, finishReport, keepOffer, programPhases, requirementsOf, shiftMove, shiftWorkout, trackerFinish, trackerLog, trackerToday, trackerUndo, weekBars, type TrackerItem, type TrackerView } from '@core/sportTrain'
import { ensureExercise, sessionItems, trainOf, type Dose, type Feel, type PlanItem } from '@core/trainLog'
import { moveName, type LadderId } from '@core/trainLadders'
import { TYPE_NAME, type SessionType } from '@core/trainWeek'
import { life } from '../bridge'
import { celebrate } from '../fx'
import { soundFanfare } from '../soundKit'
import { useToast } from '../ui'
import { Icon } from '../Icon'
import { readSport } from '../sportTrack'
import { saveTraining, useTraining } from '../body/training/trainingStore'
import { useBodyComp } from '../body/progress/BodyCompPanel'
import { MoveSheet } from '../body/training/MoveSheet'
import { useTodayFood, useTrainReady } from './useTrainHome'
import { appliedLine, keptLine, WorkoutFlow } from './WorkoutFlow'
import './training-home.css'

const ANYWAY_KEY = 'life_train_anyway'
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
const CHAINS: { id: LadderId; label: string }[] = [
  { id: 'push', label: 'Push' },
  { id: 'pull', label: 'Pull' },
  { id: 'single', label: 'Legs' },
  { id: 'core', label: 'Core' }
]
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const sign = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(d)}`

export function TrainingHome({ body, onBody, onWallet, onClassic, onMetrics }: { body: BodyState | null; onBody: (s: BodyState) => void; onWallet: () => void; onClassic: () => void; onMetrics: () => void }) {
  const toast = useToast()
  const { st, today, refresh } = useTraining()
  const { tr, thin, setDose } = useTrainReady(today)
  const food = useTodayFood()
  const comp = useBodyComp()
  const [anyway, setAnywayState] = useState<SessionType | null>(() => readAnyway(today))
  useEffect(() => setAnywayState(readAnyway(today)), [today])
  const skip = !!body?.restToday
  const dose: Dose = (tr?.mode as Dose) ?? 'full'
  const state = useMemo(() => st ?? {}, [st])
  const v = useMemo(() => trackerToday(state, today, { dose, anyway, skip }), [state, today, dose, anyway, skip])
  const week = useMemo(() => weekBars(state, today), [state, today])
  const program = useMemo(() => programPhases(state, today), [state, today])
  const readiness = tr && !thin ? tr.score : null
  const [flow, setFlow] = useState(false)
  const [custom, setCustom] = useState(false)
  const [chain, setChain] = useState<LadderId>('push')
  const [sheet, setSheet] = useState<PlanItem | null>(null)
  const session = v.type === 'rest' ? null : (v.type as SessionType)

  // ---- saving (Sport Track's state, the same store as Body → Training) ----
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

  const apply = (ladder: string, type?: SessionType): string | null => {
    const t = type ?? session
    if (!t) return null
    const box: { o: ReturnType<typeof applyOffer> } = { o: null }
    saveTraining((s) => {
      box.o = applyOffer(s, { day: today, type: t, ladder: ladder as LadderId, now: Date.now() })
    })
    refresh()
    if (!box.o) return null
    toast(`${box.o.name} is your level now. Your old sets stay in your history.`, 'good')
    return appliedLine(box.o)
  }
  const keep = (ladder: string, type?: SessionType): string | null => {
    const t = type ?? session
    if (!t) return null
    const it = sessionItems(state, trainOf(state), t, today).find((x) => x.ladder.id === ladder)
    let ok = false
    saveTraining((s) => {
      ok = keepOffer(s, { day: today, type: t, ladder: ladder as LadderId, now: Date.now() })
    })
    refresh()
    return ok && it ? keptLine(it.name) : null
  }
  const shiftAll = (delta: -1 | 1) => {
    if (!session) return
    const box: { out: ReturnType<typeof shiftWorkout> } = { out: [] }
    saveTraining((s) => {
      box.out = shiftWorkout(s, { day: today, type: session, delta, now: Date.now() })
    })
    refresh()
    if (!box.out.length) return toast(delta > 0 ? 'Every move is already at the top of its ladder.' : 'Every move is already at the easiest level.', 'info')
    toast(`${delta > 0 ? 'Harder' : 'Easier'}: ${box.out.map((x) => x.to).join(', ')}. Your history stays.`, 'good')
  }
  const shiftOne = (it: TrackerItem, delta: -1 | 1) => {
    const box: { s: ReturnType<typeof shiftMove> } = { s: null }
    saveTraining((s) => {
      box.s = shiftMove(s, { day: today, ladder: it.ladder.id, delta, now: Date.now() })
    })
    refresh()
    if (!box.s) return toast(delta > 0 ? `${it.name} is the top of this ladder.` : `${it.name} is the easiest level.`, 'info')
    toast(`${box.s.from} → ${box.s.to}. Your history stays.`, 'good')
  }
  const restToday = async (on: boolean) => {
    if (!life.body.setRest) return toast('Rest days need the newest version.', 'info')
    try {
      const next = await life.body.setRest(null, on)
      onBody(next)
      window.dispatchEvent(new CustomEvent('life-body-changed'))
      toast(on ? 'Rest today: your streak stays. Mobility is below if you feel like it.' : 'Rest day taken back.', 'good')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  const trainAnyway = (t: SessionType | null) => {
    writeAnyway(today, t)
    setAnywayState(t)
  }

  return (
    <div className="tg" data-tg="home">
      <div className="tg-grid">
        <PlanCard v={v} onStart={() => setFlow(true)} custom={custom} onCustom={() => setCustom((c) => !c)} onShift={shiftOne} onDose={(m) => void setDose(m)} auto={!!tr?.auto} onAnyway={trainAnyway} onHow={setSheet} onSkipBack={() => void restToday(false)} />
        <CoachCard v={v} readiness={readiness} thin={thin} onHarder={() => shiftAll(1)} onEasier={() => shiftAll(-1)} onRest={() => void restToday(!skip)} skip={skip} onApply={(l) => apply(l)} onKeep={(l) => keep(l)} />
        <PathCard st={state} today={today} chain={chain} onChain={setChain} onApply={apply} onKeep={keep} />
        <WeekCard week={week} weekly={v.weekly} />
        <BodyCard comp={comp} onMetrics={onMetrics} />
        <FoodCard food={food} onMetrics={onMetrics} />
        <RoadmapCard program={program} />
      </div>
      <p className="tg-foot">
        <button type="button" className="tg-link" onClick={onClassic} data-tg="classic">
          Open the Classic tracker
        </button>
        <span>Your old daily totals, badges and history are all still there.</span>
      </p>
      {flow && session && <WorkoutFlow view={v} onLog={logSet} onUndo={undoSet} onFinish={finish} onApply={(l) => apply(l)} onKeep={(l) => keep(l)} onClose={() => setFlow(false)} />}
      {sheet && <MoveSheet level={sheet.level} title={`${sheet.ladder.name} · Level ${sheet.index + 1}`} onClose={() => setSheet(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------- Today's Plan

function PlanCard({
  v,
  onStart,
  custom,
  onCustom,
  onShift,
  onDose,
  auto,
  onAnyway,
  onHow,
  onSkipBack
}: {
  v: TrackerView
  onStart: () => void
  custom: boolean
  onCustom: () => void
  onShift: (it: TrackerItem, d: -1 | 1) => void
  onDose: (m: Dose | null) => void
  auto: boolean
  onAnyway: (t: SessionType | null) => void
  onHow: (it: PlanItem) => void
  onSkipBack: () => void
}) {
  if (v.stage === 'rest')
    return (
      <section className="tg-card tg-plan" data-tg="plan" style={{ gridArea: 'plan' }}>
        <CardHead icon="calendar" title="Today's Plan" sub={v.title} />
        <p className="tg-line" data-tg="plan-line">
          {v.line}
        </p>
        <h4 className="tg-sub">8 minutes of mobility</h4>
        <ul className="tg-mob" data-tg="mobility">
          {v.mobility.map((m) => (
            <li key={m.id}>
              <span>{m.name}</span>
              <small className="num">
                {m.set} {m.unit === 'sec' ? 's' : m.unit}
              </small>
            </li>
          ))}
        </ul>
        <div className="tg-actions">
          {v.anyway && (
            <button type="button" className="tg-btn primary" onClick={() => onAnyway(v.anyway)} data-tg="anyway">
              Train anyway: {TYPE_NAME[v.anyway]}
            </button>
          )}
          {v.skipped && (
            <button type="button" className="tg-btn" onClick={onSkipBack} data-tg="skip-back">
              I can train after all
            </button>
          )}
        </div>
      </section>
    )
  const label = v.dose === 'full' ? 'Full' : v.dose === 'light' ? 'Lighter: one set less a move' : 'Short: 2 sets a move'
  return (
    <section className="tg-card tg-plan" data-tg="plan" style={{ gridArea: 'plan' }}>
      <CardHead
        icon="calendar"
        title="Today's Plan"
        sub={`≈ ${v.minutes} min · Home workout · ${label}`}
        right={v.level != null ? <span className="tg-badge" data-tg="level-badge" title="The average level of today's moves">Level {v.level}</span> : null}
      />
      <div className="tg-plan-title">
        <h3 data-tg="plan-title">{v.title}</h3>
        {v.byChoice && (
          <button type="button" className="tg-link" onClick={() => onAnyway(null)}>
            Take the rest day back
          </button>
        )}
      </div>
      <p className="tg-line">{v.line}</p>
      <ul className="tg-moves" data-tg="moves">
        {v.items.map((it) => (
          <li key={it.ladder.id} className={it.done.length >= it.sets ? 'done' : ''} data-ladder={it.ladder.id}>
            <span className={`tg-tick${it.done.length >= it.sets ? ' on' : ''}`} aria-hidden="true">
              <Icon name="check" size={13} />
            </span>
            <button type="button" className="tg-move-name" onClick={() => onHow(it)} title="How to do it">
              {it.name}
              <small>
                {it.ladder.name} · {it.levelText}
              </small>
            </button>
            <b className="tg-move-target num" data-tg="target">
              {it.target}
            </b>
            {custom && (
              <span className="tg-move-shift">
                <button type="button" className="tg-btn small" onClick={() => onShift(it, -1)} data-tg="easier" aria-label={`Make ${it.name} easier`}>
                  Easier
                </button>
                <button type="button" className="tg-btn small" onClick={() => onShift(it, 1)} data-tg="harder" aria-label={`Make ${it.name} harder`}>
                  Harder
                </button>
              </span>
            )}
            {it.offer ? (
              <span className="tg-move-note up">{it.offer.line}</span>
            ) : it.done.length ? (
              <span className="tg-move-note num">
                Today: {it.done.map((s) => s.reps).join(' · ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {custom && (
        <div className="tg-custom" data-tg="customize">
          <span className="tg-muted">How much today ({auto ? 'set by your readiness' : 'your pick'}). Same effort either way.</span>
          <div className="tg-seg" role="radiogroup" aria-label="How much today">
            {(['full', 'light', 'short'] as Dose[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={v.dose === m} className={v.dose === m ? 'on' : ''} onClick={() => onDose(m)}>
                {DOSE_LABEL[m]}
              </button>
            ))}
          </div>
          {!auto && (
            <button type="button" className="tg-link" onClick={() => onDose(null)}>
              Back to automatic
            </button>
          )}
        </div>
      )}
      <div className="tg-actions">
        {v.stage !== 'done' ? (
          <button type="button" className="tg-btn primary big tg-start" onClick={onStart} data-tg="start">
            <PlayIcon /> {v.stage === 'going' ? 'Continue workout' : 'Start Workout'}
          </button>
        ) : (
          <span className="tg-done" data-tg="done">
            Done for today · {v.setsDone} sets
          </span>
        )}
        <button type="button" className={`tg-btn big${custom ? ' on' : ''}`} onClick={onCustom} aria-expanded={custom} data-tg="customize-btn">
          <Icon name="sliders" size={15} /> Customize
        </button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- AI Coach

function CoachCard({ v, readiness, thin, onHarder, onEasier, onRest, skip, onApply, onKeep }: { v: TrackerView; readiness: number | null; thin: boolean; onHarder: () => void; onEasier: () => void; onRest: () => void; skip: boolean; onApply: (l: string) => string | null; onKeep: (l: string) => string | null }) {
  const line = coachLine(v, readiness)
  const offer = v.items.find((it) => it.offer)
  const canShift = v.type !== 'rest' && v.stage !== 'done'
  return (
    <section className="tg-card tg-coach" data-tg="coach" style={{ gridArea: 'coach' }}>
      <CardHead icon="spark" title="AI Coach" right={<span className="tg-badge soft">From your sets</span>} />
      <p className="tg-coach-line" data-tg="coach-line">
        {line}
      </p>
      {offer?.offer && (
        <div className="tg-actions tight">
          <button type="button" className="tg-btn primary" onClick={() => onApply(offer.ladder.id)} data-tg="coach-apply">
            Apply: {offer.offer.name}
          </button>
          <button type="button" className="tg-btn" onClick={() => onKeep(offer.ladder.id)} data-tg="coach-keep">
            Keep
          </button>
        </div>
      )}
      <p className="tg-muted tg-ready" data-tg="readiness">
        {readiness != null ? (
          <>
            Readiness <b className="num">{readiness}</b> · today is {DOSE_LABEL[v.dose]}
          </>
        ) : thin ? (
          'Readiness: log sleep or tap soreness on Metrics & Workouts for a real score.'
        ) : (
          `Today is ${DOSE_LABEL[v.dose]}.`
        )}
      </p>
      <div className="tg-coach-btns">
        <button type="button" className="tg-btn primary big" onClick={onHarder} disabled={!canShift} data-tg="harder-all">
          Make it harder <span aria-hidden="true">↑</span>
        </button>
        <button type="button" className="tg-btn big" onClick={onEasier} disabled={!canShift} data-tg="easier-all">
          Make it easier <span aria-hidden="true">↓</span>
        </button>
        <button type="button" className="tg-btn big" onClick={onRest} disabled={v.stage === 'going' || v.stage === 'done'} data-tg="cant-train">
          {skip ? 'I can train today after all' : "I can't train today"}
        </button>
      </div>
      <p className="tg-muted small">Harder or easier moves every move one level at once. Your sets and history stay.</p>
    </section>
  )
}

// ---------------------------------------------------------------- Progression Path

function PathCard({ st, today, chain, onChain, onApply, onKeep }: { st: any; today: string; chain: LadderId; onChain: (l: LadderId) => void; onApply: (l: string, t: SessionType) => string | null; onKeep: (l: string, t: SessionType) => string | null }) {
  const data = useMemo(() => trainOf(st), [st])
  const ladder = data.ladders.find((l) => l.id === chain) ?? data.ladders[0]
  const it = useMemo(() => sessionItems(st, data, ladder.type, today).find((x) => x.ladder.id === ladder.id) ?? null, [st, data, ladder, today])
  const reached = data.levels[ladder.id]?.reached ?? {}
  if (!it) return null
  const req = requirementsOf(it)
  const next = it.next
  return (
    <section className="tg-card tg-path" data-tg="path" style={{ gridArea: 'path' }}>
      <CardHead
        icon="chart"
        title="Progression Path"
        sub="The next move unlocks from your own sets. You choose when to move up."
        right={
          <div className="tg-seg small" role="tablist" aria-label="Chain">
            {CHAINS.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={chain === c.id} className={chain === c.id ? 'on' : ''} onClick={() => onChain(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        }
      />
      <ol className="tg-steps" data-tg="steps" style={{ ['--n' as string]: ladder.levels.length }}>
        {ladder.levels.map((lv, i) => {
          const state = i < it.index ? 'done' : i === it.index ? 'current' : 'locked'
          return (
            <li key={lv.move} className={state} data-state={state} title={moveName(lv.move)}>
              <span className="tg-step-dot" aria-hidden="true">
                {state === 'done' ? <Icon name="check" size={12} /> : null}
              </span>
              <b>Level {i + 1}</b>
              <small>{moveName(lv.move)}</small>
              {state === 'done' && reached[String(i)] && <small className="tg-step-day">{reached[String(i)].slice(5)}</small>}
            </li>
          )
        })}
      </ol>
      <div className="tg-next-box" data-tg="next-level">
        {next ? (
          <>
            <p>
              <b>Next: {moveName(next.move)}</b> <span className="tg-muted">· you are on {it.name}</span>
            </p>
            <ul className="tg-req" data-tg="requirements">
              {req.map((r) => (
                <li key={r.id} className={r.done ? 'ok' : ''} data-req={r.id} data-done={r.done ? '1' : '0'}>
                  <span className={`tg-tick${r.done ? ' on' : ''}`} aria-hidden="true">
                    <Icon name="check" size={12} />
                  </span>
                  <span>{r.label}</span>
                  <small className="num">{r.detail}</small>
                </li>
              ))}
            </ul>
            {it.offer && (
              <div className="tg-actions tight">
                <button type="button" className="tg-btn primary" onClick={() => onApply(ladder.id, ladder.type)} data-tg="path-apply">
                  Apply: {it.offer.name}
                </button>
                <button type="button" className="tg-btn" onClick={() => onKeep(ladder.id, ladder.type)}>
                  Keep {it.name}
                </button>
              </div>
            )}
          </>
        ) : (
          <p>
            <b>Top of this chain.</b> <span className="tg-muted">Slow the tempo (3 s down, 1 s pause) to keep growing.</span>
          </p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- Weekly progress

function WeekCard({ week, weekly }: { week: ReturnType<typeof weekBars>; weekly: TrackerView['weekly'] }) {
  const empty = week.done === 0
  return (
    <section className="tg-card tg-week" data-tg="week" style={{ gridArea: 'week' }}>
      <CardHead icon="bolt" title="Weekly Progress" right={week.pct != null ? <span className="tg-badge" data-tg="week-pct">{Math.round(week.pct * 100)}%</span> : null} />
      <div className="tg-bars" role="img" aria-label={`This week: ${week.done} of ${week.planned} planned sets`}>
        {week.days.map((d) => (
          <div key={d.day} className={`tg-bar${d.today ? ' today' : ''}${d.type === 'rest' ? ' rest' : ''}`} title={`${d.short}: ${d.type === 'rest' ? 'rest' : `${d.done} of ${d.planned} sets`}`}>
            <span className="tg-bar-track">
              <span className="tg-bar-fill" style={{ transform: `scaleY(${d.pct})` }} />
            </span>
            <small>{d.short}</small>
          </div>
        ))}
      </div>
      <p className="tg-muted" data-tg="week-line">
        {empty ? 'No sets logged this week yet. Your first set fills today’s bar.' : `${week.done} of ${week.planned} planned sets this week.`}
      </p>
      <ul className="tg-muscles">
        {(['push', 'pull', 'legs', 'core'] as const).map((m) => (
          <li key={m}>
            <span>{m[0].toUpperCase() + m.slice(1)}</span>
            <span className="tg-mbar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (100 * week.hard[m]) / 20)}%` }} />
              <i style={{ left: '50%' }} />
            </span>
            <small className="num">
              {week.hard[m]} / {weekly[m]} sets
            </small>
          </li>
        ))}
      </ul>
      <p className="tg-muted small">Hard sets per muscle (not tapped Easy). 10–20 a week grows muscle.</p>
    </section>
  )
}

// ---------------------------------------------------------------- Body & Metrics

function BodyCard({ comp, onMetrics }: { comp: ReturnType<typeof useBodyComp>; onMetrics: () => void }) {
  const l = comp?.latest
  const delta = comp?.head?.delta ?? null
  return (
    <section className="tg-card tg-body" data-tg="body" style={{ gridArea: 'body' }}>
      <CardHead icon="chart" title="Body & Metrics" right={l ? <small className="tg-muted">Last: {l.day.slice(5)}</small> : null} />
      {!l ? (
        <div className="tg-empty" data-tg="body-empty">
          <p>No weigh-ins yet.</p>
          <button type="button" className="tg-btn small" onClick={onMetrics}>
            Log weight on Metrics & Workouts
          </button>
        </div>
      ) : (
        <div className="tg-stats">
          <Stat label="Weight" value={`${l.weight_kg.toFixed(1)} kg`} delta={comp?.fourWeeks ? `${sign(comp.fourWeeks.kg)} kg in ${comp.fourWeeks.weeks} wk` : delta != null ? `${sign(delta)} kg vs last week` : null} />
          <Stat label="Body fat" value={l.body_fat_pct != null ? `${l.body_fat_pct.toFixed(1)}%` : '—'} delta={null} />
          <Stat label="Muscle" value={l.muscle_kg != null ? `${l.muscle_kg.toFixed(1)} kg` : '—'} delta={null} />
        </div>
      )}
    </section>
  )
}
function Stat({ label, value, delta }: { label: string; value: string; delta: string | null }) {
  return (
    <div className="tg-stat">
      <small>{label}</small>
      <b className="num">{value}</b>
      {delta && (
<span className="tg-delta num">{delta}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- Today's Nutrition

function FoodCard({ food, onMetrics }: { food: ReturnType<typeof useTodayFood>; onMetrics: () => void }) {
  if (!food)
    return (
      <section className="tg-card tg-food" data-tg="food" style={{ gridArea: 'food' }}>
        <CardHead icon="list" title="Today's Nutrition" />
        <div className="tg-empty">
          <p>The food counter is not available here.</p>
        </div>
      </section>
    )
  const k = food.progress.kcal
  const r = 46
  const c = 2 * Math.PI * r
  const bar = (label: string, eaten: number, goal: number, cls: string) => (
    <li className={cls}>
      <span>{label}</span>
      <span className="tg-fbar" aria-hidden="true">
        <span style={{ width: `${goal ? Math.min(100, (100 * eaten) / goal) : 0}%` }} />
      </span>
      <small className="num">
        {fmt(eaten)} / {fmt(goal)} g
      </small>
    </li>
  )
  return (
    <section className="tg-card tg-food" data-tg="food" style={{ gridArea: 'food' }}>
      <CardHead icon="list" title="Today's Nutrition" right={<small className="tg-muted">{food.meals ? `${food.meals} ${food.meals === 1 ? 'meal' : 'meals'}` : 'Nothing logged yet'}</small>} />
      <div className="tg-food-row">
        <span className="tg-kcal" role="img" aria-label={`${k.eaten} of ${k.goal} kcal`}>
          <svg viewBox="0 0 108 108" width="108" height="108" aria-hidden="true">
            <circle cx="54" cy="54" r={r} className="tg-ring-bg" />
            <circle cx="54" cy="54" r={r} className="tg-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - k.frac)} transform="rotate(-90 54 54)" />
          </svg>
          <span>
            <b className="num" data-tg="kcal">
              {fmt(k.eaten)}
            </b>
            <small className="num">/ {fmt(k.goal)} kcal</small>
          </span>
        </span>
        <ul className="tg-fbars">
          {bar('Protein', food.progress.protein.eaten, food.progress.protein.goal, 'p')}
          {bar('Carbs', food.carbs.eaten, food.carbs.goal, 'c')}
          {bar('Fat', food.fat.eaten, food.fat.goal, 'f')}
        </ul>
      </div>
      {!food.meals && (
        <button type="button" className="tg-link" onClick={onMetrics}>
          Log food on Metrics & Workouts
        </button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- Program Roadmap

function RoadmapCard({ program }: { program: ReturnType<typeof programPhases> }) {
  return (
    <section className="tg-card tg-road" data-tg="roadmap" style={{ gridArea: 'road' }}>
      <CardHead
        icon="trophy"
        title="Program Roadmap"
        sub={program.week ? `12-week home program · week ${program.week}${program.levelsUp ? ` · ${program.levelsUp} ${program.levelsUp === 1 ? 'level' : 'levels'} up since you started` : ''}` : 'The 12-week home program starts with your first workout.'}
      />
      <ol className="tg-phases">
        {program.phases.map((p, i) => (
          <li key={p.id} className={p.state} data-state={p.state}>
            <b>
              {p.state === 'done' && <Icon name="check" size={13} />} {p.name}
            </b>
            <small>
              Weeks {p.weeks[0]}–{p.weeks[1]}
              {p.state === 'current' ? ' · now' : p.state === 'done' ? ' · done' : ''}
            </small>
            <span>{p.what}</span>
            {i < program.phases.length - 1 && <i className="tg-arrow" aria-hidden="true" />}
          </li>
        ))}
      </ol>
    </section>
  )
}

// ---------------------------------------------------------------- bits

function CardHead({ icon, title, sub, right }: { icon: Parameters<typeof Icon>[0]['name']; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header className="tg-head">
      <span className="tg-head-icon" aria-hidden="true">
        <Icon name={icon} size={17} />
      </span>
      <div className="tg-head-text">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {right && <div className="tg-head-right">{right}</div>}
    </header>
  )
}
const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 1.8v10.4L12 7z" fill="currentColor" />
  </svg>
)
