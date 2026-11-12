// Night 11 (FX3, RL3, RL4, RL6, RL7): money points and reward buys on the real
// web services, with a made-up Finance Helper on this "device".
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { applyInbox } from './financeInbox'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function fakeTurso(): SqlJsDatabase {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return remote
}
const rows = (db: SqlJsDatabase, sql: string) => (db.exec(sql)[0]?.values ?? []) as unknown[][]

/** A made-up Finance Helper on this device (localStorage), amounts in bani. */
function financeOnDevice(state: any) {
  const store = new Map<string, string>([['finance-helper.state', JSON.stringify(state)]])
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
  return store
}
const at = (iso: string) => Date.parse(iso)
const baseFinance = (tx: any[] = [], extra: any = {}) => ({
  settings: {
    currency: 'MDL',
    categories: [
      { id: 'food', name: 'Food', type: 'expense' },
      { id: 'home', name: 'Home & bills', type: 'expense' },
      { id: 'fun', name: 'Fun', type: 'expense' }
    ],
    accounts: [
      { id: 'card', name: 'Card', kind: 'card', currency: 'MDL' },
      { id: 'safe', name: 'Safe', kind: 'savings', savings: true, currency: 'MDL' }
    ],
    savingsAccount: 'safe'
  },
  tx,
  goals: [{ id: 'g-trip', name: 'Trip', account: 'manual', saved: 0, history: [], target: 500000 }],
  ...extra
})

async function open() {
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
  await mirror.ready
  return createWebServices(mirror)
}

function clock(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

describe('honest money days (FX3)', () => {
  it('a forgotten day pays nothing; "Nothing spent today" and a live log do', async () => {
    const remote = fakeTurso()
    clock('2026-11-01T12:00:00Z')
    financeOnDevice(baseFinance())
    const web = await open()
    // Connected on Nov 1 (nothing to judge yet).
    await web.connections.syncFinance([])
    // Nov 2: you say nothing was spent. Nov 3: you log lunch that day. Nov 4: nothing logged at all.
    clock('2026-11-02T18:00:00Z')
    await web.money.nothingSpent()
    financeOnDevice(
      baseFinance([
        { id: 't1', type: 'expense', category: 'food', amount: 4000, base: 4000, date: '2026-11-03', createdAt: at('2026-11-03T12:30:00Z') },
        // Typed in later for Nov 1: back-dated, never pays under budget.
        { id: 't2', type: 'expense', category: 'food', amount: 4000, base: 4000, date: '2026-11-01', createdAt: at('2026-11-05T09:00:00Z') }
      ])
    )
    clock('2026-11-05T12:00:00Z')
    const web2 = await open()
    await web2.connections.syncFinance(['2026-11-03', '2026-11-01'])
    const refs = rows(remote, "SELECT ref FROM ledger WHERE kind = 'earn' AND module = 'money' ORDER BY ref").map((r) => String(r[0]))
    expect(refs).toContain('fin:nospend:2026-11-02')
    expect(refs).toContain('money:under:2026-11-03')
    expect(refs).not.toContain('fin:nospend:2026-11-04')
    expect(refs).not.toContain('money:under:2026-11-01')
    expect(refs.some((r) => r.startsWith('fin:cooked:') || r.startsWith('money:cooked:'))).toBe(false)
    // Paid once: a second sync pays nothing new.
    expect(await web2.connections.syncFinance(['2026-11-03'])).toBe(0)
  })

  it('"Nothing spent today" is refused after logging spending; cooking pays only when you confirm', async () => {
    fakeTurso()
    clock('2026-11-05T12:00:00Z')
    financeOnDevice(baseFinance([{ id: 't1', type: 'expense', category: 'food', amount: 4000, base: 4000, date: '2026-11-05', createdAt: at('2026-11-05T10:00:00Z') }]))
    const web = await open()
    await expect(web.money.nothingSpent()).rejects.toThrow(/already logged spending/)
    const d = await web.money.confirmCooked()
    expect(d.today.cooked).toBe(true)
    await expect(web.money.confirmCooked()).rejects.toThrow(/already counted/)
  })
})

describe('one no-spend button: "Nothing spent today" (2026-11-12)', () => {
  const logged = (remote: SqlJsDatabase) => rows(remote, "SELECT kind, ref FROM ledger WHERE rule_id = 'money.logged' ORDER BY id").map((r) => `${r[0]} ${r[1]}`)
  const noSpend = (remote: SqlJsDatabase) => rows(remote, "SELECT ref FROM ledger WHERE rule_id = 'money.no_spend' AND kind = 'earn'").map((r) => String(r[0]))

  it('the instant-pay free day is gone: the button pays nothing now and the day is paid once, at day end', async () => {
    const remote = fakeTurso()
    clock('2026-11-05T12:00:00Z')
    financeOnDevice(baseFinance())
    const web = await open()
    expect('freeDay' in web.money).toBe(false)
    expect('undoFreeDay' in web.money).toBe(false)
    await web.connections.syncFinance([])
    const d = await web.money.nothingSpent()
    expect(d.today.nothingSpentTapped).toBe(true)
    // Nothing paid at the tap ("Spending logged" is only for something really logged).
    expect(logged(remote)).toEqual([])
    expect((await web.wallet.summary()).balance).toBe(0)
    // Judged once the day is over, on what was really logged: paid once.
    clock('2026-11-06T09:00:00Z')
    const web2 = await open()
    await web2.connections.syncFinance([])
    expect(noSpend(remote)).toEqual(['fin:nospend:2026-11-05'])
    expect(await web2.connections.syncFinance([])).toBe(0)
    expect(noSpend(remote)).toEqual(['fin:nospend:2026-11-05'])
  })

  it('a day the old "No spending today" already paid keeps its points and is never paid twice', async () => {
    const remote = fakeTurso()
    // Before the change: a free day on Nov 5 marked the day and paid "Spending logged" at once.
    remote.exec(`INSERT INTO settings (key, value) VALUES ('money_nothing_spent', '["2026-11-05"]')`)
    remote.exec(`INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note) VALUES ('2026-11-05T12:00:00.000Z', '2026-11-05', 'money', 'earn', 3, 0, 'money.logged', 'fin:logged:2026-11-05', 'Spending logged (free day, no spending)')`)
    clock('2026-11-05T13:00:00Z')
    financeOnDevice(baseFinance())
    const web = await open()
    await web.connections.syncFinance([])
    const before = (await web.wallet.summary()).balance
    // Tapping the one button again that day: already counted, nothing paid.
    const d = await web.money.nothingSpent()
    expect(d.today.nothingSpentTapped).toBe(true)
    expect(logged(remote)).toEqual(['earn fin:logged:2026-11-05'])
    // Day end: the no-spend day is paid once; the earlier points are not taken back.
    clock('2026-11-06T09:00:00Z')
    const web2 = await open()
    await web2.connections.syncFinance([])
    await web2.connections.syncFinance([])
    expect(noSpend(remote)).toEqual(['fin:nospend:2026-11-05'])
    expect(logged(remote)).toEqual(['earn fin:logged:2026-11-05'])
    expect((await web2.wallet.summary()).balance).toBeGreaterThan(before)
  })

  it('is refused once spending is logged that day', async () => {
    const remote = fakeTurso()
    clock('2026-11-05T12:00:00Z')
    financeOnDevice(baseFinance([{ id: 't1', type: 'expense', category: 'food', amount: 4000, base: 4000, date: '2026-11-05', createdAt: at('2026-11-05T10:00:00Z') }]))
    const web = await open()
    await expect(web.money.nothingSpent()).rejects.toThrow(/already logged spending/)
    expect(noSpend(remote)).toEqual([])
  })
})

describe('buying a reward (RL3, RL4)', () => {
  it('logs what you paid as Fun under a fixed id, and undo takes it back out', async () => {
    const remote = fakeTurso()
    clock('2026-11-05T12:00:00Z')
    const store = financeOnDevice(baseFinance())
    const web = await open()
    await web.write((s) => s.wallet.append({ ts: new Date().toISOString(), day: '2026-11-05', module: 'test', kind: 'earn', coins: 3000, xp: 0 }))
    await web.shop.save({ title: 'Cinema night', price: 600, tier: 'bronze', realCost: 150, pinned: false, note: null, currency: 'MDL' })
    const id = (await web.shop.state()).rewards.find((r) => r.title === 'Cinema night')!.id
    const s = await web.shop.redeem(id, { paid: 140 })
    expect(s.lastBuy?.toast).toBe('−600 points · −140 lei added to Money as Fun')
    const inbox = JSON.parse(String(rows(remote, "SELECT value FROM settings WHERE key = 'finance_inbox_json'")[0][0]))
    expect(inbox).toEqual([expect.objectContaining({ id: `life-reward-${s.lastBuy!.ledgerId}`, amount: 14000, category: 'fun' })])
    // Finance Helper takes it, then the undo takes it back out.
    const applied = applyInbox(JSON.parse(store.get('finance-helper.state')!), inbox)
    expect(applied.state.tx.map((t: any) => [t.id, t.category])).toEqual([[`life-reward-${s.lastBuy!.ledgerId}`, 'fun']])
    await web.wallet.undo(s.lastBuy!.ledgerId, 'changed my mind')
    const after = JSON.parse(String(rows(remote, "SELECT value FROM settings WHERE key = 'finance_inbox_json'")[0][0]))
    expect(after.find((e: any) => e.id === `life-reward-${s.lastBuy!.ledgerId}`)?.remove).toBe(true)
    expect(applyInbox(applied.state, after).state.tx).toEqual([])
  })

  it('a buy with points puts nothing in Finance Helper; "I paid real money" puts in one record', async () => {
    const remote = fakeTurso()
    clock('2026-11-05T12:00:00Z')
    financeOnDevice(baseFinance())
    const web = await open()
    await web.write((s) => s.wallet.append({ ts: new Date().toISOString(), day: '2026-11-05', module: 'test', kind: 'earn', coins: 3000, xp: 0 }))
    await web.shop.setFunBudget({ lei: 500, source: 'manual' })
    await web.shop.save({ title: 'Made-up game hour', price: 150, tier: 'bronze', realCost: 15, pinned: false, note: null, currency: 'MDL' })
    const id = (await web.shop.state()).rewards.find((r) => r.title === 'Made-up game hour')!.id
    const inbox = () => JSON.parse(String(rows(remote, "SELECT value FROM settings WHERE key = 'finance_inbox_json'")[0]?.[0] ?? '[]'))
    const a = await web.shop.redeem(id)
    expect(a.lastBuy?.toast).toBe('−150 points')
    expect(a.lastBuy?.paid).toBe(0)
    expect(a.balance).toBe(2850)
    expect(inbox()).toEqual([])
    expect((await web.shop.value()).funSpentLei).toBe(0)
    const b = await web.shop.redeem(id, { paid: 15 })
    expect(b.balance).toBe(2700)
    expect(inbox()).toEqual([expect.objectContaining({ id: `life-reward-${b.lastBuy!.ledgerId}`, amount: 1500 })])
    expect((await web.shop.value()).funSpentLei).toBe(15)
  })

  it('old reward entries in Finance are listed with their buy, and leave only when asked', async () => {
    const remote = fakeTurso()
    clock('2026-11-05T12:00:00Z')
    const store = financeOnDevice(baseFinance())
    const web = await open()
    await web.write((s) => s.wallet.append({ ts: new Date().toISOString(), day: '2026-11-05', module: 'test', kind: 'earn', coins: 3000, xp: 0 }))
    await web.shop.save({ title: 'Made-up game hour', price: 150, tier: 'bronze', realCost: 15, pinned: false, note: null, currency: 'MDL' })
    const id = (await web.shop.state()).rewards.find((r) => r.title === 'Made-up game hour')!.id
    // An old buy that went to Finance as Fun (what happened before the fix).
    const old = await web.shop.redeem(id, { paid: 15 })
    const fid = `life-reward-${old.lastBuy!.ledgerId}`
    const inbox = () => JSON.parse(String(rows(remote, "SELECT value FROM settings WHERE key = 'finance_inbox_json'")[0][0]))
    store.set('finance-helper.state', JSON.stringify(applyInbox(JSON.parse(store.get('finance-helper.state')!), inbox()).state))
    const listed = await web.shop.rewardMoney!()
    expect(listed).toEqual([expect.objectContaining({ id: fid, ledgerId: old.lastBuy!.ledgerId, lei: 15, note: 'Reward: Made-up game hour' })])
    const balance = (await web.shop.state()).balance
    const r = await web.shop.removeRewardMoney!()
    expect(r).toMatchObject({ removed: 1, lei: 15, left: [] })
    expect(inbox().find((e: any) => e.id === fid && e.remove)).toBeTruthy()
    expect(applyInbox(JSON.parse(store.get('finance-helper.state')!), inbox()).state.tx).toEqual([])
    // The buy stays, its points stay spent, and it no longer counts as money.
    const after = await web.shop.state()
    expect(after.balance).toBe(balance)
    expect(after.recent[0]).toMatchObject({ title: 'Made-up game hour', realCost: 0, undone: false })
    expect((await web.shop.value()).funSpentLei).toBe(0)
  })

  it('an empty fun budget asks first; a goal lock is checked before money', async () => {
    fakeTurso()
    clock('2026-11-05T12:00:00Z')
    financeOnDevice(baseFinance())
    const web = await open()
    await web.write((s) => s.wallet.append({ ts: new Date().toISOString(), day: '2026-11-05', module: 'test', kind: 'earn', coins: 5000, xp: 0 }))
    await web.shop.setFunBudget({ lei: 100, source: 'manual' })
    await web.shop.save({ title: 'Concert', price: 800, tier: 'bronze', realCost: 200, pinned: false, note: null, currency: 'MDL' })
    const id = (await web.shop.state()).rewards.find((r) => r.title === 'Concert')!.id
    // With points only it is not money: the fun budget does not stop it.
    await expect(web.shop.redeem(id, { paid: 200 })).rejects.toThrow(/FUN_EMPTY: Concert costs 200 lei and only 100 lei is left/)
    // Locked to a 30-day clean streak: that is said first, even with "buy anyway".
    await web.write((s) => s.db.prepare("INSERT INTO settings (key, value) VALUES ('reward_unlocks', ?)").run(JSON.stringify({ [id]: { kind: 'streak', streak: 'clean', days: 30 } })))
    await expect(web.shop.redeem(id, { paid: 200, force: true })).rejects.toThrow(/clean/i)
    await web.write((s) => s.db.prepare("DELETE FROM settings WHERE key = 'reward_unlocks'").run())
    const s = await web.shop.redeem(id, { paid: 200, force: true })
    expect(s.lastBuy?.paid).toBe(200)
    expect((await web.shop.value()).funLeftLei).toBe(-100)
  })

  it('takes the fun budget from Finance Helper when it has a Fun limit', async () => {
    fakeTurso()
    clock('2026-11-05T12:00:00Z')
    const fin = baseFinance([{ id: 'x1', type: 'expense', category: 'fun', amount: 9000, base: 9000, date: '2026-11-02', createdAt: at('2026-11-02T10:00:00Z') }])
    fin.settings.categories[2] = { id: 'fun', name: 'Fun', type: 'expense', budget: 40000 } as any
    financeOnDevice(fin)
    const web = await open()
    const v = await web.shop.setFunBudget({ lei: 0, source: 'finance' })
    expect(v).toMatchObject({ funBudgetLei: 400, funSpentLei: 90, funLeftLei: 310, funSource: 'finance' })
  })
})

describe('leftover to savings (RL7)', () => {
  it('moves once with a small bonus, and undo takes both back', async () => {
    const remote = fakeTurso()
    clock('2026-11-28T12:00:00Z')
    const store = financeOnDevice(baseFinance())
    const web = await open()
    await web.shop.setFunBudget({ lei: 300, source: 'manual' })
    const l = await web.shop.leftover()
    expect(l).toMatchObject({ kind: 'fun', leftLei: 300, goal: { id: 'g-trip', name: 'Trip' }, monthEnd: true })
    const moved = await web.shop.moveLeftover()
    expect(moved.toast).toBe('+10 points · 300 lei moved to Trip')
    expect(moved.leftLei).toBe(0)
    await expect(web.shop.moveLeftover()).rejects.toThrow(/Already moved/)
    expect((await web.shop.value()).funLeftLei).toBe(0)
    const inbox = JSON.parse(String(rows(remote, "SELECT value FROM settings WHERE key = 'finance_inbox_json'")[0][0]))
    const applied = applyInbox(JSON.parse(store.get('finance-helper.state')!), inbox)
    expect(applied.state.goals[0].saved).toBe(30000)
    // The same inbox applied again changes nothing.
    expect(applyInbox(applied.state, inbox).state.goals[0].saved).toBe(30000)
    const bonus = rows(remote, "SELECT id FROM ledger WHERE ref LIKE 'saved:%'")[0][0] as number
    await web.wallet.undo(bonus, 'not yet')
    const after = JSON.parse(String(rows(remote, "SELECT value FROM settings WHERE key = 'finance_inbox_json'")[0][0]))
    expect(applyInbox(applied.state, after).state.goals[0].saved).toBe(0)
    expect((await web.shop.leftover()).leftLei).toBe(300)
  })

  it('moves to a savings account as a transfer when the goal counts one', async () => {
    fakeTurso()
    clock('2026-11-28T12:00:00Z')
    const fin = baseFinance([], { goals: [{ id: 'g-safe', name: 'Safe goal', account: 'savings', target: 100000 }] })
    const store = financeOnDevice(fin)
    const web = await open()
    await web.shop.setFunBudget({ lei: 50, source: 'manual' })
    await web.shop.moveLeftover()
    const remoteInbox = await web.read((s) => JSON.parse(String(s.db.prepare("SELECT value FROM settings WHERE key = 'finance_inbox_json'").get().value)))
    const applied = applyInbox(JSON.parse(store.get('finance-helper.state')!), remoteInbox)
    expect(applied.state.tx).toEqual([expect.objectContaining({ type: 'transfer', from: 'card', to: 'safe', amount: 5000 })])
  })
})
