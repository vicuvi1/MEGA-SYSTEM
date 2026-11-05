// LT5: every key of the `settings` table (key → text value, synced to every
// device and the server), with what it holds, its type, how to read it and its
// default. Read and write through readSetting / writeSetting (src/main/settings.ts)
// to get the parsed, typed value; the old getSetting / setSetting (raw text) keep
// working while the rest moves over. A test (settingsKeys.test.ts) fails when
// code uses a key that isn't listed here, so a typo can't make a second key.
//
// Pure: no database here, only the list and the parsers.
//
// Growing data, the plan (not done yet): `coach_log` is a JSON array capped at
// 200 entries, rewritten whole on every message, and synced as one blob. It
// should become a real table, append-only, added by a new migration at the end
// of MIGRATIONS (src/core/schema.ts):
//   CREATE TABLE IF NOT EXISTS coach_log (id INTEGER PRIMARY KEY AUTOINCREMENT,
//     at TEXT NOT NULL, role TEXT NOT NULL, entry TEXT NOT NULL)  -- entry = the JSON
// then a one-time copy that runs only when the table is empty and the setting
// has entries (idempotent, safe on the server and on every device at once,
// because `INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM coach_log)` is one
// statement), reading the setting as a fallback until the copy is there. The
// catch that keeps it for later: loadLog/appendLog/saveLog in
// src/renderer/src/web/botBrain.ts are used inside mirror.write by the server
// and by every open device, the undo path rewrites entries in place (undone[],
// feedback), and the sync of only what changed (tableVersions.ts) must track
// the new table. That needs its own change with two-device tests.

import type { Reminder } from './coachKit'

/** How a value is stored as text. */
export type SettingType = 'json' | 'text' | 'number' | 'flag'

export interface KeySpec<T> {
  /** What it holds, in a few words. */
  about: string
  type: SettingType
  /** What readSetting gives when the key is missing or can't be read. */
  fallback: T
  parse: (raw: string | null) => T
  serialize: (value: T) => string
}

function json<T>(about: string, fallback: T): KeySpec<T> {
  return {
    about,
    type: 'json',
    fallback,
    parse: (raw) => {
      if (raw == null || raw === '') return fallback
      try {
        const v = JSON.parse(raw)
        return v == null ? fallback : (v as T)
      } catch {
        return fallback
      }
    },
    serialize: (v) => JSON.stringify(v)
  }
}
function text(about: string): KeySpec<string | null> {
  return { about, type: 'text', fallback: null, parse: (raw) => raw, serialize: (v) => v ?? '' }
}
function num(about: string, fallback = 0): KeySpec<number> {
  return {
    about,
    type: 'number',
    fallback,
    parse: (raw) => {
      const n = raw == null || raw === '' ? NaN : Number(raw)
      return Number.isFinite(n) ? n : fallback
    },
    serialize: (v) => String(v)
  }
}
/** '1' on, anything else off. */
function flag(about: string): KeySpec<boolean> {
  return { about, type: 'flag', fallback: false, parse: (raw) => raw === '1', serialize: (v) => (v ? '1' : '0') }
}

/** The one shared water + reps log (its day turns at 04:00). */
export interface SportBlob {
  savedAt?: number
  data?: any
}
/** A focus session running now. */
export interface FocusRunning {
  subject: string
  startedAt: string
  planned?: number
  task?: unknown
  /** IC1: paused since (ISO), and the time paused before it (ms). */
  pausedAt?: string | null
  pausedMs?: number
  /** IC11: a break and the next block after it (from the island). */
  stages?: unknown[]
}

export const SETTINGS = {
  // ---- sync and system ----
  data_version: num('bumped on every write; devices refresh when it changes'),
  coach_tick_at: num('old place of the tick clock (now in sys_kv); never written to settings'),
  pin_hash: text('old device PIN hash (the PIN lives on the server now)'),
  theme: text('the app look (dark / light)'),
  bot_bridge_config: json<Record<string, unknown> | null>('Telegram bot tokens and chat ids saved in the app', null),
  notif_settings: json<Record<string, unknown> | null>('quiet hours, event warnings, travel times (N2, N3, N6)', null),
  milestones_seen: json<unknown[]>('milestones already celebrated', []),
  island_day_log: json<Record<string, unknown> | null>("the island's log of the day", null),
  island_recipes: json<unknown[]>('Smart island recipes: when → if → then, safe actions only (src/core/recipes.ts)', []),
  // ---- shared app data (embedded apps) ----
  sport_tracker_json: json<SportBlob | null>('Sport Track: water + reps, {savedAt, data:{lastDate, exercises, water}}', null),
  sport_sync_seen: json<{ at?: string } | null>('when Sporty last synced water and workouts', null),
  sporty_status: json<Record<string, unknown> | null>("Sporty's last status", null),
  sporty_update_request: json<Record<string, unknown> | null>('a change waiting for Sporty to pick up', null),
  sport_rest_days: json<unknown[]>('days marked as rest days', []),
  ben_workouts: json<unknown[]>('workouts Ben logged', []),
  app_sync_finance: json<Record<string, unknown> | null>('Finance Helper data synced into Life System', null),
  app_sync_waky: json<Record<string, unknown> | null>('Waky (sleep) data synced into Life System', null),
  finance_backup_json: json<Record<string, unknown> | null>('older copy of the Finance Helper data', null),
  waky_backup_json: json<Record<string, unknown> | null>('older copy of the Waky data', null),
  finance_inbox_json: json<unknown[]>('bank lines waiting to be sorted in Finance Helper', []),
  fin_tx_links: json<Record<string, unknown> | null>('money entries linked to Finance Helper transactions', null),
  tg_expense_links: json<Record<string, unknown> | null>('Telegram messages linked to the expenses they logged', null),
  conn_finance_since: text('when Finance Helper was first connected'),
  money_ask: json<Record<string, unknown> | null>('a money question Ben is waiting on', null),
  money_currency: text('currency for money (MDL)'),
  money_daily_budget: num('daily spending budget'),
  // ---- Ben ----
  coach_log: json<unknown[]>("Ben's chat (newest 200 entries)", []),
  coach_memory: json<Record<string, unknown> | null>("Ben's memory: facts and recent chat", null),
  coach_profile: json<Record<string, unknown> | null>('about you, as Ben knows it', null),
  coach_mind: json<Record<string, unknown> | null>('long-term memory: goals, people, what works', null),
  coach_reminders: json<Reminder[]>('reminders and check-ins Ben will send', []),
  coach_nudges: json<Record<string, unknown> | null>('nudge state (paused today, last sent)', null),
  coach_rhythm: json<Record<string, unknown> | null>('the daily rhythm: morning plan, reviews', null),
  coach_rhythm_prefs: json<Record<string, unknown> | null>('daily rhythm settings', null),
  coach_history: json<unknown[]>('past days Ben looks back on', []),
  coach_letters: json<unknown[]>("Ben's weekly letters", []),
  coach_feedback: json<unknown[]>('your thumbs up / down on replies', []),
  coach_selfreview: json<Record<string, unknown> | null>("Ben's review of his own week", null),
  coach_story: json<Record<string, unknown> | null>('the story of your weeks', null),
  coach_style: json<Record<string, unknown> | null>("Ben's tone and style", null),
  coach_adapt: json<Record<string, unknown> | null>('how Ben adapts the plan to how it went', null),
  goal_booking: json<Record<string, unknown> | null>('goal blocks booked into the calendar', null),
  ben_desk: json<object | null>("Ben's desk: excuses, moods, study, stakes, calls, letters", null),
  ben_experiment: json<Record<string, unknown> | null>('the experiment running now', null),
  ben_why: json<unknown[]>('why Ben did what he did', []),
  ben_confirm: json<Record<string, unknown> | null>('an action waiting for your yes', null),
  ben_cal_seen: json<unknown[]>('old place of the calendar events Ben saw (now in sys_kv)', []),
  ben_outbox: json<unknown[]>('messages Telegram refused, tried again for 6 hours', []),
  ben_sent_count: json<{ day: string; n: number } | null>('messages Ben sent on his own today (app day)', null),
  ben_sent_today: json<{ day: string; kinds: string[] } | null>('kinds of message already sent today (app day)', null),
  ben_misstwice_day: text('app day of the last "never miss twice" message'),
  voiced_kinds: json<{ day: string; kinds: string[] } | null>('nudge kinds Ben already wrote in his own words today', null),
  morning_sent_day: text('day the morning message went out'),
  wind_down_day: text('day the wind-down message went out'),
  plan_suggestion: json<Record<string, unknown> | null>("Ben's suggested plan for today", null),
  area_words: json<Record<string, unknown> | null>('words that map tasks to life areas', null),
  task_area_colors: json<Record<string, string> | null>('colours of the life areas', null),
  // ---- plan, focus, calendar ----
  focus_running: json<FocusRunning | null>('the focus session running now, or null', null),
  focus_ratings: json<unknown[]>('how each focus session felt', []),
  block_marks: json<Record<string, unknown> | null>('calendar blocks marked done / skipped', null),
  blocks_settled_day: text('day the blocks were last settled'),
  cal_templates: json<unknown[]>('saved calendar templates', []),
  today_order: json<unknown[]>("the order of Today's cards", []),
  week_plan: json<Record<string, unknown> | null>("this week's plan", null),
  week_plans: json<Record<string, unknown> | null>('past week plans', null),
  my_habits: json<unknown[]>('your own habits', []),
  month_aims: json<Record<string, unknown> | null>("the month's aims", null),
  learn_log: json<unknown[]>('learning path log', []),
  life_mode: json<Record<string, unknown> | null>('life mode (exam, holiday, sick…)', null),
  // ---- sleep ----
  sleep_bed_target: text('bedtime target (HH:MM)'),
  sleep_weekday_target: text('weekday wake target (HH:MM)'),
  sleep_weekend_target: text('weekend wake target (HH:MM)'),
  // ---- discipline ----
  discipline_stealth: flag('stealth mode: neutral words everywhere ("1" on)'),
  discipline_triggers: json<unknown[]>('urge triggers you logged', []),
  discipline_undone_resets: json<unknown[]>('resets you took back', []),
  discipline_warned: json<Record<string, unknown> | null>('risk warnings already sent', null),
  urge_started_at: text('when the current urge started (ISO), or empty'),
  // ---- points, rewards, bank ----
  points_v2: text('marker: points moved to version 2'),
  points_v3: text('marker: points moved to version 3'),
  'perk.shadow_monarch.p1_streak': num('perk: P1 task streak'),
  'hunter.stat_allocation': json<Record<string, number> | null>('points put into each stat', null),
  streak_shields: num('streak shields you hold'),
  reward_budget: num('monthly money for rewards'),
  reward_unlocks: json<Record<string, unknown> | null>('rewards that unlock with a goal or streak', null),
  currency: text('old name of the money currency'),
  coin_exchange_rate: num('lei per point'),
  bank_base_rate: num('points bank interest rate'),
  bank_cap_per_level: num('points bank cap per level'),
  bank_last_interest_day: text('day interest was last paid'),
  bank_staked_coins: num('points in the bank'),
  bank_total_interest_earned: num('interest earned so far'),
  // ---- plugins ----
  plugins_on: json<Record<string, boolean>>('which plugins are switched on', {}),
  plugins_status: json<Record<string, unknown>>("how each plugin's last job went", {}),
  plugin_notes_notion: json<Record<string, unknown> | null>('the notes plugin: Notion settings', null)
} satisfies Record<string, KeySpec<any>>

/**
 * Families of keys made from a prefix (one per plugin, shop item, synced app).
 * Code builds them with a template string, e.g. `plugin_${id}`.
 */
export const SETTING_PREFIXES: Record<string, string> = {
  plugin_: 'plugin_<id>: your settings for a plugin; plugin_<id>_data: what its job fetched',
  price_: 'price_<item>: the shop price of an item, in points',
  app_sync_: 'app_sync_<app>: data an embedded app synced in'
}

export type SettingKey = keyof typeof SETTINGS
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]['fallback']

export const isSettingKey = (key: string): key is SettingKey => Object.prototype.hasOwnProperty.call(SETTINGS, key)

/** Listed, or one of the prefix families. */
export const knownSettingKey = (key: string): boolean => isSettingKey(key) || Object.keys(SETTING_PREFIXES).some((p) => key.startsWith(p))

export function parseSetting<K extends SettingKey>(key: K, raw: string | null): SettingValue<K> {
  return (SETTINGS[key] as KeySpec<SettingValue<K>>).parse(raw)
}
export function serializeSetting<K extends SettingKey>(key: K, value: SettingValue<K>): string {
  return (SETTINGS[key] as KeySpec<SettingValue<K>>).serialize(value)
}
