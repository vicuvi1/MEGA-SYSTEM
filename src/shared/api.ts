import type {
  AIConfig,
  AIPerformanceReport,
  GeneratedReward,
  InspectedProductResult,
  ModelChoice,
  TaskDecompositionItem,
  TaskDecompositionResult,
  SystemCoachContext
} from '@core/ai'
import { POPULAR_MODELS } from '@core/ai'
import type {
  ChestLootDrop,
  MultiplierInfo,
  WishlistCategory,
  WishlistGoal,
  SupportedCurrency,
  CurrencyConfig,
  BankState,
  ActiveBuff,
  ConsumableItem,
  ConsumableId,
  EconomyConfig,
  EconomyPreset
} from '@core/unifiedEconomy'
import { CONSUMABLE_CATALOG, ECONOMY_PRESETS } from '@core/unifiedEconomy'
import {
  CURRENCY_CONFIGS,
  convertCurrency,
  formatDualCurrency
} from '@core/unifiedEconomy'
import type { LedgerEntry } from '@core/ledger'
import type { LevelInfo, HunterRankDef, HunterAttributes, StatAllocation, HunterPerkDef, HunterPerk } from '@core/levels'
import type { Rule } from '@core/rules'
import type { Reward, Tier, EffortEquivalence } from '@core/shop'
import { calculateEffortEquivalence } from '@core/shop'
import type { QuestState } from '@core/quests'
import type { Block, BlockKind, BlockStatus, Repeat, Task } from '@core/plan'
import type { BodyMetric, BodyMetricInput, BodySummary, Exercise, Workout, WorkoutExerciseItem, WorkoutInput } from '@core/body'
import type { SleepLog, SleepSummary } from '@core/sleep'
import type { Expense, ExpenseCategory, DailyExpenseSummary } from '@core/money'
import type { CalendarConfig, CalendarEvent } from '@core/calendar'
import { DEFAULT_CALENDAR_CONFIG } from '@core/calendar'
import type { SyncEvent, SyncResult } from '@core/sync'

export interface SyncConfig {
  syncUrl: string
  syncSecret: string
  autoSyncOnStartup: boolean
  syncIntervalMinutes: number
  lastSyncedAt: string | null
  lastSyncedCount: number
}

export type { CalendarConfig, CalendarEvent }
export type { SyncEvent, SyncResult }
export { DEFAULT_CALENDAR_CONFIG }

export type { TaskDecompositionItem, TaskDecompositionResult, SystemCoachContext }
export type { QuestState }
export type { LedgerEntry, LevelInfo, HunterRankDef, HunterAttributes, StatAllocation, HunterPerkDef, HunterPerk, Rule, Reward, Tier, EffortEquivalence, Block, BlockKind, BlockStatus, Repeat, Task }
export { calculateEffortEquivalence }
export type { BodyMetric, BodyMetricInput, BodySummary, Exercise, Workout, WorkoutExerciseItem, WorkoutInput }
export type BodyState = BodySummary
export type { SleepLog, SleepSummary, Expense, ExpenseCategory, DailyExpenseSummary }

export interface NativeMoneySummary {
  currency: string
  dailyBudget: number
  today: DailyExpenseSummary
  monthSpent: number
  recentExpenses: Expense[]
}


export type { ChestLootDrop, MultiplierInfo, WishlistCategory, WishlistGoal, SupportedCurrency, CurrencyConfig, BankState, ActiveBuff, ConsumableItem, ConsumableId, EconomyConfig, EconomyPreset }
export { CONSUMABLE_CATALOG, ECONOMY_PRESETS }
export { CURRENCY_CONFIGS, convertCurrency, formatDualCurrency }
export type { AIConfig, AIPerformanceReport, GeneratedReward, InspectedProductResult, ModelChoice }
export { POPULAR_MODELS }

export interface WishlistGoalInput {
  id?: number
  title: string
  targetCoins: number
  targetRealCost: number
  category?: WishlistCategory
  pinned?: boolean
  note?: string
  imageUrl?: string | null
  productUrl?: string | null
  currency?: string | null
}

export interface VaultLedgerEntry {
  id: number
  ts: string
  day: string
  kind: 'surplus_credit' | 'manual_deposit' | 'goal_allocation' | 'reward_payout' | 'chest_bonus'
  amount: number
  ref: string | null
  note: string
}

export interface EconomySummary {
  coinsBalance: number
  coinsRealValue: number
  exchangeRate: number
  vaultBalance: number
  currency: string
  monthlyBudget: number
  monthSpent: number
  multiplier: MultiplierInfo
  pinnedGoal: WishlistGoal | null
  goals: WishlistGoal[]
  recentVaultEntries: VaultLedgerEntry[]
  bank?: BankState
  activeBuffs?: ActiveBuff[]
}

export interface ShopState {
  rewards: Reward[]
  balance: number
  level: number
  /** Monthly real-money cap for rewards, 0 = no cap. */
  budget: number
  monthSpent: number
  currency: string
  /** Levels whose chest is waiting to be opened. */
  chests: number[]
  recent: { title: string; realCost: number; day: string; undone: boolean }[]
  economy?: EconomySummary
}

export type RewardInput = Omit<Reward, 'id' | 'archived'> & { id?: number }

export interface Category {
  id: string
  label: string
  color: string
}

export interface TaskView extends Task {
  done: boolean
  overdue: boolean
  /** When it was last completed (for repeating tasks, the most recent day). */
  lastDone: string | null
}

export interface TasksState {
  today: string
  categories: Category[]
  /** Tasks that show today (open one-offs, today's repeats, things done today). */
  tasks: TaskView[]
  coinsToday: number
  dailyCap: number
}

export type TaskInput = Omit<Task, 'id' | 'createdDay'> & { id?: number }

export interface BlockView extends Block {
  day: string
  status: BlockStatus
  startsAt: string // ISO
  endsAt: string // ISO
  startedAt: string | null
  finishAllowedAt: string | null
}

export interface ScheduleState {
  day: string
  today: string
  blocks: BlockView[]
  /** Every block definition, for the weekly editor. */
  all: Block[]
}

export type BlockInput = Omit<Block, 'id' | 'createdDay'> & { id?: number }

export interface DisciplineState {
  setup: boolean
  today: string
  since: string | null
  current: number
  best: number
  totalClean: number
  resets: number
  rank: string
  nextRank: { name: string; days: number } | null
  checkedInToday: boolean
  oathToday: boolean
  resetToday: boolean
  canEditStart: boolean
  milestones: { days: number; coins: number; status: 'locked' | 'claimable' | 'claimed' | 'before-setup'; reachedOn: string | null }[]
  urgeStartedAt: string | null
  urgesThisWeek: number
  stealth: boolean
  quote: string
}

export type ConnectionKind = 'waky' | 'finance' | 'man'

export interface ConnectionBase {
  path: string | null
  found: boolean
  error: string | null
}

export interface ConnectionsState {
  today: string
  lastSync: string | null
  waky: ConnectionBase & {
    connectedSince: string | null
    weekday: string | null
    weekend: string | null
    today: { time: string; target: string; onTime: boolean } | null
    streak: number
    best: number
    onTimeRate: number | null // last 14 days with a check-in
    mornings: { day: string; time: string; target: string; onTime: boolean; sleptMin: number | null }[]
    avgSleepMin: number | null
  }
  finance: ConnectionBase & {
    connectedSince: string | null
    currency: string
    savedAt: string | null
    staleDays: number | null
    dailyBudget: number // whole currency units, 0 = off
    today: { logged: boolean; everydaySpent: number } | null
    month: { spent: number; everyday: number; income: number; days: number } | null
    days: { day: string; logged: boolean; everydaySpent: number; judged: boolean }[]
  }
  man: ConnectionBase & {
    data: { streakDays: number; longestStreak: number; totalVictories: number; lastCheckin: string | null; urgesCrushed: number; oathsSworn: number } | null
    suggestion: { start: string; showsDays: number; lastTapDaysAgo: number | null; note: string | null } | null
  }
}


export interface TelegramConfig {
  botToken: string
  chatId: string
  enabled: boolean
  morningBriefing: boolean
  eveningNudge: boolean
}

export interface EmbeddedApps {
  finance: { url: string; partition: string; preloadReady: boolean }
  man: { url: string; partition: string }
  waky: { url: string; partition: string }
  sport: { url: string; partition: string }
  migration: { finance: 'copied' | 'exists' | 'missing'; man: 'copied' | 'exists' | 'missing' } | null
}

export interface UpdateStatus {
  current: string
  state: 'dev' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
  latest: string | null
  progress: number
  error: string | null
  checkedAt: string | null
}

export interface LogEntry {
  at: string
  level: 'error' | 'warn' | 'info'
  source: string
  message: string
  detail?: string
}

export interface AppPrefs {
  openAtLogin: boolean
  /** Auto-start only works in the installed app, not in dev. */
  canAutoStart: boolean
  keepInTray: boolean
  /** Give Finance Helper, Waky and MAN Life System's colors and fonts. */
  matchAppThemes: boolean
}

export interface Summary {
  balance: number
  totalXp: number
  level: LevelInfo
  today: string
  todayCoins: number
  todayXp: number
  todayRules?: string[]
  recent: LedgerEntry[]
}


export interface BotLogEntry {
  id: number
  ts: string
  command: string
  sender: string
  success: boolean
  reply: string
}

export interface BotBridgeConfig {
  botToken: string
  chatId: string
  /** One bot for everything (sport, money, discipline, sleep, tasks). */
  megaBotToken?: string
  /** The web server answers the bots 24/7 (Telegram webhooks): the app doesn't poll. */
  serverBots?: boolean
  /** Bots run by their own program (e.g. Sporty's Python bot): never read by the app. */
  skipBotIds?: string[]
  enabled: boolean
  pollingEnabled: boolean
  morningBriefing: boolean
  eveningNudge: boolean
  sportBotToken?: string
  sportBotChatId?: string
  financeBotToken?: string
  financeBotChatId?: string
  manBotToken?: string
  manBotChatId?: string
  wakyBotToken?: string
  wakyBotChatId?: string
  plannerBotToken?: string
  plannerBotChatId?: string
  coachBotToken?: string
  coachBotChatId?: string
  financeSyncEnabled?: boolean
}

export interface AuthStatus {
  pinSet: boolean
  locked: boolean
}

export interface BackupStatus {
  dir: string
  driveAvailable: boolean
  passphraseSet: boolean
  last: { name: string; at: string } | null
  pending: number
  count: number
  lastError: string | null
}

export interface VerifyResult {
  ok: boolean
  name: string | null
  detail: string
}

/** The bridge the renderer sees as `window.life`. Every call is async. */
export interface LifeApi {
  auth: {
    status(): Promise<AuthStatus>
    setPin(pin: string, currentPin?: string): Promise<AuthStatus>
    unlock(pin: string): Promise<AuthStatus>
    lock(): Promise<AuthStatus>
  }
  wallet: {
    summary(): Promise<Summary>
    history(limit?: number): Promise<LedgerEntry[]>
    award(ruleId: string, note?: string): Promise<Summary>
    undo(id: number, note: string): Promise<Summary>
    quests(): Promise<QuestState>
    claimQuests(): Promise<Summary>
    allocateStats(stat: 'str' | 'agi' | 'vit' | 'int' | 'sen', points?: number): Promise<Summary>
    resetStats(): Promise<Summary>
  }
  rules: {
    list(): Promise<Rule[]>
    save(rule: Rule): Promise<Rule[]>
  }
  shop: {
    state(): Promise<ShopState>
    save(reward: RewardInput): Promise<ShopState>
    archive(id: number): Promise<ShopState>
    redeem(id: number): Promise<ShopState>
    openChest(level: number): Promise<{ coins: number; state: ShopState }>
    setBudget(amount: number): Promise<ShopState>
    setCurrency(cur: string): Promise<ShopState>
  }
  tasks: {
    state(): Promise<TasksState>
    save(task: TaskInput): Promise<TasksState>
    archive(id: number): Promise<TasksState>
    complete(id: number): Promise<TasksState>
    uncomplete(id: number): Promise<TasksState>
    saveCategory(c: Category): Promise<TasksState>
    archiveCategory(id: string): Promise<TasksState>
  }
  schedule: {
    state(day?: string): Promise<ScheduleState>
    save(block: BlockInput): Promise<ScheduleState>
    archive(id: number): Promise<ScheduleState>
    start(id: number): Promise<ScheduleState>
    finish(id: number): Promise<ScheduleState>
    skip(id: number): Promise<ScheduleState>
  }
  discipline: {
    state(): Promise<DisciplineState>
    setStart(day: string): Promise<DisciplineState>
    checkIn(): Promise<DisciplineState>
    oath(): Promise<DisciplineState>
    reset(): Promise<DisciplineState>
    claim(days: number): Promise<{ coins: number; state: DisciplineState }>
    startUrge(): Promise<DisciplineState>
    finishUrge(): Promise<DisciplineState>
    cancelUrge(): Promise<DisciplineState>
    setStealth(on: boolean): Promise<DisciplineState>
  }
  body: {
    state(): Promise<BodyState>
    logWorkout(input: WorkoutInput): Promise<{ workout: Workout; state: BodyState; awarded: boolean }>
    deleteWorkout(id: number): Promise<BodyState>
    logMetric(input: BodyMetricInput): Promise<BodyState>
    saveExercise(exercise: Omit<Exercise, 'id' | 'sort'> & { id?: string; sort?: number }): Promise<BodyState>
  }
  connections: {
    state(): Promise<ConnectionsState>
    connect(kind: 'waky' | 'finance'): Promise<ConnectionsState>
    disconnect(kind: 'waky' | 'finance'): Promise<ConnectionsState>
    sync(): Promise<{ awarded: number; state: ConnectionsState }>
    choosePath(kind: ConnectionKind): Promise<ConnectionsState>
    setDailyBudget(amount: number): Promise<ConnectionsState>
  }
  updates: {
    status(): Promise<UpdateStatus>
    check(): Promise<UpdateStatus>
    /** Download the newest version, install it and restart. */
    run(): Promise<UpdateStatus>
  }
  apps: {
    info(): Promise<EmbeddedApps>
    startWaky(): Promise<{ ok: boolean; error: string | null }>
  }
  app: {
    /** Window full screen on/off; returns the new state. */
    toggleFullScreen(): Promise<boolean>
    /** Saves a problem from the window to the log. */
    reportError(message: string, detail?: string): Promise<void>
    recentErrors(): Promise<LogEntry[]>
    openLogs(): Promise<string>
    prefs(): Promise<AppPrefs>
    setPrefs(p: Partial<AppPrefs>): Promise<AppPrefs>
  }
  telegram: {
    config(): Promise<TelegramConfig>
    saveConfig(cfg: Partial<TelegramConfig>): Promise<TelegramConfig>
    test(botKey?: string): Promise<{ ok: boolean; error?: string }>
  }
  backup: {
    status(): Promise<BackupStatus>
    chooseDir(): Promise<BackupStatus>
    setPassphrase(passphrase: string): Promise<BackupStatus>
    runNow(): Promise<BackupStatus>
    list(): Promise<string[]>
    verifyLatest(): Promise<VerifyResult>
    restore(name: string, passphrase: string): Promise<void>
  }
  sleep: {
    state(): Promise<SleepSummary>
    logWake(time?: string, quality?: number): Promise<{ log: SleepLog; state: SleepSummary; awarded: boolean }>
    logBed(time?: string): Promise<{ log: SleepLog; state: SleepSummary; awarded: boolean }>
    /** The real wake-up time for today or one of the last 14 days (coins only for today). */
    setWake(day: string, time: string): Promise<{ log: SleepLog; state: SleepSummary; awarded: boolean }>
    setTargets(weekday: string, weekend: string, bedtime?: string): Promise<SleepSummary>
  }
  money: {
    state(): Promise<NativeMoneySummary>
    addExpense(amountBani: number, category: string, note?: string): Promise<{ expense: Expense; state: NativeMoneySummary; awarded: boolean }>
    deleteExpense(id: number): Promise<NativeMoneySummary>
    setBudget(budgetBani: number): Promise<NativeMoneySummary>
    setCurrency(cur: string): Promise<NativeMoneySummary>
  }
  shields: {
    count(): Promise<number>
    buy(): Promise<{ shields: number; balance: number }>
  }
  data: {
    exportJson(): Promise<string>
    exportCsv(kind: 'workouts' | 'expenses'): Promise<string>
    cloudSnapshots?(): Promise<{ day: string; exportedAt: string; sizeBytes: number }[]>
    saveDailySnapshot?(): Promise<boolean>
    restoreCloudSnapshot?(day: string): Promise<boolean>
  }
    economy: {
    summary(): Promise<EconomySummary>
    goals(): Promise<WishlistGoal[]>
    saveGoal(goal: WishlistGoalInput): Promise<WishlistGoal>
    deleteGoal(id: number): Promise<void>
    pinGoal(id: number): Promise<void>
    depositCoins(goalId: number, amount: number): Promise<{ goal: WishlistGoal; balance: number }>
    depositVault(goalId: number, amount: number): Promise<{ goal: WishlistGoal; vaultBalance: number }>
    claimGoal(goalId: number): Promise<WishlistGoal>
    creditVault(amount: number, note: string): Promise<number>
    setExchangeRate(rate: number): Promise<number>
    setCurrency(cur: string): Promise<EconomySummary>
    openChest(level: number): Promise<{ drop: ChestLootDrop; coins: number; balance: number; chests: number[] }>
    bankState(): Promise<BankState>
    stakeCoins(amount: number): Promise<BankState>
    withdrawCoins(amount: number): Promise<BankState>
    claimInterest(): Promise<{ bank: BankState; claimedCoins: number }>
    activeBuffs(): Promise<ActiveBuff[]>
    buyConsumable(itemId: string): Promise<{ buff?: ActiveBuff; balance: number; message: string }>
    getConfig(): Promise<EconomyConfig>
    saveConfig(patch: Partial<EconomyConfig>): Promise<EconomyConfig>
    applyPreset(preset: 'balanced' | 'spartan' | 'turbo'): Promise<EconomyConfig>
  }
  bots: {
    config(): Promise<BotBridgeConfig>
    saveConfig(cfg: Partial<BotBridgeConfig>): Promise<BotBridgeConfig>
    status(): Promise<{ polling: boolean; enabled: boolean; configured: boolean; lastPollAt: string | null; lastError: string | null; processedCount: number }>
    logs(): Promise<BotLogEntry[]>
    clearLogs(): Promise<void>
    test(botKey?: string): Promise<{ ok: boolean; error?: string }>
    startPolling(): Promise<boolean>
    stopPolling(): Promise<boolean>
    pollOnce?(): Promise<{ processedCount: number; replies: string[] }>
  }
  ai: {
    config(): Promise<AIConfig>
    saveConfig(cfg: Partial<AIConfig>): Promise<AIConfig>
    test(provider?: 'gemini' | 'openrouter'): Promise<{ ok: boolean; message: string; model: string }>
    generateRewards(userPrompt?: string): Promise<{ rewards: GeneratedReward[]; modelUsed: string }>
    performanceReport(): Promise<AIPerformanceReport>
    askCoach(
      message: string,
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
    ): Promise<{
      reply: string
      modelUsed: string
      toolExecutions?: Array<{ tool: string; result: string; success: boolean }>
    }>
    decomposeTask(title: string, notes?: string, category?: string): Promise<TaskDecompositionResult>
    inspectProduct(queryOrUrl: string): Promise<InspectedProductResult>
  }
  calendar: {
    config(): Promise<CalendarConfig>
    saveConfig(cfg: Partial<CalendarConfig>): Promise<CalendarConfig>
    sync(): Promise<{ events: CalendarEvent[]; count: number; error?: string }>
    events(day?: string): Promise<CalendarEvent[]>
    clear(): Promise<void>
  }
  hud: {
    hide(): Promise<void>
    toggle(): Promise<void>
    show(): Promise<void>
  }
  sync: {
    config(): Promise<SyncConfig>
    saveConfig(cfg: Partial<SyncConfig>): Promise<SyncConfig>
    test(url?: string, secret?: string): Promise<{ success: boolean; latencyMs: number; message: string; count?: number }>
    pull(): Promise<SyncResult>
  }
}

/** IPC replies are wrapped so error messages reach the UI cleanly. */
export type IpcReply<T> = { ok: true; data: T } | { ok: false; error: string }
