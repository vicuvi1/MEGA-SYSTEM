// Study Time: a time tracker in the style of Focus To-Do. Blocks (a subject,
// task or topic) with a category, tags and an optional planned length; one
// tap starts one on the ONE focus timer (the island shows it too); breaks
// never count; stats show where the time goes. Rules: src/core/studyTime.ts;
// the database side: src/main/studyTime.ts.
import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, dayKey, dayLabel } from '@core/dates'
import {
  categoryColor,
  clockText,
  filterBlocks,
  filterCounts,
  hmText,
  isForgotten,
  minutesByBlock,
  newBlockId,
  rangeOf,
  runNow,
  studyStats,
  totalsByGroup,
  type GroupBy,
  type RangeKind,
  type StudyBlock,
  type StudyFilter,
  type StudySession,
  type StudyStore
} from '@core/studyTime'
import { life } from '../bridge'
import { PageTabs, TabPanel, usePageTab } from '../PageTabs'
import { Donut } from '../Donut'
import { useAction } from '../ui'
import { soundSuccess, soundTick } from '../soundKit'
import { useStudy, useTick, type Running } from '../study/studyData'
import '../study/study.css'

const BREAKS = [5, 10, 15]
const blockOf = (store: StudyStore, run: Running | null) => (run?.blockId ? store.blocks.find((b) => b.id === run.blockId) ?? null : null)

export function StudyTime() {
  const { store, sessions, run, ready } = useStudy()
  const [tab, setTab] = usePageTab('study', ['timer', 'stats', 'log'], 'timer')
  const today = dayKey(new Date())
  const todayMin = sessions.filter((s) => s.day === today).reduce((t, s) => t + s.minutes, 0)
  return (
    <div className="sy">
      <header className="sy-top">
        <div className="sy-today" aria-label="Studied today">
          <b className="num" data-testid="study-today">{hmText(todayMin)}</b>
          <small>studied today</small>
        </div>
        <p className="sy-hint">Breaks are kept apart and never count as study.</p>
      </header>
      <PageTabs
        page="study"
        label="Study Time views"
        tabs={[
          { id: 'timer', label: 'Timer', title: 'The timer and your blocks (1)' },
          { id: 'stats', label: 'Stats', title: 'Where your time goes (2)' },
          { id: 'log', label: 'Sessions', title: 'Add or fix a session (3)', count: sessions.filter((s) => s.day >= addDays(today, -6)).length || null }
        ]}
        value={tab}
        onChange={setTab}
      />
      <TabPanel page="study" id="timer" value={tab}>
        {ready && <TimerTab store={store} sessions={sessions} run={run} today={today} />}
      </TabPanel>
      <TabPanel page="study" id="stats" value={tab}>
        {ready && <StatsTab store={store} sessions={sessions} today={today} />}
      </TabPanel>
      <TabPanel page="study" id="log" value={tab}>
        {ready && <LogTab store={store} sessions={sessions} today={today} />}
      </TabPanel>
    </div>
  )
}

// ---------------------------------------------------------------- the timer and blocks

function TimerTab({ store, sessions, run, today }: { store: StudyStore; sessions: StudySession[]; run: Running | null; today: string }) {
  const act = useAction()
  const [filter, setFilter] = useState<StudyFilter>({ kind: 'today' })
  const [editing, setEditing] = useState<StudyBlock | 'new' | null>(null)
  const shown = filterBlocks(store.blocks, filter, today)
  const counts = filterCounts(store.blocks, today)
  const todayBy = minutesByBlock(sessions, today, today)
  const totals = totalsByGroup(sessions, store)
  const tags = [...new Set(store.blocks.flatMap((b) => b.tags))].sort()
  const cats = [...new Set(store.blocks.map((b) => b.category).filter(Boolean))].sort()
  const start = async (b: StudyBlock) => {
    if (await act(() => life.study!.start(b), `Started: ${b.name}`)) soundSuccess()
  }
  const isOn = (f: StudyFilter) => JSON.stringify(f) === JSON.stringify(filter)
  const fixed: [StudyFilter['kind'], string][] = [
    ['today', 'Today'],
    ['tomorrow', 'Tomorrow'],
    ['week', 'This week'],
    ['all', 'All'],
    ['done', 'Completed']
  ]
  return (
    <div className="sy-grid">
      <div className="sy-col">
        <TimerCard store={store} run={run} />
        <section className="sy-card sy-quick" aria-label="Quick blocks">
          <header className="sy-head">
            <h2>Quick start</h2>
            <span className="sy-hint">one tap starts the timer</span>
          </header>
          <div className="sy-chips">
            {store.blocks
              .filter((b) => b.quick && !b.done)
              .map((b) => (
                <button key={b.id} className="sy-chip" disabled={!!run} onClick={() => void start(b)} style={{ ['--c' as string]: categoryColor(store, b.category) }} title={run ? 'Stop the timer first' : `Start ${b.name}`}>
                  <i />
                  {b.name}
                  {b.plannedMin ? <small>{b.plannedMin}m</small> : <small>open</small>}
                </button>
              ))}
            {!store.blocks.some((b) => b.quick && !b.done) && <span className="sy-hint">Mark a block as quick to see it here and on the island.</span>}
          </div>
        </section>
      </div>
      <section className="sy-card sy-blocks" aria-label="Blocks">
        <nav className="sy-filters" aria-label="Filters">
          {fixed.map(([k, label]) => (
            <button key={k} className={isOn({ kind: k } as StudyFilter) ? 'on' : ''} onClick={() => setFilter({ kind: k } as StudyFilter)}>
              {label} <small>{counts[k as keyof typeof counts]}</small>
            </button>
          ))}
          {cats.length > 0 && <span className="sy-fsep">Categories</span>}
          {cats.map((c) => (
            <button key={c} className={isOn({ kind: 'category', name: c }) ? 'on' : ''} onClick={() => setFilter({ kind: 'category', name: c })} style={{ ['--c' as string]: categoryColor(store, c) }}>
              <i className="dot" />
              {c} <small>{hmText(totals.category.get(c.toLowerCase()) ?? 0)}</small>
            </button>
          ))}
          {tags.length > 0 && <span className="sy-fsep">Tags</span>}
          {tags.map((t) => (
            <button key={t} className={isOn({ kind: 'tag', tag: t }) ? 'on' : ''} onClick={() => setFilter({ kind: 'tag', tag: t })}>
              #{t} <small>{hmText(totals.tag.get(t) ?? 0)}</small>
            </button>
          ))}
        </nav>
        <div className="sy-list">
          <header className="sy-head">
            <h2>Blocks</h2>
            <button className="btn small primary" onClick={() => setEditing('new')}>
              + New block
            </button>
          </header>
          {editing && <BlockForm store={store} block={editing === 'new' ? null : editing} today={today} onDone={() => setEditing(null)} />}
          <ul>
            {shown.map((b) => (
              <li key={b.id} className={`sy-block ${b.done ? 'done' : ''} ${run?.blockId === b.id ? 'live' : ''}`} style={{ ['--c' as string]: categoryColor(store, b.category) }}>
                <button className="sy-play" aria-label={`Start ${b.name}`} disabled={!!run || b.done} onClick={() => void start(b)}>
                  ▶
                </button>
                <div className="sy-bmain">
                  <b>{b.name}</b>
                  <small>
                    {b.category || 'No category'}
                    {b.tags.map((t) => ` #${t}`).join('')}
                    {b.due ? ` · ${b.due === today ? 'today' : dayLabel(b.due)}` : ''}
                    {b.taskTitle ? ` · task: ${b.taskTitle}` : ''}
                  </small>
                </div>
                <span className="sy-bnum num" title="Today / planned">
                  {hmText(todayBy.get(b.id) ?? 0)}
                  {b.plannedMin ? <small> / {b.plannedMin}m</small> : null}
                </span>
                <button className="sy-icon" aria-label={b.done ? `Bring back ${b.name}` : `Mark ${b.name} done`} title={b.done ? 'Bring back' : 'Done'} onClick={() => void act(() => life.study!.change({ op: 'done', id: b.id, done: !b.done }))}>
                  {b.done ? '↺' : '✓'}
                </button>
                <button className="sy-icon" aria-label={`Edit ${b.name}`} title="Edit" onClick={() => setEditing(b)}>
                  ✎
                </button>
              </li>
            ))}
            {!shown.length && <li className="sy-hint sy-empty">Nothing here. Add a block or pick another filter.</li>}
          </ul>
        </div>
      </section>
    </div>
  )
}

function TimerCard({ store, run }: { store: StudyStore; run: Running | null }) {
  const act = useAction()
  const now = useTick(!!run)
  const [endAt, setEndAt] = useState('')
  const block = blockOf(store, run)
  if (!run)
    return (
      <section className="sy-card sy-timer idle" aria-label="Timer">
        <div className="sy-clock num" data-testid="study-clock">
          0:00
        </div>
        <p className="sy-hint">Pick a block to start. One timer runs at a time, on this PC, the island and your other devices.</p>
      </section>
    )
  const n = runNow(run, now)
  const forgotten = isForgotten(run, now, (d) => dayKey(d))
  const color = categoryColor(store, block?.category ?? '')
  const planned = run.open ? null : run.planned
  const pct = planned ? Math.min(100, (n.workedMs / (planned * 60_000)) * 100) : null
  const over = planned != null && n.workedMs > planned * 60_000
  const startedAt = new Date(run.startedAt)
  const stop = async () => {
    if (await act(() => life.study!.stop(), (r) => `Logged ${r.session.minutes} min${r.coins ? ` · +${r.coins} points` : ''}`)) soundSuccess()
  }
  return (
    <section className={`sy-card sy-timer ${n.onBreak ? 'on-break' : ''} ${over ? 'over' : ''}`} aria-label="Timer" style={{ ['--c' as string]: color }}>
      <div className="sy-tname">
        <i />
        <b>{run.subject}</b>
        {block?.category && <small>{block.category}</small>}
      </div>
      <div className="sy-clock num" data-testid="study-clock" aria-live="off">
        {clockText(n.workedMs)}
      </div>
      {n.onBreak ? (
        <p className="sy-brk" data-testid="study-break">
          On a break · {clockText(n.breakEndsAt ? Math.max(0, n.breakEndsAt - now) : now - Date.parse(run.pausedAt!))}
          {n.breakEndsAt ? ' left' : ''}
        </p>
      ) : (
        <p className="sy-hint">
          {planned ? `${over ? 'Over the plan of' : 'Plan'} ${hmText(planned)}` : 'Open stopwatch (up to 4 h)'} · since {startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {n.breakMs >= 60_000 ? ` · breaks ${hmText(n.breakMs / 60_000)}` : ''}
        </p>
      )}
      {pct != null && (
        <div className="sy-bar" aria-hidden="true">
          <i style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
      )}
      {forgotten ? (
        <div className="sy-forgot" role="alert">
          <b>Still running since {startedAt.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}?</b>
          <small>Say when you really stopped. A timer put right is saved without points.</small>
          <div className="sy-row">
            <input type="datetime-local" aria-label="When you stopped" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            <button className="btn small primary" disabled={!endAt} onClick={() => void act(() => life.study!.stopAt(new Date(endAt).toISOString()), (r) => `Saved ${r.session.minutes} min`)}>
              Save
            </button>
            <button className="btn small ghost" onClick={() => void act(() => life.focus.cancel(), 'Timer dropped')}>
              Drop it
            </button>
          </div>
        </div>
      ) : (
        <div className="sy-actions">
          {n.onBreak ? (
            <button className="btn primary" onClick={() => void act(() => life.study!.breakEnd(), 'Back to work')}>
              Back to work
            </button>
          ) : (
            BREAKS.map((m) => (
              <button key={m} className="btn" onClick={() => void act(() => life.study!.breakStart(m), `${m} min break`).then(() => soundTick())}>
                Break {m}m
              </button>
            ))
          )}
          <button className="btn sy-stop" onClick={() => void stop()}>
            Stop
          </button>
        </div>
      )}
    </section>
  )
}

function BlockForm({ store, block, today, onDone }: { store: StudyStore; block: StudyBlock | null; today: string; onDone: () => void }) {
  const act = useAction()
  const [name, setName] = useState(block?.name ?? '')
  const [category, setCategory] = useState(block?.category ?? '')
  const [tags, setTags] = useState(block?.tags.join(', ') ?? '')
  const [planned, setPlanned] = useState(block?.plannedMin ? String(block.plannedMin) : '')
  const [quick, setQuick] = useState(block?.quick ?? true)
  const [due, setDue] = useState(block?.due ?? '')
  const [taskId, setTaskId] = useState(block?.taskId ?? '')
  const [tasks, setTasks] = useState<{ id: string; content: string }[]>([])
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => {
    first.current?.focus()
    // Link a block to a Todoist task (optional; the task stays in Todoist).
    life.todoist?.everything?.()
      .then((r) => setTasks(r.tasks.filter((t: any) => !t.checked && !t.done).slice(0, 80).map((t) => ({ id: t.id, content: t.content }))))
      .catch(() => {})
  }, [])
  const save = async () => {
    const t = tasks.find((x) => x.id === taskId)
    const id = block?.id ?? newBlockId(Date.now())
    const ok = await act(
      () =>
        life.study!.change({
          op: 'save',
          block: { id, name, category, tags: tags.split(/[,\s]+/).filter(Boolean), plannedMin: planned ? Number(planned) : null, quick, due: due || null, taskId: taskId || null, taskTitle: t?.content ?? (taskId ? block?.taskTitle ?? null : null) }
        }),
      block ? 'Block saved' : 'Block added'
    )
    if (ok) onDone()
  }
  return (
    <form
      className="sy-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <input ref={first} placeholder="Name, e.g. Chemistry: chapter 4" value={name} onChange={(e) => setName(e.target.value)} aria-label="Block name" maxLength={60} />
      <input list="sy-cats" placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" maxLength={40} />
      <datalist id="sy-cats">
        {store.categories.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
      <input placeholder="Tags: exam, reading" value={tags} onChange={(e) => setTags(e.target.value)} aria-label="Tags" />
      <input type="number" min={1} max={240} placeholder="Planned min (empty: open)" value={planned} onChange={(e) => setPlanned(e.target.value)} aria-label="Planned minutes" />
      <select value={due} onChange={(e) => setDue(e.target.value)} aria-label="Day">
        <option value="">Any day</option>
        <option value={today}>Today</option>
        <option value={addDays(today, 1)}>Tomorrow</option>
        {due && due !== today && due !== addDays(today, 1) && <option value={due}>{dayLabel(due)}</option>}
      </select>
      {tasks.length > 0 && (
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Todoist task">
          <option value="">No Todoist task</option>
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.content.slice(0, 60)}
            </option>
          ))}
        </select>
      )}
      <label className="sy-check">
        <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} /> Quick (island)
      </label>
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

// ---------------------------------------------------------------- stats

const RANGES: [RangeKind, string][] = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['custom', 'Custom']
]
const GROUPS: [GroupBy, string][] = [
  ['category', 'Category'],
  ['tag', 'Tag'],
  ['block', 'Block']
]

function StatsTab({ store, sessions, today }: { store: StudyStore; sessions: StudySession[]; today: string }) {
  const [kind, setKind] = useState<RangeKind>('week')
  const [by, setBy] = useState<GroupBy>('category')
  const [from, setFrom] = useState(addDays(today, -13))
  const [to, setTo] = useState(today)
  const [picked, setPicked] = useState<string | null>(null)
  const st = useMemo(() => studyStats(sessions, store, rangeOf(kind, today, { from, to }), by, today), [sessions, store, kind, by, from, to, today])
  const change = st.beforeMin ? Math.round(((st.totalMin - st.beforeMin) / st.beforeMin) * 100) : null
  const maxDay = Math.max(1, ...st.byDay.map((d) => d.minutes))
  const pick = st.slices.find((s) => s.key === picked) ?? null
  return (
    <div className="sy-stats">
      <div className="sy-statbar">
        <div className="sy-seg" role="group" aria-label="Range">
          {RANGES.map(([k, l]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        {kind === 'custom' && (
          <span className="sy-row">
            <input type="date" aria-label="From" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" aria-label="To" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </span>
        )}
        <span className="sy-hint">{st.range.from === st.range.to ? dayLabel(st.range.from) : `${dayLabel(st.range.from, false)} – ${dayLabel(st.range.to, false)}`}</span>
      </div>
      <div className="sy-sgrid">
        <section className="sy-card sy-where" aria-label="Where your time goes">
          <header className="sy-head">
            <h2>Where your time goes</h2>
            <div className="sy-seg small" role="group" aria-label="Group by">
              {GROUPS.map(([k, l]) => (
                <button
                  key={k}
                  className={by === k ? 'on' : ''}
                  onClick={() => {
                    setBy(k)
                    setPicked(null)
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </header>
          <div className="sy-where-body">
            <Donut parts={st.slices.map((s) => ({ key: s.key, value: s.minutes, color: s.color, label: `${s.label} · ${hmText(s.minutes)}` }))} total={by === 'tag' ? st.slices.reduce((t, s) => t + s.minutes, 0) : st.totalMin} picked={picked} onPick={(k) => setPicked((p) => (p === k ? null : k))}>
              <b className="num" data-testid="study-donut-total">
                {hmText(pick ? pick.minutes : st.totalMin)}
              </b>
              <small>{pick ? pick.label : 'studied'}</small>
              {!pick && change !== null && <em className={change < 0 ? 'up' : 'down'}>{change > 0 ? `▲ ${change}%` : change < 0 ? `▼ ${Math.abs(change)}%` : 'same as before'}</em>}
            </Donut>
            <ul className="sy-legend">
              {st.slices.map((s) => (
                <li key={s.key} className={picked === s.key ? 'on' : ''}>
                  <button onClick={() => setPicked((p) => (p === s.key ? null : s.key))}>
                    <i style={{ background: s.color }} />
                    <span>{s.label}</span>
                    <b className="num">{hmText(s.minutes)}</b>
                    <small>{st.totalMin ? Math.round((s.minutes / st.totalMin) * 100) : 0}%</small>
                  </button>
                </li>
              ))}
              {!st.slices.length && <li className="sy-hint">Nothing studied in this range yet.</li>}
            </ul>
          </div>
          {by === 'tag' && st.slices.length > 0 && <p className="sy-hint">A session with two tags counts under both.</p>}
        </section>
        <section className="sy-card sy-kpis" aria-label="Totals">
          <Kpi label="Studied" value={hmText(st.totalMin)} sub={change === null ? 'nothing before to compare' : `${change >= 0 ? '+' : ''}${change}% vs before`} />
          <Kpi label="Sessions" value={String(st.sessions)} sub={`average ${hmText(st.avgSessionMin)}`} />
          <Kpi label="Breaks" value={hmText(st.breakMin)} sub="kept apart" />
          <Kpi label="Streak" value={`${st.streak} d`} sub={`best ${st.bestStreak} d`} />
          <Kpi label="Against plan" value={st.plan.pct === null ? '—' : `${st.plan.pct}%`} sub={st.plan.plannedMin ? `${hmText(st.plan.actualMin)} of ${hmText(st.plan.plannedMin)}` : 'no planned blocks'} />
          <Kpi label="Best day" value={st.bestDay ? hmText(st.bestDay.minutes) : '—'} sub={st.bestDay ? dayLabel(st.bestDay.day) : ''} />
        </section>
        <section className="sy-card sy-days" aria-label="Per day">
          <header className="sy-head">
            <h2>Per day</h2>
          </header>
          <div className={`sy-bars ${st.byDay.length > 31 ? 'dense' : ''}`}>
            {st.byDay.map((d) => (
              <div key={d.day} className={`sy-barc ${d.day === today ? 'today' : ''}`} title={`${dayLabel(d.day)} · ${hmText(d.minutes)}`}>
                <i style={{ transform: `scaleY(${d.minutes / maxDay})` }} />
                {st.byDay.length <= 14 && <small>{st.byDay.length <= 7 ? dayLabel(d.day).slice(0, 3) : d.day.slice(8)}</small>}
              </div>
            ))}
          </div>
        </section>
        <section className="sy-card sy-top" aria-label="Top blocks">
          <header className="sy-head">
            <h2>Top blocks</h2>
          </header>
          <ol>
            {st.topBlocks.map((b) => (
              <li key={b.key}>
                <span>{b.label}</span>
                <small>{b.sessions}×</small>
                <b className="num">{hmText(b.minutes)}</b>
              </li>
            ))}
            {!st.topBlocks.length && <li className="sy-hint">No sessions yet.</li>}
          </ol>
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="sy-kpi">
      <small>{label}</small>
      <b className="num">{value}</b>
      <em>{sub}</em>
    </div>
  )
}

// ---------------------------------------------------------------- sessions: add and fix

function LogTab({ store, sessions, today }: { store: StudyStore; sessions: StudySession[]; today: string }) {
  const act = useAction()
  const recent = sessions.filter((s) => s.day >= addDays(today, -14))
  const [edit, setEdit] = useState<StudySession | null>(null)
  const [blockId, setBlockId] = useState(store.blocks[0]?.id ?? '')
  const [minutes, setMinutes] = useState('')
  const [brk, setBrk] = useState('')
  const [day, setDay] = useState(today)
  const named = (id: string | null, subject: string) => store.blocks.find((b) => b.id === id)?.name ?? subject
  const add = async () => {
    const b = store.blocks.find((x) => x.id === blockId)
    if (!b) return
    const ok = await act(() => life.study!.add({ subject: b.name, blockId: b.id, minutes: Number(minutes), breakMin: Number(brk) || 0, day }), 'Session added (typed sessions pay no points)')
    if (ok) setMinutes('')
  }
  return (
    <div className="sy-log">
      <section className="sy-card" aria-label="Add a session">
        <header className="sy-head">
          <h2>Add a session you did</h2>
          <span className="sy-hint">counts in the stats, pays no points</span>
        </header>
        <form
          className="sy-row sy-addrow"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <select value={blockId} onChange={(e) => setBlockId(e.target.value)} aria-label="Block">
            {store.blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input type="number" min={1} max={600} placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" />
          <input type="number" min={0} max={300} placeholder="Break min" value={brk} onChange={(e) => setBrk(e.target.value)} aria-label="Break minutes" />
          <input type="date" value={day} max={today} min={addDays(today, -14)} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
          <button className="btn small primary" type="submit" disabled={!minutes || !blockId}>
            Add
          </button>
        </form>
      </section>
      <section className="sy-card" aria-label="Last 14 days">
        <header className="sy-head">
          <h2>Last 14 days</h2>
          <span className="sy-hint">{recent.length} sessions</span>
        </header>
        <ul className="sy-sessions">
          {recent.slice(0, 40).map((s) =>
            edit?.id === s.id ? (
              <SessionEdit key={s.id} store={store} s={s} today={today} onDone={() => setEdit(null)} />
            ) : (
              <li key={s.id}>
                <span className="sy-sday">{s.day === today ? 'Today' : dayLabel(s.day)}</span>
                <b>{named(s.blockId, s.subject)}</b>
                <span className="num">{hmText(s.minutes)}</span>
                <small>{s.breakMin ? `break ${hmText(s.breakMin)}` : ''}</small>
                <small className={`sy-src ${s.source}`}>{s.source === 'timer' ? 'timer' : s.source === 'manual' ? 'typed' : 'put right'}</small>
                <button className="sy-icon" aria-label="Edit session" onClick={() => setEdit(s)}>
                  ✎
                </button>
                <button className="sy-icon" aria-label="Remove session" onClick={() => void act(() => life.study!.remove(s.id), 'Session removed')}>
                  ×
                </button>
              </li>
            )
          )}
          {!recent.length && <li className="sy-hint">No sessions yet. Start a block on the Timer tab.</li>}
        </ul>
      </section>
    </div>
  )
}

function SessionEdit({ store, s, today, onDone }: { store: StudyStore; s: StudySession; today: string; onDone: () => void }) {
  const act = useAction()
  const [blockId, setBlockId] = useState(s.blockId ?? '')
  const [minutes, setMinutes] = useState(String(s.minutes))
  const [brk, setBrk] = useState(String(s.breakMin))
  const [day, setDay] = useState(s.day)
  const save = async () => {
    const b = store.blocks.find((x) => x.id === blockId)
    const ok = await act(() => life.study!.edit(s.id, { blockId: blockId || null, subject: b?.name, minutes: Number(minutes), breakMin: Number(brk) || 0, day }), s.source === 'timer' && Number(minutes) !== s.minutes ? 'Saved · a changed timed session gives its points back' : 'Saved')
    if (ok) onDone()
  }
  return (
    <li className="sy-sedit">
      <select value={blockId} onChange={(e) => setBlockId(e.target.value)} aria-label="Block">
        <option value="">{s.subject}</option>
        {store.blocks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Minutes" />
      <input type="number" min={0} max={300} value={brk} onChange={(e) => setBrk(e.target.value)} aria-label="Break minutes" />
      <input type="date" value={day} max={today} min={addDays(today, -14)} onChange={(e) => setDay(e.target.value)} aria-label="Day" />
      <button className="btn small primary" onClick={() => void save()}>
        Save
      </button>
      <button className="btn small ghost" onClick={onDone}>
        Cancel
      </button>
    </li>
  )
}
