import type { LifeApi, UpdateStatus } from '@shared/api'
import type { TodoTask } from '@core/todoist'
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
  /** Your Todoist (web, when TODOIST_TOKEN is set on the server). */
  todoist?: {
    status(): Promise<{ connected: boolean }>
    today(): Promise<TodoTask[]>
    quickAdd(text: string): Promise<TodoTask>
    complete(task: TodoTask): Promise<{ paid: number }>
    sync(force?: boolean): Promise<number>
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
  ai: !!window.life,
  calendar: !!window.life,
  cloudflareSync: !!window.life,
  logFolder: !!window.life,
  updates: !!window.life
}
export const life: Bridge = window.life ?? createTursoWebBridge()
