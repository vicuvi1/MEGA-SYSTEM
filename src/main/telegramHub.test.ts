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
    sportBotToken: 'SPORT_TOKEN',
    sportBotChatId: '87654321',
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

  it('accepts commands from secondary sport bot chat ID', async () => {
    const res = await hub.handleIncomingCommand('/today', '87654321')
    expect(res).toContain('Life System Status')
    expect(hub.getLogs()[0].success).toBe(true)
  })

  it('processes /workout command and awards wallet', async () => {
    const res = await hub.handleIncomingCommand('/workout 40 pushups', '12345678')
    expect(res).toContain('Workout Recorded')
    expect(res).toContain('40 pushups')
    expect(wallet.summary().balance).toBe(10) // +10 coins for body.workout_done
  })

  it('processes /sport command (e.g. running) and logs to body', async () => {
    const res = await hub.handleIncomingCommand('/sport run 5km', '87654321')
    expect(res).toContain('Workout logged')
    expect(res).toContain('Running (5 km)')
    expect(body.state().recentWorkouts.length).toBe(1)
    expect(wallet.summary().balance).toBe(10) // +10 first workout coins
  })

  it('processes /weight and /waist metric logging', async () => {
    const resW = await hub.handleIncomingCommand('/weight 74.5', '12345678')
    expect(resW).toContain('BODY COMPOSITION LOGGED')
    expect(resW).toContain('74.5 kg')
    expect(body.state().latestWeight).toBe(74.5)

    const resWaist = await hub.handleIncomingCommand('/waist 82', '12345678')
    expect(resWaist).toContain('BODY COMPOSITION LOGGED')
    expect(resWaist).toContain('82 cm')
    expect(body.state().latestWaist).toBe(82)
  })

  it('processes /pr command and /sport status', async () => {
    const prRes = await hub.handleIncomingCommand('/pr bench 100kg', '12345678')
    expect(prRes).toContain('PERSONAL RECORD')
    expect(prRes).toContain('bench')

    const statusRes = await hub.handleIncomingCommand('/sport status', '12345678')
    expect(statusRes).toContain('Training')
  })

  it('processes /expense command and tracks spending', async () => {
    const res = await hub.handleIncomingCommand('/expense 35 food lunch sandwich', '12345678')
    expect(res).toContain('Expense Recorded')
    expect(res).toContain('35')
    expect(money.expenses().length).toBe(1)
    expect(wallet.summary().balance).toBe(3) // +3 coins for money.logged
  })

  it('processes natural language expenses and syncs with FinanceHost', async () => {
    let syncedTx: any = null
    const mockFinanceHost: any = {
      readState: async () => JSON.stringify({ tx: [] }),
      quickAdd: () => {},
      addTransaction: async (tx: any) => {
        syncedTx = tx
        return { ok: true, txId: 'mock-tx-1', balanceTotal: 1540000, accountName: 'Main Card' }
      },
      getFinanceSummary: async () => ({
        totalMdl: 15400,
        currency: 'MDL',
        accounts: [{ id: 'acc-1', name: 'Main Card', balanceMdl: 15400 }]
      }),
      syncTelegram: async () => true
    }

    hub.setFinanceHost(mockFinanceHost)

    // Send natural expense "coffee 35"
    const reply = await hub.handleIncomingCommand('coffee 35', '12345678')
    expect(reply).toContain('Expense Recorded & Synced to Finance Helper!')
    expect(reply).toContain('35 MDL · <i>coffee</i>')
    expect(reply).toContain('food')
    expect(reply).toContain('<b>Finance App Ledger:</b> Synced ✅ [Main Card]')

    expect(syncedTx).not.toBeNull()
    expect(syncedTx.amount).toBe(3500)
    expect(syncedTx.category).toBe('food')
    expect(syncedTx.note).toBe('coffee')

    // Check balance command
    const balReply = await hub.handleIncomingCommand('/balance', '12345678')
    expect(balReply).toContain('FINANCIAL BALANCE & ASSET OVERVIEW')
    expect(balReply).toContain('<b>Main Card:</b> 15400.00 MDL')
    expect(balReply).toContain('<b>Accounts Total:</b> <b>15400.00 MDL</b>')
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
