// Todoist ↔ the app, end to end, against a stateful fake Todoist (made-up
// tasks). A change made IN TODOIST (the phone, the Todoist app) must reach
// every surface within one change check: the Tasks page, Today → Now (other
// tasks, Top 3), the day plan, the island list and Ben's task context. And the
// app's own edits must reach Todoist (Tasks page, plan card, Top 3, Telegram).
//
// The chain is the real one: fake HTTP Todoist → createTodoistApi (the server)
// → todoistOp (the /api/todoist ops) → createTodoistClient (the browser queue)
// → createChangeWatch (the 5-second check) → the pure surface code.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTodoistApi, dueParts, todoistOp } from '../../../server/todoistApi'
import { createTodoistClient } from './todoistClient'
import { createChangeWatch } from './todoRefresh'
import { mergeRemote, planJobs, settle, type JobResult } from '@core/planSync'
import { ensureIds, planItems } from '@core/planEdit'
import { followMustDos, missingLinked } from '@core/todoFollow'
import { dedupeTodoist, dedupeTodos } from '@core/islandTodos'
import { isStarred, todayText, type TodoLookup, type TodoTask } from '@core/todoist'
import { addDays, calendarDay } from '@core/dates'
import type { DayProposal } from '@core/rhythm'
import type { PlanItem } from '@core/focus'

// ---- The fake Todoist (v1 REST + incremental sync) -----------------------------------

interface FakeTask {
  id: string
  content: string
  priority: number
  project_id: string
  section_id: string | null
  parent_id: string | null
  labels: string[]
  due: { date: string; is_recurring?: boolean; timezone?: string | null; string?: string } | null
  checked: boolean
  is_deleted: boolean
  seq: number
}

function createFakeTodoist() {
  let seq = 1
  const tasks = new Map<string, FakeTask>()
  const completed: { task_id: string; content: string; completed_at: string }[] = []
  const projects = [
    { id: 'p-inbox', name: 'Inbox', inbox_project: true },
    { id: 'p-uni', name: 'University' }
  ]
  const touch = (t: FakeTask) => (t.seq = ++seq)
  const add = (t: Partial<FakeTask> & { id: string; content: string }) => {
    const x: FakeTask = { priority: 1, project_id: 'p-inbox', section_id: null, parent_id: null, labels: [], due: null, checked: false, is_deleted: false, seq: 0, ...t }
    tasks.set(x.id, x)
    touch(x)
    return x
  }
  const today = () => calendarDay()
  const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } })
  const notFound = () => new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 })
  const live = () => [...tasks.values()].filter((t) => !t.checked && !t.is_deleted)
  const dueDay = (t: FakeTask) => (t.due ? String(t.due.date).slice(0, 10) : null)
  const filter = (q: string) => {
    const d = today()
    if (/^today \| overdue/.test(q)) return live().filter((t) => (dueDay(t) && dueDay(t)! <= d) || t.labels.includes('today'))
    if (/^tomorrow$/.test(q)) return live().filter((t) => dueDay(t) === addDays(d, 1))
    const m = /next (\d+) days/.exec(q)
    if (m) return live().filter((t) => dueDay(t) && dueDay(t)! >= d && dueDay(t)! <= addDays(d, Number(m[1]) - 1))
    return []
  }
  const out = (t: FakeTask) => {
    const { seq: _s, ...rest } = t
    return rest
  }
  const close = (t: FakeTask) => {
    completed.push({ task_id: t.id, content: t.content, completed_at: new Date().toISOString() })
    if (t.due?.is_recurring) t.due = { ...t.due, date: addDays(String(t.due.date).slice(0, 10), 1) + String(t.due.date).slice(10) }
    else t.checked = true
    touch(t)
  }

  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const path = url.pathname.replace(/^\/api\/v1/, '')
    const method = (init.method ?? 'GET').toUpperCase()
    if (!url.pathname.startsWith('/api/v1')) return notFound() // no older API in this fake
    if (path === '/projects') return json({ results: projects, next_cursor: null })
    if (path === '/sections') return json({ results: [], next_cursor: null })
    if (path === '/sync') {
      const token = new URLSearchParams(String(init.body)).get('sync_token') ?? '*'
      if (token === '*') return json({ sync_token: `s${seq}`, full_sync: true, items: live().map(out) })
      const since = Number(token.slice(1))
      return json({ sync_token: `s${seq}`, full_sync: false, items: [...tasks.values()].filter((t) => t.seq > since).map(out) })
    }
    if (path === '/tasks' && method === 'GET') return json({ results: live().map(out), next_cursor: null })
    if (path === '/tasks/filter') return json({ results: filter(url.searchParams.get('query') ?? '').map(out), next_cursor: null })
    if (path === '/tasks/completed/by_completion_date') return json({ items: completed.filter((c) => c.completed_at >= String(url.searchParams.get('since'))), next_cursor: null })
    if (path === '/tasks/quick') {
      const text = JSON.parse(String(init.body)).text as string
      const t = add({ id: `q${seq + 1}`, content: text.replace(/\s+tomorrow$/, ''), due: /tomorrow$/.test(text) ? { date: addDays(today(), 1) } : { date: today() } })
      return json(out(t))
    }
    const m = /^\/tasks\/([^/]+)(\/(close|reopen|move))?$/.exec(path)
    const t = m ? tasks.get(decodeURIComponent(m[1])) : undefined
    if (!m || !t || t.is_deleted) return notFound()
    if (method === 'GET') return json(out(t))
    if (method === 'DELETE') {
      t.is_deleted = true
      touch(t)
      return new Response(null, { status: 204 })
    }
    if (m[3] === 'close') return (close(t), new Response(null, { status: 204 }))
    if (m[3] === 'reopen') return ((t.checked = false), touch(t), new Response(null, { status: 204 }))
    if (m[3] === 'move') {
      const b = JSON.parse(String(init.body))
      if (b.project_id) t.project_id = b.project_id
      touch(t)
      return json(out(t))
    }
    // An update, the way Todoist reads it.
    const b = JSON.parse(String(init.body))
    if (b.content != null) t.content = b.content
    if (b.priority != null) t.priority = b.priority
    if (Array.isArray(b.labels)) t.labels = b.labels
    if (b.due_date) t.due = { date: b.due_date, is_recurring: t.due?.is_recurring ?? false }
    if (b.due_string) {
      const s = String(b.due_string)
      const mm = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(s)
      t.due = s === 'no date' ? null : mm ? { date: `${mm[1]}T${mm[2]}:00` } : t.due
    }
    touch(t)
    return json(out(t))
  }) as typeof fetch

  return {
    fetch: fetchImpl,
    add,
    /** What Todoist holds now (for the app → Todoist checks). */
    get: (id: string) => tasks.get(id)!,
    /** A change made in Todoist itself (the phone). */
    edit(id: string, f: (t: FakeTask) => void) {
      const t = tasks.get(id)!
      f(t)
      touch(t)
    },
    close: (id: string) => close(tasks.get(id)!),
    reopen(id: string) {
      const t = tasks.get(id)!
      t.checked = false
      touch(t)
    },
    remove(id: string) {
      const t = tasks.get(id)!
      t.is_deleted = true
      touch(t)
    }
  }
}

// ---- The app around it ----------------------------------------------------------------

const DAY = '2026-11-13' // a Friday
let fake: ReturnType<typeof createFakeTodoist>
let client: ReturnType<typeof createTodoistClient>
let watch: ReturnType<typeof createChangeWatch>
let failNextUpdate = false

function boot() {
  fake = createFakeTodoist()
  const api = createTodoistApi('fake-token', fake.fetch)
  const call = async (op: string, extra: Record<string, unknown> = {}) => {
    if (op === 'update' && failNextUpdate) {
      failNextUpdate = false
      throw new Error('Server busy')
    }
    const r = await todoistOp(api, { op, ...extra })
    if (!r) throw new Error('Unknown op')
    return r.json as any
  }
  client = createTodoistClient(call)
  watch = createChangeWatch((token) => client.changes(token))
}

/** Seeds the made-up day: tasks, the plan (a draft and an approved block), the Top 3. */
function seed() {
  // The approved plan block already gave the lab report its time (09:30).
  fake.add({ id: 'a', content: 'Write the lab report', priority: 4, due: { date: `${DAY}T09:30:00` }, labels: ['today'] })
  fake.add({ id: 'b', content: 'Pay the internet bill', due: { date: DAY } })
  fake.add({ id: 'c', content: 'Email the lab partner', due: { date: `${DAY}T16:00:00` } })
  fake.add({ id: 'd', content: 'Read chapter 4', due: { date: addDays(DAY, 1) } })
  fake.add({ id: 'e', content: 'Stretch for 10 minutes', due: { date: DAY, is_recurring: true, string: 'every day' } })
  fake.add({ id: 'f', content: 'Book the dentist', due: { date: DAY }, project_id: 'p-inbox' })
  fake.add({ id: 'g', content: 'Outline the essay', due: { date: DAY }, parent_id: 'a' })
}

const titles: Record<string, string> = { 'Write the lab report': 'a', 'Pay the internet bill': 'b', 'Email the lab partner': 'c', 'Read chapter 4': 'd', 'Stretch for 10 minutes': 'e', 'Book the dentist': 'f', 'Outline the essay': 'g' }
const idOf = (t: string) => titles[t]

function seedPlan(): DayProposal {
  let plan: DayProposal = ensureIds({
    day: DAY,
    headline: 'A made-up Friday',
    mustdos: ['Write the lab report'],
    blocks: [
      { title: 'Write the lab report', start: '09:30', minutes: 90, tasks: ['Write the lab report'] },
      { title: 'Book the dentist', start: '11:15', minutes: 15, tasks: ['Book the dentist'] },
      { title: 'Quick tasks', start: '13:00', minutes: 30, kind: 'quick', tasks: ['Pay the internet bill', 'Stretch for 10 minutes'] },
      { title: 'Outline the essay', start: '15:00', minutes: 30, tasks: ['Outline the essay'] }
    ],
    training: null,
    waterMl: 2500,
    also: [{ id: 'c', title: 'Email the lab partner', minutes: 15, priority: 1 }]
  })
  // The lab report block is approved on its own: it has its calendar memory and the task's time.
  plan = { ...plan, blocks: plan.blocks.map((b) => (b.title === 'Write the lab report' ? { ...b, ok: true } : b)) }
  const s = planJobs(plan, { status: 'proposed', taskId: idOf })
  const results: JobResult[] = s.jobs.map((j) => ({ id: j.id, from: j.from, ok: true, snap: j.snap, event: j.google?.kind === 'create' ? { id: 'ev1', calendarId: 'primary' } : undefined }))
  return settle(plan, results, s.closed)
}

const top3 = (): PlanItem[] => [
  { text: 'Write the lab report', done: false, todoistId: 'a' },
  { text: 'Book the dentist', done: false, todoistId: 'f' },
  { text: 'Call home', done: false }
]

/** Every surface, read the way its page reads it. */
async function surfaces(plan: DayProposal, must: PlanItem[]) {
  const today = await client.today()
  const all = (await client.everything()).tasks
  const missing = new Set<string>()
  for (const b of planItems(plan)) for (const t of b.tasks ?? []) if (idOf(t) && !today.some((x) => x.id === idOf(t))) missing.add(idOf(t)!)
  for (const id of missingLinked(must, today)) missing.add(id)
  const where: Map<string, TodoLookup> = missing.size ? await client.lookup([...missing]) : new Map()
  const merged = mergeRemote(plan, null, today, { where, idOf })
  const follow = followMustDos(must, today, where, DAY)
  const island = dedupeTodos({ mustdos: follow.items.map((m, i) => ({ i, text: m.text, done: m.done })), top: [], todoist: dedupeTodoist(today).map((t) => ({ id: t.id, content: t.content, time: t.dueTime })), max: 8 })
  return {
    tasksPage: all,
    other: today.filter((t) => !isStarred(t)).map((t) => t.content),
    starred: today.filter(isStarred).map((t) => t.content),
    top3: follow.items,
    plan: merged.plan,
    notes: merged.notes,
    island: [...island.mustdos.filter((m) => !m.done).map((m) => m.text), ...island.todoist.map((t) => t.content)],
    ben: todayText(today, DAY)
  }
}
const blockOf = (p: DayProposal, title: string) => p.blocks.find((b) => b.title === title)

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 13, 9, 0))
  failNextUpdate = false
  boot()
  seed()
  // The first check only starts the count (like the page opening).
  expect(await watch.check()).toBe(false)
})
afterEach(() => {
  vi.useRealTimers()
})

// ---- Todoist → the app: the table -----------------------------------------------------

describe('a change made in Todoist reaches every surface within one change check', () => {
  it('due today → tomorrow: gone from today everywhere, the draft block goes, "moved to tomorrow" is noted', async () => {
    fake.edit('f', (t) => (t.due = { date: addDays(DAY, 1) }))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.tasksPage.find((t) => t.id === 'f')?.due).toBe(addDays(DAY, 1))
    expect(s.other).not.toContain('Book the dentist')
    expect(s.top3.map((m) => m.text)).toEqual(['Write the lab report', 'Call home'])
    expect(blockOf(s.plan, 'Book the dentist')).toBeUndefined()
    expect(s.plan.deferred).toEqual([{ id: 'f', title: 'Book the dentist', why: 'moved to tomorrow in Todoist' }])
    expect(s.notes).toContain('Book the dentist moved to tomorrow in Todoist')
    expect(s.island).not.toContain('Book the dentist')
    expect(s.ben).not.toContain('Book the dentist')
  })

  it('tomorrow → today: on every list at once, and it leaves "moved to tomorrow"', async () => {
    fake.edit('d', (t) => (t.due = { date: DAY }))
    expect(await watch.check()).toBe(true)
    const plan = { ...seedPlan(), deferred: [{ id: 'd', title: 'Read chapter 4', why: 'moved to tomorrow in Todoist' }] }
    const s = await surfaces(plan, top3())
    expect(s.tasksPage.find((t) => t.id === 'd')?.due).toBe(DAY)
    expect(s.other).toContain('Read chapter 4')
    expect(s.island).toContain('Read chapter 4')
    expect(s.ben).toContain('Read chapter 4')
    expect(s.plan.deferred ?? []).toEqual([])
  })

  it('a time added in Todoist: the approved one-task block moves to it', async () => {
    fake.edit('a', (t) => (t.due = { date: `${DAY}T14:00:00` }))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.tasksPage.find((t) => t.id === 'a')).toMatchObject({ due: DAY, dueTime: '14:00' })
    expect(blockOf(s.plan, 'Write the lab report')?.start).toBe('14:00')
    expect(s.notes).toContain('Write the lab report moved to 14:00 in Todoist')
  })

  it('a time with a fixed time zone is read in that zone, not in UTC', () => {
    expect(dueParts({ date: '2026-11-13T22:30:00Z', timezone: 'Europe/Bucharest' })).toEqual({ due: '2026-11-14', dueTime: '00:30' })
    expect(dueParts({ date: '2026-11-13', datetime: '2026-11-13T07:00:00Z', timezone: 'America/New_York' })).toEqual({ due: '2026-11-13', dueTime: '02:00' })
    expect(dueParts({ date: '2026-11-13T15:00:00' })).toEqual({ due: '2026-11-13', dueTime: '15:00' })
    expect(dueParts({ date: '2026-11-13' })).toEqual({ due: '2026-11-13', dueTime: null })
  })

  it('the date taken off: off today, the draft block goes, "no date" is noted', async () => {
    fake.edit('f', (t) => (t.due = null))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.tasksPage.find((t) => t.id === 'f')?.due).toBeNull()
    expect(blockOf(s.plan, 'Book the dentist')).toBeUndefined()
    expect(s.notes).toContain('Book the dentist has no date in Todoist now')
    expect(s.top3.map((m) => m.text)).not.toContain('Book the dentist')
  })

  it('completed in Todoist: ticked in the plan (never closed twice), ticked in the Top 3, gone from the lists', async () => {
    fake.close('a')
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.tasksPage.some((t) => t.id === 'a')).toBe(false)
    expect(s.starred).toEqual([])
    expect(blockOf(s.plan, 'Write the lab report')?.done).toEqual(['Write the lab report'])
    expect(s.plan.closed).toContain('a')
    expect(planJobs(s.plan, { status: 'proposed', taskId: idOf }).ticks).toEqual([])
    expect(s.top3[0]).toEqual({ text: 'Write the lab report', done: true, todoistId: 'a' })
    expect(s.island).not.toContain('Write the lab report')
  })

  it('uncompleted in Todoist: back on today', async () => {
    fake.close('b')
    await watch.check()
    fake.reopen('b')
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.other).toContain('Pay the internet bill')
    expect(blockOf(s.plan, 'Quick tasks')?.done ?? []).toEqual([])
  })

  it('deleted in Todoist: it leaves the block and the Top 3, nothing is ticked', async () => {
    fake.remove('f')
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.tasksPage.some((t) => t.id === 'f')).toBe(false)
    expect(blockOf(s.plan, 'Book the dentist')).toBeUndefined()
    expect(s.plan.closed ?? []).not.toContain('f')
    expect(s.notes).toContain('Book the dentist was deleted in Todoist')
    expect(s.top3.map((m) => m.text)).toEqual(['Write the lab report', 'Call home'])
  })

  it('renamed in Todoist: the new name on the lists, the plan block, the must-dos and the Top 3', async () => {
    fake.edit('a', (t) => (t.content = 'Write the networking lab report'))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.starred).toEqual(['Write the networking lab report'])
    const b = s.plan.blocks.find((x) => x.tasks?.includes('Write the networking lab report'))
    expect(b?.title).toBe('Write the networking lab report')
    expect(b?.sync?.tasks?.[0].title).toBe('Write the networking lab report')
    expect(s.plan.mustdos).toEqual(['Write the networking lab report'])
    expect(s.top3[0].text).toBe('Write the networking lab report')
    expect(s.island).toContain('Write the networking lab report')
    // The new name is not sent back to Todoist as a rename of our own (only Google's event title follows).
    const jobs = planJobs(s.plan, { status: 'proposed', taskId: idOf }).jobs
    expect(jobs.flatMap((j) => j.todo).filter((t) => t.kind === 'rename')).toEqual([])
  })

  it('priority changed in Todoist: the lists show it', async () => {
    fake.edit('b', (t) => (t.priority = 3))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.tasksPage.find((t) => t.id === 'b')?.priority).toBe(3)
    expect(s.ben).toMatch(/🟠 <b>Pay the internet bill/)
  })

  it('moved to another project in Todoist: the Tasks page shows the new project', async () => {
    fake.edit('f', (t) => (t.project_id = 'p-uni'))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.tasksPage.find((t) => t.id === 'f')?.project).toBe('University')
  })

  it('a recurring task completed in Todoist: ticked today (it moved on to tomorrow), not "moved to tomorrow"', async () => {
    fake.close('e')
    expect(fake.get('e').due?.date).toBe(addDays(DAY, 1))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.other).not.toContain('Stretch for 10 minutes')
    expect(blockOf(s.plan, 'Quick tasks')?.done).toEqual(['Stretch for 10 minutes'])
    expect(s.plan.deferred ?? []).toEqual([])
  })

  it('a subtask moved to tomorrow in Todoist leaves today like any task', async () => {
    fake.edit('g', (t) => (t.due = { date: addDays(DAY, 1) }))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.other).not.toContain('Outline the essay')
    expect(blockOf(s.plan, 'Outline the essay')).toBeUndefined()
  })

  it('an approved block whose task moved away goes and its calendar event is cleared; Todoist is not written back', async () => {
    // Starred (@today) tasks stay on today's list whatever their date, so the star goes too here.
    fake.edit('a', (t) => ((t.due = { date: addDays(DAY, 1) }), (t.labels = [])))
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(s.plan.blocks.find((x) => x.start === '09:30')).toBeUndefined()
    expect(s.plan.removed).toEqual([expect.objectContaining({ eventId: 'ev1', calendarId: 'primary' })])
    expect(s.plan.mustdos).toEqual([])
    const jobs = planJobs(s.plan, { status: 'proposed', taskId: idOf })
    expect(jobs.jobs.map((j) => j.google?.kind)).toEqual(['remove'])
    expect(jobs.jobs.flatMap((j) => j.todo)).toEqual([]) // its new day in Todoist stays
  })

  it('a pinned block keeps its time when its task moves away; only the task leaves it', async () => {
    fake.edit('a', (t) => ((t.due = { date: addDays(DAY, 1) }), (t.labels = [])))
    expect(await watch.check()).toBe(true)
    const pinned = seedPlan()
    const plan = { ...pinned, blocks: pinned.blocks.map((b) => (b.start === '09:30' ? { ...b, locked: true } : b)) }
    const s = await surfaces(plan, top3())
    const b = s.plan.blocks.find((x) => x.start === '09:30')
    expect(b?.tasks).toEqual([])
    expect(s.plan.removed ?? []).toEqual([])
  })

  it('a task not known yet (Todoist did not answer the lookup) is left alone: never a guess', () => {
    const plan = seedPlan()
    const today: TodoTask[] = []
    const r = mergeRemote(plan, null, today, { where: new Map(), idOf })
    expect(r.plan).toBe(plan)
    expect(followMustDos(top3(), today, new Map(), DAY).changed).toBe(false)
  })
})

// ---- Your edit waiting vs Todoist's newer change ---------------------------------------

describe('a waiting edit never beats a newer change made in Todoist', () => {
  it('the same field changed in Todoist after a failed save: Todoist wins and the edit is dropped', async () => {
    await client.today() // the app has seen the task
    failNextUpdate = true
    await expect(client.update('b', { due: 'tomorrow' })).rejects.toThrow(/Couldn't save/)
    expect(client.queue.pending).toBe(1)
    // Meanwhile, on the phone: the bill moved to Monday.
    fake.edit('b', (t) => (t.due = { date: addDays(DAY, 3) }))
    expect(await watch.check()).toBe(true)
    expect(client.queue.pending).toBe(0)
    expect(client.queue.replaced()).toEqual({ b: ['due'] })
    const all = (await client.everything()).tasks
    expect(all.find((t) => t.id === 'b')?.due).toBe(addDays(DAY, 3))
  })

  it('a different field changed in Todoist: your edit still goes out', async () => {
    await client.today()
    failNextUpdate = true
    await expect(client.update('b', { priority: 4 })).rejects.toThrow()
    fake.edit('b', (t) => (t.content = 'Pay the internet bill online'))
    await watch.check()
    expect(client.queue.pending).toBe(1)
    client.retryDue(true)
    await vi.waitFor(() => expect(fake.get('b').priority).toBe(4))
    expect(fake.get('b').content).toBe('Pay the internet bill online')
  })

  it('an edit kept from an earlier visit is settled by the first read: no edit waits forever', async () => {
    const store = { v: JSON.stringify([{ id: 'b', patch: { due: addDays(DAY, 2) }, base: { id: 'b', content: 'Pay the internet bill', priority: 1, due: DAY, dueTime: null, project: null, recurring: false }, tries: 3 }]), get() { return this.v }, set(v: string) { this.v = v } }
    const api = createTodoistApi('fake-token', fake.fetch)
    fake.edit('b', (t) => (t.due = { date: addDays(DAY, 5) })) // changed in Todoist since
    const c2 = createTodoistClient(async (op, extra = {}) => (await todoistOp(api, { op, ...extra }))!.json as any, { store })
    expect(c2.queue.pending).toBe(1)
    const today = await c2.everything()
    expect(c2.queue.pending).toBe(0)
    expect(today.tasks.find((t) => t.id === 'b')?.due).toBe(addDays(DAY, 5))
  })

  it('a task done in Todoist drops the edit waiting for it', async () => {
    await client.today()
    failNextUpdate = true
    await expect(client.update('b', { priority: 2 })).rejects.toThrow()
    fake.close('b')
    await watch.check()
    expect(client.queue.pending).toBe(0)
  })
})

// ---- The app → Todoist ----------------------------------------------------------------

describe('the app changes reach Todoist', () => {
  it('Tasks page: tomorrow becomes a plain date; priority P1 is 4; the change check does not count it as "from Todoist"', async () => {
    await client.everything()
    await client.update('b', { due: 'tomorrow', priority: 4 })
    expect(fake.get('b').due?.date).toBe(addDays(DAY, 1))
    expect(fake.get('b').priority).toBe(4)
    await watch.check()
    expect(watch.take()).toBe(0)
  })

  it('a change made in Todoist itself is counted for "2 changes from Todoist"', async () => {
    fake.edit('b', (t) => (t.priority = 2))
    fake.edit('c', (t) => (t.content = 'Email the lab partner today'))
    await watch.check()
    expect(watch.take()).toBe(2)
    expect(watch.info().error).toBeNull()
  })

  it('the plan card: an approved block gives its task a time; a tick closes it once', async () => {
    let plan = seedPlan()
    expect(fake.get('a').due?.date).toBe(`${DAY}T09:30:00`) // the time the approved block gave it
    const s = planJobs(plan, { status: 'proposed', taskId: idOf })
    expect(s.jobs).toEqual([])
    const run = async (p: DayProposal) => {
      const jobs = planJobs(p, { status: 'proposed', taskId: idOf })
      for (const op of [...jobs.jobs.flatMap((j) => j.todo), ...jobs.ticks]) {
        if (op.kind === 'time') await client.update(op.taskId, { due: op.due, duration: op.duration })
        if (op.kind === 'close') await client.close(op.taskId)
      }
      return jobs
    }
    // Dragged to 10:00: Todoist gets the new time.
    plan = { ...plan, blocks: plan.blocks.map((b) => (b.title === 'Write the lab report' ? { ...b, start: '10:00' } : b)) }
    await run(plan)
    expect(fake.get('a').due?.date).toBe(`${DAY}T10:00:00`)
    // Ticked: closed in Todoist once.
    plan = { ...plan, blocks: plan.blocks.map((b) => (b.title === 'Write the lab report' ? { ...b, done: ['Write the lab report'] } : b)) }
    const j = await run(plan)
    expect(j.ticks).toEqual([{ kind: 'close', taskId: 'a', title: 'Write the lab report' }])
    expect(fake.get('a').checked).toBe(true)
  })

  it('Top 3: un-starring takes the today label off in Todoist', async () => {
    await client.today()
    await client.update('a', { labels: [] })
    expect(fake.get('a').labels).toEqual([])
  })

  it('Telegram: the server writes straight to Todoist and the app sees it on the next check', async () => {
    const api = createTodoistApi('fake-token', fake.fetch)
    await api.update('f', { due: addDays(DAY, 1) })
    expect(await watch.check()).toBe(true)
    const s = await surfaces(seedPlan(), top3())
    expect(blockOf(s.plan, 'Book the dentist')).toBeUndefined()
  })

  it('Todoist not answering: the check says so (for "Can\'t reach Todoist"), the lists keep what they had', async () => {
    const broken = createChangeWatch(async () => {
      throw new Error('Todoist 503')
    })
    await broken.check()
    expect(broken.ok).toBe(false)
    expect(broken.info().error).toBe('Todoist 503')
  })
})
