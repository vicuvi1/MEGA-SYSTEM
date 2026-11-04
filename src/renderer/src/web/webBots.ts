// Telegram bots on the web: polls getUpdates and runs each command through
// the same services as the desktop, on the Turso copy. Every message is
// recorded in bot_seen_updates in the same Turso transaction as what it
// logged, so the phone and the PC never log one message twice, and a message
// is never marked done without its record (or the other way round).
import { withTimeout } from '@core/ai'
import type { BotBridgeConfig, BotLogEntry, FocusTask } from '@shared/api'
import {
  formatBalanceResponse,
  formatCleanCheckinResponse,
  formatExpenseResponse,
  formatHelpMessage,
  formatMetricResponse,
  formatSportResponse,
  formatSportStatusResponse,
  formatTodayStatus,
  formatUrgeResponse,
  formatWorkoutResponse,
  parseTelegramText
} from '@core/botCommands'
import { addDays } from '@core/dates'
import { formatMoney } from '@core/money'
import { getSetting, setSetting } from '../../../main/settings'
import { queueFinanceExpense } from './financeInbox'
import { deleteMoney, editMoney, logMoney, moneyButton, recentMoney } from './financeBot'
import { payTodoist } from './todoistCoins'
import { pLabel, sortToday, todayText, type TodoTask } from '@core/todoist'
import { REASONS, hm, parsePlan, type DayPlan } from '@core/focus'
import { agendaText, freeGaps, suggestBlocks, type CalEvent } from '@core/dayTime'
import { PLAN_ASK, eveningText, goalsText, planKeyboard, planText, weekText } from '@core/focusBot'
import { MirrorError, type Mirror } from './mirror'
import { shownMood } from '@core/benActs'
import { NUDGES, REMINDERS, addReminder, answered as answeredReminders, MOOD_FACE, coachMood, isBigAsk, isCorrection, isMood, makeRefs, type Mood, promiseLine, promiseRefs, promiseStats, setOutcome, type NudgeState, type Reminder } from '@core/coachKit'
import { findExercise, updateSport } from '../sportTrack'
import type { Services, WebServices } from './webServices'
import { notesForBen, readNoteOp } from '@core/notebook'
import { askedFor, confirmButton, riskOf } from '@core/benSafety'
import { deskChange, deskPrompt, deskView, loadDesk, noteExcuse, readDeskOp, refreshProfile } from './benDesk'
import { purchaseCheck, readPurchase } from '@core/benMoney'
import { moodFace } from '@core/benKnows'
import { benNote, listNotes, seedNotes } from './notes'
import { answerLocal, type LookupData, appendLog, loadProfile, type Persona, RATINGS, focusRatings, brainPrompt, financeStateFrom, isSimpleLog, lifeContext, loadMemory, moneyInsight, parseBrain, personaFor, readAction, saveMemory, loadMind, saveMind, sportState, loadLog, saveLog, type UndoOp, loadStyle, saveStyle, styleText, loadFeedback, addFeedback, feedbackText, loadSelfReview, type Feedback, updateMemory, type BrainAction, type BrainOut } from './botBrain'
import { applyMind, mindText, readMindOp, weekSoFar, type MindOp } from '@core/coachMind'
import { EDIT_ASK, PROPOSAL_KEYBOARD, TOP3_ASK, WEEK_ASK, proposalText } from '@core/rhythm'
import { sparkline, telegramKeyboard } from '@core/coachButtons'
import { coachStatus } from './coachStatus'
import { createRhythm } from './rhythmBot'
import { addReps, addWater, parseWater, sharedView, sportForDay, sportToday } from '@core/sportShared'
import { activeExercises, allDone, applyWorkoutTap, defaultSport, progression, recordWorkoutDay, removeExercise, setExercise, waterCard, workoutCard, type WorkoutLog } from '@core/sportCards'

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
const LOGS_KEY = 'life_bot_logs'
const store = typeof localStorage !== 'undefined' ? localStorage : null

/** Telegram's Bot API, small and with a timeout so a hung call can't stall the app. */
async function tg(token: string, method: string, body?: unknown): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
    return json
  } finally {
    clearTimeout(t)
  }
}

/**
 * A voice note or photo from Telegram, as base64 for Gemini (up to 15 MB;
 * Telegram voice notes are OGG/Opus, photos JPEG).
 */
async function downloadFile(token: string, fileId: string, kind: 'voice' | 'photo'): Promise<{ kind: 'voice' | 'photo'; mime: string; data: string } | null> {
  try {
    const info = await tg(token, `getFile?file_id=${encodeURIComponent(fileId)}`)
    const path = info?.result?.file_path
    if (!info?.ok || !path || (info.result.file_size ?? 0) > 15_000_000) return null
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    const ext = String(path).split('.').pop()?.toLowerCase()
    const mime = kind === 'photo' ? (ext === 'png' ? 'image/png' : 'image/jpeg') : ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : 'audio/ogg'
    return { kind, mime, data: btoa(bin) }
  } catch {
    return null
  }
}

/** Sport Track's checklist on this device: a rep sent from Telegram counts today. */
function addRepsToSportTrack(name: string, amount: number): { done: number; target: number } | null {
  let prog: { done: number; target: number } | null = null
  updateSport((st) => {
    const ex = findExercise(st, name)
    if (!ex) return
    ex.doneToday = (Number(ex.doneToday) || 0) + amount
    prog = { done: ex.doneToday, target: Number(ex.target) || 0 }
  })
  return prog
}

/**
 * Sport Track's data in Turso (settings.sport_tracker_json, see sportSync.ts),
 * for the server: reps land there and every device picks them up.
 */
function addRepsInDb(db: any, name: string, amount: number): { done: number; target: number } | null {
  const saved = (() => {
    try {
      return JSON.parse(getSetting(db, 'sport_tracker_json') || 'null')
    } catch {
      return null
    }
  })()
  const st = saved?.data
  if (!st || !Array.isArray(st.exercises)) return null
  const today = new Date().toISOString().slice(0, 10) // Sport Track's day is the UTC date
  if (st.lastDate !== today) {
    st.lastDate = today
    st.exercises.forEach((e: any) => (e.doneToday = 0))
    if (st.water) st.water.currentMl = 0
  }
  const ex = findExercise(st, name)
  if (!ex) return null
  ex.doneToday = (Number(ex.doneToday) || 0) + amount
  setSetting(db, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: st }))
  return { done: ex.doneToday, target: Number(ex.target) || 0 }
}

/** Which Life System expense a Finance Helper record from Telegram made (for Undo). */
function linkExpense(db: any, txId: string, expenseId: number): void {
  let links: Record<string, number> = {}
  try {
    links = JSON.parse(getSetting(db, 'tg_expense_links') || '{}')
  } catch {
    /* start over */
  }
  links[txId] = expenseId
  const keys = Object.keys(links)
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete links[k]
  setSetting(db, 'tg_expense_links', JSON.stringify(links))
}

function takeLink(db: any, txId: string): number | null {
  try {
    const links = JSON.parse(getSetting(db, 'tg_expense_links') || '{}')
    const id = links[txId]
    if (id == null) return null
    delete links[txId]
    setSetting(db, 'tg_expense_links', JSON.stringify(links))
    return Number(id)
  } catch {
    return null
  }
}

/**
 * Finance Helper's accounts, for /balance (own currency each): this device's
 * copy, else the backup Finance Helper keeps in Turso (the server has no device).
 */
function financeAccounts(db?: any): { name: string; balanceMdl: number; currency: string }[] {
  try {
    const raw = store?.getItem('finance-helper.state') || (db ? getSetting(db, 'finance_backup_json') : null)
    const st = JSON.parse(raw || 'null')
    const accounts: any[] = st?.settings?.accounts ?? []
    const tx: any[] = Array.isArray(st?.tx) ? st.tx : []
    return accounts
      .filter((a) => !a.archived)
      .map((a) => {
        let bal = Number(a.start) || 0
        for (const t of tx) {
          if (t.type === 'income' && t.account === a.id) bal += Number(t.amount) || 0
          else if (t.type === 'expense' && t.account === a.id) bal -= Number(t.amount) || 0
          else if (t.type === 'transfer') {
            if (t.from === a.id) bal -= Number(t.amount) || 0
            if (t.to === a.id) bal += Number(t.toAmount ?? t.amount) || 0
          }
        }
        return { name: String(a.name), balanceMdl: Math.round(bal) / 100, currency: a.currency || st?.settings?.currency || 'MDL' }
      })
  } catch {
    return []
  }
}

export interface WebBotsDeps {
  mirror: Mirror
  services: WebServices
  defaults: BotBridgeConfig
  /** An expense was saved (Finance Helper picks it up from the inbox). */
  onExpense?: () => void
  /** Running on the server: Sport reps go to Turso, not this browser. */
  server?: boolean
  /** Your Todoist, when connected: /todo, /task and /done use it. */
  todoist?: TodoistLike | null
  /** Gemini, when set up: free text, voice and photos go to the coach's brain (botBrain.ts). */
  ai?: AskModel | null
  calendar?: CalendarLike | null
}

/** Your Google Calendar (server, when signed in): the coach reads and adds events. */
export interface CalendarLike {
  events(fromIso: string, toIso: string): Promise<CalEvent[]>
  create(e: { title: string; start: string; end: string; description?: string }): Promise<CalEvent>
  move?(calendarId: string, id: string, start: string, end: string): Promise<void>
  remove?(calendarId: string, id: string): Promise<void>
}

export type AskModel = (prompt: string, opts?: { json?: boolean; think?: boolean; strong?: boolean; media?: { mime: string; data: string }[] }) => Promise<string>

/** What the bot needs from Todoist (the server calls it directly, the page through /api/todoist). */
export interface TodoistLike {
  today(): Promise<TodoTask[]>
  upcoming?(days?: number): Promise<TodoTask[]>
  close(id: string): Promise<void>
  quickAdd(text: string): Promise<TodoTask>
  update?(id: string, patch: { content?: string; priority?: number; due?: string; description?: string; labels?: string[] }): Promise<void>
  move?(id: string, areaKey: string): Promise<void>
  remove?(id: string): Promise<void>
  everything?(): Promise<{ tasks: TodoTask[]; areas: { key: string; name: string }[] }>
}

/** 1–5 under the wake-up message: how you slept. */
const sleepKeyboard = (day: string) => ({ inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: ['😫', '😕', '😐', '🙂', '😄'][n - 1] + ' ' + n, callback_data: `sq|${day}|${n}` }))] })

/** The sleep coach's word after a rating. */
function sleepTip(n: number, bed: string): string {
  if (n <= 2) return `Rough night. Today: no caffeine after 15:00, and tonight lights out at <b>${bed}</b>. I'll remind you.`
  if (n === 3) return `Okay night. Same bedtime tonight (${bed}) keeps it improving.`
  return 'Great. Keep the same rhythm tonight.'
}

/** Under "Focus started": one tap stops and logs it. */
const STOP_KEYBOARD = { inline_keyboard: [[{ text: '⏹ Stop & log', callback_data: 'fx|' }]] }

/** "▶ 50 min: …" buttons that start a focus session (subject kept short for Telegram's 64 bytes). */
export function focusKeyboard(subjects: string[]): any {
  const rows = subjects
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => {
      const short = t.split(/\s+/).slice(0, 4).join(' ').slice(0, 28)
      return [{ text: `▶ 50 min: ${short}`, callback_data: `fo|${short}` }]
    })
  return rows.length ? { inline_keyboard: rows } : undefined
}

/** After a session: what was logged, and for a must-do or Todoist task, a "Done" button. */
function stoppedReply(r: { session: { minutes: number; subject: string }; coins: number; state: { todayMin: number }; task?: FocusTask | null }, plan: DayPlan): { reply: string; keyboard?: any } {
  const head = `✅ <b>${r.session.minutes} min of ${esc(r.session.subject)}</b> logged.${r.coins ? `\n🪙 +${r.coins} coins` : ''}\nToday: ${hm(r.state.todayMin)}`
  // How did it go? (1–5): a low one asks what got in the way.
  const rate = [1, 2, 3, 4, 5].map((n) => ({ text: ['😣', '😕', '😐', '🙂', '🔥'][n - 1], callback_data: `fq|${plan.day}|${n}|${r.session.minutes}` }))
  const t = r.task
  if (t?.kind === 'mustdo') {
    const i = plan.items.findIndex((p) => !p.done && p.text === t.ref)
    if (i >= 0) return { reply: `${head}\n\nFinished “${esc(t.title)}”? And how did it go?`, keyboard: { inline_keyboard: [[{ text: '✅ Yes, tick it', callback_data: `pp|${plan.day}|${i}` }], rate] } }
  }
  if (t?.kind === 'todoist') return { reply: `${head}\n\nFinished “${esc(t.title)}”? And how did it go?`, keyboard: { inline_keyboard: [[{ text: '✅ Yes, done in Todoist', callback_data: `td|${t.ref}`.slice(0, 64) }], rate] } }
  return { reply: `${head}\n\nHow did it go?`, keyboard: { inline_keyboard: [rate] } }
}



/** A rule's points right now (labels never promise a stale amount). */
const ruleCoins = (svc: any, id: string, fallback: number): number => {
  try {
    return svc.wallet.rule(id).coins
  } catch {
    return fallback
  }
}

/** Bot settings without any token (what may be synced, saved or shown). */
export function stripTokens<T extends Record<string, any>>(cfg: T): T {
  const out: any = {}
  for (const [k, v] of Object.entries(cfg ?? {})) if (!/Token$/.test(k)) out[k] = v
  return out
}
const hasTokens = (cfg: Record<string, any>) => Object.entries(cfg ?? {}).some(([k, v]) => /Token$/.test(k) && !!v && v !== 'on-server')

export function createWebBots({ mirror, services, defaults, onExpense, server = false, todoist = null, ai = null, calendar = null }: WebBotsDeps) {
  let polling = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastPollAt: string | null = null
  let lastError: string | null = null
  let processed = 0
  let running: Promise<{ processedCount: number; replies: string[] }> | null = null
  let pruned = false

  // Saved settings win, but an empty token or chat never hides the server's one.
  // Tokens are never read from (or written to) the synced settings: they live
  // only in the server's environment (and the desktop's safeStorage).
  const merge = (saved: Partial<BotBridgeConfig>): BotBridgeConfig => {
    const out: any = { ...defaults }
    for (const [k, v] of Object.entries(stripTokens(saved ?? {}))) if (v !== '' && v != null) out[k] = v
    return out
  }
  let cleaned = false
  const config = (): Promise<BotBridgeConfig> =>
    mirror
      .read((db) => getSetting(db as any, 'bot_bridge_config'))
      .then((raw) => {
        const saved = raw ? JSON.parse(raw) : {}
        // Old copies kept tokens in the synced settings (and so in every backup): remove them once.
        if (!cleaned && hasTokens(saved)) {
          cleaned = true
          void mirror.write((db) => setSetting(db as any, 'bot_bridge_config', JSON.stringify(stripTokens(saved)))).catch(() => null)
          try {
            const local = store?.getItem('bot_bridge_config')
            if (local) store?.setItem('bot_bridge_config', JSON.stringify(stripTokens(JSON.parse(local))))
          } catch {
            /* fine */
          }
        }
        return merge(saved)
      })
      .catch(() => {
        try {
          const local = store?.getItem('bot_bridge_config')
          return merge(local ? JSON.parse(local) : {})
        } catch {
          return defaults
        }
      })

  const addLog = (command: string, sender: string, success: boolean, reply: string) => {
    if (!store) return
    try {
      const list: BotLogEntry[] = JSON.parse(store.getItem(LOGS_KEY) || '[]')
      list.push({ id: Date.now() + Math.random(), ts: new Date().toISOString(), command, sender, success, reply })
      store.setItem(LOGS_KEY, JSON.stringify(list.slice(-100)))
    } catch {
      /* logs are a convenience */
    }
  }

  const allowed = (cfg: BotBridgeConfig, chat: string) =>
    [cfg.chatId, cfg.sportBotChatId, cfg.financeBotChatId, cfg.manBotChatId, cfg.wakyBotChatId, cfg.plannerBotChatId, cfg.coachBotChatId]
      .filter(Boolean)
      .some((id) => String(id) === chat)

  /** Focus sessions stopped from Telegram: they go into Google Calendar after the reply. */
  const focusEnded: { subject: string; minutes: number }[] = []
  const flushFocus = async () => {
    const list = focusEnded.splice(0)
    if (!calendar) return
    for (const f of list) {
      if (f.minutes < 5) continue
      const end = new Date()
      await calendar.create({ title: `Focus: ${f.subject}`, start: new Date(end.getTime() - f.minutes * 60000).toISOString(), end: end.toISOString(), description: `${f.minutes} min of focus, logged by Life System` }).catch(() => null)
    }
  }
  const rhythm = createRhythm({ mirror, services, todoist: todoist ?? null, calendar: calendar ?? null, ai: ai ?? null })
  /** Sends today's plan with Approve / Change / Redo. */
  async function sendProposal(token: string, chat: string, note = ''): Promise<string> {
    const { plan, version } = await rhythm.propose(note)
    const text = proposalText(plan, { version })
    await tg(token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', reply_markup: PROPOSAL_KEYBOARD })
    return text
  }
  const dayBounds = () => {
    const s = new Date()
    s.setHours(0, 0, 0, 0)
    return [s.toISOString(), new Date(s.getTime() + 86400000).toISOString()] as const
  }

  /**
   * Right after you log your wake-up on Telegram: today's plan question (once
   * a day, if there's no plan yet), with what's in your calendar.
   */
  async function morningAfterWake(token: string, chat: string): Promise<void> {
    // The daily rhythm: the coach's plan for the day (Approve / Change / Redo).
    const r = await rhythm.state().catch(() => null)
    if (r?.prefs.on) {
      if (!r.state.briefing && new Date().getHours() < 12) await sendProposal(token, chat).catch(() => null)
      return
    }
    const go = await mirror.write((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today()
      if (getSetting(db as any, 'morning_sent_day') === today || svc.focus.plan(today).items.length) return false
      setSetting(db as any, 'morning_sent_day', today)
      return true
    })
    if (!go) return
    const events = calendar ? await calendar.events(...dayBounds()).catch(() => []) : []
    const today = await services.read((s) => s.wallet.today())
    const agenda = events.length ? `\n🗓 Today: ${esc(agendaText(events, today))}\n` : ''
    await tg(token, 'sendMessage', { chat_id: chat, text: `☀️ <b>Good morning!</b>${agenda}\n<b>${PLAN_ASK}</b>\nReply to this message, one per line.`, parse_mode: 'HTML', reply_markup: { force_reply: true, input_field_placeholder: 'Essay intro; gym; call Leo' } }).catch(() => null)
  }

  /** After you send the plan: time blocks for it in your free time, to approve with one tap. */
  async function offerBlocks(token: string, chat: string): Promise<void> {
    if (!calendar) return
    const events = await calendar.events(...dayBounds()).catch(() => null)
    if (!events) return
    const now = new Date()
    const after = `${String(now.getHours()).padStart(2, '0')}:${String(Math.ceil(now.getMinutes() / 15) * 15 % 60).padStart(2, '0')}`
    const blocks = await mirror.write((db) => {
      const svc = services.services(db)
      const today = svc.wallet.today()
      const items = svc.focus.plan(today).items.filter((x) => !x.done).map((x) => ({ title: x.text, minutes: 50 }))
      const b = suggestBlocks(freeGaps(events, today, { after, minMinutes: 30 }), items)
      if (b.length) setSetting(db as any, 'plan_suggestion', JSON.stringify({ day: today, blocks: b }))
      return b
    })
    if (!blocks.length) return
    await tg(token, 'sendMessage', {
      chat_id: chat,
      text: `🗓 <b>I can fit them into your free time:</b>\n${blocks.map((b) => `${b.start}–${b.end} · ${esc(b.title)}`).join('\n')}`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '✅ Put them in my calendar', callback_data: 'gp|' }, { text: 'No thanks', callback_data: 'gx|' }]] }
    }).catch(() => null)
  }

  /** One command, on the services. Returns the reply and what changed. */
  let currentDb: any = null

  type RunOut = { reply: string; keyboard?: any; sport?: { name: string; amount: number }; expense?: { amount: number; category: string; note: string; type?: 'expense' | 'income' }; unknown?: boolean }

  /**
   * A money message, the smart way (financeBot.ts): Finance Helper's parser,
   * categories and accounts, straight into its synced data, with buttons.
   * Also in Life System's spending log (expenses), linked for "Undo".
   */
  function runMoney(s: Services, text: string, key: string): RunOut | null {
    if (!currentDb) return null
    const money = logMoney(currentDb, text, key, s.wallet.today())
    if (!money) return null
    const t = money.tx
    if (t.type !== 'expense') return { reply: money.reply, keyboard: money.keyboard }
    const res = s.money.addExpense(t.amount, t.category, t.note ? `[Telegram] ${t.note}` : '[Telegram]', new Date(), true)
    linkExpense(currentDb, t.id, res.expense.id)
    // The money coach's context: how often this week, the month against the limit.
    const insight = moneyInsight(financeStateFrom(currentDb, server ? null : store), t, s.wallet.today())
    return { reply: money.reply + (insight ? `\n${esc(insight)}` : '') + (res.awarded ? `\n🪙 <b>+${ruleCoins(s, 'money.logged', 3)} points</b> (first spending logged today)` : ''), keyboard: money.keyboard }
  }

  /** /focus, /stop, /plan, /fun, /week, /deadlines (focus.ts). */
  function runFocus(s: Services, text: string): RunOut | null {
    const m = /^\/(focus|stop|plan|fun|week|deadlines|review)(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(text.trim())
    if (!m) return null
    const cmd = m[1].toLowerCase()
    const arg = (m[2] ?? '').trim()
    const f = s.focus
    if (cmd === 'focus') {
      const st = f.state()
      if (!arg) {
        if (st.running) {
          const min = Math.round((Date.now() - Date.parse(st.running.startedAt)) / 60000)
          return { reply: `⏱ <b>Focusing on ${esc(st.running.subject)}</b>: ${min} of ${st.running.planned} min.\nSend <code>/stop</code> when you're done.` }
        }
        return { reply: `⏱ Today: <b>${hm(st.todayMin)}</b> of focus.\nStart one: <code>/focus 50 math</code>` }
      }
      const minutes = Number(/\b(\d{1,3})\b/.exec(arg)?.[1] ?? 50)
      const subject = arg.replace(/\b\d{1,3}\s*(min|m)?\b/i, '').trim() || st.subjects[0] || 'Focus'
      f.start(subject, minutes)
      return { reply: `⏱ <b>Focus started:</b> ${esc(subject)} · ${minutes} min.\nPhone away. Tap Stop (or send <code>/stop</code>) when you finish.`, keyboard: STOP_KEYBOARD }
    }
    if (cmd === 'stop') {
      const r = f.stop()
      focusEnded.push({ subject: r.session.subject, minutes: r.session.minutes })
      return stoppedReply(r, f.plan(s.wallet.today()))
    }
    if (cmd === 'plan') {
      if (arg) f.setPlan(parsePlan(arg))
      const plan = f.plan(s.wallet.today())
      return { reply: planText(plan, arg ? '📝 <b>Plan saved</b>' : undefined), keyboard: plan.items.length ? planKeyboard(plan, false) : undefined }
    }
    if (cmd === 'fun') {
      const minutes = Number(/\b(\d{1,3})\b/.exec(arg)?.[1] ?? 0)
      if (!minutes) return { reply: '🎮 How long? e.g. <code>/fun 30 youtube</code> (1 coin a minute)' }
      const what = arg.replace(/\b\d{1,3}\s*(min|m)?\b/i, '').trim() || 'Fun'
      const r = f.fun(minutes, what)
      return { reply: `🎮 <b>Enjoy ${minutes} min of ${esc(what)}</b> · −${r.cost} coins (left: ${r.balance})` }
    }
    if (cmd === 'review') {
      if (!arg) return { reply: '📝 Send one line about today, e.g. <code>/review good focus, phone was the problem</code>' }
      const today = s.wallet.today()
      const cur = f.plan(today)
      f.review(cur.review ? `${cur.review}\n${arg}` : arg, cur.reasons)
      return { reply: '📝 <b>Saved.</b> Thanks: this is what makes next week better.' }
    }
    const st = f.state()
    if (cmd === 'week') return { reply: weekText(st.week, st.goals) }
    return { reply: goalsText(st.goals) }
  }

  function run(s: Services, text: string, key = ''): RunOut {
    // Ben's cards (what Sporty did): /water and /workout, on the one shared log.
    const cmd = /^\/(water|workout|w|gym)(?:@\w+)?$/i.exec(text.trim())
    if (cmd) {
      const day = sportToday()
      const st = sportState(s.db) ?? defaultSport(day)
      if (!sportState(s.db)) setSetting(s.db, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: st }))
      const c = /^water$/i.test(cmd[1]) ? waterCard(st, day) : workoutCard(st, day)
      return { reply: c.text, keyboard: c.keyboard }
    }
    // "water 500", "+250ml": the shared water log, never a food expense.
    const ml = text.startsWith('/') ? null : parseWater(text)
    if (ml) {
      const day = sportToday()
      const st = sportState(s.db) ?? defaultSport(day)
      const next = addWater(st, ml, day)
      setSetting(s.db, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: next }))
      const c = waterCard(next, day)
      return { reply: `💧 <b>${ml > 0 ? '+' : ''}${ml} ml</b> logged.\n\n${c.text}`, keyboard: c.keyboard }
    }
    const viaFocus = runFocus(s, text)
    if (viaFocus) return viaFocus
    const parsed = parseTelegramText(text)
    if ((parsed.type === 'expense' || parsed.type === 'unknown') && !text.startsWith('/')) {
      const money = runMoney(s, text, key)
      if (money) return money
    }
    switch (parsed.type) {
      case 'help':
        return { reply: formatHelpMessage() }
      case 'today': {
        const sum = s.wallet.summary()
        return {
          reply: formatTodayStatus({
            balance: sum.balance,
            level: sum.level.level,
            rank: sum.level.rank,
            totalXp: sum.totalXp,
            ritualsDone: sum.todayRules?.length ?? 0,
            totalRituals: 5,
            cleanStreak: s.discipline.state().current,
            workoutStreak: s.body.state().streak,
            tasksLeft: s.tasks.state().tasks.filter((t) => !t.done).length
          })
        }
      }
      case 'checkin': {
        s.discipline.checkIn()
        // The same day number MAN shows (its start day is Day 1).
        const st = s.discipline.state()
        return { reply: formatCleanCheckinResponse(st.current + (st.resets === 0 ? 1 : 0), 20) }
      }
      case 'oath':
        s.discipline.oath()
        return { reply: '📜 <b>Morning Oath Affirmed!</b>\n\n<i>"I commit to purity, disciplined physical power, sharp financial focus, and daily relentless self-mastery."</i>\n\n+' + ruleCoins(s, 'discipline.oath', 3) + ' points!' }
      case 'workout': {
        const name = parsed.exerciseName || 'pushups'
        const amount = parsed.exerciseAmount || 20 // like the desktop: "/pushups" alone is 20
        const res = s.body.logWorkout({
          title: `${name} (+${amount})`,
          items: [{ exerciseId: name.toLowerCase(), name, amount, unit: 'reps' }],
          note: 'Logged via Telegram'
        })
        return { reply: formatWorkoutResponse(name, amount, res.state.streak, res.awarded ? 10 : 0), sport: { name, amount } }
      }
      case 'sport': {
        const name = parsed.exerciseName || 'Workout'
        const amount = parsed.exerciseAmount || 1
        const rawUnit = parsed.exerciseUnit || 'minutes'
        const unit = rawUnit === 'reps' || rawUnit === 'kg' || rawUnit === 'sets' ? rawUnit : 'minutes'
        const res = s.body.logWorkout({
          title: `${name} (${amount} ${rawUnit})`,
          items: [{ exerciseId: name.toLowerCase().replace(/\s+/g, '_'), name, amount, unit }],
          note: `Logged via Telegram (${amount} ${rawUnit})`
        })
        return { reply: formatSportResponse(name, amount, rawUnit, res.state.streak, res.awarded ? 10 : 0, res.awarded ? 25 : 0) }
      }
      case 'weight': {
        const w = parsed.metricWeight
        if (!w || w < 30 || w > 300) return { reply: '⚠️ Send a real weight, e.g. <code>/weight 74.5</code>.' }
        s.body.logMetric({ weight: w, note: 'Telegram' })
        return { reply: formatMetricResponse('weight', w, 'kg', 0, 0) }
      }
      case 'waist': {
        const w = parsed.metricWaist
        if (!w || w < 40 || w > 200) return { reply: '⚠️ Send a real waist size, e.g. <code>/waist 82</code>.' }
        s.body.logMetric({ waist: w, note: 'Telegram' })
        return { reply: formatMetricResponse('waist', w, 'cm', 0, 0) }
      }
      case 'sport_status':
      case 'pr': {
        const st = s.body.state()
        return { reply: formatSportStatusResponse({ streak: st.streak, totalWorkouts: st.totalWorkouts, thisWeek: st.workoutsThisWeek, latestWeight: st.latestWeight, latestWaist: st.latestWaist }) }
      }
      case 'expense': {
        const cents = Math.round((parsed.expenseAmount || 0) * 100)
        if (!(cents > 0)) return { reply: '⚠️ How much? e.g. <code>/expense 45 food lunch</code>' }
        const cat = parsed.expenseCategory || 'other'
        const note = parsed.expenseNote || ''
        // "+500 salary": money in. It goes to Finance Helper only (Life
        // System's spending log has no income), never as an expense.
        if (cat === 'income') {
          return {
            reply: `💰 <b>Income noted:</b> ${formatMoney(cents, 'MDL')}${note ? ` · ${esc(note)}` : ''}\n\nAdded to Finance Helper.`,
            expense: { amount: cents, category: 'income', note, type: 'income' as const }
          }
        }
        const res = s.money.addExpense(cents, cat, note ? `[Telegram] ${note}` : '[Telegram]', new Date(), true)
        const cur = res.state.currency || 'MDL'
        return {
          reply: formatExpenseResponse(formatMoney(cents, cur), cat, note || null, formatMoney(Math.max(0, res.state.today.remaining), cur), res.awarded ? 3 : 0),
          expense: { amount: cents, category: res.expense?.category ?? cat, note }
        }
      }
      case 'balance': {
        const coins = s.wallet.summary().balance
        const accounts = financeAccounts(currentDb)
        const money = s.money.state()
        return {
          reply: formatBalanceResponse({
            currency: 'MDL',
            walletCoins: coins,
            walletCoinsValueMdl: Math.round((coins / 10) * 100) / 100,
            vaultSurplusMdl: s.economy.getEconomySummary().vaultBalance,
            financeAccountsTotalMdl: accounts.filter((a) => a.currency === 'MDL').reduce((t, a) => t + a.balanceMdl, 0),
            financeAccounts: accounts,
            dailyBudgetLeftMdl: Math.max(0, money.today.remaining) / 100
          })
        }
      }
      case 'wake': {
        // "/wake" now, "/wake 06:40" (forgot to log it), "/wake yesterday 06:30".
        const time = parsed.args.find((a) => /^\d{1,2}[:.]\d{2}$/.test(a))?.replace('.', ':')
        const back = parsed.args.some((a) => /^(yesterday|ieri|вчера)$/i.test(a)) ? 1 : 0
        if (time || back) {
          if (!time) return { reply: '⏰ What time? e.g. <code>/wake yesterday 06:30</code>' }
          const day = addDays(s.wallet.today(), -back)
          const res = s.sleep.setWake(day, time)
          return { reply: `🌅 <b>Wake-up ${back ? 'for yesterday ' : ''}set</b>: ${res.log.wakeTime} (target ${res.log.wakeTarget})\n${res.awarded ? `🎯 On time! <b>+${ruleCoins(s, 'sleep.up_on_time', 10)} points</b>` : res.log.onTime ? (back ? 'On time · no coins for past days.' : 'On time.') : 'Saved to your sleep history.'}` }
        }
        const res = s.sleep.logWake(new Date().toTimeString().slice(0, 5)) // local time (the server runs in your time zone)
        return {
          reply: `🌅 <b>Wake-up logged</b>: ${res.log.wakeTime}\n${res.awarded ? `🎯 On time! <b>+${ruleCoins(s, 'sleep.up_on_time', 10)} points</b>` : res.log.onTime ? 'On time.' : 'Saved to your sleep history.'}\n<i>Woke up earlier? Send</i> <code>/wake 06:40</code>\n\n😴 <b>How did you sleep?</b>`,
          keyboard: sleepKeyboard(res.log.day)
        }
      }
      case 'spent': {
        // Answered from Finance Helper's records, no AI needed.
        const today = s.wallet.today()
        const from = parsed.period === 'week' ? addDays(today, -6) : parsed.period === 'month' ? `${today.slice(0, 8)}01` : parsed.period === 'yesterday' ? addDays(today, -1) : today
        const to = parsed.period === 'yesterday' ? from : today
        const line = answerLocal(`spending ${from} ${to}`, { finance: financeStateFrom(currentDb, store), input: null as any, ledger: [], sessions: [] }) ?? 'No spending data yet.'
        const label = { today: 'Today', yesterday: 'Yesterday', week: 'The last 7 days', month: 'This month' }[parsed.period ?? 'today']
        return { reply: `💸 <b>${label}</b>\n${esc(line.replace(/^Spending [^:]+: /, ''))}` }
      }
      case 'bed': {
        // "bed 23:40" / "went to bed at 0:30": that time, else now.
        const at = parsed.args.find((a) => /^\d{1,2}:\d{2}$/.test(a))
        const res = s.sleep.logBed(at ?? new Date().toTimeString().slice(0, 5))
        return { reply: `🌙 <b>Bedtime logged</b>: ${res.log.bedTime}\n${res.awarded ? `🎯 On time! <b>+${ruleCoins(s, 'sleep.bed_on_time', 5)} points</b>` : 'Saved to your sleep history.'}` }
      }
      case 'tasks': {
        const open = s.tasks.state().tasks.filter((t) => !t.done).slice(0, 8)
        return {
          reply: open.length
            ? `📋 <b>Open tasks</b>\n\n${open.map((t, i) => `${i + 1}. [${esc(t.category)}] <b>${esc(t.title)}</b>`).join('\n')}\n\n<i>Done one? Send</i> <code>/done 1</code>`
            : '📋 <b>No open tasks.</b> All clear!'
        }
      }
      case 'done': {
        const open = s.tasks.state().tasks.filter((t) => !t.done)
        const num = parsed.taskIndex ?? parseInt(parsed.args[0], 10)
        const target = open.find((t) => t.id === num) ?? (num > 0 && num <= open.length ? open[num - 1] : undefined)
        if (!target) return { reply: '⚠️ No task with that number. Send <code>/tasks</code> to see them.' }
        s.tasks.complete(target.id)
        return { reply: `✅ Done: <b>${esc(target.title)}</b>` }
      }
      case 'vault': {
        const v = s.economy.getEconomySummary()
        return {
          reply: [
            '🏛️ <b>Reward vault</b>',
            '',
            `🪙 Coins: <b>${v.coinsBalance}</b> (≈ ${v.coinsRealValue} ${v.currency})`,
            `💰 Vault: <b>${v.vaultBalance} ${v.currency}</b>`,
            `🔥 Multiplier: ${v.multiplier.label}`,
            v.pinnedGoal ? `🌟 Goal: ${esc(v.pinnedGoal.title)} (${v.pinnedGoal.allocatedCoins}/${v.pinnedGoal.targetCoins} coins)` : ''
          ].filter(Boolean).join('\n')
        }
      }
      case 'goals': {
        const goals = s.economy.goals().filter((g: any) => !g.completed)
        return {
          reply: goals.length
            ? `🎯 <b>Goals</b>\n\n${goals.map((g: any, i: number) => `${i + 1}. ${g.pinned ? '⭐ ' : ''}<b>${esc(g.title)}</b> · ${g.allocatedCoins}/${g.targetCoins} coins`).join('\n')}`
            : '🎯 No open goals. Add one in the Shop.'
        }
      }
      case 'crush':
        return { reply: formatUrgeResponse() }
      default:
        return { reply: `❓ I didn't understand <code>${esc(text.slice(0, 60))}</code>.\n\nSend <code>/help</code> for the list.`, unknown: true }
    }
  }

  /**
   * Handles one message in one Turso transaction (with its "seen" mark). If
   * another device got there first, the copy reloads and we skip it.
   */
  /** A tap on a button under a logged money record (account, category, undo). */
  async function handleButton(botId: string, update: any, cfg: BotBridgeConfig): Promise<string | null> {
    const cq = update.callback_query
    const chat = String(cq?.message?.chat?.id ?? '')
    const data = String(cq?.data ?? '')
    const key = `${botId}:cb:${cq?.id}`
    if (!cq || !/^(f[acbkuoxq]|p[pr]|td|sq|g[pxb]|n[ps]|r[bvw]|cu|cs|wa|wk|fb|md|sk|sr|bd)\|/.test(data)) return null
    const answer = (text: string) => tg(update.__token, 'answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => null)
    if (!allowed(cfg, chat)) {
      await answer('Not allowed')
      return null
    }
    const edit = (text: string, keyboard?: any) =>
      tg(update.__token, 'editMessageText', { chat_id: chat, message_id: cq.message.message_id, text, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) }).catch(() => null)
    // Water and workout cards: a tap updates the shared log and the card.
    if (data.startsWith('wa|') || data.startsWith('wk|')) {
      if (!(await markSeen(key))) return null
      const show = data === 'wa|show' || data === 'wk|show'
      const r = await mirror.write((db) => {
        const svc = services.services(db)
        const day = sportToday()
        let st = sportState(db) ?? defaultSport(day)
        const save = (x: any) => setSetting(db as any, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: x }))
        if (data.startsWith('wa|')) {
          if (!show) {
            st = addWater(st, Number(data.slice(3)) || 0, day)
            save(st)
          }
          const c = waterCard(st, day)
          return { ...c, toast: show ? '' : `${Number(data.slice(3)) > 0 ? '+' : ''}${data.slice(3)} ml` }
        }
        let extra = ''
        let toast = ''
        if (!show) {
          const was = allDone(sportForDay(st, day))
          st = applyWorkoutTap(st, day, data.slice(3))
          save(st)
          toast = 'Logged'
          if (!was && allDone(st)) {
            // Finished: it counts as today's workout (streak, points), and targets may go up.
            const list = activeExercises(st)
            try {
              svc.body.logWorkout({ title: `Daily workout: ${list.map((e: any) => `${e.doneToday} ${e.name}`).join(', ')}`, items: list.map((e: any) => ({ exerciseId: String(e.id ?? e.name), name: String(e.name), amount: Number(e.doneToday) || 0, unit: e.unit === 'sec' ? 'minutes' : 'reps' })), note: 'Logged with Ben' })
            } catch {
              /* already logged today */
            }
            let log: WorkoutLog = { days: {} }
            try {
              log = JSON.parse(getSetting(db as any, 'ben_workouts') || '{"days":{}}')
            } catch {
              log = { days: {} }
            }
            log = recordWorkoutDay(log, st, day)
            setSetting(db as any, 'ben_workouts', JSON.stringify(log))
            const ups = st.sportySettings?.autoProgression === false ? [] : progression(log, st)
            for (const u of ups) st = setExercise(st, day, u.name, u.to).st
            if (ups.length) save(st)
            const body = svc.body.state()
            extra = [`🔥 Streak ${body.streak} day${body.streak === 1 ? '' : 's'} · ${body.workoutsThisWeek} this week`, ...ups.map((u) => `📈 ${u.name}: ${u.from} → ${u.to} (3 full days in a row)`)].join('\n')
            toast = 'Workout done! 🔥'
          }
        }
        return { ...workoutCard(st, day, extra), toast }
      })
      await answer(r.toast || 'OK')
      if (show) await tg(update.__token, 'sendMessage', { chat_id: chat, text: r.text, parse_mode: 'HTML', reply_markup: r.keyboard }).catch(() => null)
      else await edit(r.text, r.keyboard)
      return r.text
    }
    // A reply button: "say" sends its words as your message; "book" books a goal; "plan" makes today's plan.
    if (data.startsWith('cs|') || data.startsWith('gb|') || data === 'rb|p') {
      if (!(await markSeen(key))) return null
      await answer(data.startsWith('cs|') ? '…' : 'On it')
      if (data === 'rb|p') return sendProposal(update.__token, chat)
      if (data.startsWith('gb|')) {
        const want = data.slice(3).toLowerCase()
        const plans = await rhythm.goalPlans()
        const ids = plans.filter((p) => p.title.toLowerCase().startsWith(want) || want.startsWith(p.title.toLowerCase().slice(0, want.length))).map((p) => p.goalId)
        const r = await rhythm.bookGoals(ids.length ? ids : undefined)
        const text = r.lines.map(esc).join('\n')
        await tg(update.__token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML' }).catch(() => null)
        return text
      }
      const said = data.slice(3)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text: `💬 <i>${esc(said)}</i>`, parse_mode: 'HTML' }).catch(() => null)
      return handleBrain(botId, { __token: update.__token, update_id: update.update_id, message: { chat: { id: chat }, text: said } }, cfg, said, `${key}:say`)
    }
    // 👍 / 👎 / too long / wrong on a reply: saved, and Ben adjusts.
    if (data.startsWith('fb|')) {
      if (!(await markSeen(key))) return null
      const [, ms, kind] = data.split('|')
      const at = new Date(Number(ms)).toISOString()
      await mirror.write((db) => {
        const e = loadLog(db).find((x) => x.role === 'coach' && x.at === at)
        addFeedback(db, { at, kind: (['up', 'down', 'long', 'wrong'].includes(kind) ? kind : 'down') as Feedback['kind'], text: e?.text ?? String(cq.message?.text ?? '').slice(0, 300) })
      })
      await answer(kind === 'up' ? '👍 Noted' : kind === 'long' ? 'Got it: shorter' : kind === 'wrong' ? 'Got it: tell me what was wrong' : 'Noted: I will do better')
      // Keep the other buttons, drop the feedback row (it's been answered).
      const kb = (cq.message?.reply_markup?.inline_keyboard ?? []).filter((row: any[]) => !row.some((b) => String(b.callback_data ?? '').startsWith('fb|')))
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: kb } }).catch(() => null)
      return null
    }
    // Ben's desk from Telegram: mood (md|1-5), a stake done (sk|id), a study topic reviewed (sr|id).
    if (data.startsWith('md|') || data.startsWith('sk|') || data.startsWith('sr|')) {
      if (!(await markSeen(key))) return null
      const arg = data.slice(3)
      const line = await mirror.write((db) => {
        const svc = services.services(db)
        if (data.startsWith('md|')) return `${moodFace(Number(arg))} ${deskChange(svc, { op: 'mood', mood: Number(arg) })}`
        if (data.startsWith('sk|')) {
          const st = loadDesk(db).stakes.find((x) => x.id === arg)
          if (!st || st.status !== 'open') return st?.status === 'lost' ? 'Too late: the points are gone.' : 'Already done.'
          return `💎 ${deskChange(svc, { op: 'keepStake', id: arg })} "${st.text}" · your ${st.points} points are safe.`
        }
        return `📚 ${deskChange(svc, { op: 'reviewed', id: arg })}`
      })
      await answer(line.slice(0, 190))
      await edit(`${esc(String(cq.message?.text ?? ''))}\n\n${esc(line)}`)
      return line
    }
    // ↩ Undo under a coach reply: take back what it did.
    if (data.startsWith('cu|')) {
      if (!(await markSeen(key))) return null
      const at = new Date(Number(data.slice(3))).toISOString()
      const r = await undoReply(at)
      await answer(r.ok ? 'Undone' : r.lines[0] ?? 'Nothing to undo')
      const text = `${esc(String(cq.message?.text ?? ''))}\n\n${r.lines.map(esc).join('\n')}`
      await edit(text)
      return text
    }
    // The daily rhythm: today's plan, the evening review, the Sunday review.
    if (/^r[bvw]\|/.test(data)) {
      if (!(await markSeen(key))) return null
      const msg = String(cq.message?.text ?? '')
      try {
        if (data === 'rb|a') {
          await answer('Approving…')
          const r = await rhythm.approve()
          const text = r.plan ? `${proposalText(r.plan, { approved: true })}\n${r.done.map(esc).join('\n')}` : esc(r.done.join(' '))
          await edit(text)
          return text
        }
        if (data === 'rb|r') {
          await answer('Making another plan…')
          await edit(`${esc(msg)}\n\n🔄 <i>Making another one…</i>`)
          return await sendProposal(update.__token, chat)
        }
        if (data === 'rb|e' || data === 'rv|e' || data === 'rw|e') {
          await answer('Tell me')
          const ask = data === 'rb|e' ? EDIT_ASK : data === 'rv|e' ? TOP3_ASK : WEEK_ASK
          await tg(update.__token, 'sendMessage', { chat_id: chat, text: ask, reply_markup: { force_reply: true, input_field_placeholder: data === 'rb|e' ? 'No gym today; lab report first' : 'One per line' } })
          return ask
        }
        if (data === 'rv|k') {
          await answer('Saved for tomorrow')
          const text = `${esc(msg)}\n\n✅ <b>Saved.</b> They're the first must-dos in tomorrow's plan.`
          await edit(text)
          return text
        }
        if (data === 'rw|a') {
          const line = await rhythm.applyWeekly()
          await answer('Week planned')
          const text = `${esc(msg)}\n\n✅ ${esc(line)}`
          await edit(text)
          return text
        }
      } catch (e) {
        await answer((e as Error).message.slice(0, 190))
      }
      return null
    }
    // A Todoist task finished after a focus session: Todoist is a network
    // call, so the tap is marked seen first, then Todoist, then the coins.
    if (data.startsWith('td|')) {
      const fresh = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return false
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        return true
      })
      if (!fresh) return null
      const id = data.slice(3)
      const title = /“([^”]*)”/.exec(String(cq.message?.text ?? ''))?.[1] ?? 'Todoist task'
      try {
        if (!todoist) throw new Error('Todoist is not connected')
        await todoist.close(id)
        const paid = await mirror.write((db) => payTodoist(services.services(db), [{ id, content: title }]))
        await answer(paid ? '+8 coins' : 'Done')
        const text = `${String(cq.message?.text ?? '').split('\n\nFinished')[0]}\n\n✅ <b>Done in Todoist:</b> ${esc(title)}${paid ? ' · 🪙 +8' : ''}`
        await edit(text)
        return text
      } catch (e) {
        await answer(`Todoist: ${(e as Error).message}`.slice(0, 190))
        return null
      }
    }
    // The suggested time blocks: into Google Calendar (or not).
    if (data.startsWith('gp|') || data.startsWith('gx|')) {
      const sug = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return undefined
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        try {
          return JSON.parse(getSetting(db as any, 'plan_suggestion') || 'null') as { day: string; blocks: { title: string; start: string; end: string }[] } | null
        } catch {
          return null
        }
      })
      if (sug === undefined) return null
      if (data.startsWith('gx|') || !sug || !calendar) {
        await answer('Okay')
        await edit(`${esc(String(cq.message?.text ?? ''))}\n\nOkay, no blocks. Start when you're ready: /focus 50`)
        return 'no blocks'
      }
      let made = 0
      for (const b of sug.blocks) {
        const ok = await calendar.create({ title: b.title, start: new Date(`${sug.day}T${b.start}:00`).toISOString(), end: new Date(`${sug.day}T${b.end}:00`).toISOString(), description: 'Planned with your coach in Life System' }).then(() => true).catch(() => false)
        if (ok) made++
      }
      await answer(made ? `${made} blocks added` : 'Calendar failed')
      const text = `${esc(String(cq.message?.text ?? ''))}\n\n✅ ${made} block${made === 1 ? '' : 's'} in your Google Calendar. When one starts, I'll be here: /focus 50`
      await edit(text)
      return text
    }
    // How a focus session went (1–5); a low one asks what got in the way.
    if (data.startsWith('fq|')) {
      const [, day, n, minutes] = data.split('|')
      const fresh = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return false
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        setSetting(db as any, RATINGS, JSON.stringify([...focusRatings(db), { day, rating: Number(n), minutes: Number(minutes) || 0 }].slice(-60)))
        return true
      })
      if (!fresh) return null
      const r = Number(n)
      await answer(`${n}/5 noted`)
      const base = esc(String(cq.message?.text ?? '').replace(/\n*(And )?[Hh]ow did it go\?\s*$/, ''))
      const low = r <= 2
      const text = `${base}\n\n${low ? `Session: <b>${r}/5</b>. What got in the way? Tap it, and next time we fix that first.` : r === 3 ? 'Session: <b>3/5</b>. Fine. Next one: phone in another room for the first 10 minutes.' : `Session: <b>${r}/5</b> 🔥 That's the feeling. Same time tomorrow?`}`
      const keyboard = low ? { inline_keyboard: [REASONS.slice(0, 3), REASONS.slice(3)].map((row, k) => row.map((x, i) => ({ text: x, callback_data: `pr|${day}|${k * 3 + i}` }))) } : undefined
      await edit(text, keyboard)
      return text
    }
    // Coach nudges: pause them for today, or snooze 30 minutes.
    if (data.startsWith('np|') || data.startsWith('ns|')) {
      const pause = data.startsWith('np|')
      await mirror.write((db) => {
        let st: NudgeState = {}
        try {
          st = JSON.parse(getSetting(db as any, NUDGES) || '{}')
        } catch {
          st = {}
        }
        const now = new Date()
        const today = services.services(db).wallet.today(now)
        setSetting(db as any, NUDGES, JSON.stringify(pause ? { ...st, pausedDay: today } : { ...st, snoozeUntil: new Date(now.getTime() + 30 * 60000).toISOString() }))
      })
      const text = pause ? '⏸ Nudges paused for today. Back tomorrow.' : '😴 OK, I\'ll check again in 30 minutes.'
      await answer(text)
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
    // ✕ Drop it, under a block Ben moved: off the calendar for today.
    if (data.startsWith('bd|')) {
      if (!(await markSeen(key))) return null
      const arg = data.slice(3)
      // New buttons carry the event id; older ones a position in the moved list.
      const id = /^\d{1,3}$/.test(arg)
        ? await mirror.read((db) => {
            try {
              return (JSON.parse(getSetting(db as any, 'coach_rhythm') || 'null')?.moved ?? [])[Number(arg)] as string | undefined
            } catch {
              return undefined
            }
          })
        : arg
      let ok = false
      if (id && calendar?.remove) {
        const day = new Date()
        const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString()
        const ev = (await calendar.events(from, new Date(Date.parse(from) + 86400000).toISOString()).catch(() => [])).find((e) => e.id === id)
        if (ev) ok = await calendar.remove(ev.calendarId, ev.id).then(() => true).catch(() => false)
      }
      const text = ok ? '✕ Dropped for today. Your calendar is up to date.' : 'Could not find that block anymore; it may already be gone.'
      await answer(ok ? 'Dropped' : 'Not found')
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
    // How you slept (1–5), under the wake-up message.
    if (data.startsWith('sq|')) {
      const [, day, n] = data.split('|')
      const res = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return null
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        try {
          const svc = services.services(db)
          svc.sleep.setQuality(day, Number(n))
          return { tip: sleepTip(Number(n), svc.sleep.bedtimeTarget()) }
        } catch (e) {
          return { tip: '', error: (e as Error).message }
        }
      })
      if (!res) return null
      await answer(res.error ?? `Sleep ${n}/5 noted`)
      if (res.error) return null
      // Telegram gives the message back as plain text: escape it, then add ours.
      const text = `${esc(String(cq.message?.text ?? '').replace(/\n*😴 How did you sleep\?\s*$/, ''))}\n\n😴 Sleep: <b>${n}/5</b>. ${res.tip}`
      await edit(text)
      return text
    }
    // ▶ start a 50-minute session on a subject / ⏹ stop the running one.
    if (data.startsWith('fo|') || data.startsWith('fx|')) {
      const res = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return null
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        const f = services.services(db).focus
        try {
          if (data.startsWith('fo|')) {
            // "fo|Subject" (50 min) or "fo|25|Subject" (a coach button with its own length).
            const m = /^fo\|(\d{1,3})\|(.*)$/.exec(data)
            const minutes = m ? Math.min(180, Math.max(5, Number(m[1]))) : 50
            const subject = (m ? m[2] : data.slice(3)) || 'Focus'
            const plan = f.plan(services.services(db).wallet.today())
            const item = plan.items.find((p) => !p.done && p.text.startsWith(subject))
            f.start(subject, minutes, new Date(), item ? { kind: 'mustdo', ref: item.text, title: item.text } : null)
            return { text: `⏱ <b>Focus started:</b> ${esc(item?.text ?? subject)} · ${minutes} min.\nPhone away. Tap Stop when you finish.`, keyboard: STOP_KEYBOARD, toast: 'Focus started' }
          }
          const r = f.stop()
          focusEnded.push({ subject: r.session.subject, minutes: r.session.minutes })
          const out = stoppedReply(r, f.plan(services.services(db).wallet.today()))
          return { text: out.reply, keyboard: out.keyboard, toast: r.coins ? `+${r.coins} coins` : 'Logged' }
        } catch (e) {
          return { text: '', keyboard: undefined, toast: (e as Error).message.slice(0, 190) }
        }
      })
      if (!res) return null
      await answer(res.toast)
      if (!res.text) return null
      // A start sends a new message (the coach's stays); a stop edits the timer message.
      if (data.startsWith('fo|')) await tg(update.__token, 'sendMessage', { chat_id: chat, text: res.text, parse_mode: 'HTML', reply_markup: res.keyboard }).catch(() => null)
      else await edit(res.text, res.keyboard)
      await flushFocus()
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-focus-changed'))
      return res.text
    }
    const res = await mirror.write((db) => {
      if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return null
      db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
      const svc = services.services(db)
      if (data.startsWith('p')) {
        // pp|day|i ticks a must-do; pr|day|n marks what got in the way
        const [kind, day, n] = data.split('|')
        return db.transaction(() => {
          let toast = ''
          if (kind === 'pp') {
            const r = svc.focus.togglePlan(Number(n), new Date(), day)
            toast = r.coins ? `+${r.coins} coins` : '✓'
          } else {
            const reason = REASONS[Number(n)]
            const cur = svc.focus.plan(day).reasons
            svc.focus.review(null, cur.includes(reason) ? cur.filter((x) => x !== reason) : [...cur, reason], new Date(), day)
            toast = 'Noted'
          }
          const plan = svc.focus.plan(day)
          // From a session rating ("What got in the way?"): keep that message, note the reason.
          if (kind === 'pr' && String(cq.message?.text ?? '').includes('What got in the way?')) {
            const reason = REASONS[Number(n)]
            return { text: `${esc(String(cq.message?.text ?? '').replace(/What got in the way\?[\s\S]*$/, ''))}Noted: <b>${esc(reason)}</b>. The coach will help you fix that first next time.`, keyboard: undefined, toast }
          }
          const evening = String(cq.message?.text ?? '').includes('Evening review')
          const focusMin = svc.focus.state().todayMin
          return { text: evening ? eveningText(plan, focusMin) : planText(plan), keyboard: planKeyboard(plan, evening), toast }
        })()
      }
      return db.transaction(() => {
        const r = moneyButton(db as any, data, svc.wallet.today())
        // Undo removes it from Life System's spending log too.
        const life = r && data.startsWith('fu|') ? takeLink(db, data.split('|')[1]) : null
        if (life) {
          try {
            svc.money.deleteExpense(life)
          } catch {
            /* already deleted */
          }
        }
        return r
      })()
    })
    if (!res) return null
    await answer(res.toast)
    await tg(update.__token, 'editMessageText', {
      chat_id: chat,
      message_id: cq.message.message_id,
      text: res.text,
      parse_mode: 'HTML',
      ...(res.keyboard ? { reply_markup: res.keyboard } : {})
    }).catch(() => null)
    if (data.startsWith('fu|') || data.startsWith('fa|') || data.startsWith('fk|')) onExpense?.()
    return res.text
  }

  /**
   * /todo, /task …, /done N with Todoist connected. Todoist is a network call,
   * so it runs outside the database change: the message is marked seen
   * first, then Todoist is asked, then the coins are written.
   */
  async function handleTodoist(botId: string, update: any, cfg: BotBridgeConfig): Promise<string | null | undefined> {
    const text = String(update.message?.text ?? '').trim()
    const m = /^\/(todo|tasks|task|add|done)(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(text)
    if (!todoist || !m) return undefined
    const chat = String(update.message?.chat?.id ?? '')
    const key = `${botId}:${update.update_id}`
    const fresh = await mirror.write((db) => {
      if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return false
      db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
      return true
    })
    if (!fresh) return null
    const cmd = m[1].toLowerCase()
    const arg = (m[2] ?? '').trim()
    let reply: string
    let ok = true
    if (!allowed(cfg, chat)) {
      reply = `⛔ This chat (<code>${esc(chat)}</code>) isn't allowed.`
      ok = false
    } else {
      try {
        const today = await services.read((sv) => sv.wallet.today())
        if (cmd === 'task' || cmd === 'add') {
          if (!arg) reply = '➕ What should I add? e.g. <code>/task call Leo tomorrow 17:00 p1 #University</code>'
          else {
            const t = await todoist.quickAdd(arg)
            reply = `➕ <b>Added to Todoist:</b> ${esc(t.content || arg)}${t.section ? `\n📂 ${esc(t.section)}` : t.project ? `\n📂 ${esc(t.project)}` : ''}${t.due ? `\n📅 ${t.due === today ? 'Today' : t.due}${t.dueTime ? ' ' + t.dueTime : ''}` : ''}${t.priority > 1 ? ` · ${pLabel(t.priority)}` : ''}`
          }
        } else if (cmd === 'done' && arg) {
          const list = sortToday(await todoist.today(), today)
          const n = parseInt(arg, 10)
          const t = n > 0 ? list[n - 1] : undefined
          if (!t) reply = '⚠️ No task with that number. Send <code>/todo</code> to see them.'
          else {
            await todoist.close(t.id)
            const paid = await mirror.write((db) => payTodoist(services.services(db), [t]))
            reply = `✅ <b>Done in Todoist:</b> ${esc(t.content)}${paid ? '\n🪙 <b>+8 coins</b>' : ''}`
          }
        } else {
          reply = todayText(await todoist.today(), today)
        }
      } catch (e) {
        ok = false
        reply = `⚠️ Todoist: ${esc((e as Error).message)}`
      }
    }
    processed++
    addLog(text, chat, ok, reply)
    await tg(update.__token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML' }).catch(() => null)
    return reply
  }

  /**
   * One text through the app's own rules, inside the open transaction: the
   * reply, plus the side effects (Sport Track reps on the server, Finance
   * Helper's inbox for money).
   */
  function applyText(db: any, svc: Services, text: string, key: string): RunOut {
    currentDb = db
    // "Should I buy headphones 1200?": the verdict from your budget, goals and price in work hours.
    const buy = readPurchase(text)
    if (buy) {
      const v = deskView(svc, financeStateFrom(db, store))
      const r = purchaseCheck({ ...v.money, price: buy.price, what: buy.what })
      return { reply: `${r.verdict === 'buy' ? '🟢' : r.verdict === 'wait' ? '🟡' : '🔴'} <b>${esc(r.title)}</b>\n${r.lines.map((l) => `• ${esc(l)}`).join('\n')}` } as RunOut
    }
    return db.transaction(() => {
      const out = run(svc, text, key)
      if (server && out.sport) {
        const prog = addRepsInDb(db, out.sport.name, out.sport.amount)
        if (prog && prog.target) out.reply += `\n\n📊 Today: <b>${prog.done}/${prog.target}</b> (${Math.round((prog.done / prog.target) * 100)}%)`
        out.sport = undefined
      }
      // Finance Helper gets it too (see financeInbox.ts).
      if (out.expense) {
        const now = new Date()
        queueFinanceExpense(db as any, { id: `tg-life-${key.replace(/[^\w-]/g, '-')}`, ...out.expense, date: svc.wallet.today(now), at: now.getTime() })
      }
      return out
    })()
  }

  /** Marks a message seen; false when another device or a retry already had it. */
  const markSeen = (key: string) =>
    mirror.write((db) => {
      if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return false
      db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
      return true
    })

  const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

  /**
   * The coach's brain (botBrain.ts): free text, a voice note or a photo, with
   * your data and the coach's memory. It answers and acts (logs, must-dos,
   * focus, Todoist, goals); each action goes through the app's own rules.
   */
  /**
   * The coach thinks: your message (and a voice note or photo) with your data,
   * its memory and your goals & rules; it answers and acts. Shared by the
   * Telegram bots and the app's Coach page (same memory, same log).
   */
  async function think(
    persona: Persona,
    text: string,
    key: string,
    media?: { kind: 'voice' | 'photo'; mime: string; data: string },
    via = 'telegram',
    onStep?: (step: string) => void
  ): Promise<{ ok: boolean; reply: string; done: string[]; keyboard?: any; steps?: string[]; mood?: Mood; at?: string; undo?: (UndoOp | null)[]; chips?: string[]; buttons?: { label: string; do: string }[]; show?: string[] }> {
    const step = (s: string) => {
      try {
        onStep?.(s)
      } catch {
        /* the screen's problem */
      }
    }
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    step('Reading your day')
    const [todoToday, upcoming, events] = await Promise.all([
      todoist ? todoist.today().catch(() => null) : Promise.resolve(null),
      todoist?.upcoming ? todoist.upcoming(7).catch(() => null) : Promise.resolve(null),
      calendar ? calendar.events(dayStart.toISOString(), new Date(dayStart.getTime() + 8 * 86400000).toISOString()).catch(() => null) : Promise.resolve(null)
    ])
    // You wrote: open follow-up check-ins stop asking.
    await mirror
      .write((db) => {
        const raw = getSetting(db as any, REMINDERS)
        if (!raw) return
        setSetting(db as any, REMINDERS, JSON.stringify(answeredReminders(JSON.parse(raw))))
      })
      .catch(() => null)
    // An excuse he repeats gets counted (Ben names the repeat kindly), and his profile note stays current.
    const excuseNote = await mirror
      .write((db) => {
        const svc = services.services(db)
        try {
          refreshProfile(svc, financeStateFrom(db, store))
        } catch {
          /* the notebook can wait */
        }
        return text ? noteExcuse(db, text, svc.wallet.today()) : null
      })
      .catch(() => null)
    const { context, memory, profile, look, mind, money, promises, feel, talk, notes, desk } = await mirror.read((db) => {
      const svc = services.services(db)
      const finance = financeStateFrom(db, store)
      let sessions: LookupData['sessions'] = []
      try {
        sessions = (db.prepare('SELECT day, subject, minutes FROM focus_sessions WHERE day >= ?').all(addDays(svc.wallet.today(), -400)) as any[]).map((r) => ({ day: String(r.day), subject: String(r.subject), minutes: Number(r.minutes) }))
      } catch {
        sessions = []
      }
      return {
        context: lifeContext(svc, db, { finance, todoToday, upcoming, events }),
        memory: loadMemory(db),
        profile: loadProfile(db),
        mind: (() => {
          const inp = svc.progress.input(null)
          const today = svc.wallet.today()
          return mindText(loadMind(db), today, weekSoFar(today, inp.focus, inp.workouts, inp.todoist))
        })(),
        talk: (() => {
          const sr = loadSelfReview(db)
          return {
            style: styleText(loadStyle(db)),
            tone: loadStyle(db).tone,
            feedback: feedbackText(loadFeedback(db)),
            selfReview: sr && sr.day >= addDays(svc.wallet.today(), -1) ? sr.notes.map((n) => `- ${n}`).join('\n') : ''
          }
        })(),
        feel: (() => {
          // How the coach feels about the day, from the data (its face in the chat).
          const f = svc.focus.state()
          let list: Reminder[] = []
          try {
            list = JSON.parse(getSetting(db as any, REMINDERS) || '[]')
          } catch {
            list = []
          }
          const ps = promiseStats(list)
          const now = new Date()
          const todayKey = svc.wallet.today(now)
          const lastLedger = svc.wallet.entries().filter((e: any) => e.day === todayKey).map((e: any) => Date.parse(e.ts)).filter(Number.isFinite)
          const lastFocus = f.todaySessions.map((x) => Date.parse(x.endedAt ?? '')).filter(Number.isFinite)
          const last = Math.max(0, ...lastLedger, ...lastFocus)
          return coachMood({
            hour: now.getHours(),
            focusMinToday: f.todayMin,
            idleMin: last ? (now.getTime() - last) / 60000 : Infinity,
            openMustDos: f.plan.items.filter((x) => !x.done).length,
            mustDosDone: f.plan.items.filter((x) => x.done).length,
            missedWeek: ps.broken + ps.ignored,
            keptWeek: ps.kept,
            goalsBehind: f.goals.filter((g) => g.aheadH <= -1).length
          })
        })(),
        promises: (() => {
          let list: Reminder[] = []
          try {
            list = JSON.parse(getSetting(db as any, REMINDERS) || '[]')
          } catch {
            list = []
          }
          return { ...promiseRefs(list), stats: promiseLine(promiseStats(list)) }
        })(),
        money: recentMoney(db as any, svc.wallet.today()),
        notes: (() => {
          try {
            seedNotes(db as any)
            return notesForBen(listNotes(db as any), text)
          } catch {
            return ''
          }
        })(),
        desk: (() => {
          try {
            return [deskPrompt(svc, finance), excuseNote ? `Repeat excuse just now. Say it kindly with the count: "${excuseNote}"` : ''].filter(Boolean).join('\n')
          } catch {
            return ''
          }
        })(),
        look: { finance, input: svc.progress.input(null, new Date(), 400), ledger: svc.wallet.entries().map((e: any) => ({ day: e.day, coins: Number(e.coins), kind: e.kind, note: e.note })), sessions } as LookupData
      }
    })
    // Tasks and events the coach can point at (E1, T3); grows when it asks for more.
    let allTasks: TodoTask[] = [...(todoToday ?? []), ...(upcoming ?? [])].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i)
    let allEvents: CalEvent[] = events ?? []
    let areas: { key: string; name: string }[] = []
    let made = makeRefs(allEvents, allTasks)
    // Money records it can fix (M1 = newest).
    const moneyRefs = new Map(money.map((m, i) => [`M${i + 1}`, m.id]))
    const moneyLines = money.length ? `Money records, newest first (use the M-number):\n${money.map((m, i) => `M${i + 1} ${m.line}`).join('\n')}` : ''
    // It thinks first for anything more than a quick log or a short chat line.
    const correcting = isCorrection(text)
    const big = isBigAsk(text) || correcting || text.split(/\s+/).length > 8 || /\?/.test(text)
    if (big) step('Thinking it through')
    // One reply must fit Vercel's 60 s: every call gets what's left of a 45 s budget.
    const deadline = Date.now() + 45_000
    const ask = (found?: string, extraNote = '') =>
      withTimeout(ai!(brainPrompt(persona, context, memory, extraNote ? `${text}\n\n(${extraNote})` : text, media?.kind, profile, { refs: [made.lines, moneyLines, promises.lines].filter(Boolean).join('\n'), found, mind: [promises.stats, mind].filter(Boolean).join('\n'), mood: `${shownMood(feel.mood, talk.tone)} ${MOOD_FACE[shownMood(feel.mood, talk.tone)]} because: ${feel.why}. (Your own call can differ if his message changes things.)`, style: talk.style, tone: talk.tone, feedback: talk.feedback, selfReview: talk.selfReview, notes, desk }), { json: true, think: big, strong: isBigAsk(text) || correcting || !!media, media: media ? [{ mime: media.mime, data: media.data }] : undefined }), Math.max(4_000, deadline - Date.now()))
    let out: BrainOut
    try {
      out = parseBrain(await ask())
      // It asked for facts it didn't have: look them up, then it answers.
      if (out.need?.length && !out.actions.length) {
        const found: string[] = []
        for (const need of out.need) {
          const local = answerLocal(need, look)
          if (local) {
            step(`Checked ${need.split(/\s+/)[0]}`)
            found.push(local)
            continue
          }
          const [k, from, days] = need.trim().split(/\s+/)
          if (/^calendar$/i.test(k) && calendar && /^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) {
            step('Read your calendar')
            const s0 = new Date(`${from}T00:00:00`)
            const more = await calendar.events(s0.toISOString(), new Date(s0.getTime() + Math.min(14, Math.max(1, Number(days) || 1)) * 86400000).toISOString()).catch(() => [])
            allEvents = [...allEvents, ...more].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i)
            found.push(`Calendar from ${from}: ${more.length} events (in the E-list below).`)
          } else if (/^todoist$/i.test(k) && todoist?.everything) {
            step('Read all your Todoist')
            const all = await todoist.everything().catch(() => null)
            if (all) {
              allTasks = [...allTasks, ...all.tasks].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i)
              areas = all.areas
              found.push(`Todoist: ${all.tasks.length} open tasks (in the T-list below). Areas: ${all.areas.map((a) => a.name).join(', ')}.`)
            }
          } else found.push(`${need}: not available.`)
        }
        made = makeRefs(allEvents, allTasks)
        out = parseBrain(await ask(found.join('\n') || 'Nothing found.'))
      }
      // He's correcting a mistake but it answered with words only: once more, it must fix it.
      if (correcting && !out.actions.length && !out.need?.length) {
        step('Fixing it')
        const again = parseBrain(await ask(undefined, 'Note for the coach: he is correcting something that went wrong. Fix it NOW with actions (delmoney / editmoney / water / sleep / edit …), then confirm in one line. Words alone change nothing.'))
        if (again.actions.length) out = again
      }
    } catch (e) {
      return { ok: false, reply: `The coach couldn't think right now (${(e as Error).message.slice(0, 120)}). Try again in a minute.`, done: [] }
    }
    for (const s of out.steps ?? []) step(s)
    // Its mood: the model's call, else the data's; the reply starts with its face.
    // Below tone 5 a slipping day shows as 🎯 (focused), never an angry face.
    const mood: Mood = shownMood(isMood(out.mood) ? out.mood : feel.mood, talk.tone)
    if (out.reply && talk.tone < 5) out.reply = out.reply.replace(/^\s*[😤😠😡🤬]+\s*/u, '')
    if (out.reply && !/^\p{Extended_Pictographic}/u.test(out.reply)) out.reply = `${MOOD_FACE[mood]} ${out.reply}`
    const refs = made.refs
    const done: string[] = []
    let keyboard: any
    let expense = false
    let acts = out.actions.map(readAction).filter((a): a is BrainAction => !!a)
    // A focus timer starts only when he asked for it now; otherwise it becomes a ▶ button he can tap.
    const askedToStart = /\b(start|go|begin|timer|focus now|let'?s go|incep|încep|porne|start\w*|начн|запуст|поехали)\b/i.test(text)
    if (!askedToStart) {
      for (const a of acts) {
        if (a.kind !== 'focus') continue
        const label = `▶ ${a.minutes} min ${a.subject}`.slice(0, 32)
        out.buttons = [...(out.buttons ?? []).filter((b) => !b.do.startsWith('focus:')), { label, do: `focus:${a.minutes}:${a.subject}` }].slice(0, 3)
      }
      acts = acts.filter((a) => a.kind !== 'focus')
    }
    // Deletes, big moves, rewards and habit ticks run only when HIS message asked for
    // that kind of thing; otherwise a one-tap "Yes, …" button (text in his calendar or
    // Todoist can't make Ben delete or pay anything).
    acts = acts.filter((a) => {
      const risk = riskOf(a as any)
      if (!risk || askedFor(text, risk)) return true
      const what =
        a.kind === 'delevent' ? (made.refs.events.get(a.ref)?.title ?? 'that event') : a.kind === 'deltask' ? (made.refs.tasks.get(a.ref)?.content ?? 'that task') : a.kind === 'delmoney' ? 'that money record' : a.kind === 'shift' ? `${a.refs.length} blocks` : a.kind === 'reward' ? a.title : a.kind === 'habit' ? a.habit : ''
      out.buttons = [...(out.buttons ?? []), confirmButton(risk, what)].slice(0, 3)
      return false
    })
    // Its notebook: a dated line under the right note.
    const noteOps = out.actions.map(readNoteOp).filter((x): x is { title: string; line: string } => !!x)
    if (noteOps.length) {
      const lines = await mirror
        .write((db) => {
          const day = services.services(db).wallet.today()
          return noteOps.map((op) => benNote(db as any, op.title, op.line, day)).filter((x): x is string => !!x)
        })
        .catch(() => [] as string[])
      done.push(...lines)
    }
    // His coaching desk: stakes, study topics, habit stacks, mood.
    if (out.actions.some((l) => /^\s*(stake|study|reviewed|stack|mood)\s*:/i.test(l))) {
      const lines = await mirror
        .write((db) => {
          const svc = services.services(db)
          const said: string[] = []
          for (const l of out.actions) {
            const op = readDeskOp(l, loadDesk(db))
            if (!op) continue
            try {
              said.push(`${op.op === 'stake' ? '💎' : op.op === 'study' || op.op === 'reviewed' ? '📚' : op.op === 'stack' ? '🔗' : '🙂'} ${deskChange(svc, op)}`)
            } catch (e) {
              said.push(`⚠️ ${(e as Error).message}`)
            }
          }
          return said
        })
        .catch(() => [] as string[])
      done.push(...lines)
    }
    // Its long-term notes: goals it tracks, what works, patterns.
    const mindOps = out.actions.map(readMindOp).filter((x): x is MindOp => !!x)
    if (mindOps.length) {
      const lines = await mirror
        .write((db) => {
          let m = loadMind(db)
          const today = services.services(db).wallet.today()
          const said: string[] = []
          for (const op of mindOps) {
            const r = applyMind(m, op, today)
            m = r.mind
            if (r.line) said.push(r.line)
          }
          saveMind(db, m)
          return said
        })
        .catch(() => [] as string[])
      done.push(...lines)
    }
    if (typeof process !== 'undefined' && process.env?.BOT_DEBUG) console.log('brain actions:', out.actions, '→', acts)
    const noCal = () => done.push("⚠️ Google Calendar isn't connected (Settings in the app)")
    const fmtHM = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
    // One undo per thing done (aligned with `done`); null when it can't be undone.
    const undo: (UndoOp | null)[] = done.map(() => null)
    let opNow: UndoOp | null = null
    // Runs the coach's actions; each line in `done` says what really happened.
    const runActs = async (acts: BrainAction[], pfx = '') => {
      for (const [i, a] of acts.entries()) {
        const mark = done.length
        opNow = null
        try {
          if (a.kind === 'event') {
            if (!calendar) {
              noCal()
              continue
            }
            const start = new Date(`${a.day}T${a.time}:00`)
            const ev = await calendar.create({ title: a.title, start: start.toISOString(), end: new Date(start.getTime() + a.minutes * 60000).toISOString(), description: 'Planned with your coach in Life System' })
            if (ev?.id) opNow = { k: 'event', cal: ev.calendarId, id: ev.id }
            done.push(`🗓 In your calendar: ${a.title} · ${a.day.slice(5)} ${a.time} (${a.minutes} min)`)
            continue
          }
          if (a.kind === 'move' || a.kind === 'resize' || a.kind === 'delevent') {
            const ev = refs.events.get(a.ref)
            if (!ev) continue
            if (!calendar?.move || !calendar.remove) {
              noCal()
              continue
            }
            if (a.kind === 'delevent') {
              await calendar.remove(ev.calendarId, ev.id)
              done.push(`🗑 Removed from your calendar: ${ev.title}`)
              continue
            }
            const len = Date.parse(ev.end) - Date.parse(ev.start)
            const start = a.kind === 'move' ? new Date(`${a.day}T${a.time}:00`).toISOString() : ev.start
            const end = new Date(Date.parse(start) + (a.kind === 'resize' ? a.minutes * 60000 : len)).toISOString()
            await calendar.move(ev.calendarId, ev.id, start, end)
            done.push(a.kind === 'move' ? `🗓 Moved: ${ev.title} → ${a.day.slice(5)} ${a.time}` : `🗓 ${ev.title}: now ${a.minutes} min (${fmtHM(start)}–${fmtHM(end)})`)
            continue
          }
          if (a.kind === 'shift') {
            if (!calendar?.move) {
              noCal()
              continue
            }
            const list = a.refs.map((r) => refs.events.get(r)).filter((x): x is CalEvent => !!x)
            for (const ev of list) await calendar.move(ev.calendarId, ev.id, new Date(Date.parse(ev.start) + a.minutes * 60000).toISOString(), new Date(Date.parse(ev.end) + a.minutes * 60000).toISOString())
            if (list.length) done.push(`🗓 Shifted ${list.length} block${list.length === 1 ? '' : 's'} by ${a.minutes > 0 ? '+' : ''}${a.minutes} min`)
            continue
          }
          if (a.kind === 'edit' || a.kind === 'taskmove' || a.kind === 'done' || a.kind === 'star' || a.kind === 'deltask') {
            const t = refs.tasks.get(a.ref)
            if (!t || !todoist) continue
            if (a.kind === 'done') {
              await todoist.close(t.id)
              const paid = await mirror.write((db) => payTodoist(services.services(db), [{ id: t.id, content: t.content, completedAt: new Date().toISOString() } as any])).catch(() => 0)
              done.push(`✅ Done in Todoist: ${t.content}${paid ? ' · +5' : ''}`)
            } else if (a.kind === 'deltask' && todoist.remove) {
              await todoist.remove(t.id)
              done.push(`🗑 Deleted from Todoist: ${t.content}`)
            } else if (a.kind === 'star' && todoist.update) {
              const labels = a.on ? [...new Set([...(t.labels ?? []), 'today'])] : (t.labels ?? []).filter((l) => l !== 'today')
              await todoist.update(t.id, { labels, ...(a.on && !(t.due && t.due <= new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)) ? { due: 'today' } : {}) })
              done.push(a.on ? `⭐ Must-do today: ${t.content}` : `☆ No longer a must-do: ${t.content}`)
            } else if (a.kind === 'edit' && todoist.update) {
              await todoist.update(t.id, { content: a.title, priority: a.priority, due: a.due, description: a.details })
              done.push(`✏️ Todoist: ${a.title ?? t.content}${a.priority ? ` · P${5 - a.priority}` : ''}${a.due ? ` · ${a.due}` : ''}`)
            } else if (a.kind === 'taskmove' && todoist.move) {
              if (!areas.length && todoist.everything) areas = (await todoist.everything().catch(() => null))?.areas ?? []
              const want = a.area.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim()
              const area = areas.find((x) => x.name.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim() === want) ?? areas.find((x) => x.name.toLowerCase().includes(want))
              if (!area) {
                done.push(`⚠️ No Todoist area called "${a.area}"`)
                continue
              }
              await todoist.move(t.id, area.key)
              done.push(`📂 ${t.content} → ${area.name}`)
            }
            continue
          }
          if (a.kind === 'remind' || a.kind === 'checkin') {
            const at = a.kind === 'remind' ? new Date(`${a.day}T${a.time}:00`) : new Date(Date.now() + a.minutes * 60000)
            if (at.getTime() < Date.now() - 60000) continue
            await mirror.write((db) => {
              let list: Reminder[] = []
              try {
                list = JSON.parse(getSetting(db as any, REMINDERS) || '[]')
              } catch {
                list = []
              }
              const next = addReminder(list, { at: at.toISOString(), text: a.text, kind: a.kind, follow: a.kind === 'checkin' })
              opNow = { k: 'remind', id: next[next.length - 1].id }
              setSetting(db as any, REMINDERS, JSON.stringify(next))
            })
            done.push(a.kind === 'remind' ? `⏰ Reminder ${fmtHM(at.toISOString())}${at.toDateString() !== new Date().toDateString() ? ` (${at.toISOString().slice(5, 10)})` : ''}: ${a.text}` : `⏰ I'll check on you at ${fmtHM(at.toISOString())} (and keep asking until you answer)`)
            continue
          }
          if (a.kind === 'book') {
            const plans = await rhythm.goalPlans()
            const want = a.goal.toLowerCase().trim()
            const ids = /^all$/.test(want) ? undefined : plans.filter((p) => p.title.toLowerCase().includes(want) || want.includes(p.title.toLowerCase()) || p.subject.toLowerCase() === want).map((p) => p.goalId)
            if (ids && !ids.length) {
              done.push(`⚠️ No goal called "${a.goal}"`)
              continue
            }
            done.push(...(await rhythm.bookGoals(ids)).lines)
            continue
          }
          if (a.kind === 'promise') {
            const id = promises.refs.get(a.ref)
            if (!id) continue
            await mirror.write((db) => {
              let list: Reminder[] = []
              try {
                list = JSON.parse(getSetting(db as any, REMINDERS) || '[]')
              } catch {
                list = []
              }
              setSetting(db as any, REMINDERS, JSON.stringify(setOutcome(list, id, a.outcome)))
            })
            await rhythm.countPromise(await services.read((sv) => sv.wallet.today()), a.outcome).catch(() => null)
            done.push(a.outcome === 'kept' ? '✅ Promise kept' : '❌ Promise broken (counted)')
            continue
          }
          if (a.kind === 'delmoney' || a.kind === 'editmoney') {
            const id = moneyRefs.get(a.ref)
            if (!id) continue
            const line = await mirror.write((db) => {
              if (a.kind === 'delmoney') {
                const what = deleteMoney(db as any, id)
                if (!what) return '⚠️ That money record is already gone'
                const life = takeLink(db, id)
                if (life) {
                  try {
                    services.services(db).money.deleteExpense(life)
                  } catch {
                    /* already gone */
                  }
                }
                return `🗑 Deleted from Finance Helper: ${what}`
              }
              const r = editMoney(db as any, id, a)
              return r.ok ? `✏️ Money record fixed: ${r.text}` : `⚠️ ${r.text}`
            })
            done.push(line)
            expense = true
            continue
          }
          if (a.kind === 'workout') {
            const line = await mirror.write((db) => {
              const svc = services.services(db)
              const today = svc.wallet.today()
              if (a.day > today || a.day < addDays(today, -60)) return `⚠️ ${a.day} is out of range (last 60 days only)`
              if (db.prepare('SELECT 1 FROM workouts WHERE day = ?').get(a.day)) return `✅ ${a.day} already has a workout`
              svc.body.logWorkout({ title: a.title, day: a.day, items: [{ exerciseId: 'ex_workout', name: a.title, amount: 1, unit: 'sets' }], note: 'Logged by Ben (past day)' } as any)
              const b = svc.body.state()
              return `💪 Workout logged for ${a.day} · streak ${b.streak}`
            })
            done.push(line)
            continue
          }
          if (a.kind === 'style') {
            const st = await mirror.write((db) => saveStyle(db, { ...(a.length ? { length: a.length } : {}), ...(a.tone ? { tone: a.tone } : {}) }))
            done.push(`🎚 Style: ${st.length}, tone ${st.tone}/5`)
            continue
          }
          if (a.kind === 'exercise' || a.kind === 'noexercise') {
            const line = await mirror.write((db) => {
              const day = sportToday()
              const st = sportState(db) ?? defaultSport(day)
              const r = a.kind === 'exercise' ? setExercise(st, day, a.name, a.target, a.unit) : removeExercise(st, day, a.name)
              if (!r.line) return a.kind === 'exercise' ? `⚠️ Give "${a.name}" a daily target` : `⚠️ No exercise "${a.name}" on your list`
              setSetting(db as any, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: r.st }))
              return r.line
            })
            done.push(line)
            continue
          }
          if (a.kind === 'water' || a.kind === 'reps') {
            const line = await mirror.write((db) => {
              const day = sportToday()
              const st = sportState(db) ?? defaultSport(day)
              const save = (next: any) => setSetting(db as any, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: next }))
              if (a.kind === 'water') {
                const next = addWater(st, a.ml, day)
                save(next)
                opNow = { k: 'water', ml: -a.ml }
                const v = sharedView(next, day)
                return `💧 ${a.ml > 0 ? '+' : ''}${a.ml} ml · ${(v.water.ml / 1000).toFixed(2).replace(/0$/, '')} of ${(v.water.target / 1000).toFixed(1)} L today`
              }
              const r = addReps(st, a.exercise, a.amount, day)
              if (!r) return `⚠️ No "${a.exercise}" on your Sport Track checklist`
              save(r.st)
              opNow = { k: 'reps', ex: a.exercise, amount: -a.amount }
              // Real reps also count as a workout (streak and points), like "30 pushups".
              if (a.amount > 0) {
                const svc = services.services(db)
                svc.body.logWorkout({ title: `${r.exercise.name} (+${a.amount})`, items: [{ exerciseId: r.exercise.name.toLowerCase().replace(/\s+/g, '_'), name: r.exercise.name, amount: a.amount, unit: 'reps' }], note: 'Logged by the coach' })
              }
              return `💪 ${r.exercise.name} ${a.amount > 0 ? '+' : ''}${a.amount} · ${r.exercise.done}${r.exercise.target ? `/${r.exercise.target}` : ''} today`
            })
            done.push(line)
            continue
          }
          if (a.kind === 'sleep') {
            const line = await mirror.write((db) => {
              const svc = services.services(db)
              const said: string[] = []
              if (a.wake) {
                const r = svc.sleep.setWake(a.day, a.wake)
                said.push(`up ${r.log.wakeTime}${r.log.onTime ? ' (on time)' : ''}`)
              }
              if (a.bed) {
                // The bedtime belongs to that morning's row (the night before it).
                const row = db.prepare('SELECT 1 FROM sleep_logs WHERE day = ?').get(a.day)
                if (!row) svc.sleep.setWake(a.day, a.wake ?? '07:00')
                const target = svc.sleep.bedtimeTarget()
                const toMin = (t: string) => {
                  const [h, m] = t.split(':').map(Number)
                  return (h < 12 ? h + 24 : h) * 60 + m
                }
                const onTime = toMin(a.bed) <= toMin(target)
                db.prepare('UPDATE sleep_logs SET bed_time = ?, bed_target = ?, bed_on_time = ? WHERE day = ?').run(a.bed, target, onTime ? 1 : 0, a.day)
                said.push(`bed ${a.bed}${onTime ? ' (on time)' : ' (late)'}`)
              }
              if (a.quality) {
                svc.sleep.setQuality(a.day, a.quality)
                said.push(`slept ${a.quality}/5`)
              }
              return said.length ? `😴 Sleep ${a.day.slice(5)}: ${said.join(', ')}` : null
            })
            if (line) done.push(line)
            continue
          }
          if (a.kind === 'habit' || a.kind === 'reward' || a.kind === 'week' || a.kind === 'bigdone') {
            const line = await mirror.write((db) => {
              const svc = services.services(db)
              if (a.kind === 'habit') {
                const already = (svc.wallet.summary().todayRules ?? []).includes(a.habit === 'oath' ? 'discipline.oath' : a.habit === 'clean' ? 'discipline.clean_day' : 'face.routine_done')
                if (already) return null
                if (a.habit === 'oath') svc.discipline.oath()
                else if (a.habit === 'clean') svc.discipline.checkIn()
                else svc.wallet.award('face.routine_done', 'Ticked by the coach')
                return `✅ Habit: ${a.habit === 'oath' ? 'morning oath' : a.habit === 'clean' ? 'clean-day check-in' : 'skincare'}`
              }
              if (a.kind === 'reward') {
                svc.shop.save({ title: a.title, price: a.points, tier: 'bronze', realCost: a.cost, pinned: false, note: 'Added by your coach', currency: 'MDL' })
                return `🎁 New reward: ${a.title} · ${a.points} points`
              }
              if (a.kind === 'bigdone') {
                const plan = svc.weekPlan.active()
                if (!plan?.big3[a.index] || plan.big3[a.index].done) return null
                svc.weekPlan.toggle(a.index)
                return `✅ Week task done: ${plan.big3[a.index].text}`
              }
              const cur = svc.weekPlan.active()
              const big3 = a.big3?.length ? a.big3.map((text) => ({ text, done: cur?.big3.find((b) => b.text.toLowerCase() === text.toLowerCase())?.done ?? false })) : cur?.big3 ?? []
              const plan = svc.weekPlan.save({ ...(cur ?? {}), focus: (a.focus ?? cur?.focus ?? 'focus') as any, note: a.note ?? cur?.note ?? '', big3 })
              const names: Record<string, string> = { focus: 'focus time', wake: 'wake-ups', sport: 'training', clean: 'clean days', todoist: 'tasks', spend: 'spending', mustdo: 'must-dos' }
              return `🗓 Week plan: ${names[plan.focus] ?? plan.focus}${plan.note ? ` ("${plan.note}")` : ''} · ${plan.big3.map((b) => b.text).join(' / ')}`
            })
            if (line) done.push(line)
            continue
          }
          if (a.kind === 'task') {
            if (!todoist) continue
            const t = await todoist.quickAdd(a.text)
            if (t?.id) opNow = { k: 'task', id: t.id }
            done.push(`➕ Todoist: ${t.content || a.text}${t.section ? ` · ${t.section}` : ''}${t.due ? ` (${t.due})` : ''}`)
            continue
          }
          const line = await mirror.write((db) => {
            const svc = services.services(db)
            if (a.kind === 'log') {
              const r = applyText(db, svc, a.text, `${key}:a${pfx}${i}`)
              if (r.unknown) return null
              if (r.keyboard) keyboard = r.keyboard
              if (r.expense) expense = true
              // A money record can be undone (its id is on its Undo button).
              const txId = ((r.keyboard?.inline_keyboard ?? []) as any[][]).flat().map((b: any) => String(b.callback_data ?? '')).find((d) => d.startsWith('fu|'))?.split('|')[1]
              if (txId) opNow = { k: 'money', id: txId }
              return `✅ Logged: ${a.text}`
            }
            if (a.kind === 'mustdo') {
              const p = svc.focus.plan(svc.wallet.today())
              if (p.items.some((x) => x.text.toLowerCase() === a.text.toLowerCase())) return null
              svc.focus.setPlan([...p.items.map((x) => x.text), a.text])
              opNow = { k: 'mustdo', text: a.text }
              return `📝 Must-do added: ${a.text}${todoist ? ' (⭐ in Todoist)' : ''}`
            }
            if (a.kind === 'focus') {
              svc.focus.start(a.subject, a.minutes)
              opNow = { k: 'focus' }
              keyboard = STOP_KEYBOARD
              return `⏱ Focus started: ${a.subject} · ${a.minutes} min`
            }
            if (a.kind === 'fun') {
              const r = svc.focus.fun(a.minutes, a.what)
              return `🎮 ${a.minutes} min of ${a.what}: −${r.cost} points (left ${r.balance})`
            }
            if (a.kind !== 'goal') return null
            svc.focus.saveGoal({ title: a.title, subject: a.subject, deadline: a.deadline, hours: a.hours })
            return `🎯 Goal: ${a.title} · ${a.hours}h by ${a.deadline}`
          })
          if (line) done.push(line)
          // One list: a new must-do is also a Todoist task due today, starred ⭐ (@today).
          if (line && a.kind === 'mustdo' && todoist) await todoist.quickAdd(`${a.text} today @today`).catch(() => null)
        } catch (e) {
          done.push(`⚠️ ${(e as Error).message}`)
        } finally {
          while (undo.length < done.length) undo.push(undo.length === mark && !String(done[mark] ?? '').startsWith('⚠️') ? opNow : null)
        }
      }
    }
    await runActs(acts)
    // Act → check → fix: when something failed, the coach sees the results and
    // tries once more (another time, the right item), or says plainly what didn't work.
    if (done.some((d) => d.startsWith('⚠️'))) {
      step('Fixing what failed')
      try {
        const fix = parseBrain(
          await ask(undefined, `RESULTS of your actions just now:\n${done.join('\n')}\nSome failed (⚠️). Fix them now with different actions if you can (another time, the right E/T/M ref, a valid day), without repeating what already worked. Your new reply replaces the old one: say what is done and, honestly, what is not.`)
        )
        const again = fix.actions.map(readAction).filter((a): a is BrainAction => !!a && a.kind !== 'focus')
        if (again.length) await runActs(again, 'f')
        if (fix.reply) out.reply = /^\p{Extended_Pictographic}/u.test(fix.reply) ? fix.reply : `${MOOD_FACE[mood]} ${fix.reply}`
      } catch {
        /* keep the first answer and its ⚠️ lines */
      }
    }
    if (expense) onExpense?.()
    const at = new Date().toISOString()
    await mirror
      .write((db) => {
        saveMemory(
          db,
          updateMemory(loadMemory(db), {
            facts: out.remember,
            turns: [
              { role: 'me', bot: persona, text: media ? `[${media.kind}] ${text}`.trim() : text, at },
              { role: 'coach', bot: persona, text: [out.reply, ...(done.length ? done : ['(nothing saved)'])].join(' | '), at }
            ]
          })
        )
        appendLog(db, [
          { role: 'me', bot: persona, via, text: media ? `[${media.kind === 'voice' ? 'voice note' : 'photo'}] ${text}`.trim() : text, at },
          { role: 'coach', bot: persona, via, text: out.reply || 'Got it.', done, mood, at, ...(undo.some(Boolean) ? { undo } : {}), ...(out.chips?.length ? { chips: out.chips } : {}), ...(out.buttons?.length ? { buttons: out.buttons } : {}), ...(out.show?.length ? { show: out.show } : {}) }
        ])
      })
      .catch(() => null)
    processed++
    return { ok: true, reply: out.reply || 'Got it.', done, keyboard, steps: out.steps, mood, at, undo, chips: out.chips, buttons: out.buttons, show: out.show }
  }

  /**
   * Takes back what the coach did in one reply (`at`): all of it, or one line.
   * Each line once; the log remembers what was undone.
   */
  async function undoReply(at: string, index?: number): Promise<{ ok: boolean; lines: string[] }> {
    const entry = await mirror.read((db) => loadLog(db).find((e) => e.role === 'coach' && e.at === at) ?? null)
    if (!entry?.undo) return { ok: false, lines: ['Nothing to undo there'] }
    const idx = entry.undo.map((op, k) => (op && !entry.undone?.[k] && (index == null || index === k) ? k : -1)).filter((k) => k >= 0)
    if (!idx.length) return { ok: false, lines: ['Already undone'] }
    const lines: string[] = []
    const ok: number[] = []
    for (const k of idx) {
      const op = entry.undo[k]!
      try {
        if (op.k === 'event') {
          if (!calendar?.remove) throw new Error('Calendar not connected')
          await calendar.remove(op.cal, op.id)
          lines.push('↩ Block removed from your calendar')
        } else if (op.k === 'task') {
          if (!todoist?.remove) throw new Error('Todoist not connected')
          await todoist.remove(op.id)
          lines.push('↩ Todoist task removed')
        } else {
          const line = await mirror.write((db) => {
            const svc = services.services(db)
            if (op.k === 'water' || op.k === 'reps') {
              const st = sportState(db)
              if (!st) return '⚠️ Sport Track data is gone'
              const day = sportToday()
              if (op.k === 'water') {
                setSetting(db as any, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: addWater(st, op.ml, day) }))
                return `↩ Water ${op.ml > 0 ? '+' : ''}${op.ml} ml`
              }
              const r = addReps(st, op.ex, op.amount, day)
              if (!r) return '⚠️ Exercise not found'
              setSetting(db as any, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: r.st }))
              return `↩ ${r.exercise.name} back to ${r.exercise.done}`
            }
            if (op.k === 'money') {
              const what = deleteMoney(db as any, op.id)
              const life = takeLink(db, op.id)
              if (life) {
                try {
                  svc.money.deleteExpense(life)
                } catch {
                  /* already gone */
                }
              }
              return what ? `↩ Removed: ${what}` : '⚠️ That money record is already gone'
            }
            if (op.k === 'remind') {
              let list: Reminder[] = []
              try {
                list = JSON.parse(getSetting(db as any, REMINDERS) || '[]')
              } catch {
                list = []
              }
              setSetting(db as any, REMINDERS, JSON.stringify(list.filter((r) => r.id !== op.id)))
              return '↩ Reminder cancelled'
            }
            if (op.k === 'mustdo') {
              const p = svc.focus.plan(svc.wallet.today())
              const rest = p.items.map((x) => x.text).filter((t) => t.toLowerCase() !== op.text.toLowerCase())
              if (!rest.length) return '⚠️ It is your only must-do: tick it or replace it'
              svc.focus.setPlan(rest)
              return `↩ Must-do removed: ${op.text}`
            }
            svc.focus.cancel()
            return '↩ Focus timer cancelled'
          })
          lines.push(line)
          if (line.startsWith('⚠️')) continue
        }
        ok.push(k)
      } catch (e) {
        lines.push(`⚠️ ${(e as Error).message}`)
      }
    }
    if (ok.length)
      await mirror.write((db) => {
        const log = loadLog(db)
        const e = log.find((x) => x.role === 'coach' && x.at === at)
        if (e) {
          const undone = e.undone ?? []
          for (const k of ok) undone[k] = true
          e.undone = undone
          saveLog(db, log)
        }
      })
    if (ok.length) onExpense?.()
    return { ok: ok.length > 0, lines }
  }

  /** The mini-widgets as text for Telegram ("Focus 7 days: ▁▃▅▇▂·▄ 4.2h"). */
  async function widgetText(show: string[]): Promise<string> {
    const st = await mirror.read((db) => coachStatus(services.services(db) as any))
    const out: string[] = []
    for (const w of show) {
      if (w === 'focus-week') out.push(`📊 Focus 7 days: <code>${sparkline(st.week.map((d) => d.min))}</code> ${(st.week.reduce((t, d) => t + d.min, 0) / 60).toFixed(1)}h`)
      if (w === 'goals') out.push(...st.goals.map((g) => `🎯 ${esc(g.title)}: ${g.pct}% · ${g.perDayMin} min/day · ${g.daysLeft}d left`))
      if (w === 'plan') out.push(`☀️ Plan: ${st.plan.status === 'none' ? 'not made yet' : `${st.plan.status}, ${st.plan.mustdos} must-dos, ${st.plan.blocks} blocks`}`)
      if (w === 'water' && st.today.waterTarget) out.push(`💧 ${(st.today.waterMl / 1000).toFixed(1)} of ${(st.today.waterTarget / 1000).toFixed(1)} L`)
      if (w === 'mustdos') out.push(...st.mustdos.map((m) => `${m.done ? '✅' : '⬜'} ${esc(m.text)}`))
      if (w === 'promises') out.push(`🤝 Promises 7 days: ${st.promises.kept} kept, ${st.promises.missed} missed${st.promises.awaiting.length ? ` · waiting: ${esc(st.promises.awaiting[st.promises.awaiting.length - 1])}` : ''}`)
    }
    return out.join('\n')
  }

  async function handleBrain(botId: string, update: any, cfg: BotBridgeConfig, text: string, key: string, media?: { kind: 'voice' | 'photo'; mime: string; data: string }): Promise<string | null> {
    const chat = String(update.message?.chat?.id ?? '')
    void tg(update.__token, 'sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => null)
    const r = await think(personaFor(botId, cfg), text, key, media)
    const reply = r.ok ? [esc(r.reply), r.done.length ? `\n${r.done.map(esc).join('\n')}` : ''].join('\n').trim() : `⚠️ ${esc(r.reply)} Or use a command like <code>/today</code>.`
    addLog(text || `[${media?.kind}]`, chat, r.ok, reply)
    // Buttons the coach attached (one tap instead of typing), then ↩ Undo.
    const rows = [
      ...(telegramKeyboard(r.buttons ?? [])?.inline_keyboard ?? []),
      ...(r.at && r.undo?.some(Boolean) ? [[{ text: '↩ Undo', callback_data: `cu|${Date.parse(r.at)}` }]] : []),
      // Feedback: Ben learns what you like.
      ...(r.ok && r.at ? [[{ text: '👍', callback_data: `fb|${Date.parse(r.at)}|up` }, { text: '👎', callback_data: `fb|${Date.parse(r.at)}|down` }, { text: '📏 Too long', callback_data: `fb|${Date.parse(r.at)}|long` }, { text: '❌ Wrong', callback_data: `fb|${Date.parse(r.at)}|wrong` }]] : [])
    ]
    const markup = r.keyboard ?? (rows.length ? { inline_keyboard: rows } : null)
    const widgets = r.ok && r.show?.length ? await widgetText(r.show).catch(() => '') : ''
    const full = widgets ? `${reply}\n\n${widgets}` : reply
    await tg(update.__token, 'sendMessage', { chat_id: chat, text: full, parse_mode: 'HTML', ...(markup ? { reply_markup: markup } : {}) }).catch(() => null)
    return full
  }

  /** One line that turns your evening note into a lesson for tomorrow (and the coach's memory). */
  async function lessonOfDay(token: string, chat: string, botId: string, cfg: BotBridgeConfig, note: string): Promise<void> {
    const ctx = await mirror.read((db) => {
      const f = services.services(db).focus.state()
      return `Focus today ${hm(f.todayMin)}. Must-dos: ${f.plan.items.map((x) => `${x.done ? '[done]' : '[open]'} ${x.text}`).join('; ') || 'none'}. Got in the way: ${f.plan.reasons.join(', ') || 'nothing marked'}.`
    })
    const out = parseBrain(
      await ai!(
        `You are Victor's coach. Here is his day and his evening note. Write ONE short lesson for tomorrow (max 25 words, concrete, kind, in the language of his note) as "reply", and the same lesson as one item in "remember" starting with "Lesson ${new Date().toISOString().slice(5, 10)}:". Answer only JSON {"reply": string, "actions": [], "remember": string[]}.

Day: ${ctx}
His note: ${note}`,
        { json: true }
      )
    )
    if (!out.reply) return
    await mirror.write((db) => saveMemory(db, updateMemory(loadMemory(db), { facts: out.remember.slice(0, 1), turns: [{ role: 'me', bot: personaFor(botId, cfg), text: `[evening] ${note}`, at: new Date().toISOString() }, { role: 'coach', bot: personaFor(botId, cfg), text: `Lesson: ${out.reply}`, at: new Date().toISOString() }] })))
    await tg(token, 'sendMessage', { chat_id: chat, text: `💡 <b>Lesson for tomorrow:</b> ${esc(out.reply)}`, parse_mode: 'HTML' })
  }

  async function handle(botId: string, update: any, cfg: BotBridgeConfig): Promise<string | null> {
    if (update.callback_query) return handleButton(botId, update, cfg)
    const viaTodoist = await handleTodoist(botId, update, cfg)
    if (viaTodoist !== undefined) return viaTodoist
    const key = `${botId}:${update.update_id}`
    let text = String(update.message?.text ?? update.message?.caption ?? '').trim()
    const said = text
    const chat = String(update.message?.chat?.id ?? '')
    // A reply to the morning question is today's plan.
    const asked = String(update.message?.reply_to_message?.text ?? '')
    // Answers to the rhythm's questions: change today's plan, tomorrow's top 3, next week's big 3.
    if (text && !text.startsWith('/') && chat && (asked.includes(EDIT_ASK) || asked.includes(TOP3_ASK) || asked.includes(WEEK_ASK))) {
      if (!(await markSeen(key))) return null
      if (!allowed(cfg, chat)) return null
      try {
        if (asked.includes(EDIT_ASK)) {
          void tg(update.__token, 'sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => null)
          return await sendProposal(update.__token, chat, text)
        }
        const reply = asked.includes(TOP3_ASK)
          ? `✅ Tomorrow's top 3:\n${(await rhythm.setTop3(text)).map((t, i) => `${i + 1}. ${esc(t)}`).join('\n')}`
          : `✅ ${esc(await rhythm.applyWeekly(text))}`
        await tg(update.__token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML' }).catch(() => null)
        return reply
      } catch (e) {
        const reply = `⚠️ ${esc((e as Error).message)}`
        await tg(update.__token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML' }).catch(() => null)
        return reply
      }
    }
    const prompted = !!text && !text.startsWith('/') && (asked.includes(PLAN_ASK) || /Evening review|One thing to change next week/.test(asked))
    if (text && !text.startsWith('/') && asked.includes(PLAN_ASK)) text = `/plan ${text}`
    // A reply to the evening review or the weekly report is your note for the day.
    else if (text && !text.startsWith('/') && /Evening review|One thing to change next week/.test(asked)) text = `/review ${asked.includes('next week') ? 'Next week: ' : ''}${text}`
    // Free text (not a quick log), a voice note or a photo: the coach's brain.
    const media = update.message?.voice ?? update.message?.audio ?? (update.message?.photo ? update.message.photo[update.message.photo.length - 1] : null)
    if (ai && chat && (media || (text && !prompted && !isSimpleLog(text)))) {
      if (!(await markSeen(key))) return null
      if (!allowed(cfg, chat)) {
        const reply = `⛔ This chat (<code>${esc(chat)}</code>) isn't allowed.`
        await tg(update.__token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML' }).catch(() => null)
        return reply
      }
      let file: { kind: 'voice' | 'photo'; mime: string; data: string } | undefined
      if (media) {
        file = (await downloadFile(update.__token, media.file_id, update.message?.photo ? 'photo' : 'voice')) ?? undefined
        if (!file) {
          const reply = '⚠️ I couldn\'t open that file. Try again, or type it.'
          await tg(update.__token, 'sendMessage', { chat_id: chat, text: reply }).catch(() => null)
          return reply
        }
      }
      return handleBrain(botId, update, cfg, text, key, file)
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await mirror.write((db) => {
          if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return { skip: true as const }
          db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
          if (!text || !chat) return { skip: true as const }
          if (!allowed(cfg, chat)) return { skip: false as const, reply: `⛔ This chat (<code>${esc(chat)}</code>) isn't allowed.`, ok: false }
          // A command can fail its own rule (already checked in, daily cap…):
          // the message is still marked seen and the reply says why.
          const svc = services.services(db)
          try {
            const r = applyText(db, svc, text, key)
            return { skip: false as const, reply: r.reply, keyboard: r.keyboard, ok: true, sport: r.sport, expense: !!r.expense, unknown: !!r.unknown }
          } catch (e) {
            currentDb = null
            return { skip: false as const, reply: `⚠️ ${esc((e as Error).message)}`, ok: false }
          }
        })
        if (out.skip) return null
        // Not understood by the rules: the coach's brain tries (already marked seen).
        if (ai && 'unknown' in out && out.unknown && !text.startsWith('/')) return handleBrain(botId, update, cfg, text, key)
        processed++
        if (out.ok && 'sport' in out && out.sport) {
          const prog = addRepsToSportTrack(out.sport.name, out.sport.amount)
          if (prog && prog.target) out.reply += `\n\n📊 Today: <b>${prog.done}/${prog.target}</b> (${Math.round((prog.done / prog.target) * 100)}%)`
        }
        if (out.ok && 'expense' in out && out.expense) onExpense?.()
        addLog(text, chat, out.ok, out.reply)
        const keyboard = 'keyboard' in out ? out.keyboard : undefined
        await tg(update.__token, 'sendMessage', { chat_id: chat, text: out.reply, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) }).catch(() => null)
        // Your evening reply becomes a lesson the coach remembers.
        if (ai && out.ok && prompted && /Evening review/.test(asked)) await lessonOfDay(update.__token, chat, botId, cfg, said).catch(() => null)
        await flushFocus()
        // Up (Telegram /wake): the plan question comes now. Plan sent: blocks for it in your free time.
        if (server && out.ok && /^\/wake(@\w+)?$/i.test(text)) await morningAfterWake(update.__token, chat).catch(() => null)
        if (out.ok && prompted && asked.includes(PLAN_ASK)) await offerBlocks(update.__token, chat).catch(() => null)
        return out.reply
      } catch (e) {
        if (e instanceof MirrorError && attempt === 0) continue // reloaded: try once more
        throw e
      }
    }
    return null
  }

  async function pollOnce(): Promise<{ processedCount: number; replies: string[] }> {
    if (running) return running
    running = (async () => {
      const cfg = await config()
      // The server answers every bot 24/7; reading them here too would fail.
      if (cfg.serverBots && !server) {
        lastPollAt = new Date().toISOString()
        lastError = null
        return { processedCount: 0, replies: [] }
      }
      // The Finance bot too: Finance Helper only reads it while it runs on
      // the PC, and its money messages ("45 lunch") reach Finance Helper
      // through the inbox either way.
      const tokens = [cfg.megaBotToken, cfg.sportBotToken, cfg.financeBotToken, cfg.manBotToken, cfg.botToken, cfg.wakyBotToken, cfg.plannerBotToken, cfg.coachBotToken]
        .filter((t): t is string => !!t && t.includes(':'))
        .filter((t) => !(cfg.skipBotIds ?? []).includes(t.split(':')[0]))
        .filter((t, i, all) => all.indexOf(t) === i)
      const replies: string[] = []
      const before = processed
      lastPollAt = new Date().toISOString()
      for (const token of tokens) {
        const botId = token.split(':')[0]
        const offsetKey = `tg_offset_${botId}`
        const offset = Number(store?.getItem(offsetKey) || 0) || 0
        try {
          const data = await tg(token, `getUpdates?offset=${offset}&limit=25&timeout=0`)
          if (!data?.ok) {
            const why = String(data?.description ?? 'no answer')
            // The Mega bot used to send its messages to the old Cloudflare
            // worker: take it back (waiting messages are kept) and read it
            // on the next round.
            if (/webhook/i.test(why) && token === cfg.megaBotToken) {
              const freed = await tg(token, 'deleteWebhook?drop_pending_updates=false').catch(() => null)
              if (freed?.ok) continue
            }
            lastError = /webhook/i.test(why)
              ? `Bot ${botId} sends its messages to a webhook (e.g. the Cloudflare worker), so it can't be read here. Remove the webhook to use it.`
              : `Bot ${botId}: ${why}`
            continue
          }
          for (const u of data.result ?? []) {
            u.__token = token
            const reply = await handle(botId, u, cfg)
            if (reply) replies.push(reply)
            // Saved after each message: an error later doesn't replay earlier ones.
            store?.setItem(offsetKey, String(u.update_id + 1))
          }
          lastError = null
        } catch (e) {
          lastError = `Bot ${botId}: ${(e as Error).message}`
        }
      }
      if (!pruned && tokens.length) {
        pruned = true
        const cutoff = addDays(new Date().toISOString().slice(0, 10), -14)
        mirror.write((db) => db.prepare('DELETE FROM bot_seen_updates WHERE ts < ?').run(cutoff)).catch(() => {})
      }
      return { processedCount: processed - before, replies }
    })().finally(() => {
      running = null
    })
    return running
  }

  /** One update Telegram sent to the server (webhook) for the bot with this token. */
  async function handleUpdate(token: string, update: any): Promise<string | null> {
    const cfg = await config()
    return handle(token.split(':')[0], { ...update, __token: token }, cfg)
  }

  /**
   * The island's command bar: the bots' rules only (no AI, instant, offline):
   * "spent 40 taxi", "water 500", "30 pushups", "bed 23:40"… Not understood →
   * { unknown: true } and the caller asks Ben.
   */
  async function quick(text: string): Promise<{ ok: boolean; reply: string } | { unknown: true }> {
    const t = text.trim()
    if (!t || t.length > 200) return { unknown: true }
    const key = `quick:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
    const out = await mirror.write((db) => {
      const svc = services.services(db)
      try {
        return applyText(db, svc, t, key) as RunOut & { error?: boolean }
      } catch (e) {
        currentDb = null
        return { reply: `⚠️ ${esc((e as Error).message)}`, error: true } as RunOut & { error?: boolean }
      }
    })
    if (out.unknown) return { unknown: true }
    if (out.sport) addRepsToSportTrack(out.sport.name, out.sport.amount)
    if (out.expense) onExpense?.()
    return { ok: !out.error, reply: plain(out.reply).replace(/\n{2,}/g, '\n').trim() }
  }

  return {
    quick,
    pollOnce,
    handleUpdate,
    /** The app's Coach page: the same brain and memory as the bots. */
    think: (text: string, key = `app:${Date.now()}`, onStep?: (s: string) => void, media?: { kind: 'voice' | 'photo'; mime: string; data: string }) => think('mega', text, key, media, 'app', onStep),
    /** The daily rhythm (morning plan, reviews), for the tick and the app. */
    rhythm,
    /** Undo what the coach did in one reply (all, or one line). */
    undoReply,
    config,
    saveConfig: async (patch: Partial<BotBridgeConfig>): Promise<BotBridgeConfig> => {
      const next: BotBridgeConfig = { ...(await config()), ...patch }
      delete next.serverBots // comes from the server each time, never saved
      delete next.skipBotIds
      const kept = stripTokens(next)
      await mirror.write((db) => setSetting(db as any, 'bot_bridge_config', JSON.stringify(kept)))
      try {
        store?.setItem('bot_bridge_config', JSON.stringify(kept))
      } catch {
        /* fine */
      }
      return next
    },
    status: async () => {
      const cfg = await config()
      return {
        polling,
        enabled: !!cfg.enabled,
        configured: !!(cfg.megaBotToken || cfg.sportBotToken || cfg.botToken || cfg.financeBotToken || cfg.manBotToken),
        lastPollAt,
        lastError,
        processedCount: processed
      }
    },
    logs: async (): Promise<BotLogEntry[]> => {
      try {
        return (JSON.parse(store?.getItem(LOGS_KEY) || '[]') as BotLogEntry[]).slice(-50).reverse()
      } catch {
        return []
      }
    },
    clearLogs: async () => {
      store?.removeItem(LOGS_KEY)
    },
    test: async (botKey?: string): Promise<{ ok: boolean; error?: string }> => {
      const cfg = await config()
      const pick: Record<string, [string | undefined, string | undefined, string]> = {
        finance: [cfg.financeBotToken, cfg.financeBotChatId, 'Finance Bot'],
        man: [cfg.manBotToken, cfg.manBotChatId, 'MAN Bot'],
        waky: [cfg.wakyBotToken, cfg.wakyBotChatId, 'Waky Bot'],
        sport: [cfg.sportBotToken, cfg.sportBotChatId, 'Sport Bot'],
        mega: [cfg.megaBotToken, cfg.chatId, 'Mega Bot']
      }
      const [tok, chat, title] = pick[botKey ?? 'sport'] ?? pick.sport
      const token = tok || cfg.botToken
      const chatId = chat || cfg.chatId
      if (!token || !chatId) return { ok: false, error: 'Bot token or chat ID is missing' }
      try {
        const d = await tg(token, 'sendMessage', { chat_id: chatId, text: `⚡ <b>Life System — ${title} online</b>`, parse_mode: 'HTML' })
        return { ok: !!d.ok, error: d.ok ? undefined : d.description }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    startPolling: async (): Promise<boolean> => {
      polling = true
      if (!timer) {
        timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') pollOnce().catch(() => {})
        }, 12000)
      }
      return true
    },
    stopPolling: async (): Promise<boolean> => {
      polling = false
      if (timer) clearInterval(timer)
      timer = null
      return false
    }
  }
}
