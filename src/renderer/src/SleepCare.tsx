// Sleep care on the Sleep page (BD4, BD6): the sleep debt meter (the last 7
// nights against your need, from the bed and wake times Waky and the app
// log), the nap guard and the earlier night; the morning light; the coffee
// log with its curfew. Nothing here pays points.
import { useCallback, useEffect, useState } from 'react'
import { hm, lightMinutes, type CareView } from '@core/sleepCare'
import { life } from './bridge'
import { useLive } from './live'
import { barFill } from './motionKit'
import { Select } from './Select'
import { useAction } from './ui'
import { weatherToday } from './widgets/widgetsFeed'
import './sleepCare.css'

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export function SleepCarePanel() {
  const act = useAction()
  const [v, setV] = useState<CareView | null>(null)
  const [light, setLight] = useState<{ min: number; why: string | null }>({ min: 10, why: null })
  const load = useCallback(() => {
    life.care
      ?.state()
      .then(setV)
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    weatherToday(Date.now())
      .then((w) => setLight(lightMinutes(w)))
      .catch(() => {})
    window.addEventListener('life-care-changed', load)
    return () => window.removeEventListener('life-care-changed', load)
  }, [load])
  useLive(load)
  if (!life.care || !v) return null
  const d = v.debt
  const today = v.care.days[v.today] ?? {}
  // The meter fills to 10 hours behind (a week of short nights).
  const fill = Math.min(1, d.debtMin / 600)
  const max = Math.max(d.needMin + 60, ...d.nights.map((n) => n.min ?? 0))
  return (
    <div className="cols even sc">
      <section className={`panel sc-debt lvl-${d.level}`} aria-label="Sleep debt">
        <header className="panel-head">
          <h2>Sleep debt</h2>
          <span className="hint">last 7 nights · need {v.care.needH} h</span>
        </header>
        <div className="sc-meter-row">
          <b className="sc-big">{d.logged ? (d.debtMin ? hm(d.debtMin) : '0') : '–'}</b>
          <span className="sc-meter-label">{d.level === 'high' ? 'behind: pay it back this week' : d.level === 'behind' ? 'a little behind' : d.logged ? 'on track' : 'log a few nights first'}</span>
        </div>
        <span className="pbar sc-meter" role="meter" aria-valuemin={0} aria-valuemax={600} aria-valuenow={d.debtMin} aria-label={`${hm(d.debtMin)} behind`}>
          <i style={barFill(fill)} />
        </span>
        <div className="sc-nights" role="img" aria-label={`Hours slept, last 7 nights, against ${v.care.needH} hours`}>
          <span className="sc-need" style={{ bottom: `${(d.needMin / max) * 100}%` }} aria-hidden />
          {d.nights.map((n) => (
            <span key={n.day} className={`sc-night ${n.min == null ? 'none' : n.min < d.needMin - 60 ? 'short' : ''}`} title={`${n.day}: ${n.min == null ? 'not logged' : hm(n.min)}`}>
              <i style={{ transform: `scaleY(${n.min == null ? 0.04 : n.min / max})` }} />
              <small>{day(n.day)}</small>
            </span>
          ))}
        </div>
        {v.advice.nap && (
          <p className={`sc-tip ${v.advice.napOk ? 'go' : ''}`}>
            <span aria-hidden>{v.advice.napOk ? '😴' : '⏳'}</span> {v.advice.nap}
          </p>
        )}
        {v.advice.early && (
          <p className="sc-tip">
            <span aria-hidden>🌙</span> Bed at <b>{v.advice.early.bed}</b> {v.advice.early.label === 'tonight' || v.advice.early.label === 'tomorrow' ? v.advice.early.label : `on ${v.advice.early.label}`} ({v.advice.early.minutes} min earlier, your next free evening).
          </p>
        )}
        <label className="sc-pick">
          I need
          <Select value={String(v.care.needH)} onChange={(e) => void act(() => life.care!.prefs({ needH: Number(e.target.value) }), 'Sleep need saved').then((r) => r && setV(r))} aria-label="Hours of sleep you need">
            {[6.5, 7, 7.5, 8, 8.5, 9].map((h) => (
              <option key={h} value={String(h)}>
                {h} h a night
              </option>
            ))}
          </Select>
        </label>
      </section>
      <section className="panel sc-day" aria-label="Light and caffeine">
        <header className="panel-head">
          <h2>Light and caffeine</h2>
          <span className="hint">bed {v.bed}</span>
        </header>
        <div className={`sc-row ${today.light ? 'done' : ''}`}>
          <span className="sc-ico" aria-hidden>☀️</span>
          <div>
            <b>Morning light</b>
            <small>{today.light ? `Done at ${clock(today.light)}. Your body clock is set for tonight.` : `${light.min} min outside after you get up${light.why ? ` (${light.why})` : ''}: you fall asleep faster tonight.`}</small>
          </div>
          {!today.light && (
            <button className="btn small" onClick={() => void act(() => life.care!.light(), 'Morning light noted').then((r) => r && setV(r))}>
              ✓ Got my light
            </button>
          )}
        </div>
        <div className={`sc-row ${v.caffeine.left <= 0 ? 'past' : ''}`}>
          <span className="sc-ico" aria-hidden>☕</span>
          <div>
            <b>
              Caffeine curfew <span className="sc-curfew">{v.caffeine.curfew}</span>
            </b>
            <small>
              {v.caffeine.cups ? `${v.caffeine.cups} today, last at ${v.caffeine.last}${v.caffeine.late ? ` · ${v.caffeine.late} after the curfew` : ''}. ` : 'No coffee logged today. '}
              {v.caffeine.left > 0 ? `${hm(v.caffeine.left)} left for coffee.` : 'Water or herbal tea from here.'}
            </small>
          </div>
          <span className="sc-acts">
            <button className="btn small" onClick={() => void act(() => life.care!.coffee(1), (r) => r.reply).then((r) => r && setV(r.view))}>
              ☕ Coffee now
            </button>
            {v.caffeine.cups > 0 && (
              <button className="btn small ghost" onClick={() => void act(() => life.care!.undoCoffee(), 'Last coffee taken back').then((r) => r && setV(r))}>
                Undo
              </button>
            )}
          </span>
        </div>
        <label className="sc-pick">
          Last caffeine
          <Select value={String(v.care.curfewH)} onChange={(e) => void act(() => life.care!.prefs({ curfewH: Number(e.target.value) }), 'Curfew saved').then((r) => r && setV(r))} aria-label="Hours before bed for the last caffeine">
            {[8, 8.5, 9, 9.5, 10].map((h) => (
              <option key={h} value={String(h)}>
                {h} h before bed
              </option>
            ))}
          </Select>
        </label>
        <p className="hint small">Tip: “coffee” on Telegram logs one too.</p>
        {v.shift && (
          <p className="sc-tip">
            <span aria-hidden>🌙</span> Tonight the shift ends {v.shift.start}: the wind-down starts then, lights out {v.shift.lightsOut}.
          </p>
        )}
      </section>
    </div>
  )
}
