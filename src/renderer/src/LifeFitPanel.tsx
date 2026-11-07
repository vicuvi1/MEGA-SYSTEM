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
import { AREA_HINT, AREA_ICON, AREA_LABEL, AREA_LEVELS, AREAS, cleanPushPrefs, LEVEL_HINT, LEVEL_LABEL, type Area, type AreaLevel, type PushPrefs } from '@core/benPushes'
import { Select } from './Select'
import './benPush.css'

const FIT_CHANGED = 'life-fit-changed'
/** My life, loaded now and again whenever the other panel saves it (both stay mounted in Settings' tabs). */
function useLifeFit(set: (v: LifeFitView) => void) {
  useEffect(() => {
    const load = () => void life.coach?.lifeFit?.().then(set).catch(() => {})
    load()
    window.addEventListener(FIT_CHANGED, load)
    return () => window.removeEventListener(FIT_CHANGED, load)
  }, [set])
}

const DAYS: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']]
/** A time input can't say 24:00: midnight at the end of a shift is shown as 00:00. */
const showEnd = (t: string) => (t === '24:00' ? '00:00' : t)
const saveEnd = (t: string) => (t === '00:00' ? '24:00' : t)

export function LifeFitPanel() {
  const act = useAction()
  const [v, setV] = useState<LifeFitView | null>(null)
  useLifeFit(setV)
  if (!v || !life.coach?.setLifeFit) return null
  const save = async (patch: Partial<LifeFitView>, toast?: string) => {
    setV({ ...v, ...patch, work: { ...v.work, ...(patch.work ?? {}) } })
    const r = await act(() => life.coach!.setLifeFit!(patch), toast)
    if (r) {
      setV(r)
      window.dispatchEvent(new Event(FIT_CHANGED))
    }
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

/** Settings → Ben → Pushes: how hard per area, and when Ben writes first. */
export function BenPushPanel() {
  const act = useAction()
  const [v, setV] = useState<LifeFitView | null>(null)
  useLifeFit(setV)
  if (!v || !life.coach?.setLifeFit) return null
  const save = async (patch: Partial<LifeFitView>, toast?: string) => {
    setV({ ...v, ...patch })
    const r = await act(() => life.coach!.setLifeFit!(patch), toast)
    if (r) {
      setV(r)
      window.dispatchEvent(new Event(FIT_CHANGED))
    }
  }
  return (
    <section className="panel bp-panel">
      <header className="panel-head">
        <h2>
          <Icon name="bell" /> Pushes
        </h2>
      </header>
      <BenPushes v={v} save={save} />
    </section>
  )
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Ben 2: how hard Ben pushes in each area, and when he writes first (core/benPushes.ts). */
function BenPushes({ v, save }: { v: LifeFitView; save: (patch: Partial<LifeFitView>, toast?: string) => Promise<void> }) {
  const act = useAction()
  const areas = v.areas ?? (Object.fromEntries(AREAS.map((a) => [a, 'hard'])) as Record<Area, AreaLevel>)
  const p = cleanPushPrefs(v.pushes)
  const setP = (patch: Partial<PushPrefs>) => void save({ pushes: { ...p, ...patch } })
  // The weekly card's day and time are the weekly review's (one setting, also on the Coach page).
  const [rh, setRh] = useState<{ weekly: string; weeklyDay?: number } | null>(null)
  useEffect(() => {
    life.coach?.rhythm?.('state').then((r) => setRh(r.prefs)).catch(() => {})
  }, [])
  const setWeek = async (patch: { weekly?: string; weeklyDay?: number }) => {
    setRh((r) => (r ? { ...r, ...patch } : r))
    const r = await act(() => life.coach!.rhythm!('prefs', undefined, patch), 'Saved')
    if (r) setRh(r.prefs)
  }
  return (
    <div className="bp-settings">
      <h3 className="lf-sub">How hard, per area</h3>
      <p className="hint block">Each nudge belongs to an area. Soft: warm, fewer nudges, no firm follow-up. Normal: direct, one follow-up. Hard: sooner and firmer.</p>
      <div className="bp-areas" role="group" aria-label="Push level per area">
        {AREAS.map((a) => (
          <div key={a} className="bp-area" data-area={a}>
            <span className="bp-area-name" title={AREA_HINT[a]}>
              {AREA_ICON[a]} {AREA_LABEL[a]}
            </span>
            <span className="bp-seg" role="radiogroup" aria-label={`${AREA_LABEL[a]}: how hard`}>
              {AREA_LEVELS.map((l) => (
                <button key={l} type="button" role="radio" title={LEVEL_HINT[l]} aria-checked={areas[a] === l} className={areas[a] === l ? 'on' : ''} onClick={() => void save({ areas: { ...areas, [a]: l } }, `${AREA_LABEL[a]}: ${LEVEL_LABEL[l]}`)}>
                  {LEVEL_LABEL[l]}
                </button>
              ))}
            </span>
          </div>
        ))}
      </div>

      <h3 className="lf-sub">When Ben writes first</h3>
      <p className="hint block">On the island while you're at the PC, on Telegram when you're away. Never twice. Each has its own sound in Settings → Sound.</p>
      <label className="check toggle-row">
        <input type="checkbox" checked={p.checkins} onChange={(e) => setP({ checkins: e.target.checked })} />
        <span>
          Check in when a planned block starts
          <small>"Lab 4 starts now, ready?" with Start, 10 min later and Skip. One firmer word 10 minutes later if it hasn't started, then he stops. Never in meetings.</small>
        </span>
      </label>
      <label className="check toggle-row">
        <input type="checkbox" checked={p.brief} onChange={(e) => setP({ brief: e.target.checked })} />
        <span>
          Morning brief at {v.wake}
          <small>Your must-dos, the first block and the water goal, with one tap for Plan my day.</small>
        </span>
      </label>
      {p.brief && (
        <div className="lf-days" role="group" aria-label="Days off (no morning brief)">
          <span className="hint small bp-off">Days off:</span>
          {DAYS.map(([d, label]) => (
            <button key={d} type="button" aria-pressed={p.offDays.includes(d)} className={p.offDays.includes(d) ? 'on' : ''} onClick={() => setP({ offDays: p.offDays.includes(d) ? p.offDays.filter((x) => x !== d) : [...p.offDays, d] })}>
              {label}
            </button>
          ))}
        </div>
      )}
      <label className="check toggle-row">
        <input type="checkbox" checked={p.shutdown} onChange={(e) => setP({ shutdown: e.target.checked })} />
        <span>
          Evening shutdown before bed ({v.bed})
          <small>What got done, what's open (each: Tomorrow, Drop or Keep today) and a bedtime reminder. It opens Today's Shut down.</small>
        </span>
      </label>
      {p.shutdown && (
        <div className="lf-grid">
          <label>
            Minutes before bed
            <Select value={String(p.shutdownBefore)} onChange={(e) => setP({ shutdownBefore: Number(e.target.value) })} aria-label="Minutes before bed">
              {[15, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}
      <label className="check toggle-row">
        <input type="checkbox" checked={p.weekly} onChange={(e) => setP({ weekly: e.target.checked })} />
        <span>
          Weekly check
          <small>Your week score, 3 wins, 1 thing to fix and next week's top 3 to accept, on Telegram and here in Coach.</small>
        </span>
      </label>
      {p.weekly && rh && life.coach?.rhythm && (
        <div className="lf-grid">
          <label>
            Day
            <Select value={String(rh.weeklyDay ?? 0)} onChange={(e) => void setWeek({ weeklyDay: Number(e.target.value) })} aria-label="Weekly check day">
              {WEEKDAYS.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Time
            <input type="time" value={rh.weekly} onChange={(e) => e.target.value && void setWeek({ weekly: e.target.value })} />
          </label>
        </div>
      )}
    </div>
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
