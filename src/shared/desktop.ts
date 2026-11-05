import type { UpdateStatus } from './api'
import type { IslandAck, IslandAction, IslandPrefs, IslandSnapshot } from '../core/islandModel'
import type { BackupStatus, BackupWhere } from '../desktop/backups'
import type { IslandDeskPrefs, Placement } from '../desktop/islandWin'
export type { IslandDeskPrefs } from '../desktop/islandWin'

/** "Nothing new": the app window's heartbeat while the snapshot stays the same (IC9). */
export interface IslandBeat { beat: number }
/** What the desktop sees, for Island debug (IC13). Positions are in the window's screen pixels (DIP). */
export interface IslandDebugSample {
  at: number
  cursor: { x: number; y: number }
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  zoom: number
  rects: { x: number; y: number; w: number; h: number }[]
  ignoring: boolean
  ctl: 'page' | 'poll'
  inWin: boolean | null
  focused: boolean
  pollJitter: number
  lag: number
  flips: number
  until: number
}
/** Where the island lives: top center / left / right, docked on a side, or floating (IF1). */
export type IslandPlacement = Placement
/** The app's colours, for the island's "Match the app" look (IP4). */
export interface IslandTheme { dark: boolean; accent: string; accentText: string; surface: string; text: string }
/** Your island settings as the app window sees them: plus where it is and which screen. */
export type IslandAllPrefs = IslandPrefs & Partial<IslandDeskPrefs> & { place?: IslandPlacement; displayId?: number }

export interface DesktopApi {
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
  backup(): Promise<string | null>
  updateStatus(): Promise<UpdateStatus>
  checkUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<UpdateStatus>
  /** CL5: the website said this app is too old for the database: install the update now (with a notice). */
  schemaOld?(): Promise<UpdateStatus>
  /** Go back one version (installs the previous release and restarts). */
  rollback?(): Promise<{ ok: boolean; version?: string; error?: string }>
  /** A Windows notification (silent: the page plays its own chime). */
  notify?(n: { id: string; title: string; body?: string | null; actions?: { id: string; label: string }[]; urgent?: boolean }): Promise<boolean>
  // ---- Ben on this PC (P1–P20; optional: older desktops don't have it) ----
  pcGetPrefs?(): Promise<{ prefs: import('../core/pcActivity').PcPrefs; port: number; token: string; now: { label: string; kind: string } | null; windows: boolean; siteServer?: string | null } | null>
  pcSetPrefs?(p: Partial<import('../core/pcActivity').PcPrefs>): Promise<import('../core/pcActivity').PcPrefs | null>
  pcToday?(): Promise<{ line: string; apps: Record<string, { sec: number; kind: string }> } | null>
  pcClear?(): Promise<boolean>
  pcFocus?(f: { running: boolean; subject: string; endsAt: number; startedAt?: number }): void
  /** MC10: a focus session's minutes on work vs distracting apps (this one, or the one that just ended). */
  pcFocusApps?(startedAt?: number): Promise<{ startedAt: number; subject: string; workMin: number; distractMin: number; otherMin: number; pct: number | null } | null>
  /** MC10: drifting in distracting apps for 2+ minutes during focus (once per session). */
  onPcDrift?(cb: (d: { startedAt: number; label: string; subject: string; minutes: number }) => void): void
  /** MC11: minutes on listed sites from the browser history (only with that switch on). */
  pcBrowserMinutes?(): Promise<{ today: Record<string, number>; yesterday: Record<string, number>; line: string; todayLine: string } | null>
  pcLock?(): Promise<boolean>
  pcDnd?(): Promise<boolean>
  pcExtensionFolder?(): Promise<string | null>
  /** The app in front (only with the sensor on): its friendly name and kind, every few seconds. */
  onPcApp?(cb: (a: { label: string; kind: 'work' | 'distract' | 'neutral'; seconds: number }) => void): void
  /** Smart island: one channel of small, title-free events (only with Smart island on), sent only on change. */
  onActivity?(cb: (e: import('../core/activityStream').ActivityEvent) => void): void
  /** Smart island: what you're doing now, today's kinds of doing, and the last week's (this PC only). */
  pcDoing?(): Promise<{ now: { label: string; context: import('../core/activityContext').ContextKind; conf: number; detail?: string } | null; ctx: Record<string, number>; line: string; hours: Record<string, Record<string, number>>; week: { day: string; ctx: Record<string, number>; hours: Record<string, Record<string, number>> }[] } | null>
  /** Smart island: the block on now (its title) and whether a meeting is on. */
  pcSmartState?(s: { block: string | null; meeting: boolean }): void
  /** The PC locked / unlocked. */
  onLock?(cb: (l: { locked: boolean; at: number }) => void): void
  /** A taskbar shortcut (P17): "focus25". */
  onJump?(cb: (a: string) => void): void
  /** Island window: the add-a-task shortcut (Alt+Shift+N) / talk-to-Ben (Alt+Shift+B). */
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
  // ---- your Obsidian vault, read-only (optional: older desktops don't have it) ----
  vaultChoose?(): Promise<import('../plugins/notes/vault').VaultData | null>
  vaultScan?(): Promise<import('../plugins/notes/vault').VaultData | null>
  vaultForget?(): Promise<void>
  // ---- the desktop island (optional: older desktops don't have it) ----
  /** App window → island: what to show. */
  islandState?(s: IslandSnapshot | IslandBeat): void
  /** App window: taps from the island. */
  onIslandAction?(cb: (a: IslandAction) => void): void
  /** App window → island: a tap was done (or why not). */
  islandAck?(ack: IslandAck): void
  /** Island window: answers to its taps. */
  onIslandAck?(cb: (ack: IslandAck) => void): void
  /** Island window: give it the keyboard (typing to Ben). */
  islandFocus?(): void
  /** App window: your island settings (Settings → Desktop island). */
  getIslandPrefs?(): Promise<IslandAllPrefs | null>
  setIslandPrefs?(p: Partial<IslandPrefs & IslandDeskPrefs> & { place?: IslandPlacement; displayId?: number }): Promise<{ prefs: IslandAllPrefs; shortcutOk: boolean } | null>
  /** App window: the screens to pick from (IF2). */
  islandDisplays?(): Promise<{ id: number; label: string; primary: boolean; current: boolean }[]>
  /** App window: programs seen in front lately, to pick the ones it hides over (IF6). */
  islandRecentApps?(): Promise<string[]>
  /** App window: its colours, for the island's "Match the app" look (IP4). */
  islandTheme?(t: IslandTheme): void
  /** App window: shortcuts another app already uses (Settings shows "taken by another app"). */
  islandShortcutStatus?(): Promise<{ failed: { what: string; accelerator: string }[] } | null>
  /** App window: a shortcut could not be registered (another app has it). `what`: island, quiet, capture or voice. */
  onIslandShortcutFailed?(cb: (f: { accelerator: string; what: string }) => void): void
  /** The island log kept by the desktop (its own lines and the island page's). */
  islandGetLog?(): Promise<{ at: string; from: 'main' | 'island'; line: string }[]>
  /** Island window: settings changed. */
  onIslandPrefs?(cb: (p: IslandPrefs & Partial<IslandDeskPrefs> & { scale?: number; theme?: IslandTheme | null }) => void): void
  /** App window: open a page when the island asks. */
  onNavigate?(cb: (page: string) => void): void
  /** You came back after a long time away from the PC (asleep?): when you were last active, and when you came back. */
  onAway?(cb: (a: { from: string; to: string }) => void): void
  /** Every 15 s: seconds since the last mouse/keyboard input on the PC. */
  onIdle?(cb: (idleSec: number) => void): void
  /** Every 15 s from the desktop while the island is on: send it a fresh snapshot (the app window may be slowed down in the tray). */
  onIslandTick?(cb: () => void): void
  /** Text you just copied (≤ 200 chars), for the island's "save this?". */
  onClip?(cb: (text: string) => void): void
  /** Island window: new snapshots. */
  onIslandState?(cb: (s: IslandSnapshot | IslandBeat) => void): void
  /** Island window: send a tap. */
  islandAction?(a: IslandAction): void
  /** Island window: done typing (false): give the keyboard back to your app. */
  islandKeyboard?(on: boolean): void
  /** Island window: you clicked into another app. */
  onIslandBlur?(cb: () => void): void
  /** Island window: quiet for N minutes / until tomorrow, or back on (null). */
  islandQuiet?(choice: number | 'tomorrow' | null): void
  /** Island window: quiet until (ms, 0 = not quiet), and what Windows says (a call, a full-screen app). */
  onIslandQuiet?(cb: (q: { until: number; call: boolean; fullscreen: boolean; mic?: boolean; meeting?: boolean; fullscreenMode?: IslandDeskPrefs['fullscreen'] }) => void): void
  /** Island window: where the visible shape is, in CSS pixels of the page (one or more areas); clicks pass through elsewhere. The old single rect still works. */
  islandHot?(rect: { rects: { x: number; y: number; w: number; h: number }[] } | { x: number; y: number; width: number; height: number }): void
  /** Island window: the pointer is on the island (take clicks) or not (let them pass through) (IC1). */
  islandTakeClicks?(on: boolean): void
  /** Island window: shown or hidden (it pauses its animations while hidden). */
  onIslandVisible?(cb: (visible: boolean) => void): void
  /** Island window: what the desktop sees, ~10 times a second while Island debug is on (IC13). */
  onIslandDebug?(cb: (d: IslandDebugSample) => void): void
  /** Island window: put text on the clipboard (Island debug's "Copy report"). */
  islandCopy?(text: string): void
  /** Island window: a calendar meeting is going on now (hides the island when "in a call: hide"). */
  islandCall?(inCall: boolean): void
  /** Island window: a line for the island log. */
  islandLog?(line: string): void
  /** Island window: a line from the desktop side for the island log (hover, click-through, zoom, why it hid). */
  onIslandDiag?(cb: (d: { at: string; from: 'main'; line: string }) => void): void
  /** Island window: the desktop ended a drag that got stuck (no movement for 10 s). */
  onIslandDragCancel?(cb: () => void): void
  /** Island window: start / stop dragging it (the desktop moves the window with the pointer). */
  islandDrag?(on: boolean): void
  /** Island window: where it lives now (changes when you drop it on an edge). */
  onIslandPlacement?(cb: (p: IslandPlacement) => void): void
  /** Island window: the shortcut was pressed. */
  onIslandToggle?(cb: () => void): void
  /** Island window (IM11, IM12): the pointer's offset from the island's middle while it is within 40 px (CSS px), or null once it went away. */
  onIslandCursor?(cb: (near: { dx: number; dy: number; dist: number } | null) => void): void
  /** Island window (IM7): while dragging, the spot it would snap to (null when the drag ends). */
  onIslandSnapGhost?(cb: (spot: IslandPlacement | null) => void): void
  /** Island window (IM7): the window jumped to its spot; play the last `dx`/`dy` CSS px as a bounce. */
  onIslandSnapped?(cb: (b: { dx: number; dy: number }) => void): void
  /** Island window: listening now (send placement + latest snapshot). */
  islandReady?(): void
  /** Island window: the real mouse pointer entered / left the pill. */
  onIslandHover?(cb: (over: boolean) => void): void
  /** IC19: Island window: you are typing in another app (true), or stopped / came near (false). */
  onIslandTyping?(cb: (typing: boolean) => void): void
  /** Island window: bring the app window up. */
  showApp?(page?: string): void
}

declare global {
  interface Window { desktop?: DesktopApi }
}
