// The Goals page's parts: the ring (it fills and counts up on load), the pace
// chart, the week dots and period bars, a goal card for every kind (target,
// habit, limit, repeat, project) with today's one step and a button that does
// it, the card's menu (pin, order, pause, reached), and the detail view with
// the steps, the history, the "future you" picture and the reward. The New /
// Edit sheet is goalSheet.tsx; the celebrations are goalsFx.tsx. Pure maths
// lives in core/goals.ts and core/goalKinds.ts.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { m } from 'framer-motion'
import { createPortal } from 'react-dom'
import { life } from './bridge'
import { useAction } from './ui'
import { celebrate, feedback } from './fx'
import { useCountUp, useSeen } from './motionKit'
import { askConfirm } from './confirmSheet'
import { daysBetween, addDays } from '@core/dates'
import { expectedAt, fmtPair, fmtValue, shortDay, STATUS_TEXT, type GoalCard, type GoalStatus, type GoalUnit, type PaceCurve } from '@core/goals'
import { answerValue, quickStep } from '@core/goalsBen'
import { GOAL_TYPES, hoursText, nextStep, perWord, sourceShort, type GoalStep } from '@core/goalKinds'
import { GOAL_TEMPLATES, type GoalTemplate } from '@core/goalsText'

export type Tone = 'good' | 'warn' | 'bad' | 'calm'
export const toneOf = (s: GoalStatus, paused?: boolean): Tone => (paused ? 'calm' : s === 'done' || s === 'ahead' || s === 'on track' ? 'good' : s === 'behind' ? 'warn' : s === 'not started' ? 'calm' : 'bad')
const AREA_ICON: Record<string, string> = { Money: '💰', Body: '💪', Study: '📚', Career: '🚀', Discipline: '🛡️', Work: '🧰', Life: '🎯' }
export const areaIcon = (a: string) => AREA_ICON[a] ?? '🎯'
export const AREAS = ['Money', 'Body', 'Study', 'Career', 'Discipline', 'Life']
export const goalEmoji = (c: GoalCard) => c.meta?.emoji || areaIcon(c.goal.area)
const typeLabel = (c: GoalCard) => GOAL_TYPES.find((t) => t.id === (c.kind ?? 'target'))?.label ?? ''

/** The soft lights behind the page (they drift slowly; paused when hidden or with reduced motion). */
export function GoalsAmbient() {
  return (
    <div className="gx-amb" aria-hidden>
      <i className="a" />
      <i className="b" />
      <i className="c" />
    </div>
  )
}

/** A progress ring that fills and counts up when it first shows, with a dot where the pace line says you should be. */
export function Ring({ pct, expected, size = 96, stroke = 9, tone, children, roll = false }: { pct: number; expected?: number; size?: number; stroke?: number; tone: Tone; children?: ReactNode; roll?: boolean }) {
  const r = (size - stroke) / 2 - 1
  const c = 2 * Math.PI * r
  const shown = useCountUp(Math.max(0, Math.min(100, pct)), 400, { fromZero: roll })
  const a = expected == null ? null : (Math.max(0, Math.min(100, expected)) / 100) * 2 * Math.PI - Math.PI / 2
  return (
    <div className={`gx-ring t-${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <defs>
          <linearGradient id={`gx-rg-${tone}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="s1" />
            <stop offset="1" className="s2" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} className="bg" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeWidth={stroke} stroke={`url(#gx-rg-${tone})`} strokeOpacity={shown < 0.5 ? 0 : 1} strokeDasharray={`${(shown / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        {a != null && <circle cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={stroke / 2.6} className="pace" />}
      </svg>
      <div className="gx-ring-in">{children}</div>
    </div>
  )
}

/** A number that rolls up to its value on load (tabular digits). */
export function Roll({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  const v = useCountUp(value, 400, { fromZero: true })
  return <>{fmt(v)}</>
}

export interface ChartInput {
  start: number
  target: number
  startDay: string
  deadline: string
  curve: PaceCurve
  series: { day: string; value: number }[]
  today: string
  milestones: number[]
  unit: GoalUnit
  unitLabel?: string
}

/** The pace chart: the dashed line you planned, your real numbers, today, the target. */
export function PaceChart({ c, tone, h = 120, label = true }: { c: ChartInput; tone: Tone; h?: number; label?: boolean }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const W = 320
  const pad = { l: 6, r: 6, t: 10, b: 10 }
  const total = Math.max(1, daysBetween(c.startDay, c.deadline))
  const vals = [c.start, c.target, ...c.series.map((p) => p.value)]
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  if (hi === lo) hi = lo + 1
  const span = hi - lo
  lo -= span * 0.08
  hi += span * 0.08
  const x = (day: string) => pad.l + (Math.max(0, Math.min(total, daysBetween(c.startDay, day))) / total) * (W - pad.l - pad.r)
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b)
  const g = { start: c.start, target: c.target, startDay: c.startDay, deadline: c.deadline, curve: c.curve }
  const plan = Array.from({ length: 25 }, (_, i) => addDays(c.startDay, Math.round((total * i) / 24))).map((d) => `${x(d).toFixed(1)},${y(expectedAt(g, d)).toFixed(1)}`)
  const pts = c.series.filter((p) => p.day <= c.today).map((p) => [x(p.day), y(p.value)] as const)
  const line = pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')
  const area = pts.length > 1 ? `M${pts[0][0].toFixed(1)},${h - pad.b} L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0].toFixed(1)},${h - pad.b} Z` : ''
  const tx = x(c.today)
  const last = pts[pts.length - 1]
  return (
    <div ref={ref} className={`gx-chart chart-in${seen ? ' seen' : ''} t-${tone}`}>
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label="Your numbers against the pace line" style={{ minHeight: h }}>
        <defs>
          <linearGradient id={`gx-area-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="a1" />
            <stop offset="1" className="a2" />
          </linearGradient>
        </defs>
        <line x1={pad.l} x2={W - pad.r} y1={y(c.target)} y2={y(c.target)} className="goal" />
        {c.milestones.map((v) => (
          <line key={v} x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="ms" />
        ))}
        <polyline points={plan.join(' ')} className="plan" />
        {c.today > c.startDay && c.today < c.deadline && <line x1={tx} x2={tx} y1={pad.t - 6} y2={h - pad.b} className="today" />}
        {area && <path d={area} fill={`url(#gx-area-${tone})`} className="area" />}
        {pts.length > 1 && <polyline points={line} className="real draw" pathLength={1} />}
        {last && <circle cx={last[0]} cy={last[1]} r={3.6} className="now" />}
      </svg>
      {label && (
        <div className="gx-chart-legend">
          <span>{shortDay(c.startDay)}</span>
          <span className="k">
            <i className="real" /> you <i className="plan" /> the line
          </span>
          <span>{shortDay(c.deadline)}</span>
        </div>
      )}
    </div>
  )
}

export const chartOf = (card: GoalCard, today: string): ChartInput => ({
  start: card.goal.start,
  target: card.goal.target,
  startDay: card.goal.startDay,
  deadline: card.goal.deadline,
  curve: card.goal.curve,
  series: [...card.series, ...(card.series.some((p) => p.day === today) || today > card.goal.deadline ? [] : [{ day: today, value: card.value }])],
  today,
  milestones: card.milestones.map((x) => x.value),
  unit: card.goal.unit,
  unitLabel: card.goal.unitLabel
})

/** This week's days for a habit: a dot per day, filled when it counted. */
export function WeekDots({ card }: { card: GoalCard }) {
  const days = card.period?.days ?? []
  if (!days.length) return null
  const today = days.find((d) => !d.future && days.every((x) => x.day <= d.day || x.future))?.day
  return (
    <div className="gx-dots" aria-label={`This week: ${card.period?.value} of ${card.period?.target}`}>
      {days.map((d, i) => (
        <span key={d.day} className={`${d.done ? 'on' : ''}${d.future ? ' fut' : ''}${d.day === today ? ' now' : ''}`} style={{ ['--i' as string]: i }}>
          <i />
          <em>{'MTWTFSS'[i]}</em>
        </span>
      ))}
    </div>
  )
}

/** The last weeks or months as bars, with the target line (limits: the line is the cap). */
export function PeriodBars({ card, h = 54 }: { card: GoalCard; h?: number }) {
  const [ref, seen] = useSeen<HTMLDivElement>()
  const pi = card.period
  if (!pi) return null
  const rows = pi.history
  const max = Math.max(pi.target * 1.15, ...rows.map((r) => r.value), 0.01)
  const g = card.goal
  const fmt = (n: number) => (pi.mode === 'days' ? `${n}` : g.unit === 'hours' ? hoursText(n) : fmtValue(g.unit, n, g.unitLabel))
  return (
    <div ref={ref} className={`gx-bars chart-in${seen ? ' seen' : ''}${card.kind === 'limit' ? ' cap' : ''}`} style={{ minHeight: h }} role="img" aria-label={`Last ${rows.length} ${perWord(pi.per)}s`}>
      <span className="line" style={{ bottom: `${(pi.target / max) * 100}%` }} />
      {rows.map((r, i) => (
        <span key={r.key} className={`bar${r.hit ? ' hit' : ''}${i === rows.length - 1 ? ' now' : ''}${card.kind === 'limit' && r.value > pi.target ? ' over' : ''}`} title={`${r.label}: ${fmt(r.value)}`}>
          <i style={{ transform: `scaleY(${Math.max(0.03, r.value / max)})`, animationDelay: `${i * 30}ms` }} />
        </span>
      ))}
    </div>
  )
}

/** A project's steps: tick them right here. */
export function StepList({ card, max, onToggle, busy }: { card: GoalCard; max?: number; onToggle: (s: GoalStep) => void; busy?: boolean }) {
  const steps = card.meta?.steps ?? []
  const next = nextStep(steps)
  const show = max ? [...steps.filter((s) => s.done).slice(-1), ...steps.filter((s) => !s.done)].slice(0, max) : steps
  return (
    <ul className="gx-steps">
      {show.map((s) => (
        <li key={s.id} className={`${s.done ? 'done' : ''}${next?.id === s.id ? ' next' : ''}`}>
          <button type="button" role="checkbox" aria-checked={!!s.done} disabled={busy} onClick={(e) => (e.stopPropagation(), onToggle(s))} aria-label={`${s.done ? 'Untick' : 'Tick'} ${s.text}`}>
            <span className="box" aria-hidden>
              {s.done ? '✓' : ''}
            </span>
            <span className="t">{s.text}</span>
            {s.weight > 1 && <small className="w">×{s.weight}</small>}
          </button>
        </li>
      ))}
      {max && steps.length > show.length && <li className="more">+{steps.length - show.length} more</li>}
    </ul>
  )
}

/** "2 of 4 this week", "1h30 of 5h", "3,200 of 5,000 lei", "4 of 9 steps". */
export function headline(c: GoalCard): { big: string; small: string } {
  const g = c.goal
  const pi = c.period
  const f = (n: number) => (g.unit === 'hours' ? hoursText(n) : fmtValue(g.unit, n, g.unitLabel))
  if (pi) return { big: pi.mode === 'days' ? `${pi.value}` : f(pi.value), small: `of ${pi.mode === 'days' ? `${pi.target} ${c.kind === 'habit' && g.source.kind === 'sleep.bed' ? 'nights' : 'days'}` : f(pi.target)} this ${perWord(pi.per)}` }
  if (c.kind === 'project') {
    const steps = c.meta?.steps ?? []
    return { big: `${steps.filter((s) => s.done).length}`, small: `of ${steps.length} steps` }
  }
  return { big: fmtValue(g.unit, c.value, g.unitLabel), small: `of ${fmtValue(g.unit, g.target, g.unitLabel)}` }
}

// ------------------------------------------------------------ one card

export interface CardActions {
  onChanged: () => void
  onOpen: (c: GoalCard) => void
  onEdit: (c: GoalCard) => void
  onMove?: (c: GoalCard, dir: -1 | 1) => void
  onAskBen?: (text: string) => void
}

/** What the card's main button does today, by kind. */
function useToday(card: GoalCard, onChanged: () => void, el: React.RefObject<HTMLElement | null>) {
  const act = useAction()
  const [busy, setBusy] = useState(false)
  const g = card.goal
  const run = async (fn: () => Promise<any>, msg: (x: any) => string, big = false) => {
    setBusy(true)
    const r = await act(fn, msg)
    setBusy(false)
    if (r) {
      const huge = big || r.done || (r.milestones?.length ?? 0) > 0
      celebrate(el.current, huge ? 'reward' : 'checkin')
      feedback(huge ? 'reward' : 'checkin')
      onChanged()
    }
    return r
  }
  const paid = (x: any) => (x?.paid ? ` · +${x.paid} points` : '')
  return {
    busy,
    logDay: () => run(() => life.extras!.goalLog(g.id, 1), (x) => `✓ ${g.title}: ${x.card.value} of ${g.target} this ${perWord(card.period?.per ?? 'week')}${paid(x)}`),
    undoDay: () => run(() => life.extras!.goalLog(g.id, -1), () => 'Taken back'),
    log: (n: number) => run(() => life.extras!.goalLog(g.id, n), (x) => `Logged ${g.unit === 'hours' ? hoursText(n) : fmtValue(g.unit, n, g.unitLabel)}${paid(x)}`),
    step: (s: GoalStep) => run(() => life.extras!.goalStep(g.id, s.id), (x) => (s.done ? `Unticked: ${s.text}` : x.done ? `🏆 ${g.title}: every step done!${paid(x)}` : `✓ ${s.text}${x.milestones.length ? ` · 🎉 ${x.card.pct}%` : ''}${paid(x)}`), !s.done),
    checkIn: (v: number) => run(() => life.extras!.goalCheckIn(g.id, v), (x) => (x.done ? `🏆 ${g.title}: goal reached!${paid(x)}` : x.milestones.length ? `🎉 Milestone: ${x.milestones.map((ms: any) => ms.label ?? fmtValue(g.unit, ms.value, g.unitLabel)).join(', ')}${paid(x)}` : `Checked in: ${fmtPair(g.unit, v, g.target, g.unitLabel)}${paid(x)}`))
  }
}

/** The card's ⋯ menu: pin, order, pause, reached, edit, remove. */
function CardMenu({ card, onChanged, onEdit, onMove, first, last }: { card: GoalCard; onChanged: () => void; onEdit: () => void; onMove?: (dir: -1 | 1) => void; first?: boolean; last?: boolean }) {
  const act = useAction()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const g = card.goal
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', off)
    window.addEventListener('keydown', k)
    return () => {
      window.removeEventListener('mousedown', off)
      window.removeEventListener('keydown', k)
    }
  }, [open])
  const go = async (fn: () => Promise<unknown>, msg: string) => {
    setOpen(false)
    if ((await act(fn, msg)) !== undefined) onChanged()
  }
  const done = card.status === 'done'
  return (
    <div className="gx-menu" ref={box} onClick={(e) => e.stopPropagation()}>
      <button className="gx-menu-btn" aria-label={`More for ${g.title}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="gx-menu-list" role="menu">
          <button role="menuitem" onClick={() => void go(() => life.extras!.goalPin(g.id, !card.pinned), card.pinned ? 'Unpinned' : `📌 Focus goal: ${g.title}`)}>
            📌 {card.pinned ? 'Unpin' : 'Make it my focus goal'}
          </button>
          {onMove && !first && (
            <button role="menuitem" onClick={() => (setOpen(false), onMove(-1))}>
              ↑ Move up
            </button>
          )}
          {onMove && !last && (
            <button role="menuitem" onClick={() => (setOpen(false), onMove(1))}>
              ↓ Move down
            </button>
          )}
          <button role="menuitem" onClick={() => (setOpen(false), onEdit())}>
            ✎ Edit
          </button>
          <button role="menuitem" onClick={() => void go(() => life.extras!.goalPause(g.id, !card.paused), card.paused ? `▶ ${g.title}: back on` : `⏸ Paused: ${g.title}`)}>
            {card.paused ? '▶ Carry on' : '⏸ Pause'}
          </button>
          <button role="menuitem" onClick={() => void go(() => life.extras!.goalDone(g.id, !done), done ? 'Open again' : `🏆 Marked reached: ${g.title}`)}>
            {done ? '↺ Open it again' : '🏆 Mark it reached'}
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={async () => {
              setOpen(false)
              if (!(await askConfirm(`Remove "${g.title}"? Its check-ins stay in your history.`, { ok: 'Remove' }))) return
              if ((await act(() => life.extras!.archiveMeasure(g.id), `${g.title}: off the list`)) !== undefined) onChanged()
            }}
          >
            ✕ Remove
          </button>
        </div>
      )}
    </div>
  )
}

/** The small check-in / log box under a card. */
function QuickBox({ card, kind, onSave, onClose, busy }: { card: GoalCard; kind: 'checkin' | 'log'; onSave: (n: number) => void; onClose: () => void; busy: boolean }) {
  const g = card.goal
  const step = quickStep(card)
  const [val, setVal] = useState(kind === 'checkin' ? String(card.value) : String(step))
  const typed = Number(val.replace(',', '.'))
  const ok = val.trim() !== '' && Number.isFinite(typed) && (kind === 'checkin' || typed !== 0)
  const label = kind === 'checkin' ? "What's the number now?" : `How much today?${g.unit === 'hours' ? ' (hours)' : ''}`
  return (
    <form
      className="gx-check"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        if (ok) onSave(typed)
      }}
    >
      <label>
        <span>{label}</span>
        <div className="gx-stepper">
          <button type="button" onClick={() => setVal(String(answerValue({ value: Number.isFinite(typed) ? typed : 0 }, `-${step}`)))} aria-label={`Minus ${step}`}>
            −
          </button>
          <input value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d.,-]/g, ''))} inputMode="decimal" autoFocus aria-label={label} />
          <button type="button" onClick={() => setVal(String(answerValue({ value: Number.isFinite(typed) ? typed : 0 }, `+${step}`)))} aria-label={`Plus ${step}`}>
            +
          </button>
        </div>
      </label>
      <div className="gx-check-row">
        <button className="btn primary small" disabled={busy || !ok}>
          Save
        </button>
        {kind === 'checkin' && (
          <button type="button" className="btn small" disabled={busy} onClick={() => onSave(card.value)}>
            Same as before
          </button>
        )}
        <button type="button" className="btn small ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** One goal, any kind: cover, ring, numbers, the pace line, a small chart, today's step and its button. */
export function GoalCardView({ card, today, index, hero, first, last, ...a }: { card: GoalCard; today: string; index: number; hero?: boolean; first?: boolean; last?: boolean } & CardActions) {
  const g = card.goal
  const tone = toneOf(card.status, card.paused)
  const el = useRef<HTMLElement>(null)
  const t = useToday(card, a.onChanged, el)
  const [box, setBox] = useState<null | 'checkin' | 'log'>(null)
  const kind = card.kind ?? 'target'
  const meta = card.meta
  const pi = card.period
  const h = headline(card)
  const open = !card.paused && card.status !== 'done' && card.status !== 'missed'
  const next = kind === 'project' ? nextStep(meta?.steps ?? []) : null

  // The one button for today.
  let main: ReactNode = null
  if (open && !card.auto && kind === 'habit') {
    main = pi?.todayDone ? (
      <button className="btn small ghost" disabled={t.busy} onClick={(e) => (e.stopPropagation(), void t.undoDay())}>
        ↺ Undo today
      </button>
    ) : (
      <button className="btn small primary gx-do" disabled={t.busy} onClick={(e) => (e.stopPropagation(), void t.logDay())}>
        ✓ Done today
      </button>
    )
  } else if (open && !card.auto && (kind === 'limit' || kind === 'repeat')) {
    main = (
      <button className={`btn small ${kind === 'repeat' ? 'primary gx-do' : ''}`} onClick={(e) => (e.stopPropagation(), setBox('log'))}>
        + Log
      </button>
    )
  } else if (open && kind === 'project' && next) {
    main = (
      <button className="btn small primary gx-do" disabled={t.busy} onClick={(e) => (e.stopPropagation(), void t.step(next))} title={`Tick "${next.text}"`}>
        ✓ Done
      </button>
    )
  } else if (open && !card.auto && kind === 'target') {
    main = (
      <button className={`btn small ${card.due ? 'primary gx-do' : ''}`} onClick={(e) => (e.stopPropagation(), setBox('checkin'))}>
        {card.due ? '✓ Check in now' : '✓ Check in'}
      </button>
    )
  }

  const reward = meta?.reward
  return (
    <m.article
      ref={el}
      className={`gx-card t-${tone} k-${kind}${hero ? ' hero' : ''}${card.due ? ' due' : ''}${card.paused ? ' paused' : ''}${card.status === 'done' ? ' reached' : ''} c-${meta?.color ?? 'lime'}`}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, delay: Math.min(index, 8) * 0.05, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => a.onOpen(card)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && a.onOpen(card)}
      aria-label={`${g.title}: ${card.pace}`}
    >
      <div className={`gx-cover cv-${meta?.cover ?? 'aurora'}`} aria-hidden>
        {meta?.cover === 'photo' && meta.photo && <img src={meta.photo} alt="" />}
      </div>
      <header className="gx-card-head">
        <span className="gx-ic" aria-hidden>
          {goalEmoji(card)}
        </span>
        <div className="gx-card-title">
          <small>
            {card.pinned && <b className="gx-pin">📌 Focus · </b>}
            {typeLabel(card)} · {g.area}
            {kind !== 'habit' && kind !== 'limit' && kind !== 'repeat' && g.deadline < '2099' ? ` · by ${shortDay(g.deadline)}` : ''}
          </small>
          <h3 title={g.title}>{g.title}</h3>
        </div>
        <span className={`gx-pill t-${tone}`}>{card.paused ? 'Paused' : pi && card.status === 'ahead' && kind !== 'limit' ? 'Done ✓' : kind === 'limit' && card.status === 'ahead' ? 'Well under' : STATUS_TEXT[card.status]}</span>
        <CardMenu card={card} onChanged={a.onChanged} onEdit={() => a.onEdit(card)} onMove={a.onMove ? (d) => a.onMove!(card, d) : undefined} first={first} last={last} />
      </header>

      <div className="gx-card-body">
        <Ring pct={card.pct} expected={kind === 'target' && card.status !== 'done' ? card.expectedPct : undefined} tone={tone} size={hero ? 118 : 84} stroke={hero ? 11 : 8} roll>
          <b className="num">
            <Roll value={card.pct} fmt={(n) => `${Math.round(n)}%`} />
          </b>
          {hero && <small>{kind === 'limit' ? 'used' : card.status === 'done' ? 'done' : kind === 'target' ? `line ${card.expectedPct}%` : 'done'}</small>}
        </Ring>
        <div className="gx-card-nums">
          <p className="gx-now">
            <b className="num">{h.big}</b>
            <span>{h.small}</span>
          </p>
          <p className={`gx-pace t-${tone}`}>{card.pace}</p>
          {(card.streak > 1 || card.eta || card.best) && (
            <ul className="gx-facts">
              {card.streak > 1 && (
                <li className="fl" title={pi ? `${perWord(pi.per)}s in a row` : 'Check-ins in a row'}>
                  <i>🔥</i>
                  {card.streak} {pi ? `${perWord(pi.per)}s` : 'check-ins'} in a row
                </li>
              )}
              {kind === 'target' && card.status !== 'done' && card.eta && (
                <li>
                  <i>🏁</i>at this pace: {shortDay(card.eta)}
                  {card.eta > g.deadline ? ' (late)' : ''}
                </li>
              )}
              {hero && card.best && (
                <li>
                  <i>🏆</i>
                  {card.best}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {kind === 'habit' && pi?.per === 'week' ? (
        <>
          <WeekDots card={card} />
          {pi.history.length > 1 && <PeriodBars card={card} h={hero ? 48 : 30} />}
        </>
      ) : pi ? <PeriodBars card={card} h={hero ? 64 : 44} /> : kind === 'project' ? <StepList card={card} max={hero ? 4 : 2} onToggle={(s) => void t.step(s)} busy={t.busy} /> : <PaceChart c={chartOf(card, today)} tone={tone} h={hero ? 96 : 52} label={!!hero} />}

      {hero && (g.why || meta?.vision) && (
        <div className="gx-vision">
          <span className="gx-vision-e" aria-hidden>
            {goalEmoji(card)}
          </span>
          <div>
            {meta?.vision && (
              <p>
                <b>Future you:</b> {meta.vision}
              </p>
            )}
            {g.why && <p className="why">“{g.why}”</p>}
          </div>
        </div>
      )}

      {box ? (
        <QuickBox
          card={card}
          kind={box}
          busy={t.busy}
          onClose={() => setBox(null)}
          onSave={(n) => {
            void (box === 'log' ? t.log(n) : t.checkIn(n)).then((r) => r && setBox(null))
          }}
        />
      ) : (
        <footer className="gx-today" onClick={(e) => e.stopPropagation()}>
          <span className="gx-today-text">
            <i aria-hidden>{card.auto && open && kind !== 'project' ? '⚡' : '👉'}</i>
            <span>{card.todayStep}</span>
          </span>
          {main}
          {reward && !hero && (
            <span className="gx-reward-chip" title={`Unlocks ${reward.title} when you reach it`}>
              🎁
            </span>
          )}
        </footer>
      )}
    </m.article>
  )
}

// ------------------------------------------------------------ the detail view

/** Everything about one goal: the big picture, its chart, steps, history, why, future you and the reward. */
export function GoalDetail({ card, today, onClose, onEdit, onChanged, onAskBen, onGo }: { card: GoalCard; today: string; onClose: () => void; onEdit: () => void; onChanged: () => void; onAskBen?: (text: string) => void; onGo?: (p: 'rewards') => void }) {
  const g = card.goal
  const kind = card.kind ?? 'target'
  const tone = toneOf(card.status, card.paused)
  const el = useRef<HTMLDivElement>(null)
  const t = useToday(card, onChanged, el as any)
  const meta = card.meta
  const pi = card.period
  const h = headline(card)
  const [history, setHistory] = useState<{ day: string; value: number; by: string }[]>([])
  useEffect(() => {
    let live = true
    life.extras
      ?.goals([])
      .then((v) => live && setHistory(v.checkins.filter((c) => c.goalId === g.id && c.by !== 'auto').slice(0, 6).map((c) => ({ day: c.day, value: c.value, by: c.by }))))
      .catch(() => null)
    return () => {
      live = false
    }
  }, [g.id, card.lastAt])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const fmt = (n: number) => (g.unit === 'hours' ? hoursText(n) : fmtValue(g.unit, n, g.unitLabel))
  return createPortal(
    <div className="gx-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <m.div ref={el} className={`gx-sheet gx-detail t-${tone}`} role="dialog" aria-modal="true" aria-label={g.title} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
        <div className={`gx-detail-cover cv-${meta?.cover ?? 'aurora'}`}>
          {meta?.cover === 'photo' && meta.photo && <img src={meta.photo} alt="" />}
          <span className="gx-detail-emoji" aria-hidden>
            {goalEmoji(card)}
          </span>
          <button className="gx-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <header className="gx-detail-head">
          <span className="gx-kicker">
            {typeLabel(card)} · {g.area} · {sourceShort(g.source)}
          </span>
          <h2>{g.title}</h2>
        </header>
        <div className="gx-detail-top">
          <Ring pct={card.pct} expected={kind === 'target' && card.status !== 'done' ? card.expectedPct : undefined} tone={tone} size={120} stroke={11} roll>
            <b className="num">{card.pct}%</b>
            <small>{kind === 'limit' ? 'used' : 'done'}</small>
          </Ring>
          <div className="gx-detail-nums">
            <p className="gx-now">
              <b className="num">{h.big}</b>
              <span>{h.small}</span>
            </p>
            <p className={`gx-pace t-${tone}`}>{card.pace}</p>
            <p className="gx-detail-step">👉 {card.todayStep}</p>
            <div className="gx-detail-chips">
              {card.streak > 1 && <span className="gx-chip">🔥 {card.streak} in a row</span>}
              {kind === 'target' && card.eta && card.status !== 'done' && <span className="gx-chip">🏁 At this pace: {shortDay(card.eta)}</span>}
              {pi && pi.mode === 'sum' && <span className="gx-chip">📈 On pace for {fmt(pi.projected)}</span>}
              {card.best && <span className="gx-chip">🏆 {card.best}</span>}
              {g.deadline < '2099' && <span className="gx-chip">📅 {kind === 'target' || kind === 'project' ? 'By' : 'Until'} {shortDay(g.deadline)}</span>}
            </div>
          </div>
        </div>

        {kind === 'project' ? (
          <section className="gx-detail-sec">
            <h3>Steps</h3>
            <StepList card={card} onToggle={(s) => void t.step(s)} busy={t.busy} />
          </section>
        ) : pi ? (
          <section className="gx-detail-sec">
            <h3>{kind === 'habit' && pi.per === 'week' ? 'This week' : `Last ${pi.history.length} ${perWord(pi.per)}s`}</h3>
            {kind === 'habit' && pi.per === 'week' && <WeekDots card={card} />}
            <PeriodBars card={card} h={84} />
          </section>
        ) : (
          <section className="gx-detail-sec">
            <h3>Your numbers and the line</h3>
            <PaceChart c={chartOf(card, today)} tone={tone} h={130} />
          </section>
        )}

        {(meta?.vision || g.why) && (
          <section className={`gx-future cv-${meta?.cover ?? 'aurora'}`}>
            {meta?.cover === 'photo' && meta.photo && <img src={meta.photo} alt="" />}
            <div>
              <span className="gx-kicker">Future you</span>
              {meta?.vision && <p className="v">{meta.vision}</p>}
              {g.why && <p className="w">Why: {g.why}</p>}
            </div>
          </section>
        )}

        {meta?.reward && (
          <section className="gx-detail-reward">
            <span className="gx-big-e">{meta.reward.emoji || '🎁'}</span>
            <div>
              <b>{card.status === 'done' ? 'Unlocked' : 'Unlocks when you reach it'}: {meta.reward.title}</b>
              <small>{meta.reward.price ? `${meta.reward.price} points in Rewards` : 'In Rewards'}</small>
            </div>
            {onGo && (
              <button className="btn small ghost" onClick={() => (onGo('rewards'), onClose())}>
                Rewards →
              </button>
            )}
          </section>
        )}

        {history.length > 0 && (
          <section className="gx-detail-sec">
            <h3>Recent</h3>
            <ul className="gx-hist">
              {history.map((x, i) => (
                <li key={i}>
                  <span>{shortDay(x.day)}</span>
                  <b className="num">{x.by === 'skip' ? 'skipped' : pi ? `${x.value > 0 ? '+' : ''}${pi.mode === 'days' ? x.value : fmt(x.value)}` : kind === 'project' ? `${x.value}%` : fmt(x.value)}</b>
                  <small>{x.by === 'ben' ? 'via Ben' : ''}</small>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="gx-sheet-foot">
          {onAskBen && card.status !== 'done' && (
            <button className="btn ghost" onClick={() => (onAskBen(`Help me with my goal "${g.title}": ${card.pace}. Today's step: ${card.todayStep}. What should I do today?`), onClose())}>
              Ask Ben
            </button>
          )}
          <button className="btn primary" onClick={onEdit}>
            ✎ Edit
          </button>
        </footer>
      </m.div>
    </div>,
    document.body
  )
}

/** Template tiles ("Raise profit to __ by __"…). */
export function TemplateGrid({ onPick, compact }: { onPick: (t: GoalTemplate) => void; compact?: boolean }) {
  return (
    <div className={`gx-tpl${compact ? ' compact' : ''}`}>
      {GOAL_TEMPLATES.map((t) => (
        <button key={t.id} type="button" onClick={() => onPick(t)}>
          <span aria-hidden>{t.icon}</span>
          <b>{t.label}</b>
        </button>
      ))}
    </div>
  )
}
