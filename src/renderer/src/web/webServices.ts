// The desktop services (src/main/*.ts) running on the web app's copy of the
// Turso database. Same rules as the desktop: daily caps, cooldowns, undo,
// quests, the shop, streaks. Each change is saved to Turso before it shows.
import { isImported, liveLog, moneyDay, type DayTx } from '@core/moneyDays'
import { moneyNumbers } from './benDesk'
import { financeStateFrom } from './botBrain'
import { queueFinanceExpense, savingTarget } from './financeInbox'
import { financeFunCategory, leftoverLei, repriceSuggestions, rewardFinId, rewardMoneyRows, toLei, txLei, type RewardMoneyRow } from '@core/funBudget'
import type { Exercise } from '@core/body'
import type { Rule } from '@core/rules'
import type {
  BlockInput,
  BodyMetricInput,
  Category,
  RewardInput,
  TaskInput,
  WishlistGoalInput,
  WorkoutInput
} from '@shared/api'
import { Body } from '../../../main/body'
import { DataExportService } from '../../../main/dataExport'
import { Discipline } from '../../../main/discipline'
import { MoneyService } from '../../../main/money'
import { Schedule, Tasks } from '../../../main/planner'
import { ShieldService } from '../../../main/shields'
import { Shop } from '../../../main/shop'
import { SleepService } from '../../../main/sleep'
import { FocusService, type FocusTask } from '../../../main/focus'
import { GoalsService } from '../../../main/goals'
import { ProgressService } from '../../../main/progress'
import { WeekPlanService } from '../../../main/weekPlan'
import { applyPointsV2, applyPointsV3 } from '../../../main/points'
import type { WeekPlan } from '@core/weekPlan'
import { UnifiedEconomyService } from '../../../main/unifiedEconomy'
import { Wallet } from '../../../main/wallet'
import { addDays } from '@core/dates'
import { LedgerError } from '@core/ledger'
import { isFlowRule } from '@core/rules'
import { getSetting, setSetting } from '../../../main/settings'
import { loadUnlocks, unlockFacts } from './lifeExtras'
import { unlockBlocker } from '@core/unlocks'
import { rewardsMore } from './rewardsMore'
import type { RewardRules } from '@core/rewardGuard'
import type { BrowserDb } from './browserDb'
import type { Mirror } from './mirror'

/** Finance Helper's data on this device (else the synced copy). */
const financeOf = (s: { db: any }) => financeStateFrom(s.db, typeof localStorage !== 'undefined' ? localStorage : null)

/** RL1: the point value with Finance Helper's fun limit, spending, rates and your hour. */
export function shopValue(s: Services, now = new Date()) {
  const finance = financeOf(s)
  const hourly = finance ? moneyNumbers(finance, s.wallet.today(now)).hourly : null
  return s.shop.value({ finance, hourlyLei: hourly != null ? hourly / 100 : null }, now)
}

/** Reward buys in Finance Helper as spending: its records and the inbox entries still waiting. */
export function rewardMoney(s: Services): RewardMoneyRow[] {
  let inbox: any[] = []
  try {
    inbox = JSON.parse(getSetting(s.db as any, 'finance_inbox_json') || '[]')
  } catch {
    inbox = []
  }
  return rewardMoneyRows(financeOf(s), Array.isArray(inbox) ? inbox : [])
}

/**
 * After a points entry is undone: a reward buy's expense (RL4) or a move to
 * savings (RL7) comes back out of Finance Helper too.
 */
export function afterUndo(s: Services, id: number): void {
  const e = s.wallet.entries().find((x) => x.id === id)
  if (!e?.ref) return
  if (e.ref.startsWith('reward:')) queueFinanceExpense(s.db as any, { id: rewardFinId(id), amount: 0, category: '', note: '', date: s.wallet.today(), at: Date.now(), remove: true })
  if (e.ref.startsWith('saved:')) queueFinanceExpense(s.db as any, { id: savedFinId(e.ref.slice(6), id), amount: 0, category: '', note: '', date: s.wallet.today(), at: Date.now(), remove: true })
}

/**
 * Finance Helper's records as money days (FX3): in lei (never a foreign amount
 * as lei), live only when made on their own day and not imported. Expenses
 * logged in Life System (life-exp-…) are counted from Life System's own list.
 */
export function financeDayTx(s: Services, finance: any = financeOf(s), withLife = false): DayTx[] {
  const txs: any[] = Array.isArray(finance?.tx) ? finance.tx : []
  if (!txs.length) return []
  const names = new Map<string, string>((finance?.settings?.categories ?? []).map((c: any) => [String(c.id), String(c.name)]))
  const dayOf = (ms: number) => s.wallet.today(new Date(ms))
  return txs
    .filter((t) => t && !t.deleted && typeof t.date === 'string' && t.type !== 'transfer' && (withLife || !String(t.id ?? '').startsWith('life-exp-')))
    .map((t) => ({
      date: t.date.slice(0, 10),
      type: String(t.type),
      category: names.get(String(t.category)) ?? String(t.category ?? ''),
      note: String(t.note ?? ''),
      amount: Math.round(txLei(t, finance?.rates, finance?.settings?.currency) * 100),
      live: liveLog(t.date.slice(0, 10), Number(t.createdAt), dayOf, isImported(t))
    }))
}

/** Today's money day, the last 14 judged days and the saving streak (FX3, RL6). */
export function moneyDays(s: Services, now = new Date()) {
  const other = financeDayTx(s)
  const today = s.wallet.today(now)
  const marks = s.money.marks()
  const t = moneyDay([...s.money.nativeDayTx(), ...other], today, { nothingSpent: marks.nothingSpent.includes(today), cookedConfirmed: marks.cooked.includes(today) })
  return {
    today: { day: today, ...t, nothingSpentTapped: marks.nothingSpent.includes(today) },
    dailyBudget: s.money.dailyBudgetSet(),
    days: s.money.judged(other, addDays(today, -14), now).reverse(),
    streak: s.money.savingStreak(other, now)
  }
}

const SAVED_BONUS = 10
const savedFinId = (month: string, ledgerId: number) => `life-save-${month}-${ledgerId}`

/** RL7: what's left of this month's fun budget (else Finance Helper's month limit), and where it can go. */
export function leftover(s: Services, now = new Date()) {
  const finance = financeOf(s)
  const today = s.wallet.today(now)
  const month = today.slice(0, 7)
  const v = shopValue(s, now)
  const moved = s.shop.savedMove(month)
  let kind: 'fun' | 'month' = 'fun'
  let budgetLei = v.funBudgetLei
  let leftLei = v.funLeftLei == null ? 0 : leftoverLei(v.funLeftLei + (moved?.kind === 'fun' ? moved.lei : 0), 0)
  if (budgetLei == null && finance) {
    const n = moneyNumbers(finance, today)
    if (n.limitLeft != null) {
      kind = 'month'
      budgetLei = Math.round(Number(finance?.settings?.limit?.amount) / 100)
      leftLei = leftoverLei(n.limitLeft / 100, 0)
    }
  }
  const target = finance ? savingTarget(finance) : null
  const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  return {
    month,
    kind,
    budgetLei,
    leftLei: moved ? 0 : leftLei,
    goal: target?.goal ?? null,
    moved,
    /** The last 3 days of the month: time to move it. */
    monthEnd: Number(today.slice(8, 10)) > dim - 3,
    toast: undefined as string | undefined
  }
}

/** All services, built for one copy of the database. */
function servicesFor(db: BrowserDb) {
  const d = db as any
  const wallet = new Wallet(d)
  const shields = new ShieldService(d, wallet)
  const discipline = new Discipline(d, wallet)
  const money = new MoneyService(d, wallet)
  // Expenses logged here reach Finance Helper through the synced inbox (deletes too).
  money.toFinance = (e) => queueFinanceExpense(d as any, e)
  const body = new Body(d, wallet)
  body.setShields(shields)
  const shop = new Shop(d, wallet)
  return {
    db: d,
    wallet,
    shields,
    discipline,
    money,
    body,
    shop,
    tasks: new Tasks(d, wallet, shields),
    schedule: new Schedule(d, wallet),
    sleep: new SleepService(d, wallet),
    focus: new FocusService(d, wallet),
    goals: new GoalsService(d, wallet),
    progress: new ProgressService(d, wallet),
    weekPlan: new WeekPlanService(d, wallet),
    economy: new UnifiedEconomyService(d, wallet, discipline, money, shields),
    exporter: new DataExportService(d, body, money)
  }
}
export type Services = ReturnType<typeof servicesFor>

const notify = (...names: string[]) => {
  if (typeof window === 'undefined') return
  for (const n of names) window.dispatchEvent(new CustomEvent(n))
}

/** The LifeApi namespaces the services cover, like src/main/index.ts maps them. */
export function createWebServices(mirror: Mirror) {
  // Points without the game (main/points.ts): once per database, in the background.
  void mirror.write((db) => (applyPointsV2(db as any), applyPointsV3(db as any))).catch(() => {})
  // The copy is replaced on every refresh, so services are built per call
  // (they hold no state of their own beyond the database).
  const read = <T>(fn: (s: Services) => T) => mirror.read((db) => fn(servicesFor(db)))
  const write = <T>(fn: (s: Services) => T, ...events: string[]) =>
    mirror.write((db) => fn(servicesFor(db))).then((r) => {
      notify(...events)
      return r
    })
  const W = 'life-wallet-changed'
  const D = 'life-discipline-changed'
  const B = 'life-body-changed'

  return {
    read,
    write,
    services: servicesFor,
    wallet: {
      summary: () => read((s) => s.wallet.summary()),
      history: (limit?: number) => read((s) => s.wallet.history(limit)),
      // Like the desktop: sleep, money, discipline and study are paid by their
      // own sections (and the connected apps), never by a bare award.
      award: (ruleId: string, note?: string) =>
        write((s) => {
          if (isFlowRule(ruleId)) throw new LedgerError('This one is logged from its own section')
          s.wallet.award(ruleId, note)
          return s.wallet.summary()
        }, W),
      undo: (id: number, note: string) =>
        write((s) => {
          s.wallet.undo(id, note)
          afterUndo(s, id)
          return s.wallet.summary()
        }, W),
      // Island 2: pays a rule once for one thing that happened (its ref); 0 when nothing was paid.
      payOnce: (ruleId: string, ref: string, note?: string) =>
        write((s) => {
          if (isFlowRule(ruleId)) throw new LedgerError('This one is logged from its own section')
          return s.wallet.payOnce(ruleId, { ref, note })
        }, W),
      quests: () => read((s) => s.wallet.quests()),
      claimQuests: () =>
        write((s) => {
          s.wallet.claimQuests()
          return s.wallet.summary()
        }, W),
      allocateStats: (stat: 'str' | 'agi' | 'vit' | 'int' | 'sen', points?: number) => write((s) => s.wallet.allocateStats(stat, points), W),
      resetStats: () => write((s) => s.wallet.resetStatAllocation(), W)
    },
    connections: {
      /**
       * Pays "Spending logged" for each day Finance Helper (on this device) has
       * a record, like the desktop's connection sync: from the day it was
       * first connected, the last 31 days at most, each day once (same refs
       * as the desktop, so the PC and the web never both pay a day).
       */
      syncFinance: (recordDays: string[]) =>
        write((s) => {
          const db = s.db
          const today = s.wallet.today()
          let since = getSetting(db, 'conn_finance_since')
          if (!since) setSetting(db, 'conn_finance_since', (since = today))
          const from = since < addDays(today, -31) ? addDays(today, -31) : since
          const handled = new Set(s.wallet.entries().map((e) => e.ref ?? '').filter(Boolean))
          let paid = 0
          for (const d of new Set(recordDays)) {
            if (d < from || d > today || handled.has(`fin:logged:${d}`)) continue
            try {
              s.wallet.awardRule('money.logged', { day: d, ref: `fin:logged:${d}`, note: 'Spending logged (Finance Helper)' })
              paid++
            } catch (e) {
              if (!(e instanceof LedgerError)) throw e
            }
          }
          // Finished days (FX3): no-spend and under budget from live logs only, the saving streak (RL6).
          // Cooking at home is never guessed into points: you confirm it (money.confirmCooked).
          paid += s.money.payDays(financeDayTx(s), since)
          return paid
        }, W)
    },
    rules: {
      list: () => read((s) => s.wallet.rules()),
      save: (rule: Rule) =>
        write((s) => {
          s.wallet.saveRule(rule)
          return s.wallet.rules()
        })
    },
    shop: {
      state: () => read((s) => s.shop.state()),
      /** RL1: what a point is worth in lei, your fun budget (spent, left) and your hour of work. */
      value: () => read((s) => shopValue(s)),
      save: (r: RewardInput) => write((s) => (s.shop.save(r), s.shop.state())),
      archive: (id: number) => write((s) => (s.shop.archive(id), s.shop.state())),
      /**
       * Buying a reward. Order: a goal/streak lock first (FT21), then the fun
       * budget (RL3) and Safe to spend (M1); `force` (the explicit "buy
       * anyway") skips only those two. A buy with points is NOT real spending:
       * nothing goes to Finance Helper. Only real money you say you paid
       * (`paid` > 0, the "I paid real money" switch) goes there as Fun under a
       * stable id, so undoing the buy takes it back out (RL4).
       */
      redeem: (id: number, opts: { force?: boolean; paid?: number } = {}) =>
        write((s) => {
          const reward = s.shop.state().rewards.find((r) => r.id === id)
          const lock = loadUnlocks(s.db)[String(id)]
          const locked = lock ? unlockBlocker(lock, unlockFacts(s)) : null
          if (locked) throw new LedgerError(locked)
          const paid = opts.paid != null && Number.isFinite(Number(opts.paid)) ? Math.max(0, Math.round(Number(opts.paid))) : 0
          const cur = (reward?.currency || 'MDL').toUpperCase()
          const finance = financeOf(s)
          const lei = paid > 0 ? (toLei(paid, cur, finance?.rates) ?? paid) : 0
          if (reward && paid > 0 && !opts.force) {
            const fun = s.shop.funBlocker(id, paid, finance)
            if (fun) throw new LedgerError(`FUN_EMPTY: ${fun}`)
            const safe = finance ? moneyNumbers(finance, s.wallet.today()).safeToday : null
            if (safe != null && lei * 100 > safe) throw new LedgerError(`OVER_SAFE: ${reward.title} costs ${Math.round(lei)} lei and your Safe to spend today is ${Math.round(safe / 100)} lei.`)
          }
          const ledgerId = s.shop.redeem(id, new Date(), { paid, force: true, finance })
          if (paid > 0 && reward) {
            const shown = cur === 'MDL' ? '' : ` (${paid} ${cur})`
            queueFinanceExpense(s.db as any, { id: rewardFinId(ledgerId), amount: Math.round(lei * 100), category: 'fun', note: `Reward: ${reward.title}${shown}`, date: s.wallet.today(), at: Date.now() })
          }
          const money = paid > 0 ? ` · −${paid.toLocaleString('en-US')} ${cur === 'MDL' ? 'lei' : cur} added to Money as Fun` : ''
          return { ...s.shop.state(), lastBuy: { ledgerId, title: reward?.title ?? 'Reward', points: reward?.price ?? 0, paid, currency: cur, toast: `−${(reward?.price ?? 0).toLocaleString('en-US')} points${money}` } }
        }, W),
      /** Points-only fix: reward buys that sit in Finance Helper as real spending (the owner sees them before removing). */
      rewardMoney: () => read((s) => rewardMoney(s)),
      /**
       * Takes those records back out of Finance Helper (all, or the ids given),
       * only after the owner's tap. The buys stay; their points stay spent.
       */
      removeRewardMoney: (ids?: string[]) =>
        write((s) => {
          const rows = rewardMoney(s).filter((r) => !ids || ids.includes(r.id))
          const at = Date.now()
          for (const r of rows) queueFinanceExpense(s.db as any, { id: r.id, amount: 0, category: '', note: '', date: s.wallet.today(), at, remove: true })
          s.shop.clearPaid(rows.map((r) => r.ledgerId))
          return { removed: rows.length, lei: Math.round(rows.reduce((t, r) => t + r.lei, 0) * 100) / 100, left: rewardMoney(s) }
        }, W),
      /** RL7: what's left this month (fun budget, else Finance Helper's month limit) and the goal it can go to. */
      leftover: () => read((s) => leftover(s)),
      /** RL7: moves the leftover to the savings goal in Finance Helper (once a month), with a small "Saved" bonus. Undo takes both back. */
      moveLeftover: () =>
        write((s) => {
          const l = leftover(s)
          if (l.moved) throw new LedgerError(`Already moved ${l.moved.lei} lei to ${l.moved.goal} this month`)
          if (!(l.leftLei > 0)) throw new LedgerError('Nothing left over to move this month')
          if (!l.goal) throw new LedgerError('Add a savings goal in Finance Helper first (one you fill by hand, or one on a savings account)')
          const now = new Date()
          const today = s.wallet.today(now)
          const ledgerId = s.wallet.append({ ts: now.toISOString(), day: today, module: 'money', kind: 'earn', coins: SAVED_BONUS, xp: 0, ref: `saved:${l.month}`, note: `Saved: ${l.leftLei} lei to ${l.goal.name}` })
          queueFinanceExpense(s.db as any, { id: savedFinId(l.month, ledgerId), type: 'saving', goalId: l.goal.id, amount: l.leftLei * 100, category: '', note: `Left over from your ${l.kind === 'fun' ? 'fun' : 'month'} budget`, date: today, at: now.getTime() })
          s.shop.recordMove(l.month, { lei: l.leftLei, ledgerId, kind: l.kind, goal: l.goal.name })
          return { ...leftover(s), toast: `+${SAVED_BONUS} points · ${l.leftLei} lei moved to ${l.goal.name}` }
        }, W),
      /** RL2: new prices from real cost for old rewards (only suggests; apply each with save). */
      reprice: () => read((s) => repriceSuggestions(s.shop.state().rewards, shopValue(s).value, financeOf(s)?.rates)),
      /** RL3: the monthly fun budget, by hand or from Finance Helper's Fun / Entertainment limit. */
      setFunBudget: (b: { lei: number; source: 'manual' | 'finance' } | null) =>
        write((s) => {
          if (b?.source === 'finance') {
            const cat = financeFunCategory(financeOf(s))
            if (!cat) throw new LedgerError('Finance Helper has no Fun or Entertainment category with a monthly limit')
            s.shop.setFunBudget({ lei: cat.lei, source: 'finance' })
          } else s.shop.setFunBudget(b)
          return shopValue(s)
        }),
      openChest: (level: number) => write((s) => ({ coins: s.shop.openChest(level), state: s.shop.state() }), W),
      setBudget: (amount: number) => write((s) => (s.shop.setBudget(amount), s.shop.state())),
      setCurrency: (cur: string) => write((s) => (s.shop.setCurrency(cur), s.shop.state())),
      // Night 11: the Rewards page.
      insights: () => read((s) => s.shop.insights()),
      restore: (id: number) => write((s) => (s.shop.restore(id), s.shop.state())),
      setGoals: (ids: number[]) => write((s) => (s.shop.setGoals(ids), s.shop.state())),
      reorder: (ids: number[]) => write((s) => (s.shop.reorder(ids), s.shop.state())),
      undoBuy: (ledgerId: number) => write((s) => (s.shop.undoBuy(ledgerId), s.shop.state()), W),
      jarAdd: (rewardId: number, amount: number) => write((s) => (s.shop.jarAdd(rewardId, amount, s.economy), s.shop.state()), W),
      jarTake: (rewardId: number, amount: number) => write((s) => (s.shop.jarTake(rewardId, amount), s.shop.state()), W),
      claimChallenge: () => write((s) => ({ coins: s.shop.claimChallenge(), state: s.shop.state() }), W),
      markReady: (keys: string[]) => write((s) => s.shop.markReady(keys)),
      // Rewards 2: suggestions, where points came from, guardrails, coupons, the mystery reward.
      more: () => read((s) => rewardsMore(s, shopValue(s))),
      addSuggestion: (key: string) => write((s) => (s.shop.addStarter(key), s.shop.state())),
      hideSuggestion: (key: string) => write((s) => (s.shop.hideSuggestion(key), rewardsMore(s, shopValue(s)))),
      setRules: (rewardId: number, rules: RewardRules | null) => write((s) => (s.shop.setRules(rewardId, rules), s.shop.state())),
      openChestPrize: (level: number) => write((s) => ({ prize: s.shop.openChestPrize(level), state: s.shop.state() }), W),
      claimMystery: () =>
        write((s) => {
          let plan = null
          try {
            plan = s.weekPlan.active()
          } catch {
            plan = null
          }
          return { prize: s.shop.claimMystery(plan), state: s.shop.state() }
        }, W)
    },
    tasks: {
      state: () => read((s) => s.tasks.state()),
      save: (t: TaskInput) => write((s) => (s.tasks.save(t), s.tasks.state())),
      archive: (id: number) => write((s) => (s.tasks.archive(id), s.tasks.state())),
      complete: (id: number) => write((s) => (s.tasks.complete(id), s.tasks.state()), W),
      uncomplete: (id: number) => write((s) => (s.tasks.uncomplete(id), s.tasks.state()), W),
      saveCategory: (c: Category) => write((s) => (s.tasks.saveCategory(c), s.tasks.state())),
      archiveCategory: (id: string) => write((s) => (s.tasks.archiveCategory(id), s.tasks.state()))
    },
    schedule: {
      state: (day?: string) => read((s) => s.schedule.state(day)),
      save: (b: BlockInput) => write((s) => (s.schedule.save(b), s.schedule.state())),
      archive: (id: number) => write((s) => (s.schedule.archive(id), s.schedule.state())),
      start: (id: number) => write((s) => (s.schedule.start(id), s.schedule.state())),
      finish: (id: number) => write((s) => (s.schedule.finish(id), s.schedule.state()), W),
      skip: (id: number) => write((s) => (s.schedule.skip(id), s.schedule.state()), W)
    },
    discipline: {
      state: () => read((s) => s.discipline.state()),
      setStart: (day: string) => write((s) => (s.discipline.setStart(day), s.discipline.state()), D),
      checkIn: () => write((s) => (s.discipline.checkIn(), s.discipline.state()), W, D),
      oath: () => write((s) => (s.discipline.oath(), s.discipline.state()), W, D),
      reset: () => write((s) => (s.discipline.reset(), s.discipline.state()), W, D),
      undoReset: () => write((s) => (s.discipline.undoReset(), s.discipline.state()), W, D),
      startUrge: () => write((s) => (s.discipline.startUrge(), s.discipline.state()), W, D),
      finishUrge: () => write((s) => (s.discipline.finishUrge(), s.discipline.state()), W, D),
      cancelUrge: () => write((s) => (s.discipline.cancelUrge(), s.discipline.state()), W, D),
      claim: (days: number) => write((s) => ({ coins: s.discipline.claim(days), state: s.discipline.state() }), W, D),
      setStealth: (on: boolean) => write((s) => (s.discipline.setStealth(on), s.discipline.state())),
      setWhy: (text: string) => write((s) => (s.discipline.setWhy(text), s.discipline.state()))
    },
    body: {
      state: () => read((s) => s.body.state()),
      logWorkout: (input: WorkoutInput) => write((s) => s.body.logWorkout(input), W, B),
      deleteWorkout: (id: number) => write((s) => s.body.deleteWorkout(id), W, B),
      takeBackSet: (id: number, name: string, amount: number) => write((s) => s.body.takeBackSet(id, name, amount), W, B),
      logMetric: (input: BodyMetricInput) => write((s) => s.body.logMetric(input), W, B),
      saveExercise: (ex: Omit<Exercise, 'id' | 'sort'> & { id?: string; sort?: number }) => write((s) => (s.body.saveExercise(ex), s.body.state()), B),
      setRest: (day: string | null, on: boolean) => write((s) => s.body.setRest(day, on), B)
    },
    focus: {
      state: () => read((s) => s.focus.state()),
      start: (subject: string, planned?: number, task?: FocusTask | null, stages?: import('@core/focusFlow').FocusStage[] | null) => write((s) => s.focus.start(subject, planned, new Date(), task ?? null, stages ?? null)),
      pause: () => write((s) => s.focus.pause()),
      resume: () => write((s) => s.focus.resume()),
      rename: (subject: string) => write((s) => s.focus.rename(subject)),
      stop: () => write((s) => s.focus.stop(), W),
      cancel: () => write((s) => s.focus.cancel()),
      extend: (minutes: number) => write((s) => s.focus.extend(minutes)),
      add: (subject: string, minutes: number, day?: string) => write((s) => s.focus.add(subject, minutes, day), W),
      setPlan: (items: import('@core/focus').PlanInput[], day?: string) => write((s) => s.focus.setPlan(items, new Date(), day)),
      togglePlan: (index: number) => write((s) => s.focus.togglePlan(index), W),
      review: (text: string | null, reasons: string[]) => write((s) => s.focus.review(text, reasons)),
      saveGoal: (g: { id?: number; title: string; subject: string; deadline: string; hours: number }) => write((s) => s.focus.saveGoal(g)),
      archiveGoal: (id: number) => write((s) => s.focus.archiveGoal(id)),
      fun: (minutes: number, what?: string) => write((s) => s.focus.fun(minutes, what), W)
    },
    progress: {
      report: (spending: { day: string; bani: number }[] | null) => read((s) => ({ ...s.progress.report(spending), savingStreak: s.money.savingStreak(financeDayTx(s)) })),
      insights: () => read((s) => s.progress.insights()),
      growth: (spending: { day: string; bani: number }[] | null) => read((s) => s.progress.growth(spending))
    },
    weekPlan: {
      saved: () => read((s) => s.weekPlan.saved()),
      save: (p: Partial<WeekPlan>) => write((s) => s.weekPlan.save(p), 'life-week-changed'),
      toggle: (i: number) => write((s) => s.weekPlan.toggle(i), 'life-week-changed')
    },
    sleep: {
      state: () => read((s) => s.sleep.state()),
      logWake: (time?: string, quality?: number) => write((s) => s.sleep.logWake(time, quality), W),
      logBed: (time?: string) => write((s) => s.sleep.logBed(time), W),
      bedActivity: (idleSec: number) => write((s) => s.sleep.bedActivity(idleSec), W),
      setWake: (day: string, time: string) => write((s) => s.sleep.setWake(day, time), W),
      /** A bedtime for a past night (the morning row `day`): the record only, no points. */
      setBed: (day: string, time: string) => write((s) => s.sleep.setBed(day, time), 'life-sleep-changed'),
      /** Waky's wake-ups and bedtimes into the sleep log, where it has none yet. */
      fromWaky: () => write((s) => s.sleep.fromWaky(), W),
      setTargets: (weekday: string, weekend: string, bedtime?: string) => write((s) => s.sleep.setTargets(weekday, weekend, bedtime)),
      /** Every logged night (newest first), for Waky (one sleep record, WK2). */
      logs: () => read((s) => s.sleep.logs().slice(0, 400)),
      /** How you slept, 1–5 (Waky's mood after check-in, WK13). */
      setQuality: (day: string, quality: number) => write((s) => s.sleep.setQuality(day, quality), 'life-sleep-changed')
    },
    money: {
      state: () => read((s) => s.money.state()),
      addExpense: (amountBani: number, category: string, note?: string) => write((s) => s.money.addExpense(amountBani, category as any, note), W),
      deleteExpense: (id: number) => write((s) => s.money.deleteExpense(id)),
      setBudget: (budgetBani: number) => write((s) => s.money.setBudget(budgetBani)),
      setCurrency: (cur: string) => write((s) => s.money.setCurrency(cur)),
      /** FX3: today, the last 14 judged days and the saving streak. */
      days: () => read((s) => moneyDays(s)),
      /** FX3: "Nothing spent today" (counts once the day is over, if it stays true). */
      nothingSpent: () => write((s) => (s.money.nothingSpent(financeDayTx(s)), moneyDays(s)), W),
      /** FX3: "I cooked at home today" (you confirm it, it pays). */
      confirmCooked: () => write((s) => (s.money.confirmCooked(), moneyDays(s)), W)
    },
    shields: {
      count: () => read((s) => s.shields.count()),
      buy: () => write((s) => s.shields.buy(), W),
      /** Spends a shield to save the workout streak for a missed day (it becomes a rest day). */
      protect: (day: string) =>
        write((s) => {
          if (!s.shields.consume()) throw new Error('No shields left: buy one in the shop')
          return s.body.setRest(day, true, new Date(), true)
        }, W)
    },
    exporter: {
      exportCsv: (kind: 'workouts' | 'expenses') => read((s) => s.exporter.exportCsv(kind)),
      exportJson: () => read((s) => s.exporter.exportJson())
    },
    economy: {
      summary: () => read((s) => s.economy.getEconomySummary()),
      goals: () => read((s) => s.economy.goals()),
      saveGoal: (g: WishlistGoalInput) => write((s) => s.economy.saveGoal(g)),
      deleteGoal: (id: number) => write((s) => s.economy.deleteGoal(id)),
      pinGoal: (id: number) => write((s) => s.economy.pinGoal(id)),
      depositCoins: (goalId: number, amount: number) => write((s) => s.economy.depositCoinsToGoal(goalId, amount), W),
      depositVault: (goalId: number, amount: number) => write((s) => s.economy.depositVaultCashToGoal(goalId, amount)),
      claimGoal: (goalId: number) => write((s) => s.economy.claimGoal(goalId)),
      creditVault: (amount: number, note: string) => write((s) => s.economy.creditVault('manual_deposit', amount, note)),
      setExchangeRate: (rate: number) => write((s) => (s.economy.setExchangeRate(rate), s.economy.getExchangeRate())),
      setCurrency: (cur: string) => write((s) => (s.economy.setCurrency(cur), s.economy.getEconomySummary())),
      /** RL7: what's left this month (fun budget, else Finance Helper's month limit) and the goal it can go to. */
      leftover: () => read((s) => leftover(s)),
      /** RL7: moves the leftover to the savings goal in Finance Helper (once a month), with a small "Saved" bonus. Undo takes both back. */
      moveLeftover: () =>
        write((s) => {
          const l = leftover(s)
          if (l.moved) throw new LedgerError(`Already moved ${l.moved.lei} lei to ${l.moved.goal} this month`)
          if (!(l.leftLei > 0)) throw new LedgerError('Nothing left over to move this month')
          if (!l.goal) throw new LedgerError('Add a savings goal in Finance Helper first (one you fill by hand, or one on a savings account)')
          const now = new Date()
          const today = s.wallet.today(now)
          const ledgerId = s.wallet.append({ ts: now.toISOString(), day: today, module: 'money', kind: 'earn', coins: SAVED_BONUS, xp: 0, ref: `saved:${l.month}`, note: `Saved: ${l.leftLei} lei to ${l.goal.name}` })
          queueFinanceExpense(s.db as any, { id: savedFinId(l.month, ledgerId), type: 'saving', goalId: l.goal.id, amount: l.leftLei * 100, category: '', note: `Left over from your ${l.kind === 'fun' ? 'fun' : 'month'} budget`, date: today, at: now.getTime() })
          s.shop.recordMove(l.month, { lei: l.leftLei, ledgerId, kind: l.kind, goal: l.goal.name })
          return { ...leftover(s), toast: `+${SAVED_BONUS} points · ${l.leftLei} lei moved to ${l.goal.name}` }
        }, W),
      /** RL2: new prices from real cost for old rewards (only suggests; apply each with save). */
      reprice: () => read((s) => repriceSuggestions(s.shop.state().rewards, shopValue(s).value, financeOf(s)?.rates)),
      /** RL3: the monthly fun budget, by hand or from Finance Helper's Fun / Entertainment limit. */
      setFunBudget: (b: { lei: number; source: 'manual' | 'finance' } | null) =>
        write((s) => {
          if (b?.source === 'finance') {
            const cat = financeFunCategory(financeOf(s))
            if (!cat) throw new LedgerError('Finance Helper has no Fun or Entertainment category with a monthly limit')
            s.shop.setFunBudget({ lei: cat.lei, source: 'finance' })
          } else s.shop.setFunBudget(b)
          return shopValue(s)
        }),
      openChest: (level: number) => write((s) => s.economy.openEnhancedChest(level), W),
      bankState: () => read((s) => s.economy.getBankState()),
      stakeCoins: (amount: number) => write((s) => s.economy.stakeCoins(amount), W),
      withdrawCoins: (amount: number) => write((s) => s.economy.withdrawCoins(amount), W),
      claimInterest: () => write((s) => s.economy.claimInterest(), W),
      activeBuffs: () => read((s) => s.economy.getActiveBuffs()),
      buyConsumable: (itemId: string) => write((s) => s.economy.buyConsumable(itemId), W),
      getConfig: () => read((s) => s.economy.getEconomyConfig()),
      saveConfig: (patch: any) => write((s) => s.economy.saveEconomyConfig(patch), W),
      applyPreset: (preset: 'balanced' | 'spartan' | 'turbo') => write((s) => s.economy.applyEconomyPreset(preset), W)
    }
  }
}
export type WebServices = ReturnType<typeof createWebServices>
