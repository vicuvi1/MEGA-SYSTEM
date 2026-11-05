// Insights, the longer views: planned vs real time this week (FT10), how mood
// moves with sleep and training (FT13), the month review (FT11) and your
// year (FT12). Calm cards, theme tokens only.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useLive } from '../live'
import { useAction } from '../ui'
import type { PageId } from '../modules'
import type { CalEvent } from '@core/dayTime'
import { recapSeason } from '@core/yearRecap'
import type { WeekTime } from '@core/plannedVsReal'
import type { MonthView, MoodView } from '../web/lifeExtras'
import type { YearRecap } from '@core/yearRecap'
import '../lifeExtras.css'

export type InsightsTab = 'week' | 'month' | 'year'
const TAB_KEY = 'ls.insightsTab'

export function savedTab(): InsightsTab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return v === 'month' || v === 'year' ? v : 'week'
  } catch {
    return 'week'
  }
}
export function saveTab(t: InsightsTab) {
  try {
    localStorage.setItem(TAB_KEY, t)
  } catch {
    /* this visit only */
  }
}

/** Opens Insights on "Your year" (the menu, Today in December). */
export function openYear(onGo?: (p: PageId) => void) {
  saveTab('year')
  window.dispatchEvent(new CustomEvent('life-insights-tab', { detail: 'year' }))
  if (onGo) onGo('progress')
  else window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'progress' }))
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(Math.round(min % 60)).padStart(2, '0') : ''}` : `${Math.round(min)}m`)
const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** This week's calendar (Monday to now), or nothing when Google isn't connected. */
async function weekEvents(): Promise<CalEvent[]> {
  if (!life.google) return []
  const now = new Date()
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return life.google.events(monday.toISOString(), now.toISOString()).catch(() => [])
}

// ------------------------------------------------- planned vs real (FT10)

export function PlannedVsReal() {
  const [w, setW] = useState<WeekTime | null>(null)
  const load = useCallback(() => {
    if (!life.extras) return
    void weekEvents().then((ev) => life.extras!.weekTime(ev).then(setW).catch(() => {}))
  }, [])
  useEffect(load, [load])
  if (!w) return null
  const max = Math.max(1, ...w.rows.map((r) => Math.max(r.plannedMin, r.realMin)))
  return (
    <section className="panel rv-card" aria-label="Planned vs real time">
      <header className="rv-head">
        <h3>Planned vs real, this week</h3>
        <small className="hint">
          {w.rows.length ? `${hm(w.plannedMin)} planned · ${hm(w.realMin)} done${w.pcWorkMin != null ? ` · PC work ${hm(w.pcWorkMin)}` : ''}` : 'nothing yet'}
        </small>
      </header>
      {!w.rows.length && <p className="hint small">Focus blocks in your calendar count as planned; the focus timer counts what you really did.</p>}
      <ul className="rv-bars">
        {w.rows.slice(0, 8).map((r) => (
          <li key={r.subject}>
            <span className="rv-label">{r.subject}</span>
            <span className="rv-track" aria-hidden="true">
              <i className="plan" style={{ width: `${(r.plannedMin / max) * 100}%` }} />
              <i className="real" style={{ width: `${(r.realMin / max) * 100}%` }} />
            </span>
            <small>
              {hm(r.realMin)} / {hm(r.plannedMin)}
              {r.skipped ? ` · ${r.skipped} skipped` : ''}
            </small>
          </li>
        ))}
      </ul>
      {w.rows.length > 0 && (
        <p className="rv-legend hint small">
          <i className="plan" /> planned <i className="real" /> done
        </p>
      )}
    </section>
  )
}

// ------------------------------------------------------- mood links (FT13)

export function MoodLinksCard() {
  const [v, setV] = useState<MoodView | null>(null)
  useEffect(() => {
    life.extras?.moods().then(setV).catch(() => {})
  }, [])
  if (!v) return null
  return (
    <section className="panel rv-card" aria-label="Mood, sleep and training">
      <header className="rv-head">
        <h3>What lifts your mood</h3>
        <small className="hint">from your mood check-ins, last 8 weeks</small>
      </header>
      {v.links.length ? (
        <ul className="rv-links">
          {v.links.map((l) => (
            <li key={l.id}>
              <b>{l.text}</b>
              <small>{l.change}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint small">
          {v.days < v.need ? `${v.days} of ${v.need} days with a mood check-in so far. Rate your mood with Ben (Coach → Today) and this fills in.` : 'No clear link yet between your mood and sleep or training.'}
        </p>
      )}
    </section>
  )
}

// -------------------------------------------------------- month review (FT11)

export function MonthReview() {
  const act = useAction()
  const [v, setV] = useState<MonthView | null>(null)
  const [aim, setAimText] = useState('')
  const load = useCallback(() => {
    life.extras
      ?.month()
      .then((m) => {
        setV(m)
        setAimText(m.nextAim ?? '')
      })
      .catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  if (!life.extras) return <p className="hint">The month review needs the web app.</p>
  if (!v) return null
  const s = v.now
  const save = async () => {
    const r = await act(() => life.extras!.setMonthAim(v.nextMonth, aim), aim.trim() ? `Aim for ${v.nextLabel} saved: Ben will keep you to it` : 'Aim cleared')
    if (r) setV(r)
  }
  return (
    <div className="rv-month">
      <section className="panel rv-card">
        <header className="rv-head">
          <h3>{s.label}</h3>
          <small className="hint">so far, against the same days of last month</small>
        </header>
        <div className="rv-compare">
          {v.compare.map((r) => (
            <div key={r.label} className={`rv-stat ${r.better === true ? 'better' : r.better === false ? 'worse' : ''}`}>
              <small>{r.label}</small>
              <b>{r.now}</b>
              <span>
                {r.better === true ? '▲ ' : r.better === false ? '▼ ' : ''}last month: {r.prev}
              </span>
            </div>
          ))}
        </div>
        {v.aim && (
          <p className="rv-aim-now">
            🎯 This month's aim: <b>{v.aim}</b>
          </p>
        )}
        {s.lines.length > 0 && (
          <ul className="rv-lines">
            {s.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {v.letter && <blockquote className="rv-letter">{v.letter}</blockquote>}
      </section>

      <section className="panel rv-card">
        <header className="rv-head">
          <h3>One aim for {v.nextLabel}</h3>
          <small className="hint">Ben keeps it in mind and asks about it</small>
        </header>
        <form
          className="rv-aim"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input value={aim} onChange={(e) => setAimText(e.target.value)} placeholder="e.g. Finish the Rust book · Sleep by 23:30" maxLength={160} aria-label={`Aim for ${v.nextLabel}`} />
          <button className="btn small primary" disabled={(aim.trim() || '') === (v.nextAim ?? '')}>
            Save
          </button>
        </form>
      </section>

      <section className="panel rv-card">
        <header className="rv-head">
          <h3>Past months</h3>
        </header>
        {!v.archive.length && <p className="hint small">Your past months show up here once there's something in them.</p>}
        <ul className="rv-archive">
          {v.archive.map((m) => (
            <li key={m.month}>
              <b>{m.label}</b>
              <span>
                {m.focusH}h focus · {m.trained} training day{m.trained === 1 ? '' : 's'}
                {m.avgSleep ? ` · sleep ${m.avgSleep}` : ''}
                {m.moodAvg != null ? ` · mood ${m.moodAvg}/5` : ''}
              </span>
              {(m.aim || m.letter) && (
                <small>
                  {m.aim ? `Aim: ${m.aim}` : ''}
                  {m.aim && m.letter ? ' · ' : ''}
                  {m.letter ? "Ben's letter saved" : ''}
                </small>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// ---------------------------------------------------------- your year (FT12)

export function YearRecapView() {
  const [year, setYear] = useState<number | undefined>(undefined)
  const [r, setR] = useState<(YearRecap & { years: number[] }) | null>(null)
  useEffect(() => {
    life.extras?.year(year).then(setR).catch(() => {})
  }, [year])
  if (!life.extras) return <p className="hint">Your year needs the web app.</p>
  if (!r) return null
  return (
    <div className="rv-year">
      <section className="panel rv-year-hero">
        <div>
          <span className="rv-kicker">{r.running ? 'Your year so far' : 'Your year'}</span>
          <h2>{r.year}</h2>
        </div>
        {r.years.length > 1 && (
          <div className="rv-years" role="tablist" aria-label="Year">
            {r.years.map((y) => (
              <button key={y} role="tab" aria-selected={y === r.year} className={y === r.year ? 'on' : ''} onClick={() => setYear(y)}>
                {y}
              </button>
            ))}
          </div>
        )}
      </section>
      {r.empty ? (
        <p className="hint">Nothing logged in {r.year} yet.</p>
      ) : (
        <div className="rv-grid">
          <div className="rv-tile">
            <small>Focus</small>
            <b>{r.focusH}h</b>
            <span>{r.bySubject[0] ? `most on ${r.bySubject[0].subject}` : ''}</span>
          </div>
          <div className="rv-tile">
            <small>Workouts</small>
            <b>{r.workouts}</b>
            <span>training days</span>
          </div>
          <div className="rv-tile">
            <small>Clean days</small>
            <b>{r.cleanDays}</b>
            <span>days without a slip</span>
          </div>
          <div className="rv-tile">
            <small>Up on time</small>
            <b>{r.onTimeWakes}</b>
            <span>mornings</span>
          </div>
          {r.savedBani != null && (
            <div className="rv-tile">
              <small>{r.savedBani >= 0 ? 'Money saved' : 'Spent more than earned'}</small>
              <b>{lei(Math.abs(r.savedBani))}</b>
              <span>income minus spending</span>
            </div>
          )}
          {r.bestMonth && (
            <div className="rv-tile">
              <small>Best month</small>
              <b>{r.bestMonth.label}</b>
              <span>
                {r.bestMonth.focusH}h focus · {r.bestMonth.workouts} workouts
              </span>
            </div>
          )}
        </div>
      )}
      {!r.empty && (
        <section className="panel rv-card">
          <header className="rv-head">
            <h3>Best streaks</h3>
          </header>
          <ul className="rv-streaks">
            {r.streaks.map((s) => (
              <li key={s.id}>
                <b>{s.best}</b>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.bySubject.length > 0 && (
        <section className="panel rv-card">
          <header className="rv-head">
            <h3>Focus hours by subject</h3>
          </header>
          <ul className="rv-bars">
            {r.bySubject.map((x) => (
              <li key={x.subject}>
                <span className="rv-label">{x.subject}</span>
                <span className="rv-track" aria-hidden="true">
                  <i className="real" style={{ width: `${(x.hours / Math.max(0.1, r.bySubject[0].hours)) * 100}%` }} />
                </span>
                <small>{x.hours}h</small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.letters.length > 0 && (
        <section className="panel rv-card">
          <header className="rv-head">
            <h3>Ben's letters</h3>
          </header>
          {r.letters.map((l) => (
            <details key={l.month} className="rv-letter-fold">
              <summary>{l.label}</summary>
              <blockquote className="rv-letter">{l.text}</blockquote>
            </details>
          ))}
        </section>
      )}
    </div>
  )
}

/** On Today in December (and the first week of January): your year is ready. */
export function YearOffer({ onOpen }: { onOpen: () => void }) {
  const year = recapSeason(localDay())
  const key = `ls.yearOffer.${year}`
  const [hidden, setHidden] = useState(() => {
    try {
      return !!localStorage.getItem(key)
    } catch {
      return false
    }
  })
  if (year == null || hidden || !life.extras) return null
  const hide = () => {
    try {
      localStorage.setItem(key, '1')
    } catch {
      /* this visit only */
    }
    setHidden(true)
  }
  return (
    <section className="rv-offer" aria-label="Your year">
      <span aria-hidden="true">🎆</span>
      <div>
        <b>Your {year} is ready</b>
        <small>Best streaks, focus hours, workouts, money saved and Ben's letters.</small>
      </div>
      <button className="btn small primary" onClick={onOpen}>
        See it
      </button>
      <button className="btn small ghost" onClick={hide} aria-label="Hide">
        ✕
      </button>
    </section>
  )
}
