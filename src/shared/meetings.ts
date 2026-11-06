// Meetings on the island (MT1–MT3, AI17): what the desktop and the island page say to each other.
import type { CaptionLine } from '../core/meetings'
import type { ReplyApp } from '../core/replyHelper'

export interface MeetState {
  /** Running on Windows. */
  windows: boolean
  /** Windows Live Captions is on this PC (Windows 11). */
  live: boolean
  /** In a call now (microphone / camera, or a calendar meeting). */
  inCall: boolean
  /** Captioning now: the watcher runs. */
  captioning: boolean
  /** Waiting for Live Captions to open / show text. */
  starting: boolean
  /** The newest 1–2 lines for the strip. */
  lines: string[]
  /** Words kept in memory now. */
  words: number
  startedAt: number
  /** A plain line (Live Captions closed, not on this PC…). */
  note: string
  /** The chat or mail app in front, for "Help me reply". */
  replyApp: ReplyApp | null
}

export interface MeetTranscript {
  title: string | null
  app: string | null
  startedAt: number
  lines: CaptionLine[]
}

export type MeetRead = { ok: true; app: ReplyApp; message: string; from: 'selection' | 'window' } | { ok: false; said: string }

export interface MeetApi {
  /** The state now; `title` is the calendar meeting's title (for the private check). */
  status(title?: string | null): Promise<(MeetState & { private: boolean }) | null>
  start(title?: string | null): Promise<{ ok: boolean; said: string }>
  /** Stop and wipe (unless saved first). */
  stop(): Promise<boolean>
  /** The captions for Save (still in memory; they are wiped by stop()). */
  transcript(): Promise<MeetTranscript | null>
  /** AI17: read the last message of the chat in front (selection, else the window text). */
  readReply(): Promise<MeetRead>
  onState(cb: (s: MeetState) => void): void
}
