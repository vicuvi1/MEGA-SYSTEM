import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { dayKey } from '@core/dates'
import { dayShown, disciplineCharts } from '@core/discipline'
import { URGE_WAVE_SECONDS, badgesOf, bestRun, friendlyDate, heatmap, nextBadge, rankLadder, rankProgress, shortDate, urgesPerWeek, type HeatCell } from '@core/disciplineView'
import { addReflection, lastReflections, REFLECTION_TITLE, reflectionPrompt } from '@core/reflections'
import type { ConnectionsState, DisciplineState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction } from '../ui'
import { CountUp } from '../motionKit'
import { celebrate as burst } from '../fx'
import { mmss } from './planUi'
import { useTicker } from '../useTicker'
import { Emblem, Flame, Medal, Ring } from './disciplineArt'
import { UrgeCrusher } from './UrgeCrusher'
import { comebackParts, type ComebackStep } from '@core/comeback'
import { RESET_UNDO_MINUTES } from '@core/discipline'
import { moduleOn } from '../useModules'

/**
 * The comeback plan's Todoist tasks, added only after the reset can no longer be taken
 * back (a task in Todoist can't be removed from here), and only if the reset still
 * stands and the Tasks module is on. Kept outside the page so leaving it doesn't cancel it.
 */
function comebackTasksLater(plan: ComebackStep[]): void {
  if (!comebackParts(plan, { coach: false, tasks: moduleOn('tasks') }).tasks.length) return
  window.setTimeout(async () => {
    const st = await life.discipline.state().catch(() => null)
    const tasks = comebackParts(plan, { coach: false, tasks: moduleOn('tasks') }).tasks
    if (!st?.resetToday || !tasks.length) return
    for (const t of tasks) await life.todoist?.quickAdd(`${t.text} ${t.due ?? 'today'}`).catch(() => null)
  }, RESET_UNDO_MINUTES * 60_000 + 5_000)
}

type ManSuggestion = ConnectionsState['man']['suggestion']

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

/**
 * Discipline: one page (no tabs). The hero (streak, rank, today's check-in),
 * the numbers, then milestones, history and the urge tools side by side on a
 * wide screen, and the settings at the end.
 */
export function Discipline({ state, man, onState, onWallet, revealed, onReveal, urgeOpen, onUrgeOpen }: Props) {
  const act = useAction()
  const [confirmReset, setConfirmReset] = useState(false)
  const [comeback, setComeback] = useState(false)
  const [celebrate, setCelebrate] = useState<string | null>(null)
  const [justChecked, setJustChecked] = useState(false)
  // MN23: a privacy blur over every number on the page. Tap "Hide" to blur;
  // it also blurs when you leave the window or after a minute untouched.
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

  const checkIn = async () => {
    const ok = await run(() => life.discipline.checkIn(), 'Checked in. Another day won.')
    if (ok) {
      burst(document.querySelector('.dx-checkin'), 'checkin')
      setJustChecked(true)
      window.setTimeout(() => setJustChecked(false), 1800)
    }
  }
  const saveWhy = (text: string) => run(() => (life.discipline.setWhy ? life.discipline.setWhy(text) : Promise.resolve(state)), 'Saved')
  const claimable = state.milestones.filter((x) => x.status === 'claimable')

  return (
    <div className={`discipline dx ${blurred ? 'privacy-blur' : ''}`}>
      {blurred && <button className="privacy-cover" aria-label="Show the numbers" onClick={() => setBlurred(false)} />}

      <div className="dx-page">
      <Hero
        state={state}
        blurred={blurred}
        onBlur={() => setBlurred((b) => !b)}
        justChecked={justChecked}
        onCheckIn={() => void checkIn()}
        onOath={() => void run(() => life.discipline.oath(), 'Oath sworn')}
        onUrge={() => onUrgeOpen(true)}
      />

      <Stats state={state} />

      <div className="dx-cols">
        <div className="dx-col">
          <section className="panel dx-card dx-miles" aria-labelledby="dx-miles-h">
            <header className="dx-head">
              <h2 id="dx-miles-h">Milestones</h2>
              <span className="hint">Rank, badges and the 90-day campaign</span>
            </header>
            <RankLadder current={state.current} />
            <Badges state={state} />
            <CoinMilestones
              state={state}
              claimable={claimable.length}
              onClaim={async (days) => {
                const r = await act(() => life.discipline.claim(days))
                if (r) {
                  onState(r.state)
                  onWallet()
                  setCelebrate(`${days} days! +${r.coins} coins`)
                }
              }}
            />
            <Campaign day={dayShown(state)} />
          </section>
        </div>

        <div className="dx-col">
          <History state={state} />
        </div>

        <div className="dx-col">
          <UrgeTools state={state} onOpen={() => onUrgeOpen(true)} onWhy={saveWhy} />
          <ReflectionCard today={state.today} />
          <section className="panel dx-card dx-settings" aria-labelledby="dx-set-h">
            <header className="dx-head">
              <h2 id="dx-set-h">Settings</h2>
            </header>
            <label className="dx-toggle">
              <input type="checkbox" role="switch" checked={state.stealth} onChange={(e) => run(() => life.discipline.setStealth(e.target.checked))} />
              <span className="dx-switch" aria-hidden="true" />
              <span>
                <b>Stealth mode</b>
                <small>Hide this section and its numbers until clicked. Ben and Telegram use neutral words.</small>
              </span>
            </label>
            <div className="dx-slip">
              <span>
                <b>I slipped</b>
                <small>An honest reset. Your best and your total stay.</small>
              </span>
              <button className="btn small ghost danger-text" disabled={state.resetToday} onClick={() => setConfirmReset(true)}>
                {state.resetToday ? 'Reset today' : 'I slipped'}
              </button>
            </div>
            {state.undoResetUntil && Date.parse(state.undoResetUntil) > Date.now() && life.discipline.undoReset && (
              <button className="btn small ghost" onClick={() => void run(() => life.discipline.undoReset!(), 'Reset taken back. Your streak and coins are back.')}>
                <Icon name="undo" size={14} /> Take the reset back (a test or a wrong tap)
              </button>
            )}
          </section>
        </div>
      </div>
      </div>

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
                    // The 72-hour plan as real things: Ben's check-ins (Coach on; removed if the reset is
                    // taken back), and Todoist tasks (Tasks on) only once the 10-minute undo window is over.
                    void life.discipline.comeback?.()
                      .then((plan) => comebackTasksLater(plan))
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
            {(moduleOn('coach') || moduleOn('tasks')) && (
              <p className="hint small">
                {moduleOn('coach') ? 'Ben will check in tonight, tomorrow and on day 3 with your if-then plan.' : ''}
                {moduleOn('tasks') ? ' The steps go to Todoist in 10 minutes, once the reset can no longer be taken back.' : ''}
              </p>
            )}
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
            why={state.why ?? null}
            onWhy={saveWhy}
            onStart={() => run(() => life.discipline.startUrge())}
            onClose={() => onUrgeOpen(false)}
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
          <m.div className="celebrate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCelebrate(null)} onAnimationComplete={() => setTimeout(() => setCelebrate(null), 2200)}>
            <m.div className="celebrate-card" initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
              <Icon name="trophy" size={34} />
              <h2>{celebrate}</h2>
              <p>Milestone unlocked</p>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** What today asks of you, in one line. */
function todayLine(s: DisciplineState): string {
  const w = s.checkIn
  if (s.resetToday && w?.mode !== 'yesterday') return 'A fresh start today. Day 1 begins tomorrow.'
  if (s.checkedInToday || w?.mode === 'done') return 'Today is checked in. Well done.'
  if (w?.mode === 'yesterday') return 'Good morning. Was yesterday clean? Check it in.'
  if (w?.mode === 'today') return 'The day is done. Was it clean? Check in.'
  return 'Check-in opens at 19:00. Get through the day.'
}

function Hero({ state, blurred, onBlur, justChecked, onCheckIn, onOath, onUrge }: { state: DisciplineState; blurred: boolean; onBlur: () => void; justChecked: boolean; onCheckIn: () => void; onOath: () => void; onUrge: () => void }) {
  const nb = nextBadge(state.current)
  const rp = rankProgress(state.current)
  const now = useTicker(!!state.urgeStartedAt)
  const urgeLeft = state.urgeStartedAt ? Math.min(URGE_WAVE_SECONDS * 1000, Math.max(0, URGE_WAVE_SECONDS * 1000 - (now - Date.parse(state.urgeStartedAt)))) : 0
  return (
    <section className={`dx-hero ${justChecked ? 'is-won' : ''}`} aria-label="Your streak">
      <button className="btn small ghost privacy-eye" aria-pressed={blurred} title={blurred ? 'Show the numbers' : 'Hide the numbers (privacy blur)'} onClick={onBlur}>
        <Icon name="eye" size={14} /> {blurred ? 'Hidden: tap to show' : 'Hide'}
      </button>

      <div className="dx-streak dx-private">
        <Ring size={188} stroke={12} pct={nb?.pct ?? 1} className="dx-streak-ring" label={`Day ${dayShown(state)}`}>
          <Flame size={26} />
          <span className="dx-days-l">Day</span>
          <span className="dx-days" data-testid="dx-day">
            <CountUp value={dayShown(state)} />
          </span>
        </Ring>
        <span className="dx-streak-next">{nb ? `${nb.days - state.current} ${nb.days - state.current === 1 ? 'day' : 'days'} to ${nb.name.toLowerCase()}` : 'Every badge earned'}</span>
      </div>

      <div className="dx-mid">
        <span className="dx-kicker">
          <Icon name="shield" size={13} /> Private streak
        </span>
        <h2 className="dx-title">{todayLine(state)}</h2>
        <p className="dx-since dx-private">
          Clean since <b>{state.since ? friendlyDate(state.since, state.today) : 'today'}</b>
          {state.best > state.current && <> · your best is {state.best} days</>}
          {state.best > 0 && state.best === state.current && <> · this is your best streak yet</>}
        </p>
        <div className="dx-actions">
          <CheckInButton state={state} won={justChecked} onCheckIn={onCheckIn} />
          <HoldButton done={state.oathToday} onDone={onOath} />
          <button className="btn urge-btn" onClick={onUrge}>
            <Icon name="bolt" size={15} /> {state.urgeStartedAt ? `Urge timer ${mmss(urgeLeft)}` : 'I feel an urge'}
          </button>
        </div>
        <span className="hint dx-panic">
          From anywhere: <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>U</kbd>
        </span>
        <figure className="dx-quote" key={state.quote}>
          <span className="dx-quote-mark" aria-hidden="true">
            “
          </span>
          <blockquote>{state.quote}</blockquote>
          <figcaption>Today's line · a new one tomorrow</figcaption>
        </figure>
      </div>

      <div className="dx-rank dx-private">
        <Ring size={136} stroke={8} pct={rp.pct} className="dx-rank-ring" label={`Rank ${rp.name}`}>
          <Emblem tier={rp.tier} state="current" size={74} />
        </Ring>
        <span className="dx-rank-l">Rank {rp.tier} of 8</span>
        <b className="dx-rank-name">{rp.name}</b>
        <span className="dx-rank-next">{rp.next ? `${rp.left} ${rp.left === 1 ? 'day' : 'days'} to ${rp.next.name}` : 'The top rank'}</span>
      </div>
    </section>
  )
}

function Stats({ state }: { state: DisciplineState }) {
  const tiles: { label: string; value: string; note: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
    { label: 'Best streak', value: `${state.best} d`, note: state.best === state.current && state.best > 0 ? 'You are on it now' : 'Your record', icon: 'trophy' },
    { label: 'Total clean days', value: `${state.totalClean}`, note: 'Every streak counts', icon: 'calendar' },
    { label: 'Urges beaten this week', value: state.urgesThisWeek ? `${state.urgesThisWeek}` : 'None yet', note: 'Last 7 days', icon: 'bolt' },
    { label: 'Resets', value: `${state.resets}`, note: state.resets ? 'Honest, every one' : 'Not one', icon: 'refresh' }
  ]
  return (
    <section className="dx-stats" aria-label="Your numbers">
      {tiles.map((t) => (
        <div key={t.label} className="dx-stat">
          <span className="dx-stat-i" aria-hidden="true">
            <Icon name={t.icon} size={16} />
          </span>
          <span className="dx-stat-l">{t.label}</span>
          <b className="dx-stat-v dx-private">{t.value}</b>
          <small>{t.note}</small>
        </div>
      ))}
    </section>
  )
}

function RankLadder({ current }: { current: number }) {
  const ladder = rankLadder(current)
  return (
    <div className="dx-ladder dx-private" aria-label="Rank ladder">
      {ladder.map((r) => (
        <div key={r.name} className={`dx-rung ${r.state}`} title={r.state === 'locked' ? `${r.name}: unlocks at ${r.days} days` : r.name}>
          <Emblem tier={r.tier} state={r.state} size={40} />
          <b>{r.name}</b>
          <small>{r.days ? `${r.days} d` : 'Start'}</small>
        </div>
      ))}
    </div>
  )
}

function Badges({ state }: { state: DisciplineState }) {
  const badges = badgesOf(state.current, state.best)
  return (
    <>
      <h3 className="dx-sub">Day badges</h3>
      <div className="dx-badges dx-private">
        {badges.map((b) => (
          <div key={b.days} className={`dx-badge ${b.state}`}>
            <Medal days={b.days} state={b.state} />
            <b>{b.name}</b>
            <small>{b.state === 'now' ? 'Holding it' : b.state === 'earned' ? 'Earned before' : b.state === 'next' ? `${b.left} ${b.left === 1 ? 'day' : 'days'} to go` : `${b.days} days`}</small>
          </div>
        ))}
      </div>
    </>
  )
}

function CoinMilestones({ state, claimable, onClaim }: { state: DisciplineState; claimable: number; onClaim: (days: number) => void }) {
  return (
    <>
      <h3 className="dx-sub">
        Points milestones {claimable > 0 && <span className="dx-pill">{claimable} to claim</span>}
      </h3>
      <div className="dx-coins dx-private">
        {state.milestones.map((x) => (
          <div key={x.days} className={`dx-coin ${x.status}`} title={x.status === 'before-setup' ? 'Reached before you set this up: no coins' : undefined}>
            <b>{x.days} d</b>
            <Coins n={x.coins} />
            {x.status === 'claimable' ? (
              <button className="btn small primary" onClick={() => onClaim(x.days)}>
                Claim
              </button>
            ) : (
              <small>{x.status === 'claimed' ? 'Paid' : x.status === 'before-setup' ? 'Reached' : ''}</small>
            )}
          </div>
        ))}
      </div>
      <p className="hint small">Paid when your check-in reaches the day. Days before you set this up show as reached, with no coins.</p>
    </>
  )
}

function Campaign({ day: n }: { day: number }) {
  const day = Math.min(n, 90)
  return (
    <div className="dx-campaign dx-private" data-testid="dx-campaign" aria-label={`Day ${day} of 90`}>
      <div className="dx-campaign-top">
        <span>90-day campaign</span>
        <b>Day {day} of 90</b>
      </div>
      <div className="dx-campaign-bar">
        <i style={{ width: `${(day / 90) * 100}%` }} />
        {[3, 7, 14, 30, 60].map((d) => (
          <span key={d} className={`dx-tick ${day >= d ? 'on' : ''}`} style={{ left: `${(d / 90) * 100}%` }} title={`Day ${d}`} />
        ))}
      </div>
    </div>
  )
}

const HEAT_WORDS: Record<HeatCell['state'], string> = { clean: 'checked in clean', reset: 'honest reset', open: 'not checked in', before: 'before you started', future: '' }

function History({ state }: { state: DisciplineState }) {
  const marks = state.history ?? []
  const start = state.startedOn ?? state.since
  const h = heatmap(marks, state.today, start, 26)
  const weeks = urgesPerWeek(marks, state.today, 8)
  const maxW = Math.max(1, ...weeks.map((w) => w.count))
  const runs = state.runs ?? []
  const best = bestRun(runs)
  const list = [...runs].reverse()
  const longest = Math.max(1, ...runs.map((r) => r.days))
  const cleanCount = h.columns.flat().filter((c) => c.state === 'clean').length
  return (
    <section className="panel dx-card dx-history" aria-labelledby="dx-hist-h">
      <header className="dx-head">
        <h2 id="dx-hist-h">History</h2>
        <span className="hint dx-private">{cleanCount ? `${cleanCount} checked-in days in 6 months` : 'Your check-ins show up here'}</span>
      </header>

      <div className="dx-heat dx-private" aria-label="The last 6 months">
        <div className="dx-heat-months" style={{ gridTemplateColumns: `repeat(${h.columns.length}, 1fr)` }}>
          {h.months.map((mo) => (
            <span key={mo.col} style={{ gridColumn: `${mo.col + 1} / span 3` }}>
              {mo.label}
            </span>
          ))}
        </div>
        <div className="dx-heat-body">
          <div className="dx-heat-days" aria-hidden="true">
            <span>Mon</span>
            <span />
            <span>Wed</span>
            <span />
            <span>Fri</span>
            <span />
            <span>Sun</span>
          </div>
          <div className="dx-heat-grid" style={{ gridTemplateColumns: `repeat(${h.columns.length}, 1fr)` }}>
            {h.columns.map((col, i) => (
              <div key={i} className="dx-heat-col">
                {col.map((c) => (
                  <span
                    key={c.day}
                    className={`dx-hc ${c.state} ${c.day === state.today ? 'today' : ''} ${c.urges ? 'urge' : ''}`}
                    title={c.state === 'future' ? undefined : `${shortDate(c.day, state.today)}: ${HEAT_WORDS[c.state]}${c.urges ? `, ${c.urges} urge${c.urges > 1 ? 's' : ''} beaten` : ''}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="dx-legend">
          <span><i className="dx-hc clean" /> Checked in</span>
          <span><i className="dx-hc open" /> Not checked in</span>
          <span><i className="dx-hc reset" /> Reset</span>
          <span><i className="dx-hc open urge" /> Urge beaten</span>
        </div>
      </div>

      <div className="dx-hist-row">
        <div className="dx-weeks dx-private">
          <h3 className="dx-sub">Urges beaten per week</h3>
          <div className="dx-wbars" role="img" aria-label={`Urges beaten per week: ${weeks.map((w) => w.count).join(', ')}`}>
            {weeks.map((w) => (
              <div key={w.from} className={`dx-wbar ${w.label === 'This week' ? 'now' : ''}`} title={`Week of ${shortDate(w.from)}: ${w.count}`}>
                <b>{w.count || ''}</b>
                <i style={{ height: `${Math.max(w.count ? 8 : 2, (w.count / maxW) * 100)}%` }} />
                <small>{w.label === 'This week' ? 'Now' : w.label.split(' ')[0]}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="dx-record dx-private">
          <h3 className="dx-sub">Longest streak</h3>
          <div className="dx-record-v">
            <Icon name="trophy" size={18} />
            <b>{best?.days ?? 0}</b>
            <span>days</span>
          </div>
          <small>{best ? (best.ended === 'now' ? `${shortDate(best.from, state.today)} → today, and counting` : `${shortDate(best.from, state.today)} → ${shortDate(best.to, state.today)}`) : 'Starts with your first day'}</small>
        </div>
      </div>

      <h3 className="dx-sub">Your streaks</h3>
      <ul className="dx-runs dx-private">
        {list.map((r) => (
          <li key={r.from + r.to} className={r.ended}>
            <span className="dx-run-dot" aria-hidden="true" />
            <div className="dx-run-main">
              <b>{r.ended === 'now' ? `${r.days} ${r.days === 1 ? 'day' : 'days'} and counting` : `${r.days} ${r.days === 1 ? 'day' : 'days'}`}</b>
              <small>
                {shortDate(r.from, state.today)} → {r.ended === 'now' ? 'today' : `${shortDate(r.to, state.today)} · ended with an honest reset`}
              </small>
              <i className="dx-run-bar" style={{ width: `${Math.max(3, (r.days / longest) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <p className="hint small dx-kind">
        {state.resets
          ? `${state.resets} honest ${state.resets === 1 ? 'reset' : 'resets'}. Each one was the truth, and the days before it still count: ${state.totalClean} clean in total.`
          : 'No resets. If one ever comes, telling the truth is the strong move: your best and your total stay.'}
      </p>
    </section>
  )
}

function UrgeTools({ state, onOpen, onWhy }: { state: DisciplineState; onOpen: () => void; onWhy: (t: string) => Promise<unknown> }) {
  const c = disciplineCharts(state.history ?? [], state.today, state.startedOn ?? state.since, 26)
  const max = Math.max(1, ...c.byTime.map((b) => b.count))
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState(state.why ?? '')
  const [windows, setWindows] = useState<string[]>([])
  useEffect(() => {
    life.discipline.patterns?.().then((p) => setWindows(p.windows.slice(0, 2))).catch(() => {})
  }, [])
  return (
    <section className="panel dx-card dx-tools" aria-labelledby="dx-tools-h">
      <header className="dx-head">
        <h2 id="dx-tools-h">Urge tools</h2>
      </header>
      <button className="dx-crush" onClick={onOpen}>
        <span className="dx-crush-i" aria-hidden="true">
          <Icon name="bolt" size={20} />
        </span>
        <span>
          <b>Open the urge crusher</b>
          <small>Breathing, a 10-minute timer, quick swaps and your why</small>
        </span>
      </button>

      <h3 className="dx-sub">Your why</h3>
      {edit || !state.why ? (
        <div className="dx-why-edit">
          <textarea rows={2} maxLength={300} value={draft} placeholder="Why does this streak matter to you? The crusher shows it when an urge hits." onChange={(e) => setDraft(e.target.value)} aria-label="Your why" />
          <div className="row end">
            {state.why && (
              <button className="btn small ghost" onClick={() => (setDraft(state.why ?? ''), setEdit(false))}>
                Cancel
              </button>
            )}
            <button className="btn small primary" disabled={!draft.trim() || draft.trim() === state.why} onClick={async () => (await onWhy(draft), setEdit(false))}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <button className="dx-why dx-private" onClick={() => setEdit(true)} title="Click to change">
          “{state.why}”
        </button>
      )}

      <h3 className="dx-sub">When urges come</h3>
      {c.urges === 0 ? (
        <p className="empty-note">No urges logged yet. When one comes, open the crusher and this shows your risky times.</p>
      ) : (
        <div className="disc-bars dx-private">
          {c.byTime.map((b) => (
            <div key={b.label} className="disc-bar">
              <span>{b.label}</span>
              <i style={{ width: `${(b.count / max) * 100}%` }} />
              <b>{b.count}</b>
            </div>
          ))}
        </div>
      )}
      {windows.length > 0 && <p className="hint small dx-private">Ben watches: {windows.join(', ')}.</p>}
    </section>
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
      <button className="btn dx-oath done" disabled>
        <Icon name="spark" size={15} /> Oath sworn today
      </button>
    )
  }
  return (
    <button
      className={`btn hold dx-oath ${holding ? 'holding' : ''}`}
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

/** MN3: the check-in says when it opens, instead of failing. */
function CheckInButton({ state, won, onCheckIn }: { state: DisciplineState; won: boolean; onCheckIn: () => void }) {
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
    <button
      className={`btn primary dx-checkin ${done ? 'done' : ''} ${won ? 'won' : ''}`}
      disabled={done || blockedByReset || w?.mode === 'wait'}
      onClick={onCheckIn}
      title="You check in a day once you've lived it: from 19:00, or the next morning until 12:00"
    >
      <span className="dx-check-i" aria-hidden="true">
        <Icon name="check" size={17} />
      </span>
      {label}
    </button>
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
    <section className="panel dx-card reflection" aria-labelledby="dx-refl-h">
      <header className="dx-head">
        <h2 id="dx-refl-h">Reflection</h2>
        <span className="hint">Saved in your Notebook. No points: it's for you.</span>
      </header>
      <label className="reflect-q" htmlFor="reflect-text">
        {prompt}
      </label>
      <textarea id="reflect-text" rows={2} value={text} placeholder="A sentence or two is enough." onChange={(e) => setText(e.target.value)} />
      <div className="row end">
        <button className="btn small primary" disabled={!text.trim()} onClick={() => void save()}>
          Save
        </button>
      </div>
      {recent && recent.length > 0 && (
        <ul className="reflect-list dx-private">
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
