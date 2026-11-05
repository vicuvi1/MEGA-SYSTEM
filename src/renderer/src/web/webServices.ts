// The desktop services (src/main/*.ts) running on the web app's copy of the
// Turso database. Same rules as the desktop: daily caps, cooldowns, undo,
// quests, the shop, streaks. Each change is saved to Turso before it shows.
import { moneyNumbers } from './benDesk'
import { financeStateFrom } from './botBrain'
import { queueFinanceExpense } from './financeInbox'
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
import type { BrowserDb } from './browserDb'
import type { Mirror } from './mirror'

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
          return s.wallet.summary()
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
      save: (r: RewardInput) => write((s) => (s.shop.save(r), s.shop.state())),
      archive: (id: number) => write((s) => (s.shop.archive(id), s.shop.state())),
      // A reward with a real cost (M1): checked against Safe to spend first, then logged in Finance Helper.
      redeem: (id: number, opts: { force?: boolean } = {}) =>
        write((s) => {
          const reward = s.shop.state().rewards.find((r) => r.id === id)
          const lei = reward?.realCost ?? 0
          if (lei > 0 && !opts.force) {
            const finance = financeStateFrom(s.db, typeof localStorage !== 'undefined' ? localStorage : null)
            const safe = finance ? moneyNumbers(finance, s.wallet.today()).safeToday : null
            if (safe != null && lei * 100 > safe) throw new LedgerError(`OVER_SAFE: ${reward!.title} costs ${lei} lei and your Safe to spend today is ${Math.round(safe / 100)} lei.`)
          }
          s.shop.redeem(id)
          if (lei > 0 && reward) queueFinanceExpense(s.db as any, { id: `life-reward-${id}-${Date.now()}`, amount: Math.round(lei * 100), category: 'fun', note: `Reward: ${reward.title}`, date: s.wallet.today(), at: Date.now() })
          return s.shop.state()
        }, W),
      openChest: (level: number) => write((s) => ({ coins: s.shop.openChest(level), state: s.shop.state() }), W),
      setBudget: (amount: number) => write((s) => (s.shop.setBudget(amount), s.shop.state())),
      setCurrency: (cur: string) => write((s) => (s.shop.setCurrency(cur), s.shop.state()))
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
      startUrge: () => write((s) => (s.discipline.startUrge(), s.discipline.state()), W, D),
      finishUrge: () => write((s) => (s.discipline.finishUrge(), s.discipline.state()), W, D),
      cancelUrge: () => write((s) => (s.discipline.cancelUrge(), s.discipline.state()), W, D),
      claim: (days: number) => write((s) => ({ coins: s.discipline.claim(days), state: s.discipline.state() }), W, D),
      setStealth: (on: boolean) => write((s) => (s.discipline.setStealth(on), s.discipline.state()))
    },
    body: {
      state: () => read((s) => s.body.state()),
      logWorkout: (input: WorkoutInput) => write((s) => s.body.logWorkout(input), W, B),
      deleteWorkout: (id: number) => write((s) => s.body.deleteWorkout(id), W, B),
      logMetric: (input: BodyMetricInput) => write((s) => s.body.logMetric(input), W, B),
      saveExercise: (ex: Omit<Exercise, 'id' | 'sort'> & { id?: string; sort?: number }) => write((s) => (s.body.saveExercise(ex), s.body.state()), B),
      setRest: (day: string | null, on: boolean) => write((s) => s.body.setRest(day, on), B)
    },
    focus: {
      state: () => read((s) => s.focus.state()),
      start: (subject: string, planned?: number, task?: FocusTask | null) => write((s) => s.focus.start(subject, planned, new Date(), task ?? null)),
      stop: () => write((s) => s.focus.stop(), W),
      cancel: () => write((s) => s.focus.cancel()),
      extend: (minutes: number) => write((s) => s.focus.extend(minutes)),
      add: (subject: string, minutes: number, day?: string) => write((s) => s.focus.add(subject, minutes, day), W),
      setPlan: (items: import('@core/focus').PlanInput[]) => write((s) => s.focus.setPlan(items)),
      togglePlan: (index: number) => write((s) => s.focus.togglePlan(index), W),
      review: (text: string | null, reasons: string[]) => write((s) => s.focus.review(text, reasons)),
      saveGoal: (g: { id?: number; title: string; subject: string; deadline: string; hours: number }) => write((s) => s.focus.saveGoal(g)),
      archiveGoal: (id: number) => write((s) => s.focus.archiveGoal(id)),
      fun: (minutes: number, what?: string) => write((s) => s.focus.fun(minutes, what), W)
    },
    progress: {
      report: (spending: { day: string; bani: number }[] | null) => read((s) => s.progress.report(spending)),
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
      setWake: (day: string, time: string) => write((s) => s.sleep.setWake(day, time), W),
      setTargets: (weekday: string, weekend: string, bedtime?: string) => write((s) => s.sleep.setTargets(weekday, weekend, bedtime))
    },
    money: {
      state: () => read((s) => s.money.state()),
      addExpense: (amountBani: number, category: string, note?: string) => write((s) => s.money.addExpense(amountBani, category as any, note), W),
      deleteExpense: (id: number) => write((s) => s.money.deleteExpense(id)),
      setBudget: (budgetBani: number) => write((s) => s.money.setBudget(budgetBani)),
      setCurrency: (cur: string) => write((s) => s.money.setCurrency(cur))
    },
    shields: {
      count: () => read((s) => s.shields.count()),
      buy: () => write((s) => s.shields.buy(), W),
      /** Spends a shield to save the workout streak for a missed day (it becomes a rest day). */
      protect: (day: string) =>
        write((s) => {
          if (!s.shields.consume()) throw new Error('No shields left: buy one in the shop')
          return s.body.setRest(day, true)
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
