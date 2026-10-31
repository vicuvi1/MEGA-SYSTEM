import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { TASK_MAX_COINS, TASK_MAX_XP } from '@core/plan'
import type { Category, Repeat, TaskInput, TasksState, TaskView, TaskDecompositionResult } from '@shared/api'
import { features, life } from '../bridge'
import { Icon } from '../Icon'
import { Coins, useAction, useToast } from '../ui'
import { soundSuccess, soundTick, soundSystemOracle, soundMechanicalClick, soundCoin } from '../sound'

interface Props {
  state: TasksState
  onState: (s: TasksState) => void
  onWallet: () => void
}

type ViewMode = 'board' | 'list'
type GroupBy = 'status' | 'priority' | 'date' | 'project'
type FilterTab = 'inbox' | 'today' | 'upcoming' | 'p1' | string

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

const PROJECT_COLOR_PALETTE = [
  '#00D2FF', '#7CC4FF', '#FF6B8B', '#DE4C4A',
  '#4ADE80', '#F5C84B', '#B892FF', '#EC4899'
]

export function Tasks({ state, onState, onWallet }: Props) {
  const act = useAction()
  const toast = useToast()
  const todayStr = state.today || new Date().toISOString().slice(0, 10)
  const tomorrowStr = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  // View preferences persisted
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('ls.tasks.viewMode') as ViewMode) || 'board'
  })
  const [groupBy, setGroupBy] = useState<GroupBy>(() => {
    return (localStorage.getItem('ls.tasks.groupBy') as GroupBy) || 'status'
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ls.tasks.sidebarCollapsed') === 'true'
  })

  // Filtering state
  const [activeTab, setActiveTab] = useState<FilterTab>('inbox')
  const [searchQuery, setSearchQuery] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [filterPriority, setFilterPriority] = useState<1 | 2 | 3 | 'all'>('all')

  // Drag and drop state
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null)
  const [dragOverColId, setDragOverColId] = useState<string | null>(null)

  // Project creation modal
  const [addingProject, setAddingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectColor, setNewProjectColor] = useState('#00D2FF')

  // AI Decomposition modal
  const [decomposeModal, setDecomposeModal] = useState<{
    isOpen: boolean
    taskTitle: string
    category: string
    notes?: string
    loading: boolean
    result: TaskDecompositionResult | null
  } | null>(null)

  // Task creation and editing state
  const [addingInColumn, setAddingInColumn] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftNotes, setDraftNotes] = useState('')
  const [draftDue, setDraftDue] = useState<string | null>(todayStr)
  const [draftPriority, setDraftPriority] = useState<1 | 2 | 3>(2)
  const [draftRepeat, setDraftRepeat] = useState<Repeat>('none')
  const [draftCategory, setDraftCategory] = useState<string>('university')
  const [editingTask, setEditingTask] = useState<TaskView | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: TaskView } | null>(null)

  // Real projects (excluding pseudo-categories like 'today' or 'tomorrow')
  const realProjects = useMemo(() => {
    return state.categories.filter((c) => c.id !== 'today' && c.id !== 'tomorrow')
  }, [state.categories])

  const catById = useMemo(() => Object.fromEntries(realProjects.map((c) => [c.id, c])), [realProjects])

  // Persist view choices
  useEffect(() => {
    localStorage.setItem('ls.tasks.viewMode', viewMode)
  }, [viewMode])
  useEffect(() => {
    localStorage.setItem('ls.tasks.groupBy', groupBy)
  }, [groupBy])
  useEffect(() => {
    localStorage.setItem('ls.tasks.sidebarCollapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  // Start AI Decomposition
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

  // Context Menu & Quick Actions (Ultimate Flexibility)
  async function handleDeleteTask(taskId: number) {
    soundMechanicalClick()
    const next = await life.tasks.archive(taskId)
    onState(next)
    toast('🗑️ Quest deleted', 'good')
  }

  async function handleDuplicateTask(task: TaskView) {
    soundTick()
    await life.tasks.save({
      title: `${task.title} (Copy)`,
      category: task.category,
      priority: task.priority,
      due: task.due,
      repeat: task.repeat,
      weekdays: task.weekdays,
      coins: task.coins,
      xp: task.xp,
      notes: task.notes ?? null
    })
    const next = await life.tasks.state()
    onState(next)
    toast('📋 Quest duplicated', 'good')
  }

  async function handleMoveStatus(task: TaskView, colId: 'backlog' | 'todo' | 'inprogress' | 'done') {
    soundMechanicalClick()
    if (colId === 'done') {
      await life.tasks.complete(task.id)
      const next = await life.tasks.state()
      onState(next)
      onWallet()
      toast('✅ Quest completed (+Coins)', 'good')
      return
    }
    if (task.done) {
      await life.tasks.uncomplete(task.id)
      onWallet()
    }
    let nextPriority = task.priority
    let nextDue = task.due
    if (colId === 'inprogress') {
      nextPriority = 1
      nextDue = todayStr
    } else if (colId === 'todo') {
      nextPriority = (task.priority === 1 ? 2 : task.priority) as 1 | 2 | 3
      nextDue = todayStr
    } else if (colId === 'backlog') {
      nextPriority = 3
      nextDue = null
    }
    await life.tasks.save({
      id: task.id,
      title: task.title,
      category: task.category,
      priority: nextPriority,
      due: nextDue,
      repeat: task.repeat,
      weekdays: task.weekdays,
      coins: task.coins,
      xp: task.xp,
      notes: task.notes ?? null
    })
    const next = await life.tasks.state()
    onState(next)
    onWallet()
    toast(`Moved to ${colId === 'todo' ? 'To Do' : colId === 'inprogress' ? 'In Progress' : colId.toUpperCase()}`, 'good')
  }

  async function handleSetPriority(task: TaskView, p: 1 | 2 | 3) {
    soundTick()
    await life.tasks.save({
      id: task.id,
      title: task.title,
      category: task.category,
      priority: p,
      due: task.due,
      repeat: task.repeat,
      weekdays: task.weekdays,
      coins: task.coins,
      xp: task.xp,
      notes: task.notes ?? null
    })
    const next = await life.tasks.state()
    onState(next)
    toast(`Priority set to P${p}`, 'good')
  }

  async function handleSetDueDate(task: TaskView, due: string | null) {
    soundTick()
    await life.tasks.save({
      id: task.id,
      title: task.title,
      category: task.category,
      priority: task.priority,
      due,
      repeat: task.repeat,
      weekdays: task.weekdays,
      coins: task.coins,
      xp: task.xp,
      notes: task.notes ?? null
    })
    const next = await life.tasks.state()
    onState(next)
    toast(due ? `Due ${due}` : 'Due date cleared', 'good')
  }

  // Filter tasks based on sidebar, search, priority, done
  const filteredTasks = useMemo(() => {
    let list = state.tasks

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((t) => t.title.toLowerCase().includes(q) || (t.notes && t.notes.toLowerCase().includes(q)))
    }

    // Done filter
    if (!showDone) {
      list = list.filter((t) => !t.done)
    }

    // Priority filter chip
    if (filterPriority !== 'all') {
      list = list.filter((t) => t.priority === filterPriority)
    }

    // Sidebar tab filter
    if (activeTab === 'today') {
      if (viewMode === 'board' && groupBy === 'status') {
        // In status board, columns already separate To Do (today) from Backlog and In Progress
      } else {
        return list.filter((t) => t.due === todayStr || t.repeat === 'daily')
      }
    }
    if (activeTab === 'upcoming') {
      return list.filter((t) => t.due && t.due > todayStr)
    }
    if (activeTab === 'p1') {
      if (viewMode === 'board' && groupBy === 'status') {
        // In status board, columns already show P1 in In Progress
      } else {
        return list.filter((t) => t.priority === 1)
      }
    }
    if (activeTab !== 'inbox' && activeTab !== 'all') {
      return list.filter((t) => t.category === activeTab)
    }

    return list
  }, [state.tasks, searchQuery, showDone, filterPriority, activeTab, todayStr, viewMode, groupBy])

  // DYNAMIC GROUPING COLUMNS (Ultimate Flexibility!)
  const boardColumns = useMemo(() => {
    if (groupBy === 'status') {
      return [
        {
          id: 'backlog',
          label: 'Backlog / Inbox',
          color: '#8A93A6',
          tasks: filteredTasks.filter((t) => !t.done && (!t.due || t.due > tomorrowStr) && t.priority !== 1)
        },
        {
          id: 'todo',
          label: 'To Do',
          color: '#38BDF8',
          tasks: filteredTasks.filter((t) => !t.done && (t.due && t.due <= tomorrowStr || t.repeat !== 'none') && t.priority !== 1)
        },
        {
          id: 'inprogress',
          label: 'In Progress (P1)',
          color: '#F43F5E',
          tasks: filteredTasks.filter((t) => !t.done && t.priority === 1)
        },
        {
          id: 'done',
          label: 'Completed',
          color: '#4ADE80',
          tasks: filteredTasks.filter((t) => t.done)
        }
      ]
    }

    if (groupBy === 'priority') {
      return [
        {
          id: 'p1',
          label: '🔴 Priority 1 (Urgent)',
          color: '#DE4C4A',
          tasks: filteredTasks.filter((t) => t.priority === 1)
        },
        {
          id: 'p2',
          label: '🟠 Priority 2 (Medium)',
          color: '#F59E0B',
          tasks: filteredTasks.filter((t) => t.priority === 2)
        },
        {
          id: 'p3',
          label: '🔵 Priority 3 (Normal)',
          color: '#38BDF8',
          tasks: filteredTasks.filter((t) => t.priority === 3)
        }
      ]
    }

    if (groupBy === 'date') {
      return [
        {
          id: 'overdue',
          label: '⚠️ Overdue',
          color: '#EF4444',
          tasks: filteredTasks.filter((t) => !t.done && t.due && t.due < todayStr)
        },
        {
          id: 'today',
          label: '📅 Today',
          color: '#4ADE80',
          tasks: filteredTasks.filter((t) => t.due === todayStr || t.repeat === 'daily')
        },
        {
          id: 'tomorrow',
          label: '🌅 Tomorrow',
          color: '#F5C84B',
          tasks: filteredTasks.filter((t) => t.due === tomorrowStr)
        },
        {
          id: 'upcoming',
          label: '🗓️ Upcoming',
          color: '#C084FC',
          tasks: filteredTasks.filter((t) => t.due && t.due > tomorrowStr)
        },
        {
          id: 'nodate',
          label: '⏳ Someday / No Date',
          color: '#8A93A6',
          tasks: filteredTasks.filter((t) => !t.due && t.repeat === 'none')
        }
      ]
    }

    // Default: Group by Project / Category
    return realProjects.map((p) => ({
      id: p.id,
      label: p.label,
      color: p.color,
      tasks: filteredTasks.filter((t) => t.category === p.id)
    }))
  }, [groupBy, filteredTasks, realProjects, todayStr, tomorrowStr])

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData('text/plain', String(taskId))
    setDraggedTaskId(taskId)
  }

  const handleDragOver = (e: React.DragEvent, colId: string) => {
    e.preventDefault()
    setDragOverColId(colId)
  }

  const handleDrop = async (e: React.DragEvent, targetColId: string) => {
    e.preventDefault()
    setDragOverColId(null)
    const rawId = e.dataTransfer.getData('text/plain')
    const taskId = parseInt(rawId, 10)
    if (!taskId) return

    const t = state.tasks.find((x) => x.id === taskId)
    if (!t) return

    soundMechanicalClick()

    // Handle dropping based on current groupBy
    if (groupBy === 'priority') {
      const newP = targetColId === 'p1' ? 1 : targetColId === 'p2' ? 2 : 3
      if (t.priority !== newP) {
        const next = await life.tasks.save({ ...t, priority: newP })
        onState(next)
      }
    } else if (groupBy === 'date') {
      const newDue = targetColId === 'today' ? todayStr : targetColId === 'tomorrow' ? tomorrowStr : targetColId === 'nodate' ? null : t.due
      const next = await life.tasks.save({ ...t, due: newDue })
      onState(next)
    } else if (groupBy === 'status') {
      if (['backlog', 'todo', 'inprogress', 'done'].includes(targetColId)) {
        await handleMoveStatus(t, targetColId as any)
      }
    } else if (groupBy === 'project') {
      if (t.category !== targetColId) {
        const next = await life.tasks.save({ ...t, category: targetColId })
        onState(next)
      }
    }
  }

  // Toggle complete
  async function handleToggle(t: TaskView) {
    soundMechanicalClick()
    const next = await act(() => (t.done ? life.tasks.uncomplete(t.id) : life.tasks.complete(t.id)))
    if (next) {
      if (!t.done) soundSuccess()
      onState(next)
      onWallet()
    }
  }

  // Create Task
  async function handleCreateTask(colId: string) {
    if (!draftTitle.trim()) return

    let targetCat = draftCategory || 'university'
    let targetPriority: 1 | 2 | 3 = draftPriority
    let targetDue = draftDue

    if (groupBy === 'project' && catById[colId]) {
      targetCat = colId
    } else if (groupBy === 'priority') {
      targetPriority = colId === 'p1' ? 1 : colId === 'p2' ? 2 : 3
    } else if (groupBy === 'date') {
      targetDue = colId === 'today' ? todayStr : colId === 'tomorrow' ? tomorrowStr : null
    }

    const input: TaskInput = {
      title: draftTitle.trim(),
      category: targetCat,
      priority: targetPriority,
      due: targetDue,
      repeat: draftRepeat,
      weekdays: draftRepeat === 'weekly' ? 0b0011111 : 0,
      coins: targetPriority === 1 ? 15 : targetPriority === 2 ? 10 : 5,
      xp: targetPriority === 1 ? 30 : targetPriority === 2 ? 20 : 10,
      notes: draftNotes.trim() || null
    }

    const next = await act(() => life.tasks.save(input), 'Quest created!')
    if (next) {
      onState(next)
      setDraftTitle('')
      setDraftNotes('')
      setAddingInColumn(null)
      soundTick()
    }
  }

  // Add Custom Project
  async function handleCreateProject() {
    if (!newProjectName.trim()) return
    const id = newProjectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    const cat: Category = {
      id,
      label: newProjectName.trim(),
      color: newProjectColor
    }
    const next = await act(() => life.tasks.saveCategory(cat), 'Project created!')
    if (next) {
      onState(next)
      setAddingProject(false)
      setNewProjectName('')
      soundSuccess()
    }
  }

  // Starter Quest Generator
  async function handleAddStarterQuest(type: 'study' | 'workout' | 'p1' | 'project') {
    let title = ''
    let cat = 'university'
    let priority: 1 | 2 | 3 = 2
    let due = todayStr

    if (type === 'study') {
      title = 'Deep Focus: SI-266 Lab & Core Study Block (90m)'
      cat = 'university'
      priority = 1
    } else if (type === 'workout') {
      title = 'Physical Mastery: Calisthenics / Gym Strength Session'
      cat = 'body'
      priority = 2
    } else if (type === 'p1') {
      title = 'CRITICAL: Solve High-Priority Assignment & Code Review'
      cat = 'university'
      priority = 1
    } else {
      title = 'Life System Architecture Refactor & Optimization'
      cat = 'life'
      priority = 2
    }

    const next = await life.tasks.save({
      title,
      category: cat,
      priority,
      due,
      repeat: 'none',
      weekdays: 0,
      coins: priority === 1 ? 15 : 10,
      xp: priority === 1 ? 30 : 20,
      notes: 'Generated from Solo Leveling starter templates'
    })
    onState(next)
    toast('⚔️ Quest added to your board!', 'good')
    soundCoin()
  }

  // Counts for sidebar badges
  const totalOpen = state.tasks.filter((t) => !t.done).length
  const todayOpen = state.tasks.filter((t) => !t.done && (t.due === todayStr || t.repeat === 'daily')).length
  const p1Open = state.tasks.filter((t) => !t.done && t.priority === 1).length
  const doneCount = state.tasks.filter((t) => t.done).length

  return (
    <div className="todoist-app">
      {/* 1. Collapsible Sub-Sidebar */}
      <aside className={`todoist-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="todoist-user-row">
          <div className="todoist-user-badge">
            <div className="todoist-avatar">V</div>
            <span>vicuvi1</span>
          </div>
          <button
            className="sidebar-toggle-btn"
            onClick={() => setSidebarCollapsed(true)}
            title="Collapse sidebar for wide board view"
          >
            ◀
          </button>
        </div>

        <button
          className="todoist-btn-add"
          onClick={() => {
            setAddingInColumn(boardColumns[0]?.id || 'university')
            setDraftTitle('')
          }}
        >
          <Icon name="plus" size={15} />
          <span>Add quest</span>
        </button>

        <div className="todoist-search-box">
          <Icon name="search" size={14} />
          <input
            type="text"
            placeholder="Search quests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ background: 'none', border: 0, color: '#888', cursor: 'pointer', padding: 0 }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Navigation Filters */}
        <ul className="todoist-nav-list">
          <li
            className={`todoist-nav-item ${activeTab === 'inbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('inbox')}
          >
            <div className="todoist-nav-left">
              <Icon name="list" size={15} />
              <span>Inbox & All</span>
            </div>
            {totalOpen > 0 && <span className="todoist-nav-count">{totalOpen}</span>}
          </li>

          <li
            className={`todoist-nav-item ${activeTab === 'today' ? 'active' : ''}`}
            onClick={() => setActiveTab('today')}
          >
            <div className="todoist-nav-left">
              <Icon name="calendar" size={15} />
              <span>Today</span>
            </div>
            {todayOpen > 0 && <span className="todoist-nav-count">{todayOpen}</span>}
          </li>

          <li
            className={`todoist-nav-item ${activeTab === 'upcoming' ? 'active' : ''}`}
            onClick={() => setActiveTab('upcoming')}
          >
            <div className="todoist-nav-left">
              <Icon name="spark" size={15} />
              <span>Upcoming</span>
            </div>
          </li>

          <li
            className={`todoist-nav-item ${activeTab === 'p1' ? 'active' : ''}`}
            onClick={() => setActiveTab('p1')}
          >
            <div className="todoist-nav-left">
              <span style={{ color: '#de4c4a', fontSize: 14 }}>🚩</span>
              <span>High Priority (P1)</span>
            </div>
            {p1Open > 0 && <span className="todoist-nav-count" style={{ color: '#de4c4a' }}>{p1Open}</span>}
          </li>
        </ul>

        {/* Real Projects */}
        <div className="todoist-section-label">
          <span>PROJECTS</span>
          <button
            className="icon-btn"
            title="Create new project"
            onClick={() => setAddingProject(true)}
            style={{ background: 'transparent', border: 0, color: '#888', cursor: 'pointer' }}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>

        <ul className="todoist-nav-list" style={{ overflowY: 'auto', flex: 1 }}>
          {realProjects.map((p) => {
            const count = state.tasks.filter((t) => !t.done && t.category === p.id).length
            return (
              <li
                key={p.id}
                className={`todoist-nav-item ${activeTab === p.id ? 'active' : ''}`}
                onClick={() => setActiveTab(p.id)}
              >
                <div className="todoist-nav-left">
                  <span style={{ color: p.color, fontWeight: 700 }}>#</span>
                  <span>{p.label}</span>
                </div>
                {count > 0 && <span className="todoist-nav-count">{count}</span>}
              </li>
            )
          })}
        </ul>
      </aside>

      {/* 2. Main Content Area */}
      <main className="todoist-main">
        {/* Header Controls */}
        <header className="todoist-header">
          <div className="todoist-header-title">
            {sidebarCollapsed && (
              <button
                className="sidebar-toggle-btn"
                onClick={() => setSidebarCollapsed(false)}
                title="Expand sidebar"
                style={{ marginRight: 8 }}
              >
                ▶
              </button>
            )}
            <h1>
              {activeTab === 'inbox'
                ? 'Inbox'
                : activeTab === 'today'
                ? 'Today'
                : activeTab === 'upcoming'
                ? 'Upcoming'
                : activeTab === 'p1'
                ? 'High Priority (P1)'
                : catById[activeTab]?.label || activeTab}
            </h1>
            <span style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
              {filteredTasks.filter((t) => !t.done).length} open
            </span>
          </div>

          <div className="todoist-header-actions">
            {/* GROUP BY CONTROL (The Ultimate Flexibility!) */}
            <div className="todoist-group-control">
              <span style={{ fontSize: 11, color: '#888', paddingLeft: 4 }}>Group:</span>
              <button
                className={`todoist-group-btn ${groupBy === 'status' ? 'active' : ''}`}
                onClick={() => {
                  soundTick()
                  setGroupBy('status')
                }}
                title="Group tasks by status: Backlog, To Do, In Progress, Done"
              >
                Status
              </button>
              <button
                className={`todoist-group-btn ${groupBy === 'priority' ? 'active' : ''}`}
                onClick={() => {
                  soundTick()
                  setGroupBy('priority')
                }}
                title="Group tasks by priority: P1 (Red), P2 (Orange), P3 (Blue)"
              >
                Priority
              </button>
              <button
                className={`todoist-group-btn ${groupBy === 'date' ? 'active' : ''}`}
                onClick={() => {
                  soundTick()
                  setGroupBy('date')
                }}
                title="Group tasks by due date: Today, Tomorrow, Upcoming"
              >
                Date
              </button>
              <button
                className={`todoist-group-btn ${groupBy === 'project' ? 'active' : ''}`}
                onClick={() => {
                  soundTick()
                  setGroupBy('project')
                }}
                title="Group tasks by project category"
              >
                Project
              </button>
            </div>

            {/* VIEW MODE TOGGLE */}
            <button
              className="todoist-action-btn"
              onClick={() => {
                soundTick()
                setViewMode(viewMode === 'board' ? 'list' : 'board')
              }}
              title="Toggle Kanban Board vs Dense List View"
            >
              {viewMode === 'board' ? '⊞ Board' : '☰ List'}
            </button>

            {/* AI DECOMPOSE BUTTON */}
            {features.ai && (
            <button
              className="todoist-action-btn"
              style={{ color: '#00d2ff', borderColor: 'rgba(0, 210, 255, 0.3)' }}
              onClick={() => {
                const sample = filteredTasks[0] || { title: 'Master Distributed Systems', category: 'university' }
                startDecomposition(sample)
              }}
              title="Break down any quest into subtasks with AI"
            >
              <span style={{ fontSize: 14 }}>✨</span> AI Decompose
            </button>
            )}
          </div>
        </header>

        {/* Quick Filter Bar */}
        <div className="todoist-filter-bar">
          <button
            className={`todoist-filter-chip ${filterPriority === 'all' ? 'active' : ''}`}
            onClick={() => setFilterPriority('all')}
          >
            All Priorities
          </button>
          <button
            className={`todoist-filter-chip ${filterPriority === 1 ? 'active' : ''}`}
            onClick={() => setFilterPriority(filterPriority === 1 ? 'all' : 1)}
          >
            🔴 P1 Urgent ({p1Open})
          </button>
          <button
            className={`todoist-filter-chip ${filterPriority === 2 ? 'active' : ''}`}
            onClick={() => setFilterPriority(filterPriority === 2 ? 'all' : 2)}
          >
            🟠 P2 Medium
          </button>
          <button
            className={`todoist-filter-chip ${filterPriority === 3 ? 'active' : ''}`}
            onClick={() => setFilterPriority(filterPriority === 3 ? 'all' : 3)}
          >
            🔵 P3 Normal
          </button>
          <button
            className={`todoist-filter-chip ${showDone ? 'active' : ''}`}
            onClick={() => setShowDone(!showDone)}
          >
            👁️ Completed ({doneCount})
          </button>
          <button
            className="todoist-filter-chip"
            onClick={() => setAddingProject(true)}
            style={{ color: '#00d2ff' }}
          >
            + New Project
          </button>
        </div>

        {/* 3. Empty State with Starter Quest Chips */}
        {filteredTasks.length === 0 && (
          <div className="todoist-starter-box">
            <span style={{ fontSize: 32 }}>⚔️</span>
            <strong style={{ fontSize: 16, color: '#fff', letterSpacing: '0.05em', fontFamily: 'var(--display)' }}>
              QUEST BOARD IS READY
            </strong>
            <p style={{ margin: 0, fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>
              No quests in this view. Pick a starter quest template or decompose a project with the System Oracle:
            </p>
            <div className="todoist-starter-chips">
              <button className="todoist-starter-chip" onClick={() => handleAddStarterQuest('study')}>
                + University Study Block
              </button>
              <button className="todoist-starter-chip" onClick={() => handleAddStarterQuest('workout')}>
                + Physical Strength Session
              </button>
              <button className="todoist-starter-chip" onClick={() => handleAddStarterQuest('p1')}>
                + Urgent P1 Objective
              </button>
              {features.ai && (
              <button
                className="todoist-starter-chip"
                style={{ borderColor: '#00d2ff', color: '#00d2ff' }}
                onClick={() => startDecomposition({ title: 'Finish Semester Project', category: 'university' })}
              >
                ✨ AI Decompose Quest
              </button>
              )}
            </div>
          </div>
        )}

        {/* 4. VIEW: Kanban Board (Horizontal Scrolling Columns) */}
        {viewMode === 'board' && filteredTasks.length > 0 && (
          <div className="todoist-board-container">
            {boardColumns.map((col) => (
              <div
                key={col.id}
                className={`todoist-column ${dragOverColId === col.id ? 'drag-over' : ''}`}
                onDragOver={(e) => handleDragOver(e, col.id)}
                onDragLeave={() => setDragOverColId(null)}
                onDrop={(e) => handleDrop(e, col.id)}
              >
                {/* Column Header */}
                <div className="todoist-col-header">
                  <div className="todoist-col-title">
                    <span style={{ color: col.color || '#fff' }}>●</span>
                    <span>{col.label}</span>
                    <span className="todoist-col-count">{col.tasks.length}</span>
                  </div>
                  <button
                    className="icon-btn"
                    title="Add task to this column"
                    onClick={() => {
                      setAddingInColumn(col.id)
                      setDraftTitle('')
                    }}
                    style={{ background: 'transparent', border: 0, color: '#888', cursor: 'pointer' }}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                </div>

                {/* Column Cards */}
                <div
                  className="todoist-col-cards"
                  onDragOver={(e) => handleDragOver(e, col.id)}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  {col.tasks.map((t) => {
                    const dateInfo = formatTodoistDate(t.due, t.repeat, todayStr)
                    return (
                      <div
                        key={t.id}
                        className={`todoist-card ${t.done ? 'done' : ''}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, t.id)}
                        onDragOver={(e) => handleDragOver(e, col.id)}
                        onDrop={(e) => handleDrop(e, col.id)}
                        onClick={() => setEditingTask(t)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            task: t
                          })
                        }}
                      >
                        <div className="todoist-card-top">
                          <button
                            className={`todoist-circle-check p${t.priority} ${t.done ? 'checked' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleToggle(t)
                            }}
                            title={t.done ? 'Mark incomplete' : 'Mark complete'}
                          />
                          <span className="todoist-card-title">{renderTitle(t.title)}</span>
                        </div>

                        {t.notes && <p className="todoist-card-notes">{t.notes}</p>}

                        {/* Card Footer */}
                        <div className="todoist-card-meta">
                          {dateInfo && (
                            <span className={`todoist-date-badge ${dateInfo.kind}`}>
                              {dateInfo.label}
                            </span>
                          )}

                          {catById[t.category] && groupBy !== 'project' && (
                            <span
                              className="todoist-project-tag"
                              style={{ color: catById[t.category]?.color || '#888' }}
                            >
                              # {catById[t.category]?.label}
                            </span>
                          )}

                          <span className="todoist-reward-badge">
                            +{t.coins} 🪙
                          </span>

                          <div className="todoist-card-actions">
                            {groupBy === 'status' && col.id === 'todo' && (
                              <>
                                <button
                                  className="card-action-mini-btn"
                                  title="Move to Backlog"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleMoveStatus(t, 'backlog')
                                  }}
                                >
                                  ◀ Backlog
                                </button>
                                <button
                                  className="card-action-mini-btn primary"
                                  title="Move to In Progress (P1)"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleMoveStatus(t, 'inprogress')
                                  }}
                                >
                                  ▶ Start
                                </button>
                              </>
                            )}
                            {groupBy === 'status' && col.id === 'backlog' && (
                              <button
                                className="card-action-mini-btn primary"
                                title="Move to To Do (Today)"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleMoveStatus(t, 'todo')
                                }}
                              >
                                ▶ To Do
                              </button>
                            )}
                            {groupBy === 'status' && col.id === 'inprogress' && (
                              <>
                                <button
                                  className="card-action-mini-btn"
                                  title="Move back to To Do"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleMoveStatus(t, 'todo')
                                  }}
                                >
                                  ◀ To Do
                                </button>
                                <button
                                  className="card-action-mini-btn success"
                                  title="Complete Quest"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleMoveStatus(t, 'done')
                                  }}
                                >
                                  ✅ Done
                                </button>
                              </>
                            )}
                            {features.ai && (
                            <button
                              className="card-action-mini-btn"
                              title="Decompose with AI"
                              onClick={(e) => {
                                e.stopPropagation()
                                startDecomposition(t)
                              }}
                            >
                              ✨ AI
                            </button>
                            )}
                            <button
                              className="card-action-mini-btn"
                              title="Edit Quest"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingTask(t)
                              }}
                            >
                              <Icon name="edit" size={11} />
                            </button>
                            <button
                              className="card-action-mini-btn danger"
                              title="Delete Quest"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteTask(t.id)
                              }}
                            >
                              <Icon name="trash" size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Inline Composer */}
                  {addingInColumn === col.id ? (
                    <div className="todoist-composer-box">
                      <input
                        type="text"
                        placeholder="Quest title..."
                        value={draftTitle}
                        autoFocus
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateTask(col.id)
                          if (e.key === 'Escape') setAddingInColumn(null)
                        }}
                      />
                      <input
                        type="text"
                        placeholder="Description / notes (optional)..."
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                      />
                      <div className="todoist-composer-actions">
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            className={`priority-chip ${draftPriority === 1 ? 'active' : ''}`}
                            onClick={() => setDraftPriority(1)}
                          >
                            P1
                          </button>
                          <button
                            type="button"
                            className={`priority-chip ${draftPriority === 2 ? 'active' : ''}`}
                            onClick={() => setDraftPriority(2)}
                          >
                            P2
                          </button>
                          <button
                            type="button"
                            className={`priority-chip ${draftPriority === 3 ? 'active' : ''}`}
                            onClick={() => setDraftPriority(3)}
                          >
                            P3
                          </button>
                        </div>

                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn small ghost" onClick={() => setAddingInColumn(null)}>
                            Cancel
                          </button>
                          <button className="btn small primary" onClick={() => handleCreateTask(col.id)}>
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="todoist-add-card-btn"
                      onClick={() => {
                        setAddingInColumn(col.id)
                        setDraftTitle('')
                      }}
                    >
                      + Add task
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 5. VIEW: Dense List View */}
        {viewMode === 'list' && filteredTasks.length > 0 && (
          <div style={{ padding: '18px 24px', overflowY: 'auto', flex: 1 }}>
            {boardColumns.map((col) => (
              <div key={col.id} className="todoist-list-section">
                <div className="todoist-list-section-header">
                  <span style={{ color: col.color || '#fff' }}>●</span>
                  <span>{col.label}</span>
                  <span style={{ fontSize: 11, color: '#888' }}>({col.tasks.length})</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {col.tasks.map((t) => {
                    const dateInfo = formatTodoistDate(t.due, t.repeat, todayStr)
                    return (
                      <div
                        key={t.id}
                        className={`todoist-card ${t.done ? 'done' : ''}`}
                        style={{ padding: '8px 12px' }}
                        onClick={() => setEditingTask(t)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            task: t
                          })
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <button
                              className={`todoist-circle-check p${t.priority} ${t.done ? 'checked' : ''}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleToggle(t)
                              }}
                            />
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>
                              {renderTitle(t.title)}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {dateInfo && (
                              <span className={`todoist-date-badge ${dateInfo.kind}`}>
                                {dateInfo.label}
                              </span>
                            )}
                            <span className="todoist-reward-badge">+{t.coins} 🪙</span>
                            {features.ai && (
                            <button
                              className="card-action-mini-btn"
                              title="AI Decompose"
                              onClick={(e) => {
                                e.stopPropagation()
                                startDecomposition(t)
                              }}
                            >
                              ✨ AI
                            </button>
                            )}
                            <button
                              className="card-action-mini-btn"
                              title="Edit Quest"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingTask(t)
                              }}
                            >
                              <Icon name="edit" size={11} />
                            </button>
                            <button
                              className="card-action-mini-btn danger"
                              title="Delete Quest"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteTask(t.id)
                              }}
                            >
                              <Icon name="trash" size={11} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 6. New Project Modal */}
      {addingProject && (
        <div className="decompose-modal-backdrop" onClick={() => setAddingProject(false)}>
          <div className="decompose-modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="decompose-modal-header">
              <span className="decompose-modal-title">📁 CREATE NEW PROJECT</span>
              <button
                className="icon-btn"
                onClick={() => setAddingProject(false)}
                style={{ background: 'none', border: 0, color: '#888', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Project Name</span>
              <input
                type="text"
                placeholder="e.g. Cybersecurity Lab, Side Business..."
                value={newProjectName}
                autoFocus
                onChange={(e) => setNewProjectName(e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  color: '#fff'
                }}
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Project Color</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PROJECT_COLOR_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewProjectColor(c)}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: c,
                      border: newProjectColor === c ? '3px solid #fff' : '1px solid rgba(0,0,0,0.4)',
                      cursor: 'pointer',
                      transform: newProjectColor === c ? 'scale(1.15)' : 'none'
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="decompose-actions-row">
              <button className="btn small ghost" onClick={() => setAddingProject(false)}>
                Cancel
              </button>
              <button
                className="btn small primary"
                disabled={!newProjectName.trim()}
                onClick={handleCreateProject}
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <TaskContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          task={contextMenu.task}
          onClose={() => setContextMenu(null)}
          onDelete={() => {
            handleDeleteTask(contextMenu.task.id)
            setContextMenu(null)
          }}
          onToggle={() => {
            handleToggle(contextMenu.task)
            setContextMenu(null)
          }}
          onEdit={() => {
            setEditingTask(contextMenu.task)
            setContextMenu(null)
          }}
          onDecompose={features.ai ? () => {
            startDecomposition(contextMenu.task)
            setContextMenu(null)
          } : undefined}
          onDuplicate={() => {
            handleDuplicateTask(contextMenu.task)
            setContextMenu(null)
          }}
          onSetPriority={(p) => {
            handleSetPriority(contextMenu.task, p)
            setContextMenu(null)
          }}
          onMoveStatus={(status) => {
            handleMoveStatus(contextMenu.task, status)
            setContextMenu(null)
          }}
          onSetDue={(due) => {
            handleSetDueDate(contextMenu.task, due)
            setContextMenu(null)
          }}
        />
      )}

      {/* 7. AI Quest Decomposition Modal */}
      {decomposeModal && (
        <div className="decompose-modal-backdrop" onClick={() => setDecomposeModal(null)}>
          <div className="decompose-modal" onClick={(e) => e.stopPropagation()}>
            <div className="decompose-modal-header">
              <div className="decompose-modal-title">
                <Icon name="spark" size={15} />
                <span>SOLO LEVELING QUEST DECOMPOSER</span>
              </div>
              <button
                className="icon-btn"
                onClick={() => setDecomposeModal(null)}
                style={{ background: 'transparent', border: 0, color: '#888', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>
              Target: <span style={{ color: '#00d2ff' }}>"{decomposeModal.taskTitle}"</span>
            </div>

            {decomposeModal.loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '36px 0' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid #00d2ff', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#38bdf8' }}>
                  Oracle decomposing quest vectors into tactical subtasks...
                </span>
              </div>
            ) : decomposeModal.result ? (
              <>
                <div className="decompose-strategy-tip">
                  <b>💡 Strategy:</b> {decomposeModal.result.strategyTip}
                </div>

                <div className="decompose-subtask-list">
                  {decomposeModal.result.subtasks.map((sub, i) => (
                    <div key={i} className="decompose-subtask-item">
                      <div className="decompose-subtask-left">
                        <span style={{ color: '#00d2ff', fontWeight: 700, fontFamily: 'var(--mono)' }}>#{i + 1}</span>
                        <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>{sub.title}</span>
                      </div>
                      <div className="decompose-subtask-badges">
                        <span style={{ fontFamily: 'var(--mono)', color: '#94a3b8' }}>⏱ {sub.minutes}m</span>
                        <span style={{ fontFamily: 'var(--mono)', color: '#38bdf8' }}>+{sub.coins} 🪙</span>
                        <span style={{ fontFamily: 'var(--mono)', color: '#c084fc' }}>+{sub.xp} XP</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="decompose-actions-row">
                  <button className="btn small ghost" onClick={() => setDecomposeModal(null)}>
                    Discard
                  </button>
                  <button className="btn small primary" onClick={handleApplySubtasks}>
                    ⚔️ Accept & Add Subtasks
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* 8. Edit Task Modal */}
      {editingTask && (
        <div className="decompose-modal-backdrop" onClick={() => setEditingTask(null)}>
          <div className="decompose-modal" style={{ width: 500 }} onClick={(e) => e.stopPropagation()}>
            <div className="decompose-modal-header">
              <span className="decompose-modal-title">EDIT QUEST OBJECTIVE</span>
              <button
                className="icon-btn"
                onClick={() => setEditingTask(null)}
                style={{ background: 'none', border: 0, color: '#888', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Title</span>
              <input
                type="text"
                value={editingTask.title}
                onChange={(e) => setEditingTask({ ...editingTask, title: e.target.value })}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  color: '#fff'
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Notes / Brief</span>
              <textarea
                rows={3}
                value={editingTask.notes || ''}
                onChange={(e) => setEditingTask({ ...editingTask, notes: e.target.value || null })}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  color: '#fff',
                  resize: 'vertical'
                }}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)' }}>Priority</span>
                <select
                  value={editingTask.priority}
                  onChange={(e) => setEditingTask({ ...editingTask, priority: Number(e.target.value) as 1 | 2 | 3 })}
                  style={{
                    background: '#1a2336',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: '#fff'
                  }}
                >
                  <option value={1}>P1 - Urgent (Red)</option>
                  <option value={2}>P2 - Medium (Orange)</option>
                  <option value={3}>P3 - Normal (Blue)</option>
                </select>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)' }}>Project</span>
                <select
                  value={editingTask.category}
                  onChange={(e) => setEditingTask({ ...editingTask, category: e.target.value })}
                  style={{
                    background: '#1a2336',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: '#fff'
                  }}
                >
                  {realProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="decompose-actions-row">
              <button
                className="btn small ghost"
                style={{ color: '#ef4444', marginRight: 'auto' }}
                onClick={() => {
                  life.tasks.archive(editingTask.id).then((next) => {
                    onState(next)
                    setEditingTask(null)
                  })
                }}
              >
                Delete Quest
              </button>
              <button className="btn small ghost" onClick={() => setEditingTask(null)}>
                Cancel
              </button>
              <button
                className="btn small primary"
                onClick={() => {
                  life.tasks.save(editingTask).then((next) => {
                    onState(next)
                    setEditingTask(null)
                  })
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// Tactical Solo Leveling Right-Click Context Menu
function TaskContextMenu({
  x,
  y,
  task,
  onClose,
  onDelete,
  onToggle,
  onEdit,
  onDecompose,
  onDuplicate,
  onSetPriority,
  onMoveStatus,
  onSetDue
}: {
  x: number
  y: number
  task: TaskView
  onClose: () => void
  onDelete: () => void
  onToggle: () => void
  onEdit: () => void
  onDecompose?: () => void
  onDuplicate: () => void
  onSetPriority: (p: 1 | 2 | 3) => void
  onMoveStatus: (status: 'backlog' | 'todo' | 'inprogress' | 'done') => void
  onSetDue: (due: string | null) => void
}) {
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const left = Math.min(x, window.innerWidth - 250)
  const top = Math.min(y, window.innerHeight - 380)

  return (
    <div
      ref={menuRef}
      className="task-context-menu"
      style={{ left: `${left}px`, top: `${top}px` }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cm-header">
        <span className="cm-title">{task.title}</span>
        <span className="cm-sub">{task.category} · {task.priority === 1 ? 'P1 Urgent' : task.priority === 2 ? 'P2 Medium' : 'P3 Normal'}</span>
      </div>

      <button className="cm-item danger" onClick={onDelete}>
        <Icon name="trash" size={14} />
        <span>Delete Quest</span>
      </button>

      <button className="cm-item" onClick={onEdit}>
        <Icon name="edit" size={14} />
        <span>Edit Quest Details</span>
      </button>

      <button className="cm-item" onClick={onToggle}>
        <Icon name="check" size={14} />
        <span>{task.done ? 'Mark Incomplete' : 'Mark as Complete (+Coins)'}</span>
      </button>

      {onDecompose && (
        <button className="cm-item" onClick={onDecompose}>
          <Icon name="spark" size={14} />
          <span>AI Subtask Decomposition</span>
        </button>
      )}

      <button className="cm-item" onClick={onDuplicate}>
        <Icon name="tasks" size={14} />
        <span>Duplicate Quest</span>
      </button>

      <div className="cm-divider" />

      <div className="cm-section-label">Move Status:</div>
      <div className="cm-pills-row">
        <button className="cm-mini-pill" onClick={() => onMoveStatus('backlog')}>Backlog</button>
        <button className="cm-mini-pill" onClick={() => onMoveStatus('todo')}>To Do</button>
        <button className="cm-mini-pill" onClick={() => onMoveStatus('inprogress')}>In Progress</button>
        <button className="cm-mini-pill" onClick={() => onMoveStatus('done')}>Done</button>
      </div>

      <div className="cm-section-label">Priority:</div>
      <div className="cm-pills-row">
        <button className={`cm-mini-pill ${task.priority === 1 ? 'active' : ''}`} style={{ color: '#ef4444' }} onClick={() => onSetPriority(1)}>🔴 P1</button>
        <button className={`cm-mini-pill ${task.priority === 2 ? 'active' : ''}`} style={{ color: '#f59e0b' }} onClick={() => onSetPriority(2)}>🟠 P2</button>
        <button className={`cm-mini-pill ${task.priority === 3 ? 'active' : ''}`} style={{ color: '#38bdf8' }} onClick={() => onSetPriority(3)}>🔵 P3</button>
      </div>

      <div className="cm-section-label">Due Date:</div>
      <div className="cm-pills-row">
        <button className="cm-mini-pill" onClick={() => onSetDue(new Date().toISOString().slice(0, 10))}>Today</button>
        <button className="cm-mini-pill" onClick={() => onSetDue(new Date(Date.now() + 86400000).toISOString().slice(0, 10))}>Tomorrow</button>
        <button className="cm-mini-pill" onClick={() => onSetDue(null)}>No Date</button>
      </div>
    </div>
  )
}
