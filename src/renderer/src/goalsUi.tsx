// The Goals page's parts: the ring, the pace chart (where you are against
// where the line says you should be), a goal card with its check-in, the
// guided New goal sheet (templates, plain words, a live pace preview) and
// the soft lights behind the page. Pure maths lives in core/goals*.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { m } from 'framer-motion'
import { createPortal } from 'react-dom'
import { life } from './bridge'
import { useAction } from './ui'
import { celebrate, feedback } from './fx'
import { useSeen } from './motionKit'
import { askConfirm } from './confirmSheet'
import { daysBetween, addDays } from '@core/dates'
import { CADENCES, countsFromStart, GOAL_UNITS, SOURCES, expectedAt, fmtDelta, fmtPair, fmtValue, milestonesOf, needText, requiredPerDay, shortDay, STATUS_TEXT, type Cadence, type GoalCard, type GoalSource, type GoalStatus, type GoalUnit, type PaceCurve } from '@core/goals'
import { answerValue, behindMove, quickStep } from '@core/goalsBen'
import { GOAL_TEMPLATES, parseGoalText, suggestCadence, type GoalTemplate } from '@core/goalsText'
import { Select } from './Select'

export type Tone = 'good' | 'warn' | 'bad' | 'calm'
export const toneOf = (s: GoalStatus): Tone => (s === 'done' || s === 'ahead' || s === 'on track' ? 'good' : s === 'behind' ? 'warn' : s === 'not started' ? 'calm' : 'bad')
const AREA_ICON: Record<string, string> = { Money: '💰', Body: '💪', Study: '📚', Career: '🚀', Discipline: '🛡️', Work: '🧰', Life: '🎯' }
export const areaIcon = (a: string) => AREA_ICON[a] ?? '🎯'
const CURVES: { id: PaceCurve; label: string; hint: string }[] = [
  { id: 'line', label: 'Straight', hint: 'the same every week' },
  { id: 'ramp', label: 'Slow start', hint: 'small steps first, bigger later' },
  { id: 'front', label: 'Fast start', hint: 'most of it early (weight)' }
]

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

/** A progress ring with a small dot where the pace line says you should be. */
export function Ring({ pct, expected, size = 96, stroke = 9, tone, children }: { pct: number; expected?: number; size?: number; stroke?: number; tone: Tone; children?: ReactNode }) {
  const r = (size - stroke) / 2 - 1
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct))
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
        <circle cx={size / 2} cy={size / 2} r={r} className="fg" strokeWidth={stroke} stroke={`url(#gx-rg-${tone})`} strokeDasharray={`${(p / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        {a != null && <circle cx={size / 2 + r * Math.cos(a)} cy={size / 2 + r * Math.sin(a)} r={stroke / 2.6} className="pace" />}
      </svg>
      <div className="gx-ring-in">{children}</div>
    </div>
  )
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
  const pad = { l: 6, r: 6, t: 14, b: 16 }
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
      <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" role="img" aria-label="Your numbers against the pace line">
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

const chartOf = (card: GoalCard, today: string): ChartInput => ({
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

const SOURCE_NOTE: Partial<Record<GoalSource['kind'], string>> = {
  'money.profit': 'Counts itself from Finance Helper',
  'money.income': 'Counts itself from Finance Helper',
  'money.saved': 'Counts itself from Finance Helper',
  'body.weight': 'Counts itself from your weight on Body',
  'body.workouts': 'Counts itself from your workouts',
  'sport.reps': 'Counts itself from your reps',
  'focus.hours': 'Counts itself from the focus timer',
  'tasks.done': 'Counts itself from Todoist',
  'habit.clean': 'Counts itself from your clean streak'
}

/** One goal: ring, numbers, the pace chart, milestones, why, and the check-in. */
export function GoalCardView({ card, today, index, onChanged, onEdit, onAskBen }: { card: GoalCard; today: string; index: number; onChanged: () => void; onEdit: (c: GoalCard) => void; onAskBen?: (text: string) => void }) {
  const act = useAction()
  const g = card.goal
  const tone = toneOf(card.status)
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const el = useRef<HTMLElement>(null)
  const v = (n: number) => fmtValue(g.unit, n, g.unitLabel)
  const step = quickStep(card)
  const up = g.target >= g.start
  const move = behindMove(card)
  useEffect(() => {
    if (open) setVal(String(card.value))
  }, [open, card.value])

  const done = async (r: Awaited<ReturnType<NonNullable<typeof life.extras>['goalCheckIn']>> | undefined) => {
    setBusy(false)
    if (!r) return
    setOpen(false)
    const big = r.done || r.milestones.length > 0
    celebrate(el.current, big ? 'reward' : 'checkin')
    feedback(big ? 'reward' : 'checkin')
    onChanged()
  }
  const save = async (value: number) => {
    setBusy(true)
    const r = await act(
      () => life.extras!.goalCheckIn(g.id, value),
      (x) => (x.done ? `🏆 ${g.title}: goal reached!${x.paid ? ` +${x.paid} points` : ''}` : x.milestones.length ? `🎉 Milestone: ${x.milestones.map((m) => m.label ?? v(m.value)).join(', ')}${x.paid ? ` · +${x.paid} points` : ''}` : `Checked in: ${fmtPair(g.unit, value, g.target, g.unitLabel)}${x.paid ? ` · +${x.paid} points` : ''}`)
    )
    await done(r)
  }
  const skip = async () => {
    if (await act(() => life.extras!.goalSkip(g.id), 'Skipped this time')) {
      setOpen(false)
      onChanged()
    }
  }
  const remove = async () => {
    if (!(await askConfirm(`Remove "${g.title}"? Its check-ins stay in your history.`, { ok: 'Remove' }))) return
    if (await act(() => life.extras!.archiveMeasure(g.id), `${g.title}: off the list`)) onChanged()
  }
  const typed = Number(val.replace(',', '.'))
  const daysText = card.status === 'done' ? 'Reached 🏆' : card.status === 'missed' ? 'Deadline passed' : `${card.daysLeft} day${card.daysLeft === 1 ? '' : 's'} left`

  return (
    <m.article
      ref={el}
      className={`gx-card t-${tone}${card.due ? ' due' : ''}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay: Math.min(index, 6) * 0.05, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="gx-card-head">
        <span className="gx-ic" aria-hidden>
          {areaIcon(g.area)}
        </span>
        <div className="gx-card-title">
          <small>
            {g.area} · by {shortDay(g.deadline)}
          </small>
          <h3 title={g.title}>{g.title}</h3>
        </div>
        <span className={`gx-pill t-${tone}`}>{STATUS_TEXT[card.status]}</span>
      </header>

      <div className="gx-card-body">
        <Ring pct={card.pct} expected={card.status === 'done' ? undefined : card.expectedPct} tone={tone} size={104}>
          <b className="num">{card.pct}%</b>
          <small>{card.status === 'done' ? 'done' : `line ${card.expectedPct}%`}</small>
        </Ring>
        <div className="gx-card-nums">
          <p className="gx-now">
            <b className="num">{v(card.value)}</b>
            <span> of {v(g.target)}</span>
          </p>
          <ul className="gx-facts">
            <li>
              <i>⏳</i>
              {daysText}
            </li>
            {card.need && (
              <li>
                <i>📈</i>need <b>{card.need}</b>
              </li>
            )}
            <li>
              <i>🏁</i>
              {card.status === 'done' ? `on ${shortDay(g.doneDay ?? today)}` : card.eta ? `at this pace: ${shortDay(card.eta)}${card.eta > g.deadline && (card.status === 'behind' || card.status === 'at risk') ? ' (late)' : ''}` : 'pace: check in twice to see'}
            </li>
          </ul>
        </div>
      </div>

      <PaceChart c={chartOf(card, today)} tone={tone} />

      <div className="gx-ms" aria-label="Milestones">
        {card.milestones.map((ms, i) => (
          <span key={i} className={ms.reached ? 'on' : i === card.next.index ? 'next' : ''} title={`${ms.label ?? ''} ${v(ms.value)}`.trim()}>
            <i />
            <em>{v(ms.value)}</em>
          </span>
        ))}
        <span className={card.status === 'done' ? 'on goal' : 'goal'}>
          <i />
          <em>🏆</em>
        </span>
      </div>
      {card.status !== 'done' && card.next && (
        <p className="gx-next">
          Next milestone: <b>{v(card.next.value)}</b> · {fmtDelta(g.unit, card.next.value - card.value, g.unitLabel).replace(/^[+−]/, '')} to go
        </p>
      )}
      {g.why && <p className="gx-why">“{g.why}”</p>}
      {move && card.status !== 'done' && (
        <p className="gx-move">
          <span>👉 {move.text}</span>
          {move.do.startsWith('focus:') && (
            <button
              className="btn small ghost"
              onClick={() => {
                const [, min, subject] = /^focus:(\d+):(.+)$/.exec(move.do) ?? []
                void act(() => life.focus.start(subject, Number(min), null), `Focus started: ${subject} · ${min} min`)
              }}
            >
              ▶ Start
            </button>
          )}
        </p>
      )}

      {open && !card.auto ? (
        <form
          className="gx-check"
          onSubmit={(e) => {
            e.preventDefault()
            if (Number.isFinite(typed) && val.trim()) void save(typed)
          }}
        >
          <label>
            <span>What's the number now?</span>
            <div className="gx-stepper">
              <button type="button" onClick={() => setVal(String(answerValue({ value: Number.isFinite(typed) ? typed : card.value }, `-${step}`)))} aria-label={`Minus ${step}`}>
                −
              </button>
              <input value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d.,-]/g, ''))} inputMode="decimal" autoFocus aria-label="The number now" />
              <button type="button" onClick={() => setVal(String(answerValue({ value: Number.isFinite(typed) ? typed : card.value }, `+${step}`)))} aria-label={`Plus ${step}`}>
                +
              </button>
            </div>
          </label>
          <div className="gx-check-row">
            <button className="btn primary small" disabled={busy || !val.trim() || !Number.isFinite(typed)}>
              Save {up ? '' : ''}
            </button>
            <button type="button" className="btn small" disabled={busy} onClick={() => void save(card.value)}>
              Same as before
            </button>
            <button type="button" className="btn small ghost" disabled={busy} onClick={() => void skip()}>
              Skip
            </button>
          </div>
        </form>
      ) : (
        <footer className="gx-card-foot">
          {card.auto ? (
            <span className="gx-auto">⚡ {SOURCE_NOTE[g.source.kind] ?? 'Counts itself'}</span>
          ) : card.status === 'done' || card.status === 'missed' ? null : (
            <button className={`btn small ${card.due ? 'primary' : ''}`} onClick={() => setOpen(true)}>
              {card.due ? '✓ Check in now' : '✓ Check in'}
            </button>
          )}
          {card.streak > 0 && <span className="gx-streak" title="Check-ins in a row">🔥 {card.streak}</span>}
          <span className="gx-spacer" />
          {onAskBen && card.status !== 'done' && (
            <button className="btn small ghost" onClick={() => onAskBen(`How do I get my "${g.title}" goal back on track? I'm at ${v(card.value)} of ${v(g.target)} with ${card.daysLeft} days left.`)} title="Ask Ben for a plan">
              Ask Ben
            </button>
          )}
          <button className="btn small ghost" onClick={() => onEdit(card)}>
            Edit
          </button>
          <button className="btn small ghost" onClick={() => void remove()} aria-label={`Remove ${g.title}`}>
            ✕
          </button>
        </footer>
      )}
    </m.article>
  )
}

// ------------------------------------------------------------ the sheet

interface Form {
  id?: number
  template: string
  kind: 'measure' | 'hours'
  title: string
  unit: GoalUnit
  unitLabel: string
  target: string
  start: string
  deadline: string
  why: string
  area: string
  cadence: Cadence
  source: GoalSource
  curve: PaceCurve
  subject: string
}

const blankForm = (today: string): Form => ({ template: 'custom', kind: 'measure', title: '', unit: 'count', unitLabel: '', target: '', start: '', deadline: addDays(today, 56), why: '', area: 'Life', cadence: 'weekly', source: { kind: 'manual' }, curve: 'line', subject: '' })
const AREAS = ['Money', 'Body', 'Study', 'Career', 'Discipline', 'Life']

export function formFromCard(c: GoalCard): Form {
  const g = c.goal
  return { id: g.id, template: 'custom', kind: 'measure', title: g.title, unit: g.unit, unitLabel: g.unitLabel ?? '', target: String(g.target), start: String(g.start), deadline: g.deadline, why: g.why, area: g.area, cadence: g.cadence, source: g.source, curve: g.curve, subject: '' }
}

/** Template tiles ("Raise profit to __ by __"…). */
export function TemplateGrid({ onPick, compact }: { onPick: (t: GoalTemplate) => void; compact?: boolean }) {
  return (
    <div className={`gx-tpl${compact ? ' compact' : ''}`}>
      {GOAL_TEMPLATES.map((t) => (
        <button key={t.id} type="button" onClick={() => onPick(t)}>
          <span aria-hidden>{t.icon}</span>
          <b>{t.label}</b>
          {!compact && <small>{SOURCES.find((s) => s.id === t.source.kind)?.label}</small>}
        </button>
      ))}
    </div>
  )
}

/**
 * The guided New goal sheet: say it in words or pick a template, then the
 * target, the deadline, how it's measured, how often Ben checks in, and why.
 * A live pace preview shows what it takes.
 */
export function GoalSheet({ today, initial, words, template, onClose, onSaved }: { today: string; initial?: Form | null; words?: string; template?: GoalTemplate | null; onClose: () => void; onSaved: (title: string) => void }) {
  const act = useAction()
  const [f, setF] = useState<Form>(() => initial ?? blankForm(today))
  const [said, setSaid] = useState(words ?? '')
  const [heard, setHeard] = useState<string | null>(null)
  const [autoNow, setAutoNow] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))

  const useTemplate = (t: GoalTemplate) =>
    setF((x) => ({
      ...x,
      template: t.id,
      kind: t.kind,
      unit: t.unit,
      unitLabel: t.unitLabel ?? '',
      source: t.source,
      cadence: t.cadence,
      curve: t.curve,
      area: t.area,
      target: x.target || '',
      title: '',
      subject: t.source.arg ?? ''
    }))

  // A template passed in (from the empty page) or words (from Ben, the island, Ctrl+K).
  useEffect(() => {
    if (template) useTemplate(template)
    if (words) hear(words)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The number an auto source shows now: the start, and "lose 5 kg" becomes a target.
  useEffect(() => {
    let live = true
    if (f.source.kind === 'manual' || f.id || countsFromStart(f.source.kind)) {
      setAutoNow(null)
      return
    }
    life.extras?.goalAutoValue(f.source).then((n) => live && setAutoNow(n ?? null)).catch(() => live && setAutoNow(null))
    return () => {
      live = false
    }
  }, [f.source.kind, f.source.arg, f.id])

  function hear(text: string) {
    const d = parseGoalText(text, today)
    if (!d) {
      setHeard(text.trim().length > 6 ? "Couldn't find a number to aim at yet: try “save 2000 lei by 31 Dec”." : null)
      return
    }
    setHeard(`Got it: ${d.title}${d.deadline ? ` · by ${shortDay(d.deadline)}` : ' · pick the deadline below'}`)
    setF((x) => ({
      ...x,
      template: d.delta != null ? 'lose' : d.template === 'lose' ? 'custom' : (d.template ?? 'custom'),
      kind: d.kind,
      title: d.title,
      unit: d.unit,
      unitLabel: d.unitLabel ?? '',
      target: d.target != null ? String(d.target) : d.delta != null ? String(Math.abs(d.delta)) : x.target,
      deadline: d.deadline ?? x.deadline,
      area: d.area,
      cadence: d.deadline ? suggestCadence(today, d.deadline) : d.cadence,
      source: d.source,
      curve: d.curve,
      subject: d.subject ?? x.subject
    }))
  }

  const tpl = GOAL_TEMPLATES.find((t) => t.id === f.template)
  const change = tpl?.change === 'down' && f.kind === 'measure'
  const startNum = f.start.trim() !== '' ? Number(f.start) : autoNow ?? 0
  const amount = Number(f.target)
  // "Lose 5 kg": the target is 5 down from where you are.
  const targetNum = change ? Math.round((startNum - Math.abs(amount)) * 10) / 10 : amount
  const unitLabel = f.unit === 'custom' ? f.unitLabel.trim() || 'things' : undefined
  const autoTitle = tpl && tpl.id !== 'custom' && f.target ? tpl.title(fmtValue(f.unit, Math.abs(Number(f.target)), unitLabel), f.subject || f.source.arg) : ''
  const title = f.title.trim() || autoTitle
  const valid = !!title && (!change || startNum > 0) && Number.isFinite(targetNum) && f.target.trim() !== '' && targetNum !== startNum && /^\d{4}-\d{2}-\d{2}$/.test(f.deadline) && f.deadline > today && (!SOURCES.find((s) => s.id === f.source.kind)?.needsArg || !!(f.source.arg || f.subject).trim())
  const days = Math.max(1, daysBetween(today, f.deadline || today))
  const per = valid ? requiredPerDay({ id: 0, title, unit: f.unit, start: startNum, target: targetNum, startDay: today, deadline: f.deadline, why: '', area: f.area, cadence: f.cadence, source: f.source, milestones: [], curve: f.curve, doneDay: null }, startNum, today) : 0
  const preview: ChartInput | null = valid
    ? { start: startNum, target: targetNum, startDay: today, deadline: f.deadline, curve: f.curve, series: [], today, milestones: milestonesOf({ start: startNum, target: targetNum, milestones: [], unit: f.unit }).map((x) => x.value), unit: f.unit, unitLabel }
    : null

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    const ok =
      f.kind === 'hours'
        ? await act(() => life.focus.saveGoal({ title, subject: (f.subject || f.source.arg || title).trim(), deadline: f.deadline, hours: Math.abs(targetNum) }), `🎯 Goal set: ${title}`)
        : await act(
            () =>
              life.extras!.saveMeasure({
                id: f.id,
                title,
                unit: f.unit,
                unitLabel,
                target: targetNum,
                start: f.start.trim() === '' ? (change ? startNum : null) : Number(f.start),
                deadline: f.deadline,
                why: f.why,
                area: f.area,
                cadence: f.cadence,
                source: f.source.kind === 'manual' ? f.source : { kind: f.source.kind, ...(f.source.arg || f.subject ? { arg: (f.source.arg || f.subject).trim() } : {}) },
                curve: f.curve
              }),
            f.id ? `Saved: ${title}` : `🎯 Goal set: ${title}`
          )
    setSaving(false)
    if (ok) {
      if (!f.id) {
        celebrate(box.current, 'reward')
        feedback('reward')
      }
      onSaved(title)
    }
  }

  // Esc closes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const srcMeta = SOURCES.find((s) => s.id === f.source.kind)
  const sources = useMemo(() => SOURCES.filter((s) => s.id === 'manual' || s.unit === null || s.unit === f.unit || (f.unit === 'eur' || f.unit === 'usd' ? s.unit === 'lei' : false) || (f.kind === 'hours' && s.id === 'focus.hours')), [f.unit, f.kind])

  return createPortal(
    <div className="gx-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <m.div ref={box} className="gx-sheet" role="dialog" aria-modal="true" aria-label={f.id ? 'Edit goal' : 'New goal'} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
        <header className="gx-sheet-head">
          <div>
            <span className="gx-kicker">{f.id ? 'Edit goal' : 'New goal'}</span>
            <h2>{f.id ? title || 'Your goal' : 'What do you want to reach?'}</h2>
          </div>
          <button className="gx-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {!f.id && (
          <>
            <label className="gx-say">
              <span>Say it in your words</span>
              <input
                value={said}
                onChange={(e) => {
                  setSaid(e.target.value)
                  hear(e.target.value)
                }}
                placeholder="e.g. raise profit to 5000 lei by 31 Dec"
                maxLength={200}
                autoFocus={!words && !template}
                aria-label="Your goal in words"
              />
              {heard && <small className="gx-heard">{heard}</small>}
            </label>
            <div className="gx-or">
              <span>or start from one</span>
            </div>
            <TemplateGrid compact onPick={(t) => (useTemplate(t), setSaid(''), setHeard(null))} />
          </>
        )}

        <section className="gx-preview" aria-live="polite">
          {preview ? (
            <>
              <PaceChart c={preview} tone="good" h={96} />
              <p>
                <b>{fmtPair(f.unit, startNum, targetNum, unitLabel)}</b> in {days} days · that's <b>{needText({ unit: f.unit, unitLabel, cadence: f.cadence }, per, days) || '—'}</b>
                {f.kind === 'measure' ? (f.source.kind === 'manual' ? ` · Ben asks ${CADENCES.find((c) => c.id === f.cadence)!.label.toLowerCase()}` : ' · counts itself') : ' · planned into focus blocks'}
              </p>
            </>
          ) : (
            <p className="hint">{change && !startNum ? 'Log your weight on Body (or type where you start) to see the pace line.' : 'Fill in the target and the date to see the pace line.'}</p>
          )}
        </section>

        <div className="gx-fields">
          <label className="wide">
            <span>Goal</span>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={autoTitle || 'e.g. Profit 5,000 lei a month'} maxLength={80} aria-label="Goal title" />
          </label>
          {tpl?.extra && f.kind !== 'measure' ? (
            <label>
              <span>{tpl.extra.split(',')[0]}</span>
              <input value={f.subject} onChange={(e) => set({ subject: e.target.value })} placeholder={tpl.extra.split(', ')[1] ?? ''} maxLength={40} />
            </label>
          ) : null}
          <label>
            <span>{change ? 'How much to lose' : 'Target'}</span>
            <div className="gx-unit">
              <input value={f.target} onChange={(e) => set({ target: e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.') })} inputMode="decimal" placeholder={String(tpl?.example ?? 10)} aria-label="Target" />
              <Select value={f.unit} onChange={(e) => set({ unit: e.target.value as GoalUnit })} aria-label="Unit" disabled={f.kind === 'hours'}>
                {GOAL_UNITS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </div>
          </label>
          {f.unit === 'custom' && (
            <label>
              <span>Counted in</span>
              <input value={f.unitLabel} onChange={(e) => set({ unitLabel: e.target.value })} placeholder="stars, books, flags…" maxLength={16} />
            </label>
          )}
          <label>
            <span>By</span>
            <input type="date" value={f.deadline} min={addDays(today, 1)} onChange={(e) => set({ deadline: e.target.value, cadence: f.id ? f.cadence : suggestCadence(today, e.target.value) })} aria-label="Deadline" />
          </label>
          {f.kind === 'measure' && (
            <label>
              <span>Starting from</span>
              <input value={f.start} onChange={(e) => set({ start: e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.') })} inputMode="decimal" placeholder={autoNow != null ? `${autoNow} (now)` : '0'} aria-label="Start value" />
            </label>
          )}
          {f.kind === 'measure' && (
            <label className="wide">
              <span>How it's measured</span>
              <Select value={f.source.kind} onChange={(e) => set({ source: { kind: e.target.value as GoalSource['kind'], ...(f.source.arg ? { arg: f.source.arg } : {}) } })} aria-label="How it's measured">
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <small className="hint">{srcMeta?.hint}{autoNow != null ? ` · now ${fmtValue(f.unit, autoNow, unitLabel)}` : ''}</small>
            </label>
          )}
          {f.kind === 'measure' && srcMeta?.needsArg && (
            <label>
              <span>{srcMeta.needsArg.split(',')[0]}</span>
              <input value={f.source.arg ?? ''} onChange={(e) => set({ source: { ...f.source, arg: e.target.value } })} placeholder={srcMeta.needsArg.split(', ')[1] ?? ''} maxLength={40} />
            </label>
          )}
          {f.kind === 'measure' && (
            <div className="wide gx-seg-wrap">
              <span>Ben checks in</span>
              <div className="gx-seg" role="radiogroup" aria-label="Check-in rhythm">
                {CADENCES.map((c) => (
                  <button type="button" key={c.id} role="radio" aria-checked={f.cadence === c.id} className={f.cadence === c.id ? 'on' : ''} onClick={() => set({ cadence: c.id })}>
                    {c.label}
                  </button>
                ))}
              </div>
              {f.source.kind !== 'manual' && <small className="hint">This one counts itself: Ben reports the change instead of asking.</small>}
            </div>
          )}
          {f.kind === 'measure' && (
            <div className="wide gx-seg-wrap">
              <span>Pace</span>
              <div className="gx-seg" role="radiogroup" aria-label="Pace line">
                {CURVES.map((c) => (
                  <button type="button" key={c.id} role="radio" aria-checked={f.curve === c.id} className={f.curve === c.id ? 'on' : ''} onClick={() => set({ curve: c.id })} title={c.hint}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="wide">
            <span>Why it matters (one line)</span>
            <input value={f.why} onChange={(e) => set({ why: e.target.value })} placeholder="e.g. pay rent without stress" maxLength={140} />
          </label>
          <div className="wide gx-areas" role="radiogroup" aria-label="Area">
            {AREAS.map((a) => (
              <button type="button" key={a} role="radio" aria-checked={f.area === a} className={f.area === a ? 'on' : ''} onClick={() => set({ area: a })}>
                {areaIcon(a)} {a}
              </button>
            ))}
          </div>
        </div>

        <footer className="gx-sheet-foot">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || saving} onClick={() => void save()}>
            {f.id ? 'Save changes' : '🎯 Set this goal'}
          </button>
        </footer>
      </m.div>
    </div>,
    document.body
  )
}
