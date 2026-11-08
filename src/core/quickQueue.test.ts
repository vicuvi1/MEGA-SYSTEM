import { describe, expect, it, vi } from 'vitest'
import { createQuickQueue, QuickRefused, type QItem } from './quickQueue'

type R = { kind: 'water'; ml: number } | { kind: 'task'; text: string }

/** A fake database: rows by id, a second insert of the same id is ignored (like body_log). */
function fakeDb(o: { delayMs?: number; failTimes?: number } = {}) {
  const rows = new Map<string, number>()
  let fails = o.failTimes ?? 0
  const calls: string[] = []
  return {
    rows,
    calls,
    run: async (r: R, id: string) => {
      calls.push(id)
      if (o.delayMs) await new Promise((res) => setTimeout(res, o.delayMs))
      if (fails > 0) {
        fails--
        throw new Error('offline')
      }
      if (!rows.has(id)) rows.set(id, r.kind === 'water' ? r.ml : 1)
      return { id }
    },
    undo: async (_r: R, id: string) => void rows.delete(id),
    total: () => [...rows.values()].reduce((a, b) => a + b, 0)
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const memStore = () => {
  let v: string | null = null
  return { get: () => v, set: (x: string) => void (v = x) }
}

describe('quickQueue: instant', () => {
  it('shows the item before the write finishes (< 100 ms with a slow fake DB)', async () => {
    const db = fakeDb({ delayMs: 300 })
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo })
    let seenAt = 0
    q.subscribe((list) => {
      if (!seenAt && list.length) seenAt = performance.now()
    })
    const t0 = performance.now()
    const it1 = q.submit({ kind: 'water', ml: 500 }, '500 ml water added')
    const shown = performance.now() - t0
    expect(it1.status).toBe('saving')
    expect(q.items()).toHaveLength(1)
    expect(seenAt - t0).toBeLessThan(100)
    expect(shown).toBeLessThan(100)
    expect(db.rows.size).toBe(0)
    await new Promise((r) => setTimeout(r, 350))
    expect(q.items()[0].status).toBe('saved')
    expect(db.total()).toBe(500)
  })
  it('100 quick adds in a row stay under the budget each', () => {
    const db = fakeDb({ delayMs: 50 })
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo })
    let worst = 0
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now()
      q.submit({ kind: 'water', ml: 10 }, 'x')
      worst = Math.max(worst, performance.now() - t0)
    }
    expect(worst).toBeLessThan(100)
  })
})

describe('quickQueue: undo', () => {
  it('takes back a saved write', async () => {
    const db = fakeDb()
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo })
    const it1 = q.submit({ kind: 'water', ml: 250 }, 'x')
    await flush()
    await flush()
    expect(db.total()).toBe(250)
    expect(await q.undo(it1.id)).toBe(true)
    expect(db.total()).toBe(0)
    expect(q.items()[0].status).toBe('undone')
    expect(await q.undo(it1.id)).toBe(false)
  })
  it('undo while the write is on its way: undone at once, taken back when it lands', async () => {
    const db = fakeDb({ delayMs: 40 })
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo })
    const it1 = q.submit({ kind: 'water', ml: 250 }, 'x')
    await flush()
    expect(await q.undo(it1.id)).toBe(true)
    expect(q.items()[0].status).toBe('undone')
    await new Promise((r) => setTimeout(r, 60))
    expect(db.total()).toBe(0)
    expect(q.items()[0].status).toBe('undone')
  })
  it('undo before the write starts: nothing is sent', async () => {
    const db = fakeDb()
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo })
    const it1 = q.submit({ kind: 'water', ml: 250 }, 'x')
    expect(await q.undo(it1.id)).toBe(true)
    await flush()
    expect(db.calls).toHaveLength(0)
  })
  it('only for 5 s', async () => {
    let t = 1000
    const db = fakeDb()
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo, now: () => t })
    const it1 = q.submit({ kind: 'water', ml: 250 }, 'x')
    await flush()
    t += 5001
    expect(await q.undo(it1.id)).toBe(false)
    expect(db.total()).toBe(250)
  })
})

describe('quickQueue: retry and idempotency', () => {
  it('a failed write is kept as "will sync" and retried with the same id', async () => {
    const db = fakeDb({ failTimes: 2 })
    const timers: (() => void)[] = []
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo, schedule: (fn) => void timers.push(fn) })
    const it1 = q.submit({ kind: 'water', ml: 500 }, 'x')
    await flush()
    expect(q.items()[0]).toMatchObject({ status: 'will-sync', tries: 1, error: 'offline' })
    expect(q.waiting()).toBe(1)
    timers.shift()!()
    await flush()
    expect(q.items()[0]).toMatchObject({ status: 'will-sync', tries: 2 })
    timers.shift()!()
    await flush()
    expect(q.items()[0].status).toBe('saved')
    expect(new Set(db.calls)).toEqual(new Set([it1.id]))
    expect(db.total()).toBe(500)
  })
  it('backoff grows and stops at the last wait', async () => {
    const db = fakeDb({ failTimes: 5 })
    const waits: number[] = []
    const timers: (() => void)[] = []
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo, retryMs: [10, 20, 30], schedule: (fn, ms) => (waits.push(ms), void timers.push(fn)) })
    q.submit({ kind: 'water', ml: 1 }, 'x')
    for (let i = 0; i < 5; i++) {
      await flush()
      timers.shift()?.()
    }
    expect(waits.slice(0, 5)).toEqual([10, 20, 30, 30, 30])
  })
  it('the same tap sent twice (same id) counts once', async () => {
    const db = fakeDb()
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo })
    const a = q.submit({ kind: 'water', ml: 500 }, 'x', 'tap-1')
    const b = q.submit({ kind: 'water', ml: 500 }, 'x', 'tap-1')
    expect(a.id).toBe(b.id)
    await flush()
    expect(q.items()).toHaveLength(1)
    expect(db.total()).toBe(500)
  })
  it('a lost answer retried with the same id does not double-count', async () => {
    const rows = new Map<string, number>()
    let first = true
    const run = vi.fn(async (r: R, id: string) => {
      if (!rows.has(id)) rows.set(id, (r as any).ml)
      if (first) {
        first = false
        throw new Error('timeout') // saved, but the answer was lost
      }
      return null
    })
    const timers: (() => void)[] = []
    const q = createQuickQueue<R>({ run, undo: async () => {}, schedule: (fn) => void timers.push(fn) })
    q.submit({ kind: 'water', ml: 500 }, 'x')
    await flush()
    timers.shift()!()
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
    expect([...rows.values()].reduce((a, b) => a + b, 0)).toBe(500)
  })
  it('undo of a "will sync" item cancels it: never sent again', async () => {
    const db = fakeDb({ failTimes: 1 })
    const timers: (() => void)[] = []
    const q = createQuickQueue<R>({ run: db.run, undo: db.undo, schedule: (fn) => void timers.push(fn) })
    const it1 = q.submit({ kind: 'water', ml: 500 }, 'x')
    await flush()
    expect(await q.undo(it1.id)).toBe(true)
    timers.shift()!()
    await flush()
    expect(db.calls).toHaveLength(1)
    expect(db.total()).toBe(0)
  })
})

describe('quickQueue: refused', () => {
  it('a refusal is shown and never retried', async () => {
    const timers: (() => void)[] = []
    const run = vi.fn(async () => {
      throw new QuickRefused('Connect Todoist to add tasks')
    })
    const q = createQuickQueue<R>({ run, undo: async () => {}, schedule: (fn) => void timers.push(fn) })
    q.submit({ kind: 'task', text: 'x' }, 'x')
    await flush()
    expect(q.items()[0]).toMatchObject({ status: 'refused', error: 'Connect Todoist to add tasks' })
    expect(timers).toHaveLength(0)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('quickQueue: never lost across a reload', () => {
  it('waiting items are kept, replayed with the same id when safe, "unsure" when not', async () => {
    const store = memStore()
    const failing = fakeDb({ failTimes: 99 })
    const q1 = createQuickQueue<R>({ run: failing.run, undo: failing.undo, store, schedule: () => {} })
    const w = q1.submit({ kind: 'water', ml: 500 }, 'water')
    const t = q1.submit({ kind: 'task', text: 'call mom' }, 'task')
    await flush()
    const kept = JSON.parse(store.get()!) as QItem<R>[]
    expect(kept.map((i) => i.id)).toEqual([w.id, t.id])

    const db = fakeDb()
    const q2 = createQuickQueue<R>({ run: db.run, undo: db.undo, store, canReplay: (r) => r.kind === 'water' })
    q2.restore()
    await flush()
    await flush()
    const byId = Object.fromEntries(q2.items().map((i) => [i.id, i]))
    expect(byId[w.id].status).toBe('saved')
    expect(byId[t.id].status).toBe('unsure')
    expect(db.calls).toEqual([w.id])
    q2.dismiss(t.id)
    expect(JSON.parse(store.get()!)).toEqual([])
  })
})
