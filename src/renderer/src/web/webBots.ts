// Telegram bots on the web: polls getUpdates and runs each command through
// the same services as the desktop, on the Turso copy. Every message is
// recorded in bot_seen_updates in the same Turso transaction as what it
// logged, so the phone and the PC never log one message twice, and a message
// is never marked done without its record (or the other way round).
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
import { logMoney, moneyButton } from './financeBot'
import { payTodoist } from './todoistCoins'
import { pLabel, sortToday, todayText, type TodoTask } from '@core/todoist'
import { REASONS, hm, parsePlan, type DayPlan } from '@core/focus'
import { agendaText, freeGaps, suggestBlocks, type CalEvent } from '@core/dayTime'
import { PLAN_ASK, eveningText, goalsText, planKeyboard, planText, weekText } from '@core/focusBot'
import { MirrorError, type Mirror } from './mirror'
import { findExercise, updateSport } from '../sportTrack'
import type { Services, WebServices } from './webServices'
import { appendLog, loadProfile, type Persona, RATINGS, focusRatings, brainPrompt, financeStateFrom, isSimpleLog, lifeContext, loadMemory, moneyInsight, parseBrain, personaFor, readAction, saveMemory, updateMemory, type BrainAction, type BrainOut } from './botBrain'

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
}

export type AskModel = (prompt: string, opts?: { json?: boolean; media?: { mime: string; data: string }[] }) => Promise<string>

/** What the bot needs from Todoist (the server calls it directly, the page through /api/todoist). */
export interface TodoistLike {
  today(): Promise<TodoTask[]>
  upcoming?(days?: number): Promise<TodoTask[]>
  close(id: string): Promise<void>
  quickAdd(text: string): Promise<TodoTask>
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



export function createWebBots({ mirror, services, defaults, onExpense, server = false, todoist = null, ai = null, calendar = null }: WebBotsDeps) {
  let polling = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastPollAt: string | null = null
  let lastError: string | null = null
  let processed = 0
  let running: Promise<{ processedCount: number; replies: string[] }> | null = null
  let pruned = false

  // Saved settings win, but an empty token or chat never hides the server's one.
  const merge = (saved: Partial<BotBridgeConfig>): BotBridgeConfig => {
    const out: any = { ...defaults }
    for (const [k, v] of Object.entries(saved ?? {})) if (v !== '' && v != null) out[k] = v
    return out
  }
  const config = (): Promise<BotBridgeConfig> =>
    mirror
      .read((db) => getSetting(db as any, 'bot_bridge_config'))
      .then((raw) => merge(raw ? JSON.parse(raw) : {}))
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
    return { reply: money.reply + (insight ? `\n${esc(insight)}` : '') + (res.awarded ? '\n🪙 <b>+3 coins</b> (first spending logged today)' : ''), keyboard: money.keyboard }
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
        return { reply: '📜 <b>Morning Oath Affirmed!</b>\n\n<i>"I commit to purity, disciplined physical power, sharp financial focus, and daily relentless self-mastery."</i>\n\n+3 coins awarded!' }
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
          return { reply: `🌅 <b>Wake-up ${back ? 'for yesterday ' : ''}set</b>: ${res.log.wakeTime} (target ${res.log.wakeTarget})\n${res.awarded ? '🎯 On time! <b>+10 coins</b>' : res.log.onTime ? (back ? 'On time · no coins for past days.' : 'On time.') : 'Saved to your sleep history.'}` }
        }
        const res = s.sleep.logWake(new Date().toTimeString().slice(0, 5)) // local time (the server runs in your time zone)
        return {
          reply: `🌅 <b>Wake-up logged</b>: ${res.log.wakeTime}\n${res.awarded ? '🎯 On time! <b>+10 coins</b>' : res.log.onTime ? 'On time.' : 'Saved to your sleep history.'}\n<i>Woke up earlier? Send</i> <code>/wake 06:40</code>\n\n😴 <b>How did you sleep?</b>`,
          keyboard: sleepKeyboard(res.log.day)
        }
      }
      case 'bed': {
        const res = s.sleep.logBed(new Date().toTimeString().slice(0, 5))
        return { reply: `🌙 <b>Bedtime logged</b>: ${res.log.bedTime}\n${res.awarded ? '🎯 On time! <b>+5 coins</b>' : 'Saved to your sleep history.'}` }
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
    if (!cq || !/^(f[acbkuoxq]|p[pr]|td|sq|g[px])\|/.test(data)) return null
    const answer = (text: string) => tg(update.__token, 'answerCallbackQuery', { callback_query_id: cq.id, text }).catch(() => null)
    if (!allowed(cfg, chat)) {
      await answer('Not allowed')
      return null
    }
    const edit = (text: string, keyboard?: any) =>
      tg(update.__token, 'editMessageText', { chat_id: chat, message_id: cq.message.message_id, text, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) }).catch(() => null)
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
            const subject = data.slice(3) || 'Focus'
            const plan = f.plan(services.services(db).wallet.today())
            const item = plan.items.find((p) => !p.done && p.text.startsWith(subject))
            f.start(subject, 50, new Date(), item ? { kind: 'mustdo', ref: item.text, title: item.text } : null)
            return { text: `⏱ <b>Focus started:</b> ${esc(item?.text ?? subject)} · 50 min.\nPhone away. Tap Stop when you finish.`, keyboard: STOP_KEYBOARD, toast: 'Focus started' }
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
  async function think(persona: Persona, text: string, key: string, media?: { kind: 'voice' | 'photo'; mime: string; data: string }, via = 'telegram'): Promise<{ ok: boolean; reply: string; done: string[]; keyboard?: any }> {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const [todoToday, upcoming, events] = await Promise.all([
      todoist ? todoist.today().catch(() => null) : Promise.resolve(null),
      todoist?.upcoming ? todoist.upcoming(7).catch(() => null) : Promise.resolve(null),
      calendar ? calendar.events(dayStart.toISOString(), new Date(dayStart.getTime() + 2 * 86400000).toISOString()).catch(() => null) : Promise.resolve(null)
    ])
    const { context, memory, profile } = await mirror.read((db) => ({
      context: lifeContext(services.services(db), db, { finance: financeStateFrom(db, store), todoToday, upcoming, events }),
      memory: loadMemory(db),
      profile: loadProfile(db)
    }))
    let out: BrainOut
    try {
      out = parseBrain(await ai!(brainPrompt(persona, context, memory, text, media?.kind, profile), { json: true, media: media ? [{ mime: media.mime, data: media.data }] : undefined }))
    } catch (e) {
      return { ok: false, reply: `The coach couldn't think right now (${(e as Error).message.slice(0, 120)}). Try again in a minute.`, done: [] }
    }
    const done: string[] = []
    let keyboard: any
    let expense = false
    const acts = out.actions.map(readAction).filter((a): a is BrainAction => !!a)
    if (typeof process !== 'undefined' && process.env?.BOT_DEBUG) console.log('brain actions:', out.actions, '→', acts)
    for (const [i, a] of acts.entries()) {
      try {
        if (a.kind === 'event') {
          if (!calendar) {
            done.push('⚠️ Google Calendar isn\'t connected (Settings in the app)')
            continue
          }
          const start = new Date(`${a.day}T${a.time}:00`)
          await calendar.create({ title: a.title, start: start.toISOString(), end: new Date(start.getTime() + a.minutes * 60000).toISOString(), description: 'Planned with your coach in Life System' })
          done.push(`🗓 In your calendar: ${a.title} · ${a.day.slice(5)} ${a.time} (${a.minutes} min)`)
          continue
        }
        if (a.kind === 'task') {
          if (!todoist) continue
          const t = await todoist.quickAdd(a.text)
          done.push(`➕ Todoist: ${t.content || a.text}${t.section ? ` · ${t.section}` : ''}${t.due ? ` (${t.due})` : ''}`)
          continue
        }
        const line = await mirror.write((db) => {
          const svc = services.services(db)
          if (a.kind === 'log') {
            const r = applyText(db, svc, a.text, `${key}:a${i}`)
            if (r.unknown) return null
            if (r.keyboard) keyboard = r.keyboard
            if (r.expense) expense = true
            return `✅ Logged: ${a.text}`
          }
          if (a.kind === 'mustdo') {
            const p = svc.focus.plan(svc.wallet.today())
            if (p.items.some((x) => x.text.toLowerCase() === a.text.toLowerCase())) return null
            svc.focus.setPlan([...p.items.map((x) => x.text), a.text])
            return `📝 Must-do added: ${a.text}${todoist ? ' (⭐ in Todoist)' : ''}`
          }
          if (a.kind === 'focus') {
            svc.focus.start(a.subject, a.minutes)
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
          { role: 'coach', bot: persona, via, text: out.reply || 'Got it.', done, at }
        ])
      })
      .catch(() => null)
    processed++
    return { ok: true, reply: out.reply || 'Got it.', done, keyboard }
  }

  async function handleBrain(botId: string, update: any, cfg: BotBridgeConfig, text: string, key: string, media?: { kind: 'voice' | 'photo'; mime: string; data: string }): Promise<string | null> {
    const chat = String(update.message?.chat?.id ?? '')
    void tg(update.__token, 'sendChatAction', { chat_id: chat, action: 'typing' }).catch(() => null)
    const r = await think(personaFor(botId, cfg), text, key, media)
    const reply = r.ok ? [esc(r.reply), r.done.length ? `\n${r.done.map(esc).join('\n')}` : ''].join('\n').trim() : `⚠️ ${esc(r.reply)} Or use a command like <code>/today</code>.`
    addLog(text || `[${media?.kind}]`, chat, r.ok, reply)
    await tg(update.__token, 'sendMessage', { chat_id: chat, text: reply, parse_mode: 'HTML', ...(r.keyboard ? { reply_markup: r.keyboard } : {}) }).catch(() => null)
    return reply
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

  return {
    pollOnce,
    handleUpdate,
    /** The app's Coach page: the same brain and memory as the bots. */
    think: (text: string, key = `app:${Date.now()}`) => think('mega', text, key, undefined, 'app'),
    config,
    saveConfig: async (patch: Partial<BotBridgeConfig>): Promise<BotBridgeConfig> => {
      const next: BotBridgeConfig = { ...(await config()), ...patch }
      delete next.serverBots // comes from the server each time, never saved
      delete next.skipBotIds
      await mirror.write((db) => setSetting(db as any, 'bot_bridge_config', JSON.stringify(next)))
      try {
        store?.setItem('bot_bridge_config', JSON.stringify(next))
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
