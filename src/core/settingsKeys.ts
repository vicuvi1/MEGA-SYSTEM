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
  /** Study Time: the block this timer is for, an open stopwatch (no planned length), the break's planned minutes. */
  blockId?: string | null
  open?: boolean
  breakMin?: number | null
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
  island_nudges: json<Record<string, unknown> | null>('Island 2 nudges: settings, people to call, daily tallies, move breaks to undo (src/core/islandNudges.ts)', null),
  island_recipes: json<unknown[]>('Smart island recipes: when → if → then, safe actions only (src/core/recipes.ts)', []),
  island_widgets: json<Record<string, unknown> | null>('PL1–PL8: installed widgets (pinned hashes, permissions), island pages, script tiles, the island look and the synced layout (src/core/widgets/settings.ts)', null),
  island_kit: json<Record<string, unknown> | null>('Island 2: your island tiles, buttons, profiles, colours and SoundCloud stations, starred tracks and music options (src/core/islandTiles.ts, src/core/music.ts)', null),
  music_now: json<Record<string, unknown> | null>("MU: the song playing now, for Ben (only with \"Ben can see what's playing\" on; src/core/music.ts)", null),
  // ---- shared app data (embedded apps) ----
  sport_tracker_json: json<SportBlob | null>('Sport Track: water + reps, {savedAt, data:{lastDate, exercises, water}}', null),
  sport_sync_seen: json<{ at?: string } | null>('when Sporty last synced water and workouts', null),
  sporty_status: json<Record<string, unknown> | null>("Sporty's last status", null),
  sporty_update_request: json<Record<string, unknown> | null>('a change waiting for Sporty to pick up', null),
  sport_rest_days: json<unknown[]>('days marked as rest days', []),
  body_plus: json<Record<string, unknown> | null>("Body: protein goal (g per kg), saved meals and favourites, supplements you track, today's training dose if you picked one, the pre-shift fuel card (src/main/bodyPlus.ts)", null),
  food_log: json<Record<string, unknown> | null>('Food counter: meals (foods, grams, macros) of the last 45 days, at most 400, and starred meals (at most 20); the day totals are rows in body_log (src/main/food.ts)', null),
  food_goals: json<Record<string, unknown> | null>('Food counter goals (slow muscle gain): height, age, sex, activity, extra kcal over maintenance (+350), your own kcal or protein goal, the weekly weight check adjustment (core/foodGoals.ts)', null),
  food_saved: json<Record<string, unknown> | null>('Saved foods (at most 60), saved meals (at most 24) and the standard day (at most 8 slots) for one-tap food logging; versioned, the seed when missing (core/foodSaved.ts)', null),
  coach_config: json<Record<string, unknown> | null>("The coach's settings: slow-gain goal, meals a day, the 2-week food ramp-up (start, baseline), home training rules, the morning routine, bed time and sleep hours, language, AI line on/off, blood-test reminder dismissed (core/coachConfig.ts)", null),
  coach_days: json<Record<string, unknown> | null>("The coach's days (last 120, size-capped): the day's short record, your own meal and bed ticks, the day's line + tip (asked once a morning), the evening check-in (core/coachPlan.ts). Ticks pay nothing", null),
  coach_weeks: json<Record<string, unknown> | null>("The coach's weekly reviews (last 26): the summary line and which decisions you applied or skipped (core/coachWeek.ts)", null),
  coach_props: json<Record<string, unknown> | null>("The coach's plan-change proposals from the chat (last 12, 7 days): a food swap or meal, a moved session, the ramp-up; open / applied (with what it replaced, for Undo) / skipped / undone. Nothing changes before Apply (core/coachTalk.ts)", null),
  body_tape: json<unknown[]>('Body: tape measurements (arm, chest, shoulders, thigh in cm) by day; waist stays in body_metrics', []),
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
  money_nothing_spent: json<string[]>('days you tapped "Nothing spent today"', []),
  money_cooked_days: json<string[]>('days you confirmed you cooked at home', []),
  // ---- Ben ----
  coach_log: json<unknown[]>("Ben's chat (newest 200 entries)", []),
  coach_memory: json<Record<string, unknown> | null>("Ben's memory: facts and recent chat", null),
  coach_profile: json<Record<string, unknown> | null>('about you, as Ben knows it', null),
  coach_mind: json<Record<string, unknown> | null>('long-term memory: goals, people, what works', null),
  coach_reminders: json<Reminder[]>('reminders and check-ins Ben will send', []),
  health_mutes: json<Record<string, string>>('health alert kinds you muted ("Mute for 7 days"): kind to until (src/core/health.ts)', {}),
  coach_nudges: json<Record<string, unknown> | null>('nudge state (paused today, last sent)', null),
  coach_rhythm: json<Record<string, unknown> | null>('the daily rhythm: morning plan, reviews', null),
  coach_rhythm_prefs: json<Record<string, unknown> | null>('daily rhythm settings', null),
  coach_history: json<unknown[]>('past days Ben looks back on', []),
  coach_letters: json<unknown[]>("Ben's weekly letters", []),
  coach_feedback: json<unknown[]>('your thumbs up / down on replies (with an optional reason)', []),
  coach_pins: json<unknown[]>('messages you pinned in the chat, with a copy of their text (CH4)', []),
  coach_answer_meta: json<Record<string, unknown>>("which model answered each of Ben's replies and roughly what it cost (QA4)", {}),
  coach_selfreview: json<Record<string, unknown> | null>("Ben's review of his own week", null),
  coach_story: json<Record<string, unknown> | null>('the story of your weeks', null),
  coach_blocks: json<unknown[]>("Ben's notes about you: About you, Goals now, How to coach you, People (BR4)", []),
  coach_memory_changes: json<unknown[]>("recent changes to Ben's memory, with what was there before (undo)", []),
  coach_style: json<Record<string, unknown> | null>("Ben's tone and style", null),
  coach_looks: json<Record<string, unknown> | null>("how the chat looks: Ben's face and your photo (small data URL)", null),
  look_wallpaper: json<Record<string, unknown> | null>('the wallpaper: which picture, how strong, blur, shade, where, motion (src/core/wallpaper.ts)', null),
  look_wallpaper_photo: text('your own wallpaper picture, made small on the device (a data URL)'),
  // ---- Custom Center: src/core/custom/ (docs/areas/custom.md) ----
  custom_setup: json<Record<string, unknown> | null>('Custom Center: your widgets, where they sit (pill, open island, home), actions, reminder rules, modes and their schedules, and the looks; versioned, at most 48 KB (core/custom)', null),
  custom_state: json<Record<string, unknown> | null>("Custom Center: today's numbers of your own counters and checklists, and when each reminder rule last fired (core/custom); counters that track water or reps keep no number here", null),
  vault_index: json<Record<string, unknown> | null>('Photo Locker: which photos, videos and files exist and which are in Google Drive (names, tags, dates, sizes, Drive file ids, the chosen folder); metadata only, never image data, at most 400 KB (core/vaultSync.ts)', null),
  // ---- the saga (LF1, LF4–LF7, LF12, LF15, LF18): src/renderer/src/web/sagaStore.ts ----
  saga_seasons: json<Record<string, unknown> | null>('your seasons (12 weeks = the quarter; old ones 8): name, theme, cover, three main quests and the boss (src/core/season.ts)', null),
  goal_ladder: json<Record<string, unknown> | null>('the goal ladder: up to 3 critical goals for the quarter, "Not now" goals, your weekly targets, confirmed monthly milestones and reviews done (src/core/goalLadder.ts)', null),
  saga_vision: json<Record<string, unknown> | null>('the vision board: word of the year, who you are becoming, 6–9 cards (src/core/vision.ts)', null),
  saga_vision_photos: json<Record<string, unknown> | null>('pictures on vision cards, made small on the device (card id → data URL)', null),
  saga_identity: json<Record<string, unknown> | null>('your "I am someone who…" lines and what counts as a vote (src/core/identityVotes.ts)', null),
  saga_side: json<Record<string, unknown> | null>("the weekly side quest's weeks and your adventures log, no photos (src/core/sideQuest.ts)", null),
  saga_wins: json<Record<string, unknown> | null>('wins you added by hand and auto wins you hid (src/core/winsWall.ts)', null),
  saga_wheel: json<Record<string, unknown> | null>('your life wheel ratings by quarter (src/core/lifeWheel.ts)', null),
  saga_arc: json<Record<string, unknown> | null>("Ben's arc: the chapter reveal you saw, his outfit, cinematics already played (src/core/benArc.ts)", null),
  coach_adapt: json<Record<string, unknown> | null>('how Ben adapts the plan to how it went', null),
  goal_booking: json<Record<string, unknown> | null>('goal blocks booked into the calendar', null),
  goal_asks: json<Record<string, unknown> | null>("Ben's goal check-ins: what he asked this period, today's count, auto goals' last number", null),
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
  study_blocks: json<Record<string, unknown> | null>('Study Time: your blocks (name, category, tags, planned length, quick, day, done, linked Todoist task) and category colours; sessions are focus_sessions rows (src/core/studyTime.ts)', null),
  study_log: json<Record<string, unknown> | null>("Study Time: per focus session (by its start time) its block, break minutes and source (timer, manual, fixed); at most 3000, the last 400 days (src/core/studyTime.ts)", null),
  focus_ratings: json<unknown[]>('how each focus session felt', []),
  block_marks: json<Record<string, unknown> | null>('calendar blocks marked done / skipped', null),
  block_kinds: json<Record<string, unknown> | null>('calendar items you set as an event or a focus block (by title)', null),
  blocks_settled_day: text('day the blocks were last settled'),
  cal_templates: json<unknown[]>('saved calendar templates', []),
  today_order: json<unknown[]>("the order of Today's cards", []),
  week_plan: json<Record<string, unknown> | null>("this week's plan", null),
  week_plans: json<Record<string, unknown> | null>('past week plans', null),
  my_habits: json<unknown[]>('your own habits', []),
  habit_board: json<Record<string, unknown> | null>("Today's habit board: icons, colours and times you set, your order, hidden habits, skipped days (src/core/habitBoard.ts)", null),
  month_aims: json<Record<string, unknown> | null>("the month's aims", null),
  learn_log: json<unknown[]>('learning path log', []),
  // ---- career (src/core/career/, src/renderer/src/web/career.ts) ----
  career_jobs: json<Record<string, unknown> | null>('Career: the job board (found, applied, interview, offer, no) with follow-up days, and the weekly application quota', null),
  career_proofs: json<unknown[]>('Career: the proof-of-work portfolio (CTF writeups, crates, labs, features: problem, what you did, skills, link)', []),
  career_cards: json<Record<string, unknown> | null>('Career: flashcards with their spaced-repetition schedule, and the review log', null),
  career_study: json<Record<string, unknown> | null>('Career: essays and assignments planned backward into steps, the shift study queue (CTF hints, readings) and which pack is next', null),
  career_money: json<Record<string, unknown> | null>('Career: the money plan (emergency fund months, pay-yourself-first %, career fund, income target and moves, the investing projection), your answers to each income and career fund spending', null),
  career_letters: json<unknown[]>('Career: the monthly career review letters', []),
  career_asks: json<Record<string, unknown> | null>("Career: what the server's tick already asked today (follow-ups, the shift pack, pay yourself first, essays behind, the letter)", null),
  life_mode: json<Record<string, unknown> | null>('life mode (exam, holiday, sick…)', null),
  sleep_care: json<Record<string, unknown> | null>('Sleep care: your sleep need, the caffeine curfew, and per day the morning light, coffees, the after-shift checklist and the warm screen (src/core/sleepCare.ts)', null),
  grooming: json<Record<string, unknown> | null>('Grooming habit: ticked morning and night steps per day, nails and haircut dates, the haircut rhythm, what each day paid (src/core/grooming.ts)', null),
  life_fit: json<Record<string, unknown> | null>("My life: latest bedtime, the work window (days, hours, how much you really work), how hard Ben pushes, tonight's shift (src/core/lifeFit.ts)", null),
  focus_boost: json<Record<string, unknown> | null>('Focus boost settings: the push ladder, stalling fixes, session goals, launch kits, the morning countdown, Dojo mode and win music (src/core/focusBoost.ts)', null),
  focus_log: json<Record<string, unknown> | null>('Focus boost log: each session\'s goal and Done / Half / Not, and why you stalled (src/core/focusBoost.ts)', null),
  ben_pushes: json<Record<string, unknown> | null>("Ben 2's pushes today: one key per check-in, brief, shutdown and drift word (shown on the island or sent on Telegram, and your answer), tonight's shutdown list with your marks, and drift words waiting for Telegram (src/core/benPushes.ts)", null),
  food_ben: json<Record<string, unknown> | null>('Food counter on Telegram and in Ben: the meal preview waiting for Save (2 hours) and "Mute food nudges" until when (src/core/foodBen.ts)', null),
  ben_pc_seen: json<Record<string, unknown> | null>('whether you are at the PC (written by the desktop app when it changes, at most every 5 minutes): the island or Telegram for Ben\'s pushes', null),
  week_top3_ask: json<Record<string, unknown> | null>('Sunday "pick your top 3" on Telegram: the week, the chips offered and the ones tapped so far', null),
  // ---- sleep ----
  sleep_bed_target: text('bedtime target (HH:MM)'),
  sleep_weekday_target: text('weekday wake target (HH:MM)'),
  sleep_weekend_target: text('weekend wake target (HH:MM)'),
  // ---- discipline ----
  discipline_stealth: flag('stealth mode: neutral words everywhere ("1" on)'),
  discipline_why: text('your reason for the streak, in your words (shown in the urge crusher)'),
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
  reward_budget: num('old monthly money for rewards (moved into fun_budget)'),
  fun_moves: json<Record<string, unknown>>('leftover money moved to a Finance Helper savings goal, by month', {}),
  fun_budget: json<{ lei: number; source: 'manual' | 'finance' } | null>('monthly fun budget in lei, typed or from Finance Helper', null),
  reward_unlocks: json<Record<string, unknown> | null>('rewards that unlock with a goal or streak', null),
  reward_rules: json<Record<string, unknown> | null>('healthy limits per reward: a most-per-day and "pair it" (src/core/rewardGuard.ts)', null),
  reward_coupons: json<unknown[] | null>('coupons from level chests and the weekly mystery reward: a free small treat or a discount (src/core/rewardSurprise.ts)', null),
  reward_suggest_hidden: json<string[] | null>('suggested rewards you said "not for me" to (src/core/rewardSuggest.ts)', null),
  reward_ready_seen: json<string[]>('rewards whose "Ready!" moment was already shown (id:buys)', []),
  currency: text('old name of the money currency'),
  coin_exchange_rate: num('lei per point'),
  bank_base_rate: num('points bank interest rate'),
  bank_cap_per_level: num('points bank cap per level'),
  bank_last_interest_day: text('day interest was last paid'),
  bank_staked_coins: num('points in the bank'),
  bank_total_interest_earned: num('interest earned so far'),
  // ---- PC & automation (AU2, AU7) ----
  pc_asks: json<unknown>("Ben's asks to do something on the PC (Allow / Deny on the desktop island), and whether a desktop app can answer", null),
  pc_last_hour: json<unknown>('the last hour on the PC as app names, sites and minutes (only when shared from the desktop app)', null),
  // ---- Automation hub (AH1–AH22) ----
  automations: json<unknown>('your automations: "When X, do Y", island buttons, Ben may run (src/core/automations.ts); never an address or key', null),
  auto_asks: json<unknown>("Ben's asks to run one of your automations (Allow / Deny on the island)", null),
  // ---- Day plan ----
  ben_know: json<unknown>('what Ben knows as rules you told him (durations, usual times, aliases) and the memories he asks before saving (Yes / No)', null),
  ben_convo: json<unknown>('key points of past chats (decisions, struggles, wins) and a rolling summary', null),
  ben_learn: json<unknown>('the plan of each of the last 30 days, to learn how long things really take', null),
  ben_pushbacks: json<unknown>('when each open task was first due (big ones that keep moving get a "Break it down" chip)', null),
  plan_asked: json<unknown>('the tasks you asked Ben to add for today ({day, titles}): the day plan never moves them to tomorrow', null),
  plan_limits: json<Record<string, unknown> | null>('time limits for the planner: most work a day, the off time, protected blocks, a cap per kind (core/planLimits.ts)', null),
  plan_week: json<Record<string, unknown> | null>('the week plan: heavy, normal or light study day and gym day for each weekday (core/planWeek.ts)', null),
  plan_review: json<Record<string, unknown> | null>("the end-of-day check: what happened to each plan block (done, partly, tomorrow, dropped, real minutes), the last 90 days; feeds the learned task times and the plan score (core/planReview.ts)", null),
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
