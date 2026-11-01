// The web / phone version of the app's bridge. Data lives in Turso; the app
// works on an in-browser copy of it (src/renderer/src/web/mirror.ts) and runs
// the same services as the desktop on that copy, so every section behaves the
// same as on the PC: caps, cooldowns, undo, shop, quests, streaks. Things only
// the web has (embedded apps, Telegram polling, cloud snapshots) are here.
import initSqlJs from 'sql.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import type { Bridge } from './bridge'
import { createMockApi } from './mock'
import { addDays, dayKey } from '@core/dates'
import type { BodyState, BotBridgeConfig, ConnectionsState, DisciplineState, Summary } from '@shared/api'
import { Mirror, indexedDbStore } from './web/mirror'
import { TursoHttp } from './web/tursoHttp'
import { createWebServices, type WebServices } from './web/webServices'
import { createWebAuth } from './web/webAuth'
import { createWebBots } from './web/webBots'
import { createFinanceInbox } from './web/financeInbox'
import { payTodoist } from './web/todoistCoins'
import type { TodoCompleted, TodoTask } from '@core/todoist'
import { SPORT } from './web/sportSync'
import { MAN, WAKY, createAppSync } from './web/appSync'
import { FINANCE } from './web/financeSync'
import { createWebAi, serverAi } from './web/webAi'
import { getSetting, setSetting } from '../../main/settings'
import { financeSpending } from '@core/progress'

/** What every screen listens to; sent when live data arrived. */
const LIVE_EVENTS = ['life-wallet-changed', 'life-discipline-changed', 'life-body-changed', 'life-focus-changed', 'life-week-changed', 'life-sport-changed', 'life-data-changed']
import type { CleanChange } from '@core/todoistClean'
import { TEMPLATES, upsertTemplate, type DayTemplate } from '@core/calTemplates'
import { loadLog, loadMemory, loadProfile, saveMemory, saveProfile } from './web/botBrain'
import { NetworkError, clearSession, currentSession, serverLogin, sessionValid } from './web/session'

/**
 * A direct Turso connection, only for development and tests (set turso_url
 * and turso_token in localStorage). The live site has no keys in its code:
 * it goes through the server (api/db.mjs) after the PIN login.
 */
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
  const utcToday = new Date().toISOString().slice(0, 10)
  const fresh = sport.lastDate === utcToday
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
function withMan(state: DisciplineState): DisciplineState {
  const man = readJson<any>('MAN_SPARTAN_DATA')
  if (!man || typeof man.streakDays !== 'number') return state
  // The streak in Turso is the same on every device; MAN on this device only
  // fills in before a start date was set (a new phone's MAN starts at Day 1).
  if (state.setup) {
    return {
      ...state,
      checkedInToday: state.checkedInToday || man.lastCheckin === state.today,
      oathToday: state.oathToday || man.lastOathDate === state.today
    }
  }
  const current = Math.max(0, man.streakDays)
  return {
    ...state,
    current,
    best: Math.max(state.best, Number(man.longestStreak) || 0, current),
    checkedInToday: state.checkedInToday || man.lastCheckin === state.today,
    oathToday: state.oathToday || man.lastOathDate === state.today
  }
}

const SNAPSHOT_TABLES = [
  'ledger', 'tasks', 'task_done', 'categories', 'rules', 'rewards', 'redemptions', 'reward_vault_ledger',
  'discipline_events', 'sleep_logs', 'expenses', 'workouts', 'body_metrics', 'exercises', 'wishlist_goals',
  'blocks', 'block_log', 'settings'
]

export function createTursoWebBridge(): Bridge {
  const base = createMockApi()
  const direct = getTursoConfig()
  const lockListeners = new Set<() => void>()
  let unlocked = false
  const lockNow = () => {
    unlocked = false
    lockListeners.forEach((cb) => cb())
  }
  // The server said the session is over: ask for the PIN again.
  const turso = direct
    ? new TursoHttp(direct.url, direct.token)
    : new TursoHttp('/api/db', currentSession, () => {
        clearSession()
        lockNow()
      })

  // Nothing is fetched before there's a session (the first PIN on a device).
  let haveSession: () => void = () => {}
  const sessionReady = new Promise<void>((resolve) => (haveSession = resolve))
  if (direct || sessionValid(currentSession())) haveSession()

  // Starts loading at once; every call below waits for it.
  const mirrorP: Promise<Mirror> = Promise.all([initSqlJs({ locateFile: () => sqlWasmUrl }), sessionReady]).then(
    ([SQL]) => new Mirror(SQL, turso, typeof indexedDB !== 'undefined' ? indexedDbStore() : null)
  )
  const svcP: Promise<WebServices> = mirrorP.then((m) => createWebServices(m))
  const authP = mirrorP.then((m) => createWebAuth(m))
  // The embedded apps' data (Sport Track, Finance Helper, Waky, MAN) lives in
  // this browser: copied to Turso and back so every device shows the same.
  const syncsP = mirrorP.then((m) => {
    const list = [SPORT, FINANCE, WAKY, MAN].map((spec) => createAppSync(m, spec))
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
          const setup = await fetch('/api/bot-setup', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}` } })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
          return { ...DEFAULT_WEB_BOT_CONFIG, ...(j?.bots ?? {}), serverBots: !!setup?.ok }
        })
        .catch(() => DEFAULT_WEB_BOT_CONFIG)
  // Todoist through the server (the token stays there).
  const todoistCall = async (op: string, extra: Record<string, unknown> = {}): Promise<any> => {
    if (direct) return { connected: false }
    const r = await fetch('/api/todoist', {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, ...extra })
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Todoist ${r.status}`)
    return j
  }
  // Google Calendar through the server (the sign-in stays sealed there).
  const googleCall = async (op: string, extra: Record<string, unknown> = {}): Promise<any> => {
    if (direct) return { connected: false, configured: false, events: [] }
    const r = await fetch('/api/google', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...extra }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j.error) throw new Error(j.error || `Google ${r.status}`)
    return j
  }
  let googleOn: Promise<boolean> | null = null
  const googleConnected = () => (googleOn ??= sessionReady.then(() => googleCall('status')).then((j) => !!j.connected).catch(() => false))
  const google = {
    status: async () => {
      const j = await googleCall('status').catch((e) => ({ configured: true, connected: false, error: (e as Error).message }))
      googleOn = Promise.resolve(!!j.connected)
      return j
    },
    connect: async () => {
      const j = await googleCall('connect')
      if (j.url) window.location.href = j.url
    },
    events: async (from: string, to: string) => ((await googleConnected()) ? ((await googleCall('events', { from, to })).events ?? []) : []),
    create: async (e: Record<string, unknown>) => (await googleCall('create', e)).event,
    move: async (calendarId: string, id: string, start: string, end: string) => {
      await googleCall('move', { calendarId, id, start, end })
    },
    update: async (calendarId: string, id: string, patch: Record<string, unknown>) => {
      await googleCall('update', { calendarId, id, ...patch })
    },
    remove: async (calendarId: string, id: string) => {
      await googleCall('remove', { calendarId, id })
    },
    setCalendars: async (on: string[], target: string | null) => {
      await googleCall('setCalendars', { on, target })
    },
    disconnect: async () => {
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
  const botsP = Promise.all([mirrorP, svcP, botDefaultsP, todoistOnP]).then(([mirror, services, defaults, todoOn]) => createWebBots({ mirror, services, defaults, onExpense: () => void applyFinance(), todoist: todoOn ? todoist : null }))

  // Live data: while the app is open it asks Turso "anything new?" every few
  // seconds (one tiny query; every change anywhere moves a marker). When a
  // bot, the phone or another tab changed something, the copy reloads and
  // every screen redraws by itself. Fast (3 s) while you use the app, slower
  // when it sits in the background, paused when the tab is hidden.
  if (typeof window !== 'undefined') {
    let lastUse = Date.now()
    for (const ev of ['pointerdown', 'keydown', 'focus', 'touchstart']) window.addEventListener(ev, () => (lastUse = Date.now()), { passive: true })
    const announce = () => {
      for (const n of LIVE_EVENTS) window.dispatchEvent(new CustomEvent(n, { detail: { live: true, fromSync: true } }))
    }
    const tab = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('life-live') : null
    let checking = false
    const check = async (force = false) => {
      if (checking) return
      checking = true
      try {
        const changed = await (await mirrorP).refresh()
        if (changed || force) {
          await applyFinance().catch(() => {})
          await syncAll().catch(() => {})
          announce()
        }
      } catch {
        /* offline: the next check retries */
      } finally {
        checking = false
      }
    }
    // Another tab of this app wrote something: check now.
    if (tab) tab.onmessage = () => void check()
    void mirrorP.then((m) => m.onChange(() => tab?.postMessage('changed')))
    let todoAt = 0
    let tickAt = 0
    const loop = async () => {
      if (document.visibilityState === 'visible') {
        await check()
        // Wake the coach (reminders, check-ins, follow-ups) more often than the server timer.
        if (!direct && Date.now() - tickAt > 120_000) {
          tickAt = Date.now()
          void fetch('/api/cron?job=tick').catch(() => null)
        }
        // Todoist and Google Calendar changes made in their own apps: every 30 s.
        if (Date.now() - todoAt > 30_000) {
          todoAt = Date.now()
          window.dispatchEvent(new CustomEvent('life-external-changed'))
          bridge.todoist?.sync().catch(() => 0)
        }
      }
      const active = Date.now() - lastUse < 3 * 60_000 && document.hasFocus()
      setTimeout(loop, active ? 3000 : 12_000)
    }
    setTimeout(loop, 3000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        todoAt = 0
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

  const ensureSnapshotsTable = () =>
    turso.writeAtomic([{ sql: 'CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)', args: [] }])

  /** Everything, for the export and the daily snapshot. */
  const snapshot = async () => {
    const mirror = await mirrorP
    const tables = await mirror.read((db) => {
      const out: Record<string, unknown[]> = {}
      for (const t of SNAPSHOT_TABLES) {
        try {
          out[t] = db.prepare(`SELECT * FROM "${t}"`).all()
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
  const backupStatus = async () => {
    const days = await snapshotDays()
    return { dir: 'Turso cloud (daily snapshot, 30 kept)', driveAvailable: false, passphraseSet: true, last: days[0] ? { name: days[0], at: days[0] } : null, pending: 0, count: days.length, lastError: null }
  }
  const aiOnP: Promise<boolean> = direct
    ? Promise.resolve(false)
    : sessionReady
        .then(() => fetch('/api/ai', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: '{"op":"status"}' }))
        .then((r) => (r.ok ? r.json() : {}))
        .then((j: any) => !!j.configured)
        .catch(() => false)
  const aiP = svcP.then((svc) => createWebAi(svc, serverAi(currentSession), () => aiOnP, { on: () => todoistOnP, quickAdd: (text) => todoist.quickAdd(text) }))
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
      chat: async (text: string, onStep?: (step: string) => void) => {
        const r = await fetch('/api/coach', { method: 'POST', headers: { Authorization: `Bearer ${currentSession()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
        if (!r.ok || !r.body) {
          const j = await r.json().catch(() => ({}))
          throw new Error(j.error || `Coach ${r.status}`)
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
      memory: async () => (await mirrorP).refresh().then(() => svcP).then((svc) => svc.read((s) => ({ facts: loadMemory(s.db).facts }))),
      setFacts: async (facts: { t: string; at: string }[]) => {
        await (await svcP).write((s) => saveMemory(s.db, { ...loadMemory(s.db), facts }))
      },
      profile: async () => (await svcP).read((s) => loadProfile(s.db)),
      saveProfile: async (p: { about: string; goals: string[]; rules: string[] }) => (await svcP).write((s) => saveProfile(s.db, p)),
      log: async () => (await mirrorP).refresh().then(() => svcP).then((svc) => svc.read((s) => loadLog(s.db))),
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
      markMilestones: async (ids: string[]) =>
        (await svcP).write((s) => {
          let cur: string[] = []
          try {
            cur = JSON.parse(getSetting(s.db, 'milestones_seen') || '[]')
          } catch {
            /* start over */
          }
          setSetting(s.db, 'milestones_seen', JSON.stringify([...new Set([...cur, ...ids])].slice(-200)))
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
        })
    },
    weekPlan: S('weekPlan'),
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
      verifyLatest: async () => {
        const days = await snapshotDays()
        return { ok: days.length > 0, name: days[0] ?? null, detail: days.length ? `Cloud snapshot of ${days[0]}` : 'No snapshot yet' }
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
      status: async () => ({ pinSet: true, locked: !unlocked }),
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
            if (!(e instanceof NetworkError) || !sessionValid(currentSession())) throw e
          }
        }
        const s = await (await authP).unlock(pin, checked)
        unlocked = !s.locked
        return s
      },
      setPin: async (pin: string, current?: string) => (await authP).setPin(pin, current),
      lock: async () => {
        unlocked = false
        return (await authP).lock()
      }
    },
    wallet: S('wallet') as Bridge['wallet'],
    rules: S('rules') as Bridge['rules'],
    shop: S('shop') as Bridge['shop'],
    tasks: S('tasks') as Bridge['tasks'],
    schedule: S('schedule') as Bridge['schedule'],
    // Every focus change tells the open screens (the Now card, the timer, Focus).
    focus: new Proxy({} as Bridge['focus'], {
      get: (_t, method: string) => async (...args: unknown[]) => {
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
    discipline: S('discipline', { state: async () => withMan(await (await svcP).discipline.state()) }) as Bridge['discipline'],
    body: S('body', { state: async () => withSportTrack(await (await svcP).body.state()) }) as Bridge['body'],
    connections: {
      ...base.connections,
      // Pays the days Finance Helper on this device has records for (Waky pays
      // through the Sleep section when it checks you in).
      sync: async () => {
        const finance = readJson<any>('finance-helper.state')
        const days = Array.isArray(finance?.tx) ? finance.tx.map((t: any) => String(t?.date ?? '')).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : []
        const awarded = days.length ? await (await svcP).connections.syncFinance(days) : 0
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
          const month = today.slice(0, 7)
          const sum = (f: (t: any) => boolean) => finance.tx.filter(f).reduce((s: number, t: any) => s + (Number(t.base ?? t.amount) || 0), 0)
          const monthExp = finance.tx.filter((t: any) => t.type === 'expense' && String(t.date || '').startsWith(month))
          financeConn = {
            ...baseConns.finance,
            path: 'Finance Helper (this device)',
            found: true,
            error: null,
            currency: finance.settings?.currency || 'MDL',
            savedAt: null,
            staleDays: null,
            today: { logged: finance.tx.some((t: any) => t.date === today), everydaySpent: sum((t) => t.type === 'expense' && t.date === today) },
            month: { spent: sum((t) => t.type === 'expense' && String(t.date || '').startsWith(month)), everyday: sum((t) => t.type === 'expense' && String(t.date || '').startsWith(month)), income: sum((t) => t.type === 'income' && String(t.date || '').startsWith(month)), days: new Set(monthExp.map((t: any) => t.date)).size },
            days: []
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
          const data = JSON.stringify(await snapshot())
          await turso.writeAtomic([
            {
              sql: `INSERT INTO cloud_snapshots (day, exported_at, size_bytes, data) VALUES (?, ?, ?, ?)
                    ON CONFLICT(day) DO UPDATE SET exported_at = excluded.exported_at, size_bytes = excluded.size_bytes, data = excluded.data`,
              args: [day, new Date().toISOString(), new Blob([data]).size, data]
            },
            { sql: 'DELETE FROM cloud_snapshots WHERE day < ?', args: [addDays(day, -30)] }
          ])
          return true
        } catch {
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
        const snap = JSON.parse(String(res.rows[0][0]))
        const mirror = await mirrorP
        const appendOnly = new Set(['ledger', 'discipline_events'])
        const keepSettings = new Set(['pin_hash', 'bot_bridge_config'])
        const stmts = await mirror.read((db) => {
          const out: { sql: string; args: any[] }[] = []
          for (const t of SNAPSHOT_TABLES) {
            const rows = snap.tables?.[t]
            if (!Array.isArray(rows)) continue
            if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)) continue
            const cols = new Set(db.prepare(`PRAGMA table_info("${t}")`).all().map((c: any) => String(c.name)))
            if (t === 'settings') {
              for (const r of rows) {
                if (!r || keepSettings.has(r.key) || typeof r.value !== 'string') continue
                out.push({ sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [r.key, r.value] })
              }
              continue
            }
            if (!appendOnly.has(t)) out.push({ sql: `DELETE FROM "${t}"`, args: [] })
            for (const r of rows) {
              const keys = Object.keys(r ?? {}).filter((k) => cols.has(k))
              if (!keys.length) continue
              out.push({
                sql: `INSERT ${appendOnly.has(t) ? 'OR IGNORE ' : ''}INTO "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
                args: keys.map((k) => r[k] ?? null)
              })
            }
          }
          return out
        })
        await turso.writeAtomic(stmts)
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
      test: async (k?: string) => (await botsP).test(k),
      startPolling: async () => (await botsP).startPolling(),
      stopPolling: async () => (await botsP).stopPolling(),
      pollOnce: async () => (await botsP).pollOnce()
    }
  } as Bridge
  return bridge
}

export type { Summary }
