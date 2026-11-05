import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { dayKey } from '@core/dates'
import { campaignMap, disciplineCharts, URGE_SECONDS } from '@core/discipline'
import { TRIGGERS } from '@core/urgePatterns'
import { addReflection, lastReflections, REFLECTION_TITLE, reflectionPrompt } from '@core/reflections'
import type { ConnectionsState, DisciplineState } from '@shared/api'

type ManSuggestion = ConnectionsState['man']['suggestion']
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction } from '../ui'
import { mmss } from './planUi'
import { useTicker } from '../useTicker'
import { pickUrgeAction } from '@core/urgeAction'

interface Props {
  state: DisciplineState
  man: ManSuggestion
  onState: (s: DisciplineState) => void
  onWallet: () => void
  revealed: boolean
  onReveal: () => void
  urgeOpen: boolean
  onUrgeOpen: (open: boolean) => void
}

export function Discipline({ state, man, onState, onWallet, revealed, onReveal, urgeOpen, onUrgeOpen }: Props) {
  const act = useAction()
  const [confirmReset, setConfirmReset] = useState(false)
  const [comeback, setComeback] = useState(false)
  const [celebrate, setCelebrate] = useState<string | null>(null)
  // MN23: a privacy blur. Tap the eye to hide the numbers; they also hide
  // when you leave the window or after a minute without touching it.
  const [blurred, setBlurred] = useState(false)
  useEffect(() => {
    let idle = 0
    const hide = () => setBlurred(true)
    const poke = () => {
      window.clearTimeout(idle)
      idle = window.setTimeout(hide, 60_000)
    }
    const onVis = () => document.hidden && hide()
    poke()
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pointerdown', poke)
    window.addEventListener('keydown', poke)
    return () => {
      window.clearTimeout(idle)
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pointerdown', poke)
      window.removeEventListener('keydown', poke)
    }
  }, [])

  async function run(fn: () => Promise<DisciplineState>, ok?: string) {
    const s = await act(fn, ok)
    if (s) {
      onState(s)
      onWallet()
    }
    return s
  }

  if (!state.setup) return <Setup man={man} onState={onState} />
  if (state.stealth && !revealed) {
    return (
      <button className="panel stealth-cover" onClick={onReveal}>
        <Icon name="shield" size={30} />
        <h2>Hidden</h2>
        <p className="hint">Stealth mode is on. Click to show this section.</p>
      </button>
    )
  }

  const nextPct = state.nextRank ? Math.min(1, state.current / state.nextRank.days) : 1
  const map = campaignMap({ current: state.current, best: state.best, totalClean: state.totalClean, relapses: state.resets, since: state.since })

  return (
    <div className={`discipline ${blurred ? 'privacy-blur' : ''}`}>
      <button
        className="btn small ghost privacy-eye"
        aria-pressed={blurred}
        title={blurred ? 'Show the numbers' : 'Hide the numbers (privacy blur)'}
        onClick={() => setBlurred((b) => !b)}
      >
        {blurred ? '🙈 Hidden: tap to show' : '👁 Hide'}
      </button>
      {blurred && <button className="privacy-cover" aria-label="Show the numbers" onClick={() => setBlurred(false)} />}
      <section className="disc-hero">
        <div className="streak">
          <div className="flame">
            <Icon name="shield" size={34} />
          </div>
          <div>
            <div className="streak-num">
              {state.current}
              <small>{state.current === 1 ? 'day' : 'days'}</small>
            </div>
            <div className="streak-sub">since {state.since}</div>
          </div>
        </div>
        <div className="rank-box">
          <span className="label">Rank</span>
          <b>{state.rank}</b>
          {state.nextRank && (
            <>
              <div className="bar">
                <i style={{ width: `${nextPct * 100}%` }} />
              </div>
              <span className="hint">
                {state.nextRank.days - state.current} days to {state.nextRank.name}
              </span>
            </>
          )}
        </div>
        <blockquote className="quote">“{state.quote}”</blockquote>
        <div className="disc-actions">
          <CheckInButton state={state} onCheckIn={() => run(() => life.discipline.checkIn(), 'Checked in. Another day won.')} />
          <HoldButton done={state.oathToday} onDone={() => run(() => life.discipline.oath(), 'Oath sworn')} />
          <button className="btn urge-btn" onClick={() => onUrgeOpen(true)}>
            <Icon name="bolt" size={15} /> I feel an urge
          </button>
        </div>
        <span className="hint panic-hint">From anywhere: Ctrl + Alt + U</span>
      </section>

      <section className="stats four">
        <Stat label="Best streak" value={`${state.best} d`} />
        <Stat label="Total clean days" value={`${state.totalClean}`} />
        <Stat label="Urges beaten this week" value={state.urgesThisWeek ? `${state.urgesThisWeek}` : 'None yet'} />
        <Stat label="Resets" value={`${state.resets}`} />
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Milestones</h2>
          <span className="hint">The coins are paid when your check-in reaches the day. Days before you set this up show as reached, with no coins.</span>
        </header>
        <div className="milestones">
          {state.milestones.map((m) => (
            <div key={m.days} className={`ms ${m.status}`}>
              <b>{m.days}</b>
              <small>days</small>
              <Coins n={m.coins} />
              {m.status === 'claimable' && (
                <button
                  className="btn small primary"
                  onClick={async () => {
                    const r = await act(() => life.discipline.claim(m.days))
                    if (r) {
                      onState(r.state)
                      onWallet()
                      setCelebrate(`${m.days} days! +${r.coins} coins`)
                    }
                  }}
                >
                  Claim
                </button>
              )}
              {m.status === 'claimed' && <span className="ms-tag">Claimed</span>}
              {m.status === 'before-setup' && <span className="ms-tag">Reached</span>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>90-day campaign</h2>
          <span className="hint">Day {Math.min(state.current, 90)} of 90</span>
        </header>
        <div className="campaign" aria-label={`${state.current} of 90 days`}>
          {map.map((c) => (
            <span key={c.day} className={`cell ${c.state} ${c.milestone ? 'm' : ''}`} title={`Day ${c.day}`}>
              {c.milestone ? c.day : ''}
            </span>
          ))}
        </div>
      </section>

      <DisciplineCharts state={state} />

      <ReflectionCard today={state.today} />

      <section className="panel slim">
        <div className="row spread">
          <label className="check">
            <input type="checkbox" checked={state.stealth} onChange={(e) => run(() => life.discipline.setStealth(e.target.checked))} /> Stealth mode: hide this section and its numbers until clicked
          </label>
          <button className="btn small ghost danger-text" disabled={state.resetToday} onClick={() => setConfirmReset(true)}>
            I slipped
          </button>
        </div>
      </section>

      {confirmReset && (
        <div className="sheet" role="dialog" aria-label="Reset streak">
          <div className="sheet-card">
            <h3>Reset the streak?</h3>
            <p className="hint">Being honest is the strong move. Your best ({state.best} days) and your {state.totalClean} total clean days stay. The count starts again from today, and it costs a few coins. You can take it back in the next 10 minutes if it was a test or a wrong tap.</p>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const s = await run(() => life.discipline.reset())
                  setConfirmReset(false)
                  if (s) {
                    setComeback(true)
                    // The 72-hour plan as real things: Ben's check-ins, and Todoist tasks.
                    void life.discipline.comeback?.()
                      .then(async (plan) => {
                        for (const st of plan.filter((x) => x.kind === 'task')) await life.todoist?.quickAdd(`${st.text} ${st.due ?? 'today'}`).catch(() => null)
                      })
                      .catch(() => {})
                    window.dispatchEvent(new Event('life-discipline-reset-done'))
                  }
                }}
              >
                Reset honestly
              </button>
            </div>
          </div>
        </div>
      )}

      {comeback && (
        <div className="sheet" role="dialog" aria-label="Comeback">
          <div className="sheet-card comeback">
            <Icon name="spark" size={28} />
            <h3>Comeback starts now</h3>
            <ul>
              <li>Get up, drink water, step outside for 5 minutes.</li>
              <li>Use the urge crusher the next time it hits.</li>
              <li>Check in tomorrow. Day 3 pays a comeback bonus.</li>
            </ul>
            <p className="hint small">Ben will check in tonight, tomorrow and on day 3 with your if-then plan, and the steps are in Todoist.</p>
            <p className="hint">One slip doesn't erase the work. Your best of {state.best} days is still yours to beat.</p>
            {state.undoResetUntil && Date.parse(state.undoResetUntil) > Date.now() && (
              <p className="hint small">
                Was it a test or a wrong tap?{' '}
                <button
                  className="btn small ghost"
                  onClick={async () => {
                    if (!life.discipline.undoReset) return
                    const s = await run(() => life.discipline.undoReset!(), 'Reset taken back. Your streak and coins are back.')
                    if (s) setComeback(false)
                  }}
                >
                  Take the reset back
                </button>{' '}
                (for 10 minutes, no cost)
              </p>
            )}
            <div className="sheet-actions">
              <button className="btn primary" onClick={() => setComeback(false)}>
                Let's go
              </button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {urgeOpen && (
          <UrgeCrusher
            startedAt={state.urgeStartedAt}
            onStart={() => run(() => life.discipline.startUrge())}
            onCancel={async () => {
              await run(() => life.discipline.cancelUrge())
              onUrgeOpen(false)
            }}
            onFinish={async () => {
              const s = await run(() => life.discipline.finishUrge(), 'Urge crushed. You won that one.')
              if (s) {
                onUrgeOpen(false)
                // The trigger was asked in the crusher (MN9): don't ask twice.
                window.dispatchEvent(new CustomEvent('life-urge-won', { detail: { noted: true } }))
              }
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {celebrate && (
          <motion.div className="celebrate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCelebrate(null)} onAnimationComplete={() => setTimeout(() => setCelebrate(null), 2200)}>
            <motion.div className="celebrate-card" initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
              <Icon name="trophy" size={34} />
              <h2>{celebrate}</h2>
              <p>Milestone unlocked</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <div className="big small-big">{value}</div>
    </div>
  )
}

function Setup({ man, onState }: { man: ManSuggestion; onState: (s: DisciplineState) => void }) {
  const act = useAction()
  // BG14: the app's day in your time, not the UTC date (wrong just after midnight).
  const today = dayKey(new Date())
  const [day, setDay] = useState(man?.start ?? today)
  return (
    <section className="panel setup">
      <div className="soon-icon" style={{ ['--c' as string]: '#FF8A3D' }}>
        <Icon name="shield" size={34} />
      </div>
      <h2>Set up Discipline</h2>
      <p className="hint">When did your current streak start? The count is worked out from this date, so it stays honest. You can't bump it by hand.</p>
      {man && (
        <div className="man-import">
          <b>Found your MAN app: {man.showsDays}-day streak.</b>
          <span>
            Starting on {man.start} gives the same {man.showsDays} days here.{man.note ? ` ${man.note}` : ''}
          </span>
        </div>
      )}
      <div className="row center">
        <input type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} aria-label="Streak start date" />
        <button className="btn primary" onClick={async () => { const s = await act(() => life.discipline.setStart(day), 'Streak set'); if (s) onState(s) }}>
          Start tracking
        </button>
      </div>
      <p className="hint">Private: this section uses neutral words and can be hidden with stealth mode.</p>
    </section>
  )
}

/** Hold for 3 seconds to swear the morning oath. */
function HoldButton({ done, onDone }: { done: boolean; onDone: () => void }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef<number | null>(null)
  const stop = () => {
    setHolding(false)
    if (timer.current) window.clearTimeout(timer.current)
  }
  if (done) {
    return (
      <button className="btn" disabled>
        <Icon name="spark" size={15} /> Oath sworn today
      </button>
    )
  }
  return (
    <button
      className={`btn hold ${holding ? 'holding' : ''}`}
      onPointerDown={() => {
        setHolding(true)
        timer.current = window.setTimeout(() => {
          setHolding(false)
          onDone()
        }, 3000)
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      title="Press and hold for 3 seconds"
    >
      <i className="hold-fill" />
      <span>
        <Icon name="spark" size={15} /> Hold for the morning oath
      </span>
    </button>
  )
}

const BREATH = ['Breathe in', 'Hold', 'Breathe out', 'Hold'] as const

function UrgeCrusher({ startedAt, onStart, onCancel, onFinish }: { startedAt: string | null; onStart: () => void; onCancel: () => void; onFinish: () => void }) {
  useEffect(() => {
    if (!startedAt) onStart()
    // Only when the crusher opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const now = useTicker(true)
  const total = URGE_SECONDS * 1000 // the full time on the web too (it was 10 s there)
  const elapsed = startedAt ? now - Date.parse(startedAt) : 0
  const left = Math.max(0, total - elapsed)
  const phase = BREATH[Math.floor(elapsed / 4000) % 4]
  // H11: one action from your most common trigger, and how strong it was before/after.
  const [trigger, setTrigger] = useState<string | null>(null)
  const [before, setBefore] = useState<number | null>(null)
  const [after, setAfter] = useState<number | null>(null)
  const [did, setDid] = useState<string | null>(null)
  const [reps, setReps] = useState<number>(20)
  const [failed, setFailed] = useState<string | null>(null)
  const [usual, setUsual] = useState<string | null>(null)
  useEffect(() => {
    life.discipline.patterns?.().then((p) => setUsual(p.triggers[0] ?? null)).catch(() => {})
  }, [])
  const action = pickUrgeAction(trigger ?? usual)
  // MN16: you log the push-ups you really did (after doing them), and a
  // failure says so instead of looking done.
  const doAction = async () => {
    setFailed(null)
    try {
      if (action.kind === 'pushups') {
        const n = Math.max(1, Math.min(500, Math.round(reps) || 0))
        await life.body.logWorkout({ title: 'Push-ups (urge crusher)', items: [{ exerciseId: 'pushups', name: 'Push-ups', unit: 'reps', amount: n }], note: 'Urge crusher' })
        window.dispatchEvent(new CustomEvent('life-body-changed'))
        setDid(`✓ ${n} push-ups in Sport Track`)
      }
      if (action.kind === 'focus' && action.minutes) {
        await life.focus.start('Urge → focus', action.minutes, null)
        setDid(`✓ ${action.minutes}-minute focus started`)
      }
    } catch (e) {
      setFailed(`Couldn't log it: ${(e as Error).message}`)
    }
  }
  const finish = () => {
    // Only a trigger you picked is saved (not a guess from your usual one).
    void life.discipline.note?.('urge', trigger ?? 'Other', { ...(before != null ? { before } : {}), ...(after != null ? { after } : {}), action: action.kind }).catch(() => {})
    onFinish()
  }
  const Scale = ({ value, onPick, label }: { value: number | null; onPick: (n: number) => void; label: string }) => (
    <div className="urge-scale" role="radiogroup" aria-label={label}>
      <small>{label}</small>
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
        <button key={n} role="radio" aria-checked={value === n} className={value === n ? 'on' : ''} onClick={() => onPick(n)}>
          {n}
        </button>
      ))}
    </div>
  )
  return (
    <motion.div className="urge" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="urge-inner">
        <span className="label">Urge crusher</span>
        <motion.div
          className="breath"
          animate={{ scale: phase === 'Breathe in' ? 1.25 : phase === 'Breathe out' ? 0.8 : phase === 'Hold' && Math.floor(elapsed / 4000) % 4 === 1 ? 1.25 : 0.8 }}
          transition={{ duration: 4, ease: 'easeInOut' }}
        >
          <span>{phase}</span>
        </motion.div>
        <div className="urge-time">{mmss(left)}</div>
        {before == null ? (
          <Scale value={before} onPick={setBefore} label="How strong is it? (1–10)" />
        ) : trigger == null ? (
          <div className="urge-triggers" role="radiogroup" aria-label="What set it off?">
            <small>What set it off?</small>
            {TRIGGERS.map((t) => (
              <button key={t} role="radio" aria-checked={false} className={t === usual ? 'usual' : ''} onClick={() => setTrigger(t)}>
                {t}
              </button>
            ))}
          </div>
        ) : (
          <div className="urge-action">
            <b>{action.title}</b>
            <p className="hint">{action.how}</p>
            {did ? (
              <p className="hint">{did}</p>
            ) : action.kind === 'pushups' ? (
              <div className="row center">
                <label className="hint">
                  I did{' '}
                  <input type="number" min={1} max={500} value={reps} onChange={(e) => setReps(Number(e.target.value))} style={{ width: 64 }} aria-label="Push-ups you did" />
                </label>
                <button className="btn small" onClick={() => void doAction()}>
                  Log them
                </button>
              </div>
            ) : action.kind === 'focus' ? (
              <button className="btn small" onClick={() => void doAction()}>
                Start {action.minutes} min
              </button>
            ) : null}
            {failed && <p className="hint danger-text">{failed}</p>}
          </div>
        )}
        <p className="hint">The urge peaks and passes. Stay here until the timer ends.</p>
        {left === 0 && <Scale value={after} onPick={setAfter} label="And now? (1–10)" />}
        <div className="row center">
          <button className="btn primary" disabled={left > 0} onClick={finish}>
            {left > 0 ? 'Keep going…' : 'I crushed it'}
          </button>
          <button className="btn ghost" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </motion.div>
  )
}

/** MN3: the check-in says when it opens, instead of failing. */
function CheckInButton({ state, onCheckIn }: { state: DisciplineState; onCheckIn: () => void }) {
  const w = state.checkIn
  const done = state.checkedInToday || w?.mode === 'done'
  // BG13: a reset today still leaves yesterday's check-in open in the morning.
  const blockedByReset = state.resetToday && w?.mode !== 'yesterday'
  const label = blockedByReset
    ? 'Check in tomorrow evening'
    : done
      ? 'Checked in'
      : w?.mode === 'wait'
        ? 'Check-in opens at 19:00'
        : w?.mode === 'yesterday'
          ? 'Check in yesterday as clean'
          : 'Check in: today was clean'
  return (
    <button className="btn primary" disabled={done || blockedByReset || w?.mode === 'wait'} onClick={onCheckIn} title="You check in a day once you've lived it: from 19:00, or the next morning until 12:00">
      <Icon name="check" size={15} />
      {label}
    </button>
  )
}

/** MN25: only what really happened: 12 weeks of days, and urges by time of day. */
function DisciplineCharts({ state }: { state: DisciplineState }) {
  const history = state.history ?? []
  const c = disciplineCharts(history, state.today, state.since, 12)
  const max = Math.max(1, ...c.byTime.map((b) => b.count))
  const weeks = Array.from({ length: 12 }, (_, i) => c.days.slice(i * 7, i * 7 + 7))
  return (
    <section className="panel disc-charts">
      <header className="panel-head">
        <h2>Last 12 weeks</h2>
        <span className="hint">{c.logged ? `${c.logged} checked-in clean days` : 'Your check-ins show up here'}</span>
      </header>
      {!history.some((h) => h.kind === 'checkin' || h.kind === 'reset' || h.kind === 'urge') ? (
        <p className="empty-note">Nothing here yet. Check in tonight after 19:00 and your first green square appears.</p>
      ) : (
        <>
          <div className="disc-weeks" aria-label="Check-ins in the last 12 weeks">
            {weeks.map((w, i) => (
              <div key={i} className="disc-week">
                {w.map((d) => (
                  <span key={d.day} className={`dw ${d.state}`} title={`${d.day}: ${d.state === 'clean' ? 'checked in clean' : d.state === 'reset' ? 'reset' : d.state === 'before' ? 'before you started' : 'not checked in'}${d.urges ? `, ${d.urges} urge${d.urges > 1 ? 's' : ''} beaten` : ''}`} />
                ))}
              </div>
            ))}
          </div>
          <div className="disc-legend">
            <span><i className="dw clean" /> Checked in</span>
            <span><i className="dw none" /> Not checked in</span>
            <span><i className="dw reset" /> Reset</span>
          </div>
          <h3 className="disc-sub">When urges come</h3>
          {c.urges === 0 ? (
            <p className="empty-note">No urges logged yet. When one comes, tap “I feel an urge” and this shows your risky times.</p>
          ) : (
            <div className="disc-bars">
              {c.byTime.map((b) => (
                <div key={b.label} className="disc-bar">
                  <span>{b.label}</span>
                  <i style={{ width: `${(b.count / max) * 100}%` }} />
                  <b>{b.count}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** MN14: one question a day; the answer goes into the Notebook ("Reflections"). */
function ReflectionCard({ today }: { today: string }) {
  const act = useAction()
  const prompt = reflectionPrompt(today)
  const [text, setText] = useState('')
  const [recent, setRecent] = useState<{ day: string; text: string }[] | null>(null)
  const load = async () => {
    const notes = await life.notes?.list().catch(() => null)
    const note = notes?.find((n) => n.title.toLowerCase() === REFLECTION_TITLE.toLowerCase())
    setRecent(lastReflections(note?.body, 3))
    return { notes, note }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!life.notes) return null
  const save = async () => {
    const t = text.trim()
    if (!t) return
    const ok = await act(async () => {
      const { note } = await load()
      await life.notes!.save(note ? { id: note.id, title: note.title, body: addReflection(note.body, today, prompt, t) } : { title: REFLECTION_TITLE, body: addReflection('', today, prompt, t) })
      return true
    }, 'Saved in Notebook → Reflections')
    if (ok) {
      setText('')
      void load()
    }
  }
  return (
    <section className="panel reflection">
      <header className="panel-head">
        <h2>Reflection</h2>
        <span className="hint">Saved in your Notebook. No points: it's for you.</span>
      </header>
      <label className="reflect-q" htmlFor="reflect-text">{prompt}</label>
      <textarea id="reflect-text" rows={3} value={text} placeholder="A sentence or two is enough." onChange={(e) => setText(e.target.value)} />
      <div className="row end">
        <button className="btn small primary" disabled={!text.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
      {recent && recent.length === 0 && <p className="empty-note">No reflections yet. Your first one shows up here.</p>}
      {recent && recent.length > 0 && (
        <ul className="reflect-list">
          {recent.map((r) => (
            <li key={r.day + r.text.slice(0, 10)}>
              <small>{r.day}</small> {r.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
