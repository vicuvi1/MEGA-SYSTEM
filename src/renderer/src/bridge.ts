import type { LifeApi } from '@shared/api'
import { createMockApi } from './mock'

export type Bridge = LifeApi & { onLocked(cb: () => void): void }

declare global {
  interface Window {
    life?: Bridge
  }
}

/** Real IPC bridge inside Electron; an in-memory demo when opened in a browser. */
export const isDemo = !window.life
export const life: Bridge = window.life ?? createMockApi()
