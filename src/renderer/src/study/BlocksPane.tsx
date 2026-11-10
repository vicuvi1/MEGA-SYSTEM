// Study Time's right half: the quick add bar ("Math lab 4 50m #practice
// tomorrow"), the filters (Today, Tomorrow, This week, All, Completed, each
// subject and tag with its time this week) and your blocks: drag to reorder,
// tomato dots (planned against done), due dates (red when overdue), repeat,
// clear Start / Done / Edit buttons. Your study tasks from Todoist show here
// too, and Done on one completes it in Todoist.
import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, dayLabel } from '@core/dates'
import { parseQuickAdd, pomosByBlock, quickAddBlock, todoistChoices, tomatoDots } from '@core/studyPlan'
import {
  NO_BLOCK_COLOR,
  PALETTE,
  categoryColor,
  categoryEmoji,
  filterBlocks,
  filterCounts,
  hmText,
  isOverdue,
  minutesByBlock,
  newBlockId,
  nextDue,
  prefsOf,
  totalsByGroup,
  weekStart,
  type Repeat,
  type StudyBlock,
  type StudyFilter,
  type StudySession,
  type StudyStore
} from '@core/studyTime'
import type { TodoTask } from '@core/todoist'
import { life } from '../bridge'
import { useAction } from '../ui'
import { soundSuccess } from '../soundKit'
import { pullTodoist, todoTasks, type Running } from './studyData'

const REPEAT_LABEL: Record<Repeat, string> = { daily: 'every day', weekdays: 'weekdays', weekly: 'every week' }

export function BlocksPane({ store, sessions, run, today, selected, onSelect }: { store: StudyStore; sessions: StudySession[]; run: Running | null; today: string; selected: string | null; onSelect: (id: string) => void }) {
  const act = useAction()
  const [filter, setFilter] = useState<StudyFilter>({ kind: 'today' })
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [todo, setTodo] = useState(false)
  const shown = filterBlocks(store.blocks, filter, today)
  const counts = filterCounts(store.blocks, today)
  const todayBy = minutesByBlock(sessions, today, today)
  const week = sessions.filter((s) => s.day >= weekStart(today) && s.day <= today)
  const totals = totalsByGroup(week, store)
  const pomos = pomosByBlock(sessions, store)
  const tags = [...new Set(store.blocks.flatMap((b) => b.tags))].sort()
  const cats = [...new Set(store.blocks.map((b) => b.category).filter(Boolean))].sort()
  const isOn = (f: StudyFilter) => JSON.stringify(f) === JSON.stringify(filter)
  const fixed: [Exclude<StudyFilter['kind'], 'category' | 'tag'>, string][] = [
    ['today', 'Today'],
    ['tomorrow', 'Tomorrow'],
    ['week', 'This week'],
    ['all', 'All'],
    ['done', 'Completed']
  ]
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const move = (ids: string[]) => void act(() => life.study!.change({ op: 'reorder', ids }))
  const dropOn = (target: string) => {
    if (!dragId || dragId === target) return
    const ids = shown.map((b) => b.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(target), 0, dragId)
    move(ids)
  }
  const nudge = (id: string, d: -1 | 1) => {
    const ids = shown.map((b) => b.id)
    const i = ids.indexOf(id)
    const j = i + d
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    move(ids)
  }
  return (
    <div className="sy-half sy-right">
      <QuickAdd store={store} today={today} filter={filter} />
      <section className="sy-card sy-blocks" aria-label="Blocks">
        <nav className="sy-filters" aria-label="Filters">
          <div className="sy-frow">
            {fixed.map(([k, label]) => (
              <button key={k} className={isOn({ kind: k }) ? 'on' : ''} data-filter={k} onClick={() => setFilter({ kind: k })}>
                {label} <small>{counts[k]}</small>
              </button>
            ))}
            <span className="sy-fspace" />
            <button className={`sy-todo-btn ${todo ? 'on' : ''}`} onClick={() => setTodo((x) => !x)} title="Bring your study tasks from Todoist in as blocks" aria-expanded={todo}>
              ✓ Todoist
            </button>
          </div>
          {(cats.length > 0 || totals.category.has('~none')) && (
            <div className="sy-frow sy-frow-sub" aria-label="Subjects, this week">
              <span className="sy-flabel" title="Time studied this week">This week {hmText(totals.total)}</span>
              {cats.map((c) => (
                <button key={c} className={`sy-fchip ${isOn({ kind: 'category', name: c }) ? 'on' : ''}`} onClick={() => setFilter(isOn({ kind: 'category', name: c }) ? { kind: 'today' } : { kind: 'category', name: c })} style={{ ['--c' as string]: categoryColor(store, c) }} title={`${c}: ${hmText(totals.category.get(c.toLowerCase()) ?? 0)} this week`}>
                  <i className="dot" />
                  {categoryEmoji(store, c) && <span>{categoryEmoji(store, c)}</span>}
                  {c} <small>{hmText(totals.category.get(c.toLowerCase()) ?? 0)}</small>
                </button>
              ))}
              {totals.category.has('~none') && (
                <span className="sy-fchip ghost" style={{ ['--c' as string]: NO_BLOCK_COLOR }} title="Plain focus timers and older sessions with no block">
                  <i className="dot" />
                  No block <small>{hmText(totals.category.get('~none') ?? 0)}</small>
                </span>
              )}
            </div>
          )}
          {tags.length > 0 && (
            <div className="sy-frow sy-frow-sub" aria-label="Tags, this week">
              {tags.map((t) => (
                <button key={t} className={`sy-fchip tag ${isOn({ kind: 'tag', tag: t }) ? 'on' : ''}`} onClick={() => setFilter(isOn({ kind: 'tag', tag: t }) ? { kind: 'today' } : { kind: 'tag', tag: t })}>
                  #{t} <small>{hmText(totals.tag.get(t) ?? 0)}</small>
                </button>
              ))}
            </div>
          )}
        </nav>
        {todo && <TodoistPicker store={store} onClose={() => setTodo(false)} />}
        <div className="sy-list">
          <header className="sy-head">
            <h2>{filter.kind === 'category' ? filter.name : filter.kind === 'tag' ? `#${filter.tag}` : fixed.find((f) => f[0] === filter.kind)?.[1]}</h2>
            <button className="btn small" onClick={() => setEditing('new')} title="Add a block with every detail (or type it in the bar above)">
              + New block
            </button>
          </header>
          {editing === 'new' && <BlockForm store={store} block={null} today={today} onDone={() => setEditing(null)} />}
          <ul onDragEnd={() => (setDragId(null), setOverId(null))}>
            {shown.map((b) =>
              editing === b.id ? (
                <li key={b.id} className="sy-editrow">
                  <BlockForm store={store} block={b} today={today} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <BlockRow
                  key={b.id}
                  b={b}
                  store={store}
                  today={today}
                  run={run}
                  picked={selected === b.id}
                  todayMin={todayBy.get(b.id) ?? 0}
                  pomos={pomos.get(b.id) ?? 0}
                  dragging={dragId === b.id}
                  over={overId === b.id && dragId !== b.id}
                  onPick={() => onSelect(b.id)}
                  onEdit={() => setEditing(b.id)}
                  onNudge={(d) => nudge(b.id, d)}
                  drag={{
                    onDragStart: (e) => {
                      setDragId(b.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', b.id)
                    },
                    onDragOver: (e) => {
                      e.preventDefault()
                      setOverId(b.id)
                    },
                    onDrop: (e) => {
                      e.preventDefault()
                      dropOn(b.id)
                      setDragId(null)
                      setOverId(null)
                    }
                  }}
                />
              )
            )}
            {!shown.length && <li className="sy-hint sy-empty">Nothing here. Type a block in the bar above, or pick another filter.</li>}
          </ul>
        </div>
      </section>
    </div>
  )
}

function BlockRow({ b, store, today, run, picked, todayMin, pomos, dragging, over, onPick, onEdit, onNudge, drag }: {
  b: StudyBlock
  store: StudyStore
  today: string
  run: Running | null
  picked: boolean
  todayMin: number
  pomos: number
  dragging: boolean
  over: boolean
  onPick: () => void
  onEdit: () => void
  onNudge: (d: -1 | 1) => void
  drag: Pick<React.HTMLAttributes<HTMLLIElement>, 'onDragStart' | 'onDragOver' | 'onDrop'>
}) {
  const act = useAction()
  const color = categoryColor(store, b.category)
  const emoji = categoryEmoji(store, b.category)
  const live = run?.blockId === b.id
  const late = isOverdue(b, today)
  const dots = tomatoDots(b.estPomos, pomos)
  const start = async () => {
    if (run) {
      if (await act(() => life.study!.switchBlock(b), (r) => (r.logged ? `${r.logged.session.minutes} min to ${run.subject} · now ${b.name}` : `Now ${b.name}`))) onPick()
      return
    }
    if (await act(() => life.study!.start(b), `Started: ${b.name}`)) {
      soundSuccess()
      onPick()
    }
  }
  const done = async () => {
    const next = !b.done
    const ok = await act(() => life.study!.change({ op: 'done', id: b.id, done: next }), next ? (b.repeat && !b.fromTodoist ? `Done · back ${dayLabel(nextDue(b.due, b.repeat, today))}` : 'Done') : 'Brought back')
    // A linked Todoist task is completed there too (the usual Tasks path: its own points rule).
    if (ok && next && b.taskId && life.todoist) {
      const t: TodoTask = todoTasks().find((x) => x.id === b.taskId) ?? { id: b.taskId, content: b.taskTitle ?? b.name, priority: 1, due: b.due, dueTime: null, project: null, recurring: false }
      await act(() => life.todoist!.complete(t), 'Completed in Todoist too')
    }
  }
  const dueText = b.due ? (b.due === today ? 'Today' : b.due === addDays(today, 1) ? 'Tomorrow' : late ? `${dayLabel(b.due)} (late)` : dayLabel(b.due)) : null
  return (
    <li
      className={`sy-block ${b.done ? 'done' : ''} ${live ? 'live' : ''} ${picked && !live ? 'picked' : ''} ${dragging ? 'dragging' : ''} ${over ? 'drop-here' : ''}`}
      style={{ ['--c' as string]: color }}
      data-block={b.id}
      draggable={!b.done}
      {...drag}
      onClick={(e) => !(e.target as HTMLElement).closest('button') && onPick()}
    >
      <button
        className="sy-grip"
        aria-label={`Move ${b.name} (drag, or Alt + arrow keys)`}
        title="Drag to reorder (or Alt + ↑ / ↓)"
        onKeyDown={(e) => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            onNudge(e.key === 'ArrowUp' ? -1 : 1)
          }
        }}
      >
        ⋮⋮
      </button>
      <span className="sy-badge">{emoji || b.name.slice(0, 1).toUpperCase()}</span>
      <div className="sy-bmain">
        <b>{b.name}</b>
        <small className="sy-meta">
          <span>{b.category || 'No subject'}</span>
          {b.tags.map((t) => (
            <span key={t} className="sy-tag">
              #{t}
            </span>
          ))}
          {dueText && <span className={`sy-due ${late ? 'late' : b.due === today ? 'today' : ''}`}>📅 {dueText}</span>}
          {b.repeat && <span title={`Comes back ${REPEAT_LABEL[b.repeat]}`}>↻ {REPEAT_LABEL[b.repeat]}</span>}
          {b.taskId && <span title={b.taskTitle ? `Todoist: ${b.taskTitle}` : 'Linked to Todoist'}>✓ Todoist</span>}
        </small>
        {(dots.done > 0 || dots.left > 0) && (
          <span className="sy-tomatoes" title={`${pomos} of ${b.estPomos ?? 0} pomodoros done`} aria-label={`${pomos} of ${b.estPomos ?? 0} pomodoros`}>
            {Array.from({ length: dots.done }, (_, i) => (
              <i key={`d${i}`} className="done" />
            ))}
            {Array.from({ length: dots.left }, (_, i) => (
              <i key={`l${i}`} />
            ))}
            {dots.extra > 0 && <small>+{dots.extra}</small>}
          </span>
        )}
      </div>
      <span className="sy-bnum num" title="Studied today / planned length">
        {hmText(todayMin)}
        {b.plannedMin ? <small> / {hmText(b.plannedMin)}</small> : null}
      </span>
      <div className="sy-bacts">
        {live ? (
          <span className="sy-livetag" title="This block is running">● Running</span>
        ) : (
          !b.done && (
            <button className="btn small primary sy-startbtn" onClick={() => void start()} title={run ? `Switch to ${b.name}: the time so far goes to ${run.subject}` : `Start ${b.name} now`} aria-label={run ? `Switch to ${b.name}` : `Start ${b.name}`}>
              {run ? '⇄ Switch' : '▶ Start'}
            </button>
          )
        )}
        <button className="btn small ghost" onClick={() => void done()} title={b.done ? 'Bring it back to your list' : b.repeat ? `Mark done (it comes back ${REPEAT_LABEL[b.repeat]})` : b.taskId ? 'Mark done (also completes it in Todoist)' : 'Mark done'} aria-label={b.done ? `Bring back ${b.name}` : `Mark ${b.name} done`}>
          {b.done ? '↺ Bring back' : '✓ Done'}
        </button>
        <button className="btn small ghost" onClick={onEdit} title="Change the name, subject, length, day, repeat…" aria-label={`Edit ${b.name}`}>
          ✎ Edit
        </button>
      </div>
    </li>
  )
}

function QuickAdd({ store, today, filter }: { store: StudyStore; today: string; filter: StudyFilter }) {
  const act = useAction()
  const [text, setText] = useState('')
  const q = useMemo(() => parseQuickAdd(text, today, store), [text, today, store])
  const add = async () => {
    if (!q.name) return
    // Typed with the Tomorrow filter on and no day: it's for tomorrow.
    const due = q.due ?? (filter.kind === 'tomorrow' ? addDays(today, 1) : null)
    const block = { ...quickAddBlock(q, newBlockId(Date.now()), store), due, ...(filter.kind === 'category' && !q.category ? { category: filter.name } : {}) }
    if (await act(() => life.study!.change({ op: 'save', block }), `Added: ${q.name}`)) setText('')
  }
  return (
    <section className="sy-card sy-quickadd" aria-label="Quick add">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <span className="sy-plus" aria-hidden="true">
          ＋
        </span>
        <input data-testid="study-quickadd" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a block: Math lab 4 50m #practice tomorrow" aria-label="Add a block" maxLength={200} />
        <button className="btn small primary" type="submit" disabled={!q.name}>
          Add
        </button>
      </form>
      <div className="sy-qparts" aria-live="polite">
        {text.trim() ? (
          <>
            {q.name && <span className="sy-qname">{q.name}</span>}
            {q.parts.map((p, i) => (
              <span key={i} className={`sy-qpart ${p.kind}`}>
                {p.kind === 'day' ? '📅 ' : p.kind === 'length' ? '⏱ ' : p.kind === 'repeat' ? '↻ ' : p.kind === 'category' ? '◆ ' : ''}
                {p.text}
              </span>
            ))}
          </>
        ) : (
          <span className="sy-hint">Length 50m or 1h30 · 3p pomodoros · #tag · @subject · today, tomorrow, mon · daily, weekdays, weekly · * quick</span>
        )}
      </div>
    </section>
  )
}

const DAYS_AHEAD = (today: string) => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i))

function BlockForm({ store, block, today, onDone }: { store: StudyStore; block: StudyBlock | null; today: string; onDone: () => void }) {
  const act = useAction()
  const [name, setName] = useState(block?.name ?? '')
  const [category, setCategory] = useState(block?.category ?? '')
  const known = store.categories.find((c) => c.name.toLowerCase() === category.trim().toLowerCase())
  const [color, setColor] = useState<string | null>(null)
  const [emoji, setEmoji] = useState<string | null>(null)
  const [tags, setTags] = useState(block?.tags.join(', ') ?? '')
  const [planned, setPlanned] = useState(block?.plannedMin ? String(block.plannedMin) : '')
  const [est, setEst] = useState(block?.estPomos ? String(block.estPomos) : '')
  const [quick, setQuick] = useState(block?.quick ?? false)
  const [due, setDue] = useState(block?.due ?? '')
  const [repeat, setRepeat] = useState<Repeat | ''>(block?.repeat ?? '')
  const [taskId, setTaskId] = useState(block?.taskId ?? '')
  const first = useRef<HTMLInputElement>(null)
  const tasks = todoTasks().slice(0, 120)
  useEffect(() => {
    first.current?.focus()
  }, [])
  const save = async () => {
    const t = tasks.find((x) => x.id === taskId)
    const id = block?.id ?? newBlockId(Date.now())
    const ok = await act(async () => {
      const r = await life.study!.change({
        op: 'save',
        block: { id, name, category, tags: tags.split(/[,\s]+/).filter(Boolean), plannedMin: planned ? Number(planned) : null, estPomos: est ? Number(est) : null, quick, due: due || null, repeat: repeat || null, taskId: taskId || null, taskTitle: t?.content ?? (taskId ? block?.taskTitle ?? null : null) }
      })
      // The subject's colour and emoji (used in the ring, the bars and the island).
      if (category.trim() && (color || emoji !== null)) return life.study!.change({ op: 'color', category: category.trim(), color: color ?? known?.color ?? categoryColor(r, category), ...(emoji !== null ? { emoji } : {}) })
      return r
    }, block ? 'Block saved' : 'Block added')
    if (ok) onDone()
  }
  const curColor = color ?? known?.color ?? (category ? categoryColor(store, category) : PALETTE[0])
  return (
    <form
      className="sy-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="sy-form-grid">
        <label className="wide">
          <span>Name</span>
          <input ref={first} placeholder="e.g. Chemistry: chapter 4" value={name} onChange={(e) => setName(e.target.value)} aria-label="Block name" maxLength={60} />
        </label>
        <label>
          <span>Subject</span>
          <input list="sy-cats" placeholder="Math" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Subject" maxLength={40} />
          <datalist id="sy-cats">
            {store.categories.map((c) => (
              <option key={c.name} value={c.name} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Emoji</span>
          <input className="sy-emoji-in" placeholder="📐" value={emoji ?? known?.emoji ?? ''} onChange={(e) => setEmoji(e.target.value)} aria-label="Subject emoji" maxLength={8} />
        </label>
        <div className="sy-colors wide" role="radiogroup" aria-label="Subject colour">
          <span>Colour</span>
          {PALETTE.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={curColor === c} className={curColor === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} title="Colour for this subject" />
          ))}
        </div>
        <label>
          <span>Tags</span>
          <input placeholder="exam, reading" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
        </label>
        <label>
          <span>Length (min)</span>
          <input type="number" min={1} max={600} placeholder="empty: open" value={planned} onChange={(e) => setPlanned(e.target.value)} aria-label="Planned minutes" />
        </label>
        <label>
          <span>Pomodoros 🍅</span>
          <input type="number" min={0} max={20} placeholder={planned ? String(Math.max(1, Math.round(Number(planned) / prefsOf(store).work))) : '—'} value={est} onChange={(e) => setEst(e.target.value)} aria-label="Estimated pomodoros" />
        </label>
        <label>
          <span>Due</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" list="sy-days" />
          <datalist id="sy-days">
            {DAYS_AHEAD(today).map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </datalist>
        </label>
        <label>
          <span>Repeat</span>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat | '')} aria-label="Repeat">
            <option value="">Never</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Weekdays</option>
            <option value="weekly">Every week</option>
          </select>
        </label>
        {tasks.length > 0 && (
          <label className="wide">
            <span>Todoist task</span>
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Todoist task">
              <option value="">None</option>
              {block?.taskId && !tasks.some((t) => t.id === block.taskId) && <option value={block.taskId}>{block.taskTitle ?? 'Linked task'}</option>}
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.content.slice(0, 70)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="sy-check wide">
          <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> Quick: on top of the island's list
        </label>
      </div>
      <div className="sy-row">
        <button className="btn small primary" type="submit">
          Save
        </button>
        <button className="btn small ghost" type="button" onClick={onDone}>
          Cancel
        </button>
        {block && (
          <button
            className="btn small ghost sy-del"
            type="button"
            onClick={() =>
              void act(() => life.study!.change({ op: 'remove', id: block.id }), 'Block removed (its sessions stay)').then((r) => {
                if (r) onDone()
              })
            }
          >
            Remove
          </button>
        )}
      </div>
    </form>
  )
}

/** Which Todoist tasks are study: pick projects and labels; they come in as blocks. */
function TodoistPicker({ store, onClose }: { store: StudyStore; onClose: () => void }) {
  const act = useAction()
  const [tasks, setTasks] = useState<TodoTask[]>(todoTasks())
  const [busy, setBusy] = useState(false)
  const rule = prefsOf(store).todoist
  useEffect(() => {
    if (tasks.length) return
    void life.todoist?.everything?.().then((r) => setTasks(r.tasks)).catch(() => {})
  }, [tasks.length])
  const choices = todoistChoices(tasks)
  const toggle = (kind: 'projects' | 'labels', name: string) => {
    const cur = rule[kind]
    const next = cur.some((x) => x.toLowerCase() === name.toLowerCase()) ? cur.filter((x) => x.toLowerCase() !== name.toLowerCase()) : [...cur, name]
    void act(async () => {
      const s = await life.study!.change({ op: 'prefs', prefs: { todoist: { ...rule, [kind]: next } } })
      return pullTodoist(s)
    })
  }
  const on = (kind: 'projects' | 'labels', name: string) => rule[kind].some((x) => x.toLowerCase() === name.toLowerCase())
  return (
    <div className="sy-todo" role="region" aria-label="Todoist study tasks">
      <header className="sy-head">
        <h2>Your study tasks from Todoist</h2>
        <button className="sy-icon" onClick={onClose} aria-label="Close" title="Close">
          ✕
        </button>
      </header>
      {!life.todoist ? (
        <p className="sy-hint">Connect Todoist on the Tasks page first.</p>
      ) : !tasks.length ? (
        <p className="sy-hint">Reading your Todoist…</p>
      ) : (
        <>
          <p className="sy-hint">Tasks in these projects, or with these labels, show as blocks. Done here completes them in Todoist.</p>
          <div className="sy-chips">
            <span className="sy-flabel">Projects</span>
            {choices.projects.map((p) => (
              <button key={p} className={`sy-fchip ${on('projects', p) ? 'on' : ''}`} aria-pressed={on('projects', p)} onClick={() => toggle('projects', p)}>
                {on('projects', p) ? '✓ ' : ''}
                {p}
              </button>
            ))}
          </div>
          {choices.labels.length > 0 && (
            <div className="sy-chips">
              <span className="sy-flabel">Labels</span>
              {choices.labels.map((l) => (
                <button key={l} className={`sy-fchip ${on('labels', l) ? 'on' : ''}`} aria-pressed={on('labels', l)} onClick={() => toggle('labels', l)}>
                  {on('labels', l) ? '✓ ' : ''}@{l}
                </button>
              ))}
            </div>
          )}
          <div className="sy-row">
            <button
              className="btn small"
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void act(() => pullTodoist(store), (r) => (r ? 'Pulled from Todoist' : 'Pick a project or label first')).finally(() => setBusy(false))
              }}
            >
              ↻ Pull now
            </button>
            <span className="sy-hint">{store.blocks.filter((b) => b.fromTodoist && !b.done).length} open from Todoist</span>
          </div>
        </>
      )}
    </div>
  )
}
