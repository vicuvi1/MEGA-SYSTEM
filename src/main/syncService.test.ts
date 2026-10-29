import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Discipline } from './discipline'
import { MoneyService } from './money'
import { Body } from './body'
import { Tasks } from './planner'
import { SleepService } from './sleep'
import { SyncService } from './syncService'

let dir: string
let db: DB
let wallet: Wallet
let discipline: Discipline
let money: MoneyService
let body: Body
let tasks: Tasks
let sleep: SleepService
let sync: SyncService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-sync-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  discipline = new Discipline(db, wallet)
  money = new MoneyService(db, wallet)
  body = new Body(db, wallet)
  tasks = new Tasks(db, wallet)
  sleep = new SleepService(db, wallet)
  sync = new SyncService(db, wallet, discipline, money, body, tasks, sleep)
})

afterEach(() => {
  sync.stop()
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('SyncService', () => {
  it('loads and saves config cleanly', () => {
    const initial = sync.getConfig()
    expect(initial.autoSyncOnStartup).toBe(true)

    const updated = sync.saveConfig({
      syncUrl: 'https://test-worker.workers.dev',
      syncSecret: 'secret_123',
      syncIntervalMinutes: 30
    })

    expect(updated.syncUrl).toBe('https://test-worker.workers.dev')
    expect(updated.syncSecret).toBe('secret_123')
    expect(updated.syncIntervalMinutes).toBe(30)
  })

  it('pulls events, applies checkins and expenses, and saves to applied_sync_events', async () => {
    discipline.setStart('2026-10-20', new Date('2026-10-20T10:00:00Z'))

    // Mock fetch for GET /api/sync and POST /api/ack
    const mockEvents = [
      {
        id: 'evt_101',
        type: 'checkin',
        day: '2026-10-25',
        ts: '2026-10-25T14:00:00Z',
        payload: {},
        source: 'telegram_bot'
      },
      {
        id: 'evt_102',
        type: 'expense',
        day: '2026-10-25',
        ts: '2026-10-25T15:30:00Z',
        payload: { amountBani: 4500, category: 'food', note: 'Coffee and croissant' },
        source: 'telegram_bot'
      }
    ]

    const fetchMock = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/sync')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, count: mockEvents.length, events: mockEvents })
        })
      }
      if (url.includes('/api/ack')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, acknowledged: 2 })
        })
      }
      return Promise.reject(new Error(`Unexpected url: ${url}`))
    })
    globalThis.fetch = fetchMock

    sync.saveConfig({
      syncUrl: 'https://test-sync.workers.dev',
      syncSecret: 'my_secret'
    })

    const result = await sync.pullAndApply()

    expect(result.eventsProcessed).toBe(2)
    expect(result.errors).toHaveLength(0)

    // Verify checkin recorded
    const checkins = db.prepare("SELECT * FROM discipline_events WHERE kind = 'checkin' AND day = '2026-10-25'").all()
    expect(checkins).toHaveLength(1)

    // Verify expense recorded
    const expenses = db.prepare('SELECT * FROM expenses').all() as any[]
    expect(expenses).toHaveLength(1)
    expect(expenses[0].amount).toBe(4500)
    expect(expenses[0].category).toBe('food')

    // Verify applied_sync_events table has both IDs
    const applied = db.prepare('SELECT id FROM applied_sync_events ORDER BY id').all() as any[]
    expect(applied.map((a) => a.id)).toEqual(['evt_101', 'evt_102'])

    // Re-running pullAndApply skips already applied events
    const secondPull = await sync.pullAndApply()
    expect(secondPull.eventsProcessed).toBe(0)
  })
})
