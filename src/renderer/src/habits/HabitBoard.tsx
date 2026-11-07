// Today's habits: a simple tracker. One row per habit (its icon, the name,
// what's left or when it's due, the last 7 days as dots, the streak and a
// circle to tick it), or the same habits as a compact grid (⋯ → Show as a
// grid). Auto habits (Sport Track, the focus timer, Finance) show live
// progress and a tap only opens what really counts: a tap never pays for
// something that didn't happen. Long-press or ⋯: skip today, edit, move,
// hide, details. The pure parts are in src/core/habitBoard.ts.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  boardCount,
  EMPTY_PREFS,
  goodDayRun,
  habitStreak,
  HABIT_COLORS,
  HABIT_ICONS,
  listTiles,
  lookOf,
  moveBefore,
  nudge,
  scheduleText,
  skipsOf,
  slotOf,
  SLOT_LABEL,
  weekDots,
  weekdayOf,
  dueState,
  type BoardPrefs,
  type DotState,
  type DueState,
  type HabitLook,
  type Schedule,
  type Slot,
  type SlotPick
} from '@core/habitBoard'
import { dayKey } from '@core/dates'
import { life } from '../bridge'
import { useLive } from '../live'
import { useAction } from '../ui'
import { celebrate } from '../fx'
import { play } from '../soundKit'
import { reducedMotion } from '../motionKit'
import { askConfirm } from '../confirmSheet'
import type { Habit } from '../dayflow/hooks'
import type { HabitsView, BoardView } from '../web/lifeExtras'
import { COLOR_HEX, HabitIcon } from './habitIcons'
import './habits.css'
import { GroomingSheet, GROOMING_OPEN } from './GroomingSheet'

interface Tile {
  id: string
  habit: Habit
  name: string
  look: HabitLook
  slot: Slot
  schedule: Schedule
  done: boolean
  skipped: boolean
  off: boolean
  hidden: boolean
  days: string[]
  skips: string[]
  due: { state: DueState; hint: string }
  dots: { day: string; state: DotState }[]
  streak: { n: number; unit: 'day' | 'week' }
  best: number
  paid: number
}

type Sheet = { kind: 'add' } | { kind: 'edit'; id: string } | { kind: 'details'; id: string }
type View = 'list' | 'grid'

const storeGet = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const storeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* private window: this session only */
  }
}

/** The minute of the day, redrawn once a minute (due hints move with the clock). */
function useMinute(): number {
  const read = () => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
  const [m, setM] = useState(read)
  useEffect(() => {
    const t = setInterval(() => setM(read()), 60_000)
    return () => clearInterval(t)
  }, [])
  return m
}

export interface HabitBoardProps {
  habits: Habit[]
  own: HabitsView | null
  reloadOwn: () => void
  onChange: () => void
  focusTarget: number
  /** Extra buttons on the right of the header (before ⋯). */
  actions?: ReactNode
  /** Under the list (never miss twice, the spending line). */
  children?: ReactNode
}

export function HabitBoard({ habits, own, reloadOwn, onChange, focusTarget, actions, children }: HabitBoardProps) {
  const act = useAction()
  const [view, setView] = useState<BoardView | null>(null)
  const [prefs, setPrefs] = useState<BoardPrefs>(EMPTY_PREFS)
  const load = useCallback(() => {
    life.extras
      ?.habitBoard(focusTarget)
      .then((v) => {
        setView(v)
        setPrefs(v.prefs)
      })
      .catch(() => {})
  }, [focusTarget])
  const doneKey = habits.map((h) => `${h.id}${h.done ? 1 : 0}`).join()
  useEffect(load, [load, doneKey])
  useEffect(() => {
    const evs = ['life-habits-changed', 'life-wallet-changed']
    for (const e of evs) window.addEventListener(e, load)
    return () => {
      for (const e of evs) window.removeEventListener(e, load)
    }
  }, [load])
  useLive(load)

  const nowMin = useMinute()
  const today = view?.today ?? dayKey(new Date())
  const rest = view?.rest ?? []

  // Just ticked: it keeps its place for a moment (the check plays) before moving to the end.
  const [recent, setRecent] = useState<string[]>([])
  const [pop, setPop] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [boardMenu, setBoardMenu] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  // BD15: the Grooming tile opens its checklist.
  const [groomOpen, setGroomOpen] = useState(false)
  useEffect(() => {
    const open = () => setGroomOpen(true)
    window.addEventListener(GROOMING_OPEN, open)
    return () => window.removeEventListener(GROOMING_OPEN, open)
  }, [])
  const [showHidden, setShowHidden] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  // A list (the default) or a compact grid: your pick on this device.
  const [mode, setModeRaw] = useState<View>(() => (storeGet('ls.hbView') === 'grid' ? 'grid' : 'list'))
  const setMode = (v: View) => {
    setModeRaw(v)
    storeSet('ls.hbView', v)
  }

  const tiles: Tile[] = useMemo(
    () =>
      habits.map((h) => {
        const row = h.ownId ? own?.rows.find((r) => r.id === h.ownId) : undefined
        const look = lookOf(h.id, prefs, row?.look)
        const schedule: Schedule = row?.schedule ?? { kind: 'daily' }
        const skips = skipsOf(prefs, h.id)
        const skipped = !h.done && skips.includes(today)
        const off = !h.done && !!row && !row.due
        const raw = row ? row.days : (view?.days[h.id] ?? [])
        const days = h.done && !raw.includes(today) ? [...raw, today] : raw
        return {
          id: h.id,
          habit: h,
          name: h.short ?? h.label,
          look,
          slot: slotOf(look),
          schedule,
          done: h.done,
          skipped,
          off,
          hidden: prefs.hidden.includes(h.id),
          days,
          skips,
          due: dueState({ done: h.done, skipped, off, slot: look.slot, by: look.by }, nowMin),
          dots: weekDots(days, today, { rest, skips, schedule }),
          streak: habitStreak(days, today, { rest, skips, schedule }),
          best: row?.best ?? 0,
          paid: view?.paid[h.id] ?? 0
        }
      }),
    // rest is derived from view
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [habits, own, prefs, view, today, nowMin]
  )
  const byId = useMemo(() => new Map(tiles.map((t) => [t.id, t])), [tiles])
  const shown = tiles.filter((t) => showHidden || !t.hidden)
  const counted = tiles.filter((t) => !t.hidden)
  const count = boardCount(counted)
  // One list. A tile ticked a moment ago still counts as open, so it doesn't jump away mid-animation.
  const list = listTiles(
    shown.map((t) => ({ ...t, done: t.done && !recent.includes(t.id) })),
    prefs.order,
    prefs.fixed
  ).map((t) => byId.get(t.id)!)
  const flatIds = list.map((t) => t.id)
  const run = useMemo(
    () =>
      goodDayRun(
        counted
          .filter((t) => t.schedule.kind !== 'perWeek' && t.days.length > 0)
          .map((t) => {
            const first = t.days.reduce((a, b) => (a < b ? a : b))
            return { days: t.days, asked: (d: string) => d >= first && !rest.includes(d) && !t.skips.includes(d) && (t.schedule.kind === 'daily' || weekdayOf(d) < 5) }
          }),
        today
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiles, today]
  )

  // A perfect day: one small burst, once a day.
  const [confetti, setConfetti] = useState(false)
  useEffect(() => {
    if (!view || !count.perfect) return
    if (storeGet('ls.hbPerfect') === today) return
    storeSet('ls.hbPerfect', today)
    if (reducedMotion()) return
    setConfetti(true)
    try {
      play('reward')
    } catch {
      /* no sound is fine */
    }
    const t = setTimeout(() => setConfetti(false), 2400)
    return () => clearTimeout(t)
  }, [view, count.perfect, today])

  // Rows glide to their new place (done ones to the end).
  const boardRef = useRef<HTMLUListElement>(null)
  const rects = useRef(new Map<string, DOMRect>())
  useLayoutEffect(() => {
    const el = boardRef.current
    if (!el) return
    const next = new Map<string, DOMRect>()
    const nodes = el.querySelectorAll<HTMLElement>('[data-hb-id]')
    nodes.forEach((n) => next.set(n.dataset.hbId!, n.getBoundingClientRect()))
    if (rects.current.size && !reducedMotion())
      nodes.forEach((n) => {
        const a = rects.current.get(n.dataset.hbId!)
        const b = next.get(n.dataset.hbId!)
        if (!a || !b) return
        const dx = a.left - b.left
        const dy = a.top - b.top
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) n.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
      })
    rects.current = next
  })

  const savePrefs = async (patch: Partial<BoardPrefs>) => {
    setPrefs((p) => ({ ...p, ...patch }))
    const r = await act(() => life.extras!.saveHabitBoard(patch))
    if (r) setPrefs(r)
  }

  const tick = async (t: Tile, el: HTMLElement) => {
    // A habit with steps (Grooming): a tap opens its checklist, done or not.
    if (t.habit.sheet) return void t.habit.run()
    if (t.done || t.off) return
    if (t.skipped) return setMenu(null)
    // An auto habit: the tap opens what really counts (the app, the timer); it never ticks here.
    if (t.habit.auto) return void t.habit.run()
    const ok = await t.habit.run()
    if (ok === false) return
    setRecent((r) => [...r, t.id])
    setPop(t.id)
    celebrate(el, 'habit')
    try {
      navigator.vibrate?.(12)
    } catch {
      /* no buzz here */
    }
    setTimeout(() => setPop((p) => (p === t.id ? null : p)), 900)
    setTimeout(() => setRecent((r) => r.filter((x) => x !== t.id)), 1100)
  }
  const skip = async (t: Tile, on: boolean) => {
    setMenu(null)
    if (await act(() => life.extras!.skipHabit(t.id, on), on ? `${t.name}: skipped today. No points, your streak waits.` : `${t.name}: back on today`)) load()
  }
  const hide = async (t: Tile, on: boolean) => {
    setMenu(null)
    await savePrefs({ hidden: on ? [...prefs.hidden, t.id] : prefs.hidden.filter((x) => x !== t.id) })
  }
  const move = async (t: Tile, dir: -1 | 1) => {
    setMenu(null)
    await savePrefs({ order: nudge(flatIds, t.id, dir) })
  }
  const untap = async (t: Tile) => {
    setMenu(null)
    if (!t.habit.ownId) return
    if (await act(() => life.extras!.untapHabit(t.habit.ownId!), 'Taken back for today (its points too)')) {
      reloadOwn()
      onChange()
    }
  }
  const drop = async (targetId: string | null) => {
    const id = dragId
    setDragId(null)
    setDropOn(null)
    if (!id || id === targetId || !byId.has(id)) return
    await savePrefs({ order: moveBefore(flatIds, id, targetId) })
  }

  // Close menus with Esc or a tap elsewhere.
  useEffect(() => {
    if (!menu && !boardMenu) return
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e.type === 'pointerdown' && (e.target as Element)?.closest?.('.hb-menu')) return
      setMenu(null)
      setBoardMenu(false)
    }
    window.addEventListener('pointerdown', off)
    window.addEventListener('keydown', off)
    return () => {
      window.removeEventListener('pointerdown', off)
      window.removeEventListener('keydown', off)
    }
  }, [menu, boardMenu])

  const menuTile = menu ? byId.get(menu.id) : undefined
  const sheetTile = sheet && sheet.kind !== 'add' ? byId.get(sheet.id) : undefined
  const hiddenTiles = tiles.filter((t) => t.hidden)
  const pct = count.total ? count.done / count.total : 0

  return (
    <div className={`hb ${mode === 'grid' ? 'grid' : 'list'} ${count.perfect ? 'perfect' : ''}`} aria-label="Habits">
      <header className="hb-head">
        <h2>
          Habits{' '}
          <span className="hb-count">
            {count.done} of {count.total}
          </span>
        </h2>
        <span className={`hb-bar ${count.perfect ? 'all' : ''}`} aria-hidden="true">
          <i style={{ transform: `scaleX(${pct})` }} />
        </span>
        {run > 0 && (
          <span className="hb-run" title={`${run} good ${run === 1 ? 'day' : 'days'} in a row (at least two thirds of your habits done)`}>
            <i aria-hidden="true">🔥</i> {run}
          </span>
        )}
        {count.perfect && <span className="hb-perfect">Perfect day</span>}
        <div className="hb-actions">
          {actions}
          <button type="button" className="hb-more" aria-label="Habit options" aria-expanded={boardMenu} onClick={(e) => (e.stopPropagation(), setBoardMenu((x) => !x))}>
            ⋯
          </button>
          {boardMenu && (
            <div className="hb-menu hb-menu-board" role="menu">
              {life.extras && (
                <button role="menuitem" onClick={() => (setBoardMenu(false), setSheet({ kind: 'add' }))}>
                  + Add a habit
                </button>
              )}
              <button role="menuitem" onClick={() => (setBoardMenu(false), setMode(mode === 'grid' ? 'list' : 'grid'))}>
                {mode === 'grid' ? 'Show as a list' : 'Show as a grid'}
              </button>
              <button role="menuitemcheckbox" aria-checked={prefs.fixed} onClick={() => (setBoardMenu(false), void savePrefs({ fixed: !prefs.fixed }))}>
                {prefs.fixed ? '✓ ' : ''}Keep the order fixed
              </button>
              {hiddenTiles.length > 0 && (
                <button role="menuitemcheckbox" aria-checked={showHidden} onClick={() => (setBoardMenu(false), setShowHidden((x) => !x))}>
                  {showHidden ? 'Hide' : 'Show'} hidden habits ({hiddenTiles.length})
                </button>
              )}
            </div>
          )}
        </div>
        {confetti && <Confetti />}
      </header>

      <ul className="hb-list" ref={boardRef} onDragOver={(e) => dragId && e.preventDefault()} onDrop={(e) => (e.preventDefault(), void drop(null))}>
        {list.map((t) => (
          <HabitRow
            key={t.id}
            t={t}
            pop={pop === t.id}
            dropping={dropOn === t.id && dragId !== t.id}
            onTick={(el) => void tick(t, el)}
            onMenu={(x, y) => setMenu({ id: t.id, x, y })}
            drag={{
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/x-habit', t.id)
                setDragId(t.id)
              },
              onDragEnd: () => (setDragId(null), setDropOn(null)),
              onDragOver: (e) => {
                if (!dragId) return
                e.preventDefault()
                e.stopPropagation()
                setDropOn(t.id)
              },
              onDrop: (e) => {
                e.preventDefault()
                e.stopPropagation()
                void drop(t.id)
              }
            }}
          />
        ))}
      </ul>
      <div className="hb-foot-line">
        {life.extras && (
          <button type="button" className="hb-add" onClick={() => setSheet({ kind: 'add' })}>
            + Add a habit
          </button>
        )}
        {hiddenTiles.length > 0 && !showHidden && (
          <span className="hb-hidden-line">
            {hiddenTiles.length} hidden ·{' '}
            <button type="button" className="hb-link" onClick={() => setShowHidden(true)}>
              Show
            </button>
          </span>
        )}
      </div>
      {children}

      {menu && menuTile && (
        <TileMenu
          t={menuTile}
          x={menu.x}
          y={menu.y}
          first={flatIds[0] === menuTile.id}
          last={flatIds[flatIds.length - 1] === menuTile.id}
          onSkip={(on) => void skip(menuTile, on)}
          onUntap={() => void untap(menuTile)}
          onEdit={() => (setMenu(null), setSheet({ kind: 'edit', id: menuTile.id }))}
          onDetails={() => (setMenu(null), setSheet({ kind: 'details', id: menuTile.id }))}
          onMove={(d) => void move(menuTile, d)}
          onHide={(on) => void hide(menuTile, on)}
        />
      )}
      {sheet?.kind === 'add' && (
        <HabitSheet
          own={own}
          onClose={() => setSheet(null)}
          onSave={async (v) => {
            if (await act(() => life.extras!.editHabits({ op: 'add', name: v.name, look: v.look, schedule: v.schedule }), `Added: ${v.name.trim()}`)) {
              setSheet(null)
              reloadOwn()
              onChange()
            }
          }}
        />
      )}
      {sheet?.kind === 'edit' && sheetTile && (
        <HabitSheet
          own={own}
          tile={sheetTile}
          onClose={() => setSheet(null)}
          onRemove={
            sheetTile.habit.ownId
              ? async () => {
                  if (!(await askConfirm(`Remove "${sheetTile.name}"? Its past days stay in your history.`, { ok: 'Remove' }))) return
                  if (await act(() => life.extras!.editHabits({ op: 'remove', id: sheetTile.habit.ownId! }), `Removed: ${sheetTile.name}`)) {
                    setSheet(null)
                    reloadOwn()
                    onChange()
                  }
                }
              : undefined
          }
          onSave={async (v) => {
            if (sheetTile.habit.ownId) {
              if (await act(() => life.extras!.editHabits({ op: 'update', id: sheetTile.habit.ownId!, name: v.name, look: v.look, schedule: v.schedule }), 'Saved')) {
                setSheet(null)
                reloadOwn()
                onChange()
              }
            } else {
              await savePrefs({ looks: { ...prefs.looks, [sheetTile.id]: v.look } })
              setSheet(null)
            }
          }}
        />
      )}
      {groomOpen && (
        <GroomingSheet
          onClose={() => setGroomOpen(false)}
          onChange={() => {
            load()
            onChange()
          }}
        />
      )}
      {sheet?.kind === 'details' && sheetTile && (
        <DetailsSheet
          t={sheetTile}
          today={today}
          rest={rest}
          onClose={() => setSheet(null)}
          onEdit={() => setSheet({ kind: 'edit', id: sheetTile.id })}
          onSkip={(on) => (setSheet(null), void skip(sheetTile, on))}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ one row

function HabitRow({
  t,
  pop,
  dropping,
  onTick,
  onMenu,
  drag
}: {
  t: Tile
  pop: boolean
  dropping: boolean
  onTick: (el: HTMLElement) => void
  onMenu: (x: number, y: number) => void
  drag: Pick<React.HTMLAttributes<HTMLLIElement>, 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'> & { draggable: boolean }
}) {
  const h = t.habit
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const ringRef = useRef<HTMLSpanElement>(null)
  const p = h.progress
  const frac = t.done ? 1 : p && p.target ? Math.min(1, p.value / p.target) : 0
  const state = t.done ? 'done' : t.skipped ? 'skipped' : t.off ? 'off' : t.due.state
  // One quiet line under the name: live progress, else when it's due; what it paid once done.
  const meta = t.done
    ? t.paid
      ? `+${t.paid} paid`
      : 'done'
    : t.skipped
      ? 'skipped today'
      : t.off
        ? 'not today'
        : p
          ? `${p.value}/${p.target} ${p.unit}`
          : t.due.hint
  const label = h.sheet
    ? `${t.name}: open the checklist (${p ? `${p.value} of ${p.target} ${p.unit}` : meta})`
    : t.done
    ? `${t.name}: done${t.paid ? `, +${t.paid} paid` : ''}`
    : t.skipped
      ? `${t.name}: skipped today`
      : h.auto
        ? `${t.name}: ${h.action ?? 'open'}${p ? ` (${p.value} of ${p.target} ${p.unit})` : ''}. It ticks by itself.`
        : `Tick ${t.name}${h.pays ? ` (${h.pays})` : ''}`
  const startPress = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest?.('.hb-dots-btn')) return
    const x = e.clientX
    const y = e.clientY
    press.current = {
      x,
      y,
      fired: false,
      timer: window.setTimeout(() => {
        if (press.current) press.current.fired = true
        try {
          navigator.vibrate?.(8)
        } catch {
          /* fine */
        }
        onMenu(x, y)
      }, 480)
    }
  }
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer)
  }
  return (
    <li
      className={`hb-row s-${state} ${h.auto ? 'auto' : ''} ${pop ? 'pop' : ''} ${t.hidden ? 'is-hidden' : ''} ${dropping ? 'drop-before' : ''}`}
      data-hb-id={t.id}
      style={{ ['--hc' as string]: COLOR_HEX[t.look.color] ?? COLOR_HEX.violet, ['--f' as string]: frac }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      onPointerDown={startPress}
      onPointerUp={endPress}
      onPointerLeave={endPress}
      onPointerMove={(e) => {
        if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 8) endPress()
      }}
      {...drag}
    >
      <span className="hb-badge" aria-hidden="true">
        <HabitIcon name={t.look.icon} size={15} />
      </span>
      <span className="hb-body">
        <span className="hb-name">{t.name}</span>
        <span className={`hb-meta d-${t.due.state} ${t.done && t.paid ? 'paid' : ''} ${h.auto && p && !t.done ? 'prog' : ''}`}>
          {meta}
          {!t.done && !t.skipped && !t.off && h.pays && <span className="hb-pts">{h.pays}</span>}
        </span>
      </span>
      <span className="hb-dots" aria-label={`Last 7 days: ${t.dots.filter((d) => d.state === 'done').length} done`}>
        {t.dots.map((d) => (
          <i key={d.day} className={`dot ${d.state}`} title={`${d.day}: ${d.state}`} />
        ))}
      </span>
      <span className={`hb-streak ${t.streak.n ? '' : 'none'}`} title={t.streak.n ? `${t.streak.n}-${t.streak.unit} streak` : 'No streak yet'}>
        {t.streak.n > 0 && (
          <>
            <i aria-hidden="true">🔥</i>
            {t.streak.n}
            {t.streak.unit === 'week' ? 'w' : ''}
          </>
        )}
      </span>
      <button
        type="button"
        className="hb-dots-btn"
        aria-label={`More for ${t.name}`}
        onClick={(e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect()
          onMenu(r.right, r.bottom)
        }}
      >
        ⋯
      </button>
      <button
        type="button"
        className="hb-hit"
        aria-label={label}
        aria-disabled={(!h.sheet && (t.done || t.off)) || undefined}
        title={h.sheet ? 'Open the checklist' : h.auto && !t.done ? `${h.action}: it ticks by itself from ${h.source}` : t.done ? 'Done' : 'Tap when you did it'}
        onClick={(e) => {
          if (press.current?.fired) {
            press.current = null
            return
          }
          press.current = null
          onTick(ringRef.current ?? e.currentTarget)
        }}
      >
        <span className={`hb-ring ${frac > 0 ? '' : 'zero'}`} ref={ringRef} aria-hidden="true">
          <svg className="rg" viewBox="0 0 44 44">
            <circle className="tr" cx="22" cy="22" r="19" />
            <circle className="fg" cx="22" cy="22" r="19" pathLength="100" />
          </svg>
          <span className="hb-face">
            {t.done ? <HabitIcon name="check" size={15} /> : t.skipped ? <HabitIcon name="skip" size={12} /> : h.auto ? <HabitIcon name={h.id === 'focus' ? 'play' : 'arrow'} size={12} /> : <span className="hb-face-ico"><HabitIcon name={t.look.icon} size={14} /></span>}
          </span>
        </span>
      </button>
    </li>
  )
}

// ------------------------------------------------------------------ the ⋯ menu

function TileMenu({
  t,
  x,
  y,
  first,
  last,
  onSkip,
  onUntap,
  onEdit,
  onDetails,
  onMove,
  onHide
}: {
  t: Tile
  x: number
  y: number
  first: boolean
  last: boolean
  onSkip: (on: boolean) => void
  onUntap: () => void
  onEdit: () => void
  onDetails: () => void
  onMove: (d: -1 | 1) => void
  onHide: (on: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    setPos({ left: Math.max(8, Math.min(x - w + 8, window.innerWidth - w - 8)), top: y + h + 8 > window.innerHeight ? Math.max(8, y - h - 8) : y + 4 })
    el.querySelector<HTMLButtonElement>('button')?.focus()
  }, [x, y])
  return createPortal(
    <div ref={ref} className="hb-menu hb-menu-tile" role="menu" aria-label={t.name} style={{ left: pos.left, top: pos.top }}>
      <p className="hb-menu-title">{t.name}</p>
      {t.done && t.habit.ownId && (
        <button role="menuitem" onClick={onUntap}>
          Undo today
        </button>
      )}
      {!t.done && (
        <button role="menuitem" onClick={() => onSkip(!t.skipped)}>
          {t.skipped ? 'Back on for today' : 'Skip today'}
          <small>{t.skipped ? '' : 'no points · the streak waits'}</small>
        </button>
      )}
      <button role="menuitem" onClick={onDetails}>
        Details
      </button>
      <button role="menuitem" onClick={onEdit}>
        Edit
      </button>
      <div className="hb-menu-row">
        <button role="menuitem" disabled={first} onClick={() => onMove(-1)} aria-label="Move earlier">
          ↑ Earlier
        </button>
        <button role="menuitem" disabled={last} onClick={() => onMove(1)} aria-label="Move later">
          ↓ Later
        </button>
      </div>
      <button role="menuitem" onClick={() => onHide(!t.hidden)}>
        {t.hidden ? 'Show on Today' : 'Hide from Today'}
      </button>
    </div>,
    document.body
  )
}

// ------------------------------------------------------------------ sheets

export function SheetFrame({ title, onClose, children, label }: { title: ReactNode; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, button:not(.hb-x)')
    first?.focus()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('keydown', key)
      before?.focus?.()
    }
  }, [onClose])
  return createPortal(
    <div className="hb-back" onMouseDown={onClose}>
      <div ref={ref} className="hb-sheet" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h3>{title}</h3>
          <button type="button" className="hb-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body
  )
}

const SLOT_PICKS: [SlotPick, string][] = [
  ['morning', 'Morning'],
  ['day', 'Day'],
  ['evening', 'Evening'],
  ['any', 'Any time']
]

function HabitSheet({ own, tile, onClose, onSave, onRemove }: { own: HabitsView | null; tile?: Tile; onClose: () => void; onSave: (v: { name: string; look: HabitLook; schedule: Schedule }) => void | Promise<void>; onRemove?: () => void }) {
  const builtin = !!tile && !tile.habit.ownId
  const [name, setName] = useState(tile?.name ?? '')
  const [icon, setIcon] = useState(tile?.look.icon ?? 'book')
  const [color, setColor] = useState(tile?.look.color ?? 'violet')
  const [slot, setSlot] = useState<SlotPick>(tile?.look.slot ?? 'any')
  const [by, setBy] = useState<string>(tile?.look.by ?? '')
  const [schedule, setSchedule] = useState<Schedule>(tile?.schedule ?? { kind: 'daily' })
  const [busy, setBusy] = useState(false)
  const hex = COLOR_HEX[color]
  const pays = own?.pays ?? 0
  const save = async () => {
    if (!builtin && !name.trim()) return
    setBusy(true)
    await onSave({ name: name.trim(), look: { icon, color, slot, by: by || null }, schedule })
    setBusy(false)
  }
  return (
    <SheetFrame title={tile ? `Edit ${builtin ? tile.name : 'habit'}` : 'New habit'} label={tile ? 'Edit habit' : 'Add a habit'} onClose={onClose}>
      <form
        className="hb-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="hb-preview" style={{ ['--hc' as string]: hex }}>
          <span className="hb-pv-ico">
            <HabitIcon name={icon} size={22} />
          </span>
          {builtin ? (
            <b>{tile!.name}</b>
          ) : (
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Read 10 pages" maxLength={60} aria-label="Habit name" />
          )}
        </div>
        <fieldset>
          <legend>Icon</legend>
          <div className="hb-icons">
            {HABIT_ICONS.map((n) => (
              <button type="button" key={n} className={icon === n ? 'on' : ''} aria-label={n} aria-pressed={icon === n} onClick={() => setIcon(n)} style={{ ['--hc' as string]: hex }}>
                <HabitIcon name={n} size={18} />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Colour</legend>
          <div className="hb-colors">
            {HABIT_COLORS.map((c) => (
              <button type="button" key={c} className={color === c ? 'on' : ''} aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} style={{ ['--hc' as string]: COLOR_HEX[c] }} />
            ))}
          </div>
        </fieldset>
        {!builtin && (
          <fieldset>
            <legend>How often</legend>
            <div className="hb-seg">
              <button type="button" className={schedule.kind === 'daily' ? 'on' : ''} onClick={() => setSchedule({ kind: 'daily' })}>
                Every day
              </button>
              <button type="button" className={schedule.kind === 'weekdays' ? 'on' : ''} onClick={() => setSchedule({ kind: 'weekdays' })}>
                Weekdays
              </button>
              <button type="button" className={schedule.kind === 'perWeek' ? 'on' : ''} onClick={() => setSchedule({ kind: 'perWeek', n: schedule.kind === 'perWeek' ? schedule.n : 3 })}>
                Times a week
              </button>
            </div>
            {schedule.kind === 'perWeek' && (
              <div className="hb-stepper">
                <button type="button" aria-label="Fewer" disabled={schedule.n <= 1} onClick={() => setSchedule({ kind: 'perWeek', n: schedule.n - 1 })}>
                  −
                </button>
                <b>{schedule.n}× a week</b>
                <button type="button" aria-label="More" disabled={schedule.n >= 6} onClick={() => setSchedule({ kind: 'perWeek', n: schedule.n + 1 })}>
                  +
                </button>
              </div>
            )}
          </fieldset>
        )}
        <fieldset>
          <legend>Time of day</legend>
          <div className="hb-seg">
            {SLOT_PICKS.map(([v, l]) => (
              <button type="button" key={v} className={slot === v ? 'on' : ''} onClick={() => setSlot(v)}>
                {l}
              </button>
            ))}
          </div>
          <label className="hb-by">
            <span>Due by</span>
            <input type="time" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Due by (optional)" />
            {by && (
              <button type="button" className="hb-link" onClick={() => setBy('')}>
                No time
              </button>
            )}
            <small>optional, a soft reminder on the tile</small>
          </label>
        </fieldset>
        <p className="hb-pays">
          <span className="hb-coin" aria-hidden="true" />
          {builtin
            ? tile!.habit.auto
              ? `Pays ${tile!.habit.pays} when ${tile!.habit.source} logs it. A tap here only opens it.`
              : `Pays ${tile!.habit.pays || 'nothing'} when you do it, once a day.`
            : pays
              ? `Pays +${pays} on a day you tick it, only when you did it (your habits share up to ${own?.cap || pays} a day).`
              : 'Your own habits pay no points right now (Rewards → How you earn).'}
        </p>
        <div className="hb-form-foot">
          {onRemove && (
            <button type="button" className="btn ghost danger" onClick={onRemove}>
              Remove
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || (!builtin && !name.trim())}>
            {tile ? 'Save' : 'Add habit'}
          </button>
        </div>
      </form>
    </SheetFrame>
  )
}

function DetailsSheet({ t, today, rest, onClose, onEdit, onSkip }: { t: Tile; today: string; rest: string[]; onClose: () => void; onEdit: () => void; onSkip: (on: boolean) => void }) {
  const month = weekDots(t.days, today, { rest, skips: t.skips, schedule: t.schedule, n: 28 })
  const doneN = month.filter((d) => d.state === 'done').length
  const h = t.habit
  return (
    <SheetFrame
      title={
        <span className="hb-dt-title" style={{ ['--hc' as string]: COLOR_HEX[t.look.color] }}>
          <span className="hb-pv-ico">
            <HabitIcon name={t.look.icon} size={20} />
          </span>
          {t.name}
        </span>
      }
      label={`${t.name}: details`}
      onClose={onClose}
    >
      <dl className="hb-facts">
        <div>
          <dt>Streak</dt>
          <dd>{t.streak.n ? `🔥 ${t.streak.n} ${t.streak.unit}${t.streak.n === 1 ? '' : 's'}` : 'Not yet'}</dd>
        </div>
        <div>
          <dt>Last 4 weeks</dt>
          <dd>
            {doneN} of 28 days{t.best ? ` · best ${t.best}` : ''}
          </dd>
        </div>
        <div>
          <dt>When</dt>
          <dd>
            {t.look.slot === 'any' ? 'Any time' : SLOT_LABEL[t.look.slot]}
            {t.look.by ? `, by ${t.look.by}` : ''} · {scheduleText(t.schedule)}
          </dd>
        </div>
        <div>
          <dt>How it's logged</dt>
          <dd>{h.auto ? `By itself, from ${h.source}` : h.ownId ? 'You tick it when you did it' : `You tick it (${h.source})`}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd>
            {h.pays ? `${h.pays} when done` : 'None'}
            {t.paid ? ` · +${t.paid} paid today` : ''}
          </dd>
        </div>
      </dl>
      <div className="hb-month" aria-label={`Last 28 days: ${doneN} done`} style={{ ['--hc' as string]: COLOR_HEX[t.look.color] }}>
        {month.map((d) => (
          <i key={d.day} className={`dot ${d.state}`} title={`${d.day}: ${d.state}`} />
        ))}
      </div>
      <div className="hb-form-foot">
        {!t.done && (
          <button type="button" className="btn ghost" onClick={() => onSkip(!t.skipped)}>
            {t.skipped ? 'Back on for today' : 'Skip today'}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onEdit}>
          Edit
        </button>
      </div>
    </SheetFrame>
  )
}

// ------------------------------------------------------------------ perfect day

const CONFETTI = ['#c8f135', '#f5b53d', '#ff7a59', '#f472b6', '#a78bfa', '#38bdf8', '#2dd4bf']
function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => ({
        x: Math.round((Math.random() - 0.5) * 520),
        y: Math.round(-60 - Math.random() * 120),
        r: Math.round(Math.random() * 720 - 360),
        d: Math.round(Math.random() * 180),
        c: CONFETTI[i % CONFETTI.length],
        w: 5 + Math.round(Math.random() * 4)
      })),
    []
  )
  return (
    <div className="hb-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ ['--x' as string]: `${b.x}px`, ['--y' as string]: `${b.y}px`, ['--r' as string]: `${b.r}deg`, ['--d' as string]: `${b.d}ms`, ['--c' as string]: b.c, width: b.w, height: b.w * 0.45 }} />
      ))}
    </div>
  )
}
