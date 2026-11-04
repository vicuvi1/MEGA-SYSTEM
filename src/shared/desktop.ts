import type { UpdateStatus } from './api'

export interface DesktopApi {
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
  backup(): Promise<string | null>
  updateStatus(): Promise<UpdateStatus>
  checkUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<UpdateStatus>
  loginGithub(): Promise<void>
}

declare global {
  interface Window { desktop?: DesktopApi }
}
