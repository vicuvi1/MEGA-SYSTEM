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
    chat(text: string, onStep?: (step: string) => void): Promise<{ ok: boolean; reply: string; done: string[]; steps?: string[] }>
    memory(): Promise<{ facts: { t: string; at: string }[] }>
    setFacts(facts: { t: string; at: string }[]): Promise<void>
    profile(): Promise<{ about: string; goals: string[]; rules: string[] }>
    saveProfile(p: { about: string; goals: string[]; rules: string[] }): Promise<{ about: string; goals: string[]; rules: string[] }>
    log(): Promise<{ role: 'me' | 'coach'; bot: string; via: string; text: string; done?: string[]; at: string }[]>
    model(): Promise<string | null>
  }
  /** Google Calendar through the server (sign in once in Settings). */
  google?: {
    status(): Promise<GoogleStatus>
    connect(): Promise<void>
    events(fromIso: string, toIso: string): Promise<CalEvent[]>
    create(e: { title: string; start: string; end: string; description?: string; calendarId?: string; recurrence?: string[] }): Promise<CalEvent>
    update?(calendarId: string, id: string, patch: { title?: string; start?: string; end?: string; description?: string }): Promise<void>
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
    update?(id: string, patch: { content?: string; priority?: number; due?: string; description?: string; labels?: string[] }): Promise<void>
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

/** Real IPC bridge inside Electron; live Turso Cloud client when opened in web/mobile browser. */
export const isDemo = !window.life

/** What works where: the website has no AI key, Google Calendar, Cloudflare sync, log folder or installer updates. */
export const features = {
  ai: true,
  /** AI keys are typed in only on the desktop; the website's key is in Vercel. */
  aiSettings: !!window.life,
  calendar: !!window.life,
  cloudflareSync: !!window.life,
  logFolder: !!window.life,
  updates: !!window.life
}
export const life: Bridge = window.life ?? createTursoWebBridge()
