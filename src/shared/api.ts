import type {
  AIConfig,
  AIPerformanceReport,
  GeneratedReward,
  InspectedProductResult,
  ModelChoice,
  TaskDecompositionItem,
  TaskDecompositionResult
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

export type { TaskDecompositionItem, TaskDecompositionResult }
export type { QuestState }
export type { LedgerEntry, LevelInfo, HunterRankDef, HunterAttributes, StatAllocation, HunterPerkDef, HunterPerk, Rule, Reward, Tier, EffortEquivalence, Block, BlockKind, BlockStatus, Repeat, Task }
export { calculateEffortEquivalence }
export type { BodyMetric, BodyMetricInput, BodySummary, Exercise, Workout, WorkoutExerciseItem, WorkoutInput }
export type BodyState = BodySummary
export type { SleepLog, SleepSummary, Expense, ExpenseCategory, DailyExpenseSummary }
export type { FocusState, RunningFocus, FocusTask } from '../main/focus'
export type { DayPlan, FocusSession, GoalProgress, WeekReport } from '@core/focus'
import type { FocusState, FocusTask } from '../main/focus'
import type { DayPlan, FocusSession } from '@core/focus'

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
  /** Old hard cap, always 0 now: the monthly fun budget lives in shop.value() (RL3). */
  budget: number
  monthSpent: number
  currency: string
  /** Levels whose chest is waiting to be opened. */
  chests: number[]
  recent: {
    title: string
    realCost: number
    day: string
    undone: boolean
    /** Night 11: the ledger row of the buy (for "Undo buy"), the reward, points paid (wallet + jar), its look. */
    ledgerId?: number
    rewardId?: number
    coins?: number
    emoji?: string | null
    category?: string | null
    imageUrl?: string | null
  }[]
  /** Days of each reward's buys that still count (cooldowns and monthly limits). */
  buys?: Record<number, string[]>
  /** Today's day key, as the shop sees it. */
  today?: string
  economy?: EconomySummary
  /** Your usual points a day (last 30 days), for "about 3 days" next to a price. */
  earnPerDay?: number
  /** Healthy limits per reward id (a most-per-day, "pair it"), and why each blocks a buy now (null = fine). */
  rules?: Record<string, import('@core/rewardGuard').RewardRules>
  guards?: Record<number, string | null>
  /** Coupons you can use now (from chests and the weekly mystery reward). */
  coupons?: import('@core/rewardSurprise').Coupon[]
  /** Set right after a buy (RL4): what went, for the toast "−600 points · −150 lei added to Money as Fun". */
  lastBuy?: { ledgerId: number; title: string; points: number; paid: number; currency: string; toast: string }
}

export type RewardInput = Omit<Reward, 'id' | 'archived'> & { id?: number }

/** RL7: leftover money this month, ready to move to savings. */
export interface LeftoverState {
  month: string
  /** 'fun' = your fun budget; 'month' = Finance Helper's month limit (no fun budget set). */
  kind: 'fun' | 'month'
  budgetLei: number | null
  /** Whole lei you can move now (0 = nothing, or already moved). */
  leftLei: number
  goal: { id: string; name: string } | null
  moved: { lei: number; ledgerId: number; kind: 'fun' | 'month'; goal: string } | null
  /** The last days of the month. */
  monthEnd: boolean
  /** After a move: "+10 points · 120 lei moved to Trip". */
  toast?: string
}

/** FX3/RL6: honest money days. Amounts in bani. */
export interface MoneyDaysState {
  today: import('@core/moneyDays').MoneyDay & { day: string; nothingSpentTapped: boolean }
  /** The daily budget you set, bani (0 = none). */
  dailyBudget: number
  days: import('@core/moneyDays').JudgedMoneyDay[]
  streak: { days: number; next: { days: number; points: number } | null }
}

/** RL1: what a point is worth in real money, and this month's fun budget (life.shop.value()). */
export interface ShopValue {
  value: import('@core/pointValue').PointValue
  /** Monthly fun budget in lei (null = not set). */
  funBudgetLei: number | null
  /** Lei spent on fun this month (rewards bought, plus Finance Helper's Fun category when the budget comes from there). */
  funSpentLei: number
  /** What is left (null without a budget; below 0 = over). */
  funLeftLei: number | null
  /** Your hour of work in lei (Finance Helper), null when unknown. */
  hourlyLei: number | null
  /** Where the budget comes from (extra, may be missing). */
  funSource?: 'manual' | 'finance' | null
}

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
  /** The streak as "Day N" (dayNumber): what every screen shows. */
  day: number
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
  /** MN3: when the clean-day check-in can be done ('wait' = it opens at 19:00). */
  checkIn?: { mode: 'today' | 'yesterday' | 'wait' | 'done'; day: string }
  /** MN25: the last 12 weeks of check-ins, resets and urges, for honest charts. */
  history?: { day: string; kind: 'start' | 'reset' | 'checkin' | 'oath' | 'urge'; hour: number }[]
  /** MN7: a reset can be taken back until this time (10 minutes). */
  undoResetUntil?: string | null
  /** The first start date (before any reset), for the calendar. */
  startedOn?: string | null
  /** Every streak from the start, split at the resets (oldest first). */
  runs?: { from: string; to: string; days: number; ended: 'reset' | 'now' }[]
  /** Your reason, in your words (the urge crusher shows it). */
  why?: string | null
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
  /** What's new in the newer version (one line), when known. */
  notes?: string | null
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

export interface DeviceList {
  devices: { sid: string; label: string; created: number; lastSeen: number }[]
  passkeys: { id: string; label: string; created: number }[]
  current: string | null
}

/** The bridge the renderer sees as `window.life`. Every call is async. */
export interface LifeApi {
  auth: {
    status(): Promise<AuthStatus>
    setPin(pin: string, currentPin?: string): Promise<AuthStatus>
    /** End every other device's session (they must enter the PIN again). */
    signOutOthers?(): Promise<void>
    /** Fingerprint / face unlock (passkeys, website and installed app). */
    unlockPasskey?(): Promise<AuthStatus>
    setupPasskey?(): Promise<void>
    /** Devices signed in and passkeys saved, with the one you're on (A6). */
    devices?(): Promise<DeviceList>
    /** Sign one device out (it needs the PIN again). */
    revokeDevice?(sid: string): Promise<DeviceList>
    removePasskey?(id: string): Promise<DeviceList>
    unlock(pin: string): Promise<AuthStatus>
    lock(): Promise<AuthStatus>
    /** This device opens without the PIN (it remembers you). */
    remembered?(): Promise<boolean>
    /** Turn "ask for the PIN on this device" off (needs the PIN once) or back on. */
    setRemembered?(on: boolean, pin?: string): Promise<boolean>
  }
  /** The notification center (synced across devices). */
  /** Focus boost: the push ladder, stalling fixes, session goals and verdicts, launch kits, Dojo, win music. */
  boost?: import('../core/focusBoost').BoostApi
  /** What the desktop island learns about your day (focus quality, blocks checked off). */
  dayLog?: {
    addFocus(day: string, e: { at: string; subject: string; minutes: number; pct: number; workMin?: number; distractMin?: number }): Promise<void>
    addBlock(day: string, e: { at: string; title: string; result: 'done' | 'half' | 'no' }): Promise<void>
    /** P8: the day's PC totals for Ben (only if you share them). */
    setPc?(day: string, line: string): Promise<void>
    /** MC11: minutes on listed sites from the browser history (only with that switch on). */
    setWeb?(day: string, line: string): Promise<void>
    /** SI8/SI22: the day by kind of doing ("coding 3h10, study 1h05") and minutes per hour (only if you share totals). */
    setDoing?(day: string, line: string, hours: Record<string, Record<string, number>>): Promise<void>
    /** Island eyes: what's in front now, one short line for Ben (only with "Tell Ben" on). */
    setEyes?(day: string, line: string, at: number): Promise<void>
    /** Island 2: a focus check-in halfway through a timer ("Still on X?"). */
    addCheck?(day: string, e: { at: string; subject: string; answer: 'yes' | 'drifted' | 'switch' }): Promise<void>
  }
  /** Island 2: your island nudges (settings, people, tallies, move breaks), synced setting island_nudges. */
  nudges?: {
    get(): Promise<import('@core/islandNudges').NudgeStore>
    save(n: import('@core/islandNudges').NudgeStore): Promise<import('@core/islandNudges').NudgeStore>
  }
  /** BD4–BD6, BD12, BD15: sleep care (light, coffee, debt, after-shift) and the grooming habit (synced settings sleep_care, grooming). */
  care?: {
    state(): Promise<import('@core/sleepCare').CareView>
    coffee(cups?: number): Promise<{ reply: string; view: import('@core/sleepCare').CareView }>
    undoCoffee(): Promise<import('@core/sleepCare').CareView>
    light(): Promise<import('@core/sleepCare').CareView>
    warm(): Promise<import('@core/sleepCare').CareView>
    prefs(p: { needH?: number; curfewH?: number }): Promise<import('@core/sleepCare').CareView>
    shiftStep(step: string, on: boolean): Promise<import('@core/sleepCare').CareView>
    groom(sunny: boolean | null): Promise<import('@core/grooming').GroomView>
    /** Ticks a step; pays the day's one habit when every step is done (coins: what it paid now). */
    groomStep(id: string, on: boolean, sunny: boolean | null): Promise<import('@core/grooming').GroomView & { coins: number }>
    groomWeekly(id: 'nails' | 'haircut', done: boolean, sunny: boolean | null): Promise<import('@core/grooming').GroomView>
    groomRhythm(weeks: number, sunny: boolean | null): Promise<import('@core/grooming').GroomView>
  }
  /** AU2 / AU7: Ben's asks for the PC and the last hour's summary (synced settings pc_asks, pc_last_hour). */
  pcAuto?: {
    state(): Promise<import('@core/pcActions').PcState>
    answer(id: string, status: import('@core/pcActions').PcAsk['status'], why?: string): Promise<void>
    /** This desktop app can (or can no longer) answer Ben's asks. */
    desk(on: boolean): Promise<void>
    lastHour(h: import('@core/pcLastHour').LastHour | null): Promise<void>
  }
  /** MU: the song playing now, for Ben (only with that option on; null clears it). */
  musicNow?: { set(v: import('@core/music').MusicNow | null): Promise<void> }
  /** SI7: your Smart island recipes (synced; they run only in the desktop app). */
  recipes?: {
    list(): Promise<import('@core/recipes').Recipe[]>
    save(list: import('@core/recipes').Recipe[]): Promise<import('@core/recipes').Recipe[]>
  }
  /** Automation hub: your automations and Ben's asks to run one (synced settings automations, auto_asks). */
  automations?: {
    get(): Promise<import('@core/automations').AutomationStore>
    save(s: import('@core/automations').AutomationStore): Promise<import('@core/automations').AutomationStore>
    asks(): Promise<import('@core/automations').AutoAsk[]>
    setAsk(id: string, status: import('@core/automations').AutoAsk['status'], why?: string): Promise<void>
  }
  /** Island 2: your island tiles, buttons, profiles, colours and stations (synced settings). */
  islandKit?: {
    get(): Promise<import('@core/islandTiles').IslandKit>
    save(kit: import('@core/islandTiles').IslandKit): Promise<import('@core/islandTiles').IslandKit>
  }
  /** PL1–PL8: your widgets, pages, scripts and island look (synced setting island_widgets; cleaned by the caller). */
  widgets?: {
    get(): Promise<unknown>
    save(v: unknown): Promise<void>
  }
  /** The notebook (Obsidian-like): your notes and Ben's. */
  notes?: {
    list(): Promise<import('@core/notebook').Note[]>
    save(n: { id?: string; title: string; body: string; pinned?: boolean }): Promise<import('@core/notebook').Note>
    remove(id: string): Promise<void>
  }
  notifications?: {
    list(): Promise<import('@core/notify').Notif[]>
    read(ids: string[] | null): Promise<void>
    dismiss(id: string): Promise<void>
    /** Adds one made by the app (once per id, every device sees it). */
    add?(n: Omit<import('@core/notify').Notif, 'readAt'>): Promise<void>
    /** Comes back at `until` (ms). */
    snooze?(id: string, until: number): Promise<void>
    /** Quiet hours, event warnings, travel times: synced, the server uses them too. */
    settings?(): Promise<import('@core/eventAlerts').NotifSettings>
    saveSettings?(p: Partial<import('@core/eventAlerts').NotifSettings>): Promise<import('@core/eventAlerts').NotifSettings>
  }
  wallet: {
    summary(): Promise<Summary>
    history(limit?: number): Promise<LedgerEntry[]>
    award(ruleId: string, note?: string): Promise<Summary>
    undo(id: number, note: string): Promise<Summary>
    /** Pays a rule once for one thing that happened (ref); the ledger id, or 0 when nothing was paid. */
    payOnce?(ruleId: string, ref: string, note?: string): Promise<number>
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
    /**
     * `force`: buy even over Safe to spend or an empty fun budget (the explicit "buy anyway").
     * `paid`: real money you actually paid, in the reward's currency. Default 0: a buy
     * with points is not real spending and never goes to Finance Helper.
     * Errors start with OVER_SAFE: or FUN_EMPTY: when "buy anyway" may be offered.
     */
    redeem(id: number, opts?: { force?: boolean; paid?: number }): Promise<ShopState>
    openChest(level: number): Promise<{ coins: number; state: ShopState }>
    /** RL1: what a point is worth in lei, your fun budget, spent and left, your hour of work. */
    value(): Promise<ShopValue>
    /** RL3: set the monthly fun budget by hand, from Finance Helper's Fun/Entertainment limit, or off (null). */
    setFunBudget(b: { lei: number; source: 'manual' | 'finance' } | null): Promise<ShopValue>
    /** RL2: suggested new prices from real cost (only suggestions; apply one with save). */
    reprice(): Promise<import('@core/funBudget').RepriceRow[]>
    /** RL7: what is left this month and the Finance Helper goal it can go to. */
    leftover(): Promise<LeftoverState>
    /** RL7: move the leftover to that goal in one tap (once a month, small "Saved" bonus; undo from History). */
    moveLeftover(): Promise<LeftoverState>
    setBudget(amount: number): Promise<ShopState>
    setCurrency(cur: string): Promise<ShopState>
    /** Night 11 (Rewards page). Optional: older bridges may not have them. */
    insights?(): Promise<import('../main/shop').RewardsInsights>
    restore?(id: number): Promise<ShopState>
    setGoals?(ids: number[]): Promise<ShopState>
    reorder?(ids: number[]): Promise<ShopState>
    undoBuy?(ledgerId: number): Promise<ShopState>
    jarAdd?(rewardId: number, amount: number): Promise<ShopState>
    jarTake?(rewardId: number, amount: number): Promise<ShopState>
    claimChallenge?(): Promise<{ coins: number; state: ShopState }>
    /** Rewards 2: suggestions from your activity, where points came from, unlock progress, the mystery reward, Ben's fun note. */
    more?(): Promise<import('../renderer/src/web/rewardsMore').RewardsMore>
    addSuggestion?(key: string): Promise<ShopState>
    hideSuggestion?(key: string): Promise<import('../renderer/src/web/rewardsMore').RewardsMore>
    setRules?(rewardId: number, rules: import('@core/rewardGuard').RewardRules | null): Promise<ShopState>
    openChestPrize?(level: number): Promise<{ prize: import('@core/rewardSurprise').ChestPrize; state: ShopState }>
    claimMystery?(): Promise<{ prize: import('@core/rewardSurprise').ChestPrize; state: ShopState }>
    markReady?(keys: string[]): Promise<void>
    /** Reward buys that went into Finance Helper as real spending (before the points-only fix). */
    rewardMoney?(): Promise<import('@core/funBudget').RewardMoneyRow[]>
    /** Takes them (all, or these ids) back out of Finance Helper, after the owner's tap. */
    removeRewardMoney?(ids?: string[]): Promise<{ removed: number; lei: number; left: import('@core/funBudget').RewardMoneyRow[] }>
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
    /** Take back a reset made in the last 10 minutes (a test or a wrong tap). */
    undoReset?(): Promise<DisciplineState>
    claim(days: number): Promise<{ coins: number; state: DisciplineState }>
    startUrge(): Promise<DisciplineState>
    finishUrge(): Promise<DisciplineState>
    cancelUrge(): Promise<DisciplineState>
    setStealth(on: boolean): Promise<DisciplineState>
    /** Save your reason ("your why"); empty clears it. */
    setWhy?(text: string): Promise<DisciplineState>
    /** What set off an urge / a reset (Ben learns your patterns from it). */
    note?(kind: 'urge' | 'reset', trigger: string, extra?: { before?: number; after?: number; action?: string }): Promise<void>
    /** After a reset: the 72-hour comeback plan (Ben's check-ins are set; tasks are returned for Todoist). */
    comeback?(): Promise<import('@core/comeback').ComebackStep[]>
    /** Your risky times and top triggers, in words. */
    patterns?(): Promise<{ windows: string[]; triggers: string[] }>
  }
  body: {
    state(): Promise<BodyState>
    logWorkout(input: WorkoutInput): Promise<{ workout: Workout; state: BodyState; awarded: boolean }>
    deleteWorkout(id: number): Promise<BodyState>
    /** Takes one set back out of a day's workout (an undo); the workout and its points go when nothing is left. */
    takeBackSet?(id: number, name: string, amount: number): Promise<BodyState>
    logMetric(input: BodyMetricInput): Promise<BodyState>
    saveExercise(exercise: Omit<Exercise, 'id' | 'sort'> & { id?: string; sort?: number }): Promise<BodyState>
    /** Mark a day (default today) as a rest day, or take it back. */
    setRest?(day: string | null, on: boolean): Promise<BodyState>
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
  focus: {
    state(): Promise<FocusState>
    start(subject: string, planned?: number, task?: FocusTask | null, stages?: import('@core/focusFlow').FocusStage[] | null): Promise<FocusState>
    /** IC1: pause the running timer (paused time doesn't count) and go on. */
    pause?(): Promise<FocusState>
    resume?(): Promise<FocusState>
    /** IC7: a new name for the running timer. */
    rename?(subject: string): Promise<FocusState>
    stop(): Promise<{ session: FocusSession; coins: number; state: FocusState; task?: FocusTask | null }>
    cancel(): Promise<FocusState>
    /** Adds minutes to the running timer (web app). */
    extend?(minutes: number): Promise<FocusState>
    add(subject: string, minutes: number, day?: string): Promise<{ session: FocusSession; coins: number; state: FocusState }>
    setPlan(items: import('@core/focus').PlanInput[]): Promise<DayPlan>
    togglePlan(index: number): Promise<{ plan: DayPlan; coins: number }>
    review(text: string | null, reasons: string[]): Promise<DayPlan>
    saveGoal(g: { id?: number; title: string; subject: string; deadline: string; hours: number }): Promise<FocusState>
    archiveGoal(id: number): Promise<FocusState>
    fun(minutes: number, what?: string): Promise<{ cost: number; balance: number }>
  }
  sleep: {
    state(): Promise<SleepSummary>
    logWake(time?: string, quality?: number): Promise<{ log: SleepLog; state: SleepSummary; awarded: boolean }>
    logBed(time?: string): Promise<{ log: SleepLog; state: SleepSummary; awarded: boolean }>
    /** The real wake-up time for today or one of the last 14 days (coins only for today). */
    setWake(day: string, time: string): Promise<{ log: SleepLog; state: SleepSummary; awarded: boolean }>
    setTargets(weekday: string, weekend: string, bedtime?: string): Promise<SleepSummary>
    logs?(): Promise<SleepLog[]>
    setQuality?(day: string, quality: number): Promise<SleepLog>
  }
  money: {
    state(): Promise<NativeMoneySummary>
    addExpense(amountBani: number, category: string, note?: string): Promise<{ expense: Expense; state: NativeMoneySummary; awarded: boolean }>
    deleteExpense(id: number): Promise<NativeMoneySummary>
    setBudget(budgetBani: number): Promise<NativeMoneySummary>
    setCurrency(cur: string): Promise<NativeMoneySummary>
    /** FX3/RL6: today, the last 14 judged days (newest first) and the saving streak. */
    days(): Promise<MoneyDaysState>
    /** "Nothing spent today": counts as a no-spend day once the day is over (if no spending shows up). */
    nothingSpent(): Promise<MoneyDaysState>
    /** "I cooked at home today": you confirm it, it pays once a day. */
    confirmCooked(): Promise<MoneyDaysState>
  }
  shields: {
    count(): Promise<number>
    buy(): Promise<{ shields: number; balance: number }>
    /** Spend a shield on a missed day: it counts as a rest day for the workout streak. */
    protect?(day: string): Promise<BodyState>
  }
  data: {
    exportJson(): Promise<string>
    exportCsv(kind: 'workouts' | 'expenses'): Promise<string>
    cloudSnapshots?(): Promise<{ day: string; exportedAt: string; sizeBytes: number }[]>
    saveDailySnapshot?(): Promise<boolean>
    restoreCloudSnapshot?(day: string): Promise<boolean>
    /** Puts back a backup (the JSON of a daily file, an export or a snapshot). */
    restoreSnapshot?(text: string): Promise<boolean>
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
    /** How syncing is doing on this device (Y9). */
    health?(): Promise<SyncHealth>
    /** Forget the "couldn't sync" list. */
    clearFailed?(): Promise<void>
  }
}

export interface SyncHealth {
  syncedAt: string | null
  /** Changes made offline, waiting to be sent. */
  waiting: number
  /** The desktop app's changes not yet sent. */
  desktopPending: number
  error: string | null
  /** Changes the database refused (another device changed the same thing). */
  failed: { at: string; error: string }[]
  backupError: string | null
}

/** IPC replies are wrapped so error messages reach the UI cleanly. */
export type IpcReply<T> = { ok: true; data: T } | { ok: false; error: string }
