// Readiness on Body → Today (BD7): a score 0–100 from last night's sleep against
// your need (Sleep care), how sore you are (one tap, this device, today only)
// and yesterday's hard sets, with a plain verdict: "Ready: go full", "Go
// lighter (70%)" or "Rest or mobility". The same score sets today's dose in
// Sport Track (Full, Lighter 70% or Short 50%); your own pick wins. Under 6 h
// of sleep progression holds (same reps, no level-ups).
import { useCallback, useEffect, useState } from 'react'
import { nightMinutes, readiness } from '@core/readiness'
import { DOSE_LABEL, type DoseMode, type TrainReady } from '@core/trainReadiness'
import { readinessParts, verdictOf, VERDICT_TITLE, type Verdict } from '@core/readinessDay'
import { dayKey } from '@core/dates'
import { life } from './bridge'
import { useAction } from './ui'
import { BtRing } from './body/today/BtRing'

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

export interface ReadinessState {
  sleptMin: number | null
  needMin: number
  sore: number | null
  tr: TrainReady | null
  score: number
  verdict: Verdict
  mode: DoseMode
  grit: string | null
  pickSore: (v: number) => void
  setDose: (mode: DoseMode | null) => Promise<void>
}

/** Today's readiness: the numbers, your soreness tap and the dose (shared by the cards on Body → Today). */
export function useReadiness(workoutDone: boolean): ReadinessState {
  const act = useAction()
  const [slept, setSlept] = useState<{ min: number | null; quality: number | null }>({ min: null, quality: null })
  const [needMin, setNeed] = useState(480)
  const [sore, setSore] = useState<number | null>(readSore)
  const [tr, setTr] = useState<TrainReady | null>(null)
  useEffect(() => {
    life.sleep
      .state()
      .then((s) => setSlept({ min: nightMinutes(s.todayLog), quality: s.todayLog?.quality ?? null }))
      .catch(() => {})
    life.care
      ?.state()
      .then((c) => setNeed(Math.round((Number(c.care?.needH) || 8) * 60)))
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
    window.addEventListener('life-body-changed', load)
    return () => {
      window.removeEventListener('life-sleep-changed', load)
      window.removeEventListener('life-body-changed', load)
    }
  }, [load, sore])
  const pickSore = (v: number) => {
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
  const local = readiness({ sleptMin: slept.min, soreness: sore, quality: slept.quality, needMin })
  // Surprise on a hard day (M4): trained anyway on a light/rest day → a grit bonus, once a day (unchanged).
  const [grit, setGrit] = useState<string | null>(null)
  useEffect(() => {
    // The bonus needs a hard day you reported before training (not soreness tapped after: P6).
    const before = readiness({ sleptMin: slept.min, soreness: soreBefore(), quality: slept.quality, needMin })
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
  }, [workoutDone, local.kind, slept.min])
  const score = tr?.score ?? local.score
  const verdict = verdictOf(score)
  const mode = tr?.mode ?? (local.kind === 'full' ? 'full' : local.kind === 'light' ? 'light' : 'short')
  return { sleptMin: slept.min, needMin, sore, tr, score, verdict, mode, grit, pickSore, setDose }
}

export function ReadinessCard({ r, ydaySets }: { r: ReadinessState; ydaySets: number }) {
  const parts = readinessParts({ sleptMin: r.sleptMin, needMin: r.needMin, soreness: r.sore, ydaySets })
  const tone = r.verdict === 'go' ? '' : r.verdict === 'lighter' ? 'ok' : 'low'
  return (
    <section className={`bdy-card rdy-card rdy-${r.verdict}`} aria-label="Readiness for training today">
      <div className="bdy-head">
        <h2 className="bdy-title">Readiness</h2>
        {r.tr?.hold && <span className="rdy-hold">Progression on hold today</span>}
      </div>
      <div className="rdy-main">
        <BtRing frac={r.score / 100} size={104} stroke={10} tone={tone} label={`Readiness ${r.score} of 100`}>
          <b className="bdy-num lg rdy-score">{r.score}</b>
        </BtRing>
        <div className="rdy-verdict">
          <b className="rdy-verdict-title">{VERDICT_TITLE[r.verdict]}</b>
          <ul className="rdy-parts">
            {parts.map((p) => (
              <li key={p.id} className={`rdy-part ${p.tone}`}>
                <span>{p.label}</span>
                <b>{p.value}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="rdy-sore" role="radiogroup" aria-label="How sore are you? 1 fresh, 5 very sore">
        <span className="bdy-note">Sore?</span>
        {[1, 2, 3, 4, 5].map((v) => (
          <button key={v} type="button" role="radio" aria-checked={r.sore === v} className={r.sore === v ? 'on' : ''} onClick={() => r.pickSore(v)}>
            {v}
          </button>
        ))}
        <span className="bdy-note rdy-sore-hint">1 fresh · 5 very sore</span>
      </div>
      <div className="rdy-plan">
        <span className="bdy-note">Sport Track today</span>
        <div className="bdy-seg" role="radiogroup" aria-label="Today's dose in Sport Track">
          {MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={r.mode === m} className={r.mode === m ? 'on' : ''} onClick={() => void r.setDose(m)} title={m === r.tr?.suggested ? 'What your sleep, soreness and yesterday say' : 'Your pick for today'}>
              {DOSE_LABEL[m]}
              {r.tr && m === r.tr.suggested && <i className="rdy-auto">auto</i>}
            </button>
          ))}
        </div>
        {r.tr && !r.tr.auto && (
          <button type="button" className="bdy-btn quiet rdy-back" onClick={() => void r.setDose(null)}>
            Back to automatic
          </button>
        )}
      </div>
      {r.tr && !r.tr.auto && r.tr.mode !== r.tr.suggested && <p className="bdy-note">You picked it; the numbers say {DOSE_LABEL[r.tr.suggested]}.</p>}
      {r.grit && (
        <p className="rdy-grit" role="status">
          <b>Grit bonus +15</b> · {r.grit}
        </p>
      )}
    </section>
  )
}
