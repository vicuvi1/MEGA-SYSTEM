// Settings → Ben → My life: your sleep window, your work window (and how much
// of it you really work), and how hard Ben pushes. Synced; Ben and the day
// planner use it (core/lifeFit.ts).
import { useEffect, useState } from 'react'
import { life } from './bridge'
import { dayKey } from '@core/dates'
import { Icon } from './Icon'
import { useAction } from './ui'
import { PUSH_LEVELS, pushStyle, usualText, type PushLevel, type WorkWindow } from '@core/lifeFit'
import type { LifeFitView } from './web/lifeFitStore'

const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]
/** A time input can't say 24:00: midnight at the end of a shift is shown as 00:00. */
const showEnd = (t: string) => (t === '24:00' ? '00:00' : t)
const saveEnd = (t: string) => (t === '00:00' ? '24:00' : t)

export function LifeFitPanel() {
  const act = useAction()
  const [v, setV] = useState<LifeFitView | null>(null)
  useEffect(() => {
    life.coach?.lifeFit?.().then(setV).catch(() => {})
  }, [])
  if (!v || !life.coach?.setLifeFit) return null
  const save = async (patch: Partial<LifeFitView>, toast?: string) => {
    setV({ ...v, ...patch, work: { ...v.work, ...(patch.work ?? {}) } })
    const r = await act(() => life.coach!.setLifeFit!(patch), toast)
    if (r) setV(r)
  }
  const work = (p: Partial<WorkWindow>) => void save({ work: { ...v.work, ...p } })
  const w = v.work
  return (
    <section className="panel lf-panel">
      <header className="panel-head">
        <h2>
          <Icon name="sun" /> My life
        </h2>
      </header>
      <p className="hint block">A few facts about your week. Ben and the day planner use them.</p>

      <h3 className="lf-sub">Sleep</h3>
      <div className="lf-grid">
        <label>
          Bedtime
          <input type="time" value={v.bed} onChange={(e) => e.target.value && void save({ bed: e.target.value })} />
        </label>
        <label>
          Latest bedtime
          <input type="time" value={v.latestBed} onChange={(e) => e.target.value && void save({ latestBed: e.target.value })} />
        </label>
        <label>
          Wake up
          <input type="time" value={v.wake} onChange={(e) => e.target.value && void save({ wake: e.target.value })} />
        </label>
      </div>
      <small className="hint">Wind-down starts an hour before bedtime. After your latest bedtime the late-night nudges get firm.</small>

      <h3 className="lf-sub">Work</h3>
      <label className="check toggle-row">
        <input type="checkbox" checked={w.on} onChange={(e) => work({ on: e.target.checked })} />
        <span>
          I have a job with set hours
          <small>The planner keeps deep focus out of these hours and only puts light tasks there.</small>
        </span>
      </label>
      {w.on && (
        <>
          <div className="lf-days" role="group" aria-label="Work days">
            {DAYS.map(([d, label]) => (
              <button key={d} type="button" aria-pressed={w.days.includes(d)} className={w.days.includes(d) ? 'on' : ''} onClick={() => work({ days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d] })}>
                {label}
              </button>
            ))}
          </div>
          <div className="lf-grid">
            <label>
              From
              <input type="time" value={w.from} onChange={(e) => e.target.value && work({ from: e.target.value })} />
            </label>
            <label>
              To
              <input type="time" value={showEnd(w.to)} onChange={(e) => e.target.value && work({ to: saveEnd(e.target.value) })} />
            </label>
            <label>
              I usually really work (least, h)
              <input type="number" min={0} max={12} step={0.5} value={w.minH} onChange={(e) => work({ minH: Number(e.target.value) })} />
            </label>
            <label>
              (most, h)
              <input type="number" min={0} max={12} step={0.5} value={w.maxH} onChange={(e) => work({ maxH: Number(e.target.value) })} />
            </label>
          </div>
          <small className="hint">
            Usually {usualText(w)} of it, and it changes. On a short shift or a night off, tell Ben ("short shift tonight", "no work tonight") or tap the button on Today: the free part opens up for that day.
          </small>
        </>
      )}

      <h3 className="lf-sub">How hard should Ben push?</h3>
      <div className="lf-push" role="radiogroup" aria-label="How hard should Ben push">
        {PUSH_LEVELS.map((lvl: PushLevel) => {
          const ps = pushStyle(lvl)
          return (
            <button key={lvl} type="button" role="radio" aria-checked={v.push === lvl} className={v.push === lvl ? 'on' : ''} onClick={() => void save({ push: lvl }, `Ben: ${ps.label}`)}>
              <b>{ps.label}</b>
              <small>{ps.hint}</small>
            </button>
          )
        })}
      </div>
      <small className="hint">Always within quiet hours and the daily message limit. Ben never blames you for something your data doesn't show.</small>
    </section>
  )
}

/** Today / island: "Short shift tonight" and "No work tonight" for a work day (one tap). */
export function ShiftButtons({ compact = false }: { compact?: boolean }) {
  const act = useAction()
  const [v, setV] = useState<LifeFitView | null>(null)
  useEffect(() => {
    life.coach?.lifeFit?.().then(setV).catch(() => {})
  }, [])
  const today = dayKey(new Date())
  if (!v || !v.work.on || !life.coach?.setTonight) return null
  const wd = new Date(`${today}T12:00:00`).getDay()
  if (!v.work.days.includes(wd)) return null
  const mode = v.tonight?.day === today ? v.tonight.mode : 'normal'
  const set = async (m: 'normal' | 'short' | 'off') => {
    const r = await act(() => life.coach!.setTonight!(mode === m ? 'normal' : m), (x) => x.line)
    if (r) setV(r.view)
  }
  return (
    <div className="shift-pill" role="group" aria-label="Tonight's work">
      {!compact && <span>Work {v.work.from}–{showEnd(v.work.to)}:</span>}
      <button type="button" className={mode === 'short' ? 'on' : ''} aria-pressed={mode === 'short'} onClick={() => void set('short')}>
        Short shift tonight
      </button>
      <button type="button" className={mode === 'off' ? 'on' : ''} aria-pressed={mode === 'off'} onClick={() => void set('off')}>
        No work tonight
      </button>
    </div>
  )
}
