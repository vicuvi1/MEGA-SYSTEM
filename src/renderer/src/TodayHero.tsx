// Today's top: Ben's face and one line about your day, the one move that
// matters now, and three numbers (focus, water, must-dos). Everything else on
// Today sits below it, and the extras fold away.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoachStatus } from './web/coachStatus'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'

/** A number that counts up to its value (calm, quick). */
export function useCountUp(value: number, ms = 700): number {
  const [n, setN] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setN(value)
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setN(a + (value - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return n
}

function Stat({ label, value, sub, pct, tone }: { label: string; value: string; sub: string; pct: number; tone?: 'water' | 'ok' }) {
  const p = useCountUp(Math.min(100, Math.max(0, pct)))
  return (
    <div className={`th-stat ${tone ?? ''}`}>
      <div className="th-ring" style={{ ['--p' as string]: `${p}%` }}>
        <span>{Math.round(p)}%</span>
      </div>
      <div>
        <small>{label}</small>
        <b>{value}</b>
        <em>{sub}</em>
      </div>
    </div>
  )
}

const greet = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function TodayHero({ name, onGo }: { name?: string; onGo: (page: 'coach') => void }) {
  const act = useAction()
  const [st, setSt] = useState<CoachStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    life.coach?.status?.().then(setSt).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    const on = () => load()
    window.addEventListener('life-focus-changed', on)
    return () => {
      clearInterval(t)
      window.removeEventListener('life-focus-changed', on)
    }
  }, [load])
  useLive(load)
  const focusMin = useCountUp(st?.today.focusMin ?? 0)
  if (!life.coach?.status || !st) return null
  const m = st.move
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (m.kind === 'focus') await act(() => life.focus.start(m.subject, m.minutes, null), `Focus started: ${m.subject} · ${m.minutes} min`)
      else if (m.kind === 'running') await act(() => life.focus.stop(), 'Logged')
      else if (m.kind === 'approve') await act(() => life.coach!.rhythm!('approve'), 'Approved: blocks in your calendar, must-dos on Today')
      else if (m.kind === 'plan') await act(() => life.coach!.rhythm!('propose'), 'Your plan is ready: see below')
      else if (m.kind === 'answer') {
        const r = await act(() => life.coach!.chat(`Done: ${m.promise}`))
        if (r?.reply) await act(async () => r, r.reply.slice(0, 140))
      } else onGo('coach')
    } finally {
      setBusy(false)
      load()
    }
  }
  const label: Record<string, string> = { focus: '▶ Start', running: '⏹ Stop & log', approve: '✓ Approve', plan: 'Plan my day', answer: '✅ Done', ask: 'Ask Ben' }
  const water = st.today.waterTarget ? st.today.waterMl / st.today.waterTarget : 0
  return (
    <section className={`th mood-${st.mood}`}>
      <div className="th-top">
        <button className={`th-face mood-${st.mood}`} onClick={() => onGo('coach')} title="Talk to Ben" aria-label="Talk to Ben">
          {st.face}
        </button>
        <div className="th-hello">
          <h2>
            {greet()}
            {name ? `, ${name}` : ''}
          </h2>
          <p>
            {st.mood === 'focused' ? (
              <>
                <b>Ben</b>: {st.why}
              </>
            ) : (
              <>
                <b>Ben</b> is {st.mood}: {st.why}.
              </>
            )}
          </p>
        </div>
      </div>
      <div className={`th-move move-${m.kind}`}>
        <div>
          <small>Do this now</small>
          <b>{m.title}</b>
          <span>{m.sub}</span>
        </div>
        <div className="th-move-actions">
          {m.kind === 'answer' && (
            <button className="btn ghost" disabled={busy} onClick={() => onGo('coach')}>
              Not yet
            </button>
          )}
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? '…' : label[m.kind]}
          </button>
        </div>
      </div>
      <div className="th-stats">
        <Stat label="Focus" value={`${Math.floor(focusMin / 60) ? `${Math.floor(focusMin / 60)}h ` : ''}${Math.round(focusMin % 60)}m`} sub={st.goals.length ? `${st.goals.reduce((t, g) => t + g.todayLeftMin, 0)} min still for your goals` : 'goal: 50 min a day'} pct={(st.today.focusMin / Math.max(50, st.goals.reduce((t, g) => t + g.perDayMin, 0) || 50)) * 100} tone="ok" />
        <Stat label="Water" value={st.today.waterTarget ? `${(st.today.waterMl / 1000).toFixed(1)} L` : '—'} sub={st.today.waterTarget ? `of ${(st.today.waterTarget / 1000).toFixed(1)} L` : 'log with Ben: water 250'} pct={water * 100} tone="water" />
        <Stat label="Must-dos" value={st.today.mustTotal ? `${st.today.mustDone}/${st.today.mustTotal}` : '—'} sub={st.today.mustTotal ? (st.today.mustDone === st.today.mustTotal ? 'all done 🔥' : `${st.today.mustTotal - st.today.mustDone} to go`) : 'none set yet'} pct={st.today.mustTotal ? (st.today.mustDone / st.today.mustTotal) * 100 : 0} />
      </div>
    </section>
  )
}
