// Body → Training, top card: what to train today (from your weekly split),
// each move on your current level with sets × range and "last time", the
// warm-up, a 30-minute session clock with an on-pace bar, and fast logging
// for a phone mid-workout (big − / +, a number pad, effort taps, "same as
// last time", a rest timer). Every set is saved at once into Sport Track's
// set log; "Finish workout" logs the workout like any other (the usual
// "Workout done" points, once a day). No new points anywhere here.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BodyState } from '@shared/api'
import { DEFAULT_DAYS, SESSION_RULES, SHORT_DAYS, TYPE_NAME, WARMUP, WEEKDAYS, dowOf, todayPlan, validateWeek, type DayType, type SessionType } from '@core/trainWeek'
import { doneSessions, ensureExercise, exIdsFor, keepLevel, logSet, sameAsLast, saveSession, sessionFromSets, sessionItems, sessionMinutes, trainOf, unlogSet, workoutOf, type Feel, type PlanItem, type TrainSession } from '@core/trainLog'
import { rangeText } from '@core/trainLadders'
import { LIGHTER, lighterOn, lighterReps, setLighter } from '@core/trainWarnings'
import { LIGHT_DAY_KEY } from './TrainWarnings'
import { life } from '../../bridge'
import { RecoveryPanel } from './RecoveryPanel'
import { celebrate } from '../../fx'
import { soundFanfare } from '../../soundKit'
import { useToast } from '../../ui'
import { MoveSheet } from './MoveSheet'
import { RestTimer } from './RestTimer'
import { saveTraining } from './trainingStore'
import { readSport } from '../../sportTrack'

const DRAFT_KEY = 'life_train_session'

/** This device's workout in progress (a convenience: every logged set is already saved). */
interface Draft {
  id: string
  date: string
  type: SessionType
  startedAt: number | null
  reps: Record<string, number[]>
  feel: Record<string, (Feel | null)[]>
  kg: Record<string, number>
  /** Saved set ids per move, null while not logged. */
  logged: Record<string, (string | null)[]>
  rest: 60 | 90
}
const readDraft = (today: string): Draft | null => {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
    return d && d.date === today && typeof d.id === 'string' ? d : null
  } catch {
    return null
  }
}
const writeDraft = (d: Draft | null) => {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* private window: the workout still saves every set */
  }
}
const FEELS: { id: Feel; label: string }[] = [
  { id: 'hard', label: 'Hard' },
  { id: 'ok', label: 'OK' },
  { id: 'easy', label: 'Easy' }
]
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function TodaySession({ st, today, refresh, onOpenSportApp, onLogged }: { st: any; today: string; refresh: () => void; onOpenSportApp?: () => void; onLogged: (s: BodyState) => void }) {
  const toast = useToast()
  const data = useMemo(() => trainOf(st), [st])
  const done = useMemo(() => doneSessions(data.log), [data])
  const plan = useMemo(() => todayPlan(data.week, done, today), [data, done, today])
  const lighter = lighterOn(st, today)
  /** "Same as last time", at 70% during a lighter week. */
  const fillOf = (it: PlanItem) => sameAsLast(it.last, it.sets, it.level).map((f) => (lighter ? { ...f, reps: lighterReps(f.reps) } : f))
  // A lighter week sets today's dose to Lighter 70% (the usual dose setting, so Sport Track follows it),
  // once a day and only when you haven't picked a dose for today yourself.
  useEffect(() => {
    if (!lighter) return
    const key = LIGHT_DAY_KEY
    try {
      if (localStorage.getItem(key) === today) return
      localStorage.setItem(key, today)
    } catch {
      return
    }
    const bp = life.coach?.bodyPlus
    if (!bp) return
    void bp
      .ready(null)
      .then((r) => (r.auto ? bp.setDose('light', null).then(() => window.dispatchEvent(new CustomEvent('life-body-changed'))) : undefined))
      .catch(() => {})
  }, [lighter, today])
  const [draft, setDraftState] = useState<Draft | null>(() => readDraft(today))
  const setDraft = useCallback((d: Draft | null) => {
    writeDraft(d)
    setDraftState(d)
  }, [])
  useEffect(() => setDraftState(readDraft(today)), [today])

  const type: DayType = draft?.type ?? (plan.why === 'done' ? 'rest' : plan.type)
  const items = useMemo(() => (type === 'rest' ? [] : sessionItems(st, data, type, today)), [st, data, type, today])
  const [rest, setRest] = useState<{ endsAt: number; total: number } | null>(null)
  const [sheet, setSheet] = useState<PlanItem | null>(null)
  const [weekMsg, setWeekMsg] = useState<string | null>(null)
  const [editWeek, setEditWeek] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!draft?.startedAt) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [draft?.startedAt])

  /** A fresh draft for a session type: every set filled with your last session's reps. */
  const newDraft = (t: SessionType): Draft => {
    const list = sessionItems(st, data, t, today)
    const d: Draft = { id: `t${Date.now().toString(36)}`, date: today, type: t, startedAt: null, reps: {}, feel: {}, kg: {}, logged: {}, rest: 90 }
    for (const it of list) {
      const fill = fillOf(it)
      d.reps[it.ladder.id] = fill.map((f) => f.reps)
      d.feel[it.ladder.id] = fill.map(() => null)
      d.kg[it.ladder.id] = fill[0]?.kg ?? 0
      d.logged[it.ladder.id] = fill.map(() => null)
    }
    return d
  }
  const ensure = (): Draft => draft ?? newDraft(type as SessionType)

  const start = (t?: SessionType) => {
    const d = draft && (!t || draft.type === t) ? draft : newDraft(t ?? (type as SessionType))
    setDraft({ ...d, startedAt: d.startedAt ?? Date.now() })
  }

  const edit = (ladder: string, i: number, patch: { reps?: number; feel?: Feel | null }) => {
    const d = ensure()
    const reps = [...(d.reps[ladder] ?? [])]
    const feel = [...(d.feel[ladder] ?? [])]
    if (patch.reps !== undefined) reps[i] = Math.max(0, Math.min(500, Math.round(patch.reps)))
    if (patch.feel !== undefined) feel[i] = patch.feel
    setDraft({ ...d, reps: { ...d.reps, [ladder]: reps }, feel: { ...d.feel, [ladder]: feel } })
  }

  const fillSame = (it: PlanItem) => {
    const d = ensure()
    const fill = fillOf(it)
    const logged = d.logged[it.ladder.id] ?? []
    const reps = fill.map((f, i) => (logged[i] ? d.reps[it.ladder.id]?.[i] ?? f.reps : f.reps))
    setDraft({ ...d, reps: { ...d.reps, [it.ladder.id]: reps }, kg: { ...d.kg, [it.ladder.id]: fill[0]?.kg ?? d.kg[it.ladder.id] ?? 0 } })
  }

  const recordOf = (d: Draft, s: any, done = false) =>
    sessionFromSets(s, { id: d.id, date: d.date, type: d.type, items: items.map((it) => ({ ladder: it.ladder.id, move: it.level.move, exId: exIdOf(s, it) })), startedAt: d.startedAt ?? Date.now(), now: Date.now(), done })

  /** Logs set i of a move (or takes it back when it's already logged). */
  const toggleSet = (it: PlanItem, i: number) => {
    const d0 = ensure()
    const d: Draft = { ...d0, startedAt: d0.startedAt ?? Date.now() }
    const ladder = it.ladder.id
    const logged = [...(d.logged[ladder] ?? Array(it.sets).fill(null))]
    if (logged[i]) {
      const id = logged[i]!
      saveTraining((s) => {
        unlogSet(s, today, exIdOf(s, it), id)
        saveSession(s, recordOf(d, s))
      })
      logged[i] = null
      setDraft({ ...d, logged: { ...d.logged, [ladder]: logged } })
      setRest(null)
      refresh()
      return
    }
    const reps = d.reps[ladder]?.[i] ?? it.level.lo
    if (reps <= 0) return toast('Set the reps first.', 'info')
    // The exercise first (its own change), so the reps after it are logged as reps.
    saveTraining((s) => void ensureExercise(s, it.level.move, it.level, it.sets))
    let setId = ''
    saveTraining((s) => {
      const exId = exIdOf(s, it)
      keepLevel(s, ladder, it.index, Date.now())
      setId = logSet(s, { day: today, exId, set: { reps, kg: d.kg[ladder] || undefined, feel: d.feel[ladder]?.[i] ?? undefined }, session: d.id, now: Date.now() }).id ?? ''
      saveSession(s, recordOf(d, s))
    })
    logged[i] = setId || null
    setDraft({ ...d, logged: { ...d.logged, [ladder]: logged } })
    setRest({ endsAt: Date.now() + d.rest * 1000, total: d.rest })
    refresh()
  }

  const finish = async () => {
    if (!draft) return
    const box: { rec: TrainSession | null } = { rec: null }
    saveTraining((s) => {
      box.rec = recordOf(draft, s, true)
      saveSession(s, box.rec)
    })
    setRest(null)
    const w = box.rec ? workoutOf(box.rec) : null
    if (!w) {
      setDraft(null)
      refresh()
      return toast('Nothing logged, so nothing saved. Log a set first.', 'info')
    }
    const fresh = readSport() ?? {}
    const after = sessionItems(fresh, trainOf(fresh), draft.type, today)
    const up = after.filter((x) => x.status.state === 'complete')
    setDraft(null)
    refresh()
    try {
      const r = await life.body.logWorkout(w)
      onLogged(r.state)
      window.dispatchEvent(new CustomEvent('life-body-changed'))
      window.dispatchEvent(new CustomEvent('life-wallet-changed'))
      toast(r.awarded ? 'Workout saved. "Workout done" points paid.' : 'Workout saved (today’s workout points were already paid).', 'good')
    } catch {
      toast('Your sets are saved. The workout could not be added to your log right now.', 'info')
    }
    if (up.length) {
      celebrate(null, 'reward')
      soundFanfare()
      toast(`Level complete: ${up.map((x) => x.name).join(', ')}. Move up in your roadmap below.`, 'good')
    } else celebrate(null, 'reward')
  }

  const changeDay = (i: number) => {
    const order: DayType[] = ['upper', 'legs', 'rest']
    const days = [...data.week.days]
    days[i] = order[(order.indexOf(days[i]) + 1) % 3]
    const r = validateWeek(days, i)
    setWeekMsg(r.message)
    saveTraining((s) => {
      s.trainWeek = { v: 1, days: r.days, updatedAt: Date.now() }
    })
    refresh()
  }

  const elapsed = draft?.startedAt ? Math.max(0, (now - draft.startedAt) / 1000) : 0
  const planned = items.reduce((n, it) => n + it.sets, 0)
  const doneSets = draft ? Object.values(draft.logged).reduce((n, l) => n + l.filter(Boolean).length, 0) : 0
  const timePct = Math.min(1, elapsed / (SESSION_RULES.minutes * 60))
  const setPct = planned ? doneSets / planned : 0
  const pace = !draft?.startedAt ? '' : setPct >= 1 ? 'All sets done' : setPct + 0.08 >= timePct ? 'On pace' : 'Behind: drop the last set if you need to'
  const minutes = sessionMinutes(items)
  const restDay = type === 'rest'
  const dayIdx = dowOf(today)

  return (
    <section className="bdy-card tr-today" aria-label="Today's training" data-tr="today">
      <header className="tr-head">
        <div className="tr-head-text">
          <small className="bdy-eyebrow">{WEEKDAYS[dayIdx]}{plan.why === 'catch-up' && !draft ? ' · catch-up' : ''}</small>
          <h2 className="tr-title" data-tr="type">{plan.why === 'done' && !draft ? `Done: ${TYPE_NAME[plan.type]}` : restDay ? 'Rest day' : TYPE_NAME[type]}</h2>
          <p className="bdy-note" data-tr="line">
            {draft && draft.type !== plan.type ? `${TYPE_NAME[draft.type]} today, by your choice. Stop each set with 1–3 reps left.` : plan.line}
          </p>
        </div>
        <button type="button" className="tr-week" onClick={() => setEditWeek((v) => !v)} aria-expanded={editWeek} aria-label="Your week" data-tr="week">
          {data.week.days.map((d, i) => (
            <span key={i} className={`tr-wday ${d}${i === dayIdx ? ' now' : ''}`} title={`${WEEKDAYS[i]}: ${TYPE_NAME[d]}`}>
              <small>{SHORT_DAYS[i][0]}</small>
              <i>{d === 'upper' ? 'U' : d === 'legs' ? 'L' : '·'}</i>
            </span>
          ))}
        </button>
      </header>

      {!draft?.startedAt && <RecoveryPanel st={st} plan={plan} week={data.week} done={done} today={today} started={!!draft} onSwap={(t) => setDraft(newDraft(t))} />}

      {editWeek && (
        <div className="tr-week-edit" data-tr="week-edit">
          <p className="bdy-note">Tap a day to change it: Upper → Legs + core → Rest. The same muscles never train two days in a row.</p>
          <div className="tr-week-days">
            {data.week.days.map((d, i) => (
              <button key={i} type="button" className={`tr-wbtn ${d}`} onClick={() => changeDay(i)} data-tr={`day-${i}`}>
                <small>{SHORT_DAYS[i]}</small>
                <b>{d === 'rest' ? 'Rest' : d === 'upper' ? 'Upper' : 'Legs'}</b>
              </button>
            ))}
          </div>
          {weekMsg && (
            <p className="tr-week-msg" role="status" data-tr="week-msg">
              {weekMsg}
            </p>
          )}
          <button type="button" className="bdy-btn quiet" onClick={() => (saveTraining((s) => void (s.trainWeek = { v: 1, days: DEFAULT_DAYS, updatedAt: Date.now() })), setWeekMsg(null), refresh())}>
            Back to the default week
          </button>
        </div>
      )}

      {restDay ? (
        <div className="tr-restday">
          {plan.why === 'done' ? (
            <p className="bdy-sub">Nice work. Protein, water and a good night's sleep finish the job.</p>
          ) : (
            <ul className="tr-restlist">
              <li>Walk 20–30 minutes</li>
              <li>Stretch 5–10 minutes</li>
              <li>Eat your full food, protein at every meal</li>
            </ul>
          )}
          {plan.anyway && (
            <button type="button" className="bdy-btn quiet" onClick={() => start(plan.anyway!)} data-tr="anyway">
              Train anyway: {TYPE_NAME[plan.anyway]}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="tr-meta">
            <span>{items.length} moves</span>
            <span>about {minutes} min</span>
            <span>rest 60–90 s</span>
            <span>1–3 reps in reserve</span>
          </div>
          {lighter && (
            <p className="tr-lighter" data-tr="lighter">
              Lighter week until {WEEKDAYS[dowOf(lighter.until)]}: {LIGHTER.pct}% of your usual reps.
              <button type="button" className="bdy-btn quiet" onClick={() => (saveTraining((s) => setLighter(s, today, Date.now(), false)), refresh())} data-tr="lighter-off">
                Back to full
              </button>
            </p>
          )}
          <details className="tr-warm">
            <summary>Warm-up · {SESSION_RULES.warmupMin} min</summary>
            <ol>
              {WARMUP[type as SessionType].map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ol>
          </details>

          {draft?.startedAt ? (
            <div className="tr-clock" data-tr="clock">
              <div className="tr-clock-row">
                <b className="bdy-num">{mmss(elapsed)}</b>
                <span className="bdy-note">of {SESSION_RULES.minutes}:00 · {doneSets}/{planned} sets</span>
                <span className={`tr-pace${pace.startsWith('Behind') ? ' behind' : ''}`}>{pace}</span>
              </div>
              <div className="tr-pacebar" aria-hidden>
                <i className="time" style={{ width: `${timePct * 100}%` }} />
                <i className="sets" style={{ width: `${setPct * 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="tr-startrow">
              <button type="button" className="bdy-btn primary big tr-start" onClick={() => start()} data-tr="start">
                Start workout
              </button>
              {onOpenSportApp && (
                <button type="button" className="bdy-btn quiet" onClick={onOpenSportApp}>
                  Open in Sport Track
                </button>
              )}
            </div>
          )}

          <ol className="tr-exlist">
            {items.map((it) => {
              const L = it.ladder.id
              const reps = draft?.reps[L] ?? fillOf(it).map((f) => f.reps)
              const feel = draft?.feel[L] ?? []
              const logged = draft?.logged[L] ?? []
              const kg = draft?.kg[L] ?? 0
              const u = it.level.unit === 'sec' ? 's' : 'reps'
              return (
                <li key={L} className="tr-ex" data-ladder={L}>
                  <div className="tr-ex-head">
                    <button type="button" className="tr-ex-name" onClick={() => setSheet(it)} aria-label={`How to do ${it.name}`}>
                      <b>{it.name}</b>
                      <small>
                        {it.ladder.name} · level {it.index + 1} of {it.ladder.levels.length}
                        {it.placed && !it.last ? ' (from your best sets)' : ''}
                      </small>
                    </button>
                    <span className="tr-target" data-tr="target">
                      {it.sets} × {rangeText(it.level)}
                    </span>
                  </div>
                  {it.status.state === 'complete' && (
                    <span className="tr-done-chip" data-tr="level-done">
                      Level done{it.next ? ': move up in your roadmap' : ''}
                    </span>
                  )}
                  <div className="tr-ex-last">
                    <span data-tr="last">{it.lastLine}</span>
                    <button type="button" className="bdy-chip" onClick={() => fillSame(it)} data-tr="same">
                      Same as last time
                    </button>
                  </div>
                  <div className="tr-kg">
                    <span className="bdy-note">Backpack</span>
                    <button type="button" className="tr-step sm" aria-label="Less weight" onClick={() => { const d = ensure(); setDraft({ ...d, kg: { ...d.kg, [L]: Math.max(0, (d.kg[L] ?? 0) - 2.5) } }) }}>−</button>
                    <b>{kg ? `+${kg} kg` : 'none'}</b>
                    <button type="button" className="tr-step sm" aria-label="More weight" onClick={() => { const d = ensure(); setDraft({ ...d, kg: { ...d.kg, [L]: Math.min(60, (d.kg[L] ?? 0) + 2.5) } }) }}>+</button>
                  </div>
                  <ol className="tr-sets">
                    {Array.from({ length: it.sets }, (_, i) => {
                      const on = !!logged[i]
                      const r = reps[i] ?? it.level.lo
                      return (
                        <li key={i} className={`tr-set${on ? ' logged' : ''}`} data-set={i}>
                          <span className="tr-set-n">
                            Set {i + 1}
                            <small>{u}</small>
                          </span>
                          <div className="tr-reps">
                            <button type="button" className="tr-step" aria-label="One less" disabled={on} onClick={() => edit(L, i, { reps: r - 1 })}>−</button>
                            <input
                              className="tr-num"
                              type="number"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min={0}
                              max={500}
                              value={r}
                              disabled={on}
                              aria-label={`Set ${i + 1} ${u}`}
                              onFocus={(e) => e.currentTarget.select()}
                              onChange={(e) => edit(L, i, { reps: Number(e.currentTarget.value) || 0 })}
                            />
                            <button type="button" className="tr-step" aria-label="One more" disabled={on} onClick={() => edit(L, i, { reps: r + 1 })}>+</button>
                          </div>
                          <div className="bdy-seg tr-feel" role="radiogroup" aria-label={`Set ${i + 1} effort`}>
                            {FEELS.map((f) => (
                              <button key={f.id} type="button" role="radio" aria-checked={feel[i] === f.id} disabled={on} onClick={() => edit(L, i, { feel: feel[i] === f.id ? null : f.id })} data-feel={f.id}>
                                {f.label}
                              </button>
                            ))}
                          </div>
                          <button type="button" className={`tr-log${on ? ' on' : ''}`} onClick={() => toggleSet(it, i)} aria-pressed={on} aria-label={on ? `Set ${i + 1} logged: tap to undo` : `Log set ${i + 1}`} data-tr="log">
                            {on ? '✓' : 'Log'}
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                </li>
              )
            })}
          </ol>

          {draft?.startedAt && (
            <button type="button" className="bdy-btn primary big tr-finish" onClick={() => void finish()} data-tr="finish">
              Finish workout
            </button>
          )}
        </>
      )}

      {rest && draft && (
        <RestTimer
          endsAt={rest.endsAt}
          total={rest.total}
          rest={draft.rest}
          onRest={(s) => {
            setDraft({ ...draft, rest: s })
            setRest({ endsAt: Date.now() + s * 1000, total: s })
          }}
          onAdd={() => setRest((r) => (r ? { endsAt: r.endsAt + 15000, total: r.total + 15 } : r))}
          onSkip={() => setRest(null)}
        />
      )}

      {sheet && <MoveSheet level={sheet.level} title={`${sheet.ladder.name} · level ${sheet.index + 1}`} onClose={() => setSheet(null)} />}
    </section>
  )
}

/** The Sport Track exercise this move is logged on (made by ensureExercise if needed). */
const exIdOf = (s: any, it: PlanItem): string => exIdsFor(s?.exercises, it.level.move)[0] ?? `ex_t_${it.level.move}`
