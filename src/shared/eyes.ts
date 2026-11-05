// Island eyes: what the desktop app and its pages say to each other.
import type { EyeKind, EyesLogEntry, EyesPrefs, PauseChoice } from '../core/eyesGuard'
import type { EyesSeen } from '../core/eyesSense'

export interface EyesModelStatus {
  /** none: not downloaded; downloading; ready; error (with why). */
  state: 'none' | 'downloading' | 'ready' | 'error'
  /** Bytes downloaded / to download (known once the download starts). */
  got: number
  total: number
  /** Bytes on disk now. */
  onDisk: number
  error?: string
}

export interface EyesState {
  windows: boolean
  prefs: EyesPrefs
  /** Paused now (ms until), 0 if not. */
  pausedUntil: number
  /** Which eye is reading right now (the island shows it). */
  reading: EyeKind | null
  /** The last thing kept (short), for the island. */
  last: EyesSeen | null
  model: EyesModelStatus
}

export interface EyesInfo extends EyesState {
  log: EyesLogEntry[]
  /** About how big the caption model is (bytes), before you download it. */
  modelSize: number
}

/** A caption job for the app window's worker: the window picture, small, RGB, in memory only. */
export interface EyesCaptionJob {
  id: string
  w: number
  h: number
  rgb: Uint8Array
}

export interface EyesApi {
  get(): Promise<EyesInfo | null>
  set(patch: Partial<EyesPrefs>): Promise<EyesInfo | null>
  pause(choice: PauseChoice): Promise<EyesState | null>
  /** EY2: read the window in front's screen text now (the island's "Read screen"). */
  readScreen(): Promise<{ ok: boolean; said: string }>
  /** EY3: a caption of the window in front now. */
  captionNow(): Promise<{ ok: boolean; said: string }>
  clearLog(): Promise<boolean>
  modelDownload(): Promise<EyesModelStatus | null>
  modelCancel(): Promise<EyesModelStatus | null>
  modelDelete(): Promise<EyesModelStatus | null>
  onState(cb: (s: EyesState) => void): void
  onSeen(cb: (s: EyesSeen) => void): void
  /** The app window only: run a caption job in the worker, then answer with captionDone. */
  onCaptionJob(cb: (job: EyesCaptionJob) => void): void
  captionDone(id: string, r: { ok: boolean; text?: string; error?: string }): void
  /** The app window only: the caption worker was idle and stopped (or the model was deleted). */
  onCaptionUnload(cb: () => void): void
}
