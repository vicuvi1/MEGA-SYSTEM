// What the bots' split-out parts (LT6: callbacks.ts, undo.ts) get from
// createWebBots, passed in explicitly instead of read from one big closure.
import type { BotBridgeConfig } from '@shared/api'
import type { Mirror } from '../mirror'
import type { WebServices } from '../webServices'
import type { CalendarLike, TodoistLike } from '../webBots'
import type { createRhythm } from '../rhythmBot'

export interface BotContext {
  mirror: Mirror
  services: WebServices
  todoist: TodoistLike | null
  calendar: CalendarLike | null
  /** Tells the app a new expense was logged (it refreshes Money). */
  onExpense?: () => void
  /** Records a Telegram update as handled; false when it already was (a tap delivered twice). */
  markSeen: (key: string) => Promise<boolean>
  rhythm: ReturnType<typeof createRhythm>
  /** Sends today's plan with Approve / Change / Redo. */
  sendProposal: (token: string, chat: string, note?: string) => Promise<string>
  /** One message to Ben's brain, answered on Telegram. */
  handleBrain: (botId: string, update: any, cfg: BotBridgeConfig, text: string, key: string, media?: { kind: 'voice' | 'photo'; mime: string; data: string }) => Promise<string | null>
  /** Takes back what Ben did in one reply (all, or one line). */
  undoReply: (at: string, index?: number) => Promise<{ ok: boolean; lines: string[] }>
  /** Focus sessions stopped from Telegram go into Google Calendar after the reply. */
  flushFocus: () => Promise<void>
  focusEnded: { subject: string; minutes: number }[]
  /**
   * TV1: an edit from a button, through Ben's own executor (undo, coach log). `lines` are
   * action lines run as they are; with `asText`, that text goes through Ben's chat path instead.
   */
  act: (said: string, lines: string[], reply: string, asText?: string) => Promise<{ done: string[]; at?: string; undo?: unknown[] }>
  /** A money message logged on this database (inside mirror.write). */
  runMoneyIn: (db: any, text: string, key: string) => { reply: string; keyboard?: any } | null
  /** A meal photo's vision read (the server only; foodBot.ts "Done, read them"). */
  foodPhoto?: import('./foodBot').FoodPhotoFn | null
  /** Server-only short rows for photos of one meal (Telegram file ids, foodAlbum.ts). */
  photoKv?: import('./foodAlbum').PhotoKv | null
}

/** One button tap. */
export interface Tap {
  /** The callback data, "xx|args". */
  data: string
  chat: string
  /** The update's key in bot_seen_updates. */
  key: string
  botId: string
  cfg: BotBridgeConfig
  /** The raw update (with `__token`, the bot it came to). */
  update: any
  cq: any
  /** Answers the tap (the small toast in Telegram). */
  answer: (text: string) => Promise<unknown>
  /** Edits the message the button was under. */
  edit: (text: string, keyboard?: any) => Promise<unknown>
}
