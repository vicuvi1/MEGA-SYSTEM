// The desktop services (src/main/*.ts) running on the web app's copy of the
// Turso database. Same rules as the desktop: daily caps, cooldowns, undo,
// quests, the shop, streaks. Each change is saved to Turso before it shows.
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
import { UnifiedEconomyService } from '../../../main/unifiedEconomy'
import { Wallet } from '../../../main/wallet'
import type { BrowserDb } from './browserDb'
import type { Mirror } from './mirror'

/** All services, built for one copy of the database. */
function servicesFor(db: BrowserDb) {
  const d = db as any
  const wallet = new Wallet(d)
  const shields = new ShieldService(d, wallet)
  const discipline = new Discipline(d, wallet)
  const money = new MoneyService(d, wallet)
  const body = new Body(d, wallet)
  const shop = new Shop(d, wallet)
  return {
    wallet,
    shields,
    discipline,
    money,
    body,
    shop,
    tasks: new Tasks(d, wallet, shields),
    schedule: new Schedule(d, wallet),
    sleep: new SleepService(d, wallet),
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
      // Unlike the desktop, sleep/money/discipline rules are allowed here: on
      // the web the embedded apps (Waky, Finance Helper, MAN) pay them, and
      // each is capped at once a day by its rule.
      award: (ruleId: string, note?: string) =>
        write((s) => {
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
      redeem: (id: number) => write((s) => (s.shop.redeem(id), s.shop.state()), W),
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
      saveExercise: (ex: Omit<Exercise, 'id' | 'sort'> & { id?: string; sort?: number }) => write((s) => (s.body.saveExercise(ex), s.body.state()), B)
    },
    sleep: {
      state: () => read((s) => s.sleep.state()),
      logWake: (time?: string, quality?: number) => write((s) => s.sleep.logWake(time, quality), W),
      logBed: (time?: string) => write((s) => s.sleep.logBed(time), W),
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
      buy: () => write((s) => s.shields.buy(), W)
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
