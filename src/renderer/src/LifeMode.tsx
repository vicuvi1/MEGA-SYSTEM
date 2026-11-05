// Life modes (FT4): one switch for Exam week, Sick or Travel, for a few days.
// Shown on Today and on Ben's desk, with the end date and "End now".
import { useCallback, useEffect, useState } from 'react'
import { life } from './bridge'
import { useLive } from './live'
import { useAction } from './ui'
import { untilText, type ModeKind } from '@core/lifeMode'
import type { ModeView } from './web/lifeExtras'
import './lifeExtras.css'

export function useLifeMode(): [ModeView | null, () => void] {
  const [v, setV] = useState<ModeView | null>(null)
  const load = useCallback(() => {
    life.extras?.mode().then(setV).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('life-mode-changed', load)
    return () => window.removeEventListener('life-mode-changed', load)
  }, [load])
  useLive(load)
  return [v, load]
}

export function LifeModeCard({ compact = false }: { compact?: boolean }) {
  const act = useAction()
  const [v, reload] = useLifeMode()
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState<ModeKind>('exam')
  const [days, setDays] = useState(7)
  if (!life.extras || !v) return null
  const cur = v.current
  const start = async () => {
    const def = v.modes.find((m) => m.kind === pick)
    const r = await act(() => life.extras!.setMode(pick, days), `${def?.emoji ?? ''} ${def?.label ?? 'Mode'} on until ${untilText(addDaysLocal(v.today, days - 1))}`)
    if (r) {
      setOpen(false)
      reload()
    }
  }
  const end = async () => {
    const r = await act(() => life.extras!.setMode(null), 'Back to a normal day')
    if (r) reload()
  }
  if (cur) {
    return (
      <section className={`lm-card on ${compact ? 'compact' : ''}`} aria-label="Life mode">
        <span className="lm-emoji" aria-hidden="true">{cur.emoji}</span>
        <div className="lm-text">
          <b>
            {cur.label} · day {cur.dayN} of {cur.days}
          </b>
          <small>
            Until {untilText(cur.until)}. {cur.blurb}. Points only for what you do.
          </small>
        </div>
        <button className="btn small ghost" onClick={() => void end()}>
          End now
        </button>
      </section>
    )
  }
  if (!open) {
    return (
      <button className={`lm-open ${compact ? 'compact' : ''}`} onClick={() => setOpen(true)} title="Exam week, sick or travelling: change targets and nudges for a few days">
        <span aria-hidden="true">🎚</span> Life mode: normal <small>Exam week · Sick · Travel</small>
      </button>
    )
  }
  return (
    <section className={`lm-card ${compact ? 'compact' : ''}`} aria-label="Pick a life mode">
      <div className="lm-pick" role="radiogroup" aria-label="Mode">
        {v.modes.map((m) => (
          <button
            key={m.kind}
            role="radio"
            aria-checked={pick === m.kind}
            className={pick === m.kind ? 'on' : ''}
            onClick={() => {
              setPick(m.kind)
              setDays(m.defaultDays)
            }}
          >
            <span aria-hidden="true">{m.emoji}</span> {m.label}
          </button>
        ))}
      </div>
      <p className="hint small">{v.modes.find((m) => m.kind === pick)?.blurb}. Streaks are kept; points still come only from what you do.</p>
      <div className="lm-row">
        <label>
          For
          <input type="number" min={1} max={21} value={days} onChange={(e) => setDays(Math.max(1, Math.min(21, Number(e.target.value) || 1)))} aria-label="Days" />
          days
        </label>
        <span className="hint small">until {untilText(addDaysLocal(v.today, days - 1))}</span>
        <span className="lm-grow" />
        <button className="btn small ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btn small primary" onClick={() => void start()}>
          Turn on
        </button>
      </div>
    </section>
  )
}

function addDaysLocal(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
}
