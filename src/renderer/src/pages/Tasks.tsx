import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TASK_MAX_COINS, TASK_MAX_XP } from '@core/plan'
import type { Category, Repeat, TaskInput, TasksState, TaskView, TaskDecompositionResult } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction, useToast } from '../ui'
import { soundSuccess, soundTick, soundSystemOracle, soundMechanicalClick } from '../sound'

interface Props {
  state: TasksState
  onState: (s: TasksState) => void
  onWallet: () => void
}

type ViewMode = 'board' | 'list'
type FilterTab = 'inbox' | 'today' | 'upcoming' | 'p1' | 'all' | string

function formatTodoistDate(due: string | null, repeat: string, todayStr: string): { label: string; kind: 'today' | 'tomorrow' | 'upcoming' | 'overdue' } | null {
  if (!due && repeat === 'none') return null
  if (!due && repeat !== 'none') {
    return { label: 'Recurring 🔁', kind: 'today' }
  }
  if (!due) return null

  if (due === todayStr) {
    return { label: repeat !== 'none' ? 'Today 🔁' : 'Today', kind: 'today' }
  }

  const [ty, tm, td] = todayStr.split('-').map(Number)
  const [dy, dm, dd] = due.split('-').map(Number)
  const tUtc = Date.UTC(ty, tm - 1, td)
  const dUtc = Date.UTC(dy, dm - 1, dd)
  const diffDays = Math.round((dUtc - tUtc) / 86_400_000)

  const repeatSuffix = repeat !== 'none' ? ' 🔁' : ''

  if (diffDays === 1) {
    return { label: `Tomorrow${repeatSuffix}`, kind: 'tomorrow' }
  }
  if (diffDays === -1) {
    return { label: 'Yesterday', kind: 'overdue' }
  }
  if (diffDays < -1) {
    const dObj = new Date(dUtc)
    const label = dObj.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    return { label, kind: 'overdue' }
  }

  if (diffDays > 1 && diffDays <= 6) {
    const dObj = new Date(dUtc)
    const label = dObj.toLocaleDateString(undefined, { weekday: 'long' })
    return { label: `${label}${repeatSuffix}`, kind: 'upcoming' }
  }

  const dObj = new Date(dUtc)
  const label = dObj.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return { label: `${label}${repeatSuffix}`, kind: 'upcoming' }
}

function renderTitle(title: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts = title.split(urlRegex)
  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation()
            window.open(part, '_blank')
          }}
        >
          {part.length > 38 ? part.slice(0, 38) + '...' : part}
        </a>
      )
    }
    return part
  })
}

export function Tasks({ state, onState, onWallet }: Props) {
  const act = useAction()
  const toast = useToast()
  const todayStr = state.today || new Date().toISOString().slice(0, 10)

  const [decomposeModal, setDecomposeModal] = useState<{
    isOpen: boolean
    taskTitle: string
    category: string
    notes?: string
    loading: boolean
    result: TaskDecompositionResult | null
  } | null>(null)

  async function startDecomposition(t: { title: string; category?: string; notes?: string | null }) {
    setDecomposeModal({
      isOpen: true,
      taskTitle: t.title,
      category: t.category || 'university',
      notes: t.notes ?? undefined,
      loading: true,
      result: null
    })
    try {
      const res = await life.ai.decomposeTask(t.title, t.notes ?? undefined, t.category || 'university')
      setDecomposeModal((prev) => (prev ? { ...prev, loading: false, result: res } : null))
      soundSystemOracle()
    } catch (err: any) {
      toast(err?.message || 'Failed to decompose task. Check AI keys in Settings.', 'bad')
      setDecomposeModal(null)
    }
  }

  async function handleApplySubtasks() {
    if (!decomposeModal?.result) return
    const { subtasks } = decomposeModal.result
    const cat = decomposeModal.category || 'university'
    for (const sub of subtasks) {
      await life.tasks.save({
        title: sub.title,
        category: cat,
        priority: sub.priority || 2,
        due: todayStr,
        repeat: 'none',
        weekdays: 0,
        coins: sub.coins,
        xp: sub.xp,
        notes: `Decomposed from: "${decomposeModal.taskTitle}"`
      })
    }
    const next = await life.tasks.state()
    onState(next)
    setDecomposeModal(null)
    toast(`⚔️ Added ${subtasks.length} subtasks to ${catById[cat]?.label || cat}!`, 'good')
    soundSuccess()
  }

  const [activeTab, setActiveTab] = useState<FilterTab>('inbox')
  const [viewMode, setViewMode] = useState<ViewMode>('board')
  const [searchQuery, setSearchQuery] = useState('')
  const [showDone, setShowDone] = useState(false)

  // Column inline task adding
  const [addingInColumn, setAddingInColumn] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [draftDue, setDraftDue] = useState<string | null>(todayStr)
  const [draftPriority, setDraftPriority] = useState<1 | 2 | 3>(2)
  const [draftRepeat, setDraftRepeat] = useState<Repeat>('none')
  const [draftCategory, setDraftCategory] = useState<string>('university')

  // Editing existing task
  const [editingTask, setEditingTask] = useState<TaskView | null>(null)

  // Ensure default categories exist
  useEffect(() => {
    const existingIds = new Set(state.categories.map((c) => c.id))
    const required: { id: string; label: string; color: string }[] = [
      { id: 'university', label: 'University', color: '#7CC4FF' },
      { id: 'today', label: 'Today', color: '#4ADE80' },
      { id: 'just-tasks', label: 'Just Tasks', color: '#B892FF' },
      { id: 'tomorrow', label: 'Tomorrow', color: '#F5C84B' },
      { id: 'life', label: 'Life', color: '#C8F135' }
    ]
    for (const r of required) {
      if (!existingIds.has(r.id)) {
        life.tasks.saveCategory(r).catch(() => {})
      }
    }
  }, [state.categories])

  const catById = useMemo(() => Object.fromEntries(state.categories.map((c) => [c.id, c])), [state.categories])

  // Filter tasks based on activeTab and search
  const filteredTasks = useMemo(() => {
    let list = state.tasks

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.notes && t.notes.toLowerCase().includes(q)))
    }

    if (!showDone) {
      list = list.filter((t) => !t.done)
    }

    if (activeTab === 'inbox' || activeTab === 'all') {
      return list
    }

    if (activeTab === 'today') {
      return list.filter((t) => t.due === todayStr || t.repeat === 'daily' || t.category === 'today')
    }

    if (activeTab === 'upcoming') {
      return list.filter((t) => (t.due && t.due > todayStr) || t.category === 'tomorrow')
    }

    if (activeTab === 'p1') {
      return list.filter((t) => t.priority === 1)
    }

    // Specific category/project tab
    return list.filter((t) => t.category === activeTab)
  }, [state.tasks, activeTab, searchQuery, showDone, todayStr])

  // Distinct board columns:
  // When in Inbox or All, show sections matching categories: University, Today, Just Tasks, Tomorrow, Life, etc.
  // When in a specific project or Today view, show sections: Overdue, Today, Tomorrow, Upcoming, No Date.
  const boardColumns = useMemo(() => {
    if (activeTab === 'inbox' || activeTab === 'all') {
      // Use categories as columns
      const cols: { id: string; label: string; tasks: TaskView[]; color?: string }[] = []
      // Standard order to match user screenshot: University, Today, Just Tasks, Tomorrow, etc.
      const priorityOrder = ['university', 'today', 'just-tasks', 'tomorrow', 'life', 'body', 'finance']
      const seen = new Set<string>()

      for (const catId of priorityOrder) {
        const cat = catById[catId]
        if (cat) {
          seen.add(cat.id)
          cols.push({
            id: cat.id,
            label: cat.label,
            tasks: filteredTasks.filter((t) => t.category === cat.id),
            color: cat.color
          })
        }
      }

      for (const cat of state.categories) {
        if (!seen.has(cat.id)) {
          cols.push({
            id: cat.id,
            label: cat.label,
            tasks: filteredTasks.filter((t) => t.category === cat.id),
            color: cat.color
          })
        }
      }

      return cols
    }

    // Date-based grouping columns for Today / Upcoming / Project views
    return [
      {
        id: 'today',
        label: 'Today',
        tasks: filteredTasks.filter((t) => t.due === todayStr || t.repeat === 'daily' || t.category === 'today'),
        color: '#4ade80'
      },
      {
        id: 'tomorrow',
        label: 'Tomorrow',
        tasks: filteredTasks.filter((t) => {
          if (t.due) {
            const diff = Math.round((new Date(t.due).getTime() - new Date(todayStr).getTime()) / 86_400_000)
            return diff === 1 || t.category === 'tomorrow'
          }
          return t.category === 'tomorrow'
        }),
        color: '#fbbf24'
      },
      {
        id: 'upcoming',
        label: 'Later & Upcoming',
        tasks: filteredTasks.filter((t) => {
          if (t.due) {
            const diff = Math.round((new Date(t.due).getTime() - new Date(todayStr).getTime()) / 86_400_000)
            return diff > 1
          }
          return false
        }),
        color: '#c084fc'
      },
      {
        id: 'nodate',
        label: 'No Due Date',
        tasks: filteredTasks.filter((t) => !t.due && t.repeat === 'none' && t.category !== 'today' && t.category !== 'tomorrow'),
        color: '#888888'
      }
    ]
  }, [activeTab, catById, filteredTasks, state.categories, todayStr])

  async function handleToggle(t: TaskView) {
    soundMechanicalClick()
    const next = await act(() => (t.done ? life.tasks.uncomplete(t.id) : life.tasks.complete(t.id)))
    if (next) {
      if (!t.done) soundSuccess()
      onState(next)
      onWallet()
    }
  }

  async function handleCreateTask(colId: string) {
    if (!draftTitle.trim()) return
    const targetCat = colId === 'today' || colId === 'tomorrow' || colId === 'just-tasks' || colId === 'university'
      ? colId
      : activeTab !== 'inbox' && activeTab !== 'all' && activeTab !== 'today' && activeTab !== 'upcoming' && activeTab !== 'p1'
      ? activeTab
      : draftCategory || 'university'

    const targetDue = colId === 'today'
      ? todayStr
      : colId === 'tomorrow'
      ? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      : draftDue

    const input: TaskInput = {
      title: draftTitle.trim(),
      category: targetCat,
      priority: draftPriority,
      due: targetDue,
      repeat: draftRepeat,
      weekdays: draftRepeat === 'weekly' ? 0b0011111 : 0,
      coins: draftPriority === 1 ? 15 : draftPriority === 2 ? 10 : 5,
      xp: draftPriority === 1 ? 30 : draftPriority === 2 ? 20 : 10,
      notes: draftNotes.trim() || null
    }

    const next = await act(() => life.tasks.save(input), 'Task created!')
    if (next) {
      onState(next)
      setDraftTitle('')
      setDraftNotes('')
      setAddingInColumn(null)
    }
  }

  async function handleUpdateTask() {
    if (!editingTask || !editingTask.title.trim()) return
    const input: TaskInput = {
      id: editingTask.id,
      title: editingTask.title.trim(),
      category: editingTask.category,
      priority: editingTask.priority,
      due: editingTask.due,
      repeat: editingTask.repeat,
      weekdays: editingTask.weekdays,
      coins: editingTask.coins,
      xp: editingTask.xp,
      notes: editingTask.notes
    }
    const next = await act(() => life.tasks.save(input), 'Task updated!')
    if (next) {
      onState(next)
      setEditingTask(null)
    }
  }

  async function handleDeleteTask(id: number) {
    const next = await act(() => life.tasks.archive(id), 'Task deleted')
    if (next) {
      onState(next)
      setEditingTask(null)
    }
  }

  async function loadScreenshotDemoTasks() {
    // Exact tasks from user's Todoist screenshot
    const samples = [
      // University (8)
      { title: 'Certifications that emil recommnede Crto', category: 'university', priority: 2 as const, due: null },
      { title: 'clean up our pc', category: 'university', priority: 2 as const, due: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10) },
      { title: 'CYBERSECURITY VIDEO CHFC I IT OUT https://www.instagram.com', category: 'university', priority: 2 as const, due: null },
      { title: 'find out hte number of your teacher de educatia fizica penbtru ai da lui doamna...', category: 'university', priority: 2 as const, due: null },
      { title: 'finish etica curs IMPORTANT', category: 'university', priority: 1 as const, due: null },
      { title: 'just sit down and thinkg of your priorities again life is hard and you might...', category: 'university', priority: 2 as const, due: '2026-10-23' },
      { title: 'manaca morcov', category: 'university', priority: 2 as const, due: todayStr },
      { title: 'think more a bout Marius about Emil', category: 'university', priority: 2 as const, due: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) },

      // Today (6)
      { title: 'interview', category: 'today', priority: 2 as const, due: todayStr },
      { title: 'invata laborator criptgrafie', category: 'today', priority: 2 as const, due: '2026-10-25' },
      { title: 'study criptografie', category: 'today', priority: 2 as const, due: todayStr },
      { title: 'study math', category: 'today', priority: 2 as const, due: todayStr },
      { title: 'team meeting', category: 'today', priority: 2 as const, due: todayStr },
      { title: 'work some AI', category: 'today', priority: 2 as const, due: todayStr },

      // Just Tasks (4)
      { title: 'check linkedin15 min', category: 'just-tasks', priority: 2 as const, due: todayStr, repeat: 'daily' as const },
      { title: 'CRITICAL NEED TO IMPLEMENT ANTIAI from Maxim - this simbol cna be...', category: 'just-tasks', priority: 1 as const, due: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) },
      { title: 'log in the result in sparta app 1 min', category: 'just-tasks', priority: 2 as const, due: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), repeat: 'daily' as const },
      { title: 'sport', category: 'just-tasks', priority: 2 as const, due: todayStr, repeat: 'daily' as const },

      // Tomorrow (1)
      { title: 'Solve the problem with Revolut 20 min', category: 'tomorrow', priority: 2 as const, due: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) }
    ]

    for (const s of samples) {
      await life.tasks.save({
        title: s.title,
        category: s.category,
        priority: s.priority,
        due: s.due,
        repeat: (s as any).repeat ?? 'none',
        weekdays: 0,
        coins: s.priority === 1 ? 15 : 10,
        xp: s.priority === 1 ? 30 : 20,
        notes: null
      })
    }

    const updated = await life.tasks.state()
    onState(updated)
  }

  // Count open tasks for navigation badges
  const totalOpen = state.tasks.filter((t) => !t.done).length
  const todayOpen = state.tasks.filter((t) => !t.done && (t.due === todayStr || t.repeat === 'daily' || t.category === 'today')).length

  return (
    <div className="todoist-app">
      {/* Left Sub-Sidebar */}
      <aside className="todoist-sidebar">
        <div className="todoist-user-row">
          <div className="todoist-user-badge">
            <div className="todoist-avatar">V</div>
            <span>vicuvi1</span>
          </div>
          <button className="icon-btn" title="Notifications" style={{ background: 'transparent', border: 0, color: '#888', cursor: 'pointer' }}>
            <Icon name="bell" size={15} />
          </button>
        </div>

        <button
          className="todoist-btn-add"
          onClick={() => {
            setAddingInColumn('university')
            setDraftTitle('')
          }}
        >
          <Icon name="plus" size={15} />
          <span>Add task</span>
        </button>

        <div className="todoist-search-box">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <ul className="todoist-nav-list">
          <li
            className={`todoist-nav-item ${activeTab === 'inbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('inbox')}
          >
            <div className="todoist-nav-left">
              <Icon name="tasks" size={16} />
              <span>Inbox</span>
            </div>
            <span className="todoist-nav-count">{totalOpen}</span>
          </li>

          <li
            className={`todoist-nav-item ${activeTab === 'today' ? 'active' : ''}`}
            onClick={() => setActiveTab('today')}
          >
            <div className="todoist-nav-left">
              <Icon name="calendar" size={16} />
              <span>Today</span>
            </div>
            <span className="todoist-nav-count">{todayOpen}</span>
          </li>

          <li
            className={`todoist-nav-item ${activeTab === 'upcoming' ? 'active' : ''}`}
            onClick={() => setActiveTab('upcoming')}
          >
            <div className="todoist-nav-left">
              <Icon name="calendar" size={16} />
              <span>Upcoming</span>
            </div>
          </li>

          <li
            className={`todoist-nav-item ${activeTab === 'p1' ? 'active' : ''}`}
            onClick={() => setActiveTab('p1')}
          >
            <div className="todoist-nav-left">
              <Icon name="bolt" size={16} />
              <span>High Priority (P1)</span>
            </div>
          </li>
        </ul>

        <div className="todoist-section-label">
          <span>My Projects</span>
        </div>

        <ul className="todoist-nav-list">
          {state.categories.map((c) => {
            const count = state.tasks.filter((t) => t.category === c.id && !t.done).length
            return (
              <li
                key={c.id}
                className={`todoist-project-item ${activeTab === c.id ? 'active' : ''}`}
                onClick={() => setActiveTab(c.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: c.color, fontSize: '13px', fontWeight: 'bold' }}>#</span>
                  <span>{c.label}</span>
                </div>
                {count > 0 && <span className="todoist-nav-count">{count}</span>}
              </li>
            )
          })}
        </ul>

        {/* Demo data loader if empty */}
        {state.tasks.length === 0 && (
          <div style={{ marginTop: 'auto', padding: '10px 6px' }}>
            <button
              className="btn small"
              style={{ width: '100%', fontSize: '11.5px', background: 'rgba(222, 76, 74, 0.2)', border: '1px solid #de4c4a', color: '#ff7a75' }}
              onClick={loadScreenshotDemoTasks}
            >
              📥 Load Screenshot Boards
            </button>
          </div>
        )}
      </aside>

      {/* Main Board / List Area */}
      <main className="todoist-main">
        {/* Top Header */}
        <header className="todoist-header">
          <div className="todoist-header-title">
            <h1>
              {activeTab === 'inbox'
                ? 'Inbox'
                : activeTab === 'today'
                ? 'Today'
                : activeTab === 'upcoming'
                ? 'Upcoming'
                : activeTab === 'p1'
                ? 'Priority 1 Tasks'
                : catById[activeTab]?.label || 'Tasks'}
            </h1>
            <span style={{ fontSize: '13px', color: '#888' }}>
              {filteredTasks.filter((t) => !t.done).length} open
            </span>
          </div>

          <div className="todoist-header-actions">
            <button
              className="todoist-action-btn"
              style={{ background: 'rgba(0, 210, 255, 0.1)', borderColor: 'rgba(0, 210, 255, 0.3)', color: '#38bdf8' }}
              onClick={() => {
                const title = prompt('Enter a complex task or objective to decompose with System AI:')
                if (title && title.trim()) {
                  startDecomposition({ title: title.trim(), category: activeTab !== 'inbox' && catById[activeTab] ? activeTab : 'university' })
                }
              }}
              title="Decompose any complex objective into actionable subtasks with AI"
            >
              <span>⚡ AI Decompose</span>
            </button>

            <button
              className="todoist-action-btn"
              onClick={() => setViewMode(viewMode === 'board' ? 'list' : 'board')}
              title="Toggle Board/List layout"
            >
              <Icon name="sliders" size={14} />
              <span>Display: {viewMode === 'board' ? 'Board' : 'List'}</span>
            </button>

            <label className="check small-check" style={{ fontSize: '12px', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              <span>Show Done</span>
            </label>

            {state.tasks.length === 0 && (
              <button className="todoist-action-btn" onClick={loadScreenshotDemoTasks}>
                Load Demo Tasks
              </button>
            )}
          </div>
        </header>

        {/* Board (Kanban) View */}
        {viewMode === 'board' ? (
          <div className="todoist-board-container">
            {boardColumns.map((col) => (
              <div key={col.id} className="todoist-column">
                <div className="todoist-col-header">
                  <div className="todoist-col-title">
                    {col.color && <span style={{ color: col.color, fontWeight: 'bold' }}>#</span>}
                    <span>{col.label}</span>
                    <span className="todoist-col-count">{col.tasks.filter((t) => !t.done).length}</span>
                  </div>
                  <button className="icon-btn" style={{ background: 'transparent', border: 0, color: '#777', cursor: 'pointer' }}>
                    •••
                  </button>
                </div>

                <div className="todoist-col-cards">
                  <AnimatePresence>
                    {col.tasks.map((t) => {
                      const dateInfo = formatTodoistDate(t.due, t.repeat, todayStr)
                      return (
                        <motion.div
                          key={t.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={`todoist-card ${t.done ? 'done' : ''}`}
                          onClick={() => setEditingTask(t)}
                        >
                          <div className="todoist-card-top">
                            <button
                              className={`todoist-circle-check p${t.priority} ${t.done ? 'checked' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleToggle(t)
                              }}
                              title={t.done ? 'Untick task' : 'Mark complete'}
                            >
                              {t.done && <Icon name="check" size={11} />}
                            </button>

                            <div className="todoist-card-text">
                              {renderTitle(t.title)}
                            </div>
                          </div>

                          {t.notes && (
                            <div className="todoist-card-notes">
                              {t.notes}
                            </div>
                          )}

                          <div className="todoist-card-footer">
                            <button
                              className="todoist-decompose-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                startDecomposition(t)
                              }}
                              title="Break down with AI System Oracle"
                            >
                              ⚡ AI Break Down
                            </button>
                            {dateInfo && (
                              <span className={`todoist-date-pill ${dateInfo.kind}`}>
                                <Icon name="calendar" size={11} />
                                {dateInfo.label}
                              </span>
                            )}

                            {activeTab === 'inbox' && catById[t.category] && (
                              <span className="todoist-project-tag">
                                #{catById[t.category].label}
                              </span>
                            )}

                            <span className="todoist-reward-badge" title="Reward on completion">
                              <Coins n={t.coins} />
                              <span style={{ fontSize: '10px', color: '#888' }}>+{t.xp}XP</span>
                            </span>
                          </div>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>

                  {/* Inline Composer if this column is active */}
                  {addingInColumn === col.id ? (
                    <div className="todoist-inline-composer">
                      <input
                        className="todoist-composer-input"
                        placeholder="Task name"
                        autoFocus
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateTask(col.id)
                          if (e.key === 'Escape') setAddingInColumn(null)
                        }}
                      />

                      <textarea
                        className="todoist-composer-notes"
                        placeholder="Description (optional)"
                        rows={2}
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                      />

                      <div className="todoist-composer-pills-row">
                        <select
                          className="todoist-composer-pill"
                          value={draftCategory}
                          onChange={(e) => setDraftCategory(e.target.value)}
                          style={{ background: '#222', border: '1px solid #444', color: '#eee' }}
                        >
                          {state.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              📁 #{c.label}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          className={`todoist-composer-pill ${draftDue === todayStr ? 'active' : ''}`}
                          onClick={() => setDraftDue(draftDue === todayStr ? null : todayStr)}
                        >
                          <Icon name="calendar" size={11} />
                          {draftDue === todayStr ? '📅 Today' : '📅 Date'}
                        </button>

                        <select
                          className="todoist-composer-pill"
                          value={draftPriority}
                          onChange={(e) => setDraftPriority(Number(e.target.value) as 1 | 2 | 3)}
                          style={{ background: '#222', border: '1px solid #444', color: '#eee' }}
                        >
                          <option value={1}>🚩 P1 Urgent</option>
                          <option value={2}>🚩 P2 High</option>
                          <option value={3}>🚩 P3 Normal</option>
                        </select>

                        <select
                          className="todoist-composer-pill"
                          value={draftRepeat}
                          onChange={(e) => setDraftRepeat(e.target.value as Repeat)}
                          style={{ background: '#222', border: '1px solid #444', color: '#eee' }}
                        >
                          <option value="none">One-off</option>
                          <option value="daily">🔁 Daily</option>
                          <option value="weekly">🔁 Weekly</option>
                        </select>
                      </div>

                      <div className="todoist-composer-actions">
                        <button
                          type="button"
                          className="todoist-btn-cancel"
                          onClick={() => setAddingInColumn(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="todoist-btn-submit"
                          disabled={!draftTitle.trim()}
                          onClick={() => handleCreateTask(col.id)}
                        >
                          Add task
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="todoist-col-add-btn"
                      onClick={() => {
                        setAddingInColumn(col.id)
                        setDraftTitle('')
                        setDraftCategory(col.id)
                      }}
                    >
                      <Icon name="plus" size={13} />
                      <span>Add task</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="todoist-list-container">
            {boardColumns.map((col) => (
              <div key={col.id} className="todoist-list-group">
                <div className="todoist-list-group-header">
                  <span>{col.label}</span>
                  <span style={{ fontSize: '12px', color: '#777' }}>{col.tasks.length}</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {col.tasks.map((t) => {
                    const dateInfo = formatTodoistDate(t.due, t.repeat, todayStr)
                    return (
                      <div
                        key={t.id}
                        className={`todoist-card ${t.done ? 'done' : ''}`}
                        onClick={() => setEditingTask(t)}
                        style={{ padding: '10px 14px' }}
                      >
                        <div className="todoist-card-top">
                          <button
                            className={`todoist-circle-check p${t.priority} ${t.done ? 'checked' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleToggle(t)
                            }}
                          >
                            {t.done && <Icon name="check" size={11} />}
                          </button>
                          <div className="todoist-card-text">{renderTitle(t.title)}</div>
                          {dateInfo && (
                            <span className={`todoist-date-pill ${dateInfo.kind}`} style={{ marginLeft: 'auto' }}>
                              {dateInfo.label}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  <button
                    className="todoist-col-add-btn"
                    onClick={() => {
                      setAddingInColumn(col.id)
                      setDraftTitle('')
                      setDraftCategory(col.id)
                      setViewMode('board')
                    }}
                  >
                    <Icon name="plus" size={13} />
                    <span>Add task to {col.label}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Edit Task Modal */}
      {editingTask && (
        <div
          className="modal-scrim"
          onClick={() => setEditingTask(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 999 }}
        >
          <div
            className="todoist-inline-composer"
            style={{ width: '450px', maxWidth: '90vw', padding: '18px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>Edit Task</span>
              <button
                className="icon-btn"
                style={{ background: 'transparent', border: 0, color: '#aaa', cursor: 'pointer' }}
                onClick={() => setEditingTask(null)}
              >
                ✕
              </button>
            </div>

            <input
              className="todoist-composer-input"
              value={editingTask.title}
              onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
            />

            <textarea
              className="todoist-composer-notes"
              placeholder="Notes / Link"
              rows={3}
              value={editingTask.notes || ''}
              onChange={(e) => setEditingTask({ ...editingTask, notes: e.target.value })}
            />

            <div className="todoist-composer-pills-row">
              <select
                className="todoist-composer-pill"
                value={editingTask.category}
                onChange={(e) => setEditingTask({ ...editingTask, category: e.target.value })}
                style={{ background: '#222', border: '1px solid #444', color: '#eee' }}
              >
                {state.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.label}
                  </option>
                ))}
              </select>

              <input
                type="date"
                className="todoist-composer-pill"
                value={editingTask.due || ''}
                onChange={(e) => setEditingTask({ ...editingTask, due: e.target.value || null })}
                style={{ background: '#222', border: '1px solid #444', color: '#eee' }}
              >
              </input>

              <select
                className="todoist-composer-pill"
                value={editingTask.priority}
                onChange={(e) => setEditingTask({ ...editingTask, priority: Number(e.target.value) as 1 | 2 | 3 })}
                style={{ background: '#222', border: '1px solid #444', color: '#eee' }}
              >
                <option value={1}>🚩 P1 Urgent</option>
                <option value={2}>🚩 P2 High</option>
                <option value={3}>🚩 P3 Normal</option>
              </select>

              <select
                className="todoist-composer-pill"
                value={editingTask.repeat}
                onChange={(e) => setEditingTask({ ...editingTask, repeat: e.target.value as Repeat })}
                style={{ background: '#222', border: '1px solid #444', color: '#eee' }}
              >
                <option value="none">One-off</option>
                <option value="daily">🔁 Daily</option>
                <option value="weekly">🔁 Weekly</option>
              </select>
            </div>

            <div className="todoist-composer-actions">
              <button
                type="button"
                className="btn danger small"
                onClick={() => handleDeleteTask(editingTask.id)}
              >
                Delete
              </button>
              <button
                type="button"
                className="btn small"
                style={{ background: 'rgba(0, 210, 255, 0.12)', borderColor: 'rgba(0, 210, 255, 0.35)', color: '#38bdf8', marginRight: 'auto' }}
                onClick={() => {
                  const current = editingTask
                  setEditingTask(null)
                  startDecomposition(current)
                }}
                title="Break down this task into subtasks using AI Oracle"
              >
                ⚡ Decompose (AI)
              </button>
              <button
                type="button"
                className="todoist-btn-cancel"
                onClick={() => setEditingTask(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="todoist-btn-submit"
                onClick={handleUpdateTask}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
 
      {/* AI Quest Decomposition Modal */}
      <AnimatePresence>
        {decomposeModal?.isOpen && (
          <div className="decompose-modal-backdrop" onClick={() => setDecomposeModal(null)}>
            <motion.div
              className="decompose-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="decompose-modal-header">
                <div className="decompose-modal-title">
                  <span style={{ color: '#00d2ff' }}>[QUEST DECOMPOSITION]</span>
                  <span style={{ color: '#fff', fontSize: '14px' }}>{decomposeModal.taskTitle}</span>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setDecomposeModal(null)}
                  style={{ background: 'transparent', border: 0, color: '#aaa', cursor: 'pointer', fontSize: '16px' }}
                >
                  ✕
                </button>
              </div>

              {decomposeModal.loading ? (
                <div style={{ padding: '36px 20px', textAlign: 'center', color: '#38bdf8' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '12px 18px', background: 'rgba(0, 210, 255, 0.08)', border: '1px dashed rgba(0, 210, 255, 0.35)', borderRadius: '10px' }}>
                    <span style={{ animation: 'system-pulse 1.4s infinite' }}>⚡</span>
                    <span>Solo Leveling System Oracle analyzing quest topology and generating micro-phases…</span>
                  </div>
                </div>
              ) : decomposeModal.result ? (
                <>
                  <div className="decompose-strategy-tip">
                    <b style={{ color: '#38bdf8' }}>Tactical Directive:</b> {decomposeModal.result.strategyTip}
                  </div>

                  <div className="decompose-subtask-list">
                    {decomposeModal.result.subtasks.map((sub, i) => (
                      <div key={i} className="decompose-subtask-item">
                        <div className="decompose-subtask-left">
                          <span style={{ color: '#00d2ff', fontWeight: 700, fontFamily: 'var(--mono)' }}>{i + 1}.</span>
                          <span style={{ fontWeight: 500, fontSize: '13.5px' }}>{sub.title}</span>
                        </div>
                        <div className="decompose-subtask-badges">
                          <span style={{ color: '#94a3b8', fontSize: '11.5px' }}>⏱ {sub.minutes}m</span>
                          <span style={{ color: '#F5C84B', fontWeight: 600 }}>+{sub.coins} coins</span>
                          <span style={{ color: '#c084fc', fontSize: '12px' }}>+{sub.xp} XP</span>
                          <span className={`todoist-priority-badge p${sub.priority}`}>P{sub.priority}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="decompose-actions-row">
                    <button className="btn ghost" onClick={() => setDecomposeModal(null)}>
                      Dismiss
                    </button>
                    <button className="btn primary" onClick={handleApplySubtasks}>
                      ⚔️ Add All {decomposeModal.result.subtasks.length} Subtasks to Board
                    </button>
                  </div>
                </>
              ) : null}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}