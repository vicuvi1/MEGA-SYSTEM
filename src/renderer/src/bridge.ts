import type { LifeApi, UpdateStatus } from '@shared/api'
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
}

declare global {
  interface Window {
    life?: Bridge
  }
}

/** Real IPC bridge inside Electron; live Turso Cloud client when opened in web/mobile browser. */
export const isDemo = !window.life
export const life: Bridge = window.life ?? createTursoWebBridge()
