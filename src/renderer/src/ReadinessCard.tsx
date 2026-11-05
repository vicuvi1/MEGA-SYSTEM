// Readiness on the Body page: last night's sleep (from Sleep) + how sore you
// are (one tap, this device, today only) → a full, light or rest day.
import { useEffect, useState } from 'react'
import { nightMinutes, readiness } from '@core/readiness'
import { dayKey } from '@core/dates'
import { life } from './bridge'

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

export function ReadinessCard({ workoutDone = false }: { workoutDone?: boolean }) {
  const [slept, setSlept] = useState<{ min: number | null; quality: number | null }>({ min: null, quality: null })
  const [sore, setSore] = useState<number | null>(readSore)
  useEffect(() => {
    life.sleep
      .state()
      .then((s) => setSlept({ min: nightMinutes(s.todayLog), quality: s.todayLog?.quality ?? null }))
      .catch(() => {})
  }, [])
  const pick = (v: number) => {
    setSore(v)
    try {
      // Set after training it still guides tomorrow, but no longer counts for the grit bonus.
      localStorage.setItem(KEY, JSON.stringify({ day: today(), v, pre: !workoutDone }))
    } catch {
      /* this session only */
    }
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
  return (
    <section className={`card rd-card rd-${r.kind}`} aria-label="Readiness for training today">
      <div className="rd-top">
        <span className="rd-badge">{r.kind === 'full' ? '💪 Full' : r.kind === 'light' ? '🙂 Light' : '🛌 Rest'}</span>
        <p>{r.why}</p>
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
