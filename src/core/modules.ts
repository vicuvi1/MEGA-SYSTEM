// The module switch (owner, 2026-11-12): every part of Life System is a module that is
// ON or OFF. Pure and tested (modules.test.ts). Stored in the synced `modules_on` setting.
//
// OFF means off, not hidden: the module's pages leave the sidebar, Ctrl+K and Alt+number;
// its Today cards, island sections and notifications go; its background jobs (desktop
// timers, server tick parts, bot handlers and pushes) do not run; its bot commands answer
// OFF_REPLY. Its data is never deleted or changed, so turning it on brings it back as it was.
//
// This file is the only place that lists what belongs to which module. Code elsewhere asks
// `isOn(mods, id)`, `pageOn`, `jobOn`, `commandModule` or `notifOn`, never a hard-coded list.

export const MODULES_KEY = 'modules_on'

export type ModuleId =
  | 'today'
  | 'money'
  | 'sleep'
  | 'sport'
  | 'discipline'
  | 'study'
  | 'calendar'
  | 'tasks'
  | 'coach'
  | 'goals'
  | 'season'
  | 'career'
  | 'insights'
  | 'rewards'
  | 'locker'
  | 'music'
  | 'custom'
  | 'focusBoost'
  | 'island'
  | 'growth'
  | 'notebook'
  | 'plugins'

export interface ModuleDef {
  id: ModuleId
  label: string
  /** One line on what it does (Settings → Modules). */
  line: string
  /** App pages (sidebar ids) that belong to it. */
  pages: string[]
  /** Island sections (IslandSnapshot keys) it fills. */
  island: string[]
  /** Background jobs on this device (job ids used with `jobOn`). */
  desktop: string[]
  /** Server jobs: tick parts, daily messages and cron jobs (job ids used with `jobOn`). */
  server: string[]
  /** Telegram commands (without the slash). */
  bot: string[]
  /** Notification kinds it sends. */
  pushes: string[]
  /** Synced settings it owns (kept as they are while it is off). */
  settings: string[]
  /** Always on (the home page). */
  locked?: boolean
}

/** Every module, in menu order. */
export const MODULE_LIST: ModuleDef[] = [
  {
    id: 'today',
    label: 'Today',
    line: 'The 3 numbers: sleep, focus blocks started and exactly 3 must-dos, with the focus timer and your own reminders.',
    pages: ['today'],
    island: ['running', 'mustdos', 'three', 'today', 'dayPct', 'alert', 'focusGuard', 'shield'],
    desktop: ['focusTimer', 'reminders', 'pushBudget', 'nightNudge'],
    server: ['tick.budget', 'tick.reminders', 'tick.pick'],
    bot: ['today', 'status', 'stat', 'focus', 'stop', 'plan', 'review', 'week', 'why', 'start', 'help', 'commands'],
    pushes: ['plan', 'reminder'],
    settings: ['simple_mode', 'push_budget', 'pick_tomorrow', 'focus_running', 'night_nudge_day', 'my_habits', 'habit_board'],
    locked: true
  },
  {
    id: 'money',
    label: 'Money',
    line: 'Finance Helper: safe to spend, quick add and your categories.',
    pages: ['money'],
    island: ['money'],
    desktop: [],
    server: [],
    bot: ['expense', 'buy', 'spent', 'pay', 'paid', 'balance', 'accounts', 'money'],
    pushes: [],
    settings: ['app_sync_finance', 'money_daily_budget', 'money_nothing_spent']
  },
  {
    id: 'sleep',
    label: 'Sleep',
    line: 'Bedtime and wake-up (Waky), asleep by 23:30 and up by 06:45, the wind-down.',
    pages: ['sleep'],
    island: ['sleep', 'windDown', 'windMode', 'afterShift'],
    desktop: ['awayBedtime', 'bedtimeAlert'],
    server: ['tick.winddown', 'daily.night'],
    bot: ['wake', 'up', 'bed', 'sleep'],
    pushes: ['bedtime'],
    settings: ['app_sync_waky', 'sleep_bed_target', 'sleep_weekday_target', 'sleep_weekend_target', 'sleep_care', 'wind_down_day']
  },
  {
    id: 'sport',
    label: 'Sport Track',
    line: 'Workouts, water, body metrics and food (meals, protein, food photos).',
    pages: ['body'],
    island: ['water', 'reps', 'protein', 'streak', 'health', 'glance'],
    desktop: ['waterAlert', 'foodInbox'],
    server: ['cron.sport', 'cron.health'],
    bot: ['water', 'workout', 'w', 'gym', 'train', 'protein', 'p', 'food', 'meals', 'weight', 'waist', 'pr', 'record', 'sport', 'sports', 'athlete', 'pushups', 'situps', 'squats', 'plank', 'run'],
    pushes: ['water', 'training'],
    settings: ['sport_tracker_json', 'body_plus', 'food_log', 'food_goals', 'food_saved', 'food_ben', 'body_tape', 'sport_rest_days']
  },
  {
    id: 'discipline',
    label: 'Discipline',
    line: 'The days-clean counter, check-in, morning oath and the urge crusher.',
    pages: ['discipline'],
    island: [],
    desktop: [],
    server: [],
    bot: ['checkin', 'clean', 'oath', 'crush', 'panic', 'urge'],
    pushes: [],
    settings: ['discipline_stealth', 'discipline_why', 'discipline_triggers']
  },
  {
    id: 'study',
    label: 'Study Time',
    line: 'Study blocks with a pomodoro, breaks, stats and Todoist study tasks.',
    pages: ['study'],
    island: ['studyTime'],
    desktop: ['studyAlarm'],
    server: [],
    bot: [],
    pushes: [],
    settings: ['study_blocks', 'study_log']
  },
  {
    id: 'calendar',
    label: 'Calendar',
    line: 'Your Google Calendar by week or day, class and leave-now warnings, the day strip.',
    pages: ['calendar'],
    island: ['now', 'next', 'maybe', 'call', 'inMeeting', 'day', 'work'],
    desktop: ['eventAlerts', 'planAutoSync'],
    server: ['tick.calendarWatch', 'tick.calendarAlerts', 'tick.lateBlock'],
    bot: [],
    pushes: ['block', 'event', 'leave'],
    settings: ['cal_templates', 'ben_cal_seen']
  },
  {
    id: 'tasks',
    label: 'Tasks',
    line: 'Your Todoist, by area, with points for tasks done.',
    pages: ['tasks'],
    island: ['tasks', 'tasksAt', 'tasksStale'],
    desktop: ['todoistWatch'],
    server: ['tick.todoistPay'],
    bot: ['todo', 'tasks', 'task', 'add', 'done', 'tick', 'complete'],
    pushes: [],
    settings: []
  },
  {
    id: 'coach',
    label: 'Coach (Ben)',
    line: 'Ben, the AI coach: chat, plans, check-ins, nudges, memory and his Telegram chat.',
    pages: ['coach'],
    island: ['ben', 'nudgeWhy', 'dayState', 'story', 'doing', 'move'],
    desktop: ['benBubble', 'coachUnread'],
    server: ['tick.rhythm', 'tick.desk', 'tick.memory', 'tick.checkins', 'tick.nudges', 'daily.morning', 'daily.reask', 'daily.midday', 'daily.evening'],
    bot: ['coach', 'ben'],
    pushes: ['ben', 'review'],
    settings: ['coach_rhythm', 'coach_rhythm_prefs', 'coach_memory', 'coach_nudges', 'coach_reminders', 'ben_desk', 'ben_pushes']
  },
  {
    id: 'goals',
    label: 'Goals',
    line: 'Every goal with its deadline and pace, the goal ladder and the week top 3.',
    pages: ['goals'],
    island: ['goals', 'week'],
    desktop: [],
    server: ['tick.goals'],
    bot: ['goals', 'wishlist', 'deadlines'],
    pushes: ['week'],
    settings: ['goal_ladder', 'goal_asks', 'goal_booking', 'week_top3_ask']
  },
  {
    id: 'season',
    label: 'Season',
    line: 'The 12-week arc and its boss, vision board, wins wall and the level-up scenes.',
    pages: ['season'],
    island: ['saga'],
    desktop: ['cinematics'],
    server: [],
    bot: [],
    pushes: [],
    settings: ['saga_seasons', 'saga_vision', 'saga_wins', 'saga_arc']
  },
  {
    id: 'career',
    label: 'Career',
    line: 'Job hunt, flashcards, study packs, essays and the money plan behind your career.',
    pages: ['career'],
    island: ['study'],
    desktop: [],
    server: ['tick.career'],
    bot: ['quiz', 'pack', 'jobs', 'career'],
    pushes: [],
    settings: ['career_jobs', 'career_cards', 'career_study', 'career_money', 'career_letters']
  },
  {
    id: 'insights',
    label: 'Insights',
    line: 'Am I improving? Week score, streaks, your year and the week plan.',
    pages: ['progress', 'focus'],
    island: [],
    desktop: [],
    server: [],
    bot: [],
    pushes: [],
    settings: ['week_plan', 'week_plans', 'month_aims']
  },
  {
    id: 'rewards',
    label: 'Rewards',
    line: 'Spend your points on fun time and real rewards; loot, coupons and the points history.',
    pages: ['shop', 'history'],
    island: ['points', 'pointsFx'],
    desktop: [],
    server: [],
    bot: ['vault', 'economy', 'fun', 'shop'],
    pushes: [],
    settings: ['reward_budget', 'reward_coupons', 'streak_shields', 'fun_budget']
  },
  {
    id: 'locker',
    label: 'Photo Locker',
    line: 'Progress photos, short videos and files, backed up to your Google Drive.',
    pages: ['locker'],
    island: [],
    desktop: ['driveSync'],
    server: [],
    bot: [],
    pushes: [],
    settings: ['vault_index']
  },
  {
    id: 'music',
    label: 'Music',
    line: 'SoundCloud stations, lyrics and the players on your PC.',
    pages: ['music'],
    island: ['musicPause'],
    desktop: ['musicHost'],
    server: [],
    bot: [],
    pushes: [],
    settings: ['music_now']
  },
  {
    id: 'custom',
    label: 'Custom Center',
    line: 'Your own widgets, actions, reminders, modes and looks for the island and the app.',
    pages: ['custom'],
    island: ['center', 'widgets', 'kit', 'weather', 'moment', 'auto'],
    desktop: ['customBackground'],
    server: [],
    bot: [],
    pushes: [],
    settings: ['custom_setup', 'custom_state', 'island_widgets', 'island_kit']
  },
  {
    id: 'focusBoost',
    label: 'Focus boost',
    line: 'Push ladder, launch kits, Dojo mode, "why I\'m stalling" and win music.',
    pages: [],
    island: [],
    desktop: ['focusBoost'],
    server: [],
    bot: [],
    pushes: [],
    settings: ['focus_boost', 'focus_log']
  },
  {
    // Off: the desktop never creates the island window (src/desktop/island.ts), the app stops building its
    // snapshots, and your own timers end with the in-app chime and a Windows notification instead.
    id: 'island',
    label: 'Dynamic island',
    line: 'The floating island at the top of the screen on Windows: timers, quick logs and notices.',
    pages: [],
    island: [],
    desktop: ['islandWindow', 'islandFeed'],
    server: [],
    bot: [],
    pushes: [],
    settings: ['island_day_log', 'island_nudges', 'island_recipes']
  },
  {
    id: 'growth',
    label: 'Growth level',
    line: 'The Growth level (Seedling to Legend) in the header and on Today.',
    pages: [],
    island: [],
    desktop: [],
    server: [],
    bot: [],
    pushes: [],
    settings: []
  },
  {
    id: 'notebook',
    label: 'Notebook',
    line: 'Your notes and Ben\'s notes about you, your journal.',
    pages: ['notebook'],
    island: [],
    desktop: [],
    server: [],
    bot: [],
    pushes: [],
    settings: []
  },
  {
    id: 'plugins',
    label: 'Plugins & automation',
    line: 'Plugins (weather, GitHub…), PC automations, n8n flows and webhooks.',
    pages: [],
    island: [],
    desktop: ['pcAutomations'],
    server: ['tick.plugins', 'tick.n8n', 'cron.plugins'],
    bot: [],
    pushes: [],
    settings: ['plugins_on', 'automations']
  }
]

export const MODULE_IDS = MODULE_LIST.map((m) => m.id)

/** The owner's choice (2026-11-12): these five on, everything else off. */
export const DEFAULT_ON: readonly ModuleId[] = ['today', 'money', 'sleep', 'sport', 'discipline']

export type ModulesOn = Record<ModuleId, boolean>

export const DEFAULT_MODULES: ModulesOn = Object.fromEntries(MODULE_IDS.map((id) => [id, DEFAULT_ON.includes(id)])) as ModulesOn

export const ALL_ON: ModulesOn = Object.fromEntries(MODULE_IDS.map((id) => [id, true])) as ModulesOn

const byId = new Map(MODULE_LIST.map((m) => [m.id, m]))
export const moduleDef = (id: ModuleId): ModuleDef => byId.get(id)!

/**
 * The stored setting (`{ on: { study: true, … } }`) on top of the defaults. Missing or
 * unreadable = the defaults; a module added later starts at its default. Today is always on.
 */
export function readModules(raw: unknown): ModulesOn {
  let r: any = raw
  if (typeof raw === 'string') {
    try {
      r = JSON.parse(raw)
    } catch {
      r = null
    }
  }
  const out = { ...DEFAULT_MODULES }
  const on = r && typeof r === 'object' && r.on && typeof r.on === 'object' && !Array.isArray(r.on) ? r.on : null
  if (on) for (const id of MODULE_IDS) if (typeof on[id] === 'boolean') out[id] = on[id]
  for (const m of MODULE_LIST) if (m.locked) out[m.id] = true
  return out
}

/** What is stored: every module's state (so later default changes never flip a choice). */
export const writeModules = (m: ModulesOn): string => JSON.stringify({ on: readModules({ on: m }) })

/** Turn one module on or off (Today stays on). */
export function setModule(m: ModulesOn, id: ModuleId, on: boolean): ModulesOn {
  return readModules({ on: { ...m, [id]: on } })
}

export const isOn = (m: ModulesOn, id: ModuleId): boolean => m[id] !== false

/** The module a page belongs to; null for system pages (Settings, Connected apps, Telegram bots). */
export function pageModule(page: string): ModuleId | null {
  for (const m of MODULE_LIST) if (m.pages.includes(page)) return m.id
  return null
}

/** Is this page usable now? System pages always are. */
export const pageOn = (m: ModulesOn, page: string): boolean => {
  const id = pageModule(page)
  return !id || isOn(m, id)
}

/** The module that runs this background job (desktop or server); null = not a module's job. */
export function jobModule(job: string): ModuleId | null {
  for (const m of MODULE_LIST) if (m.desktop.includes(job) || m.server.includes(job)) return m.id
  return null
}

/** May this background job run? A job of no module (backups, health, sync) always may. */
export const jobOn = (m: ModulesOn, job: string): boolean => {
  const id = jobModule(job)
  return !id || isOn(m, id)
}

/** The module of a Telegram command ("/quiz 3", "/todo@MyBot"); null for free text or a command of no module. */
export function commandModule(text: string): ModuleId | null {
  const c = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(String(text ?? '').trim())
  if (!c) return null
  const cmd = c[1].toLowerCase()
  for (const m of MODULE_LIST) if (m.bot.includes(cmd)) return m.id
  return null
}

/** The reply to a command of a module that is off. */
export const OFF_REPLY = 'This part is switched off. Turn it on in Settings → Modules'

/** The OFF reply for this text when its command belongs to a module that is off; null otherwise. */
export function offReply(m: ModulesOn, text: string): string | null {
  const id = commandModule(text)
  return id && !isOn(m, id) ? `${moduleDef(id).label}: ${OFF_REPLY}` : null
}

/** The daily-push slot ids (notifyBudget `budget:<slot>:<day>`) and the module that owns each. */
const SLOT_MODULE: Record<string, ModuleId> = { morning: 'today', afternoon: 'today', plan: 'today', weekly: 'today', winddown: 'sleep', lastcall: 'sleep' }

/** The module a notification belongs to: the daily pushes by their slot, then its kind, then the page it opens. */
export function notifModule(n: { id?: string; kind?: string; action?: { kind?: string; page?: string } | null }): ModuleId | null {
  const slot = /^budget:([a-z]+):/.exec(String(n.id ?? ''))
  if (slot && SLOT_MODULE[slot[1]]) return SLOT_MODULE[slot[1]]
  if (/^(night|bedcheck):/.test(String(n.id ?? ''))) return 'sleep'
  const kind = String(n.kind ?? '')
  for (const m of MODULE_LIST) if (m.pushes.includes(kind)) return m.id
  const page = n.action?.kind === 'page' ? n.action.page : undefined
  return page ? pageModule(page) : null
}

/** May this notification show (bell, pop-up, Telegram)? One of no module (health, updates) always may. */
export const notifOn = (m: ModulesOn, n: Parameters<typeof notifModule>[0]): boolean => {
  const id = notifModule(n)
  return !id || isOn(m, id)
}

/** Which island sections belong to modules that are off (to be emptied). */
export function islandOff(m: ModulesOn): string[] {
  return MODULE_LIST.filter((d) => !isOn(m, d.id)).flatMap((d) => d.island)
}

/**
 * The sidebar: the pages of the modules that are on, in module order, without pages you
 * hid in Settings → Look. `known` is the list of pages the sidebar can draw.
 */
export function menuPages(m: ModulesOn, known: readonly string[], hidden: readonly string[] = []): string[] {
  const k = new Set(known)
  const h = new Set(hidden)
  return MODULE_LIST.filter((d) => isOn(m, d.id)).flatMap((d) => d.pages.filter((p) => k.has(p) && !h.has(p)))
}

/** Alt+1…9: the n-th page of the menu as shown (never a page of a module that is off). */
export function altPage(m: ModulesOn, known: readonly string[], hidden: readonly string[], n: number): string | null {
  return menuPages(m, known, hidden)[n - 1] ?? null
}

/**
 * An island snapshot with the sections of off modules emptied: lists become [], the required
 * blocks null, water 0 of 0, Ben's dot and move gone; the rest is left out. Pure (any snapshot shape).
 */
export function islandWithout<T extends Record<string, any>>(snap: T, m: ModulesOn): T {
  const off = islandOff(m)
  const offIds = MODULE_LIST.filter((d) => !isOn(m, d.id)).map((d) => d.id)
  if (!offIds.length) return snap
  const out: Record<string, any> = { ...snap, off: offIds }
  for (const k of off) {
    if (!(k in out)) continue
    const v = out[k]
    if (k === 'ben') out.ben = { ...v, unread: 0, move: null, last: null }
    else if (k === 'water') out.water = { ml: 0, target: 0 }
    else if (Array.isArray(v)) out[k] = []
    else if (k === 'now' || k === 'next') out[k] = null
    else delete out[k]
  }
  return out as T
}
