// Today's top, one thin row: Ben (click to talk), what's on now and its one
// button, your points and the bar to the reward you're working toward, and
// the day's numbers (score, focus, water, must-dos).
import { appHour, dayKey } from '@core/dates'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoachStatus } from './web/coachStatus'
import type { ShopState } from '@shared/api'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'
import { useTodayEvents } from './todayEvents'
import { blockSubject, localDay } from '@core/dayTime'
import { focusStreak, liveScore } from '@core/liveScore'
import { runSharedNow, skipSharedNow, useSharedNow } from './nowStore'
import { meetingNow } from '@core/dayGlance'
import { useCountUp } from './motionKit'

/** A number that counts up to its value (shared, AF7). */
export { useCountUp }

const greet = () => {
  const h = new Date().getHours()
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function TodayHero({ name, onGo }: { name?: string; onGo: (page: 'coach' | 'shop') => void }) {
  const act = useAction()
  const [st, setSt] = useState<CoachStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    life.coach?.status?.().then(setSt).catch(() => {})
    // Closed on another device too: today's review is in the synced day plan (Z3).
    life.focus
      .state()
      .then((f) => {
        if ((f.plan.reasons?.length ?? 0) > 0) setClosed(true)
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    // CL2: only while you can see it (coming back to the window reloads it).
    const t = setInterval(() => document.visibilityState !== 'hidden' && load(), 60_000)
    const on = () => load()
    // Anything that changes today's numbers refreshes the card at once (N5), not only focus.
    const EVENTS = ['life-focus-changed', 'life-focus-ended', 'life-water-changed', 'life-body-changed', 'life-sport-changed', 'life-wallet-changed', 'life-tasks-changed', 'life-sleep-changed', 'life-external-changed', 'life-day-closed']
    for (const e of EVENTS) window.addEventListener(e, on)
    window.addEventListener('focus', on)
    return () => {
      clearInterval(t)
      for (const e of EVENTS) window.removeEventListener(e, on)
      window.removeEventListener('focus', on)
    }
  }, [load])
  useLive(load)
  // Your points and the reward you're working toward (pinned first, else the
  // cheapest one you can't afford yet).
  const [shop, setShop] = useState<ShopState | null>(null)
  const loadShop = useCallback(() => void life.shop?.state().then(setShop).catch(() => {}), [])
  useEffect(loadShop, [loadShop])
  useLive(loadShop)
  const focusMin = useCountUp(st?.today.focusMin ?? 0)
  // The one "Do this now", decided by the Now card below (same pick, same button).
  const shared = useSharedNow()
  // What's on now (or soon) in your calendar: the Now card.
  const { events } = useTodayEvents()
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const [closed, setClosed] = useState(() => {
    try {
      return localStorage.getItem('ls.dayClosed') === dayKey(new Date())
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
  const focusGoal = Math.max(50, st.goals.reduce((t, g) => t + g.perDayMin, 0))
  const live = liveScore({
    mustDone: st.today.mustDone,
    openMustDos: st.mustdos.filter((x) => !x.done).map((x) => x.text),
    focusMin: st.today.focusMin,
    focusGoal,
    waterMl: st.today.waterMl,
    waterTarget: st.today.waterTarget,
    workoutDone: !!st.today.workoutDone
  })
  // What the row's left side says and does: evening close, a block now/soon, or Ben's move.
  const evening = appHour(new Date(tick)) >= 19 && !closed && m.kind !== 'running'
  const block = !evening && m.kind !== 'running' && m.kind !== 'answer' ? nowBlock : null
  const soon = !evening && !block && m.kind !== 'running' && m.kind !== 'answer' && nextBlock && Date.parse(nextBlock.start) - tick < 60 * 60000 ? nextBlock : null
  const b = block ?? soon
  const left = b ? Math.max(5, Math.round((Date.parse(b.end) - Math.max(tick, Date.parse(b.start))) / 60000)) : 0
  // In a class or meeting (T4): it says so; Join instead of "Start focus".
  const inMeeting = m.kind !== 'running' ? meetingNow(timed, tick) : null
  const now = inMeeting
    ? {
        tag: `In ${inMeeting.meet || (inMeeting.attendees ?? 0) > 1 ? 'a meeting' : 'class'} until ${hm(inMeeting.end)}`,
        title: inMeeting.title,
        btn: inMeeting.meet ? '🎥 Join' : '',
        go: () => inMeeting.meet && window.open(inMeeting.meet, '_blank', 'noopener')
      }
    : shared
    ? { tag: shared.tag, title: shared.title, btn: shared.button, go: runSharedNow, why: shared.why }
    : evening
    ? { tag: 'Evening', title: 'Close your day · 2 minutes', btn: 'Close my day', go: () => window.dispatchEvent(new CustomEvent('life-close-day')) }
    : b
      ? {
          tag: block ? `Now · ${left} min left` : `Next · ${hm(b.start)}`,
          title: b.title,
          btn: block ? `▶ Start · ${Math.min(180, left)} min` : '▶ Start early',
          go: () => void act(() => life.focus.start(blockSubject(b.title), Math.min(180, left), null), `Focus: ${b.title}`).then(load)
        }
      : { tag: m.kind === 'running' ? 'Focus running' : 'Do this now', title: m.title, btn: busy ? '…' : label[m.kind], go: () => void run() }
  // The reward you're working toward.
  const rewards = (shop?.rewards ?? []).filter((r) => !r.archived && r.price > 0)
  const balance = shop?.balance ?? 0
  const goal = rewards.find((r) => r.pinned) ?? [...rewards].sort((a, b2) => a.price - b2.price).find((r) => r.price > balance) ?? [...rewards].sort((a, b2) => b2.price - a.price)[0]
  const water = st.today.waterTarget ? st.today.waterMl / st.today.waterTarget : 0
  const fm = Math.round(focusMin)
  return (
    <section className={`thb mood-${st.mood}`}>
      <button className={`thb-face mood-${st.mood}`} onClick={() => onGo('coach')} title={`${greet()}${name ? `, ${name}` : ''}. Ben is ${st.mood}: ${st.why}. Click to talk to Ben.`} aria-label="Talk to Ben">
        {st.face}
      </button>
      <div className={`thb-now ${evening ? 'evening' : ''} ${m.kind === 'running' ? 'running' : ''}`}>
        <small>{now.tag}</small>
        <b title={'why' in now && now.why ? `${now.title}: ${now.why}` : now.title}>{now.title}</b>
      </div>
      <div className="thb-act">
        {m.kind === 'running' && (
          <button className="btn small ghost" onClick={() => window.dispatchEvent(new CustomEvent('life-deep-work'))}>
            ⛶ Deep work
          </button>
        )}
        {now.btn && (
          <button className="btn small primary" disabled={busy} onClick={now.go}>
            {now.btn}
          </button>
        )}
        {shared && shared.kind !== 'running' && shared.key !== 'action:done:All done for today 🎉' && (
          <button className="btn small ghost" onClick={skipSharedNow} title="Not now: show the next thing (comes back tomorrow)">
            Skip
          </button>
        )}
      </div>
      <button className={`thb-reward ${goal && balance >= goal.price ? 'ready' : ''}`} onClick={() => onGo('shop')} title="Your rewards: add your own (1h manga, a film…) and redeem them">
        <span className="thb-pts">
          <i className="coin-dot" aria-hidden="true" /> {balance} pts
        </span>
        {goal ? (
          <span className="thb-goal">
            <i style={{ ['--p' as string]: `${Math.min(100, (balance / goal.price) * 100)}%` }} />
            <small>{balance >= goal.price ? `Ready: ${goal.title} 🎉` : `${goal.price - balance} to ${goal.title}`}</small>
          </span>
        ) : (
          <small className="thb-goal-empty">+ Add a reward to work toward</small>
        )}
      </button>
      <div className="thb-nums">
        <span className={live.score >= 70 ? 'good' : ''} title={`Today's score (Ben's evening review). Raise it: ${live.gains.map((g) => `${g.label} +${g.points}`).join(', ') || 'a perfect day'}`}>
          <b>{live.score}</b> score
        </span>
        <span title={focusStreak(st.week) >= 2 ? `Focus streak: ${focusStreak(st.week)} days` : `Goal: ${focusGoal} min`} style={{ ['--p' as string]: `${Math.min(100, (st.today.focusMin / focusGoal) * 100)}%` }}>
          <b>{fm >= 60 ? `${Math.floor(fm / 60)}h${fm % 60 ? ` ${fm % 60}m` : ''}` : `${fm}m`}</b> focus
        </span>
        <span title={st.today.waterTarget ? `of ${st.today.waterTarget.toLocaleString('en-GB')} ml` : 'log with Ben: water 250'} style={{ ['--p' as string]: `${Math.min(100, water * 100)}%` }}>
          {/* In ml, like everywhere you log it (F5). */}
          <b>{st.today.waterTarget ? `${st.today.waterMl.toLocaleString('en-GB')}` : '—'}</b> ml water
        </span>
        <span>
          <b>{st.today.mustTotal ? `${st.today.mustDone}/${st.today.mustTotal}` : '—'}</b> must-dos
        </span>
      </div>
    </section>
  )
}
