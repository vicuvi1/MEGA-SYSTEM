// Readiness on the Body page (BD7): last night's sleep (from Sleep), how sore
// you are (one tap, this device, today only) and yesterday's hard sets set
// today's dose in Sport Track: Full, Lighter 70% or Short 50%. Under 6 h of
// sleep progression holds (same reps, no level-ups). Your own pick wins.
import { useCallback, useEffect, useState } from 'react'
import { nightMinutes, readiness } from '@core/readiness'
import { DOSE_LABEL, type DoseMode, type TrainReady } from '@core/trainReadiness'
import { dayKey } from '@core/dates'
import { life } from './bridge'
import { useAction } from './ui'

const KEY = 'ls.soreness'
const today = () => dayKey(new Date())
const readSore = (): number | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && v.day === today() ? Number(v.v) : null
  } catch {
    return null
  }
}
/** Soreness picked BEFORE today's workout (only that one can earn the grit bonus: P6). */
const soreBefore = (): number | null => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && v.day === today() && v.pre ? Number(v.v) : null
  } catch {
    return null
  }
}

const MODES: DoseMode[] = ['full', 'light', 'short']

export function ReadinessCard({ workoutDone = false }: { workoutDone?: boolean }) {
  const act = useAction()
  const [slept, setSlept] = useState<{ min: number | null; quality: number | null }>({ min: null, quality: null })
  const [sore, setSore] = useState<number | null>(readSore)
  const [tr, setTr] = useState<TrainReady | null>(null)
  useEffect(() => {
    life.sleep
      .state()
      .then((s) => setSlept({ min: nightMinutes(s.todayLog), quality: s.todayLog?.quality ?? null }))
      .catch(() => {})
  }, [])
  const load = useCallback(() => {
    life.coach?.bodyPlus
      ?.ready(readSore(), slept.quality)
      .then(setTr)
      .catch(() => {})
  }, [slept.quality])
  useEffect(() => {
    load()
    window.addEventListener('life-sleep-changed', load)
    return () => window.removeEventListener('life-sleep-changed', load)
  }, [load, sore])
  const pick = (v: number) => {
    setSore(v)
    try {
      // Set after training it still guides tomorrow, but no longer counts for the grit bonus.
      localStorage.setItem(KEY, JSON.stringify({ day: today(), v, pre: !workoutDone }))
    } catch {
      /* this session only */
    }
    // Sport Track hears it too (it reads the dose from life_body).
    window.dispatchEvent(new CustomEvent('life-body-changed'))
  }
  const setDose = async (mode: DoseMode | null) => {
    const next = await act(() => life.coach!.bodyPlus!.setDose(mode, readSore()), mode ? `Today: ${DOSE_LABEL[mode]} in Sport Track` : 'Back to automatic')
    if (next) setTr(next)
  }
  const r = readiness({ sleptMin: slept.min, soreness: sore, quality: slept.quality })
  // Surprise on a hard day (M4): trained anyway on a light/rest day → a grit bonus, once a day.
  const [grit, setGrit] = useState<string | null>(null)
  useEffect(() => {
    // The bonus needs a hard day you reported before training (not soreness tapped after: P6).
    const before = readiness({ sleptMin: slept.min, soreness: soreBefore(), quality: slept.quality })
    if (!workoutDone || before.kind === 'full' || slept.min == null) return
    const key = `ls.grit.${today()}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      return
    }
    life.wallet
      .award('body.grit_day')
      .then(() => {
        const lines = ['You showed up when it was hard. That is the whole game.', 'Tired and you still trained: that counts double.', 'Hard day, done anyway. Respect.']
        setGrit(lines[Math.floor(Math.random() * lines.length)])
        window.dispatchEvent(new CustomEvent('life-wallet-changed'))
      })
      .catch(() => {})
  }, [workoutDone, r.kind, slept.min])
  const mode = tr?.mode ?? (r.kind === 'full' ? 'full' : r.kind === 'light' ? 'light' : 'short')
  return (
    <section className={`card rd-card rd-${mode === 'full' ? 'full' : mode === 'light' ? 'light' : 'rest'}`} aria-label="Readiness for training today">
      <div className="rd-top">
        <span className="rd-badge">{mode === 'full' ? '💪 Full' : mode === 'light' ? '🙂 Lighter 70%' : '⏱️ Short 50%'}</span>
        <p>{tr?.line ?? r.why}</p>
      </div>
      <div className="rd-plan" role="radiogroup" aria-label="Today's dose in Sport Track">
        <small>Sport Track today</small>
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => void setDose(m)} title={m === tr?.suggested ? 'What your sleep, soreness and yesterday say' : 'Your pick for today'}>
            {DOSE_LABEL[m]}
            {tr && m === tr.suggested && <i className="rd-auto">auto</i>}
          </button>
        ))}
        {tr && !tr.auto && (
          <button type="button" className="btn ghost small" onClick={() => void setDose(null)}>
            Back to automatic
          </button>
        )}
        {tr?.hold && <span className="rd-hold">⏸ progression on hold today</span>}
      </div>
      {grit && (
        <p className="rd-grit" role="status">
          🎁 <b>Grit bonus +15</b> · {grit}
        </p>
      )}
      <div className="rd-sore" role="radiogroup" aria-label="How sore are you? 1 fresh, 5 very sore">
        <small>Sore?</small>
        {[1, 2, 3, 4, 5].map((v) => (
          <button key={v} role="radio" aria-checked={sore === v} className={sore === v ? 'on' : ''} onClick={() => pick(v)}>
            {v}
          </button>
        ))}
      </div>
    </section>
  )
}
