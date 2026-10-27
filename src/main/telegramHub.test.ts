import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Body } from './body'
import { openDb, type DB } from './db'
import { Discipline } from './discipline'
import { MoneyService } from './money'
import { SleepService } from './sleep'
import { Tasks } from './planner'
import { TelegramBotHub } from './telegramHub'
import { Wallet } from './wallet'

let dir: string
let db: DB
let wallet: Wallet
let discipline: Discipline
let body: Body
let sleep: SleepService
let money: MoneyService
let tasks: Tasks
let hub: TelegramBotHub

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-tele-hub-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  discipline = new Discipline(db, wallet)
  body = new Body(db, wallet)
  sleep = new SleepService(db, wallet)
  money = new MoneyService(db, wallet)
  tasks = new Tasks(db, wallet)

  hub = new TelegramBotHub(
    wallet,
    discipline,
    body,
    sleep,
    money,
    tasks,
    join(dir, 'tele.bin')
  )

  hub.saveConfig({
    botToken: 'TEST_TOKEN',
    chatId: '12345678',
    enabled: true,
    pollingEnabled: false
  })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('TelegramBotHub service', () => {
  it('rejects commands from unauthorized chat IDs', async () => {
    const res = await hub.handleIncomingCommand('/today', '99999999')
    expect(res).toContain('Unauthorized')
    expect(hub.getLogs()[0].success).toBe(false)
  })

  it('processes /today command from authorized chat', async () => {
    const res = await hub.handleIncomingCommand('/today', '12345678')
    expect(res).toContain('Life System Status')
    expect(res).toContain('Balance:')
    expect(hub.getLogs()[0].success).toBe(true)
  })

  it('processes /workout command and awards wallet', async () => {
    const res = await hub.handleIncomingCommand('/workout 40 pushups', '12345678')
    expect(res).toContain('Workout Recorded')
    expect(res).toContain('40 pushups')
    expect(wallet.summary().balance).toBe(10) // +10 coins for body.workout_done
  })

  it('processes /expense command and tracks spending', async () => {
    const res = await hub.handleIncomingCommand('/expense 35 food lunch sandwich', '12345678')
    expect(res).toContain('Expense Recorded')
    expect(res).toContain('35')
    expect(money.expenses().length).toBe(1)
    expect(wallet.summary().balance).toBe(3) // +3 coins for money.logged
  })

  it('processes /oath and /checkin', async () => {
    discipline.setStart('2026-10-25')
    const oathRes = await hub.handleIncomingCommand('/oath', '12345678')
    expect(oathRes).toContain('Morning Oath Affirmed')

    const checkinRes = await hub.handleIncomingCommand('/checkin', '12345678')
    expect(checkinRes).toContain('Clean Day Affirmed')
  })

  it('processes /panic emergency urge crusher', async () => {
    const res = await hub.handleIncomingCommand('/panic', '12345678')
    expect(res).toContain('URGE CRUSHER ACTIVATED')
  })
})
