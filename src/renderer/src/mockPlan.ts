import { dayKey } from '@core/dates'
import { effective, type LedgerEntry, type NewEntry } from '@core/ledger'
import {
  BLOCK_RULES, blockOn, DEFAULT_CATEGORIES, EVERY_DAY, isOverdue, planSkip, planTaskComplete,
  sortTasks, taskOn, TASKS_DAILY_COIN_CAP, validateBlock, validateTask, WORK_DAYS, type Block, type Task
} from '@core/plan'
import { planAward, type Rule } from '@core/rules'
import type { BlockView, Category, LifeApi, ScheduleState, TasksState } from '@shared/api'

interface Ctx {
  entries: LedgerEntry[]
  add: (e: NewEntry) => number
  rules: () => Rule[]
}

/** In-memory Tasks and Schedule for the browser demo. */
export function createMockPlan(ctx: Ctx): Pick<LifeApi, 'tasks' | 'schedule' | 'app'> {
  const today = () => dayKey(new Date())
  const categories: Category[] = DEFAULT_CATEGORIES.map((c) => ({ ...c }))
  let tasks: Task[] = [
    { id: 1, title: 'Morning skincare', category: 'face', coins: 5, xp: 10, priority: 2, due: null, repeat: 'daily', weekdays: 0, notes: null, createdDay: today() },
    { id: 2, title: 'Finish lab report', category: 'university', coins: 20, xp: 40, priority: 1, due: today(), repeat: 'none', weekdays: 0, notes: null, createdDay: today() },
    { id: 3, title: 'Log expenses', category: 'finance', coins: 5, xp: 10, priority: 3, due: null, repeat: 'daily', weekdays: 0, notes: null, createdDay: today() },
    { id: 4, title: '50 push-ups', category: 'body', coins: 10, xp: 20, priority: 2, due: null, repeat: 'weekly', weekdays: EVERY_DAY, notes: null, createdDay: today() },
    { id: 5, title: 'Call grandma', category: 'life', coins: 10, xp: 15, priority: 2, due: null, repeat: 'none', weekdays: 0, notes: null, createdDay: today() }
  ]
  const done: { taskId: number; day: string; ledgerId: number }[] = []
  let blocks: Block[] = [
    { id: 1, title: 'Math', kind: 'study', start: '09:00', minutes: 50, weekdays: WORK_DAYS, date: null, remindMin: 5, createdDay: today() },
    { id: 2, title: 'Programming', kind: 'study', start: '14:00', minutes: 90, weekdays: EVERY_DAY, date: null, remindMin: 10, createdDay: today() },
    { id: 3, title: 'Gym', kind: 'workout', start: '18:30', minutes: 60, weekdays: EVERY_DAY, date: null, remindMin: 15, createdDay: today() },
    { id: 4, title: 'Read before bed', kind: 'other', start: '22:30', minutes: 30, weekdays: EVERY_DAY, date: null, remindMin: 0, createdDay: today() }
  ]
  const logs = new Map<string, { status: BlockView['status']; startedAt: string | null }>()
  let keepInTray = true

  const live = () => new Set(effective(ctx.entries).map((e) => e.id))
  const daysFor = (id: number) => new Set(done.filter((d) => d.taskId === id && live().has(d.ledgerId)).map((d) => d.day))
  const coinsToday = () => effective(ctx.entries).filter((e) => e.module === 'tasks' && e.day === today()).reduce((s, e) => s + Math.max(0, e.coins), 0)

  const tasksState = (): TasksState => ({
    today: today(),
    categories,
    tasks: sortTasks(
      tasks
        .filter((t) => taskOn(t, today(), daysFor(t.id)))
        .map((t) => {
          const days = daysFor(t.id)
          return { ...t, done: t.repeat === 'none' ? days.size > 0 : days.has(today()), overdue: isOverdue(t, today(), days), lastDone: [...days].sort().pop() ?? null }
        })
    ),
    coinsToday: coinsToday(),
    dailyCap: TASKS_DAILY_COIN_CAP
  })

  const award = (ruleId: string | null, b: Block) => {
    if (!ruleId) return
    const rule = ctx.rules().find((r) => r.id === ruleId)
    if (!rule) return
    try {
      const now = new Date()
      ctx.add({ ...planAward(rule, ctx.entries, now, today(), b.title), ref: `block:${b.id}` })
    } catch {
      // over a limit: the block still counts, just without coins
    }
  }

  const scheduleState = (day = today()): ScheduleState => ({
    day,
    today: today(),
    blocks: blocks
      .filter((b) => blockOn(b, day))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => {
        const log = logs.get(`${b.id}:${day}`)
        const startsAt = new Date(`${day}T${b.start}:00`)
        return {
          ...b,
          day,
          status: log?.status ?? 'pending',
          startsAt: startsAt.toISOString(),
          endsAt: new Date(startsAt.getTime() + b.minutes * 60_000).toISOString(),
          startedAt: log?.startedAt ?? null,
          // The demo lets you finish right away; the real app needs 80% of the block.
          finishAllowedAt: log?.status === 'running' ? log.startedAt : null
        }
      }),
    all: blocks
  })

  const block = (id: number) => {
    const b = blocks.find((x) => x.id === id)
    if (!b) throw new Error('Block not found')
    return b
  }

  return {
    tasks: {
      state: async () => tasksState(),
      save: async (input) => {
        validateTask(input)
        tasks = input.id ? tasks.map((t) => (t.id === input.id ? { ...t, ...input, id: t.id } : t)) : [...tasks, { ...input, id: tasks.length + 1, createdDay: today() }]
        return tasksState()
      },
      archive: async (id) => {
        tasks = tasks.filter((t) => t.id !== id)
        return tasksState()
      },
      complete: async (id) => {
        const t = tasks.find((x) => x.id === id)!
        const { coins, xp } = planTaskComplete(t, today(), daysFor(id), coinsToday())
        const now = new Date()
        const ledgerId = ctx.add({ ts: now.toISOString(), day: today(), module: 'tasks', kind: 'earn', coins, xp, ref: `task:${id}`, note: t.title })
        done.push({ taskId: id, day: today(), ledgerId })
        return tasksState()
      },
      uncomplete: async (id) => {
        const row = done.filter((d) => d.taskId === id && live().has(d.ledgerId)).pop()
        if (!row) throw new Error('This task is not done')
        const now = new Date()
        ctx.add({ ts: now.toISOString(), day: today(), module: 'tasks', kind: 'undo', coins: 0, xp: 0, note: 'Task unticked', undoOf: row.ledgerId })
        return tasksState()
      },
      saveCategory: async (c) => {
        categories.push({ ...c, id: c.label.toLowerCase() })
        return tasksState()
      }
    },
    schedule: {
      state: async (day) => scheduleState(day),
      save: async (input) => {
        validateBlock(input)
        blocks = input.id ? blocks.map((b) => (b.id === input.id ? { ...b, ...input, id: b.id } : b)) : [...blocks, { ...input, id: blocks.length + 1, createdDay: today() }]
        return scheduleState()
      },
      archive: async (id) => {
        blocks = blocks.filter((b) => b.id !== id)
        return scheduleState()
      },
      start: async (id) => {
        block(id)
        if ([...logs.entries()].some(([k, v]) => k.endsWith(today()) && v.status === 'running')) throw new Error('Finish or skip the running block first')
        logs.set(`${id}:${today()}`, { status: 'running', startedAt: new Date().toISOString() })
        return scheduleState()
      },
      finish: async (id) => {
        const b = block(id)
        const log = logs.get(`${id}:${today()}`)
        if (log?.status !== 'running') throw new Error('Start the focus timer first')
        logs.set(`${id}:${today()}`, { status: 'done', startedAt: log?.startedAt ?? null })
        award(BLOCK_RULES[b.kind].done, b)
        return scheduleState()
      },
      skip: async (id) => {
        const b = block(id)
        planSkip(logs.get(`${id}:${today()}`)?.status ?? 'pending')
        logs.set(`${id}:${today()}`, { status: 'skipped', startedAt: null })
        award(BLOCK_RULES[b.kind].skipped, b)
        return scheduleState()
      }
    },
    app: {
      prefs: async () => ({ openAtLogin: false, canAutoStart: false, keepInTray }),
      setPrefs: async (p) => {
        if (p.keepInTray !== undefined) keepInTray = p.keepInTray
        return { openAtLogin: false, canAutoStart: false, keepInTray }
      }
    }
  }
}
