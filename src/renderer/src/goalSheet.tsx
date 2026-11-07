// The New / Edit goal sheet: say it in words (the parser understands every
// kind) or pick a kind, then what counts, how it's measured (your own logs or
// data the app already has), the steps of a project, and what keeps you
// going: why, the "future you" picture (an emoji, a drawn cover or a small
// photo kept in your own data), a colour, and a reward from Rewards that
// unlocks when you get there. Everything can be changed later.
import { useEffect, useMemo, useRef, useState } from 'react'
import { m } from 'framer-motion'
import { createPortal } from 'react-dom'
import { life } from './bridge'
import { useAction } from './ui'
import { celebrate, feedback } from './fx'
import { daysBetween, addDays } from '@core/dates'
import { argOptional, CADENCES, countsFromStart, GOAL_UNITS, SOURCES, fmtPair, fmtValue, milestonesOf, needText, requiredPerDay, shortDay, type Cadence, type GoalCard, type GoalSource, type GoalUnit, type PaceCurve } from '@core/goals'
import { COLORS, COVERS, GOAL_TYPES, SOURCES_FOR, isPeriodType, stepsFromText, type GoalColor, type GoalCover, type GoalStep, type GoalType, type Per, type RewardLink } from '@core/goalKinds'
import { GOAL_TEMPLATES, parseGoalText, suggestCadence, type GoalTemplate } from '@core/goalsText'
import { Select } from './Select'
import { AREAS, areaIcon, PaceChart, TemplateGrid, type ChartInput } from './goalsUi'

const NO_END = '2099-12-31'
const CURVES: { id: PaceCurve; label: string; hint: string }[] = [
  { id: 'line', label: 'Straight', hint: 'the same every week' },
  { id: 'ramp', label: 'Slow start', hint: 'small steps first, bigger later' },
  { id: 'front', label: 'Fast start', hint: 'most of it early (weight)' }
]
const EMOJIS = ['🎯', '🏋️', '💪', '🌙', '💧', '📚', '🛡️', '🦀', '🏦', '💰', '🚀', '⭐', '🧠', '🎮', '🏆', '🔥']
const COVER_LABEL: Record<string, string> = { aurora: 'Aurora', sunrise: 'Sunrise', ocean: 'Ocean', forest: 'Forest', night: 'Night', ember: 'Ember' }

export interface Form {
  id?: number
  type: GoalType
  template: string
  /** 'hours': an hour goal planned into focus blocks (the Hours tab). */
  kind: 'measure' | 'hours'
  title: string
  unit: GoalUnit
  unitLabel: string
  target: string
  start: string
  deadline: string
  noEnd: boolean
  why: string
  area: string
  cadence: Cadence
  source: GoalSource
  curve: PaceCurve
  subject: string
  per: Per
  dayMin: string
  steps: GoalStep[]
  emoji: string
  color: GoalColor
  cover: GoalCover
  photo: string | null
  vision: string
  reward: RewardLink | null
  /** LF4: the vision card this goal serves. */
  card?: string | null
}

const sid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const blankForm = (today: string): Form => ({ type: 'target', template: 'custom', kind: 'measure', title: '', unit: 'count', unitLabel: '', target: '', start: '', deadline: addDays(today, 56), noEnd: true, why: '', area: 'Life', cadence: 'weekly', source: { kind: 'manual' }, curve: 'line', subject: '', per: 'week', dayMin: '', steps: [], emoji: '', color: 'lime', cover: 'aurora', photo: null, vision: '', reward: null })

export function formFromCard(c: GoalCard): Form {
  const g = c.goal
  const mt = c.meta
  return {
    id: g.id,
    type: c.kind ?? 'target',
    template: 'custom',
    kind: 'measure',
    title: g.title,
    unit: g.unit,
    unitLabel: g.unitLabel ?? '',
    target: String(g.target),
    start: String(g.start),
    deadline: g.deadline >= NO_END ? addDays(g.startDay, 84) : g.deadline,
    noEnd: g.deadline >= NO_END,
    why: g.why,
    area: g.area,
    cadence: g.cadence,
    source: g.source,
    curve: g.curve,
    subject: '',
    per: mt?.per ?? 'week',
    dayMin: mt && mt.dayMin !== 1 ? String(mt.dayMin) : '',
    steps: mt?.steps ?? [],
    emoji: mt?.emoji ?? '',
    color: mt?.color ?? 'lime',
    cover: mt?.cover ?? 'aurora',
    photo: mt?.photo ?? null,
    vision: mt?.vision ?? '',
    reward: mt?.reward ?? null,
    card: mt?.card ?? null
  }
}

/** A picture you picked, made small (480×270, JPEG) so it fits in your data; never a link. */
function shrinkPhoto(file: File): Promise<string | null> {
  return new Promise((done) => {
    if (!/^image\//.test(file.type) || file.size > 15_000_000) return done(null)
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const W = 480
      const H = 270
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const x = c.getContext('2d')
      if (!x) return done(null)
      const k = Math.max(W / img.width, H / img.height)
      x.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k)
      URL.revokeObjectURL(url)
      let q = 0.75
      let out = c.toDataURL('image/jpeg', q)
      while (out.length > 110_000 && q > 0.35) out = c.toDataURL('image/jpeg', (q -= 0.1))
      done(out.length <= 110_000 ? out : null)
    }
    img.onerror = () => (URL.revokeObjectURL(url), done(null))
    img.src = url
  })
}

/** What counts for a habit day from data, in words ("2,000 ml a day"). */
const dayMinLabel = (k: GoalSource['kind']) => (k === 'water' ? 'ml that make a day' : k === 'focus.hours' || k === 'pc.work' ? 'hours that make a day' : k === 'sport.reps' ? 'reps that make a day' : k === 'tasks.done' ? 'tasks that make a day' : '')

export function GoalSheet({ today, initial, words, template, onClose, onSaved }: { today: string; initial?: Form | null; words?: string; template?: GoalTemplate | null; onClose: () => void; onSaved: (title: string) => void }) {
  const act = useAction()
  const [f, setF] = useState<Form>(() => initial ?? blankForm(today))
  // LF4: your vision cards, so a goal can serve one.
  const [cards, setCards] = useState<{ id: string; text: string }[]>([])
  useEffect(() => {
    void life.saga?.view({ budget: null }).then((v) => setCards(v.vision.cards.map((c) => ({ id: c.id, text: c.text })))).catch(() => {})
  }, [])
  const [said, setSaid] = useState(words ?? '')
  const [heard, setHeard] = useState<string | null>(null)
  const [autoNow, setAutoNow] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [rewards, setRewards] = useState<RewardLink[]>([])
  const [stepText, setStepText] = useState('')
  const [photoErr, setPhotoErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }))
  const prevReward = useRef(initial?.reward?.id ?? null)

  const useTemplate = (t: GoalTemplate) =>
    setF((x) => ({ ...x, type: 'target', template: t.id, kind: t.kind, unit: t.unit, unitLabel: t.unitLabel ?? '', source: t.source, cadence: t.cadence, curve: t.curve, area: t.area, target: x.target || '', title: '', subject: t.source.arg ?? '' }))

  useEffect(() => {
    if (template) useTemplate(template)
    if (words) hear(words)
    life.extras
      ?.goalRewards?.()
      .then((r) => setRewards(r))
      .catch(() => setRewards([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The number an auto source shows now: the start, and "lose 5 kg" becomes a target.
  useEffect(() => {
    let live = true
    if (f.type !== 'target' || f.source.kind === 'manual' || f.id || countsFromStart(f.source.kind)) {
      setAutoNow(null)
      return
    }
    life.extras?.goalAutoValue(f.source).then((n) => live && setAutoNow(n ?? null)).catch(() => live && setAutoNow(null))
    return () => {
      live = false
    }
  }, [f.source.kind, f.source.arg, f.id, f.type])

  function hear(text: string) {
    const d = parseGoalText(text, today)
    if (!d) {
      setHeard(text.trim().length > 6 ? 'No number or rhythm yet: try “workout 4 times a week” or “save 2000 lei by 31 Dec”.' : null)
      return
    }
    const type: GoalType = d.type ?? 'target'
    const kindWord = GOAL_TYPES.find((t) => t.id === type)?.label.toLowerCase()
    setHeard(`Got it: ${d.title}${type !== 'target' ? ` (${kindWord})` : ''}${d.deadline ? ` · by ${shortDay(d.deadline)}` : type === 'target' || type === 'project' ? ' · pick the date below' : ''}`)
    setF((x) => ({
      ...x,
      type,
      template: d.delta != null ? 'lose' : d.template === 'lose' ? 'custom' : (d.template ?? 'custom'),
      kind: d.kind,
      title: d.title,
      unit: d.unit,
      unitLabel: d.unitLabel ?? '',
      target: d.target != null ? String(d.target) : d.delta != null ? String(Math.abs(d.delta)) : x.target,
      deadline: d.deadline ?? x.deadline,
      noEnd: isPeriodType(type) ? !d.deadline : x.noEnd,
      area: d.area,
      cadence: d.deadline ? suggestCadence(today, d.deadline) : d.cadence,
      source: d.source,
      curve: d.curve,
      subject: d.subject ?? x.subject,
      per: d.per ?? (type === 'repeat' ? 'month' : 'week'),
      dayMin: d.dayMin && d.dayMin !== 1 ? String(d.dayMin) : '',
      steps: d.steps ? d.steps.map((s) => ({ id: sid(), text: s.text, weight: s.weight, done: null })) : x.steps
    }))
  }

  const pickType = (type: GoalType) =>
    setF((x) => {
      const src = SOURCES_FOR[type].includes(x.source.kind) ? x.source : { kind: 'manual' as const }
      return { ...x, type, kind: 'measure', source: src, per: type === 'repeat' ? 'month' : x.per, unit: type === 'project' ? 'pct' : type === 'limit' && x.unit === 'count' ? 'hours' : x.unit === 'pct' && type !== 'target' ? 'count' : x.unit }
    })

  const tpl = GOAL_TEMPLATES.find((t) => t.id === f.template)
  const period = isPeriodType(f.type)
  const change = f.type === 'target' && tpl?.change === 'down' && f.kind === 'measure'
  const startNum = f.start.trim() !== '' ? Number(f.start) : (autoNow ?? 0)
  const amount = Number(f.target)
  const targetNum = change ? Math.round((startNum - Math.abs(amount)) * 10) / 10 : amount
  const unitLabel = f.unit === 'custom' ? f.unitLabel.trim() || 'things' : undefined
  const autoTitle = f.type === 'target' && tpl && tpl.id !== 'custom' && f.target ? tpl.title(fmtValue(f.unit, Math.abs(Number(f.target)), unitLabel), f.subject || f.source.arg) : ''
  const title = f.title.trim() || autoTitle
  const srcMeta = SOURCES.find((s) => s.id === f.source.kind)
  const argOk = !srcMeta?.needsArg || argOptional(f.source.kind) || !!(f.source.arg || f.subject).trim()
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(f.deadline) && (f.deadline > today || !!f.id)
  const valid =
    !!title &&
    argOk &&
    (f.type === 'project'
      ? f.steps.length > 0 && dateOk
      : period
        ? Number.isFinite(amount) && amount > 0 && (f.type !== 'habit' || amount <= (f.per === 'week' ? 7 : 31)) && (f.noEnd || dateOk)
        : (!change || startNum > 0) && Number.isFinite(targetNum) && f.target.trim() !== '' && targetNum !== startNum && dateOk)
  const days = Math.max(1, daysBetween(today, f.deadline || today))
  const per = valid && f.type === 'target' ? requiredPerDay({ id: 0, title, unit: f.unit, start: startNum, target: targetNum, startDay: today, deadline: f.deadline, why: '', area: f.area, cadence: f.cadence, source: f.source, milestones: [], curve: f.curve, doneDay: null }, startNum, today) : 0
  const preview: ChartInput | null = valid && f.type === 'target' ? { start: startNum, target: targetNum, startDay: today, deadline: f.deadline, curve: f.curve, series: [], today, milestones: milestonesOf({ start: startNum, target: targetNum, milestones: [], unit: f.unit }).map((x) => x.value), unit: f.unit, unitLabel } : null
  const sources = useMemo(() => SOURCES.filter((s) => SOURCES_FOR[f.type].includes(s.id) && (f.type !== 'target' || s.id === 'manual' || s.unit === null || s.unit === f.unit || ((f.unit === 'eur' || f.unit === 'usd') && s.unit === 'lei') || (f.kind === 'hours' && s.id === 'focus.hours'))), [f.unit, f.kind, f.type])

  const addSteps = () => {
    const list = stepsFromText(stepText)
    if (!list.length) return
    set({ steps: [...f.steps, ...list.map((s) => ({ id: sid(), text: s.text, weight: s.weight, done: null }))].slice(0, 40) })
    setStepText('')
  }

  const save = async () => {
    if (!valid || saving) return
    setSaving(true)
    const meta = { type: f.type, per: f.per, dayMin: Number(f.dayMin) > 0 ? Number(f.dayMin) : 1, steps: f.steps, emoji: f.emoji, color: f.color, cover: f.cover, photo: f.photo, vision: f.vision, reward: f.reward, card: f.card ?? null }
    const src: GoalSource = f.source.kind === 'manual' ? f.source : { kind: f.source.kind, ...((f.source.arg || f.subject).trim() ? { arg: (f.source.arg || f.subject).trim() } : {}) }
    const saved =
      f.kind === 'hours' && f.type === 'target'
        ? await act(() => life.focus.saveGoal({ title, subject: (f.subject || f.source.arg || title).trim(), deadline: f.deadline, hours: Math.abs(targetNum) }), `🎯 Goal set: ${title}`)
        : await act(
            () =>
              life.extras!.saveMeasure({
                id: f.id,
                title,
                unit: f.type === 'project' ? 'pct' : f.unit,
                unitLabel,
                target: f.type === 'project' ? 100 : targetNum,
                start: f.type !== 'target' ? 0 : f.start.trim() === '' ? (change ? startNum : null) : Number(f.start),
                deadline: period && f.noEnd ? NO_END : f.deadline,
                why: f.why,
                area: f.area,
                cadence: f.cadence,
                source: src,
                curve: f.curve,
                meta
              }),
            f.id ? `Saved: ${title}` : `🎯 Goal set: ${title}`
          )
    // The reward unlocks when the goal is reached (Rewards' own lock).
    const id = f.id ?? (saved && typeof saved === 'object' && 'id' in (saved as any) ? Number((saved as any).id) : null)
    if (saved && id && life.extras?.setUnlock && f.kind === 'measure') {
      if (prevReward.current && prevReward.current !== f.reward?.id) {
        const v = await life.extras.unlocks().catch(() => null)
        const lock = v?.locks[String(prevReward.current)]
        if (lock && lock.kind === 'goal' && lock.goalId === id) await life.extras.setUnlock(prevReward.current, null).catch(() => null)
      }
      if (f.reward) await life.extras.setUnlock(f.reward.id, { kind: 'goal', goalId: id, title }).catch(() => null)
    }
    setSaving(false)
    if (saved) {
      if (!f.id) {
        celebrate(box.current, 'reward')
        feedback('reward')
      }
      onSaved(title)
    }
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const kindMeta = GOAL_TYPES.find((t) => t.id === f.type)!
  const perWordX = f.per === 'month' ? 'month' : 'week'
  const fmtT = (n: number) => fmtValue(f.unit, n, unitLabel)

  return createPortal(
    <div className="gx-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <m.div ref={box} className="gx-sheet gx-edit" role="dialog" aria-modal="true" aria-label={f.id ? 'Edit goal' : 'New goal'} initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
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
          <label className="gx-say">
            <span>Say it in your words</span>
            <input
              value={said}
              onChange={(e) => {
                setSaid(e.target.value)
                hear(e.target.value)
              }}
              placeholder="e.g. workout 4 times a week · save 2000 lei by 31 Dec · Security+: domain 1..5, book exam"
              maxLength={200}
              autoFocus={!words && !template}
              aria-label="Your goal in words"
            />
            {heard && <small className="gx-heard">{heard}</small>}
          </label>
        )}

        <div className="gx-kinds" role="radiogroup" aria-label="Kind of goal">
          {GOAL_TYPES.map((t) => (
            <button type="button" key={t.id} role="radio" aria-checked={f.type === t.id} className={f.type === t.id ? 'on' : ''} onClick={() => pickType(t.id)} title={t.hint}>
              <span aria-hidden>{t.icon}</span>
              <b>{t.label}</b>
            </button>
          ))}
        </div>
        <p className="hint gx-kind-hint">{kindMeta.hint}</p>
        {!f.id && f.type === 'target' && (
          <details className="gx-more-tpl">
            <summary>Start from a template</summary>
            <TemplateGrid compact onPick={(t) => (useTemplate(t), setSaid(''), setHeard(null))} />
          </details>
        )}

        <section className="gx-preview" aria-live="polite">
          {preview ? (
            <>
              <PaceChart c={preview} tone="good" h={84} />
              <p>
                <b>{fmtPair(f.unit, startNum, targetNum, unitLabel)}</b> in {days} days · that's <b>{needText({ unit: f.unit, unitLabel, cadence: f.cadence }, per, days) || '—'}</b>
                {f.kind === 'measure' ? (f.source.kind === 'manual' ? ` · Ben asks ${CADENCES.find((c) => c.id === f.cadence)!.label.toLowerCase()}` : ' · counts itself') : ' · planned into focus blocks'}
              </p>
            </>
          ) : valid && period ? (
            <p>
              <b>{f.type === 'habit' ? `${amount}× a ${perWordX}` : f.type === 'limit' ? `At most ${f.unit === 'hours' ? `${amount}h` : fmtT(amount)} a ${perWordX}` : `${f.unit === 'hours' ? `${amount}h` : fmtT(amount)} every ${perWordX}`}</b>
              {f.noEnd ? ', no end date' : `, until ${shortDay(f.deadline)}`} · {f.source.kind === 'manual' ? (f.type === 'habit' ? 'you tap “Done today”' : 'you log it') : `counts itself (${srcMeta?.label.toLowerCase()})`} · a 🔥 for every {perWordX} you make
            </p>
          ) : valid && f.type === 'project' ? (
            <p>
              <b>{f.steps.length} steps</b> in {days} days · about <b>{Math.max(1, Math.round((f.steps.length / days) * 7))} a week</b> · each step you tick moves the ring
            </p>
          ) : (
            <p className="hint">{change && !startNum ? 'Log your weight on Body (or type where you start) to see the pace line.' : f.type === 'project' ? 'Add the steps and a date to see the plan.' : 'Fill in the number to see what it takes.'}</p>
          )}
        </section>

        <h3 className="gx-fsec">The goal</h3>
        <div className="gx-fields">
          <label className="wide">
            <span>Name</span>
            <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={autoTitle || (f.type === 'habit' ? 'e.g. Work out 4× a week' : f.type === 'limit' ? 'e.g. Gaming: at most 5h a week' : f.type === 'repeat' ? 'e.g. Save 2,000 lei every month' : f.type === 'project' ? 'e.g. Get Security+' : 'e.g. Profit 5,000 lei a month')} maxLength={80} aria-label="Goal title" />
          </label>
          {f.type !== 'project' && (
            <label>
              <span>{f.type === 'habit' ? `Times a ${perWordX}` : f.type === 'limit' ? `At most, a ${perWordX}` : f.type === 'repeat' ? `Every ${perWordX}` : change ? 'How much to lose' : 'Target'}</span>
              <div className="gx-unit">
                <input value={f.target} onChange={(e) => set({ target: e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.') })} inputMode="decimal" placeholder={f.type === 'habit' ? '4' : String(tpl?.example ?? 10)} aria-label="Target" />
                {f.type !== 'habit' && (
                  <Select value={f.unit} onChange={(e) => set({ unit: e.target.value as GoalUnit })} aria-label="Unit" disabled={f.kind === 'hours'}>
                    {GOAL_UNITS.filter((u) => u.id !== 'pct' || f.type === 'target').map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </label>
          )}
          {period && (
            <div className="gx-seg-wrap">
              <span>Per</span>
              <div className="gx-seg" role="radiogroup" aria-label="Per week or month">
                {(['week', 'month'] as Per[]).map((p) => (
                  <button type="button" key={p} role="radio" aria-checked={f.per === p} className={f.per === p ? 'on' : ''} onClick={() => set({ per: p })}>
                    {p === 'week' ? 'Week' : 'Month'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {f.unit === 'custom' && f.type !== 'habit' && f.type !== 'project' && (
            <label>
              <span>Counted in</span>
              <input value={f.unitLabel} onChange={(e) => set({ unitLabel: e.target.value })} placeholder="stars, books, flags…" maxLength={16} />
            </label>
          )}
          {period ? (
            <label>
              <span>Until</span>
              <div className="gx-until">
                <label className="gx-check-inline">
                  <input type="checkbox" checked={f.noEnd} onChange={(e) => set({ noEnd: e.target.checked })} /> No end
                </label>
                {!f.noEnd && <input type="date" value={f.deadline} min={addDays(today, 1)} onChange={(e) => set({ deadline: e.target.value })} aria-label="Until" />}
              </div>
            </label>
          ) : (
            <label>
              <span>By</span>
              <input type="date" value={f.deadline} min={f.id ? undefined : addDays(today, 1)} onChange={(e) => set({ deadline: e.target.value, cadence: f.id ? f.cadence : suggestCadence(today, e.target.value) })} aria-label="Deadline" />
            </label>
          )}
          {f.type === 'target' && f.kind === 'measure' && (
            <label>
              <span>Starting from</span>
              <input value={f.start} onChange={(e) => set({ start: e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.') })} inputMode="decimal" placeholder={autoNow != null ? `${autoNow} (now)` : '0'} aria-label="Start value" />
            </label>
          )}
          {tpl?.extra && f.kind === 'hours' && (
            <label>
              <span>{tpl.extra.split(',')[0]}</span>
              <input value={f.subject} onChange={(e) => set({ subject: e.target.value })} placeholder={tpl.extra.split(', ')[1] ?? ''} maxLength={40} />
            </label>
          )}
        </div>

        {f.type === 'project' && (
          <div className="gx-step-edit">
            <ul>
              {f.steps.map((s, i) => (
                <li key={s.id}>
                  <span className={`n${s.done ? ' done' : ''}`} title={s.done ? `Done ${shortDay(s.done)}` : undefined}>{s.done ? '✓' : i + 1}</span>
                  <input value={s.text} onChange={(e) => set({ steps: f.steps.map((x) => (x.id === s.id ? { ...x, text: e.target.value.slice(0, 80) } : x)) })} aria-label={`Step ${i + 1}`} />
                  <div className="w" title="How big this step is">
                    <button type="button" onClick={() => set({ steps: f.steps.map((x) => (x.id === s.id ? { ...x, weight: Math.max(1, x.weight - 1) } : x)) })} aria-label="Smaller">
                      −
                    </button>
                    <b>×{s.weight}</b>
                    <button type="button" onClick={() => set({ steps: f.steps.map((x) => (x.id === s.id ? { ...x, weight: Math.min(10, x.weight + 1) } : x)) })} aria-label="Bigger">
                      +
                    </button>
                  </div>
                  <button type="button" className="x" onClick={() => set({ steps: f.steps.filter((x) => x.id !== s.id) })} aria-label={`Remove step ${i + 1}`}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="add">
              <input value={stepText} onChange={(e) => setStepText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSteps())} placeholder="Add steps: “domain 1..5, 3 practice exams, book exam”" maxLength={300} aria-label="Add steps" />
              <button type="button" className="btn small" onClick={addSteps} disabled={!stepText.trim()}>
                Add
              </button>
            </div>
          </div>
        )}

        {f.type !== 'project' && f.kind === 'measure' && (
          <>
            <h3 className="gx-fsec">How it's measured</h3>
            <div className="gx-fields">
              <label className="wide">
                <span>Counted from</span>
                <Select value={f.source.kind} onChange={(e) => set({ source: { kind: e.target.value as GoalSource['kind'], ...(f.source.arg ? { arg: f.source.arg } : {}) } })} aria-label="How it's measured">
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id === 'manual' ? (f.type === 'habit' ? 'I tap “Done today”' : f.type === 'target' ? 'I check in' : 'I log it') : s.label}
                    </option>
                  ))}
                </Select>
                <small className="hint">
                  {srcMeta?.id === 'manual' ? (f.type === 'target' ? 'Ben asks you for the number on your rhythm' : 'Quick taps on the card; Ben asks when you forget') : srcMeta?.hint}
                  {autoNow != null ? ` · now ${fmtValue(f.unit, autoNow, unitLabel)}` : ''}
                </small>
              </label>
              {srcMeta?.needsArg && (
                <label>
                  <span>{srcMeta.needsArg.split(',')[0]}</span>
                  <input value={f.source.arg ?? ''} onChange={(e) => set({ source: { ...f.source, arg: e.target.value } })} placeholder={srcMeta.needsArg.split(', ')[1] ?? ''} maxLength={40} />
                </label>
              )}
              {f.type === 'habit' && dayMinLabel(f.source.kind) && (
                <label>
                  <span>{cap(dayMinLabel(f.source.kind))}</span>
                  <input value={f.dayMin} onChange={(e) => set({ dayMin: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') })} inputMode="decimal" placeholder={f.source.kind === 'water' ? '2000' : '1'} />
                </label>
              )}
              {f.type === 'target' && (
                <div className="wide gx-seg-wrap">
                  <span>Ben checks in</span>
                  <div className="gx-seg" role="radiogroup" aria-label="Check-in rhythm">
                    {CADENCES.map((c) => (
                      <button type="button" key={c.id} role="radio" aria-checked={f.cadence === c.id} className={f.cadence === c.id ? 'on' : ''} onClick={() => set({ cadence: c.id })}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {f.type === 'target' && (
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
            </div>
          </>
        )}

        {f.kind === 'measure' && (
          <>
            <h3 className="gx-fsec">What keeps you going</h3>
            <div className="gx-fields">
              <label className="wide">
                <span>Why it matters (one line)</span>
                <input value={f.why} onChange={(e) => set({ why: e.target.value })} placeholder="e.g. pay rent without stress" maxLength={140} />
              </label>
              <label className="wide">
                <span>Future you: what life looks like when you get there</span>
                <textarea value={f.vision} onChange={(e) => set({ vision: e.target.value })} placeholder="e.g. I walk into the exam calm, I know this stuff, and the job offers come to me." maxLength={200} rows={2} />
              </label>
              {cards.length > 0 && (
                <label className="wide">
                  <span>The vision card it serves</span>
                  <Select value={f.card ?? ''} onChange={(e) => set({ card: e.target.value || null })}>
                    <option value="">None</option>
                    {cards.map((c) => <option key={c.id} value={c.id}>{c.text}</option>)}
                  </Select>
                </label>
              )}
              <label className="wide">
                <span>Reward when you reach it</span>
                <Select
                  value={f.reward ? String(f.reward.id) : ''}
                  onChange={(e) => {
                    const r = rewards.find((x) => String(x.id) === e.target.value) ?? null
                    set({ reward: r })
                  }}
                  aria-label="Reward"
                >
                  <option value="">No reward</option>
                  {f.reward && !rewards.some((r) => r.id === f.reward!.id) && <option value={String(f.reward.id)}>{f.reward.title}</option>}
                  {rewards.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {`${r.emoji ? `${r.emoji} ` : ''}${r.title}${r.price ? ` · ${r.price} pts` : ''}`}
                    </option>
                  ))}
                </Select>
                <small className="hint">{rewards.length ? 'It stays locked in Rewards until this goal is reached.' : 'Add rewards on the Rewards page to tie one to this goal.'}</small>
              </label>
            </div>

            <h3 className="gx-fsec">Look</h3>
            <div className="gx-look">
              <div className="gx-emojis" role="radiogroup" aria-label="Emoji">
                {EMOJIS.map((e) => (
                  <button type="button" key={e} role="radio" aria-checked={f.emoji === e} className={f.emoji === e ? 'on' : ''} onClick={() => set({ emoji: f.emoji === e ? '' : e })}>
                    {e}
                  </button>
                ))}
                <input value={EMOJIS.includes(f.emoji) ? '' : f.emoji} onChange={(e) => set({ emoji: [...e.target.value].slice(-2).join('') })} placeholder="Own" maxLength={8} aria-label="Your own emoji" />
              </div>
              <div className="gx-covers" role="radiogroup" aria-label="Cover">
                {COVERS.map((c) => (
                  <button type="button" key={c} role="radio" aria-checked={f.cover === c} className={`cv-${c}${f.cover === c ? ' on' : ''}`} onClick={() => set({ cover: c })} title={COVER_LABEL[c]}>
                    <span>{f.emoji || '🎯'}</span>
                  </button>
                ))}
                <label className={`gx-photo${f.cover === 'photo' ? ' on' : ''}`} title="Your own picture (kept small, in your data)">
                  {f.photo ? <img src={f.photo} alt="" /> : <span>📷</span>}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const p = await shrinkPhoto(file)
                      if (!p) return setPhotoErr("That picture didn't work: try a JPG or PNG")
                      setPhotoErr('')
                      set({ photo: p, cover: 'photo' })
                    }}
                    aria-label="Pick a picture"
                  />
                </label>
              </div>
              {photoErr && <small className="hint bad">{photoErr}</small>}
              <div className="gx-colors" role="radiogroup" aria-label="Colour">
                {COLORS.map((c) => (
                  <button type="button" key={c} role="radio" aria-checked={f.color === c} className={`c-${c}${f.color === c ? ' on' : ''}`} onClick={() => set({ color: c })} aria-label={c} />
                ))}
              </div>
            </div>
          </>
        )}

        <div className="gx-areas" role="radiogroup" aria-label="Area">
          {AREAS.map((a) => (
            <button type="button" key={a} role="radio" aria-checked={f.area === a} className={f.area === a ? 'on' : ''} onClick={() => set({ area: a })}>
              {areaIcon(a)} {a}
            </button>
          ))}
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
