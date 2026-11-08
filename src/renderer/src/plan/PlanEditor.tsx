// PE1–PE8, QA1: the day plan you can edit right where it shows (Ben's plan
// card in the chat, Today → Plan). A day column: drag a block to a new time
// (5-minute steps), pull its bottom edge, double-click the name to rename, ✕
// to drop it, "+" in a free gap to add one, drag a task onto another block,
// 📌 to pin it, a tick per block to approve just that part. Mouse, touch and
// keyboard (arrow keys move the focused block by 5 minutes; Shift+arrows
// change its length; Enter renames; Delete drops; P pins). Each approved
// block shows whether Google and Todoist have it (syncing… / ✓ / ⚠ Retry).
// Ctrl+Z (or Undo) takes back the last edit everywhere.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import { layoutDay, minLenFor } from '@core/calLayout'
import { fromMin, toMin, type RhythmState } from '@core/rhythm'
import { idsUntil, isApproved, minOfDay, planGaps, planItems, replanFromNow, snap5, type EditItem, type PlanEdit } from '@core/planEdit'
import { issueChip } from '@core/planCheck'
import { auditPlan, blockWhy } from '@core/planAudit'
import { pending } from '@core/planSync'
import { planTone } from '@core/planView'
import type { CalEvent } from '@core/dayTime'
import { life } from '../bridge'
import { useToast } from '../ui'
import { attach, edit, moveTomorrow, onNotice, retry, setAuto, setContext, setEditing, startLive, subscribe, undoLast, type PlanSnap } from './planStore'
import { PlanSync } from './SyncButton'
import './planEditor.css'

const HOUR_PX = 78
const PX = HOUR_PX / 60
const MIN_PX = 30
const nowMin = () => {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}
const hm = (m: number) => fromMin(Math.max(0, Math.min(24 * 60 - 5, m)))
const len = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`)

type Drag = { id: string; kind: 'move' | 'resize'; y0: number; start: number; minutes: number; moved: boolean; pid: number }
type TaskDrag = { task: string; from: string; x: number; y: number; over: string | null; moved: boolean; x0: number; y0: number }

/** `auto`: Settings -> Re-plan by itself (default on). */
export function PlanEditor({ state, water = true, auto = true }: { state: RhythmState; water?: boolean; auto?: boolean }) {
  const toast = useToast()
  const [s, setS] = useState<PlanSnap | null>(null)
  const [events, setEvents] = useState<CalEvent[]>([])
  const [bed, setBed] = useState('23:30')
  const [freeShare, setFreeShare] = useState<number | undefined>(undefined)
  const [preview, setPreview] = useState<{ id: string; start: number; minutes: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [taskDrag, setTaskDrag] = useState<TaskDrag | null>(null)
  const [until, setUntil] = useState(() => hm(Math.ceil((nowMin() + 180) / 60) * 60))
  const [t, setT] = useState(nowMin())
  const drag = useRef<Drag | null>(null)
  const col = useRef<HTMLOListElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)

  useEffect(() => subscribe(setS), [])
  useEffect(() => attach(state), [state])
  useEffect(() => startLive(), [])
  useEffect(() => {
    const id = setInterval(() => setT(nowMin()), 30_000)
    return () => clearInterval(id)
  }, [])
  useEffect(() => onNotice((n) => toast(n.text, n.tone, n.undo ? { label: 'Undo', run: () => void undoLast() } : undefined)), [toast])
  useEffect(() => setAuto(auto), [auto])
  // No automatic re-plan while a block is dragged or renamed.
  useEffect(() => {
    setEditing(!!preview || !!renaming || !!taskDrag)
    return () => setEditing(false)
  }, [preview, renaming, taskDrag])
  useEffect(() => {
    life.coach
      ?.lifeFit?.()
      .then((f) => {
        if (f?.bed) setBed(f.bed)
        if (typeof f?.freeShare === 'number') setFreeShare(f.freeShare)
      })
      .catch(() => {})
  }, [])
  // Today's calendar: fixed events are drawn (pinned) behind the plan.
  const day = s?.plan.day ?? state.briefing?.plan.day
  const loadEvents = useCallback(() => {
    if (!day || !life.google) return
    const s0 = new Date(`${day}T00:00:00`)
    life.google
      .events(s0.toISOString(), new Date(s0.getTime() + 86400000).toISOString())
      .then(setEvents)
      .catch(() => {})
  }, [day])
  useEffect(loadEvents, [loadEvents])
  useEffect(() => {
    window.addEventListener('life-external-changed', loadEvents)
    window.addEventListener('life-plan-synced', loadEvents)
    return () => {
      window.removeEventListener('life-external-changed', loadEvents)
      window.removeEventListener('life-plan-synced', loadEvents)
    }
  }, [loadEvents])

  const doEdit = useCallback(
    (e: PlanEdit, quiet = false) => {
      const label = edit(e)
      // Pins and approvals show on the block itself; the rest get a toast with Undo.
      if (label && !quiet && e.op !== 'lock' && e.op !== 'approve') toast(label, 'info', { label: 'Undo', run: () => void undoLast() })
      return label
    },
    [toast]
  )
  const doUndo = useCallback(() => {
    const l = undoLast()
    toast(l ? `Undone: ${l}` : 'Nothing to undo', l ? 'info' : 'bad')
  }, [toast])

  // Ctrl+Z / Cmd+Z: the store listens once for every card (planStore startLive).

  // Opened: the column starts a little before now (not at the first hour of the day).
  const ready = !!s
  useEffect(() => {
    const el = scroller.current
    if (!ready || scrolled.current || !el) return
    scrolled.current = true
    const now = el.querySelector<HTMLElement>('.pe-now')
    if (now) el.scrollTop = Math.max(0, now.offsetTop - 40)
  }, [ready])
  const items = useMemo(() => (s ? planItems(s.plan) : []), [s])
  const mine = useMemo(() => new Set(items.map((b) => b.sync?.eventId).filter(Boolean) as string[]), [items])
  const fixed = useMemo(() => (day ? events.filter((e) => !e.allDay && !e.declined && !mine.has(e.id) && minOfDay(e.end, day) > 0 && minOfDay(e.start, day) < 24 * 60) : []), [events, mine, day])
  const endBy = hm(Math.min(toMin(bed) < 12 * 60 ? 24 * 60 - 5 : toMin(bed) - 45, 23 * 60))
  useEffect(() => setContext({ events: fixed, bedtime: bed, water, freeShare, endBy }), [fixed, bed, water, freeShare, endBy])
  // The plan audit, before the card shows: what is wrong (the chip) and what has no room (one plain line).
  const audit = useMemo(() => (s ? auditPlan(s.plan, { now: hm(t), bedtime: bed, events: fixed, water, freeShare, tasks: s.tasks ?? undefined, fixTimes: false }) : null), [s, t, bed, fixed, water, freeShare])
  const issues = audit?.issues ?? []

  if (!s || !day) return null
  const status = s.status
  const minOf = (iso: string) => minOfDay(iso, day)
  const shown = items.map((b) => (preview?.id === b.id ? { ...b, start: hm(preview.start), minutes: preview.minutes } : b))
  const ends = [...shown.map((b) => toMin(b.start) + b.minutes), ...fixed.map((e) => minOf(e.end))]
  const starts = [...shown.map((b) => toMin(b.start)), ...fixed.map((e) => minOf(e.start))]
  const from = Math.max(0, Math.floor((Math.min(...starts, t) - 15) / 60) * 60)
  const to = Math.min(24 * 60, Math.ceil((Math.max(...ends, from + 120) + 20) / 60) * 60)
  const fixedIn = fixed.filter((e) => minOf(e.end) > from && minOf(e.start) < to)
  const lay = layoutDay(
    shown.map((b) => ({ start: toMin(b.start), end: toMin(b.start) + b.minutes, b })),
    { maxCols: 3, minLen: minLenFor(MIN_PX, HOUR_PX) }
  )
  const yOf = (m: number) => (m - from) * PX
  const gaps = planGaps(s.plan, fixedIn, hm(Math.max(from, snap5(t + 5))), hm(to), 25)
  const anyDraft = items.some((b) => !isApproved(b, status))
  const syncing = Object.values(s.sync).includes('syncing')
  const failed = Object.values(s.sync).includes('err')
  const chip = issueChip(issues)

  // ---- Dragging a block (mouse, pen, touch) ----
  const startDrag = (ev: RPointerEvent, b: EditItem, kind: Drag['kind']) => {
    if (ev.button !== 0 || b.locked || renaming === b.id) return
    if ((ev.target as HTMLElement).closest('button, input, .pe-task')) return
    ev.stopPropagation()
    ;(ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId)
    drag.current = { id: b.id, kind, y0: ev.clientY, start: toMin(b.start), minutes: b.minutes, moved: false, pid: ev.pointerId }
  }
  const onMove = (ev: RPointerEvent) => {
    const d = drag.current
    if (!d || d.pid !== ev.pointerId) return
    const dy = ev.clientY - d.y0
    if (!d.moved && Math.abs(dy) < 4) return
    d.moved = true
    const dm = snap5(dy / PX)
    setPreview(d.kind === 'move' ? { id: d.id, start: Math.max(0, Math.min(24 * 60 - d.minutes, d.start + dm)), minutes: d.minutes } : { id: d.id, start: d.start, minutes: Math.max(15, d.minutes + dm) })
  }
  const endDrag = (ev: RPointerEvent) => {
    const d = drag.current
    if (!d || d.pid !== ev.pointerId) return
    drag.current = null
    const p = preview
    setPreview(null)
    if (!d.moved || !p) {
      setPicked(d.id)
      return
    }
    if (d.kind === 'move' && p.start !== d.start) doEdit({ op: 'move', id: d.id, start: hm(p.start) })
    if (d.kind === 'resize' && p.minutes !== d.minutes) doEdit({ op: 'resize', id: d.id, minutes: p.minutes })
  }

  // ---- Dragging a task onto another block ----
  const startTask = (ev: RPointerEvent, task: string, from: string) => {
    if (ev.button !== 0 || (ev.target as HTMLElement).closest('button')) return
    ev.stopPropagation()
    ;(ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId)
    setTaskDrag({ task, from, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, over: null, moved: false })
  }
  const moveTask = (ev: RPointerEvent) => {
    if (!taskDrag) return
    const moved = taskDrag.moved || Math.hypot(ev.clientX - taskDrag.x0, ev.clientY - taskDrag.y0) > 5
    const under = document.elementsFromPoint(ev.clientX, ev.clientY).map((el) => (el as HTMLElement).closest?.('[data-block]') as HTMLElement | null).find((el) => el && el.dataset.block !== taskDrag.from)
    setTaskDrag({ ...taskDrag, x: ev.clientX, y: ev.clientY, moved, over: under?.dataset.block ?? null })
  }
  const endTask = () => {
    const d = taskDrag
    setTaskDrag(null)
    if (d?.moved && d.over && d.over !== 'train') doEdit({ op: 'moveTask', task: d.task, from: d.from, to: d.over })
  }

  const keyOn = (ev: RKeyboardEvent, b: EditItem) => {
    if (ev.target !== ev.currentTarget) return
    const step = ev.key === 'ArrowUp' ? -5 : ev.key === 'ArrowDown' ? 5 : 0
    if (step) {
      ev.preventDefault()
      if (ev.shiftKey) doEdit({ op: 'resize', id: b.id, minutes: b.minutes + step }, true)
      else doEdit({ op: 'move', id: b.id, start: hm(toMin(b.start) + step) }, true)
    } else if (ev.key === 'Enter' || ev.key === 'F2') {
      ev.preventDefault()
      setRenaming(b.id)
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault()
      doEdit({ op: 'remove', id: b.id })
    } else if (ev.key.toLowerCase() === 'p') {
      ev.preventDefault()
      doEdit({ op: 'lock', id: b.id, on: !b.locked })
    }
  }

  const statusOf = (b: EditItem): { tx: string; tone: string } | null => {
    if (!isApproved(b, status)) return null
    const st = s.sync[b.id]
    if (st === 'syncing' || pending(b)) return { tx: 'syncing…', tone: 'wait' }
    if (st === 'err') return { tx: '⚠ Retry', tone: 'err' }
    if (b.sync?.eventId) return { tx: '✓', tone: 'ok' }
    return toMin(b.start) + b.minutes <= t ? null : { tx: 'syncing…', tone: 'wait' }
  }

  const add = (g: { start: string; minutes: number }) => {
    const id = `b${Date.now().toString(36)}`
    if (doEdit({ op: 'add', id, start: g.start, minutes: Math.min(45, g.minutes), title: 'New block' })) setRenaming(id)
  }
  const replan = () => {
    const r = replanFromNow(s.plan, { now: hm(nowMin()), events: fixed, endBy })
    doEdit({ op: 'replace', plan: r.plan, label: `Re-planned from now: ${r.moved} moved${r.unplaced.length ? `, ${r.unplaced.length} back on the list` : ''}` })
  }
  const fix = () => {
    const r = auditPlan(s.plan, { now: hm(nowMin()), bedtime: bed, events: fixed, water, freeShare, tasks: s.tasks ?? undefined })
    if (r.fixed.length && JSON.stringify(r.plan) !== JSON.stringify(s.plan)) doEdit({ op: 'replace', plan: r.plan, label: 'Fixed the plan' })
    else toast('Nothing Ben can fix by himself here: move a block, or ask him', 'info')
  }
  const sel = picked ? items.find((b) => b.id === picked) : undefined

  return (
    <div className={`pe ${taskDrag?.moved ? 'task-drag' : ''}`} onPointerMove={(e) => (taskDrag ? moveTask(e) : onMove(e))} onPointerUp={(e) => (taskDrag ? endTask() : endDrag(e))} onPointerCancel={() => ((drag.current = null), setPreview(null), setTaskDrag(null))}>
      <div className="pe-bar">
        <span className={`pe-sync ${failed ? 'err' : syncing ? 'wait' : 'ok'}`} title={s.error ?? undefined}>
          {failed ? (
            <button type="button" onClick={retry}>
              ⚠ Not synced · Retry
            </button>
          ) : syncing ? (
            'Syncing…'
          ) : items.some((b) => isApproved(b, status)) ? (
            '✓ Google and Todoist up to date'
          ) : (
            'Draft: syncs once approved'
          )}
        </span>
        {chip && (
          <button type="button" className="pe-warn" onClick={fix} title={issues.map((i) => i.text).join(' · ')}>
            ⚠ {chip}
          </button>
        )}
        <span className="pe-space" />
        <PlanSync />
        <button type="button" className="pe-btn" onClick={replan} title="Re-pack the time that is left (done and pinned blocks stay)">
          ⏩ Re-plan from now
        </button>
        <button type="button" className="pe-btn" disabled={!s.canUndo} onClick={doUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
      </div>
      {s.autoNote && (
        <p className="pe-auto" role="status">
          <span>↻ {s.autoNote}</span>
          <button type="button" onClick={doUndo}>
            Undo
          </button>
        </p>
      )}
      {audit?.line && (
        <p className="pe-audit" role="status" title={audit.left.map((l) => `${l.title}: ${l.text}`).join(' · ')}>
          <span>{audit.line}</span>
          <button
            type="button"
            onClick={() => {
              const l = moveTomorrow(audit.left.filter((x) => x.why === 'room'))
              if (l) toast(l, 'info', { label: 'Undo', run: () => void undoLast() })
            }}
          >
            Move to tomorrow
          </button>
        </p>
      )}
      {anyDraft && (
        <div className="pe-approve" title="Approved blocks go to Google Calendar and Todoist; the rest stays a draft">
          <span>Tick blocks to approve them, or</span>
          <button type="button" className="pe-btn" onClick={() => doEdit({ op: 'approve', ids: idsUntil(s.plan, until), on: true })}>
            ✓ Approve until
          </button>
          <input type="time" step={900} value={until} onChange={(e) => e.target.value && setUntil(e.target.value)} aria-label="Approve the blocks before this time" />
        </div>
      )}
      <div className="pe-scroll" ref={scroller}>
        <ol ref={col} className="pe-col" style={{ height: (to - from) * PX } as CSSProperties} aria-label="Plan blocks: arrow keys move a block by 5 minutes">
          {Array.from({ length: (to - from) / 60 + 1 }, (_, i) => from + i * 60).map((m) => (
            <span key={`h${m}`} className="pe-hour" style={{ top: yOf(m) }} aria-hidden>
              <small>{hm(m)}</small>
            </span>
          ))}
          {t > from && t < to && <span className="pe-now" style={{ top: yOf(t) }} aria-hidden />}
          {fixedIn.map((e) => (
            <span key={`e${e.id}`} className="pe-ev" style={{ top: yOf(Math.max(from, minOf(e.start))), height: Math.max(18, (Math.min(to, minOf(e.end)) - Math.max(from, minOf(e.start))) * PX) }} title={`${e.title} · fixed in Google Calendar (pinned)`}>
              <small>📌 {e.title}</small>
            </span>
          ))}
          {gaps.map((g) => (
            <button key={`g${g.start}`} type="button" className="pe-add" style={{ top: yOf(toMin(g.start)) + 2 }} onClick={() => add(g)} aria-label={`Add a block at ${g.start}`}>
              + Add block · {g.start}
            </button>
          ))}
          {lay.placed.map(({ it, left: l0, width: w0 }) => {
            const b = it.b
            // The block being dragged floats over the others, full width.
            const left = preview?.id === b.id ? 0 : l0
            const width = preview?.id === b.id ? 100 : w0
            const top = yOf(toMin(b.start))
            const h = Math.max(MIN_PX, b.minutes * PX)
            const st = statusOf(b)
            const ok = isApproved(b, status)
            const dragging = preview?.id === b.id
            const rows = Math.max(0, Math.floor((h - 34 - (h >= 44 ? 14 : 0)) / 20))
            const tasks = b.tasks ?? []
            const done = new Set((b.done ?? []).map((x) => x.toLowerCase()))
            const past = toMin(b.start) + b.minutes <= t
            const why = blockWhy(b, s.plan, s.tasks ?? [])
            return (
              <li
                key={b.id}
                data-block={b.id}
                className={`pe-block tone-${planTone(b.title, b.train)} ${ok ? 'ok' : 'draft'} ${b.locked ? 'locked' : ''} ${dragging ? 'dragging' : ''} ${taskDrag?.over === b.id ? 'drop' : ''} ${picked === b.id ? 'picked' : ''} ${past ? 'past' : ''}`}
                style={{ transform: `translateY(${top}px)`, height: h, left: `calc(52px + (100% - 56px) * ${left / 100})`, width: `calc((100% - 56px) * ${width / 100} - 4px)` } as CSSProperties}
                tabIndex={0}
                aria-label={`${b.title}, ${b.start} to ${hm(toMin(b.start) + b.minutes)}${b.locked ? ', pinned' : ''}${ok ? ', approved' : ', draft'}`}
                onPointerDown={(e) => startDrag(e, b, 'move')}
                onKeyDown={(e) => keyOn(e, b)}
                onFocus={() => setPicked(b.id)}
              >
                <div className="pe-head">
                  {status !== 'approved' && (
                    <input type="checkbox" className="pe-ok" checked={!!b.ok} onChange={(e) => doEdit({ op: 'approve', ids: [b.id], on: e.target.checked })} aria-label={`Approve ${b.title}`} title="Approve this block" />
                  )}
                  {renaming === b.id ? (
                    <input
                      className="pe-name-in"
                      autoFocus
                      defaultValue={b.title}
                      aria-label="Block name"
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                      onBlur={(e) => {
                        if (renaming === b.id) doEdit({ op: 'rename', id: b.id, title: e.target.value })
                        setRenaming(null)
                      }}
                    />
                  ) : (
                    <b className="pe-name" onDoubleClick={() => setRenaming(b.id)} title="Double-click to rename">
                      {b.train ? `💪 ${b.title}` : b.title}
                    </b>
                  )}
                  <small className="pe-time">
                    {b.start}–{hm(toMin(b.start) + b.minutes)}
                    {dragging ? ` · ${len(b.minutes)}` : ''}
                  </small>
                  {st && (
                    <span className={`pe-st ${st.tone}`} role="status">
                      {st.tone === 'err' ? (
                        <button type="button" onClick={retry}>
                          {st.tx}
                        </button>
                      ) : (
                        st.tx
                      )}
                    </span>
                  )}
                  <button type="button" className={`pe-pin ${b.locked ? 'on' : ''}`} aria-pressed={!!b.locked} aria-label={b.locked ? `Unpin ${b.title}` : `Pin ${b.title}`} title={b.locked ? 'Pinned: re-planning never moves it' : 'Pin: re-planning never moves it'} onClick={() => doEdit({ op: 'lock', id: b.id, on: !b.locked })}>
                    📌
                  </button>
                  <button type="button" className="pe-x" aria-label={`Remove ${b.title}`} title="Remove" onClick={() => doEdit({ op: 'remove', id: b.id })}>
                    ✕
                  </button>
                </div>
                {why && h >= 44 && <small className="pe-why">{why}</small>}
                {tasks.length > 0 && rows > 0 && (
                  <ul className="pe-tasks">
                    {tasks.slice(0, rows).map((x) => (
                      <TaskRow key={x} task={x} done={done.has(x.toLowerCase())} onTick={(on) => doEdit({ op: 'tick', id: b.id, task: x, on })} onGrab={(e) => startTask(e, x, b.id)} />
                    ))}
                    {tasks.length > rows && (
                      <li className="pe-more">
                        <button type="button" onClick={() => setPicked(b.id)}>
                          +{tasks.length - rows} more
                        </button>
                      </li>
                    )}
                  </ul>
                )}
                {!b.locked && <span className="pe-resize" onPointerDown={(e) => startDrag(e, b, 'resize')} aria-hidden title="Drag to change the length" />}
              </li>
            )
          })}
        </ol>
      </div>
      {sel && (sel.tasks?.length ?? 0) > 0 && (
        <div className="pe-tray" data-block={sel.id}>
          <small>
            {sel.title}: {sel.tasks!.length} task{sel.tasks!.length === 1 ? '' : 's'} · drag one onto another block
          </small>
          <ul className="pe-tasks">
            {sel.tasks!.map((x) => (
              <TaskRow key={x} task={x} done={(sel.done ?? []).some((d) => d.toLowerCase() === x.toLowerCase())} onTick={(on) => doEdit({ op: 'tick', id: sel.id, task: x, on })} onGrab={(e) => startTask(e, x, sel.id)} />
            ))}
          </ul>
        </div>
      )}
      {status !== 'approved' && (
        <p className="pe-hint">
          <small>Drag to move · pull the bottom edge · double-click to rename · ↑↓ keys move the picked block by 5 min</small>
        </p>
      )}
      {taskDrag?.moved && (
        <span className="pe-ghost" style={{ left: taskDrag.x + 12, top: taskDrag.y + 8 }} aria-hidden>
          {taskDrag.task}
        </span>
      )}
    </div>
  )
}

function TaskRow({ task, done, onTick, onGrab }: { task: string; done: boolean; onTick: (on: boolean) => void; onGrab: (e: RPointerEvent) => void }) {
  return (
    <li className={`pe-task ${done ? 'done' : ''}`} onPointerDown={onGrab}>
      <button type="button" className="pe-tick" aria-pressed={done} aria-label={done ? `${task}: done (tap to undo)` : `Tick ${task}`} onClick={() => onTick(!done)}>
        {done ? '✓' : ''}
      </button>
      <span>{task}</span>
      <i className="pe-grip" aria-hidden>
        ⋮⋮
      </i>
    </li>
  )
}
