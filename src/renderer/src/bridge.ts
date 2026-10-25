import type { LifeApi, UpdateStatus } from '@shared/api'
import { createMockApi } from './mock'

export type Bridge = LifeApi & { onLocked(cb: () => void): void; onUrge(cb: () => void): void; onWalletChanged(cb: () => void): void; onNavigate(cb: (page: string) => void): void; onUpdate(cb: (s: UpdateStatus) => void): void; onUiKey(cb: (key: string) => void): () => void; onFullScreen(cb: (on: boolean) => void): () => void }

declare global {
  interface Window {
    life?: Bridge
  }
}

/** Real IPC bridge inside Electron; an in-memory demo when opened in a browser. */
export const isDemo = !window.life
export const life: Bridge = window.life ?? createMockApi()
