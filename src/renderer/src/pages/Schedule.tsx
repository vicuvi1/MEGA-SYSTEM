import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { addDays } from '@core/dates'
import { BLOCK_RULES, EVERY_DAY, weekdayIndex, WEEKDAYS, WORK_DAYS } from '@core/plan'
import type { BlockInput, BlockKind, BlockView, Rule, ScheduleState } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { DualTimeline } from '../DualTimeline'
import { Coins, useAction } from '../ui'
import { clock, mmss, WeekdayPicker, weekdayLabel } from './planUi'

interface Props {
  state: ScheduleState
  rules: Rule[]
  onState: (s: ScheduleState) => void
  onWallet: () => void
}

export const KIND: Record<BlockKind, { label: string; color: string }> = {
  study: { label: 'Study', color: '#7CC4FF' },
  workout: { label: 'Workout', color: '#FF6B8B' },
  other: { label: 'Other', color: '#8A93A6' }
}

const STATUS_LABEL = { pending: 'Planned', running: 'In progress', done: 'Done', skipped: 'Skipped', missed: 'Missed' } as const

/** Re-renders every second while `on` is true. */
export function useTicker(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function Schedule({ state, rules, onState, onWallet }: Props) {
  const act = useAction()
  const [editing, setEditing] = useState<BlockInput | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; block: BlockView } | null>(null)
  const [scheduleView, setScheduleView] = useState<'timeline' | 'blocks' | 'week'>('timeline')
  const running = state.blocks.find((b) => b.status === 'running')
  const now = useTicker(!!running)
  const isToday = state.day === state.today
  const ruleCoins = (id: string | null) => rules.find((r) => r.id === id)?.coins ?? 0

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', (e) => e.key === 'Escape' && close())
    return () => {
      window.removeEventListener('mousedown', close)
    }
  }, [contextMenu])

  const go = (day: string) => act(() => life.schedule.state(day)).then((s) => s && onState(s))

  async function run(kind: 'start' | 'finish' | 'skip', b: BlockView) {
    const s = await act(() => life.schedule[kind](b.id), kind === 'finish' ? 'Block done. Nice work.' : undefined)
    if (s) {
      onState(s)
      if (kind !== 'start') onWallet()
    }
  }

  async function save(b: BlockInput) {
    const s = await act(() => life.schedule.save(b), 'Saved')
    if (s) {
      onState(await life.schedule.state(state.day))
      setEditing(null)
    }
  }

  // Monday-first week around the shown day.
  const monday = addDays(state.day, -weekdayIndex(state.day))
  const week = WEEKDAYS.map((label, i) => ({ label, day: addDays(monday, i) }))

  const blank = (): BlockInput => ({ title: '', kind: 'study', start: '18:00', minutes: 50, weekdays: WORK_DAYS, date: null, remindMin: 5 })

  return (
    <div className="schedule">
      <div className="week">
        <button className="icon-btn" aria-label="Previous week" onClick={() => go(addDays(state.day, -7))}>
          ‹
        </button>
        {week.map((w) => (
          <button key={w.day} className={`wk ${w.day === state.day ? 'on' : ''} ${w.day === state.today ? 'today' : ''}`} onClick={() => go(w.day)}>
            <small>{w.label}</small>
            <b>{Number(w.day.slice(8))}</b>
          </button>
        ))}
        <button className="icon-btn" aria-label="Next week" onClick={() => go(addDays(state.day, 7))}>
          ›
        </button>
        {!isToday && (
          <button className="btn small ghost" onClick={() => go(state.today)}>
            Today
          </button>
        )}
        <span className="spacer" />
        <button className="btn primary small" onClick={() => setEditing(blank())}>
          <Icon name="plus" size={14} /> New block
        </button>
      </div>

      {/* View Switcher: Dual Timeline & Calendar vs Blocks vs Weekly Overview */}
      <div className="seg-switch" style={{ margin: '14px 0 16px', alignSelf: 'flex-start' }}>
        <button
          className={scheduleView === 'timeline' ? 'on' : ''}
          onClick={() => setScheduleView('timeline')}
        >
          <Icon name="calendar" size={14} />
          Dual Timeline & Calendar
        </button>
        <button
          className={scheduleView === 'blocks' ? 'on' : ''}
          onClick={() => setScheduleView('blocks')}
        >
          <Icon name="list" size={14} />
          Focus Blocks List ({state.blocks.length})
        </button>
        <button
          className={scheduleView === 'week' ? 'on' : ''}
          onClick={() => setScheduleView('week')}
        >
          <Icon name="spark" size={14} />
          Weekly Overview ({state.all.length})
        </button>
      </div>

      {running && isToday && <FocusCard block={running} now={now} onFinish={() => run('finish', running)} onSkip={() => run('skip', running)} />}

      {scheduleView === 'timeline' && (
        <div style={{ marginBottom: 24 }}>
          <DualTimeline schedule={state} onSchedule={onState} />
        </div>
      )}

      {scheduleView === 'blocks' && (
      <section className="panel">
        <header className="panel-head">
          <h2>{isToday ? 'Today' : new Date(`${state.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
          <span className="hint">Study blocks pay when you finish them with the timer. Skipping, or leaving one open past the day, costs a little.</span>
        </header>
        {state.blocks.length === 0 ? (
          <div className="empty">
            <Icon name="calendar" size={28} />
            <p>Nothing planned for this day.</p>
          </div>
        ) : (
          <ol className="timeline">
            {state.blocks.map((b) => {
              const k = KIND[b.kind]
              const pay = ruleCoins(BLOCK_RULES[b.kind].done)
              const cost = ruleCoins(BLOCK_RULES[b.kind].skipped)
              const open = b.status === 'pending' || b.status === 'running'
              return (
                <li key={b.id} className={`tl ${b.status}`} style={{ ['--c' as string]: k.color }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setContextMenu({ x: e.clientX, y: e.clientY, block: b })
                    }}
                  >
                  <div className="tl-time">
                    <b>{clock(b.startsAt)}</b>
                    <small>{clock(b.endsAt)}</small>
                  </div>
                  <div className="tl-card">
                    <div className="tl-head">
                      <span className="tl-title">{b.title}</span>
                      <span className={`status s-${b.status}`}>{STATUS_LABEL[b.status]}</span>
                    </div>
                    <div className="tl-sub">
                      <span>{k.label}</span>
                      <span>{b.minutes} min</span>
                      {b.date ? <span>Once</span> : <span>{weekdayLabel(b.weekdays)}</span>}
                      {pay > 0 && <Coins n={pay} sign />}
                      {cost < 0 && <span className="neg-text">skip {cost}</span>}
                    </div>
                    {isToday && open && b.status !== 'running' && (
                      <div className="tl-actions">
                        <button className="btn small primary" disabled={!!running} title={running ? 'Another block is running' : ''} onClick={() => run('start', b)}>
                          Start timer
                        </button>
                        <button className="btn small ghost" onClick={() => run('skip', b)}>
                          Skip
                        </button>
                      </div>
                    )}
                  </div>
                  <button className="icon-btn tl-edit" aria-label={`Edit ${b.title}`} title="Edit" onClick={() => setEditing({ ...b })}>
                    <Icon name="sliders" size={14} />
                  </button>
                  <button
                    className="icon-btn tl-edit"
                    aria-label={`Delete ${b.title}`}
                    title="Delete Block"
                    style={{ color: '#ef4444' }}
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (b.id) {
                        const s = await act(() => life.schedule.archive(b.id), 'Block removed')
                        if (s) onState(await life.schedule.state(state.day))
                      }
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </section>
      )}

      {scheduleView === 'week' && state.all.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h2>Your week</h2>
            <span className="hint">All blocks. Click one to change it.</span>
          </header>
          <div className="all-blocks">
            {state.all.map((b) => (
              <button key={b.id} className="mini-block" style={{ ['--c' as string]: KIND[b.kind].color }} onClick={() => setEditing({ ...b })}>
                <b>{b.title}</b>
                <span>
                  {b.start} · {b.minutes} min · {b.date ?? weekdayLabel(b.weekdays)}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Schedule Block Context Menu */}
      {contextMenu && (
        <div
          className="task-context-menu"
          style={{
            left: `${Math.min(contextMenu.x, window.innerWidth - 240)}px`,
            top: `${Math.min(contextMenu.y, window.innerHeight - 260)}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="cm-header">
            <span className="cm-title">{contextMenu.block.title}</span>
            <span className="cm-sub">{contextMenu.block.minutes} min · {contextMenu.block.status}</span>
          </div>

          <button
            className="cm-item danger"
            onClick={async () => {
              const b = contextMenu.block
              setContextMenu(null)
              if (b.id) {
                const s = await act(() => life.schedule.archive(b.id), 'Block removed')
                if (s) onState(await life.schedule.state(state.day))
              }
            }}
          >
            <Icon name="trash" size={14} />
            <span>Delete Schedule Block</span>
          </button>

          <button
            className="cm-item"
            onClick={() => {
              setEditing({ ...contextMenu.block })
              setContextMenu(null)
            }}
          >
            <Icon name="sliders" size={14} />
            <span>Edit Block Settings</span>
          </button>

          {isToday && contextMenu.block.status === 'pending' && (
            <button
              className="cm-item"
              onClick={() => {
                run('start', contextMenu.block)
                setContextMenu(null)
              }}
            >
              <Icon name="bolt" size={14} />
              <span>Start Timer Now</span>
            </button>
          )}

          {isToday && (contextMenu.block.status === 'pending' || contextMenu.block.status === 'running') && (
            <button
              className="cm-item"
              onClick={() => {
                run('skip', contextMenu.block)
                setContextMenu(null)
              }}
            >
              <Icon name="undo" size={14} />
              <span>Skip Block</span>
            </button>
          )}
        </div>
      )}

      {editing && (
        <BlockSheet
          value={editing}
          onCancel={() => setEditing(null)}
          onSave={save}
          onArchive={async (id) => {
            const s = await act(() => life.schedule.archive(id), 'Block removed')
            if (s) {
              onState(await life.schedule.state(state.day))
              setEditing(null)
            }
          }}
        />
      )}
    </div>
  )
}

function FocusCard({ block, now, onFinish, onSkip }: { block: BlockView; now: number; onFinish: () => void; onSkip: () => void }) {
  const started = Date.parse(block.startedAt!)
  const total = block.minutes * 60_000
  const elapsed = now - started
  const pct = Math.min(1, elapsed / total)
  const unlockAt = block.finishAllowedAt ? Date.parse(block.finishAllowedAt) : started
  const canFinish = now >= unlockAt
  const R = 54
  const C = 2 * Math.PI * R
  return (
    <motion.section className="focus" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} style={{ ['--c' as string]: KIND[block.kind].color }}>
      <svg className="ring" width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
        <circle cx="66" cy="66" r={R} className="ring-bg" />
        <circle cx="66" cy="66" r={R} className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
      </svg>
      <div className="focus-time">
        <b>{mmss(elapsed)}</b>
        <small>of {block.minutes} min</small>
      </div>
      <div className="focus-info">
        <span className="label">Focus · {KIND[block.kind].label}</span>
        <h2>{block.title}</h2>
        <p className="hint">{canFinish ? 'You can finish now. Keep going if you are in the zone.' : `Finish unlocks in ${mmss(unlockAt - now)}. Stay with it.`}</p>
        <div className="row">
          <button className="btn primary" disabled={!canFinish} onClick={onFinish}>
            Finish block
          </button>
          <button className="btn ghost" onClick={onSkip}>
            Give up (skip)
          </button>
        </div>
      </div>
    </motion.section>
  )
}

function BlockSheet({ value, onCancel, onSave, onArchive }: { value: BlockInput; onCancel: () => void; onSave: (b: BlockInput) => void; onArchive: (id: number) => void }) {
  const [b, setB] = useState(value)
  const once = !!b.date
  return (
    <div className="sheet" role="dialog" aria-label="Edit block">
      <div className="sheet-card">
        <h3>{b.id ? 'Edit block' : 'New block'}</h3>
        <label>
          Name
          <input autoFocus value={b.title} placeholder="e.g. Math" onChange={(e) => setB({ ...b, title: e.target.value })} />
        </label>
        <div className="field">
          <span>Type</span>
          <div className="seg">
            {(Object.keys(KIND) as BlockKind[]).map((k) => (
              <button key={k} type="button" className={b.kind === k ? 'on' : ''} onClick={() => setB({ ...b, kind: k })}>
                {KIND[k].label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid3">
          <label>
            Starts
            <input type="time" value={b.start} onChange={(e) => setB({ ...b, start: e.target.value })} />
          </label>
          <label>
            Minutes
            <input type="number" min={5} max={600} value={b.minutes} onChange={(e) => setB({ ...b, minutes: parseInt(e.target.value, 10) || 0 })} />
          </label>
          <label>
            Remind before (min)
            <input type="number" min={0} max={120} value={b.remindMin} onChange={(e) => setB({ ...b, remindMin: parseInt(e.target.value, 10) || 0 })} />
          </label>
        </div>
        <div className="field">
          <span>When</span>
          <div className="seg">
            <button type="button" className={!once ? 'on' : ''} onClick={() => setB({ ...b, date: null, weekdays: b.weekdays || EVERY_DAY })}>
              Repeats
            </button>
            <button type="button" className={once ? 'on' : ''} onClick={() => setB({ ...b, date: new Date().toISOString().slice(0, 10) })}>
              One day
            </button>
          </div>
        </div>
        {once ? (
          <input type="date" aria-label="Date" value={b.date ?? ''} onChange={(e) => setB({ ...b, date: e.target.value || null })} />
        ) : (
          <WeekdayPicker value={b.weekdays} onChange={(weekdays) => setB({ ...b, weekdays })} />
        )}
        <p className="hint">
          {b.kind === 'study' ? 'Study: run the timer for 80% of the block to earn coins. Skipping costs a few.' : b.kind === 'workout' ? 'Workout: finishing logs a workout for coins.' : 'Other: just a reminder, no coins.'}
        </p>
        <div className="sheet-actions">
          {b.id && (
            <button className="btn ghost danger-text" onClick={() => onArchive(b.id!)}>
              Remove
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(b)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
