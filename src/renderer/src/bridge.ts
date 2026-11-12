import type { LifeApi, UpdateStatus } from '@shared/api'
import type { DayTemplate } from '@core/calTemplates'
import type { MemoryView } from '@core/benMemory'
import type { Area, TodoTask } from '@core/todoist'
import type { ProgressReport } from '@core/progress'
import type { Insights } from '@core/insights'
import type { Growth } from '@core/growth'
import type { CleanChange } from '@core/todoistClean'
import type { WeekPlan } from '@core/weekPlan'
import type { CalEvent } from '@core/dayTime'

export interface GoogleStatus {
  configured: boolean
  connected: boolean
  email?: string | null
  calendars?: { id: string; name: string; color: string; primary: boolean; canWrite: boolean }[]
  on?: string[]
  target?: string | null
  /** Read-only Gmail was allowed too (Connect Gmail). */
  gmail?: boolean
  /** Photo Locker's Google Drive was allowed too (Connect Google Drive). */
  drive?: boolean
  error?: string
}
import { createTursoWebBridge } from './tursoWebBridge'
import type { CoachMind } from '@core/coachMind'
import type { RhythmPrefs, RhythmState } from '@core/rhythm'
import type { WeekRow } from '@core/coachImpact'
import type { CoachStatus } from './web/coachStatus'
import type { ProfileView } from './web/coachProfile'
import type { DeskOp, DeskView } from './web/benDesk'
import type { SportyView } from '@core/sportyUpdate'
import type { CoachLooks } from '@core/coachLooks'

export type Bridge = LifeApi & {
  onLocked(cb: () => void): void
  onUrge(cb: () => void): void
  onWalletChanged(cb: () => void): void
  onDisciplineChanged?(cb: () => void): () => void
  onNavigate(cb: (page: string) => void): void
  onUpdate(cb: (s: UpdateStatus) => void): void
  onUiKey(cb: (key: string) => void): () => void
  onFullScreen(cb: (on: boolean) => void): () => void
  /** The Coach page: chat (same brain as the bots), memory, goals & rules, the log. */
  coach?: {
    /** Rules only (no AI): the island's command bar. */
    quick?(text: string): Promise<{ ok: boolean; reply: string } | { unknown: true }>
    chat(text: string, onStep?: (step: string) => void, media?: { mime: string; data: string }, onDelta?: (replySoFar: string) => void, opts?: { overBudget?: boolean }): Promise<{ ok: boolean; reply: string; done: string[]; steps?: string[]; mood?: string; at?: string; undo?: unknown[]; chips?: string[]; buttons?: { label: string; do: string }[]; show?: string[]; cards?: import('@core/coachButtons').ReplyCards; meta?: import('@core/answerCost').AnswerMeta; basic?: 'budget'; noVision?: boolean }>
    undo?(at: string, index?: number): Promise<{ ok: boolean; lines: string[] }>
    memory(): Promise<{ facts: { t: string; at: string }[] }>
    setFacts(facts: { t: string; at: string }[]): Promise<void>
    mind?(): Promise<CoachMind>
    rhythm?(action?: 'state' | 'propose' | 'shift' | 'approve' | 'top3' | 'prefs' | 'book' | 'letter' | 'month', note?: string, prefs?: Partial<RhythmPrefs>): Promise<{ state: RhythmState; prefs: RhythmPrefs; late?: number; done?: string[]; ok?: boolean; lines?: string[]; letter?: string | null }>
    /** PE1: save today's edited plan (returns the new state, or null when today has no plan). */
    planSave?(plan: import('@core/rhythm').DayProposal): Promise<RhythmState | null>
    /** Planner time limits and the week plan (synced): read, or save a change (returns both). */
    /** The end-of-day check's records (synced setting plan_review): read, or save / take back one block's mark. */
    planReview?(patch?: { day: string; item?: import('@core/planReview').ReviewItem; drop?: string }): Promise<import('@core/planReview').ReviewStore>
    planSetup?(patch?: { limits?: Partial<import('@core/planLimits').PlanLimits>; week?: import('@core/planWeek').WeekShape }): Promise<{ limits: import('@core/planLimits').PlanLimits; week: import('@core/planWeek').WeekShape }>
    profileView?(): Promise<ProfileView>
    /** Ben's desk: patterns, energy map, excuses, mood, study, stacks, stakes, month story, money (read here, instant). */
    desk?(): Promise<DeskView>
    /** A change on the desk (mood, stake, study topic, habit stack, coach call). Returns a line for the toast. */
    deskDo?(op: DeskOp): Promise<string>
    feedback?(at: string, kind: 'up' | 'down' | 'long' | 'wrong', extra?: { reason?: import('@core/feedbackLearn').FeedbackReason; note?: string }): Promise<void>
    /** QA2: what Ben got wrong this week (your 👎s and their reasons). */
    feedbackWeek?(): Promise<ReturnType<typeof import('@core/feedbackLearn').weeklyMisses>>
    /** CH4: pinned messages (synced). */
    pins?(): Promise<import('@core/chatPins').ChatPin[]>
    pin?(m: { at: string; role: 'me' | 'coach'; text: string }): Promise<import('@core/chatPins').ChatPin[]>
    /** QA4: which model answered each reply and roughly what it cost. */
    answerMeta?(): Promise<Record<string, import('@core/answerCost').AnswerMeta>>
    /** QA4: this month's AI spend and budget (null when it can't be read). */
    budget?(): Promise<{ tier: 'normal' | 'save' | 'minimal'; spent: number; budget: number } | null>
    /** CH3: past conversations from a store, when one is there (the chat log is searched on the page). */
    searchHistory?(query: string, limit: number): Promise<import('@core/chatSearch').ChatHit[]>
    style?(): Promise<{ length: 'short' | 'normal' | 'detailed'; tone: number; lang?: 'en' | 'ro' | 'ru' | 'auto' }>
    setStyle?(st: Partial<{ length: 'short' | 'normal' | 'detailed'; tone: number; lang: 'en' | 'ro' | 'ru' | 'auto' }>): Promise<{ length: 'short' | 'normal' | 'detailed'; tone: number; lang?: 'en' | 'ro' | 'ru' | 'auto' }>
    status?(): Promise<CoachStatus>
    /** My life (Settings → Ben): bedtime, wake time, latest bedtime, the work window, how hard Ben pushes (synced). */
    lifeFit?(): Promise<import('./web/lifeFitStore').LifeFitView>
    setLifeFit?(patch: Partial<import('./web/lifeFitStore').LifeFitView>): Promise<import('./web/lifeFitStore').LifeFitView>
    /** "Short shift tonight" / "no work tonight" / back to normal, for today. */
    setTonight?(mode: import('@core/lifeFit').ShiftMode): Promise<{ view: import('./web/lifeFitStore').LifeFitView; line: string }>
    /** Ben 2's pushes (core/benPushes.ts): today's shared log, claim one shown here, your answer, at the PC or not, a drift word for Telegram, tonight's shutdown list and Tomorrow / Drop / Keep today. */
    pushes?: {
      log(): Promise<import('@core/benPushes').PushLog>
      claim(key: string): Promise<boolean>
      answer(key: string, op: import('@core/benPushes').PushOp, minutes?: number): Promise<void>
      seen(p: import('@core/benPushes').PcSeen): Promise<void>
      queue(item: import('@core/benPushes').OutItem): Promise<void>
      shutdown(items: import('@core/benPushes').ShutdownItem[]): Promise<void>
      mark(id: string, mark: import('@core/benPushes').ItemMark): Promise<string>
      note(id: string, mark: import('@core/benPushes').ItemMark): Promise<void>
      /** Auto-rescue (core/planRescue): the rescue for a late block now, if one is due (its offer is kept for Accept). */
      rescueCheck?(o: { now: number; events: import('@core/dayTime').CalEvent[]; running: boolean; meeting: boolean; quiet: boolean; on: boolean }): Promise<import('@core/benPushes').PushOut | null>
      /** Accept / Not now / Skip today on a rescue, or Undo an accepted one. Resolves with the line to show. */
      rescue?(op: 'accept' | 'later' | 'skip' | 'undo', key: string): Promise<string>
      /** Food (core/foodBen.ts): a meal reminder, the evening protein nudge or the dinner reminder for the island now, if one is due. */
      foodCheck?(o: { now: number; meeting: boolean; quiet: boolean }): Promise<import('@core/benPushes').PushOut | null>
      /** A food push's button: "Same as yesterday" (saves yesterday's dinner), "Mute food nudges for 7 days", or a meal reminder's "Log it" (`arg` 'alt': its swap). Resolves with the line to show. */
      food?(op: 'yesterday' | 'mute' | 'log', key: string, arg?: string): Promise<string>
    }
    /** How the chat looks: Ben's face and your photo (synced). */
    looks?(): Promise<CoachLooks>
    setLooks?(patch: Partial<CoachLooks>): Promise<CoachLooks>
    /** Sporty on your server: connected, version, updates waiting; update() presses its Update button. */
    sporty?(): Promise<SportyView>
    /** Adds water to the shared log (the one Ben and Sporty use). */
    water?(ml: number, opts?: { source?: string; id?: string }): Promise<{ ml: number; target: number }>
    /** The one water + reps log: changes from this device's Sport Track copy or the embedded app (rows), today's entries, remove / bring back one. Returns the shared copy after it. */
    bodyLog?: {
      log(changes: { kind: string; amount: number; id?: string }[], source: string): Promise<any>
      entries(kind?: string, day?: string): Promise<import('@core/bodyLog').LogEntry[]>
      toggle(id: string): Promise<{ removed: boolean; day: string } | null>
      repair(): Promise<{ day: string; what: string; from: number; to: number }[]>
      /** Sport Track's checklist (id, name) from the shared copy. */
      exercises?(): Promise<{ id: string; name: string }[]>
    }
    /** BD1–BD18: protein, saved meals, supplements, tape measurements, today's training dose, the weekly body report. */
    bodyPlus?: import('./web/bodyPlusBridge').BodyPlusApi
    /** Body composition: weigh-ins (weight, fat %, muscle, waist), weekly averages, the target band, Undo. */
    bodyComp?: import('./web/bodyCompBridge').BodyCompApi
    /** Food counter: meals from your AI app's reply, day totals, goals, what to eat next, favourites. */
    food?: import('./web/foodBridge').FoodApi
    /** The coach: today's plan, ticks, the day's line and the weekly review (coach/coachApi.ts). */
    today?: import('./coach/coachApi').CoachApi
    /** HD: your reminders (the list Ben's ⏰ uses), and add / Done / Snooze from the island. */
    reminders?(): Promise<import('@core/healthyDay').ReminderItem[]>
    remind?(op: { op: 'add'; text: string; at: number } | { op: 'done'; id: string } | { op: 'snooze'; id: string; minutes: number }): Promise<string>
    updateSporty?(): Promise<SportyView>
    scorecard?(): Promise<{ rows: WeekRow[]; verdict: 'working' | 'mixed' | 'not yet' | 'too early'; lines: string[] }>
    setMind?(m: CoachMind): Promise<void>
    /** ME1: "What Ben knows about me": facts, preferences, habits, goals, people, the questions he asks before remembering, and past-chat points (ME4). */
    know?: {
      view(): Promise<import('./web/benMind').KnowView>
      edit(id: string, text: string): Promise<import('./web/benMind').KnowView>
      remove(id: string): Promise<import('./web/benMind').KnowView>
      add(text: string): Promise<import('./web/benMind').KnowView>
      forget(about: string): Promise<{ removed: number; view: import('./web/benMind').KnowView }>
      answer(offerId: string, yes: boolean): Promise<import('./web/benMind').KnowView>
      /** The store the chat search reads: key points of past chats that fit the words. */
      past(q: string): Promise<import('@core/benConvo').ConvoPoint[]>
    }
    /** BR4: Ben's notes about you (memory blocks), recent memory changes, pins and undo. */
    brain?: {
      view(): Promise<MemoryView>
      editBlock(name: string, patch: { text?: string; pinned?: boolean }): Promise<MemoryView>
      pinFact(text: string, on: boolean): Promise<MemoryView>
      undo(id: string): Promise<{ ok: boolean; view: MemoryView }>
    }
    profile(): Promise<{ about: string; goals: string[]; rules: string[] }>
    saveProfile(p: { about: string; goals: string[]; rules: string[] }): Promise<{ about: string; goals: string[]; rules: string[] }>
    log(): Promise<{ role: 'me' | 'coach'; bot: string; via: string; text: string; done?: string[]; receipt?: string; at: string; mood?: string; proactive?: boolean; undo?: unknown[]; undone?: boolean[]; chips?: string[]; buttons?: { label: string; do: string }[]; show?: string[]; cards?: import('@core/coachButtons').ReplyCards }[]>
    model(): Promise<string | null>
  }
  /** Settings → Look → Wallpaper: the choice and your own picture (synced settings). */
  look?: {
    wallpaper(): Promise<import('@core/wallpaper').WallpaperPrefs>
    setWallpaper(patch: Partial<import('@core/wallpaper').WallpaperPrefs>): Promise<import('@core/wallpaper').WallpaperPrefs>
    photo(): Promise<string | null>
    setPhoto(dataUrl: string | null): Promise<void>
  }
  /** Custom Center (src/core/custom): your set-up and today's custom numbers, two synced settings. */
  custom?: {
    get(): Promise<{ setup: import('@core/custom').CustomSetup; state: import('@core/custom').CustomState; newer: boolean }>
    save(setup: import('@core/custom').CustomSetup): Promise<import('@core/custom').CustomSetup>
    saveState(state: import('@core/custom').CustomState): Promise<import('@core/custom').CustomState>
  }
  /** Google Calendar through the server (sign in once in Settings). */
  google?: {
    status(): Promise<GoogleStatus>
    connect(): Promise<void>
    events(fromIso: string, toIso: string): Promise<CalEvent[]>
    create(e: { title: string; start: string; end: string; description?: string; location?: string; calendarId?: string; recurrence?: string[]; reminder?: number | null; colorId?: string; id?: string }): Promise<CalEvent>
    update?(calendarId: string, id: string, patch: { title?: string; start?: string; end?: string; description?: string; location?: string; colorId?: string | null; recurrence?: string[] | null; moveTo?: string; scope?: 'one' | 'all'; recurringEventId?: string | null; reminder?: number | null }): Promise<void>
    move(calendarId: string, id: string, start: string, end: string): Promise<void>
    remove(calendarId: string, id: string): Promise<void>
    setCalendars(on: string[], target: string | null): Promise<void>
    disconnect(): Promise<void>
    /** Photo Locker: sign in again adding Google Drive (only the app's own files); the calendar stays. */
    connectDrive?(): Promise<void>
    /** Photo Locker: a short-lived Drive-only key for this device (straight to Google, never through the server). */
    driveToken?(): Promise<{ token: string; expiresAt: number }>
    /** Photo Locker: Telegram food photos the server holds for this app (file ids only, 3 days at most; bots/foodLocker.ts). */
    foodInbox?(): Promise<{ id: string; at: number; meal?: string; name?: string; type?: string }[]>
    /** One held photo's bytes (base64), fetched through the server (the bot token stays there). */
    foodInboxGet?(id: string): Promise<{ mime: string; data: string }>
    /** Erases held photos once they are in Drive. */
    foodInboxDone?(ids: string[]): Promise<void>
  }
  /** Photo Locker's synced index (metadata only, core/vaultSync.ts). */
  vault?: {
    index(): Promise<import('@core/vaultSync').VaultIndex>
    /** Joins with the saved index (another device may have saved in between) and saves. */
    saveIndex(next: import('@core/vaultSync').VaultIndex): Promise<import('@core/vaultSync').VaultIndex>
  }
  /** Money receipts' synced index `money_receipts` (metadata only, core/receiptIndex.ts). */
  moneyReceipts?: {
    index(): Promise<import('@core/receiptIndex').ReceiptIndex>
    /** Joins with the saved index and saves (read → merge → write). */
    saveIndex(next: import('@core/receiptIndex').ReceiptIndex): Promise<import('@core/receiptIndex').ReceiptIndex>
  }
  /** "Am I improving?": the last 7 days against your usual week (web). */
  progress?: { report(): Promise<ProgressReport>; insights?(): Promise<Insights>; growth?(): Promise<Growth>; seenMilestones?(): Promise<string[]>; markMilestones?(ids: string[], replace?: boolean): Promise<void> }
  /** Day templates for the calendar ("study day"), synced (web). */
  calTemplates?: { list(): Promise<DayTemplate[]>; save(t: DayTemplate): Promise<DayTemplate[]>; remove(name: string): Promise<DayTemplate[]> }
  /** Done / skipped marks on today's calendar blocks (web). */
  timeline?: { marks(day: string): Promise<Record<string, 'done' | 'skip'>>; mark(day: string, id: string, v: 'done' | 'skip' | null): Promise<Record<string, 'done' | 'skip'>>; kinds?(): Promise<import('@core/blockKind').BlockKinds>; setKind?(title: string, kind: import('@core/blockKind').BlockKind): Promise<import('@core/blockKind').BlockKinds> }
  /** The Sunday plan: one focus area and 3 big tasks for the week (web). */
  /** System health and the shared error log (Settings → System health). */
  system?: {
    health(): Promise<{ checks: import('@core/health').Check[]; errors: import('@core/health').ErrorEntry[] }>
    beat(key: string, ok: boolean, msg?: string): Promise<void>
    logError(source: string, msg: string): Promise<void>
    /** Several errors (with stack, build and screen) in one write. */
    logErrors?(list: import('./web/systemHealth').ErrorReport[]): Promise<void>
    /** Ben's log: messages sent, held back (and why) or failed. */
    benLog?(): Promise<(import('./web/systemHealth').BenLogEntry & { at: string })[]>
  }
  /** Settings → Plugins (src/plugins). */
  plugins?: {
    state(): Promise<{ on: Record<string, boolean>; status: Record<string, { at: string; ok: boolean; note?: string; need?: string[] }>; config: Record<string, Record<string, unknown>> }>
    setOn(id: string, on: boolean): Promise<void>
    setConfig(id: string, cfg: Record<string, unknown>): Promise<void>
    /** A plugin_* setting (what a job fetched). */
    data<T = any>(key: string): Promise<T | null>
    saveData(key: string, value: unknown): Promise<void>
    refresh(only?: string): Promise<{ ran: string[] }>
    importBank(text: string): Promise<string>
    healthKeys(op: { op: 'list' } | { op: 'new'; label: string } | { op: 'drop'; id: string }): Promise<{ keys?: { id: string; label: string; created: number; lastUsed: number | null }[]; key?: string; id?: string; label?: string }>
    connectGmail(): Promise<void>
    /**
     * Settings → Phone payments: payment keys (list / new / drop), "Send test"
     * (with `key`: through the real URL and that key, as MacroDroid would;
     * without: signed in), and the last 5 notifications received (`recent`).
     */
    phonePay?(
      op: { op: 'list' } | { op: 'new'; label: string } | { op: 'drop'; id: string } | { op: 'test'; key?: string } | { op: 'recent' }
    ): Promise<{ keys?: { id: string; label: string; created: number; lastUsed: number | null }[]; key?: string; id?: string; label?: string; status?: string; what?: string; recent?: import('@core/moneyToSort').ToSortItem[] }>
  }
  /** Your own habits, goals list, life modes, learning path, month and year reviews, reward locks (web). */
  extras?: import('./web/lifeExtras').ExtrasApi
  /** The Season page: seasons and the boss, vision board, identity votes, side quests, wins, life wheel, Ben's arc. */
  saga?: import('./web/sagaApi').SagaApi
  /** Career: job board, portfolio, flashcards, essays, shift study kit, money plan, monthly letters (web). */
  career?: import('./web/career').CareerApi
  /** The Money hub (Finance Helper's numbers) and one-line quick add. */
  finance?: import('./web/moneyApi').MoneyApi
  weekPlan?: { saved(): Promise<WeekPlan | null>; save(p: Partial<WeekPlan>): Promise<WeekPlan>; toggle(i: number): Promise<WeekPlan> }
  /** The Sync button: pulls Todoist and Google Calendar now, then every list reads again. Resolves with the time. */
  syncNow?: () => Promise<number>
  /** Your Todoist (web, when TODOIST_TOKEN is set on the server). */
  todoist?: {
    status(): Promise<{ connected: boolean }>
    today(): Promise<TodoTask[]>
    upcoming?(): Promise<TodoTask[]>
    quickAdd(text: string, area?: string): Promise<TodoTask & { area?: string | null }>
    complete(task: TodoTask): Promise<{ paid: number }>
    sync(force?: boolean): Promise<number>
    /** The Tasks page: every open task and your areas. */
    everything?(): Promise<{ tasks: TodoTask[]; areas: Area[] }>
    /** Suggested fixes for your Todoist (AI, else duplicates and long-overdue tasks), to approve. */
    cleanup?(today: string): Promise<{ changes: CleanChange[]; ai: boolean; error?: string }>
    /** Sends only what changed; resolves once Todoist confirms. A failed save waits (and is retried) and this throws. */
    update?(id: string, patch: { content?: string; priority?: number; due?: string; description?: string; labels?: string[]; duration?: number | null }): Promise<void>
    /** Edits on their way to Todoist, per task id: saving / failed (with why) / saved (a few seconds). */
    pending?(): Promise<Record<string, import('@core/todoSync').EditStatus>>
    /** Send a failed edit again now. */
    retry?(id: string): Promise<void>
    /** Where these tasks are now (open on some day, done, or gone): the change check's answer, else asked from Todoist. */
    lookup?(ids: string[]): Promise<Map<string, import('@core/todoist').TodoLookup>>
    /** The Sync line: when Todoist last answered, the last problem, outside changes since the last Sync. */
    syncInfo?(): { okAt: number; failAt: number; error: string | null; changes: number; lastSyncChanges: number }
    /** Your own order of today's tasks (ids), synced. */
    order?(): Promise<string[]>
    setOrder?(ids: string[]): Promise<void>
    move?(id: string, area: string): Promise<void>
    reopen?(id: string): Promise<void>
    remove?(id: string): Promise<void>
    addArea?(name: string): Promise<Area>
    renameArea?(area: string, name: string): Promise<void>
    /** Area colors you picked (area key → color), synced to every device. */
    colors?(): Promise<Record<string, string>>
    setColor?(area: string, color: string): Promise<Record<string, string>>
  }
}

declare global {
  interface Window {
    life?: Bridge
  }
}

// desktop = running inside Electron (preload exposes window.life).
// Always false when opened as a normal web page.
export const isDesktop = !!window.life
export const isDemo = false

/** What works where. */
export const features = {
  ai: true,
  aiSettings: !!window.life,
  calendar: !!window.life,
  cloudflareSync: !!window.life,
  logFolder: !!window.life,
  updates: !!window.life || !!window.desktop
}

// Always use Turso Cloud as the data source — same DB on web and desktop.
// Electron IPC (window.life) is kept only for desktop extras: updates, tray, fullscreen events.
const turso = createTursoWebBridge()
const desktop = window.life
function noOp() {}
function noOpOff() { return noOp }

export const life: Bridge = {
  ...turso,
  // Desktop-only services: use IPC when in Electron, graceful no-ops on web.
  // The cloud desktop (window.desktop) has the real updater; the old desktop its own.
  updates: desktop?.updates ?? (window.desktop?.updateStatus ? {
    status: () => window.desktop!.updateStatus(),
    check: () => window.desktop!.checkUpdates(),
    run: () => window.desktop!.installUpdate(),
  } : {
    status: async () => ({ current: '—', state: 'dev' as const, latest: null, progress: 0, error: null, checkedAt: null }),
    check:  async () => ({ current: '—', state: 'dev' as const, latest: null, progress: 0, error: null, checkedAt: null }),
    run:    async () => ({ current: '—', state: 'dev' as const, latest: null, progress: 0, error: null, checkedAt: null }),
  }),
  app:  desktop?.app  ?? turso.app,
  apps: desktop?.apps ?? turso.apps,
  hud:  desktop?.hud  ?? { hide: async () => {}, toggle: async () => {}, show: async () => {} },
  // IPC event subscriptions — desktop only, silent no-ops on web.
  onLocked:            (cb) => desktop ? desktop.onLocked(cb)                            : noOp(),
  onUrge:              (cb) => desktop ? desktop.onUrge(cb)                              : noOp(),
  onWalletChanged:     (cb) => desktop ? desktop.onWalletChanged(cb)                     : noOp(),
  onDisciplineChanged: (cb) => desktop ? (desktop.onDisciplineChanged?.(cb) ?? noOpOff()) : noOpOff(),
  onNavigate:          (cb) => desktop ? desktop.onNavigate(cb)                          : noOp(),
  onUpdate:            (cb) => desktop ? desktop.onUpdate(cb)                            : window.desktop?.onUpdateStatus ? window.desktop.onUpdateStatus(cb) : noOp(),
  onUiKey:             (cb) => desktop ? (desktop.onUiKey?.(cb) ?? noOpOff())            : noOpOff(),
  onFullScreen:        (cb) => desktop ? (desktop.onFullScreen?.(cb) ?? noOpOff())       : noOpOff(),
}
