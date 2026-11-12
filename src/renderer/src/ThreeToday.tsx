// Today → Now since the feature freeze (2026-11-11): the 3 daily numbers and
// nothing else. Sleep (asleep by 23:30, up by 06:45, from last night's log),
// focus blocks started today, and exactly 3 must-dos (done out of 3). Under
// them: the next calendar block, the honest day score (core/threeNumbers.ts)
// and "Pick tomorrow's 3" (open by itself from 21:15, any time from "Set
// tomorrow's 3"; concrete items only: core/mustDoRule.ts).
// Ticking a must-do pays as before (honest points: only for something done now).
// Usability pass (2026-11-12): the sleep tile logs last night in place (a typed
// bedtime is a record only, no points; the wake-up pays only when typed within
// 20 minutes of getting up, as everywhere), the focus tile names the must-do it
// starts and shows a running block with Stop.
import { useCallback, useEffect, useState } from 'react'
import type { FocusState } from '@shared/api'
import { addDays, appHour } from '@core/dates'
import { focusEndsAt } from '@core/focus'
import { localDay } from '@core/dayTime'
import { countdown, nextUp } from '@core/dayGlance'
import { BED_BY, FOCUS_GOAL, MUST_DOS, UP_BY, honestScore, sleepCheck } from '@core/threeNumbers'
import { checkPick, vagueReason } from '@core/mustDoRule'
import type { CoachStatus } from './web/coachStatus'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'
import { useTodayEvents } from './todayEvents'
import './threeToday.css'

const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)

/** From 21:15 (until the day turns at 04:00): time to pick tomorrow's 3. */
export function pickTime(d: Date): boolean {
  const h = appHour(d)
  return h > 21 || (h === 21 && d.getMinutes() >= 15)
}

export function ThreeToday() {
  const act = useAction()
  const [st, setSt] = useState<CoachStatus | null>(null)
  const [adding, setAdding] = useState('')
  const [addErr, setAddErr] = useState<string | null>(null)
  const [tick, setTick] = useState(() => Date.now())
  const [focus, setFocus] = useState<FocusState | null>(null)
  const [sleepOpen, setSleepOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const load = useCallback(() => {
    void life.coach?.status?.().then(setSt).catch(() => {})
    void life.focus.state().then(setFocus).catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  // A must-do ticked or a focus block started elsewhere on this device (the island, Ben, the timer) shows at once.
  useEffect(() => {
    const evs = ['life-focus-changed', 'life-wallet-changed', 'life-sleep-changed']
    for (const e of evs) window.addEventListener(e, load)
    return () => {
      for (const e of evs) window.removeEventListener(e, load)
    }
  }, [load])
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const { events } = useTodayEvents()
  const timed = events.filter((e) => !e.allDay && localDay(e.start) === localDay(new Date(tick).toISOString()))
  const next = nextUp(timed, tick)

  const t = st?.today
  const sleep = sleepCheck(t?.sleep ?? null)
  const blocks = t?.focusBlocks ?? 0
  const items = (st?.mustdos ?? []).slice(0, MUST_DOS)
  const mustDone = items.filter((x) => x.done).length
  const score = honestScore({ sleep: t?.sleep ?? null, focusBlocks: blocks, mustDone, mustTotal: items.length }).score

  const toggle = async (i: number) => {
    await act(() => life.focus.togglePlan(i))
    load()
  }
  const add = async () => {
    const text = adding.trim()
    const why = vagueReason(text)
    if (why) return setAddErr(why)
    setAddErr(null)
    const ok = await act(() => life.focus.setPlan([...(st?.mustdos ?? []).map((x) => x.text), text]), 'Must-do added')
    if (ok) {
      setAdding('')
      load()
    }
  }
  const firstOpen = items.find((x) => !x.done)?.text ?? null
  const startBlock = async () => {
    const subject = firstOpen ?? 'Focus'
    await act(() => life.focus.start(subject.slice(0, 40), 25, null), 'Focus block started: 25 min')
    window.dispatchEvent(new Event('life-focus-changed'))
    load()
  }
  const run = focus?.running ?? null
  const runLeft = run ? Math.round((focusEndsAt(run) - tick) / 60_000) : 0
  const stopBlock = async () => {
    await act(() => life.focus.stop(), 'Focus block logged')
    window.dispatchEvent(new Event('life-focus-changed'))
    load()
  }
  const sleepEmpty = sleep.bedOk == null && sleep.upOk == null
  const showPick = pickOpen || pickTime(new Date(tick))

  return (
    <section className="tn" data-testid="three-numbers" aria-label="Today's 3 numbers">
      <div className="tn-row">
        <article className={`tn-tile ${sleep.met ? 'ok' : sleep.bedOk == null && sleep.upOk == null ? '' : 'off'}`} data-n="sleep">
          <small className="tn-label">Sleep · last night</small>
          <b className="tn-big num" data-testid="tn-sleep">{sleep.bedOk == null && sleep.upOk == null ? '—' : sleep.met ? 'On time' : 'Off target'}</b>
          <span className="tn-sub" data-testid="tn-sleep-result">{sleep.text}</span>
          <span className="tn-target">Target: asleep by {BED_BY}, up by {UP_BY}</span>
          {sleepOpen || sleepEmpty ? (
            <SleepForm
              night={t?.sleep ?? null}
              onSaved={() => {
                setSleepOpen(false)
                load()
              }}
            />
          ) : (
            <button className="tn-link" data-testid="tn-sleep-open" onClick={() => setSleepOpen(true)}>
              Change last night
            </button>
          )}
        </article>
        <article className={`tn-tile ${blocks >= FOCUS_GOAL ? 'ok' : ''}`} data-n="focus">
          <small className="tn-label">Focus blocks started</small>
          <b className="tn-big num" data-testid="tn-focus">{blocks}</b>
          {run ? (
            <>
              <span className="tn-sub tn-running" data-testid="tn-running">
                Running: <b>{run.subject}</b> · {run.pausedAt ? 'paused' : runLeft > 0 ? `${runLeft} min left` : 'time is up'}
              </span>
              <button className="btn small" data-testid="tn-stop" onClick={() => void stopBlock()}>⏹ Stop and log</button>
            </>
          ) : (
            <>
              <span className="tn-sub">{blocks >= FOCUS_GOAL ? 'Enough for today' : `${FOCUS_GOAL - blocks} more to reach ${FOCUS_GOAL}`}</span>
              <button className="btn primary tn-start" data-testid="tn-start" onClick={() => void startBlock()} title="A 25 minute focus block">
                ▶ {firstOpen ? <>Start “{firstOpen}”</> : 'Start a focus block'} · 25 min
              </button>
            </>
          )}
        </article>
        <article className={`tn-tile ${items.length && mustDone >= MUST_DOS ? 'ok' : ''}`} data-n="must">
          <small className="tn-label">Must-dos</small>
          <b className="tn-big num" data-testid="tn-must">{mustDone} / {MUST_DOS}</b>
          <ul className="tn-list">
            {items.map((x) => (
              <li key={x.i} className={x.done ? 'done' : ''}>
                <button className="tn-check" aria-pressed={x.done} aria-label={x.done ? `Done: ${x.text}` : `Mark done: ${x.text}`} onClick={() => void toggle(x.i)}>
                  {x.done ? '✓' : ''}
                </button>
                <span>{x.text}</span>
              </li>
            ))}
          </ul>
          {items.length < MUST_DOS && (
            <form
              className="tn-add"
              onSubmit={(e) => {
                e.preventDefault()
                void add()
              }}
            >
              <input value={adding} onChange={(e) => (setAdding(e.target.value), setAddErr(null))} placeholder={items.length ? 'Next one, e.g. "math 40 min"' : 'e.g. "read 20 pages"'} aria-label="Add a must-do" />
              <button className="btn small" type="submit">Add</button>
            </form>
          )}
          {addErr && <p className="tn-err" role="alert">{addErr}</p>}
        </article>
      </div>
      <footer className="tn-foot">
        <span className="tn-next" data-testid="tn-next">
          {next ? (
            <>
              Next: <b>{next.title}</b> {hm(next.start)} <i>{countdown(Date.parse(next.start) - tick)}</i>
            </>
          ) : (
            'Nothing more in your calendar today'
          )}
        </span>
        <span className="tn-foot-r">
          {!showPick && (
            <button className="tn-link" data-testid="plan-tomorrow" onClick={() => setPickOpen(true)}>
              Set tomorrow's 3
            </button>
          )}
          <span className="tn-score" data-testid="day-score" title="Sleep 34 + focus blocks 33 + must-dos 33 (out of 3). No must-dos: that part is 0.">
            Day score <b className="num">{score}</b>/100
          </span>
        </span>
      </footer>
      {showPick && <PickTomorrow />}
    </section>
  )
}

/**
 * Last night in place: asleep at, up at. The bedtime is a record only (no
 * points: it is typed afterwards); the wake-up goes through setWake, which pays
 * only when it is typed within 20 minutes of getting up (src/main/sleep.ts).
 */
function SleepForm({ night, onSaved }: { night: { bedTime: string | null; wakeTime: string | null } | null; onSaved: () => void }) {
  const act = useAction()
  const [bed, setBed] = useState(night?.bedTime ?? '')
  const [up, setUp] = useState(night?.wakeTime ?? '')
  const save = async () => {
    const f = await life.focus.state().catch(() => null)
    const today = f?.today ?? new Date().toISOString().slice(0, 10)
    const ok = await act(async () => {
      if (up) await life.sleep.setWake(today, up)
      if (bed && life.sleep.setBed) await life.sleep.setBed(today, bed)
      window.dispatchEvent(new Event('life-sleep-changed'))
      return true
    }, 'Last night saved')
    if (ok) onSaved()
  }
  return (
    <form
      className="tn-sleep-form"
      data-testid="tn-sleep-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label>
        Asleep at <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} aria-label="Asleep at" />
      </label>
      <label>
        Up at <input type="time" value={up} onChange={(e) => setUp(e.target.value)} aria-label="Up at" />
      </label>
      <button className="btn small" type="submit" disabled={!bed && !up}>
        Save
      </button>
    </form>
  )
}

/** "Pick tomorrow's 3": exactly 3, each concrete (a number or minutes). */
export function PickTomorrow() {
  const act = useAction()
  const [text, setText] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const save = async () => {
    const r = checkPick(text)
    if (!r.ok) return setMsg({ ok: false, text: r.reply })
    const f = await life.focus.state().catch(() => null)
    const tomorrow = addDays(f?.today ?? new Date().toISOString().slice(0, 10), 1)
    const done = await act(() => life.focus.setPlan(r.items, tomorrow), "Tomorrow's 3 are saved")
    if (done) {
      setMsg({ ok: true, text: r.reply })
      setText('')
    }
  }
  return (
    <form
      className="tn-pick"
      data-testid="pick-tomorrow"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label>
        <b>Pick tomorrow's 3</b> <small>One per line, each with minutes or a number ("sport: 25 min, 30 push-ups").</small>
        <textarea rows={3} value={text} onChange={(e) => (setText(e.target.value), setMsg(null))} aria-label="Tomorrow's 3 must-dos" />
      </label>
      <button className="btn small primary" type="submit">Save tomorrow's 3</button>
      {msg && (
        <p className={msg.ok ? 'tn-ok' : 'tn-err'} role={msg.ok ? 'status' : 'alert'} data-testid="pick-reply">
          {msg.text}
        </p>
      )}
    </form>
  )
}
