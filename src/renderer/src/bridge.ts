import type { LifeApi, UpdateStatus } from '@shared/api'
import type { DayTemplate } from '@core/calTemplates'
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
  error?: string
}
import { createTursoWebBridge } from './tursoWebBridge'
import type { CoachMind } from '@core/coachMind'
import type { RhythmPrefs, RhythmState } from '@core/rhythm'
import type { WeekRow } from '@core/coachImpact'
import type { CoachStatus } from './web/coachStatus'
import type { ProfileView } from './web/coachProfile'
import type { SportyView } from '@core/sportyUpdate'

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
    chat(text: string, onStep?: (step: string) => void, media?: { mime: string; data: string }): Promise<{ ok: boolean; reply: string; done: string[]; steps?: string[]; mood?: string; at?: string; undo?: unknown[]; chips?: string[]; buttons?: { label: string; do: string }[]; show?: string[] }>
    undo?(at: string, index?: number): Promise<{ ok: boolean; lines: string[] }>
    memory(): Promise<{ facts: { t: string; at: string }[] }>
    setFacts(facts: { t: string; at: string }[]): Promise<void>
    mind?(): Promise<CoachMind>
    rhythm?(action?: 'state' | 'propose' | 'approve' | 'top3' | 'prefs' | 'book' | 'letter', note?: string, prefs?: Partial<RhythmPrefs>): Promise<{ state: RhythmState; prefs: RhythmPrefs; done?: string[]; ok?: boolean; lines?: string[]; letter?: string | null }>
    profileView?(): Promise<ProfileView>
    feedback?(at: string, kind: 'up' | 'down' | 'long' | 'wrong'): Promise<void>
    style?(): Promise<{ length: 'short' | 'normal' | 'detailed'; tone: number }>
    setStyle?(st: Partial<{ length: 'short' | 'normal' | 'detailed'; tone: number }>): Promise<{ length: 'short' | 'normal' | 'detailed'; tone: number }>
    status?(): Promise<CoachStatus>
    /** Sporty on your server: connected, version, updates waiting; update() presses its Update button. */
    sporty?(): Promise<SportyView>
    /** Adds water to the shared log (the one Ben and Sporty use). */
    water?(ml: number): Promise<{ ml: number; target: number }>
    updateSporty?(): Promise<SportyView>
    scorecard?(): Promise<{ rows: WeekRow[]; verdict: 'working' | 'mixed' | 'not yet' | 'too early'; lines: string[] }>
    setMind?(m: CoachMind): Promise<void>
    profile(): Promise<{ about: string; goals: string[]; rules: string[] }>
    saveProfile(p: { about: string; goals: string[]; rules: string[] }): Promise<{ about: string; goals: string[]; rules: string[] }>
    log(): Promise<{ role: 'me' | 'coach'; bot: string; via: string; text: string; done?: string[]; at: string; mood?: string; proactive?: boolean; undo?: unknown[]; undone?: boolean[]; chips?: string[]; buttons?: { label: string; do: string }[]; show?: string[] }[]>
    model(): Promise<string | null>
  }
  /** Google Calendar through the server (sign in once in Settings). */
  google?: {
    status(): Promise<GoogleStatus>
    connect(): Promise<void>
    events(fromIso: string, toIso: string): Promise<CalEvent[]>
    create(e: { title: string; start: string; end: string; description?: string; calendarId?: string; recurrence?: string[] }): Promise<CalEvent>
    update?(calendarId: string, id: string, patch: { title?: string; start?: string; end?: string; description?: string; colorId?: string | null; recurrence?: string[] | null; moveTo?: string; scope?: 'one' | 'all'; recurringEventId?: string | null }): Promise<void>
    move(calendarId: string, id: string, start: string, end: string): Promise<void>
    remove(calendarId: string, id: string): Promise<void>
    setCalendars(on: string[], target: string | null): Promise<void>
    disconnect(): Promise<void>
  }
  /** "Am I improving?": the last 7 days against your usual week (web). */
  progress?: { report(): Promise<ProgressReport>; insights?(): Promise<Insights>; growth?(): Promise<Growth>; seenMilestones?(): Promise<string[]>; markMilestones?(ids: string[], replace?: boolean): Promise<void> }
  /** Day templates for the calendar ("study day"), synced (web). */
  calTemplates?: { list(): Promise<DayTemplate[]>; save(t: DayTemplate): Promise<DayTemplate[]>; remove(name: string): Promise<DayTemplate[]> }
  /** Done / skipped marks on today's calendar blocks (web). */
  timeline?: { marks(day: string): Promise<Record<string, 'done' | 'skip'>>; mark(day: string, id: string, v: 'done' | 'skip' | null): Promise<Record<string, 'done' | 'skip'>> }
  /** The Sunday plan: one focus area and 3 big tasks for the week (web). */
  /** System health and the shared error log (Settings → System health). */
  system?: {
    health(): Promise<{ checks: import('@core/health').Check[]; errors: import('@core/health').ErrorEntry[] }>
    beat(key: string, ok: boolean, msg?: string): Promise<void>
    logError(source: string, msg: string): Promise<void>
  }
  weekPlan?: { saved(): Promise<WeekPlan | null>; save(p: Partial<WeekPlan>): Promise<WeekPlan>; toggle(i: number): Promise<WeekPlan> }
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
    update?(id: string, patch: { content?: string; priority?: number; due?: string; description?: string; labels?: string[]; duration?: number | null }): Promise<void>
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
