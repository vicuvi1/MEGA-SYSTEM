import type { UpdateStatus } from './api'
import type { IslandAck, IslandAction, IslandPrefs, IslandSnapshot } from '../core/islandModel'
import type { BackupStatus, BackupWhere } from '../desktop/backups'

/** Where the island lives: top of the screen, docked on a side, or floating. */
export type IslandPlacement = 'top' | 'left' | 'right' | 'free'

export interface DesktopApi {
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
  backup(): Promise<string | null>
  updateStatus(): Promise<UpdateStatus>
  checkUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<UpdateStatus>
  /** Go back one version (installs the previous release and restarts). */
  rollback?(): Promise<{ ok: boolean; version?: string; error?: string }>
  /** A Windows notification (silent: the page plays its own chime). */
  notify?(n: { id: string; title: string; body?: string | null; actions?: { id: string; label: string }[]; urgent?: boolean }): Promise<boolean>
  // ---- Ben on this PC (P1–P20; optional: older desktops don't have it) ----
  pcGetPrefs?(): Promise<{ prefs: import('../core/pcActivity').PcPrefs; port: number; token: string; now: { label: string; kind: string } | null; windows: boolean; siteServer?: string | null } | null>
  pcSetPrefs?(p: Partial<import('../core/pcActivity').PcPrefs>): Promise<import('../core/pcActivity').PcPrefs | null>
  pcToday?(): Promise<{ line: string; apps: Record<string, { sec: number; kind: string }> } | null>
  pcClear?(): Promise<boolean>
  pcFocus?(f: { running: boolean; subject: string; endsAt: number }): void
  pcLock?(): Promise<boolean>
  pcDnd?(): Promise<boolean>
  pcExtensionFolder?(): Promise<string | null>
  /** The app in front (only with the sensor on): its friendly name and kind, every few seconds. */
  onPcApp?(cb: (a: { label: string; kind: 'work' | 'distract' | 'neutral'; seconds: number }) => void): void
  /** The PC locked / unlocked. */
  onLock?(cb: (l: { locked: boolean; at: number }) => void): void
  /** A taskbar shortcut (P17): "focus25". */
  onJump?(cb: (a: string) => void): void
  /** Island window: Ctrl+Alt+N (add a task) / Ctrl+Alt+B (talk to Ben). */
  onIslandCapture?(cb: () => void): void
  onIslandVoice?(cb: () => void): void
  /** A button on a Windows notification (N9). */
  onNotifAction?(cb: (a: { id: string; action: string }) => void): void
  /** You clicked one: the app is in front, run its action. */
  onNotifClick?(cb: (id: string) => void): void
  /** The update status, pushed whenever it changes. */
  onUpdateStatus?(cb: (s: UpdateStatus) => void): void
  loginGithub(): Promise<void>
  /** Colors of Windows' own minimize/maximize/close (they sit on the app's title bar). */
  titleBar?(color: string, symbol: string): void
  /** Crashes from the last run (sent once after loading), for the error log. */
  onCrashes?(cb: (list: { at: string; why: string }[]) => void): void
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
  /** App window: your island settings (Settings → Desktop island). */
  getIslandPrefs?(): Promise<IslandPrefs | null>
  setIslandPrefs?(p: Partial<IslandPrefs>): Promise<{ prefs: IslandPrefs; shortcutOk: boolean } | null>
  /** Island window: settings changed. */
  onIslandPrefs?(cb: (p: IslandPrefs) => void): void
  /** App window: open a page when the island asks. */
  onNavigate?(cb: (page: string) => void): void
  /** You came back after a long time away from the PC (asleep?): when you were last active, and when you came back. */
  onAway?(cb: (a: { from: string; to: string }) => void): void
  /** Every 15 s: seconds since the last mouse/keyboard input on the PC. */
  onIdle?(cb: (idleSec: number) => void): void
  /** Text you just copied (≤ 200 chars), for the island's "save this?". */
  onClip?(cb: (text: string) => void): void
  /** Island window: new snapshots. */
  onIslandState?(cb: (s: IslandSnapshot) => void): void
  /** Island window: send a tap. */
  islandAction?(a: IslandAction): void
  /** Island window: done typing (false): give the keyboard back to your app. */
  islandKeyboard?(on: boolean): void
  /** Island window: you clicked into another app. */
  onIslandBlur?(cb: () => void): void
  /** Island window: quiet for N minutes / until tomorrow, or back on (null). */
  islandQuiet?(choice: number | 'tomorrow' | null): void
  /** Island window: quiet until (ms, 0 = not quiet), and what Windows says (a call, a full-screen app). */
  onIslandQuiet?(cb: (q: { until: number; call: boolean; fullscreen: boolean }) => void): void
  /** Island window: where the visible pill/card is (window pixels); clicks pass through elsewhere. */
  islandHot?(rect: { x: number; y: number; width: number; height: number }): void
  /** Island window: start / stop dragging it (the desktop moves the window with the pointer). */
  islandDrag?(on: boolean): void
  /** Island window: where it lives now (changes when you drop it on an edge). */
  onIslandPlacement?(cb: (p: IslandPlacement) => void): void
  /** Island window: the shortcut was pressed. */
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
