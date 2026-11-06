// The web / phone version of the app's bridge. Data lives in Turso; the app
// works on an in-browser copy of it (src/renderer/src/web/mirror.ts) and runs
// the same services as the desktop on that copy, so every section behaves the
// same as on the PC: caps, cooldowns, undo, shop, quests, streaks. Things only
// the web has (embedded apps, Telegram polling, cloud snapshots) are here.
import { cleanMusicNow } from '@core/music'
import { setupPasskey, unlockWithPasskey } from './web/passkey'
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { Bridge } from './bridge'
import { createMockApi } from './mock'
import { addDays, calendarDay, dayKey } from '@core/dates'
import type { BodyState, BotBridgeConfig, ConnectionsState, DisciplineState, Summary } from '@shared/api'
import { Mirror, indexedDbStore } from './web/mirror'
import { TursoHttp } from './web/tursoHttp'
import { createWebServices, financeDayTx, type WebServices } from './web/webServices'
import { financeSummary } from '@core/moneyDays'
import { createWebAuth } from './web/webAuth'
import { createFinanceInbox } from './web/financeInbox'
import { payTodoist } from './web/todoistCoins'
import { sportDay } from './sportTrack'
import type { TodoCompleted, TodoTask } from '@core/todoist'
import { SPORT } from './web/sportSync'
import { MAN, WAKY, createAppSync } from './web/appSync'
import { FINANCE } from './web/financeSync'
import { createWebAi, serverAi } from './web/webAi'
import { getSetting, setSetting, readSetting, writeSetting } from '../../main/settings'
import { cleanLooks, type CoachLooks } from '@core/coachLooks'
import { financeSpending } from '@core/progress'

/** What every screen listens to; sent when live data arrived. */
const LIVE_EVENTS = ['life-wallet-changed', 'life-discipline-changed', 'life-body-changed', 'life-focus-changed', 'life-week-changed', 'life-sport-changed', 'life-data-changed']
import type { CleanChange } from '@core/todoistClean'
import { TEMPLATES, upsertTemplate, type DayTemplate } from '@core/calTemplates'
import { editBlock, memoryView, pinFact, undoMemory } from './web/memoryStore'
import { financeStateFrom, sportState, addFeedback, loadLog, loadMemory, loadMind, loadProfile, loadStyle, saveMemory, saveMind, saveProfile, saveStyle, type CoachStyle } from './web/botBrain'
import { deskChange, deskView, type DeskOp } from './web/benDesk'
import type { CoachMind } from '@core/coachMind'
import { RHYTHM, RHYTHM_PREFS, cleanPrefs, rhythmFor } from '@core/rhythm'
import { COACH_HISTORY, cleanHistory, impactVerdict, scorecard } from '@core/coachImpact'
import { coachStatus } from './web/coachStatus'
import { backupTables, redactRows, restoreStatements } from '@core/backupPlan'
import { breaker, retryDelay } from '@core/retry'
import { riskWindows, topTriggers, windowLabel } from '@core/urgePatterns'
import { healthChecks } from '@core/health'
import { beat, logError, logErrors, readBenLog, readHealth, type ErrorReport } from './web/systemHealth'
import { addTrigger, loadTriggers, urgeEvents } from './web/disciplinePatterns'
import { addReminder, REMINDERS, type Reminder } from '@core/coachKit'
import { reminderDone, reminderSnooze } from '@core/healthyDay'
import { comebackPlan } from '@core/comeback'
import { neutral } from '@core/stealth'
import { addWater, sharedView, sportToday } from '@core/sportShared'
import { defaultSport } from '@core/sportCards'
import { SPORTY_REQUEST, SPORTY_STATUS, parseJson, sportyView, type SportyRequest, type SportyStatus } from '@core/sportyUpdate'

const sportyViewOf = (db: any) => sportyView(parseJson<SportyStatus>(getSetting(db, SPORTY_STATUS)), parseJson<{ at: string }>(getSetting(db, 'sport_sync_seen')), parseJson<SportyRequest>(getSetting(db, SPORTY_REQUEST)), new Date())
import { profileView } from './web/coachProfile'
import { addNotif, dismissNotif, listNotifs, readNotifs, snoozeNotif } from './web/notifications'
import { NOTIF_SETTINGS_KEY, cleanNotifSettings } from '@core/eventAlerts'
import { listNotes, removeNote, saveNote, seedNotes } from './web/notes'
import { PLUGINS_STATUS, parseJson as parsePluginJson, pluginKey, pluginsOn, setOn as setPluginOn, configKey as pluginConfigKey } from '../../plugins/store'
import { importBank, importText } from '../../plugins/bank'
import { addBlockResult, addFocusCheck, addFocusQuality, setDoingLine, setEyesLine, setPcLine, setWebLine } from './web/dayLog'
import { cleanNudgeStore, type NudgeStore } from '@core/islandNudges'
import { cleanRecipes, type Recipe } from '@core/recipes'
import { cleanAutoAsks, cleanStore, setAutoAsk, type AutoAsk, type AutomationStore } from '@core/automations'
import { cleanKit } from '@core/islandTiles'
import { cleanPcState, setAskStatus, type PcAsk } from '@core/pcActions'
import type { LastHour } from '@core/pcLastHour'
import { createExtras } from './web/lifeExtras'
import { createMoneyApi } from './web/moneyApi'
import { NetworkError, clearSession, currentSession, remembered, renewSession, serverChangePin, serverLogin, sessionValid, setRememberedFlag, signOutOthers, deviceCall } from './web/session'
import { MIGRATIONS } from '@core/schema'
import { cleanBlockKinds, setBlockKind, type BlockKind, type BlockKinds } from '@core/blockKind'

/**
 * /api/db with this page's database version (LT22): when the server is
 * newer, it refuses this page's writes and the "new version" bar asks for a reload.
 */
const schemaFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  headers.set('X-Life-Schema', String(MIGRATIONS.length))
  const res = await fetch(input, { ...init, headers })
  if (res.status === 409) window.dispatchEvent(new CustomEvent('life-schema-old'))
  return res
}

/**
 * A direct Turso connection, only for development and tests (set turso_url
 * and turso_token in localStorage). The live site has no keys in its code:
 * it goes through the server (api/db.mjs) after the PIN login.
 */

/** A server error in words, never "Coach 404" (U9). */
export function httpProblem(who: string, status: number): string {
  if (status === 401) return 'Your session ended: enter your PIN again.'
  if (status === 404) return `${who} isn't reachable right now (a new version may still be deploying). Reload in a minute.`
  if (status === 429) return `${who} is busy: too many requests. Try again in a minute.`
  if (status >= 500) return `${who} had a problem on the server. Try again in a minute.`
  return `${who} didn't answer (error ${status}). Try again.`
}

export function getTursoConfig(): { url: string; token: string } | null {
  try {
    const url = localStorage.getItem('turso_url')
    const token = localStorage.getItem('turso_token')
    return url && token ? { url, token } : null
  } catch {
    return null
  }
}

// The bot settings to start from; the tokens and chat come from the server.
const DEFAULT_WEB_BOT_CONFIG: BotBridgeConfig = {
  botToken: '',
  chatId: '',
  enabled: true,
  pollingEnabled: true,
  morningBriefing: true,
  eveningNudge: true,
  sportBotToken: '',
  sportBotChatId: '',
  financeBotToken: '',
  financeBotChatId: '',
  manBotToken: '',
  manBotChatId: '',
  wakyBotToken: '',
  wakyBotChatId: '',
  plannerBotToken: '',
  plannerBotChatId: '',
  coachBotToken: '',
  coachBotChatId: '',
  financeSyncEnabled: true
}

const store = typeof localStorage !== 'undefined' ? localStorage : null
const readJson = <T>(key: string): T | null => {
  try {
    const raw = store?.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** A Sport Track history entry's day: its id is a timestamp; its date is in the phone's own format. */
export function sportEntryDay(h: { id?: unknown; date?: unknown }): string | null {
  if (typeof h.id === 'number' && h.id > 1e12) return dayKey(new Date(h.id))
  const d = String(h.date ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(d) // 31.10.2026 (Romanian, Russian…)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d) // 10/31/2026 (US)
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}

/** Body, plus Sport Track's checklist on this device (its exercises and today's routine). */
function withSportTrack(state: BodyState): BodyState {
  const sport = readJson<any>('life_sport_tracker_v1')
  if (!sport || !Array.isArray(sport.exercises) || !sport.exercises.length) return state
  const t = state.today
  const fresh = sport.lastDate === sportDay()
  const routineDone = fresh && sport.exercises.filter((e: any) => e.active !== false).every((e: any) => (Number(e.doneToday) || 0) >= (Number(e.target) || 0) && Number(e.target) > 0)
  const historyToday = Array.isArray(sport.history) && sport.history.some((h: any) => sportEntryDay(h) === t)
  const workoutDoneToday = state.workoutDoneToday || routineDone || historyToday
  const streak = Math.max(state.streak, Number(sport.streak) || 0, workoutDoneToday ? 1 : 0)
  return {
    ...state,
    workoutDoneToday,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    exercises: sport.exercises.map((e: any, i: number) => ({
      id: String(e.id || `ex_${i}`),
      name: String(e.name || 'Exercise'),
      unit: !e.unit || String(e.unit).trim() === '1' ? 'reps' : String(e.unit).trim(),
      target: Number(e.target) || 0,
      category: 'calisthenics',
      sort: i,
      archived: e.active === false,
      // Today's reps from Sport Track (0 once its day has rolled over).
      doneToday: fresh ? Number(e.doneToday) || 0 : 0
    })) as BodyState['exercises']
  }
}

/** Discipline, shown with MAN's own streak when MAN keeps one on this device. */
// MN2: Life System's record (Turso) is the only streak. MAN on this device
// no longer fills in numbers; before setup, its streak is only offered as a
// suggested start date on the setup screen (connections.man.suggestion).
function withMan(state: DisciplineState): DisciplineState {
  return state
}

const SNAPSHOT_TABLES = [
  'ledger', 'tasks', 'task_done', 'categories', 'rules', 'rewards', 'redemptions', 'reward_vault_ledger',
  'discipline_events', 'sleep_logs', 'expenses', 'workouts', 'body_metrics', 'exercises', 'wishlist_goals',
  'blocks', 'block_log', 'settings'
]

// A short-lived shared result: calls in the same moment (several cards
// loading together) share one read; any change clears it.
const sharedCache = new Map<string, { at: number; p: Promise<unknown> }>()
function shared<T>(key: string, load: () => Promise<T>, ms = 1500): Promise<T> {
  const hit = sharedCache.get(key)
  if (hit && Date.now() - hit.at < ms) return hit.p as Promise<T>
  const p = load()
  sharedCache.set(key, { at: Date.now(), p })
  p.catch(() => sharedCache.delete(key))
  return p
}
const forgetShared = () => sharedCache.clear()

export function createTursoWebBridge(): Bridge {
  const base = createMockApi()
  const direct = getTursoConfig()
  const lockListeners = new Set<() => void>()
  let unlocked = false
  // "Lock now" on a remembered device still locks until the PIN.
  let lockedOnPurpose = false
  const lockNow = () => {
    unlocked = false
    lockListeners.forEach((cb) => cb())
  }
  // The server said the session is over: ask for the PIN again.
  const turso = direct
    ? new TursoHttp(direct.url, direct.token)
    : new TursoHttp(
        '/api/db',
        currentSession,
        () => {
          clearSession()
          lockNow()
        },
        schemaFetch
      )
  // LT3: sessions last 14 days and are renewed while the app is in use (a tab left open too).
  if (!direct) setInterval(() => void renewSession(), 6 * 3600_000)

  // Nothing is fetched before there's a session (the first PIN on a device).
  let haveSession: () => void = () => {}
  const sessionReady = new Promise<void>((resolve) => (haveSession = resolve))
  if (direct || sessionValid(currentSession())) haveSession()
  // The server session may expire during a trip. A previously downloaded
  // desktop database still opens with its locally verified PIN while offline.
  if (window.desktop) void window.desktop.load().then((bytes) => { if (bytes) haveSession() })

  // Starts loading at once; every call below waits for it.
  const mirrorP: Promise<Mirror> = Promise.all([initSqlJs({ locateFile: () => sqlWasmUrl }), sessionReady]).then(
    ([SQL]) => new Mirror(SQL, turso, window.desktop ? { load: () => window.desktop!.load(), save: (bytes) => window.desktop!.save(bytes) } : typeof indexedDB !== 'undefined' ? indexedDbStore() : null, !!window.desktop)
  )
  const svcP: Promise<WebServices> = mirrorP.then((m) => createWebServices(m))
  const authP = mirrorP.then((m) => createWebAuth(m))
  // The embedded apps' data (Sport Track, Finance Helper, Waky, MAN) lives in
  // this browser: copied to Turso and back so every device shows the same.
  const syncsP = mirrorP.then((m) => {
    // Waky's mornings and nights also go into the sleep log (where it has no time yet).
    const wakyToSleep = () =>
      void svcP
        .then((s) => s.sleep.fromWaky())
        .then((r) => {
          if (r.wakes || r.beds) window.dispatchEvent(new CustomEvent('life-sleep-changed'))
        })
        .catch(() => null)
    const list = [SPORT, FINANCE, WAKY, MAN].map((spec) => createAppSync(m, spec, undefined, spec === WAKY ? wakyToSleep : undefined))
    for (const s of list) void s.sync()
    return list
  })
  const syncAll = () => syncsP.then((list) => Promise.all(list.map((s) => s.sync())))
  if (typeof window !== 'undefined') {
    // The app saved (its page is a same-site frame, so this page hears it).
    window.addEventListener('storage', (e) => syncsP.then((list) => list.find((s) => s.spec.localKey === e.key)?.soon()))
    // Changed here (the bot, the daily quest, the Telegram inbox), not by a sync.
    for (const spec of [SPORT, FINANCE, WAKY, MAN]) {
      window.addEventListener(spec.event, (e) => {
        if ((e as CustomEvent).detail?.fromSync) return
        syncsP.then((list) => list.find((s) => s.spec === spec)?.soon())
      })
    }
  }
  // Telegram expenses waiting for Finance Helper on this device.
  const financeP = mirrorP.then((m) => {
    const inbox = createFinanceInbox(m)
    void inbox.apply().catch(() => 0)
    return inbox
  })
  const applyFinance = () => financeP.then((f) => f.apply()).catch(() => 0)
  const botDefaultsP: Promise<BotBridgeConfig> = direct
    ? Promise.resolve(DEFAULT_WEB_BOT_CONFIG)
    : sessionReady
        .then(() => fetch('/api/config', { headers: { Authorization: `Bearer ${currentSession()}` } }))
        .then((r) => (r.ok ? r.json() : {}))
        .then(async (j: any) => {
          // Point the bots at the server so they answer 24/7 (no device
          // needed); when that works this page stops reading them itself.
          // Once a day is enough (Y10): the webhook stays set between visits.
          const SETUP = 'life_bot_setup_ok'
          const lastOk = Number(store?.getItem(SETUP) ?? 0)
          if (Date.now() - lastOk < 24 * 3600_000) return { ...DEFAULT_WEB_BOT_CONFIG, ...(j?.bots ?? {}), serverBots: true }
          const setup = await fetch('/api/bot-setup', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}` } })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
          if (setup?.ok) store?.setItem(SETUP, String(Date.now()))
          else store?.removeItem(SETUP)
          return { ...DEFAULT_WEB_BOT_CONFIG, ...(j?.bots ?? {}), serverBots: !!setup?.ok }
        })
        .catch(() => DEFAULT_WEB_BOT_CONFIG)
  // CL7: reading Todoist or Google over and over while they fail helps nobody:
  // after 3 failures in a row the background reads pause (1 min, then longer);
  // what you press yourself always goes through.
  const POLLING = new Set(['changes', 'today', 'upcoming', 'everything', 'events', 'status'])
  const todoistBreak = breaker()
  const googleBreak = breaker()
  const paused = (who: string, b: ReturnType<typeof breaker>) => new Error(`${who} is not answering: trying again at ${new Date(b.pausedUntil).toTimeString().slice(0, 5)}`)
  // Todoist through the server (the token stays there).
  const todoistCall = async (op: string, extra: Record<string, unknown> = {}): Promise<any> => {
    if (direct) return { connected: false }
    const poll = POLLING.has(op)
    if (poll && !todoistBreak.allow()) throw paused('Todoist', todoistBreak)
    try {
      const r = await fetch('/api/todoist', {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, ...extra })
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || httpProblem('Todoist', r.status))
      todoistBreak.ok()
      return j
    } catch (e) {
      if (poll) todoistBreak.fail()
      throw e
    }
  }
  // Google Calendar through the server (the sign-in stays sealed there).
  const googleCall = async (op: string, extra: Record<string, unknown> = {}): Promise<any> => {
    if (direct) return { connected: false, configured: false, events: [] }
    const poll = POLLING.has(op)
    if (poll && !googleBreak.allow()) throw paused('Google Calendar', googleBreak)
    try {
      // 25 s at most: a stuck request must never leave "Loading your day…" up forever.
      const r = await fetch('/api/google', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...extra }), signal: AbortSignal.timeout(25_000) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.error) throw new Error(j.error || httpProblem('Google Calendar', r.status))
      googleBreak.ok()
      return j
    } catch (e) {
      if (poll) googleBreak.fail()
      throw e
    }
  }
  let googleOn: Promise<boolean> | null = null
  const googleConnected = () => (googleOn ??= sessionReady.then(() => google.status()).then((j: any) => !!j.connected).catch(() => false))
  // CL2: one shared copy of your calendar for Today, the Now card, the day
  // strip, the alerts and the island. Fresh for a minute while you look; while
  // the page is hidden nothing is asked (the desktop app, in the tray, every 5
  // minutes for the island). Changing an event clears it.
  let gStatus: { at: number; j: any } | null = null
  let gWins: { from: number; to: number; at: number; events: any[] }[] = []
  // A minute while you use the app; 5 minutes when it sits open untouched (or in the desktop tray).
  let lastInput = Date.now()
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => (lastInput = Date.now()), { passive: true })
  const calendarTtl = () => (document.visibilityState === 'visible' ? (Date.now() - lastInput < 3 * 60_000 ? 60_000 : 5 * 60_000) : window.desktop ? 5 * 60_000 : Infinity)
  const forgetCalendar = () => {
    gWins = []
  }
  const google = {
    status: async () => {
      if (gStatus && Date.now() - gStatus.at < 10 * 60_000) return gStatus.j
      const j = await googleCall('status').catch((e) => ({ configured: true, connected: false, error: (e as Error).message }))
      googleOn = Promise.resolve(!!j.connected)
      gStatus = j.error ? null : { at: Date.now(), j }
      return j
    },
    connect: async () => {
      gStatus = null
      const j = await googleCall('connect')
      if (j.url) window.location.href = j.url
    },
    events: async (from: string, to: string) => {
      if (!(await googleConnected())) return []
      const f = Date.parse(from)
      const t = Date.parse(to)
      const pick = (w: { events: any[] }) => w.events.filter((e) => Date.parse(e.end) > f && Date.parse(e.start) < t)
      const hit = gWins.find((w) => w.from <= f && w.to >= t)
      if (hit && (Date.now() - hit.at < calendarTtl() || document.visibilityState !== 'visible' && !window.desktop)) return pick(hit)
      // Around today, ask for a little more (today and the next two days), so the next asks are answered from here.
      const day0 = new Date()
      day0.setHours(0, 0, 0, 0)
      const near = f >= day0.getTime() - 86400_000 && t <= day0.getTime() + 3 * 86400_000
      const wf = near ? Math.min(f, day0.getTime()) : f
      const wt = near ? Math.max(t, day0.getTime() + 2 * 86400_000 + 4 * 3600_000) : t
      const events = ((await googleCall('events', { from: new Date(wf).toISOString(), to: new Date(wt).toISOString() })).events ?? []) as any[]
      const win = { from: wf, to: wt, at: Date.now(), events }
      gWins = [win, ...gWins.filter((w) => !(w.from >= wf && w.to <= wt))].slice(0, 6)
      return pick(win)
    },
    create: async (e: Record<string, unknown>) => {
      forgetCalendar()
      return (await googleCall('create', e)).event
    },
    move: async (calendarId: string, id: string, start: string, end: string) => {
      forgetCalendar()
      await googleCall('move', { calendarId, id, start, end })
    },
    update: async (calendarId: string, id: string, patch: Record<string, unknown>) => {
      forgetCalendar()
      await googleCall('update', { calendarId, id, ...patch })
    },
    remove: async (calendarId: string, id: string) => {
      forgetCalendar()
      await googleCall('remove', { calendarId, id })
    },
    setCalendars: async (on: string[], target: string | null) => {
      forgetCalendar()
      gStatus = null
      await googleCall('setCalendars', { on, target })
    },
    disconnect: async () => {
      forgetCalendar()
      gStatus = null
      await googleCall('disconnect')
      googleOn = Promise.resolve(false)
    }
  }

  const todoist = {
    today: async () => ((await todoistCall('today')).tasks ?? []) as TodoTask[],
    close: async (id: string) => {
      await todoistCall('close', { id })
    },
    quickAdd: async (text: string, area?: string) => (await todoistCall('quick', { text, area })).task as TodoTask
  }
  const todoistOnP: Promise<boolean> = sessionReady
    .then(() => todoistCall('status'))
    .then((j) => !!j.connected)
    .catch(() => false)
  let todoistSyncedAt = 0
  // The bots' code (big) loads on first use, not with the app.
  type Bots = ReturnType<typeof import('./web/webBots').createWebBots>
  let botsMade: Promise<Bots> | null = null
  const makeBots = () => (botsMade ??= Promise.all([mirrorP, svcP, botDefaultsP, todoistOnP, import('./web/webBots')]).then(([mirror, services, defaults, todoOn, { createWebBots }]) => createWebBots({ mirror, services, defaults, onExpense: () => void applyFinance(), todoist: todoOn ? todoist : null })))
  // Awaitable like a promise, but nothing loads until something asks for the bots.
  const botsP: PromiseLike<Bots> = { then: (ok, no) => makeBots().then(ok, no) }

  // Live data: while the app is open it asks Turso "anything new?" every few
  // seconds (one tiny query; every change anywhere moves a marker). When a
  // bot, the phone or another tab changed something, the copy reloads and
  // every screen redraws by itself. Fast (3 s) while you use the app, slower
  // when it sits in the background, paused when the tab is hidden.
  if (typeof window !== 'undefined') {
    let lastUse = Date.now()
    // Back after a while: look for changes right away (not at the next slow round).
    let wake: (() => void) | null = null
    for (const ev of ['pointerdown', 'keydown', 'focus', 'touchstart'])
      window.addEventListener(
        ev,
        () => {
          const was = lastUse
          lastUse = Date.now()
          if (lastUse - was > 60_000) wake?.()
        },
        { passive: true }
      )
    const announce = () => {
      for (const n of LIVE_EVENTS) window.dispatchEvent(new CustomEvent(n, { detail: { live: true, fromSync: true } }))
    }
    const tab = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('life-live') : null
    let checking = false
    /** True when the server answered (the copy is current or was reloaded). */
    const check = async (force = false): Promise<boolean> => {
      if (checking) return true
      checking = true
      try {
        const m = await mirrorP
        const changed = await m.refresh()
        if (changed || force) {
          await applyFinance().catch(() => {})
          await syncAll().catch(() => {})
          announce()
        }
        return !!m.syncedAt && Date.now() - Date.parse(m.syncedAt) < 60_000
      } catch {
        /* offline: the next check retries */
        return false
      } finally {
        checking = false
      }
    }
    // Another tab of this app wrote something: check now.
    if (tab) tab.onmessage = () => void check()
    void mirrorP.then((m) => m.onChange(() => (forgetShared(), tab?.postMessage('changed'))))
    let todoAt = 0
    let tickAt = 0
    let todoQuickAt = 0
    // Todoist's sync token: null = not started, '' = Todoist off or failing (stop asking).
    let todoToken: string | null = null
    const todoistChanged = async (): Promise<boolean> => {
      if (todoToken === '' || !(await todoistOnP)) return false
      try {
        const j = await todoistCall('changes', { token: todoToken ?? '*' })
        const first = todoToken === null
        todoToken = String(j.token || '') || null
        return !first && Number(j.changed) > 0
      } catch {
        return false
      }
    }
    // How lively to be: you're using it (every 3 s), it's open but you're away
    // (every 20 s), away for long (every 60 s), in the background (5 min). Fewer
    // server calls, and changes still show within seconds when you look.
    // CL2: a tab left open and untouched asks far less (about 70 calls an hour
    // instead of 450): the data every 90 s, Ben's timer and the outside apps
    // every 10 minutes. Touch it and it is lively again at once.
    const pace = (): { db: number; todo: number; ext: number; tick: number } => {
      const idle = Date.now() - lastUse
      // In the background: every 5 minutes (coming back checks at once anyway: Y10).
      if (document.visibilityState !== 'visible') return { db: 300_000, todo: Infinity, ext: Infinity, tick: Infinity }
      if (idle < 3 * 60_000 && document.hasFocus()) return { db: 3000, todo: 5000, ext: 30_000, tick: 120_000 }
      if (idle < 15 * 60_000) return { db: 20_000, todo: 60_000, ext: 120_000, tick: 120_000 }
      return { db: 90_000, todo: 600_000, ext: 600_000, tick: 600_000 }
    }
    // CL7: the server not answering: wait longer each time (5 s … 4 min), not every few seconds.
    // (Saving a change in between waits too: see Mirror.flushOffline.)
    let fails = 0
    const loop = async () => {
      const p = pace()
      if (document.visibilityState === 'visible') {
        const ok = await check()
        fails = ok ? 0 : fails + 1
        // Wake the coach (reminders, check-ins, follow-ups) more often than the server timer.
        if (!direct && ok && Date.now() - tickAt > p.tick) {
          tickAt = Date.now()
          void fetch('/api/cron?job=tick', { headers: { Authorization: `Bearer ${currentSession()}` } }).catch(() => null)
        }
        // Todoist: a task added or done in Todoist itself shows up within
        // seconds (a cheap "anything new?" every 5 s while you're here).
        if (!direct && Date.now() - todoQuickAt > p.todo) {
          todoQuickAt = Date.now()
          void todoistChanged().then((changed) => {
            if (!changed) return
            window.dispatchEvent(new CustomEvent('life-external-changed'))
            bridge.todoist?.sync().catch(() => 0)
          })
        }
        // Google Calendar changes made in its own app (and a safety net for Todoist): every 30 s.
        if (ok && Date.now() - todoAt > p.ext) {
          todoAt = Date.now()
          window.dispatchEvent(new CustomEvent('life-external-changed'))
          bridge.todoist?.sync().catch(() => 0)
        }
      }
      setTimeout(loop, fails ? Math.max(pace().db, retryDelay(fails - 1, { max: 4 * 60_000 })) : pace().db)
    }
    setTimeout(loop, 3000)
    wake = () => void check()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        todoAt = 0
        fails = 0
        void check(true)
      }
    })
  }

  /**
   * `ns.method(...)` on the services once they're ready; `own` replaces some
   * methods. (A Proxy has no keys of its own, so spreading it gives an empty
   * object: that lost every discipline and body action but `state`.)
   */
  const S = <K extends keyof WebServices>(ns: K, own: Record<string, (...a: any[]) => any> = {}) =>
    new Proxy({} as WebServices[K], {
      get: (_t, method: string) =>
        own[method] ??
        (async (...args: unknown[]) => {
          const svc = (await svcP)[ns] as any
          return svc[method](...args)
        })
    })

  /** "gz:" + base64 of the gzipped JSON (plain JSON when the browser can't compress). */
  const packSnapshot = async (json: string): Promise<string> => {
    if (typeof CompressionStream === 'undefined') return json
    const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
    let bin = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return `gz:${btoa(bin)}`
  }
  const unpackSnapshot = async (data: string): Promise<string> => {
    if (!data.startsWith('gz:')) return data
    const bin = atob(data.slice(3))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  }

  // Through /api/db the backups can only be read (LT1): the server makes the table.
  const ensureSnapshotsTable = async () => {
    if (direct) await turso.writeAtomic([{ sql: 'CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)', args: [] }])
  }

  /** Everything, for the export and the daily snapshot. */
  const snapshot = async () => {
    const mirror = await mirrorP
    const tables = await mirror.read((db) => {
      const out: Record<string, unknown[]> = {}
      // Every data table (focus, day plans, … too), not a fixed list.
      const all = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => String(r.name))
      for (const t of backupTables([...new Set([...SNAPSHOT_TABLES, ...all])])) {
        try {
          out[t] = redactRows(t, db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[])
        } catch {
          /* a table this database doesn't have */
        }
      }
      return out
    })
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      source: 'Life System Web',
      tables,
      financeState: readJson('finance-helper.state'),
      wakyState: readJson('waky_web_data_v2'),
      sportState: readJson('life_sport_tracker_v1'),
      manState: readJson('MAN_SPARTAN_DATA')
    }
  }

  const ERRORS = 'life_error_log'
  const readErrors = (): any[] => readJson<any[]>(ERRORS) ?? []
  const prefs = () => ({ openAtLogin: false, canAutoStart: false, keepInTray: false, matchAppThemes: store?.getItem('life_match_themes') !== '0' })
  const upToDate = () => ({ current: 'web', state: 'up-to-date' as const, latest: null, progress: 0, error: null, checkedAt: new Date().toISOString() })
  const snapshotDays = async (): Promise<string[]> => ((await bridge.data.cloudSnapshots?.()) ?? []).map((x: any) => x.day)
  // CL2: the list of cloud backups changes once a day: asked at most once an hour (it was every minute).
  let backupDays: { at: number; days: string[] } | null = null
  const backupStatus = async () => {
    if (!backupDays || Date.now() - backupDays.at > 3600_000) backupDays = { at: Date.now(), days: await snapshotDays() }
    const days = backupDays.days
    return { dir: 'Turso cloud (daily snapshot, 30 kept)', driveAvailable: false, passphraseSet: true, last: days[0] ? { name: days[0], at: days[0] } : null, pending: 0, count: days.length, lastError: store?.getItem('life_snapshot_error') ?? null }
  }
  const aiOnP: Promise<boolean> = direct
    ? Promise.resolve(false)
    : sessionReady
        .then(() => fetch('/api/ai', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: '{"op":"status"}' }))
        .then((r) => (r.ok ? r.json() : {}))
        .then((j: any) => !!j.configured)
        .catch(() => false)
  const aiP = svcP.then((svc) => createWebAi(svc, serverAi(currentSession), () => aiOnP, { on: () => todoistOnP, quickAdd: (text) => todoist.quickAdd(text) }))
  // CL2: Ben's log is read every minute by several cards; each read used to ask the server too
  // (175 calls an idle hour). The live loop keeps the copy fresh; here only a copy over 5 minutes old is refreshed.
  const freshCopy = async () => {
    const m = await mirrorP
    if (!m.pendingOffline && (!m.syncedAt || Date.now() - Date.parse(m.syncedAt) > 5 * 60_000)) await m.refresh().catch(() => false)
  }
  const syncNow = async () => {
    const m = await mirrorP
    await m.refresh()
    await applyFinance()
    await syncAll()
    for (const n of ['life-wallet-changed', 'life-discipline-changed', 'life-body-changed']) window.dispatchEvent(new CustomEvent(n))
    return m
  }

  const bridge = {
    ...base,
    google,
    coach: {
      // The answer streams: live steps ("Reading your calendar…"), then the reply.
      quick: async (text: string) => (await botsP).quick(text),
      chat: async (text: string, onStep?: (step: string) => void, media?: { mime: string; data: string }, onDelta?: (replySoFar: string) => void) => {
        const r = await fetch('/api/coach', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, ...(media ? { media } : {}) }) })
        if (!r.ok || !r.body) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || httpProblem('Ben', r.status))
        }
        const reader = r.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let last: any = null
        for (;;) {
          const { value, done } = await reader.read()
          if (value) buf += dec.decode(value, { stream: true })
          let nl
          while ((nl = buf.indexOf('\n')) >= 0) {
            const raw = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!raw) continue
            try {
              const o = JSON.parse(raw)
              if (typeof o.step === 'string') onStep?.(o.step)
              else if (typeof o.delta === 'string') onDelta?.(o.delta)
              else last = o
            } catch {
              /* a broken line: skip */
            }
          }
          if (done) break
        }
        if (buf.trim()) {
          try {
            last = JSON.parse(buf.trim())
          } catch {
            /* ignore */
          }
        }
        if (!last) throw new Error('The coach gave no answer')
        if (last.error && !last.reply) throw new Error(last.error)
        // The coach may have logged, planned or added things: everything refreshes.
        void syncNow().catch(() => null)
        return last
      },
      memory: async () => freshCopy().then(() => svcP).then((svc) => svc.read((s) => ({ facts: loadMemory(s.db).facts }))),
      setFacts: async (facts: { t: string; at: string }[]) => {
        await (await svcP).write((s) => saveMemory(s.db, { ...loadMemory(s.db), facts }))
      },
      mind: async () => (await svcP).read((s) => loadMind(s.db)),
      // 👍 / 👎 / too long / wrong on one of Ben's replies (saved here; Ben reads it).
      feedback: async (at: string, kind: 'up' | 'down' | 'long' | 'wrong') =>
        (await svcP).write((s) => {
          const e = loadLog(s.db).find((x) => x.role === 'coach' && x.at === at)
          addFeedback(s.db, { at, kind, text: e?.text ?? '' })
        }),
      water: async (ml: number) =>
        (await svcP).write((s) => {
          const day = sportToday()
          const next = addWater(sportState(s.db) ?? defaultSport(day), ml, day)
          writeSetting(s.db, 'sport_tracker_json', { savedAt: Date.now(), data: next })
          return sharedView(next, day).water
        }),
      // HD: your reminders (the same list Ben's ⏰ uses): read, add, Done, Snooze. The server sends each to Telegram once.
      reminders: async () =>
        (await svcP).read((s) => {
          try {
            return (readSetting(s.db as any, REMINDERS) as Reminder[]) ?? []
          } catch {
            return [] as Reminder[]
          }
        }),
      remind: async (op: { op: 'add'; text: string; at: number } | { op: 'done'; id: string } | { op: 'snooze'; id: string; minutes: number }) => {
        const line = await (await svcP).write((s) => {
          let list: Reminder[] = []
          try {
            list = readSetting(s.db as any, REMINDERS) ?? []
          } catch {
            list = []
          }
          const now = Date.now()
          if (op.op === 'add') {
            const text = String(op.text ?? '').trim().slice(0, 120)
            if (!text || !Number.isFinite(op.at) || op.at < now - 60_000) throw new Error('That reminder needs a time from now on')
            writeSetting(s.db as any, REMINDERS, addReminder(list, { at: new Date(op.at).toISOString(), text, kind: 'remind' }))
            return `⏰ ${new Date(op.at).toTimeString().slice(0, 5)}${new Date(op.at).toDateString() !== new Date().toDateString() ? ' tomorrow' : ''}: ${text}`
          }
          if (!list.some((r) => r.id === op.id)) throw new Error('That reminder is gone')
          if (op.op === 'done') {
            writeSetting(s.db as any, REMINDERS, reminderDone(list, op.id, now))
            return '✓ Done'
          }
          writeSetting(s.db as any, REMINDERS, reminderSnooze(list, op.id, op.minutes, now))
          return `⏰ Again at ${new Date(now + op.minutes * 60_000).toTimeString().slice(0, 5)}`
        })
        void syncNow().catch(() => null)
        return line
      },
      // Sporty on the server: status, and the Update Sporty button (picked up within a minute).
      sporty: async () => (await svcP).read((s) => sportyViewOf(s.db)),
      updateSporty: async () =>
        (await svcP).write((s) => {
          setSetting(s.db, SPORTY_REQUEST, JSON.stringify({ at: new Date().toISOString() }))
          return sportyViewOf(s.db)
        }),
      // How Ben writes: length and tone.
      style: async () => (await svcP).read((s) => loadStyle(s.db)),
      setStyle: async (st: Partial<CoachStyle>) => (await svcP).write((s) => saveStyle(s.db, st)),
      // How the chat looks: Ben's face and your photo (one small synced setting).
      looks: async () => (await svcP).read((s) => cleanLooks(readSetting(s.db, 'coach_looks'))),
      setLooks: async (patch: Partial<CoachLooks>) =>
        (await svcP).write((s) => {
          const next = cleanLooks({ ...cleanLooks(readSetting(s.db, 'coach_looks')), ...patch })
          writeSetting(s.db, 'coach_looks', next as unknown as Record<string, unknown>)
          return next
        }),
      // Ben's desk (read here, instant; changes sync like everything else).
      desk: async () => (await svcP).read((s) => deskView(s as any, financeStateFrom((s as any).db, localStorage))),
      deskDo: async (op: DeskOp) => {
        const line = await (await svcP).write((s) => deskChange(s as any, op))
        void syncNow().catch(() => null)
        return line
      },
      // "What I know about you" (read here, instant).
      profileView: async () => (await svcP).read((s) => profileView(s as any)),
      // ↩ Undo what the coach did in one reply (all of it, or one line).
      undo: async (at: string, index?: number) => {
        const r = await fetch('/api/coach', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'undo', at, index }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || httpProblem('Ben', r.status))
        void syncNow().catch(() => null)
        return j as { ok: boolean; lines: string[] }
      },
      // The chat's header, pinned "Do this now" and live cards (read here, instant).
      status: () => shared('coachStatus', async () => (await svcP).read((s) => coachStatus(s as any))),
      // Is the coach working? The weekly scorecard from its history (read here).
      scorecard: async () =>
        (await svcP).read((s) => {
          let h: any = null
          try {
            h = JSON.parse(getSetting(s.db, COACH_HISTORY) || 'null')
          } catch {
            h = null
          }
          const today = s.wallet.today()
          const rows = scorecard(cleanHistory(h), s.progress.input(null, new Date(), 70).focus, today, 8)
          return { rows, ...impactVerdict(rows) }
        }),
      // The daily rhythm: today's plan from the coach (read here, actions on the server).
      rhythm: async (action: 'state' | 'propose' | 'approve' | 'top3' | 'prefs' | 'book' | 'letter' | 'month' = 'state', note?: string, prefs?: Record<string, unknown>) => {
        if (action === 'state') {
          return (await svcP).read((s) => {
            const read = (k: string) => {
              try {
                return JSON.parse(getSetting(s.db, k) || 'null')
              } catch {
                return null
              }
            }
            return { state: rhythmFor(read(RHYTHM), s.wallet.today()), prefs: cleanPrefs(read(RHYTHM_PREFS)) }
          })
        }
        const r = await fetch('/api/coach', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'rhythm', action, note, prefs }) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || httpProblem('Ben', r.status))
        void syncNow().catch(() => null)
        return j
      },
      setMind: async (m: CoachMind) => {
        await (await svcP).write((s) => saveMind(s.db, m))
      },
      brain: {
        view: async () => freshCopy().then(() => svcP).then((svc) => svc.read((s) => memoryView(s.db))),
        editBlock: async (name: string, patch: { text?: string; pinned?: boolean }) =>
          (await svcP).write((s) => {
            editBlock(s.db, name, patch)
            return memoryView(s.db)
          }),
        pinFact: async (text: string, on: boolean) =>
          (await svcP).write((s) => {
            pinFact(s.db, text, on)
            return memoryView(s.db)
          }),
        undo: async (id: string) => (await svcP).write((s) => ({ ok: undoMemory(s.db, id), view: memoryView(s.db) }))
      },
      profile: async () => (await svcP).read((s) => loadProfile(s.db)),
      saveProfile: async (p: { about: string; goals: string[]; rules: string[] }) => (await svcP).write((s) => saveProfile(s.db, p)),
      log: async () => freshCopy().then(() => svcP).then((svc) => svc.read((s) => loadLog(s.db))),
      model: async () => {
        const r = await fetch('/api/ai', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: '{"op":"status"}' }).catch(() => null)
        const j = r ? await r.json().catch(() => ({})) : {}
        return j.model ?? null
      }
    },
    progress: {
      report: async () => (await svcP).progress.report(financeSpending(readJson('finance-helper.state'))),
      insights: async () => (await svcP).progress.insights(),
      growth: async () => (await svcP).progress.growth(financeSpending(readJson('finance-helper.state'))),
      // Milestones already celebrated (synced, so each one shows once, anywhere).
      seenMilestones: async () => (await svcP).read((s) => {
        try {
          return JSON.parse(getSetting(s.db, 'milestones_seen') || '[]') as string[]
        } catch {
          return []
        }
      }),
      markMilestones: async (ids: string[], replace = false) =>
        (await svcP).write((s) => {
          let cur: string[] = []
          try {
            cur = JSON.parse(getSetting(s.db, 'milestones_seen') || '[]')
          } catch {
            /* start over */
          }
          setSetting(s.db, 'milestones_seen', JSON.stringify([...new Set(replace ? ids : [...cur, ...ids])].slice(-200)))
        })
    },
    // Day templates for the calendar, synced everywhere.
    calTemplates: {
      list: async () => (await svcP).read((s) => {
        try {
          return JSON.parse(getSetting(s.db, TEMPLATES) || '[]') as DayTemplate[]
        } catch {
          return []
        }
      }),
      save: async (t: DayTemplate) =>
        (await svcP).write((s) => {
          let cur: DayTemplate[] = []
          try {
            cur = JSON.parse(getSetting(s.db, TEMPLATES) || '[]')
          } catch {
            /* start over */
          }
          const next = upsertTemplate(cur, t)
          setSetting(s.db, TEMPLATES, JSON.stringify(next))
          return next
        }),
      remove: async (name: string) =>
        (await svcP).write((s) => {
          let cur: DayTemplate[] = []
          try {
            cur = JSON.parse(getSetting(s.db, TEMPLATES) || '[]')
          } catch {
            /* start over */
          }
          const next = cur.filter((x) => x.name !== name)
          setSetting(s.db, TEMPLATES, JSON.stringify(next))
          return next
        })
    },
    // Done / skipped marks on calendar blocks (kept 14 days, synced everywhere).
    timeline: {
      marks: async (day: string) => (await svcP).read((s) => {
        try {
          return (JSON.parse(getSetting(s.db, 'block_marks') || '{}')[day] ?? {}) as Record<string, 'done' | 'skip'>
        } catch {
          return {}
        }
      }),
      mark: async (day: string, id: string, v: 'done' | 'skip' | null) =>
        (await svcP).write((s) => {
          let all: Record<string, Record<string, 'done' | 'skip'>> = {}
          try {
            all = JSON.parse(getSetting(s.db, 'block_marks') || '{}')
          } catch {
            /* start over */
          }
          const dayMarks = { ...(all[day] ?? {}) }
          if (v) dayMarks[id] = v
          else delete dayMarks[id]
          const keep = Object.keys(all).sort().slice(-13).filter((d) => d !== day)
          const next: typeof all = Object.fromEntries(keep.map((d) => [d, all[d]]))
          next[day] = dayMarks
          setSetting(s.db, 'block_marks', JSON.stringify(next))
          return dayMarks
        }),
      // Event or focus block, your choice per title (synced; the island and the Today timeline both read it).
      kinds: async () => (await svcP).read((s) => {
        try {
          return cleanBlockKinds(JSON.parse(getSetting(s.db, 'block_kinds') || '{}'))
        } catch {
          return {}
        }
      }),
      setKind: async (title: string, kind: BlockKind) =>
        (await svcP).write((s) => {
          let cur: BlockKinds = {}
          try {
            cur = cleanBlockKinds(JSON.parse(getSetting(s.db, 'block_kinds') || '{}'))
          } catch {
            /* start over */
          }
          const next = setBlockKind(cur, title, kind)
          setSetting(s.db, 'block_kinds', JSON.stringify(next))
          return next
        })
    },
    weekPlan: S('weekPlan'),
    extras: createExtras(svcP),
    // The Money hub and one-line quick add (Finance Helper's data).
    finance: createMoneyApi(svcP, () => syncsP.then((list) => list.find((x) => x.spec === FINANCE)?.sync())),
    system: {
      health: async () => {
        const h = await readHealth(turso)
        const mirror = await mirrorP
        const sporty = await mirror.read((db) => {
          try {
            return JSON.parse(getSetting(db as any, 'sport_sync_seen') || 'null')?.at ?? null
          } catch {
            return null
          }
        })
        const n = new Date()
        const today = calendarDay(n)
        return { checks: healthChecks({ now: n, beats: h.beats, sportySeen: sporty, latestSnapshot: h.latestSnapshot, today, errors: h.errors, notes: h.notes }), errors: h.errors }
      },
      beat: (key: string, ok: boolean, msg?: string) => beat(turso, key, ok, msg),
      logError: (source: string, msg: string) => logError(turso, source, msg),
      logErrors: (list: ErrorReport[]) => logErrors(turso, list),
      benLog: () => readBenLog(turso)
    },
    // Your Todoist: today's tasks, complete (+coins), quick add, and coins for
    // what you completed in Todoist itself (checked at most every 5 minutes).
    todoist: {
      status: async () => ({ connected: await todoistOnP }),
      today: async () => ((await todoistOnP) ? todoist.today() : []),
      upcoming: async () => ((await todoistOnP) ? (((await todoistCall('upcoming')).tasks ?? []) as TodoTask[]) : []),
      quickAdd: async (text: string, area?: string) => todoist.quickAdd(text, area),
      everything: async () => {
        const j = await todoistCall('everything')
        return { tasks: (j.tasks ?? []) as TodoTask[], areas: j.areas ?? [] }
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        await todoistCall('update', { id, ...patch })
      },
      cleanup: async (today: string) => {
        const j = await todoistCall('cleanup', { today })
        return { changes: (j.changes ?? []) as CleanChange[], ai: !!j.ai, error: j.error as string | undefined }
      },
      move: async (id: string, area: string) => {
        await todoistCall('move', { id, area })
      },
      reopen: async (id: string) => {
        await todoistCall('reopen', { id })
      },
      remove: async (id: string) => {
        await todoistCall('remove', { id })
      },
      addArea: async (name: string) => (await todoistCall('addArea', { name })).area,
      renameArea: async (area: string, name: string) => {
        await todoistCall('renameArea', { area, name })
      },
      order: async () => (await svcP).read((s) => {
        try {
          return JSON.parse(getSetting(s.db, 'today_order') || '[]') as string[]
        } catch {
          return []
        }
      }),
      setOrder: async (ids: string[]) => {
        await (await svcP).write((s) => setSetting(s.db, 'today_order', JSON.stringify(ids.slice(0, 300))))
      },
      // Colors live with your data (Turso), so every device shows the same.
      colors: async () => (await svcP).read((s) => {
        try {
          return JSON.parse(getSetting(s.db, 'task_area_colors') || '{}') as Record<string, string>
        } catch {
          return {}
        }
      }),
      setColor: async (area: string, color: string) =>
        (await svcP).write((s) => {
          let cur: Record<string, string> = {}
          try {
            cur = JSON.parse(getSetting(s.db, 'task_area_colors') || '{}')
          } catch {
            /* start over */
          }
          const next = { ...cur, [area]: color }
          setSetting(s.db, 'task_area_colors', JSON.stringify(next))
          return next
        }),
      complete: async (task: TodoTask) => {
        await todoist.close(task.id)
        const paid = await (await svcP).write((s) => payTodoist(s, [task]), 'life-wallet-changed')
        return { paid }
      },
      sync: async (force = false) => {
        if (!(await todoistOnP)) return 0
        if (!force && Date.now() - todoistSyncedAt < 5 * 60_000) return 0
        todoistSyncedAt = Date.now()
        const midnight = new Date()
        midnight.setHours(0, 0, 0, 0)
        const items = ((await todoistCall('completed', { since: midnight.toISOString() })).items ?? []) as TodoCompleted[]
        if (!items.length) return 0
        const paid = await (await svcP).write((s) => payTodoist(s, items), 'life-wallet-changed')
        if (paid) window.dispatchEvent(new CustomEvent('life-todoist-paid', { detail: { paid } }))
        return paid
      }
    },
    // Things the desktop window does, the browser's way.
    app: {
      toggleFullScreen: async () => {
        if (document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {})
          return false
        }
        await document.documentElement.requestFullscreen?.().catch(() => {})
        return !!document.fullscreenElement
      },
      reportError: async (message: string, detail?: string) => {
        const list = [{ at: new Date().toISOString(), level: 'error', source: 'web', message: String(message).slice(0, 300), detail: detail?.slice(0, 2000) }, ...readErrors()].slice(0, 50)
        store?.setItem(ERRORS, JSON.stringify(list))
      },
      recentErrors: async () => readErrors(),
      openLogs: async () => '',
      prefs: async () => prefs(),
      setPrefs: async (p: any) => {
        if (typeof p?.matchAppThemes === 'boolean') store?.setItem('life_match_themes', p.matchAppThemes ? '1' : '0')
        return prefs()
      }
    },
    // The website updates itself on every push; "update" just reloads.
    updates: {
      status: async () => upToDate(),
      check: async () => upToDate(),
      run: async () => {
        window.location.reload()
        return upToDate()
      }
    },
    hud: { hide: async () => {}, toggle: async () => {}, show: async () => {} },
    // Turso is the sync on the web: "Sync" fetches what other devices changed now.
    sync: {
      config: async () => ({ syncUrl: 'Turso (automatic)', syncSecret: '', autoSyncOnStartup: true, syncIntervalMinutes: 1, lastSyncedAt: (await mirrorP).syncedAt, lastSyncedCount: 0 }),
      health: async () => ({ ...(await mirrorP).health(), backupError: store?.getItem('life_snapshot_error') ?? null }),
      clearFailed: async () => (await mirrorP).clearFailed(),
      saveConfig: async () => bridge.sync.config(),
      test: async () => {
        const t = Date.now()
        await syncNow()
        return { success: true, latencyMs: Date.now() - t, message: 'Connected to your Turso cloud database', count: 0 }
      },
      pull: async () => {
        await syncNow()
        return { eventsProcessed: 0, restoredDays: [], restoredStreak: 0, previousStreak: 0, errors: [] }
      }
    },
    // Backups on the web are the daily cloud snapshots in Turso.
    backup: {
      status: backupStatus,
      chooseDir: backupStatus,
      setPassphrase: backupStatus,
      runNow: async () => {
        await bridge.data.saveDailySnapshot?.()
        return backupStatus()
      },
      list: async () => (await snapshotDays()).reverse(),
      // Opens the newest snapshot and says what's inside, before you'd restore it (Y8).
      verifyLatest: async () => {
        const days = await snapshotDays()
        if (!days.length) return { ok: false, name: null, detail: store?.getItem('life_snapshot_error') || 'No snapshot yet' }
        try {
          const [res] = await turso.readMany([{ sql: 'SELECT data FROM cloud_snapshots WHERE day = ?', args: [days[0]] }])
          if (res instanceof Error || !res.rows.length) throw new Error('not readable')
          const snap = JSON.parse(await unpackSnapshot(String(res.rows[0][0])))
          const n = (t: string) => (Array.isArray(snap.tables?.[t]) ? snap.tables[t].length : 0)
          const parts = [`${n('ledger')} points entries`, `${n('workouts')} workouts`, `${n('sleep_logs')} nights`, `${n('expenses')} expenses`, `${Object.keys(snap.tables ?? {}).length} tables`]
          return { ok: true, name: days[0], detail: `Cloud snapshot of ${days[0]}: ${parts.join(', ')}` }
        } catch {
          return { ok: false, name: days[0], detail: `The snapshot of ${days[0]} could not be opened` }
        }
      },
      restore: async (name: string) => {
        if (!(await bridge.data.restoreCloudSnapshot?.(name))) throw new Error('That snapshot could not be restored')
      }
    },
    calendar: {
      config: async () => ({ feedUrl: '', enabled: false, autoSyncIntervalMin: 0, lastSyncAt: null, lastError: 'Google Calendar works in the desktop app', cachedEventsCount: 0 }),
      saveConfig: async () => bridge.calendar.config(),
      sync: async () => ({ events: [], count: 0 }),
      events: async () => [],
      clear: async () => {}
    },
    // Google Gemini through the server (the key stays in Vercel).
    ai: new Proxy({} as Bridge['ai'], {
      get: (_t, method: string) => async (...args: unknown[]) => {
        const ai = await aiP
        return (ai as any)[method](...args)
      }
    }),
    onLocked: (cb: () => void) => {
      lockListeners.add(cb)
      return () => lockListeners.delete(cb)
    },
    auth: {
      status: async () => {
        // A remembered device opens by itself (unless you locked it on purpose).
        if (!unlocked && !lockedOnPurpose && remembered() && (direct || sessionValid(currentSession()) || window.desktop)) {
          unlocked = true
          if (!direct) void renewSession()
        }
        return { pinSet: true, locked: !unlocked }
      },
      remembered: async () => remembered(),
      setRemembered: async (on: boolean, pin?: string) => {
        if (on) {
          // Once with the PIN, so someone at your open screen can't switch it off.
          if (!pin) throw new Error('Enter your PIN once to turn this on')
          if (direct) {
            const s = await (await authP).unlock(pin)
            if (s.locked) throw new Error('Wrong PIN')
          } else await serverLogin(pin)
        }
        setRememberedFlag(on)
        return on
      },
      // The server checks the PIN and opens a session; offline, a device that
      // still has a session checks it against its own copy.
      unlock: async (pin: string) => {
        let checked = false
        if (!direct) {
          try {
            await serverLogin(pin)
            haveSession()
            checked = true
          } catch (e) {
            if (!(e instanceof NetworkError) || (!sessionValid(currentSession()) && !window.desktop)) throw e
          }
        }
        const s = await (await authP).unlock(pin, checked)
        unlocked = !s.locked
        if (unlocked) lockedOnPurpose = false
        // CL7: changes that waited for the PIN go out now.
        if (checked) void mirrorP.then((m) => m.resume())
        return s
      },
      // Fingerprint / face (M7): the server checks the passkey and gives a session like the PIN.
      unlockPasskey: async () => {
        if (direct) throw new Error('Passkeys work on the website and the installed app')
        await unlockWithPasskey()
        haveSession()
        void mirrorP.then((m) => m.resume())
        unlocked = true
        lockedOnPurpose = false
        return { pinSet: true, locked: false }
      },
      setupPasskey: async () => {
        if (direct) throw new Error('Passkeys work on the website and the installed app')
        await setupPasskey()
      },
      // A new PIN ends every session (all devices). On the website and the
      // installed app the server checks the current PIN and saves the new one
      // (A2); this device keeps working with a fresh session.
      setPin: async (pin: string, current?: string) => {
        if (direct) return (await authP).setPin(pin, current)
        if (!/^\d{4,12}$/.test(pin)) throw new Error('PIN must be 4 to 12 digits')
        await serverChangePin(current ?? '', pin)
        void (await mirrorP).refresh().catch(() => null)
        unlocked = true
        return { pinSet: true, locked: false }
      },
      signOutOthers: async () => {
        if (!direct) await signOutOthers()
      },
      // Devices (A6): the website and installed app only (they hold server sessions).
      ...(direct
        ? {}
        : {
            devices: () => deviceCall(),
            revokeDevice: (sid: string) => deviceCall({ revokeDevice: sid }),
            removePasskey: (id: string) => deviceCall({ revokePasskey: id })
          }),
      lock: async () => {
        unlocked = false
        lockedOnPurpose = true
        return (await authP).lock()
      }
    },
    dayLog: {
      addFocus: async (day: string, e: { at: string; subject: string; minutes: number; pct: number; workMin?: number; distractMin?: number }) => {
        await (await mirrorP).write((db) => addFocusQuality(db as any, day, e))
      },
      addBlock: async (day: string, e: { at: string; title: string; result: 'done' | 'half' | 'no' }) => {
        await (await mirrorP).write((db) => addBlockResult(db as any, day, e))
      },
      setPc: async (day: string, line: string) => {
        await (await mirrorP).write((db) => setPcLine(db as any, day, line))
      },
      setWeb: async (day: string, line: string) => {
        await (await mirrorP).write((db) => setWebLine(db as any, day, line))
      },
      setDoing: async (day: string, line: string, hours: Record<string, Record<string, number>>) => {
        await (await mirrorP).write((db) => setDoingLine(db as any, day, line, hours))
      },
      setEyes: async (day: string, line: string, at: number) => {
        await (await mirrorP).write((db) => setEyesLine(db as any, day, line, at))
      },
      addCheck: async (day: string, e: { at: string; subject: string; answer: 'yes' | 'drifted' | 'switch' }) => {
        await (await mirrorP).write((db) => addFocusCheck(db as any, day, e))
      }
    },
    pcAuto: {
      state: async () => (await mirrorP).read((db) => cleanPcState(readSetting(db as any, 'pc_asks'), Date.now())),
      answer: async (id: string, status: PcAsk['status'], why?: string) => {
        await (await mirrorP).write((db) => {
          const st = cleanPcState(readSetting(db as any, 'pc_asks'), Date.now())
          writeSetting(db as any, 'pc_asks', { desk: st.desk, asks: setAskStatus(st.asks, id, status, why) })
        })
      },
      desk: async (on: boolean) => {
        await (await mirrorP).write((db) => {
          const st = cleanPcState(readSetting(db as any, 'pc_asks'), Date.now())
          writeSetting(db as any, 'pc_asks', { desk: { on, at: Date.now() }, asks: st.asks })
        })
      },
      lastHour: async (h: LastHour | null) => {
        await (await mirrorP).write((db) => writeSetting(db as any, 'pc_last_hour', h))
      }
    },
    // Island 2: your nudges (settings, people, today's tallies, move breaks to undo), synced.
    nudges: {
      get: async () => (await mirrorP).read((db) => cleanNudgeStore(readSetting(db as any, 'island_nudges'), dayKey(new Date()))),
      save: async (n: NudgeStore) => {
        const clean = cleanNudgeStore(n, dayKey(new Date()))
        await (await mirrorP).write((db) => writeSetting(db as any, 'island_nudges', clean as unknown as Record<string, unknown>))
        return clean
      }
    },
    recipes: {
      list: async () => (await mirrorP).read((db) => cleanRecipes(readSetting(db as any, 'island_recipes'))),
      save: async (list: Recipe[]) => {
        const clean = cleanRecipes(list)
        await (await mirrorP).write((db) => writeSetting(db as any, 'island_recipes', clean))
        return clean
      }
    },
    // Automation hub: your automations (never an address or key) and Ben's asks.
    automations: {
      get: async () => (await mirrorP).read((db) => cleanStore(readSetting(db as any, 'automations'))),
      save: async (st: AutomationStore) => {
        const clean = cleanStore(st)
        await (await mirrorP).write((db) => writeSetting(db as any, 'automations', clean))
        return clean
      },
      asks: async () => (await mirrorP).read((db) => cleanAutoAsks(readSetting(db as any, 'auto_asks'), Date.now())),
      setAsk: async (id: string, status: AutoAsk['status'], why?: string) => {
        await (await mirrorP).write((db) => writeSetting(db as any, 'auto_asks', { asks: setAutoAsk(cleanAutoAsks(readSetting(db as any, 'auto_asks'), Date.now()), id, status, why) }))
      }
    },
    // MU: the song playing now, for Ben (only with that option on).
    musicNow: {
      set: async (v: import('@core/music').MusicNow | null) => {
        const clean = v ? cleanMusicNow(v) : null
        await (await mirrorP).write((db) => writeSetting(db as any, 'music_now', clean as unknown as Record<string, unknown> | null))
      }
    },
    // Island 2: tiles, buttons, profiles, colours and stations, one synced setting.
    islandKit: {
      get: async () => (await mirrorP).read((db) => cleanKit(readSetting(db as any, 'island_kit'))),
      save: async (kit: unknown) => {
        const clean = cleanKit(kit)
        await (await mirrorP).write((db) => writeSetting(db as any, 'island_kit', clean as unknown as Record<string, unknown>))
        return clean
      }
    },
    // PL1–PL8: widgets, pages, scripts and the island look, one synced setting (cleaned by the caller, which knows the widgets).
    widgets: {
      get: async () => (await mirrorP).read((db) => readSetting(db as any, 'island_widgets')),
      save: async (v: unknown) => {
        if (!v || typeof v !== 'object' || JSON.stringify(v).length > 64_000) throw new Error('Widget settings are too big')
        await (await mirrorP).write((db) => writeSetting(db as any, 'island_widgets', v as Record<string, unknown>))
      }
    },
    // Settings → Plugins (src/plugins): on/off, their settings, what their jobs fetched.
    plugins: {
      state: async () =>
        (await mirrorP).read((db) => {
          const get = (k: string) => ((db as any).prepare('SELECT value FROM settings WHERE key = ?').get(k) as any)?.value ?? null
          const config: Record<string, Record<string, unknown>> = {}
          for (const r of (db as any).prepare("SELECT key, value FROM settings WHERE key LIKE 'plugin\\_%' ESCAPE '\\' AND key NOT LIKE '%\\_data' ESCAPE '\\'").all() as any[]) config[String(r.key).slice(7)] = parsePluginJson(r.value, {})
          return { on: pluginsOn(db as any), status: parsePluginJson(get(PLUGINS_STATUS), {}), config }
        }),
      setOn: async (id: string, on: boolean) => {
        await (await mirrorP).write((db) => setPluginOn(db as any, id, on))
      },
      setConfig: async (id: string, cfg: Record<string, unknown>) => {
        await (await mirrorP).write((db) => (db as any).prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(pluginConfigKey(id), JSON.stringify(cfg)))
      },
      data: async (key: string) => (pluginKey(key) ? (await mirrorP).read((db) => parsePluginJson((((db as any).prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value ?? null), null)) : null),
      saveData: async (key: string, value: unknown) => {
        if (!pluginKey(key)) throw new Error('Not a plugin setting')
        await (await mirrorP).write((db) => (db as any).prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)))
      },
      refresh: async (only?: string) => {
        const r = await fetch(`/api/cron?job=plugins${only ? `&only=${encodeURIComponent(only)}` : ''}`, { headers: { Authorization: `Bearer ${currentSession()}` } })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || httpProblem('Plugins', r.status))
        await (await mirrorP).refresh().catch(() => {})
        return j as { ran: string[] }
      },
      // MC9: read in memory, never stored; Finance Helper gets the new payments.
      importBank: async (text: string) => {
        const r = await (await mirrorP).write((db) => importBank(db as any, text))
        await applyFinance()
        return importText(r)
      },
      healthKeys: async (op: { op: 'list' } | { op: 'new'; label: string } | { op: 'drop'; id: string }) => {
        const r = await fetch('/api/cron?job=health', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(op) })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || httpProblem('Health keys', r.status))
        return j
      },
      connectGmail: async () => {
        const j = await googleCall('connect', { gmail: true })
        if (j.url) window.location.href = j.url
      }
    },
    notes: {
      list: async () => {
        const m = await mirrorP
        await m.write((db) => seedNotes(db as any))
        return m.read((db) => listNotes(db as any))
      },
      save: async (n: { id?: string; title: string; body: string; pinned?: boolean }) => (await mirrorP).write((db) => saveNote(db as any, n)),
      remove: async (id: string) => {
        await (await mirrorP).write((db) => removeNote(db as any, id))
      }
    },
    notifications: {
      list: async () => (await mirrorP).read((db) => listNotifs(db as any)),
      read: async (ids: string[] | null) => {
        await (await mirrorP).write((db) => readNotifs(db as any, ids))
      },
      dismiss: async (id: string) => {
        await (await mirrorP).write((db) => dismissNotif(db as any, id))
      },
      add: async (n: any) => {
        // Already there (another device or the server added it): nothing to write.
        const have = await (await mirrorP).read((db) => !!(db as any).prepare('SELECT 1 FROM notifications WHERE id = ?').get(n.id))
        if (!have) await (await mirrorP).write((db) => addNotif(db as any, n))
      },
      snooze: async (id: string, until: number) => {
        await (await mirrorP).write((db) => snoozeNotif(db as any, id, until))
      },
      settings: async () => (await mirrorP).read((db) => cleanNotifSettings(JSON.parse(((db as any).prepare('SELECT value FROM settings WHERE key = ?').get(NOTIF_SETTINGS_KEY) as any)?.value || 'null'))),
      saveSettings: async (p: any) =>
        (await mirrorP).write((db) => {
          const cur = cleanNotifSettings(JSON.parse(((db as any).prepare('SELECT value FROM settings WHERE key = ?').get(NOTIF_SETTINGS_KEY) as any)?.value || 'null'))
          const next = cleanNotifSettings({ ...cur, ...p })
          ;(db as any).prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(NOTIF_SETTINGS_KEY, JSON.stringify(next))
          return next
        })
    },
    wallet: S('wallet') as Bridge['wallet'],
    rules: S('rules') as Bridge['rules'],
    shop: S('shop') as Bridge['shop'],
    tasks: S('tasks') as Bridge['tasks'],
    schedule: S('schedule') as Bridge['schedule'],
    // Every focus change tells the open screens (the Now card, the timer, Focus).
    focus: new Proxy({} as Bridge['focus'], {
      get: (_t, method: string) => async (...args: unknown[]) => {
        // Six parts of the screen ask for the focus state at once: one read serves them all.
        if (method === 'state') return shared('focus', () => svcP.then((svc) => (svc.focus as any).state()))
        forgetShared()
        const r = await ((await svcP).focus as any)[method](...args)
        if (method !== 'state') window.dispatchEvent(new CustomEvent('life-focus-changed'))
        // Every focus session goes into Google Calendar too (when connected).
        if (method === 'stop' && r?.session && r.session.minutes >= 5) {
          const end = new Date()
          const start = new Date(end.getTime() - r.session.minutes * 60000)
          void googleConnected().then((on) => on && google.create({ title: `Focus: ${r.session.subject}`, start: start.toISOString(), end: end.toISOString(), description: `${r.session.minutes} min of focus, logged by Life System` }).catch(() => null))
        }
        // A session for a must-do or a Todoist task: Today asks whether it's done.
        if (method === 'stop' && r?.task) window.dispatchEvent(new CustomEvent('life-focus-ended', { detail: { task: r.task, minutes: r.session?.minutes ?? 0 } }))
        return r
      }
    }),
    sleep: S('sleep', {
      // A corrected wake-up also goes into Waky's own copy of that morning, so
      // both show the same (Waky's data then syncs to your other devices).
      setWake: async (day: string, time: string) => {
        const res = await (await svcP).sleep.setWake(day, time)
        const waky = readJson<any>('waky_web_data_v2')
        if (waky && typeof waky === 'object' && waky.days?.[day]?.time !== res.log.wakeTime) {
          waky.days = waky.days || {}
          waky.days[day] = { reps: 0, mode: 'edited', sent: true, ...(waky.days[day] || {}), time: res.log.wakeTime, target: waky.days[day]?.target || waky.settings?.weekday || res.log.wakeTarget }
          store?.setItem('waky_web_data_v2', JSON.stringify(waky))
          window.dispatchEvent(new CustomEvent('life-waky-changed'))
        }
        return res
      }
    }) as Bridge['sleep'],
    money: S('money') as Bridge['money'],
    shields: S('shields') as Bridge['shields'],
    economy: S('economy') as Bridge['economy'],
    discipline: S('discipline', {
      state: async () => withMan(await (await svcP).discipline.state()),
      note: async (kind: 'urge' | 'reset', trigger: string, extra?: { before?: number; after?: number; action?: string }) => (await svcP).write((s) => addTrigger(s.db, { at: new Date().toISOString(), kind, trigger, ...(extra ?? {}) })),
      // After a reset: Ben's check-ins for the 72-hour comeback plan (H13); the app adds the Todoist tasks.
      comeback: async () =>
        (await svcP).write((s) => {
          const trig = topTriggers(loadTriggers(s.db))[0]?.trigger ?? null
          const stealth = readSetting(s.db as any, 'discipline_stealth')
          const plan = comebackPlan(new Date(), trig, s.sleep.bedtimeTarget()).map((x) => (stealth ? { ...x, text: neutral(x.text) } : x))
          let list: Reminder[] = []
          try {
            list = readSetting(s.db as any, REMINDERS)
          } catch {
            list = []
          }
          for (const st of plan.filter((x) => x.kind === 'checkin')) list = addReminder(list, { at: st.at, text: st.text, kind: 'checkin', follow: false })
          writeSetting(s.db as any, REMINDERS, list)
          return plan
        }),
      patterns: async () =>
        (await svcP).read((s) => ({
          windows: riskWindows(urgeEvents(s.db)).map(windowLabel),
          triggers: topTriggers(loadTriggers(s.db)).map((t) => t.trigger)
        }))
    }) as Bridge['discipline'],
    body: S('body', { state: async () => withSportTrack(await (await svcP).body.state()) }) as Bridge['body'],
    connections: {
      ...base.connections,
      // The real daily budget (money_daily_budget, bani), the one points are judged on.
      setDailyBudget: async (amount: number) => {
        await (await svcP).write((s) => s.money.setBudget(Math.max(0, Math.round(Number(amount) || 0)) * 100))
        return bridge.connections.state()
      },
      // Pays the days Finance Helper on this device has records for (Waky pays
      // through the Sleep section when it checks you in).
      sync: async () => {
        const finance = readJson<any>('finance-helper.state')
        const days = Array.isArray(finance?.tx) ? finance.tx.map((t: any) => String(t?.date ?? '')).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : []
        // Always: finished days logged in Life System are judged too (FX3).
        const awarded = await (await svcP).connections.syncFinance(days)
        return { awarded, state: await bridge.connections.state() }
      },
      state: async (): Promise<ConnectionsState> => {
        const baseConns = await base.connections.state()
        const svc = await svcP
        const today = dayKey(new Date())
        const sleep = await svc.sleep.state()
        const finance = readJson<any>('finance-helper.state')
        const man = readJson<any>('MAN_SPARTAN_DATA')
        // Without Finance Helper data on this device: say so (not demo numbers).
        let financeConn: ConnectionsState['finance'] = {
          ...baseConns.finance,
          path: null,
          found: false,
          error: 'Open Finance Helper on this device to connect it',
          today: null,
          month: null,
          days: []
        }
        if (finance && Array.isArray(finance.tx)) {
          // FX7: in lei (never dollars added as lei), bills apart, the last 14 days judged.
          const sum = await svc.read((s) => financeSummary(financeDayTx(s, finance, true), today))
          const budgetBani = await svc.read((s) => s.money.dailyBudgetSet())
          financeConn = {
            ...baseConns.finance,
            path: 'Finance Helper (this device)',
            found: true,
            error: null,
            currency: finance.settings?.currency || 'MDL',
            savedAt: null,
            staleDays: null,
            dailyBudget: Math.round(budgetBani / 100),
            today: sum.today,
            month: sum.month,
            days: sum.days
          }
        }
        return {
          ...baseConns,
          today,
          lastSync: (await mirrorP).syncedAt,
          finance: financeConn,
          man: man && typeof man.streakDays === 'number'
            ? {
                ...baseConns.man,
                path: 'MAN (this device)',
                found: true,
                error: null,
                data: {
                  streakDays: man.streakDays,
                  longestStreak: man.longestStreak || man.streakDays,
                  totalVictories: man.totalVictories || 0,
                  lastCheckin: man.lastCheckin || null,
                  urgesCrushed: man.urgesCrushedCount || 0,
                  oathsSworn: man.oathsSwornCount || 0
                },
                suggestion: { start: addDays(today, -man.streakDays), showsDays: man.streakDays, lastTapDaysAgo: null, note: null }
              }
            : { ...baseConns.man, path: null, found: false, error: 'Open MAN on this device to connect it', data: null, suggestion: null },
          // Waky's numbers are the real sleep log now (not fixed 06:30 and 100%).
          waky: {
            ...baseConns.waky,
            found: true,
            path: 'Sleep log (Turso)',
            error: null,
            weekday: sleep.weekdayTarget,
            weekend: sleep.weekendTarget,
            today: sleep.todayLog ? { time: sleep.todayLog.wakeTime, target: sleep.todayLog.wakeTarget, onTime: sleep.todayLog.onTime } : null,
            streak: sleep.streak,
            best: sleep.bestStreak,
            onTimeRate: sleep.onTimeRate,
            avgSleepMin: sleep.avgSleepMin,
            mornings: sleep.recentLogs.map((l) => ({ day: l.day, time: l.wakeTime, target: l.wakeTarget, onTime: l.onTime, sleptMin: null }))
          }
        }
      }
    },
    apps: {
      ...base.apps,
      info: async () => ({
        finance: { url: '/apps/finance/index.html', partition: 'web', preloadReady: false },
        man: { url: '/apps/man/index.html', partition: 'web' },
        waky: { url: '/apps/waky/index.html', partition: 'web' },
        sport: { url: '/apps/sport/index.html', partition: 'web' },
        migration: null
      }),
      startWaky: async () => ({ ok: true, error: null })
    },
    data: {
      ...base.data,
      exportCsv: async (kind: 'workouts' | 'expenses') => (await svcP).exporter.exportCsv(kind),
      exportJson: async (): Promise<string> => JSON.stringify(await snapshot(), null, 2),
      cloudSnapshots: async () => {
        try {
          await ensureSnapshotsTable()
          const [res] = await turso.readMany([{ sql: 'SELECT day, exported_at, size_bytes FROM cloud_snapshots ORDER BY day DESC LIMIT 30', args: [] }])
          if (res instanceof Error) return []
          return res.rows.map(([day, at, size]) => ({ day: String(day), exportedAt: String(at), sizeBytes: Number(size) }))
        } catch {
          return []
        }
      },
      /** One snapshot a day in Turso, the last 30 kept. */
      saveDailySnapshot: async () => {
        try {
          await ensureSnapshotsTable()
          const day = dayKey(new Date())
          const [have] = await turso.readMany([{ sql: 'SELECT 1 FROM cloud_snapshots WHERE day = ?', args: [day] }])
          if (!(have instanceof Error) && have.rows.length) return true
          // Packed (gzip) so a big history fits the 4.5 MB a request may carry (Y8).
          const data = await packSnapshot(JSON.stringify(await snapshot()))
          if (data.length > 4_200_000) {
            store?.setItem('life_snapshot_error', `Today's cloud backup is too big to save (${(data.length / 1e6).toFixed(1)} MB). Download a backup from Settings → Data instead.`)
            return false
          }
          if (direct)
            await turso.writeAtomic([
              {
                sql: `INSERT INTO cloud_snapshots (day, exported_at, size_bytes, data) VALUES (?, ?, ?, ?)
                      ON CONFLICT(day) DO UPDATE SET exported_at = excluded.exported_at, size_bytes = excluded.size_bytes, data = excluded.data`,
                args: [day, new Date().toISOString(), new Blob([data]).size, data]
              },
              { sql: 'DELETE FROM cloud_snapshots WHERE day < ?', args: [addDays(day, -30)] }
            ])
          else {
            // LT1: the backups are read-only through /api/db; the server adds today's (it never overwrites one).
            const res = await fetch('/api/db', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot: { day, data } }) })
            if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || `HTTP ${res.status}`)
          }
          store?.removeItem('life_snapshot_error')
          backupDays = null
          return true
        } catch (e) {
          // Never silent (Y8): the sync panel shows why today's backup is missing.
          store?.setItem('life_snapshot_error', `Today's cloud backup failed: ${String((e as Error)?.message ?? e).slice(0, 160)}`)
          return false
        }
      },
      /**
       * Puts a snapshot back, all in one Turso transaction (all or nothing).
       * Tables are replaced, except the append-only history (the ledger,
       * discipline events), where only missing rows come back. Your current
       * PIN and bot settings are kept.
       */
      restoreCloudSnapshot: async (day: string) => {
        const [res] = await turso.readMany([{ sql: 'SELECT data FROM cloud_snapshots WHERE day = ?', args: [day] }])
        if (res instanceof Error || !res.rows.length) return false
        return bridge.data.restoreSnapshot!(await unpackSnapshot(String(res.rows[0][0])))
      },
      /**
       * Puts a backup back (a daily file, an export, a cloud snapshot), all in
       * one Turso transaction (all or nothing). Tables are replaced, except the
       * append-only history (ledger, discipline events), where only missing
       * rows come back. Your current PIN and bot settings are kept. Every
       * device reloads (the data marker moves).
       */
      restoreSnapshot: async (text: string) => {
        const snap = JSON.parse(text)
        const mirror = await mirrorP
        // Changes still waiting on this computer go first.
        await mirror.refresh().catch(() => {})
        const columns = await mirror.read((db) => {
          const out: Record<string, string[]> = {}
          for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]) {
            out[String(r.name)] = db.prepare(`PRAGMA table_info("${String(r.name)}")`).all().map((c: any) => String(c.name))
          }
          return out
        })
        await turso.writeAtomic(restoreStatements(snap, columns, `restore-${Date.now().toString(36)}`) as any)
        for (const [key, field] of [['finance-helper.state', 'financeState'], ['waky_web_data_v2', 'wakyState'], ['life_sport_tracker_v1', 'sportState'], ['MAN_SPARTAN_DATA', 'manState']] as const) {
          if (snap[field]) store?.setItem(key, JSON.stringify(snap[field]))
        }
        await mirror.refresh()
        for (const n of ['life-wallet-changed', 'life-discipline-changed', 'life-body-changed']) window.dispatchEvent(new CustomEvent(n))
        return true
      }
    },
    bots: {
      ...base.bots,
      config: async () => (await botsP).config(),
      saveConfig: async (p: Partial<BotBridgeConfig>) => (await botsP).saveConfig(p),
      status: async () => (await botsP).status(),
      logs: async () => (await botsP).logs(),
      clearLogs: async () => (await botsP).clearLogs(),
      // The test message goes out from the server (tokens never reach this page).
      test: async (k?: string) => {
        if (direct) return (await botsP).test(k)
        const r = await fetch('/api/bot-setup', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: '{"test":true}' }).catch(() => null)
        return r?.ok ? r.json() : { ok: false, error: 'Server not reachable' }
      },
      startPolling: async () => (await botsP).startPolling(),
      stopPolling: async () => (await botsP).stopPolling(),
      pollOnce: async () => (await botsP).pollOnce()
    }
  } as Bridge
  return bridge
}

export type { Summary }
