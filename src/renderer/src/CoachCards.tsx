// Coach UI v3: rich cards Ben can put in the chat. A reply whose log entry
// says `show: ['plan']` (or 'day', 'tasks', 'block') gets the matching card:
// the day's plan as a timeline with Approve / Change / Regenerate, the day at
// a glance, today's tasks to tick, and the next block with Start / Move / Skip.
// Only the newest card of a kind is live; older ones settle into one line.
import { liveHeadline, planSummary } from '@core/benPlanText'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { coachCheer } from './coachCheer'
import { life } from './bridge'
import { useAction } from './ui'
import { useLive } from './live'
import type { CoachStatus } from './web/coachStatus'
import { expiredLabel, type RhythmPrefs, type RhythmState } from '@core/rhythm'
import type { TodoTask } from '@core/todoist'
import { fmtMinutes, planTimeline, type PlanItem } from '@core/planView'
import { barFill } from './motionKit'
import { Ring } from './CoachFeed'
import { PlanAlso } from './PlanAlso'
import { PlanShiftOffer } from './PlanShiftOffer'
import { PlanEditor } from './plan/PlanEditor'
import './coachFeed.css'

/** The kinds of `show` that are cards here (the rest are ReplyExtras' small widgets). */
const CARD_ALIAS: Record<string, CardKind> = { plan: 'plan', day: 'day', today: 'day', tasks: 'tasks', todo: 'tasks', todoist: 'tasks', block: 'block', 'next-block': 'block' }
export type CardKind = 'plan' | 'day' | 'tasks' | 'block'
export const cardKind = (w: string): CardKind | null => CARD_ALIAS[w.split(':')[0].trim().toLowerCase()] ?? null

const nowMin = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
const toMinutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** The rhythm state (plan, review) for the cards, live. */
function useRhythm() {
  const [data, setData] = useState<{ state: RhythmState; prefs: RhythmPrefs; late?: number } | null>(null)
  const load = useCallback(() => {
    life.coach?.rhythm?.('state').then(setData).catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  return [data, setData] as const
}

function useClock(ms = 30_000) {
  const [t, setT] = useState(nowMin())
  useEffect(() => {
    const id = setInterval(() => setT(nowMin()), ms)
    return () => clearInterval(id)
  }, [ms])
  return t
}

function CardHead({ icon, title, sub, chip, chipTone }: { icon: string; title: string; sub?: string; chip?: string; chipTone?: 'ok' | 'wait' | 'plain' }) {
  return (
    <div className="cf-card-head">
      <span className="ic" aria-hidden>
        {icon}
      </span>
      <span className="hd-tx">
        <b>{title}</b>
        {sub && <small className="hd-sub">{sub}</small>}
      </span>
      {chip && <small className={`hd-chip c-${chipTone ?? 'plain'}`}>{chip}</small>}
    </div>
  )
}

/** The day's blocks as coloured bars on one line, with a "now" mark. */
export function PlanTrack({ items, now, from, to, compact = false }: { items: PlanItem[]; now: number | null; from: string; to: string; compact?: boolean }) {
  if (!items.length) return null
  return (
    <div className={`cf-plan-track ${compact ? 'compact' : ''}`}>
      <div className="bar" aria-hidden>
        {items.map((x, k) => (
          <i key={k} className={`tone-${x.tone} s-${x.state}`} style={{ left: `${x.left * 100}%`, width: `max(6px, calc(${x.width * 100}% - 3px))`, '--k': k } as CSSProperties} title={`${x.start}–${x.end} ${x.title}`} />
        ))}
        {now != null && <b className="now" style={{ left: `${now * 100}%` }} />}
      </div>
      {!compact && (
        <div className="ends" aria-hidden>
          <span>{from}</span>
          <span>{to}</span>
        </div>
      )}
    </div>
  )
}

/**
 * The PLAN card: headline, the timeline, each block, must-dos and Approve /
 * Change / Regenerate. `live` is false on older messages (one quiet line).
 */
export function PlanCard({ live = true, spotlight = false, expired = false, onChange, onOpenPlan }: { live?: boolean; spotlight?: boolean; expired?: boolean; onChange?: () => void; onOpenPlan?: () => void }) {
  const act = useAction()
  const [data, setData] = useRhythm()
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState('')
  const [cheer, setCheer] = useState(false)
  const t = useClock()
  if (!life.coach?.rhythm || !data) return null
  const b = data.state.briefing
  const ev = data.state.evening

  const run = async (action: 'propose' | 'approve', msg?: string, label = '…') => {
    setBusy(label)
    const r = await act(() => life.coach!.rhythm!(action, msg), action === 'approve' ? 'Approved: blocks in your calendar, must-dos on Today' : undefined)
    setBusy(null)
    if (r) {
      setData({ state: r.state, prefs: r.prefs })
      onChange?.()
      if (action === 'approve') {
        setCheer(true)
        setTimeout(() => setCheer(false), 1600)
      }
    }
  }

  // A card from before the app day turned (04:00), or an older planner's draft: folded, never live.
  if (!live && expired)
    return (
      <div className="cf-card cf-plan t-plan settled expired">
        <CardHead icon="🗓" title="Expired · last night's draft" sub={b ? "Today's plan is the live one" : 'A fresh plan for today replaces it'} />
        {onOpenPlan && (
          <div className="cf-btns">
            <button type="button" onClick={onOpenPlan}>
              See today's plan
            </button>
          </div>
        )}
      </div>
    )
  if (!live)
    return (
      <div className="cf-card cf-plan t-plan settled">
        <CardHead icon="🗓" title="An earlier version of the plan" sub="The newest one below is up to date" />
      </div>
    )

  if (ev && !b)
    return (
      <div className="cf-card cf-plan t-plan">
        <CardHead icon="✨" title="Day review" chip={`${ev.score}/100`} chipTone={ev.score >= 70 ? 'ok' : 'wait'} />
        {ev.lesson && <p className="cf-quiet">{ev.lesson}</p>}
      </div>
    )

  if (!b)
    return (
      <div className={`cf-card cf-plan t-plan live ${spotlight ? 'spot' : ''}`}>
        {data.state.expired && <small className="cf-plan-expired">{expiredLabel(data.state.expired)}</small>}
        <CardHead icon="🗓" title="No plan for today yet" sub="Must-dos, blocks in your free time, training and water. You approve." />
        <div className="cf-btns">
          <button className="p" disabled={!!busy} onClick={() => void run('propose', undefined, 'Planning…')}>
            {busy ?? 'Plan my day'}
          </button>
        </div>
      </div>
    )

  const p = b.plan
  const tl = planTimeline(p, t)
  // One summary for the card, the chat and the headline (benPlanText.ts): stale counts leave the headline.
  const sum = planSummary(p)
  const head = liveHeadline(p.headline, p)
  const approved = b.status === 'approved'
  return (
    <div className={`cf-card cf-plan t-plan live ${approved ? 'ok' : 'waiting'} ${spotlight ? 'spot' : ''} ${cheer ? 'cheer' : ''}`}>
      <CardHead icon="🗓" title={approved ? "Today's plan" : 'Your plan for today'} sub={[sum.blocks ? `${sum.blocks} block${sum.blocks === 1 ? '' : 's'} · ${fmtMinutes(sum.focusMin)} of focus` : '', sum.mustdos ? `${sum.mustdos} must-do${sum.mustdos === 1 ? '' : 's'}` : '', b.version > 1 ? `v${b.version}` : ''].filter(Boolean).join(' · ')} chip={approved ? '✓ Approved' : 'Waiting for you'} chipTone={approved ? 'ok' : 'wait'} />
      {head && <p className="cf-plan-head">{head}</p>}
      <PlanShiftOffer state={data.state} late={data.late} onDone={(r) => (setData(r), onChange?.())} />
      {p.why && <p className="plan-why">{p.why}</p>}
      <PlanTrack items={tl.items} now={tl.now} from={tl.from} to={tl.to} />
      {/* PE1: edit the plan right here (drag, resize, rename, pin, approve part of it); edits sync to Google and Todoist. */}
      <PlanEditor state={data.state} water={data.prefs.water} />
      {p.mustdos.length > 0 && (
        <div className="cf-plan-must">
          <small>Must-dos</small>
          <ul>
            {p.mustdos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <PlanAlso plan={p} />
      <small className="cf-plan-water">💧 Water goal {(p.waterMl / 1000).toFixed(1)} L</small>
      {!approved &&
        (editing ? (
          <form
            className="cf-plan-edit"
            onSubmit={(e) => {
              e.preventDefault()
              if (!note.trim()) return
              setEditing(false)
              void run('propose', note.trim(), 'Replanning…')
              setNote('')
            }}
          >
            <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} placeholder="What should change? e.g. add the CV update, move gym to the evening" aria-label="What should change in the plan" />
            <button className="p" disabled={!note.trim()}>
              Replan
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="cf-btns">
            <button className="p" disabled={!!busy} onClick={() => void run('approve', undefined, 'Approving…')}>
              {busy === 'Approving…' ? busy : '✓ Approve'}
            </button>
            <button disabled={!!busy} onClick={() => setEditing(true)}>
              Change
            </button>
            <button disabled={!!busy} onClick={() => void run('propose', undefined, 'Planning…')}>
              {busy === 'Planning…' || busy === 'Replanning…' || busy === 'Dropping…' ? busy : '↻ Regenerate'}
            </button>
          </div>
        ))}
    </div>
  )
}

/** The BLOCK card: a focus block with a countdown, Start / Move / Skip. */
export function BlockCard({ title, time, minutes, note, onChange }: { title: string; time?: string; minutes?: number; note?: string; onChange?: () => void }) {
  const act = useAction()
  const t = useClock()
  const [done, setDone] = useState<string | null>(null)
  const left = time ? toMinutes(time) - t : null
  const subject = title.replace(/\(.*?\)/g, '').trim().slice(0, 28) || 'Focus'
  const start = async () => {
    if (await act(() => life.focus.start(subject, minutes ?? 25, null), `Focus started: ${subject}`)) {
      setDone('Timer running')
      coachCheer('focus')
      onChange?.()
    }
  }
  return (
    <div className="cf-card cf-blockcard t-block">
      <CardHead icon="🎯" title={title} sub={[time, minutes ? `${minutes} min of focus` : ''].filter(Boolean).join(' · ')} chip={note ?? (left != null ? (left > 0 ? `in ${fmtMinutes(left)}` : 'now') : undefined)} chipTone="wait" />
      <div className="cf-when">
        <Ring value={left != null && left > 0 ? 1 - Math.min(60, left) / 60 : 1} size={50} tone="block">
          {left != null && left > 0 ? (left >= 60 ? `${Math.floor(left / 60)}h` : `${left}m`) : 'Now'}
        </Ring>
        <p className="cf-quiet">{left != null && left > 0 ? 'Get ready: water, phone in the other room, notes open.' : 'It starts now. One tap and go.'}</p>
      </div>
      {done ? (
        <small className="cf-done">✓ {done}</small>
      ) : (
        <div className="cf-btns">
          <button className="p" onClick={() => void start()}>
            ▶ Start
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'calendar' }))}>Move</button>
          <button onClick={() => setDone('Skipped for now')}>Skip</button>
        </div>
      )}
    </div>
  )
}

/** The next block of today's plan as a BLOCK card. */
function NextBlockCard({ onChange }: { onChange?: () => void }) {
  const [data] = useRhythm()
  const t = useClock()
  const plan = data?.state.briefing?.plan
  if (!plan) return null
  const next = planTimeline(plan, t).items.find((x) => !x.train && (x.state === 'now' || x.state === 'next'))
  if (!next) return null
  return <BlockCard title={next.title} time={next.start} minutes={next.minutes} onChange={onChange} />
}

/** The DAY card: must-dos, focus and water as rings, the plan as a thin bar. */
export function DayCard({ status, onOpen }: { status: CoachStatus; onOpen?: () => void }) {
  const [data] = useRhythm()
  const t = useClock()
  const d = status.today
  const plan = data?.state.briefing?.plan
  const tl = plan ? planTimeline(plan, t) : null
  const next = tl?.items.find((x) => x.state === 'now' || x.state === 'next')
  const focusGoal = Math.max(60, tl?.totalMin ?? 120)
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className="cf-card cf-daycard t-day">
      <CardHead icon="☀️" title="Your day" sub={date} chip={status.plan.score != null ? `${status.plan.score}/100` : undefined} chipTone="ok" />
      <div className="cf-day-rings">
        <span>
          <Ring value={d.mustTotal ? d.mustDone / d.mustTotal : 0} size={54} tone="accent">
            {d.mustTotal ? `${d.mustDone}/${d.mustTotal}` : '–'}
          </Ring>
          <small>Must-dos</small>
        </span>
        <span>
          <Ring value={d.focusMin / focusGoal} size={54} tone="focus">
            {d.focusMin >= 60 ? `${Math.floor(d.focusMin / 60)}h` : d.focusMin}
          </Ring>
          <small>Focus{d.focusMin < 60 ? ' min' : ''}</small>
        </span>
        <span>
          <Ring value={d.waterTarget ? d.waterMl / d.waterTarget : 0} size={54} tone="water">
            {(d.waterMl / 1000).toFixed(1)}
          </Ring>
          <small>Water L</small>
        </span>
        <span>
          <Ring value={d.workoutDone ? 1 : 0} size={54} tone="train">
            {d.workoutDone ? '✓' : '–'}
          </Ring>
          <small>Training</small>
        </span>
      </div>
      {tl && <PlanTrack items={tl.items} now={tl.now} from={tl.from} to={tl.to} compact />}
      {next && (
        <p className="cf-quiet">
          {next.state === 'now' ? 'Now: ' : `Next at ${next.start}: `}
          <b>{next.title}</b>
        </p>
      )}
      {onOpen && (
        <div className="cf-btns">
          <button onClick={onOpen}>Open the plan</button>
        </div>
      )}
    </div>
  )
}

/** The TASK LIST card: today's Todoist tasks to tick (else your must-dos). */
export function TaskListCard({ status, onChange }: { status: CoachStatus | null; onChange?: () => void }) {
  const act = useAction()
  const [tasks, setTasks] = useState<TodoTask[] | null>(null)
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!life.todoist) return setTasks([])
    life.todoist
      .today()
      .then((x) => setTasks(x))
      .catch(() => setTasks([]))
  }, [])
  if (tasks === null) return <div className="cf-card cf-tasks t-tasks"><CardHead icon="✅" title="Today's tasks" sub="Loading…" /></div>
  const tick = async (x: TodoTask) => {
    setTicked((m) => ({ ...m, [x.id]: true }))
    const r = await act(() => life.todoist!.complete(x), 'Done')
    if (!r) setTicked((m) => ({ ...m, [x.id]: false }))
    else (coachCheer('done'), onChange?.())
  }
  const must = status?.mustdos ?? []
  const useMust = !tasks.length
  const rows = useMust ? must.map((m) => ({ id: `m${m.i}`, text: m.text, done: m.done, meta: 'Must-do', run: async () => (await act(() => life.focus.togglePlan(m.i))) && (!m.done && coachCheer('done'), onChange?.()) })) : tasks.map((x) => ({ id: x.id, text: x.content, done: !!ticked[x.id], meta: [x.dueTime, x.section ?? x.project].filter(Boolean).join(' · '), prio: x.priority, run: () => void tick(x) }))
  const left = rows.filter((r) => !r.done).length
  return (
    <div className="cf-card cf-tasks t-tasks">
      <CardHead icon="✅" title={useMust ? "Today's must-dos" : "Today's tasks"} sub={rows.length ? `${left} left of ${rows.length}` : undefined} />
      {rows.length ? (
        <>
          <div className="cf-bar pbar" aria-hidden>
            <i style={barFill(rows.length ? (rows.length - left) / rows.length : 0)} />
          </div>
          <ul className="cf-task-list">
            {rows.slice(0, 7).map((r, k) => (
              <li key={r.id} className={r.done ? 'done' : ''} style={{ '--k': k } as CSSProperties}>
                <button type="button" className={`tick ${'prio' in r && r.prio === 4 ? 'p1' : 'prio' in r && r.prio === 3 ? 'p2' : ''}`} aria-label={r.done ? `${r.text}: done` : `Tick ${r.text}`} aria-pressed={r.done} disabled={r.done && !useMust} onClick={() => void r.run()}>
                  {r.done ? '✓' : ''}
                </button>
                <span>
                  {r.text}
                  {r.meta && <small>{r.meta}</small>}
                </span>
              </li>
            ))}
          </ul>
          {rows.length > 7 && (
            <div className="cf-btns">
              <button onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'tasks' }))}>All {rows.length} tasks</button>
            </div>
          )}
        </>
      ) : (
        <p className="cf-quiet">Nothing due today. A clean slate.</p>
      )}
    </div>
  )
}

/** The cards a reply asked for (`show`), in order. */
const SETTLED: Record<Exclude<CardKind, 'plan'>, [string, string]> = { day: ['☀️', 'Your day, as it was then'], tasks: ['✅', 'Your tasks, as they were then'], block: ['🎯', 'A focus block, earlier'] }

export function ShowCards({ show, live, expired = false, status, onChange, onOpenPlan }: { show: string[]; live: (k: CardKind) => boolean; expired?: boolean; status: CoachStatus | null; onChange: () => void; onOpenPlan?: () => void }) {
  const kinds = [...new Set(show.map(cardKind).filter((k): k is CardKind => !!k))]
  if (!kinds.length) return null
  return (
    <div className="cf-cards">
      {kinds.map((k) => {
        if (k === 'plan') return <PlanCard key={k} live={live(k)} expired={expired && !live(k)} onChange={onChange} onOpenPlan={onOpenPlan} />
        // Live numbers on an old message would mislead: only the newest card of a kind is live.
        if (!live(k))
          return (
            <div key={k} className="cf-card settled">
              <CardHead icon={SETTLED[k][0]} title={SETTLED[k][1]} sub="The newest one below is up to date" />
            </div>
          )
        if (k === 'block') return <NextBlockCard key={k} onChange={onChange} />
        if (k === 'day') return status ? <DayCard key={k} status={status} onOpen={onOpenPlan} /> : null
        return <TaskListCard key={k} status={status} onChange={onChange} />
      })}
    </div>
  )
}
