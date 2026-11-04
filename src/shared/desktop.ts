import type { UpdateStatus } from './api'
import type { IslandAck, IslandAction, IslandSnapshot } from '../core/islandModel'
import type { BackupStatus, BackupWhere } from '../desktop/backups'

export type IslandMode = 'hidden' | 'pill' | 'open'
/** Where the island lives: top of the screen, docked on a side, or floating. */
export type IslandPlacement = 'top' | 'left' | 'right' | 'free'

export interface DesktopApi {
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
  backup(): Promise<string | null>
  updateStatus(): Promise<UpdateStatus>
  checkUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<UpdateStatus>
  loginGithub(): Promise<void>
  /** Colors of Windows' own minimize/maximize/close (they sit on the app's title bar). */
  titleBar?(color: string, symbol: string): void
  // ---- daily backup files (optional: older desktops don't have them) ----
  backupStatus?(): Promise<BackupStatus>
  writeBackup?(text: string, day: string): Promise<BackupStatus>
  readBackup?(where: BackupWhere, name: string): Promise<string>
  chooseBackupFolder?(): Promise<BackupStatus>
  openBackupFolder?(where: BackupWhere): Promise<void>
  // ---- the desktop island (optional: older desktops don't have it) ----
  /** App window → island: what to show. */
  islandState?(s: IslandSnapshot): void
  /** App window: taps from the island. */
  onIslandAction?(cb: (a: IslandAction) => void): void
  /** App window → island: a tap was done (or why not). */
  islandAck?(ack: IslandAck): void
  /** Island window: answers to its taps. */
  onIslandAck?(cb: (ack: IslandAck) => void): void
  /** Island window: give it the keyboard (typing to Ben). */
  islandFocus?(): void
  /** App window: open a page when the island asks. */
  onNavigate?(cb: (page: string) => void): void
  /** Island window: new snapshots. */
  onIslandState?(cb: (s: IslandSnapshot) => void): void
  /** Island window: send a tap. */
  islandAction?(a: IslandAction): void
  /** Island window: its size (and whether the mouse is over it, so clicks pass through elsewhere). */
  islandMode?(mode: IslandMode, height?: number): void
  /** Island window: where the visible pill/card is (window pixels); clicks pass through elsewhere. */
  islandHot?(rect: { x: number; y: number; width: number; height: number }): void
  /** Island window: start / stop dragging it (the desktop moves the window with the pointer). */
  islandDrag?(on: boolean): void
  /** Island window: where it lives now (changes when you drop it on an edge). */
  onIslandPlacement?(cb: (p: IslandPlacement) => void): void
  /** Island window: the screen edge was touched (or the shortcut pressed): come out. */
  onIslandReveal?(cb: () => void): void
  onIslandToggle?(cb: () => void): void
  /** Island window: listening now (send placement + latest snapshot). */
  islandReady?(): void
  /** Island window: the real mouse pointer entered / left the pill. */
  onIslandHover?(cb: (over: boolean) => void): void
  /** Island window: bring the app window up. */
  showApp?(page?: string): void
}

declare global {
  interface Window { desktop?: DesktopApi }
}
