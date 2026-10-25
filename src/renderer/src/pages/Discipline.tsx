import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { campaignMap, URGE_SECONDS } from '@core/discipline'
import type { DisciplineState } from '@shared/api'
import { isDemo, life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction } from '../ui'
import { mmss } from './planUi'
import { useTicker } from './Schedule'

interface Props {
  state: DisciplineState
  onState: (s: DisciplineState) => void
  onWallet: () => void
  revealed: boolean
  onReveal: () => void
  urgeOpen: boolean
  onUrgeOpen: (open: boolean) => void
}

export function Discipline({ state, onState, onWallet, revealed, onReveal, urgeOpen, onUrgeOpen }: Props) {
  const act = useAction()
  const [confirmReset, setConfirmReset] = useState(false)
  const [comeback, setComeback] = useState(false)
  const [celebrate, setCelebrate] = useState<string | null>(null)

  async function run(fn: () => Promise<DisciplineState>, ok?: string) {
    const s = await act(fn, ok)
    if (s) {
      onState(s)
      onWallet()
    }
    return s
  }

  if (!state.setup) return <Setup onState={onState} />
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
    <div className="discipline">
      <section className="disc-hero">
        <div className="streak">
          <motion.div className="flame" animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 2.4 }}>
            <Icon name="shield" size={34} />
          </motion.div>
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
          <button className="btn primary" disabled={state.checkedInToday || state.resetToday} onClick={() => run(() => life.discipline.checkIn(), 'Checked in. Another day won.')}>
            <Icon name="check" size={15} />
            {state.checkedInToday ? 'Checked in today' : state.resetToday ? 'Check in tomorrow' : 'Check in clean today'}
          </button>
          <HoldButton done={state.oathToday} onDone={() => run(() => life.discipline.oath(), 'Oath sworn')} />
          <button className="btn urge-btn" onClick={() => onUrgeOpen(true)}>
            <Icon name="bolt" size={15} /> Urge crusher
          </button>
        </div>
        <span className="hint panic-hint">Panic shortcut from anywhere: Ctrl + Alt + U</span>
      </section>

      <section className="stats four">
        <Stat label="Best streak" value={`${state.best} d`} />
        <Stat label="Total clean days" value={`${state.totalClean}`} />
        <Stat label="Urges crushed this week" value={`${state.urgesThisWeek}`} />
        <Stat label="Resets" value={`${state.resets}`} />
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Milestones</h2>
          <span className="hint">Bonus coins and XP when you reach them. Days that passed before you set this up show as reached without coins.</span>
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
            <p className="hint">Being honest is the strong move. Your best ({state.best} days) and your {state.totalClean} total clean days stay. The count starts again from today, and it costs a few coins. No XP is lost.</p>
            <div className="sheet-actions">
              <button className="btn ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const s = await run(() => life.discipline.reset())
                  setConfirmReset(false)
                  if (s) setComeback(true)
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
            <p className="hint">One slip doesn't erase the work. Your best of {state.best} days is still yours to beat.</p>
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
              if (s) onUrgeOpen(false)
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

function Setup({ onState }: { onState: (s: DisciplineState) => void }) {
  const act = useAction()
  const today = new Date().toISOString().slice(0, 10)
  const [day, setDay] = useState(today)
  return (
    <section className="panel setup">
      <div className="soon-icon" style={{ ['--c' as string]: '#FF8A3D' }}>
        <Icon name="shield" size={34} />
      </div>
      <h2>Set up Discipline</h2>
      <p className="hint">When did your current streak start? The count is worked out from this date, so it stays honest. You can't bump it by hand.</p>
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
  const total = (isDemo ? 10 : URGE_SECONDS) * 1000
  const elapsed = startedAt ? now - Date.parse(startedAt) : 0
  const left = Math.max(0, total - elapsed)
  const phase = BREATH[Math.floor(elapsed / 4000) % 4]
  const minute = Math.floor(elapsed / 60000)
  const prompts = ['Stand up. Breathe with the circle.', 'Drop and do 10 push-ups.', 'Cold water on your face, then breathe.']
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
        <p className="urge-prompt">{prompts[Math.min(minute, prompts.length - 1)]}</p>
        <p className="hint">The urge peaks and passes. Stay here until the timer ends.</p>
        <div className="row center">
          <button className="btn primary" disabled={left > 0} onClick={onFinish}>
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
