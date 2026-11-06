// Coach UI v4, "alive companion": Ben as a living presence in the chat.
// - BenLive: his big face. It breathes and blinks, follows your pointer,
//   leans in while you type (a soft pulse per key), swirls while he thinks,
//   talks with each streamed chunk, and shows his mood.
// - CoachAtmos: the chat's soft lights follow the time of day and his mood,
//   with a burst of colour when something good happens.
// - CoachHero: the start screen (greeting, today's numbers, the next thing,
//   big suggestions); it folds away into the chat when you scroll or send.
// - MomentCard: a full-width celebration for a big thing (confetti + sound).
// Motion budget: transform and opacity only (SVG groups included), loops
// only for what is live, nothing while hidden (rAF, html.doc-hidden), calm
// mode keeps Ben breathing but stills the lights, reduced motion stills all.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { BenFace, useCoachLooks } from './BenAvatar'
import { celebrate, feedback } from './fx'
import { reducedMotion, useCountUp } from './motionKit'
import { life } from './bridge'
import { GlyphIcon, Ring, type ChipKind } from './CoachFeed'
import type { CoachStatus } from './web/coachStatus'
import { planTimeline } from '@core/planView'
import type { BenAct, BenFeel, DayPhase, Moment } from '@core/coachAlive'
import './coachAlive.css'

export { CHEER_EVENT, coachCheer } from './coachCheer'

/**
 * Ben's living face. `gaze` is where the message box is from him (his eyes
 * go there while you type). `pulse` and `talk` are counters: each change
 * sends one ring out (a keystroke, a streamed chunk).
 */
export function BenLive({ size = 64, act, feel, pulse = 0, talk = 0, gaze = 'right', online = false, className = '' }: { size?: number; act: BenAct; feel: BenFeel; pulse?: number; talk?: number; gaze?: 'right' | 'down'; online?: boolean; className?: string }) {
  const [looks] = useCoachLooks()
  const ref = useRef<HTMLSpanElement>(null)
  // His eyes follow the pointer a little (one listener, at most once a frame).
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion() || typeof window === 'undefined' || window.matchMedia?.('(hover: none)').matches) return
    let raf = 0
    let px = 0
    let py = 0
    const apply = () => {
      raf = 0
      const r = el.getBoundingClientRect()
      if (!r.width) return
      const dx = px - (r.left + r.width / 2)
      const dy = py - (r.top + r.height / 2)
      const d = Math.max(1, Math.hypot(dx, dy))
      const k = Math.min(1, d / 420)
      el.style.setProperty('--gx', ((dx / d) * k).toFixed(3))
      el.style.setProperty('--gy', ((dy / d) * k).toFixed(3))
    }
    const on = (e: PointerEvent) => {
      px = e.clientX
      py = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }
    window.addEventListener('pointermove', on, { passive: true })
    return () => {
      window.removeEventListener('pointermove', on)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  return (
    <span ref={ref} className={`bl ba live ${act} f-${feel} g-${gaze} ${className}`} style={{ '--ba': `${size}px` } as CSSProperties} aria-hidden>
      <i className="bl-aura" />
      <i className="bl-swirl" />
      {act === 'listening' && pulse > 0 && <i key={`p${pulse}`} className="bl-ping" />}
      {act === 'talking' && talk > 0 && <i key={`t${talk}`} className="bl-wave" />}
      <span className="bl-lean">
        <span className="bl-body">
          <svg className="ba-face" viewBox="0 0 64 64">
            <BenFace look={looks.ben} />
          </svg>
        </span>
      </span>
      {feel === 'sleepy' && act === 'idle' && (
        <span className="bl-z">
          <i>z</i>
          <i>z</i>
        </span>
      )}
      {feel === 'happy' && <span className="bl-spark">✦</span>}
      {online && <i className="ba-dot" />}
    </span>
  )
}

const PHASES: DayPhase[] = ['dawn', 'day', 'dusk', 'night']
const FEELS: BenFeel[] = ['happy', 'focused', 'sleepy', 'stern']

/** The soft lights behind the chat: a set per time of day (cross-faded), a tint for Ben's mood, a burst for good news. */
export function CoachAtmos({ phase, feel, burst }: { phase: DayPhase; feel: BenFeel; burst: number }) {
  return (
    <div className={`cf-amb ph-${phase}`} aria-hidden>
      {PHASES.map((p) => (
        <div key={p} className={`cf-amb-set s-${p} ${p === phase ? 'on' : ''}`}>
          <i className="a" />
          <i className="b" />
          <i className="c" />
        </div>
      ))}
      {FEELS.map((f) => (
        <i key={f} className={`cf-amb-mood m-${f} ${f === feel ? 'on' : ''}`} />
      ))}
      {burst > 0 && <i key={burst} className="cf-amb-burst" />}
    </div>
  )
}

const fmtMin = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n} min`)
const hm = (d: Date) => d.toTimeString().slice(0, 5)
const inWords = (min: number) => (min <= 0 ? 'now' : min < 60 ? `in ${min} min` : `in ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`)

/** The next thing today: a calendar event, else the next block of the plan. */
function useNextThing(): { title: string; when: string } | null | undefined {
  const [next, setNext] = useState<{ title: string; when: string } | null | undefined>(undefined)
  useEffect(() => {
    let off = false
    const now = new Date()
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    const fromPlan = async () => {
      const r = await life.coach?.rhythm?.('state').catch(() => null)
      const plan = r?.state.briefing?.plan
      if (!plan) return null
      const t = now.getHours() * 60 + now.getMinutes()
      const it = planTimeline(plan, t).items.find((x) => x.state === 'now' || x.state === 'next')
      if (!it) return null
      const [h, m] = it.start.split(':').map(Number)
      return { title: it.title, when: it.state === 'now' ? `now, until ${it.end}` : `${it.start} · ${inWords(h * 60 + m - t)}` }
    }
    ;(async () => {
      let found: { title: string; when: string } | null = null
      try {
        const evs = (await life.google?.events(now.toISOString(), end.toISOString())) ?? []
        const ev = evs
          .filter((e) => !e.allDay)
          .map((e) => ({ title: e.title, s: new Date(e.start), e: new Date(e.end) }))
          .filter((e) => e.title && Number.isFinite(e.s.getTime()) && e.e.getTime() > now.getTime())
          .sort((a, b) => a.s.getTime() - b.s.getTime())[0]
        if (ev) found = { title: ev.title, when: ev.s <= now ? `now, until ${hm(ev.e)}` : `${hm(ev.s)} · ${inWords(Math.round((ev.s.getTime() - now.getTime()) / 60000))}` }
      } catch {
        /* no calendar here */
      }
      if (!found) found = await fromPlan()
      if (!off) setNext(found)
    })()
    return () => {
      off = true
    }
  }, [])
  return next
}

function HeroStat({ icon, tone, label, value, sub, ring }: { icon: ChipKind; tone: string; label: string; value: ReactNode; sub: string; ring?: number }) {
  return (
    <div className={`ch-stat t-${tone}`}>
      {ring != null ? (
        <Ring value={ring} size={44} tone={tone === 'water' ? 'water' : tone === 'focus' ? 'focus' : 'accent'}>
          <GlyphIcon kind={icon} size={15} />
        </Ring>
      ) : (
        <span className="ic">
          <GlyphIcon kind={icon} size={18} />
        </span>
      )}
      <span className="tx">
        <small>{label}</small>
        <b>{value}</b>
        <em>{sub}</em>
      </span>
    </div>
  )
}

export interface HeroAsk {
  key: string
  title: string
  sub: string
  icon: ChipKind
  run: () => void
}

/** The start screen: Ben says hello with today's numbers, the next thing and big suggestions. */
export function CoachHero({ title, line, status, asks, ben, closing, onClose }: { title: string; line: string; status: CoachStatus | null; asks: HeroAsk[]; ben: ReactNode; closing: boolean; onClose: () => void }) {
  const next = useNextThing()
  const t = status?.today
  const must = useCountUp(t?.mustDone ?? 0, 600, { fromZero: true, ready: !!t })
  const water = useCountUp((t?.waterMl ?? 0) / 1000, 700, { fromZero: true, ready: !!t })
  const focus = useCountUp(t?.focusMin ?? 0, 700, { fromZero: true, ready: !!t })
  return (
    <div className={`ch-hero ${closing ? 'closing' : ''}`} role="region" aria-label="Start">
      <div className="ch-inner">
        <div className="ch-ben">{ben}</div>
        <h2 className="ch-title">{title}</h2>
        <p className="ch-line">{line}</p>
        {t && (
          <div className="ch-stats">
            <HeroStat icon="done" tone="must" label="Must-dos" value={t.mustTotal ? `${Math.round(must)}/${t.mustTotal}` : '—'} sub={t.mustTotal ? (t.mustDone >= t.mustTotal ? 'all done' : `${t.mustTotal - t.mustDone} left`) : 'none yet'} ring={t.mustTotal ? t.mustDone / t.mustTotal : 0} />
            <HeroStat icon="water" tone="water" label="Water" value={`${water.toFixed(1)} L`} sub={t.waterTarget ? `of ${(t.waterTarget / 1000).toFixed(1)} L` : 'no goal set'} ring={t.waterTarget ? t.waterMl / t.waterTarget : 0} />
            <HeroStat icon="focus" tone="focus" label="Focus" value={fmtMin(Math.round(focus))} sub="today" ring={Math.min(1, (t.focusMin || 0) / 120)} />
          </div>
        )}
        <div className={`ch-next ${next === undefined ? 'wait' : ''}`}>
          <GlyphIcon kind="plan" size={16} />
          {next ? (
            <span>
              <small>Next</small> <b>{next.title}</b> <em>{next.when}</em>
            </span>
          ) : (
            <span>{next === null ? 'Nothing else on your calendar today' : 'Looking at your day…'}</span>
          )}
        </div>
        <div className="ch-asks">
          {asks.map((a, k) => (
            <button key={a.key} type="button" className={`ch-ask k-${a.icon}`} style={{ '--k': k } as CSSProperties} onClick={a.run}>
              <span className="ic">
                <GlyphIcon kind={a.icon} size={20} />
              </span>
              <b>{a.title}</b>
              <small>{a.sub}</small>
            </button>
          ))}
        </div>
        <button type="button" className="ch-down" onClick={onClose}>
          Show the chat <span aria-hidden>↓</span>
        </button>
      </div>
    </div>
  )
}

const MOMENT_ICON: Record<Moment['kind'], string> = { plan: '🗓', goal: '🎯', streak: '🔥' }

/** A big moment: full width, confetti from fx.ts and one sound (both respect your settings). */
export function MomentCard({ moment, onClose }: { moment: Moment; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    feedback('reward')
    if (!el || reducedMotion()) return
    const timers: number[] = []
    // Measured when each burst fires: the chat scrolls the card into view first.
    ;[0.15, 0.38, 0.62, 0.85, 0.5].forEach((x, k) =>
      timers.push(
        window.setTimeout(() => {
          const r = el.getBoundingClientRect()
          const y = Math.max(40, Math.min(window.innerHeight - 40, r.top + r.height * 0.4))
          celebrate({ x: r.left + r.width * x, y }, k % 2 ? 'reward' : 'habit')
        }, 260 + k * 110)
      )
    )
    return () => timers.forEach(clearTimeout)
  }, [])
  return (
    <div ref={ref} className={`cf-moment k-${moment.kind}`} role="status">
      <span className="mo-rays" aria-hidden />
      <span className="mo-badge" aria-hidden>
        {MOMENT_ICON[moment.kind]}
      </span>
      <span className="mo-tx">
        <small>{moment.kind === 'plan' ? 'Locked in' : moment.kind === 'streak' ? 'Streak' : 'Milestone'}</small>
        <b>{moment.title}</b>
        <em>{moment.sub}</em>
      </span>
      <button type="button" className="mo-x" onClick={onClose} aria-label="Close">
        ✕
      </button>
    </div>
  )
}
