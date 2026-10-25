import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TASK_MAX_COINS, TASK_MAX_XP } from '@core/plan'
import type { Repeat, TaskInput, TasksState, TaskView } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction } from '../ui'
import { WeekdayPicker, weekdayLabel } from './planUi'

interface Props {
  state: TasksState
  onState: (s: TasksState) => void
  onWallet: () => void
}

const PRIORITY = { 1: 'High', 2: 'Normal', 3: 'Low' } as const

export function Tasks({ state, onState, onWallet }: Props) {
  const act = useAction()
  const [filter, setFilter] = useState<string>('all')
  const [editing, setEditing] = useState<TaskInput | null>(null)
  const [showDone, setShowDone] = useState(true)

  const catById = useMemo(() => Object.fromEntries(state.categories.map((c) => [c.id, c])), [state.categories])
  const visible = state.tasks.filter((t) => (filter === 'all' || t.category === filter) && (showDone || !t.done))
  const groups = state.categories
    .map((c) => ({ cat: c, tasks: visible.filter((t) => t.category === c.id) }))
    .filter((g) => g.tasks.length)
  const open = state.tasks.filter((t) => !t.done).length

  async function toggle(t: TaskView) {
    const s = await act(() => (t.done ? life.tasks.uncomplete(t.id) : life.tasks.complete(t.id)))
    if (s) {
      onState(s)
      onWallet()
    }
  }

  async function save(t: TaskInput) {
    const s = await act(() => life.tasks.save(t), 'Saved')
    if (s) {
      onState(s)
      setEditing(null)
    }
  }

  const blank = (): TaskInput => ({ title: '', category: filter === 'all' ? 'life' : filter, coins: 5, xp: 10, priority: 2, due: null, repeat: 'none', weekdays: 0, notes: null })

  return (
    <div className="tasks">
      <div className="task-bar">
        <div className="chips-row" role="tablist" aria-label="Categories">
          <button className={`fchip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
            All <em>{open}</em>
          </button>
          {state.categories.map((c) => {
            const n = state.tasks.filter((t) => t.category === c.id && !t.done).length
            return (
              <button key={c.id} className={`fchip ${filter === c.id ? 'on' : ''}`} style={{ ['--c' as string]: c.color }} onClick={() => setFilter(c.id)}>
                <i className="dot" /> {c.label} {n > 0 && <em>{n}</em>}
              </button>
            )
          })}
        </div>
        <div className="task-meta">
          <span className="hint" title="Coins from tasks stop at the daily cap; XP keeps counting">
            Task coins today <b>{state.coinsToday}</b> / {state.dailyCap}
          </span>
          <label className="check small-check">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
          </label>
          <button className="btn primary small" onClick={() => setEditing(blank())}>
            <Icon name="plus" size={14} /> New task
          </button>
        </div>
      </div>

      {groups.length === 0 && (
        <section className="panel empty">
          <Icon name="check" size={30} />
          <p>{state.tasks.length ? 'Nothing here. Nice.' : 'No tasks yet. Add your first one.'}</p>
        </section>
      )}

      {groups.map(({ cat, tasks }) => (
        <section key={cat.id} className="panel task-group" style={{ ['--c' as string]: cat.color }}>
          <header className="panel-head">
            <h2>
              <i className="dot big-dot" /> {cat.label}
            </h2>
            <span className="hint">{tasks.filter((t) => !t.done).length} open</span>
          </header>
          <ul className="task-list">
            <AnimatePresence initial={false}>
              {tasks.map((t) => (
                <motion.li key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`task ${t.done ? 'done' : ''} ${t.overdue ? 'overdue' : ''}`}>
                  <motion.button className="tick" whileTap={{ scale: 0.85 }} aria-label={t.done ? `Untick ${t.title}` : `Complete ${t.title}`} onClick={() => toggle(t)}>
                    {t.done && <Icon name="check" size={14} />}
                  </motion.button>
                  <div className="task-main">
                    <span className="task-title">{t.title}</span>
                    <span className="task-tags">
                      {t.priority === 1 && <span className="tag hot">High</span>}
                      {t.repeat === 'daily' && <span className="tag">Daily</span>}
                      {t.repeat === 'weekly' && <span className="tag">{weekdayLabel(t.weekdays)}</span>}
                      {t.due && t.repeat === 'none' && <span className={`tag ${t.overdue ? 'hot' : ''}`}>{t.overdue ? `Overdue · ${t.due}` : t.due === state.today ? 'Due today' : `Due ${t.due}`}</span>}
                      {t.notes && <span className="tag ghost-tag">{t.notes}</span>}
                    </span>
                  </div>
                  <span className="task-pay">
                    <Coins n={t.coins} sign />
                    <small>+{t.xp} XP</small>
                  </span>
                  <button className="icon-btn" aria-label={`Edit ${t.title}`} title="Edit" onClick={() => setEditing({ ...t })}>
                    <Icon name="sliders" size={14} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ))}

      {editing && (
        <TaskSheet
          value={editing}
          categories={state.categories.map((c) => ({ id: c.id, label: c.label }))}
          onCancel={() => setEditing(null)}
          onSave={save}
          onArchive={async (id) => {
            const s = await act(() => life.tasks.archive(id), 'Task removed')
            if (s) {
              onState(s)
              setEditing(null)
            }
          }}
          catColor={catById[editing.category]?.color}
        />
      )}
    </div>
  )
}

function TaskSheet({ value, categories, onCancel, onSave, onArchive, catColor }: {
  value: TaskInput
  categories: { id: string; label: string }[]
  onCancel: () => void
  onSave: (t: TaskInput) => void
  onArchive: (id: number) => void
  catColor?: string
}) {
  const [t, setT] = useState(value)
  const int = (k: 'coins' | 'xp') => (e: React.ChangeEvent<HTMLInputElement>) => setT({ ...t, [k]: parseInt(e.target.value, 10) || 0 })
  const setRepeat = (r: Repeat) => setT({ ...t, repeat: r, weekdays: r === 'weekly' && !t.weekdays ? 0b0011111 : t.weekdays, due: r === 'none' ? t.due : null })

  return (
    <div className="sheet" role="dialog" aria-label="Edit task">
      <div className="sheet-card" style={{ ['--c' as string]: catColor ?? 'var(--lime)' }}>
        <h3>{t.id ? 'Edit task' : 'New task'}</h3>
        <label>
          Task
          <input autoFocus value={t.title} placeholder="e.g. Finish lab report" onChange={(e) => setT({ ...t, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && onSave(t)} />
        </label>
        <div className="grid3">
          <label>
            Category
            <select value={t.category} onChange={(e) => setT({ ...t, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Coins (max {TASK_MAX_COINS})
            <input type="number" min={0} max={TASK_MAX_COINS} value={t.coins} onChange={int('coins')} />
          </label>
          <label>
            XP (max {TASK_MAX_XP})
            <input type="number" min={0} max={TASK_MAX_XP} value={t.xp} onChange={int('xp')} />
          </label>
        </div>
        <div className="field">
          <span>Priority</span>
          <div className="seg">
            {([1, 2, 3] as const).map((p) => (
              <button key={p} type="button" className={t.priority === p ? 'on' : ''} onClick={() => setT({ ...t, priority: p })}>
                {PRIORITY[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>Repeat</span>
          <div className="seg">
            {(['none', 'daily', 'weekly'] as const).map((r) => (
              <button key={r} type="button" className={t.repeat === r ? 'on' : ''} onClick={() => setRepeat(r)}>
                {r === 'none' ? 'Once' : r === 'daily' ? 'Every day' : 'Some days'}
              </button>
            ))}
          </div>
        </div>
        {t.repeat === 'weekly' && <WeekdayPicker value={t.weekdays} onChange={(weekdays) => setT({ ...t, weekdays })} />}
        {t.repeat === 'none' && (
          <label>
            Due date (optional)
            <input type="date" value={t.due ?? ''} onChange={(e) => setT({ ...t, due: e.target.value || null })} />
          </label>
        )}
        <label>
          Note (optional)
          <input value={t.notes ?? ''} onChange={(e) => setT({ ...t, notes: e.target.value })} />
        </label>
        <div className="sheet-actions">
          {t.id && (
            <button className="btn ghost danger-text" onClick={() => onArchive(t.id!)}>
              Remove
            </button>
          )}
          <span className="spacer" />
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onSave(t)}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
