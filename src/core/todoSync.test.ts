import { describe, expect, it } from 'vitest'
import { fromApiPriority, pLabel, toApiPriority, type TodoTask } from './todoist'
import { applyPatch, createTodoQueue, diffPatch, onTodayList, resolveDue, retryable, type TaskPatch } from './todoSync'

const task = (over: Partial<TodoTask> = {}): TodoTask => ({ id: 'a1', content: 'Read chapter 4', priority: 1, due: null, dueTime: null, project: 'Inbox', recurring: false, labels: [], duration: null, ...over })

/** A fake Todoist: records each write, answers with the task as it now is. */
function fakeTodoist(start: TodoTask[]) {
  const tasks = new Map(start.map((t) => [t.id, { ...t }]))
  const writes: { id: string; patch: TaskPatch }[] = []
  let offline = false
  let hold: Promise<void> | null = null
  return {
    tasks,
    writes,
    set offline(v: boolean) {
      offline = v
    },
    holdNext() {
      let go!: () => void
      hold = new Promise<void>((ok) => (go = ok))
      return go
    },
    send: async (id: string, patch: TaskPatch) => {
      if (hold) {
        const h = hold
        hold = null
        await h
      }
      if (offline) throw new TypeError('Failed to fetch')
      const t = tasks.get(id)
      if (!t) throw new Error('Todoist 404: Task not found')
      writes.push({ id, patch })
      const next = applyPatch(t, patch)
      tasks.set(id, next)
      return next
    }
  }
}

const memStore = () => {
  let v: string | null = null
  return { get: () => v, set: (s: string) => void (v = s), get raw() {
    return v
  } }
}

describe('priority: one mapping everywhere', () => {
  it('P1 is Todoist 4, P4 is Todoist 1, and back', () => {
    expect([1, 2, 3, 4].map(toApiPriority)).toEqual([4, 3, 2, 1])
    expect([4, 3, 2, 1].map(fromApiPriority)).toEqual([1, 2, 3, 4])
    expect(pLabel(4)).toBe('P1')
    expect(pLabel(1)).toBe('P4')
    expect(toApiPriority(0)).toBe(4) // nonsense reads as P1? no: clamps to 1 → 4
    expect(toApiPriority(9)).toBe(1)
  })
})

describe('"today" is your own date', () => {
  it('uses your time zone, also near midnight', () => {
    // 22:30 UTC is already 00:30 the next day in Chisinau (UTC+2).
    const late = new Date('2026-11-08T22:30:00Z')
    expect(resolveDue('today', late, 'Europe/Chisinau')).toBe('2026-11-09')
    expect(resolveDue('today', late, 'UTC')).toBe('2026-11-08')
    expect(resolveDue('tomorrow', late, 'Europe/Chisinau')).toBe('2026-11-10')
    expect(resolveDue('today 18:00', late, 'UTC')).toBe('2026-11-08 18:00')
    expect(resolveDue('tomorrow at 9', late, 'UTC')).toBe('2026-11-09 09:00')
    expect(resolveDue('', late)).toBe('no date')
    expect(resolveDue('friday 18:00', late)).toBe('friday 18:00')
  })
  it('today\'s list holds due today, late, and starred tasks', () => {
    const keep = onTodayList('2026-11-08')
    expect(keep(task({ due: '2026-11-08' }))).toBe(true)
    expect(keep(task({ due: '2026-11-07' }))).toBe(true)
    expect(keep(task({ due: '2026-11-09' }))).toBe(false)
    expect(keep(task({ labels: ['today'] }))).toBe(true)
  })
})

describe('only what changed is sent', () => {
  it('drops fields equal to the task as last seen', () => {
    const t = task({ priority: 4, due: '2026-11-08', labels: ['b', 'a'] })
    expect(diffPatch(t, { priority: 4, due: '2026-11-08', labels: ['a', 'b'], content: 'New name' })).toEqual({ content: 'New name' })
    expect(diffPatch(undefined, { priority: 4 })).toEqual({ priority: 4 })
  })
  it('retryable: offline and server trouble yes; a task gone or a bad value no', () => {
    expect(retryable(new TypeError('Failed to fetch'))).toBe(true)
    expect(retryable(new Error('Todoist 503: busy'))).toBe(true)
    expect(retryable(new Error('Todoist is not answering: trying again at 12:04'))).toBe(true)
    expect(retryable(new Error('Todoist 404: Task not found'))).toBe(false)
    expect(retryable(new Error('Todoist 400: Invalid argument value'))).toBe(false)
  })
})

describe('the edit queue', () => {
  it('set priority: Todoist gets priority 4 (P1), confirmed, and the row says saved', async () => {
    const fake = fakeTodoist([task()])
    const q = createTodoQueue({ send: fake.send })
    const done = q.edit('a1', { priority: toApiPriority(1) }, task())
    expect(q.status().a1.state).toBe('saving')
    await done
    expect(fake.writes).toEqual([{ id: 'a1', patch: { priority: 4 } }])
    expect(q.status().a1.state).toBe('saved')
    expect(q.pending).toBe(0)
  })

  it('set due today on a task with no date: it joins today\'s list right away', async () => {
    const fake = fakeTodoist([task()])
    const q = createTodoQueue({ send: fake.send })
    const go = fake.holdNext()
    const done = q.edit('a1', { due: '2026-11-08' }, task())
    // Todoist's today list doesn't have it yet; the overlay adds it.
    expect(q.overlay([], 0, onTodayList('2026-11-08')).map((t) => t.id)).toEqual(['a1'])
    go()
    await done
    expect(fake.tasks.get('a1')!.due).toBe('2026-11-08')
  })

  it('set due tomorrow, and both priority and due at once: one write with both', async () => {
    const fake = fakeTodoist([task()])
    const q = createTodoQueue({ send: fake.send })
    await q.edit('a1', { due: '2026-11-09' }, task())
    await q.edit('a1', { priority: 3, due: '2026-11-08' }, fake.tasks.get('a1'))
    expect(fake.writes.map((w) => w.patch)).toEqual([{ due: '2026-11-09' }, { priority: 3, due: '2026-11-08' }])
  })

  it('a refresh arriving between the click and the write does not undo your edit', async () => {
    const fake = fakeTodoist([task()])
    let clock = 1000
    const q = createTodoQueue({ send: fake.send, now: () => clock })
    const go = fake.holdNext()
    const readStarted = clock
    const done = q.edit('a1', { priority: 4, due: '2026-11-08' }, task())
    clock += 500
    // The old value comes back from Todoist while the write is on its way.
    const stale = q.overlay([task()], readStarted)
    expect(stale[0]).toMatchObject({ priority: 4, due: '2026-11-08' })
    go()
    clock += 500
    await done
    // A read that started before the confirm still shows the confirmed value.
    expect(q.overlay([task()], readStarted)[0].priority).toBe(4)
    // A read after the confirm shows Todoist as it is (a later change made in Todoist wins).
    clock += 100
    expect(q.overlay([task({ priority: 2 })], clock)[0].priority).toBe(2)
  })

  it('edit offline, reload, come back online: the write is not lost', async () => {
    const fake = fakeTodoist([task()])
    fake.offline = true
    const store = memStore()
    const q = createTodoQueue({ send: fake.send, store })
    await expect(q.edit('a1', { priority: 4, due: '2026-11-08' }, task())).rejects.toThrow('Failed to fetch')
    expect(q.status().a1).toMatchObject({ state: 'failed' })
    // The list still shows your edit, not Todoist's old value.
    expect(q.overlay([task()], 0)[0].priority).toBe(4)
    // Reload: a new queue from what was kept.
    const q2 = createTodoQueue({ send: fake.send, store })
    expect(q2.pending).toBe(1)
    fake.offline = false
    await q2.retry('a1')
    expect(fake.writes).toEqual([{ id: 'a1', patch: { priority: 4, due: '2026-11-08' } }])
    expect(q2.pending).toBe(0)
    expect(JSON.parse(store.raw!)).toEqual([])
  })

  it('retryDue waits for the backoff, then sends', async () => {
    const fake = fakeTodoist([task()])
    fake.offline = true
    let clock = 0
    const q = createTodoQueue({ send: fake.send, now: () => clock })
    await q.edit('a1', { priority: 2 }, task()).catch(() => null)
    fake.offline = false
    q.retryDue()
    await Promise.resolve()
    expect(fake.writes.length).toBe(0)
    clock += 6000
    q.retryDue()
    await new Promise((ok) => setTimeout(ok, 0))
    expect(fake.writes.length).toBe(1)
  })

  it('a task Todoist no longer has: the edit is dropped, not retried forever', async () => {
    const fake = fakeTodoist([])
    const q = createTodoQueue({ send: fake.send })
    await expect(q.edit('zz', { priority: 4 })).rejects.toThrow('404')
    expect(q.pending).toBe(0)
  })

  it('a second edit while the first is on its way goes right after, merged', async () => {
    const fake = fakeTodoist([task()])
    const q = createTodoQueue({ send: fake.send })
    const go = fake.holdNext()
    const a = q.edit('a1', { priority: 4 }, task())
    const b = q.edit('a1', { due: '2026-11-08' })
    go()
    await Promise.all([a, b])
    expect(fake.writes.map((w) => w.patch)).toEqual([{ priority: 4 }, { priority: 4, due: '2026-11-08' }])
    expect(fake.tasks.get('a1')).toMatchObject({ priority: 4, due: '2026-11-08' })
    expect(q.pending).toBe(0)
  })

  it('nothing changed: nothing is sent', async () => {
    const fake = fakeTodoist([task({ priority: 4 })])
    const q = createTodoQueue({ send: fake.send })
    await q.edit('a1', { priority: 4 }, task({ priority: 4 }))
    expect(fake.writes).toEqual([])
  })
})
