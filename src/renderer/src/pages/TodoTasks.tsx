// Tasks = your Todoist, cleanly split by area (University, Cyber, Job…).
// Each area has its color (yours to pick), tasks sorted late → urgent →
// soonest. Add (the right area is picked for you), complete (points), change
// the priority, date, area or text, delete, focus on a task, drag a task to
// another area. "Clean up" asks the coach for fixes you approve one by one.
// Keys: n new task, / search, e edit, 1–4 priority, x complete (on the task
// under the mouse or keyboard focus). Every change goes straight to Todoist.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AREA_COLORS, defaultAreaColor, plainName, sortTasks, type Area, type TodoTask } from '@core/todoist'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { EmptyState, Skeleton } from '../blocks'
import { soundCoin, soundSuccess } from '../sound'
import { useAction, useToast } from '../ui'
import type { CleanChange } from '@core/todoistClean'
import { useSwipeRows } from '../swipe'
import { useLive } from '../live'

type View = 'areas' | 'today' | 'upcoming' | 'all'

const P_COLOR: Record<number, string> = { 4: '#FF5D6C', 3: '#FF9F43', 2: '#5BA8FF', 1: 'var(--muted)' }
const P_LABEL: Record<number, string> = { 4: 'P1 · urgent', 3: 'P2 · high', 2: 'P3 · medium', 1: 'P4 · none' }
const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dueLabel = (t: TodoTask, today: string) => {
  if (!t.due) return null
  const tm = t.dueTime ? ` ${t.dueTime}` : ''
  if (t.due < today) return { text: `late · ${t.due.slice(8)}.${t.due.slice(5, 7)}`, cls: 'late' }
  if (t.due === today) return { text: `today${tm}`, cls: 'today' }
  if (t.due === addDays(today, 1)) return { text: `tomorrow${tm}`, cls: '' }
  const wd = new Date(`${t.due}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return { text: `${wd}${tm}`, cls: '' }
}
const areaOf = (t: TodoTask) => (t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ''}`)

function useTodoistData() {
  const [data, setData] = useState<{ tasks: TodoTask[]; areas: Area[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    if (!life.todoist?.everything) return setError('Tasks need Todoist on the website.')
    try {
      const connected = (await life.todoist.status()).connected
      if (!connected) return setError('Connect Todoist: add TODOIST_TOKEN in Vercel.')
      setData(await life.todoist.everything())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
    life.todoist.colors?.().then(setColors).catch(() => {})
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  useLive(() => void load(), { external: true })
  return { data, setData, error, load, colors, setColors }
}

export function TodoTasks({ onWallet }: { onWallet: () => void }) {
  const act = useAction()
  const toast = useToast()
  const { data, setData, error, load, colors, setColors } = useTodoistData()
  const [view, setView] = useState<View>('areas')
  const [q, setQ] = useState('')
  const [prio, setPrio] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [addArea, setAddArea] = useState('auto')
  const [menu, setMenu] = useState<{ id: string; kind: 'prio' | 'date' | 'move' } | null>(null)
  const [palette, setPalette] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [hot, setHot] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const today = todayStr()

  const color = useCallback((a: Area | undefined) => (a ? colors[a.key] ?? defaultAreaColor(a) : 'var(--muted)'), [colors])
  const areaByKey = useMemo(() => new Map((data?.areas ?? []).map((a) => [a.key, a])), [data])

  const filtered = useMemo(() => {
    const list = data?.tasks ?? []
    const words = q.trim().toLowerCase()
    return list.filter((t) => (!words || t.content.toLowerCase().includes(words) || (t.description ?? '').toLowerCase().includes(words)) && (prio == null || t.priority === prio))
  }, [data, q, prio])

  // Optimistic change, then Todoist, then a fresh copy (or back on error).
  const change = async (fn: () => Promise<unknown>, local: (tasks: TodoTask[]) => TodoTask[], ok?: string) => {
    const before = data
    if (data) setData({ ...data, tasks: local(data.tasks) })
    const r = await act(async () => {
      await fn()
      return true
    }, ok)
    if (!r && before) setData(before)
    void load()
  }

  const [leaving, setLeaving] = useState<string[]>([])
  const complete = async (t: TodoTask) => {
    if (leaving.includes(t.id)) return
    soundSuccess()
    setLeaving((l) => [...l, t.id])
    await new Promise((done) => setTimeout(done, 320))
    setLeaving((l) => l.filter((x) => x !== t.id))
    setData((d) => (d ? { ...d, tasks: d.tasks.filter((x) => x.id !== t.id) } : d))
    const r = await act(() => life.todoist!.complete(t))
    if (!r) return void load()
    if (r.paid) soundCoin()
    onWallet()
    toast(`Done: ${t.content}${r.paid ? ' · points added' : ''}`, 'good')
  }
  const add = async (areaKey?: string, value = text) => {
    const v = value.trim()
    if (!v) return
    setBusy(true)
    const target = areaKey ?? (addArea === 'auto' ? undefined : addArea)
    const t = await act(() => life.todoist!.quickAdd(v, target))
    setBusy(false)
    if (t) {
      if (!areaKey) setText('')
      toast(`Added${t.area || t.section ? ` to ${plainName(t.area || t.section || '')}` : ''}: ${t.content}`, 'good')
      void load()
    }
  }
  const focus = async (t: TodoTask) => {
    const a = areaByKey.get(areaOf(t))
    const subject = (a && a.name !== 'Inbox' ? plainName(a.name) : '') || t.content.split(/\s+/).slice(0, 3).join(' ')
    if (await act(() => life.focus.start(subject.slice(0, 40), 50, { kind: 'todoist', ref: t.id, title: t.content }), `Focus started: ${t.content}`)) soundSuccess()
  }
  const moveTo = (t: TodoTask, x: Area) =>
    change(() => life.todoist!.move!(t.id, x.key), (ts) => ts.map((y) => (y.id === t.id ? { ...y, sectionId: x.kind === 'section' ? x.id : null, projectId: x.projectId } : y)), `Moved to ${plainName(x.name)}`)
  const setPriority = (t: TodoTask, p: number) => change(() => life.todoist!.update!(t.id, { priority: p }), (ts) => ts.map((x) => (x.id === t.id ? { ...x, priority: p } : x)), `${P_LABEL[p]}`)

  // Shortcuts (not while typing): n, /, and e · 1–4 · x on the task under the pointer.
  // Swipe right on a task to complete it (phone).
  const rootRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<(id: string) => void>(() => {})
  swipeRef.current = (id: string) => {
    const t = data?.tasks.find((x) => x.id === id)
    if (t) void complete(t)
  }
  const onSwipe = useCallback((id: string) => swipeRef.current(id), [])
  useSwipeRows(rootRef, onSwipe)

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null
    if (e.ctrlKey || e.metaKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) return
    if (e.key === 'n') {
      e.preventDefault()
      addRef.current?.focus()
      return
    }
    if (e.key === '/') {
      e.preventDefault()
      searchRef.current?.focus()
      return
    }
    const t = hot ? data?.tasks.find((x) => x.id === hot) : undefined
    if (!t) return
    if (e.key === 'e') {
      e.preventDefault()
      setEditing(t.id)
    } else if (/^[1-4]$/.test(e.key)) {
      e.preventDefault()
      void setPriority(t, 5 - Number(e.key))
    } else if (e.key === 'x') {
      e.preventDefault()
      void complete(t)
    }
  }
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  if (error) return <section className="card"><EmptyState icon="tasks" title="Todoist isn't connected">{error}</EmptyState></section>
  if (!data)
    return (
      <div className="ta">
        <section className="card">
          <Skeleton lines={1} />
        </section>
        <div className="ta-cols">
          {[5, 3, 4].map((n) => (
            <section key={n} className="card">
              <Skeleton lines={n} />
            </section>
          ))}
        </div>
      </div>
    )

  const shownAreas = data.areas.filter((a) => a.kind === 'section' || filtered.some((t) => areaOf(t) === a.key))
  const counts = {
    today: filtered.filter((t) => t.due && t.due <= today).length,
    upcoming: filtered.filter((t) => t.due && t.due > today && t.due <= addDays(today, 7)).length,
    all: filtered.length
  }

  const row = (t: TodoTask, showArea: boolean) => {
    const a = areaByKey.get(areaOf(t))
    const due = dueLabel(t, today)
    const open = menu?.id === t.id ? menu.kind : null
    return (
      <li
        key={t.id}
        className={`ta-task ${t.due && t.due < today ? 'is-late' : ''} ${hot === t.id ? 'hot' : ''} ${leaving.includes(t.id) ? 'leaving' : ''}`}
        data-swipe={t.id}
        style={{ ['--pc' as string]: P_COLOR[t.priority] }}
        tabIndex={0}
        draggable={editing !== t.id}
        onMouseEnter={() => setHot(t.id)}
        onFocus={() => setHot(t.id)}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/x-task', t.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
      >
        <button className="ta-check" style={{ borderColor: P_COLOR[t.priority] }} aria-label={`Complete ${t.content}`} title="Complete (points)" onClick={() => void complete(t)} />
        <div className="ta-body">
          {editing === t.id ? (
            <input
              className="ta-edit"
              autoFocus
              defaultValue={t.content}
              onBlur={(e) => {
                setEditing(null)
                const v = e.target.value.trim()
                if (v && v !== t.content) void change(() => life.todoist!.update!(t.id, { content: v }), (ts) => ts.map((x) => (x.id === t.id ? { ...x, content: v } : x)), 'Saved')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span className="ta-text" onDoubleClick={() => setEditing(t.id)} title="Double-click to edit">
              {t.content}
            </span>
          )}
          <span className="ta-meta">
            {due && <span className={`ta-due ${due.cls}`}>{due.text}</span>}
            {t.recurring && <span title="Repeats">↻</span>}
            {t.deadline && <span className="ta-dl" title="Deadline">⚑ {t.deadline.slice(8)}.{t.deadline.slice(5, 7)}</span>}
            {t.priority > 1 && <span className="ta-flag" style={{ color: P_COLOR[t.priority] }}>⚑ P{5 - t.priority}</span>}
            {showArea && a && (
              <span className="ta-chip" style={{ ['--c' as string]: color(a) }}>
                {plainName(a.name)}
              </span>
            )}
          </span>
        </div>
        <div className="ta-actions">
          <button className="ta-act" title="Focus 50 min on this" aria-label="Focus" onClick={() => void focus(t)}>
            ▶
          </button>
          <button className="ta-act" title="Priority" aria-label="Priority" onClick={() => setMenu(open === 'prio' ? null : { id: t.id, kind: 'prio' })}>
            <span style={{ color: P_COLOR[t.priority] }}>⚑</span>
          </button>
          <button className="ta-act" title="Date" aria-label="Date" onClick={() => setMenu(open === 'date' ? null : { id: t.id, kind: 'date' })}>
            <Icon name="calendar" size={13} />
          </button>
          <button className="ta-act" title="Move to another area" aria-label="Move" onClick={() => setMenu(open === 'move' ? null : { id: t.id, kind: 'move' })}>
            <Icon name="list" size={13} />
          </button>
          <button className="ta-act" title="Edit text" aria-label="Edit" onClick={() => setEditing(t.id)}>
            <Icon name="edit" size={13} />
          </button>
          <DeleteButton onDelete={() => void change(() => life.todoist!.remove!(t.id), (ts) => ts.filter((x) => x.id !== t.id), 'Deleted')} />
        </div>
        {open === 'prio' && (
          <div className="ta-pop">
            {[4, 3, 2, 1].map((p) => (
              <button key={p} className={`ta-pop-item ${t.priority === p ? 'on' : ''}`} onClick={() => { setMenu(null); void setPriority(t, p) }}>
                <span style={{ color: P_COLOR[p] }}>⚑</span> {P_LABEL[p]} <kbd>{5 - p}</kbd>
              </button>
            ))}
          </div>
        )}
        {open === 'date' && (
          <div className="ta-pop">
            {[
              ['Today', 'today'],
              ['Tomorrow', 'tomorrow'],
              ['Next week', 'next monday'],
              ['No date', 'no date']
            ].map(([label, val]) => (
              <button key={val} className="ta-pop-item" onClick={() => { setMenu(null); void change(() => life.todoist!.update!(t.id, { due: val }), (ts) => ts, `Moved to ${label.toLowerCase()}`) }}>
                {label}
              </button>
            ))}
            <form
              className="ta-pop-form"
              onSubmit={(e) => {
                e.preventDefault()
                const v = String(new FormData(e.currentTarget).get('d') || '').trim()
                if (!v) return
                setMenu(null)
                void change(() => life.todoist!.update!(t.id, { due: v }), (ts) => ts, 'Date set')
              }}
            >
              <input name="d" placeholder="friday 18:00, 12 nov…" autoFocus />
            </form>
          </div>
        )}
        {open === 'move' && (
          <div className="ta-pop">
            {data.areas
              .filter((x) => x.key !== areaOf(t))
              .map((x) => (
                <button key={x.key} className="ta-pop-item" onClick={() => { setMenu(null); void moveTo(t, x) }}>
                  <i className="ta-dot" style={{ background: color(x) }} /> {x.name}
                </button>
              ))}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="ta" ref={rootRef} onClick={(e) => { if (!(e.target as HTMLElement).closest('.ta-pop, .ta-act, .ta-swatch, .ta-palette')) { setMenu(null); setPalette(null) } }}>
      <section className="panel ta-top">
        <form
          className="ta-add"
          onSubmit={(e) => {
            e.preventDefault()
            void add()
          }}
        >
          <Icon name="plus" size={16} />
          <input ref={addRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task… e.g. “fix lab 3 friday 18:00 p1”  (n)" maxLength={300} />
          <select value={addArea} onChange={(e) => setAddArea(e.target.value)} aria-label="Area">
            <option value="auto">Area: automatic</option>
            {data.areas.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!text.trim() || busy}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
        <div className="ta-bar">
          <div className="ta-tabs" role="tablist">
            {(
              [
                ['areas', 'By area', data.tasks.length],
                ['today', 'Today', counts.today],
                ['upcoming', 'Next 7 days', counts.upcoming],
                ['all', 'All', counts.all]
              ] as const
            ).map(([v, label, n]) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {label} <small>{n}</small>
              </button>
            ))}
          </div>
          <div className="ta-filters">
            {[4, 3, 2].map((p) => (
              <button key={p} className={`ta-pf ${prio === p ? 'on' : ''}`} style={{ ['--c' as string]: P_COLOR[p] }} onClick={() => setPrio(prio === p ? null : p)}>
                ⚑ P{5 - p}
              </button>
            ))}
            <input ref={searchRef} className="ta-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…  /" />
            <button className="btn small ta-clean" onClick={() => setCleaning(true)} disabled={!data.tasks.length} title="The coach suggests fixes: typos, short titles, areas, priorities, dates, duplicates. You approve each one.">
              <Icon name="spark" size={13} /> Clean up
            </button>
          </div>
        </div>
      </section>

      {!data.tasks.length && (
        <section className="card">
          <EmptyState icon="tasks" title="No open tasks">
            Add one above, or send it to your bot. Tasks go to the right area by themselves.
          </EmptyState>
        </section>
      )}

      {view === 'areas' && (
        <div className="ta-cols">
          {shownAreas.map((a) => {
            const list = sortTasks(filtered.filter((t) => areaOf(t) === a.key), today)
            const c = color(a)
            return (
              <section
                key={a.key}
                className={`ta-col ${dragOver === a.key ? 'drop' : ''}`}
                style={{ ['--c' as string]: c }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('text/x-task')) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOver !== a.key) setDragOver(a.key)
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(null)
                  const t = data.tasks.find((x) => x.id === e.dataTransfer.getData('text/x-task'))
                  if (t && areaOf(t) !== a.key) void moveTo(t, a)
                }}
              >
                <header className="ta-col-head">
                  <button className="ta-swatch" style={{ background: c }} aria-label={`Color of ${a.name}`} title="Change color" onClick={() => setPalette(palette === a.key ? null : a.key)} />
                  {renaming === a.key ? (
                    <input
                      className="ta-rename"
                      autoFocus
                      defaultValue={a.name}
                      onBlur={(e) => {
                        setRenaming(null)
                        const v = e.target.value.trim()
                        if (v && v !== a.name) void act(() => life.todoist!.renameArea!(a.key, v), 'Area renamed').then(() => load())
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                        if (e.key === 'Escape') setRenaming(null)
                      }}
                    />
                  ) : (
                    <h3 onDoubleClick={() => a.name !== 'Inbox' && setRenaming(a.key)} title={a.name !== 'Inbox' ? 'Double-click to rename' : undefined}>
                      {a.name}
                    </h3>
                  )}
                  <span className="ta-count">{list.length}</span>
                  {palette === a.key && (
                    <div className="ta-palette">
                      {AREA_COLORS.map((col) => (
                        <button
                          key={col}
                          className={`ta-color ${c === col ? 'on' : ''}`}
                          style={{ background: col }}
                          aria-label={`Use ${col}`}
                          onClick={async () => {
                            setPalette(null)
                            setColors((cur) => ({ ...cur, [a.key]: col }))
                            const next = await life.todoist?.setColor?.(a.key, col).catch(() => null)
                            if (next) setColors(next)
                          }}
                        />
                      ))}
                    </div>
                  )}
                </header>
                <ul className="ta-list">{list.length ? list.map((t) => row(t, false)) : <li className="ta-empty">Nothing here. Nice.</li>}</ul>
                <AreaAdd onAdd={(v) => add(a.key, v)} name={plainName(a.name)} />
              </section>
            )
          })}
          <NewArea onCreate={async (name) => { if (await act(() => life.todoist!.addArea!(name), 'Area added')) void load() }} />
        </div>
      )}

      {view !== 'areas' && (
        <section className="panel">
          {(() => {
            const inView = filtered.filter((t) => (view === 'today' ? t.due && t.due <= today : view === 'upcoming' ? t.due && t.due > today && t.due <= addDays(today, 7) : true))
            if (!inView.length) return <p className="hint">{view === 'today' ? 'Nothing due today. Pick something from an area, or rest.' : 'Nothing here.'}</p>
            if (view === 'upcoming') {
              const days = [...new Set(inView.map((t) => t.due!))].sort()
              return days.map((d) => (
                <div key={d} className="ta-group">
                  <h3 className="ta-group-head">{new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
                  <ul className="ta-list">{sortTasks(inView.filter((t) => t.due === d), today).map((t) => row(t, true))}</ul>
                </div>
              ))
            }
            return <ul className="ta-list">{sortTasks(inView, today).map((t) => row(t, true))}</ul>
          })()}
        </section>
      )}
      <p className="hint small ta-keys">
        <kbd>n</kbd> new · <kbd>/</kbd> search · on a task: <kbd>e</kbd> edit · <kbd>1</kbd>–<kbd>4</kbd> priority · <kbd>x</kbd> done · drag it to another area
      </p>
      {cleaning && <CleanupSheet tasks={data.tasks} areas={data.areas} color={color} today={today} onClose={() => setCleaning(false)} onDone={() => { setCleaning(false); void load() }} />}
    </div>
  )
}

/** The coach's suggested fixes; you tick which ones to apply. */
function CleanupSheet({ tasks, areas, color, today, onClose, onDone }: { tasks: TodoTask[]; areas: Area[]; color: (a: Area | undefined) => string; today: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [res, setRes] = useState<{ changes: CleanChange[]; ai: boolean; error?: string } | null>(null)
  const [off, setOff] = useState<string[]>([])
  const [applying, setApplying] = useState<number | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    life.todoist!.cleanup!(today).then(setRes).catch((e) => setFailed((e as Error).message))
  }, [today])
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && applying === null && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [applying, onClose])
  const areaBy = new Map(areas.map((a) => [a.key, a]))
  const chosen = (res?.changes ?? []).filter((c) => !off.includes(c.id))
  const apply = async () => {
    let n = 0
    let bad = 0
    for (const c of chosen) {
      setApplying(++n)
      try {
        if (c.remove) await life.todoist!.remove!(c.id)
        else {
          const patch: { content?: string; description?: string; priority?: number; due?: string } = {}
          if (c.title) patch.content = c.title
          if (c.details) patch.description = c.details
          if (c.priority) patch.priority = c.priority
          if (c.due) patch.due = c.due
          if (Object.keys(patch).length) await life.todoist!.update!(c.id, patch)
          if (c.area) await life.todoist!.move!(c.id, c.area)
        }
      } catch {
        bad++
      }
    }
    soundSuccess()
    toast(bad ? `${chosen.length - bad} fixed, ${bad} failed` : `${chosen.length} task${chosen.length === 1 ? '' : 's'} cleaned up`, bad ? 'bad' : 'good')
    onDone()
  }
  return (
    <div className="sheet" role="dialog" aria-label="Clean up my Todoist" onClick={(e) => e.target === e.currentTarget && applying === null && onClose()}>
      <div className="sheet-card cu">
        <header className="card-head">
          <h2>
            <Icon name="spark" size={16} /> Clean up my Todoist
          </h2>
          <button className="btn small ghost" onClick={onClose} disabled={applying !== null}>
            Close
          </button>
        </header>
        {failed && <p className="hint">Couldn't get suggestions: {failed}</p>}
        {!res && !failed && (
          <div className="cu-loading">
            <span className="co-typing">
              <i />
              <i />
              <i />
            </span>
            <p className="hint">Reading your {tasks.length} tasks…</p>
          </div>
        )}
        {res && (
          <>
            <p className="hint">
              {res.changes.length
                ? `${res.changes.length} suggestion${res.changes.length === 1 ? '' : 's'}${res.ai ? '' : ' (without AI: exact duplicates and long-overdue tasks)'}. Untick what you don't want.`
                : 'Your Todoist looks clean. Nothing to fix.'}
            </p>
            <ul className="cu-list">
              {res.changes.map((c) => {
                const on = !off.includes(c.id)
                const a = c.area ? areaBy.get(c.area) : undefined
                return (
                  <li key={c.id} className={`${on ? '' : 'off'} ${c.remove ? 'remove' : ''}`}>
                    <label>
                      <input type="checkbox" checked={on} onChange={() => setOff((cur) => (on ? [...cur, c.id] : cur.filter((x) => x !== c.id)))} />
                      <span className="cu-main">
                        {c.remove ? (
                          <span className="cu-title">
                            <s>{c.before}</s>
                          </span>
                        ) : c.title ? (
                          <span className="cu-title">
                            <s>{c.before}</s> → <b>{c.title}</b>
                          </span>
                        ) : (
                          <span className="cu-title">{c.before}</span>
                        )}
                        {c.details && <span className="cu-details">{c.details}</span>}
                        <span className="chips">
                          {c.remove === 'duplicate' && <span className="chip bad">Delete: same as “{c.duplicateOf}”</span>}
                          {c.remove === 'stale' && <span className="chip bad">Delete: stale</span>}
                          {a && <span className="chip" title="Move to"><i className="dot" style={{ ['--c' as string]: color(a) }} />→ {plainName(a.name) || a.name}</span>}
                          {c.priority && <span className="chip" style={{ color: P_COLOR[c.priority] }}>⚑ {P_LABEL[c.priority]}</span>}
                          {c.due && <span className="chip">📅 {c.due}</span>}
                          <span className="cu-why">{c.why}</span>
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="sheet-actions">
              {res.changes.length > 0 && (
                <button className="btn small ghost" onClick={() => setOff(off.length ? [] : res.changes.map((c) => c.id))} disabled={applying !== null}>
                  {off.length ? 'Select all' : 'Select none'}
                </button>
              )}
              <button className="btn primary" disabled={!chosen.length || applying !== null} onClick={() => void apply()}>
                {applying !== null ? `Applying ${applying}/${chosen.length}…` : `Apply ${chosen.length}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Two taps to delete (no browser confirm). */
function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [sure, setSure] = useState(false)
  const t = useRef<number | undefined>(undefined)
  return (
    <button
      className={`ta-act ${sure ? 'danger' : ''}`}
      title={sure ? 'Tap again to delete' : 'Delete'}
      aria-label="Delete"
      onClick={() => {
        if (sure) {
          clearTimeout(t.current)
          setSure(false)
          return onDelete()
        }
        setSure(true)
        t.current = window.setTimeout(() => setSure(false), 2500)
      }}
    >
      {sure ? 'Sure?' : <Icon name="trash" size={13} />}
    </button>
  )
}

function AreaAdd({ onAdd, name }: { onAdd: (v: string) => Promise<void>; name: string }) {
  const [v, setV] = useState('')
  return (
    <form
      className="ta-col-add"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!v.trim()) return
        await onAdd(v)
        setV('')
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`+ Add to ${name || 'this area'}`} maxLength={300} />
    </form>
  )
}

function NewArea({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState('')
  if (!open)
    return (
      <button className="ta-col ta-new" onClick={() => setOpen(true)}>
        <Icon name="plus" size={18} /> New area
      </button>
    )
  return (
    <form
      className="ta-col ta-new-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!v.trim()) return
        await onCreate(v.trim())
        setV('')
        setOpen(false)
      }}
    >
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="Area name, e.g. 🧠 Learning" maxLength={60} />
      <div className="row">
        <button className="btn small primary">Add area</button>
        <button type="button" className="btn small ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  )
}
