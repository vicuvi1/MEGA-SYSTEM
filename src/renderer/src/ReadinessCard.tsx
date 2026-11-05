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

export function ReadinessCard() {
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
      localStorage.setItem(KEY, JSON.stringify({ day: today(), v }))
    } catch {
      /* this session only */
    }
  }
  const r = readiness({ sleptMin: slept.min, soreness: sore, quality: slept.quality })
  return (
    <section className={`card rd-card rd-${r.kind}`} aria-label="Readiness for training today">
      <div className="rd-top">
        <span className="rd-badge">{r.kind === 'full' ? '💪 Full' : r.kind === 'light' ? '🙂 Light' : '🛌 Rest'}</span>
        <p>{r.why}</p>
      </div>
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
