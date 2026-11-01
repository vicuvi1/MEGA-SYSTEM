// The Telegram bots, run by the web server (api/telegram.mjs) so they answer
// 24/7, even with no device open. Telegram sends each message here; it is
// handled exactly like the app does (same services, same Turso transaction
// with its "seen" mark), on a copy of the Turso database kept warm between
// messages. Bundled into api/_bot/bot.mjs by `npm run build:bot`.
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import type { BotBridgeConfig } from '@shared/api'
import { Mirror } from '../renderer/src/web/mirror'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { createWebServices } from '../renderer/src/web/webServices'
import { createWebBots, focusKeyboard, type AskModel, type CalendarLike } from '../renderer/src/web/webBots'
import { GOOGLE_SETTING as GSET, createCalendarApi as makeCal, type GoogleEnv, type GoogleStored } from './googleCalendar'
import { createTodoistApi } from './todoistApi'
import { payTodoist } from '../renderer/src/web/todoistCoins'
import { DEFAULT_RULES } from '@core/rules'
import { coachFacts, coachPrompt, coachText, deadlineFacts, wakeSlipping, weekFocusFact, windDownText, worthSaying } from '@core/coach'
import { deadlineRadar } from '@core/todoist'
import { shouldPlan } from '@core/weekPlan'
import { targetForDay } from '@core/sleep'
import { addDays } from '@core/dates'
import { financeSpending, progressReport, progressText } from '@core/progress'
import { getSetting, setSetting } from '../main/settings'
import { WEEK_FOCUS_POINTS, payOnce } from '../main/points'
import { PLAN_ASK, eveningText, morningText, planKeyboard, weekText } from '@core/focusBot'
import { NUDGES as NUDGES_KEY, REMINDERS as REMINDERS_KEY, afterSend, answered as answeredReminders, dueReminders, nudged, shouldNudge, type NudgeFacts, type NudgeState, type Reminder } from '@core/coachKit'
import { isFocusBlock } from '@core/dayTime'
import { focusCoins } from '@core/focus'

export { createTodoistApi }
export { GOOGLE_SETTING, authUrl, createCalendarApi, exchangeCode, localIso } from './googleCalendar'

export interface BotEnv {
  tursoUrl: string
  tursoToken: string
  defaults: Partial<BotBridgeConfig>
  timeZone?: string
  /** Your Todoist API token (TODOIST_TOKEN): /todo, /task, /done use it. */
  todoistToken?: string
  /** Gemini (GEMINI_API_KEY): the coach's brain for free text, voice and photos. */
  model?: AskModel
  /** Google sign-in app (GOOGLE_CLIENT_ID/SECRET + the server secret): your calendar. */
  google?: GoogleEnv | null
}

/**
 * Your Google Calendar for the bots, when you signed in (Settings): reads
 * the sealed sign-in from the database each time, so a new sign-in works
 * without a restart.
 */
function calendarFor(env: BotEnv, mirror: Mirror): CalendarLike | null {
  if (!env.google) return null
  const api = async () => {
    const raw = await mirror.read((db) => getSetting(db as any, GSET))
    const st = raw ? (JSON.parse(raw) as GoogleStored | null) : null
    return st?.enc ? makeCal(env.google!, st) : null
  }
  return {
    events: async (from, to) => (await api())?.events(from, to) ?? [],
    create: async (e) => {
      const a = await api()
      if (!a) throw new Error('Connect Google Calendar in the app (Settings) first')
      return a.create(e)
    },
    move: async (calendarId, id, start, end) => {
      const a = await api()
      if (!a) throw new Error('Connect Google Calendar in the app (Settings) first')
      return a.move(calendarId, id, start, end)
    },
    remove: async (calendarId, id) => {
      const a = await api()
      if (!a) throw new Error('Connect Google Calendar in the app (Settings) first')
      return a.remove(calendarId, id)
    }
  }
}

let warm: { key: string; bots: ReturnType<typeof createWebBots>; mirror: Mirror; services: ReturnType<typeof createWebServices>; calendar: CalendarLike | null } | null = null

async function botsFor(env: BotEnv) {
  const key = env.tursoUrl + '|' + env.tursoToken.slice(-12) + '|' + (env.todoistToken ?? '').slice(-6) + '|' + (env.model ? 'ai' : '') + '|' + (env.google ? 'g' : '')
  if (warm && warm.key === key) {
    await warm.mirror.refresh() // what the devices changed since the last message
    return warm
  }
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  const mirror = new Mirror(SQL, new TursoHttp(env.tursoUrl, env.tursoToken), null)
  await mirror.ready
  const services = createWebServices(mirror)
  const defaults = { enabled: true, pollingEnabled: true, morningBriefing: true, eveningNudge: true, ...env.defaults } as BotBridgeConfig
  // New tasks from the bots go to their area too (words first, then Gemini).
  const pickArea = env.model
    ? async (text: string, names: string[]) => {
        const r = (await env.model!(`Which ONE of these life areas does this task belong to? Areas: ${names.join(', ')}.\nTask: "${text}"\nReply with exactly one area name from the list, or "none".`)).trim().replace(/^"|"$/g, '')
        return /^none$/i.test(r) ? null : r
      }
    : undefined
  const todoist = env.todoistToken ? createTodoistApi(env.todoistToken, fetch, { pickArea }) : null
  const calendar = calendarFor(env, mirror)
  const bots = createWebBots({ mirror, services, defaults, server: true, todoist, ai: env.model ?? null, calendar })
  warm = { key, bots, mirror, services, calendar }
  return warm
}

let todoistCheckedAt = 0
const TODOIST_COINS = DEFAULT_RULES.find((r) => r.id === 'tasks.todoist_done')?.coins ?? 8

/**
 * Coins for what you completed in Todoist itself (each task once, see
 * payTodoist), checked by the server so they arrive with no device open:
 * at the daily messages and, at most every few minutes, with a bot message.
 * `since` defaults to today's midnight in your time zone.
 */
export async function payTodoistDone(env: BotEnv, opts: { since?: Date; minGapMs?: number } = {}): Promise<{ paid: number; done: number }> {
  if (!env.todoistToken) return { paid: 0, done: 0 }
  if (opts.minGapMs && Date.now() - todoistCheckedAt < opts.minGapMs) return { paid: 0, done: 0 }
  todoistCheckedAt = Date.now()
  const { mirror, services } = await botsFor(env)
  const since = opts.since ?? localMidnight(0)
  const items = await createTodoistApi(env.todoistToken).completedSince(since.toISOString())
  if (!items.length) return { paid: 0, done: 0 }
  const paid = await mirror.write((db) => payTodoist(services.services(db), items))
  return { paid, done: items.length }
}

/** Midnight `daysAgo` days back, in process.env.TZ. */
function localMidnight(daysAgo: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

/** The app's Coach page: one message to the coach (same brain, memory and log as the bots). */
export async function coachChat(env: BotEnv, text: string, onStep?: (step: string) => void): Promise<{ ok: boolean; reply: string; done: string[]; steps?: string[] }> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  if (!env.model) return { ok: false, reply: 'Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to talk to the coach.', done: [] }
  const { bots } = await botsFor(env)
  const r = await bots.think(text, `app:${Date.now()}`, onStep)
  return { ok: r.ok, reply: r.reply, done: r.done, steps: r.steps }
}

/** Handles one Telegram update for the bot with this token; returns the reply sent. */
export async function handleTelegramUpdate(env: BotEnv, token: string, update: unknown): Promise<string | null> {
  // Days, wake-up times and streaks follow your time zone, not the server's.
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { bots, mirror } = await botsFor(env)
  // You wrote something: open check-ins stop asking (you answered).
  if ((update as any)?.message) {
    await mirror
      .write((db) => {
        const raw = getSetting(db as any, REMINDERS_KEY)
        if (raw) setSetting(db as any, REMINDERS_KEY, JSON.stringify(answeredReminders(JSON.parse(raw))))
      })
      .catch(() => null)
  }
  const reply = await bots.handleUpdate(token, update)
  await payTodoistDone(env, { minGapMs: 3 * 60_000 }).catch(() => null)
  return reply
}

export type DailyJob = 'morning' | 'reask' | 'midday' | 'evening' | 'night'

/**
 * The daily messages (Vercel runs them on a schedule, api/cron.mjs):
 * morning: the plan question, then the coach if something slipped;
 * midday: a nudge only when there's been no focus yet today;
 * evening: the review with tap-buttons, and on Sundays the week and
 * "Am I improving?".
 */
export async function runDaily(env: BotEnv & { botToken: string; chatId: string; ai?: (prompt: string) => Promise<string>; appUrl?: string; sleepBotToken?: string }, job: DailyJob): Promise<string[]> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { services, mirror } = await botsFor(env)
  const send = async (text: string, reply_markup?: unknown, token = env.botToken) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.chatId, text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) })
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!j.ok) throw new Error(`Telegram: ${j.description ?? res.status}`)
  }
  // Todoist tasks you completed in Todoist pay here even if no device opened
  // the app: the morning picks up last evening's, the others today's.
  const todo = await payTodoistDone(env, { since: localMidnight(job === 'morning' ? 1 : 0) }).catch(() => null)
  const st = await services.focus.state()
  const todoistToday = env.todoistToken ? await createTodoistApi(env.todoistToken).today().then((t) => t.length).catch(() => null) : null
  // Same numbers as the Progress page (spending from Finance Helper's synced copy).
  const { input, report, weekPlan, savedPlan } = await mirror.read((db) => {
    const svc = services.services(db)
    const fin = getSetting(db as any, 'app_sync_finance')
    let spending: ReturnType<typeof financeSpending> = null
    try {
      spending = fin ? financeSpending(JSON.parse(fin)?.data) : null
    } catch {
      spending = null
    }
    const input = svc.progress.input(spending)
    return { input, report: progressReport(input), weekPlan: svc.weekPlan.active(), savedPlan: svc.weekPlan.saved() }
  })
  const weekFact = weekFocusFact(weekPlan, report)
  // Deadline radar: important Todoist tasks due in the next 3 days (morning and midday).
  const radar = env.todoistToken && job !== 'evening' && job !== 'night' ? deadlineRadar(await createTodoistApi(env.todoistToken).upcoming(7).catch(() => []), input.today) : []
  const facts = [...deadlineFacts(radar), ...(weekFact ? [weekFact] : []), ...coachFacts(input, report)].sort((a, b) => b.weight - a.weight)
  /** Gemini says it in its own words; the plain text when there's no key or it fails. */
  const coach = async (when: DailyJob, fallback: string) => {
    if (!env.ai) return fallback
    try {
      const prompt = coachPrompt(facts, report, { mustdos: st.plan.items.map((x) => x.text), todoistToday, when })
      const text = (await env.ai(prompt)).trim()
      return text ? `🧭 <b>Coach</b>\n\n${escapeHtml(text).slice(0, 900)}` : fallback
    } catch {
      return fallback
    }
  }
  /** ▶ buttons under the coach: your open must-dos, else your usual subjects. */
  const focusButtons = () => {
    const open = st.plan.items.filter((x) => !x.done).map((x) => x.text)
    return focusKeyboard(open.length ? open : st.subjects.slice(0, 2))
  }
  const sent: string[] = []
  if (job === 'morning') {
    const planAlready = st.plan.items.length > 0
    // Already asked when you logged your wake-up on Telegram: just the coach.
    const askedToday = await mirror.read((db) => getSetting(db as any, 'morning_sent_day') === input.today)
    if (!askedToday) await mirror.write((db) => setSetting(db as any, 'morning_sent_day', input.today))
    if (!askedToday) await send(
      morningText({ focusYesterdayMin: st.week.byDay[5]?.minutes ?? 0, goalsBehind: st.goals.filter((g) => g.aheadH < 0), todoistToday, planAlready }),
      planAlready ? undefined : { force_reply: true, input_field_placeholder: 'Essay intro; gym; call Leo' }
    )
    if (!askedToday) sent.push('morning')
    if (worthSaying(facts)) {
      await send(await coach('morning', coachText(facts)), focusButtons())
      sent.push('coach')
    }
  } else if (job === 'reask') {
    // 10:00 and still no plan: ask again, simpler (a reply is the plan, like the morning one).
    if (!st.plan.items.length) {
      await send(`🧭 Still no plan for today. Just one thing is enough.\n\n<b>${PLAN_ASK}</b>\nReply to this message.`, { force_reply: true, input_field_placeholder: 'One thing that makes today good' })
      sent.push('reask')
    }
  } else if (job === 'midday') {
    // Only when the day hasn't started: no focus yet and nothing running.
    if (st.todayMin === 0 && !st.running) {
      const fallback = `🧭 <b>Coach</b>\n\nHalf the day is gone and no focus yet${st.plan.items.length ? `. Your must-do: <b>${escapeHtml(st.plan.items.find((x) => !x.done)?.text ?? st.plan.items[0].text)}</b>` : ''}.\n\n👉 Start one 25-minute block now: <code>/focus 25 ${escapeHtml(st.subjects[0] ?? 'study')}</code>`
      facts.unshift({ id: 'no-focus', weight: 10, text: 'No focus session yet today (it is midday).', step: 'Start one 25-minute block now.' })
      await send(await coach('midday', fallback), focusButtons())
      sent.push('midday')
    }
  } else if (job === 'night') {
    // Only when wake-ups are slipping: one message 45 minutes before bedtime.
    const slip = wakeSlipping(input.wakes, input.today)
    if (slip) {
      const { bed, wake } = await mirror.read((db) => {
        const sl = services.services(db).sleep
        return { bed: sl.bedtimeTarget(), wake: targetForDay(addDays(input.today, 1), sl.weekdayTarget(), sl.weekendTarget()) }
      })
      let first: string | null = null
      if (env.todoistToken) {
        const tom = await createTodoistApi(env.todoistToken).tomorrow().catch(() => [])
        first = tom.sort((a, b) => b.priority - a.priority || String(a.dueTime ?? '99').localeCompare(String(b.dueTime ?? '99')))[0]?.content ?? null
      }
      first ??= st.plan.items.find((x) => !x.done)?.text ?? null
      // From Waky, the sleep coach, when it's on the server.
      await send(windDownText({ bedTarget: bed, wakeTarget: wake, late: slip.late, of: slip.of, first }), undefined, env.sleepBotToken || env.botToken)
      sent.push('night')
    }
  } else {
    // Reaching the week's chosen focus pays a bonus once.
    let weekLine = ''
    const wm = weekPlan ? report.metrics.find((m) => m.id === weekPlan.focus) : null
    if (weekPlan && wm?.target && wm.now >= wm.target) {
      const paid = await mirror.write((db) => payOnce(services.services(db).wallet, `weekfocus:${weekPlan.week}`, WEEK_FOCUS_POINTS, `Week focus reached: ${wm.label}`))
      if (paid) weekLine = `\n\n🏆 Week focus reached: <b>${wm.label}</b> (${wm.text}). +${WEEK_FOCUS_POINTS} points.`
    }
    const todoLine = todo && todo.done ? `\n\n✅ Todoist: ${todo.done} done today${todo.paid ? ` · +${todo.paid * TODOIST_COINS} 🪙 just now` : ''}` : ''
    await send(eveningText(st.plan, st.todayMin) + todoLine + weekLine, st.plan.items.length ? planKeyboard(st.plan, true) : undefined)
    sent.push('evening')
    if (new Date().getDay() === 0) {
      await send(weekText(st.week, st.goals))
      await send(progressText(report))
      // Sunday is planning day: a nudge to make next week's plan, unless it's done.
      if (shouldPlan(savedPlan, input.today)) {
        const url = env.appUrl ? `${env.appUrl.replace(/\/$/, '')}/` : null
        await send(
          '🗓 <b>Plan next week</b> (15 minutes)\n\nPick <b>one</b> area to focus on and your <b>3 big tasks</b>. Open Progress in the app; the coach then checks that focus every day.',
          url ? { inline_keyboard: [[{ text: '🗓 Plan my week', url }]] } : undefined
        )
      }
      sent.push('weekly')
    }
  }
  return sent
}

const escapeHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export { cleanupPrompt, parseCleanup, localCleanup } from '../core/todoistClean'

// ---- The tick: the coach writes first --------------------------------------
// Called every few minutes (a GitHub Actions timer, and the open app). Sends
// due reminders and check-ins (check-ins come back every 45 min until you
// answer), says when a study block in your calendar starts, and follows up
// when you're slipping (idle 60+ min with must-dos open), never while paused.
const TICK_AT = 'coach_tick_at'

export async function runTick(env: BotEnv & { botToken: string; chatId: string }, now = new Date()): Promise<string[]> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { services, mirror, calendar } = await botsFor(env)
  // At most once a minute, whoever calls.
  const fresh = await mirror.write((db) => {
    const last = Number(getSetting(db as any, TICK_AT) || 0)
    if (now.getTime() - last < 50_000) return false
    setSetting(db as any, TICK_AT, String(now.getTime()))
    return true
  })
  if (!fresh) return []
  const sent: string[] = []
  const send = async (text: string, reply_markup?: unknown) => {
    const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.chatId, text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) })
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!j.ok) throw new Error(`Telegram: ${j.description ?? res.status}`)
    sent.push(text)
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const pauseRow = [
    { text: '😴 30 min', callback_data: 'ns|' },
    { text: '⏸ Pause today', callback_data: 'np|' }
  ]

  // 1) Reminders and check-ins that are due.
  const reminders = await mirror.read((db) => {
    try {
      return JSON.parse(getSetting(db as any, REMINDERS_KEY) || '[]') as Reminder[]
    } catch {
      return [] as Reminder[]
    }
  })
  let list = reminders
  for (const r of dueReminders(list, now)) {
    try {
      await send(r.kind === 'checkin' ? `🔔 ${esc(r.text)}${(r.tries ?? 0) > 0 ? `\n<i>(asking again: answer me, even "not yet")</i>` : ''}` : `⏰ ${esc(r.text)}`, r.kind === 'checkin' ? { inline_keyboard: [pauseRow] } : undefined)
      list = afterSend(list, r.id, now)
    } catch {
      /* Telegram hiccup: next tick */
    }
  }
  if (list !== reminders) await mirror.write((db) => setSetting(db as any, REMINDERS_KEY, JSON.stringify(list)))

  // 2) A study block in your calendar starts now, and 3) follow-ups when slipping.
  const st = await mirror.read((db) => {
    let nudge: NudgeState = {}
    try {
      nudge = JSON.parse(getSetting(db as any, NUDGES_KEY) || '{}')
    } catch {
      nudge = {}
    }
    const svc = services.services(db)
    const today = svc.wallet.today(now)
    const f = svc.focus.state(now)
    const lastLedger = svc.wallet.entries().filter((e: any) => e.day === today).map((e: any) => Date.parse(e.ts)).filter(Number.isFinite)
    const lastFocus = f.todaySessions.map((x) => Date.parse(x.endedAt ?? '')).filter(Number.isFinite)
    const last = Math.max(0, ...lastLedger, ...lastFocus)
    return { nudge, today, focus: f, idleMin: last ? (now.getTime() - last) / 60000 : Infinity }
  })
  let nudge: NudgeState = st.nudge.day === st.today ? st.nudge : { ...st.nudge, day: st.today, count: 0, announced: [] }
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const paused = nudge.pausedDay === st.today
  if (calendar && !st.focus.running && !paused) {
    const events = await calendar.events(new Date(now.getTime() - 30 * 60000).toISOString(), new Date(now.getTime() + 15 * 60000).toISOString()).catch(() => [])
    const starting = events.find((e) => isFocusBlock(e) && !(nudge.announced ?? []).includes(e.id) && Date.parse(e.start) - now.getTime() <= 10 * 60000 && Date.parse(e.end) - now.getTime() >= 15 * 60000)
    if (starting) {
      const mins = Math.round((Date.parse(starting.end) - Math.max(now.getTime(), Date.parse(starting.start))) / 60000)
      const subject = starting.title.replace(/^[^\p{L}\p{N}]+/u, '').split(/\s+/).slice(0, 4).join(' ').slice(0, 28)
      try {
        await send(`📚 <b>${esc(starting.title)}</b> ${Date.parse(starting.start) > now.getTime() ? `starts at ${localIsoHM(starting.start)}` : 'is on now'} · ${mins} min · +${focusCoins(mins)} points if you focus.\nStart the timer?`, {
          inline_keyboard: [[{ text: `▶ Start: ${subject}`, callback_data: `fo|${subject}` }], pauseRow]
        })
        nudge = { ...nudge, announced: [...(nudge.announced ?? []), starting.id] }
      } catch {
        /* next tick */
      }
    }
  }
  const openMustDos = st.focus.plan.items.filter((x) => !x.done)
  const facts: NudgeFacts = { today: st.today, time, focusRunning: !!st.focus.running, focusMinToday: st.focus.todayMin, openMustDos: openMustDos.length, idleMin: st.idleMin, wakeLogged: true }
  if (!sent.length && shouldNudge(nudge, facts, now)) {
    const n = (nudge.day === st.today ? nudge.count ?? 0 : 0) + 1
    const first = openMustDos[0]?.text
    const idle = Number.isFinite(st.idleMin) ? `${Math.floor(st.idleMin / 60) ? `${Math.floor(st.idleMin / 60)}h ` : ''}${Math.round(st.idleMin % 60)}m` : 'all day'
    const text =
      n === 1
        ? `👀 Nothing done for ${idle}. ${first ? `Your must-do: <b>${esc(first)}</b>.` : `Focus today: ${st.focus.todayMin} min.`} 25 minutes, starting now.`
        : n <= 3
          ? `⏰ Still waiting. ${first ? `<b>${esc(first)}</b> won't do itself.` : 'One focus block.'} Just start the timer, the rest follows.`
          : `🔥 Nudge ${n}: you said you want this. ${first ? `<b>${esc(first)}</b>,` : 'One block,'} 25 min. Tap and go.`
    const subject = (first ?? 'Focus').split(/\s+/).slice(0, 4).join(' ').slice(0, 28)
    try {
      await send(text, { inline_keyboard: [[{ text: `▶ 50 min: ${subject}`, callback_data: `fo|${subject}` }], pauseRow] })
      nudge = nudged(nudge, st.today, now)
    } catch {
      /* next tick */
    }
  }
  if (JSON.stringify(nudge) !== JSON.stringify(st.nudge)) await mirror.write((db) => setSetting(db as any, NUDGES_KEY, JSON.stringify(nudge)))
  return sent
}

const localIsoHM = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
