// The Telegram bots, run by the web server (api/telegram.mjs) so they answer
// 24/7, even with no device open. Telegram sends each message here; it is
// handled exactly like the app does (same services, same Turso transaction
// with its "seen" mark), on a copy of the Turso database kept warm between
// messages. Bundled into api/_bot/bot.mjs by `npm run build:bot`.
import { gunzipSync } from 'node:zlib'
import { calendarChanges, type Seen } from '../core/calWatch'
import { loadFeedback } from '../renderer/src/web/botBrain'
import { quietNow, quietRules } from '../core/benTiming'
import { neutral } from '../core/stealth'
import { examSleepGuard, sleepRegularity } from '../core/sleepRegularity'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import type { SqlJsStatic } from 'sql.js'
import type { BotBridgeConfig } from '@shared/api'
import { Mirror } from '../renderer/src/web/mirror'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { createWebServices } from '../renderer/src/web/webServices'
import { createWebBots, focusKeyboard, type AskModel, type CalendarLike } from '../renderer/src/web/webBots'
import { appendLog, loadLog } from '../renderer/src/web/botBrain'
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
import { messageKind, sendOnce, type SentToday } from '../core/benOnce'
import { cleanVoice, voiceKind, voicePrompt } from '../core/benVoice'
import { riskWindows, topTriggers, upcomingRisk, warningText } from '@core/urgePatterns'
import { alertDecisions, alertText, healthChecks, weeklyReport } from '@core/health'
import { beat, logBen, logError, readHealth, setNote, type BenLogEntry } from '../renderer/src/web/systemHealth'
import { restoreDrill, snapshotOf } from '../renderer/src/web/restoreDrill'
import { loadTriggers, urgeEvents } from '../renderer/src/web/disciplinePatterns'
import { SPORTY_REQUEST, SPORTY_STATUS, parseJson, pollSporty, sportyUpdated, type SportyRequest, type SportyStatus } from '@core/sportyUpdate'
import { WEEK_FOCUS_POINTS, payOnce } from '../main/points'
import { PLAN_ASK, eveningText, morningText, planKeyboard, weekText } from '@core/focusBot'
import { NUDGES as NUDGES_KEY, REMINDERS as REMINDERS_KEY, afterSend, answered as answeredReminders, dueReminders, followUpText, promiseStats, MOOD_FACE, nudged, shouldNudge, type NudgeFacts, type NudgeState, type Reminder } from '@core/coachKit'
import { blockSubject, isFocusBlock } from '@core/dayTime'
import { notifFromMessage, type Notif } from '@core/notify'
import { addNotif } from '../renderer/src/web/notifications'
import { AREA_WORDS, areaFromWords, learnAreaWords } from '@core/areaWords'
import { rescueFromEvents } from '@core/benPlans'
import { autoApproveDue, planWaitingText, missedBlocks, movedText, nextSlot, nudgeText } from '@core/benActs'
import { loadStyle } from '../renderer/src/web/botBrain'
import { deskChange, deskView, loadDesk, saveDesk } from '../renderer/src/web/benDesk'
import { financeStateFrom, loadProfile } from '../renderer/src/web/botBrain'
import { monthTakePrompt, callDue, loseStakes, overdueStakes, stakeLostText, stakeRemindText, type Stake, proofMet, keepStake } from '@core/benStakes'
import { dueTopics } from '@core/benPlans'
import { MOOD_FACES, moodDue } from '@core/benKnows'
import { addReps, addWater, sharedView, sportToday, type SharedSport } from '@core/sportShared'
import { focusCoins } from '@core/focus'
import { defaultSport, workoutCard } from '@core/sportCards'
import { PROPOSAL_KEYBOARD, REVIEW_KEYBOARD, RHYTHM_PREFS, WEEKLY_KEYBOARD, cleanPrefs, dueRhythm, proposalText, reviewText, rhythmFor, RHYTHM, weeklyText, type RhythmState, missedTwiceText } from '@core/rhythm'
import { missTwiceLine } from '@core/neverMissTwice'
import { coachStatus } from '../renderer/src/web/coachStatus'
import { NOTIF_SETTINGS_KEY, cleanNotifSettings, eventAlerts, quietNow as quietNowSet } from '@core/eventAlerts'

/** What Ben already said today, by kind (each kind once a day). */
const BEN_SENT = 'ben_sent_today'

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

/** Todoist calls leave a health beat: Ben tells you when the Todoist key stops working. */
const todoistFetch = (env: BotEnv): typeof fetch => {
  const t = new TursoHttp(env.tursoUrl, env.tursoToken)
  return (async (url: any, init?: any) => {
    try {
      const res = await fetch(url, init)
      if (res.ok) void beat(t, 'todoist', true)
      else if (res.status === 401 || res.status === 403 || res.status >= 500) void beat(t, 'todoist', false, `HTTP ${res.status}`)
      return res
    } catch (e) {
      void beat(t, 'todoist', false, (e as Error).message)
      throw e
    }
  }) as typeof fetch
}

let warm: { key: string; SQL: SqlJsStatic; bots: ReturnType<typeof createWebBots>; mirror: Mirror; services: ReturnType<typeof createWebServices>; calendar: CalendarLike | null } | null = null
let warmAt = 0

async function botsFor(env: BotEnv) {
  const key = env.tursoUrl + '|' + env.tursoToken.slice(-12) + '|' + (env.todoistToken ?? '').slice(-6) + '|' + (env.model ? 'ai' : '') + '|' + (env.google ? 'g' : '')
  if (warm && warm.key === key) {
    // What the devices changed since the last message (one tiny read); not
    // again within the same few seconds (a tick calls this several times: S2).
    if (Date.now() - warmAt > 3000) {
      await warm.mirror.refresh()
      warmAt = Date.now()
    }
    return warm
  }
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  const mirror = new Mirror(SQL, new TursoHttp(env.tursoUrl, env.tursoToken), null)
  await mirror.ready
  const services = createWebServices(mirror)
  const defaults = { enabled: true, pollingEnabled: true, morningBriefing: true, eveningNudge: true, ...env.defaults } as BotBridgeConfig
  // New tasks from the bots go to their area too (words first, then Gemini).
  // Every AI answer (or failure) is a health beat: Ben tells you when his AI stops working.
  const healthDb = new TursoHttp(env.tursoUrl, env.tursoToken)
  const model: BotEnv['model'] = env.model
    ? async (prompt, opts) => {
        try {
          const r = await env.model!(prompt, opts)
          void beat(healthDb, 'ai', true)
          return r
        } catch (e) {
          void beat(healthDb, 'ai', false, (e as Error).message)
          throw e
        }
      }
    : undefined
  // B17: words → area learned from earlier picks; the AI is asked only for tasks with no known word.
  const pickArea = model
    ? async (text: string, names: string[]) => {
        const known = await mirror.read((db) => areaFromWords(JSON.parse(getSetting(db as any, AREA_WORDS) || '{}'), text, names)).catch(() => null)
        if (known) return known
        const r = (await model!(`Which ONE of these life areas does this task belong to? Areas: ${names.join(', ')}.\nTask: "${text}"\nReply with exactly one area name from the list, or "none".`, { kind: 'area' } as any)).trim().replace(/^"|"$/g, '')
        const area = /^none$/i.test(r) ? null : names.find((n) => n.toLowerCase() === r.toLowerCase()) ?? r
        if (area) await mirror.write((db) => setSetting(db as any, AREA_WORDS, JSON.stringify(learnAreaWords(JSON.parse(getSetting(db as any, AREA_WORDS) || '{}'), text, area)))).catch(() => null)
        return area
      }
    : undefined
  const todoist = env.todoistToken ? createTodoistApi(env.todoistToken, todoistFetch(env), { pickArea }) : null
  const calendar = calendarFor(env, mirror)
  const bots = createWebBots({ mirror, services, defaults, server: true, todoist, ai: model ?? null, calendar })
  warm = { key, SQL, bots, mirror, services, calendar }
  warmAt = Date.now()
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
  const items = await createTodoistApi(env.todoistToken, todoistFetch(env)).completedSince(since.toISOString())
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
export async function coachChat(env: BotEnv, text: string, onStep?: (step: string) => void, media?: { kind: 'voice' | 'photo'; mime: string; data: string }): Promise<{ ok: boolean; reply: string; done: string[]; steps?: string[]; mood?: string; at?: string; undo?: unknown[]; chips?: string[]; buttons?: { label: string; do: string }[]; show?: string[] }> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  if (!env.model) return { ok: false, reply: 'Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to talk to the coach.', done: [] }
  const { bots } = await botsFor(env)
  const r = await bots.think(text, `app:${Date.now()}`, onStep, media)
  return { ok: r.ok, reply: r.reply, done: r.done, steps: r.steps, mood: r.mood, at: r.at, undo: r.undo, chips: r.chips, buttons: r.buttons, show: r.show }
}

/** The app: take back what the coach did in one reply (all, or one line). */
export async function coachUndo(env: BotEnv, at: string, index?: number): Promise<{ ok: boolean; lines: string[] }> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { bots } = await botsFor(env)
  return bots.undoReply(at, index)
}

/** Handles one Telegram update for the bot with this token; returns the reply sent. */
export async function handleTelegramUpdate(env: BotEnv, token: string, update: unknown): Promise<string | null> {
  // Days, wake-up times and streaks follow your time zone, not the server's.
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { bots, mirror } = await botsFor(env)
  // You wrote something: open check-ins stop asking (you answered). Only
  // from your own chats: a stranger writing to the bot changes nothing (A5).
  const msgChat = (update as any)?.message?.chat?.id
  if (msgChat != null && (await bots.allowedChat(msgChat))) {
    await mirror
      .write((db) => {
        const raw = getSetting(db as any, REMINDERS_KEY)
        const m = (update as any).message
        if (raw) setSetting(db as any, REMINDERS_KEY, JSON.stringify(answeredReminders(JSON.parse(raw), new Date(), String(m.text ?? m.caption ?? ''), !!m.reply_to_message)))
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
  // The daily rhythm (the tick) sends the morning plan and the evening and Sunday reviews now.
  if (job === 'morning' || job === 'reask' || job === 'evening' || job === 'midday') {
    const on = await mirror.read((db) => cleanPrefs(JSON.parse(getSetting(db as any, RHYTHM_PREFS) || 'null')).on).catch(() => true)
    if (on) {
      await logBen(new TursoHttp(env.tursoUrl, env.tursoToken), [{ status: 'skipped', kind: `${job} message`, reason: 'The daily rhythm sends this one instead' }])
      return []
    }
  }
  const stealth = await mirror.read((db) => getSetting(db as any, 'discipline_stealth') === '1').catch(() => false)
  const send = async (text: string, reply_markup?: unknown, token = env.botToken) => {
    if (stealth) text = neutral(text)
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.chatId, text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) })
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    const at = new Date().toISOString()
    await logBen(new TursoHttp(env.tursoUrl, env.tursoToken), [{ at, status: j.ok ? 'sent' : 'failed', kind: `${job} message`, reason: j.ok ? undefined : `Telegram: ${j.description ?? res.status}`, text }])
    if (!j.ok) throw new Error(`Telegram: ${j.description ?? res.status}`)
  }
  // Todoist tasks you completed in Todoist pay here even if no device opened
  // the app: the morning picks up last evening's, the others today's.
  const todo = await payTodoistDone(env, { since: localMidnight(job === 'morning' ? 1 : 0) }).catch(() => null)
  const st = await services.focus.state()
  const todoistToday = env.todoistToken ? await createTodoistApi(env.todoistToken, todoistFetch(env)).today().then((t) => t.length).catch(() => null) : null
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
  const radar = env.todoistToken && job !== 'evening' && job !== 'night' ? deadlineRadar(await createTodoistApi(env.todoistToken, todoistFetch(env)).upcoming(7).catch(() => []), input.today) : []
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
    // Exam week and short on sleep: one warning before the wind-down (H10).
    const guard = await mirror
      .read((db) => {
        const sl = services.services(db).sleep
        const nights = sleepRegularity(sl.state().recentLogs).nights
        const exams = services.services(db).focus.state().goals.map((g: any) => ({ title: g.title, deadline: g.deadline }))
        return examSleepGuard({ today: input.today, nights, exams, bedTarget: sl.bedtimeTarget() })
      })
      .catch(() => null)
    if (guard) {
      await send(guard.text, undefined, env.sleepBotToken || env.botToken).catch(() => null)
      sent.push('exam-sleep')
    }
    // Only when wake-ups are slipping: one message 45 minutes before bedtime.
    const slip = wakeSlipping(input.wakes, input.today)
    if (slip) {
      const { bed, wake } = await mirror.read((db) => {
        const sl = services.services(db).sleep
        return { bed: sl.bedtimeTarget(), wake: targetForDay(addDays(input.today, 1), sl.weekdayTarget(), sl.weekendTarget()) }
      })
      let first: string | null = null
      if (env.todoistToken) {
        const tom = await createTodoistApi(env.todoistToken, todoistFetch(env)).tomorrow().catch(() => [])
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
      // Sunday in ONE message (T7): the week, progress and the "plan next week"
      // nudge used to arrive as three separate messages right after the review.
      const plan = shouldPlan(savedPlan, input.today)
      const url = env.appUrl ? `${env.appUrl.replace(/\/$/, '')}/` : null
      await send(
        [weekText(st.week, st.goals), progressText(report), plan ? '🗓 <b>Plan next week</b> (15 minutes): pick <b>one</b> area to focus on and your <b>3 big tasks</b> in Progress; the coach then checks that focus every day.' : ''].filter(Boolean).join('\n\n'),
        plan && url ? { inline_keyboard: [[{ text: '🗓 Plan my week', url }]] } : undefined
      )
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

// Server-only notes (sys_kv): the tick's clock and the calendar watch change
// every minute or ten. In settings they made every device download the whole
// settings table each time (S1); sys_ tables are never copied to devices.
const SYS_KV = { sql: 'CREATE TABLE IF NOT EXISTS sys_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)', args: [] as any[] }
/** True when this caller wins the slot (at most once per `gapMs`), atomically. */
async function sysClaim(db: TursoHttp, key: string, nowMs: number, gapMs: number): Promise<boolean> {
  const [, rows] = await db.writeAtomic([SYS_KV, { sql: 'INSERT INTO sys_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(sys_kv.value AS INTEGER) <= ? RETURNING value', args: [key, String(nowMs), nowMs - gapMs] }])
  return rows.length > 0
}
async function sysGet(db: TursoHttp, key: string): Promise<string | null> {
  await db.writeAtomic([SYS_KV])
  const [r] = await db.readMany([{ sql: 'SELECT value FROM sys_kv WHERE key = ?', args: [key] }])
  return r instanceof Error ? null : ((r.rows[0]?.[0] as string | undefined) ?? null)
}
const sysSet = (db: TursoHttp, key: string, value: string) => db.writeAtomic([SYS_KV, { sql: 'INSERT INTO sys_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [key, value] }])

export async function runTick(env: BotEnv & { botToken: string; chatId: string; sleepBotToken?: string }, now = new Date()): Promise<string[]> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { services, mirror, calendar, bots, SQL } = await botsFor(env)
  // At most once a minute, whoever calls.
  const healthDb = new TursoHttp(env.tursoUrl, env.tursoToken)
  if (!(await sysClaim(healthDb, TICK_AT, now.getTime(), 50_000))) return []
  await beat(healthDb, 'tick', true, undefined, now)
  const sent: string[] = []
  // Ben's log (Coach → Ben's log): everything sent, held back (and why) or failed.
  const journal: BenLogEntry[] = []
  const note = (status: BenLogEntry['status'], text: string, reason?: string, kind?: string) =>
    journal.push({ at: new Date().toISOString(), status, kind: kind ?? messageKind(text) ?? (/^⏰/u.test(text.replace(/<[^>]+>/g, '').trim()) ? 'reminder' : 'message'), reason, text })
  try {
    return await tickBody()
  } finally {
    await logBen(healthDb, journal, now)
  }
  async function tickBody(): Promise<string[]> {
  const voiced = async (template: string): Promise<string> => {
    const kind = voiceKind(template)
    if (!kind || !env.model) return template
    // B16/W10: the AI writes only the first nudge of each kind per day; the rest use the
    // template with live numbers (no model call, no calendar or Todoist round trip).
    const dayKey = now.toLocaleDateString('sv-SE')
    const fresh = await mirror
      .write((db) => {
        let v: { day: string; kinds: string[] } = { day: dayKey, kinds: [] }
        try {
          const raw = JSON.parse(getSetting(db as any, 'voiced_kinds') || 'null')
          if (raw?.day === dayKey && Array.isArray(raw.kinds)) v = raw
        } catch {
          /* new day */
        }
        if (v.kinds.includes(kind)) return false
        setSetting(db as any, 'voiced_kinds', JSON.stringify({ day: dayKey, kinds: [...v.kinds, kind] }))
        return true
      })
      .catch(() => false)
    if (!fresh) return template
    try {
      const ctx = await mirror.read((db) => {
        const svc = services.services(db)
        const f = svc.focus.state(now)
        return { focusMin: f.todayMin, mustDos: f.plan.items.filter((x) => !x.done).map((x) => x.text).slice(0, 4), tone: loadStyle(db).tone }
      })
      const day = now.toLocaleDateString('sv-SE')
      const events = calendar ? await calendar.events(now.toISOString(), new Date(`${day}T23:59:59`).toISOString()).catch(() => []) : []
      const next = events.filter((e) => !e.allDay && Date.parse(e.start) > now.getTime()).sort((a, b) => a.start.localeCompare(b.start))[0]
      const tasks = env.todoistToken ? await createTodoistApi(env.todoistToken, todoistFetch(env)).today().then((l) => l.map((t) => t.content).slice(0, 5), () => []) : []
      const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
      const out = await env.model(voicePrompt(kind, template, { time: hm(now.toISOString()), ...ctx, nextEvent: next ? `${next.title} at ${hm(next.start)}` : null, tasks, water: null }), { kind: 'nudge' } as any)
      return cleanVoice(out, template) ?? template
    } catch {
      return template
    }
  }
  // true when it really went out. `always`: check-ins and nudges escalate on purpose
  // ("Last check on…" twice is the point), so the once-a-day rule never drops them.
  // Quiet hours, event warnings, travel times: the same settings as the app (N2, N3, N6).
  const notifSet = await mirror.read((db) => cleanNotifSettings(JSON.parse(getSetting(db as any, NOTIF_SETTINGS_KEY) || 'null'))).catch(() => cleanNotifSettings(null))
  /** `notif`: the bell entry to use (fixed id, so the app's own copy isn't doubled). `urgent`: through quiet hours. */
  const send = async (text: string, reply_markup?: unknown, opts: { always?: boolean; notif?: Omit<Notif, 'readAt'>; urgent?: boolean } = {}): Promise<any> => {
    // Quiet hours (N6): only your own reminders (🔔 ⏰) and urgent things go to Telegram; the rest waits in the bell.
    if (!opts.urgent && quietNowSet(notifSet, now) && !/^\s*(🔔|⏰)/u.test(text)) {
      await mirror.write((db) => {
        const n = opts.notif ?? notifFromMessage(text, reply_markup, new Date())
        if (n) addNotif(db as any, n)
      }).catch(() => null)
      note('skipped', text, `Quiet hours (${notifSet.quiet.from}–${notifSet.quiet.to}): in the bell instead`)
      return false
    }
    // W21: at most 15 messages a day on his own; the rest go to the bell. Your reminders (🔔 ⏰),
    // urgent things (leave now) and event warnings always go through.
    const dayKey = now.toLocaleDateString('sv-SE')
    const own = !opts.urgent && !opts.notif && !/^\s*(🔔|⏰)/u.test(text)
    if (own) {
      const count = await mirror.read((db) => {
        try {
          const c = JSON.parse(getSetting(db as any, 'ben_sent_count') || 'null')
          return c?.day === dayKey ? Number(c.n) || 0 : 0
        } catch {
          return 0
        }
      })
      if (count >= 15) {
        await mirror.write((db) => {
          const n = notifFromMessage(text, reply_markup, new Date())
          if (n) addNotif(db as any, n)
        }).catch(() => null)
        note('skipped', text, "Today's message budget is used up: in the bell instead")
        return false
      }
    }
    // Each kind of message at most once a day (not the same water nudge 4 times).
    // Checked now, but marked as sent only once Telegram says ok (a failed send
    // is tried again on the next tick instead of counting as sent).
    const original = text
    const once = opts.always
      ? null
      : await mirror.read((db) => {
          let prev: SentToday | null = null
          try {
            prev = JSON.parse(getSetting(db as any, BEN_SENT) || 'null')
          } catch {
            /* start fresh */
          }
          return sendOnce(prev, text, now.toLocaleDateString('sv-SE'))
        })
    if (once && !once.send) {
      note('skipped', original, 'Already sent one like it today')
      return false
    }
    // Stealth mode: neutral words in everything Ben sends on his own (H14).
    if (await mirror.read((db) => getSetting(db as any, 'discipline_stealth') === '1').catch(() => false)) text = neutral(text)
    // Nudges in Ben's own words for this moment of your day (the fixed line if that fails).
    text = await voiced(text)
    const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.chatId, text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) })
    }).catch((e) => ({ status: 0, json: async () => ({ ok: false, description: (e as Error).message }) }) as any)
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!j.ok) {
      void beat(healthDb, 'telegram', false, j.description ?? `HTTP ${res.status}`)
      // Kept for the next ticks (up to 6 hours), so nothing is lost when Telegram hiccups.
      if (!opts.always) await mirror.write((db) => setSetting(db as any, OUTBOX, JSON.stringify(outboxAdd(readOutbox(db), { text: original, markup: reply_markup ?? null, at: now.getTime() })))).catch(() => null)
      note('failed', text, `Telegram: ${j.description ?? `HTTP ${res.status}`}${opts.always ? '' : ' (kept, tried again on the next tick)'}`)
      throw new Error(`Telegram: ${j.description ?? res.status}`)
    }
    if (once) {
      await mirror
        .write((db) => {
          let prev: SentToday | null = null
          try {
            prev = JSON.parse(getSetting(db as any, BEN_SENT) || 'null')
          } catch {
            prev = null
          }
          const r = sendOnce(prev, original, now.toLocaleDateString('sv-SE'))
          if (r.send) setSetting(db as any, BEN_SENT, JSON.stringify(r.next))
        })
        .catch(() => null)
    }
    void beat(healthDb, 'telegram', true)
    if (own)
      await mirror
        .write((db) => {
          let c = { day: dayKey, n: 0 }
          try {
            const p = JSON.parse(getSetting(db as any, 'ben_sent_count') || 'null')
            if (p?.day === dayKey) c = { day: dayKey, n: Number(p.n) || 0 }
          } catch {
            /* new day */
          }
          setSetting(db as any, 'ben_sent_count', JSON.stringify({ day: dayKey, n: c.n + 1 }))
        })
        .catch(() => null)
    sent.push(text)
    note('sent', text, text !== original ? 'In his own words for this moment' : undefined, messageKind(original) ?? undefined)
    // What the coach says on its own shows in the app's chat too (live).
    await mirror
      .write((db) => {
        const plain = text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        const mood = (Object.entries(MOOD_FACE).find(([, f]) => plain.trimStart().startsWith(f)) ?? [plain.trimStart().startsWith('🔔') ? 'annoyed' : 'chill'])[0]
        appendLog(db, [{ role: 'coach', bot: 'mega', via: 'telegram', text: plain, at: new Date().toISOString(), proactive: true, mood }])
        // …and in the bell, with the one thing to do about it.
        const n = opts.notif ?? notifFromMessage(text, reply_markup, new Date())
        if (n) addNotif(db as any, n)
      })
      .catch(() => null)
    return true
  }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const pauseRow = [
    { text: '😴 30 min', callback_data: 'ns|' },
    { text: '⏸ Pause today', callback_data: 'np|' }
  ]

  // 0) Messages Telegram refused on an earlier tick: try them again (newest 6 hours only).
  const box = await mirror.read((db) => readOutbox(db))
  if (box.length) {
    await mirror.write((db) => setSetting(db as any, OUTBOX, '[]')).catch(() => null)
    for (const m of box.filter((x) => now.getTime() - x.at < 6 * 3600_000)) await send(m.text, m.markup ?? undefined).catch(() => null)
  }

  const today0 = await mirror.read((db) => services.services(db).wallet.today(now))
  const tone = await mirror.read((db) => loadStyle(db).tone)
  // 1) Reminders and check-ins that are due.
  const reminders = await mirror.read((db) => {
    try {
      return JSON.parse(getSetting(db as any, REMINDERS_KEY) || '[]') as Reminder[]
    } catch {
      return [] as Reminder[]
    }
  })
  let list = reminders
  // "😴 30 min" and "⏸ Pause today" quiet the check-ins too, not only nudges (T1).
  const hush = await mirror.read((db) => {
    try {
      const n = JSON.parse(getSetting(db as any, NUDGES_KEY) || '{}')
      return n.pausedDay === today0 || (n.snoozeUntil && Date.parse(n.snoozeUntil) > now.getTime())
    } catch {
      return false
    }
  })
  for (const r of dueReminders(list, now)) {
    // Plain reminders you set still ring; Ben's check-ins wait.
    if (hush && r.kind === 'checkin') continue
    try {
      // Check-ins get sharper each time and name the week's missed promises.
      const went = await send(r.kind === 'checkin' ? followUpText({ ...r, text: esc(r.text) }, promiseStats(list, now), tone) : `⏰ ${esc(r.text)}`, r.kind === 'checkin' ? { inline_keyboard: [pauseRow] } : undefined, { always: true })
      // Only a message that really reached him moves the check-in on (and can count as ignored).
      if (!went) continue
      list = afterSend(list, r.id, now)
      // Never answered after every follow-up: an ignored promise (the scorecard counts it).
      if (list.find((x) => x.id === r.id)?.ignored) await bots.rhythm.countPromise(today0, 'ignored').catch(() => null)
    } catch {
      /* Telegram hiccup: next tick */
    }
  }
  if (list !== reminders) await mirror.write((db) => setSetting(db as any, REMINDERS_KEY, JSON.stringify(list)))

  // The daily rhythm: morning plan, water and training nudges, evening and Sunday reviews.
  try {
    await rhythmTick(env, now, send)
  } catch (e) {
    console.error('rhythm:', e)
    void logError(healthDb, 'server', `rhythm: ${(e as Error).message}`)
  }

  // Ben's desk: stakes enforced on time, study reviews, mood check-ins, the Sunday call.
  try {
    await deskTick(mirror, services, now, send, esc)
  } catch (e) {
    console.error('desk:', e)
  }

  // System health: Ben warns you when a part has been broken for 30+ minutes,
  // says when it works again, and sends a short report on Sunday evenings.
  try {
    await backupTick(healthDb, SQL, mirror, now)
    await healthTick(healthDb, mirror, now, send)
  } catch (e) {
    console.error('health:', e)
  }

  // Calendar watch (N10): a class added or cancelled today or tomorrow, checked every 10 minutes.
  if (calendar) {
    try {
      if (await sysClaim(healthDb, 'ben_cal_watch_at', now.getTime(), 10 * 60000)) {
        const end = new Date(now)
        end.setDate(end.getDate() + 2)
        end.setHours(0, 0, 0, 0)
        const evs = await calendar.events(now.toISOString(), end.toISOString())
        const seenNow: Seen = Object.fromEntries(evs.filter((e) => !e.allDay && !isFocusBlock(e)).map((e) => [e.id, { title: e.title, start: e.start, end: e.end }]))
        let prev: Seen | null = null
        try {
          // Older versions kept it in settings: read that once.
          prev = JSON.parse((await sysGet(healthDb, 'ben_cal_seen')) ?? (await mirror.read((db) => getSetting(db as any, 'ben_cal_seen'))) ?? 'null')
        } catch {
          prev = null
        }
        const must = await mirror.read((db) => services.services(db).focus.state(now).plan.items.find((x: any) => !x.done)?.text ?? null)
        await sysSet(healthDb, 'ben_cal_seen', JSON.stringify(seenNow))
        for (const ch of calendarChanges(prev, seenNow, now, must)) {
          const subject = (must ?? 'Focus').split(/\s+/).slice(0, 3).join(' ').slice(0, 28)
          // W19: something new over one of Ben's blocks → that block moves to the next free time that day.
          if (ch.kind === 'added' && calendar.move) {
            const s0 = Date.parse(ch.ev.start)
            const e0 = Date.parse(ch.ev.end)
            const hit = evs.filter((e) => isFocusBlock(e) && e.ours && Date.parse(e.start) < e0 && Date.parse(e.end) > s0)
            for (const b of hit) {
              const day = new Date(b.start).toLocaleDateString('sv-SE')
              const len = Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000)
              const after = day === now.toLocaleDateString('sv-SE') ? now.toTimeString().slice(0, 5) : '08:00'
              const slot = nextSlot(evs.filter((e) => e.id !== b.id), day, after, len)
              if (slot && (await calendar.move(b.calendarId, b.id, new Date(`${day}T${slot.start}:00`).toISOString(), new Date(`${day}T${slot.end}:00`).toISOString()).then(() => true).catch(() => false))) ch.text += `\n↪️ It was on top of <b>${escapeHtml(b.title)}</b>, so I moved that to ${slot.start}–${slot.end}.`
            }
          }
          await send(ch.text, ch.kind === 'cancelled' && ch.freeMin && ch.freeMin >= 25 ? { inline_keyboard: [[{ text: `▶ ${Math.min(90, ch.freeMin)} min: ${subject}`, callback_data: `fo|${subject}` }]] } : undefined, { always: true }).catch(() => null)
        }
      }
    } catch (e) {
      console.error('calendar watch:', e)
    }
  }

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
    // Water, reps (Sport Track's last save), a workout or a message to Ben count as doing something too (T2).
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    let sportAt = 0
    try {
      sportAt = num(JSON.parse(getSetting(db as any, 'sport_tracker_json') || 'null')?.savedAt)
    } catch {
      sportAt = 0
    }
    const chatAt = loadLog(db as any).filter((e) => e.role === 'me').pop()?.at
    const workoutAt = (db.prepare('SELECT MAX(ts) AS ts FROM workouts WHERE day = ?').get(today) as any)?.ts
    const extra = [sportAt, Date.parse(String(chatAt ?? '')), Date.parse(String(workoutAt ?? ''))].filter((t) => Number.isFinite(t) && t > 0 && t <= now.getTime())
    const last = Math.max(0, ...lastLedger, ...lastFocus, ...extra)
    // Up yet? From today's sleep log, not assumed (T2).
    const woke = (db.prepare('SELECT wake_time FROM sleep_logs WHERE day = ?').get(today) as any)?.wake_time
    return { nudge, today, focus: f, idleMin: last ? (now.getTime() - last) / 60000 : Infinity, tone: loadStyle(db).tone, wakeLogged: !!woke }
  })
  let nudge: NudgeState = st.nudge.day === st.today ? st.nudge : { ...st.nudge, day: st.today, count: 0, announced: [] }
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const paused = nudge.pausedDay === st.today
  // What's in the calendar around now (a class or meeting means: don't nag).
  const events = calendar ? await calendar.events(new Date(now.getTime() - 4 * 3600_000).toISOString(), new Date(now.getTime() + 15 * 60000).toISOString()).catch(() => []) : []
  const inEvent = events.some((e) => !e.allDay && !isFocusBlock(e) && Date.parse(e.start) <= now.getTime() && Date.parse(e.end) > now.getTime())
  if (calendar && !st.focus.running && !paused) {
    const starting = events.find((e) => isFocusBlock(e) && !(nudge.announced ?? []).includes(e.id) && Date.parse(e.start) - now.getTime() <= 10 * 60000 && Date.parse(e.end) - now.getTime() >= 15 * 60000)
    if (starting) {
      const mins = Math.round((Date.parse(starting.end) - Math.max(now.getTime(), Date.parse(starting.start))) / 60000)
      const subject = blockSubject(starting.title).slice(0, 28)
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
  // Classes and meetings (N2) and "leave now" (N3), not only focus blocks:
  // the same warnings (same ids) as the app makes, once each.
  if (calendar && notifSet.lead + Math.max(0, ...notifSet.travel.map((t) => t.minutes)) > 0) {
    const ahead = await calendar.events(now.toISOString(), new Date(now.getTime() + (Math.max(notifSet.lead, ...notifSet.travel.map((t) => t.minutes + 5)) + 15) * 60_000).toISOString()).catch(() => [])
    for (const w of eventAlerts(ahead, now, notifSet).filter((x) => !(nudge.announced ?? []).includes(x.id))) {
      const ev = ahead.find((e) => w.id.includes(`:${e.id}:`))
      const markup = ev?.meet ? { inline_keyboard: [[{ text: '🎥 Join', url: ev.meet }]] } : undefined
      try {
        await send(`${w.kind === 'leave' ? '🚶' : '📅'} <b>${esc(w.title)}</b>${w.body ? `\n${esc(w.body)}` : ''}`, markup, { always: true, notif: w, urgent: w.kind === 'leave' })
        nudge = { ...nudge, announced: [...(nudge.announced ?? []), w.id] }
      } catch {
        /* next tick */
      }
    }
  }
  // W2: a block that should be running but hasn't started: one nudge about THAT block,
  // and no "nothing done" nudge while a block is on (the plan is the nudge).
  const blockNow = events.find((e) => isFocusBlock(e) && Date.parse(e.start) <= now.getTime() - 10 * 60000 && Date.parse(e.end) - now.getTime() >= 15 * 60000)
  if (blockNow && !st.focus.running && !paused && st.idleMin >= 20 && !(nudge.announced ?? []).includes(`late:${blockNow.id}`)) {
    const subject = blockSubject(blockNow.title).slice(0, 28)
    const later = `bx|${blockNow.id}`.length <= 64 ? [{ text: '↪️ Next free time', callback_data: `bx|${blockNow.id}` }] : []
    try {
      if (await send(`⏰ ${time}: <b>${esc(blockNow.title)}</b> (${localIsoHM(blockNow.start)}–${localIsoHM(blockNow.end)}) hasn't started. Start now, or move it?`, { inline_keyboard: [[{ text: `▶ Start: ${subject}`, callback_data: `fo|${subject}` }, ...later], pauseRow] }, { always: true })) {
        nudge = { ...nudged(nudge, st.today, now, st.idleMin), announced: [...(nudge.announced ?? []), `late:${blockNow.id}`] }
        sent.push('plan-nudge')
      }
    } catch {
      /* next tick */
    }
  }
  const openMustDos = st.focus.plan.items.filter((x) => !x.done)
  const facts: NudgeFacts = { today: st.today, time, focusRunning: !!st.focus.running, focusMinToday: st.focus.todayMin, openMustDos: openMustDos.length, idleMin: st.idleMin, wakeLogged: st.wakeLogged }
  // Never "nothing done for 1h" while he's in class or a meeting.
  if (!sent.length && inEvent && !paused && shouldNudge(nudge, facts, now)) note('skipped', 'Nudge: nothing done for a while', 'You were in a class or meeting', 'nudge')
  // Your 👎 at this time of the week became a quiet rule (N9).
  const quiet = await mirror.read((db) => quietNow(quietRules(loadFeedback(db)), now)).catch(() => null)
  if (!sent.length && !inEvent && quiet && shouldNudge(nudge, facts, now)) note('skipped', 'Nudge: nothing done for a while', `${quiet.text} (learned from your 👎)`, 'nudge')
  if (!sent.length && !inEvent && !quiet && !blockNow && shouldNudge(nudge, facts, now)) {
    const n = (nudge.day === st.today ? nudge.count ?? 0 : 0) + 1
    const first = openMustDos[0]?.text
    const idle = Number.isFinite(st.idleMin) ? `${Math.floor(st.idleMin / 60) ? `${Math.floor(st.idleMin / 60)}h ` : ''}${Math.round(st.idleMin % 60)}m` : 'all day'
    const text = nudgeText(n, idle, first, st.focus.todayMin, st.tone)
    const subject = (first ?? 'Focus').split(/\s+/).slice(0, 4).join(' ').slice(0, 28)
    try {
      if (await send(text, { inline_keyboard: [[{ text: `▶ 50 min: ${subject}`, callback_data: `fo|${subject}` }], pauseRow] }, { always: true })) nudge = nudged(nudge, st.today, now, st.idleMin)
    } catch {
      /* next tick */
    }
  }
  if (JSON.stringify(nudge) !== JSON.stringify(st.nudge)) await mirror.write((db) => setSetting(db as any, NUDGES_KEY, JSON.stringify(nudge)))
  // The wind-down, 25–50 minutes before YOUR bedtime target (a fixed UTC cron
  // drifted an hour with daylight saving), once a day.
  try {
    const bed = await mirror.read((db) => services.services(db).sleep.bedtimeTarget())
    const bm = Number(bed.slice(0, 2)) * 60 + Number(bed.slice(3, 5))
    const before = (bm - (now.getHours() * 60 + now.getMinutes()) + 1440) % 1440
    if (before >= 25 && before <= 50) {
      const first = await mirror.write((db) => {
        if (getSetting(db as any, 'wind_down_day') === today0) return false
        setSetting(db as any, 'wind_down_day', today0)
        return true
      })
      if (first) sent.push(...(await runDaily(env as any, 'night')))
    }
  } catch (e) {
    console.error('wind-down:', e)
  }
  return sent
  }
}

const OUTBOX = 'ben_outbox'
type OutMsg = { text: string; markup: unknown; at: number }
const readOutbox = (db: any): OutMsg[] => {
  try {
    const v = JSON.parse(getSetting(db, OUTBOX) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
/** A message for the outbox (no duplicates, at most 20). */
export const outboxAdd = (list: OutMsg[], m: OutMsg): OutMsg[] => [...list.filter((x) => x.text !== m.text), m].slice(-20)

/** Stakes (points taken when time is up, a reminder an hour before), study reviews, mood, the Sunday call. */
async function deskTick(mirror: Mirror, services: any, now: Date, send: (text: string, markup?: unknown) => Promise<void>, esc: (s: string) => string): Promise<void> {
  // 0) W16: stakes the data already proves (focus minutes, a workout, a wake-up) settle by themselves.
  const proven = await mirror.write((db) => {
    const svc = services.services(db)
    const d = loadDesk(db)
    const f = svc.focus.state(now)
    const today = svc.wallet.today(now)
    const wake = (db.prepare('SELECT wake_time FROM sleep_logs WHERE day = ?').get(today) as any)?.wake_time ?? null
    const workout = (svc.wallet.summary(now).todayRules ?? []).includes('body.workout_done')
    const ok = d.stakes.filter((st: Stake) => st.status === 'open' && proofMet(st, { sessions: f.todaySessions, workoutSince: workout, wakeTime: wake }))
    if (!ok.length) return [] as Stake[]
    let stakes = d.stakes
    for (const st of ok) stakes = keepStake(stakes, st.id, now)
    saveDesk(db, { ...d, stakes })
    return ok
  }).catch(() => [] as Stake[])
  for (const st of proven) await send(esc(`💎 Stake kept, the log shows it: "${st.text}". Your ${st.points} points are safe.`)).catch(() => null)
  // 1) Stakes that ran out: the points go, once (the ledger ref makes it idempotent).
  const lost = await mirror.write((db) => {
    const svc = services.services(db)
    const d = loadDesk(db)
    const over = overdueStakes(d.stakes, now)
    if (!over.length) return [] as Stake[]
    for (const st of over) {
      const ref = `stake:${st.id}`
      if (!svc.wallet.entries().some((e: any) => e.ref === ref)) svc.wallet.append({ ts: now.toISOString(), day: svc.wallet.today(now), module: 'goals', kind: 'adjust', coins: -st.points, xp: 0, ref, note: `Stake lost: ${st.text}` } as any)
    }
    saveDesk(db, { ...d, stakes: loseStakes(d.stakes, over.map((x) => x.id), now) })
    return over
  })
  for (const st of lost) await send(esc(stakeLostText(st))).catch(() => null)
  const d = await mirror.read((db) => loadDesk(db))
  for (const st of d.stakes.filter((x) => x.status === 'open')) {
    const t = stakeRemindText(st, now)
    if (t) await send(esc(t), { inline_keyboard: [[{ text: '✅ Done', callback_data: `sk|${st.id}` }]] }).catch(() => null)
  }
  const h = now.getHours()
  const today = now.toLocaleDateString('sv-SE')
  // 2) Study topics due for review (between 10:00 and 21:00).
  const due = dueTopics(d.study, today)
  if (due.length && h >= 10 && h < 21) {
    await send(`📚 Review time: ${due.slice(0, 4).map((t) => `<b>${esc(t.exam)}</b> · ${esc(t.topic)}`).join(', ')}${due.length > 4 ? ` +${due.length - 4}` : ''}. 15 minutes each, from memory first.`, { inline_keyboard: due.slice(0, 3).map((t) => [{ text: `✅ Reviewed: ${t.topic}`.slice(0, 40), callback_data: `sr|${t.id}` }]) }).catch(() => null)
  }
  // 3) Mood check-in (one tap) at lunch and in the evening.
  const slot = moodDue(d.moods, now)
  if (slot && ((slot === 'noon' && h === 13) || (slot === 'evening' && h === 20))) {
    await send(slot === 'noon' ? '🙂 Lunch check-in: how do you feel right now?' : '🌙 Evening check-in: how was today, really?', { inline_keyboard: [MOOD_FACES.map((f, i) => ({ text: f, callback_data: `md|${i + 1}` }))] }).catch(() => null)
  }
  // 4) The Sunday coach call (in the app, 5 minutes).
  // Two hours after the Sunday review, not on top of it (T7).
  if (callDue(d.calls, now) && now.getDay() === 0 && h >= 20 && h < 22) {
    await send("🔁 Sunday review: look back, one change, next week's big 3, book the blocks. 5 minutes. Open Coach → <b>Sunday review</b>.").catch(() => null)
  }
  // 5) Never miss twice (D4): yesterday slipped → one message, once a day, from 10:00.
  if (h >= 10 && h < 20) {
    const line = await mirror.write((db) => {
      if (getSetting(db as any, 'ben_misstwice_day') === today) return null
      const items = coachStatus(services.services(db), now).missTwice
      if (!items.length) return null
      setSetting(db as any, 'ben_misstwice_day', today)
      return missTwiceLine(items)
    }).catch(() => null)
    if (line) await send(`🔗 ${esc(line)}`, { inline_keyboard: [[{ text: '▶ 15 min focus', callback_data: 'fo|15|Focus' }]] }).catch(() => null)
  }
}

/**
 * The daily cloud snapshot, made by the server so no device has to be open
 * (30 kept), and once a week a test restore of the newest one into a
 * throwaway database: Ben warns you if a backup wouldn't come back.
 */
async function backupTick(t: TursoHttp, SQL: SqlJsStatic, mirror: Mirror, now: Date): Promise<void> {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  await t.writeAtomic([{ sql: 'CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)', args: [] }] as any)
  const [have, notes] = await t.readMany([
    { sql: 'SELECT 1 FROM cloud_snapshots WHERE day = ?', args: [day] },
    { sql: "SELECT msg FROM sys_health WHERE key = 'note:drill'", args: [] }
  ] as any)
  if (!(have instanceof Error) && !have.rows.length) {
    try {
      const data = JSON.stringify(await mirror.read((db) => snapshotOf(db as any, "Ben's server", now)))
      const cut = new Date(now.getTime() - 30 * 86400000)
      await t.writeAtomic([
        { sql: 'INSERT INTO cloud_snapshots (day, exported_at, size_bytes, data) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO NOTHING', args: [day, now.toISOString(), Buffer.byteLength(data), data] },
        { sql: 'DELETE FROM cloud_snapshots WHERE day < ?', args: [`${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`] }
      ] as any)
    } catch (e) {
      void logError(t, 'server', `snapshot: ${(e as Error).message}`)
    }
  }
  let last: string | null = null
  try {
    last = notes instanceof Error ? null : JSON.parse(String(notes.rows[0]?.[0] ?? 'null'))
  } catch {
    last = null
  }
  if (last && now.getTime() - Date.parse(last) < 7 * 86400000) return
  await setNote(t, 'drill', now.toISOString())
  const [snap] = await t.readMany([{ sql: 'SELECT day, data FROM cloud_snapshots ORDER BY day DESC LIMIT 1', args: [] }] as any)
  if (snap instanceof Error || !snap.rows.length) return
  // Snapshots saved by the app are gzipped ("gz:" + base64, Y8).
  const raw = String(snap.rows[0][1])
  const text = raw.startsWith('gz:') ? gunzipSync(Buffer.from(raw.slice(3), 'base64')).toString('utf8') : raw
  const r = restoreDrill(SQL, text)
  await beat(t, 'restoreDrill', r.ok, r.ok ? undefined : `${snap.rows[0][0]}: ${r.msg}`, now)
}

async function healthTick(t: TursoHttp, mirror: Mirror, now: Date, send: (text: string) => Promise<void>): Promise<void> {
  const h = await readHealth(t)
  const local = await mirror.read((db) => ({
    sporty: (() => {
      try {
        return JSON.parse(getSetting(db as any, 'sport_sync_seen') || 'null')?.at ?? null
      } catch {
        return null
      }
    })(),
    today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }))
  const checks = healthChecks({ now, beats: h.beats, sportySeen: local.sporty, latestSnapshot: h.latestSnapshot, today: local.today, errors: h.errors })
  const d = alertDecisions(checks, h.notes.alerted ?? {}, now)
  if (d.warn.length || d.fixed.length) {
    await setNote(t, 'alerted', d.next)
    await send(alertText(d.warn, d.fixed)).catch(() => null)
  }
  // Sunday 21:00–21:59, once a week (after the review and the call: T7).
  const week = `${local.today}`
  if (now.getDay() === 0 && now.getHours() === 21 && h.notes.weekly !== week) {
    await setNote(t, 'weekly', week)
    await send(weeklyReport(checks, h.errors, now)).catch(() => null)
  }
}

/**
 * Ben acts instead of judging: a plan still waiting at 10:00 gets approved
 * (blocks into the calendar), and a planned block you missed moves into
 * your next free time, once, with Start / Drop buttons.
 */
async function benActs(env: BotEnv, now: Date, send: (text: string, markup?: unknown) => Promise<unknown>, state: RhythmState, on: boolean, time: string): Promise<void> {
  if (!on) return
  const { bots, mirror, calendar, services } = await botsFor(env)
  const mark = (patch: Partial<RhythmState>) =>
    mirror.write((db) => {
      const cur = rhythmFor(JSON.parse(getSetting(db as any, RHYTHM) || 'null'), state.day)
      setSetting(db as any, RHYTHM, JSON.stringify({ ...cur, ...patch, moved: [...new Set([...(cur.moved ?? []), ...(patch.moved ?? [])])], asked: [...new Set([...(cur.asked ?? []), ...(patch.asked ?? [])])] }))
    })
  // 10:00 and the plan is still waiting: one reminder (it's your plan: Ben doesn't approve it for you).
  if (autoApproveDue(state.briefing?.status, time, !!state.autoApproved)) {
    await mark({ autoApproved: true })
    await send(planWaitingText(state.briefing?.plan?.headline ?? 'your must-dos and blocks'), { inline_keyboard: [[{ text: '✅ Approve', callback_data: 'rb|a' }, { text: '✏️ Change', callback_data: 'rb|e' }, { text: '🔄 New plan', callback_data: 'rb|r' }]] })
  }
  if (!calendar?.move) return
  const day = state.day
  const events = await calendar.events(new Date(`${day}T00:00:00`).toISOString(), new Date(`${day}T23:59:59`).toISOString()).catch(() => null)
  if (!events) return
  const focus = await mirror.read((db) => services.services(db).focus.state(now))
  if (focus.running) return
  const sessions = focus.todaySessions
  for (const m of missedBlocks(events, sessions, now, state.asked ?? []).slice(0, 1)) {
    const subject = blockSubject(m.event.title).slice(0, 28)
    // Missed again after the move (K3): ask, don't skip it silently.
    if ((state.moved ?? []).includes(m.event.id)) {
      await mark({ asked: [m.event.id] })
      const tomorrow = `bt|${m.event.id}`.length <= 64 ? [{ text: '📅 Tomorrow', callback_data: `bt|${m.event.id}` }] : []
      const drop = `bd|${m.event.id}`.length <= 64 ? [{ text: '✕ Drop', callback_data: `bd|${m.event.id}` }] : []
      const stake = `sg|${subject}`.length <= 64 ? [[{ text: '🎯 Put 50 points on doing it today', callback_data: `sg|${subject}` }]] : []
      await send(missedTwiceText(m.event.title), { inline_keyboard: [[{ text: `▶ 25 min now`, callback_data: `fo|${subject}` }, ...tomorrow, ...drop], ...stake] })
      continue
    }
    await mark({ moved: [m.event.id] })
    const slot = nextSlot(events.filter((e) => e.id !== m.event.id), day, time, m.minutes)
    if (slot) await calendar.move(m.event.calendarId, m.event.id, new Date(`${day}T${slot.start}:00`).toISOString(), new Date(`${day}T${slot.end}:00`).toISOString()).catch(() => null)
    // The button carries the event's own id (fits Telegram's 64 bytes), never a list position.
    const drop = `bd|${m.event.id}`.length <= 64 ? `bd|${m.event.id}` : `bd|${(state.moved ?? []).length}`
    await send(movedText(m.event.title, slot), { inline_keyboard: [[{ text: `▶ Start now: ${subject}`, callback_data: `fo|${subject}` }, { text: '✕ Drop it', callback_data: drop }]] })
  }
  // W1: the day is slipping (2 blocks missed, or at 15:00 under 40% of the focus planned so far):
  // once a day, one card with the rest of today shrunk to fit.
  if (!state.rescued && time >= '11:00' && time < '20:00') {
    const ours = events.filter((e) => e.ours && !e.allDay && !e.title.includes('💪'))
    const pastMin = ours.filter((e) => Date.parse(e.end) <= now.getTime()).reduce((t, e) => t + (Date.parse(e.end) - Date.parse(e.start)) / 60000, 0)
    const behind = time >= '15:00' && pastMin >= 50 && focus.todayMin < pastMin * 0.4
    if ((state.moved ?? []).length >= 2 || behind) {
      const end = new Date(now)
      end.setHours(22, 0, 0, 0)
      const r = rescueFromEvents(events, now.getTime(), end.getTime())
      const changes = r.moves.filter((x) => x.action !== 'keep' && ours.some((e) => e.id === x.id))
      await mark({ rescued: true } as any)
      if (changes.length) {
        const t = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
        const lines = changes.map((x) => (x.action === 'tomorrow' ? `➡️ ${x.title} → tomorrow` : `${x.action === 'shrink' ? '✂️' : '↪️'} ${x.title} ${t(x.start!)}–${t(x.end!)}`))
        await send(`🛟 <b>Today slipped a bit.</b> Here's the rest of it, shrunk to fit (${r.freeMin} min still free):\n${lines.map(escapeHtml).join('\n')}`, { inline_keyboard: [[{ text: '✅ Do it', callback_data: 'rs|a' }, { text: 'Keep as is', callback_data: 'rs|n' }]] })
      }
    }
  }
}

async function rhythmTick(env: BotEnv, now: Date, send: (text: string, markup?: unknown, opts?: { always?: boolean }) => Promise<unknown>): Promise<void> {
  const { bots, services, mirror } = await botsFor(env)
  const f = await mirror.read((db) => {
    const svc = services.services(db)
    const today = svc.wallet.today(now)
    const prefs = cleanPrefs(JSON.parse(getSetting(db as any, RHYTHM_PREFS) || 'null'))
    const state = rhythmFor(JSON.parse(getSetting(db as any, RHYTHM) || 'null'), today)
    const row = db.prepare('SELECT wake_time, created_at FROM sleep_logs WHERE day = ?').get(today) as { wake_time?: string } | undefined
    const sl = svc.sleep
    let sport: any = null
    try {
      sport = JSON.parse(getSetting(db as any, 'sport_tracker_json') || 'null')?.data ?? null
    } catch {
      sport = null
    }
    const water = sport ? sharedView(sport, sportToday(now)).water : { ml: 0, target: 0 }
    let paused = false
    try {
      paused = JSON.parse(getSetting(db as any, NUDGES_KEY) || '{}').pausedDay === today
    } catch {
      paused = false
    }
    return {
      prefs,
      state,
      tone: loadStyle(db).tone,
      facts: {
        today,
        time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        weekday: now.getDay(),
        wakeAt: row?.wake_time ?? null,
        wakeTarget: targetForDay(today, sl.weekdayTarget(), sl.weekendTarget()),
        waterMl: water.ml,
        waterTarget: water.target,
        workoutDone: (svc.wallet.summary(now).todayRules ?? []).includes('body.workout_done') || !!svc.body.state().restToday,
        paused
      }
    }
  })
  // The training slot in today's approved plan: Ben opens the workout then.
  const slot = f.state.briefing?.status === 'approved' ? f.state.briefing.plan.training : null
  if (f.prefs.on && slot && !f.facts.workoutDone && !(f.state as any).slotSent && f.facts.time >= slot.time && f.facts.time < addMinutesHM(slot.time, 40)) {
    await mirror.write((db) => {
      const cur = rhythmFor(JSON.parse(getSetting(db as any, RHYTHM) || 'null'), f.facts.today)
      setSetting(db as any, RHYTHM, JSON.stringify({ ...cur, slotSent: true }))
    })
    const day = sportToday(now)
    const st = await mirror.read((db) => {
      try {
        return JSON.parse(getSetting(db as any, 'sport_tracker_json') || 'null')?.data ?? null
      } catch {
        return null
      }
    })
    const card = workoutCard(st ?? defaultSport(day), day)
    await send(`💪 <b>Training time</b> (${escapeHtml(slot.what)}). Let's go.\n\n${card.text}`, card.keyboard)
  }
  // 23:15: Ben reviews his own day (silent) and writes notes for tomorrow.
  if (f.prefs.on && f.facts.time >= '23:15' && !(f.state as any).selfReviewed) {
    await mirror.write((db) => {
      const cur = rhythmFor(JSON.parse(getSetting(db as any, RHYTHM) || 'null'), f.facts.today)
      setSetting(db as any, RHYTHM, JSON.stringify({ ...cur, selfReviewed: true }))
    })
    await bots.rhythm.selfReview().catch(() => null)
  }
  // Before your risky time (Ben learned it from when urges and resets happen): one heads-up.
  if (f.prefs.on && !f.facts.paused) {
    const risk = await mirror.read((db) => {
      const w = upcomingRisk(riskWindows(urgeEvents(db), now), now, 60)
      if (!w) return null
      const key = `${f.facts.today}:${w.weekday ?? 'd'}:${w.slot}`
      if (getSetting(db as any, 'discipline_warned') === key) return null
      return { key, text: warningText(w, topTriggers(loadTriggers(db), now)[0]?.trigger ?? null, getSetting(db as any, 'discipline_stealth') === '1') }
    })
    if (risk) {
      await mirror.write((db) => setSetting(db as any, 'discipline_warned', risk.key))
      await send(risk.text)
    }
  }
  await benActs(env, now, send, f.state, f.prefs.on, f.facts.time).catch((e) => console.error('ben acts:', e))
  const due0 = dueRhythm(f.state, f.prefs, f.facts)
  // W21: water and training due together go out as one message.
  const mergeWater = due0.includes('water') && due0.includes('training')
  const jobs = mergeWater ? due0.filter((x) => x !== 'water') : due0
  for (const job of jobs) {
    if (job === 'briefing') {
      // Mark it first: a slow model must not make two plans.
      const { plan, version } = await bots.rhythm.propose()
      await send(proposalText(plan, { version }), PROPOSAL_KEYBOARD)
    } else if (job === 'midweek') {
      const text = await bots.rhythm.midweek()
      await send(text, text.includes('Want them booked') ? { inline_keyboard: [[{ text: '📅 Book them', callback_data: 'rw|b' }]] } : undefined)
    } else if (job === 'replan') {
      // W8: no plan by noon: half a day left is still worth a plan.
      const { plan, version } = await bots.rhythm.propose()
      await send(`🕐 <b>Half a day left</b>: here's a plan for the rest of it.\n\n${proposalText(plan, { version })}`, PROPOSAL_KEYBOARD)
    } else if (job === 'water') {
      // Up to 5 a day when you're behind (K2): the cap and spacing live in waterBehind, so it's not "once a day".
      const line = await bots.rhythm.waterLine()
      if (line) {
        await send(line, { inline_keyboard: [[{ text: '😴 30 min', callback_data: 'ns|' }, { text: '⏸ Pause today', callback_data: 'np|' }]] }, { always: true })
        await bots.rhythm.markWater()
      }
    } else if (job === 'training') {
      // W21: water due at the same time rides along in one message.
      const water = mergeWater ? await bots.rhythm.waterLine().catch(() => null) : null
      const due = !!water
      await send(`${await bots.rhythm.trainingLine()}${due ? `\n\n${water}` : ''}`, { inline_keyboard: [[{ text: '🏋️ Start workout', callback_data: 'wk|show' }, { text: '😴 30 min', callback_data: 'ns|' }]] })
      if (due) await bots.rhythm.markWater()
    } else if (job === 'weekly') {
      const w = await bots.rhythm.weekly()
      await send(weeklyText(w), WEEKLY_KEYBOARD)
      // Ben's story so far about you, rewritten once a week (B5).
      await bots.rhythm.writeStory().catch(() => null)
      const letter = await bots.rhythm.letter().catch(() => null)
      if (letter) await send(`💌 <b>A letter from Ben</b>\n\n${escapeHtml(letter)}`)
    } else if (job === 'evening' && (await mirror.read((db) => (services.services(db).focus.state().plan.reasons?.length ?? 0) > 0).catch(() => false))) {
      // You already closed the day in the app (on any device): no evening review (Z3).
      await logBen(new TursoHttp(env.tursoUrl, env.tursoToken), [{ status: 'skipped', kind: 'evening review', reason: 'You closed the day in the app already' }]).catch(() => null)
    } else if (job === 'evening') {
      await payTodoistDone(env, { since: localMidnight(0) }).catch(() => null)
      const r = await bots.rhythm.evening()
      // Reaching the week's chosen focus pays a bonus once.
      const bonus = await mirror.write((db) => {
        const svc = services.services(db)
        const plan = svc.weekPlan.active()
        if (!plan) return ''
        const m = progressReport(svc.progress.input(null)).metrics.find((x) => x.id === plan.focus)
        if (!m?.target || m.now < m.target) return ''
        return payOnce(svc.wallet, `weekfocus:${plan.week}`, WEEK_FOCUS_POINTS, `Week focus reached: ${m.label}`) ? `\n\n🏆 Week focus reached: <b>${m.label}</b> (${m.text}). +${WEEK_FOCUS_POINTS} points.` : ''
      })
      const goalText = r.goals.length ? `\n\n🎯 <b>Goals</b>\n${r.goals.map((g) => escapeHtml(g)).join('\n')}${r.rebooked.length ? `\n${r.rebooked.map((x) => escapeHtml(x)).join('\n')}` : ''}` : ''
      const moneyText = r.money ? `\n\n💸 ${escapeHtml(r.money)}` : ''
      await send(reviewText(r.result, r.score, r.lesson, r.top3, f.tone) + goalText + moneyText + bonus, r.top3.length ? REVIEW_KEYBOARD : undefined)
    }
  }
}

/** The app: today's rhythm (state), or an action on it. */
export async function coachRhythm(env: BotEnv, op: { action: 'state' | 'propose' | 'approve' | 'top3' | 'prefs' | 'book' | 'letter' | 'month'; note?: string; prefs?: any }): Promise<any> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { bots, mirror, services } = await botsFor(env)
  // The month's letter: Ben's honest take on the month's story (saved; the app shows it).
  if (op.action === 'month') {
    const { story, goals } = await mirror.read((db) => {
      const svc = services.services(db)
      const v = deskView(svc, financeStateFrom(db, null))
      return { story: v.month, goals: loadProfile(db).goals }
    })
    const model = (env as any).model as AskModel | undefined
    let text = story.lines.join('\n')
    if (model) {
      try {
        text = (await model(monthTakePrompt(story, goals), { kind: 'letter' } as any)).trim().replace(/^```\w*|```$/g, '').trim() || text
      } catch {
        /* the numbers alone */
      }
    }
    await mirror.write((db) => deskChange(services.services(db), { op: 'letter', month: story.month, text }))
    return { letter: text }
  }
  // Book a goal's blocks for the next 7 days (note: the goal id, or all goals).
  if (op.action === 'book') {
    const id = Number(op.note)
    return bots.rhythm.bookGoals(Number.isFinite(id) && id > 0 ? [id] : undefined)
  }
  if (op.action === 'propose') await bots.rhythm.propose(String(op.note ?? '').slice(0, 500))
  if (op.action === 'approve') {
    const r = await bots.rhythm.approve()
    return { ...(await bots.rhythm.state()), done: r.done }
  }
  if (op.action === 'top3') await bots.rhythm.setTop3(String(op.note ?? ''))
  if (op.action === 'prefs') await bots.rhythm.setPrefs(op.prefs ?? {})
  if (op.action === 'letter') return { letter: await bots.rhythm.letter() }
  return bots.rhythm.state()
}

const addMinutesHM = (hm: string, m: number) => {
  const t = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + m
  return `${String(Math.min(23, Math.floor(t / 60))).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

const localIsoHM = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- Sporty (the Python bot) shares water and workouts through here --------
// POST /api/cron?job=sport with Authorization: Bearer <SPORT_SYNC_KEY>.
//   {op:'state'}                          → today's water and reps
//   {op:'water', ml}                      → add (or remove, negative) water
//   {op:'reps', name, amount}             → add reps to an exercise
//   {op:'workout', title, items?}         → a workout done (counts in Insights, +points)
//   {op:'poll', version, behind, latest}  → {update: true} when the Update Sporty button was pressed
//   {op:'updated', ok, updated, version}  → how that update went
export async function sportShared(env: BotEnv, body: any): Promise<{ ok: boolean; state?: SharedSport; exercise?: unknown; error?: string }> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { mirror, services } = await botsFor(env)
  const today = sportToday()
  const read = (db: any) => {
    try {
      return JSON.parse(getSetting(db, 'sport_tracker_json') || 'null')?.data ?? null
    } catch {
      return null
    }
  }
  const save = (db: any, st: any) => setSetting(db, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: st }))
  const op = String(body?.op ?? 'state')
  // Self-update: Sporty polls every minute; the Update Sporty button leaves a request.
  if (op === 'poll') {
    const r = await mirror.read((db) => pollSporty(parseJson<SportyStatus>(getSetting(db as any, SPORTY_STATUS)), parseJson<SportyRequest>(getSetting(db as any, SPORTY_REQUEST)), body, new Date()))
    if (r.save) await mirror.write((db) => setSetting(db as any, SPORTY_STATUS, JSON.stringify(r.status))).catch(() => null)
    return { ok: true, update: r.update } as any
  }
  if (op === 'updated') {
    await mirror.write((db) => setSetting(db as any, SPORTY_STATUS, JSON.stringify(sportyUpdated(parseJson<SportyStatus>(getSetting(db as any, SPORTY_STATUS)), body, new Date()))))
    return { ok: true }
  }
  // Remember when Sporty last talked to us (Ben and the app show it).
  await mirror.write((db) => setSetting(db as any, 'sport_sync_seen', JSON.stringify({ at: new Date().toISOString(), op }))).catch(() => null)
  if (op === 'state') return { ok: true, state: await mirror.read((db) => sharedView(read(db), today)) }
  // Never start an empty copy: it could replace the app's exercises on the next sync.
  if ((op === 'water' || op === 'reps') && !(await mirror.read((db) => read(db)))) return { ok: false, error: 'Open Sport Track in the Life System app once, so there is something to share' }
  if (op === 'water') {
    const ml = Number(body.ml)
    if (!Number.isFinite(ml) || Math.abs(ml) > 5000) return { ok: false, error: 'ml must be a number (−5000…5000)' }
    const state = await mirror.write((db) => {
      const st = addWater(read(db), ml, today)
      save(db, st)
      return sharedView(st, today)
    })
    return { ok: true, state }
  }
  if (op === 'reps') {
    const amount = Number(body.amount)
    if (!body.name || !Number.isFinite(amount) || Math.abs(amount) > 2000) return { ok: false, error: 'name and amount needed' }
    return mirror.write((db) => {
      const r = addReps(read(db), String(body.name), amount, today)
      if (!r) return { ok: false, error: `No exercise called "${body.name}" in Sport Track` }
      save(db, r.st)
      return { ok: true, exercise: r.exercise, state: sharedView(r.st, today) }
    })
  }
  if (op === 'workout') {
    const title = String(body.title || 'Workout').slice(0, 80)
    const items = Array.isArray(body.items) && body.items.length ? body.items : [{ exerciseId: 'ex_workout', name: title, amount: 1, unit: 'sets' }]
    // Its own day (Sporty sends past days too); never in the future or older than 60 days.
    const localToday = await mirror.read((db) => services.services(db).wallet.today())
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day ?? '')) && body.day <= localToday && body.day >= addDays(localToday, -60) ? String(body.day) : localToday
    const fromSporty = body.source === 'sporty'
    try {
      const added = await mirror.write((db) => {
        // One Sporty workout per day: sending the same day again changes nothing.
        if (fromSporty && db.prepare("SELECT 1 FROM workouts WHERE day = ? AND note = 'Sporty'").get(day)) return false
        services.services(db).body.logWorkout({ title, items, day, note: fromSporty ? 'Sporty' : undefined } as any)
        return true
      })
      return { ok: true, added, day, state: await mirror.read((db) => sharedView(read(db), today)) } as any
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  return { ok: false, error: 'op must be state | water | reps | workout | poll | updated' }
}
export { runBenEval } from './benEval'
