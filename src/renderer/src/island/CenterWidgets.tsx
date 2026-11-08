// Custom Center on the island: your widgets in the pill (up to 3 small chips)
// and in the open island (cards you can use), the mode chips, and the clock
// in your style. Everything is drawn from `snap.center` (plain data built by
// the app window, core/islandCenter.ts); every tap is a normal island action,
// so the app logs it through the counter's route and the change shows at once.
// No timers of its own except one per minute for a clock; seconds and the
// analog second hand are CSS steps / transforms, paused while hidden.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CenterCard, CenterIsland } from '@core/islandCenter'
import { clockAngles, clockText, type IslandLooks } from '@core/islandLooks'
import type { IslandAction } from '@core/islandModel'
import { scrubKey, scrubWheel, type ScrubSpec } from '@core/islandScrub'
import { tp } from '../islandTap'
import { bump, useFeel } from '../islandFeel'

type Send = (a: IslandAction, label?: string) => void

/** The minute, redrawn on the minute (one timeout a minute; none while hidden). */
export function useMinute(): number {
  const [t, setT] = useState(() => Date.now())
  useEffect(() => {
    let id = 0
    const arm = () => {
      clearTimeout(id)
      if (document.hidden) return
      id = window.setTimeout(() => {
        setT(Date.now())
        arm()
      }, 60_000 - (Date.now() % 60_000) + 50)
    }
    const vis = () => {
      if (!document.hidden) setT(Date.now())
      arm()
    }
    arm()
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearTimeout(id)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])
  return t
}

const SECS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

/** The clock in your style: digital or analog, 12 or 24 hours, seconds, the date, a second time zone. */
export function ClockFace({ clock, compact = false }: { clock: IslandLooks['clock']; compact?: boolean }) {
  const t = useMinute()
  const now = new Date(t)
  const c = clockText(now, clock)
  // Seconds and the second hand run as CSS (steps / one rotation a minute), started at the right second.
  const delay = { animationDelay: `-${now.getSeconds() + (t % 1000) / 1000}s` } as CSSProperties
  const label = `${c.time}${c.ampm ? ` ${c.ampm}` : ''}${c.date ? `, ${c.date}` : ''}${c.zone ? `, ${c.zone.label} ${c.zone.time}` : ''}`
  if (clock.style === 'analog') {
    const a = clockAngles(now)
    return (
      <span className={`v2c-clock analog ${compact ? 'compact' : ''}`} data-clock="analog" aria-label={label} title={label}>
        <svg viewBox="0 0 24 24" width={compact ? 18 : 30} height={compact ? 18 : 30} aria-hidden>
          <circle cx="12" cy="12" r="10.5" className="v2c-dial" />
          <line x1="12" y1="12" x2="12" y2="6.5" className="v2c-hand h" style={{ transform: `rotate(${a.h}deg)` }} />
          <line x1="12" y1="12" x2="12" y2="4" className="v2c-hand m" style={{ transform: `rotate(${a.m}deg)` }} />
          {clock.seconds && <line x1="12" y1="13.5" x2="12" y2="3.5" className="v2c-hand s" style={delay} />}
        </svg>
        {c.date && !compact && <small className="v2c-date">{c.date}</small>}
        {c.zone && <small className="v2c-zone">{c.zone.label} {c.zone.time}</small>}
      </span>
    )
  }
  return (
    <span className={`v2c-clock digital ${compact ? 'compact' : ''}`} data-clock="digital" aria-label={label} title={label}>
      <b className="v2c-time">{c.time}</b>
      {clock.seconds && (
        <span className="v2c-sec" aria-hidden>
          <span className="v2c-sec-strip" style={delay}>
            {SECS.map((x) => <i key={x}>{x}</i>)}
          </span>
        </span>
      )}
      {c.ampm && <small className="v2c-ampm">{c.ampm}</small>}
      {c.date && <small className="v2c-date">{c.date}</small>}
      {c.zone && <small className="v2c-zone">{c.zone.label} {c.zone.time}</small>}
    </span>
  )
}

/** A small ring for progress (0–1). */
function Ring({ p, size = 16, color }: { p: number; size?: number; color?: string | null }) {
  const r = size / 2 - 2
  const len = 2 * Math.PI * r
  return (
    <svg className="v2c-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} className="v2c-ring-bg" />
      <circle cx={size / 2} cy={size / 2} r={r} className="v2c-ring-fg" style={{ strokeDasharray: len, strokeDashoffset: len * (1 - Math.max(0, Math.min(1, p))), ...(color ? { stroke: color } : {}) }} />
    </svg>
  )
}

const minutesLeft = (endsAt: number, now: number) => `${Math.max(0, Math.ceil((endsAt - now) / 60_000))} min left`

/** A card's value right now (a running timer counts down with the island's clock). */
const valueOf = (c: CenterCard, now: number) => (c.kind === 'timer' && c.endsAt ? minutesLeft(c.endsAt, now) : c.value)

/** The pill: up to three chips. A tap on a counter adds its first step; anything else opens the island. */
export function CenterPill({ c, now, clock, send }: { c: CenterIsland; now: number; clock: IslandLooks['clock']; send: Send }) {
  const f = useFeel()
  if (!c.pill.length) return null
  return (
    <span className="v2c-pill" data-center-pill={c.mode.id}>
      {c.pill.slice(0, 3).map((w) => {
        if (w.kind === 'clock') return <span key={w.id} className="v2c-chip clock" data-center-chip={w.id}><ClockFace clock={clock} compact /></span>
        const step = w.kind === 'counter' ? w.steps?.[0] ?? 1 : 0
        const tap = w.kind === 'counter' ? tp(`center:pill:${w.id}`, (t) => (bump(t.el, f), send({ kind: 'center', op: 'count', widget: w.id, amount: step }, `+${step} ${w.title}`))) : {}
        return (
          <span
            key={w.id}
            className={`v2c-chip k-${w.kind} ${w.done ? 'done' : ''}`}
            data-center-chip={w.id}
            title={w.kind === 'counter' ? `${w.title}: ${w.value} of ${w.goal}. Tap to add ${step}` : `${w.title}: ${valueOf(w, now)}`}
            aria-label={w.kind === 'counter' ? `${w.title} ${w.value}. Add ${step}` : `${w.title} ${valueOf(w, now)}`}
            role={w.kind === 'counter' ? 'button' : undefined}
            style={w.color ? ({ ['--v2c-c' as string]: w.color } as CSSProperties) : undefined}
            {...tap}
          >
            {w.progress != null ? <Ring p={w.progress} size={15} color={w.color} /> : <span className="v2c-ico" aria-hidden>{w.icon}</span>}
            <b className="v2c-val">{valueOf(w, now)}</b>
          </span>
        )
      })}
    </span>
  )
}

/** Scroll on the number (or use the arrow keys), then click to add that many. */
function CounterScrub({ w, send }: { w: CenterCard; send: Send }) {
  const step = Math.max(1, Math.min(...(w.steps?.length ? w.steps : [1])))
  const spec: ScrubSpec = { min: step, max: Math.max(step * 10, (w.goal ?? 100) * 2), step, start: w.steps?.[0] ?? step, unit: w.unit || '' }
  const [v, setVal] = useState(spec.start)
  const cur = useRef(spec.start)
  const acc = useRef(0)
  const setV = (n: number) => {
    cur.current = n
    setVal(n)
  }
  const f = useFeel()
  return (
    <button
      type="button"
      className="v2-scrub v2c-scrub"
      data-center-scrub={w.id}
      data-value={v}
      title={`Scroll to change, click to add ${v}`}
      aria-label={`${v} ${spec.unit} for ${w.title}. Scroll or use the arrow keys to change, click to add`}
      onWheel={(e) => {
        e.stopPropagation()
        const r = scrubWheel(cur.current, acc.current, e.deltaY, spec, e.shiftKey)
        acc.current = r.acc
        if (r.changed) setV(r.value)
      }}
      onKeyDown={(e) => {
        const n = scrubKey(cur.current, e.key, spec)
        if (n == null) return
        e.preventDefault()
        e.stopPropagation()
        setV(n)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      {...tp(`center:scrub:${w.id}`, (t) => (bump(t.el, f), send({ kind: 'center', op: 'count', widget: w.id, amount: cur.current }, `+${cur.current} ${w.title}`)))}
    >
      <span className="v2-scrub-n">{v}</span>
      <span className="v2-scrub-u">{spec.unit}</span>
      <i className="v2-scrub-arrows" aria-hidden>
        <b>▲</b>
        <b>▼</b>
      </i>
    </button>
  )
}

function CenterCardView({ w, now, clock, send, scrub }: { w: CenterCard; now: number; clock: IslandLooks['clock']; send: Send; scrub: boolean }) {
  const f = useFeel()
  const style = w.color ? ({ ['--v2c-c' as string]: w.color } as CSSProperties) : undefined
  return (
    <div className={`v2c-card k-${w.kind} ${w.done ? 'done' : ''}`} data-center-card={w.id} style={style}>
      <div className="v2c-head">
        <span className="v2c-ico" aria-hidden>{w.icon}</span>
        <span className="v2c-title">{w.title}</span>
        {w.progress != null && w.kind !== 'ring' && <Ring p={w.progress} size={16} color={w.color} />}
      </div>
      {w.kind === 'clock' ? (
        <ClockFace clock={clock} />
      ) : w.kind === 'ring' ? (
        <div className="v2c-ringbig">
          <Ring p={w.progress ?? 0} size={44} color={w.color} />
          <span><b className="v2c-val">{w.value}</b><small>{w.sub}</small></span>
        </div>
      ) : (
        <div className="v2c-body">
          <b className="v2c-val">{valueOf(w, now)}</b>
          {w.kind !== 'timer' || !w.endsAt ? <small className="v2c-sub">{w.sub}</small> : <small className="v2c-sub">{w.subject}</small>}
        </div>
      )}
      {w.kind === 'counter' && (
        <div className="v2c-steps" onPointerDown={(e) => e.stopPropagation()}>
          {(w.steps ?? []).map((n) => (
            <button key={n} type="button" className="v2-instant-b" data-center-step={`${w.id}:${n}`} aria-label={`Add ${n} to ${w.title}`} {...tp(`center:step:${w.id}:${n}`, (t) => (bump(t.el, f), send({ kind: 'center', op: 'count', widget: w.id, amount: n }, `+${n} ${w.title}`)))}>
              +{n}
            </button>
          ))}
          {scrub && <CounterScrub w={w} send={send} />}
        </div>
      )}
      {w.kind === 'checklist' && (
        <ul className="v2c-items" onPointerDown={(e) => e.stopPropagation()}>
          {(w.items ?? []).map((it) => (
            <li key={it.id}>
              <button type="button" className={`v2c-item ${it.done ? 'on' : ''}`} aria-pressed={it.done} data-center-item={`${w.id}:${it.id}`} {...tp(`center:check:${w.id}:${it.id}`, () => send({ kind: 'center', op: 'check', widget: w.id, item: it.id }, it.done ? `Untick ${it.text}` : `✓ ${it.text}`))}>
                <i aria-hidden>{it.done ? '✓' : ''}</i>
                {it.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {w.kind === 'timer' && !w.endsAt && (
        <div className="v2c-steps" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="v2-instant-b focus" data-center-timer={w.id} {...tp(`center:timer:${w.id}`, () => send({ kind: 'center', op: 'timer', widget: w.id }, `⏱ ${w.subject ?? w.title}`))}>
            ▶ {w.focusMin} min
          </button>
        </div>
      )}
    </div>
  )
}

/** The mode chips: the one on now, and one tap to switch. */
export function CenterModes({ c, send }: { c: CenterIsland; send: Send }) {
  if (c.modes.length < 2) return null
  return (
    <div className="v2c-modes" role="group" aria-label="Modes" onPointerDown={(e) => e.stopPropagation()}>
      {c.modes.map((m) => (
        <button key={m.id} type="button" className={`v2c-mode ${m.id === c.mode.id ? 'on' : ''}`} aria-pressed={m.id === c.mode.id} data-center-mode={m.id} {...tp(`center:mode:${m.id}`, () => m.id !== c.mode.id && send({ kind: 'center', op: 'mode', mode: m.id }, `${m.icon} ${m.name}`))}>
          {m.icon} {m.name}
        </button>
      ))}
    </div>
  )
}

/**
 * The open island's section: the mode chips and the widgets you placed in the
 * open island (the pill's widgets too when the open island has none).
 */
export function CenterPanel({ c, now, clock, send, scrub }: { c: CenterIsland; now: number; clock: IslandLooks['clock']; send: Send; scrub: boolean }) {
  const cards = c.island.length ? c.island : c.pill
  if (!cards.length && c.modes.length < 2) return null
  return (
    <section className="v2c-panel" data-center-panel={c.mode.id} aria-label={`Your widgets: ${c.mode.name} mode`}>
      <header className="v2c-panel-head">
        <span>{c.mode.icon} {c.mode.name}</span>
        <small>{c.mode.why === 'schedule' ? 'by its times' : c.mode.why === 'manual' ? 'picked by you' : 'base mode'}</small>
      </header>
      <CenterModes c={c} send={send} />
      {cards.length > 0 && (
        <div className="v2c-cards">
          {cards.map((w) => <CenterCardView key={w.id} w={w} now={now} clock={clock} send={send} scrub={scrub} />)}
        </div>
      )}
    </section>
  )
}

/** The hover peek: your pill widgets with their buttons (handy while a timer holds the pill). */
export function CenterPeekRow({ c, clock, send }: { c: CenterIsland; clock: IslandLooks['clock']; send: Send }) {
  const counters = c.pill.filter((w) => w.kind === 'counter')
  if (!counters.length) return null
  return (
    <div className="v2c-peek" onPointerDown={(e) => e.stopPropagation()}>
      {counters.map((w) => (
        <span key={w.id} className="v2-instant-group" data-center-peek={w.id}>
          <span className="v2-instant-ico" aria-hidden>{w.icon}</span>
          <b className="v2c-val">{w.value}</b>
          {(w.steps ?? []).slice(0, 3).map((n) => (
            <button key={n} type="button" className="v2-instant-b" aria-label={`Add ${n} to ${w.title}`} {...tp(`center:peek:${w.id}:${n}`, () => send({ kind: 'center', op: 'count', widget: w.id, amount: n }, `+${n} ${w.title}`))}>
              +{n}
            </button>
          ))}
        </span>
      ))}
      {c.pill.some((w) => w.kind === 'clock') && <ClockFace clock={clock} compact />}
    </div>
  )
}
