// Today's top: Ben's face and one line about your day, the one move that
// matters now, and three numbers (focus, water, must-dos). Everything else on
// Today sits below it, and the extras fold away.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoachStatus } from './web/coachStatus'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'
import { useTodayEvents } from './todayEvents'
import { blockSubject, localDay } from '@core/dayTime'
import { focusStreak, liveScore } from '@core/liveScore'

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
  // What's on now (or soon) in your calendar: the Now card.
  const { events } = useTodayEvents()
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem('ls.dayClosed') === new Date().toDateString()
    } catch {
      return false
    }
  })
  useEffect(() => {
    const on = () => setClosed(true)
    window.addEventListener('life-day-closed', on)
    return () => window.removeEventListener('life-day-closed', on)
  }, [])
  const timed = events.filter((e) => !e.allDay && localDay(e.start) === localDay(new Date().toISOString()))
  const nowBlock = timed.filter((e) => Date.parse(e.start) <= tick && Date.parse(e.end) > tick).sort((a, b) => Date.parse(a.end) - Date.parse(a.start) - (Date.parse(b.end) - Date.parse(b.start)))[0]
  const nextBlock = timed.filter((e) => Date.parse(e.start) > tick).sort((a, b) => a.start.localeCompare(b.start))[0]
  const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
      {(() => {
        // Evening: one place to close the day.
        if (new Date(tick).getHours() >= 19 && !closed && m.kind !== 'running')
          return (
            <div className="th-move th-now evening">
              <div>
                <small>Evening</small>
                <b>Close your day · 2 minutes</b>
                <span>What's left goes to tomorrow, Ben's review, tomorrow's top 3.</span>
              </div>
              <div className="th-move-actions">
                <button className="btn primary" onClick={() => window.dispatchEvent(new CustomEvent('life-close-day'))}>
                  Close my day
                </button>
              </div>
            </div>
          )
        // A block on now (and nothing running): start it, see what's next.
        const block = m.kind !== 'running' && m.kind !== 'answer' ? nowBlock : null
        const soon = !block && m.kind !== 'running' && m.kind !== 'answer' && nextBlock && Date.parse(nextBlock.start) - tick < 60 * 60000 ? nextBlock : null
        const b = block ?? soon
        if (!b) return null
        const left = Math.max(5, Math.round((Date.parse(b.end) - Math.max(tick, Date.parse(b.start))) / 60000))
        const inMin = Math.round((Date.parse(b.start) - tick) / 60000)
        return (
          <div className="th-move th-now">
            <div>
              <small>{block ? `Now · ${left} min left` : `Next · in ${inMin} min`}</small>
              <b>{b.title}</b>
              <span>
                {hm(b.start)}–{hm(b.end)}
                {block && nextBlock ? ` · then ${nextBlock.title} at ${hm(nextBlock.start)}` : ''}
              </span>
            </div>
            <div className="th-move-actions">
              <button className="btn primary" disabled={busy} onClick={() => void act(() => life.focus.start(blockSubject(b.title), Math.min(180, left), null), `Focus: ${b.title} · ${Math.min(180, left)} min`).then(load)}>
                ▶ {block ? `Start · ${Math.min(180, left)} min` : 'Start early'}
              </button>
            </div>
          </div>
        )
      })() ?? (
      <div className={`th-move move-${m.kind}`}>
        <div>
          <small>Do this now</small>
          <b>{m.title}</b>
          <span>{m.sub}</span>
        </div>
        <div className="th-move-actions">
          {m.kind === 'running' && (
            <button className="btn ghost" onClick={() => window.dispatchEvent(new CustomEvent('life-deep-work'))}>
              ⛶ Deep work
            </button>
          )}
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
      )}
      {(() => {
        const live = liveScore({
          mustDone: st.today.mustDone,
          openMustDos: st.mustdos.filter((x) => !x.done).map((x) => x.text),
          focusMin: st.today.focusMin,
          focusGoal: Math.max(50, st.goals.reduce((t, g) => t + g.perDayMin, 0)),
          waterMl: st.today.waterMl,
          waterTarget: st.today.waterTarget,
          workoutDone: !!st.today.workoutDone
        })
        return (
          <div className="th-score">
            <div className={`th-score-ring ${live.score >= 70 ? 'good' : ''}`} style={{ ['--p' as string]: `${live.score}%` }} title="Today's score: the same one Ben uses in the evening review">
              <b>{live.score}</b>
              <small>today</small>
            </div>
            {live.gains.length ? (
              <div className="th-gains">
                <span className="th-gains-lead">Raise it:</span>
                {live.gains.slice(0, 4).map((g) => (
                  <button
                    key={g.kind + g.label}
                    className={`th-gain k-${g.kind}`}
                    onClick={() =>
                      g.kind === 'mustdo' || g.kind === 'focus'
                        ? void act(() => life.focus.start(g.kind === 'mustdo' ? g.label.split(/\s+/).slice(0, 4).join(' ').slice(0, 40) : 'Focus', 25, null), `Focus started · 25 min`).then(load)
                        : onGo('coach')
                    }
                    title={g.kind === 'mustdo' || g.kind === 'focus' ? 'Start 25 minutes on it' : 'Log it with Ben'}
                  >
                    {g.label} <em>+{g.points}</em>
                  </button>
                ))}
              </div>
            ) : (
              <span className="th-gains-lead">A perfect day. 🔥</span>
            )}
          </div>
        )
      })()}
      <div className="th-stats">
        <Stat label={focusStreak(st.week) >= 2 ? `Focus · 🔥 ${focusStreak(st.week)} days` : 'Focus'} value={`${Math.floor(focusMin / 60) ? `${Math.floor(focusMin / 60)}h ` : ''}${Math.round(focusMin % 60)}m`} sub={st.goals.length ? `${st.goals.reduce((t, g) => t + g.todayLeftMin, 0)} min still for your goals` : 'goal: 50 min a day'} pct={(st.today.focusMin / Math.max(50, st.goals.reduce((t, g) => t + g.perDayMin, 0) || 50)) * 100} tone="ok" />
        <Stat label="Water" value={st.today.waterTarget ? `${(st.today.waterMl / 1000).toFixed(1)} L` : '—'} sub={st.today.waterTarget ? `of ${(st.today.waterTarget / 1000).toFixed(1)} L` : 'log with Ben: water 250'} pct={water * 100} tone="water" />
        <Stat label="Must-dos" value={st.today.mustTotal ? `${st.today.mustDone}/${st.today.mustTotal}` : '—'} sub={st.today.mustTotal ? (st.today.mustDone === st.today.mustTotal ? 'all done 🔥' : `${st.today.mustTotal - st.today.mustDone} to go`) : 'none set yet'} pct={st.today.mustTotal ? (st.today.mustDone / st.today.mustTotal) * 100 : 0} />
      </div>
    </section>
  )
}
