// The evening shut-down card (LT11: split out of DayFlow.tsx).
import { useEffect, useState } from 'react'
import type { TodoTask } from '@core/todoist'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { localToday } from '../todayEvents'
import { soundSuccess } from '../soundKit'
import { useAction } from '../ui'
import { tomorrowOf } from './util'

export const REASONS = ['Phone', 'Tired', 'Unclear task', 'Too much planned', 'Interrupted', 'Good day']

export function ShutDown({ today, focusMin, doneToday, planLen, openMustDos, openTodo, onTomorrow, onMustDoTomorrow, onClose, onSaved }: {
  today: string
  focusMin: number
  doneToday: number
  planLen: number
  todoDone: number
  openMustDos: string[]
  openTodo: TodoTask[]
  onTomorrow: (t: TodoTask) => Promise<void>
  onMustDoTomorrow: (text: string) => Promise<void>
  onClose: () => void
  onSaved: () => void
}) {
  const act = useAction()
  const [text, setText] = useState('')
  const [reasons, setReasons] = useState<string[]>([])
  const [moved, setMoved] = useState<string[]>([])
  // Step 3 (D3): bedtime tonight and tomorrow's wake-up target.
  const tomorrow = tomorrowOf(today)
  const tomorrowWeekend = [0, 6].includes(new Date(`${tomorrow}T12:00:00Z`).getUTCDay())
  const [sleepT, setSleepT] = useState<{ weekday: string; weekend: string; bed: string } | null>(null)
  const [bed, setBed] = useState('')
  const [wake, setWake] = useState('')
  useEffect(() => {
    life.sleep
      .state()
      .then((st: any) => {
        const t = { weekday: st.weekdayTarget ?? '07:00', weekend: st.weekendTarget ?? '08:30', bed: st.bedTarget ?? '23:00' }
        setSleepT(t)
        setBed(t.bed)
        setWake(tomorrowWeekend ? t.weekend : t.weekday)
      })
      .catch(() => {})
  }, [tomorrowWeekend])
  const sleepHours = (() => {
    const m = (x: string) => (/^\d{2}:\d{2}$/.test(x) ? Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) : null)
    const b = m(bed)
    const w = m(wake)
    if (b == null || w == null) return null
    const d = (w - b + 1440) % 1440
    return `${Math.floor(d / 60)}h${d % 60 ? ` ${d % 60}m` : ''}`
  })()
  const save = async () => {
    if (sleepT && (bed !== sleepT.bed || wake !== (tomorrowWeekend ? sleepT.weekend : sleepT.weekday))) {
      await life.sleep.setTargets(tomorrowWeekend ? sleepT.weekday : wake, tomorrowWeekend ? wake : sleepT.weekend, bed).catch(() => null)
    }
    if (await act(() => life.focus.review(text || null, reasons.length ? reasons : ['Reviewed']), `Day closed. Bed by ${bed || '23:00'}, up at ${wake || '07:00'}. Sleep well.`)) {
      soundSuccess()
      onSaved()
    }
  }
  const left = [...openMustDos.map((m) => ({ id: `m:${m}`, title: m, todo: null as TodoTask | null })), ...openTodo.map((t) => ({ id: t.id, title: t.content, todo: t }))].filter((x) => !moved.includes(x.id))
  // Ben's review of the day (score, lesson, tomorrow's top 3) sits in here, not in a card of its own.
  const [review, setReview] = useState<{ score: number; lesson?: string; top3: string[] } | null>(null)
  useEffect(() => {
    life.coach?.rhythm?.('state').then((d: any) => setReview(d?.state?.evening ?? null)).catch(() => {})
  }, [])
  const moveAll = async () => {
    const all = left
    setMoved((m) => [...m, ...all.map((x) => x.id)])
    for (const x of all) await (x.todo ? onTomorrow(x.todo) : onMustDoTomorrow(x.title)).catch(() => null)
  }
  return (
    <section className="mode-card evening" aria-label="Shut down your day">
      <header>
        <span className="mode-label">
          <Icon name="moon" size={14} /> Evening · shut down in 2 minutes
        </span>
        <button className="btn small ghost" onClick={onClose}>
          Later
        </button>
      </header>
      <p className="mode-sum">
        <b>{doneToday}/{planLen || 0}</b> must-dos · <b>{focusMin >= 60 ? `${Math.floor(focusMin / 60)}h ${focusMin % 60}m` : `${focusMin}m`}</b> focus today
      </p>
      {review && (
        <div className="mode-review">
          <span className={`mode-score ${review.score >= 70 ? 'good' : ''}`}>{review.score}</span>
          <div>
            <b>Ben's review</b>
            {review.lesson && <p>{review.lesson}</p>}
            {review.top3.length > 0 && <small>Tomorrow: {review.top3.join(' · ')}</small>}
          </div>
        </div>
      )}
      <ol className="mode-steps">
        <li className={left.length ? '' : 'done'}>
          <b>
            1. What's left{left.length > 1 && (
              <button className="btn small mode-all" onClick={() => void moveAll()}>
                Move all {left.length} to tomorrow
              </button>
            )}
          </b>
          {left.length ? (
            <ul className="mode-left">
              {left.map((x) => (
                <li key={x.id}>
                  <span>{x.title}</span>
                  <button
                    className="btn small ghost"
                    onClick={async () => {
                      setMoved((m) => [...m, x.id])
                      await (x.todo ? onTomorrow(x.todo) : onMustDoTomorrow(x.title))
                    }}
                  >
                    → Tomorrow
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <span className="hint">Nothing left for {today === localToday() ? 'today' : 'the day'}. Clean finish.</span>
          )}
        </li>
        <li>
          <b>2. How did it go?</b>
          <div className="chips">
            {REASONS.map((r) => (
              <button key={r} type="button" className={`chip ${reasons.includes(r) ? 'on' : ''}`} onClick={() => setReasons((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))}>
                {r}
              </button>
            ))}
          </div>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="One line about today (optional)" maxLength={300} />
        </li>
        <li>
          <b>3. Bed and tomorrow</b>
          <div className="mode-sleep">
            <label>
              Bed by <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
            </label>
            <label>
              Up at <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
            </label>
            {sleepHours && <span className="hint">{sleepHours} of sleep</span>}
          </div>
          <span className="hint small">Changes your {tomorrowWeekend ? 'weekend' : 'weekday'} wake-up target and your bedtime target (Waky and reminders use them).</span>
        </li>
      </ol>
      <div className="row">
        <button className="btn primary" onClick={() => void save()}>
          <Icon name="check" size={13} /> Close my day
        </button>
      </div>
    </section>
  )
}
