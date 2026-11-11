// Today → Now since the feature freeze (2026-11-11): the 3 daily numbers and
// nothing else. Sleep (asleep by 23:30, up by 06:45, from last night's log),
// focus blocks started today, and exactly 3 must-dos (done out of 3). Under
// them: the next calendar block, the honest day score (core/threeNumbers.ts)
// and, from 21:15, "Pick tomorrow's 3" (concrete items only: core/mustDoRule.ts).
// Ticking a must-do pays as before (honest points: only for something done now).
import { useCallback, useEffect, useState } from 'react'
import { addDays, appHour } from '@core/dates'
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
  const load = useCallback(() => void life.coach?.status?.().then(setSt).catch(() => {}), [])
  useEffect(load, [load])
  useLive(load)
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
  const startBlock = async () => {
    const subject = items.find((x) => !x.done)?.text ?? 'Focus'
    await act(() => life.focus.start(subject.slice(0, 40), 25, null), 'Focus block started: 25 min')
    load()
  }

  return (
    <section className="tn" data-testid="three-numbers" aria-label="Today's 3 numbers">
      <div className="tn-row">
        <article className={`tn-tile ${sleep.met ? 'ok' : sleep.bedOk == null && sleep.upOk == null ? '' : 'off'}`} data-n="sleep">
          <small className="tn-label">Sleep · last night</small>
          <b className="tn-big num" data-testid="tn-sleep">{sleep.bedOk == null && sleep.upOk == null ? '—' : sleep.met ? 'On time' : 'Off target'}</b>
          <span className="tn-sub" data-testid="tn-sleep-result">{sleep.text}</span>
          <span className="tn-target">Target: asleep by {BED_BY}, up by {UP_BY}</span>
        </article>
        <article className={`tn-tile ${blocks >= FOCUS_GOAL ? 'ok' : ''}`} data-n="focus">
          <small className="tn-label">Focus blocks started</small>
          <b className="tn-big num" data-testid="tn-focus">{blocks}</b>
          <span className="tn-sub">{blocks >= FOCUS_GOAL ? 'Enough for today' : `${FOCUS_GOAL - blocks} more to reach ${FOCUS_GOAL}`}</span>
          <button className="btn small primary" onClick={() => void startBlock()}>▶ Start a 25 min block</button>
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
              <input value={adding} onChange={(e) => (setAdding(e.target.value), setAddErr(null))} placeholder={items.length ? 'Add one (with minutes or a number)' : 'Your first must-do, e.g. "read 20 pages"'} aria-label="Add a must-do" />
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
        <span className="tn-score" data-testid="day-score" title="Sleep 34 + focus blocks 33 + must-dos 33 (out of 3). No must-dos: that part is 0.">
          Day score <b className="num">{score}</b>/100
        </span>
      </footer>
      {pickTime(new Date(tick)) && <PickTomorrow />}
    </section>
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
