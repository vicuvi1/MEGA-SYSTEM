import { createRequire } from "node:module";
import initSqlJs from "sql.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
// src/core/schema.ts
var MIGRATIONS = [
	`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    day TEXT NOT NULL,
    module TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('earn', 'spend', 'adjust', 'undo')),
    coins INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    rule_id TEXT,
    ref TEXT,
    note TEXT,
    undo_of INTEGER REFERENCES ledger(id)
  );
  CREATE INDEX ledger_day ON ledger(day);
  CREATE INDEX ledger_rule ON ledger(rule_id);
  CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger
    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;

  CREATE TABLE rules (
    id TEXT PRIMARY KEY,
    module TEXT NOT NULL,
    title TEXT NOT NULL,
    coins INTEGER NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
    daily_cap INTEGER NOT NULL DEFAULT 0,
    cooldown_min INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  `,
	`
  CREATE TABLE rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price > 0),
    tier TEXT NOT NULL CHECK (tier IN ('bronze', 'silver', 'gold', 'legendary')),
    real_cost INTEGER NOT NULL DEFAULT 0 CHECK (real_cost >= 0),
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    note TEXT
  );
  CREATE TABLE redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ledger_id INTEGER NOT NULL UNIQUE REFERENCES ledger(id),
    reward_id INTEGER NOT NULL REFERENCES rewards(id),
    title TEXT NOT NULL,
    real_cost INTEGER NOT NULL DEFAULT 0,
    day TEXT NOT NULL
  );
  INSERT INTO rewards (title, price, tier, real_cost, pinned, note) VALUES
    ('Face cream', 300, 'bronze', 30, 0, NULL),
    ('New phone case', 600, 'bronze', 60, 1, NULL),
    ('Shaver machine', 1500, 'silver', 150, 0, NULL),
    ('Kaaba trip fund', 20000, 'legendary', 2000, 0, 'The big one. Keep stacking.');
  `,
	`
  CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO categories (id, label, color, sort) VALUES
    ('body', 'Body', '#FF6B8B', 1), ('face', 'Face', '#F9A8D4', 2), ('finance', 'Finance', '#F5C84B', 3),
    ('university', 'University', '#7CC4FF', 4), ('life', 'Life', '#C8F135', 5);

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL REFERENCES categories(id),
    coins INTEGER NOT NULL DEFAULT 5,
    xp INTEGER NOT NULL DEFAULT 10,
    priority INTEGER NOT NULL DEFAULT 2,
    due TEXT,
    repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekly')),
    weekdays INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_day TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  -- A completion is the ledger row; this links it to the task and day.
  CREATE TABLE task_done (
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    day TEXT NOT NULL,
    ledger_id INTEGER NOT NULL REFERENCES ledger(id),
    PRIMARY KEY (task_id, day)
  );

  CREATE TABLE blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('study', 'workout', 'other')),
    start TEXT NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes BETWEEN 5 AND 600),
    weekdays INTEGER NOT NULL DEFAULT 0,
    date TEXT,
    remind_min INTEGER NOT NULL DEFAULT 5,
    created_day TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE block_log (
    block_id INTEGER NOT NULL REFERENCES blocks(id),
    day TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'skipped', 'missed')),
    started_at TEXT,
    ended_at TEXT,
    ledger_id INTEGER REFERENCES ledger(id),
    PRIMARY KEY (block_id, day)
  );
  `,
	`
  CREATE TABLE discipline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('start', 'reset', 'checkin', 'oath', 'urge')),
    day TEXT NOT NULL,
    ts TEXT NOT NULL
  );
  CREATE INDEX discipline_day ON discipline_events(day);
  CREATE TRIGGER discipline_no_update BEFORE UPDATE ON discipline_events
    BEGIN SELECT RAISE(ABORT, 'discipline log is append-only'); END;
  CREATE TRIGGER discipline_no_delete BEFORE DELETE ON discipline_events
    BEGIN SELECT RAISE(ABORT, 'discipline log is append-only'); END;
  `,
	`
  CREATE TABLE exercises (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'reps',
    target INTEGER NOT NULL DEFAULT 10,
    category TEXT NOT NULL DEFAULT 'calisthenics',
    sort INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    ts TEXT NOT NULL,
    title TEXT NOT NULL,
    items_json TEXT NOT NULL,
    note TEXT,
    ledger_id INTEGER REFERENCES ledger(id)
  );
  CREATE INDEX workouts_day ON workouts(day);

  CREATE TABLE body_metrics (
    day TEXT PRIMARY KEY,
    weight REAL,
    waist REAL,
    note TEXT,
    updated_at TEXT NOT NULL
  );
  `,
	`
  CREATE TABLE sleep_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL UNIQUE,
    wake_time TEXT NOT NULL,
    wake_target TEXT NOT NULL,
    on_time INTEGER NOT NULL DEFAULT 0,
    bed_time TEXT,
    bed_target TEXT,
    bed_on_time INTEGER,
    quality INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX sleep_day ON sleep_logs(day);

  CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    amount INTEGER NOT NULL,
    category TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX expenses_day ON expenses(day);
  `,
	`
  CREATE TABLE wishlist_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    target_coins INTEGER NOT NULL,
    target_real_cost INTEGER NOT NULL,
    allocated_coins INTEGER NOT NULL DEFAULT 0,
    allocated_real_cost INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'gear',
    pinned INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX wishlist_pinned ON wishlist_goals(pinned, completed);

  CREATE TABLE reward_vault_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('surplus_credit', 'manual_deposit', 'goal_allocation', 'reward_payout', 'chest_bonus')),
    amount INTEGER NOT NULL,
    ref TEXT,
    note TEXT NOT NULL
  );
  CREATE INDEX vault_day ON reward_vault_ledger(day);

  CREATE TABLE chest_loot_drops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level INTEGER NOT NULL,
    loot_type TEXT NOT NULL,
    loot_value INTEGER NOT NULL,
    loot_label TEXT NOT NULL,
    ts TEXT NOT NULL
  );
  `,
	`
  ALTER TABLE rewards ADD COLUMN image_url TEXT;
  ALTER TABLE rewards ADD COLUMN currency TEXT NOT NULL DEFAULT 'MDL';
  ALTER TABLE wishlist_goals ADD COLUMN image_url TEXT;
  ALTER TABLE wishlist_goals ADD COLUMN currency TEXT NOT NULL DEFAULT 'MDL';
  `,
	`
  UPDATE tasks SET category = 'life' WHERE category IN ('today', 'tomorrow');
  UPDATE categories SET archived = 1 WHERE id IN ('today', 'tomorrow');
  `,
	`
  DELETE FROM settings WHERE key = 'pin_hash';
  `,
	`
  CREATE TABLE IF NOT EXISTS active_buffs (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    effect_kind TEXT NOT NULL,
    effect_val REAL NOT NULL,
    icon TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS active_buffs_expiry ON active_buffs(expires_at);

  CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    description TEXT NOT NULL,
    icon TEXT NOT NULL
  );
  `,
	`
  UPDATE rewards SET real_cost = CAST(ROUND(price / 10.0) AS INTEGER) WHERE real_cost != CAST(ROUND(price / 10.0) AS INTEGER) OR real_cost = 0;
  `,
	`
  ALTER TABLE rewards ADD COLUMN product_url TEXT;
  ALTER TABLE wishlist_goals ADD COLUMN product_url TEXT;
  `,
	`
  CREATE INDEX IF NOT EXISTS idx_ledger_day_id ON ledger(day, id);
  CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger(ts);
  CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category);
  `,
	`
  CREATE TABLE IF NOT EXISTS applied_sync_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    day TEXT NOT NULL,
    ts TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    payload_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_applied_sync_day ON applied_sync_events(day);
  `,
	`
  CREATE TABLE IF NOT EXISTS bot_seen_updates (key TEXT PRIMARY KEY, ts TEXT NOT NULL);
  `,
	`
  CREATE TABLE IF NOT EXISTS focus_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    subject TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS focus_day ON focus_sessions(day);
  CREATE TABLE IF NOT EXISTS focus_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    deadline TEXT NOT NULL,
    hours REAL NOT NULL,
    created_day TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS day_plans (
    day TEXT PRIMARY KEY,
    items TEXT NOT NULL DEFAULT '[]',
    review TEXT,
    reasons TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  `
];
// src/core/ledger.ts
var LedgerError = class extends Error {
	name = "LedgerError";
};
/** Rows that still count: not undo rows and not undone. */
function effective(entries) {
	const undone = /* @__PURE__ */ new Set();
	for (const e of entries) if (e.kind === "undo" && e.undoOf != null) undone.add(e.undoOf);
	return entries.filter((e) => e.kind !== "undo" && !undone.has(e.id));
}
function balance(entries) {
	return effective(entries).reduce((s, e) => s + e.coins, 0);
}
/** XP only ever goes up; undoing an earn is the one way it is corrected. */
function totalXp(entries) {
	return effective(entries).reduce((s, e) => s + Math.max(0, e.xp), 0);
}
/**
* Penalties dock coins but never push the balance below zero, so one bad day
* can't wipe out the wallet.
*/
function clampPenalty(currentBalance, coins) {
	if (coins >= 0) return coins;
	return Math.max(coins, -Math.max(0, currentBalance));
}
/** Validates an undo and returns the row to insert. */
function planUndo(entries, id, note, ts, day) {
	if (!note.trim()) throw new LedgerError("An undo needs a reason");
	const target = entries.find((e) => e.id === id);
	if (!target) throw new LedgerError("Entry not found");
	if (target.kind === "undo") throw new LedgerError("Cannot undo an undo");
	if (target.ref?.startsWith("chest:")) throw new LedgerError("Chest prizes are final");
	if (entries.some((e) => e.kind === "undo" && e.undoOf === id)) throw new LedgerError("Already undone");
	if (balance(entries) - target.coins < 0) throw new LedgerError("Those coins were already spent");
	return {
		ts,
		day,
		module: target.module,
		kind: "undo",
		coins: 0,
		xp: 0,
		ruleId: target.ruleId ?? null,
		ref: target.ref ?? null,
		note,
		undoOf: id
	};
}
// src/core/rules.ts
var DEFAULT_RULES = [
	{
		id: "sleep.up_on_time",
		module: "sleep",
		title: "Up by 07:00",
		coins: 10,
		xp: 20,
		dailyCap: 1,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "sleep.bed_on_time",
		module: "sleep",
		title: "In bed on time",
		coins: 5,
		xp: 10,
		dailyCap: 1,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "study.block_done",
		module: "schedule",
		title: "Study block completed",
		coins: 15,
		xp: 30,
		dailyCap: 6,
		cooldownMin: 20,
		enabled: true
	},
	{
		id: "study.block_skipped",
		module: "schedule",
		title: "Study block skipped",
		coins: -5,
		xp: 0,
		dailyCap: 6,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "discipline.clean_day",
		module: "discipline",
		title: "Clean day",
		coins: 20,
		xp: 40,
		dailyCap: 1,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "discipline.urge_resisted",
		module: "discipline",
		title: "Urge crushed",
		coins: 10,
		xp: 20,
		dailyCap: 5,
		cooldownMin: 10,
		enabled: true
	},
	{
		id: "discipline.oath",
		module: "discipline",
		title: "Morning oath",
		coins: 3,
		xp: 5,
		dailyCap: 1,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "discipline.reset",
		module: "discipline",
		title: "Streak reset",
		coins: -20,
		xp: 0,
		dailyCap: 3,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "body.workout_done",
		module: "body",
		title: "Workout done",
		coins: 10,
		xp: 25,
		dailyCap: 2,
		cooldownMin: 60,
		enabled: true
	},
	{
		id: "face.routine_done",
		module: "tasks",
		title: "Skincare routine",
		coins: 5,
		xp: 10,
		dailyCap: 2,
		cooldownMin: 240,
		enabled: true
	},
	{
		id: "tasks.todoist_done",
		module: "tasks",
		title: "Todoist task done",
		coins: 8,
		xp: 15,
		dailyCap: 12,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "money.under_budget",
		module: "money",
		title: "Stayed under budget",
		coins: 5,
		xp: 10,
		dailyCap: 1,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "money.logged",
		module: "money",
		title: "Logged spending",
		coins: 3,
		xp: 5,
		dailyCap: 1,
		cooldownMin: 0,
		enabled: true
	},
	{
		id: "grand_slam.all_four",
		module: "general",
		title: "4-Pillar Grand Slam (Sovereign Day)",
		coins: 50,
		xp: 100,
		dailyCap: 1,
		cooldownMin: 0,
		enabled: true
	}
];
/**
* Rules paid only through their own section or a connected app (focus timer,
* check-in, urge crusher, Waky, Finance Helper), never by a quick-log tap, so
* the proof behind them can't be skipped.
*/
function isFlowRule(id) {
	return [
		"discipline.",
		"study.",
		"sleep.",
		"money.",
		"tasks.todoist"
	].some((p) => id.startsWith(p));
}
/** Checks caps and cooldowns and returns the row to insert for this rule. */
function planAward(rule, entries, now, day, note) {
	if (!rule.enabled) throw new LedgerError(`"${rule.title}" is turned off`);
	const mine = effective(entries).filter((e) => e.ruleId === rule.id);
	if (rule.dailyCap > 0 && mine.filter((e) => e.day === day).length >= rule.dailyCap) throw new LedgerError(`Daily limit reached for "${rule.title}"`);
	if (rule.cooldownMin > 0 && mine.length) {
		const waitMs = Math.max(...mine.map((e) => Date.parse(e.ts))) + rule.cooldownMin * 6e4 - now.getTime();
		if (waitMs > 0) throw new LedgerError(`Wait ${Math.ceil(waitMs / 6e4)} min before "${rule.title}" again`);
	}
	return {
		ts: now.toISOString(),
		day,
		module: rule.module,
		kind: rule.coins < 0 ? "adjust" : "earn",
		coins: clampPenalty(balance(entries), rule.coins),
		xp: Math.max(0, rule.xp),
		ruleId: rule.id,
		ref: null,
		note: note ?? null,
		undoOf: null
	};
}
var fmtCache = /* @__PURE__ */ new Map();
function formatter(timeZone) {
	const key = timeZone ?? "";
	let f = fmtCache.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit"
		});
		fmtCache.set(key, f);
	}
	return f;
}
/** Local day key (YYYY-MM-DD) for an instant, shifted by DAY_START_HOUR. */
function dayKey(at, timeZone, startHour = 4) {
	const t = typeof at === "string" ? new Date(at) : at;
	const shifted = /* @__PURE__ */ new Date(t.getTime() - startHour * 36e5);
	return formatter(timeZone).format(shifted);
}
function toUtc(day) {
	const [y, m, d] = day.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
}
/** Whole days from a to b (b - a). */
function daysBetween$1(a, b) {
	return Math.round((toUtc(b) - toUtc(a)) / 864e5);
}
function addDays$1(day, n) {
	return new Date(toUtc(day) + n * 864e5).toISOString().slice(0, 10);
}
function monthKey$1(day) {
	return day.slice(0, 7);
}
// src/core/streaks.ts
/**
* Consecutive days ending today. If today isn't done yet the streak is still
* alive as long as yesterday was.
*/
function dayStreak(doneDays, today) {
	const set = new Set(doneDays);
	let cursor = set.has(today) ? today : addDays$1(today, -1);
	let n = 0;
	while (set.has(cursor)) {
		n++;
		cursor = addDays$1(cursor, -1);
	}
	return n;
}
function bestDayStreak(doneDays) {
	const days = [...new Set(doneDays)].sort();
	let best = 0;
	let run = 0;
	for (let i = 0; i < days.length; i++) {
		run = i > 0 && daysBetween$1(days[i - 1], days[i]) === 1 ? run + 1 : 1;
		best = Math.max(best, run);
	}
	return best;
}
/**
* Clean-day stats derived from a start date and relapse dates. The count is
* the number of whole days since the last reset, so it can't be bumped by hand.
*/
function cleanStats(start, relapses, today) {
	if (!start) return {
		current: 0,
		best: 0,
		totalClean: 0,
		relapses: 0,
		since: null
	};
	const resets = relapses.filter((d) => d >= start && d <= today).sort();
	const points = [
		start,
		...resets,
		today
	];
	const segments = [];
	for (let i = 0; i < points.length - 1; i++) segments.push(Math.max(0, daysBetween$1(points[i], points[i + 1])));
	const since = resets.length ? resets[resets.length - 1] : start;
	return {
		current: segments[segments.length - 1] ?? 0,
		best: Math.max(0, ...segments),
		totalClean: segments.reduce((s, n) => s + n, 0),
		relapses: resets.length,
		since
	};
}
// src/core/body.ts
var DEFAULT_EXERCISES = [
	{
		id: "situps",
		name: "Sit-ups",
		unit: "reps",
		target: 60,
		category: "calisthenics",
		sort: 0
	},
	{
		id: "pushups",
		name: "Push-ups",
		unit: "reps",
		target: 123,
		category: "calisthenics",
		sort: 1
	},
	{
		id: "press",
		name: "press",
		unit: "reps",
		target: 50,
		category: "calisthenics",
		sort: 2
	},
	{
		id: "pullups",
		name: "Pull-ups",
		unit: "reps",
		target: 12,
		category: "calisthenics",
		sort: 3
	},
	{
		id: "squats",
		name: "Squats",
		unit: "reps",
		target: 50,
		category: "calisthenics",
		sort: 4
	},
	{
		id: "running",
		name: "Running",
		unit: "min",
		target: 20,
		category: "cardio",
		sort: 5
	}
];
var WEIGHT_RANGE = [25, 300];
var WAIST_RANGE = [40, 200];
function validateWeight(w) {
	if (w == null) return null;
	if (Number.isNaN(w) || w < WEIGHT_RANGE[0] || w > WEIGHT_RANGE[1]) return `Weight must be between ${WEIGHT_RANGE[0]} and ${WEIGHT_RANGE[1]} kg`;
	return null;
}
function validateWaist(w) {
	if (w == null) return null;
	if (Number.isNaN(w) || w < WAIST_RANGE[0] || w > WAIST_RANGE[1]) return `Waist measurement must be between ${WAIST_RANGE[0]} and ${WAIST_RANGE[1]} cm`;
	return null;
}
function validateWorkout(input) {
	if (!input.title || !input.title.trim()) return "Workout title is required";
	if (!input.items || input.items.length === 0) return "At least one exercise is required";
	for (const it of input.items) {
		if (!it.name || !it.name.trim()) return "Exercise name cannot be empty";
		if (it.amount <= 0 || Number.isNaN(it.amount)) return `Amount for ${it.name} must be greater than 0`;
	}
	return null;
}
/** Compute Monday of the week for a given YYYY-MM-DD */
function weekMonday(day) {
	const [y, m, d] = day.split("-").map(Number);
	const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return addDays$1(day, dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
}
function computeWorkoutStats(workouts, today) {
	const workoutDays = Array.from(new Set(workouts.filter((w) => w.day <= today).map((w) => w.day))).sort();
	const streak = dayStreak(workoutDays, today);
	const bestStreak = bestDayStreak(workoutDays);
	const totalWorkouts = workouts.length;
	const workoutDoneToday = workoutDays.includes(today);
	const thisMonday = weekMonday(today);
	const nextMonday = addDays$1(thisMonday, 7);
	return {
		streak,
		bestStreak,
		totalWorkouts,
		workoutsThisWeek: workouts.filter((w) => w.day >= thisMonday && w.day < nextMonday).length,
		workoutDoneToday
	};
}
function computeWeeklyAverages(metrics, weeks = 12) {
	const withWeight = metrics.filter((m) => m.weight != null && !Number.isNaN(m.weight));
	if (withWeight.length === 0) return [];
	const groups = /* @__PURE__ */ new Map();
	for (const m of withWeight) {
		const monday = weekMonday(m.day);
		const list = groups.get(monday) ?? [];
		list.push(m.weight);
		groups.set(monday, list);
	}
	return Array.from(groups.keys()).sort().slice(-weeks).map((monday) => {
		const weights = groups.get(monday);
		const sum = weights.reduce((a, b) => a + b, 0);
		return {
			week: monday,
			avg: Math.round(sum / weights.length * 10) / 10,
			count: weights.length
		};
	});
}
// src/renderer/src/web/browserDb.ts
var isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array);
var toParam = (v) => {
	if (v === void 0 || v === null) return null;
	if (typeof v === "boolean") return v ? 1 : 0;
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "number" || typeof v === "string" || v instanceof Uint8Array) return v;
	return String(v);
};
/**
* better-sqlite3 accepts `run(a, b)`, `run([a, b])` and `run({ name })` with
* `@name`/`:name`/`$name` in the SQL. Both sql.js and Turso get the same plain
* `?` form, so they always see exactly the same statement.
*/
function normalize(sql, raw) {
	if (raw.length === 1 && isPlainObject(raw[0])) {
		const obj = raw[0];
		const args = [];
		let out = "";
		let quote = null;
		for (let i = 0; i < sql.length; i++) {
			const c = sql[i];
			if (quote) {
				out += c;
				if (c === quote) quote = null;
				continue;
			}
			if (c === "'" || c === "\"") {
				quote = c;
				out += c;
				continue;
			}
			if ((c === "@" || c === ":" || c === "$") && /[A-Za-z_]/.test(sql[i + 1] ?? "")) {
				let j = i + 1;
				while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
				const name = sql.slice(i + 1, j);
				if (!(name in obj)) throw new Error(`Missing named parameter "${name}"`);
				args.push(toParam(obj[name]));
				out += "?";
				i = j - 1;
				continue;
			}
			out += c;
		}
		return {
			sql: out,
			args
		};
	}
	return {
		sql,
		args: raw.flat().map(toParam)
	};
}
var isWrite = (sql) => !/^\s*(SELECT|WITH\s[\s\S]*SELECT|PRAGMA\s+\w+\s*$|EXPLAIN)/i.test(sql);
var BrowserDb = class {
	raw;
	depth = 0;
	sp = 0;
	/** Changes made since the last `takeChanges()`, in order. */
	changes = [];
	pkCache = /* @__PURE__ */ new Map();
	constructor(raw) {
		this.raw = raw;
	}
	takeChanges() {
		const c = this.changes;
		this.changes = [];
		return c;
	}
	dropChanges() {
		this.changes = [];
	}
	rows(sql, args) {
		const stmt = this.raw.prepare(sql);
		try {
			stmt.bind(args);
			const out = [];
			while (stmt.step()) out.push(stmt.getAsObject());
			return out;
		} finally {
			stmt.free();
		}
	}
	scalar(sql) {
		const r = this.raw.exec(sql);
		return Number(r[0]?.values[0]?.[0] ?? 0);
	}
	/** The INTEGER PRIMARY KEY column of a table (its rowid), if it has one. */
	rowidColumn(table) {
		if (this.pkCache.has(table)) return this.pkCache.get(table);
		const pk = this.rows(`PRAGMA table_info(${JSON.stringify(table)})`, []).filter((c) => Number(c.pk) > 0);
		const col = pk.length === 1 && String(pk[0].type).toUpperCase() === "INTEGER" ? String(pk[0].name) : null;
		this.pkCache.set(table, col);
		return col;
	}
	/**
	* A new row got its id here; Turso must store the same id, or records that
	* point at it (undo_of, ledger_id…) would point at the wrong row.
	*/
	withExplicitId(change, id) {
		const m = /^\s*INSERT(\s+OR\s+\w+)?\s+INTO\s+["`]?(\w+)["`]?\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(change.sql);
		if (!m || /\bSELECT\b/i.test(change.sql) || (change.sql.match(/\bVALUES\b/gi) || []).length !== 1) return change;
		const col = this.rowidColumn(m[2]);
		if (!col) return change;
		if (m[3].split(",").map((c) => c.trim().replace(/["`]/g, "").toLowerCase()).includes(col.toLowerCase())) return change;
		return {
			sql: `INSERT${m[1] ?? ""} INTO ${m[2]} (${col}, ${m[3].trim()}) VALUES (?, ` + change.sql.slice(m[0].length),
			args: [id, ...change.args]
		};
	}
	run(sql, raw) {
		const change = normalize(sql, raw);
		const before = this.scalar("SELECT last_insert_rowid()");
		this.raw.run(change.sql, change.args);
		const changes = this.raw.getRowsModified();
		const after = this.scalar("SELECT last_insert_rowid()");
		if (isWrite(change.sql)) {
			const inserted = changes > 0 && /^\s*INSERT/i.test(change.sql) && (after !== before || !/\bON\s+CONFLICT\b/i.test(change.sql));
			this.changes.push(inserted ? this.withExplicitId(change, after) : change);
		}
		return {
			changes,
			lastInsertRowid: after
		};
	}
	prepare(sql) {
		return {
			run: (...args) => this.run(sql, args),
			get: (...args) => {
				const c = normalize(sql, args);
				return this.rows(c.sql, c.args)[0];
			},
			all: (...args) => {
				const c = normalize(sql, args);
				return this.rows(c.sql, c.args);
			}
		};
	}
	exec(sql) {
		this.raw.exec(sql);
		if (isWrite(sql)) this.changes.push({
			sql,
			args: []
		});
	}
	pragma(source, opts) {
		const r = this.rows(`PRAGMA ${source}`, []);
		if (opts?.simple) return r[0] ? Object.values(r[0])[0] : void 0;
		return r;
	}
	/** Like better-sqlite3: nested calls become savepoints; a throw rolls back. */
	transaction(fn) {
		const run = (...args) => {
			const outer = this.depth === 0;
			const name = `sp${++this.sp}`;
			const mark = this.changes.length;
			this.raw.run(outer ? "BEGIN" : `SAVEPOINT ${name}`);
			this.depth++;
			try {
				const res = fn(...args);
				this.depth--;
				this.raw.run(outer ? "COMMIT" : `RELEASE ${name}`);
				return res;
			} catch (e) {
				this.depth--;
				if (outer) this.raw.run("ROLLBACK");
				else {
					this.raw.run(`ROLLBACK TO ${name}`);
					this.raw.run(`RELEASE ${name}`);
				}
				this.changes.length = mark;
				throw e;
			}
		};
		return Object.assign(run, {
			immediate: run,
			deferred: run,
			exclusive: run,
			default: run
		});
	}
};
// src/renderer/src/web/mirror.ts
var SKIP = /^(sqlite_|libsql_|_litestream|_cf_)/;
var MirrorError = class extends Error {};
var Mirror = class {
	SQL;
	turso;
	store;
	db = null;
	queue = Promise.resolve();
	listeners = /* @__PURE__ */ new Set();
	refreshing = null;
	/**
	* A marker every change sets in Turso (settings.data_version): a refresh
	* reads it first and downloads everything only when it moved, instead of
	* the whole database every minute.
	*/
	version = null;
	rebuiltAt = 0;
	/** When the copy last matched Turso (null: only the cached copy so far). */
	syncedAt = null;
	lastError = null;
	ready;
	constructor(SQL, turso, store = null) {
		this.SQL = SQL;
		this.turso = turso;
		this.store = store;
		this.ready = this.start();
	}
	onChange(cb) {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}
	emit() {
		this.listeners.forEach((cb) => {
			try {
				cb();
			} catch {}
		});
	}
	/** One thing at a time: a refresh never swaps the copy under a write. */
	lock(fn) {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => {});
		return run;
	}
	async start() {
		const cached = this.store ? await this.store.load() : null;
		if (cached) try {
			this.db = new BrowserDb(new this.SQL.Database(cached));
			this.refresh().catch(() => {});
			return;
		} catch {
			this.db = null;
		}
		await this.lock(() => this.rebuild());
	}
	get current() {
		if (!this.db) throw new MirrorError("Your data is still loading");
		return this.db;
	}
	/** A read on the current copy. */
	async read(fn) {
		await this.ready;
		return this.lock(() => fn(this.current));
	}
	/**
	* A change: runs on the copy, then goes to Turso in one transaction. Only
	* when Turso has it does the caller get the result.
	*/
	async write(fn) {
		await this.ready;
		return this.lock(async () => {
			const db = this.current;
			db.dropChanges();
			const result = db.transaction(() => fn(db))();
			const changes = db.takeChanges();
			if (!changes.length) return result;
			const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			const mark = {
				sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
				args: [version]
			};
			try {
				await this.turso.writeAtomic([...changes, mark]);
				db.raw.run(mark.sql, mark.args);
				this.version = version;
				this.lastError = null;
			} catch (e) {
				this.lastError = e.message;
				await this.rebuild().catch(() => {});
				this.emit();
				throw new MirrorError(navigator.onLine === false ? "You are offline, so this was not saved. Try again when you are back online." : `Not saved: ${e.message}`);
			}
			this.persist();
			this.emit();
			return result;
		});
	}
	/**
	* Reloads the copy from Turso (e.g. after the phone or a bot changed
	* something). Cheap when nothing changed: one tiny query. True when the
	* copy was reloaded (listeners hear it only then).
	*/
	refresh() {
		if (this.refreshing) return this.refreshing;
		this.refreshing = this.lock(async () => {
			if (this.version && Date.now() - this.rebuiltAt < 9e5) {
				const [r] = await this.turso.readMany([{
					sql: "SELECT value FROM settings WHERE key = 'data_version'",
					args: []
				}]);
				if (!(r instanceof Error) && String(r.rows[0]?.[0] ?? "") === this.version) {
					this.syncedAt = (/* @__PURE__ */ new Date()).toISOString();
					return false;
				}
			}
			await this.rebuild();
			return true;
		}).then((changed) => {
			if (changed) this.emit();
			return changed;
		}).finally(() => {
			this.refreshing = null;
		});
		return this.refreshing;
	}
	persist() {
		if (!this.store || !this.db) return;
		try {
			this.store.save(this.db.raw.export()).catch(() => {});
		} catch {}
	}
	/** Reference schema: what the desktop app's migrations produce. */
	referenceDb() {
		const ref = new this.SQL.Database();
		for (const m of MIGRATIONS) ref.exec(m);
		return ref;
	}
	async rebuild() {
		const schema = (await this.turso.readMany([{
			sql: "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid",
			args: []
		}]))[0];
		if (schema instanceof Error) throw schema;
		const objects = schema.rows.map(([type, name, tbl, sql]) => ({
			type: String(type),
			name: String(name),
			tbl: String(tbl),
			sql: String(sql)
		})).filter((o) => !SKIP.test(o.name) && !SKIP.test(o.tbl));
		const raw = new this.SQL.Database();
		const local = new BrowserDb(raw);
		for (const o of objects.filter((x) => x.type === "table")) raw.exec(o.sql);
		const ddl = [];
		const ref = this.referenceDb();
		const refTables = ref.exec("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? [];
		const have = new Set(objects.filter((x) => x.type === "table").map((x) => x.name));
		for (const [name, sql] of refTables) {
			if (!have.has(name)) {
				const create = sql.replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?/i, "CREATE TABLE IF NOT EXISTS ");
				raw.exec(create);
				ddl.push({
					sql: create,
					args: []
				});
				const idx = ref.exec(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${name}' AND sql IS NOT NULL`)[0]?.values ?? [];
				for (const [isql] of idx) {
					const c = isql.replace(/^CREATE (UNIQUE )?INDEX\s+(IF NOT EXISTS\s+)?/i, (_m, u) => `CREATE ${u ?? ""}INDEX IF NOT EXISTS `);
					raw.exec(c);
					ddl.push({
						sql: c,
						args: []
					});
				}
				continue;
			}
			const localCols = new Set((raw.exec(`PRAGMA table_info("${name}")`)[0]?.values ?? []).map((r) => String(r[1]).toLowerCase()));
			for (const col of ref.exec(`PRAGMA table_info("${name}")`)[0]?.values ?? []) {
				const [, cname, ctype, notnull, dflt] = col;
				if (localCols.has(cname.toLowerCase())) continue;
				const def = `ALTER TABLE ${name} ADD COLUMN ${cname} ${ctype}${notnull && dflt != null ? " NOT NULL" : ""}${dflt != null ? ` DEFAULT ${dflt}` : ""}`;
				raw.exec(def);
				ddl.push({
					sql: def,
					args: []
				});
			}
		}
		ref.close();
		if (ddl.length) await this.turso.writeAtomic(ddl);
		const tables = (raw.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []).map((r) => String(r[0]));
		const data = await this.turso.readMany(tables.map((t) => ({
			sql: `SELECT * FROM "${t}"`,
			args: []
		})));
		raw.run("BEGIN");
		tables.forEach((t, i) => {
			const res = data[i];
			if (res instanceof Error || !res.rows.length) return;
			const stmt = raw.prepare(`INSERT INTO "${t}" (${res.cols.map((c) => `"${c}"`).join(", ")}) VALUES (${res.cols.map(() => "?").join(", ")})`);
			for (const row of res.rows) stmt.run(row);
			stmt.free();
		});
		raw.run("COMMIT");
		for (const o of objects.filter((x) => x.type !== "table")) try {
			raw.exec(o.sql);
		} catch {}
		const old = this.db;
		this.db = local;
		this.syncedAt = (/* @__PURE__ */ new Date()).toISOString();
		this.rebuiltAt = Date.now();
		try {
			const row = this.db?.raw.exec("SELECT value FROM settings WHERE key = 'data_version'")[0]?.values[0]?.[0];
			this.version = row == null ? null : String(row);
		} catch {
			this.version = null;
		}
		old?.raw.close();
		await this.seedDefaults();
		if (!this.version) {
			const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			const mark = {
				sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
				args: [version]
			};
			try {
				await this.turso.writeAtomic([mark]);
				local.raw.run(mark.sql, mark.args);
				this.version = version;
			} catch {}
		}
		this.persist();
	}
	async seedDefaults() {
		const db = this.current;
		const haveRules = new Set(db.prepare("SELECT id FROM rules").all().map((r) => String(r.id)));
		const haveEx = new Set(db.prepare("SELECT id FROM exercises").all().map((r) => String(r.id)));
		const rules = DEFAULT_RULES.map((r, i) => ({
			...r,
			enabled: r.enabled ? 1 : 0,
			sort: i
		})).filter((r) => !haveRules.has(r.id));
		const exercises = DEFAULT_EXERCISES.filter((e) => !haveEx.has(e.id));
		if (!rules.length && !exercises.length) return;
		db.dropChanges();
		db.transaction(() => {
			const rule = db.prepare(`INSERT OR IGNORE INTO rules (id, module, title, coins, xp, daily_cap, cooldown_min, enabled, sort)
         VALUES (@id, @module, @title, @coins, @xp, @dailyCap, @cooldownMin, @enabled, @sort)`);
			rules.forEach((r) => rule.run(r));
			const ex = db.prepare(`INSERT OR IGNORE INTO exercises (id, name, unit, target, category, sort, archived)
         VALUES (@id, @name, @unit, @target, @category, @sort, 0)`);
			exercises.forEach((e) => ex.run(e));
		})();
		await this.turso.writeAtomic(db.takeChanges()).catch(() => {});
	}
};
// src/renderer/src/web/tursoHttp.ts
var toHrana = (v) => {
	if (v === null) return { type: "null" };
	if (typeof v === "number") return Number.isInteger(v) ? {
		type: "integer",
		value: String(v)
	} : {
		type: "float",
		value: v
	};
	if (v instanceof Uint8Array) {
		let s = "";
		v.forEach((b) => s += String.fromCharCode(b));
		return {
			type: "blob",
			base64: btoa(s)
		};
	}
	return {
		type: "text",
		value: String(v)
	};
};
var fromHrana = (v) => {
	if (!v || v.type === "null") return null;
	if (v.type === "integer") return Number(v.value);
	if (v.type === "float") return Number(v.value);
	if (v.type === "blob") {
		const s = atob(v.base64 ?? "");
		return Uint8Array.from(s, (c) => c.charCodeAt(0));
	}
	return v.value ?? "";
};
/** Turso said the session is over (the web server answers 401). */
var UnauthorizedError = class extends Error {};
var TursoHttp = class {
	onUnauthorized;
	url;
	token;
	/**
	* `url` is a Turso database URL, or a path on this site ("/api/db") that
	* passes the request on with the server's key.
	*/
	constructor(url, token, onUnauthorized) {
		this.onUnauthorized = onUnauthorized;
		let base = (url || "").trim();
		if (base.startsWith("/")) this.url = base;
		else {
			if (base.startsWith("libsql://")) base = "https://" + base.slice(9);
			if (!/^https?:\/\//.test(base)) base = "https://" + base;
			this.url = base.replace(/\/+$/, "") + "/v2/pipeline";
		}
		this.token = typeof token === "function" ? token : () => token;
	}
	async pipeline(requests) {
		const res = await fetch(this.url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.token()}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({ requests: [...requests, { type: "close" }] })
		});
		if (res.status === 401 && this.onUnauthorized) {
			this.onUnauthorized();
			throw new UnauthorizedError("Locked: enter your PIN again");
		}
		if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${await res.text().catch(() => "") || res.statusText}`);
		return (await res.json()).results ?? [];
	}
	/** Several reads in one round trip; a failed one comes back as an Error. */
	async readMany(stmts) {
		const results = await this.pipeline(stmts.map((s) => ({
			type: "execute",
			stmt: {
				sql: s.sql,
				args: s.args.map(toHrana)
			}
		})));
		return stmts.map((_, i) => {
			const r = results[i];
			if (!r || r.type === "error") return new Error(r?.error?.message ?? "Turso read failed");
			const result = r.response?.result;
			return {
				cols: (result?.cols ?? []).map((c) => String(c.name)),
				rows: (result?.rows ?? []).map((row) => row.map(fromHrana))
			};
		});
	}
	/** Runs the statements in one transaction: all of them, or none. */
	async writeAtomic(stmts) {
		if (!stmts.length) return;
		const steps = [{ stmt: { sql: "BEGIN" } }];
		stmts.forEach((s, i) => steps.push({
			condition: {
				type: "ok",
				step: i
			},
			stmt: {
				sql: s.sql,
				args: s.args.map(toHrana)
			}
		}));
		const last = steps.length - 1;
		steps.push({
			condition: {
				type: "ok",
				step: last
			},
			stmt: { sql: "COMMIT" }
		});
		steps.push({
			condition: {
				type: "not",
				cond: {
					type: "ok",
					step: last + 1
				}
			},
			stmt: { sql: "ROLLBACK" }
		});
		const [r] = await this.pipeline([{
			type: "batch",
			batch: { steps }
		}]);
		if (!r || r.type === "error") throw new Error(r?.error?.message ?? "Turso write failed");
		const res = r.response?.result;
		const errs = res?.step_errors ?? [];
		if (!(res?.step_results?.[last + 1] != null)) {
			const firstErr = errs.find((e) => e);
			throw new Error(firstErr?.message ?? "Turso did not save the change");
		}
	}
};
// src/main/body.ts
var Body = class {
	db;
	wallet;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	exercises() {
		let rows = this.db.prepare("SELECT id, name, unit, target, category, sort, archived FROM exercises WHERE archived = 0 ORDER BY sort, name").all();
		if (rows.length === 0) {
			for (const ex of DEFAULT_EXERCISES) this.saveExercise(ex);
			rows = this.db.prepare("SELECT id, name, unit, target, category, sort, archived FROM exercises WHERE archived = 0 ORDER BY sort, name").all();
		} else {
			const existingIds = new Set(rows.map((r) => r.id));
			for (const ex of DEFAULT_EXERCISES.slice(0, 3)) if (!existingIds.has(ex.id)) this.saveExercise(ex);
			rows = this.db.prepare("SELECT id, name, unit, target, category, sort, archived FROM exercises WHERE archived = 0 ORDER BY sort, name").all();
		}
		return rows.map((r) => ({
			id: r.id,
			name: r.name,
			unit: r.unit,
			target: r.target,
			category: r.category,
			sort: r.sort,
			archived: Boolean(r.archived)
		}));
	}
	saveExercise(ex) {
		if (!ex.name || !ex.name.trim()) throw new LedgerError("Exercise name is required");
		const id = ex.id?.trim() || ex.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
		const sort = ex.sort ?? 99;
		this.db.prepare(`INSERT INTO exercises (id, name, unit, target, category, sort, archived)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         unit = excluded.unit,
         target = excluded.target,
         category = excluded.category,
         sort = excluded.sort,
         archived = 0`).run(id, ex.name.trim(), ex.unit || "reps", Math.max(1, ex.target || 10), ex.category || "calisthenics", sort);
	}
	workouts(limit = 100) {
		return this.db.prepare("SELECT id, day, ts, title, items_json, note, ledger_id FROM workouts ORDER BY ts DESC LIMIT ?").all(limit).map((r) => ({
			id: r.id,
			day: r.day,
			ts: r.ts,
			title: r.title,
			items: JSON.parse(r.items_json),
			note: r.note ?? void 0,
			ledgerId: r.ledger_id
		}));
	}
	metrics(limit = 60) {
		return this.db.prepare("SELECT day, weight, waist, note, updated_at FROM body_metrics ORDER BY day ASC LIMIT ?").all(limit).map((r) => ({
			day: r.day,
			weight: r.weight,
			waist: r.waist,
			note: r.note,
			updatedAt: r.updated_at
		}));
	}
	state(now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const allWorkouts = this.workouts(200);
		const allMetrics = this.metrics(100);
		const exercises = this.exercises();
		const stats = computeWorkoutStats(allWorkouts, today);
		const weeklyAverages = computeWeeklyAverages(allMetrics, 12);
		const withWeight = allMetrics.filter((m) => m.weight != null);
		const latestWeight = withWeight.length ? withWeight[withWeight.length - 1].weight : null;
		const previousWeight = withWeight.length > 1 ? withWeight[withWeight.length - 2].weight : null;
		const withWaist = allMetrics.filter((m) => m.waist != null);
		const latestWaist = withWaist.length ? withWaist[withWaist.length - 1].waist : null;
		const previousWaist = withWaist.length > 1 ? withWaist[withWaist.length - 2].waist : null;
		return {
			today,
			streak: stats.streak,
			bestStreak: stats.bestStreak,
			totalWorkouts: stats.totalWorkouts,
			workoutsThisWeek: stats.workoutsThisWeek,
			workoutDoneToday: stats.workoutDoneToday,
			latestWeight,
			previousWeight,
			latestWaist,
			previousWaist,
			weeklyAverages,
			recentWorkouts: allWorkouts.slice(0, 25),
			metrics: allMetrics,
			exercises
		};
	}
	logWorkout(input, now = /* @__PURE__ */ new Date()) {
		const err = validateWorkout(input);
		if (err) throw new LedgerError(err);
		const today = input.day ?? this.wallet.today(now);
		const ts = now.toISOString();
		return this.db.transaction(() => {
			let ledgerId = null;
			let awarded = false;
			try {
				ledgerId = this.wallet.awardRule("body.workout_done", {
					note: input.title,
					now,
					day: today,
					ref: `workout:${today}:${ts}`
				});
				awarded = true;
			} catch (e) {
				if (!(e instanceof LedgerError)) throw e;
			}
			const res = this.db.prepare(`INSERT INTO workouts (day, ts, title, items_json, note, ledger_id)
         VALUES (?, ?, ?, ?, ?, ?)`).run(today, ts, input.title.trim(), JSON.stringify(input.items), input.note?.trim() || null, ledgerId);
			return {
				workout: {
					id: Number(res.lastInsertRowid),
					day: today,
					ts,
					title: input.title.trim(),
					items: input.items,
					note: input.note?.trim() || void 0,
					ledgerId
				},
				state: this.state(now),
				awarded
			};
		})();
	}
	deleteWorkout(id, now = /* @__PURE__ */ new Date()) {
		return this.db.transaction(() => {
			const row = this.db.prepare("SELECT ledger_id FROM workouts WHERE id = ?").get(id);
			if (!row) throw new LedgerError("Workout not found");
			if (row.ledger_id != null) try {
				this.wallet.undo(row.ledger_id, "Workout deleted", now);
			} catch {}
			this.db.prepare("DELETE FROM workouts WHERE id = ?").run(id);
			return this.state(now);
		})();
	}
	logMetric(input, now = /* @__PURE__ */ new Date()) {
		const wErr = validateWeight(input.weight);
		if (wErr) throw new LedgerError(wErr);
		const waistErr = validateWaist(input.waist);
		if (waistErr) throw new LedgerError(waistErr);
		if (input.weight == null && input.waist == null) throw new LedgerError("Enter at least a weight or a waist measurement");
		const today = input.day ?? this.wallet.today(now);
		const ts = now.toISOString();
		this.db.prepare(`INSERT INTO body_metrics (day, weight, waist, note, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         weight = COALESCE(excluded.weight, body_metrics.weight),
         waist = COALESCE(excluded.waist, body_metrics.waist),
         note = COALESCE(excluded.note, body_metrics.note),
         updated_at = excluded.updated_at`).run(today, input.weight ?? null, input.waist ?? null, input.note?.trim() || null, ts);
		return this.state(now);
	}
};
// src/core/dataExport.ts
function toWorkoutsCsv(workouts) {
	return ["Date,Title,Notes,Exercises", ...workouts.map((w) => {
		const exs = w.items.map((i) => `${i.name || i.exerciseId}:${i.amount}${i.unit}`).join(";");
		const note = (w.note ?? "").replace(/"/g, "\"\"");
		const title = (w.title ?? "").replace(/"/g, "\"\"");
		return `"${w.day}","${title}","${note}","${exs}"`;
	})].join("\n");
}
function toExpensesCsv(expenses, currency = "MDL") {
	return ["Date,Amount,Currency,Category,Note", ...expenses.map((e) => {
		const amt = (e.amount / 100).toFixed(2);
		const note = (e.note ?? "").replace(/"/g, "\"\"");
		return `"${e.day}",${amt},"${currency}","${e.category}","${note}"`;
	})].join("\n");
}
// src/main/dataExport.ts
var DataExportService = class {
	db;
	body;
	money;
	constructor(db, body, money) {
		this.db = db;
		this.body = body;
		this.money = money;
	}
	exportJson() {
		const payload = {
			version: "0.8.0",
			exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
			ledger: this.db.prepare("SELECT * FROM ledger ORDER BY id ASC").all(),
			workouts: this.body.workouts(1e3),
			bodyMetrics: this.body.metrics(),
			exercises: this.body.exercises(),
			sleepLogs: this.db.prepare("SELECT * FROM sleep_logs ORDER BY day ASC").all(),
			expenses: this.money.expenses(1e3),
			rules: this.db.prepare("SELECT * FROM rules ORDER BY sort ASC").all(),
			disciplineEvents: this.db.prepare("SELECT * FROM discipline_events ORDER BY id ASC").all(),
			tasks: this.db.prepare("SELECT * FROM tasks ORDER BY id ASC").all(),
			blocks: this.db.prepare("SELECT * FROM blocks ORDER BY id ASC").all(),
			settings: this.db.prepare("SELECT * FROM settings").all()
		};
		return JSON.stringify(payload, null, 2);
	}
	exportCsv(kind) {
		if (kind === "workouts") return toWorkoutsCsv(this.body.workouts(1e3));
		return toExpensesCsv(this.money.expenses(1e3), this.money.currency());
	}
};
// src/core/discipline.ts
var MILESTONES$1 = [
	{
		days: 3,
		coins: 15
	},
	{
		days: 7,
		coins: 40
	},
	{
		days: 10,
		coins: 60
	},
	{
		days: 14,
		coins: 80
	},
	{
		days: 30,
		coins: 200
	},
	{
		days: 60,
		coins: 350
	},
	{
		days: 90,
		coins: 600
	},
	{
		days: 180,
		coins: 1e3
	},
	{
		days: 365,
		coins: 2e3
	}
];
var DISCIPLINE_RANKS = [
	{
		days: 0,
		name: "Initiate"
	},
	{
		days: 3,
		name: "Squire"
	},
	{
		days: 7,
		name: "Warrior"
	},
	{
		days: 14,
		name: "Guardian"
	},
	{
		days: 30,
		name: "Knight"
	},
	{
		days: 60,
		name: "Champion"
	},
	{
		days: 90,
		name: "Spartan"
	},
	{
		days: 180,
		name: "Legend"
	}
];
var QUOTES = [
	"Discipline is choosing what you want most over what you want now.",
	"The urge is a wave. You do not have to surf it, you only have to let it pass.",
	"Every clean day is a vote for the person you are becoming.",
	"You are not your impulses. You are the one who notices them.",
	"Hard choices, easy life. Easy choices, hard life.",
	"One day at a time is still a day won.",
	"Boredom is not an emergency. Stand up, move, breathe.",
	"Strong is built in the moments nobody sees.",
	"A slip is a lesson, not a verdict. Start again today.",
	"Your future self is watching. Give them a reason to be proud.",
	"Energy saved is energy you get to spend on your goals.",
	"Comfort is the enemy of progress. Do the harder thing.",
	"The first five minutes are the hardest. After that it gets quiet.",
	"You have done hard things before. This is one more.",
	"Win the morning, win the day.",
	"Control the phone or the phone controls you.",
	"Real confidence is a promise to yourself, kept.",
	"Cold water, ten push-ups, fresh air. Then decide.",
	"Small daily wins beat big rare ones.",
	"The streak is the proof. Keep stacking days."
];
function quoteFor(day) {
	return QUOTES[(daysBetween$1("2026-01-01", day) % QUOTES.length + QUOTES.length) % QUOTES.length];
}
function rankFor(days) {
	let i = 0;
	for (let k = 0; k < DISCIPLINE_RANKS.length; k++) if (days >= DISCIPLINE_RANKS[k].days) i = k;
	const next = DISCIPLINE_RANKS[i + 1];
	return {
		name: DISCIPLINE_RANKS[i].name,
		next: next ?? null
	};
}
/** The current start date is the latest `start` event. */
function startOf(events) {
	const starts = events.filter((e) => e.kind === "start").sort((a, b) => a.id - b.id);
	return starts[starts.length - 1] ?? null;
}
function statsOf(events, today) {
	return cleanStats(startOf(events)?.day ?? null, events.filter((e) => e.kind === "reset").map((e) => e.day), today);
}
function milestoneRef(since, days) {
	return `milestone:${since}:${days}`;
}
/**
* Milestones of the current streak. A milestone whose day came before the
* streak was entered in the app shows as reached but pays nothing, so a
* backdated start date can't unlock a pile of coins at once.
*/
function milestonesOf(events, today, claimedRefs, setupDay) {
	const start = startOf(events);
	const stats = statsOf(events, today);
	if (!start || !stats.since) return MILESTONES$1.map((m) => ({
		...m,
		status: "locked",
		reachedOn: null
	}));
	const recorded = setupDay(start);
	return MILESTONES$1.map((m) => {
		if (stats.current < m.days) return {
			...m,
			status: "locked",
			reachedOn: null
		};
		const reachedOn = addDays$1(stats.since, m.days);
		if (claimedRefs.has(milestoneRef(stats.since, m.days))) return {
			...m,
			status: "claimed",
			reachedOn
		};
		return {
			...m,
			status: reachedOn < recorded ? "before-setup" : "claimable",
			reachedOn
		};
	});
}
function validateStart(day, today, events) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LedgerError("Pick a date");
	if (day > today) throw new LedgerError("The start date cannot be in the future");
	if (daysBetween$1(day, today) > 3650) throw new LedgerError("That date is too far back");
	if (events.some((e) => e.kind === "reset")) throw new LedgerError("After a reset the date comes from the reset itself");
}
function planCheckIn(events, today) {
	if (!startOf(events)) throw new LedgerError("Set your start date first");
	if (events.some((e) => e.kind === "reset" && e.day === today)) throw new LedgerError("Today was a reset day. Check in again tomorrow.");
	if (events.some((e) => e.kind === "checkin" && e.day === today)) throw new LedgerError("Already checked in today");
}
function planUrgeFinish(startedAt, now) {
	if (!startedAt) throw new LedgerError("Start the urge crusher first");
	const elapsed = (now.getTime() - Date.parse(startedAt)) / 1e3;
	if (elapsed < 170) throw new LedgerError(`Stay with it ${Math.ceil(170 - elapsed)} more seconds`);
}
// src/main/settings.ts
function getSetting(db, key) {
	return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}
function setSetting(db, key, value) {
	db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
// src/main/discipline.ts
var Discipline = class {
	db;
	wallet;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	events() {
		return this.db.prepare("SELECT id, kind, day, ts FROM discipline_events ORDER BY id").all();
	}
	record(kind, day, now) {
		this.db.prepare("INSERT INTO discipline_events (kind, day, ts) VALUES (?, ?, ?)").run(kind, day, now.toISOString());
	}
	claimedRefs() {
		return new Set(effective(this.wallet.entries()).map((e) => e.ref ?? "").filter((r) => r.startsWith("milestone:")));
	}
	milestones(events, today) {
		return milestonesOf(events, today, this.claimedRefs(), (start) => this.wallet.today(new Date(start.ts)));
	}
	state(now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const events = this.events();
		const stats = statsOf(events, today);
		const rank = rankFor(stats.current);
		const weekAgo = addDays$1(today, -6);
		const has = (kind) => events.some((e) => e.kind === kind && e.day === today);
		return {
			setup: !!startOf(events),
			today,
			since: stats.since,
			current: stats.current,
			best: stats.best,
			totalClean: stats.totalClean,
			resets: stats.relapses,
			rank: rank.name,
			nextRank: rank.next,
			checkedInToday: has("checkin"),
			oathToday: has("oath"),
			resetToday: has("reset"),
			canEditStart: !events.some((e) => e.kind === "reset"),
			milestones: this.milestones(events, today),
			urgeStartedAt: getSetting(this.db, "urge_started_at") || null,
			urgesThisWeek: events.filter((e) => e.kind === "urge" && e.day >= weekAgo).length,
			stealth: getSetting(this.db, "discipline_stealth") === "1",
			quote: quoteFor(today)
		};
	}
	setStart(day, now = /* @__PURE__ */ new Date()) {
		const events = this.events();
		validateStart(day, this.wallet.today(now), events);
		this.record("start", day, now);
	}
	checkIn(now = /* @__PURE__ */ new Date()) {
		this.db.transaction(() => {
			const today = this.wallet.today(now);
			planCheckIn(this.events(), today);
			this.wallet.awardRule("discipline.clean_day", {
				now,
				ref: `discipline:checkin:${today}`
			});
			this.record("checkin", today, now);
		}).immediate();
	}
	oath(now = /* @__PURE__ */ new Date()) {
		this.db.transaction(() => {
			const today = this.wallet.today(now);
			if (this.events().some((e) => e.kind === "oath" && e.day === today)) throw new LedgerError("Oath already sworn today");
			this.wallet.awardRule("discipline.oath", { now });
			this.record("oath", today, now);
		}).immediate();
	}
	/** An honest reset: the current streak starts again; best and total stay. */
	reset(now = /* @__PURE__ */ new Date()) {
		this.db.transaction(() => {
			const today = this.wallet.today(now);
			const events = this.events();
			if (!startOf(events)) throw new LedgerError("Set your start date first");
			if (events.some((e) => e.kind === "reset" && e.day === today)) throw new LedgerError("Already reset today. Tomorrow is day 1.");
			let penaltyAwarded = false;
			try {
				this.wallet.awardRule("discipline.reset", { now });
				penaltyAwarded = true;
			} catch (e) {
				if (!(e instanceof LedgerError)) throw e;
			}
			if (penaltyAwarded) try {
				if (this.wallet.summary(now).level.perks.some((p) => p.id === "rulers_authority" && p.unlocked)) {
					const entries = this.wallet.entries();
					const lastEntry = entries[entries.length - 1];
					if (lastEntry && lastEntry.ruleId === "discipline.reset" && lastEntry.coins < 0) {
						const refundCoins = Math.round(Math.abs(lastEntry.coins) * .5);
						if (refundCoins > 0) this.wallet.append({
							ts: now.toISOString(),
							day: today,
							module: "perks",
							kind: "earn",
							coins: refundCoins,
							xp: 0,
							ref: "perk:rulers_authority",
							note: "Ruler's Authority: 50% Urge Reset Penalty Refund"
						});
					}
				}
			} catch {}
			this.record("reset", today, now);
			setSetting(this.db, "urge_started_at", "");
		}).immediate();
	}
	claim(days, now = /* @__PURE__ */ new Date()) {
		return this.db.transaction(() => {
			const today = this.wallet.today(now);
			const events = this.events();
			const m = this.milestones(events, today).find((x) => x.days === days);
			if (!m || m.status !== "claimable") throw new LedgerError("Nothing to claim for that milestone");
			const since = statsOf(events, today).since;
			this.wallet.append({
				ts: now.toISOString(),
				day: today,
				module: "discipline",
				kind: "earn",
				coins: m.coins,
				xp: m.coins,
				ref: milestoneRef(since, days),
				note: `${days}-day milestone`
			});
			return m.coins;
		}).immediate();
	}
	startUrge(now = /* @__PURE__ */ new Date()) {
		if (getSetting(this.db, "urge_started_at")) return;
		setSetting(this.db, "urge_started_at", now.toISOString());
	}
	finishUrge(now = /* @__PURE__ */ new Date()) {
		this.db.transaction(() => {
			planUrgeFinish(getSetting(this.db, "urge_started_at") || null, now);
			try {
				this.wallet.awardRule("discipline.urge_resisted", { now });
			} catch (e) {
				if (!(e instanceof LedgerError)) throw e;
			}
			this.record("urge", this.wallet.today(now), now);
			setSetting(this.db, "urge_started_at", "");
		}).immediate();
	}
	cancelUrge() {
		setSetting(this.db, "urge_started_at", "");
	}
	setStealth(on) {
		setSetting(this.db, "discipline_stealth", on ? "1" : "0");
	}
};
// src/core/money.ts
function validateExpense(amount, category) {
	if (typeof amount !== "number" || isNaN(amount) || amount <= 0) throw new Error("Expense amount must be greater than zero");
	if (!category || typeof category !== "string" || !category.trim()) throw new Error("Category is required");
}
function computeDailyExpenseSummary(expenses, day, dailyBudgetBani) {
	const dayExpenses = expenses.filter((e) => e.day === day);
	let totalSpent = 0;
	let everydaySpent = 0;
	const byCategory = {};
	for (const e of dayExpenses) {
		totalSpent += e.amount;
		if (e.category !== "bills") everydaySpent += e.amount;
		byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount;
	}
	const remaining = dailyBudgetBani - everydaySpent;
	return {
		day,
		totalSpent,
		everydaySpent,
		budget: dailyBudgetBani,
		underBudget: dailyBudgetBani > 0 && everydaySpent <= dailyBudgetBani,
		remaining,
		byCategory
	};
}
function formatMoney$1(bani, currency = "MDL") {
	return `${(bani / 100).toLocaleString(void 0, {
		minimumFractionDigits: bani % 100 === 0 ? 0 : 2,
		maximumFractionDigits: 2
	})} ${currency}`;
}
// src/main/money.ts
function toExpense(r) {
	return {
		id: r.id,
		day: r.day,
		amount: r.amount,
		category: r.category,
		note: r.note,
		createdAt: r.created_at
	};
}
var MoneyService = class {
	db;
	wallet;
	financeHost;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	setFinanceHost(fh) {
		this.financeHost = fh;
	}
	currency() {
		return getSetting(this.db, "money_currency") || "MDL";
	}
	setCurrency(cur) {
		setSetting(this.db, "money_currency", cur || "MDL");
		return this.state();
	}
	dailyBudget() {
		const val = getSetting(this.db, "money_daily_budget");
		return val ? parseInt(val, 10) : 1e4;
	}
	setBudget(budgetBani) {
		setSetting(this.db, "money_daily_budget", String(Math.max(0, budgetBani)));
		return this.state();
	}
	expenses(limit = 100) {
		return this.db.prepare("SELECT * FROM expenses ORDER BY day DESC, id DESC LIMIT ?").all(limit).map(toExpense);
	}
	state(now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const all = this.expenses(300);
		const budget = this.dailyBudget();
		const todaySummary = computeDailyExpenseSummary(all, today, budget);
		const thisMonth = today.slice(0, 7);
		const monthSpent = all.filter((e) => e.day.startsWith(thisMonth)).reduce((s, e) => s + e.amount, 0);
		return {
			currency: this.currency(),
			dailyBudget: budget,
			today: todaySummary,
			monthSpent,
			recentExpenses: all.slice(0, 25)
		};
	}
	addExpense(amountBani, category, note, now = /* @__PURE__ */ new Date(), skipFinanceSync = false) {
		validateExpense(amountBani, category);
		const today = this.wallet.today(now);
		const roundedBani = Math.round(amountBani);
		const info = this.db.prepare("INSERT INTO expenses (day, amount, category, note, created_at) VALUES (?, ?, ?, ?, ?)").run(today, roundedBani, category.trim(), note?.trim() || null, now.toISOString());
		const row = this.db.prepare("SELECT * FROM expenses WHERE id = ?").get(info.lastInsertRowid);
		let awarded = false;
		try {
			this.wallet.award("money.logged", `Logged expense: ${category}`, now);
			awarded = true;
		} catch {}
		if (!skipFinanceSync && this.financeHost) this.financeHost.addTransaction({
			type: "expense",
			amount: roundedBani,
			category: category.trim(),
			note: note?.trim() || void 0
		}).catch((err) => {
			console.warn("FinanceHost dual-write warning:", err);
		});
		return {
			expense: toExpense(row),
			state: this.state(now),
			awarded
		};
	}
	deleteExpense(id) {
		this.db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
		return this.state();
	}
};
function weekdayIndex(day) {
	const [y, m, d] = day.split("-").map(Number);
	return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
function onWeekday(mask, day) {
	return (mask & 1 << weekdayIndex(day)) !== 0;
}
function validateTask(t) {
	if (!t.title.trim()) throw new LedgerError("A task needs a title");
	if (!Number.isInteger(t.coins) || t.coins < 0 || t.coins > 30) throw new LedgerError(`Coins must be 0 to 30`);
	if (!Number.isInteger(t.xp) || t.xp < 0 || t.xp > 60) throw new LedgerError(`XP must be 0 to 60`);
	if (![
		1,
		2,
		3
	].includes(t.priority)) throw new LedgerError("Priority must be high, normal or low");
	if (![
		"none",
		"daily",
		"weekly"
	].includes(t.repeat)) throw new LedgerError("Unknown repeat");
	if (t.repeat === "weekly" && !(t.weekdays & 127)) throw new LedgerError("Pick at least one weekday");
	if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) throw new LedgerError("Due date must be YYYY-MM-DD");
}
/**
* Does the task show up on `day`? One-off tasks show from creation until
* done; repeating ones on their days.
*/
function taskOn(t, day, doneDays) {
	if (day < t.createdDay) return false;
	if (t.repeat === "daily") return true;
	if (t.repeat === "weekly") return onWeekday(t.weekdays, day);
	const doneOn = [...doneDays].sort()[0];
	return doneOn ? doneOn === day : true;
}
/** The day a completion is recorded under: one-offs finish once, repeats once per day. */
function alreadyDone(t, day, doneDays) {
	return t.repeat === "none" ? doneDays.size > 0 : doneDays.has(day);
}
function isOverdue(t, day, doneDays) {
	return t.repeat === "none" && !!t.due && t.due < day && doneDays.size === 0;
}
function planTaskComplete(t, day, doneDays, coinsFromTasksToday) {
	if (alreadyDone(t, day, doneDays)) throw new LedgerError("Already done");
	if (t.repeat !== "none" && !taskOn(t, day, doneDays)) throw new LedgerError("This task is not scheduled today");
	const room = Math.max(0, 150 - coinsFromTasksToday);
	return {
		coins: Math.min(t.coins, room),
		xp: t.xp
	};
}
/** High priority first, then overdue, then by due date, then title. */
function sortTasks(list) {
	return list.slice().sort((a, b) => Number(a.done) - Number(b.done) || a.priority - b.priority || (a.due ?? "9999").localeCompare(b.due ?? "9999") || a.title.localeCompare(b.title));
}
/** Which rule a block pays out through when finished or skipped. */
var BLOCK_RULES = {
	study: {
		done: "study.block_done",
		skipped: "study.block_skipped"
	},
	workout: {
		done: "body.workout_done",
		skipped: null
	},
	other: {
		done: null,
		skipped: null
	}
};
/** A block must run for this share of its length before it can be finished. */
var FINISH_SHARE = .8;
function validateBlock(b) {
	if (!b.title.trim()) throw new LedgerError("A block needs a title");
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start)) throw new LedgerError("Start must be HH:MM");
	if (!Number.isInteger(b.minutes) || b.minutes < 5 || b.minutes > 600) throw new LedgerError("Length must be 5 to 600 minutes");
	if (!(b.kind in BLOCK_RULES)) throw new LedgerError("Unknown block type");
	if (!b.date && !(b.weekdays & 127)) throw new LedgerError("Pick weekdays or a date");
	if (!Number.isInteger(b.remindMin) || b.remindMin < 0 || b.remindMin > 120) throw new LedgerError("Reminder must be 0 to 120 minutes");
}
function blockOn(b, day) {
	if (day < b.createdDay && !b.date) return false;
	return b.date ? b.date === day : onWeekday(b.weekdays, day);
}
/** Earliest instant a running block may be finished. */
function finishAllowedAt(startedAt, minutes) {
	return new Date(Date.parse(startedAt) + Math.round(minutes * FINISH_SHARE) * 6e4);
}
function planFinish(status, startedAt, minutes, now) {
	if (status === "done" || status === "skipped" || status === "missed") throw new LedgerError("This block is already closed");
	if (status !== "running" || !startedAt) throw new LedgerError("Start the focus timer first");
	const at = finishAllowedAt(startedAt, minutes);
	if (now < at) throw new LedgerError(`Keep going: ${Math.ceil((at.getTime() - now.getTime()) / 6e4)} more min before this block counts`);
}
function planSkip(status) {
	if (status === "done" || status === "skipped" || status === "missed") throw new LedgerError("This block is already closed");
}
/**
* Study blocks from past days that were never closed. They count as missed
* (with the skip penalty), so ignoring a block isn't a way around it.
*/
function blocksToMiss(blocks, closed, today, lookbackDays = 7) {
	const out = [];
	for (let i = lookbackDays; i >= 1; i--) {
		const day = addDays$1(today, -i);
		for (const b of blocks) {
			if (b.kind !== "study" || day < b.createdDay || !blockOn(b, day)) continue;
			if (!closed.has(`${b.id}:${day}`)) out.push({
				block: b,
				day
			});
		}
	}
	return out;
}
// src/main/planner.ts
var toTask = (r) => ({
	id: r.id,
	title: r.title,
	category: r.category,
	coins: r.coins,
	xp: r.xp,
	priority: r.priority,
	due: r.due,
	repeat: r.repeat,
	weekdays: r.weekdays,
	notes: r.notes,
	createdDay: r.created_day
});
var toBlock = (r) => ({
	id: r.id,
	title: r.title,
	kind: r.kind,
	start: r.start,
	minutes: r.minutes,
	weekdays: r.weekdays,
	date: r.date,
	remindMin: r.remind_min,
	createdDay: r.created_day
});
/** Local wall-clock time on a day key, as an instant. */
function atLocal(day, hhmm) {
	return /* @__PURE__ */ new Date(`${day}T${hhmm}:00`);
}
var Tasks = class {
	db;
	wallet;
	shieldService;
	economy;
	constructor(db, wallet, shieldService) {
		this.db = db;
		this.wallet = wallet;
		this.shieldService = shieldService;
	}
	setEconomy(economy) {
		this.economy = economy;
	}
	liveLedgerIds() {
		return new Set(effective(this.wallet.entries()).map((e) => e.id));
	}
	/** Days each task was completed, ignoring completions undone in History. */
	doneDays(live) {
		const out = /* @__PURE__ */ new Map();
		const rows = this.db.prepare("SELECT task_id, day, ledger_id FROM task_done").all();
		for (const r of rows) {
			if (!live.has(r.ledger_id)) continue;
			if (!out.has(r.task_id)) out.set(r.task_id, /* @__PURE__ */ new Set());
			out.get(r.task_id).add(r.day);
		}
		return out;
	}
	task(id) {
		const row = this.db.prepare("SELECT * FROM tasks WHERE id = ? AND archived = 0").get(id);
		if (!row) throw new LedgerError("Task not found");
		return toTask(row);
	}
	coinsToday(today) {
		return effective(this.wallet.entries()).filter((e) => e.module === "tasks" && e.day === today && e.ref?.startsWith("task:")).reduce((s, e) => s + Math.max(0, e.coins), 0);
	}
	categories() {
		return this.db.prepare("SELECT id, label, color FROM categories WHERE archived = 0 ORDER BY sort, label").all();
	}
	state(now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const live = this.liveLedgerIds();
		const done = this.doneDays(live);
		const rows = this.db.prepare("SELECT * FROM tasks WHERE archived = 0").all().map(toTask);
		const views = [];
		for (const t of rows) {
			const days = done.get(t.id) ?? /* @__PURE__ */ new Set();
			if (!taskOn(t, today, days)) continue;
			const sorted = [...days].sort();
			views.push({
				...t,
				done: t.repeat === "none" ? days.size > 0 : days.has(today),
				overdue: isOverdue(t, today, days),
				lastDone: sorted[sorted.length - 1] ?? null
			});
		}
		return {
			today,
			categories: this.categories(),
			tasks: sortTasks(views),
			coinsToday: this.coinsToday(today),
			dailyCap: 150
		};
	}
	save(input, now = /* @__PURE__ */ new Date()) {
		const t = {
			...input,
			title: input.title.trim(),
			notes: input.notes?.trim() || null,
			due: input.due || null
		};
		validateTask(t);
		if (!this.categories().some((c) => c.id === t.category)) throw new LedgerError("Unknown category");
		const params = {
			title: t.title,
			category: t.category,
			coins: t.coins,
			xp: t.xp,
			priority: t.priority,
			due: t.due,
			repeat: t.repeat,
			weekdays: t.weekdays,
			notes: t.notes
		};
		if (input.id) {
			this.task(input.id);
			this.db.prepare("UPDATE tasks SET title=@title, category=@category, coins=@coins, xp=@xp, priority=@priority, due=@due, repeat=@repeat, weekdays=@weekdays, notes=@notes WHERE id=@id").run({
				...params,
				id: input.id
			});
		} else this.db.prepare("INSERT INTO tasks (title, category, coins, xp, priority, due, repeat, weekdays, notes, created_day) VALUES (@title, @category, @coins, @xp, @priority, @due, @repeat, @weekdays, @notes, @createdDay)").run({
			...params,
			createdDay: this.wallet.today(now)
		});
	}
	archive(id) {
		this.task(id);
		this.db.prepare("UPDATE tasks SET archived = 1 WHERE id = ?").run(id);
	}
	complete(id, now = /* @__PURE__ */ new Date()) {
		return this.db.transaction(() => {
			const t = this.task(id);
			const today = this.wallet.today(now);
			let { coins, xp } = planTaskComplete(t, today, this.doneDays(this.liveLedgerIds()).get(id) ?? /* @__PURE__ */ new Set(), this.coinsToday(today));
			if (this.economy?.isBuffActive("multiplier_boost", now)) {
				const mult = this.economy.getBuffMultiplier("multiplier_boost", now) || 2;
				coins = Math.round(coins * mult);
			}
			if (this.economy?.isBuffActive("xp_boost", now)) {
				const xpMult = this.economy.getBuffMultiplier("xp_boost", now) || 1.5;
				xp = Math.round(xp * xpMult);
			}
			const ledgerId = this.wallet.append({
				ts: now.toISOString(),
				day: today,
				module: "tasks",
				kind: "earn",
				coins,
				xp,
				ref: `task:${id}`,
				note: t.title
			});
			this.db.prepare("DELETE FROM task_done WHERE task_id = ? AND day = ?").run(id, today);
			this.db.prepare("INSERT INTO task_done (task_id, day, ledger_id) VALUES (?, ?, ?)").run(id, today, ledgerId);
			if (t.priority === 1) try {
				if (this.wallet.summary(now).level.perks.some((p) => p.id === "shadow_monarch_extraction" && p.unlocked)) {
					const currentStreak = parseInt(getSetting(this.db, "perk.shadow_monarch.p1_streak") || "0", 10) + 1;
					if (currentStreak >= 7) {
						setSetting(this.db, "perk.shadow_monarch.p1_streak", "0");
						this.shieldService?.awardFreeShield("Shadow Monarch Extraction: 7 consecutive P1 tasks");
					} else setSetting(this.db, "perk.shadow_monarch.p1_streak", String(currentStreak));
				}
			} catch {}
			return ledgerId;
		}).immediate();
	}
	uncomplete(id, now = /* @__PURE__ */ new Date()) {
		this.db.transaction(() => {
			const t = this.task(id);
			const today = this.wallet.today(now);
			const live = this.liveLedgerIds();
			const row = this.db.prepare("SELECT day, ledger_id FROM task_done WHERE task_id = ?").all(id).find((r) => live.has(r.ledger_id) && (t.repeat === "none" || r.day === today));
			if (!row) throw new LedgerError("This task is not done");
			this.wallet.undo(row.ledger_id, "Task unticked", now);
			this.db.prepare("DELETE FROM task_done WHERE task_id = ? AND day = ?").run(id, row.day);
		}).immediate();
	}
	saveCategory(c) {
		const id = c.id.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
		if (!id || !c.label.trim()) throw new LedgerError("A category needs a name");
		if (!/^#[0-9a-fA-F]{6}$/.test(c.color)) throw new LedgerError("Color must look like #A1B2C3");
		this.db.prepare(`INSERT INTO categories (id, label, color, sort) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM categories))
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, color = excluded.color, archived = 0`).run(id, c.label.trim(), c.color);
	}
	archiveCategory(id) {
		this.db.prepare("UPDATE categories SET archived = 1 WHERE id = ?").run(id);
	}
};
var Schedule = class {
	db;
	wallet;
	economy;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	setEconomy(economy) {
		this.economy = economy;
	}
	blocks() {
		return this.db.prepare("SELECT * FROM blocks WHERE archived = 0 ORDER BY start").all().map(toBlock);
	}
	block(id) {
		const row = this.db.prepare("SELECT * FROM blocks WHERE id = ? AND archived = 0").get(id);
		if (!row) throw new LedgerError("Block not found");
		return toBlock(row);
	}
	log(id, day) {
		return this.db.prepare("SELECT * FROM block_log WHERE block_id = ? AND day = ?").get(id, day);
	}
	/** Pays out a block's rule if it has one; limits that block it just mean no coins. */
	payout(ruleId, b, day, now) {
		if (!ruleId) return null;
		try {
			return this.wallet.awardRule(ruleId, {
				now,
				day,
				ref: `block:${b.id}:${day}`,
				note: b.title
			});
		} catch (e) {
			if (e instanceof LedgerError) return null;
			throw e;
		}
	}
	/** Closes study blocks from past days that were left open, with the skip penalty. */
	closeMissed(now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const closed = new Set(this.db.prepare("SELECT block_id, day FROM block_log WHERE status != 'running'").all().map((r) => `${r.block_id}:${r.day}`));
		const misses = blocksToMiss(this.blocks(), closed, today);
		this.db.transaction(() => {
			for (const { block, day } of misses) {
				const ledgerId = this.payout(BLOCK_RULES[block.kind].skipped, block, day, now);
				this.db.prepare(`INSERT INTO block_log (block_id, day, status, ended_at, ledger_id) VALUES (?, ?, 'missed', ?, ?)
             ON CONFLICT(block_id, day) DO UPDATE SET status = 'missed', ended_at = excluded.ended_at, ledger_id = excluded.ledger_id`).run(block.id, day, now.toISOString(), ledgerId);
			}
		})();
		return misses.length;
	}
	state(day, now = /* @__PURE__ */ new Date()) {
		this.closeMissed(now);
		const today = this.wallet.today(now);
		const d = day ?? today;
		return {
			day: d,
			today,
			blocks: this.blocks().filter((b) => blockOn(b, d)).map((b) => {
				const log = this.log(b.id, d);
				const startsAt = atLocal(d, b.start);
				return {
					...b,
					day: d,
					status: log?.status ?? "pending",
					startsAt: startsAt.toISOString(),
					endsAt: new Date(startsAt.getTime() + b.minutes * 6e4).toISOString(),
					startedAt: log?.started_at ?? null,
					finishAllowedAt: log?.status === "running" && log.started_at ? finishAllowedAt(log.started_at, b.minutes).toISOString() : null
				};
			}),
			all: this.blocks()
		};
	}
	save(input, now = /* @__PURE__ */ new Date()) {
		const b = {
			...input,
			title: input.title.trim(),
			date: input.date || null,
			weekdays: input.date ? 0 : input.weekdays
		};
		validateBlock(b);
		const params = {
			title: b.title,
			kind: b.kind,
			start: b.start,
			minutes: b.minutes,
			weekdays: b.weekdays,
			date: b.date,
			remindMin: b.remindMin
		};
		if (input.id) {
			this.block(input.id);
			this.db.prepare("UPDATE blocks SET title=@title, kind=@kind, start=@start, minutes=@minutes, weekdays=@weekdays, date=@date, remind_min=@remindMin WHERE id=@id").run({
				...params,
				id: input.id
			});
		} else this.db.prepare("INSERT INTO blocks (title, kind, start, minutes, weekdays, date, remind_min, created_day) VALUES (@title, @kind, @start, @minutes, @weekdays, @date, @remindMin, @createdDay)").run({
			...params,
			createdDay: this.wallet.today(now)
		});
	}
	archive(id) {
		this.block(id);
		this.db.prepare("UPDATE blocks SET archived = 1 WHERE id = ?").run(id);
	}
	todayBlock(id, now) {
		const b = this.block(id);
		const day = this.wallet.today(now);
		if (!blockOn(b, day)) throw new LedgerError("This block is not on today");
		return {
			b,
			day,
			log: this.log(id, day)
		};
	}
	start(id, now = /* @__PURE__ */ new Date()) {
		const { b, day, log } = this.todayBlock(id, now);
		if (log) throw new LedgerError(log.status === "running" ? "Already running" : "This block is already closed");
		const running = this.db.prepare("SELECT b.title FROM block_log l JOIN blocks b ON b.id = l.block_id WHERE l.day = ? AND l.status = 'running'").get(day);
		if (running) throw new LedgerError(`Finish or skip "${running.title}" first`);
		this.db.prepare("INSERT INTO block_log (block_id, day, status, started_at) VALUES (?, ?, 'running', ?)").run(b.id, day, now.toISOString());
	}
	finish(id, now = /* @__PURE__ */ new Date()) {
		this.db.transaction(() => {
			const { b, day, log } = this.todayBlock(id, now);
			planFinish(log?.status ?? "pending", log?.started_at ?? null, b.minutes, now);
			const ledgerId = this.payout(BLOCK_RULES[b.kind].done, b, day, now);
			this.db.prepare("UPDATE block_log SET status = 'done', ended_at = ?, ledger_id = ? WHERE block_id = ? AND day = ?").run(now.toISOString(), ledgerId, b.id, day);
			if (ledgerId && b.kind === "study") try {
				if (this.wallet.summary(now).level.perks.some((p) => p.id === "iron_focus" && p.unlocked)) {
					const baseCoins = this.wallet.entries().find((e) => e.id === ledgerId)?.coins ?? 0;
					if (baseCoins > 0) {
						const bonusCoins = Math.max(1, Math.round(baseCoins * .2));
						this.wallet.append({
							ts: now.toISOString(),
							day,
							module: "perks",
							kind: "earn",
							coins: bonusCoins,
							xp: 0,
							ref: `perk:iron_focus:${b.id}:${day}`,
							note: "Perk: Iron Focus (+20% coins)"
						});
					}
				}
			} catch {}
		}).immediate();
	}
	skip(id, now = /* @__PURE__ */ new Date()) {
		this.db.transaction(() => {
			const { b, day, log } = this.todayBlock(id, now);
			planSkip(log?.status ?? "pending");
			const ledgerId = this.payout(BLOCK_RULES[b.kind].skipped, b, day, now);
			this.db.prepare(`INSERT INTO block_log (block_id, day, status, ended_at, ledger_id) VALUES (?, ?, 'skipped', ?, ?)
           ON CONFLICT(block_id, day) DO UPDATE SET status = 'skipped', ended_at = excluded.ended_at, ledger_id = excluded.ledger_id`).run(b.id, day, now.toISOString(), ledgerId);
		}).immediate();
	}
};
function planBuyShield(balance, currentShields, maxShields = 5) {
	if (balance < 50) throw new LedgerError(`Need 50 coins to buy a Streak Shield (you have ${balance})`);
	if (currentShields >= maxShields) throw new LedgerError(`Shield inventory full (maximum ${maxShields} shields)`);
	return {
		coins: 50,
		shields: currentShields + 1
	};
}
// src/main/shields.ts
var ShieldService = class {
	db;
	wallet;
	timeZone;
	constructor(db, wallet, timeZone = "UTC") {
		this.db = db;
		this.wallet = wallet;
		this.timeZone = timeZone;
	}
	count() {
		const val = getSetting(this.db, "streak_shields");
		return val ? parseInt(val, 10) : 0;
	}
	buy(now = /* @__PURE__ */ new Date()) {
		const summary = this.wallet.summary(now);
		const current = this.count();
		const plan = planBuyShield(summary.balance, current);
		const day = dayKey(now, this.timeZone);
		this.wallet.append({
			ts: now.toISOString(),
			day,
			module: "shop",
			kind: "spend",
			coins: -plan.coins,
			xp: 0,
			ref: "shield:buy",
			note: "Purchased Streak Shield"
		});
		setSetting(this.db, "streak_shields", String(plan.shields));
		return {
			shields: plan.shields,
			balance: this.wallet.summary(now).balance
		};
	}
	awardFreeShield(reason = "Bonus") {
		const next = this.count() + 1;
		setSetting(this.db, "streak_shields", String(next));
		return next;
	}
	consume() {
		const current = this.count();
		if (current <= 0) return false;
		setSetting(this.db, "streak_shields", String(current - 1));
		return true;
	}
};
function xpToNext(level) {
	return Math.round(80 * Math.pow(level, 1.3));
}
var RANKS = [
	{
		minLevel: 1,
		name: "Recruit (E-Rank)",
		title: "The Weakest Hunter",
		grade: "E-Rank",
		badge: "⚔️",
		color: "#8A93A6",
		auraGlow: "rgba(138, 147, 166, 0.4)",
		desc: "You have awakened at the bottom of the world. Even if called the weakest, the System has chosen you. Take your daily quest and begin your ascent.",
		perk: "Awakening Spark: +10% XP on first daily ritual",
		dailyQuestBonus: 5
	},
	{
		minLevel: 3,
		name: "E-Rank Scout",
		title: "Dungeon Scout",
		grade: "E-Rank",
		badge: "🗡️",
		color: "#A0AEC0",
		auraGlow: "rgba(160, 174, 192, 0.4)",
		desc: "Learning the terrain of your mind. You spot old addictive triggers and complacency before they strike.",
		perk: "Pattern Sense: +5% Urge Resistance",
		dailyQuestBonus: 5
	},
	{
		minLevel: 5,
		name: "D-Rank Survivor",
		title: "Dungeon Survivor",
		grade: "D-Rank",
		badge: "🛡️",
		color: "#4ADE80",
		auraGlow: "rgba(74, 222, 128, 0.4)",
		desc: "You no longer panic when habits get hard. Workouts and clean days are becoming your new normal.",
		perk: "Iron Will: Workout fatigue reduced by 10%",
		dailyQuestBonus: 8
	},
	{
		minLevel: 8,
		name: "D-Rank Gate Clearer",
		title: "Gate Breaker",
		grade: "D-Rank",
		badge: "⚡",
		color: "#52E38B",
		auraGlow: "rgba(82, 227, 139, 0.4)",
		desc: "Entering basic habit dungeons with certainty. Morning wake-ups and focused blocks are completed with steady rhythm.",
		perk: "Momentum Pulse: +5 coins on completed focus blocks",
		dailyQuestBonus: 8
	},
	{
		minLevel: 10,
		name: "C-Rank Striker",
		title: "Dungeon Striker",
		grade: "C-Rank",
		badge: "🏹",
		color: "#38BDF8",
		auraGlow: "rgba(56, 189, 248, 0.45)",
		desc: "You possess real destructive power against procrastination. The gap between your intentions and execution has shrunk dramatically.",
		perk: "Striking Velocity: Tasks completed before noon pay +20% XP",
		dailyQuestBonus: 10
	},
	{
		minLevel: 14,
		name: "C-Rank Raid Vanguard",
		title: "Raid Vanguard",
		grade: "C-Rank",
		badge: "🔱",
		color: "#0EA5E9",
		auraGlow: "rgba(14, 165, 233, 0.45)",
		desc: "First through the gate. When adversity strikes your schedule, you spearhead the solution instead of retreating.",
		perk: "Frontline Fortitude: Streak Shield durability increased",
		dailyQuestBonus: 12
	},
	{
		minLevel: 18,
		name: "B-Rank Raider",
		title: "Dungeon Raider",
		grade: "B-Rank",
		badge: "🔮",
		color: "#818CF8",
		auraGlow: "rgba(129, 140, 248, 0.45)",
		desc: "A respected warrior. Common temptations, binge spending, and impulse distractions no longer defeat you in standard encounters.",
		perk: "Budget Fortification: Daily budget remaining bonus +10%",
		dailyQuestBonus: 15
	},
	{
		minLevel: 22,
		name: "B-Rank High Striker",
		title: "High Striker",
		grade: "B-Rank",
		badge: "💥",
		color: "#6366F1",
		auraGlow: "rgba(99, 102, 241, 0.5)",
		desc: "High workout volume and intense focus sessions feel second nature. Your daily output outclasses 95% of your peers.",
		perk: "Dual Strike: Double XP on days with 2+ completed study blocks",
		dailyQuestBonus: 15
	},
	{
		minLevel: 26,
		name: "B-Rank Raid Commander",
		title: "Tactical Commander",
		grade: "B-Rank",
		badge: "🦅",
		color: "#A855F7",
		auraGlow: "rgba(168, 85, 247, 0.5)",
		desc: "Orchestrating every hour with tactical clarity. No time is wasted in mindless scrolling or hesitation.",
		perk: "Commander Domain: All 5 daily rituals completed grants +15 bonus coins",
		dailyQuestBonus: 18
	},
	{
		minLevel: 30,
		name: "A-Rank Elite Vanguard",
		title: "Red Gate Conqueror",
		grade: "A-Rank",
		badge: "🔥",
		color: "#C084FC",
		auraGlow: "rgba(192, 132, 252, 0.5)",
		desc: "You enter red gates without fear. Extreme workloads and intense physical challenges are systematically conquered.",
		perk: "Red Gate Resilience: Missed block penalty reduced by 50%",
		dailyQuestBonus: 20
	},
	{
		minLevel: 35,
		name: "A-Rank Shadow Assassin",
		title: "Stealth Infiltrator",
		grade: "A-Rank",
		badge: "🥷",
		color: "#E879F9",
		auraGlow: "rgba(232, 121, 249, 0.5)",
		desc: "Moving silently through your goals. Stealth discipline mode: results speak so loudly that explanations are unnecessary.",
		perk: "Silent Mastery: Stealth check-ins yield +10 XP",
		dailyQuestBonus: 22
	},
	{
		minLevel: 40,
		name: "A-Rank Master of Iron",
		title: "Ironclad Titan",
		grade: "A-Rank",
		badge: "🦾",
		color: "#F43F5E",
		auraGlow: "rgba(244, 63, 94, 0.55)",
		desc: "The physical temple is hardened. Heavy weights, push-up sets, and cold discipline have sculpted an unbreakable warrior body.",
		perk: "Muscle Memory: Workouts logged award +5 extra coins",
		dailyQuestBonus: 25
	},
	{
		minLevel: 45,
		name: "A-Rank Apex Hunter",
		title: "Guild Champion",
		grade: "A-Rank",
		badge: "👑",
		color: "#FB7185",
		auraGlow: "rgba(251, 113, 133, 0.55)",
		desc: "Standing at the peak of standard humanity. Every project and financial challenge is conquered before the deadline.",
		perk: "Apex Will: Task streaks award +25 bonus coins",
		dailyQuestBonus: 28
	},
	{
		minLevel: 50,
		name: "S-Rank Calamity Buster",
		title: "National Awakening",
		grade: "S-Rank",
		badge: "⭐",
		color: "#F5C84B",
		auraGlow: "rgba(245, 200, 75, 0.6)",
		desc: "THE MAGIC MEASURING DEVICE SHATTERS. You have entered the realm of S-Rank Hunters. Your discipline bends reality to your favor.",
		perk: "S-Rank Authority: +25% permanent multiplier across all coin earnings",
		dailyQuestBonus: 35
	},
	{
		minLevel: 55,
		name: "S-Rank Demon Castle Pioneer",
		title: "Demon Slayer",
		grade: "S-Rank",
		badge: "👹",
		color: "#EAB308",
		auraGlow: "rgba(234, 179, 8, 0.6)",
		desc: "Ascending the 100 floors of the Demon Castle. The demons of past addiction, regret, and low self-worth are permanently slain.",
		perk: "Demon Slayer Will: Urge crusher completions award double coins",
		dailyQuestBonus: 38
	},
	{
		minLevel: 60,
		name: "S-Rank Sovereign Striker",
		title: "Apex Sovereign",
		grade: "S-Rank",
		badge: "☄️",
		color: "#FACC15",
		auraGlow: "rgba(250, 204, 21, 0.65)",
		desc: "Speed, power, precision. Circadian wake-ups are clockwork; spending is surgically controlled; fitness is non-negotiable.",
		perk: "Apex Focus: On-time wakeups award +15 coins",
		dailyQuestBonus: 40
	},
	{
		minLevel: 65,
		name: "National Level Hunter",
		title: "World Authority",
		grade: "National Level",
		badge: "🌍",
		color: "#00D2FF",
		auraGlow: "rgba(0, 210, 255, 0.7)",
		desc: "Possessing power rivaling entire nations. You control your fate with absolute sovereignty. A beacon of relentless self-discipline.",
		perk: "National Authority: Level mystery chests guarantee rare loot drops",
		dailyQuestBonus: 50
	},
	{
		minLevel: 70,
		name: "National Level Titan",
		title: "Living Monolith",
		grade: "National Level",
		badge: "🏛️",
		color: "#38BDF8",
		auraGlow: "rgba(56, 189, 248, 0.7)",
		desc: "Unshakable by peer pressure, immune to dopamine traps. You stand as an indestructible monolith of habit execution.",
		perk: "Titan Shield: 1 free Streak Shield awarded upon reaching this rank",
		dailyQuestBonus: 55
	},
	{
		minLevel: 75,
		name: "Ruler’s Vessel",
		title: "Vessel of the Brilliant Light",
		grade: "National Level",
		badge: "☀️",
		color: "#67E8F9",
		auraGlow: "rgba(103, 232, 249, 0.75)",
		desc: "Channeling divine power. Telekinetic mastery over your focus: distractions bounce off your attention span like dust.",
		perk: "Ruler’s Reach: Focus timers flow effortlessly with zero mental friction",
		dailyQuestBonus: 60
	},
	{
		minLevel: 80,
		name: "Monarch Candidate",
		title: "Shadow Heir",
		grade: "Monarch Candidate",
		badge: "🌑",
		color: "#7C3AED",
		auraGlow: "rgba(124, 58, 237, 0.8)",
		desc: "The System chooses you. You stand between the world of light and sovereign darkness. Your past failures become soldiers in your shadow army.",
		perk: "Arise Extraction: Every past slip converted into permanent wisdom and XP",
		dailyQuestBonus: 70
	},
	{
		minLevel: 85,
		name: "Commander of Shadows",
		title: "Lord of the Undead",
		grade: "Monarch Candidate",
		badge: "💀",
		color: "#6D28D9",
		auraGlow: "rgba(109, 40, 217, 0.8)",
		desc: "Summoning Igris, Tank, and Iron. Your daily routines march forward automatically without conscious willpower strain.",
		perk: "Shadow Army: Recurring habits execute with zero friction",
		dailyQuestBonus: 75
	},
	{
		minLevel: 90,
		name: "Sovereign of the Abyss",
		title: "Void Sovereign",
		grade: "Monarch",
		badge: "🌌",
		color: "#5B21B6",
		auraGlow: "rgba(91, 33, 182, 0.85)",
		desc: "Master of the infinite expanse. Time bends to your priorities. When you decide a goal is done, the universe aligns.",
		perk: "Void Mastery: Reward Vault surplus earns 5% monthly dividend",
		dailyQuestBonus: 80
	},
	{
		minLevel: 95,
		name: "Shadow Monarch",
		title: "Monarch of Shadows (True Form)",
		grade: "Monarch",
		badge: "👑",
		color: "#9D4EDD",
		auraGlow: "rgba(157, 78, 221, 0.9)",
		desc: "\"ARISE.\" The true Shadow Monarch awakens. Death of bad habits is permanent; resurrection of your highest potential is absolute.",
		perk: "True Monarch Domain: 2x permanent coin multiplier on all discipline rituals",
		dailyQuestBonus: 100
	},
	{
		minLevel: 100,
		name: "Sovereign of Eternal Rebirth",
		title: "Centennial Monarch",
		grade: "Monarch",
		badge: "♾️",
		color: "#C77DFF",
		auraGlow: "rgba(199, 125, 255, 0.9)",
		desc: "Centennial titan. One hundred levels of relentless sweat, restraint, and calculated focus. You rule your mind with iron certainty.",
		perk: "Centennial Aura: Level 100 Legendary Chest unlocked with guaranteed mega drop",
		dailyQuestBonus: 110
	},
	{
		minLevel: 110,
		name: "Transcendent Sovereign",
		title: "Master of Dimensions",
		grade: "Transcendent",
		badge: "🌀",
		color: "#E0AAFF",
		auraGlow: "rgba(224, 170, 255, 0.95)",
		desc: "You operate across dimensions of financial wealth, physical elite status, and spiritual alignment. A master of total life architecture.",
		perk: "Dimensional Vault: Real-money reward budget cap removed",
		dailyQuestBonus: 125
	},
	{
		minLevel: 120,
		name: "Monarch of Total Sovereignty",
		title: "Unbreakable Ruler",
		grade: "Transcendent",
		badge: "🩸",
		color: "#FF3366",
		auraGlow: "rgba(255, 51, 102, 0.95)",
		desc: "The entire system recognizes your supremacy. No urge can breach your armor; no financial turbulence can shake your foundation.",
		perk: "Supreme Will: Complete urge immunity protocol",
		dailyQuestBonus: 140
	},
	{
		minLevel: 130,
		name: "Absolute Being Avatar",
		title: "Divine Creator",
		grade: "Divine Sovereign",
		badge: "✨",
		color: "#C8F135",
		auraGlow: "rgba(200, 241, 53, 0.95)",
		desc: "Possessing the spark of the creator. Every daily action creates ripples of excellence across your university, fitness, and family life.",
		perk: "Divine Spark: Triple XP on all master goals",
		dailyQuestBonus: 160
	},
	{
		minLevel: 140,
		name: "Primordial Architect",
		title: "Forge of Destiny",
		grade: "Divine Sovereign",
		badge: "⚜️",
		color: "#FFD700",
		auraGlow: "rgba(255, 215, 0, 1.0)",
		desc: "You do not adapt to the world; the world adapts to your discipline. A mastercraft of relentless execution.",
		perk: "Destiny Forge: Max daily coin cap increased to 500 coins",
		dailyQuestBonus: 180
	},
	{
		minLevel: 145,
		name: "Eternal Monarch of the Cosmos",
		title: "Cosmic Ruler",
		grade: "Divine Sovereign",
		badge: "🌠",
		color: "#00FFFF",
		auraGlow: "rgba(0, 255, 255, 1.0)",
		desc: "A legendary myth made flesh. The weakest E-Rank has conquered the cosmos of his own mind and soul.",
		perk: "Cosmic Dominion: Permanent 3x multiplier on all study and body blocks",
		dailyQuestBonus: 200
	},
	{
		minLevel: 150,
		name: "The Apex Sovereign (Unrivaled)",
		title: "Omnipotent Ruler of Fate",
		grade: "Absolute Supreme",
		badge: "🏆",
		color: "#FF0055",
		auraGlow: "rgba(255, 0, 85, 1.0)",
		desc: "MAX LEVEL 150. The summit of human potential. You have completed the System's grand purpose: becoming the supreme ruler of your own destiny.",
		perk: "Omnipotent Sovereign: Master of all domains, permanently crowned in eternal glory.",
		dailyQuestBonus: 250
	}
];
function hunterDefFor(level) {
	let def = RANKS[0];
	for (const r of RANKS) if (level >= r.minLevel) def = r;
	return def;
}
function nextHunterRank(level) {
	for (const r of RANKS) if (r.minLevel > level) return r;
	return null;
}
function totalStatPointsForLevel(level) {
	if (level <= 1) return 0;
	let total = 0;
	for (let l = 2; l <= level; l++) if (l <= 10) total += 1;
	else if (l <= 25) total += 2;
	else total += 3;
	return total;
}
var HUNTER_PERK_DEFINITIONS = [
	{
		id: "awakening_spark",
		name: "Awakening Spark",
		category: "combat",
		reqDesc: "Level 1",
		levelReq: 1,
		icon: "⚡",
		color: "#8A93A6",
		desc: "Awakened spark grants +10% bonus XP on the first ritual completed each day."
	},
	{
		id: "sprint_velocity",
		name: "Sprint Velocity",
		category: "mind",
		reqDesc: "AGI 20",
		statReq: {
			stat: "agi",
			value: 20
		},
		icon: "💨",
		color: "#38bdf8",
		desc: "Morning circadian momentum: on-time wakeups yield +5 bonus coins."
	},
	{
		id: "iron_focus",
		name: "Iron Focus",
		category: "mind",
		reqDesc: "INT 25",
		statReq: {
			stat: "int",
			value: 25
		},
		icon: "🧠",
		color: "#a78bfa",
		desc: "Hyper-focused cognition: planned study and focus blocks yield +20% bonus coins."
	},
	{
		id: "indomitable_bastion",
		name: "Indomitable Bastion",
		category: "recovery",
		reqDesc: "VIT 25",
		statReq: {
			stat: "vit",
			value: 25
		},
		icon: "🛡️",
		color: "#4ade80",
		desc: "Metabolic resilience: healthy sleep quality and budget discipline reinforce streak fortitude."
	},
	{
		id: "bloodlust",
		name: "Bloodlust Strike",
		category: "combat",
		reqDesc: "STR 30",
		statReq: {
			stat: "str",
			value: 30
		},
		icon: "⚔️",
		color: "#f87171",
		desc: "Relentless physical intensity: workout sessions award +25% bonus XP toward leveling."
	},
	{
		id: "rulers_authority",
		name: "Ruler's Authority",
		category: "sovereign",
		reqDesc: "SEN 30",
		statReq: {
			stat: "sen",
			value: 30
		},
		icon: "👑",
		color: "#fbbf24",
		desc: "Sovereign willpower barrier: urge reset coin penalties are permanently reduced by 50%."
	},
	{
		id: "shadow_monarch_extraction",
		name: "Shadow Monarch's Extraction",
		category: "sovereign",
		reqDesc: "Level 50",
		levelReq: 50,
		icon: "🌑",
		color: "#c084fc",
		desc: "Extracting shadow remnants: completing 7 consecutive Priority 1 (P1) tasks refunds 1 streak shield."
	}
];
function computeHunterPerks(level, attributes) {
	return HUNTER_PERK_DEFINITIONS.map((def) => {
		let unlocked = false;
		let progressPct = 0;
		if (def.levelReq != null) {
			unlocked = level >= def.levelReq;
			progressPct = Math.min(100, Math.round(level / def.levelReq * 100));
		} else if (def.statReq != null) {
			const currentStat = attributes[def.statReq.stat];
			unlocked = currentStat >= def.statReq.value;
			progressPct = Math.min(100, Math.round(currentStat / def.statReq.value * 100));
		}
		return {
			...def,
			unlocked,
			progressPct
		};
	});
}
function calculateHunterAttributes(level, params) {
	const base = Math.max(10, Math.floor(level * 2.5));
	const strBonus = Math.floor((params?.workoutCount ?? 0) * 1.5);
	const senBonus = Math.floor((params?.cleanStreakDays ?? 0) * 2);
	const intBonus = Math.floor((params?.focusBlocksCount ?? 0) * 1.8);
	const agiBonus = Math.floor((params?.onTimeWakeups ?? 0) * 1.2);
	const vitBonus = Math.floor((params?.budgetDays ?? 0) * 1);
	const allocated = {
		str: Math.max(0, Math.floor(params?.allocated?.str ?? 0)),
		agi: Math.max(0, Math.floor(params?.allocated?.agi ?? 0)),
		vit: Math.max(0, Math.floor(params?.allocated?.vit ?? 0)),
		int: Math.max(0, Math.floor(params?.allocated?.int ?? 0)),
		sen: Math.max(0, Math.floor(params?.allocated?.sen ?? 0))
	};
	const str = base + strBonus + allocated.str;
	const sen = base + senBonus + allocated.sen;
	const int = base + intBonus + allocated.int;
	const agi = base + agiBonus + allocated.agi;
	const vit = base + vitBonus + allocated.vit;
	const totalCombatPower = str * 3 + agi * 2 + vit * 2 + int * 3 + sen * 4;
	const totalEarnedPoints = totalStatPointsForLevel(level);
	const spent = allocated.str + allocated.agi + allocated.vit + allocated.int + allocated.sen;
	return {
		str,
		agi,
		vit,
		int,
		sen,
		totalCombatPower,
		allocated,
		unallocatedPoints: Math.max(0, totalEarnedPoints - spent),
		totalEarnedPoints
	};
}
function levelInfo(totalXp, hunterStatsInput) {
	let level = 1;
	let left = Number.isFinite(totalXp) ? Math.max(0, Math.floor(totalXp)) : 0;
	while (level < 150 && left >= xpToNext(level)) {
		left -= xpToNext(level);
		level++;
	}
	const xpForNext = level >= 150 ? 0 : xpToNext(level);
	const def = hunterDefFor(level);
	const next = nextHunterRank(level);
	const attributes = calculateHunterAttributes(level, hunterStatsInput);
	const perks = computeHunterPerks(level, attributes);
	return {
		level,
		xpIntoLevel: left,
		xpForNext,
		progress: xpForNext ? left / xpForNext : 1,
		rank: def.name,
		hunterTitle: def.title,
		hunterGrade: def.grade,
		rankBadge: def.badge,
		rankColor: def.color,
		rankAura: def.auraGlow,
		rankDesc: def.desc,
		rankPerk: def.perk,
		attributes,
		perks,
		nextRank: next,
		allRanks: RANKS
	};
}
// src/core/shop.ts
var TIERS = {
	bronze: {
		label: "Bronze",
		minLevel: 1,
		color: "#D59A6A"
	},
	silver: {
		label: "Silver",
		minLevel: 5,
		color: "#C9D3E3"
	},
	gold: {
		label: "Gold",
		minLevel: 10,
		color: "#F5C84B"
	},
	legendary: {
		label: "Legendary",
		minLevel: 20,
		color: "#B892FF"
	}
};
function isTier(t) {
	return t in TIERS;
}
/** Why a reward can't be bought right now, or null if it can. */
function redeemBlocker(c) {
	const { reward, balance, level, monthSpent, budget } = c;
	if (reward.archived) return "This reward is archived";
	if (balance < reward.price) return `You need ${reward.price - balance} more points`;
	if (budget > 0 && monthSpent + reward.realCost > budget) return `Over this month's reward budget (${budget - monthSpent} left)`;
	return null;
}
function planRedeem(c) {
	const why = redeemBlocker(c);
	if (why) throw new LedgerError(why);
}
function validateReward(r) {
	if (!r.title.trim()) throw new LedgerError("A reward needs a name");
	if (!Number.isInteger(r.price) || r.price <= 0) throw new LedgerError("Price must be a whole number of coins above 0");
	if (!Number.isInteger(r.realCost) || r.realCost < 0) throw new LedgerError("Real cost must be a whole number, 0 or more");
	if (!isTier(r.tier)) throw new LedgerError("Unknown tier");
}
function chestRef(level) {
	return `chest:L${level}`;
}
/** Levels whose chest is earned (level 2 and up) but not opened yet. */
function unopenedChests(level, openedRefs) {
	const opened = new Set(openedRefs);
	const out = [];
	for (let l = 2; l <= level; l++) if (!opened.has(chestRef(l))) out.push(l);
	return out;
}
/** Bigger chests at higher levels. `rand` is 0..1. */
function rollChest(level, rand) {
	const min = 10 + level * 2;
	const max = 40 + level * 5;
	return Math.round(min + rand * (max - min));
}
// src/main/shop.ts
var toReward = (r) => ({
	id: r.id,
	title: r.title,
	price: r.price,
	tier: r.tier,
	realCost: r.real_cost,
	pinned: !!r.pinned,
	archived: !!r.archived,
	note: r.note,
	imageUrl: r.image_url ?? null,
	productUrl: r.product_url ?? null,
	currency: r.currency ?? "MDL"
});
var Shop = class {
	db;
	wallet;
	timeZone;
	rand;
	economy;
	constructor(db, wallet, timeZone, rand = Math.random, economy) {
		this.db = db;
		this.wallet = wallet;
		this.timeZone = timeZone;
		this.rand = rand;
		this.economy = economy;
	}
	setEconomy(eco) {
		this.economy = eco;
	}
	rewards() {
		return this.db.prepare("SELECT * FROM rewards WHERE archived = 0 ORDER BY pinned DESC, price").all().map(toReward);
	}
	reward(id) {
		const row = this.db.prepare("SELECT * FROM rewards WHERE id = ?").get(id);
		if (!row) throw new LedgerError("Reward not found");
		return toReward(row);
	}
	budget() {
		return Number(getSetting(this.db, "reward_budget") ?? 0);
	}
	/** Real money spent on rewards this month, ignoring undone purchases. */
	monthSpent(day, undoneIds) {
		return this.db.prepare("SELECT ledger_id, real_cost FROM redemptions WHERE substr(day, 1, 7) = ?").all(monthKey$1(day)).filter((r) => !undoneIds.has(r.ledger_id)).reduce((s, r) => s + r.real_cost, 0);
	}
	undoneIds() {
		const all = this.wallet.entries();
		const live = new Set(effective(all).map((e) => e.id));
		return new Set(all.filter((e) => e.kind !== "undo" && !live.has(e.id)).map((e) => e.id));
	}
	state(now = /* @__PURE__ */ new Date()) {
		const all = this.wallet.entries();
		const day = dayKey(now, this.timeZone);
		const undone = this.undoneIds();
		const level = levelInfo(totalXp(all)).level;
		const openedRefs = effective(all).map((e) => e.ref ?? "").filter((r) => r.startsWith("chest:"));
		const recent = this.db.prepare("SELECT ledger_id, title, real_cost, day FROM redemptions ORDER BY id DESC LIMIT 8").all();
		return {
			rewards: this.rewards(),
			balance: balance(all),
			level,
			budget: this.budget(),
			monthSpent: this.monthSpent(day, undone),
			currency: getSetting(this.db, "currency") ?? "MDL",
			chests: unopenedChests(level, openedRefs),
			recent: recent.map((r) => ({
				title: r.title,
				realCost: r.real_cost,
				day: r.day,
				undone: undone.has(r.ledger_id)
			})),
			economy: this.economy?.getEconomySummary(now)
		};
	}
	save(input) {
		const r = {
			...input,
			title: input.title.trim(),
			note: input.note?.trim() || null,
			imageUrl: input.imageUrl?.trim() || null,
			productUrl: input.productUrl?.trim() || null,
			currency: input.currency?.trim() || "MDL",
			archived: false
		};
		validateReward(r);
		this.db.transaction(() => {
			if (r.pinned) this.db.prepare("UPDATE rewards SET pinned = 0").run();
			const params = {
				title: r.title,
				price: r.price,
				tier: r.tier,
				realCost: r.realCost,
				pinned: r.pinned ? 1 : 0,
				note: r.note,
				imageUrl: r.imageUrl,
				productUrl: r.productUrl,
				currency: r.currency
			};
			if (input.id) {
				this.reward(input.id);
				this.db.prepare("UPDATE rewards SET title = @title, price = @price, tier = @tier, real_cost = @realCost, pinned = @pinned, note = @note, image_url = @imageUrl, product_url = @productUrl, currency = @currency WHERE id = @id").run({
					...params,
					id: input.id
				});
			} else this.db.prepare("INSERT INTO rewards (title, price, tier, real_cost, pinned, note, image_url, product_url, currency) VALUES (@title, @price, @tier, @realCost, @pinned, @note, @imageUrl, @productUrl, @currency)").run(params);
		})();
	}
	archive(id) {
		this.reward(id);
		this.db.prepare("UPDATE rewards SET archived = 1, pinned = 0 WHERE id = ?").run(id);
	}
	redeem(id, now = /* @__PURE__ */ new Date()) {
		return this.db.transaction(() => {
			const reward = this.reward(id);
			const all = this.wallet.entries();
			const day = dayKey(now, this.timeZone);
			planRedeem({
				reward,
				balance: balance(all),
				level: levelInfo(totalXp(all)).level,
				monthSpent: this.monthSpent(day, this.undoneIds()),
				budget: this.budget()
			});
			const ledgerId = this.wallet.append({
				ts: now.toISOString(),
				day,
				module: "shop",
				kind: "spend",
				coins: -reward.price,
				xp: 0,
				ref: `reward:${id}`,
				note: reward.title
			});
			this.db.prepare("INSERT INTO redemptions (ledger_id, reward_id, title, real_cost, day) VALUES (?, ?, ?, ?, ?)").run(ledgerId, id, reward.title, reward.realCost, day);
			return ledgerId;
		}).immediate();
	}
	openChest(level, now = /* @__PURE__ */ new Date()) {
		return this.db.transaction(() => {
			if (!this.state(now).chests.includes(level)) throw new LedgerError("No chest waiting for that level");
			const coins = rollChest(level, this.rand());
			this.wallet.append({
				ts: now.toISOString(),
				day: dayKey(now, this.timeZone),
				module: "shop",
				kind: "earn",
				coins,
				xp: 0,
				ref: chestRef(level),
				note: `Level ${level} chest`
			});
			return coins;
		}).immediate();
	}
	setBudget(amount) {
		if (!Number.isInteger(amount) || amount < 0) throw new LedgerError("Budget must be a whole number, 0 or more");
		setSetting(this.db, "reward_budget", String(amount));
	}
	setCurrency(cur) {
		const code = cur?.trim().toUpperCase() || "MDL";
		setSetting(this.db, "currency", code);
		setSetting(this.db, "money_currency", code);
	}
};
// src/core/sleep.ts
function toMinutes(hhmm) {
	const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
	if (isNaN(h) || isNaN(m)) return 0;
	return h * 60 + m;
}
/**
* On-time check: wake up at or before target (with up to 15 min grace, consistent with Waky).
*/
function isWakeOnTime(wakeTime, targetTime, graceMinutes = 15) {
	return toMinutes(wakeTime) <= toMinutes(targetTime) + graceMinutes;
}
/** Bedtime check: in bed within 30 min of bedtime target. */
function isBedOnTime(bedTime, targetTime, graceMinutes = 30) {
	const b = toMinutes(bedTime);
	const t = toMinutes(targetTime);
	const diff = Math.abs(b - t);
	return diff <= graceMinutes || diff >= 1440 - graceMinutes;
}
function targetForDay(day, weekdayTarget, weekendTarget) {
	const dow = (/* @__PURE__ */ new Date(`${day}T12:00:00Z`)).getUTCDay();
	return dow === 0 || dow === 6 ? weekendTarget : weekdayTarget;
}
function computeSleepStats(logs, today, weekdayTarget = "07:00", weekendTarget = "08:30") {
	const valid = logs.filter((l) => l.day <= today).sort((a, b) => b.day.localeCompare(a.day));
	const todayLog = valid.find((l) => l.day === today) ?? null;
	const onTimeDays = valid.filter((l) => l.onTime).map((l) => l.day);
	const streak = dayStreak(onTimeDays, today);
	const bestStreak = bestDayStreak(onTimeDays);
	const last14Days = valid.slice(0, 14);
	const onTimeRate = last14Days.length > 0 ? last14Days.filter((l) => l.onTime).length / last14Days.length : null;
	let sleepMinsTotal = 0;
	let sleepCount = 0;
	for (const l of valid) if (l.wakeTime && l.bedTime) {
		const w = toMinutes(l.wakeTime);
		const b = toMinutes(l.bedTime);
		const dur = w >= b ? w - b : 1440 - b + w;
		if (dur >= 180 && dur <= 900) {
			sleepMinsTotal += dur;
			sleepCount++;
		}
	}
	return {
		today,
		weekdayTarget,
		weekendTarget,
		todayLog,
		streak,
		bestStreak,
		onTimeRate,
		avgSleepMin: sleepCount > 0 ? Math.round(sleepMinsTotal / sleepCount) : null,
		recentLogs: valid.slice(0, 14)
	};
}
// src/main/sleep.ts
function toLog(r) {
	return {
		id: r.id,
		day: r.day,
		wakeTime: r.wake_time,
		wakeTarget: r.wake_target,
		onTime: Boolean(r.on_time),
		bedTime: r.bed_time,
		bedTarget: r.bed_target,
		bedOnTime: r.bed_on_time !== null ? Boolean(r.bed_on_time) : null,
		quality: r.quality,
		createdAt: r.created_at
	};
}
var SleepService = class {
	db;
	wallet;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	weekdayTarget() {
		return getSetting(this.db, "sleep_weekday_target") || "07:00";
	}
	weekendTarget() {
		return getSetting(this.db, "sleep_weekend_target") || "08:30";
	}
	bedtimeTarget() {
		return getSetting(this.db, "sleep_bed_target") || "23:00";
	}
	setTargets(weekday, weekend, bedtime) {
		if (weekday) setSetting(this.db, "sleep_weekday_target", weekday);
		if (weekend) setSetting(this.db, "sleep_weekend_target", weekend);
		if (bedtime) setSetting(this.db, "sleep_bed_target", bedtime);
		return this.state();
	}
	logs() {
		return this.db.prepare("SELECT * FROM sleep_logs ORDER BY day DESC").all().map(toLog);
	}
	state(now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		return computeSleepStats(this.logs(), today, this.weekdayTarget(), this.weekendTarget());
	}
	/** How you slept (1–5) for a morning already logged (the bot's check-in buttons). */
	setQuality(day, quality) {
		const q = Math.round(quality);
		if (!(q >= 1 && q <= 5)) throw new LedgerError("Sleep quality is 1 to 5");
		const row = this.db.prepare("SELECT * FROM sleep_logs WHERE day = ?").get(day);
		if (!row) throw new LedgerError("Log the wake-up first");
		this.db.prepare("UPDATE sleep_logs SET quality = ? WHERE day = ?").run(q, day);
		return toLog({
			...row,
			quality: q
		});
	}
	logWake(time, quality, now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const hh = String(now.getHours()).padStart(2, "0");
		const mm = String(now.getMinutes()).padStart(2, "0");
		const wakeTime = time || `${hh}:${mm}`;
		const target = targetForDay(today, this.weekdayTarget(), this.weekendTarget());
		const onTime = isWakeOnTime(wakeTime, target);
		const existing = this.db.prepare("SELECT * FROM sleep_logs WHERE day = ?").get(today);
		if (existing) this.db.prepare("UPDATE sleep_logs SET wake_time = ?, wake_target = ?, on_time = ?, quality = ? WHERE day = ?").run(wakeTime, target, onTime ? 1 : 0, quality ?? existing.quality, today);
		else this.db.prepare("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)").run(today, wakeTime, target, onTime ? 1 : 0, quality ?? null, now.toISOString());
		let awarded = false;
		if (onTime) try {
			this.wallet.award("sleep.up_on_time", `Up at ${wakeTime} (target ${target})`, now);
			awarded = true;
		} catch {}
		return {
			log: toLog(this.db.prepare("SELECT * FROM sleep_logs WHERE day = ?").get(today)),
			state: this.state(now),
			awarded
		};
	}
	/**
	* The real wake-up time for a day you forgot to log (or logged late).
	* Today: like logging it then (pays "up on time" if it was, once a day).
	* An earlier day (up to 14 back): the record is corrected, so the streak
	* and stats are right, but no coins are paid for the past.
	*/
	setWake(day, time, now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LedgerError("Pick a day");
		const m = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
		if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new LedgerError("Use a time like 06:45");
		const wakeTime = `${m[1].padStart(2, "0")}:${m[2]}`;
		if (day > today) throw new LedgerError("That day has not come yet");
		if (daysBetween$1(day, today) > 14) throw new LedgerError("Only the last 14 days can be changed");
		if (day === today) return this.logWake(wakeTime, void 0, now);
		const target = targetForDay(day, this.weekdayTarget(), this.weekendTarget());
		const onTime = isWakeOnTime(wakeTime, target);
		if (this.db.prepare("SELECT * FROM sleep_logs WHERE day = ?").get(day)) this.db.prepare("UPDATE sleep_logs SET wake_time = ?, wake_target = ?, on_time = ? WHERE day = ?").run(wakeTime, target, onTime ? 1 : 0, day);
		else this.db.prepare("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)").run(day, wakeTime, target, onTime ? 1 : 0, now.toISOString());
		return {
			log: toLog(this.db.prepare("SELECT * FROM sleep_logs WHERE day = ?").get(day)),
			state: this.state(now),
			awarded: false
		};
	}
	logBed(time, now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const hh = String(now.getHours()).padStart(2, "0");
		const mm = String(now.getMinutes()).padStart(2, "0");
		const bedTime = time || `${hh}:${mm}`;
		const target = this.bedtimeTarget();
		const onTime = isBedOnTime(bedTime, target);
		if (this.db.prepare("SELECT * FROM sleep_logs WHERE day = ?").get(today)) this.db.prepare("UPDATE sleep_logs SET bed_time = ?, bed_target = ?, bed_on_time = ? WHERE day = ?").run(bedTime, target, onTime ? 1 : 0, today);
		else {
			const wakeTarget = targetForDay(today, this.weekdayTarget(), this.weekendTarget());
			this.db.prepare("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, NULL, ?)").run(today, "07:00", wakeTarget, bedTime, target, onTime ? 1 : 0, now.toISOString());
		}
		let awarded = false;
		if (onTime) try {
			this.wallet.award("sleep.bed_on_time", `In bed at ${bedTime} (target ${target})`, now);
			awarded = true;
		} catch {}
		return {
			log: toLog(this.db.prepare("SELECT * FROM sleep_logs WHERE day = ?").get(today)),
			state: this.state(now),
			awarded
		};
	}
};
function focusCoins(minutes) {
	return Math.floor(Math.max(0, Math.floor(minutes)) / 10) * 3;
}
/** A session longer than planned counts up to 30 minutes extra; never more than 4 hours. */
function sessionMinutes(startedAt, planned, now) {
	const elapsed = Math.round((now.getTime() - Date.parse(startedAt)) / 6e4);
	return Math.max(1, Math.min(elapsed, planned + 30, 240));
}
/** Fun (games, YouTube, scrolling) costs 1 coin a minute. */
var funCost = (minutes) => Math.max(1, Math.round(minutes));
/** Why a must-do didn't happen (one tap in the evening). */
var REASONS = [
	"Tired",
	"Phone / social media",
	"Task unclear",
	"No time",
	"Forgot",
	"Other"
];
/** "1. Essay\n2) gym; call Leo" → ["Essay", "gym", "call Leo"] (at most 5). */
function parsePlan(text) {
	return String(text || "").split(/\n|;|•/).flatMap((l) => /,/.test(l) && !/\d,\d/.test(l) && l.split(",").length <= 3 && l.length < 120 ? l.split(",") : [l]).map((l) => l.replace(/^\s*(\d+[.)]|[-*✅⬜☐]|\[\s?[xX]?\s?\])\s*/, "").trim()).filter((l) => l.length > 0).slice(0, 5);
}
/** Where a goal stands: hours done, the weekly target from here, ahead or behind. */
function goalProgress$1(g, doneMin, today) {
	const total = Math.max(1, daysBetween$1(g.createdDay, g.deadline));
	const elapsed = Math.min(total, Math.max(0, daysBetween$1(g.createdDay, today)));
	const daysLeft = Math.max(0, daysBetween$1(today, g.deadline));
	const leftH = Math.max(0, g.hours - doneMin / 60);
	const perWeekH = leftH === 0 ? 0 : leftH / Math.max(1, daysLeft / 7);
	const expectedH = g.hours * elapsed / total;
	return {
		...g,
		doneMin,
		perWeekH: Math.round(perWeekH * 10) / 10,
		aheadH: Math.round((doneMin / 60 - expectedH) * 10) / 10,
		daysLeft
	};
}
/** The last 7 days (today included), for the weekly review. */
function weekReport(sessions, plans, funMin, today) {
	const from = addDays$1(today, -6);
	const inWeek = (d) => d >= from && d <= today;
	const s = sessions.filter((x) => inWeek(x.day));
	const bySub = /* @__PURE__ */ new Map();
	for (const x of s) bySub.set(x.subject, (bySub.get(x.subject) ?? 0) + x.minutes);
	const byDay = Array.from({ length: 7 }, (_, i) => {
		const day = addDays$1(from, i);
		return {
			day,
			minutes: s.filter((x) => x.day === day).reduce((t, x) => t + x.minutes, 0)
		};
	});
	const p = plans.filter((x) => inWeek(x.day));
	const reasons = /* @__PURE__ */ new Map();
	for (const x of p) for (const r of x.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
	return {
		from,
		to: today,
		totalMin: s.reduce((t, x) => t + x.minutes, 0),
		bySubject: [...bySub].map(([subject, minutes]) => ({
			subject,
			minutes
		})).sort((a, b) => b.minutes - a.minutes),
		byDay,
		planDone: p.reduce((t, x) => t + x.items.filter((i) => i.done).length, 0),
		planTotal: p.reduce((t, x) => t + x.items.length, 0),
		topReasons: [...reasons].map(([reason, count]) => ({
			reason,
			count
		})).sort((a, b) => b.count - a.count).slice(0, 3),
		funMin
	};
}
/** "2h 05m", "45m". */
var hm$1 = (min) => min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${Math.max(0, Math.round(min))}m`;
// src/main/focus.ts
var RUNNING = "focus_running";
var FocusService = class {
	db;
	wallet;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	sessions(sinceDay) {
		return this.db.prepare("SELECT id, day, subject, minutes, coins FROM focus_sessions WHERE day >= ? ORDER BY id DESC").all(sinceDay).map((r) => ({
			...r,
			minutes: Number(r.minutes),
			coins: Number(r.coins)
		}));
	}
	running() {
		try {
			return JSON.parse(getSetting(this.db, RUNNING) || "null");
		} catch {
			return null;
		}
	}
	funMin(fromDay, toDay) {
		return this.db.prepare("SELECT coins FROM ledger WHERE module = 'fun' AND kind = 'spend' AND day >= ? AND day <= ?").all(fromDay, toDay).reduce((t, r) => t - Number(r.coins), 0);
	}
	plan(day) {
		const row = this.db.prepare("SELECT * FROM day_plans WHERE day = ?").get(day);
		if (!row) return {
			day,
			items: [],
			review: null,
			reasons: []
		};
		const parse = (s) => {
			try {
				return JSON.parse(s);
			} catch {
				return [];
			}
		};
		return {
			day,
			items: parse(row.items),
			review: row.review,
			reasons: parse(row.reasons)
		};
	}
	savePlan(p, now) {
		this.db.prepare(`INSERT INTO day_plans (day, items, review, reasons, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(day) DO UPDATE SET items = excluded.items, review = excluded.review, reasons = excluded.reasons, updated_at = excluded.updated_at`).run(p.day, JSON.stringify(p.items.slice(0, 5)), p.review, JSON.stringify(p.reasons), now.toISOString());
	}
	timed(day) {
		try {
			return this.db.prepare("SELECT subject, started_at, ended_at, minutes FROM focus_sessions WHERE day = ? ORDER BY id").all(day).map((r) => ({
				subject: String(r.subject),
				startedAt: r.started_at ? String(r.started_at) : null,
				endedAt: r.ended_at ? String(r.ended_at) : null,
				minutes: Number(r.minutes)
			}));
		} catch {
			return [];
		}
	}
	state(now = /* @__PURE__ */ new Date()) {
		const today = this.wallet.today(now);
		const all = this.sessions(addDays$1(today, -400));
		const todays = all.filter((s) => s.day === today);
		const by = /* @__PURE__ */ new Map();
		for (const s of todays) by.set(s.subject, (by.get(s.subject) ?? 0) + s.minutes);
		const goals = this.db.prepare("SELECT * FROM focus_goals WHERE archived = 0 ORDER BY deadline").all().map((g) => {
			const goal = {
				id: Number(g.id),
				title: String(g.title),
				subject: String(g.subject),
				deadline: String(g.deadline),
				hours: Number(g.hours),
				createdDay: String(g.created_day)
			};
			return goalProgress$1(goal, all.filter((s) => s.day >= goal.createdDay && s.subject.toLowerCase() === goal.subject.toLowerCase()).reduce((t, s) => t + s.minutes, 0), today);
		});
		const plans = Array.from({ length: 7 }, (_, i) => this.plan(addDays$1(today, -i)));
		const subjects = [.../* @__PURE__ */ new Set([...goals.map((g) => g.subject), ...all.map((s) => s.subject)])].slice(0, 8);
		return {
			today,
			running: this.running(),
			todayMin: todays.reduce((t, s) => t + s.minutes, 0),
			todayBySubject: [...by].map(([subject, minutes]) => ({
				subject,
				minutes
			})).sort((a, b) => b.minutes - a.minutes),
			subjects,
			recent: all.slice(0, 10),
			goals,
			plan: this.plan(today),
			week: weekReport(all, plans, this.funMin(addDays$1(today, -6), today), today),
			funToday: this.funMin(today, today),
			focusCoinsToday: todays.reduce((t, s) => t + s.coins, 0),
			todaySessions: this.timed(today)
		};
	}
	/** Starts the timer (one at a time; it keeps running across devices). */
	start(subject, planned = 50, now = /* @__PURE__ */ new Date(), task = null) {
		const name = String(subject || "").trim().slice(0, 40);
		if (!name) throw new LedgerError("What are you focusing on? e.g. Math");
		if (this.running()) throw new LedgerError("A focus session is already running: stop it first");
		const minutes = Math.min(180, Math.max(5, Math.round(planned) || 50));
		const t = task && (task.kind === "mustdo" || task.kind === "todoist") ? {
			kind: task.kind,
			ref: String(task.ref).slice(0, 200),
			title: String(task.title).slice(0, 200)
		} : null;
		setSetting(this.db, RUNNING, JSON.stringify({
			subject: name,
			startedAt: now.toISOString(),
			planned: minutes,
			task: t
		}));
		return this.state(now);
	}
	/** Stops the timer and logs the minutes; coins for them (up to the daily limit). */
	stop(now = /* @__PURE__ */ new Date()) {
		const run = this.running();
		if (!run) throw new LedgerError("No focus session is running");
		const minutes = sessionMinutes(run.startedAt, run.planned, now);
		return this.db.transaction(() => {
			setSetting(this.db, RUNNING, "null");
			return {
				...this.log(run.subject, minutes, now, run.startedAt),
				task: run.task ?? null
			};
		})();
	}
	/** Drops the running timer without logging it. */
	cancel(now = /* @__PURE__ */ new Date()) {
		setSetting(this.db, RUNNING, "null");
		return this.state(now);
	}
	/** A session you did without the timer (today pays coins; earlier days count without). */
	add(subject, minutes, day, now = /* @__PURE__ */ new Date()) {
		const name = String(subject || "").trim().slice(0, 40);
		if (!name) throw new LedgerError("Which subject?");
		const m = Math.round(minutes);
		if (!(m >= 1 && m <= 600)) throw new LedgerError("Minutes from 1 to 600");
		return this.db.transaction(() => this.log(name, m, now, null, day))();
	}
	log(subject, minutes, now, startedAt, day) {
		const today = this.wallet.today(now);
		const d = day && day <= today && day >= addDays$1(today, -14) ? day : today;
		const earned = this.sessions(today).filter((s) => s.day === today).reduce((t, s) => t + s.coins, 0);
		const coins = d === today ? Math.max(0, Math.min(focusCoins(minutes), 80 - earned)) : 0;
		const end = now.toISOString();
		const start = startedAt ?? (/* @__PURE__ */ new Date(now.getTime() - minutes * 6e4)).toISOString();
		const id = Number(this.db.prepare("INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at, coins) VALUES (?, ?, ?, ?, ?, ?)").run(d, subject, minutes, start, end, coins).lastInsertRowid);
		if (coins > 0 || minutes > 0) this.wallet.append({
			ts: end,
			day: today,
			module: "focus",
			kind: "earn",
			coins,
			xp: minutes,
			ruleId: "focus.session",
			ref: `focus:${id}`,
			note: `Focus ${minutes} min · ${subject}`
		});
		return {
			session: {
				id,
				day: d,
				subject,
				minutes,
				coins
			},
			coins,
			state: this.state(now)
		};
	}
	/** Today's 1–3 (up to 5) must-dos. Keeps what was already ticked. */
	setPlan(items, now = /* @__PURE__ */ new Date(), day) {
		const d = day ?? this.wallet.today(now);
		const cur = this.plan(d);
		const next = items.map((t) => String(t).trim().slice(0, 140)).filter(Boolean).slice(0, 5).map((text) => ({
			text,
			done: cur.items.find((i) => i.text === text)?.done ?? false
		}));
		if (!next.length) throw new LedgerError("Write at least one must-do");
		this.savePlan({
			...cur,
			items: next
		}, now);
		return this.plan(d);
	}
	/** Ticks (or unticks) a must-do. The first tick of each pays its coins (3 a day). */
	togglePlan(index, now = /* @__PURE__ */ new Date(), day) {
		const d = day ?? this.wallet.today(now);
		const p = this.plan(d);
		const item = p.items[index];
		if (!item) throw new LedgerError("No must-do with that number");
		item.done = !item.done;
		let coins = 0;
		return this.db.transaction(() => {
			this.savePlan(p, now);
			if (item.done && d === this.wallet.today(now)) {
				const ref = `plan:${d}:${index}`;
				const entries = this.wallet.entries();
				const paidToday = entries.filter((e) => e.ruleId === "plan.item_done" && e.day === d).length;
				if (!entries.some((e) => e.ref === ref) && paidToday < 3) {
					this.wallet.append({
						ts: now.toISOString(),
						day: d,
						module: "plan",
						kind: "earn",
						coins: 10,
						xp: 15,
						ruleId: "plan.item_done",
						ref,
						note: `Must-do: ${item.text.slice(0, 80)}`
					});
					coins = 10;
				}
			}
			return {
				plan: this.plan(d),
				coins
			};
		})();
	}
	/** The evening review: what got in the way, a line about the day. */
	review(text, reasons, now = /* @__PURE__ */ new Date(), day) {
		const d = day ?? this.wallet.today(now);
		const p = this.plan(d);
		this.savePlan({
			...p,
			review: text?.trim().slice(0, 500) || p.review,
			reasons: [...new Set(reasons.map((r) => String(r).slice(0, 40)))].slice(0, 6)
		}, now);
		return this.plan(d);
	}
	saveGoal(g, now = /* @__PURE__ */ new Date()) {
		const title = String(g.title || "").trim().slice(0, 80);
		const subject = String(g.subject || title).trim().slice(0, 40);
		if (!title) throw new LedgerError("Name the goal, e.g. \"Math exam\"");
		if (!/^\d{4}-\d{2}-\d{2}$/.test(g.deadline)) throw new LedgerError("Pick the deadline");
		if (!(g.hours > 0 && g.hours <= 2e3)) throw new LedgerError("How many hours does it need?");
		if (g.id) this.db.prepare("UPDATE focus_goals SET title = ?, subject = ?, deadline = ?, hours = ? WHERE id = ?").run(title, subject, g.deadline, g.hours, g.id);
		else this.db.prepare("INSERT INTO focus_goals (title, subject, deadline, hours, created_day) VALUES (?, ?, ?, ?, ?)").run(title, subject, g.deadline, g.hours, this.wallet.today(now));
		return this.state(now);
	}
	archiveGoal(id, now = /* @__PURE__ */ new Date()) {
		this.db.prepare("UPDATE focus_goals SET archived = 1 WHERE id = ?").run(id);
		return this.state(now);
	}
	/** Fun time costs coins (1 a minute); you can't spend coins you don't have. */
	fun(minutes, what = "Fun", now = /* @__PURE__ */ new Date()) {
		const cost = funCost(minutes);
		if (!(minutes >= 1 && minutes <= 600)) throw new LedgerError("Minutes from 1 to 600");
		return this.db.transaction(() => {
			const bal = balance(this.wallet.entries());
			if (bal < cost) throw new LedgerError(`Not enough coins: ${minutes} min of fun costs ${cost}, you have ${bal}. Focus first!`);
			this.wallet.append({
				ts: now.toISOString(),
				day: this.wallet.today(now),
				module: "fun",
				kind: "spend",
				coins: -cost,
				xp: 0,
				ruleId: null,
				ref: null,
				note: `${String(what).slice(0, 40)} · ${minutes} min`
			});
			return {
				cost,
				balance: bal - cost
			};
		})();
	}
};
// src/core/progress.ts
var WEEKS = 6;
/** Sum of `value` for days in [from, to]. */
function sum(rows, from, to, value) {
	let t = 0;
	for (const r of rows) if (r.day >= from && r.day <= to) t += value(r);
	return t;
}
/** Clean days in [from, to], counted like the Discipline streak (after the current start, not on reset days). */
function cleanDays(ev, from, to, today) {
	const starts = ev.filter((e) => e.kind === "start").map((e) => e.day);
	if (!starts.length) return 0;
	const start = starts[starts.length - 1];
	const resets = new Set(ev.filter((e) => e.kind === "reset" && e.day > start).map((e) => e.day));
	let n = 0;
	for (let d = from; d <= to && d <= today; d = addDays$1(d, 1)) if (d > start && !resets.has(d)) n++;
	return n;
}
function progressReport(i) {
	const to = i.today;
	const win = (w) => ({
		from: addDays$1(to, -6 - 7 * w),
		to: addDays$1(to, -7 * w)
	});
	const series = (f) => Array.from({ length: WEEKS }, (_, k) => {
		const w = win(5 - k);
		return f(w.from, w.to);
	});
	const lei = (v) => `${Math.round(v / 100).toLocaleString("en-US")} lei`;
	const tick = (v) => v ? "✓" : "·";
	const metrics = [
		{
			id: "focus",
			label: "Focus time",
			higherBetter: true,
			f: (a, b) => sum(i.focus, a, b, (r) => r.minutes),
			text: hm$1,
			day: (v) => v ? hm$1(v) : "·",
			target: 600,
			unit: 30
		},
		{
			id: "wake",
			label: "On-time wake-ups",
			higherBetter: true,
			f: (a, b) => sum(i.wakes, a, b, (r) => r.onTime ? 1 : 0),
			text: (v) => `${v}/7`,
			day: tick,
			target: 7,
			unit: 1
		},
		{
			id: "sport",
			label: "Workouts",
			higherBetter: true,
			f: (a, b) => new Set(i.workouts.filter((r) => r.day >= a && r.day <= b).map((r) => r.day)).size,
			text: (v) => `${v} day${v === 1 ? "" : "s"}`,
			day: tick,
			target: 4,
			unit: 1
		},
		{
			id: "clean",
			label: "Clean days",
			higherBetter: true,
			f: (a, b) => cleanDays(i.discipline, a, b, to),
			text: (v) => `${v}/7`,
			day: tick,
			target: 7,
			unit: 1
		},
		{
			id: "todoist",
			label: "Todoist tasks done",
			higherBetter: true,
			f: (a, b) => sum(i.todoist, a, b, () => 1),
			text: (v) => String(v),
			day: (v) => v ? String(v) : "·",
			target: 15,
			unit: 1
		},
		{
			id: "mustdo",
			label: "Must-dos done",
			higherBetter: true,
			f: (a, b) => sum(i.mustdos ?? [], a, b, (r) => r.done ? 1 : 0),
			text: (v) => String(v),
			day: (v) => v ? String(v) : "·",
			target: 10,
			unit: 1,
			skip: !i.mustdos
		},
		{
			id: "spend",
			label: "Spent",
			higherBetter: false,
			f: (a, b) => sum(i.spending ?? [], a, b, (r) => r.bani),
			text: lei,
			day: (v) => v ? String(Math.round(v / 100)) : "·",
			target: null,
			unit: 1e4,
			skip: !i.spending
		}
	].filter((d) => !d.skip).map((d) => {
		const weeks = series(d.f);
		const now = weeks[5];
		const prev = weeks[4];
		const before = weeks.slice(1, 5);
		const usual = before.reduce((t, v) => t + v, 0) / before.length;
		const margin = Math.max(d.unit, prev * .1);
		const diff = now - prev;
		const up = diff > margin;
		const down = diff < -margin;
		const trend = !up && !down ? "same" : up === d.higherBetter ? "better" : "worse";
		const days = Array.from({ length: 7 }, (_, k) => {
			const day = addDays$1(to, k - 6);
			return {
				day,
				value: d.f(day, day)
			};
		});
		const deltaText = diff === 0 ? "same as last week" : `${diff > 0 ? "+" : "−"}${d.text(Math.abs(diff)).replace(/\/7$/, "")} vs last week`;
		return {
			id: d.id,
			label: d.label,
			now,
			prev,
			usual,
			text: d.text(now),
			prevText: d.text(prev),
			higherBetter: d.higherBetter,
			trend,
			weeks,
			days,
			target: d.target,
			targetText: d.target === null ? null : d.text(d.target),
			deltaText,
			dayText: d.day,
			fmt: d.text,
			daily: d.day === tick
		};
	});
	const better = metrics.filter((m) => m.trend === "better").map((m) => m.id);
	const worse = metrics.filter((m) => m.trend === "worse").map((m) => m.id);
	const name = (id) => metrics.find((m) => m.id === id).label.toLowerCase();
	const verdict = metrics.every((m) => m.now === 0 && m.usual === 0) ? "Not enough logged yet: a week of focus, wake-ups and workouts gives the first comparison." : better.length > worse.length ? `You're improving: ${better.map(name).join(", ")} up on last week.${worse.length ? ` Watch ${worse.map(name).join(", ")}.` : ""}` : worse.length > better.length ? `Slipping a bit: ${worse.map(name).join(", ")} below last week. Pick one to fix this week.` : better.length ? `Mixed week: ${better.map(name).join(", ")} better, ${worse.map(name).join(", ")} worse.` : "Steady: about the same as last week. Push one area a little.";
	const scored = metrics.filter((m) => m.target);
	const scoreOf = (pick) => scored.length ? Math.round(scored.reduce((t, m) => t + Math.min(1, pick(m) / m.target), 0) / scored.length * 100) : 0;
	return {
		from: win(0).from,
		to,
		metrics,
		better,
		worse,
		verdict,
		score: scoreOf((m) => m.now),
		prevScore: scoreOf((m) => m.prev)
	};
}
/** The report as a Telegram message (HTML). */
function progressText(r) {
	const mark = (m) => m.trend === "better" ? "🟢" : m.trend === "worse" ? "🔴" : "⚪";
	return `📈 <b>Am I improving?</b> Last 7 days\n\n${r.metrics.map((m) => `${mark(m)} ${m.label}: <b>${m.text}</b> (before: ${m.prevText})`).join("\n")}\n\n${r.verdict}`;
}
/** Expenses from Finance Helper's saved state (amounts in bani), for `spending`. */
function financeSpending(state) {
	if (!state || !Array.isArray(state.tx)) return null;
	return state.tx.filter((t) => t && t.type === "expense" && typeof t.date === "string" && !t.deleted).map((t) => ({
		day: t.date.slice(0, 10),
		bani: Math.abs(Number(t.base ?? t.amount) || 0)
	}));
}
// src/core/insights.ts
var WEEKDAYS$1 = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday"
];
/** Weekday of a YYYY-MM-DD (0 = Sunday), without local-time Date math. */
function weekday$2(day) {
	const [y, m, d] = day.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
/**
* Clean days, the same way the Discipline streak counts them: after your
* current start date (the latest 'start'), each day after it or after a
* reset is clean; the start day and reset days are not.
*/
function cleanSet(ev, from, to) {
	const out = /* @__PURE__ */ new Set();
	const starts = ev.filter((e) => e.kind === "start").map((e) => e.day);
	if (!starts.length) return out;
	const start = starts[starts.length - 1];
	const resets = new Set(ev.filter((e) => e.kind === "reset" && e.day > start).map((e) => e.day));
	for (let d = addDays$1(start > from ? start : addDays$1(from, -1), 1); d <= to; d = addDays$1(d, 1)) if (!resets.has(d)) out.add(d);
	return out;
}
/** Days in a row ending today (or yesterday, when today isn't done yet). */
function currentStreak(done, today) {
	let d = done.has(today) ? today : addDays$1(today, -1);
	let n = 0;
	while (done.has(d)) {
		n++;
		d = addDays$1(d, -1);
	}
	return n;
}
/** The longest run of consecutive days. */
function bestStreak(done) {
	const days = [...done].sort();
	let best = 0;
	let run = 0;
	let prev = "";
	for (const d of days) {
		run = prev && addDays$1(prev, 1) === d ? run + 1 : 1;
		best = Math.max(best, run);
		prev = d;
	}
	return best;
}
function insights(i, length = 364) {
	const to = i.today;
	const from = addDays$1(to, -(length - 1));
	const focus = /* @__PURE__ */ new Map();
	for (const r of i.focus) if (r.day >= from && r.day <= to) focus.set(r.day, (focus.get(r.day) ?? 0) + r.minutes);
	const sets = {
		focus: new Set([...focus].filter(([, m]) => m >= 50).map(([d]) => d)),
		wake: new Set(i.wakes.filter((w) => w.onTime).map((w) => w.day)),
		sport: new Set(i.workouts.map((w) => w.day)),
		clean: cleanSet(i.discipline, from, to),
		tasks: /* @__PURE__ */ new Set([...i.todoist.map((t) => t.day), ...(i.mustdos ?? []).filter((m) => m.done).map((m) => m.day)])
	};
	const LABEL = {
		focus: "50+ min focus",
		wake: "On-time wake-up",
		sport: "Workout",
		clean: "Clean day",
		tasks: "Task done"
	};
	const days = [];
	for (let d = from; d <= to; d = addDays$1(d, 1)) {
		const parts = Object.keys(sets).filter((k) => sets[k].has(d)).map((k) => LABEL[k]);
		const count = parts.length;
		days.push({
			day: d,
			count,
			level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 3 ? 3 : 4,
			focusMin: focus.get(d) ?? 0,
			parts
		});
	}
	const streaks = Object.keys(sets).map((id) => ({
		id,
		label: LABEL[id],
		current: currentStreak(sets[id], to),
		best: bestStreak(new Set([...sets[id]].filter((d) => d >= from && d <= to)))
	}));
	const byWd = Array.from({ length: 7 }, () => ({
		n: 0,
		t: 0
	}));
	for (const c of days) {
		const w = byWd[weekday$2(c.day)];
		w.n++;
		w.t += c.count;
	}
	const active = days.filter((c) => c.count > 0);
	const ranked = byWd.map((w, k) => ({
		k,
		avg: w.n ? w.t / w.n : 0
	})).sort((a, b) => b.avg - a.avg);
	return {
		days,
		streaks,
		activeDays: active.length,
		totalFocusMin: days.reduce((t, c) => t + c.focusMin, 0),
		bestWeekday: active.length >= 14 && ranked[0].avg > 0 ? WEEKDAYS$1[ranked[0].k] : null
	};
}
// src/core/growth.ts
var pct = (now, then) => then > 0 ? Math.round((now - then) / then * 100) : now > 0 ? null : 0;
var MILESTONES = [
	{
		id: "focus",
		label: (n) => `${n} hours of focus`,
		of: "focusH",
		steps: [
			10,
			25,
			50,
			100,
			250,
			500,
			1e3
		]
	},
	{
		id: "workouts",
		label: (n) => `${n} workouts`,
		of: "workouts",
		steps: [
			10,
			25,
			50,
			100,
			200,
			365
		]
	},
	{
		id: "clean",
		label: (n) => `${n} clean days`,
		of: "clean",
		steps: [
			7,
			30,
			90,
			180,
			365
		]
	},
	{
		id: "tasks",
		label: (n) => `${n} tasks done`,
		of: "tasks",
		steps: [
			50,
			100,
			250,
			500,
			1e3,
			2500
		]
	},
	{
		id: "wakes",
		label: (n) => `${n} on-time wake-ups`,
		of: "wakes",
		steps: [
			10,
			30,
			100,
			200,
			365
		]
	}
];
function growth(i, weeks = 26) {
	const today = i.today;
	const first = (rows) => rows.reduce((m, r) => r.day < m ? r.day : m, today);
	const since = [
		i.focus,
		i.wakes,
		i.workouts,
		i.todoist,
		i.mustdos ?? [],
		i.spending ?? []
	].map(first).reduce((a, b) => a < b ? a : b, today);
	const clean = cleanSet(i.discipline, since, today);
	const daily = {
		focus: /* @__PURE__ */ new Map(),
		wake: /* @__PURE__ */ new Map(),
		sport: /* @__PURE__ */ new Map(),
		clean: /* @__PURE__ */ new Map(),
		tasks: /* @__PURE__ */ new Map(),
		spend: /* @__PURE__ */ new Map()
	};
	const add = (m, d, v) => m.set(d, (m.get(d) ?? 0) + v);
	for (const r of i.focus) add(daily.focus, r.day, r.minutes);
	for (const r of i.wakes) if (r.onTime) daily.wake.set(r.day, 1);
	for (const r of i.workouts) daily.sport.set(r.day, 1);
	for (const d of clean) daily.clean.set(d, 1);
	for (const r of i.todoist) add(daily.tasks, r.day, 1);
	for (const r of i.mustdos ?? []) if (r.done) add(daily.tasks, r.day, 1);
	for (const r of i.spending ?? []) add(daily.spend, r.day, r.bani);
	const sum = (m, from, to) => {
		let t = 0;
		for (const [d, v] of m) if (d >= from && d <= to) t += v;
		return t;
	};
	const win = (k) => ({
		from: addDays$1(today, -6 - 7 * k),
		to: addDays$1(today, -7 * k)
	});
	const monthsBack = Array.from({ length: 12 }, (_, k) => {
		const [y, m] = today.split("-").map(Number);
		const d = new Date(Date.UTC(y, m - 1 - (11 - k), 1));
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
	});
	const metrics = [
		{
			id: "focus",
			label: "Focus",
			higherBetter: true,
			unit: "min"
		},
		{
			id: "wake",
			label: "On-time wake-ups",
			higherBetter: true,
			unit: "count"
		},
		{
			id: "sport",
			label: "Workouts",
			higherBetter: true,
			unit: "count"
		},
		{
			id: "clean",
			label: "Clean days",
			higherBetter: true,
			unit: "count"
		},
		{
			id: "tasks",
			label: "Tasks done",
			higherBetter: true,
			unit: "count"
		},
		{
			id: "spend",
			label: "Spending",
			higherBetter: false,
			unit: "bani",
			skip: !i.spending
		}
	].filter((d) => !d.skip).map((d) => {
		const m = daily[d.id];
		const wk = Array.from({ length: weeks }, (_, k) => {
			const w = win(weeks - 1 - k);
			return {
				label: w.from,
				value: sum(m, w.from, w.to)
			};
		});
		const months = monthsBack.map((mo) => ({
			label: mo,
			value: sum(m, `${mo}-01`, `${mo}-31`)
		}));
		const all = [];
		for (let k = 0;; k++) {
			const w = win(k);
			if (w.to < since) break;
			all.push({
				label: w.from,
				value: sum(m, w.from, w.to)
			});
			if (k > 520) break;
		}
		const thisWeek = wk[wk.length - 1]?.value ?? 0;
		const lastWeek = wk[wk.length - 2]?.value ?? 0;
		const prev4 = wk.slice(-5, -1);
		const avg4 = prev4.length ? prev4.reduce((t, p) => t + p.value, 0) / prev4.length : 0;
		const withData = all.filter((p) => p.value > 0);
		const best = withData.length ? withData.reduce((b, p) => d.higherBetter ? p.value > b.value ? p : b : p.value < b.value ? p : b) : null;
		const earlier = all.slice(1).filter((p) => p.value > 0);
		const record = d.higherBetter ? thisWeek > 0 && earlier.length > 0 && earlier.every((p) => thisWeek > p.value) : false;
		return {
			id: d.id,
			label: d.label,
			higherBetter: d.higherBetter,
			unit: d.unit,
			weeks: wk,
			months,
			thisWeek,
			lastWeek,
			avg4,
			best,
			vsLast: pct(thisWeek, lastWeek),
			vsAvg: pct(thisWeek, avg4),
			record
		};
	});
	const focusDays = [...daily.focus].sort((a, b) => b[1] - a[1]);
	const taskDays = [...daily.tasks].sort((a, b) => b[1] - a[1]);
	const focusMetric = metrics.find((x) => x.id === "focus");
	const records = {
		bestFocusDay: focusDays[0] ? {
			day: focusDays[0][0],
			minutes: focusDays[0][1]
		} : null,
		bestFocusWeek: focusMetric?.best ?? null,
		longestCleanStreak: bestStreak(clean),
		longestWakeStreak: bestStreak(new Set(daily.wake.keys())),
		longestFocusStreak: bestStreak(new Set([...daily.focus].filter(([, v]) => v >= 50).map(([k]) => k))),
		mostTasksDay: taskDays[0] ? {
			day: taskDays[0][0],
			count: taskDays[0][1]
		} : null
	};
	const cumulative = (m, scale = 1) => {
		const days = [...m].sort((a, b) => a[0] < b[0] ? -1 : 1);
		let t = 0;
		return days.map(([d, v]) => ({
			day: d,
			total: (t += v) / scale
		}));
	};
	const totals = {
		focusH: cumulative(daily.focus, 60),
		workouts: cumulative(daily.sport),
		clean: cumulative(daily.clean),
		tasks: cumulative(daily.tasks),
		wakes: cumulative(daily.wake)
	};
	const milestones = [];
	for (const ms of MILESTONES) {
		const run = totals[ms.of];
		const total = run.length ? run[run.length - 1].total : 0;
		for (const n of ms.steps) {
			const hit = run.find((r) => r.total >= n);
			milestones.push({
				id: `${ms.id}-${n}`,
				label: ms.label(n),
				at: hit?.day ?? null,
				progress: Math.min(1, total / n)
			});
			if (!hit) break;
		}
	}
	return {
		metrics,
		records,
		milestones
	};
}
// src/core/todoist.ts
/** The Todoist label that makes a task one of today's must-dos (⭐). */
var TODAY_LABEL = "today";
/** Is this task starred for today? */
var isStarred = (t) => !!t.labels?.includes(TODAY_LABEL);
/** The area name without its emoji: "🎓 University" → "University". */
var plainName = (name) => name.replace(/[^\p{L}\p{N}&\s'-]/gu, "").replace(/\s+/g, " ").trim();
/** Words that point to an area, matched against the area's name. */
var AREA_WORDS = [
	{
		area: /univ|study|school|facult/i,
		words: /\b(univ\w*|lab\w*|exam\w*|curs\w*|course\w*|lecture\w*|seminar\w*|homework|teza|referat\w*|colloq\w*|coloc\w*|etica|thesis|assignment|professor|prof|teacher|grade)\b/i
	},
	{
		area: /cyber|secur|hack/i,
		words: /\b(ctf\w*|picoctf|rust|crypto\w*|hack\w*|secur\w*|cyber\w*|pentest\w*|linux|tryhackme|htb|exploit\w*|reverse|malware|ctftime)\b/i
	},
	{
		area: /job|career|work/i,
		words: /\b(cv|resume|linkedin|job\w*|interview\w*|intern\w*|career|portfolio|apply|application|recruiter|salary|freelance)\b/i
	},
	{
		area: /sport|gym|fit|train/i,
		words: /\b(gym|workout\w*|run|running|sport\w*|train\w*|push-?ups?|squats?|swim\w*|football|box\w*)\b/i
	},
	{
		area: /health|medic/i,
		words: /\b(doctor|dentist|teeth|tooth|health|pharmac\w*|medic\w*|pills?|vitamin\w*|blood|clinic|hospital|eyes?)\b/i
	},
	{
		area: /skin|look|beauty|groom/i,
		words: /\b(skin\w*|hair\w*|face|barber|beard|shave\w*|cream|serum|acne|nails?)\b/i
	},
	{
		area: /idea/i,
		words: /\b(idea\w*|maybe|someday|think about|brainstorm|business)\b/i
	},
	{
		area: /admin|life|home|errand/i,
		words: /\b(bank|revolut|maib|pay|bill\w*|buy|order|fix|repair|call|mouse|buds|phone|laptop|documents?|passport|clean\w*|wash|groceries)\b/i
	}
];
/** The area a new task most likely belongs to, by its words (null when unclear). */
function guessArea(text, areas) {
	for (const rule of AREA_WORDS) {
		if (!rule.words.test(text)) continue;
		const hit = areas.find((a) => rule.area.test(plainName(a.name)));
		if (hit) return hit;
	}
	const lower = text.toLowerCase();
	return areas.find((a) => plainName(a.name).length > 2 && lower.includes(plainName(a.name).toLowerCase())) ?? null;
}
var IMPORTANT = /univ|lab|exam|examen|curs|course|test|colloq|deadline|essay|referat|proiect|project|cv|interview/i;
var dayDiff = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
/**
* Deadlines worth a warning: due (or with a deadline) in the next `within`
* days, not today's routine. Important means a deadline set in Todoist, P1/P2,
* or a study/career word in the task or its area (University, lab, exam…).
*/
function deadlineRadar(tasks, today, within = 3) {
	return tasks.filter((t) => !t.recurring).map((t) => {
		const date = t.deadline || t.due;
		return date ? {
			task: t,
			date,
			daysLeft: dayDiff(today, date)
		} : null;
	}).filter((x) => !!x && x.daysLeft >= 1 && x.daysLeft <= within).filter((x) => !!x.task.deadline || x.task.priority >= 3 || IMPORTANT.test(`${x.task.content} ${x.task.section ?? ""} ${x.task.project ?? ""}`)).sort((a, b) => a.daysLeft - b.daysLeft || b.task.priority - a.task.priority);
}
/** "tomorrow", "in 3 days (Tue)". */
function whenText(daysLeft, date) {
	const wd = [
		"Sun",
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat"
	][(/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay()];
	return daysLeft === 1 ? `tomorrow (${wd})` : `in ${daysLeft} days (${wd})`;
}
/** The point rule that pays for a completed Todoist task. */
var TODOIST_RULE = "tasks.todoist_done";
/** Shown as P1…P4 (Todoist's own labels). */
var pLabel = (priority) => `P${5 - Math.min(4, Math.max(1, priority || 1))}`;
/** Overdue first, then most urgent, then by time. The bot's /done N uses this order. */
function sortToday(tasks, today) {
	return tasks.slice().sort((a, b) => {
		const ao = a.due && a.due < today ? 0 : 1;
		const bo = b.due && b.due < today ? 0 : 1;
		if (ao !== bo) return ao - bo;
		if (a.priority !== b.priority) return b.priority - a.priority;
		return String(a.dueTime ?? "99").localeCompare(String(b.dueTime ?? "99"));
	});
}
var esc$3 = (s) => s.replace(/[<>&]/g, (c) => ({
	"<": "&lt;",
	">": "&gt;",
	"&": "&amp;"
})[c]);
var P_ICON = {
	4: "🔴",
	3: "🟠",
	2: "🔵",
	1: "⚪"
};
/** The bot's /todo reply. */
function todayText(tasks, today) {
	const list = sortToday(tasks, today);
	if (!list.length) return "✅ <b>Nothing left in Todoist for today.</b>\n\nAdd one: <code>/task call Leo tomorrow 17:00 p1</code>";
	const lines = list.slice(0, 15).map((t, i) => {
		const late = t.due && t.due < today ? " <i>(late)</i>" : "";
		const time = t.dueTime ? ` · ${t.dueTime}` : "";
		const proj = t.project ? ` · #${esc$3(t.project)}` : "";
		return `${i + 1}. ${P_ICON[t.priority] ?? "⚪"} <b>${esc$3(t.content)}</b>${time}${proj}${late}`;
	});
	return `📋 <b>Todoist today</b> (${list.length})\n\n${lines.join("\n")}${list.length > 15 ? `\n…and ${list.length - 15} more` : ""}\n\n<i>Done one? Send</i> <code>/done 1</code> · <i>add:</i> <code>/task …</code>`;
}
// src/main/progress.ts
var ProgressService = class {
	db;
	wallet;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	input(spending, now = /* @__PURE__ */ new Date(), days = 60) {
		const today = this.wallet.today(now);
		const since = addDays$1(today, -days);
		const all = (sql, ...args) => {
			try {
				return this.db.prepare(sql).all(...args);
			} catch {
				return [];
			}
		};
		const plans = all("SELECT day, items FROM day_plans WHERE day >= ?", since);
		return {
			today,
			focus: all("SELECT day, minutes FROM focus_sessions WHERE day >= ?", since),
			wakes: all("SELECT day, on_time FROM sleep_logs WHERE day >= ?", since).map((r) => ({
				day: r.day,
				onTime: !!r.on_time
			})),
			workouts: all("SELECT day FROM workouts WHERE day >= ?", since),
			discipline: all("SELECT kind, day FROM discipline_events WHERE kind IN ('start', 'reset') ORDER BY id"),
			todoist: all("SELECT day FROM ledger WHERE rule_id = ? AND kind = 'earn' AND day >= ? AND id NOT IN (SELECT undo_of FROM ledger WHERE undo_of IS NOT NULL)", TODOIST_RULE, since),
			mustdos: plans.flatMap((p) => {
				try {
					return JSON.parse(p.items).map((x) => ({
						day: p.day,
						done: !!x.done
					}));
				} catch {
					return [];
				}
			}),
			spending
		};
	}
	report(spending, now = /* @__PURE__ */ new Date()) {
		return progressReport(this.input(spending, now));
	}
	/** Your year: a heatmap of good days and your streaks. */
	insights(now = /* @__PURE__ */ new Date()) {
		return insights(this.input(null, now, 366));
	}
	/** Growth over weeks and months, you vs your past, records and milestones (all your history). */
	growth(spending, now = /* @__PURE__ */ new Date()) {
		return growth(this.input(spending, now, 3650));
	}
};
// src/core/weekPlan.ts
var weekday$1 = (day) => (/* @__PURE__ */ new Date(`${day}T12:00:00Z`)).getUTCDay();
/**
* The week a plan made today is for: this week's Monday, but on Sunday the
* coming week (Sunday is planning day).
*/
function planWeek(today) {
	const wd = weekday$1(today);
	return wd === 0 ? addDays$1(today, 1) : addDays$1(today, 1 - wd);
}
/** The Monday of the week today is in (Sunday counts with the week before). */
function currentWeek(today) {
	const wd = weekday$1(today);
	return addDays$1(today, wd === 0 ? -6 : 1 - wd);
}
/** Sunday, or no plan for this week yet: time to plan. */
function shouldPlan(plan, today) {
	if (weekday$1(today) === 0) return !plan || plan.week !== planWeek(today);
	return !plan || plan.week !== currentWeek(today);
}
/** The plan in force today (made last Sunday or during this week). */
function activePlan(plan, today) {
	return plan && plan.week === currentWeek(today) ? plan : null;
}
/** Checks and tidies a plan before it's saved. */
function cleanPlan(p, today, now = /* @__PURE__ */ new Date()) {
	const big3 = (p.big3 ?? []).map((b) => ({
		text: String(b?.text ?? "").trim().slice(0, 140),
		done: !!b?.done,
		todoistId: b?.todoistId ? String(b.todoistId) : null
	})).filter((b) => b.text).slice(0, 3);
	return {
		week: p.week && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? p.week : planWeek(today),
		focus: p.focus ?? "focus",
		note: String(p.note ?? "").trim().slice(0, 140),
		big3,
		savedAt: now.toISOString()
	};
}
// src/main/points.ts
/** rule id → [old default, new value]. */
var HABIT_POINTS = {
	"sleep.up_on_time": [10, 3],
	"sleep.bed_on_time": [5, 2],
	"discipline.clean_day": [20, 3],
	"discipline.urge_resisted": [10, 2],
	"discipline.oath": [3, 1],
	"discipline.reset": [-20, -5],
	"body.workout_done": [10, 3],
	"face.routine_done": [5, 2],
	"money.under_budget": [5, 2],
	"money.logged": [3, 1],
	"grand_slam.all_four": [50, 5]
};
var FLAG = "points_v2";
/** Runs once per database; true when it changed something. */
function applyPointsV2(db) {
	if (getSetting(db, FLAG)) return false;
	const upd = db.prepare("UPDATE rules SET coins = ? WHERE id = ? AND coins = ?");
	let n = 0;
	for (const [id, [from, to]] of Object.entries(HABIT_POINTS)) n += Number(upd.run(to, id, from).changes ?? 0);
	setSetting(db, FLAG, (/* @__PURE__ */ new Date()).toISOString());
	return n > 0;
}
var HABIT_V3 = [
	"sleep.up_on_time",
	"sleep.bed_on_time",
	"discipline.clean_day",
	"discipline.oath",
	"body.workout_done",
	"face.routine_done",
	"money.logged",
	"money.under_budget",
	"discipline.urge_resisted"
];
var FLAG3 = "points_v3";
/** old defaults (v1 or v2) that move to the v3 values. */
function applyPointsV3(db) {
	if (getSetting(db, FLAG3)) return false;
	let n = 0;
	const upd = db.prepare("UPDATE rules SET coins = ? WHERE id = ? AND coins = ?");
	for (const id of HABIT_V3) {
		const olds = [HABIT_POINTS[id]?.[0], HABIT_POINTS[id]?.[1]].filter((v) => typeof v === "number" && v !== 2);
		for (const old of olds) n += Number(upd.run(2, id, old).changes ?? 0);
	}
	n += Number(upd.run(5, "tasks.todoist_done", 8).changes ?? 0);
	setSetting(db, FLAG3, (/* @__PURE__ */ new Date()).toISOString());
	return n > 0;
}
/** Pays a one-time bonus (ref keeps it once); false when it was already paid. */
function payOnce(wallet, ref, coins, note, now = /* @__PURE__ */ new Date()) {
	if (wallet.entries().some((e) => e.ref === ref && e.kind !== "undo")) return false;
	wallet.append({
		ts: now.toISOString(),
		day: wallet.today(now),
		module: "goals",
		kind: "earn",
		coins,
		xp: 0,
		ref,
		note
	});
	return true;
}
// src/main/weekPlan.ts
var KEY$1 = "week_plan";
var WeekPlanService = class {
	db;
	wallet;
	constructor(db, wallet) {
		this.db = db;
		this.wallet = wallet;
	}
	/** The last plan saved (may be for an earlier week). */
	saved() {
		try {
			return JSON.parse(getSetting(this.db, KEY$1) || "null");
		} catch {
			return null;
		}
	}
	/** The plan for the week today is in, if one was made. */
	active(now = /* @__PURE__ */ new Date()) {
		return activePlan(this.saved(), this.wallet.today(now));
	}
	save(p, now = /* @__PURE__ */ new Date()) {
		const plan = cleanPlan(p, this.wallet.today(now), now);
		if (!plan.big3.length) throw new LedgerError("Add at least one big task for the week");
		setSetting(this.db, KEY$1, JSON.stringify(plan));
		return plan;
	}
	/** Ticks (or unticks) one of the big 3. */
	toggle(i, now = /* @__PURE__ */ new Date()) {
		const plan = this.active(now);
		if (!plan || !plan.big3[i]) throw new LedgerError("No such task in this week’s plan");
		plan.big3[i].done = !plan.big3[i].done;
		setSetting(this.db, KEY$1, JSON.stringify(plan));
		if (plan.big3[i].done) payOnce(this.wallet, `week:${plan.week}:big${i}`, 25, `Week goal done: ${plan.big3[i].text}`, now);
		return plan;
	}
};
// src/core/unifiedEconomy.ts
var DISCIPLINE_MULTIPLIERS = [
	{
		minStreak: 30,
		multiplier: 2,
		label: "Ascendant (2.0x)"
	},
	{
		minStreak: 14,
		multiplier: 1.5,
		label: "Spartan (1.5x)"
	},
	{
		minStreak: 7,
		multiplier: 1.25,
		label: "Disciplined (1.25x)"
	},
	{
		minStreak: 3,
		multiplier: 1.1,
		label: "Focused (1.1x)"
	},
	{
		minStreak: 0,
		multiplier: 1,
		label: "Standard (1.0x)"
	}
];
/**
* Computes active multiplier based on clean discipline streak and budget consistency.
*/
function computeActiveMultiplier(cleanStreak, budgetStreak) {
	const safeClean = Math.max(0, cleanStreak || 0);
	const safeBudget = Math.max(0, budgetStreak || 0);
	const tier = DISCIPLINE_MULTIPLIERS.find((t) => safeClean >= t.minStreak) || DISCIPLINE_MULTIPLIERS[DISCIPLINE_MULTIPLIERS.length - 1];
	const budgetBonus = safeBudget >= 3 ? .15 : 0;
	const totalRate = Math.round((tier.multiplier + budgetBonus) * 100) / 100;
	let label = tier.label;
	if (budgetBonus > 0) label += " + 💰 Budget Shield (+15%)";
	return {
		rate: tier.multiplier,
		cleanStreak: safeClean,
		budgetStreak: safeBudget,
		budgetBonus,
		totalRate,
		label
	};
}
/**
* Converts coins into equivalent real-world money value based on exchange rate.
* e.g., ratePerHundred = 10 means 100 coins = 10.00 currency (1 coin = 0.10 currency).
*/
function coinsToMoneyValue(coins, ratePerHundred = 10) {
	return Math.round(Math.max(0, coins || 0) * (Math.max(1, ratePerHundred || 10) / 100) * 100) / 100;
}
/**
* Enhanced chest roll engine with tiered mystery loot drops:
* - 60% chance: Coins Jackpot (scaled with level)
* - 20% chance: Streak Shield (free shield added to inventory)
* - 15% chance: Reward Vault Real-Money Boost (+25..+100 real currency)
* - 5% chance: 24h 2x Super Multiplier
*/
function rollEnhancedChest(level, rand = Math.random()) {
	const roll = rand * 100;
	if (roll < 60) {
		const baseMin = 15 + level * 3;
		const baseMax = 50 + level * 8;
		const coins = Math.round(baseMin + Math.random() * (baseMax - baseMin));
		return {
			type: "coins",
			value: coins,
			label: `+${coins} Coins Jackpot!`,
			description: `Discipline dividends credited directly to your points wallet.`
		};
	}
	if (roll < 80) return {
		type: "shield",
		value: 1,
		label: "🛡️ Legendary Streak Shield!",
		description: "Added 1 Streak Shield to your inventory. Your streaks are protected!"
	};
	if (roll < 95) {
		const boost = 25 + Math.floor(Math.random() * 4) * 25;
		return {
			type: "vault_boost",
			value: boost,
			label: `💰 +${boost} Vault Cash Bonus!`,
			description: `Real money surplus credited to your Reward Vault for real-world rewards.`
		};
	}
	return {
		type: "multiplier_24h",
		value: 2,
		label: "⚡ 24h 2x Super Multiplier Shard!",
		description: "Double all coin earnings across all tasks and workouts for the next 24 hours!"
	};
}
/**
* Calculates staking cap based on hunter level:
* Formula: 250 + (level * 250) coins.
*/
function computeMaxStakingCap(level) {
	return 250 + Math.max(1, Math.floor(level || 1)) * 250;
}
/**
* Computes daily dividend interest rate for staked coins:
* - Base rate: 0.5% daily (0.005)
* - 7+ day clean streak: 0.8% daily (0.008)
* - 14+ day clean streak: 1.2% daily (0.012)
* - 30+ day clean streak: 1.5% daily (0.015)
*/
function computeDailyInterestRate(cleanStreak) {
	const safeStreak = Math.max(0, cleanStreak || 0);
	if (safeStreak >= 30) return {
		rate: .015,
		percent: 1.5,
		streakBonusActive: true
	};
	if (safeStreak >= 14) return {
		rate: .012,
		percent: 1.2,
		streakBonusActive: true
	};
	if (safeStreak >= 7) return {
		rate: .008,
		percent: .8,
		streakBonusActive: true
	};
	return {
		rate: .005,
		percent: .5,
		streakBonusActive: false
	};
}
/**
* Computes estimated daily coin dividend from staked amount:
* If staked >= 50 coins, minimum yield is 1 coin/day.
*/
function computeDailyDividend(stakedCoins, cleanStreak) {
	if (stakedCoins <= 0) return 0;
	const { rate } = computeDailyInterestRate(cleanStreak);
	const calculated = Math.floor(stakedCoins * rate);
	return stakedCoins >= 50 ? Math.max(1, calculated) : calculated;
}
/**
* Calculates accrued pending interest between lastClaimDay and currentDay.
*/
function calculateAccruedInterest(stakedCoins, lastClaimDay, currentDay, cleanStreak) {
	if (stakedCoins <= 0 || !currentDay) return {
		pendingInterest: 0,
		daysPassed: 0
	};
	if (!lastClaimDay) return {
		pendingInterest: 0,
		daysPassed: 0
	};
	if (lastClaimDay >= currentDay) return {
		pendingInterest: 0,
		daysPassed: 0
	};
	const lastTime = Date.parse(`${lastClaimDay}T00:00:00Z`);
	const currTime = Date.parse(`${currentDay}T00:00:00Z`);
	if (isNaN(lastTime) || isNaN(currTime) || currTime <= lastTime) return {
		pendingInterest: 0,
		daysPassed: 0
	};
	const daysPassed = Math.floor((currTime - lastTime) / 864e5);
	if (daysPassed <= 0) return {
		pendingInterest: 0,
		daysPassed: 0
	};
	return {
		pendingInterest: computeDailyDividend(stakedCoins, cleanStreak) * daysPassed,
		daysPassed
	};
}
var CONSUMABLE_CATALOG = [
	{
		id: "focus_elixir",
		name: "Focus Elixir of the Shadow Monarch",
		title: "Focus Elixir",
		description: "Doubles (2.0x) all coin earnings on completed tasks and schedule blocks for 2 hours.",
		costCoins: 20,
		durationHours: 2,
		icon: "🧪",
		effectKind: "multiplier_boost",
		effectValue: 2,
		rarity: "rare",
		quote: "\"Your senses sharpen into absolute, unbroken focus.\""
	},
	{
		id: "xp_booster",
		name: "Grand Hunter Awakening Draught",
		title: "XP Booster",
		description: "Increases all XP earned from tasks, blocks, and workouts by +50% for 3 hours.",
		costCoins: 25,
		durationHours: 3,
		icon: "⚡",
		effectKind: "xp_boost",
		effectValue: 1.5,
		rarity: "rare",
		quote: "\"The flow of mana accelerates your cellular ascension.\""
	},
	{
		id: "streak_shield",
		name: "Aegis of the Immortal Vanguard",
		title: "Streak Aegis Shield",
		description: "Adds +1 Streak Shield to your inventory. Protects all streaks from resetting if you miss a day.",
		costCoins: 50,
		durationHours: 0,
		icon: "🛡️",
		effectKind: "streak_shield",
		effectValue: 1,
		rarity: "epic",
		quote: "\"An unyielding barrier shielding your hard-won discipline from rupture.\""
	},
	{
		id: "fatigue_neutralizer",
		name: "System Fatigue Recovery Capsule",
		title: "Fatigue Neutralizer",
		description: "Instantly cleanses workout muscle exhaustion and resets daily workout coin caps.",
		costCoins: 15,
		durationHours: 0,
		icon: "💊",
		effectKind: "workout_cap_reset",
		effectValue: 1,
		rarity: "common",
		quote: "\"Lactic acid dissolved. Physical vitality restored to baseline.\""
	}
];
var ECONOMY_PRESETS = {
	balanced: {
		id: "balanced",
		name: "Balanced Hunter",
		tagline: "Standard Progression",
		description: "Realistic, sustainable reward pacing. Standard daily yields and balanced consumable prices.",
		badge: "⚖️ BALANCED",
		bankBaseRate: .5,
		bankCapPerLevel: 250,
		consumablePrices: {
			focus_elixir: 20,
			xp_booster: 25,
			streak_shield: 50,
			fatigue_neutralizer: 15
		},
		ruleOverrides: {
			"sleep.up_on_time": {
				coins: 10,
				xp: 20
			},
			"sleep.bed_on_time": {
				coins: 5,
				xp: 10
			},
			"study.block_done": {
				coins: 15,
				xp: 30
			},
			"study.block_skipped": {
				coins: -5,
				xp: 0
			},
			"discipline.clean_day": {
				coins: 20,
				xp: 40
			},
			"discipline.urge_resisted": {
				coins: 10,
				xp: 20
			},
			"discipline.oath": {
				coins: 3,
				xp: 5
			},
			"discipline.reset": {
				coins: -20,
				xp: 0
			},
			"body.workout_done": {
				coins: 10,
				xp: 25
			},
			"face.routine_done": {
				coins: 5,
				xp: 10
			},
			"money.under_budget": {
				coins: 5,
				xp: 10
			},
			"money.logged": {
				coins: 3,
				xp: 5
			}
		}
	},
	spartan: {
		id: "spartan",
		name: "Hardcore Spartan",
		tagline: "High Stakes & Extreme Discipline",
		description: "Stricter discipline, punishing slip penalties, and precious coin rewards. For elite focus.",
		badge: "⚔️ SPARTAN",
		bankBaseRate: .3,
		bankCapPerLevel: 150,
		consumablePrices: {
			focus_elixir: 30,
			xp_booster: 35,
			streak_shield: 75,
			fatigue_neutralizer: 25
		},
		ruleOverrides: {
			"sleep.up_on_time": {
				coins: 8,
				xp: 25
			},
			"sleep.bed_on_time": {
				coins: 5,
				xp: 15
			},
			"study.block_done": {
				coins: 12,
				xp: 35
			},
			"study.block_skipped": {
				coins: -15,
				xp: 0
			},
			"discipline.clean_day": {
				coins: 25,
				xp: 60
			},
			"discipline.urge_resisted": {
				coins: 15,
				xp: 30
			},
			"discipline.oath": {
				coins: 5,
				xp: 10
			},
			"discipline.reset": {
				coins: -50,
				xp: 0
			},
			"body.workout_done": {
				coins: 12,
				xp: 35
			},
			"face.routine_done": {
				coins: 4,
				xp: 10
			},
			"money.under_budget": {
				coins: 8,
				xp: 15
			},
			"money.logged": {
				coins: 2,
				xp: 5
			}
		}
	},
	turbo: {
		id: "turbo",
		name: "Turbo Velocity",
		tagline: "High Motivation & Fast Milestones",
		description: "Generous coin and XP payouts to rapidly celebrate habit consistency and unlock master wishlist rewards.",
		badge: "⚡ TURBO",
		bankBaseRate: 1,
		bankCapPerLevel: 500,
		consumablePrices: {
			focus_elixir: 15,
			xp_booster: 20,
			streak_shield: 35,
			fatigue_neutralizer: 10
		},
		ruleOverrides: {
			"sleep.up_on_time": {
				coins: 20,
				xp: 40
			},
			"sleep.bed_on_time": {
				coins: 10,
				xp: 20
			},
			"study.block_done": {
				coins: 30,
				xp: 60
			},
			"study.block_skipped": {
				coins: -5,
				xp: 0
			},
			"discipline.clean_day": {
				coins: 40,
				xp: 80
			},
			"discipline.urge_resisted": {
				coins: 20,
				xp: 40
			},
			"discipline.oath": {
				coins: 10,
				xp: 15
			},
			"discipline.reset": {
				coins: -15,
				xp: 0
			},
			"body.workout_done": {
				coins: 25,
				xp: 50
			},
			"face.routine_done": {
				coins: 10,
				xp: 20
			},
			"money.under_budget": {
				coins: 15,
				xp: 30
			},
			"money.logged": {
				coins: 5,
				xp: 10
			}
		}
	}
};
// src/main/unifiedEconomy.ts
var toGoal = (r) => ({
	id: r.id,
	title: r.title,
	targetCoins: r.target_coins,
	targetRealCost: r.target_real_cost,
	allocatedCoins: r.allocated_coins,
	allocatedRealCost: r.allocated_real_cost,
	category: r.category,
	pinned: !!r.pinned,
	completed: !!r.completed,
	completedAt: r.completed_at,
	note: r.note,
	createdAt: r.created_at,
	imageUrl: r.image_url ?? null,
	productUrl: r.product_url ?? null,
	currency: r.currency ?? "MDL"
});
var UnifiedEconomyService = class {
	db;
	wallet;
	discipline;
	money;
	shields;
	timeZone;
	constructor(db, wallet, discipline, money, shields, timeZone) {
		this.db = db;
		this.wallet = wallet;
		this.discipline = discipline;
		this.money = money;
		this.shields = shields;
		this.timeZone = timeZone;
		this.seedInitialGoals();
	}
	seedInitialGoals() {
		try {
			const count = this.db.prepare("SELECT COUNT(*) as c FROM wishlist_goals").get();
			if (count && count.c === 0) {
				const now = (/* @__PURE__ */ new Date()).toISOString();
				const insert = this.db.prepare(`INSERT INTO wishlist_goals (title, target_coins, target_real_cost, allocated_coins, allocated_real_cost, category, pinned, completed, note, created_at, image_url, product_url, currency)
           VALUES (?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?, ?, ?)`);
				this.db.transaction(() => {
					insert.run("Kaaba Pilgrimage Fund", 2e4, 15e3, "trip", 1, "The supreme spiritual milestone. Keep stacking.", now, "https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=800&auto=format&fit=crop&q=80", "https://www.visitsaudi.com/en/umrah", "MDL");
					insert.run("MacBook / Pro Warrior Setup", 12e3, 8e3, "tech", 0, "High-performance battle workstation.", now, "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&auto=format&fit=crop&q=80", "https://darwin.md/apple-macbook-pro", "MDL");
					insert.run("Luxury Recovery & Spa Retreat", 3500, 1500, "luxury", 0, "Deep restorative rest and rejuvenation.", now, "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&auto=format&fit=crop&q=80", "https://aquaterra.md/spa", "MDL");
				})();
			}
		} catch {}
	}
	getExchangeRate() {
		return Number(getSetting(this.db, "coin_exchange_rate") ?? 10);
	}
	setExchangeRate(rate) {
		if (rate <= 0) throw new LedgerError("Exchange rate must be greater than zero");
		setSetting(this.db, "coin_exchange_rate", String(rate));
	}
	getCurrency() {
		return getSetting(this.db, "currency") ?? getSetting(this.db, "money_currency") ?? "MDL";
	}
	setCurrency(cur) {
		const code = cur?.trim().toUpperCase() || "MDL";
		setSetting(this.db, "currency", code);
		setSetting(this.db, "money_currency", code);
	}
	getVaultBalance() {
		return this.db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM reward_vault_ledger").get()?.total ?? 0;
	}
	getVaultHistory(limit = 25) {
		return this.db.prepare("SELECT * FROM reward_vault_ledger ORDER BY id DESC LIMIT ?").all(limit).map((r) => ({
			id: r.id,
			ts: r.ts,
			day: r.day,
			kind: r.kind,
			amount: r.amount,
			ref: r.ref,
			note: r.note
		}));
	}
	creditVault(kind, amount, note, ref = null, now = /* @__PURE__ */ new Date()) {
		if (amount <= 0) return this.getVaultBalance();
		const day = dayKey(now, this.timeZone);
		this.db.prepare("INSERT INTO reward_vault_ledger (ts, day, kind, amount, ref, note) VALUES (?, ?, ?, ?, ?, ?)").run(now.toISOString(), day, kind, amount, ref, note);
		return this.getVaultBalance();
	}
	debitVault(kind, amount, note, ref = null, now = /* @__PURE__ */ new Date()) {
		if (amount <= 0) return this.getVaultBalance();
		const balance = this.getVaultBalance();
		if (balance < amount) throw new LedgerError(`Insufficient Reward Vault funds (${balance} available, requested ${amount})`);
		const day = dayKey(now, this.timeZone);
		this.db.prepare("INSERT INTO reward_vault_ledger (ts, day, kind, amount, ref, note) VALUES (?, ?, ?, ?, ?, ?)").run(now.toISOString(), day, kind, -amount, ref, note);
		return this.getVaultBalance();
	}
	goals() {
		return this.db.prepare("SELECT * FROM wishlist_goals ORDER BY completed ASC, pinned DESC, id ASC").all().map(toGoal);
	}
	pinnedGoal() {
		const row = this.db.prepare("SELECT * FROM wishlist_goals WHERE pinned = 1 AND completed = 0 LIMIT 1").get();
		return row ? toGoal(row) : null;
	}
	saveGoal(input) {
		if (!input.title || !input.title.trim()) throw new LedgerError("Goal title is required");
		if (input.targetCoins <= 0 && input.targetRealCost <= 0) throw new LedgerError("Goal must have a target in coins or real money");
		const title = input.title.trim();
		const targetCoins = Math.max(0, Math.round(input.targetCoins || 0));
		const targetRealCost = Math.max(0, Math.round(input.targetRealCost || 0));
		const category = input.category || "gear";
		const note = input.note?.trim() || null;
		const imageUrl = input.imageUrl?.trim() || null;
		const productUrl = input.productUrl?.trim() || null;
		const currency = input.currency?.trim() || "MDL";
		const pinned = input.pinned ? 1 : 0;
		const now = (/* @__PURE__ */ new Date()).toISOString();
		return this.db.transaction(() => {
			if (pinned) this.db.prepare("UPDATE wishlist_goals SET pinned = 0").run();
			if (input.id) {
				this.db.prepare(`UPDATE wishlist_goals
             SET title = ?, target_coins = ?, target_real_cost = ?, category = ?, pinned = ?, note = ?, image_url = ?, product_url = ?, currency = ?
             WHERE id = ?`).run(title, targetCoins, targetRealCost, category, pinned, note, imageUrl, productUrl, currency, input.id);
				return toGoal(this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(input.id));
			} else {
				const info = this.db.prepare(`INSERT INTO wishlist_goals (title, target_coins, target_real_cost, allocated_coins, allocated_real_cost, category, pinned, completed, note, created_at, image_url, product_url, currency)
             VALUES (?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?, ?, ?)`).run(title, targetCoins, targetRealCost, category, pinned, note, now, imageUrl, productUrl, currency);
				return toGoal(this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(info.lastInsertRowid));
			}
		})();
	}
	pinGoal(id) {
		this.db.transaction(() => {
			this.db.prepare("UPDATE wishlist_goals SET pinned = 0").run();
			this.db.prepare("UPDATE wishlist_goals SET pinned = 1 WHERE id = ?").run(id);
		})();
	}
	deleteGoal(id) {
		this.db.prepare("DELETE FROM wishlist_goals WHERE id = ?").run(id);
	}
	depositCoinsToGoal(goalId, amount, now = /* @__PURE__ */ new Date()) {
		if (amount <= 0) throw new LedgerError("Deposit amount must be greater than zero");
		const currentBalance = balance(this.wallet.entries());
		if (currentBalance < amount) throw new LedgerError(`Insufficient coins balance (${currentBalance} available)`);
		const row = this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(goalId);
		if (!row) throw new LedgerError("Goal not found");
		if (row.completed) throw new LedgerError("Goal is already completed");
		const day = dayKey(now, this.timeZone);
		return this.db.transaction(() => {
			this.wallet.append({
				ts: now.toISOString(),
				day,
				module: "shop",
				kind: "spend",
				coins: -amount,
				xp: 0,
				ref: `goal:${goalId}`,
				note: `Wishlist Allocation: ${row.title}`
			});
			const newAllocated = row.allocated_coins + amount;
			const isCompleted = newAllocated >= row.target_coins && row.allocated_real_cost >= row.target_real_cost;
			const completedAt = isCompleted ? now.toISOString() : null;
			this.db.prepare("UPDATE wishlist_goals SET allocated_coins = ?, completed = ?, completed_at = ? WHERE id = ?").run(newAllocated, isCompleted ? 1 : 0, completedAt, goalId);
			return {
				goal: toGoal(this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(goalId)),
				balance: balance(this.wallet.entries())
			};
		})();
	}
	depositVaultCashToGoal(goalId, amount, now = /* @__PURE__ */ new Date()) {
		if (amount <= 0) throw new LedgerError("Deposit amount must be greater than zero");
		const vaultBal = this.getVaultBalance();
		if (vaultBal < amount) throw new LedgerError(`Insufficient Reward Vault funds (${vaultBal} available)`);
		const row = this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(goalId);
		if (!row) throw new LedgerError("Goal not found");
		if (row.completed) throw new LedgerError("Goal is already completed");
		return this.db.transaction(() => {
			this.debitVault("goal_allocation", amount, `Allocated to ${row.title}`, `goal:${goalId}`, now);
			const newAllocated = row.allocated_real_cost + amount;
			const isCompleted = row.allocated_coins >= row.target_coins && newAllocated >= row.target_real_cost;
			const completedAt = isCompleted ? now.toISOString() : null;
			this.db.prepare("UPDATE wishlist_goals SET allocated_real_cost = ?, completed = ?, completed_at = ? WHERE id = ?").run(newAllocated, isCompleted ? 1 : 0, completedAt, goalId);
			return {
				goal: toGoal(this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(goalId)),
				vaultBalance: this.getVaultBalance()
			};
		})();
	}
	claimGoal(goalId, now = /* @__PURE__ */ new Date()) {
		if (!this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(goalId)) throw new LedgerError("Goal not found");
		const completedAt = now.toISOString();
		this.db.prepare("UPDATE wishlist_goals SET completed = 1, completed_at = ? WHERE id = ?").run(completedAt, goalId);
		return toGoal(this.db.prepare("SELECT * FROM wishlist_goals WHERE id = ?").get(goalId));
	}
	openEnhancedChest(level, now = /* @__PURE__ */ new Date()) {
		const all = this.wallet.entries();
		const lvl = levelInfo(totalXp(all)).level;
		if (!unopenedChests(lvl, all.filter((e) => e.kind !== "undo").map((e) => e.ref ?? "").filter((r) => r.startsWith("chest:"))).includes(level)) throw new LedgerError("No chest waiting for that level");
		return this.db.transaction(() => {
			const drop = rollEnhancedChest(level);
			let coinsAwarded = 0;
			const day = dayKey(now, this.timeZone);
			switch (drop.type) {
				case "coins":
					coinsAwarded = drop.value;
					this.wallet.append({
						ts: now.toISOString(),
						day,
						module: "shop",
						kind: "earn",
						coins: coinsAwarded,
						xp: 0,
						ref: chestRef(level),
						note: `Level ${level} Chest: Coins Jackpot (+${coinsAwarded})`
					});
					break;
				case "shield":
					if (this.shields) this.shields.awardFreeShield(`Level ${level} Mystery Chest drop`);
					this.wallet.append({
						ts: now.toISOString(),
						day,
						module: "shop",
						kind: "earn",
						coins: 0,
						xp: 0,
						ref: chestRef(level),
						note: `Level ${level} Chest: Streak Shield Awarded`
					});
					break;
				case "vault_boost":
					this.creditVault("chest_bonus", drop.value, `Level ${level} Chest Bonus`, chestRef(level), now);
					this.wallet.append({
						ts: now.toISOString(),
						day,
						module: "shop",
						kind: "earn",
						coins: 0,
						xp: 0,
						ref: chestRef(level),
						note: `Level ${level} Chest: +${drop.value} Vault Cash Bonus`
					});
					break;
				case "multiplier_24h":
					coinsAwarded = 25;
					this.wallet.append({
						ts: now.toISOString(),
						day,
						module: "shop",
						kind: "earn",
						coins: coinsAwarded,
						xp: 0,
						ref: chestRef(level),
						note: `Level ${level} Chest: 2x Multiplier Shard (+25 coins)`
					});
			}
			this.db.prepare("INSERT INTO chest_loot_drops (level, loot_type, loot_value, loot_label, ts) VALUES (?, ?, ?, ?, ?)").run(level, drop.type, drop.value, drop.label, now.toISOString());
			const nextAll = this.wallet.entries();
			const nextOpened = nextAll.filter((e) => e.kind !== "undo").map((e) => e.ref ?? "").filter((r) => r.startsWith("chest:"));
			const remainingChests = unopenedChests(lvl, nextOpened);
			return {
				drop,
				coins: coinsAwarded,
				balance: balance(nextAll),
				chests: remainingChests
			};
		})();
	}
	getEconomySummary(now = /* @__PURE__ */ new Date()) {
		const coinsBalance = balance(this.wallet.entries());
		const rate = this.getExchangeRate();
		const coinsRealValue = coinsToMoneyValue(coinsBalance, rate);
		const vaultBalance = this.getVaultBalance();
		const currency = this.getCurrency();
		const monthlyBudget = Number(getSetting(this.db, "reward_budget") ?? 0);
		const month = dayKey(now, this.timeZone).slice(0, 7);
		const monthSpent = this.db.prepare("SELECT COALESCE(SUM(real_cost), 0) as total FROM redemptions WHERE substr(day, 1, 7) = ?").get(month)?.total ?? 0;
		const multiplier = computeActiveMultiplier(this.discipline?.state().current ?? 0, this.money?.state().today.underBudget ? 3 : 0);
		const goals = this.goals();
		return {
			coinsBalance,
			coinsRealValue,
			exchangeRate: rate,
			vaultBalance,
			currency,
			monthlyBudget,
			monthSpent,
			multiplier,
			pinnedGoal: goals.find((g) => g.pinned && !g.completed) ?? null,
			goals,
			recentVaultEntries: this.getVaultHistory(10),
			bank: this.getBankState(now),
			activeBuffs: this.getActiveBuffs(now)
		};
	}
	getBankState(now = /* @__PURE__ */ new Date()) {
		const stakedCoins = Number(getSetting(this.db, "bank_staked_coins") ?? 0);
		const totalInterestEarned = Number(getSetting(this.db, "bank_total_interest_earned") ?? 0);
		const lastClaimDay = getSetting(this.db, "bank_last_interest_day");
		const lvl = levelInfo(totalXp(this.wallet.entries())).level;
		const maxStakingCap = computeMaxStakingCap(lvl);
		const cleanStreak = this.discipline?.state(now).current ?? 0;
		const rateInfo = computeDailyInterestRate(cleanStreak);
		const { pendingInterest } = calculateAccruedInterest(stakedCoins, lastClaimDay, dayKey(now, this.timeZone), cleanStreak);
		return {
			stakedCoins,
			maxStakingCap,
			dailyRatePercent: rateInfo.percent,
			pendingInterest,
			totalInterestEarned,
			lastClaimDay,
			streakBonusActive: rateInfo.streakBonusActive,
			cleanStreak
		};
	}
	stakeCoins(amount, now = /* @__PURE__ */ new Date()) {
		if (amount <= 0) throw new LedgerError("Staking amount must be greater than zero");
		const currentBalance = balance(this.wallet.entries());
		if (currentBalance < amount) throw new LedgerError(`Insufficient coins in wallet (${currentBalance} available, ${amount} requested)`);
		const state = this.getBankState(now);
		if (state.stakedCoins + amount > state.maxStakingCap) throw new LedgerError(`Staking would exceed your Rank limit of ${state.maxStakingCap} coins. Level up to increase cap!`);
		const currentDay = dayKey(now, this.timeZone);
		return this.db.transaction(() => {
			if (state.pendingInterest > 0) {
				this.wallet.append({
					ts: now.toISOString(),
					day: currentDay,
					module: "shop",
					kind: "earn",
					coins: state.pendingInterest,
					xp: 0,
					ref: "bank:interest",
					note: "Iron Bank Auto-Accrued Dividend on Deposit"
				});
				setSetting(this.db, "bank_total_interest_earned", String(state.totalInterestEarned + state.pendingInterest));
			}
			this.wallet.append({
				ts: now.toISOString(),
				day: currentDay,
				module: "shop",
				kind: "spend",
				coins: -amount,
				xp: 0,
				ref: "bank:stake",
				note: `Iron Bank Vault Deposit: ${amount} coins staked`
			});
			const nextStaked = state.stakedCoins + amount;
			setSetting(this.db, "bank_staked_coins", String(nextStaked));
			setSetting(this.db, "bank_last_interest_day", currentDay);
			return this.getBankState(now);
		})();
	}
	withdrawCoins(amount, now = /* @__PURE__ */ new Date()) {
		if (amount <= 0) throw new LedgerError("Withdrawal amount must be greater than zero");
		const state = this.getBankState(now);
		if (state.stakedCoins < amount) throw new LedgerError(`Insufficient staked coins (${state.stakedCoins} staked, requested ${amount})`);
		const currentDay = dayKey(now, this.timeZone);
		return this.db.transaction(() => {
			if (state.pendingInterest > 0) {
				this.wallet.append({
					ts: now.toISOString(),
					day: currentDay,
					module: "shop",
					kind: "earn",
					coins: state.pendingInterest,
					xp: 0,
					ref: "bank:interest",
					note: "Iron Bank Accrued Dividend on Withdrawal"
				});
				setSetting(this.db, "bank_total_interest_earned", String(state.totalInterestEarned + state.pendingInterest));
			}
			this.wallet.append({
				ts: now.toISOString(),
				day: currentDay,
				module: "shop",
				kind: "earn",
				coins: amount,
				xp: 0,
				ref: "bank:withdraw",
				note: `Iron Bank Vault Withdrawal: ${amount} coins released`
			});
			const nextStaked = state.stakedCoins - amount;
			setSetting(this.db, "bank_staked_coins", String(nextStaked));
			setSetting(this.db, "bank_last_interest_day", currentDay);
			return this.getBankState(now);
		})();
	}
	claimInterest(now = /* @__PURE__ */ new Date()) {
		const state = this.getBankState(now);
		if (state.pendingInterest <= 0) throw new LedgerError("No dividend yield available to claim yet today");
		const currentDay = dayKey(now, this.timeZone);
		const claimed = state.pendingInterest;
		return this.db.transaction(() => {
			this.wallet.append({
				ts: now.toISOString(),
				day: currentDay,
				module: "shop",
				kind: "earn",
				coins: claimed,
				xp: 0,
				ref: "bank:interest",
				note: `Iron Bank Daily Dividend Yield: +${claimed} coins`
			});
			setSetting(this.db, "bank_last_interest_day", currentDay);
			setSetting(this.db, "bank_total_interest_earned", String(state.totalInterestEarned + claimed));
			return {
				bank: this.getBankState(now),
				claimedCoins: claimed
			};
		})();
	}
	getActiveBuffs(now = /* @__PURE__ */ new Date()) {
		const nowIso = now.toISOString();
		try {
			this.db.prepare("DELETE FROM active_buffs WHERE expires_at <= ?").run(nowIso);
			return this.db.prepare("SELECT * FROM active_buffs WHERE expires_at > ?").all(nowIso).map((r) => {
				const remainingSeconds = Math.max(0, Math.floor((Date.parse(r.expires_at) - now.getTime()) / 1e3));
				return {
					id: r.id,
					itemId: r.item_id,
					title: r.title,
					expiresAt: r.expires_at,
					effectKind: r.effect_kind,
					effectVal: r.effect_val,
					icon: r.icon,
					remainingSeconds
				};
			});
		} catch {
			return [];
		}
	}
	isBuffActive(effectKind, now = /* @__PURE__ */ new Date()) {
		try {
			const nowIso = now.toISOString();
			return (this.db.prepare("SELECT COUNT(*) as c FROM active_buffs WHERE effect_kind = ? AND expires_at > ?").get(effectKind, nowIso)?.c ?? 0) > 0;
		} catch {
			return false;
		}
	}
	getBuffMultiplier(effectKind, now = /* @__PURE__ */ new Date()) {
		try {
			const nowIso = now.toISOString();
			return this.db.prepare("SELECT MAX(effect_val) as val FROM active_buffs WHERE effect_kind = ? AND expires_at > ?").get(effectKind, nowIso)?.val ?? 1;
		} catch {
			return 1;
		}
	}
	buyConsumable(itemId, now = /* @__PURE__ */ new Date()) {
		const defaultItem = CONSUMABLE_CATALOG.find((c) => c.id === itemId);
		if (!defaultItem) throw new LedgerError(`Unknown consumable item: "${itemId}"`);
		const customCost = Number(getSetting(this.db, `price_${itemId}`)) || defaultItem.costCoins;
		const item = {
			...defaultItem,
			costCoins: customCost
		};
		const currentBalance = balance(this.wallet.entries());
		if (currentBalance < item.costCoins) throw new LedgerError(`Insufficient coins (${currentBalance} available, ${item.costCoins} required)`);
		const currentDay = dayKey(now, this.timeZone);
		return this.db.transaction(() => {
			this.wallet.append({
				ts: now.toISOString(),
				day: currentDay,
				module: "shop",
				kind: "spend",
				coins: -item.costCoins,
				xp: 0,
				ref: `consumable:${item.id}`,
				note: `Purchased ${item.name}`
			});
			const nextBalance = balance(this.wallet.entries());
			if (item.effectKind === "streak_shield") {
				this.shields?.awardFreeShield("Purchased from Hunter Tactical Store");
				return {
					balance: nextBalance,
					message: "🛡️ Streak Aegis Shield added to your tactical inventory!"
				};
			}
			if (item.effectKind === "workout_cap_reset") return {
				balance: nextBalance,
				message: "💊 System Fatigue Cleansed! Workout muscle limits reset."
			};
			const existing = this.db.prepare("SELECT * FROM active_buffs WHERE item_id = ? AND expires_at > ?").get(item.id, now.toISOString());
			const durationMs = item.durationHours * 3600 * 1e3;
			let newExpiresAt;
			if (existing) {
				newExpiresAt = new Date(Date.parse(existing.expires_at) + durationMs).toISOString();
				this.db.prepare("UPDATE active_buffs SET expires_at = ? WHERE id = ?").run(newExpiresAt, existing.id);
			} else {
				newExpiresAt = new Date(now.getTime() + durationMs).toISOString();
				const buffId = `buff_${item.id}_${Date.now()}`;
				this.db.prepare("INSERT INTO active_buffs (id, item_id, title, expires_at, effect_kind, effect_val, icon) VALUES (?, ?, ?, ?, ?, ?, ?)").run(buffId, item.id, item.title, newExpiresAt, item.effectKind, item.effectValue, item.icon);
			}
			return {
				buff: this.getActiveBuffs(now).find((b) => b.itemId === item.id),
				balance: nextBalance,
				message: `${item.icon} ${item.title} Activated! Active for ${item.durationHours} hours.`
			};
		})();
	}
	getEconomyConfig() {
		return {
			exchangeRate: this.getExchangeRate(),
			currency: this.getCurrency(),
			monthlyBudget: Number(getSetting(this.db, "reward_budget") ?? 0),
			bankBaseRate: Number(getSetting(this.db, "bank_base_rate") ?? .5),
			bankCapPerLevel: Number(getSetting(this.db, "bank_cap_per_level") ?? 250),
			consumablePrices: {
				focus_elixir: Number(getSetting(this.db, "price_focus_elixir") ?? 20),
				xp_booster: Number(getSetting(this.db, "price_xp_booster") ?? 25),
				streak_shield: Number(getSetting(this.db, "price_streak_shield") ?? 50),
				fatigue_neutralizer: Number(getSetting(this.db, "price_fatigue_neutralizer") ?? 15)
			}
		};
	}
	saveEconomyConfig(patch) {
		if (patch.exchangeRate !== void 0 && patch.exchangeRate > 0) this.setExchangeRate(patch.exchangeRate);
		if (patch.currency !== void 0 && patch.currency.trim()) this.setCurrency(patch.currency);
		if (patch.monthlyBudget !== void 0 && patch.monthlyBudget >= 0) setSetting(this.db, "reward_budget", String(patch.monthlyBudget));
		if (patch.bankBaseRate !== void 0 && patch.bankBaseRate > 0) setSetting(this.db, "bank_base_rate", String(patch.bankBaseRate));
		if (patch.bankCapPerLevel !== void 0 && patch.bankCapPerLevel > 0) setSetting(this.db, "bank_cap_per_level", String(patch.bankCapPerLevel));
		if (patch.consumablePrices) {
			for (const [k, v] of Object.entries(patch.consumablePrices)) if (typeof v === "number" && v > 0) setSetting(this.db, `price_${k}`, String(v));
		}
		return this.getEconomyConfig();
	}
	applyEconomyPreset(presetId) {
		const preset = ECONOMY_PRESETS[presetId];
		if (!preset) throw new LedgerError(`Unknown preset: "${presetId}"`);
		setSetting(this.db, "bank_base_rate", String(preset.bankBaseRate));
		setSetting(this.db, "bank_cap_per_level", String(preset.bankCapPerLevel));
		for (const [k, v] of Object.entries(preset.consumablePrices)) setSetting(this.db, `price_${k}`, String(v));
		const allRules = this.wallet.rules();
		for (const [ruleId, override] of Object.entries(preset.ruleOverrides)) {
			const existing = allRules.find((r) => r.id === ruleId);
			if (existing) this.wallet.saveRule({
				...existing,
				coins: override.coins,
				xp: override.xp,
				dailyCap: override.dailyCap ?? existing.dailyCap
			});
		}
		return this.getEconomyConfig();
	}
};
// src/core/quests.ts
var rule = (id) => (day) => day.filter((e) => e.ruleId === id).length;
var QUEST_POOL = [
	{
		id: "study2",
		title: "Finish 2 study blocks",
		goal: 2,
		count: rule("study.block_done")
	},
	{
		id: "wake",
		title: "Wake up on time",
		goal: 1,
		count: rule("sleep.up_on_time")
	},
	{
		id: "bed",
		title: "Be in bed on time",
		goal: 1,
		count: rule("sleep.bed_on_time")
	},
	{
		id: "money",
		title: "Log your spending",
		goal: 1,
		count: rule("money.logged")
	},
	{
		id: "tasks3",
		title: "Complete 3 tasks",
		goal: 3,
		count: (d) => d.filter((e) => e.ref?.startsWith("task:")).length
	},
	{
		id: "clean",
		title: "Check in clean",
		goal: 1,
		count: rule("discipline.clean_day")
	},
	{
		id: "workout",
		title: "Work out",
		goal: 1,
		count: rule("body.workout_done")
	},
	{
		id: "face",
		title: "Do your skincare",
		goal: 1,
		count: rule("face.routine_done")
	},
	{
		id: "earn60",
		title: "Earn 60 coins",
		goal: 60,
		count: (d) => d.reduce((s, e) => s + Math.max(0, e.coins), 0)
	}
];
var QUEST_BONUS = {
	coins: 30,
	xp: 50
};
function hash(s) {
	let h = 2166136261;
	for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return h >>> 0;
}
/** The day's three quests, always the same for the same day. */
function questsFor(day) {
	return QUEST_POOL.map((q) => ({
		q,
		k: hash(`${day}:${q.id}`)
	})).sort((a, b) => a.k - b.k).slice(0, 3).map((x) => x.q);
}
var questRef = (day) => `quest:${day}`;
function questState(day, entries) {
	const live = effective(entries);
	const today = live.filter((e) => e.day === day && !e.ref?.startsWith("quest:"));
	const quests = questsFor(day).map((q) => {
		const progress = Math.min(q.goal, q.count(today));
		return {
			id: q.id,
			title: q.title,
			goal: q.goal,
			progress,
			done: progress >= q.goal
		};
	});
	return {
		day,
		quests,
		allDone: quests.every((q) => q.done),
		claimed: live.some((e) => e.ref === questRef(day)),
		bonus: QUEST_BONUS
	};
}
// src/main/wallet.ts
var toEntry = (r) => ({
	id: r.id,
	ts: r.ts,
	day: r.day,
	module: r.module,
	kind: r.kind,
	coins: r.coins,
	xp: r.xp,
	ruleId: r.rule_id,
	ref: r.ref,
	note: r.note,
	undoOf: r.undo_of
});
var toRule = (r) => ({
	id: r.id,
	module: r.module,
	title: r.title,
	coins: r.coins,
	xp: r.xp,
	dailyCap: r.daily_cap,
	cooldownMin: r.cooldown_min,
	enabled: !!r.enabled
});
/** Database side of the wallet; all decisions are made by the pure core. */
var Wallet = class {
	db;
	timeZone;
	constructor(db, timeZone) {
		this.db = db;
		this.timeZone = timeZone;
	}
	entries() {
		return this.db.prepare("SELECT * FROM ledger ORDER BY id").all().map(toEntry);
	}
	/** Appends a row the core already validated. Call inside a transaction. */
	append(e) {
		const res = this.db.prepare(`INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note, undo_of)
         VALUES (@ts, @day, @module, @kind, @coins, @xp, @ruleId, @ref, @note, @undoOf)`).run({
			ruleId: null,
			ref: null,
			note: null,
			undoOf: null,
			...e
		});
		return Number(res.lastInsertRowid);
	}
	getStatAllocation() {
		try {
			const row = this.db.prepare("SELECT value FROM settings WHERE key = 'hunter.stat_allocation'").get();
			if (!row?.value) return {
				str: 0,
				agi: 0,
				vit: 0,
				int: 0,
				sen: 0
			};
			const parsed = JSON.parse(row.value);
			return {
				str: Math.max(0, Math.floor(Number(parsed.str) || 0)),
				agi: Math.max(0, Math.floor(Number(parsed.agi) || 0)),
				vit: Math.max(0, Math.floor(Number(parsed.vit) || 0)),
				int: Math.max(0, Math.floor(Number(parsed.int) || 0)),
				sen: Math.max(0, Math.floor(Number(parsed.sen) || 0))
			};
		} catch {
			return {
				str: 0,
				agi: 0,
				vit: 0,
				int: 0,
				sen: 0
			};
		}
	}
	saveStatAllocation(alloc) {
		this.db.prepare(`INSERT INTO settings (key, value) VALUES ('hunter.stat_allocation', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(alloc));
	}
	allocateStats(stat, points = 1) {
		if (points <= 0) return this.summary();
		if (this.summary().level.attributes.unallocatedPoints < points) throw new LedgerError("Not enough unallocated stat points available");
		const alloc = this.getStatAllocation();
		alloc[stat] = (alloc[stat] ?? 0) + points;
		this.saveStatAllocation(alloc);
		return this.summary();
	}
	resetStatAllocation() {
		this.saveStatAllocation({
			str: 0,
			agi: 0,
			vit: 0,
			int: 0,
			sen: 0
		});
		return this.summary();
	}
	summary(now = /* @__PURE__ */ new Date()) {
		const today = dayKey(now, this.timeZone);
		const totals = this.db.prepare(`
      SELECT 
        COALESCE(SUM(coins), 0) AS balance,
        COALESCE(SUM(CASE WHEN xp > 0 THEN xp ELSE 0 END), 0) AS total_xp
      FROM ledger
      WHERE kind != 'undo'
        AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
    `).get() ?? {
			balance: 0,
			total_xp: 0
		};
		const todayRows = this.db.prepare(`
      SELECT * FROM ledger
      WHERE day = ?
        AND kind != 'undo'
        AND id NOT IN (SELECT undo_of FROM ledger WHERE kind = 'undo' AND undo_of IS NOT NULL)
      ORDER BY id ASC
    `).all(today).map(toEntry);
		const recentRows = this.db.prepare(`
      SELECT * FROM ledger ORDER BY id DESC LIMIT 12
    `).all().map(toEntry);
		const xp = totals.total_xp;
		const allocated = this.getStatAllocation();
		let hunterStats = { allocated };
		try {
			hunterStats = {
				workoutCount: this.db.prepare("SELECT COUNT(*) as c FROM workouts").get()?.c ?? 0,
				cleanStreakDays: this.db.prepare("SELECT COUNT(*) as c FROM discipline_events WHERE kind = 'checkin'").get()?.c ?? 0,
				focusBlocksCount: this.db.prepare("SELECT COUNT(*) as c FROM block_log WHERE status = 'done'").get()?.c ?? 0,
				onTimeWakeups: this.db.prepare("SELECT COUNT(*) as c FROM sleep_logs WHERE on_time = 1").get()?.c ?? 0,
				budgetDays: this.db.prepare("SELECT COUNT(*) as c FROM reward_vault_ledger WHERE kind = 'surplus_credit'").get()?.c ?? 0,
				allocated
			};
		} catch {}
		return {
			balance: totals.balance,
			totalXp: xp,
			level: levelInfo(xp, hunterStats),
			today,
			todayCoins: todayRows.reduce((s, e) => s + e.coins, 0),
			todayXp: todayRows.reduce((s, e) => s + e.xp, 0),
			todayRules: [...new Set(todayRows.map((e) => e.ruleId).filter(Boolean))],
			recent: recentRows
		};
	}
	history(limit = 100) {
		return this.db.prepare("SELECT * FROM ledger ORDER BY id DESC LIMIT ?").all(limit).map(toEntry);
	}
	rules() {
		return this.db.prepare("SELECT * FROM rules ORDER BY sort, id").all().map(toRule);
	}
	rule(id) {
		const row = this.db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
		if (!row) throw new LedgerError(`Unknown rule ${id}`);
		return toRule(row);
	}
	saveRule(rule) {
		if (!rule.id.trim() || !rule.title.trim()) throw new LedgerError("A rule needs an id and a title");
		for (const n of [
			rule.coins,
			rule.xp,
			rule.dailyCap,
			rule.cooldownMin
		]) if (!Number.isInteger(n)) throw new LedgerError("Numbers must be whole numbers");
		if (rule.xp < 0 || rule.dailyCap < 0 || rule.cooldownMin < 0) throw new LedgerError("XP, cap and cooldown cannot be negative");
		this.db.prepare(`INSERT INTO rules (id, module, title, coins, xp, daily_cap, cooldown_min, enabled, sort)
         VALUES (@id, @module, @title, @coins, @xp, @dailyCap, @cooldownMin, @enabled,
                 COALESCE((SELECT sort FROM rules WHERE id = @id), (SELECT COALESCE(MAX(sort), 0) + 1 FROM rules)))
         ON CONFLICT(id) DO UPDATE SET module = excluded.module, title = excluded.title, coins = excluded.coins,
           xp = excluded.xp, daily_cap = excluded.daily_cap, cooldown_min = excluded.cooldown_min, enabled = excluded.enabled`).run({
			...rule,
			enabled: rule.enabled ? 1 : 0
		});
	}
	award(ruleId, note, now = /* @__PURE__ */ new Date()) {
		return this.awardRule(ruleId, {
			note,
			now
		});
	}
	/** Awards a rule; `day` books it on another day (e.g. a missed block from yesterday). */
	awardRule(ruleId, opts = {}) {
		const now = opts.now ?? /* @__PURE__ */ new Date();
		return this.db.transaction(() => {
			const row = planAward(this.rule(ruleId), this.entries(), now, opts.day ?? dayKey(now, this.timeZone), opts.note);
			return this.append({
				...row,
				ref: opts.ref ?? null
			});
		}).immediate();
	}
	quests(now = /* @__PURE__ */ new Date()) {
		return questState(this.today(now), this.entries());
	}
	/** Pays the daily quest bonus once all three are done. */
	claimQuests(now = /* @__PURE__ */ new Date()) {
		return this.db.transaction(() => {
			const q = this.quests(now);
			if (!q.allDone) throw new LedgerError("Finish all three quests first");
			if (q.claimed) throw new LedgerError("Already claimed today");
			return this.append({
				ts: now.toISOString(),
				day: q.day,
				module: "quests",
				kind: "earn",
				coins: q.bonus.coins,
				xp: q.bonus.xp,
				ref: questRef(q.day),
				note: "Daily quests complete"
			});
		}).immediate();
	}
	today(now = /* @__PURE__ */ new Date()) {
		return dayKey(now, this.timeZone);
	}
	undo(id, note, now = /* @__PURE__ */ new Date()) {
		return this.db.transaction(() => {
			const row = planUndo(this.entries(), id, note, now.toISOString(), dayKey(now, this.timeZone));
			return this.append(row);
		}).immediate();
	}
};
// src/renderer/src/web/webServices.ts
/** All services, built for one copy of the database. */
function servicesFor(db) {
	const d = db;
	const wallet = new Wallet(d);
	const shields = new ShieldService(d, wallet);
	const discipline = new Discipline(d, wallet);
	const money = new MoneyService(d, wallet);
	const body = new Body(d, wallet);
	return {
		db: d,
		wallet,
		shields,
		discipline,
		money,
		body,
		shop: new Shop(d, wallet),
		tasks: new Tasks(d, wallet, shields),
		schedule: new Schedule(d, wallet),
		sleep: new SleepService(d, wallet),
		focus: new FocusService(d, wallet),
		progress: new ProgressService(d, wallet),
		weekPlan: new WeekPlanService(d, wallet),
		economy: new UnifiedEconomyService(d, wallet, discipline, money, shields),
		exporter: new DataExportService(d, body, money)
	};
}
var notify = (...names) => {
	if (typeof window === "undefined") return;
	for (const n of names) window.dispatchEvent(new CustomEvent(n));
};
/** The LifeApi namespaces the services cover, like src/main/index.ts maps them. */
function createWebServices(mirror) {
	mirror.write((db) => (applyPointsV2(db), applyPointsV3(db))).catch(() => {});
	const read = (fn) => mirror.read((db) => fn(servicesFor(db)));
	const write = (fn, ...events) => mirror.write((db) => fn(servicesFor(db))).then((r) => {
		notify(...events);
		return r;
	});
	const W = "life-wallet-changed";
	const D = "life-discipline-changed";
	const B = "life-body-changed";
	return {
		read,
		write,
		services: servicesFor,
		wallet: {
			summary: () => read((s) => s.wallet.summary()),
			history: (limit) => read((s) => s.wallet.history(limit)),
			award: (ruleId, note) => write((s) => {
				if (isFlowRule(ruleId)) throw new LedgerError("This one is logged from its own section");
				s.wallet.award(ruleId, note);
				return s.wallet.summary();
			}, W),
			undo: (id, note) => write((s) => {
				s.wallet.undo(id, note);
				return s.wallet.summary();
			}, W),
			quests: () => read((s) => s.wallet.quests()),
			claimQuests: () => write((s) => {
				s.wallet.claimQuests();
				return s.wallet.summary();
			}, W),
			allocateStats: (stat, points) => write((s) => s.wallet.allocateStats(stat, points), W),
			resetStats: () => write((s) => s.wallet.resetStatAllocation(), W)
		},
		connections: { 
		/**
		* Pays "Spending logged" for each day Finance Helper (on this device) has
		* a record, like the desktop's connection sync: from the day it was
		* first connected, the last 31 days at most, each day once (same refs
		* as the desktop, so the PC and the web never both pay a day).
		*/
syncFinance: (recordDays) => write((s) => {
			const db = s.db;
			const today = s.wallet.today();
			let since = getSetting(db, "conn_finance_since");
			if (!since) setSetting(db, "conn_finance_since", since = today);
			const from = since < addDays$1(today, -31) ? addDays$1(today, -31) : since;
			const handled = new Set(s.wallet.entries().map((e) => e.ref ?? "").filter(Boolean));
			let paid = 0;
			for (const d of new Set(recordDays)) {
				if (d < from || d > today || handled.has(`fin:logged:${d}`)) continue;
				try {
					s.wallet.awardRule("money.logged", {
						day: d,
						ref: `fin:logged:${d}`,
						note: "Spending logged (Finance Helper)"
					});
					paid++;
				} catch (e) {
					if (!(e instanceof LedgerError)) throw e;
				}
			}
			return paid;
		}, W) },
		rules: {
			list: () => read((s) => s.wallet.rules()),
			save: (rule) => write((s) => {
				s.wallet.saveRule(rule);
				return s.wallet.rules();
			})
		},
		shop: {
			state: () => read((s) => s.shop.state()),
			save: (r) => write((s) => (s.shop.save(r), s.shop.state())),
			archive: (id) => write((s) => (s.shop.archive(id), s.shop.state())),
			redeem: (id) => write((s) => (s.shop.redeem(id), s.shop.state()), W),
			openChest: (level) => write((s) => ({
				coins: s.shop.openChest(level),
				state: s.shop.state()
			}), W),
			setBudget: (amount) => write((s) => (s.shop.setBudget(amount), s.shop.state())),
			setCurrency: (cur) => write((s) => (s.shop.setCurrency(cur), s.shop.state()))
		},
		tasks: {
			state: () => read((s) => s.tasks.state()),
			save: (t) => write((s) => (s.tasks.save(t), s.tasks.state())),
			archive: (id) => write((s) => (s.tasks.archive(id), s.tasks.state())),
			complete: (id) => write((s) => (s.tasks.complete(id), s.tasks.state()), W),
			uncomplete: (id) => write((s) => (s.tasks.uncomplete(id), s.tasks.state()), W),
			saveCategory: (c) => write((s) => (s.tasks.saveCategory(c), s.tasks.state())),
			archiveCategory: (id) => write((s) => (s.tasks.archiveCategory(id), s.tasks.state()))
		},
		schedule: {
			state: (day) => read((s) => s.schedule.state(day)),
			save: (b) => write((s) => (s.schedule.save(b), s.schedule.state())),
			archive: (id) => write((s) => (s.schedule.archive(id), s.schedule.state())),
			start: (id) => write((s) => (s.schedule.start(id), s.schedule.state())),
			finish: (id) => write((s) => (s.schedule.finish(id), s.schedule.state()), W),
			skip: (id) => write((s) => (s.schedule.skip(id), s.schedule.state()), W)
		},
		discipline: {
			state: () => read((s) => s.discipline.state()),
			setStart: (day) => write((s) => (s.discipline.setStart(day), s.discipline.state()), D),
			checkIn: () => write((s) => (s.discipline.checkIn(), s.discipline.state()), W, D),
			oath: () => write((s) => (s.discipline.oath(), s.discipline.state()), W, D),
			reset: () => write((s) => (s.discipline.reset(), s.discipline.state()), W, D),
			startUrge: () => write((s) => (s.discipline.startUrge(), s.discipline.state()), W, D),
			finishUrge: () => write((s) => (s.discipline.finishUrge(), s.discipline.state()), W, D),
			cancelUrge: () => write((s) => (s.discipline.cancelUrge(), s.discipline.state()), W, D),
			claim: (days) => write((s) => ({
				coins: s.discipline.claim(days),
				state: s.discipline.state()
			}), W, D),
			setStealth: (on) => write((s) => (s.discipline.setStealth(on), s.discipline.state()))
		},
		body: {
			state: () => read((s) => s.body.state()),
			logWorkout: (input) => write((s) => s.body.logWorkout(input), W, B),
			deleteWorkout: (id) => write((s) => s.body.deleteWorkout(id), W, B),
			logMetric: (input) => write((s) => s.body.logMetric(input), W, B),
			saveExercise: (ex) => write((s) => (s.body.saveExercise(ex), s.body.state()), B)
		},
		focus: {
			state: () => read((s) => s.focus.state()),
			start: (subject, planned, task) => write((s) => s.focus.start(subject, planned, /* @__PURE__ */ new Date(), task ?? null)),
			stop: () => write((s) => s.focus.stop(), W),
			cancel: () => write((s) => s.focus.cancel()),
			add: (subject, minutes, day) => write((s) => s.focus.add(subject, minutes, day), W),
			setPlan: (items) => write((s) => s.focus.setPlan(items)),
			togglePlan: (index) => write((s) => s.focus.togglePlan(index), W),
			review: (text, reasons) => write((s) => s.focus.review(text, reasons)),
			saveGoal: (g) => write((s) => s.focus.saveGoal(g)),
			archiveGoal: (id) => write((s) => s.focus.archiveGoal(id)),
			fun: (minutes, what) => write((s) => s.focus.fun(minutes, what), W)
		},
		progress: {
			report: (spending) => read((s) => s.progress.report(spending)),
			insights: () => read((s) => s.progress.insights()),
			growth: (spending) => read((s) => s.progress.growth(spending))
		},
		weekPlan: {
			saved: () => read((s) => s.weekPlan.saved()),
			save: (p) => write((s) => s.weekPlan.save(p), "life-week-changed"),
			toggle: (i) => write((s) => s.weekPlan.toggle(i), "life-week-changed")
		},
		sleep: {
			state: () => read((s) => s.sleep.state()),
			logWake: (time, quality) => write((s) => s.sleep.logWake(time, quality), W),
			logBed: (time) => write((s) => s.sleep.logBed(time), W),
			setWake: (day, time) => write((s) => s.sleep.setWake(day, time), W),
			setTargets: (weekday, weekend, bedtime) => write((s) => s.sleep.setTargets(weekday, weekend, bedtime))
		},
		money: {
			state: () => read((s) => s.money.state()),
			addExpense: (amountBani, category, note) => write((s) => s.money.addExpense(amountBani, category, note), W),
			deleteExpense: (id) => write((s) => s.money.deleteExpense(id)),
			setBudget: (budgetBani) => write((s) => s.money.setBudget(budgetBani)),
			setCurrency: (cur) => write((s) => s.money.setCurrency(cur))
		},
		shields: {
			count: () => read((s) => s.shields.count()),
			buy: () => write((s) => s.shields.buy(), W)
		},
		exporter: {
			exportCsv: (kind) => read((s) => s.exporter.exportCsv(kind)),
			exportJson: () => read((s) => s.exporter.exportJson())
		},
		economy: {
			summary: () => read((s) => s.economy.getEconomySummary()),
			goals: () => read((s) => s.economy.goals()),
			saveGoal: (g) => write((s) => s.economy.saveGoal(g)),
			deleteGoal: (id) => write((s) => s.economy.deleteGoal(id)),
			pinGoal: (id) => write((s) => s.economy.pinGoal(id)),
			depositCoins: (goalId, amount) => write((s) => s.economy.depositCoinsToGoal(goalId, amount), W),
			depositVault: (goalId, amount) => write((s) => s.economy.depositVaultCashToGoal(goalId, amount)),
			claimGoal: (goalId) => write((s) => s.economy.claimGoal(goalId)),
			creditVault: (amount, note) => write((s) => s.economy.creditVault("manual_deposit", amount, note)),
			setExchangeRate: (rate) => write((s) => (s.economy.setExchangeRate(rate), s.economy.getExchangeRate())),
			setCurrency: (cur) => write((s) => (s.economy.setCurrency(cur), s.economy.getEconomySummary())),
			openChest: (level) => write((s) => s.economy.openEnhancedChest(level), W),
			bankState: () => read((s) => s.economy.getBankState()),
			stakeCoins: (amount) => write((s) => s.economy.stakeCoins(amount), W),
			withdrawCoins: (amount) => write((s) => s.economy.withdrawCoins(amount), W),
			claimInterest: () => write((s) => s.economy.claimInterest(), W),
			activeBuffs: () => read((s) => s.economy.getActiveBuffs()),
			buyConsumable: (itemId) => write((s) => s.economy.buyConsumable(itemId), W),
			getConfig: () => read((s) => s.economy.getEconomyConfig()),
			saveConfig: (patch) => write((s) => s.economy.saveEconomyConfig(patch), W),
			applyPreset: (preset) => write((s) => s.economy.applyEconomyPreset(preset), W)
		}
	};
}
// src/core/botCommands.ts
function parseAmountAndUnit(str, defaultUnit = "reps") {
	if (!str) return {
		amount: 1,
		unit: defaultUnit
	};
	const match = str.match(/^([\d.]+)\s*([a-zA-Z]*)$/);
	if (match) {
		const amount = parseFloat(match[1]) || 1;
		let unit = (match[2] || defaultUnit).toLowerCase();
		if (unit === "k" || unit === "km" || unit === "kms") unit = "km";
		else if (unit === "m" || unit === "min" || unit === "mins" || unit === "minute" || unit === "minutes") unit = "minutes";
		else if (unit === "sec" || unit === "secs" || unit === "s") unit = "seconds";
		else if (unit === "kg" || unit === "kgs") unit = "kg";
		else if (unit === "r" || unit === "rep" || unit === "reps") unit = "reps";
		return {
			amount,
			unit
		};
	}
	const fallback = parseFloat(str);
	return {
		amount: isNaN(fallback) ? 1 : fallback,
		unit: defaultUnit
	};
}
function detectExpenseCategory(text) {
	const t = text.toLowerCase();
	if (/\b(coffee|cafe|cafea|cappuccino|tea|ceai|lunch|pranz|dinner|cina|breakfast|dejun|groceries|alimente|market|magazin|lidl|kaufland|linella|supermarket|food|mancare|mcdonalds|kfc|pizza|burger|shawarma|kebab|restaurant|bar|bere|beer|snack|water|apa)\b/i.test(t)) return "food";
	if (/\b(taxi|cab|uber|bolt|yandex|bus|troleibuz|autobuz|gas|benzina|fuel|motorina|car|auto|parking|parcare|metro|train|tren|transit|transport)\b/i.test(t)) return "transport";
	if (/\b(rent|chirie|bills|facturi|utilitati|gaz|lumina|electricitate|net|internet|wifi|moldtelecom|orange|clean|cleaning|intretinere|home|casa)\b/i.test(t)) return "home";
	if (/\b(gym|sala|fitness|workout|protein|proteina|creatine|sport|echipament|antrenament)\b/i.test(t)) return "sport";
	if (/\b(farmacie|pharmacy|pastile|medic|doctor|dentist|stomatolog|medicina|vitamine|spital|clinic|health|sanatate)\b/i.test(t)) return "health";
	if (/\b(movie|cinema|cineplex|game|steam|netflix|party|concert|club|fun|joc|distractie)\b/i.test(t)) return "fun";
	if (/\b(haine|clothes|shoes|pantofi|adibas|adadasi|mall|zara|bershka|shopping)\b/i.test(t)) return "clothes";
	if (/\b(salary|salariu|freelance|venit|bonus|profit|dividend|cash|income)\b/i.test(t)) return "income";
	return "other";
}
function tryParseNaturalExpense(text) {
	const trimmed = text.trim();
	if (!trimmed || trimmed.startsWith("/")) return null;
	const amountFirstMatch = trimmed.match(/^([+-]?\s*\d+(?:[.,]\d+)?)\s*(?:mdl|lei|\$|€)?\s+(.+)$/i);
	if (amountFirstMatch) {
		const rawAmt = amountFirstMatch[1].replace(/\s+/g, "").replace(",", ".");
		const amt = parseFloat(rawAmt);
		const note = amountFirstMatch[2].replace(/\b(lei|mdl|\$|€)\b/gi, "").trim();
		if (!isNaN(amt) && amt > 0 && note.length > 0) {
			const cat = rawAmt.startsWith("+") ? "income" : detectExpenseCategory(note);
			return {
				type: "expense",
				args: [
					String(amt),
					cat,
					note
				],
				raw: trimmed,
				expenseAmount: amt,
				expenseCategory: cat,
				expenseNote: note
			};
		}
	}
	const noteFirstMatch = trimmed.match(/^(.+?)\s+([+-]?\s*\d+(?:[.,]\d+)?)\s*(?:mdl|lei|\$|€)?$/i);
	if (noteFirstMatch) {
		const note = noteFirstMatch[1].replace(/\b(lei|mdl|\$|€)\b/gi, "").trim();
		const rawAmt = noteFirstMatch[2].replace(/\s+/g, "").replace(",", ".");
		const amt = parseFloat(rawAmt);
		if (!isNaN(amt) && amt > 0 && note.length > 0) {
			const cat = rawAmt.startsWith("+") ? "income" : detectExpenseCategory(note);
			return {
				type: "expense",
				args: [
					String(amt),
					cat,
					note
				],
				raw: trimmed,
				expenseAmount: amt,
				expenseCategory: cat,
				expenseNote: note
			};
		}
	}
	return null;
}
function parseTelegramText(text) {
	const trimmed = (text || "").trim();
	if (!trimmed) return {
		type: "unknown",
		args: [],
		raw: ""
	};
	const parts = trimmed.split(/\s+/);
	let cmd = parts[0].toLowerCase();
	if (cmd.startsWith("/")) cmd = cmd.slice(1);
	if (cmd.includes("@")) cmd = cmd.split("@")[0];
	const args = parts.slice(1);
	const exerciseShortcuts = {
		pushups: "pushups",
		pushup: "pushups",
		push_ups: "pushups",
		push_up: "pushups",
		flotari: "pushups",
		situps: "situps",
		situp: "situps",
		sit_ups: "situps",
		sit_up: "situps",
		abdomene: "situps",
		press: "press",
		shoulderpress: "press",
		benchpress: "press",
		bench_press: "press",
		pullups: "pullups",
		pullup: "pullups",
		pull_ups: "pullups",
		tractiuni: "pullups",
		squats: "squats",
		squat: "squats",
		genuflexiuni: "squats",
		dips: "dips",
		dip: "dips",
		plank: "plank"
	};
	if (exerciseShortcuts[cmd]) {
		const amount = parseInt(args[0], 10) || 20;
		return {
			type: "workout",
			args,
			raw: trimmed,
			exerciseName: exerciseShortcuts[cmd],
			exerciseAmount: amount,
			exerciseUnit: "reps"
		};
	}
	if (/^\d+$/.test(cmd) && args.length > 0) {
		const exCandidate = args[0].toLowerCase().replace(/[^a-z_]/g, "");
		if (exerciseShortcuts[exCandidate]) {
			const amount = parseInt(cmd, 10);
			return {
				type: "workout",
				args: [cmd],
				raw: trimmed,
				exerciseName: exerciseShortcuts[exCandidate],
				exerciseAmount: amount,
				exerciseUnit: "reps"
			};
		}
	}
	const sportDirectShortcuts = {
		run: {
			name: "Running",
			defaultUnit: "km"
		},
		running: {
			name: "Running",
			defaultUnit: "km"
		},
		football: {
			name: "Football",
			defaultUnit: "minutes"
		},
		soccer: {
			name: "Football",
			defaultUnit: "minutes"
		},
		boxing: {
			name: "Boxing",
			defaultUnit: "minutes"
		},
		combat: {
			name: "Combat Sports",
			defaultUnit: "minutes"
		},
		gym: {
			name: "Gym Session",
			defaultUnit: "minutes"
		},
		swim: {
			name: "Swimming",
			defaultUnit: "m"
		},
		swimming: {
			name: "Swimming",
			defaultUnit: "m"
		},
		cycling: {
			name: "Cycling",
			defaultUnit: "km"
		},
		bike: {
			name: "Cycling",
			defaultUnit: "km"
		},
		bench: {
			name: "Bench Press",
			defaultUnit: "kg"
		}
	};
	if (sportDirectShortcuts[cmd]) {
		const spec = sportDirectShortcuts[cmd];
		const parsed = parseAmountAndUnit(args[0], spec.defaultUnit);
		return {
			type: "sport",
			args,
			raw: trimmed,
			exerciseName: spec.name,
			exerciseAmount: parsed.amount,
			exerciseUnit: parsed.unit
		};
	}
	if (cmd === "weight") return {
		type: "weight",
		args,
		raw: trimmed,
		metricWeight: parseAmountAndUnit(args[0], "kg").amount
	};
	if (cmd === "waist") return {
		type: "waist",
		args,
		raw: trimmed,
		metricWaist: parseAmountAndUnit(args[0], "cm").amount
	};
	if (cmd === "pr" || cmd === "record") {
		if (args.length === 0) return {
			type: "pr",
			args,
			raw: trimmed
		};
		return {
			type: "pr",
			args,
			raw: trimmed,
			prExercise: args[0],
			prValue: args.slice(1).join(" ")
		};
	}
	if (cmd === "sport" || cmd === "sports" || cmd === "athlete") {
		if (args.length === 0 || args[0].toLowerCase() === "status" || args[0].toLowerCase() === "stats") return {
			type: "sport_status",
			args,
			raw: trimmed
		};
		const act = args[0].toLowerCase();
		let exName = args[0].charAt(0).toUpperCase() + args[0].slice(1);
		let defUnit = "minutes";
		if (act.includes("run")) {
			exName = "Running";
			defUnit = "km";
		} else if (act.includes("foot") || act.includes("soccer")) {
			exName = "Football";
			defUnit = "minutes";
		} else if (act.includes("box")) {
			exName = "Boxing";
			defUnit = "minutes";
		} else if (act.includes("swim")) {
			exName = "Swimming";
			defUnit = "m";
		} else if (act.includes("cycl") || act.includes("bike")) {
			exName = "Cycling";
			defUnit = "km";
		} else if (act.includes("push") || act.includes("pull") || act.includes("squat")) defUnit = "reps";
		else if (act.includes("bench") || act.includes("deadlift")) defUnit = "kg";
		const parsed = parseAmountAndUnit(args[1], defUnit);
		return {
			type: "sport",
			args,
			raw: trimmed,
			exerciseName: exName,
			exerciseAmount: parsed.amount,
			exerciseUnit: parsed.unit
		};
	}
	if (cmd === "start" || cmd === "help" || cmd === "commands") return {
		type: "help",
		args,
		raw: trimmed
	};
	if (cmd === "vault" || cmd === "economy") return {
		type: "vault",
		args,
		raw: trimmed
	};
	if (cmd === "goals" || cmd === "wishlist") return {
		type: "goals",
		args,
		raw: trimmed
	};
	if (cmd === "today" || cmd === "status" || cmd === "stat") return {
		type: "today",
		args,
		raw: trimmed
	};
	if (cmd === "checkin" || cmd === "clean") return {
		type: "checkin",
		args,
		raw: trimmed
	};
	if (cmd === "oath") return {
		type: "oath",
		args,
		raw: trimmed
	};
	if (cmd === "workout" || cmd === "train") {
		let amount = 20;
		let ex = "pushups";
		if (args.length >= 2) {
			if (/^\d+$/.test(args[0])) {
				amount = parseInt(args[0], 10);
				ex = args[1].toLowerCase();
			} else {
				ex = args[0].toLowerCase();
				amount = parseInt(args[1], 10) || 20;
			}
		} else if (args.length === 1) {
			if (/^\d+$/.test(args[0])) amount = parseInt(args[0], 10);
			else ex = args[0].toLowerCase();
		}
		return {
			type: "workout",
			args,
			raw: trimmed,
			exerciseName: ex,
			exerciseAmount: amount,
			exerciseUnit: "reps"
		};
	}
	if (cmd === "expense" || cmd === "buy" || cmd === "spent" || cmd === "pay") {
		let amount = 0;
		let cat = "food";
		let note = "";
		if (args.length > 0) {
			amount = parseFloat(args[0]) || 0;
			if (args.length > 1) {
				cat = args[1].toLowerCase();
				note = args.slice(2).join(" ");
			}
		}
		return {
			type: "expense",
			args,
			raw: trimmed,
			expenseAmount: amount,
			expenseCategory: cat,
			expenseNote: note || void 0
		};
	}
	if (cmd === "tasks" || cmd === "todo") return {
		type: "tasks",
		args,
		raw: trimmed
	};
	if (cmd === "done" || cmd === "tick" || cmd === "complete") return {
		type: "done",
		args,
		raw: trimmed,
		taskIndex: parseInt(args[0], 10) || 1
	};
	if (cmd === "wake" || cmd === "up") return {
		type: "wake",
		args,
		raw: trimmed
	};
	if (cmd === "bed" || cmd === "sleep") return {
		type: "bed",
		args,
		raw: trimmed
	};
	if (cmd === "crush" || cmd === "panic" || cmd === "urge") return {
		type: "crush",
		args,
		raw: trimmed
	};
	if (cmd === "balance" || cmd === "accounts" || cmd === "money") return {
		type: "balance",
		args,
		raw: trimmed
	};
	const naturalExp = tryParseNaturalExpense(trimmed);
	if (naturalExp) return naturalExp;
	return {
		type: "unknown",
		args,
		raw: trimmed
	};
}
function formatHelpMessage() {
	return [
		`⚡ <b>Life System — Telegram Command Center</b> ⚡`,
		``,
		`One bot for everything: Sport, Money (Finance Helper), Discipline (MAN), Sleep (Waky), Tasks and your wallet.`,
		``,
		`📊 <b>Dashboard & Status</b>`,
		`• <code>/today</code> — Your day: points, streaks and what's left`,
		`• <code>/vault</code> — Real-money Reward Vault surplus, coin valuation & multiplier`,
		`• <code>/goals</code> — Wishlist Mega Goals & savings progress`,
		`• <code>/tasks</code> — View open tasks for today`,
		`• <code>/done &lt;num&gt;</code> — Complete a task (e.g. <code>/done 1</code>)`,
		``,
		`⚡ <b>Sport & Athletic Tracking</b>`,
		`• <code>/sport &lt;activity&gt; &lt;amount&gt;</code> — e.g. <code>/sport run 5km</code> (+15 🪙)`,
		`• <code>/run &lt;km&gt;</code> — e.g. <code>/run 5km</code>`,
		`• <code>/football &lt;min&gt;</code> — e.g. <code>/football 90m</code>`,
		`• <code>/boxing &lt;min&gt;</code> — e.g. <code>/boxing 45m</code>`,
		`• <code>/gym &lt;min&gt;</code> — e.g. <code>/gym 60m</code>`,
		`• <code>/bench &lt;kg&gt;</code> — e.g. <code>/bench 80kg</code>`,
		`• <code>/weight &lt;kg&gt;</code> — e.g. <code>/weight 74.5</code> (+5 🪙)`,
		`• <code>/waist &lt;cm&gt;</code> — e.g. <code>/waist 82</code> (+5 🪙)`,
		`• <code>/sport status</code> — Your training stats & records`,
		``,
		`💪 <b>Quick Body Exercises</b>`,
		`• <code>/pushups &lt;reps&gt;</code> — Quick log push-ups`,
		`• <code>/pullups &lt;reps&gt;</code> — Quick log pull-ups`,
		`• <code>/squats &lt;reps&gt;</code> — Quick log squats`,
		`• <code>/workout &lt;reps&gt; &lt;exercise&gt;</code> — e.g. <code>/workout 50 pushups</code> (+10 🪙)`,
		``,
		`🛡️ <b>Discipline & Standard</b>`,
		`• <code>/checkin</code> — Log daily clean check-in (+20 🪙)`,
		`• <code>/oath</code> — Take morning oath (+3 🪙)`,
		`• <code>/panic</code> — Instant urge crusher emergency protocol`,
		``,
		`💳 <b>Money & Expenses</b>`,
		`• <code>coffee 35</code> or <code>taxi 50</code> — Fast natural expense logging`,
		`• <code>/balance</code> — View accounts, coins & vault balances`,
		`• <code>/expense &lt;amount&gt; &lt;category&gt; [note]</code>`,
		`  e.g. <code>/expense 45 food lunch</code> (+3 🪙)`,
		``,
		`🌙 <b>Sleep & Wake</b>`,
		`• <code>/wake</code> — Log on-time morning check-in (+10 🪙)`,
		`• <code>/bed</code> — Log bedtime check-in (+5 🪙)`
	].join("\n");
}
function formatTodayStatus(data) {
	return [
		`👑 <b>Life System Status</b>`,
		``,
		`🪙 <b>Balance:</b> ${data.balance} coins`,
		`🔥 <b>Clean Streak:</b> ${data.cleanStreak} days`,
		`💪 <b>Workout Streak:</b> ${data.workoutStreak} days`,
		`⚡ <b>Daily Rituals:</b> ${data.ritualsDone}/${data.totalRituals} completed today`,
		`📋 <b>Tasks Remaining:</b> ${data.tasksLeft} open tasks`,
		``,
		data.ritualsDone === data.totalRituals ? `🏆 <i>All daily rituals complete! Supreme focus today.</i>` : `<i>Use /checkin, /sport or /expense to log today wins.</i>`
	].join("\n");
}
function formatWorkoutResponse(exName, amount, streak, coins) {
	return [
		`💪 <b>Workout Recorded!</b>`,
		``,
		`• <b>Exercise:</b> ${amount} ${exName}`,
		`• <b>Reward:</b> +${coins} points`,
		`• <b>Workout Streak:</b> ${streak} days in a row!`,
		``,
		`<i>The iron never lies. Keep pushing forward!</i>`
	].join("\n");
}
function formatSportResponse(activity, amount, unit, streak, coins, xp) {
	return [
		`🏃 <b>Workout logged</b>`,
		``,
		`• <b>Sport / Activity:</b> ${activity} (${amount} ${unit})`,
		`• <b>Attribute Gains:</b> +2 STR · +2 VIT · +1 AGI`,
		`• <b>Points:</b> +${coins}`,
		`• <b>Continuous Streak:</b> ${streak} days active!`,
		``,
		`<i>"Your physical combat power ascends. The System acknowledges your relentless dedication!"</i>`
	].join("\n");
}
function formatMetricResponse(type, val, unit, coins, xp) {
	return [
		`⚖️ <b>BODY COMPOSITION LOGGED</b> ⚖️`,
		``,
		`• <b>${type === "weight" ? "Body Weight" : "Waist Circumference"}:</b> ${val} ${unit}`,
		`• <b>Points:</b> +${coins}`,
		`• <b>Ledger:</b> Saved to physical metrics archive.`,
		``,
		`<i>"Consistency in tracking breeds absolute control over physical form."</i>`
	].join("\n");
}
function formatSportStatusResponse(data) {
	return [
		`🏋️ <b>Training</b>`,
		``,
		`🔥 <b>Workout Streak:</b> ${data.streak} Days Continuous`,
		`🏋️ <b>Sessions Logged:</b> ${data.totalWorkouts} total (${data.thisWeek} this week)`,
		`⚖️ <b>Current Weight:</b> ${data.latestWeight ? `${data.latestWeight} kg` : "Not recorded"}`,
		`📏 <b>Current Waist:</b> ${data.latestWaist ? `${data.latestWaist} cm` : "Not recorded"}`,
		``,
		`<i>Tip: Send <code>/sport run 5km</code>, <code>/bench 80kg</code>, <code>/boxing 45m</code> or <code>/weight 75</code> to log directly!</i>`
	].join("\n");
}
function formatExpenseResponse(amountFormatted, category, note, remainingBudget, coinsAwarded, financeSyncInfo) {
	const parts = [
		`💳 <b>Expense Recorded${financeSyncInfo?.synced ? " & Synced to Finance Helper!" : ""}</b>`,
		``,
		`• <b>Amount:</b> ${amountFormatted}${note ? ` · <i>${note}</i>` : ""}`,
		`• <b>Category:</b> ${category}`,
		`• <b>Daily Budget Left:</b> ${remainingBudget}`
	];
	if (financeSyncInfo?.synced) parts.push(`• <b>Finance App Ledger:</b> Synced ✅${financeSyncInfo.accountName ? ` [${financeSyncInfo.accountName}]` : ""}${financeSyncInfo.totalBalance ? ` (Total: <b>${financeSyncInfo.totalBalance}</b>)` : ""}`);
	if (coinsAwarded > 0) parts.push(`• <b>Reward:</b> +${coinsAwarded} coins (first log of the day)`);
	return parts.join("\n");
}
function formatBalanceResponse(data) {
	const lines = [`💰 <b>FINANCIAL BALANCE & ASSET OVERVIEW</b> 💰`, ``];
	if (data.financeAccounts.length > 0) {
		lines.push(`🏦 <b>Finance Helper Accounts:</b>`);
		for (const acc of data.financeAccounts) lines.push(`• <b>${acc.name}:</b> ${acc.balanceMdl.toFixed(2)} ${acc.currency}`);
		lines.push(`💳 <b>Accounts Total:</b> <b>${data.financeAccountsTotalMdl.toFixed(2)} ${data.currency}</b>`);
		lines.push(``);
	}
	lines.push(`🪙 <b>Life System Points Wallet:</b>`, `• <b>${data.walletCoins} Coins</b> (≈ <b>${data.walletCoinsValueMdl.toFixed(2)} ${data.currency}</b> at 10:1 ratio)`, ``, `🏛️ <b>Discipline Reward Vault:</b>`, `• <b>${data.vaultSurplusMdl.toFixed(2)} ${data.currency}</b> (unlocked surplus reward cash)`, ``, `💎 <b>Combined Liquid & Stored Value:</b>`, `• <b>${(data.financeAccountsTotalMdl + data.vaultSurplusMdl + data.walletCoinsValueMdl).toFixed(2)} ${data.currency}</b>`);
	if (data.dailyBudgetLeftMdl != null) lines.push(``, `📊 <b>Today's Spending Budget:</b> ${data.dailyBudgetLeftMdl.toFixed(2)} ${data.currency} remaining`);
	return lines.join("\n");
}
function formatCleanCheckinResponse(streak, coins) {
	return [
		`🛡️ <b>Clean Day Affirmed!</b>`,
		``,
		`• <b>Current Streak:</b> ${streak} days clean!`,
		`• <b>Reward:</b> +${coins} points`,
		``,
		`<i>"Stand fast, keep the standard, give today everything."</i>`
	].join("\n");
}
function formatUrgeResponse() {
	return [
		`🚨 <b>URGE CRUSHER ACTIVATED</b> 🚨`,
		``,
		`<b>STOP. DO NOT NEGOTIATE.</b>`,
		`1. Stand up from where you are immediately.`,
		`2. Take 5 slow, deep breaths through your nose.`,
		`3. Drop to the floor and do 20 push-ups right now.`,
		`4. Splash cold water on your face.`,
		``,
		`<i>A few seconds of temporary comfort is not worth your self-respect and progress. You are stronger than any momentary impulse. STAND FAST!</i>`
	].join("\n");
}
// src/renderer/src/web/financeInbox.ts
var SETTING$1 = "finance_inbox_json";
var KEEP_DAYS = 60;
var parse = (raw, fallback) => {
	try {
		return raw ? JSON.parse(raw) : fallback;
	} catch {
		return fallback;
	}
};
/** Adds an expense to the inbox (call inside the bot's change). */
function queueFinanceExpense(db, entry) {
	const cutoff = entry.at - KEEP_DAYS * 864e5;
	const list = parse(getSetting(db, SETTING$1), []).filter((e) => e.at >= cutoff && e.id !== entry.id);
	list.push(entry);
	setSetting(db, SETTING$1, JSON.stringify(list));
}
// src/renderer/public/apps/finance/js/money.js
var LETTERS = /[^\d.,+\-*/()x×÷]/gi;
function parseAmount(text) {
	if (text == null) return null;
	if (typeof text === "number") return Number.isFinite(text) ? Math.round(text * 100) : null;
	let s = String(text).replace(/[\s  ]/g, "").replace(/[^\d.,-]/g, "");
	if (!s || !/\d/.test(s)) return null;
	const negative = s.startsWith("-");
	s = s.replace(/-/g, "");
	const n = toNumber(s);
	if (n == null) return null;
	return Math.round((negative ? -n : n) * 100);
}
function toNumber(s) {
	const lastDot = s.lastIndexOf(".");
	const lastComma = s.lastIndexOf(",");
	if (lastDot >= 0 && lastComma >= 0) {
		const dec = lastDot > lastComma ? "." : ",";
		const thou = dec === "." ? "," : ".";
		s = s.split(thou).join("").replace(dec, ".");
	} else if (lastComma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(/,/g, ".");
	else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
	if (!/^\d*\.?\d*$/.test(s) || s === ".") return null;
	const n = Number(s);
	return Number.isFinite(n) ? n : null;
}
function evalAmount(text) {
	if (text == null) return null;
	const s = String(text).replace(/[\s  ]/g, "").replace(LETTERS, "").replace(/[x×]/gi, "*").replace(/÷/g, "/");
	if (!s) return null;
	if (!/[+*/()]/.test(s.slice(1)) && !/\d-/.test(s)) return parseAmount(s);
	const tokens = s.match(/\d[\d.,]*|[+\-*/()]/g);
	if (!tokens || tokens.join("") !== s) return null;
	let i = 0;
	const peek = () => tokens[i];
	const next = () => tokens[i++];
	function expr() {
		let v = term();
		while (peek() === "+" || peek() === "-") {
			const op = next();
			const r = term();
			if (v == null || r == null) return null;
			v = op === "+" ? v + r : v - r;
		}
		return v;
	}
	function term() {
		let v = factor();
		while (peek() === "*" || peek() === "/") {
			const op = next();
			const r = factor();
			if (v == null || r == null) return null;
			if (op === "/" && r === 0) return null;
			v = op === "*" ? v * r : v / r;
		}
		return v;
	}
	function factor() {
		const t = next();
		if (t === "-") {
			const v = factor();
			return v == null ? null : -v;
		}
		if (t === "(") {
			const v = expr();
			if (next() !== ")") return null;
			return v;
		}
		if (t && /^\d/.test(t)) return toNumber(t);
		return null;
	}
	const v = expr();
	if (v == null || i !== tokens.length || !Number.isFinite(v)) return null;
	return Math.round(v * 100);
}
function formatMoney(cents, currency = "MDL", { sign = false, compact = false } = {}) {
	const neg = cents < 0;
	const abs = Math.abs(Math.round(cents));
	let whole = Math.floor(abs / 100);
	const frac = abs % 100;
	let text;
	if (compact && whole >= 1e4) {
		const k = whole / 1e3;
		text = (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10).toString().replace(".", ",") + "k";
	} else text = group(whole) + (frac ? "," + String(frac).padStart(2, "0") : "");
	return (neg ? "−" : sign && cents > 0 ? "+" : "") + text + (currency ? "\xA0" + currency : "");
}
function group(n) {
	return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\xA0");
}
// src/renderer/public/apps/finance/js/dates.js
var MONTHS$1 = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December"
];
var pad$3 = (n) => String(n).padStart(2, "0");
function toISO(d) {
	return `${d.getFullYear()}-${pad$3(d.getMonth() + 1)}-${pad$3(d.getDate())}`;
}
var monthKey = (iso) => iso.slice(0, 7);
function monthLabel(key, short = false) {
	const [y, m] = key.split("-").map(Number);
	const name = MONTHS$1[m - 1];
	return `${short ? name.slice(0, 3) : name} ${y}`;
}
function addMonths(key, n) {
	const [y, m] = key.split("-").map(Number);
	const idx = y * 12 + (m - 1) + n;
	return `${Math.floor(idx / 12)}-${pad$3(idx % 12 + 1)}`;
}
function daysInMonth(key) {
	const [y, m] = key.split("-").map(Number);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function utc(iso) {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d));
}
function addDays(iso, n) {
	const d = utc(iso);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}
var daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
function weekday(iso) {
	return utc(iso).getUTCDay();
}
var dowIndex = (iso) => (weekday(iso) + 6) % 7;
var DOW_SHORT = [
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
	"Sun"
];
function isValidISO(iso) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
	const d = utc(iso);
	return toISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) === iso;
}
// src/renderer/public/apps/finance/js/fx.js
function perUsd(rates, code) {
	if (code === "USD") return 1;
	const v = rates?.usd?.[code];
	return v > 0 ? v : null;
}
function convert(cents, from, to, rates) {
	if (from === to) return cents;
	const a = perUsd(rates, from);
	const b = perUsd(rates, to);
	if (!a || !b) return null;
	return Math.round(cents / a * b);
}
// src/renderer/public/apps/finance/js/recurring.js
var MONTHS = {
	month: 1,
	"3months": 3,
	year: 12
};
var pad$2 = (n) => String(n).padStart(2, "0");
function nth(rule, n) {
	if (rule.every === "once") return rule.start;
	if (rule.every === "week") return addDays(rule.start, 7 * n);
	if (rule.every === "2weeks") return addDays(rule.start, 14 * n);
	const key = addMonths(monthKey(rule.start), (MONTHS[rule.every] || 1) * n);
	return `${key}-${pad$2(Math.min(Number(rule.start.slice(8, 10)), daysInMonth(key)))}`;
}
function occurrences(rule, from, to, max = 1e3) {
	const out = [];
	for (let n = 0; n < 5e3 && out.length < max; n++) {
		if (rule.every === "once" && n > 0) break;
		const d = nth(rule, n);
		if (d > to || rule.end && d > rule.end) break;
		if (d >= from) out.push(d);
	}
	return out;
}
var active = (state) => (state.recurring || []).filter((r) => !r.paused);
var sortItems = (a, b) => a.date.localeCompare(b.date) || (a.rule.note || "").localeCompare(b.rule.note || "");
function dueItems(state, today) {
	const out = [];
	for (const rule of active(state)) {
		const from = rule.lastDone ? addDays(rule.lastDone, 1) : rule.start;
		for (const date of occurrences(rule, from, today, 60)) out.push({
			rule,
			date
		});
	}
	return out.sort(sortItems);
}
function upcomingItems(state, today, days = 30) {
	const out = [];
	const to = addDays(today, days);
	for (const rule of active(state)) {
		const from = addDays(rule.lastDone && rule.lastDone > today ? rule.lastDone : today, 1);
		for (const date of occurrences(rule, from, to, 60)) out.push({
			rule,
			date
		});
	}
	return out.sort(sortItems);
}
var ACCOUNT_DEFAULTS = {
	bank: "",
	kind: "cash",
	currency: "MDL",
	start: 0,
	last4: "",
	color: 1,
	savings: false,
	archived: false,
	holdings: []
};
function defaultState() {
	return {
		version: 3,
		settings: {
			currency: "MDL",
			jars: [
				{
					id: "savings",
					name: "Deposit (safe)",
					emoji: "🏦",
					pct: 70,
					savings: true
				},
				{
					id: "living",
					name: "Food & transport",
					emoji: "🍔",
					pct: 10
				},
				{
					id: "growth",
					name: "Investing & self-development",
					emoji: "📈",
					pct: 10
				},
				{
					id: "care",
					name: "Hygiene & cosmetics",
					emoji: "🧴",
					pct: 10
				}
			],
			accounts: [
				{
					...ACCOUNT_DEFAULTS,
					id: "wallet",
					name: "Wallet",
					kind: "cash",
					emoji: "💵",
					color: 2
				},
				{
					...ACCOUNT_DEFAULTS,
					id: "safe",
					name: "Safe",
					kind: "savings",
					savings: true,
					emoji: "🏦",
					color: 1
				},
				{
					...ACCOUNT_DEFAULTS,
					id: "card",
					name: "Card",
					kind: "card",
					emoji: "💳",
					color: 5
				}
			],
			categories: [
				{
					id: "work",
					type: "income",
					name: "Work",
					emoji: "💼"
				},
				{
					id: "family",
					type: "income",
					name: "Family",
					emoji: "👪"
				},
				{
					id: "side",
					type: "income",
					name: "Side jobs",
					emoji: "🛠️"
				},
				{
					id: "competitions",
					type: "income",
					name: "Competitions",
					emoji: "🏆"
				},
				{
					id: "gift-in",
					type: "income",
					name: "Gifts received",
					emoji: "🎁"
				},
				{
					id: "other-in",
					type: "income",
					name: "Other income",
					emoji: "➕"
				},
				{
					id: "food",
					type: "expense",
					name: "Food",
					emoji: "🍔",
					jar: "living"
				},
				{
					id: "transport",
					type: "expense",
					name: "Transport",
					emoji: "🚌",
					jar: "living"
				},
				{
					id: "home",
					type: "expense",
					name: "Home & bills",
					emoji: "🏠",
					jar: "living"
				},
				{
					id: "family-out",
					type: "expense",
					name: "Family",
					emoji: "💞",
					jar: "living"
				},
				{
					id: "gifts",
					type: "expense",
					name: "Gifts",
					emoji: "🎁",
					jar: "living"
				},
				{
					id: "fun",
					type: "expense",
					name: "Fun & going out",
					emoji: "🎉",
					jar: "living"
				},
				{
					id: "learning",
					type: "expense",
					name: "Learning & tools",
					emoji: "📚",
					jar: "growth"
				},
				{
					id: "sport",
					type: "expense",
					name: "Sport & competitions",
					emoji: "🥋",
					jar: "growth"
				},
				{
					id: "subscriptions",
					type: "expense",
					name: "Subscriptions",
					emoji: "📱",
					jar: "growth"
				},
				{
					id: "investing",
					type: "expense",
					name: "Investing",
					emoji: "📈",
					jar: "growth"
				},
				{
					id: "hygiene",
					type: "expense",
					name: "Hygiene & cosmetics",
					emoji: "🧴",
					jar: "care"
				},
				{
					id: "health",
					type: "expense",
					name: "Health",
					emoji: "💊",
					jar: "care"
				},
				{
					id: "clothes",
					type: "expense",
					name: "Clothes",
					emoji: "👕",
					jar: "care"
				},
				{
					id: "other",
					type: "expense",
					name: "Other",
					emoji: "📦",
					jar: "living"
				}
			],
			goal: {
				name: "Safe goal",
				target: 1e7,
				account: "savings"
			},
			savingsAccount: "safe",
			theme: "dark",
			themeMotion: false,
			sound: false,
			smallPurchase: 1e4
		},
		tx: [],
		people: [],
		recurring: [],
		invoices: [],
		goals: [{
			id: "g-main",
			name: "Safe goal",
			emoji: "🏦",
			target: 1e7,
			account: "savings",
			saved: 0,
			history: [],
			deadline: null,
			doneAt: null,
			theme: "gold",
			updatedAt: 0
		}],
		goalAllocations: [],
		netWorth: [],
		deleted: {},
		rates: null,
		meta: {
			lastBackup: null,
			createdAt: null
		}
	};
}
function normalizeState(raw) {
	const base = defaultState();
	if (!raw || typeof raw !== "object") return base;
	const s = raw.settings || {};
	const accounts = (Array.isArray(s.accounts) && s.accounts.length ? s.accounts : base.settings.accounts).map((a, i) => {
		const acc = {
			...ACCOUNT_DEFAULTS,
			color: i % 8 + 1,
			...a,
			holdings: Array.isArray(a.holdings) ? a.holdings : []
		};
		if (acc.id === "wallet" || /^(wallet|cash|numerar)$/i.test(acc.name || "")) {
			if (acc.kind !== "cash") acc.kind = "cash";
			if (!acc.emoji || acc.emoji === "💳") acc.emoji = "💵";
		}
		return acc;
	});
	if (!accounts.some((a) => a.kind === "cash" || a.id === "wallet" || /^(wallet|cash|numerar)$/i.test(a.name || ""))) accounts.unshift({
		...ACCOUNT_DEFAULTS,
		id: "wallet",
		name: "Cash",
		kind: "cash",
		emoji: "💵",
		color: 2
	});
	const settings = {
		...base.settings,
		...s,
		goal: {
			...base.settings.goal,
			...s.goal || {}
		},
		jars: Array.isArray(s.jars) && s.jars.length ? s.jars : base.settings.jars,
		accounts,
		categories: Array.isArray(s.categories) && s.categories.length ? s.categories : base.settings.categories
	};
	const baseCur = settings.currency || "MDL";
	const accCur = Object.fromEntries(accounts.map((a) => [a.id, a.currency || baseCur]));
	const tx = (Array.isArray(raw.tx) ? raw.tx : []).filter(validTx).map((t) => {
		const currency = t.currency || accCur[t.account ?? t.from] || baseCur;
		const out = {
			...t,
			currency,
			updatedAt: t.updatedAt || t.createdAt || 0
		};
		if (!Number.isInteger(out.base)) {
			out.base = currency === baseCur ? t.amount : Math.round(t.amount * (t.rate || 1));
			out.rate = currency === baseCur ? 1 : t.rate || null;
		}
		return out;
	});
	const people = (Array.isArray(raw.people) ? raw.people : []).filter((p) => p && typeof p.id === "string" && p.name).map((p) => ({
		note: "",
		...p,
		updatedAt: p.updatedAt || 0
	}));
	const deleted = raw.deleted && typeof raw.deleted === "object" ? { ...raw.deleted } : {};
	const recurring = (Array.isArray(raw.recurring) ? raw.recurring : []).filter((r) => r && typeof r.id === "string" && Number.isInteger(r.amount) && /^\d{4}-\d{2}-\d{2}$/.test(r.start || "")).map((r) => ({
		every: "month",
		currency: accCur[r.account] || baseCur,
		note: "",
		auto: false,
		paused: false,
		lastDone: null,
		...r,
		updatedAt: r.updatedAt || 0
	}));
	const invoices = (Array.isArray(raw.invoices) ? raw.invoices : []).filter((i) => i && typeof i.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.date || "")).map((i) => ({
		items: [],
		note: "",
		sent: false,
		paidDate: null,
		paidTx: null,
		currency: "USD",
		...i,
		updatedAt: i.updatedAt || 0
	}));
	const netWorth = (Array.isArray(raw.netWorth) ? raw.netWorth : []).filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date || "") && Number.isFinite(x.total));
	const goals = Array.isArray(raw.goals) ? raw.goals.filter((g) => g && typeof g.id === "string" && g.name).map((g) => ({
		emoji: "🎯",
		account: "all",
		saved: 0,
		history: [],
		deadline: null,
		doneAt: null,
		...g,
		updatedAt: g.updatedAt || 0
	})).map((g) => g.id === "g-main" && !g.updatedAt && g.account === "all" && g.name === "Safe goal" ? {
		...g,
		account: "savings"
	} : g) : [{
		id: "g-main",
		name: settings.goal.name || "Safe goal",
		emoji: "🏦",
		target: settings.goal.target || 0,
		account: settings.goal.account || "all",
		saved: 0,
		history: [],
		deadline: null,
		doneAt: null,
		theme: "gold",
		updatedAt: 0
	}];
	const goalAllocations = (Array.isArray(raw.goalAllocations) ? raw.goalAllocations : []).filter((a) => a && typeof a.id === "string" && typeof a.goalId === "string" && Number.isSafeInteger(a.amount) && a.amount > 0 && isValidISO(a.date || "")).map((a) => ({
		...a,
		currency: a.currency || baseCur,
		updatedAt: a.updatedAt || 0
	}));
	const oliviu = people.find((p) => p.name?.trim().toLowerCase() === "oliviu");
	const brother = people.find((p) => p.name?.trim().toLowerCase() === "brother");
	if (oliviu && brother && oliviu.id !== brother.id) {
		const now = Date.now();
		for (const t of tx) if (t.person === oliviu.id) {
			t.person = brother.id;
			t.updatedAt = now;
		}
		const oIdx = people.findIndex((p) => p.id === oliviu.id);
		if (oIdx !== -1) people.splice(oIdx, 1);
		deleted[oliviu.id] = now;
		brother.updatedAt = now;
	}
	return {
		version: 3,
		settings,
		tx,
		people,
		recurring,
		invoices,
		netWorth,
		goals,
		goalAllocations,
		deleted,
		rates: raw.rates || null,
		meta: {
			...base.meta,
			...raw.meta || {}
		}
	};
}
function validTx(t) {
	return t && typeof t.id === "string" && [
		"income",
		"expense",
		"transfer"
	].includes(t.type) && Number.isInteger(t.amount) && t.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
}
var B = (t) => Number.isInteger(t.base) ? t.base : t.amount;
var counts = (t) => !t.loan;
function sortTx(list) {
	return [...list].sort((a, b) => a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1);
}
var category = (state, id) => state.settings.categories.find((c) => c.id === id);
var account = (state, id) => state.settings.accounts.find((a) => a.id === id);
var savingsJar = (state) => state.settings.jars.find((j) => j.savings) || state.settings.jars[0];
function accountBalances(state, upTo = null) {
	const bal = Object.fromEntries(state.settings.accounts.map((a) => [a.id, a.start || 0]));
	for (const t of state.tx) {
		if (upTo && t.date > upTo) continue;
		if (t.type === "income" && t.account in bal) bal[t.account] += t.amount;
		else if (t.type === "expense" && t.account in bal) bal[t.account] -= t.amount;
		else if (t.type === "transfer") {
			if (t.from in bal) bal[t.from] -= t.amount;
			if (t.to in bal) bal[t.to] += Number.isInteger(t.toAmount) ? t.toAmount : t.amount;
		}
	}
	return bal;
}
var txInMonth = (state, key) => state.tx.filter((t) => monthKey(t.date) === key);
function sumBy(list, keyFn) {
	const out = /* @__PURE__ */ new Map();
	for (const t of list) out.set(keyFn(t), (out.get(keyFn(t)) || 0) + B(t));
	return [...out.entries()].map(([id, amount]) => ({
		id,
		amount
	})).sort((a, b) => b.amount - a.amount);
}
function monthSummary(state, key) {
	const list = txInMonth(state, key);
	const incomes = list.filter((t) => t.type === "income" && counts(t));
	const expenses = list.filter((t) => t.type === "expense" && counts(t));
	const income = incomes.reduce((a, t) => a + B(t), 0);
	const expense = expenses.reduce((a, t) => a + B(t), 0);
	const net = income - expense;
	return {
		key,
		income,
		expense,
		net,
		savingsRate: income > 0 ? net / income : null,
		byCategory: sumBy(expenses, (t) => t.category),
		bySource: sumBy(incomes, (t) => t.category),
		count: list.length,
		expenses,
		incomes
	};
}
var WORK_INCOME = /\b(work|job|jobs|client|clients|freelance|salary|salariu|lucru|proiect|project|invoice|factur\w*)\b/i;
function isWorkIncome(state, catId) {
	const c = category(state, catId);
	if (!c || c.type !== "income") return false;
	if (typeof c.work === "boolean") return c.work;
	return c.id === "work" || c.id === "side" || WORK_INCOME.test(c.name || "");
}
var isWorkCost = (state, catId) => {
	const c = category(state, catId);
	return c?.type === "expense" && c.jar === "none";
};
var payOn = (state) => {
	const p = state.settings.pay;
	return !!(p?.on && p.buffer && p.to && p.amount > 0 && state.settings.accounts.some((a) => a.id === p.buffer));
};
function personalMonth(state, key) {
	const s = monthSummary(state, key);
	const workIncome = s.incomes.filter((t) => isWorkIncome(state, t.category)).reduce((a, t) => a + B(t), 0);
	const workCosts = s.expenses.filter((t) => isWorkCost(state, t.category)).reduce((a, t) => a + B(t), 0);
	const otherIncome = s.income - workIncome;
	const pay = payOn(state);
	const salary = pay ? txInMonth(state, key).filter((t) => t.type === "transfer" && t.salary).reduce((a, t) => a + B(t), 0) : 0;
	const personalIncome = pay ? salary + otherIncome : s.income - workCosts;
	const personalSpent = s.expense - workCosts;
	const kept = personalIncome - personalSpent;
	return {
		key,
		workIncome,
		workCosts,
		profit: workIncome - workCosts,
		otherIncome,
		salary,
		pay,
		personalIncome,
		personalSpent,
		kept,
		rate: personalIncome > 0 ? kept / personalIncome : null
	};
}
var BILLISH = /bill|rent|chiri|apart|utilit|factur|comunal|internet|subscript|abonam|insur|asigur|mortgage|ipotec|credit|coммун|аренд|квартир/i;
var isBillCategory = (state, catId) => {
	const c = category(state, catId);
	if (!c) return false;
	return typeof c.bill === "boolean" ? c.bill : c.id === "home" || c.id === "subscriptions" || BILLISH.test(c.name || "");
};
var spentIn = (state, key, catId) => txInMonth(state, key).filter((t) => t.type === "expense" && counts(t) && t.category === catId).reduce((a, t) => a + B(t), 0);
function budgetAlert(state, t) {
	const c = category(state, t.category);
	if (t.type !== "expense" || !counts(t) || !(c?.budget > 0)) return null;
	const after = spentIn(state, monthKey(t.date), c.id);
	const before = after - B(t);
	const fmt = (x) => formatMoney(x, state.settings.currency);
	if (before <= c.budget && after > c.budget) return {
		level: "over",
		text: `${c.name} is over budget: ${fmt(after)} of ${fmt(c.budget)} (${fmt(after - c.budget)} over).`
	};
	if (before < c.budget * .8 && after >= c.budget * .8) return {
		level: "near",
		text: `${c.name}: ${Math.round(after / c.budget * 100)}% of the budget used. ${fmt(c.budget - after)} left this month.`
	};
	return null;
}
var KEYWORDS = {
	expense: [
		["food", /food|mancare|mâncare|еда|продукт|magazin|market|lidl|kaufland|linella|pizza|burger|cafe|cafea|coffee|lunch|dinner|breakfast/i],
		["transport", /transport|taxi|yandex|bolt|uber|bus|autobuz|troleibuz|metro|benzin|fuel|petrol|бензин|такси/i],
		["gifts", /gift|cadou|подар|birthday|zi de nastere/i],
		["subscriptions", /subscri|abonament|подписк|google|netflix|spotify|youtube|icloud|chatgpt|claude/i],
		["hygiene", /hair|igien|cosmet|shampoo|sampon|soap|sapun|barber|frizer|uhod|косметик/i],
		["health", /medic|pharm|farmac|doctor|dentist|аптек|лекар|vitamin/i],
		["sport", /sport|gym|sala|black belt|centura|karate|judo|competi|turneu|dame|шашк|спорт/i],
		["learning", /book|carte|course|curs|printer|culori|material|school|scoala|universit|math|matem|teach/i],
		["clothes", /cloth|haine|shoe|pantofi|adidas|nike|одежд|обув/i],
		["home", /rent|chirie|electric|gaz|apa|water|internet|telefon|phone|bill|factur|комм/i],
		["fun", /cinema|film|movie|party|club|bar|game|joc|concert/i],
		["family", /mother|mama|mom|brother|frate|sister|sora|family|familie|мама|брат/i]
	],
	income: [
		["competitions", /competi|turneu|prize|premiu|dame|tournament|donation from/i],
		["work", /work|job|salar|lucru|munca|serviciu|services|работ|зарплат|from work/i],
		["side", /interview|freelance|client|order|comand|tutor|lesson|lectie|repair|sold|vandut/i],
		["family", /mother|mama|mom|brother|frate|family|familie|father|tata|bunic|мама|папа|семь/i],
		["gift-in", /gift|cadou|birthday|подар/i]
	]
};
var fold$2 = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
var STOP = new Set("plata platii pentru from with the and for card pos srl sa ii md mda chisinau chisinaului moldova str nr via transfer payment purchase achitare cumparare comision operatiune tranzactie оплата покупка перевод платеж для www com shop store magazin".split(" "));
var words = (note) => [...new Set(fold$2(note).match(/[\p{L}]{3,}/gu) || [])].filter((w) => !STOP.has(w));
function matchRule(state, note, type) {
	const n = fold$2(note);
	if (!n) return null;
	return (state.settings.rules || []).filter((r) => r.match && (r.type === type || r.type === "any") && n.includes(fold$2(r.match))).sort((a, b) => b.match.length - a.match.length)[0] || null;
}
var statsCache = /* @__PURE__ */ new WeakMap();
function wordStats(state, type) {
	let last = 0;
	for (const t of state.tx) if (t.updatedAt > last) last = t.updatedAt;
	const key = `${type}|${state.tx.length}|${last}`;
	const hit = statsCache.get(state.tx);
	if (hit?.[key]) return hit[key];
	const out = /* @__PURE__ */ new Map();
	for (const t of state.tx) {
		if (t.type !== type || !t.note || t.category === "other" || t.category === "other-in") continue;
		for (const w of words(t.note)) {
			const m = out.get(w) || /* @__PURE__ */ new Map();
			m.set(t.category, (m.get(t.category) || 0) + 1);
			out.set(w, m);
		}
	}
	statsCache.set(state.tx, {
		...Object.keys(hit || {}).length < 4 ? hit : {},
		[key]: out
	});
	return out;
}
function learnedCategory(state, note, type) {
	const stats = wordStats(state, type);
	let best = null;
	for (const w of words(note)) {
		const m = stats.get(w);
		if (!m) continue;
		const total = [...m.values()].reduce((a, b) => a + b, 0);
		const [cat, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
		if (n >= 2 && n / total >= .85 && (!best || n > best.n)) best = {
			cat,
			n
		};
	}
	return best?.cat || null;
}
function suggestCategory(state, note, type) {
	const n = (note || "").trim().toLowerCase();
	if (!n || type === "transfer") return null;
	const valid = (id) => state.settings.categories.some((c) => c.id === id && c.type === type);
	const rule = matchRule(state, note, type);
	if (rule && valid(rule.category)) return rule.category;
	const past = sortTx(state.tx).find((t) => t.type === type && (t.note || "").trim().toLowerCase() === n);
	if (past && valid(past.category)) return past.category;
	const learned = learnedCategory(state, note, type);
	if (learned && valid(learned)) return learned;
	for (const [id, re] of KEYWORDS[type] || []) if (re.test(n) && valid(id)) return id;
	return null;
}
// src/renderer/public/apps/finance/js/blocks.js
var G = (name, list) => ({
	name,
	items: list.split("|").map((x) => {
		const i = x.indexOf(" ");
		return {
			e: x.slice(0, i),
			k: x.slice(i + 1)
		};
	})
});
var EMOJI_GROUPS = [
	G("Food & drinks", "☕ coffee cafea кофе espresso latte|🍵 tea ceai чай|🧋 bubble tea|🥤 soda cola drink suc|🧃 juice suc|💧 water apa вода|🥛 milk lapte|🍺 beer bere пиво bar|🍷 wine vin вино|🥂 champagne party|🍸 cocktail|🥃 whisky|🍾 bottle|🥙 kebab shaorma shawarma doner|🌯 wrap burrito|🌮 taco|🍔 burger lunch pranz|🍟 fries cartofi|🍕 pizza|🌭 hot dog|🥪 sandwich|🥗 salad salata|🍣 sushi|🍜 ramen soup supa|🍲 soup stew zeama|🍝 pasta|🍛 curry|🍚 rice orez|🥟 dumplings coltunasi pelmeni|🍗 chicken pui|🍖 meat carne|🥩 steak|🥓 bacon|🍳 eggs breakfast oua|🥞 pancakes clatite|🧇 waffle|🥐 croissant bakery|🥖 bread paine хлеб|🥨 pretzel covrig|🧀 cheese branza|🍰 cake tort|🎂 birthday cake|🧁 cupcake|🍩 donut gogosi|🍪 cookie biscuit|🍫 chocolate snack ciocolata|🍬 candy bomboane|🍦 ice cream inghetata|🍎 apple fruit mar|🍌 banana|🍓 strawberry|🍉 watermelon|🍇 grapes struguri|🥑 avocado|🥕 vegetables legume|🥔 potato cartofi|🍅 tomato rosii|🥜 nuts|🍿 popcorn movie snack|🛒 groceries market magazin supermarket|🧺 basket market piata"),
	G("Internet & tech", "🌐 internet web online|📶 internet mobile data signal|🛜 wifi wireless internet|📡 satellite tv internet antenna|💻 laptop computer pc|🖥️ desktop computer pc monitor|⌨️ keyboard|🖱️ mouse|🖨️ printer|📱 phone mobile telefon|📲 top up phone credit recharge|☎️ phone landline|📞 call|🔋 battery charger|🔌 plug charger electricity|💾 storage|💿 disk|📀 dvd|🎧 headphones music|🎮 games gaming playstation|🕹️ games arcade|📺 tv television netflix|📹 camera video|📷 camera photo|🤖 ai bot chatgpt claude|🧠 ai learning|☁️ cloud drive icloud storage|🔐 vpn security password|🔑 key license|🛡️ antivirus security|⚙️ software tools|🧩 plugin app|🌍 domain hosting website|🖋️ design|🎨 design figma|🎵 music spotify|🎬 streaming movie youtube|📧 email mail|💬 chat telegram|🔔 subscription notification|📦 order delivery package colet|🛍️ online shopping aliexpress temu|🪙 crypto coin bitcoin|📈 trading stocks investing"),
	G("Transport", "🚌 bus autobuz troleibuz|🚎 trolleybus troleibuz|🚐 minibus rutiera maxi taxi|🚕 taxi yandex bolt uber|🚗 car masina|🚙 suv car|🏎️ fast car|🏍️ motorbike|🛵 scooter|🚲 bike bicycle bicicleta|🛴 kick scooter|🚇 metro subway|🚆 train tren|🚄 fast train|✈️ flight plane avion|🛫 trip airport|🚢 ship ferry|⛽ fuel gas benzina petrol|🔋 ev charging|🅿️ parking parcare|🛞 tires anvelope|🔧 repair service car|🧽 car wash spalatorie|🚦 traffic fine amenda|🛣️ road toll vigneta|🗺️ trip travel"),
	G("Home & bills", "🏠 home rent chirie casa|🏡 house|🏢 apartment office|💡 electricity light lumina|🔥 gas heating gaz|💧 water bill apa|🚿 shower water|🛁 bath|🧻 toilet paper|🧹 cleaning curatenie|🧼 soap sapun|🧺 laundry|🪣 bucket|🛋️ furniture mobila|🛏️ bed|🪑 chair|🔨 repair tools|🪛 tools|🧰 toolbox|🪴 plants flori|🔑 keys rent|📬 mail post|🧾 bill receipt factura|🗑️ trash gunoi|🪟 window|🚪 door"),
	G("Shopping & clothes", "👕 tshirt clothes haine|👖 jeans|👗 dress rochie|🧥 coat jacket|👟 sneakers shoes|👞 shoes pantofi|👠 heels|🧦 socks|🧢 cap|🎒 backpack rucsac|👜 bag geanta|👛 wallet|💍 ring jewelry|⌚ watch ceas|🕶️ sunglasses|👓 glasses ochelari|🛍️ shopping cumparaturi|🎁 gift cadou present|🧸 toy jucarie|🖊️ stationery pen|📒 notebook"),
	G("Health & care", "💊 medicine pills farmacie|🏥 hospital doctor|🩺 doctor checkup|🦷 dentist stomatolog|👁️ eyes optician|💉 vaccine injection|🩹 bandage|🧴 cosmetics lotion|🪥 toothbrush|💈 barber frizer|💇 haircut|💅 nails manichiura|💆 massage spa|🧘 yoga|🛀 spa|🧪 lab tests analize"),
	G("Sport & fun", "🥋 martial arts karate judo|🏋️ gym sala fitness|🤸 gymnastics|🏃 running|⚽ football fotbal|🏀 basketball|🎾 tennis|🏊 swimming|🚴 cycling|🥊 boxing|🏆 competition trophy|🎟️ tickets bilete|🎫 ticket|🎬 cinema movie film|🎭 theatre|🎤 karaoke concert|🎸 guitar|🎳 bowling|🎱 billiards|🎯 darts goal|🎲 board games|🃏 cards|🎉 party petrecere|🍻 drinks friends|🏖️ vacation beach|⛰️ mountains hiking|🏕️ camping|🎡 park|📸 photos"),
	G("Learning & work", "📚 books carti|📖 reading|🎓 course university|✏️ school|🧑‍💻 freelance coding|💼 work job lucru|🗂️ documents|📊 business report|📝 taxes forms|🏛️ taxes state|🖇️ office supplies|🧑‍🏫 tutor lessons|🌐 online course"),
	G("Money", "💰 money salary bani|💵 cash dollars|💶 euro|💷 pound|💴 yen|💳 card bank|🏦 bank safe deposit|🪙 coin crypto|💸 spending money out|🤑 bonus|📈 investing growth|📉 loss|🧾 receipt|💹 exchange|🎰 gambling|🤝 loan debt"),
	G("Family & pets", "👪 family familie|👶 baby kids copil|🧒 child|👵 grandma bunica|👴 grandpa|❤️ love partner|💐 flowers flori|🐶 dog caine|🐱 cat pisica|🐾 pet food|🐟 fish|🐦 bird|🦜 parrot|🐴 horse"),
	G("Symbols", "⭐ star favorite|🔥 hot fire|✅ done|❗ important|❓ other unknown|🔴 red|🟠 orange|🟡 yellow|🟢 green|🔵 blue|🟣 purple|⚫ black|⚪ white|💜 heart|💙 heart|💚 heart|💛 heart|🧡 heart|🖤 heart|🍀 luck|🌙 night|☀️ day|⚡ quick|📌 pin|🔁 repeat|➕ plus|➖ minus")
];
[...new Set(EMOJI_GROUPS.flatMap((g) => g.items.map((x) => x.e)))];
// src/renderer/public/apps/finance/js/invoices.js
var invoiceHours = (inv) => (inv.items || []).reduce((a, l) => a + (Number(l.hours) > 0 ? Number(l.hours) : 0), 0);
var workPrefs = (state) => ({
	mode: "auto",
	rate: 0,
	hoursPerMonth: 160,
	show: true,
	...state.settings.workHour || {}
});
function hourlyRate(state, today) {
	const p = workPrefs(state);
	if (p.mode === "manual") return p.rate > 0 ? {
		rate: p.rate,
		source: "manual"
	} : null;
	const from = `${addMonths(monthKey(today), -12)}-01`;
	let hours = 0;
	let paid = 0;
	for (const inv of state.invoices || []) {
		if (!inv.paidDate || inv.paidDate < from) continue;
		const h = invoiceHours(inv);
		const t = h > 0 && state.tx.find((x) => x.id === inv.paidTx);
		if (t) {
			hours += h;
			paid += B(t);
		}
	}
	if (hours >= 10) return {
		rate: Math.round(paid / hours),
		source: "invoices",
		hours
	};
	const cur = monthKey(today);
	const months = [
		1,
		2,
		3
	].map((i) => addMonths(cur, -i));
	const income = state.tx.filter((t) => t.type === "income" && !t.loan && months.includes(t.date.slice(0, 7))).reduce((a, t) => a + B(t), 0);
	const active = new Set(state.tx.filter((t) => t.type === "income" && !t.loan && months.includes(t.date.slice(0, 7))).map((t) => t.date.slice(0, 7))).size;
	if (!income || !active) return null;
	return {
		rate: Math.round(income / active / (p.hoursPerMonth || 160)),
		source: "income"
	};
}
var workHours = (amount, rate) => rate > 0 ? amount / rate : null;
function formatWork(h) {
	if (h == null || !Number.isFinite(h)) return "";
	if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
	const one = (x) => (x < 10 ? Math.round(x * 10) / 10 : Math.round(x)).toString().replace(".", ",");
	if (h < 8) return `${one(h)} h`;
	if (h < 40) return `${one(h / 8)} work day${h / 8 >= 1.05 ? "s" : ""}`;
	return `${one(h / 40)} work week${h / 40 >= 1.05 ? "s" : ""}`;
}
function workText(state, amountBase, today) {
	if (!workPrefs(state).show) return "";
	const r = hourlyRate(state, today);
	if (!r) return "";
	return formatWork(workHours(amountBase, r.rate));
}
// src/renderer/public/apps/finance/js/payyourself.js
var pad$1 = (n) => String(n).padStart(2, "0");
var toBase = (state, c, cur) => !cur || cur === state.settings.currency ? c : convert(c, cur, state.settings.currency, state.rates);
function suggestSalary(state, today) {
	const key = monthKey(today);
	const months = [
		1,
		2,
		3,
		4,
		5,
		6
	].map((n) => personalMonth(state, addMonths(key, -n))).filter((m) => m.workIncome > 0);
	if (!months.length) return {
		amount: 0,
		average: 0,
		months: 0
	};
	const average = Math.round(months.reduce((a, m) => a + m.profit, 0) / months.length);
	return {
		amount: Math.max(0, Math.floor(average * .8 / 1e4) * 1e4),
		average,
		months: months.length
	};
}
var salaryDate = (key, day = 1) => `${key}-${pad$1(Math.min(Math.max(1, day), daysInMonth(key)))}`;
var salaryOf = (state, key) => state.tx.find((t) => t.type === "transfer" && t.salary === key) || null;
function payStatus(state, today) {
	if (!payOn(state)) return {
		on: false,
		suggest: suggestSalary(state, today)
	};
	const p = state.settings.pay;
	const key = monthKey(today);
	const date = salaryDate(key, p.day);
	const paid = salaryOf(state, key);
	const due = !paid && today >= date;
	const next = !paid && today < date ? date : salaryDate(addMonths(key, 1), p.day);
	const acc = state.settings.accounts.find((a) => a.id === p.buffer);
	const bufferBalance = toBase(state, accountBalances(state)[p.buffer] || 0, acc?.currency) ?? 0;
	const runway = p.amount > 0 ? Math.max(0, bufferBalance) / p.amount : 0;
	return {
		on: true,
		key,
		label: monthLabel(key),
		amount: p.amount,
		date,
		paid,
		due,
		next,
		bufferBalance,
		runway,
		short: due && bufferBalance < p.amount
	};
}
// src/renderer/public/apps/finance/js/forecast.js
var isLiquid = (a) => !a.archived && !a.savings && a.kind !== "savings" && a.kind !== "crypto";
function spentFrom(state, today, window = 60) {
	const since = addDays(today, -window + 1);
	const by = /* @__PURE__ */ new Map();
	let total = 0;
	for (const t of state.tx) {
		if (t.type !== "expense" || t.loan || t.recurring || t.date < since || t.date > today) continue;
		if (isBillCategory(state, t.category) || isWorkCost(state, t.category)) continue;
		by.set(t.account, (by.get(t.account) || 0) + B(t));
		total += B(t);
	}
	return [...by.entries()].map(([id, amount]) => ({
		id,
		amount,
		share: total ? amount / total : 0
	})).sort((a, b) => b.amount - a.amount);
}
function spendingIds(state, today = null) {
	const accs = state.settings.accounts.filter((a) => !a.archived);
	const pick = Array.isArray(state.settings.spendFrom) && state.settings.spendFrom.length ? state.settings.spendFrom : null;
	const ids = new Set(pick ? accs.filter((a) => pick.includes(a.id)).map((a) => a.id) : accs.filter((a) => isLiquid(a) && a.kind !== "business").map((a) => a.id));
	if (!pick && today) for (const x of spentFrom(state, today)) {
		const a = accs.find((y) => y.id === x.id);
		if (a && a.kind !== "crypto" && x.share >= .2) ids.add(a.id);
	}
	if (payOn(state)) ids.delete(state.settings.pay.buffer);
	return ids;
}
// src/renderer/public/apps/finance/js/safespend.js
var lei$1 = (c) => Math.floor(c / 100) * 100;
var isEveryday = (state, t) => t.type === "expense" && !t.loan && !t.recurring && !isBillCategory(state, t.category) && !isWorkCost(state, t.category);
var everydaySpent = (state, from, to) => state.tx.filter((t) => t.date >= from && t.date <= to && isEveryday(state, t)).reduce((a, t) => a + B(t), 0);
var limitOn = (state) => !!(state.settings.limit?.on && state.settings.limit.amount > 0);
function limitStatus(state, today) {
	if (!limitOn(state)) return null;
	const amount = state.settings.limit.amount;
	const key = monthKey(today);
	const daysLeft = daysInMonth(key) - Number(today.slice(8)) + 1;
	const before = everydaySpent(state, `${key}-01`, addDays(today, -1));
	const spentToday = everydaySpent(state, today, today);
	const leftBefore = amount - before;
	const perDay = leftBefore > 0 ? lei$1(leftBefore / daysLeft) : 0;
	const spent = before + spentToday;
	return {
		amount,
		spent,
		left: amount - spent,
		perDay,
		daysLeft,
		ratio: spent / amount,
		projected: Number(today.slice(8)) >= 3 ? Math.round(spent / Number(today.slice(8)) * daysInMonth(key) / 100) * 100 : null
	};
}
function safeToSpend(state, today) {
	const base = state.settings.currency;
	const toBase = (c, cur) => !cur || cur === base ? c : convert(c, cur, base, state.rates);
	const pay = payOn(state) ? payStatus(state, today) : null;
	const spendIds = spendingIds(state, today);
	const spendable = (a) => spendIds.has(a.id);
	const accs = state.settings.accounts;
	const liquidIds = new Set(accs.filter(spendable).map((a) => a.id));
	const bal = accountBalances(state);
	const liquid = accs.filter(spendable).reduce((a, acc) => a + (toBase(bal[acc.id] || 0, acc.currency) || 0), 0);
	const ahead = upcomingItems(state, today, 45);
	const inc = pay ? null : ahead.find((x) => x.rule.type === "income");
	const payday = pay ? pay.next : inc ? inc.date : `${addMonths(monthKey(today), 1)}-01`;
	const days = Math.max(1, daysBetween(today, payday));
	const bills = [...dueItems(state, today), ...ahead.filter((x) => x.date < payday)].filter((x) => x.rule.type !== "income").map((x) => ({
		label: x.rule.note || "Bill",
		date: x.date,
		amount: toBase(x.rule.amount, x.rule.currency) || 0
	}));
	const billsTotal = bills.reduce((a, b) => a + b.amount, 0);
	const key = monthKey(today);
	const jar = savingsJar(state);
	const income = personalMonth(state, key).personalIncome;
	const plan = jar?.savings ? Math.round(income * jar.pct / 1e4) * 100 : 0;
	let moved = 0;
	for (const t of state.tx) {
		if (t.type !== "transfer" || monthKey(t.date) !== key) continue;
		const v = B(t);
		if (liquidIds.has(t.from) && !liquidIds.has(t.to)) moved += v;
		else if (!liquidIds.has(t.from) && liquidIds.has(t.to)) moved -= v;
	}
	const savingsLeft = pay ? 0 : Math.max(0, plan - moved);
	const spentToday = everydaySpent(state, today, today);
	const pool = liquid + spentToday - billsTotal - savingsLeft;
	const moneyPerDay = pool > 0 ? lei$1(pool / days) : 0;
	let tomorrow = days > 1 && pool - spentToday > 0 ? lei$1((pool - spentToday) / (days - 1)) : 0;
	const limit = limitStatus(state, today);
	const byLimit = !!limit && limit.perDay < moneyPerDay;
	const perDay = byLimit ? limit.perDay : moneyPerDay;
	if (limit) {
		const lt = limit.daysLeft > 1 && limit.left > 0 ? lei$1(limit.left / (limit.daysLeft - 1)) : 0;
		tomorrow = Math.min(tomorrow, lt);
	}
	const leftToday = perDay - spentToday;
	return {
		liquid,
		bills,
		billsTotal,
		plan,
		moved,
		savingsLeft,
		spentToday,
		pool,
		perDay,
		leftToday,
		tomorrow,
		payday,
		days,
		paydayFrom: pay ? "salary" : inc ? inc.rule.note || "Income" : null,
		short: pool <= 0 ? -pool : 0,
		moneyPerDay,
		limit,
		byLimit
	};
}
function safeLine(state, today, fmt) {
	const s = safeToSpend(state, today);
	if (s.pool <= 0) return `🔴 Nothing safe to spend until ${shortDay(s.payday)}: bills and savings need ${fmt(s.short)} more.`;
	if (s.limit && s.limit.left <= 0 && s.leftToday <= 0) return `🔴 Your ${fmt(s.limit.amount)} limit for the month is used up${s.limit.left < 0 ? ` (${fmt(-s.limit.left)} over)` : ""}.`;
	if (s.leftToday >= 0) return `${s.leftToday >= s.perDay / 4 ? "🟢" : "🟡"} Safe to spend today: <b>${fmt(s.leftToday)}</b> left (of ${fmt(s.perDay)})`;
	return `🟠 ${fmt(-s.leftToday)} over today's ${fmt(s.perDay)}. From tomorrow: ${fmt(s.tomorrow)} a day until ${shortDay(s.payday)}.`;
}
var shortDay = (iso) => `${Number(iso.slice(8))} ${[
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec"
][Number(iso.slice(5, 7)) - 1]}`;
// src/renderer/public/apps/finance/js/telegram.js
var fold$1 = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
var INCOME_WORDS = /^(\+|got|earned|income|salary|salariu|venit|primit|зарплата|получил|доход)$/;
var stripIcons = (s) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").trim();
function findAccount(state, words) {
	const accs = state.settings.accounts.filter((a) => !a.archived);
	let best = null;
	for (const a of accs) for (const name of [
		a.name,
		a.bank,
		a.kind === "cash" ? "cash" : null
	].filter(Boolean)) {
		const n = fold$1(name);
		if (n.length < 3) continue;
		if (words.join(" ").includes(n) && (!best || n.length > best.len)) best = {
			id: a.id,
			len: n.length,
			name: n
		};
	}
	return best;
}
function parseQuick(text, state) {
	let t = stripIcons(String(text || "")).replace(/\s+/g, " ").trim();
	if (!t || t.startsWith("/")) return null;
	let type = "expense";
	let daysAgo = 0;
	t = t.replace(/(^|\s)(yesterday|ieri|вчера)(?=\s|$)/i, () => {
		daysAgo = 1;
		return " ";
	}).replace(/\s+/g, " ").trim();
	if (/^\+/.test(t)) {
		type = "income";
		t = t.slice(1).trim();
	}
	const m = t.match(/(^|\s)(\(?\d[\d\s.,]*(?:[+\-*/x×]\s*\(?\d[\d.,]*\)?)*\)?)(?=\s|$|[a-zа-яăâîșț$€]|lei|mdl)/i);
	if (!m) return null;
	const amount = evalAmount(m[2].replace(/\s+/g, ""));
	if (!amount || amount <= 0) return null;
	let rest = `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`.replace(/\b(lei|mdl)\b/gi, "").replace(/\s+/g, " ").trim();
	let words = fold$1(rest).split(" ").filter(Boolean);
	if (words.length && INCOME_WORDS.test(words[0]) && words[0] !== "salary" && words[0] !== "salariu" && words[0] !== "зарплата") {
		type = "income";
		words = words.slice(1);
		rest = rest.split(" ").slice(1).join(" ");
	}
	if (words.some((w) => [
		"salary",
		"salariu",
		"зарплата"
	].includes(w))) type = "income";
	const acc = findAccount(state, words);
	let note = rest;
	if (acc) note = rest.replace(new RegExp(acc.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(/\s+/g, " ").trim();
	const recent = sortTx(state.tx).filter((x) => x.type !== "transfer");
	const same = recent.find((x) => fold$1(x.note) === fold$1(note) && account(state, x.account) && !account(state, x.account).archived);
	const accountId = acc?.id || same?.account || recent[0]?.account || state.settings.accounts[0]?.id;
	const cat = suggestCategory(state, note, type) || (type === "income" ? "other-in" : "other");
	return {
		type,
		amount,
		note,
		account: accountId,
		category: cat,
		...daysAgo ? { daysAgo } : {}
	};
}
var recordDay$1 = (sentDay, f) => f?.daysAgo ? addDays(sentDay, -f.daysAgo) : sentDay;
function recordFromMessage(fields, { updateId, date, rate = 1, currency, now = Date.now() }) {
	return {
		id: `tg-${updateId}`,
		createdAt: now,
		updatedAt: now,
		type: fields.type,
		amount: fields.amount,
		currency,
		rate,
		base: Math.round(fields.amount * rate),
		date,
		category: fields.category,
		account: fields.account,
		note: fields.note,
		source: "telegram"
	};
}
var esc$2 = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;"
})[c]);
var fm = (state, c) => esc$2(formatMoney(Math.round(c / 100) * 100, state.settings.currency));
var spentOn = (state, from, to) => state.tx.filter((t) => t.type === "expense" && !t.loan && t.date >= from && t.date <= to).reduce((a, t) => a + B(t), 0);
function loggedText(state, t, today = null) {
	const c = category(state, t.category)?.name || "";
	const a = account(state, t.account)?.name || "";
	const sign = t.type === "income" ? "+" : "−";
	const alert = budgetAlert(state, t);
	const work = t.type === "expense" ? workText(state, B(t), t.date) : "";
	const lines = [`✅ <b>${sign}${esc$2(formatMoney(t.amount, t.currency))}</b> · ${esc$2(t.note || c)}`, `${esc$2(c)} · ${esc$2(a)}${t.date ? ` · ${dayShort(t.date)}` : ""}`];
	if (work) lines.push(`⏱ ${esc$2(work)} of your work`);
	if (t.type === "expense" && t.date) {
		const key = monthKey(t.date);
		const catMonth = state.tx.filter((x) => x.type === "expense" && !x.loan && x.category === t.category && monthKey(x.date) === key).reduce((s, x) => s + B(x), 0);
		lines.push(`\n📊 Spent that day: <b>${fm(state, spentOn(state, t.date, t.date))}</b> · month: ${fm(state, monthSummary(state, key).expense)}`);
		lines.push(`${esc$2(c || "This category")} this month: ${fm(state, catMonth)}`);
	}
	if (alert) lines.push(`⚠️ ${esc$2(alert.text)}`);
	if (today && t.type === "expense" && (state.recurring?.length || state.tx.length > 10)) lines.push(safeLine(state, today, (c) => fm(state, c)));
	return lines.join("\n");
}
var dayShort = (iso) => `${DOW_SHORT[dowIndex(iso)]} ${Number(iso.slice(8))}`;
// src/renderer/public/apps/finance/js/sync.js
var LOCAL_SETTINGS = [
	"theme",
	"themeMotion",
	"logView"
];
function toCloud(state, deviceId, now = Date.now()) {
	const settings = { ...state.settings };
	for (const k of LOCAL_SETTINGS) delete settings[k];
	return {
		app: "finance-helper",
		schema: 3,
		savedAt: now,
		deviceId,
		data: {
			settings,
			tx: state.tx,
			people: state.people,
			recurring: state.recurring || [],
			invoices: state.invoices || [],
			netWorth: state.netWorth || [],
			goals: state.goals || [],
			goalAllocations: state.goalAllocations || [],
			deleted: state.deleted
		}
	};
}
// src/renderer/src/web/financeBot.ts
var SETTING = "app_sync_finance";
/** Finance Helper's data as every device last synced it (null: never synced). */
function financeState(db) {
	try {
		const saved = JSON.parse(getSetting(db, SETTING) || "null");
		if (saved?.data) return normalizeState({
			...saved.data,
			version: 3
		});
		const legacy = JSON.parse(getSetting(db, "finance_backup_json") || "null");
		return legacy ? normalizeState(legacy) : null;
	} catch {
		return null;
	}
}
function save(db, state) {
	setSetting(db, SETTING, JSON.stringify({
		savedAt: Date.now(),
		data: toCloud(state, "").data
	}));
}
var fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** "Other" is only a last resort: Life System's keyword list (EN/RO/RU) may know better. */
function betterCategory(state, f) {
	const fallback = f.type === "income" ? "other-in" : "other";
	if (f.category && f.category !== fallback) return f.category;
	const guess = detectExpenseCategory(fold(String(f.note || "")));
	const hit = state.settings.categories.find((c) => c.id === guess && c.type === f.type && !c.archived);
	return hit ? hit.id : f.category || fallback;
}
var baseAccounts = (state) => state.settings.accounts.filter((a) => !a.archived && (a.currency || state.settings.currency) === state.settings.currency);
/** The buttons under a logged record: its account, category, undo. */
function moneyKeyboard(state, t, extra = "") {
	const accs = baseAccounts(state).slice(0, 6);
	const rows = [];
	for (let i = 0; i < accs.length; i += 3) rows.push(accs.slice(i, i + 3).map((a) => ({
		text: `${a.id === t.account ? "✓ " : ""}${a.emoji ? a.emoji + " " : ""}${a.name}`,
		callback_data: `fa|${t.id}|${a.id}`
	})));
	rows.push([{
		text: `📂 ${category(state, t.category)?.name || "Category"}`,
		callback_data: `fc|${t.id}`
	}, {
		text: "↩️ Undo",
		callback_data: `fu|${t.id}${extra ? "|" + extra : ""}`
	}]);
	return { inline_keyboard: rows };
}
function categoryKeyboard(state, t) {
	const cats = state.settings.categories.filter((c) => c.type === t.type && !c.archived).slice(0, 18);
	const rows = [];
	for (let i = 0; i < cats.length; i += 3) rows.push(cats.slice(i, i + 3).map((c) => ({
		text: `${c.id === t.category ? "✓ " : ""}${c.emoji ? c.emoji + " " : ""}${c.name}`,
		callback_data: `fk|${t.id}|${c.id}`
	})));
	rows.push([{
		text: "⬅️ Back",
		callback_data: `fb|${t.id}`
	}]);
	return { inline_keyboard: rows };
}
/**
* Logs a money message into Finance Helper's data, or returns null when it
* isn't one (no amount) or Finance Helper was never synced yet.
*/
function logMoney(db, text, key, today, now = Date.now()) {
	const state = financeState(db);
	if (!state) return null;
	const f = parseQuick(text, state);
	if (!f || !(f.amount > 0)) return null;
	f.category = betterCategory(state, f);
	const currency = account(state, f.account)?.currency || state.settings.currency;
	const rate = currency === state.settings.currency ? 1 : Number(state.rates?.[currency]) || 1;
	const tx = recordFromMessage(f, {
		updateId: key.replace(/[^\w-]/g, "-"),
		date: recordDay$1(today, f),
		rate,
		currency,
		now
	});
	if (state.tx.some((x) => x.id === tx.id)) return null;
	state.tx.push(tx);
	save(db, state);
	return {
		tx,
		reply: loggedText(state, tx, today),
		keyboard: moneyKeyboard(state, tx)
	};
}
/** A button under a logged record was tapped: returns the new text and buttons. */
function moneyButton(db, data, today) {
	const [kind, id, arg] = data.split("|");
	const state = financeState(db);
	const t = state?.tx.find((x) => x.id === id);
	if (!state || !t) return {
		text: "↩️ This record is no longer in Finance Helper.",
		toast: "Already removed"
	};
	const now = Date.now();
	if (kind === "fc") return {
		text: loggedText(state, t, today),
		keyboard: categoryKeyboard(state, t),
		toast: "Pick a category"
	};
	if (kind === "fb") return {
		text: loggedText(state, t, today),
		keyboard: moneyKeyboard(state, t),
		toast: ""
	};
	if (kind === "fu") {
		state.tx = state.tx.filter((x) => x.id !== id);
		state.deleted = {
			...state.deleted || {},
			[id]: now
		};
		save(db, state);
		return {
			text: `↩️ <s>${loggedText(state, t, null).split("\n")[0].replace(/<[^>]+>/g, "")}</s>\nRemoved from Finance Helper.`,
			toast: "Undone",
			undoExpense: Number(arg) || void 0
		};
	}
	if (kind === "fa" && account(state, arg)) t.account = arg;
	else if (kind === "fk" && category(state, arg)) t.category = arg;
	else return null;
	t.updatedAt = now;
	save(db, state);
	const what = kind === "fa" ? `From ${account(state, arg).name}` : category(state, arg).name;
	return {
		text: loggedText(state, t, today),
		keyboard: moneyKeyboard(state, t),
		toast: `✓ ${what}`
	};
}
/** The last records (newest first, last 3 days) the coach can point at. */
function recentMoney(db, today, n = 8) {
	const state = financeState(db);
	if (!state) return [];
	const from = (/* @__PURE__ */ new Date(Date.parse(`${today}T12:00:00Z`) - 2592e5)).toISOString().slice(0, 10);
	return state.tx.filter((t) => typeof t.date === "string" && t.date >= from).sort((a, b) => (b.date + String(b.createdAt ?? 0)).localeCompare(a.date + String(a.createdAt ?? 0)) || Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0)).slice(0, n).map((t) => ({
		id: String(t.id),
		line: `${t.date.slice(5)} ${t.type === "income" ? "+" : "−"}${Math.round(Number(t.amount) / 100)} ${t.currency || state.settings.currency} · ${category(state, t.category)?.name || "Other"}${t.note ? ` "${String(t.note).slice(0, 40)}"` : ""} · ${account(state, t.account)?.name || ""}`
	}));
}
/** Removes a record (it syncs as deleted to every device). */
function deleteMoney(db, id) {
	const state = financeState(db);
	const t = state?.tx.find((x) => x.id === id);
	if (!state || !t) return null;
	state.tx = state.tx.filter((x) => x.id !== id);
	state.deleted = {
		...state.deleted || {},
		[id]: Date.now()
	};
	save(db, state);
	return `${t.type === "income" ? "+" : "−"}${Math.round(Number(t.amount) / 100)} ${t.currency || state.settings.currency} ${t.note || category(state, t.category)?.name || ""}`.trim();
}
var fuzzy = (list, name) => {
	const w = fold(name).replace(/[^\p{L}\p{N} ]/gu, "").trim();
	if (!w) return null;
	return list.find((x) => fold(x.name).replace(/[^\p{L}\p{N} ]/gu, "").trim() === w) ?? list.find((x) => fold(x.name).includes(w) || w.includes(fold(x.name))) ?? null;
};
/** Changes a record: amount (in whole units), category, account (by name), note, date. */
function editMoney(db, id, patch) {
	const state = financeState(db);
	const t = state?.tx.find((x) => x.id === id);
	if (!state || !t) return {
		ok: false,
		text: "That record is no longer there"
	};
	const changed = [];
	if (patch.amount != null && patch.amount > 0) {
		t.amount = Math.round(patch.amount * 100);
		t.base = Math.round(t.amount * (Number(t.rate) || 1));
		changed.push(`${patch.amount} ${t.currency || state.settings.currency}`);
	}
	if (patch.category) {
		const c = fuzzy(state.settings.categories.filter((x) => x.type === t.type && !x.archived), patch.category);
		if (!c) return {
			ok: false,
			text: `No category called "${patch.category}"`
		};
		t.category = c.id;
		changed.push(c.name);
	}
	if (patch.account) {
		const a = fuzzy(state.settings.accounts.filter((x) => !x.archived), patch.account);
		if (!a) return {
			ok: false,
			text: `No account called "${patch.account}"`
		};
		t.account = a.id;
		changed.push(`from ${a.name}`);
	}
	if (patch.note != null) {
		t.note = patch.note;
		changed.push(`"${patch.note}"`);
	}
	if (patch.date && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) {
		t.date = patch.date;
		changed.push(patch.date);
	}
	if (!changed.length) return {
		ok: false,
		text: "Nothing to change"
	};
	t.updatedAt = Date.now();
	save(db, state);
	return {
		ok: true,
		text: changed.join(" · ")
	};
}
// src/renderer/src/web/todoistCoins.ts
function payTodoist(s, done) {
	const paid = new Set(s.wallet.entries().map((e) => e.ref ?? "").filter((r) => r.startsWith("todoist:")));
	let n = 0;
	for (const t of done) {
		const ref = `todoist:${t.id}`;
		if (paid.has(ref)) continue;
		try {
			s.wallet.awardRule(TODOIST_RULE, {
				ref,
				note: t.content.slice(0, 120)
			});
			paid.add(ref);
			n++;
		} catch (e) {
			if (!(e instanceof LedgerError)) throw e;
		}
	}
	return n;
}
var toMin$1 = (hm) => {
	const [h, m] = hm.split(":").map(Number);
	return h * 60 + (m || 0);
};
var fromMin$1 = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
/** "2026-11-01T14:30:00+02:00" → "14:30" in local time (the server runs in your time zone). */
function localHM(iso) {
	if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "00:00";
	const d = new Date(iso);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
/** The local day (YYYY-MM-DD) an event starts on. */
function localDay(iso) {
	if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Timed events of one day as minute ranges, clipped to the day window. */
function busy(events, day, from, to) {
	const lo = toMin$1(from);
	const hi = toMin$1(to);
	return events.filter((e) => !e.allDay && localDay(e.start) === day).map((e) => {
		const s = toMin$1(localHM(e.start));
		const en = localDay(e.end) > day ? 1440 : toMin$1(localHM(e.end));
		return [Math.max(lo, s), Math.min(hi, en)];
	}).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
}
/**
* Free time between events (07:00–23:00 by default), from `after` (e.g. now)
* on, at least `minMinutes` long.
*/
function freeGaps(events, day, opts = {}) {
	const from = opts.from ?? "07:00";
	const to = opts.to ?? "23:00";
	const min = opts.minMinutes ?? 25;
	let cursor = Math.max(toMin$1(from), opts.after ? toMin$1(opts.after) : 0);
	const out = [];
	for (const [s, e] of busy(events, day, from, to)) {
		if (s - cursor >= min) out.push({
			start: fromMin$1(cursor),
			end: fromMin$1(s),
			minutes: s - cursor
		});
		cursor = Math.max(cursor, e);
	}
	if (toMin$1(to) - cursor >= min) out.push({
		start: fromMin$1(cursor),
		end: to,
		minutes: toMin$1(to) - cursor
	});
	return out;
}
/**
* Puts each item into the free gaps, in order, with a 10-minute breather
* after each block. Items that don't fit are left out.
*/
function suggestBlocks(gaps, items, breather = 10) {
	const free = gaps.map((g) => ({
		s: toMin$1(g.start),
		e: toMin$1(g.end)
	}));
	const out = [];
	for (const it of items) {
		const need = Math.max(15, Math.round(it.minutes));
		const g = free.find((x) => x.e - x.s >= need);
		if (!g) continue;
		out.push({
			title: it.title,
			start: fromMin$1(g.s),
			end: fromMin$1(g.s + need),
			minutes: need
		});
		g.s += need + breather;
	}
	return out;
}
/** "09:00–10:30 Lecture; 14:00–15:00 Gym" for the coach. */
function agendaText(events, day) {
	const list = events.filter((e) => localDay(e.start) === day).sort((a, b) => a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1);
	if (!list.length) return "nothing in the calendar";
	return list.map((e) => e.allDay ? `all day: ${e.title}` : `${localHM(e.start)}–${localHM(e.end)} ${e.title}`).join("; ");
}
/** Calendar blocks meant for deep work: they become focus sessions. */
var FOCUS_WORDS = /\b(deep|focus|study|studiu|learn\w*|lab\w*|homework|teme?|curs\w*|course\w*|project\w*|proiect\w*|revis\w*|exam\w*|ctf\w*|picoctf|rust|crypto\w*|code|coding|practice|write|writing|read(?:ing)?|cv|portfolio)\b/i;
/** The focus subject of a calendar block: "Algebra: Pass the exam" → "Algebra" (goal blocks count for their goal). */
function blockSubject(title) {
	const t = title.replace(/^[^\p{L}\p{N}]+/u, "").trim();
	return (t.split(/\s*[:·|—]\s*/)[0] || t).slice(0, 40) || "Focus";
}
function isFocusBlock(e) {
	if (e.allDay) return false;
	return !!e.ours || FOCUS_WORDS.test(e.title);
}
// src/core/focusBot.ts
var esc$1 = (s) => s.replace(/[<>&]/g, (c) => ({
	"<": "&lt;",
	">": "&gt;",
	"&": "&amp;"
})[c]);
/** Marker the bot looks for when you reply to the morning question. */
var PLAN_ASK = "What are your 1–3 must-dos today?";
function morningText(o) {
	const lines = ["☀️ <b>Good morning!</b>", ""];
	if (o.focusYesterdayMin) lines.push(`Yesterday: <b>${hm$1(o.focusYesterdayMin)}</b> of focus.`);
	for (const g of o.goalsBehind.slice(0, 2)) lines.push(`🎯 <b>${esc$1(g.title)}</b>: ${-g.aheadH}h behind, needs ~${g.perWeekH}h this week.`);
	if (o.todoistToday) lines.push(`📋 ${o.todoistToday} Todoist task${o.todoistToday === 1 ? "" : "s"} due today (/todo).`);
	if (lines.length > 2) lines.push("");
	lines.push(o.planAlready ? "You already have a plan for today: /plan to see it." : `<b>${PLAN_ASK}</b>\nReply to this message, one per line.`);
	return lines.join("\n");
}
function planText(plan, title = "📝 <b>Today's must-dos</b>") {
	if (!plan.items.length) return `${title}\n\nNo plan yet. Send <code>/plan essay; gym; call Leo</code>.`;
	const done = plan.items.filter((i) => i.done).length;
	const lines = plan.items.map((it, i) => `${it.done ? "✅" : "⬜"} ${i + 1}. ${esc$1(it.text)}`);
	return `${title} (${done}/${plan.items.length})\n\n${lines.join("\n")}\n\n<i>Tap to tick · +10 coins each</i>`;
}
/** Buttons under a plan: tick each must-do; in the evening, what got in the way. */
function planKeyboard(plan, withReasons) {
	const rows = plan.items.map((it, i) => [{
		text: `${it.done ? "✅" : "⬜"} ${i + 1}. ${it.text}`.slice(0, 60),
		callback_data: `pp|${plan.day}|${i}`
	}]);
	if (withReasons && plan.items.some((i) => !i.done)) {
		const rs = REASONS.map((r, i) => ({
			text: `${plan.reasons.includes(r) ? "● " : ""}${r}`,
			callback_data: `pr|${plan.day}|${i}`
		}));
		rows.push(rs.slice(0, 3), rs.slice(3));
	}
	return { inline_keyboard: rows };
}
function eveningText(plan, focusMin) {
	const head = `🌙 <b>Evening review</b> · ${hm$1(focusMin)} of focus today`;
	if (!plan.items.length) return `${head}\n\nNo must-dos today. Tomorrow morning I'll ask again.\nHow was today? Just reply here with one line.`;
	const done = plan.items.filter((i) => i.done).length;
	const verdict = done === plan.items.length ? "All done 🎉 Great day." : `${done}/${plan.items.length} done. Tick what you finished; for the rest, tap what got in the way.`;
	return `${head}\n\n${plan.items.map((it, i) => `${it.done ? "✅" : "⬜"} ${i + 1}. ${esc$1(it.text)}`).join("\n")}\n\n${verdict}`;
}
function weekText(w, goals) {
	const lines = [
		`📊 <b>Your week</b> (${w.from.slice(5)} → ${w.to.slice(5)})`,
		"",
		`⏱ Focus: <b>${hm$1(w.totalMin)}</b>`
	];
	for (const s of w.bySubject.slice(0, 6)) lines.push(`   · ${esc$1(s.subject)}: ${hm$1(s.minutes)}`);
	lines.push(`📝 Must-dos: <b>${w.planDone}/${w.planTotal}</b>${w.planTotal ? ` (${Math.round(w.planDone / w.planTotal * 100)}%)` : ""}`);
	if (w.topReasons.length) lines.push(`🧱 What got in the way: ${w.topReasons.map((r) => `${esc$1(r.reason)} ×${r.count}`).join(", ")}`);
	if (w.funMin) lines.push(`🎮 Fun: ${hm$1(w.funMin)}`);
	for (const g of goals.slice(0, 4)) lines.push(`🎯 ${esc$1(g.title)}: ${hm$1(g.doneMin)} of ${g.hours}h · ${g.aheadH >= 0 ? `${g.aheadH}h ahead` : `${-g.aheadH}h behind`} · ~${g.perWeekH}h/week`);
	lines.push("", "<b>One thing to change next week?</b> Reply here.");
	return lines.join("\n");
}
function goalsText(goals) {
	if (!goals.length) return "🎯 <b>No goals with a deadline yet.</b>\nAdd one in Life System → Focus (e.g. \"Math exam, 15 Jan, 40 h\").";
	return `🎯 <b>Goals</b>\n\n${goals.map((g) => `<b>${esc$1(g.title)}</b> · ${g.daysLeft} days left\n   ${hm$1(g.doneMin)} of ${g.hours}h · ${g.aheadH >= 0 ? `${g.aheadH}h ahead` : `${-g.aheadH}h behind`} · needs ~${g.perWeekH}h/week`).join("\n")}`;
}
// src/core/coachKit.ts
var hm = (iso) => {
	const d = new Date(iso);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
var dayOf = (iso) => {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** E1… for events (time order), T1… for tasks; the lines the model sees. */
function makeRefs(events, tasks) {
	const refs = {
		events: /* @__PURE__ */ new Map(),
		tasks: /* @__PURE__ */ new Map()
	};
	const evLines = events.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 40).map((e, i) => {
		refs.events.set(`E${i + 1}`, e);
		return `E${i + 1} ${dayOf(e.start).slice(5)} ${hm(e.start)}–${hm(e.end)} ${e.title}`;
	});
	const tLines = tasks.slice(0, 60).map((t, i) => {
		refs.tasks.set(`T${i + 1}`, t);
		return `T${i + 1} ${t.content}${t.due ? ` (due ${t.due}${t.dueTime ? ` ${t.dueTime}` : ""})` : ""}${t.priority > 1 ? ` P${5 - t.priority}` : ""}${t.section ? ` [${t.section}]` : ""}${t.labels?.includes("today") ? " ⭐" : ""}`;
	});
	return {
		refs,
		lines: [evLines.length ? `Calendar events (use the E-number):\n${evLines.join("\n")}` : "Calendar events: none (or not connected)", tLines.length ? `Todoist tasks (use the T-number):\n${tLines.join("\n")}` : "Todoist tasks: none (or not connected)"].join("\n")
	};
}
/** Plans, reviews, reshuffles and "why" questions get the slower, deeper model. */
function isBigAsk(text) {
	const t = text.toLowerCase();
	return t.length > 160 || /\b(plan|replan|re-plan|schedule|reschedule|shift|move everything|organi[sz]e|review|analy[sz]|why|strategy|week|month|budget|prioriti[sz]e|clean up|what should i|help me (decide|figure))\b/.test(t);
}
var REMINDERS = "coach_reminders";
var NUDGES = "coach_nudges";
function addReminder(list, r, now = /* @__PURE__ */ new Date()) {
	const id = `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	return [...list.filter((x) => !x.done || Date.parse(x.at) > now.getTime() - 6912e5), {
		...r,
		id,
		createdAt: now.toISOString()
	}].slice(-60);
}
/** Reminders to send now. */
function dueReminders(list, now = /* @__PURE__ */ new Date()) {
	return list.filter((r) => !r.done && Date.parse(r.at) <= now.getTime() && Date.parse(r.at) > now.getTime() - 216e5);
}
/**
* After sending: a plain reminder is done; a follow-up check-in comes back
* in 45 minutes (up to 4 times) unless you answered since.
*/
function afterSend(list, id, now = /* @__PURE__ */ new Date()) {
	return list.map((r) => {
		if (r.id !== id) return r;
		const tries = (r.tries ?? 0) + 1;
		if (r.kind === "checkin" && r.follow && tries < 4) return {
			...r,
			tries,
			sentAt: now.toISOString(),
			at: new Date(now.getTime() + 27e5).toISOString()
		};
		return {
			...r,
			tries,
			sentAt: now.toISOString(),
			done: true,
			...r.kind === "checkin" && r.follow ? { ignored: true } : {}
		};
	});
}
/** You wrote to the coach: open follow-ups stop. */
function answered(list, now = /* @__PURE__ */ new Date()) {
	return list.map((r) => !r.done && r.sentAt && Date.parse(r.sentAt) <= now.getTime() ? {
		...r,
		done: true,
		ignored: false,
		answeredAt: now.toISOString()
	} : r);
}
/**
* "Follow up until I act": between 09:00 and 21:30, when nothing is running,
* something is open and you've been idle 60+ minutes, nudge, then again every
* 45 minutes. Never while paused or snoozed, at most 8 a day.
*/
function shouldNudge(st, f, now = /* @__PURE__ */ new Date()) {
	if (st.pausedDay === f.today) return false;
	if (st.snoozeUntil && Date.parse(st.snoozeUntil) > now.getTime()) return false;
	if (f.time < "09:00" || f.time > "21:30") return false;
	if (f.focusRunning) return false;
	if (f.openMustDos === 0 && f.focusMinToday >= 50) return false;
	if (f.idleMin < 60) return false;
	if ((st.day === f.today ? st.count ?? 0 : 0) >= 8) return false;
	if (st.lastAt && now.getTime() - Date.parse(st.lastAt) < 27e5) return false;
	return true;
}
function nudged(st, today, now = /* @__PURE__ */ new Date()) {
	return {
		...st,
		lastAt: now.toISOString(),
		day: today,
		count: (st.day === today ? st.count ?? 0 : 0) + 1,
		announced: st.day === today ? st.announced : []
	};
}
/** He's saying something went wrong ("that's not money", "undo", "wrong amount", "nu e bine"). */
function isCorrection(text) {
	const t = text.toLowerCase();
	return /\b(wrong|mistake|not money|not an expense|that'?s water|undo|delete (it|that)|remove (it|that)|fix (it|that)|incorrect|shouldn'?t (be|have)|didn'?t (spend|buy|pay)|greșit|gresit|nu e (bine|corect)|nu sunt bani|șterge|sterge|неправильно|удали|ошибка|не деньги)\b/.test(t) || /\bnot money\b|\bthats water\b|\bthat's water\b/.test(t.replace(/[^\w' ]/g, ""));
}
/** Check-ins of the last 2 days without a verdict yet, as P1, P2… for the coach. */
function promiseRefs(list, now = /* @__PURE__ */ new Date()) {
	const refs = /* @__PURE__ */ new Map();
	const lines = list.filter((r) => r.kind === "checkin" && r.sentAt && !r.outcome && Date.parse(r.createdAt) > now.getTime() - 1728e5).slice(-6).map((r, i) => {
		refs.set(`P${i + 1}`, r.id);
		const state = r.answeredAt ? "he answered" : r.ignored ? "IGNORED (no answer to any follow-up)" : `asked ${r.tries ?? 1}×, no answer yet`;
		return `P${i + 1} "${r.text}" (${new Date(r.sentAt).toTimeString().slice(0, 5)}, ${state})`;
	});
	return {
		refs,
		lines: lines.length ? `Promises you're checking (use the P-number):\n${lines.join("\n")}` : ""
	};
}
function setOutcome(list, id, outcome) {
	return list.map((r) => r.id === id ? {
		...r,
		outcome,
		done: true
	} : r);
}
/** The last 7 days of promises: kept, broken, ignored. */
function promiseStats(list, now = /* @__PURE__ */ new Date()) {
	const week = list.filter((r) => r.kind === "checkin" && Date.parse(r.createdAt) > now.getTime() - 6048e5);
	const missed = week.filter((r) => r.outcome === "broken" || r.ignored && r.outcome !== "kept");
	return {
		kept: week.filter((r) => r.outcome === "kept").length,
		broken: week.filter((r) => r.outcome === "broken").length,
		ignored: week.filter((r) => r.ignored && !r.outcome).length,
		open: week.filter((r) => !r.done).length,
		misses: missed.slice(-5).reverse().map((r) => r.text)
	};
}
/** One line for the coach (and the escalating follow-ups). */
function promiseLine(s) {
	if (!s.kept && !s.broken && !s.ignored) return "";
	return `Promises in the last 7 days: ${s.kept} kept, ${s.broken} broken, ${s.ignored} ignored${s.misses.length ? `. Missed: ${s.misses.map((m) => `"${m.slice(0, 60)}"`).join(", ")}` : ""}.`;
}
/** The follow-up gets sharper each time, and names the pattern when there is one. */
function followUpText(r, s) {
	const tries = r.tries ?? 0;
	const misses = s.broken + s.ignored;
	if (tries === 0) return `🔔 ${r.text}`;
	if (tries === 1) return `🔔 ${r.text}\n<i>Asking again. "Not yet" is an answer too.</i>`;
	if (tries === 2) return `⏰ ${r.text}\n<b>Third time.</b>${misses ? ` ${misses} promise${misses === 1 ? "" : "s"} missed this week already.` : ""} Answer me.`;
	return `🚨 Last call: ${r.text}\n${misses ? `This would be miss #${misses + 1} this week. ` : ""}You said you'd do it. Do it now, or tell me why not.`;
}
// src/renderer/src/sportTrack.ts
var KEY = "life_sport_tracker_v1";
var sportDay = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
/** Sport Track's data with today's checklist (reset if its day has passed). */
function readSport() {
	try {
		const s = JSON.parse(localStorage.getItem(KEY) || "null");
		if (!s || !Array.isArray(s.exercises)) return s;
		if (s.lastDate !== sportDay()) {
			s.lastDate = sportDay();
			s.exercises.forEach((e) => e.doneToday = 0);
			if (s.water) s.water.currentMl = 0;
		}
		return s;
	} catch {
		return null;
	}
}
/** Changes Sport Track's data and tells its open page to reload. */
function updateSport(fn) {
	const s = readSport();
	if (!s) return null;
	fn(s);
	try {
		localStorage.setItem(KEY, JSON.stringify(s));
	} catch {
		return null;
	}
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("life-sport-changed"));
	return s;
}
/** The exercise a name like "pushups", "Push-ups" or "ex_situps" means. */
function findExercise(s, name) {
	const key = name.toLowerCase().replace(/[^a-z]/g, "");
	if (!key || !Array.isArray(s?.exercises)) return null;
	return s.exercises.find((e) => {
		const id = String(e.id ?? "").toLowerCase().replace(/[^a-z]/g, "");
		const n = String(e.name ?? "").toLowerCase().replace(/[^a-z]/g, "");
		return id.includes(key) || n.includes(key) || n.length > 3 && key.includes(n);
	}) ?? null;
}
// src/core/goalPlan.ts
var round5 = (m) => Math.ceil(m / 5) * 5;
/** Minutes a day to finish `leftMin` in `days` days. */
var perDay = (leftMin, days) => leftMin <= 0 ? 0 : round5(leftMin / Math.max(1, days));
/** The plan for one goal, from its progress (hours done) and today's focus on it. */
function planGoal(g, today, todayMin = 0) {
	const leftMin = Math.max(0, Math.round(g.hours * 60 - g.doneMin));
	const daysLeft = Math.max(0, daysBetween$1(today, g.deadline));
	const pd = perDay(leftMin + todayMin, daysLeft);
	const status = leftMin === 0 ? "done" : daysLeft === 0 ? "late" : g.aheadH >= 1 ? "ahead" : g.aheadH <= -1 ? "behind" : "on track";
	const milestones = [];
	if (leftMin > 0 && daysLeft > 0) {
		const doneH = g.doneMin / 60;
		const last = addDays$1(g.deadline, -1);
		let d = today;
		while (d <= last && milestones.length < 12) {
			const wd = (/* @__PURE__ */ new Date(`${d}T12:00:00Z`)).getUTCDay();
			const sunday = addDays$1(d, (7 - wd) % 7);
			const by = sunday < last ? sunday : last;
			const daysTo = daysBetween$1(today, by) + 1;
			const target = Math.min(g.hours, doneH + (leftMin + todayMin) / 60 * (daysTo / daysLeft) - todayMin / 60);
			milestones.push({
				by,
				targetH: Math.round(target * 10) / 10,
				state: milestones.length === 0 ? "now" : "next"
			});
			d = addDays$1(by, 1);
		}
	}
	return {
		goalId: g.id,
		title: g.title,
		subject: g.subject,
		deadline: g.deadline,
		leftMin,
		daysLeft,
		perDayMin: pd,
		todayLeftMin: Math.max(0, pd - todayMin),
		status,
		aheadH: g.aheadH,
		milestones
	};
}
/** What missing today costs: the per-day minutes from tomorrow if nothing more is done today. */
function missCost(p) {
	if (p.daysLeft <= 1 || p.todayLeftMin <= 0) return 0;
	return Math.max(0, perDay(p.leftMin, p.daysLeft - 1) - p.perDayMin);
}
/** The block title: the subject first (so the focus timer counts it for the goal). */
var goalBlockTitle = (p) => `${p.subject}: ${p.title}`;
/** Is this calendar event one of our blocks for this goal? */
var isGoalBlock = (e, p) => !!e.ours && e.title.trim() === goalBlockTitle(p);
/**
* Blocks for the next `days` days (today from `now`), in free time between
* 08:00 and 22:00: each goal's minutes per day, in chunks of 25–90 minutes,
* the most urgent goal first.
*/
function bookBlocks(plans, events, today, now, days = 7) {
	const out = [];
	const urgent = plans.filter((p) => p.leftMin > 0 && p.daysLeft > 0).sort((a, b) => a.daysLeft - b.daysLeft || a.aheadH - b.aheadH);
	for (let i = 0; i < days; i++) {
		const day = addDays$1(today, i);
		const items = [];
		for (const p of urgent) {
			if (day >= p.deadline) continue;
			const need = i === 0 ? p.todayLeftMin : p.perDayMin;
			if (need < 20) continue;
			const n = Math.ceil(need / 90);
			const chunk = Math.max(25, round5(need / n));
			for (let k = 0; k < n; k++) items.push({
				title: goalBlockTitle(p),
				minutes: chunk,
				goalId: p.goalId
			});
		}
		if (!items.length) continue;
		const placed = suggestBlocks(freeGaps(events, day, {
			from: "08:00",
			to: "22:00",
			...i === 0 ? { after: now } : {},
			minMinutes: 25
		}), items);
		for (const b of placed) out.push({
			goalId: items.find((x) => x.title === b.title).goalId,
			title: b.title,
			day,
			start: b.start,
			minutes: b.minutes
		});
	}
	return out;
}
/** One line per goal for the coach and the evening review. */
function planLine(p) {
	if (p.status === "done") return `${p.title}: done 🎉`;
	if (p.status === "late") return `${p.title}: deadline reached, ${(p.leftMin / 60).toFixed(1)}h still open`;
	const cost = missCost(p);
	return `${p.title} (${p.subject}, due ${p.deadline}, ${p.daysLeft} days): ${(p.leftMin / 60).toFixed(1)}h left → ${p.perDayMin} min/day${p.todayLeftMin ? `, ${p.todayLeftMin} min still today` : ", today done"}${p.status === "behind" ? `, ${Math.abs(p.aheadH)}h behind` : p.status === "ahead" ? `, ${p.aheadH}h ahead` : ""}${cost ? `. Skipping today costs +${cost} min/day` : ""}`;
}
// src/core/coachMind.ts
var MAX = {
	goals: 8,
	works: 12,
	fails: 12,
	patterns: 10
};
var norm$1 = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
var clip = (t, n = 160) => String(t ?? "").trim().slice(0, n);
function cleanMind(m) {
	const list = (x) => Array.isArray(x) ? x.filter((e) => e && typeof e.t === "string").map((e) => ({
		t: clip(e.t),
		at: String(e.at ?? "")
	})) : [];
	return {
		goals: Array.isArray(m?.goals) ? m.goals.filter((g) => g && typeof g.title === "string").map((g) => ({
			title: clip(g.title, 120),
			deadline: /^\d{4}-\d{2}-\d{2}$/.test(g.deadline) ? g.deadline : "",
			weekly: clip(g.weekly ?? "", 80),
			at: String(g.at ?? "")
		})) : [],
		works: list(m?.works),
		fails: list(m?.fails),
		patterns: list(m?.patterns)
	};
}
/** Reads "aim: …", "aimdone: …", "works: …", "fails: …", "pattern: …" (the coach's memory actions). */
function readMindOp(line) {
	const m = /^\s*(aim|aimdone|works|fails|pattern)\s*:\s*([\s\S]+)$/i.exec(line);
	if (!m) return null;
	const kind = m[1].toLowerCase();
	const arg = m[2].trim();
	if (!arg) return null;
	if (kind === "aim") {
		const [title, deadline = "", weekly = ""] = arg.split("|").map((x) => x.trim());
		if (!title) return null;
		return {
			kind: "aim",
			title: clip(title, 120),
			deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : "",
			weekly: clip(weekly.replace(/^-$/, ""), 80)
		};
	}
	if (kind === "aimdone") return {
		kind: "aimdone",
		title: clip(arg, 120)
	};
	return {
		kind,
		text: clip(arg)
	};
}
var sameIdea = (a, b) => {
	const x = norm$1(a);
	const y = norm$1(b);
	return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};
/** Applies one memory change; the newest version of an idea replaces the old one. */
function applyMind(mind, op, today) {
	const m = cleanMind(mind);
	if (op.kind === "aim") {
		const goals = m.goals.filter((g) => !sameIdea(g.title, op.title));
		goals.push({
			title: op.title,
			deadline: op.deadline,
			weekly: op.weekly,
			at: today
		});
		return {
			mind: {
				...m,
				goals: goals.slice(-MAX.goals)
			},
			line: `🎯 Tracking: ${op.title}${op.deadline ? ` by ${op.deadline}` : ""}${op.weekly ? ` · ${op.weekly}/week` : ""}`
		};
	}
	if (op.kind === "aimdone") {
		const hit = m.goals.find((g) => sameIdea(g.title, op.title));
		if (!hit) return {
			mind: m,
			line: ""
		};
		return {
			mind: {
				...m,
				goals: m.goals.filter((g) => g !== hit)
			},
			line: `🏁 Goal closed: ${hit.title}`
		};
	}
	const key = op.kind === "pattern" ? "patterns" : op.kind;
	const list = m[key].filter((x) => !sameIdea(x.t, op.text));
	const other = op.kind === "works" ? "fails" : op.kind === "fails" ? "works" : null;
	const next = {
		...m,
		[key]: [...list, {
			t: op.text,
			at: today
		}].slice(-MAX[key])
	};
	if (other) next[other] = next[other].filter((x) => !sameIdea(x.t, op.text));
	return {
		mind: next,
		line: `${op.kind === "works" ? "🧠 Noted what works" : op.kind === "fails" ? "🧠 Noted what doesn't work" : "🧠 Noted a pattern"}: ${op.text}`
	};
}
var daysTo = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5);
/** "6h focus" → focus 3h20 of 6h (56%); "3 workouts" → 1 of 3. Null when the target isn't something measured. */
function goalProgress(weekly, w) {
	const t = weekly.toLowerCase();
	const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|hours?|ore|часов|ч)\b/.exec(t);
	if (hours && !/(sleep|somn|сон)/.test(t)) {
		const target = Number(hours[1].replace(",", ".")) * 60;
		const pct = Math.round(w.focusMin / Math.max(1, target) * 100);
		const need = Math.max(0, target - w.focusMin);
		return `this week ${(w.focusMin / 60).toFixed(1)}h of ${target / 60}h (${pct}%)${need ? `, ${Math.round(need / Math.max(1, w.daysLeft))} min/day needed for ${w.daysLeft} days` : ", done"}`;
	}
	const n = /(\d+)\s*(workouts?|runs?|trainings?|gym|sessions?|antrenament\w*|тренировк\w*)/.exec(t);
	if (n) return `this week ${w.workouts} of ${n[1]} workouts`;
	const k = /(\d+)\s*(tasks?|sarcini|задач\w*)/.exec(t);
	if (k) return `this week ${w.tasks} of ${k[1]} tasks`;
	return null;
}
/** The mind as prompt lines (with this week's progress on each tracked goal when known). */
function mindText(m, today, week) {
	const out = [];
	if (m.goals.length) out.push(`Goals you track with him:\n${m.goals.map((g) => {
		const left = g.deadline ? daysTo(today, g.deadline) : null;
		const prog = g.weekly && week ? goalProgress(g.weekly, week) : null;
		return `- ${g.title}${g.deadline ? ` · due ${g.deadline} (${left < 0 ? `${-left} days late` : `${left} days left`})` : ""}${g.weekly ? ` · weekly target ${g.weekly}` : ""}${prog ? ` · ${prog}` : ""}`;
	}).join("\n")}`);
	if (m.works.length) out.push(`What works for him:\n${m.works.map((x) => `- ${x.t}`).join("\n")}`);
	if (m.fails.length) out.push(`What doesn't work:\n${m.fails.map((x) => `- ${x.t}`).join("\n")}`);
	if (m.patterns.length) out.push(`Patterns you noticed:\n${m.patterns.map((x) => `- ${x.t}`).join("\n")}`);
	return out.join("\n");
}
var WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday"
];
var wd = (day) => (/* @__PURE__ */ new Date(`${day}T12:00:00Z`)).getUTCDay();
var avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
/**
* What his last 8 weeks say: focus after a late night vs an on-time one,
* after a late wake-up, on workout days, his best and worst weekday, and
* weekend vs weekday spending. Only differences that are big (≥25%) and
* seen enough (≥3 days each side) count.
*/
function findPatterns(p, weeks = 8) {
	const from = addDays$1(p.today, -weeks * 7);
	const days = [];
	for (let d = from; d < p.today; d = addDays$1(d, 1)) days.push(d);
	const focusBy = /* @__PURE__ */ new Map();
	for (const f of p.focus) if (f.day >= from && f.day < p.today) focusBy.set(f.day, (focusBy.get(f.day) ?? 0) + f.minutes);
	const firstFocus = [...focusBy.keys()].sort()[0];
	const active = firstFocus ? days.filter((d) => d >= firstFocus) : [];
	const fm = (d) => focusBy.get(d) ?? 0;
	const out = [];
	const compare = (label, a, b, aName, bName) => {
		if (a.length < 3 || b.length < 3) return;
		const x = avg(a.map(fm));
		const y = avg(b.map(fm));
		if (Math.max(x, y) < 15) return;
		const diff = (x - y) / Math.max(x, y);
		if (Math.abs(diff) < .25) return;
		out.push(`${label}: ${Math.round(x)} min focus on ${aName} vs ${Math.round(y)} min on ${bName} (${a.length} vs ${b.length} days).`);
	};
	const sleep = new Map(p.sleep.map((s) => [s.day, s]));
	compare("After a late night", active.filter((d) => sleep.get(d)?.bedOnTime === false), active.filter((d) => sleep.get(d)?.bedOnTime === true), "days after a late bedtime", "days after an on-time one");
	compare("Late wake-ups", active.filter((d) => sleep.get(d)?.onTime === false), active.filter((d) => sleep.get(d)?.onTime === true), "late-wake days", "on-time days");
	const wset = new Set(p.workouts.map((w) => w.day));
	compare("Training", active.filter((d) => wset.has(d)), active.filter((d) => !wset.has(d)), "workout days", "rest days");
	compare("Sleep quality", active.filter((d) => (sleep.get(d)?.quality ?? 0) > 0 && sleep.get(d).quality <= 2), active.filter((d) => (sleep.get(d)?.quality ?? 0) >= 4), "days after poor sleep (1–2/5)", "after good sleep (4–5/5)");
	if (active.length >= 21) {
		const by = WEEKDAYS.map((_, i) => avg(active.filter((d) => wd(d) === i).map(fm)));
		const best = by.indexOf(Math.max(...by));
		const worst = by.indexOf(Math.min(...by));
		if (by[best] >= 20 && by[best] - by[worst] >= Math.max(20, by[best] * .4)) out.push(`Best focus day: ${WEEKDAYS[best]} (${Math.round(by[best])} min avg); weakest: ${WEEKDAYS[worst]} (${Math.round(by[worst])} min).`);
	}
	if (p.spending?.length) {
		const spend = /* @__PURE__ */ new Map();
		for (const s of p.spending) if (s.day >= from && s.day < p.today) spend.set(s.day, (spend.get(s.day) ?? 0) + s.bani);
		const firstSpend = [...spend.keys()].sort()[0];
		const sd = firstSpend ? days.filter((d) => d >= firstSpend) : [];
		const we = sd.filter((d) => wd(d) === 0 || wd(d) === 6).map((d) => spend.get(d) ?? 0);
		const wk = sd.filter((d) => wd(d) > 0 && wd(d) < 6).map((d) => spend.get(d) ?? 0);
		if (we.length >= 4 && wk.length >= 10) {
			const a = avg(we);
			const b = avg(wk);
			if (Math.max(a, b) >= 5e3 && Math.abs(a - b) / Math.max(a, b) >= .3) out.push(`Spending: ${Math.round(a / 100)} lei/day on weekends vs ${Math.round(b / 100)} lei/day on weekdays.`);
		}
	}
	return out;
}
/** The last nights in one line each: "10-30 bed 00:40 (late) → up 07:20 (late) · 3/5". */
function sleepDiary(logs, today, nights = 7) {
	const from = addDays$1(today, -nights);
	const rows = logs.filter((l) => l.day > from && l.day <= today).sort((a, b) => a.day < b.day ? -1 : 1);
	if (!rows.length) return "Sleep diary: nothing logged in the last week.";
	return `Sleep diary (bedtime is the night before): ${rows.map((l) => `${l.day.slice(5)} ${l.bedTime ? `bed ${l.bedTime}${l.bedOnTime === false ? " (late)" : ""} → ` : ""}up ${l.wakeTime}${l.onTime ? "" : " (late)"}${l.quality ? ` · ${l.quality}/5` : ""}`).join("; ")}.`;
}
/** The week ahead from calendar events: per day, how many blocks and busy hours. */
function weekAhead(events, today, days = 7) {
	const local = (iso) => {
		const d = new Date(iso);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	};
	const parts = [];
	for (let i = 1; i <= days; i++) {
		const day = addDays$1(today, i);
		const list = events.filter((e) => !e.allDay && local(e.start) === day);
		const allDay = events.filter((e) => e.allDay && String(e.start).slice(0, 10) === day);
		const min = list.reduce((t, e) => t + Math.max(0, (Date.parse(e.end) - Date.parse(e.start)) / 6e4), 0);
		const name = WEEKDAYS[wd(day)].slice(0, 3);
		parts.push(list.length || allDay.length ? `${name} ${day.slice(5)}: ${list.length} blocks, ${Math.round(min / 6) / 10}h busy${allDay.length ? ` (${allDay.map((e) => e.title).join(", ")})` : ""}` : `${name} ${day.slice(5)}: free`);
	}
	return `Next ${days} days: ${parts.join("; ")}.`;
}
/** Focus minutes per subject since `from` (for "where his study time goes"). */
function focusBySubject(sessions, from) {
	const by = /* @__PURE__ */ new Map();
	for (const s of sessions) if (s.day >= from) by.set(s.subject, (by.get(s.subject) ?? 0) + s.minutes);
	if (!by.size) return "";
	const hm = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
	return [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, m]) => `${s} ${hm(m)}`).join(", ");
}
/** Monday-to-today numbers from the history lists. */
function weekSoFar(today, focus, workouts, tasks) {
	const wdN = (/* @__PURE__ */ new Date(`${today}T12:00:00Z`)).getUTCDay();
	const monday = addDays$1(today, -((wdN + 6) % 7));
	const inWeek = (d) => d >= monday && d <= today;
	return {
		focusMin: focus.filter((f) => inWeek(f.day)).reduce((t, f) => t + f.minutes, 0),
		workouts: new Set(workouts.filter((x) => inWeek(x.day)).map((x) => x.day)).size,
		tasks: tasks.filter((x) => inWeek(x.day)).length,
		daysLeft: 7 - (wdN + 6) % 7
	};
}
// src/core/sportShared.ts
var sportToday = (now = /* @__PURE__ */ new Date()) => now.toISOString().slice(0, 10);
/** A new day starts a fresh checklist (reps and water back to 0). */
function sportForDay(st, today) {
	const s = st && typeof st === "object" ? JSON.parse(JSON.stringify(st)) : {};
	if (!Array.isArray(s.exercises)) s.exercises = [];
	if (!s.water || typeof s.water !== "object") s.water = {
		currentMl: 0,
		targetMl: 2700,
		glassSizeMl: 250
	};
	if (s.lastDate !== today) {
		s.lastDate = today;
		s.exercises.forEach((e) => e.doneToday = 0);
		s.water.currentMl = 0;
	}
	return s;
}
function sharedView(st, today) {
	const s = sportForDay(st, today);
	return {
		date: today,
		water: {
			ml: Math.max(0, Math.round(Number(s.water.currentMl) || 0)),
			target: Number(s.water.targetMl) || 2700,
			glass: Number(s.water.glassSizeMl) || 250
		},
		exercises: s.exercises.map((e) => ({
			id: String(e.id ?? e.name),
			name: String(e.name ?? e.id),
			target: Number(e.target) || 0,
			done: Number(e.doneToday) || 0
		}))
	};
}
/** Adds (or with a negative amount, removes) water; never below 0. */
function addWater(st, ml, today) {
	const s = sportForDay(st, today);
	s.water.currentMl = Math.max(0, Math.round((Number(s.water.currentMl) || 0) + ml));
	return s;
}
var key = (x) => String(x ?? "").toLowerCase().replace(/[^a-z]/g, "");
/** The exercise "pushups", "Push-ups" or "push up" means. */
function findSharedExercise(s, name) {
	const k = key(name).replace(/s$/, "");
	if (!k) return null;
	return (s.exercises ?? []).find((e) => {
		const id = key(e.id).replace(/s$/, "");
		const n = key(e.name).replace(/s$/, "");
		return id === k || n === k || id.includes(k) || n.includes(k) || n.length > 3 && k.includes(n);
	}) ?? null;
}
/** Adds reps to an exercise (removes with a negative amount, never below 0); null if it doesn't exist. */
function addReps(st, name, amount, today) {
	const s = sportForDay(st, today);
	const ex = findSharedExercise(s, name);
	if (!ex) return null;
	ex.doneToday = Math.max(0, (Number(ex.doneToday) || 0) + Math.round(amount));
	return {
		st: s,
		exercise: {
			name: String(ex.name ?? ex.id),
			done: ex.doneToday,
			target: Number(ex.target) || 0
		}
	};
}
/**
* "water 500", "500 ml", "+250ml", "apă 0.5 l", "2 glasses of water", "вода 300":
* how much water a short message means (ml), or null. A small number with
* "water" and no unit ("water 15") is a bottle bought (money), not drunk.
*/
function parseWater(text, glass = 250) {
	const t = text.trim().toLowerCase();
	if (t.length > 40 || /\b(lei|mdl|ron|leu|\$|€|usd|eur)\b/.test(t)) return null;
	const word = /(water|apa|apă|вод[аыу]|drank|drink)/.test(t);
	const glasses = /(\d{1,2})\s*(glass(es)?|pahar(e)?|стакан\w*|cups?)/.exec(t);
	if (glasses && (word || /^\+?\s*\d/.test(t))) return Math.min(3e3, Number(glasses[1]) * glass);
	const unit = /([+-]?\d+(?:[.,]\d+)?)\s*(ml|l|л|мл)\b/.exec(t);
	if (unit) {
		const n = Number(unit[1].replace(",", "."));
		const ml = /^(l|л)$/.test(unit[2]) ? n * 1e3 : n;
		if (Math.abs(ml) >= 50 && Math.abs(ml) <= 3e3 && (word || t.replace(unit[0], "").trim().replace(/^\+/, "") === "")) return Math.round(ml);
		return null;
	}
	const bare = /^(?:\+?\s*)?(?:water|apa|apă|вода)\s*\+?(\d{2,4})$|^\+?(\d{2,4})\s*(?:water|apa|apă|вода)$/.exec(t);
	const n = Number(bare?.[1] ?? bare?.[2]);
	return bare && n >= 100 && n <= 3e3 ? n : null;
}
// src/renderer/src/web/botBrain.ts
var MEMORY = "coach_memory";
function loadMemory(db) {
	try {
		const m = JSON.parse(getSetting(db, MEMORY) || "null");
		return {
			facts: Array.isArray(m?.facts) ? m.facts : [],
			chat: Array.isArray(m?.chat) ? m.chat : []
		};
	} catch {
		return {
			facts: [],
			chat: []
		};
	}
}
function saveMemory(db, m) {
	setSetting(db, MEMORY, JSON.stringify({
		facts: m.facts.slice(-40),
		chat: m.chat.slice(-24)
	}));
}
/** Adds facts (no near-duplicates) and conversation turns, keeping the newest. */
function updateMemory(m, add, now = /* @__PURE__ */ new Date()) {
	const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
	const facts = m.facts.slice();
	for (const f of add.facts ?? []) {
		const t = String(f).trim().slice(0, 200);
		if (!t) continue;
		const n = norm(t);
		const i = facts.findIndex((x) => norm(x.t) === n || norm(x.t).includes(n) || n.includes(norm(x.t)));
		if (i >= 0) facts.splice(i, 1);
		facts.push({
			t,
			at: now.toISOString().slice(0, 10)
		});
	}
	return {
		facts: facts.slice(-40),
		chat: [...m.chat, ...add.turns ?? []].slice(-24)
	};
}
var PROFILE = "coach_profile";
var DEFAULT_PROFILE = {
	about: "",
	goals: [
		"Top university results: pass every exam and lab well and on time",
		"A cyber security career: CTFs, Rust, crypto, a portfolio, a job",
		"A strong body and good health: training, sleep, skin, teeth",
		"Money and discipline: spend with intention, save, keep the clean streak"
	],
	rules: []
};
function loadProfile(db) {
	try {
		const p = JSON.parse(getSetting(db, PROFILE) || "null");
		if (!p) return DEFAULT_PROFILE;
		return {
			about: String(p.about ?? ""),
			goals: Array.isArray(p.goals) ? p.goals.map(String) : [],
			rules: Array.isArray(p.rules) ? p.rules.map(String) : []
		};
	} catch {
		return DEFAULT_PROFILE;
	}
}
var LOG = "coach_log";
function loadLog(db) {
	try {
		const l = JSON.parse(getSetting(db, LOG) || "[]");
		return Array.isArray(l) ? l : [];
	} catch {
		return [];
	}
}
function appendLog(db, entries) {
	setSetting(db, LOG, JSON.stringify([...loadLog(db), ...entries].slice(-200)));
}
/** Which coach a bot is, from its token's id. */
function personaFor(botId, cfg) {
	const id = (t) => t && t.includes(":") ? t.split(":")[0] : "";
	if (botId === id(cfg.financeBotToken)) return "finance";
	if (botId === id(cfg.manBotToken) || botId === id(cfg.wakyBotToken)) return "waky";
	if (botId === id(cfg.sportBotToken) || botId === id(cfg.botToken)) return "sport";
	return "mega";
}
/**
* Short, clear logs keep the fast path ("taxi 45", "30 pushups", "coffee 35
* maib"): one number, a few words. Anything longer is for the brain.
*/
function isSimpleLog(text) {
	const t = text.trim();
	if (t.startsWith("/")) return true;
	const nums = t.match(/\d+(?:[.,]\d+)?/g) ?? [];
	const words = t.split(/\s+/).filter(Boolean);
	return nums.length >= 1 && nums.length <= 2 && words.length <= 5 && !/[?]/.test(t) && !/\b(and|și|si|и|then|also|plus)\b/i.test(t);
}
/** Finance Helper's saved state on this device, else the copy synced to Turso. */
function financeStateFrom(db, store) {
	try {
		const local = store?.getItem("finance-helper.state");
		if (local) return JSON.parse(local);
	} catch {}
	try {
		const synced = JSON.parse(getSetting(db, "app_sync_finance") || "null");
		if (synced?.data) return synced.data;
	} catch {}
	try {
		return JSON.parse(getSetting(db, "finance_backup_json") || "null");
	} catch {
		return null;
	}
}
/** The last focus session ratings (1–5): how focus feels, not just minutes. */
function focusRatings(db) {
	try {
		return JSON.parse(getSetting(db, "focus_ratings") || "[]");
	} catch {
		return [];
	}
}
var lei = (bani) => `${Math.round(bani / 100).toLocaleString("en-US")} lei`;
/** The money picture: this month, this week, today, by category, against the limit. */
function moneyContext(state, today) {
	if (!state || !Array.isArray(state.tx)) return "Money: Finance Helper data not available.";
	const cats = new Map((state.settings?.categories ?? []).map((c) => [String(c.id), String(c.name)]));
	const exp = state.tx.filter((t) => t && t.type === "expense" && !t.deleted && typeof t.date === "string");
	const amt = (t) => Math.abs(Number(t.base ?? t.amount) || 0);
	const month = today.slice(0, 7);
	const weekFrom = addDays$1(today, -6);
	const inMonth = exp.filter((t) => t.date.startsWith(month));
	const byCat = /* @__PURE__ */ new Map();
	for (const t of inMonth) byCat.set(cats.get(String(t.category)) ?? String(t.category ?? "Other"), (byCat.get(cats.get(String(t.category)) ?? String(t.category ?? "Other")) ?? 0) + amt(t));
	const top = [...byCat].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `${c} ${lei(v)}`);
	const monthTotal = inMonth.reduce((s, t) => s + amt(t), 0);
	const weekTotal = exp.filter((t) => t.date >= weekFrom && t.date <= today).reduce((s, t) => s + amt(t), 0);
	const todayTotal = exp.filter((t) => t.date === today).reduce((s, t) => s + amt(t), 0);
	const last = exp.filter((t) => t.date >= weekFrom).slice(-6).map((t) => `${t.date.slice(5)} ${cats.get(String(t.category)) ?? t.category ?? ""} ${t.note ? `"${String(t.note).slice(0, 30)}" ` : ""}${lei(amt(t))}`);
	const limit = state.settings?.limit;
	const daysLeft = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() - Number(today.slice(8)) + 1;
	const limitLine = limit?.on && Number(limit.amount) > 0 ? `Monthly limit ${lei(Number(limit.amount))}: ${Math.round(monthTotal / Number(limit.amount) * 100)}% used, ${lei(Math.max(0, Number(limit.amount) - monthTotal))} left for ${daysLeft} days (${lei(Math.max(0, Number(limit.amount) - monthTotal) / daysLeft)}/day).` : "No monthly limit set.";
	return [
		`Money (MDL): today ${lei(todayTotal)}, last 7 days ${lei(weekTotal)}, this month ${lei(monthTotal)}.`,
		limitLine,
		top.length ? `This month by category: ${top.join(", ")}.` : "",
		last.length ? `Recent expenses: ${last.join("; ")}.` : ""
	].filter(Boolean).join("\n");
}
/** Everything the coach should know about you right now, in plain lines. */
function lifeContext(s, db, extra, now = /* @__PURE__ */ new Date()) {
	const today = s.wallet.today(now);
	const sum = s.wallet.summary();
	const f = s.focus.state(now);
	const disc = s.discipline.state(now);
	const body = s.body.state(now);
	const sl = s.sleep;
	const input = s.progress.input(financeSpending(extra.finance), now);
	const report = progressReport(input);
	const wp = activePlan(s.weekPlan.saved(), today);
	const wakes = input.wakes.filter((w) => w.day > addDays$1(today, -7)).sort((a, b) => a.day < b.day ? -1 : 1);
	const lines = [
		`Now: ${now.toLocaleDateString("en-GB", {
			weekday: "long",
			day: "numeric",
			month: "long"
		})}, ${now.toTimeString().slice(0, 5)}.`,
		`Coins: ${sum.balance} (today +${sum.todayCoins}). Level ${sum.level.level}.`,
		`Focus today: ${hm$1(f.todayMin)}${f.running ? `, RUNNING now on "${f.running.subject}" (${f.running.planned} min planned)` : ""}. Last 7 days ${hm$1(f.week.totalMin)}. Subjects: ${f.subjects.slice(0, 5).join(", ") || "none yet"}.`,
		`Today's must-dos: ${f.plan.items.length ? f.plan.items.map((x) => `${x.done ? "[done]" : "[open]"} ${x.text}`).join("; ") : "none written yet"}.`,
		f.goals.length ? `Goals planned backward from their deadlines (block titles "Subject: goal" count for them):\n${f.goals.map((g) => `- ${planLine(planGoal(g, today, f.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0)))}`).join("\n")}` : "No goals with deadlines (offer to set one when he mentions an exam, project or deadline).",
		`Week score ${report.score}/100 (last week ${report.prevScore}). ${report.verdict}`,
		`Last 7 days: ${report.metrics.map((m) => `${m.label} ${m.text}${m.target ? ` of ${m.targetText}` : ""} (${m.trend})`).join("; ")}.`,
		wp ? `This week's chosen focus: ${wp.focus}${wp.note ? ` ("${wp.note}")` : ""}. Big 3: ${wp.big3.map((b) => `${b.done ? "[done]" : "[open]"} ${b.text}`).join("; ")}.` : "No week plan yet.",
		`Sleep: bedtime target ${sl.bedtimeTarget()}, wake target weekday ${sl.weekdayTarget()} / weekend ${sl.weekendTarget()}. Last wake-ups: ${wakes.map((w) => `${w.day.slice(5)} ${w.onTime ? "on time" : "late"}`).join(", ") || "none logged"}.`,
		wakePattern(input.wakes) ?? "",
		(() => {
			const r = focusRatings(db).filter((x) => x.day > addDays$1(today, -7));
			if (!r.length) return "";
			const avg = r.reduce((t, x) => t + x.rating, 0) / r.length;
			const reasons = f.week.topReasons.map((x) => x.reason).join(", ");
			return `Focus sessions felt ${avg.toFixed(1)}/5 on average this week (${r.length} rated)${reasons ? `; what got in the way: ${reasons}` : ""}.`;
		})(),
		`Discipline: clean streak ${disc.current} days (best ${disc.best}).`,
		`Training: workout streak ${body.streak}, ${body.workoutsThisWeek} workouts this week, total ${body.totalWorkouts}${body.latestWeight ? `, weight ${body.latestWeight} kg` : ""}. Recent: ${s.body.workouts(6).map((w) => `${w.day.slice(5)} ${w.title}`).join("; ") || "none"}.`,
		moneyContext(extra.finance, today),
		...moreContext(s, db, extra.finance, today, input, sum.todayRules ?? [], disc)
	];
	if (extra.events) {
		const nowHM = now.toTimeString().slice(0, 5);
		const gaps = freeGaps(extra.events, today, {
			after: nowHM,
			minMinutes: 30
		});
		lines.push(`Calendar today: ${agendaText(extra.events, today)}. Free time left today: ${gaps.map((g) => `${g.start}–${g.end}`).join(", ") || "none"}.`);
		const tomorrow = addDays$1(today, 1);
		if (extra.events.some((e) => localDay(e.start) === tomorrow)) lines.push(`Calendar tomorrow: ${agendaText(extra.events, tomorrow)}.`);
		if (extra.events.some((e) => localDay(e.start) > tomorrow)) lines.push(weekAhead(extra.events, today));
	}
	if (extra.todoToday) {
		const list = extra.todoToday.slice(0, 8).map((t) => `${t.content}${t.due && t.due < today ? " (late)" : ""}${t.priority >= 3 ? ` P${5 - t.priority}` : ""}${t.section ? ` [${t.section}]` : ""}`);
		lines.push(`Todoist today/late (${extra.todoToday.length}): ${list.join("; ") || "nothing"}.`);
	}
	if (extra.upcoming) {
		const r = deadlineRadar(extra.upcoming, today);
		if (r.length) lines.push(`Deadlines soon: ${r.map((x) => `${x.task.content} ${whenText(x.daysLeft, x.date)}`).join("; ")}.`);
	}
	return lines.filter(Boolean).join("\n");
}
/** The coach's long-term notes (goals it tracks, what works, patterns). */
var MIND = "coach_mind";
function loadMind(db) {
	try {
		return cleanMind(JSON.parse(getSetting(db, MIND) || "null"));
	} catch {
		return cleanMind(null);
	}
}
function saveMind(db, m) {
	setSetting(db, MIND, JSON.stringify(cleanMind(m)));
}
/** Sport Track's shared state (water and reps), if it exists. */
function sportState(db) {
	try {
		return JSON.parse(getSetting(db, "sport_tracker_json") || "null")?.data ?? null;
	} catch {
		return null;
	}
}
/** The rest of what the coach should know: water, reps, habits, sleep diary, focus by subject, patterns, past advice. */
function moreContext(s, db, finance, today, input, todayRules, disc) {
	const out = [];
	const st = sportState(db);
	if (st) {
		const v = sharedView(st, sportToday());
		const reps = v.exercises.map((e) => `${e.name} ${e.done}/${e.target}`).join(", ");
		out.push(`Water today: ${v.water.ml} of ${v.water.target} ml (${Math.round(v.water.ml / Math.max(1, v.water.target) * 100)}%). Reps checklist: ${reps || "none set"}.`);
	}
	const habit = (done, name) => `${done ? "[done]" : "[open]"} ${name}`;
	out.push(`Habits today: ${[
		habit(!!disc.oathToday || todayRules.includes("discipline.oath"), "oath"),
		habit(!!disc.checkedInToday || todayRules.includes("discipline.clean_day"), "clean check-in"),
		habit(todayRules.includes("body.workout_done"), "workout"),
		habit(todayRules.includes("face.routine_done"), "skincare"),
		habit(todayRules.includes("money.logged"), "spending logged")
	].join(", ")}.`);
	let logs = [];
	try {
		logs = s.sleep.logs();
	} catch {
		logs = [];
	}
	out.push(sleepDiary(logs, today));
	let sessions = [];
	try {
		sessions = db.prepare("SELECT day, subject, minutes FROM focus_sessions WHERE day >= ?").all(addDays$1(today, -60)).map((r) => ({
			day: String(r.day),
			subject: String(r.subject),
			minutes: Number(r.minutes)
		}));
	} catch {
		sessions = [];
	}
	const bySub = focusBySubject(sessions, addDays$1(today, -6));
	if (bySub) out.push(`Focus by subject, last 7 days: ${bySub}.`);
	const pats = findPatterns({
		today,
		focus: input.focus,
		sleep: logs.map((l) => ({
			day: l.day,
			onTime: !!l.onTime,
			bedOnTime: l.bedOnTime ?? null,
			quality: l.quality ?? null
		})),
		workouts: input.workouts,
		spending: financeSpending(finance)
	});
	if (pats.length) out.push(`What his own data shows (last 8 weeks):\n${pats.map((p) => `- ${p}`).join("\n")}`);
	const since = addDays$1(today, -4);
	const advice = loadLog(db).filter((e) => e.role === "coach" && e.at.slice(0, 10) >= since).slice(-12, -4).map((e) => `${e.at.slice(5, 10)}: ${e.text.replace(/\s+/g, " ").slice(0, 140)}`);
	if (advice.length) out.push(`Your earlier advice (check if he did it):\n${advice.map((a) => `- ${a}`).join("\n")}`);
	return out;
}
var PERSONA = {
	mega: "You are MEGA, Victor's head coach for his whole life: study (university), cyber security skills, career, sport and training, sleep, discipline and money. You also coach his training: suggest concrete workouts (sets and reps, progressing a little each week), keep his streak alive.",
	finance: "You are the MONEY COACH (Finance bot). Help Victor spend with intention and save: react to spending with context (how often, how much this week/month, against his limit), spot patterns, suggest one concrete change. Logging money is your main job; coaching on money is what makes you useful.",
	waky: "You are WAKY, the SLEEP COACH. Help Victor wake up on time and sleep well: bedtime routine, consistency, sleep debt, patterns (which days go wrong and why). Be concrete about times.",
	sport: "You are the TRAINING COACH. Plan concrete workouts and progressions, keep the streak alive."
};
var ACTIONS = `You can act. Put actions in "actions" (strings), only when Victor asked for it or clearly reported doing it:
Logging and the day:
- "log: <text>" to record something with the app's own parser, one item per action. Money: "<what> <amount>" with the amount LAST (shop names before it), a wallet name may follow: "pizza 120", "groceries Linella 163", "taxi 30 maib", "+500 salary". Workouts: "30 pushups", "run 5 km". Sleep: "/wake 06:40", "/bed". Discipline: "/checkin", "/oath". Body: "/weight 74.5".
- "mustdo: <text>" a must-do for today (also starred in Todoist).
- "focus: <minutes> <subject>" start a focus timer now. "fun: <minutes> <what>" spend points on fun.
- "goal: <title> | <subject> | <YYYY-MM-DD> | <hours>" an exam or project with a deadline and the hours it needs (estimate honestly if he doesn't say). Then "book: <title>" plans it backward from the deadline and books its blocks in his calendar for the next 7 days (they move by themselves when he misses a day). "book: all" re-plans every goal.
Body, sleep and habits (one shared log with Sport Track and Sporty):
- "water: <ml>" add water (a glass is 250, negative removes). "reps: <exercise> | <amount>" reps on today's checklist (pushups, squats…; counts as a workout).
- "sleep: <YYYY-MM-DD> | wake=HH:MM; bed=HH:MM; quality=1-5" fix or fill a night (any of the three; the date is the morning).
- "habit: oath" / "habit: clean" (clean-day check-in) / "habit: skincare".
Money records (use the M-numbers; this is how you FIX a wrong log):
- "delmoney: M2" delete a record. "editmoney: M2 | amount=45; category=Food; account=Maib; note=<text>; date=YYYY-MM-DD" change it.
- Water, reps or anything that is NOT money logged as an expense by mistake: "delmoney" it, then log it right ("water: 250").
Points and the week:
- "reward: <title> | <points> | <real cost in lei>" a new reward in the shop (points ≈ 10 per lei of real cost is fair).
- "week: focus=<focus|wake|sport|clean|todoist|spend|mustdo>; note=<his words>; big3=<task> / <task> / <task>" set this week's plan (any part). "bigdone: <1-3>" ticks a big task.
Your long-term memory (use it: this is how you get better at coaching HIM):
- "aim: <goal> | <YYYY-MM-DD or -> | <weekly target>" a goal you track with him ("aim: Pass algebra | 2026-12-15 | 6h focus"). "aimdone: <goal>" when reached or dropped.
- "works: <what>" / "fails: <what>" when you learn what helps him or doesn't ("25-min blocks before noon work"). "pattern: <what>" a pattern you see in his data.
Google Calendar (use the E-numbers from the list; never over another event unless he asks):
- "event: <title> | <YYYY-MM-DD HH:MM> | <minutes>" new block.
- "move: E3 | <YYYY-MM-DD HH:MM>" move (keeps its length). "resize: E3 | <minutes>" new length. "delete: E3".
- "shift: <+/-minutes> | E3, E4, E5" move several (e.g. he's running late: shift the rest of today's blocks).
Todoist (use the T-numbers):
- "task: <text>" new task (Todoist reads "friday 18:00", "p1", "#University").
- "edit: T2 | title=<new>; priority=P1; due=<friday 18:00 | no date>; details=<notes>" any of these.
- "taskmove: T2 | <area name>". "done: T2". "star: T2" / "unstar: T2" (today's must-do). "deltask: T2".
Reminders (Telegram, sent by you later):
- "remind: <YYYY-MM-DD HH:MM> | <message>" a reminder at that time.
- "checkin: <minutes from now> | <question>" you ask him later, and keep asking every 45 min until he answers (use it when he says he'll do something: hold him to it).
Never invent amounts or times he didn't give. Never log the same thing twice.
Promises (use the P-numbers): when he answers a check-in, judge it: "kept: P1" (he did it) or "broken: P1" (he didn't, or made an excuse). An ignored check-in is broken unless he shows it's done.
Default to ACTING: when an action clearly helps (he reports something done → tick/log it; he says he'll do X → a checkin; he's behind → put a block in the calendar), do it without asking. Ask first only before deleting things he didn't mention.
When he says something is wrong ("that's not money", "wrong amount", "undo that", "delete it"), FIX it with actions now (delmoney / editmoney / water: -250 …). Never answer "ignore it" or "I won't count it": the data stays wrong unless you act.
Never invent appointments, reviews or times: only use times from his calendar, his plan, his reminders or what he said.
IMPORTANT: something happens ONLY if you put an action for it. Never write "logged"/"added"/"moved"/"done" in your reply: the app adds a ✅ line under your reply for each thing it really did. The history shows ✅ lines for what was done before; if there is none, it was NOT done.`;
var LOOKUPS = `Need facts you don't have (history, other days, all tasks)? Put requests in "need" and leave "reply" empty; you'll get the answers and answer then. Only when really needed. Requests:
- "spending <YYYY-MM-DD> <YYYY-MM-DD> [category]" totals and top categories (or one category).
- "focus <from> <to>", "workouts <from> <to>", "sleep <from> <to>", "tasks <from> <to>" (tasks done), "points <from> <to>".
- "calendar <YYYY-MM-DD> [days]" events of other days (with E-numbers). "todoist" every open task (with T-numbers).`;
/** The full prompt for one message. `refs`: the E/T lists; `found`: answers to the coach's lookups. */
function brainPrompt(persona, context, memory, message, media, profile = DEFAULT_PROFILE, extra = {}) {
	const chat = memory.chat.slice(-10).map((c) => `${c.role === "me" ? "Victor" : `Coach (${c.bot})`}: ${c.text.replace(/<[^>]+>/g, "").slice(0, 300)}`);
	return [
		PERSONA[persona],
		"Facts: every number you write must come from the data below (or his message). Check it before you write it. If you don't have a number, don't make one up; ask for it with \"need\" or leave it out.",
		"Accountability: you are not a cheerleader. When he broke or ignored promises this week, name it with the count (\"3rd promise missed this week\"), and make the next step smaller and timed. When he keeps them, say so in one short line and raise the bar a little. Tie today to his big goals and deadlines: say how today moves the goal (or doesn't).",
		"Style: a real coach, tough love, on his side. SHORT AND CLEAR: at most 3–4 short lines. Numbers first (his real ones: \"focus 32m of 10h this week\", \"water 1.2 of 2.7 L\"), then ONE push: one next step with a time or a duration. Use the patterns and what works for him when you advise; check his tracked goals against this week. No essays, no lists unless he asks for a plan (then a few short lines \"14:00–14:50 Lab report\"). Plain text, no markdown, at most 1 emoji. Ask one question back only when you really need to know. Reply in the language Victor writes in (English, Romanian or Russian); with no text from him, in English.",
		"",
		ACTIONS,
		"",
		extra.found ? "" : LOOKUPS,
		"",
		"Also put in \"remember\" any NEW lasting fact worth keeping about Victor (goals, exams and dates, preferences, problems, promises), short, with dates. Not things already in memory, not one-off logs.",
		"Put in \"steps\" 1–4 very short labels of what you did or checked, for the screen (\"Checked your calendar\", \"Found 2h free after 15:00\", \"Moved 3 blocks\").",
		"",
		`Answer ONLY with JSON: {"reply": string, "actions": string[], "remember": string[], "steps": string[]${extra.found ? "" : ", \"need\": string[]"}}.`,
		"",
		"== Victor right now ==",
		context,
		extra.refs ? `\n${extra.refs}` : "",
		extra.found ? `\n== Answers to what you asked for ==\n${extra.found}` : "",
		"",
		"== His goals (push him toward these) ==",
		profile.goals.length ? profile.goals.map((g) => `- ${g}`).join("\n") : "- (none set)",
		profile.rules.length ? `== His own rules (hold him to them, call it out when he breaks one) ==\n${profile.rules.map((r) => `- ${r}`).join("\n")}` : "",
		profile.about ? `== About him, in his words ==\n${profile.about}` : "",
		"",
		extra.mind ? `== Your long-term coaching notes ==\n${extra.mind}` : "",
		"",
		"== What you remember about him ==",
		memory.facts.length ? memory.facts.map((f) => `- ${f.t} (noted ${f.at})`).join("\n") : "- nothing yet",
		"",
		"== Recent conversation ==",
		chat.length ? chat.join("\n") : "(none)",
		"",
		media === "voice" ? "Victor sent a VOICE message (attached). First understand what he said; treat it like his text message." : "",
		media === "photo" ? "Victor sent a PHOTO (attached). If it is a receipt or a bill: you MUST add one action \"log: <kind> <shop> <total>\" with the TOTAL as a plain number LAST (e.g. \"log: groceries Linella 245\"), then comment briefly as his money coach. Otherwise react as a coach." : "",
		`Victor's message: ${message || (media ? "(see attachment)" : "")}`
	].filter((l) => l !== "").join("\n");
}
/** Reads the model's JSON (tolerating code fences or text around it). */
function parseBrain(text) {
	const raw = String(text ?? "").trim();
	const json = raw.match(/\{[\s\S]*\}/)?.[0];
	try {
		const j = JSON.parse(json ?? raw);
		return {
			reply: String(j.reply ?? "").trim(),
			actions: (Array.isArray(j.actions) ? j.actions : []).map(String).slice(0, 16),
			remember: (Array.isArray(j.remember) ? j.remember : []).map(String).slice(0, 5),
			steps: (Array.isArray(j.steps) ? j.steps : []).map(String).map((x) => x.slice(0, 80)).slice(0, 4),
			need: (Array.isArray(j.need) ? j.need : []).map(String).slice(0, 5)
		};
	} catch {
		return {
			reply: raw.replace(/^```\w*|```$/g, "").trim(),
			actions: [],
			remember: []
		};
	}
}
/** Only these slash commands may come from the brain (nothing that resets or deletes). */
var SAFE_SLASH = /^\/(wake|bed|checkin|oath|weight|waist|pushups|situps|squats|plank|run|stop)\b/i;
var WEEK_FOCUS = [
	"focus",
	"wake",
	"sport",
	"clean",
	"todoist",
	"spend",
	"mustdo"
];
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var WHEN = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/;
var EREF = /^E\d{1,3}$/i;
var TREF = /^T\d{1,3}$/i;
var MREF = /^M\d{1,2}$/i;
/** Turns an action line into something safe to run, or null. */
function readAction(line) {
	const m = /^\s*(log|mustdo|focus|fun|task|goal|event|move|resize|delete|shift|edit|taskmove|done|star|unstar|deltask|remind|checkin|water|reps|sleep|habit|reward|week|bigdone|delmoney|editmoney|kept|broken|book)\s*:\s*([\s\S]+)$/i.exec(line);
	if (!m) return null;
	const kind = m[1].toLowerCase();
	const arg = m[2].trim().slice(0, 400);
	if (!arg) return null;
	const parts = arg.split("|").map((x) => x.trim());
	if (kind === "move") {
		const w = WHEN.exec(parts[1] ?? "");
		return EREF.test(parts[0]) && w ? {
			kind: "move",
			ref: parts[0].toUpperCase(),
			day: w[1],
			time: `${w[2].padStart(2, "0")}:${w[3]}`
		} : null;
	}
	if (kind === "resize") {
		const minutes = Number(parts[1]);
		return EREF.test(parts[0]) && minutes >= 10 && minutes <= 600 ? {
			kind: "resize",
			ref: parts[0].toUpperCase(),
			minutes
		} : null;
	}
	if (kind === "delete") return EREF.test(parts[0]) ? {
		kind: "delevent",
		ref: parts[0].toUpperCase()
	} : null;
	if (kind === "shift") {
		const minutes = Number(parts[0]);
		const refs = (parts[1] ?? "").split(/[\s,]+/).filter((x) => EREF.test(x)).map((x) => x.toUpperCase());
		return minutes && Math.abs(minutes) <= 720 && refs.length ? {
			kind: "shift",
			refs: refs.slice(0, 20),
			minutes
		} : null;
	}
	if (kind === "edit") {
		if (!TREF.test(parts[0])) return null;
		const out = {
			kind: "edit",
			ref: parts[0].toUpperCase()
		};
		for (const kv of parts.slice(1).join("|").split(/;\s*/)) {
			const mm = /^\s*(title|priority|due|details)\s*=\s*([\s\S]*)$/i.exec(kv);
			if (!mm) continue;
			const key = mm[1].toLowerCase();
			const v = mm[2].trim();
			if (key === "title" && v) out.title = v.slice(0, 200);
			if (key === "details") out.details = v.slice(0, 1e3);
			if (key === "due" && v) out.due = v.slice(0, 40);
			if (key === "priority") {
				const p = /^P?([1-4])$/i.exec(v);
				if (p) out.priority = 5 - Number(p[1]);
			}
		}
		return out.title || out.priority || out.due || out.details != null ? out : null;
	}
	if (kind === "taskmove") return TREF.test(parts[0]) && parts[1] ? {
		kind: "taskmove",
		ref: parts[0].toUpperCase(),
		area: parts[1].slice(0, 60)
	} : null;
	if (kind === "done") return TREF.test(parts[0]) ? {
		kind: "done",
		ref: parts[0].toUpperCase()
	} : null;
	if (kind === "star" || kind === "unstar") return TREF.test(parts[0]) ? {
		kind: "star",
		ref: parts[0].toUpperCase(),
		on: kind === "star"
	} : null;
	if (kind === "deltask") return TREF.test(parts[0]) ? {
		kind: "deltask",
		ref: parts[0].toUpperCase()
	} : null;
	if (kind === "remind") {
		const w = WHEN.exec(parts[0] ?? "");
		return w && parts[1] ? {
			kind: "remind",
			day: w[1],
			time: `${w[2].padStart(2, "0")}:${w[3]}`,
			text: parts.slice(1).join(" | ").slice(0, 300)
		} : null;
	}
	if (kind === "checkin") {
		const minutes = Number(parts[0]);
		return minutes >= 5 && minutes <= 720 && parts[1] ? {
			kind: "checkin",
			minutes,
			text: parts.slice(1).join(" | ").slice(0, 300)
		} : null;
	}
	if (kind === "book") return {
		kind: "book",
		goal: arg.slice(0, 120)
	};
	if (kind === "kept" || kind === "broken") return /^P\d{1,2}$/i.test(parts[0]) ? {
		kind: "promise",
		ref: parts[0].toUpperCase(),
		outcome: kind
	} : null;
	if (kind === "delmoney") return MREF.test(parts[0]) ? {
		kind: "delmoney",
		ref: parts[0].toUpperCase()
	} : null;
	if (kind === "editmoney") {
		if (!MREF.test(parts[0])) return null;
		const out = {
			kind: "editmoney",
			ref: parts[0].toUpperCase()
		};
		for (const kv of parts.slice(1).join("|").split(/;\s*/)) {
			const mm = /^\s*(amount|category|account|note|date)\s*=\s*([\s\S]*)$/i.exec(kv);
			if (!mm) continue;
			const k = mm[1].toLowerCase();
			const v = mm[2].trim();
			if (k === "amount" && Number(v.replace(",", ".")) > 0) out.amount = Number(v.replace(",", "."));
			if (k === "category" && v) out.category = v.slice(0, 40);
			if (k === "account" && v) out.account = v.slice(0, 40);
			if (k === "note") out.note = v.slice(0, 120);
			if (k === "date" && DATE_RE.test(v)) out.date = v;
		}
		return out.amount || out.category || out.account || out.note != null || out.date ? out : null;
	}
	if (kind === "water") {
		const ml = Math.round(Number(/^[+-]?\d{1,4}/.exec(arg.replace(/\s+/g, ""))?.[0]));
		return ml && Math.abs(ml) <= 3e3 ? {
			kind: "water",
			ml
		} : null;
	}
	if (kind === "reps") {
		const amount = Math.round(Number(parts[1]));
		return parts[0] && amount && Math.abs(amount) <= 1e3 ? {
			kind: "reps",
			exercise: parts[0].slice(0, 40),
			amount
		} : null;
	}
	if (kind === "sleep") {
		if (!DATE_RE.test(parts[0] ?? "")) return null;
		const out = {
			kind: "sleep",
			day: parts[0]
		};
		for (const kv of parts.slice(1).join(";").split(/;\s*/)) {
			const mm = /^\s*(wake|bed|quality)\s*=\s*(\S+)/i.exec(kv);
			if (!mm) continue;
			const k = mm[1].toLowerCase();
			const t = /^(\d{1,2})[:.](\d{2})$/.exec(mm[2]);
			if ((k === "wake" || k === "bed") && t && Number(t[1]) < 24 && Number(t[2]) < 60) out[k] = `${t[1].padStart(2, "0")}:${t[2]}`;
			if (k === "quality" && /^[1-5]$/.test(mm[2])) out.quality = Number(mm[2]);
		}
		return out.wake || out.bed || out.quality ? out : null;
	}
	if (kind === "habit") {
		const h = arg.toLowerCase();
		const habit = /oath/.test(h) ? "oath" : /clean|check/.test(h) ? "clean" : /skin|face/.test(h) ? "skincare" : null;
		return habit ? {
			kind: "habit",
			habit
		} : null;
	}
	if (kind === "reward") {
		const points = Math.round(Number(parts[1]));
		const cost = Math.max(0, Math.round(Number(parts[2]) || 0));
		return parts[0] && points > 0 && points <= 1e5 ? {
			kind: "reward",
			title: parts[0].slice(0, 80),
			points,
			cost
		} : null;
	}
	if (kind === "week") {
		const out = { kind: "week" };
		for (const kv of arg.split(/;\s*/)) {
			const mm = /^\s*(focus|note|big3)\s*=\s*([\s\S]*)$/i.exec(kv);
			if (!mm) continue;
			const k = mm[1].toLowerCase();
			const v = mm[2].trim();
			if (k === "focus" && WEEK_FOCUS.includes(v.toLowerCase())) out.focus = v.toLowerCase();
			if (k === "note") out.note = v.slice(0, 140);
			if (k === "big3") out.big3 = v.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
		}
		return out.focus || out.note != null || out.big3?.length ? out : null;
	}
	if (kind === "bigdone") {
		const index = Number(arg) - 1;
		return index >= 0 && index <= 2 ? {
			kind: "bigdone",
			index
		} : null;
	}
	if (kind === "log") return arg.startsWith("/") && !SAFE_SLASH.test(arg) ? null : {
		kind: "log",
		text: arg
	};
	if (kind === "mustdo") return {
		kind: "mustdo",
		text: arg.slice(0, 140)
	};
	if (kind === "task") return {
		kind: "task",
		text: arg
	};
	if (kind === "event") {
		const [title, when, mins] = arg.split("|").map((x) => x.trim());
		const w = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(when ?? "");
		const minutes = Number(mins) || 50;
		if (!title || !w || minutes < 10 || minutes > 600) return null;
		return {
			kind: "event",
			title: title.slice(0, 120),
			day: w[1],
			time: `${w[2].padStart(2, "0")}:${w[3]}`,
			minutes
		};
	}
	if (kind === "focus" || kind === "fun") {
		const minutes = Number(/\d{1,3}/.exec(arg)?.[0] ?? (kind === "focus" ? 50 : 0));
		const rest = arg.replace(/\d{1,3}\s*(minutes|min|m)?\b/i, "").trim();
		if (!(minutes >= 5 && minutes <= 180) && kind === "focus") return null;
		if (!(minutes >= 1 && minutes <= 240) && kind === "fun") return null;
		return kind === "focus" ? {
			kind,
			minutes,
			subject: rest || "Focus"
		} : {
			kind,
			minutes,
			what: rest || "Fun"
		};
	}
	const [title, subject, deadline, hours] = arg.split("|").map((x) => x.trim());
	if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(deadline ?? "") || !(Number(hours) > 0)) return null;
	return {
		kind: "goal",
		title,
		subject: subject || title,
		deadline,
		hours: Math.min(500, Number(hours))
	};
}
var ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
/**
* The money coach's line under an expense: how often this week, the month
* against the limit and what's left per day. Null when there's nothing useful.
*/
function moneyInsight(state, tx, today) {
	if (!state || !Array.isArray(state.tx) || tx.type === "income") return null;
	const cats = new Map((state.settings?.categories ?? []).map((c) => [String(c.id), String(c.name)]));
	const amt = (t) => Math.abs(Number(t.base ?? t.amount) || 0);
	const exp = state.tx.filter((t) => t && t.type === "expense" && !t.deleted && typeof t.date === "string");
	const weekFrom = addDays$1(today, -6);
	const same = exp.filter((t) => t.date >= weekFrom && t.date <= today && String(t.category) === String(tx.category));
	const name = cats.get(String(tx.category)) ?? "this";
	const parts = [];
	if (same.length >= 2) parts.push(`${ordinal(same.length)} ${name} this week (${lei(same.reduce((s, t) => s + amt(t), 0))})`);
	const month = today.slice(0, 7);
	const monthTotal = exp.filter((t) => t.date.startsWith(month)).reduce((s, t) => s + amt(t), 0);
	const limit = state.settings?.limit;
	if (limit?.on && Number(limit.amount) > 0) {
		const daysLeft = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() - Number(today.slice(8)) + 1;
		const left = Math.max(0, Number(limit.amount) - monthTotal);
		const pct = Math.round(monthTotal / Number(limit.amount) * 100);
		parts.push(pct >= 100 ? `over the monthly limit by ${lei(monthTotal - Number(limit.amount))}` : `${pct}% of the monthly limit, ${lei(left / daysLeft)}/day left for ${daysLeft} days`);
	} else parts.push(`this month ${lei(monthTotal)}`);
	return parts.length ? `📊 ${parts.join(" · ")}` : null;
}
/** Which weekdays your wake-ups go wrong (last 8 weeks), for the sleep coach. */
function wakePattern(wakes) {
	const names = [
		"Sun",
		"Mon",
		"Tue",
		"Wed",
		"Thu",
		"Fri",
		"Sat"
	];
	const by = names.map(() => ({
		late: 0,
		n: 0
	}));
	for (const w of wakes) {
		const d = (/* @__PURE__ */ new Date(`${w.day}T12:00:00Z`)).getUTCDay();
		by[d].n++;
		if (!w.onTime) by[d].late++;
	}
	const bad = by.map((x, i) => ({
		...x,
		d: names[i]
	})).filter((x) => x.n >= 2 && x.late / x.n >= .5);
	return bad.length ? `Late most often on: ${bad.map((x) => `${x.d} (${x.late}/${x.n})`).join(", ")}.` : null;
}
var DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Answers one "need" from the data on hand; null when it needs Calendar/Todoist (or isn't known). */
function answerLocal(need, d) {
	const [kind, from, to, ...rest] = need.trim().split(/\s+/);
	const k = (kind ?? "").toLowerCase();
	if (![
		"spending",
		"focus",
		"workouts",
		"sleep",
		"tasks",
		"points"
	].includes(k)) return null;
	if (!DATE.test(from ?? "") || !DATE.test(to ?? "")) return `${need}: give dates as YYYY-MM-DD YYYY-MM-DD.`;
	const inRange = (day) => day >= from && day <= to;
	const span = `${from} to ${to}`;
	if (k === "spending") {
		const st = d.finance;
		if (!st || !Array.isArray(st.tx)) return `Spending ${span}: Finance Helper data not available.`;
		const cats = new Map((st.settings?.categories ?? []).map((c) => [String(c.id), String(c.name)]));
		const want = rest.join(" ").toLowerCase();
		const exp = st.tx.filter((t) => t && t.type === "expense" && !t.deleted && typeof t.date === "string" && inRange(t.date.slice(0, 10)));
		const name = (t) => cats.get(String(t.category)) ?? String(t.category ?? "Other");
		const pick = want ? exp.filter((t) => name(t).toLowerCase().includes(want) || String(t.note ?? "").toLowerCase().includes(want)) : exp;
		const amt = (t) => Math.abs(Number(t.base ?? t.amount) || 0);
		const total = pick.reduce((s, t) => s + amt(t), 0);
		const by = /* @__PURE__ */ new Map();
		for (const t of pick) by.set(name(t), (by.get(name(t)) ?? 0) + amt(t));
		const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => `${c} ${lei(v)}`);
		const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1);
		return `Spending ${span}${want ? ` on "${want}"` : ""}: ${lei(total)} in ${pick.length} expenses (${lei(total / days)}/day).${top.length ? ` By category: ${top.join(", ")}.` : ""}`;
	}
	if (k === "focus") {
		const list = d.sessions.filter((s) => inRange(s.day));
		const total = list.reduce((t, s) => t + s.minutes, 0);
		const by = /* @__PURE__ */ new Map();
		for (const s of list) by.set(s.subject, (by.get(s.subject) ?? 0) + s.minutes);
		const days = new Set(list.map((s) => s.day)).size;
		return `Focus ${span}: ${hm$1(total)} in ${list.length} sessions on ${days} days.${by.size ? ` By subject: ${[...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, m]) => `${s} ${hm$1(m)}`).join(", ")}.` : ""}`;
	}
	if (k === "workouts") {
		const days = [...new Set(d.input.workouts.filter((w) => inRange(w.day)).map((w) => w.day))].sort();
		return `Workouts ${span}: ${days.length} days${days.length ? ` (${days.map((x) => x.slice(5)).join(", ")})` : ""}.`;
	}
	if (k === "sleep") {
		const w = d.input.wakes.filter((x) => inRange(x.day));
		return `Wake-ups ${span}: ${w.filter((x) => x.onTime).length}/${w.length} on time.${w.length ? ` Late on: ${w.filter((x) => !x.onTime).map((x) => x.day.slice(5)).join(", ") || "none"}.` : ""}`;
	}
	if (k === "tasks") {
		const t = d.input.todoist.filter((x) => inRange(x.day)).length;
		const m = (d.input.mustdos ?? []).filter((x) => inRange(x.day));
		return `Tasks ${span}: ${t} Todoist tasks done, ${m.filter((x) => x.done).length}/${m.length} must-dos done.`;
	}
	const l = d.ledger.filter((e) => inRange(e.day));
	return `Points ${span}: +${l.filter((e) => e.coins > 0).reduce((t, e) => t + e.coins, 0)} earned, −${-l.filter((e) => e.coins < 0).reduce((t, e) => t + e.coins, 0)} spent.`;
}
// src/core/rhythm.ts
var RHYTHM = "coach_rhythm";
var RHYTHM_PREFS = "coach_rhythm_prefs";
var DEFAULT_RHYTHM_PREFS = {
	on: true,
	evening: "21:00",
	weekly: "19:00",
	water: true,
	training: true
};
var HM = /^([01]\d|2[0-3]):[0-5]\d$/;
var toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
var fromMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function cleanPrefs(p) {
	return {
		on: p?.on !== false,
		evening: HM.test(p?.evening) ? p.evening : DEFAULT_RHYTHM_PREFS.evening,
		weekly: HM.test(p?.weekly) ? p.weekly : DEFAULT_RHYTHM_PREFS.weekly,
		water: p?.water !== false,
		training: p?.training !== false
	};
}
/** Today's state: a new day keeps only tomorrow's top 3 and the weekly review. */
function rhythmFor(state, today) {
	const s = state && typeof state === "object" ? state : {};
	if (s.day === today) return {
		...s,
		water: Array.isArray(s.water) ? s.water : []
	};
	return {
		day: today,
		water: [],
		...s.tomorrow ? { tomorrow: s.tomorrow } : {},
		...s.weekly ? { weekly: s.weekly } : {}
	};
}
/** What the coach should send now (in order). */
function dueRhythm(state, prefs, f) {
	if (!prefs.on) return [];
	const t = toMin(f.time);
	const out = [];
	const start = Math.max(toMin("06:00"), f.wakeAt ? toMin(f.wakeAt) + 5 : toMin(f.wakeTarget) + 45);
	if (!state.briefing && t >= start && t < toMin("12:00")) out.push("briefing");
	if (!f.paused && prefs.water && waterBehind(state, f)) out.push("water");
	if (!f.paused && prefs.training && !f.workoutDone && !state.training && t >= toMin("18:00") && t < toMin("21:00")) out.push("training");
	if (f.weekday === 0 && t >= toMin(prefs.weekly) && state.weekly?.day !== f.today) out.push("weekly");
	if (!state.evening && t >= toMin(prefs.evening)) out.push("evening");
	return out;
}
/** Water well behind the day's pace (08:00→21:00), at most 3 nudges, 2.5 h apart, 11:00–20:30. */
function waterBehind(state, f) {
	const t = toMin(f.time);
	if (t < toMin("11:00") || t > toMin("20:30") || f.waterTarget <= 0) return false;
	if (state.water.length >= 3) return false;
	const last = state.water[state.water.length - 1];
	if (last && t - toMin(last) < 150) return false;
	const pace = Math.min(1, Math.max(0, (t - toMin("08:00")) / (toMin("21:00") - toMin("08:00"))));
	return f.waterMl < f.waterTarget * pace - f.waterTarget * .25;
}
var quarter = (hm) => fromMin(Math.ceil(toMin(hm) / 15) * 15);
/** A plan without the model: last night's top 3 (else starred and urgent tasks), blocks in free time, a training slot. */
function localProposal(p) {
	const seen = /* @__PURE__ */ new Set();
	const pick = [];
	const add = (t) => {
		const k = t.trim().toLowerCase();
		if (!k || seen.has(k) || pick.length >= 3) return;
		seen.add(k);
		pick.push(t.trim());
	};
	p.top3.forEach(add);
	[...p.tasks].sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || (b.priority ?? 1) - (a.priority ?? 1) || String(a.due ?? "9").localeCompare(String(b.due ?? "9"))).forEach((t) => add(t.content));
	const blocks = suggestBlocks(freeGaps(p.events, p.today, {
		after: quarter(p.now),
		minMinutes: 30
	}), [...p.goals ?? [], ...pick.map((title) => ({
		title,
		minutes: 50
	}))]).map((b) => ({
		title: b.title,
		start: b.start,
		minutes: b.minutes
	}));
	let training = null;
	if (!p.workoutDone) {
		const taken = blocks.map((b) => ({
			s: toMin(b.start),
			e: toMin(b.start) + b.minutes
		}));
		const evening = freeGaps(p.events, p.today, {
			after: fromMin(Math.max(toMin(quarter(p.now)), toMin("17:00"))),
			minMinutes: 45
		});
		for (const g of evening) {
			let s = toMin(g.start);
			while (s + 45 <= toMin(g.end) && taken.some((x) => s < x.e + 10 && s + 45 > x.s - 10)) s += 15;
			if (s + 45 <= toMin(g.end)) {
				training = {
					time: fromMin(s),
					what: "Workout · 45 min"
				};
				break;
			}
		}
	}
	const focus = blocks.reduce((t, b) => t + b.minutes, 0);
	return {
		day: p.today,
		headline: pick.length ? `${pick.length} must-do${pick.length === 1 ? "" : "s"} · ${focus} min of focus planned` : "A light day: pick one thing that matters",
		mustdos: pick,
		blocks,
		training,
		waterMl: p.waterTarget
	};
}
/** The model's plan, made safe: real times, no clashes with your calendar or each other, at most 3 must-dos. */
function cleanProposal(raw, fallback, events, now) {
	if (!raw || typeof raw !== "object") return fallback;
	const day = fallback.day;
	const busy = events.filter((e) => !e.allDay && localDayOf(e.start) === day).map((e) => ({
		s: minOfIso(e.start),
		e: minOfIso(e.end)
	}));
	const after = toMin(quarter(now));
	const taken = [];
	const blocks = [];
	for (const b of Array.isArray(raw.blocks) ? raw.blocks : []) {
		const start = String(b?.start ?? "").padStart(5, "0");
		const minutes = Math.round(Number(b?.minutes));
		const title = String(b?.title ?? "").trim().slice(0, 80);
		if (!HM.test(start) || !title || !(minutes >= 15 && minutes <= 180)) continue;
		const s = toMin(start);
		const e = s + minutes;
		if (s < after || e > toMin("23:30")) continue;
		if ([...busy, ...taken].some((x) => s < x.e && e > x.s)) continue;
		taken.push({
			s,
			e
		});
		blocks.push({
			title,
			start,
			minutes
		});
		if (blocks.length >= 6) break;
	}
	const mustdos = (Array.isArray(raw.mustdos) ? raw.mustdos : []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3);
	let training = null;
	if (raw.training && HM.test(String(raw.training.time ?? "").padStart(5, "0"))) {
		const t = String(raw.training.time).padStart(5, "0");
		const s = toMin(t);
		if (s >= after && ![...busy, ...taken].some((x) => s < x.e && s + 30 > x.s)) training = {
			time: t,
			what: String(raw.training.what ?? "Workout").slice(0, 60) || "Workout"
		};
	}
	const waterMl = Number(raw.waterMl) >= 1e3 && Number(raw.waterMl) <= 5e3 ? Math.round(Number(raw.waterMl)) : fallback.waterMl;
	return {
		day,
		headline: String(raw.headline ?? "").trim().slice(0, 140) || fallback.headline,
		mustdos: mustdos.length ? mustdos : fallback.mustdos,
		blocks: blocks.length || !fallback.blocks.length ? blocks : fallback.blocks,
		training: training ?? (raw.training === null ? null : fallback.training),
		waterMl
	};
}
var localDayOf = (iso) => {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
var minOfIso = (iso) => {
	const d = new Date(iso);
	return d.getHours() * 60 + d.getMinutes();
};
/** The plan as a Telegram message (HTML). */
function proposalText(p, opts = {}) {
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const lines = [`☀️ <b>Your day${opts.version && opts.version > 1 ? ` (v${opts.version})` : ""}</b> · ${esc(p.headline)}`];
	if (p.mustdos.length) lines.push("", "<b>Must-dos</b>", ...p.mustdos.map((m, i) => `${i + 1}. ${esc(m)}`));
	const timed = [...p.blocks.map((b) => ({
		s: b.start,
		text: `${b.start}–${fromMin(toMin(b.start) + b.minutes)} ${esc(b.title)}`
	})), ...p.training ? [{
		s: p.training.time,
		text: `${p.training.time} 💪 ${esc(p.training.what)}`
	}] : []].sort((a, b) => a.s.localeCompare(b.s));
	if (timed.length) lines.push("", "<b>Blocks</b>", ...timed.map((x) => x.text));
	lines.push("", `💧 Water: ${(p.waterMl / 1e3).toFixed(1)} L`);
	lines.push("", opts.approved ? "✅ <b>Approved.</b> Blocks are in your calendar, must-dos are starred." : "Approve, change it, or ask for another one.");
	return lines.join("\n");
}
var PROPOSAL_KEYBOARD = { inline_keyboard: [[
	{
		text: "✅ Approve",
		callback_data: "rb|a"
	},
	{
		text: "✏️ Change",
		callback_data: "rb|e"
	},
	{
		text: "🔄 Redo",
		callback_data: "rb|r"
	}
]] };
var EDIT_ASK = "What should change in today's plan?";
/** 0–100: must-dos 40, focus against the plan 30, water 15, training 15. */
function dayScore(r) {
	const md = r.mustdosTotal ? r.mustdosDone / r.mustdosTotal : r.focusMin >= 50 ? 1 : 0;
	const fo = Math.min(1, r.focusMin / Math.max(50, r.plannedFocusMin));
	const wa = r.waterTarget ? Math.min(1, r.waterMl / r.waterTarget) : 0;
	const tr = r.workoutDone ? 1 : r.trainingPlanned ? 0 : .5;
	return Math.round(md * 40 + fo * 30 + wa * 15 + tr * 15);
}
/** The weakest part of the day, for the lesson when there's no model. */
function weakest(r) {
	const parts = [
		{
			k: r.mustdosTotal ? r.mustdosDone / r.mustdosTotal : 1,
			t: `${r.mustdosTotal - r.mustdosDone} must-do${r.mustdosTotal - r.mustdosDone === 1 ? "" : "s"} left open. Tomorrow: the hardest one first, before noon.`
		},
		{
			k: Math.min(1, r.focusMin / Math.max(50, r.plannedFocusMin)),
			t: `Focus ${r.focusMin} of ${Math.max(50, r.plannedFocusMin)} min planned. Start the first block on time; the rest follows.`
		},
		{
			k: r.waterTarget ? Math.min(1, r.waterMl / r.waterTarget) : 1,
			t: `Water ${(r.waterMl / 1e3).toFixed(1)} of ${(r.waterTarget / 1e3).toFixed(1)} L. A full glass with every meal.`
		},
		{
			k: r.workoutDone || !r.trainingPlanned ? 1 : 0,
			t: "Training skipped. Put it before the evening, not after."
		}
	].sort((a, b) => a.k - b.k);
	return parts[0].k >= 1 ? "Everything done. Keep the same rhythm tomorrow." : parts[0].t;
}
function reviewText(r, score, lesson, top3) {
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return [
		`🌙 <b>Day review: ${score}/100</b> ${score >= 80 ? "🔥" : score >= 55 ? "👍" : "⚠️"}`,
		"",
		`Must-dos ${r.mustdosDone}/${r.mustdosTotal} · Focus ${r.focusMin}${r.plannedFocusMin ? `/${r.plannedFocusMin}` : ""} min${r.blocksPlanned ? ` · Blocks ${r.blocksDone}/${r.blocksPlanned}` : ""}`,
		`Water ${(r.waterMl / 1e3).toFixed(1)}/${(r.waterTarget / 1e3).toFixed(1)} L · Training ${r.workoutDone ? "✅" : "—"}`,
		"",
		`<b>Lesson:</b> ${esc(lesson)}`,
		...top3.length ? [
			"",
			"<b>Tomorrow's top 3</b>",
			...top3.map((t, i) => `${i + 1}. ${esc(t)}`)
		] : []
	].join("\n");
}
var REVIEW_KEYBOARD = { inline_keyboard: [[{
	text: "✅ Keep as tomorrow's top 3",
	callback_data: "rv|k"
}, {
	text: "✏️ Change",
	callback_data: "rv|e"
}]] };
var TOP3_ASK = "Tomorrow's top 3? One per line.";
var FOCUS_NAMES = {
	focus: "focus time",
	wake: "wake-ups",
	sport: "training",
	clean: "clean days",
	todoist: "tasks",
	spend: "spending",
	mustdo: "must-dos"
};
var focusName = (id) => FOCUS_NAMES[id] ?? id;
/** Next week's focus without the model: the metric furthest below its target. */
function suggestWeekFocus(metrics) {
	const scored = metrics.filter((m) => m.target && m.target > 0 && m.id !== "spend").map((m) => ({
		id: m.id,
		k: m.now / m.target
	}));
	scored.sort((a, b) => a.k - b.k);
	return scored[0]?.id ?? "focus";
}
function weeklyText(o) {
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const delta = o.score - o.prevScore;
	return [
		`📊 <b>Week review: ${o.score}/100</b> (${delta >= 0 ? "+" : ""}${delta} vs last week)`,
		"",
		...o.lines.map(esc),
		"",
		`🏆 <b>Win:</b> ${esc(o.win)}`,
		`🕳 <b>Leak:</b> ${esc(o.leak)}`,
		"",
		`<b>Next week</b>: focus on ${esc(focusName(o.focus))}${o.note ? ` (“${esc(o.note)}”)` : ""}`,
		...o.big3.map((b, i) => `${i + 1}. ${esc(b)}`)
	].join("\n");
}
var WEEKLY_KEYBOARD = { inline_keyboard: [[{
	text: "✅ Use this plan",
	callback_data: "rw|a"
}, {
	text: "✏️ Change",
	callback_data: "rw|e"
}]] };
var WEEK_ASK = "Next week's 3 big tasks? One per line.";
/** "1. a\n2) b\n- c" → ['a','b','c'] (at most 3). */
function readLines(text) {
	return text.split(/\n|;/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, "").trim()).filter(Boolean).slice(0, 3);
}
// src/core/coachImpact.ts
var COACH_HISTORY = "coach_history";
function cleanHistory(h) {
	return { days: h && typeof h.days === "object" && h.days ? h.days : {} };
}
/** Sets fields on a day (and drops days older than half a year). */
function recordDay(h, day, patch) {
	const days = { ...cleanHistory(h).days };
	const cur = days[day] ?? {};
	const plan = cur.plan === "approved" && patch.plan === "proposed" ? "approved" : patch.plan ?? cur.plan;
	days[day] = {
		...cur,
		...patch,
		...plan ? { plan } : {}
	};
	const cutoff = addDays$1(day, -180);
	for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
	return { days };
}
function bump(h, day, key, by = 1) {
	const cur = cleanHistory(h).days[day] ?? {};
	return recordDay(h, day, { [key]: (cur[key] ?? 0) + by });
}
var mondayOf = (day) => {
	return addDays$1(day, -(((/* @__PURE__ */ new Date(`${day}T12:00:00Z`)).getUTCDay() + 6) % 7));
};
/** The last `weeks` weeks (oldest first), this week included. */
function scorecard(h, focus, today, weeks = 8) {
	const days = cleanHistory(h).days;
	const thisMonday = mondayOf(today);
	const rows = [];
	for (let i = weeks - 1; i >= 0; i--) {
		const week = addDays$1(thisMonday, -7 * i);
		const end = addDays$1(week, 6);
		const ds = Object.entries(days).filter(([d]) => d >= week && d <= end && d <= today).map(([, v]) => v);
		const kept = ds.reduce((t, d) => t + (d.kept ?? 0), 0);
		const broken = ds.reduce((t, d) => t + (d.broken ?? 0), 0);
		const ignored = ds.reduce((t, d) => t + (d.ignored ?? 0), 0);
		const judged = kept + broken + ignored;
		const scores = ds.map((d) => d.score).filter((x) => typeof x === "number");
		rows.push({
			week,
			kept,
			broken,
			ignored,
			keptPct: judged ? Math.round(kept / judged * 100) : null,
			plansProposed: ds.filter((d) => d.plan).length,
			plansApproved: ds.filter((d) => d.plan === "approved").length,
			avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
			mustdosDone: ds.reduce((t, d) => t + (d.mustdos?.[0] ?? 0), 0),
			mustdosTotal: ds.reduce((t, d) => t + (d.mustdos?.[1] ?? 0), 0),
			focusMin: focus.filter((f) => f.day >= week && f.day <= end).reduce((t, f) => t + f.minutes, 0)
		});
	}
	return rows;
}
/**
* The honest answer: the last 2 weeks against the 2 before them. "Working"
* when most measures went up, "not yet" when most went down.
*/
function impactVerdict(rows) {
	const recent = rows.slice(-2);
	const before = rows.slice(-4, -2);
	if (rows.filter((r) => r.plansProposed || r.kept + r.broken + r.ignored || r.avgScore != null).length < 2 || !before.some((r) => r.plansProposed || r.avgScore != null || r.kept + r.broken + r.ignored)) return {
		verdict: "too early",
		lines: ["Two weeks of using the coach are needed to compare. Keep answering its check-ins and approving plans."]
	};
	const sum = (rs, f) => rs.reduce((t, r) => t + f(r), 0);
	const pct = (rs) => {
		const j = sum(rs, (r) => r.kept + r.broken + r.ignored);
		return j ? sum(rs, (r) => r.kept) / j : null;
	};
	const avg = (rs) => {
		const s = rs.filter((r) => r.avgScore != null);
		return s.length ? sum(s, (r) => r.avgScore) / s.length : null;
	};
	const measures = [
		{
			name: "Promises kept",
			a: pct(recent),
			b: pct(before),
			fmt: (x) => `${Math.round(x * 100)}%`
		},
		{
			name: "Day score",
			a: avg(recent),
			b: avg(before),
			fmt: (x) => `${Math.round(x)}/100`
		},
		{
			name: "Focus",
			a: sum(recent, (r) => r.focusMin) / 2,
			b: sum(before, (r) => r.focusMin) / 2,
			fmt: (x) => `${(x / 60).toFixed(1)}h/week`
		},
		{
			name: "Plans approved",
			a: sum(recent, (r) => r.plansApproved),
			b: sum(before, (r) => r.plansApproved),
			fmt: (x) => `${x}`
		}
	];
	let up = 0;
	let down = 0;
	const lines = [];
	for (const m of measures) {
		if (m.a == null || m.b == null) continue;
		const diff = m.a - m.b;
		const tol = Math.max(Math.abs(m.b) * .05, 1e-9);
		if (diff > tol) up++;
		else if (diff < -tol) down++;
		lines.push(`${m.name}: ${m.fmt(m.a)} (was ${m.fmt(m.b)}) ${diff > tol ? "↑" : diff < -tol ? "↓" : "="}`);
	}
	return {
		verdict: up > down && up >= 2 ? "working" : down > up ? "not yet" : "mixed",
		lines
	};
}
// src/renderer/src/web/rhythmBot.ts
var pad = (n) => String(n).padStart(2, "0");
var hmNow = (d = /* @__PURE__ */ new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
var quarterNow = (d = /* @__PURE__ */ new Date()) => {
	const m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15;
	return `${pad(Math.min(23, Math.floor(m / 60)))}:${pad(m % 60)}`;
};
function readJson(db, key, fallback) {
	try {
		return JSON.parse(getSetting(db, key) || "null") ?? fallback;
	} catch {
		return fallback;
	}
}
function createRhythm({ mirror, services, todoist, calendar, ai }) {
	const load = (db, today) => rhythmFor(readJson(db, RHYTHM, null), today);
	const save = (db, s) => setSetting(db, RHYTHM, JSON.stringify(s));
	const dayBounds = () => {
		const s = /* @__PURE__ */ new Date();
		s.setHours(0, 0, 0, 0);
		return [s.toISOString(), new Date(s.getTime() + 864e5).toISOString()];
	};
	const history = (db, day, patch) => setSetting(db, COACH_HISTORY, JSON.stringify(recordDay(cleanHistory(readJson(db, COACH_HISTORY, null)), day, patch)));
	const countPromise = (db, day, key) => setSetting(db, COACH_HISTORY, JSON.stringify(bump(cleanHistory(readJson(db, COACH_HISTORY, null)), day, key)));
	const BOOKING = "goal_booking";
	/** Every open focus goal with its plan (minutes a day, milestones, what a miss costs). */
	async function goalPlans() {
		return mirror.read((db) => {
			const svc = services.services(db);
			const today = svc.wallet.today();
			const f = svc.focus.state();
			return f.goals.map((g) => {
				const todayMin = f.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0);
				return planGoal(g, today, todayMin);
			});
		});
	}
	/**
	* Books each goal's blocks for the next 7 days in free time (today from now).
	* Our future blocks for those goals are removed first, so a missed day is
	* spread again over the days left (the deadline holds).
	*/
	async function bookGoals(goalIds) {
		if (!calendar?.remove) return {
			ok: false,
			lines: ["⚠️ Connect Google Calendar (Settings) to book goal blocks"]
		};
		const plans = (await goalPlans()).filter((p) => (!goalIds?.length || goalIds.includes(p.goalId)) && p.leftMin > 0 && p.daysLeft > 0);
		if (!plans.length) return {
			ok: false,
			lines: ["No open goal with a deadline to plan. Add one: title, subject, deadline, hours."]
		};
		const now = /* @__PURE__ */ new Date();
		const start = new Date(now);
		start.setHours(0, 0, 0, 0);
		const events = await calendar.events(start.toISOString(), new Date(start.getTime() + 6912e5).toISOString());
		const stale = events.filter((e) => plans.some((p) => isGoalBlock(e, p)) && Date.parse(e.start) > now.getTime());
		for (const e of stale) await calendar.remove(e.calendarId, e.id).catch(() => null);
		const blocks = bookBlocks(plans, events.filter((e) => !stale.includes(e)), await mirror.read((db) => services.services(db).wallet.today()), quarterNow(now), 7);
		let made = 0;
		for (const b of blocks) {
			const s = /* @__PURE__ */ new Date(`${b.day}T${b.start}:00`);
			if (await calendar.create({
				title: b.title,
				start: s.toISOString(),
				end: new Date(s.getTime() + b.minutes * 6e4).toISOString(),
				description: "Goal plan from your coach in Life System (moves by itself when you miss a day)"
			}).then(() => true).catch(() => false)) made++;
		}
		await mirror.write((db) => {
			const cur = readJson(db, BOOKING, { goalIds: [] });
			setSetting(db, BOOKING, JSON.stringify({
				goalIds: [.../* @__PURE__ */ new Set([...cur.goalIds ?? [], ...plans.map((p) => p.goalId)])],
				at: (/* @__PURE__ */ new Date()).toISOString()
			}));
		});
		const lines = plans.map((p) => {
			const mine = blocks.filter((b) => b.goalId === p.goalId);
			const min = mine.reduce((t, b) => t + b.minutes, 0);
			const want = p.todayLeftMin + p.perDayMin * Math.min(6, Math.max(0, p.daysLeft - 1));
			return `🗓 ${p.title}: ${mine.length} blocks, ${(min / 60).toFixed(1)}h this week${min + 20 < want ? ` (⚠️ only room for ${(min / 60).toFixed(1)} of ${(want / 60).toFixed(1)}h)` : ""}`;
		});
		return {
			ok: made > 0 || !blocks.length,
			lines: [...lines, ...stale.length ? [`↻ Replaced ${stale.length} old block${stale.length === 1 ? "" : "s"}`] : []]
		};
	}
	/** Every evening: goals with booked blocks are spread again over the days left. */
	async function rebookGoals() {
		const ids = await mirror.read((db) => readJson(db, BOOKING, { goalIds: [] }).goalIds ?? []);
		if (!ids.length || !calendar?.remove) return [];
		const open = (await goalPlans()).filter((p) => ids.includes(p.goalId) && p.leftMin > 0 && p.daysLeft > 0).map((p) => p.goalId);
		if (!open.length) return [];
		return (await bookGoals(open).catch(() => ({ lines: [] }))).lines;
	}
	async function state() {
		return mirror.read((db) => {
			const today = services.services(db).wallet.today();
			return {
				state: load(db, today),
				prefs: cleanPrefs(readJson(db, RHYTHM_PREFS, null))
			};
		});
	}
	async function setPrefs(p) {
		return mirror.write((db) => {
			const next = cleanPrefs({
				...cleanPrefs(readJson(db, RHYTHM_PREFS, null)),
				...p
			});
			setSetting(db, RHYTHM_PREFS, JSON.stringify(next));
			return next;
		});
	}
	/** Context for the model: the same picture the coach sees in chat. */
	async function contextFor(events, todoToday, upcoming) {
		return mirror.read((db) => {
			const svc = services.services(db);
			return [
				lifeContext(svc, db, {
					finance: financeStateFrom(db, null),
					todoToday,
					upcoming,
					events
				}),
				(() => {
					const inp = svc.progress.input(null);
					const today = svc.wallet.today();
					return mindText(loadMind(db), today, weekSoFar(today, inp.focus, inp.workouts, inp.todoist));
				})(),
				`His goals: ${loadProfile(db).goals.join("; ")}`
			].filter(Boolean).join("\n");
		});
	}
	/** A plan for today (a new version when you ask to change or redo it). */
	async function propose(note = "") {
		const now = /* @__PURE__ */ new Date();
		const [events, tasks, upcoming] = await Promise.all([
			calendar ? calendar.events(...dayBounds()).catch(() => []) : Promise.resolve([]),
			todoist ? todoist.today().catch(() => []) : Promise.resolve([]),
			todoist?.upcoming ? todoist.upcoming(7).catch(() => null) : Promise.resolve(null)
		]);
		const base = await mirror.read((db) => {
			const svc = services.services(db);
			const today = svc.wallet.today(now);
			const st = load(db, today);
			const sport = sportState(db);
			return {
				today,
				st,
				water: sport ? sharedView(sport, sportToday()).water.target : 2700,
				workoutDone: (svc.wallet.summary(now).todayRules ?? []).includes("body.workout_done")
			};
		});
		const plans = await goalPlans().catch(() => []);
		const bookedToday = (p) => events.some((e) => isGoalBlock(e, p));
		const fallback = localProposal({
			goals: plans.filter((p) => p.todayLeftMin >= 20 && !bookedToday(p)).map((p) => ({
				title: `${p.subject}: ${p.title}`,
				minutes: Math.min(90, p.todayLeftMin)
			})),
			today: base.today,
			now: hmNow(now),
			events,
			tasks: tasks.map((t) => ({
				content: t.content,
				starred: isStarred(t),
				priority: t.priority,
				due: t.due
			})),
			top3: base.st.tomorrow?.day === base.today ? base.st.tomorrow.top3 : [],
			waterTarget: base.water,
			workoutDone: base.workoutDone
		});
		let plan = fallback;
		if (ai) try {
			const context = await contextFor(events, tasks, upcoming);
			const prev = base.st.briefing?.plan;
			const raw = await ai([
				"You are MEGA, Victor's head coach. Plan his day: what makes today a win for his goals. Tough love, realistic.",
				`It is ${hmNow(now)}. Only plan from now on, never over calendar events, with 10-minute breaks between blocks. 1–3 must-dos (the ones that matter most; last night's top 3 first if given). Focus blocks 25–90 min. A training slot if he hasn't trained today. Water goal in ml.`,
				"Big picture first: blocks must move his tracked goals and nearest deadlines forward (see his goals, deadlines and weekly targets below); say which goal in the block title when it fits (\"Algebra set (exam 15 Dec)\").",
				"headline: one short line with numbers (\"3 must-dos · 2h40 focus · gym 18:00\").",
				note ? `He asked to change the previous plan: "${note}". Previous plan: ${JSON.stringify(prev ?? null)}` : prev ? `He asked for a different plan than: ${JSON.stringify(prev)}` : "",
				plans.length ? `Goals planned backward from their deadlines (today's minutes are a MUST; booked ones are already in the calendar):\n${plans.map((p) => `- ${planLine(p)}${bookedToday(p) ? " (booked today)" : ""}`).join("\n")}` : "",
				`A simple starting point (improve it): ${JSON.stringify(fallback)}`,
				"Answer ONLY with JSON: {\"headline\": string, \"mustdos\": string[], \"blocks\": [{\"title\": string, \"start\": \"HH:MM\", \"minutes\": number}], \"training\": {\"time\": \"HH:MM\", \"what\": string} | null, \"waterMl\": number}",
				"",
				"== Victor right now ==",
				context
			].filter(Boolean).join("\n"), {
				json: true,
				think: true,
				strong: true
			});
			const json = String(raw).match(/\{[\s\S]*\}/)?.[0];
			plan = cleanProposal(json ? JSON.parse(json) : null, fallback, events, hmNow(now));
		} catch {
			plan = fallback;
		}
		return mirror.write((db) => {
			const st = load(db, plan.day);
			const version = (st.briefing?.version ?? 0) + 1;
			save(db, {
				...st,
				briefing: {
					status: "proposed",
					sentAt: (/* @__PURE__ */ new Date()).toISOString(),
					plan,
					version
				}
			});
			history(db, plan.day, { plan: "proposed" });
			return {
				plan,
				version
			};
		});
	}
	/** Approved: blocks and training into the calendar, must-dos on Today (starred in Todoist). */
	async function approve() {
		const cur = await mirror.read((db) => load(db, services.services(db).wallet.today()).briefing);
		if (!cur) return {
			ok: false,
			done: ["No plan to approve yet"]
		};
		if (cur.status === "approved") return {
			ok: true,
			done: ["Already approved"],
			plan: cur.plan
		};
		const p = cur.plan;
		const done = [];
		await mirror.write((db) => {
			const st = load(db, p.day);
			if (st.briefing) save(db, {
				...st,
				briefing: {
					...st.briefing,
					status: "approved"
				}
			});
			history(db, p.day, { plan: "approved" });
		});
		if (calendar) {
			let made = 0;
			const items = [...p.blocks.map((b) => ({
				title: b.title,
				start: b.start,
				minutes: b.minutes
			})), ...p.training ? [{
				title: `💪 ${p.training.what}`,
				start: p.training.time,
				minutes: Number(/(\d+)\s*min/.exec(p.training.what)?.[1]) || 45
			}] : []];
			for (const b of items) {
				const start = /* @__PURE__ */ new Date(`${p.day}T${b.start}:00`);
				if (await calendar.create({
					title: b.title,
					start: start.toISOString(),
					end: new Date(start.getTime() + b.minutes * 6e4).toISOString(),
					description: "Planned with your coach in Life System"
				}).then(() => true).catch(() => false)) made++;
			}
			if (items.length) done.push(made ? `🗓 ${made} block${made === 1 ? "" : "s"} in your calendar` : "⚠️ Calendar: blocks not added");
		} else if (p.blocks.length) done.push("⚠️ Connect Google Calendar to get the blocks in your calendar");
		if (p.mustdos.length) {
			const added = await mirror.write((db) => {
				const svc = services.services(db);
				const plan = svc.focus.plan(p.day);
				const have = new Set(plan.items.map((x) => x.text.toLowerCase()));
				const fresh = p.mustdos.filter((m) => !have.has(m.toLowerCase()));
				if (fresh.length) svc.focus.setPlan([...plan.items.map((x) => x.text), ...fresh]);
				return fresh;
			});
			if (todoist) {
				const tasks = await todoist.today().catch(() => []);
				for (const m of added) {
					const t = tasks.find((x) => x.content.trim().toLowerCase() === m.toLowerCase());
					if (t && todoist.update) await todoist.update(t.id, { labels: [.../* @__PURE__ */ new Set([...t.labels ?? [], "today"])] }).catch(() => null);
					else if (!t) await todoist.quickAdd(`${m} today @today`).catch(() => null);
				}
			}
			done.push(`⭐ ${p.mustdos.length} must-do${p.mustdos.length === 1 ? "" : "s"} on Today`);
		}
		return {
			ok: true,
			done,
			plan: p
		};
	}
	/** Planned vs done today. */
	async function dayResult() {
		return mirror.read((db) => {
			const svc = services.services(db);
			const today = svc.wallet.today();
			const st = load(db, today);
			const f = svc.focus.state();
			const plan = svc.focus.plan(today);
			const sport = sportState(db);
			const water = sport ? sharedView(sport, sportToday()).water : {
				ml: 0,
				target: 2700
			};
			const blocks = st.briefing?.status === "approved" ? st.briefing.plan.blocks : [];
			return {
				mustdosDone: plan.items.filter((x) => x.done).length,
				mustdosTotal: plan.items.length,
				focusMin: f.todayMin,
				plannedFocusMin: blocks.reduce((t, b) => t + b.minutes, 0),
				blocksDone: 0,
				blocksPlanned: 0,
				waterMl: water.ml,
				waterTarget: water.target,
				workoutDone: (svc.wallet.summary().todayRules ?? []).includes("body.workout_done"),
				trainingPlanned: !!st.briefing?.plan.training
			};
		});
	}
	/** The evening review: the score, one lesson, tomorrow's top 3 (saved for the morning plan). */
	async function evening() {
		const result = await dayResult();
		const score = dayScore(result);
		const [open, tomorrowTasks] = await Promise.all([mirror.read((db) => {
			const svc = services.services(db);
			return svc.focus.plan(svc.wallet.today()).items.filter((x) => !x.done).map((x) => x.text);
		}), todoist?.upcoming ? todoist.upcoming(2).catch(() => []) : Promise.resolve([])]);
		const today = await mirror.read((db) => services.services(db).wallet.today());
		const tomorrow = addDays$1(today, 1);
		const nextUp = tomorrowTasks.filter((t) => t.due && t.due <= tomorrow).sort((a, b) => b.priority - a.priority).map((t) => t.content);
		let lesson = weakest(result);
		let top3 = [.../* @__PURE__ */ new Set([...open, ...nextUp])].slice(0, 3);
		if (ai) try {
			const context = await contextFor(null, null, tomorrowTasks);
			const raw = await ai([
				"You are MEGA, Victor's head coach. It's his evening review. Be honest and short.",
				`Today: score ${score}/100. ${JSON.stringify(result)}. Open must-dos: ${open.join("; ") || "none"}. Due tomorrow in Todoist: ${nextUp.join("; ") || "nothing"}.`,
				"lesson: ONE sentence: what to do differently tomorrow, concrete, tied to his numbers or patterns. top3: tomorrow's 3 most important things (short, as tasks).",
				"Answer ONLY with JSON: {\"lesson\": string, \"top3\": string[]}",
				"",
				context
			].join("\n"), {
				json: true,
				think: true,
				strong: true
			});
			const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? "{}");
			if (typeof j.lesson === "string" && j.lesson.trim()) lesson = j.lesson.trim().slice(0, 240);
			const t = (Array.isArray(j.top3) ? j.top3 : []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3);
			if (t.length) top3 = t;
		} catch {}
		await mirror.write((db) => {
			const st = load(db, today);
			save(db, {
				...st,
				evening: {
					sentAt: (/* @__PURE__ */ new Date()).toISOString(),
					score,
					top3,
					lesson
				},
				tomorrow: {
					day: tomorrow,
					top3
				}
			});
			history(db, today, {
				score,
				mustdos: [result.mustdosDone, result.mustdosTotal]
			});
		});
		const goals = (await goalPlans().catch(() => [])).filter((p) => p.status !== "done");
		const rebooked = await rebookGoals().catch(() => []);
		return {
			result,
			score,
			lesson,
			top3,
			goals: goals.map(planLine),
			rebooked
		};
	}
	async function setTop3(text) {
		const top3 = readLines(text);
		await mirror.write((db) => {
			const today = services.services(db).wallet.today();
			const st = load(db, today);
			save(db, {
				...st,
				tomorrow: {
					day: addDays$1(today, 1),
					top3
				}
			});
		});
		return top3;
	}
	/** The Sunday review: the week in numbers, a win, a leak, next week's focus and big 3. */
	async function weekly() {
		const { report, today } = await mirror.read((db) => {
			const svc = services.services(db);
			return {
				report: progressReport(svc.progress.input(financeSpending(financeStateFrom(db, null)))),
				today: svc.wallet.today()
			};
		});
		const coachCheck = await mirror.read((db) => {
			const svc = services.services(db);
			const v = impactVerdict(scorecard(cleanHistory(readJson(db, COACH_HISTORY, null)), svc.progress.input(null, /* @__PURE__ */ new Date(), 70).focus, svc.wallet.today(), 8));
			return `Is the coach working? ${{
				working: "working, you are improving",
				mixed: "mixed",
				"not yet": "not working yet, we change something",
				"too early": "too early to tell"
			}[v.verdict]}${v.verdict === "too early" ? "" : ` (${v.lines.join("; ")})`}`;
		});
		const goalLines = (await goalPlans().catch(() => [])).filter((p) => p.status !== "done").map((p) => `🎯 ${planLine(p)}`);
		const lines = [
			...report.metrics.map((m) => `${m.label}: ${m.text}${m.target ? ` of ${m.targetText}` : ""} (${m.trend})`),
			...goalLines,
			coachCheck
		];
		const ranked = report.metrics.filter((m) => m.target && m.id !== "spend").map((m) => ({
			m,
			k: m.now / m.target
		})).sort((a, b) => b.k - a.k);
		const upcoming = todoist?.upcoming ? await todoist.upcoming(8).catch(() => []) : [];
		let out = {
			score: report.score,
			prevScore: report.prevScore,
			lines,
			win: ranked[0] ? `${ranked[0].m.label}: ${ranked[0].m.text}` : "You showed up.",
			leak: ranked.length ? `${ranked[ranked.length - 1].m.label}: ${ranked[ranked.length - 1].m.text}${ranked[ranked.length - 1].m.target ? ` of ${ranked[ranked.length - 1].m.targetText}` : ""}` : "Not enough data yet.",
			focus: suggestWeekFocus(report.metrics),
			note: "",
			big3: [...upcoming].sort((a, b) => b.priority - a.priority).slice(0, 3).map((t) => t.content)
		};
		if (ai) try {
			const context = await contextFor(null, null, upcoming);
			const raw = await ai([
				"You are MEGA, Victor's head coach. Sunday review of his week. Honest, short, numbers.",
				`Week score ${report.score}/100 (last week ${report.prevScore}). ${lines.join("; ")}.`,
				"win: the best thing this week (with its number). leak: the biggest leak (with its number). focus: next week's ONE area, one of focus|wake|sport|clean|todoist|spend|mustdo. note: his target in a few words (\"up at 7:00 every day\"). big3: the 3 big tasks for next week (from his deadlines and goals).",
				"Answer ONLY with JSON: {\"win\": string, \"leak\": string, \"focus\": string, \"note\": string, \"big3\": string[]}",
				"",
				context
			].join("\n"), {
				json: true,
				think: true,
				strong: true
			});
			const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? "{}");
			const big3 = (Array.isArray(j.big3) ? j.big3 : []).map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3);
			out = {
				...out,
				win: String(j.win ?? "").trim().slice(0, 200) || out.win,
				leak: String(j.leak ?? "").trim().slice(0, 200) || out.leak,
				focus: [
					"focus",
					"wake",
					"sport",
					"clean",
					"todoist",
					"spend",
					"mustdo"
				].includes(j.focus) ? j.focus : out.focus,
				note: String(j.note ?? "").trim().slice(0, 140),
				big3: big3.length ? big3 : out.big3
			};
		} catch {}
		await mirror.write((db) => {
			const st = load(db, today);
			save(db, {
				...st,
				weekly: {
					day: today,
					focus: out.focus,
					note: out.note,
					big3: out.big3
				}
			});
		});
		return out;
	}
	/** "Use this plan": next week's focus and big 3 (typed ones replace the suggestion). */
	async function applyWeekly(typed) {
		return mirror.write((db) => {
			const svc = services.services(db);
			const st = load(db, svc.wallet.today());
			const w = st.weekly;
			if (!w) throw new Error("No weekly review yet");
			const big3 = typed ? readLines(typed) : w.big3;
			if (!big3.length) throw new Error("Give at least one big task");
			const plan = svc.weekPlan.save({
				focus: w.focus,
				note: w.note,
				big3: big3.map((text) => ({
					text,
					done: false
				}))
			});
			if (typed) save(db, {
				...st,
				weekly: {
					...w,
					big3
				}
			});
			return `🗓 Next week: ${focusName(plan.focus)} · ${plan.big3.map((b) => b.text).join(" / ")}`;
		});
	}
	/** Water behind pace: one line with the numbers and what to do. */
	async function waterLine() {
		return mirror.write((db) => {
			const svc = services.services(db);
			const st = load(db, svc.wallet.today());
			const sport = sportState(db);
			if (!sport) return null;
			const w = sharedView(sport, sportToday()).water;
			save(db, {
				...st,
				water: [...st.water, hmNow()]
			});
			const glasses = Math.max(1, Math.ceil((w.target - w.ml) / w.glass / 3));
			return `💧 Water ${(w.ml / 1e3).toFixed(1)} of ${(w.target / 1e3).toFixed(1)} L and the day is going. Drink ${glasses} glass${glasses === 1 ? "" : "es"} now. Send "water 250" after each.`;
		});
	}
	/** No training yet by the evening (once a day). */
	async function trainingLine() {
		return mirror.write((db) => {
			const svc = services.services(db);
			const st = load(db, svc.wallet.today());
			save(db, {
				...st,
				training: true
			});
			const slot = st.briefing?.plan.training;
			const body = svc.body.state();
			return `💪 No training today yet${slot ? ` (planned ${slot.time})` : ""}. Streak ${body.streak} day${body.streak === 1 ? "" : "s"}, ${body.workoutsThisWeek} this week. 20 minutes counts: start now.`;
		});
	}
	return {
		state,
		setPrefs,
		propose,
		approve,
		dayResult,
		evening,
		setTop3,
		weekly,
		applyWeekly,
		waterLine,
		trainingLine,
		goalPlans,
		bookGoals,
		rebookGoals,
		countPromise: (day, key) => mirror.write((db) => countPromise(db, day, key))
	};
}
// src/renderer/src/web/webBots.ts
var esc = (s) => s.replace(/[<>&]/g, (c) => ({
	"<": "&lt;",
	">": "&gt;",
	"&": "&amp;"
})[c]);
var LOGS_KEY = "life_bot_logs";
var store = typeof localStorage !== "undefined" ? localStorage : null;
/** Telegram's Bot API, small and with a timeout so a hung call can't stall the app. */
async function tg(token, method, body) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), 15e3);
	try {
		const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
			method: body ? "POST" : "GET",
			headers: body ? { "Content-Type": "application/json" } : void 0,
			body: body ? JSON.stringify(body) : void 0,
			signal: ctrl.signal
		});
		return await res.json().catch(() => ({
			ok: false,
			description: `HTTP ${res.status}`
		}));
	} finally {
		clearTimeout(t);
	}
}
/**
* A voice note or photo from Telegram, as base64 for Gemini (up to 15 MB;
* Telegram voice notes are OGG/Opus, photos JPEG).
*/
async function downloadFile(token, fileId, kind) {
	try {
		const info = await tg(token, `getFile?file_id=${encodeURIComponent(fileId)}`);
		const path = info?.result?.file_path;
		if (!info?.ok || !path || (info.result.file_size ?? 0) > 15e6) return null;
		const res = await fetch(`https://api.telegram.org/file/bot${token}/${path}`);
		if (!res.ok) return null;
		const buf = new Uint8Array(await res.arrayBuffer());
		let bin = "";
		for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768));
		const ext = String(path).split(".").pop()?.toLowerCase();
		return {
			kind,
			mime: kind === "photo" ? ext === "png" ? "image/png" : "image/jpeg" : ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : "audio/ogg",
			data: btoa(bin)
		};
	} catch {
		return null;
	}
}
/** Sport Track's checklist on this device: a rep sent from Telegram counts today. */
function addRepsToSportTrack(name, amount) {
	let prog = null;
	updateSport((st) => {
		const ex = findExercise(st, name);
		if (!ex) return;
		ex.doneToday = (Number(ex.doneToday) || 0) + amount;
		prog = {
			done: ex.doneToday,
			target: Number(ex.target) || 0
		};
	});
	return prog;
}
/**
* Sport Track's data in Turso (settings.sport_tracker_json, see sportSync.ts),
* for the server: reps land there and every device picks them up.
*/
function addRepsInDb(db, name, amount) {
	const st = (() => {
		try {
			return JSON.parse(getSetting(db, "sport_tracker_json") || "null");
		} catch {
			return null;
		}
	})()?.data;
	if (!st || !Array.isArray(st.exercises)) return null;
	const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	if (st.lastDate !== today) {
		st.lastDate = today;
		st.exercises.forEach((e) => e.doneToday = 0);
		if (st.water) st.water.currentMl = 0;
	}
	const ex = findExercise(st, name);
	if (!ex) return null;
	ex.doneToday = (Number(ex.doneToday) || 0) + amount;
	setSetting(db, "sport_tracker_json", JSON.stringify({
		savedAt: Date.now(),
		data: st
	}));
	return {
		done: ex.doneToday,
		target: Number(ex.target) || 0
	};
}
/** Which Life System expense a Finance Helper record from Telegram made (for Undo). */
function linkExpense(db, txId, expenseId) {
	let links = {};
	try {
		links = JSON.parse(getSetting(db, "tg_expense_links") || "{}");
	} catch {}
	links[txId] = expenseId;
	const keys = Object.keys(links);
	for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete links[k];
	setSetting(db, "tg_expense_links", JSON.stringify(links));
}
function takeLink(db, txId) {
	try {
		const links = JSON.parse(getSetting(db, "tg_expense_links") || "{}");
		const id = links[txId];
		if (id == null) return null;
		delete links[txId];
		setSetting(db, "tg_expense_links", JSON.stringify(links));
		return Number(id);
	} catch {
		return null;
	}
}
/**
* Finance Helper's accounts, for /balance (own currency each): this device's
* copy, else the backup Finance Helper keeps in Turso (the server has no device).
*/
function financeAccounts(db) {
	try {
		const raw = store?.getItem("finance-helper.state") || (db ? getSetting(db, "finance_backup_json") : null);
		const st = JSON.parse(raw || "null");
		const accounts = st?.settings?.accounts ?? [];
		const tx = Array.isArray(st?.tx) ? st.tx : [];
		return accounts.filter((a) => !a.archived).map((a) => {
			let bal = Number(a.start) || 0;
			for (const t of tx) if (t.type === "income" && t.account === a.id) bal += Number(t.amount) || 0;
			else if (t.type === "expense" && t.account === a.id) bal -= Number(t.amount) || 0;
			else if (t.type === "transfer") {
				if (t.from === a.id) bal -= Number(t.amount) || 0;
				if (t.to === a.id) bal += Number(t.toAmount ?? t.amount) || 0;
			}
			return {
				name: String(a.name),
				balanceMdl: Math.round(bal) / 100,
				currency: a.currency || st?.settings?.currency || "MDL"
			};
		});
	} catch {
		return [];
	}
}
/** 1–5 under the wake-up message: how you slept. */
var sleepKeyboard = (day) => ({ inline_keyboard: [[
	1,
	2,
	3,
	4,
	5
].map((n) => ({
	text: [
		"😫",
		"😕",
		"😐",
		"🙂",
		"😄"
	][n - 1] + " " + n,
	callback_data: `sq|${day}|${n}`
}))] });
/** The sleep coach's word after a rating. */
function sleepTip(n, bed) {
	if (n <= 2) return `Rough night. Today: no caffeine after 15:00, and tonight lights out at <b>${bed}</b>. I'll remind you.`;
	if (n === 3) return `Okay night. Same bedtime tonight (${bed}) keeps it improving.`;
	return "Great. Keep the same rhythm tonight.";
}
/** Under "Focus started": one tap stops and logs it. */
var STOP_KEYBOARD = { inline_keyboard: [[{
	text: "⏹ Stop & log",
	callback_data: "fx|"
}]] };
/** "▶ 50 min: …" buttons that start a focus session (subject kept short for Telegram's 64 bytes). */
function focusKeyboard(subjects) {
	const rows = subjects.filter(Boolean).slice(0, 3).map((t) => {
		const short = t.split(/\s+/).slice(0, 4).join(" ").slice(0, 28);
		return [{
			text: `▶ 50 min: ${short}`,
			callback_data: `fo|${short}`
		}];
	});
	return rows.length ? { inline_keyboard: rows } : void 0;
}
/** After a session: what was logged, and for a must-do or Todoist task, a "Done" button. */
function stoppedReply(r, plan) {
	const head = `✅ <b>${r.session.minutes} min of ${esc(r.session.subject)}</b> logged.${r.coins ? `\n🪙 +${r.coins} coins` : ""}\nToday: ${hm$1(r.state.todayMin)}`;
	const rate = [
		1,
		2,
		3,
		4,
		5
	].map((n) => ({
		text: [
			"😣",
			"😕",
			"😐",
			"🙂",
			"🔥"
		][n - 1],
		callback_data: `fq|${plan.day}|${n}|${r.session.minutes}`
	}));
	const t = r.task;
	if (t?.kind === "mustdo") {
		const i = plan.items.findIndex((p) => !p.done && p.text === t.ref);
		if (i >= 0) return {
			reply: `${head}\n\nFinished “${esc(t.title)}”? And how did it go?`,
			keyboard: { inline_keyboard: [[{
				text: "✅ Yes, tick it",
				callback_data: `pp|${plan.day}|${i}`
			}], rate] }
		};
	}
	if (t?.kind === "todoist") return {
		reply: `${head}\n\nFinished “${esc(t.title)}”? And how did it go?`,
		keyboard: { inline_keyboard: [[{
			text: "✅ Yes, done in Todoist",
			callback_data: `td|${t.ref}`.slice(0, 64)
		}], rate] }
	};
	return {
		reply: `${head}\n\nHow did it go?`,
		keyboard: { inline_keyboard: [rate] }
	};
}
function createWebBots({ mirror, services, defaults, onExpense, server = false, todoist = null, ai = null, calendar = null }) {
	let polling = false;
	let timer = null;
	let lastPollAt = null;
	let lastError = null;
	let processed = 0;
	let running = null;
	let pruned = false;
	const merge = (saved) => {
		const out = { ...defaults };
		for (const [k, v] of Object.entries(saved ?? {})) if (v !== "" && v != null) out[k] = v;
		return out;
	};
	const config = () => mirror.read((db) => getSetting(db, "bot_bridge_config")).then((raw) => merge(raw ? JSON.parse(raw) : {})).catch(() => {
		try {
			const local = store?.getItem("bot_bridge_config");
			return merge(local ? JSON.parse(local) : {});
		} catch {
			return defaults;
		}
	});
	const addLog = (command, sender, success, reply) => {
		if (!store) return;
		try {
			const list = JSON.parse(store.getItem(LOGS_KEY) || "[]");
			list.push({
				id: Date.now() + Math.random(),
				ts: (/* @__PURE__ */ new Date()).toISOString(),
				command,
				sender,
				success,
				reply
			});
			store.setItem(LOGS_KEY, JSON.stringify(list.slice(-100)));
		} catch {}
	};
	const allowed = (cfg, chat) => [
		cfg.chatId,
		cfg.sportBotChatId,
		cfg.financeBotChatId,
		cfg.manBotChatId,
		cfg.wakyBotChatId,
		cfg.plannerBotChatId,
		cfg.coachBotChatId
	].filter(Boolean).some((id) => String(id) === chat);
	/** Focus sessions stopped from Telegram: they go into Google Calendar after the reply. */
	const focusEnded = [];
	const flushFocus = async () => {
		const list = focusEnded.splice(0);
		if (!calendar) return;
		for (const f of list) {
			if (f.minutes < 5) continue;
			const end = /* @__PURE__ */ new Date();
			await calendar.create({
				title: `Focus: ${f.subject}`,
				start: (/* @__PURE__ */ new Date(end.getTime() - f.minutes * 6e4)).toISOString(),
				end: end.toISOString(),
				description: `${f.minutes} min of focus, logged by Life System`
			}).catch(() => null);
		}
	};
	const rhythm = createRhythm({
		mirror,
		services,
		todoist: todoist ?? null,
		calendar: calendar ?? null,
		ai: ai ?? null
	});
	/** Sends today's plan with Approve / Change / Redo. */
	async function sendProposal(token, chat, note = "") {
		const { plan, version } = await rhythm.propose(note);
		const text = proposalText(plan, { version });
		await tg(token, "sendMessage", {
			chat_id: chat,
			text,
			parse_mode: "HTML",
			reply_markup: PROPOSAL_KEYBOARD
		});
		return text;
	}
	const dayBounds = () => {
		const s = /* @__PURE__ */ new Date();
		s.setHours(0, 0, 0, 0);
		return [s.toISOString(), new Date(s.getTime() + 864e5).toISOString()];
	};
	/**
	* Right after you log your wake-up on Telegram: today's plan question (once
	* a day, if there's no plan yet), with what's in your calendar.
	*/
	async function morningAfterWake(token, chat) {
		const r = await rhythm.state().catch(() => null);
		if (r?.prefs.on) {
			if (!r.state.briefing && (/* @__PURE__ */ new Date()).getHours() < 12) await sendProposal(token, chat).catch(() => null);
			return;
		}
		if (!await mirror.write((db) => {
			const svc = services.services(db);
			const today = svc.wallet.today();
			if (getSetting(db, "morning_sent_day") === today || svc.focus.plan(today).items.length) return false;
			setSetting(db, "morning_sent_day", today);
			return true;
		})) return;
		const events = calendar ? await calendar.events(...dayBounds()).catch(() => []) : [];
		const today = await services.read((s) => s.wallet.today());
		await tg(token, "sendMessage", {
			chat_id: chat,
			text: `☀️ <b>Good morning!</b>${events.length ? `\n🗓 Today: ${esc(agendaText(events, today))}\n` : ""}\n<b>${PLAN_ASK}</b>\nReply to this message, one per line.`,
			parse_mode: "HTML",
			reply_markup: {
				force_reply: true,
				input_field_placeholder: "Essay intro; gym; call Leo"
			}
		}).catch(() => null);
	}
	/** After you send the plan: time blocks for it in your free time, to approve with one tap. */
	async function offerBlocks(token, chat) {
		if (!calendar) return;
		const events = await calendar.events(...dayBounds()).catch(() => null);
		if (!events) return;
		const now = /* @__PURE__ */ new Date();
		const after = `${String(now.getHours()).padStart(2, "0")}:${String(Math.ceil(now.getMinutes() / 15) * 15 % 60).padStart(2, "0")}`;
		const blocks = await mirror.write((db) => {
			const svc = services.services(db);
			const today = svc.wallet.today();
			const items = svc.focus.plan(today).items.filter((x) => !x.done).map((x) => ({
				title: x.text,
				minutes: 50
			}));
			const b = suggestBlocks(freeGaps(events, today, {
				after,
				minMinutes: 30
			}), items);
			if (b.length) setSetting(db, "plan_suggestion", JSON.stringify({
				day: today,
				blocks: b
			}));
			return b;
		});
		if (!blocks.length) return;
		await tg(token, "sendMessage", {
			chat_id: chat,
			text: `🗓 <b>I can fit them into your free time:</b>\n${blocks.map((b) => `${b.start}–${b.end} · ${esc(b.title)}`).join("\n")}`,
			parse_mode: "HTML",
			reply_markup: { inline_keyboard: [[{
				text: "✅ Put them in my calendar",
				callback_data: "gp|"
			}, {
				text: "No thanks",
				callback_data: "gx|"
			}]] }
		}).catch(() => null);
	}
	/** One command, on the services. Returns the reply and what changed. */
	let currentDb = null;
	/**
	* A money message, the smart way (financeBot.ts): Finance Helper's parser,
	* categories and accounts, straight into its synced data, with buttons.
	* Also in Life System's spending log (expenses), linked for "Undo".
	*/
	function runMoney(s, text, key) {
		if (!currentDb) return null;
		const money = logMoney(currentDb, text, key, s.wallet.today());
		if (!money) return null;
		const t = money.tx;
		if (t.type !== "expense") return {
			reply: money.reply,
			keyboard: money.keyboard
		};
		const res = s.money.addExpense(t.amount, t.category, t.note ? `[Telegram] ${t.note}` : "[Telegram]", /* @__PURE__ */ new Date(), true);
		linkExpense(currentDb, t.id, res.expense.id);
		const insight = moneyInsight(financeStateFrom(currentDb, server ? null : store), t, s.wallet.today());
		return {
			reply: money.reply + (insight ? `\n${esc(insight)}` : "") + (res.awarded ? "\n🪙 <b>+3 coins</b> (first spending logged today)" : ""),
			keyboard: money.keyboard
		};
	}
	/** /focus, /stop, /plan, /fun, /week, /deadlines (focus.ts). */
	function runFocus(s, text) {
		const m = /^\/(focus|stop|plan|fun|week|deadlines|review)(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(text.trim());
		if (!m) return null;
		const cmd = m[1].toLowerCase();
		const arg = (m[2] ?? "").trim();
		const f = s.focus;
		if (cmd === "focus") {
			const st = f.state();
			if (!arg) {
				if (st.running) {
					const min = Math.round((Date.now() - Date.parse(st.running.startedAt)) / 6e4);
					return { reply: `⏱ <b>Focusing on ${esc(st.running.subject)}</b>: ${min} of ${st.running.planned} min.\nSend <code>/stop</code> when you're done.` };
				}
				return { reply: `⏱ Today: <b>${hm$1(st.todayMin)}</b> of focus.\nStart one: <code>/focus 50 math</code>` };
			}
			const minutes = Number(/\b(\d{1,3})\b/.exec(arg)?.[1] ?? 50);
			const subject = arg.replace(/\b\d{1,3}\s*(min|m)?\b/i, "").trim() || st.subjects[0] || "Focus";
			f.start(subject, minutes);
			return {
				reply: `⏱ <b>Focus started:</b> ${esc(subject)} · ${minutes} min.\nPhone away. Tap Stop (or send <code>/stop</code>) when you finish.`,
				keyboard: STOP_KEYBOARD
			};
		}
		if (cmd === "stop") {
			const r = f.stop();
			focusEnded.push({
				subject: r.session.subject,
				minutes: r.session.minutes
			});
			return stoppedReply(r, f.plan(s.wallet.today()));
		}
		if (cmd === "plan") {
			if (arg) f.setPlan(parsePlan(arg));
			const plan = f.plan(s.wallet.today());
			return {
				reply: planText(plan, arg ? "📝 <b>Plan saved</b>" : void 0),
				keyboard: plan.items.length ? planKeyboard(plan, false) : void 0
			};
		}
		if (cmd === "fun") {
			const minutes = Number(/\b(\d{1,3})\b/.exec(arg)?.[1] ?? 0);
			if (!minutes) return { reply: "🎮 How long? e.g. <code>/fun 30 youtube</code> (1 coin a minute)" };
			const what = arg.replace(/\b\d{1,3}\s*(min|m)?\b/i, "").trim() || "Fun";
			const r = f.fun(minutes, what);
			return { reply: `🎮 <b>Enjoy ${minutes} min of ${esc(what)}</b> · −${r.cost} coins (left: ${r.balance})` };
		}
		if (cmd === "review") {
			if (!arg) return { reply: "📝 Send one line about today, e.g. <code>/review good focus, phone was the problem</code>" };
			const today = s.wallet.today();
			const cur = f.plan(today);
			f.review(cur.review ? `${cur.review}\n${arg}` : arg, cur.reasons);
			return { reply: "📝 <b>Saved.</b> Thanks: this is what makes next week better." };
		}
		const st = f.state();
		if (cmd === "week") return { reply: weekText(st.week, st.goals) };
		return { reply: goalsText(st.goals) };
	}
	function run(s, text, key = "") {
		const ml = text.startsWith("/") ? null : parseWater(text);
		if (ml) {
			const st = sportState(s.db);
			if (st) {
				const day = sportToday();
				const next = addWater(st, ml, day);
				setSetting(s.db, "sport_tracker_json", JSON.stringify({
					savedAt: Date.now(),
					data: next
				}));
				const v = sharedView(next, day);
				const pct = Math.round(v.water.ml / Math.max(1, v.water.target) * 100);
				return { reply: `💧 <b>${ml > 0 ? "+" : ""}${ml} ml</b> · ${v.water.ml} of ${v.water.target} ml today (${pct}%)${pct >= 100 ? "\n🎯 Water goal done!" : ""}` };
			}
		}
		const viaFocus = runFocus(s, text);
		if (viaFocus) return viaFocus;
		const parsed = parseTelegramText(text);
		if ((parsed.type === "expense" || parsed.type === "unknown") && !text.startsWith("/")) {
			const money = runMoney(s, text, key);
			if (money) return money;
		}
		switch (parsed.type) {
			case "help": return { reply: formatHelpMessage() };
			case "today": {
				const sum = s.wallet.summary();
				return { reply: formatTodayStatus({
					balance: sum.balance,
					level: sum.level.level,
					rank: sum.level.rank,
					totalXp: sum.totalXp,
					ritualsDone: sum.todayRules?.length ?? 0,
					totalRituals: 5,
					cleanStreak: s.discipline.state().current,
					workoutStreak: s.body.state().streak,
					tasksLeft: s.tasks.state().tasks.filter((t) => !t.done).length
				}) };
			}
			case "checkin": {
				s.discipline.checkIn();
				const st = s.discipline.state();
				return { reply: formatCleanCheckinResponse(st.current + (st.resets === 0 ? 1 : 0), 20) };
			}
			case "oath":
				s.discipline.oath();
				return { reply: "📜 <b>Morning Oath Affirmed!</b>\n\n<i>\"I commit to purity, disciplined physical power, sharp financial focus, and daily relentless self-mastery.\"</i>\n\n+3 coins awarded!" };
			case "workout": {
				const name = parsed.exerciseName || "pushups";
				const amount = parsed.exerciseAmount || 20;
				const res = s.body.logWorkout({
					title: `${name} (+${amount})`,
					items: [{
						exerciseId: name.toLowerCase(),
						name,
						amount,
						unit: "reps"
					}],
					note: "Logged via Telegram"
				});
				return {
					reply: formatWorkoutResponse(name, amount, res.state.streak, res.awarded ? 10 : 0),
					sport: {
						name,
						amount
					}
				};
			}
			case "sport": {
				const name = parsed.exerciseName || "Workout";
				const amount = parsed.exerciseAmount || 1;
				const rawUnit = parsed.exerciseUnit || "minutes";
				const unit = rawUnit === "reps" || rawUnit === "kg" || rawUnit === "sets" ? rawUnit : "minutes";
				const res = s.body.logWorkout({
					title: `${name} (${amount} ${rawUnit})`,
					items: [{
						exerciseId: name.toLowerCase().replace(/\s+/g, "_"),
						name,
						amount,
						unit
					}],
					note: `Logged via Telegram (${amount} ${rawUnit})`
				});
				return { reply: formatSportResponse(name, amount, rawUnit, res.state.streak, res.awarded ? 10 : 0, res.awarded ? 25 : 0) };
			}
			case "weight": {
				const w = parsed.metricWeight;
				if (!w || w < 30 || w > 300) return { reply: "⚠️ Send a real weight, e.g. <code>/weight 74.5</code>." };
				s.body.logMetric({
					weight: w,
					note: "Telegram"
				});
				return { reply: formatMetricResponse("weight", w, "kg", 0, 0) };
			}
			case "waist": {
				const w = parsed.metricWaist;
				if (!w || w < 40 || w > 200) return { reply: "⚠️ Send a real waist size, e.g. <code>/waist 82</code>." };
				s.body.logMetric({
					waist: w,
					note: "Telegram"
				});
				return { reply: formatMetricResponse("waist", w, "cm", 0, 0) };
			}
			case "sport_status":
			case "pr": {
				const st = s.body.state();
				return { reply: formatSportStatusResponse({
					streak: st.streak,
					totalWorkouts: st.totalWorkouts,
					thisWeek: st.workoutsThisWeek,
					latestWeight: st.latestWeight,
					latestWaist: st.latestWaist
				}) };
			}
			case "expense": {
				const cents = Math.round((parsed.expenseAmount || 0) * 100);
				if (!(cents > 0)) return { reply: "⚠️ How much? e.g. <code>/expense 45 food lunch</code>" };
				const cat = parsed.expenseCategory || "other";
				const note = parsed.expenseNote || "";
				if (cat === "income") return {
					reply: `💰 <b>Income noted:</b> ${formatMoney$1(cents, "MDL")}${note ? ` · ${esc(note)}` : ""}\n\nAdded to Finance Helper.`,
					expense: {
						amount: cents,
						category: "income",
						note,
						type: "income"
					}
				};
				const res = s.money.addExpense(cents, cat, note ? `[Telegram] ${note}` : "[Telegram]", /* @__PURE__ */ new Date(), true);
				const cur = res.state.currency || "MDL";
				return {
					reply: formatExpenseResponse(formatMoney$1(cents, cur), cat, note || null, formatMoney$1(Math.max(0, res.state.today.remaining), cur), res.awarded ? 3 : 0),
					expense: {
						amount: cents,
						category: res.expense?.category ?? cat,
						note
					}
				};
			}
			case "balance": {
				const coins = s.wallet.summary().balance;
				const accounts = financeAccounts(currentDb);
				const money = s.money.state();
				return { reply: formatBalanceResponse({
					currency: "MDL",
					walletCoins: coins,
					walletCoinsValueMdl: Math.round(coins / 10 * 100) / 100,
					vaultSurplusMdl: s.economy.getEconomySummary().vaultBalance,
					financeAccountsTotalMdl: accounts.filter((a) => a.currency === "MDL").reduce((t, a) => t + a.balanceMdl, 0),
					financeAccounts: accounts,
					dailyBudgetLeftMdl: Math.max(0, money.today.remaining) / 100
				}) };
			}
			case "wake": {
				const time = parsed.args.find((a) => /^\d{1,2}[:.]\d{2}$/.test(a))?.replace(".", ":");
				const back = parsed.args.some((a) => /^(yesterday|ieri|вчера)$/i.test(a)) ? 1 : 0;
				if (time || back) {
					if (!time) return { reply: "⏰ What time? e.g. <code>/wake yesterday 06:30</code>" };
					const day = addDays$1(s.wallet.today(), -back);
					const res = s.sleep.setWake(day, time);
					return { reply: `🌅 <b>Wake-up ${back ? "for yesterday " : ""}set</b>: ${res.log.wakeTime} (target ${res.log.wakeTarget})\n${res.awarded ? "🎯 On time! <b>+10 coins</b>" : res.log.onTime ? back ? "On time · no coins for past days." : "On time." : "Saved to your sleep history."}` };
				}
				const res = s.sleep.logWake((/* @__PURE__ */ new Date()).toTimeString().slice(0, 5));
				return {
					reply: `🌅 <b>Wake-up logged</b>: ${res.log.wakeTime}\n${res.awarded ? "🎯 On time! <b>+10 coins</b>" : res.log.onTime ? "On time." : "Saved to your sleep history."}\n<i>Woke up earlier? Send</i> <code>/wake 06:40</code>\n\n😴 <b>How did you sleep?</b>`,
					keyboard: sleepKeyboard(res.log.day)
				};
			}
			case "bed": {
				const res = s.sleep.logBed((/* @__PURE__ */ new Date()).toTimeString().slice(0, 5));
				return { reply: `🌙 <b>Bedtime logged</b>: ${res.log.bedTime}\n${res.awarded ? "🎯 On time! <b>+5 coins</b>" : "Saved to your sleep history."}` };
			}
			case "tasks": {
				const open = s.tasks.state().tasks.filter((t) => !t.done).slice(0, 8);
				return { reply: open.length ? `📋 <b>Open tasks</b>\n\n${open.map((t, i) => `${i + 1}. [${esc(t.category)}] <b>${esc(t.title)}</b>`).join("\n")}\n\n<i>Done one? Send</i> <code>/done 1</code>` : "📋 <b>No open tasks.</b> All clear!" };
			}
			case "done": {
				const open = s.tasks.state().tasks.filter((t) => !t.done);
				const num = parsed.taskIndex ?? parseInt(parsed.args[0], 10);
				const target = open.find((t) => t.id === num) ?? (num > 0 && num <= open.length ? open[num - 1] : void 0);
				if (!target) return { reply: "⚠️ No task with that number. Send <code>/tasks</code> to see them." };
				s.tasks.complete(target.id);
				return { reply: `✅ Done: <b>${esc(target.title)}</b>` };
			}
			case "vault": {
				const v = s.economy.getEconomySummary();
				return { reply: [
					"🏛️ <b>Reward vault</b>",
					"",
					`🪙 Coins: <b>${v.coinsBalance}</b> (≈ ${v.coinsRealValue} ${v.currency})`,
					`💰 Vault: <b>${v.vaultBalance} ${v.currency}</b>`,
					`🔥 Multiplier: ${v.multiplier.label}`,
					v.pinnedGoal ? `🌟 Goal: ${esc(v.pinnedGoal.title)} (${v.pinnedGoal.allocatedCoins}/${v.pinnedGoal.targetCoins} coins)` : ""
				].filter(Boolean).join("\n") };
			}
			case "goals": {
				const goals = s.economy.goals().filter((g) => !g.completed);
				return { reply: goals.length ? `🎯 <b>Goals</b>\n\n${goals.map((g, i) => `${i + 1}. ${g.pinned ? "⭐ " : ""}<b>${esc(g.title)}</b> · ${g.allocatedCoins}/${g.targetCoins} coins`).join("\n")}` : "🎯 No open goals. Add one in the Shop." };
			}
			case "crush": return { reply: formatUrgeResponse() };
			default: return {
				reply: `❓ I didn't understand <code>${esc(text.slice(0, 60))}</code>.\n\nSend <code>/help</code> for the list.`,
				unknown: true
			};
		}
	}
	/**
	* Handles one message in one Turso transaction (with its "seen" mark). If
	* another device got there first, the copy reloads and we skip it.
	*/
	/** A tap on a button under a logged money record (account, category, undo). */
	async function handleButton(botId, update, cfg) {
		const cq = update.callback_query;
		const chat = String(cq?.message?.chat?.id ?? "");
		const data = String(cq?.data ?? "");
		const key = `${botId}:cb:${cq?.id}`;
		if (!cq || !/^(f[acbkuoxq]|p[pr]|td|sq|g[px]|n[ps]|r[bvw])\|/.test(data)) return null;
		const answer = (text) => tg(update.__token, "answerCallbackQuery", {
			callback_query_id: cq.id,
			text
		}).catch(() => null);
		if (!allowed(cfg, chat)) {
			await answer("Not allowed");
			return null;
		}
		const edit = (text, keyboard) => tg(update.__token, "editMessageText", {
			chat_id: chat,
			message_id: cq.message.message_id,
			text,
			parse_mode: "HTML",
			...keyboard ? { reply_markup: keyboard } : {}
		}).catch(() => null);
		if (/^r[bvw]\|/.test(data)) {
			if (!await markSeen(key)) return null;
			const msg = String(cq.message?.text ?? "");
			try {
				if (data === "rb|a") {
					await answer("Approving…");
					const r = await rhythm.approve();
					const text = r.plan ? `${proposalText(r.plan, { approved: true })}\n${r.done.map(esc).join("\n")}` : esc(r.done.join(" "));
					await edit(text);
					return text;
				}
				if (data === "rb|r") {
					await answer("Making another plan…");
					await edit(`${esc(msg)}\n\n🔄 <i>Making another one…</i>`);
					return await sendProposal(update.__token, chat);
				}
				if (data === "rb|e" || data === "rv|e" || data === "rw|e") {
					await answer("Tell me");
					const ask = data === "rb|e" ? EDIT_ASK : data === "rv|e" ? TOP3_ASK : WEEK_ASK;
					await tg(update.__token, "sendMessage", {
						chat_id: chat,
						text: ask,
						reply_markup: {
							force_reply: true,
							input_field_placeholder: data === "rb|e" ? "No gym today; lab report first" : "One per line"
						}
					});
					return ask;
				}
				if (data === "rv|k") {
					await answer("Saved for tomorrow");
					const text = `${esc(msg)}\n\n✅ <b>Saved.</b> They're the first must-dos in tomorrow's plan.`;
					await edit(text);
					return text;
				}
				if (data === "rw|a") {
					const line = await rhythm.applyWeekly();
					await answer("Week planned");
					const text = `${esc(msg)}\n\n✅ ${esc(line)}`;
					await edit(text);
					return text;
				}
			} catch (e) {
				await answer(e.message.slice(0, 190));
			}
			return null;
		}
		if (data.startsWith("td|")) {
			if (!await mirror.write((db) => {
				if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return false;
				db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
				return true;
			})) return null;
			const id = data.slice(3);
			const title = /“([^”]*)”/.exec(String(cq.message?.text ?? ""))?.[1] ?? "Todoist task";
			try {
				if (!todoist) throw new Error("Todoist is not connected");
				await todoist.close(id);
				const paid = await mirror.write((db) => payTodoist(services.services(db), [{
					id,
					content: title
				}]));
				await answer(paid ? "+8 coins" : "Done");
				const text = `${String(cq.message?.text ?? "").split("\n\nFinished")[0]}\n\n✅ <b>Done in Todoist:</b> ${esc(title)}${paid ? " · 🪙 +8" : ""}`;
				await edit(text);
				return text;
			} catch (e) {
				await answer(`Todoist: ${e.message}`.slice(0, 190));
				return null;
			}
		}
		if (data.startsWith("gp|") || data.startsWith("gx|")) {
			const sug = await mirror.write((db) => {
				if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return void 0;
				db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
				try {
					return JSON.parse(getSetting(db, "plan_suggestion") || "null");
				} catch {
					return null;
				}
			});
			if (sug === void 0) return null;
			if (data.startsWith("gx|") || !sug || !calendar) {
				await answer("Okay");
				await edit(`${esc(String(cq.message?.text ?? ""))}\n\nOkay, no blocks. Start when you're ready: /focus 50`);
				return "no blocks";
			}
			let made = 0;
			for (const b of sug.blocks) if (await calendar.create({
				title: b.title,
				start: (/* @__PURE__ */ new Date(`${sug.day}T${b.start}:00`)).toISOString(),
				end: (/* @__PURE__ */ new Date(`${sug.day}T${b.end}:00`)).toISOString(),
				description: "Planned with your coach in Life System"
			}).then(() => true).catch(() => false)) made++;
			await answer(made ? `${made} blocks added` : "Calendar failed");
			const text = `${esc(String(cq.message?.text ?? ""))}\n\n✅ ${made} block${made === 1 ? "" : "s"} in your Google Calendar. When one starts, I'll be here: /focus 50`;
			await edit(text);
			return text;
		}
		if (data.startsWith("fq|")) {
			const [, day, n, minutes] = data.split("|");
			if (!await mirror.write((db) => {
				if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return false;
				db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
				setSetting(db, "focus_ratings", JSON.stringify([...focusRatings(db), {
					day,
					rating: Number(n),
					minutes: Number(minutes) || 0
				}].slice(-60)));
				return true;
			})) return null;
			const r = Number(n);
			await answer(`${n}/5 noted`);
			const base = esc(String(cq.message?.text ?? "").replace(/\n*(And )?[Hh]ow did it go\?\s*$/, ""));
			const low = r <= 2;
			const text = `${base}\n\n${low ? `Session: <b>${r}/5</b>. What got in the way? Tap it, and next time we fix that first.` : r === 3 ? "Session: <b>3/5</b>. Fine. Next one: phone in another room for the first 10 minutes." : `Session: <b>${r}/5</b> 🔥 That's the feeling. Same time tomorrow?`}`;
			await edit(text, low ? { inline_keyboard: [REASONS.slice(0, 3), REASONS.slice(3)].map((row, k) => row.map((x, i) => ({
				text: x,
				callback_data: `pr|${day}|${k * 3 + i}`
			}))) } : void 0);
			return text;
		}
		if (data.startsWith("np|") || data.startsWith("ns|")) {
			const pause = data.startsWith("np|");
			await mirror.write((db) => {
				let st = {};
				try {
					st = JSON.parse(getSetting(db, "coach_nudges") || "{}");
				} catch {
					st = {};
				}
				const now = /* @__PURE__ */ new Date();
				const today = services.services(db).wallet.today(now);
				setSetting(db, NUDGES, JSON.stringify(pause ? {
					...st,
					pausedDay: today
				} : {
					...st,
					snoozeUntil: new Date(now.getTime() + 18e5).toISOString()
				}));
			});
			const text = pause ? "⏸ Nudges paused for today. Back tomorrow." : "😴 OK, I'll check again in 30 minutes.";
			await answer(text);
			await tg(update.__token, "editMessageReplyMarkup", {
				chat_id: chat,
				message_id: cq.message.message_id,
				reply_markup: { inline_keyboard: [] }
			}).catch(() => null);
			await tg(update.__token, "sendMessage", {
				chat_id: chat,
				text
			}).catch(() => null);
			return text;
		}
		if (data.startsWith("sq|")) {
			const [, day, n] = data.split("|");
			const res = await mirror.write((db) => {
				if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return null;
				db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
				try {
					const svc = services.services(db);
					svc.sleep.setQuality(day, Number(n));
					return { tip: sleepTip(Number(n), svc.sleep.bedtimeTarget()) };
				} catch (e) {
					return {
						tip: "",
						error: e.message
					};
				}
			});
			if (!res) return null;
			await answer(res.error ?? `Sleep ${n}/5 noted`);
			if (res.error) return null;
			const text = `${esc(String(cq.message?.text ?? "").replace(/\n*😴 How did you sleep\?\s*$/, ""))}\n\n😴 Sleep: <b>${n}/5</b>. ${res.tip}`;
			await edit(text);
			return text;
		}
		if (data.startsWith("fo|") || data.startsWith("fx|")) {
			const res = await mirror.write((db) => {
				if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return null;
				db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
				const f = services.services(db).focus;
				try {
					if (data.startsWith("fo|")) {
						const subject = data.slice(3) || "Focus";
						const item = f.plan(services.services(db).wallet.today()).items.find((p) => !p.done && p.text.startsWith(subject));
						f.start(subject, 50, /* @__PURE__ */ new Date(), item ? {
							kind: "mustdo",
							ref: item.text,
							title: item.text
						} : null);
						return {
							text: `⏱ <b>Focus started:</b> ${esc(item?.text ?? subject)} · 50 min.\nPhone away. Tap Stop when you finish.`,
							keyboard: STOP_KEYBOARD,
							toast: "Focus started"
						};
					}
					const r = f.stop();
					focusEnded.push({
						subject: r.session.subject,
						minutes: r.session.minutes
					});
					const out = stoppedReply(r, f.plan(services.services(db).wallet.today()));
					return {
						text: out.reply,
						keyboard: out.keyboard,
						toast: r.coins ? `+${r.coins} coins` : "Logged"
					};
				} catch (e) {
					return {
						text: "",
						keyboard: void 0,
						toast: e.message.slice(0, 190)
					};
				}
			});
			if (!res) return null;
			await answer(res.toast);
			if (!res.text) return null;
			if (data.startsWith("fo|")) await tg(update.__token, "sendMessage", {
				chat_id: chat,
				text: res.text,
				parse_mode: "HTML",
				reply_markup: res.keyboard
			}).catch(() => null);
			else await edit(res.text, res.keyboard);
			await flushFocus();
			if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("life-focus-changed"));
			return res.text;
		}
		const res = await mirror.write((db) => {
			if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return null;
			db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
			const svc = services.services(db);
			if (data.startsWith("p")) {
				const [kind, day, n] = data.split("|");
				return db.transaction(() => {
					let toast = "";
					if (kind === "pp") {
						const r = svc.focus.togglePlan(Number(n), /* @__PURE__ */ new Date(), day);
						toast = r.coins ? `+${r.coins} coins` : "✓";
					} else {
						const reason = REASONS[Number(n)];
						const cur = svc.focus.plan(day).reasons;
						svc.focus.review(null, cur.includes(reason) ? cur.filter((x) => x !== reason) : [...cur, reason], /* @__PURE__ */ new Date(), day);
						toast = "Noted";
					}
					const plan = svc.focus.plan(day);
					if (kind === "pr" && String(cq.message?.text ?? "").includes("What got in the way?")) {
						const reason = REASONS[Number(n)];
						return {
							text: `${esc(String(cq.message?.text ?? "").replace(/What got in the way\?[\s\S]*$/, ""))}Noted: <b>${esc(reason)}</b>. The coach will help you fix that first next time.`,
							keyboard: void 0,
							toast
						};
					}
					const evening = String(cq.message?.text ?? "").includes("Evening review");
					const focusMin = svc.focus.state().todayMin;
					return {
						text: evening ? eveningText(plan, focusMin) : planText(plan),
						keyboard: planKeyboard(plan, evening),
						toast
					};
				})();
			}
			return db.transaction(() => {
				const r = moneyButton(db, data, svc.wallet.today());
				const life = r && data.startsWith("fu|") ? takeLink(db, data.split("|")[1]) : null;
				if (life) try {
					svc.money.deleteExpense(life);
				} catch {}
				return r;
			})();
		});
		if (!res) return null;
		await answer(res.toast);
		await tg(update.__token, "editMessageText", {
			chat_id: chat,
			message_id: cq.message.message_id,
			text: res.text,
			parse_mode: "HTML",
			...res.keyboard ? { reply_markup: res.keyboard } : {}
		}).catch(() => null);
		if (data.startsWith("fu|") || data.startsWith("fa|") || data.startsWith("fk|")) onExpense?.();
		return res.text;
	}
	/**
	* /todo, /task …, /done N with Todoist connected. Todoist is a network call,
	* so it runs outside the database change: the message is marked seen
	* first, then Todoist is asked, then the coins are written.
	*/
	async function handleTodoist(botId, update, cfg) {
		const text = String(update.message?.text ?? "").trim();
		const m = /^\/(todo|tasks|task|add|done)(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(text);
		if (!todoist || !m) return void 0;
		const chat = String(update.message?.chat?.id ?? "");
		const key = `${botId}:${update.update_id}`;
		if (!await mirror.write((db) => {
			if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return false;
			db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
			return true;
		})) return null;
		const cmd = m[1].toLowerCase();
		const arg = (m[2] ?? "").trim();
		let reply;
		let ok = true;
		if (!allowed(cfg, chat)) {
			reply = `⛔ This chat (<code>${esc(chat)}</code>) isn't allowed.`;
			ok = false;
		} else try {
			const today = await services.read((sv) => sv.wallet.today());
			if (cmd === "task" || cmd === "add") {
				if (!arg) reply = "➕ What should I add? e.g. <code>/task call Leo tomorrow 17:00 p1 #University</code>";
				else {
					const t = await todoist.quickAdd(arg);
					reply = `➕ <b>Added to Todoist:</b> ${esc(t.content || arg)}${t.section ? `\n📂 ${esc(t.section)}` : t.project ? `\n📂 ${esc(t.project)}` : ""}${t.due ? `\n📅 ${t.due === today ? "Today" : t.due}${t.dueTime ? " " + t.dueTime : ""}` : ""}${t.priority > 1 ? ` · ${pLabel(t.priority)}` : ""}`;
				}
			} else if (cmd === "done" && arg) {
				const list = sortToday(await todoist.today(), today);
				const n = parseInt(arg, 10);
				const t = n > 0 ? list[n - 1] : void 0;
				if (!t) reply = "⚠️ No task with that number. Send <code>/todo</code> to see them.";
				else {
					await todoist.close(t.id);
					const paid = await mirror.write((db) => payTodoist(services.services(db), [t]));
					reply = `✅ <b>Done in Todoist:</b> ${esc(t.content)}${paid ? "\n🪙 <b>+8 coins</b>" : ""}`;
				}
			} else reply = todayText(await todoist.today(), today);
		} catch (e) {
			ok = false;
			reply = `⚠️ Todoist: ${esc(e.message)}`;
		}
		processed++;
		addLog(text, chat, ok, reply);
		await tg(update.__token, "sendMessage", {
			chat_id: chat,
			text: reply,
			parse_mode: "HTML"
		}).catch(() => null);
		return reply;
	}
	/**
	* One text through the app's own rules, inside the open transaction: the
	* reply, plus the side effects (Sport Track reps on the server, Finance
	* Helper's inbox for money).
	*/
	function applyText(db, svc, text, key) {
		currentDb = db;
		return db.transaction(() => {
			const out = run(svc, text, key);
			if (server && out.sport) {
				const prog = addRepsInDb(db, out.sport.name, out.sport.amount);
				if (prog && prog.target) out.reply += `\n\n📊 Today: <b>${prog.done}/${prog.target}</b> (${Math.round(prog.done / prog.target * 100)}%)`;
				out.sport = void 0;
			}
			if (out.expense) {
				const now = /* @__PURE__ */ new Date();
				queueFinanceExpense(db, {
					id: `tg-life-${key.replace(/[^\w-]/g, "-")}`,
					...out.expense,
					date: svc.wallet.today(now),
					at: now.getTime()
				});
			}
			return out;
		})();
	}
	/** Marks a message seen; false when another device or a retry already had it. */
	const markSeen = (key) => mirror.write((db) => {
		if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return false;
		db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
		return true;
	});
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
	async function think(persona, text, key, media, via = "telegram", onStep) {
		const step = (s) => {
			try {
				onStep?.(s);
			} catch {}
		};
		const dayStart = /* @__PURE__ */ new Date();
		dayStart.setHours(0, 0, 0, 0);
		step("Reading your day");
		const [todoToday, upcoming, events] = await Promise.all([
			todoist ? todoist.today().catch(() => null) : Promise.resolve(null),
			todoist?.upcoming ? todoist.upcoming(7).catch(() => null) : Promise.resolve(null),
			calendar ? calendar.events(dayStart.toISOString(), new Date(dayStart.getTime() + 6912e5).toISOString()).catch(() => null) : Promise.resolve(null)
		]);
		await mirror.write((db) => {
			const raw = getSetting(db, REMINDERS);
			if (!raw) return;
			setSetting(db, REMINDERS, JSON.stringify(answered(JSON.parse(raw))));
		}).catch(() => null);
		const { context, memory, profile, look, mind, money, promises } = await mirror.read((db) => {
			const svc = services.services(db);
			const finance = financeStateFrom(db, store);
			let sessions = [];
			try {
				sessions = db.prepare("SELECT day, subject, minutes FROM focus_sessions WHERE day >= ?").all(addDays$1(svc.wallet.today(), -400)).map((r) => ({
					day: String(r.day),
					subject: String(r.subject),
					minutes: Number(r.minutes)
				}));
			} catch {
				sessions = [];
			}
			return {
				context: lifeContext(svc, db, {
					finance,
					todoToday,
					upcoming,
					events
				}),
				memory: loadMemory(db),
				profile: loadProfile(db),
				mind: (() => {
					const inp = svc.progress.input(null);
					const today = svc.wallet.today();
					return mindText(loadMind(db), today, weekSoFar(today, inp.focus, inp.workouts, inp.todoist));
				})(),
				promises: (() => {
					let list = [];
					try {
						list = JSON.parse(getSetting(db, "coach_reminders") || "[]");
					} catch {
						list = [];
					}
					return {
						...promiseRefs(list),
						stats: promiseLine(promiseStats(list))
					};
				})(),
				money: recentMoney(db, svc.wallet.today()),
				look: {
					finance,
					input: svc.progress.input(null, /* @__PURE__ */ new Date(), 400),
					ledger: svc.wallet.entries().map((e) => ({
						day: e.day,
						coins: Number(e.coins),
						kind: e.kind,
						note: e.note
					})),
					sessions
				}
			};
		});
		let allTasks = [...todoToday ?? [], ...upcoming ?? []].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
		let allEvents = events ?? [];
		let areas = [];
		let made = makeRefs(allEvents, allTasks);
		const moneyRefs = new Map(money.map((m, i) => [`M${i + 1}`, m.id]));
		const moneyLines = money.length ? `Money records, newest first (use the M-number):\n${money.map((m, i) => `M${i + 1} ${m.line}`).join("\n")}` : "";
		const correcting = isCorrection(text);
		const big = isBigAsk(text) || correcting || text.split(/\s+/).length > 8 || /\?/.test(text);
		if (big) step("Thinking it through");
		const ask = (found, extraNote = "") => ai(brainPrompt(persona, context, memory, extraNote ? `${text}\n\n(${extraNote})` : text, media?.kind, profile, {
			refs: [
				made.lines,
				moneyLines,
				promises.lines
			].filter(Boolean).join("\n"),
			found,
			mind: [promises.stats, mind].filter(Boolean).join("\n")
		}), {
			json: true,
			think: big,
			strong: big,
			media: media ? [{
				mime: media.mime,
				data: media.data
			}] : void 0
		});
		let out;
		try {
			out = parseBrain(await ask());
			if (out.need?.length && !out.actions.length) {
				const found = [];
				for (const need of out.need) {
					const local = answerLocal(need, look);
					if (local) {
						step(`Checked ${need.split(/\s+/)[0]}`);
						found.push(local);
						continue;
					}
					const [k, from, days] = need.trim().split(/\s+/);
					if (/^calendar$/i.test(k) && calendar && /^\d{4}-\d{2}-\d{2}$/.test(from ?? "")) {
						step("Read your calendar");
						const s0 = /* @__PURE__ */ new Date(`${from}T00:00:00`);
						const more = await calendar.events(s0.toISOString(), new Date(s0.getTime() + Math.min(14, Math.max(1, Number(days) || 1)) * 864e5).toISOString()).catch(() => []);
						allEvents = [...allEvents, ...more].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i);
						found.push(`Calendar from ${from}: ${more.length} events (in the E-list below).`);
					} else if (/^todoist$/i.test(k) && todoist?.everything) {
						step("Read all your Todoist");
						const all = await todoist.everything().catch(() => null);
						if (all) {
							allTasks = [...allTasks, ...all.tasks].filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
							areas = all.areas;
							found.push(`Todoist: ${all.tasks.length} open tasks (in the T-list below). Areas: ${all.areas.map((a) => a.name).join(", ")}.`);
						}
					} else found.push(`${need}: not available.`);
				}
				made = makeRefs(allEvents, allTasks);
				out = parseBrain(await ask(found.join("\n") || "Nothing found."));
			}
			if (correcting && !out.actions.length && !out.need?.length) {
				step("Fixing it");
				const again = parseBrain(await ask(void 0, "Note for the coach: he is correcting something that went wrong. Fix it NOW with actions (delmoney / editmoney / water / sleep / edit …), then confirm in one line. Words alone change nothing."));
				if (again.actions.length) out = again;
			}
		} catch (e) {
			return {
				ok: false,
				reply: `The coach couldn't think right now (${e.message.slice(0, 120)}). Try again in a minute.`,
				done: []
			};
		}
		for (const s of out.steps ?? []) step(s);
		const refs = made.refs;
		const done = [];
		let keyboard;
		let expense = false;
		const acts = out.actions.map(readAction).filter((a) => !!a);
		const mindOps = out.actions.map(readMindOp).filter((x) => !!x);
		if (mindOps.length) {
			const lines = await mirror.write((db) => {
				let m = loadMind(db);
				const today = services.services(db).wallet.today();
				const said = [];
				for (const op of mindOps) {
					const r = applyMind(m, op, today);
					m = r.mind;
					if (r.line) said.push(r.line);
				}
				saveMind(db, m);
				return said;
			}).catch(() => []);
			done.push(...lines);
		}
		if (typeof process !== "undefined" && process.env?.BOT_DEBUG) console.log("brain actions:", out.actions, "→", acts);
		const noCal = () => done.push("⚠️ Google Calendar isn't connected (Settings in the app)");
		const fmtHM = (iso) => new Date(iso).toTimeString().slice(0, 5);
		for (const [i, a] of acts.entries()) try {
			if (a.kind === "event") {
				if (!calendar) {
					noCal();
					continue;
				}
				const start = /* @__PURE__ */ new Date(`${a.day}T${a.time}:00`);
				await calendar.create({
					title: a.title,
					start: start.toISOString(),
					end: new Date(start.getTime() + a.minutes * 6e4).toISOString(),
					description: "Planned with your coach in Life System"
				});
				done.push(`🗓 In your calendar: ${a.title} · ${a.day.slice(5)} ${a.time} (${a.minutes} min)`);
				continue;
			}
			if (a.kind === "move" || a.kind === "resize" || a.kind === "delevent") {
				const ev = refs.events.get(a.ref);
				if (!ev) continue;
				if (!calendar?.move || !calendar.remove) {
					noCal();
					continue;
				}
				if (a.kind === "delevent") {
					await calendar.remove(ev.calendarId, ev.id);
					done.push(`🗑 Removed from your calendar: ${ev.title}`);
					continue;
				}
				const len = Date.parse(ev.end) - Date.parse(ev.start);
				const start = a.kind === "move" ? (/* @__PURE__ */ new Date(`${a.day}T${a.time}:00`)).toISOString() : ev.start;
				const end = new Date(Date.parse(start) + (a.kind === "resize" ? a.minutes * 6e4 : len)).toISOString();
				await calendar.move(ev.calendarId, ev.id, start, end);
				done.push(a.kind === "move" ? `🗓 Moved: ${ev.title} → ${a.day.slice(5)} ${a.time}` : `🗓 ${ev.title}: now ${a.minutes} min (${fmtHM(start)}–${fmtHM(end)})`);
				continue;
			}
			if (a.kind === "shift") {
				if (!calendar?.move) {
					noCal();
					continue;
				}
				const list = a.refs.map((r) => refs.events.get(r)).filter((x) => !!x);
				for (const ev of list) await calendar.move(ev.calendarId, ev.id, new Date(Date.parse(ev.start) + a.minutes * 6e4).toISOString(), new Date(Date.parse(ev.end) + a.minutes * 6e4).toISOString());
				if (list.length) done.push(`🗓 Shifted ${list.length} block${list.length === 1 ? "" : "s"} by ${a.minutes > 0 ? "+" : ""}${a.minutes} min`);
				continue;
			}
			if (a.kind === "edit" || a.kind === "taskmove" || a.kind === "done" || a.kind === "star" || a.kind === "deltask") {
				const t = refs.tasks.get(a.ref);
				if (!t || !todoist) continue;
				if (a.kind === "done") {
					await todoist.close(t.id);
					const paid = await mirror.write((db) => payTodoist(services.services(db), [{
						id: t.id,
						content: t.content,
						completedAt: (/* @__PURE__ */ new Date()).toISOString()
					}])).catch(() => 0);
					done.push(`✅ Done in Todoist: ${t.content}${paid ? " · +5" : ""}`);
				} else if (a.kind === "deltask" && todoist.remove) {
					await todoist.remove(t.id);
					done.push(`🗑 Deleted from Todoist: ${t.content}`);
				} else if (a.kind === "star" && todoist.update) {
					const labels = a.on ? [.../* @__PURE__ */ new Set([...t.labels ?? [], "today"])] : (t.labels ?? []).filter((l) => l !== "today");
					await todoist.update(t.id, {
						labels,
						...a.on && !(t.due && t.due <= (/* @__PURE__ */ new Date(Date.now() - (/* @__PURE__ */ new Date()).getTimezoneOffset() * 6e4)).toISOString().slice(0, 10)) ? { due: "today" } : {}
					});
					done.push(a.on ? `⭐ Must-do today: ${t.content}` : `☆ No longer a must-do: ${t.content}`);
				} else if (a.kind === "edit" && todoist.update) {
					await todoist.update(t.id, {
						content: a.title,
						priority: a.priority,
						due: a.due,
						description: a.details
					});
					done.push(`✏️ Todoist: ${a.title ?? t.content}${a.priority ? ` · P${5 - a.priority}` : ""}${a.due ? ` · ${a.due}` : ""}`);
				} else if (a.kind === "taskmove" && todoist.move) {
					if (!areas.length && todoist.everything) areas = (await todoist.everything().catch(() => null))?.areas ?? [];
					const want = a.area.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
					const area = areas.find((x) => x.name.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim() === want) ?? areas.find((x) => x.name.toLowerCase().includes(want));
					if (!area) {
						done.push(`⚠️ No Todoist area called "${a.area}"`);
						continue;
					}
					await todoist.move(t.id, area.key);
					done.push(`📂 ${t.content} → ${area.name}`);
				}
				continue;
			}
			if (a.kind === "remind" || a.kind === "checkin") {
				const at = a.kind === "remind" ? /* @__PURE__ */ new Date(`${a.day}T${a.time}:00`) : new Date(Date.now() + a.minutes * 6e4);
				if (at.getTime() < Date.now() - 6e4) continue;
				await mirror.write((db) => {
					let list = [];
					try {
						list = JSON.parse(getSetting(db, "coach_reminders") || "[]");
					} catch {
						list = [];
					}
					setSetting(db, REMINDERS, JSON.stringify(addReminder(list, {
						at: at.toISOString(),
						text: a.text,
						kind: a.kind,
						follow: a.kind === "checkin"
					})));
				});
				done.push(a.kind === "remind" ? `⏰ Reminder ${fmtHM(at.toISOString())}${at.toDateString() !== (/* @__PURE__ */ new Date()).toDateString() ? ` (${at.toISOString().slice(5, 10)})` : ""}: ${a.text}` : `⏰ I'll check on you at ${fmtHM(at.toISOString())} (and keep asking until you answer)`);
				continue;
			}
			if (a.kind === "book") {
				const plans = await rhythm.goalPlans();
				const want = a.goal.toLowerCase().trim();
				const ids = /^all$/.test(want) ? void 0 : plans.filter((p) => p.title.toLowerCase().includes(want) || want.includes(p.title.toLowerCase()) || p.subject.toLowerCase() === want).map((p) => p.goalId);
				if (ids && !ids.length) {
					done.push(`⚠️ No goal called "${a.goal}"`);
					continue;
				}
				done.push(...(await rhythm.bookGoals(ids)).lines);
				continue;
			}
			if (a.kind === "promise") {
				const id = promises.refs.get(a.ref);
				if (!id) continue;
				await mirror.write((db) => {
					let list = [];
					try {
						list = JSON.parse(getSetting(db, "coach_reminders") || "[]");
					} catch {
						list = [];
					}
					setSetting(db, REMINDERS, JSON.stringify(setOutcome(list, id, a.outcome)));
				});
				await rhythm.countPromise(await services.read((sv) => sv.wallet.today()), a.outcome).catch(() => null);
				done.push(a.outcome === "kept" ? "✅ Promise kept" : "❌ Promise broken (counted)");
				continue;
			}
			if (a.kind === "delmoney" || a.kind === "editmoney") {
				const id = moneyRefs.get(a.ref);
				if (!id) continue;
				const line = await mirror.write((db) => {
					if (a.kind === "delmoney") {
						const what = deleteMoney(db, id);
						if (!what) return "⚠️ That money record is already gone";
						const life = takeLink(db, id);
						if (life) try {
							services.services(db).money.deleteExpense(life);
						} catch {}
						return `🗑 Deleted from Finance Helper: ${what}`;
					}
					const r = editMoney(db, id, a);
					return r.ok ? `✏️ Money record fixed: ${r.text}` : `⚠️ ${r.text}`;
				});
				done.push(line);
				expense = true;
				continue;
			}
			if (a.kind === "water" || a.kind === "reps") {
				const line = await mirror.write((db) => {
					const st = sportState(db);
					if (!st) return a.kind === "water" ? "⚠️ Open Sport Track once so water has a place to go" : "⚠️ Open Sport Track once to set up your reps checklist";
					const day = sportToday();
					const save = (next) => setSetting(db, "sport_tracker_json", JSON.stringify({
						savedAt: Date.now(),
						data: next
					}));
					if (a.kind === "water") {
						const next = addWater(st, a.ml, day);
						save(next);
						const v = sharedView(next, day);
						return `💧 ${a.ml > 0 ? "+" : ""}${a.ml} ml · ${(v.water.ml / 1e3).toFixed(2).replace(/0$/, "")} of ${(v.water.target / 1e3).toFixed(1)} L today`;
					}
					const r = addReps(st, a.exercise, a.amount, day);
					if (!r) return `⚠️ No "${a.exercise}" on your Sport Track checklist`;
					save(r.st);
					if (a.amount > 0) services.services(db).body.logWorkout({
						title: `${r.exercise.name} (+${a.amount})`,
						items: [{
							exerciseId: r.exercise.name.toLowerCase().replace(/\s+/g, "_"),
							name: r.exercise.name,
							amount: a.amount,
							unit: "reps"
						}],
						note: "Logged by the coach"
					});
					return `💪 ${r.exercise.name} ${a.amount > 0 ? "+" : ""}${a.amount} · ${r.exercise.done}${r.exercise.target ? `/${r.exercise.target}` : ""} today`;
				});
				done.push(line);
				continue;
			}
			if (a.kind === "sleep") {
				const line = await mirror.write((db) => {
					const svc = services.services(db);
					const said = [];
					if (a.wake) {
						const r = svc.sleep.setWake(a.day, a.wake);
						said.push(`up ${r.log.wakeTime}${r.log.onTime ? " (on time)" : ""}`);
					}
					if (a.bed) {
						if (!db.prepare("SELECT 1 FROM sleep_logs WHERE day = ?").get(a.day)) svc.sleep.setWake(a.day, a.wake ?? "07:00");
						const target = svc.sleep.bedtimeTarget();
						const toMin = (t) => {
							const [h, m] = t.split(":").map(Number);
							return (h < 12 ? h + 24 : h) * 60 + m;
						};
						const onTime = toMin(a.bed) <= toMin(target);
						db.prepare("UPDATE sleep_logs SET bed_time = ?, bed_target = ?, bed_on_time = ? WHERE day = ?").run(a.bed, target, onTime ? 1 : 0, a.day);
						said.push(`bed ${a.bed}${onTime ? " (on time)" : " (late)"}`);
					}
					if (a.quality) {
						svc.sleep.setQuality(a.day, a.quality);
						said.push(`slept ${a.quality}/5`);
					}
					return said.length ? `😴 Sleep ${a.day.slice(5)}: ${said.join(", ")}` : null;
				});
				if (line) done.push(line);
				continue;
			}
			if (a.kind === "habit" || a.kind === "reward" || a.kind === "week" || a.kind === "bigdone") {
				const line = await mirror.write((db) => {
					const svc = services.services(db);
					if (a.kind === "habit") {
						if ((svc.wallet.summary().todayRules ?? []).includes(a.habit === "oath" ? "discipline.oath" : a.habit === "clean" ? "discipline.clean_day" : "face.routine_done")) return null;
						if (a.habit === "oath") svc.discipline.oath();
						else if (a.habit === "clean") svc.discipline.checkIn();
						else svc.wallet.award("face.routine_done", "Ticked by the coach");
						return `✅ Habit: ${a.habit === "oath" ? "morning oath" : a.habit === "clean" ? "clean-day check-in" : "skincare"}`;
					}
					if (a.kind === "reward") {
						svc.shop.save({
							title: a.title,
							price: a.points,
							tier: "bronze",
							realCost: a.cost,
							pinned: false,
							note: "Added by your coach",
							currency: "MDL"
						});
						return `🎁 New reward: ${a.title} · ${a.points} points`;
					}
					if (a.kind === "bigdone") {
						const plan = svc.weekPlan.active();
						if (!plan?.big3[a.index] || plan.big3[a.index].done) return null;
						svc.weekPlan.toggle(a.index);
						return `✅ Week task done: ${plan.big3[a.index].text}`;
					}
					const cur = svc.weekPlan.active();
					const big3 = a.big3?.length ? a.big3.map((text) => ({
						text,
						done: cur?.big3.find((b) => b.text.toLowerCase() === text.toLowerCase())?.done ?? false
					})) : cur?.big3 ?? [];
					const plan = svc.weekPlan.save({
						...cur ?? {},
						focus: a.focus ?? cur?.focus ?? "focus",
						note: a.note ?? cur?.note ?? "",
						big3
					});
					return `🗓 Week plan: ${{
						focus: "focus time",
						wake: "wake-ups",
						sport: "training",
						clean: "clean days",
						todoist: "tasks",
						spend: "spending",
						mustdo: "must-dos"
					}[plan.focus] ?? plan.focus}${plan.note ? ` ("${plan.note}")` : ""} · ${plan.big3.map((b) => b.text).join(" / ")}`;
				});
				if (line) done.push(line);
				continue;
			}
			if (a.kind === "task") {
				if (!todoist) continue;
				const t = await todoist.quickAdd(a.text);
				done.push(`➕ Todoist: ${t.content || a.text}${t.section ? ` · ${t.section}` : ""}${t.due ? ` (${t.due})` : ""}`);
				continue;
			}
			const line = await mirror.write((db) => {
				const svc = services.services(db);
				if (a.kind === "log") {
					const r = applyText(db, svc, a.text, `${key}:a${i}`);
					if (r.unknown) return null;
					if (r.keyboard) keyboard = r.keyboard;
					if (r.expense) expense = true;
					return `✅ Logged: ${a.text}`;
				}
				if (a.kind === "mustdo") {
					const p = svc.focus.plan(svc.wallet.today());
					if (p.items.some((x) => x.text.toLowerCase() === a.text.toLowerCase())) return null;
					svc.focus.setPlan([...p.items.map((x) => x.text), a.text]);
					return `📝 Must-do added: ${a.text}${todoist ? " (⭐ in Todoist)" : ""}`;
				}
				if (a.kind === "focus") {
					svc.focus.start(a.subject, a.minutes);
					keyboard = STOP_KEYBOARD;
					return `⏱ Focus started: ${a.subject} · ${a.minutes} min`;
				}
				if (a.kind === "fun") {
					const r = svc.focus.fun(a.minutes, a.what);
					return `🎮 ${a.minutes} min of ${a.what}: −${r.cost} points (left ${r.balance})`;
				}
				if (a.kind !== "goal") return null;
				svc.focus.saveGoal({
					title: a.title,
					subject: a.subject,
					deadline: a.deadline,
					hours: a.hours
				});
				return `🎯 Goal: ${a.title} · ${a.hours}h by ${a.deadline}`;
			});
			if (line) done.push(line);
			if (line && a.kind === "mustdo" && todoist) await todoist.quickAdd(`${a.text} today @today`).catch(() => null);
		} catch (e) {
			done.push(`⚠️ ${e.message}`);
		}
		if (expense) onExpense?.();
		const at = (/* @__PURE__ */ new Date()).toISOString();
		await mirror.write((db) => {
			saveMemory(db, updateMemory(loadMemory(db), {
				facts: out.remember,
				turns: [{
					role: "me",
					bot: persona,
					text: media ? `[${media.kind}] ${text}`.trim() : text,
					at
				}, {
					role: "coach",
					bot: persona,
					text: [out.reply, ...done.length ? done : ["(nothing saved)"]].join(" | "),
					at
				}]
			}));
			appendLog(db, [{
				role: "me",
				bot: persona,
				via,
				text: media ? `[${media.kind === "voice" ? "voice note" : "photo"}] ${text}`.trim() : text,
				at
			}, {
				role: "coach",
				bot: persona,
				via,
				text: out.reply || "Got it.",
				done,
				at
			}]);
		}).catch(() => null);
		processed++;
		return {
			ok: true,
			reply: out.reply || "Got it.",
			done,
			keyboard,
			steps: out.steps
		};
	}
	async function handleBrain(botId, update, cfg, text, key, media) {
		const chat = String(update.message?.chat?.id ?? "");
		tg(update.__token, "sendChatAction", {
			chat_id: chat,
			action: "typing"
		}).catch(() => null);
		const r = await think(personaFor(botId, cfg), text, key, media);
		const reply = r.ok ? [esc(r.reply), r.done.length ? `\n${r.done.map(esc).join("\n")}` : ""].join("\n").trim() : `⚠️ ${esc(r.reply)} Or use a command like <code>/today</code>.`;
		addLog(text || `[${media?.kind}]`, chat, r.ok, reply);
		await tg(update.__token, "sendMessage", {
			chat_id: chat,
			text: reply,
			parse_mode: "HTML",
			...r.keyboard ? { reply_markup: r.keyboard } : {}
		}).catch(() => null);
		return reply;
	}
	/** One line that turns your evening note into a lesson for tomorrow (and the coach's memory). */
	async function lessonOfDay(token, chat, botId, cfg, note) {
		const ctx = await mirror.read((db) => {
			const f = services.services(db).focus.state();
			return `Focus today ${hm$1(f.todayMin)}. Must-dos: ${f.plan.items.map((x) => `${x.done ? "[done]" : "[open]"} ${x.text}`).join("; ") || "none"}. Got in the way: ${f.plan.reasons.join(", ") || "nothing marked"}.`;
		});
		const out = parseBrain(await ai(`You are Victor's coach. Here is his day and his evening note. Write ONE short lesson for tomorrow (max 25 words, concrete, kind, in the language of his note) as "reply", and the same lesson as one item in "remember" starting with "Lesson ${(/* @__PURE__ */ new Date()).toISOString().slice(5, 10)}:". Answer only JSON {"reply": string, "actions": [], "remember": string[]}.

Day: ${ctx}
His note: ${note}`, { json: true }));
		if (!out.reply) return;
		await mirror.write((db) => saveMemory(db, updateMemory(loadMemory(db), {
			facts: out.remember.slice(0, 1),
			turns: [{
				role: "me",
				bot: personaFor(botId, cfg),
				text: `[evening] ${note}`,
				at: (/* @__PURE__ */ new Date()).toISOString()
			}, {
				role: "coach",
				bot: personaFor(botId, cfg),
				text: `Lesson: ${out.reply}`,
				at: (/* @__PURE__ */ new Date()).toISOString()
			}]
		})));
		await tg(token, "sendMessage", {
			chat_id: chat,
			text: `💡 <b>Lesson for tomorrow:</b> ${esc(out.reply)}`,
			parse_mode: "HTML"
		});
	}
	async function handle(botId, update, cfg) {
		if (update.callback_query) return handleButton(botId, update, cfg);
		const viaTodoist = await handleTodoist(botId, update, cfg);
		if (viaTodoist !== void 0) return viaTodoist;
		const key = `${botId}:${update.update_id}`;
		let text = String(update.message?.text ?? update.message?.caption ?? "").trim();
		const said = text;
		const chat = String(update.message?.chat?.id ?? "");
		const asked = String(update.message?.reply_to_message?.text ?? "");
		if (text && !text.startsWith("/") && chat && (asked.includes("What should change in today's plan?") || asked.includes("Tomorrow's top 3? One per line.") || asked.includes("Next week's 3 big tasks? One per line."))) {
			if (!await markSeen(key)) return null;
			if (!allowed(cfg, chat)) return null;
			try {
				if (asked.includes("What should change in today's plan?")) {
					tg(update.__token, "sendChatAction", {
						chat_id: chat,
						action: "typing"
					}).catch(() => null);
					return await sendProposal(update.__token, chat, text);
				}
				const reply = asked.includes("Tomorrow's top 3? One per line.") ? `✅ Tomorrow's top 3:\n${(await rhythm.setTop3(text)).map((t, i) => `${i + 1}. ${esc(t)}`).join("\n")}` : `✅ ${esc(await rhythm.applyWeekly(text))}`;
				await tg(update.__token, "sendMessage", {
					chat_id: chat,
					text: reply,
					parse_mode: "HTML"
				}).catch(() => null);
				return reply;
			} catch (e) {
				const reply = `⚠️ ${esc(e.message)}`;
				await tg(update.__token, "sendMessage", {
					chat_id: chat,
					text: reply,
					parse_mode: "HTML"
				}).catch(() => null);
				return reply;
			}
		}
		const prompted = !!text && !text.startsWith("/") && (asked.includes("What are your 1–3 must-dos today?") || /Evening review|One thing to change next week/.test(asked));
		if (text && !text.startsWith("/") && asked.includes("What are your 1–3 must-dos today?")) text = `/plan ${text}`;
		else if (text && !text.startsWith("/") && /Evening review|One thing to change next week/.test(asked)) text = `/review ${asked.includes("next week") ? "Next week: " : ""}${text}`;
		const media = update.message?.voice ?? update.message?.audio ?? (update.message?.photo ? update.message.photo[update.message.photo.length - 1] : null);
		if (ai && chat && (media || text && !prompted && !isSimpleLog(text))) {
			if (!await markSeen(key)) return null;
			if (!allowed(cfg, chat)) {
				const reply = `⛔ This chat (<code>${esc(chat)}</code>) isn't allowed.`;
				await tg(update.__token, "sendMessage", {
					chat_id: chat,
					text: reply,
					parse_mode: "HTML"
				}).catch(() => null);
				return reply;
			}
			let file;
			if (media) {
				file = await downloadFile(update.__token, media.file_id, update.message?.photo ? "photo" : "voice") ?? void 0;
				if (!file) {
					const reply = "⚠️ I couldn't open that file. Try again, or type it.";
					await tg(update.__token, "sendMessage", {
						chat_id: chat,
						text: reply
					}).catch(() => null);
					return reply;
				}
			}
			return handleBrain(botId, update, cfg, text, key, file);
		}
		for (let attempt = 0; attempt < 2; attempt++) try {
			const out = await mirror.write((db) => {
				if (db.prepare("SELECT 1 FROM bot_seen_updates WHERE key = ?").get(key)) return { skip: true };
				db.prepare("INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)").run(key, (/* @__PURE__ */ new Date()).toISOString());
				if (!text || !chat) return { skip: true };
				if (!allowed(cfg, chat)) return {
					skip: false,
					reply: `⛔ This chat (<code>${esc(chat)}</code>) isn't allowed.`,
					ok: false
				};
				const svc = services.services(db);
				try {
					const r = applyText(db, svc, text, key);
					return {
						skip: false,
						reply: r.reply,
						keyboard: r.keyboard,
						ok: true,
						sport: r.sport,
						expense: !!r.expense,
						unknown: !!r.unknown
					};
				} catch (e) {
					currentDb = null;
					return {
						skip: false,
						reply: `⚠️ ${esc(e.message)}`,
						ok: false
					};
				}
			});
			if (out.skip) return null;
			if (ai && "unknown" in out && out.unknown && !text.startsWith("/")) return handleBrain(botId, update, cfg, text, key);
			processed++;
			if (out.ok && "sport" in out && out.sport) {
				const prog = addRepsToSportTrack(out.sport.name, out.sport.amount);
				if (prog && prog.target) out.reply += `\n\n📊 Today: <b>${prog.done}/${prog.target}</b> (${Math.round(prog.done / prog.target * 100)}%)`;
			}
			if (out.ok && "expense" in out && out.expense) onExpense?.();
			addLog(text, chat, out.ok, out.reply);
			const keyboard = "keyboard" in out ? out.keyboard : void 0;
			await tg(update.__token, "sendMessage", {
				chat_id: chat,
				text: out.reply,
				parse_mode: "HTML",
				...keyboard ? { reply_markup: keyboard } : {}
			}).catch(() => null);
			if (ai && out.ok && prompted && /Evening review/.test(asked)) await lessonOfDay(update.__token, chat, botId, cfg, said).catch(() => null);
			await flushFocus();
			if (server && out.ok && /^\/wake(@\w+)?$/i.test(text)) await morningAfterWake(update.__token, chat).catch(() => null);
			if (out.ok && prompted && asked.includes("What are your 1–3 must-dos today?")) await offerBlocks(update.__token, chat).catch(() => null);
			return out.reply;
		} catch (e) {
			if (e instanceof MirrorError && attempt === 0) continue;
			throw e;
		}
		return null;
	}
	async function pollOnce() {
		if (running) return running;
		running = (async () => {
			const cfg = await config();
			if (cfg.serverBots && !server) {
				lastPollAt = (/* @__PURE__ */ new Date()).toISOString();
				lastError = null;
				return {
					processedCount: 0,
					replies: []
				};
			}
			const tokens = [
				cfg.megaBotToken,
				cfg.sportBotToken,
				cfg.financeBotToken,
				cfg.manBotToken,
				cfg.botToken,
				cfg.wakyBotToken,
				cfg.plannerBotToken,
				cfg.coachBotToken
			].filter((t) => !!t && t.includes(":")).filter((t) => !(cfg.skipBotIds ?? []).includes(t.split(":")[0])).filter((t, i, all) => all.indexOf(t) === i);
			const replies = [];
			const before = processed;
			lastPollAt = (/* @__PURE__ */ new Date()).toISOString();
			for (const token of tokens) {
				const botId = token.split(":")[0];
				const offsetKey = `tg_offset_${botId}`;
				const offset = Number(store?.getItem(offsetKey) || 0) || 0;
				try {
					const data = await tg(token, `getUpdates?offset=${offset}&limit=25&timeout=0`);
					if (!data?.ok) {
						const why = String(data?.description ?? "no answer");
						if (/webhook/i.test(why) && token === cfg.megaBotToken) {
							if ((await tg(token, "deleteWebhook?drop_pending_updates=false").catch(() => null))?.ok) continue;
						}
						lastError = /webhook/i.test(why) ? `Bot ${botId} sends its messages to a webhook (e.g. the Cloudflare worker), so it can't be read here. Remove the webhook to use it.` : `Bot ${botId}: ${why}`;
						continue;
					}
					for (const u of data.result ?? []) {
						u.__token = token;
						const reply = await handle(botId, u, cfg);
						if (reply) replies.push(reply);
						store?.setItem(offsetKey, String(u.update_id + 1));
					}
					lastError = null;
				} catch (e) {
					lastError = `Bot ${botId}: ${e.message}`;
				}
			}
			if (!pruned && tokens.length) {
				pruned = true;
				const cutoff = addDays$1((/* @__PURE__ */ new Date()).toISOString().slice(0, 10), -14);
				mirror.write((db) => db.prepare("DELETE FROM bot_seen_updates WHERE ts < ?").run(cutoff)).catch(() => {});
			}
			return {
				processedCount: processed - before,
				replies
			};
		})().finally(() => {
			running = null;
		});
		return running;
	}
	/** One update Telegram sent to the server (webhook) for the bot with this token. */
	async function handleUpdate(token, update) {
		const cfg = await config();
		return handle(token.split(":")[0], {
			...update,
			__token: token
		}, cfg);
	}
	return {
		pollOnce,
		handleUpdate,
		/** The app's Coach page: the same brain and memory as the bots. */
		think: (text, key = `app:${Date.now()}`, onStep) => think("mega", text, key, void 0, "app", onStep),
		/** The daily rhythm (morning plan, reviews), for the tick and the app. */
		rhythm,
		config,
		saveConfig: async (patch) => {
			const next = {
				...await config(),
				...patch
			};
			delete next.serverBots;
			delete next.skipBotIds;
			await mirror.write((db) => setSetting(db, "bot_bridge_config", JSON.stringify(next)));
			try {
				store?.setItem("bot_bridge_config", JSON.stringify(next));
			} catch {}
			return next;
		},
		status: async () => {
			const cfg = await config();
			return {
				polling,
				enabled: !!cfg.enabled,
				configured: !!(cfg.megaBotToken || cfg.sportBotToken || cfg.botToken || cfg.financeBotToken || cfg.manBotToken),
				lastPollAt,
				lastError,
				processedCount: processed
			};
		},
		logs: async () => {
			try {
				return JSON.parse(store?.getItem(LOGS_KEY) || "[]").slice(-50).reverse();
			} catch {
				return [];
			}
		},
		clearLogs: async () => {
			store?.removeItem(LOGS_KEY);
		},
		test: async (botKey) => {
			const cfg = await config();
			const pick = {
				finance: [
					cfg.financeBotToken,
					cfg.financeBotChatId,
					"Finance Bot"
				],
				man: [
					cfg.manBotToken,
					cfg.manBotChatId,
					"MAN Bot"
				],
				waky: [
					cfg.wakyBotToken,
					cfg.wakyBotChatId,
					"Waky Bot"
				],
				sport: [
					cfg.sportBotToken,
					cfg.sportBotChatId,
					"Sport Bot"
				],
				mega: [
					cfg.megaBotToken,
					cfg.chatId,
					"Mega Bot"
				]
			};
			const [tok, chat, title] = pick[botKey ?? "sport"] ?? pick.sport;
			const token = tok || cfg.botToken;
			const chatId = chat || cfg.chatId;
			if (!token || !chatId) return {
				ok: false,
				error: "Bot token or chat ID is missing"
			};
			try {
				const d = await tg(token, "sendMessage", {
					chat_id: chatId,
					text: `⚡ <b>Life System — ${title} online</b>`,
					parse_mode: "HTML"
				});
				return {
					ok: !!d.ok,
					error: d.ok ? void 0 : d.description
				};
			} catch (e) {
				return {
					ok: false,
					error: e.message
				};
			}
		},
		startPolling: async () => {
			polling = true;
			if (!timer) timer = setInterval(() => {
				if (typeof document === "undefined" || document.visibilityState === "visible") pollOnce().catch(() => {});
			}, 12e3);
			return true;
		},
		stopPolling: async () => {
			polling = false;
			if (timer) clearInterval(timer);
			timer = null;
			return false;
		}
	};
}
// src/server/googleCalendar.ts
var GOOGLE_SETTING = "google_oauth";
var GOOGLE_SCOPES = [
	"https://www.googleapis.com/auth/calendar",
	"openid",
	"email"
];
var TOKEN_URL = "https://oauth2.googleapis.com/token";
var API = "https://www.googleapis.com/calendar/v3";
var keyOf = (secret) => createHash("sha256").update("life-google:" + secret).digest();
function sealToken(secret, token) {
	const iv = randomBytes(12);
	const c = createCipheriv("aes-256-gcm", keyOf(secret), iv);
	const enc = Buffer.concat([c.update(token, "utf8"), c.final()]);
	return Buffer.concat([
		iv,
		c.getAuthTag(),
		enc
	]).toString("base64");
}
function openToken(secret, sealed) {
	const buf = Buffer.from(sealed, "base64");
	const d = createDecipheriv("aes-256-gcm", keyOf(secret), buf.subarray(0, 12));
	d.setAuthTag(buf.subarray(12, 28));
	return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
function authUrl(env, redirectUri, state) {
	return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
		client_id: env.clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: GOOGLE_SCOPES.join(" "),
		access_type: "offline",
		prompt: "consent",
		include_granted_scopes: "true",
		state
	})}`;
}
/** The code from the sign-in → a refresh token (sealed) and your email. */
async function exchangeCode(env, redirectUri, code, fetchImpl = fetch) {
	const res = await fetchImpl(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: env.clientId,
			client_secret: env.clientSecret,
			redirect_uri: redirectUri,
			grant_type: "authorization_code"
		})
	});
	const j = await res.json().catch(() => ({}));
	if (!res.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "Google did not give a refresh token");
	let email = null;
	try {
		email = JSON.parse(Buffer.from(String(j.id_token).split(".")[1], "base64url").toString("utf8")).email ?? null;
	} catch {}
	return {
		enc: sealToken(env.secret, j.refresh_token),
		email,
		on: [],
		target: null
	};
}
function createCalendarApi(env, stored, fetchImpl = fetch) {
	let access = null;
	const token = async () => {
		if (access && access.until > Date.now() + 6e4) return access.token;
		const res = await fetchImpl(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: env.clientId,
				client_secret: env.clientSecret,
				refresh_token: openToken(env.secret, stored.enc),
				grant_type: "refresh_token"
			})
		});
		const j = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(j.error === "invalid_grant" ? "Google sign-in expired: connect Google Calendar again in Settings" : j.error_description || "Google refused the sign-in");
		access = {
			token: j.access_token,
			until: Date.now() + (Number(j.expires_in) || 3600) * 1e3
		};
		return access.token;
	};
	const call = async (path, init = {}) => {
		const res = await fetchImpl(`${API}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${await token()}`,
				...init.body ? { "Content-Type": "application/json" } : {}
			},
			signal: AbortSignal.timeout(12e3)
		});
		if (res.status === 204) return null;
		const j = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${j?.error?.message ?? "request failed"}`);
		return j;
	};
	let cals = null;
	const calendars = async () => {
		if (cals) return cals;
		cals = ((await call("/users/me/calendarList?minAccessRole=reader&maxResults=100")).items ?? []).filter((c) => !c.deleted && !c.hidden).map((c) => ({
			id: String(c.id),
			name: String(c.summaryOverride ?? c.summary ?? c.id),
			color: String(c.backgroundColor ?? "#7CC4FF"),
			primary: !!c.primary,
			canWrite: c.accessRole === "owner" || c.accessRole === "writer"
		}));
		return cals;
	};
	const target = async () => {
		const list = await calendars();
		return stored.target && list.some((c) => c.id === stored.target && c.canWrite) ? stored.target : list.find((c) => c.primary)?.id ?? "primary";
	};
	const toEvent = (e, cal) => ({
		id: String(e.id),
		calendarId: cal.id,
		title: String(e.summary ?? "(no title)"),
		start: String(e.start?.dateTime ?? e.start?.date ?? ""),
		end: String(e.end?.dateTime ?? e.end?.date ?? ""),
		allDay: !e.start?.dateTime,
		color: cal.color,
		location: e.location ?? null,
		ours: e.extendedProperties?.private?.lifeSystem === "1"
	});
	return {
		calendars,
		/** Events of the shown calendars between two ISO times, sorted. */
		async events(fromIso, toIso) {
			const list = (await calendars()).filter((c) => !stored.on?.length || stored.on.includes(c.id));
			return (await Promise.all(list.map((c) => call(`/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin=${encodeURIComponent(fromIso)}&timeMax=${encodeURIComponent(toIso)}`).then((j) => (j.items ?? []).filter((e) => e.status !== "cancelled").map((e) => toEvent(e, c))).catch(() => [])))).flat().sort((a, b) => a.start.localeCompare(b.start));
		},
		/** A new event (in your chosen calendar), marked as made by Life System. */
		async create(e) {
			const calId = e.calendarId || await target();
			const allDay = /^\d{4}-\d{2}-\d{2}$/.test(e.start);
			const body = {
				summary: e.title,
				description: e.description ?? "Added by Life System",
				start: allDay ? { date: e.start } : {
					dateTime: e.start,
					...e.recurrence?.length ? { timeZone: e.timeZone || process.env.TZ || "Europe/Chisinau" } : {}
				},
				end: allDay ? { date: e.end } : {
					dateTime: e.end,
					...e.recurrence?.length ? { timeZone: e.timeZone || process.env.TZ || "Europe/Chisinau" } : {}
				},
				...e.colorId ? { colorId: e.colorId } : {},
				...e.recurrence?.length ? { recurrence: e.recurrence.filter((r) => /^RRULE:[A-Z0-9=;,]+$/.test(r)).slice(0, 2) } : {},
				extendedProperties: { private: { lifeSystem: "1" } }
			};
			const j = await call(`/calendars/${encodeURIComponent(calId)}/events`, {
				method: "POST",
				body: JSON.stringify(body)
			});
			const cal = (await calendars()).find((c) => c.id === calId) ?? {
				id: calId,
				name: "",
				color: "#C8F135",
				primary: false,
				canWrite: true
			};
			return toEvent(j, cal);
		},
		async move(calendarId, id, start, end) {
			await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
				method: "PATCH",
				body: JSON.stringify({
					start: { dateTime: start },
					end: { dateTime: end }
				})
			});
		},
		/** Changes the title, times or notes of one event. */
		async update(calendarId, id, patch) {
			const body = {};
			if (patch.title != null) body.summary = patch.title;
			if (patch.description != null) body.description = patch.description;
			if (patch.start) body.start = { dateTime: patch.start };
			if (patch.end) body.end = { dateTime: patch.end };
			await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
				method: "PATCH",
				body: JSON.stringify(body)
			});
		},
		async remove(calendarId, id) {
			await call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: "DELETE" });
		}
	};
}
/** Local "YYYY-MM-DD" + "HH:MM" → an ISO time with the local offset (the server runs in your time zone). */
function localIso(day, hm) {
	const off = -(/* @__PURE__ */ new Date(`${day}T${hm}:00`)).getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
	return `${day}T${hm}:00${sign}${p(off / 60)}:${p(off % 60)}`;
}
// src/server/todoistApi.ts
var V1 = "https://api.todoist.com/api/v1";
var V2 = "https://api.todoist.com/rest/v2";
var SYNC = "https://api.todoist.com/sync/v9";
function createTodoistApi(token, fetchImpl = fetch, opts = {}) {
	const call = async (url, init = {}) => {
		const res = await fetchImpl(url, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				...init.body ? { "Content-Type": "application/json" } : {},
				...init.headers ?? {}
			},
			signal: AbortSignal.timeout(1e4)
		});
		if (res.status === 401 || res.status === 403) throw new Error("Todoist refused the token: check TODOIST_TOKEN in Vercel");
		if (!res.ok) {
			const err = /* @__PURE__ */ new Error(`Todoist ${res.status}`);
			err.status = res.status;
			throw err;
		}
		if (res.status === 204) return null;
		const text = await res.text();
		return text ? JSON.parse(text) : null;
	};
	/** v1 first; on "not found / gone" (an account or region still on v2), the older API. */
	const either = async (v1, v2) => {
		try {
			return await v1();
		} catch (e) {
			if (e?.status === 404 || e?.status === 410) return v2();
			throw e;
		}
	};
	const all = async (url) => {
		const out = [];
		let cursor = null;
		for (let page = 0; page < 10; page++) {
			const sep = url.includes("?") ? "&" : "?";
			const r = await call(cursor ? `${url}${sep}cursor=${encodeURIComponent(cursor)}` : url);
			if (Array.isArray(r)) return r;
			out.push(...r?.results ?? r?.items ?? []);
			cursor = r?.next_cursor ?? null;
			if (!cursor) break;
		}
		return out;
	};
	let projectNames = null;
	const projects = async () => {
		if (projectNames) return projectNames;
		const list = await either(() => all(`${V1}/projects`), () => all(`${V2}/projects`));
		projectNames = new Map(list.map((p) => [String(p.id), String(p.name)]));
		return projectNames;
	};
	let sectionNames = null;
	const sections = async () => {
		if (sectionNames) return sectionNames;
		const list = await either(() => all(`${V1}/sections`), () => all(`${V2}/sections`)).catch(() => []);
		sectionNames = new Map(list.map((x) => [String(x.id), String(x.name)]));
		return sectionNames;
	};
	const toTask = (t, names, secs = /* @__PURE__ */ new Map()) => {
		const due = t.due ?? null;
		const dt = String(due?.datetime ?? due?.date ?? "");
		return {
			id: String(t.id),
			content: String(t.content ?? ""),
			priority: Number(t.priority) || 1,
			due: dt ? dt.slice(0, 10) : null,
			dueTime: /T\d{2}:\d{2}/.test(dt) ? dt.slice(11, 16) : null,
			project: names.get(String(t.project_id)) ?? null,
			section: t.section_id ? secs.get(String(t.section_id)) ?? null : null,
			deadline: t.deadline?.date ? String(t.deadline.date).slice(0, 10) : null,
			recurring: !!due?.is_recurring,
			projectId: t.project_id != null ? String(t.project_id) : null,
			sectionId: t.section_id ? String(t.section_id) : null,
			description: t.description ? String(t.description) : null,
			labels: Array.isArray(t.labels) ? t.labels.map(String) : [],
			duration: t.duration?.amount ? Number(t.duration.amount) * (t.duration.unit === "day" ? 1440 : 1) : null
		};
	};
	/** Your areas: every section (Inbox first), and every project without sections. */
	const areaList = async () => {
		const [projects, sections] = await Promise.all([either(() => all(`${V1}/projects`), () => all(`${V2}/projects`)), either(() => all(`${V1}/sections`), () => all(`${V2}/sections`)).catch(() => [])]);
		const live = projects.filter((p) => !p.is_archived && !p.is_deleted);
		const inbox = live.find((p) => p.inbox_project || p.is_inbox_project);
		const ordered = [...inbox ? [inbox] : [], ...live.filter((p) => p !== inbox)];
		const areas = [];
		for (const p of ordered) {
			const secs = sections.filter((x) => String(x.project_id) === String(p.id) && !x.is_deleted && !x.is_archived).sort((a, b) => (a.section_order ?? a.order ?? 0) - (b.section_order ?? b.order ?? 0));
			for (const x of secs) areas.push({
				key: `s:${x.id}`,
				name: String(x.name),
				kind: "section",
				id: String(x.id),
				projectId: String(p.id),
				todoistColor: p.color ?? null
			});
			areas.push({
				key: `p:${p.id}`,
				name: String(p.name),
				kind: "project",
				id: String(p.id),
				projectId: String(p.id),
				todoistColor: p.color ?? null
			});
		}
		return {
			areas,
			inboxId: inbox ? String(inbox.id) : null,
			raw: {
				projects: live,
				sections
			}
		};
	};
	/** Moves a task to a section or a project (v1 move; the sync API on older accounts). */
	const moveTo = async (id, area) => {
		const body = area.kind === "section" ? { section_id: area.id } : { project_id: area.id };
		await either(() => call(`${V1}/tasks/${encodeURIComponent(id)}/move`, {
			method: "POST",
			body: JSON.stringify(body)
		}), () => call(`${SYNC}/sync`, {
			method: "POST",
			body: JSON.stringify({ commands: [{
				type: "item_move",
				uuid: `${id}-${Date.now()}`,
				args: {
					id,
					...body
				}
			}] })
		}));
	};
	/** The area for a new task: its words first, then the model (if any). */
	const chooseArea = async (text, areas) => {
		const byWords = guessArea(text, areas);
		if (byWords || !opts.pickArea) return byWords;
		const choices = areas.filter((a) => a.kind === "section" || a.name !== "Inbox");
		const name = await opts.pickArea(text, choices.map((a) => plainName(a.name))).catch(() => null);
		return name ? choices.find((a) => plainName(a.name).toLowerCase() === name.trim().toLowerCase()) ?? null : null;
	};
	return {
		/** Every open task and your areas (the Tasks page). */
		async everything() {
			const [list, { areas, raw }] = await Promise.all([either(() => all(`${V1}/tasks`), () => all(`${V2}/tasks`)), areaList()]);
			const names = new Map(raw.projects.map((p) => [String(p.id), String(p.name)]));
			const secs = new Map(raw.sections.map((x) => [String(x.id), String(x.name)]));
			return {
				tasks: list.filter((t) => !t.checked && !t.is_completed).map((t) => toTask(t, names, secs)),
				areas
			};
		},
		areas: async () => (await areaList()).areas,
		/** Changes the text, priority (4 = P1), date ("friday 18:00", "no date") or note. */
		async update(id, patch) {
			const body = {};
			if (patch.content != null) body.content = patch.content;
			if (patch.priority != null) body.priority = Math.min(4, Math.max(1, Math.round(patch.priority)));
			if (patch.due != null) body.due_string = patch.due.trim() || "no date";
			if (patch.description != null) body.description = patch.description;
			if (Array.isArray(patch.labels)) body.labels = patch.labels.map(String).slice(0, 20);
			if (patch.duration !== void 0) {
				if (patch.duration && patch.duration > 0) {
					body.duration = Math.min(1440, Math.round(patch.duration));
					body.duration_unit = "minute";
				} else body.duration = null;
			}
			await either(() => call(`${V1}/tasks/${encodeURIComponent(id)}`, {
				method: "POST",
				body: JSON.stringify(body)
			}), () => call(`${V2}/tasks/${encodeURIComponent(id)}`, {
				method: "POST",
				body: JSON.stringify(body)
			}));
		},
		async move(id, areaKey) {
			const a = (await areaList()).areas.find((x) => x.key === areaKey);
			if (!a) throw new Error("That area no longer exists in Todoist");
			await moveTo(id, a);
		},
		async reopen(id) {
			await either(() => call(`${V1}/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" }), () => call(`${V2}/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" }));
		},
		async remove(id) {
			await either(() => call(`${V1}/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }), () => call(`${V2}/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }));
		},
		/** A new area: a section in the Inbox (or the given project). */
		async addArea(name, projectId) {
			const { inboxId } = await areaList();
			const pid = projectId || inboxId;
			const x = await either(() => call(`${V1}/sections`, {
				method: "POST",
				body: JSON.stringify({
					name,
					project_id: pid
				})
			}), () => call(`${V2}/sections`, {
				method: "POST",
				body: JSON.stringify({
					name,
					project_id: pid
				})
			}));
			return {
				key: `s:${x.id}`,
				name: String(x.name),
				kind: "section",
				id: String(x.id),
				projectId: String(pid)
			};
		},
		async renameArea(areaKey, name) {
			const [kind, id] = [areaKey.slice(0, 1), areaKey.slice(2)];
			const path = kind === "s" ? "sections" : "projects";
			await either(() => call(`${V1}/${path}/${encodeURIComponent(id)}`, {
				method: "POST",
				body: JSON.stringify({ name })
			}), () => call(`${V2}/${path}/${encodeURIComponent(id)}`, {
				method: "POST",
				body: JSON.stringify({ name })
			}));
		},
		/** Due today or overdue, or starred for today (label @today), not completed. */
		async today() {
			const q = encodeURIComponent(`today | overdue | @${TODAY_LABEL}`);
			const [list, names, secs] = await Promise.all([
				either(() => all(`${V1}/tasks/filter?query=${q}`), () => all(`${V2}/tasks?filter=${q}`)),
				projects(),
				sections()
			]);
			return list.filter((t) => !t.checked && !t.is_completed).map((t) => toTask(t, names, secs));
		},
		/** Due in the next `days` days or with a deadline then (for the deadline radar). */
		async upcoming(days = 7) {
			const q = encodeURIComponent(`next ${days} days | deadline before: +${days + 1} days`);
			const plain = encodeURIComponent(`next ${days} days`);
			const get = (query) => either(() => all(`${V1}/tasks/filter?query=${query}`), () => all(`${V2}/tasks?filter=${query}`));
			const [list, names, secs] = await Promise.all([
				get(q).catch(() => get(plain)),
				projects(),
				sections()
			]);
			return list.filter((t) => !t.checked && !t.is_completed).map((t) => toTask(t, names, secs));
		},
		/** Due tomorrow, not completed (the first thing for the wind-down message). */
		async tomorrow() {
			const q = encodeURIComponent("tomorrow");
			const [list, names, secs] = await Promise.all([
				either(() => all(`${V1}/tasks/filter?query=${q}`), () => all(`${V2}/tasks?filter=${q}`)),
				projects(),
				sections()
			]);
			return list.filter((t) => !t.checked && !t.is_completed).map((t) => toTask(t, names, secs));
		},
		async close(id) {
			await either(() => call(`${V1}/tasks/${encodeURIComponent(id)}/close`, { method: "POST" }), () => call(`${V2}/tasks/${encodeURIComponent(id)}/close`, { method: "POST" }));
		},
		/**
		* Todoist reads the date, time, priority and #project from the text. A
		* task that lands in the plain Inbox is then put in its area (by its
		* words, else the model); `areaKey` picks the area yourself.
		*/
		async quickAdd(text, areaKey) {
			const t = await either(() => call(`${V1}/tasks/quick`, {
				method: "POST",
				body: JSON.stringify({ text })
			}), () => call(`${SYNC}/quick/add`, {
				method: "POST",
				body: JSON.stringify({ text })
			}));
			const task = toTask(t ?? {}, await projects());
			try {
				const { areas, inboxId } = await areaList();
				const inPlainInbox = !task.sectionId && (!task.projectId || task.projectId === inboxId);
				const target = areaKey ? areas.find((a) => a.key === areaKey) ?? null : inPlainInbox && !/#\S/.test(text) ? await chooseArea(text, areas) : null;
				if (target && task.id && target.key !== `p:${task.projectId}`) {
					await moveTo(task.id, target);
					task.section = target.kind === "section" ? target.name : null;
					task.sectionId = target.kind === "section" ? target.id : null;
					task.projectId = target.projectId;
					task.area = target.name;
				}
			} catch {}
			return task;
		},
		/** Completed since `since` (ISO), newest first. */
		async completedSince(since) {
			const until = (/* @__PURE__ */ new Date()).toISOString();
			return (await either(() => all(`${V1}/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=200`), () => all(`${SYNC}/completed/get_all?since=${encodeURIComponent(since.slice(0, 19))}&limit=200`))).map((t) => ({
				id: String(t.task_id ?? t.id),
				content: String(t.content ?? ""),
				priority: Number(t.priority) || 1,
				completedAt: String(t.completed_at ?? "")
			}));
		}
	};
}
// src/core/coach.ts
var daysSince = (rows, today) => {
	const last = rows.map((r) => r.day).filter((d) => d <= today).sort().pop();
	if (!last) return null;
	let n = 0;
	for (let d = last; d < today; d = addDays$1(d, 1)) n++;
	return n;
};
/** What's worth a word today, most important first (empty: say nothing). */
function coachFacts(i, r) {
	const out = [];
	const t = i.today;
	const focusDays = daysSince(i.focus.filter((x) => x.minutes > 0), t);
	if (focusDays !== null && focusDays >= 2) out.push({
		id: "no-focus",
		weight: 9,
		text: `No focus session for ${focusDays} days.`,
		step: "Do one 25-minute focus block before lunch on your main subject."
	});
	const last5 = i.wakes.filter((w) => w.day > addDays$1(t, -5) && w.day <= t);
	const late = last5.filter((w) => !w.onTime).length;
	if (late >= 3) out.push({
		id: "late-wake",
		weight: 7,
		text: `Woke up late ${late} of the last ${last5.length} days.`,
		step: "Tonight: phone away 30 minutes before bed, lights out at your bedtime."
	});
	const sportDays = daysSince(i.workouts, t);
	if (sportDays !== null && sportDays >= 4) out.push({
		id: "no-sport",
		weight: 6,
		text: `No workout for ${sportDays} days.`,
		step: "Just 15 minutes today: push-ups, squats, plank. Small counts."
	});
	const lastReset = i.discipline.filter((e) => e.kind === "reset").map((e) => e.day).sort().pop();
	if (lastReset && lastReset >= addDays$1(t, -2)) out.push({
		id: "reset",
		weight: 8,
		text: "Your clean streak reset recently.",
		step: "No guilt: check in today and plan the hour when urges usually come."
	});
	const focus = r.metrics.find((m) => m.id === "focus");
	if (focus && focus.trend === "worse" && !out.some((f) => f.id === "no-focus")) out.push({
		id: "focus-down",
		weight: 6,
		text: `Focus time is down: ${focus.text} this week, about ${Math.round(focus.usual / 60)}h usually.`,
		step: "Book two 50-minute blocks in your calendar for tomorrow."
	});
	const planned = new Set((i.mustdos ?? []).map((m) => m.day));
	const unplanned = [
		1,
		2,
		3
	].filter((k) => !planned.has(addDays$1(t, -k))).length;
	if (i.mustdos && unplanned === 3) out.push({
		id: "no-plan",
		weight: 4,
		text: "No must-dos planned for 3 days.",
		step: "Write 1–3 must-dos now. Two minutes."
	});
	if (r.better.length >= 2) out.push({
		id: "improving",
		weight: 3,
		text: r.verdict,
		step: "Keep the same rhythm tomorrow."
	});
	const clean = r.metrics.find((m) => m.id === "clean");
	if (clean && clean.now === 7) out.push({
		id: "good-streak",
		weight: 2,
		text: "7 clean days out of 7.",
		step: "Protect it: same routine tonight."
	});
	return out.sort((a, b) => b.weight - a.weight);
}
/** Only good news? Then the coach stays quiet unless it's Sunday. */
var worthSaying = (facts) => facts.some((f) => f.weight >= 4);
/** The message without AI: the top facts and one step. */
function coachText(facts) {
	const top = facts.slice(0, 3);
	return `🧭 <b>Coach</b>\n\n${top.map((f) => `• ${f.text}`).join("\n")}\n\n👉 ${top[0]?.step ?? "Keep going."}`;
}
/** What Gemini is asked (the reply is sent as is, so it must be short). */
function coachPrompt(facts, r, extra) {
	return [
		"You are a calm, direct personal coach for Victor, a university student in Moldova working on university, cyber security skills, his career, sport, health and discipline.",
		`It is ${extra.when}. Write him a Telegram message of at most 3 short sentences, in plain English, no greeting fluff, no hashtags, no markdown.`,
		"Name what you see (use the facts, with numbers), then give exactly ONE concrete step he can do today, with a time or a duration.",
		"Kind but honest; never preachy. If things go well, say so in one sentence and keep the step small.",
		"",
		"Facts:",
		...facts.slice(0, 4).map((f) => `- ${f.text} (suggested step: ${f.step})`),
		`- Week overall: ${r.verdict}`,
		`- Today's must-dos: ${extra.mustdos.length ? extra.mustdos.join("; ") : "none written yet"}`,
		extra.todoistToday !== null ? `- Todoist tasks due today or late: ${extra.todoistToday}` : ""
	].filter(Boolean).join("\n");
}
/** Wake-ups are slipping: late on at least 2 of the last 5 logged mornings. */
function wakeSlipping(wakes, today) {
	const last = wakes.filter((w) => w.day <= today).sort((a, b) => a.day < b.day ? 1 : -1).slice(0, 5);
	const late = last.filter((w) => !w.onTime).length;
	return late >= 2 ? {
		late,
		of: last.length
	} : null;
}
/** The bedtime message: when to put the phone away, when you get up, the first thing tomorrow. */
function windDownText(o) {
	const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	return [
		`🌙 <b>Wind-down</b> · bedtime ${o.bedTarget}`,
		"",
		`You woke up late ${o.late} of the last ${o.of} mornings. Tomorrow starts tonight:`,
		"📵 Phone away now (charge it outside the bed).",
		`💡 Lights out at <b>${o.bedTarget}</b>, up at <b>${o.wakeTarget}</b>.`,
		o.first ? `🎯 First thing tomorrow: <b>${esc(o.first)}</b>` : "🎯 Decide your first thing for tomorrow, then sleep on it."
	].join("\n");
}
/** This week's chosen focus, when it's behind a good week: the coach's first point. */
function weekFocusFact(plan, r) {
	if (!plan) return null;
	const m = r.metrics.find((x) => x.id === plan.focus);
	if (!m || !m.target || m.now >= m.target) return null;
	const open = plan.big3.filter((b) => !b.done).map((b) => b.text);
	return {
		id: "week-focus",
		weight: 9.5,
		text: `Your focus this week is ${m.label.toLowerCase()}: ${m.text} in the last 7 days, a good week is ${m.targetText}.${plan.note ? ` Your plan: ${plan.note}.` : ""}`,
		step: plan.note || (open[0] ? `Put one block on “${open[0]}” in your calendar today.` : "One small step on it today.")
	};
}
/** Deadlines in the next 3 days (from Todoist): warned about before the day, not on it. */
function deadlineFacts(items) {
	return items.slice(0, 2).map((x, k) => {
		const wd = [
			"Sun",
			"Mon",
			"Tue",
			"Wed",
			"Thu",
			"Fri",
			"Sat"
		][(/* @__PURE__ */ new Date(`${x.date}T12:00:00Z`)).getUTCDay()];
		const when = x.daysLeft === 1 ? `tomorrow (${wd})` : `in ${x.daysLeft} days (${wd})`;
		return {
			id: "deadline",
			weight: 9.8 - k * .1,
			text: `“${x.task.content}” is due ${when}.`,
			step: x.daysLeft === 1 ? `Finish “${x.task.content}” today: block 2 hours this afternoon.` : `Do the first 50 minutes of “${x.task.content}” today, so it isn't a last-night rush.`
		};
	});
}
// src/core/todoistClean.ts
var MAX_TASKS = 150;
var norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** The prompt: compact task lines (numbered, so the model never copies ids). */
function cleanupPrompt(tasks, areas, today) {
	const areaName = (t) => {
		const key = t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ""}`;
		return areas.find((a) => a.key === key)?.name ?? t.section ?? t.project ?? "Inbox";
	};
	const lines = tasks.slice(0, MAX_TASKS).map((t, i) => JSON.stringify({
		i,
		t: t.content,
		...t.description ? { d: t.description.slice(0, 160) } : {},
		a: plainName(areaName(t)) || "Inbox",
		p: `P${5 - t.priority}`,
		...t.due ? { due: t.due } : {},
		...t.recurring ? { r: 1 } : {}
	}));
	return `You tidy a student's Todoist. Today is ${today}.
Areas: ${areas.map((a) => plainName(a.name) || a.name).join(", ")}.
Tasks (one JSON per line; i = number, t = title, d = details, a = area, p = priority, due, r = repeats):
${lines.join("\n")}

Suggest changes ONLY where they clearly help. Rules:
- Fix typos, wrong capitalization and messy wording; keep the user's language and meaning. Never invent facts.
- Titles short and actionable (max ~60 characters, start with a verb when natural). Move extra info (names, notes, links) into "details".
- "area": only when the task is clearly in the wrong area or sits in Inbox and one area clearly fits. Use an area name from the list.
- "priority": only when clearly off (an exam or deadline at P4, a someday idea at P1). P1 = urgent ... P4 = none.
- "due": only for tasks overdue by more than 7 days (suggest a realistic new date like "tomorrow", "next monday" or "no date"). Never change repeating tasks' dates.
- "remove": "duplicate" when two tasks mean the same thing (keep the better one, set "dup" to its i), or "stale" for vague tasks overdue 30+ days that nobody will do.
- "why": a few plain words.
Reply with JSON only: {"changes":[{"i":0,"title":"...","details":"...","area":"...","priority":"P2","due":"tomorrow","remove":"duplicate","dup":3,"why":"..."}]}. Leave out fields you don't change. At most 40 changes. If nothing needs fixing: {"changes":[]}.`;
}
function jsonFrom(text) {
	const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
	try {
		return JSON.parse(s);
	} catch {
		const m = s.match(/\{[\s\S]*\}/);
		if (!m) return null;
		try {
			return JSON.parse(m[0]);
		} catch {
			return null;
		}
	}
}
/** The model's answer → checked changes (unknown tasks, areas and empty changes dropped). */
function parseCleanup(text, tasks, areas) {
	const j = jsonFrom(text);
	const list = Array.isArray(j?.changes) ? j.changes : Array.isArray(j) ? j : [];
	const sent = tasks.slice(0, MAX_TASKS);
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	for (const c of list.slice(0, 60)) {
		const t = sent[Number(c?.i)];
		if (!t || seen.has(t.id)) continue;
		const ch = {
			id: t.id,
			before: t.content,
			why: String(c.why ?? "").trim().slice(0, 120) || "Tidier"
		};
		const title = typeof c.title === "string" ? c.title.trim().slice(0, 200) : "";
		if (title && title !== t.content) ch.title = title;
		const details = typeof c.details === "string" ? c.details.trim().slice(0, 1e3) : "";
		if (details && details !== (t.description ?? "")) ch.details = t.description && !details.includes(t.description) ? `${details}\n\n${t.description}` : details;
		if (typeof c.area === "string") {
			const want = norm(c.area);
			const a = areas.find((x) => norm(plainName(x.name) || x.name) === want) ?? areas.find((x) => want && norm(x.name).includes(want));
			const cur = t.sectionId ? `s:${t.sectionId}` : `p:${t.projectId ?? ""}`;
			if (a && a.key !== cur) ch.area = a.key;
		}
		const pm = String(c.priority ?? "").match(/^P?([1-4])$/i);
		if (pm) {
			const p = 5 - Number(pm[1]);
			if (p !== t.priority) ch.priority = p;
		}
		if (typeof c.due === "string" && c.due.trim() && !t.recurring) ch.due = c.due.trim().slice(0, 40);
		if (c.remove === "duplicate" || c.remove === "stale") {
			ch.remove = c.remove;
			const dup = sent[Number(c.dup)];
			if (c.remove === "duplicate") {
				if (!dup || dup.id === t.id) continue;
				ch.duplicateOf = dup.content;
			}
		}
		if (!ch.title && !ch.details && !ch.area && !ch.priority && !ch.due && !ch.remove) continue;
		seen.add(t.id);
		out.push(ch);
	}
	return out;
}
/** Without AI: exact duplicates (same words) and tasks overdue for 30+ days. */
function localCleanup(tasks, today) {
	const out = [];
	const first = /* @__PURE__ */ new Map();
	for (const t of tasks) {
		const k = norm(t.content);
		if (!k) continue;
		const prev = first.get(k);
		if (prev) out.push({
			id: t.id,
			before: t.content,
			remove: "duplicate",
			duplicateOf: prev.content,
			why: "Same task twice"
		});
		else first.set(k, t);
	}
	const old = addDays$1(today, -30);
	for (const t of tasks) {
		if (t.recurring || !t.due || t.due >= old || out.some((c) => c.id === t.id)) continue;
		out.push({
			id: t.id,
			before: t.content,
			due: "no date",
			why: `Overdue since ${t.due}: give it a real date or drop it`
		});
	}
	return out;
}
// src/server/telegramBot.ts
/**
* Your Google Calendar for the bots, when you signed in (Settings): reads
* the sealed sign-in from the database each time, so a new sign-in works
* without a restart.
*/
function calendarFor(env, mirror) {
	if (!env.google) return null;
	const api = async () => {
		const raw = await mirror.read((db) => getSetting(db, GOOGLE_SETTING));
		const st = raw ? JSON.parse(raw) : null;
		return st?.enc ? createCalendarApi(env.google, st) : null;
	};
	return {
		events: async (from, to) => (await api())?.events(from, to) ?? [],
		create: async (e) => {
			const a = await api();
			if (!a) throw new Error("Connect Google Calendar in the app (Settings) first");
			return a.create(e);
		},
		move: async (calendarId, id, start, end) => {
			const a = await api();
			if (!a) throw new Error("Connect Google Calendar in the app (Settings) first");
			return a.move(calendarId, id, start, end);
		},
		remove: async (calendarId, id) => {
			const a = await api();
			if (!a) throw new Error("Connect Google Calendar in the app (Settings) first");
			return a.remove(calendarId, id);
		}
	};
}
var warm = null;
async function botsFor(env) {
	const key = env.tursoUrl + "|" + env.tursoToken.slice(-12) + "|" + (env.todoistToken ?? "").slice(-6) + "|" + (env.model ? "ai" : "") + "|" + (env.google ? "g" : "");
	if (warm && warm.key === key) {
		await warm.mirror.refresh();
		return warm;
	}
	const require = createRequire(import.meta.url);
	const mirror = new Mirror(await initSqlJs({ locateFile: (f) => require.resolve(`sql.js/dist/${f}`) }), new TursoHttp(env.tursoUrl, env.tursoToken), null);
	await mirror.ready;
	const services = createWebServices(mirror);
	const defaults = {
		enabled: true,
		pollingEnabled: true,
		morningBriefing: true,
		eveningNudge: true,
		...env.defaults
	};
	const pickArea = env.model ? async (text, names) => {
		const r = (await env.model(`Which ONE of these life areas does this task belong to? Areas: ${names.join(", ")}.\nTask: "${text}"\nReply with exactly one area name from the list, or "none".`)).trim().replace(/^"|"$/g, "");
		return /^none$/i.test(r) ? null : r;
	} : void 0;
	const todoist = env.todoistToken ? createTodoistApi(env.todoistToken, fetch, { pickArea }) : null;
	const calendar = calendarFor(env, mirror);
	warm = {
		key,
		bots: createWebBots({
			mirror,
			services,
			defaults,
			server: true,
			todoist,
			ai: env.model ?? null,
			calendar
		}),
		mirror,
		services,
		calendar
	};
	return warm;
}
var todoistCheckedAt = 0;
var TODOIST_COINS = DEFAULT_RULES.find((r) => r.id === "tasks.todoist_done")?.coins ?? 8;
/**
* Coins for what you completed in Todoist itself (each task once, see
* payTodoist), checked by the server so they arrive with no device open:
* at the daily messages and, at most every few minutes, with a bot message.
* `since` defaults to today's midnight in your time zone.
*/
async function payTodoistDone(env, opts = {}) {
	if (!env.todoistToken) return {
		paid: 0,
		done: 0
	};
	if (opts.minGapMs && Date.now() - todoistCheckedAt < opts.minGapMs) return {
		paid: 0,
		done: 0
	};
	todoistCheckedAt = Date.now();
	const { mirror, services } = await botsFor(env);
	const since = opts.since ?? localMidnight(0);
	const items = await createTodoistApi(env.todoistToken).completedSince(since.toISOString());
	if (!items.length) return {
		paid: 0,
		done: 0
	};
	return {
		paid: await mirror.write((db) => payTodoist(services.services(db), items)),
		done: items.length
	};
}
/** Midnight `daysAgo` days back, in process.env.TZ. */
function localMidnight(daysAgo) {
	const d = /* @__PURE__ */ new Date();
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - daysAgo);
	return d;
}
/** The app's Coach page: one message to the coach (same brain, memory and log as the bots). */
async function coachChat(env, text, onStep) {
	process.env.TZ = env.timeZone || "Europe/Chisinau";
	if (!env.model) return {
		ok: false,
		reply: "Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to talk to the coach.",
		done: []
	};
	const { bots } = await botsFor(env);
	const r = await bots.think(text, `app:${Date.now()}`, onStep);
	return {
		ok: r.ok,
		reply: r.reply,
		done: r.done,
		steps: r.steps
	};
}
/** Handles one Telegram update for the bot with this token; returns the reply sent. */
async function handleTelegramUpdate(env, token, update) {
	process.env.TZ = env.timeZone || "Europe/Chisinau";
	const { bots, mirror } = await botsFor(env);
	if (update?.message) await mirror.write((db) => {
		const raw = getSetting(db, REMINDERS);
		if (raw) setSetting(db, REMINDERS, JSON.stringify(answered(JSON.parse(raw))));
	}).catch(() => null);
	const reply = await bots.handleUpdate(token, update);
	await payTodoistDone(env, { minGapMs: 18e4 }).catch(() => null);
	return reply;
}
/**
* The daily messages (Vercel runs them on a schedule, api/cron.mjs):
* morning: the plan question, then the coach if something slipped;
* midday: a nudge only when there's been no focus yet today;
* evening: the review with tap-buttons, and on Sundays the week and
* "Am I improving?".
*/
async function runDaily(env, job) {
	process.env.TZ = env.timeZone || "Europe/Chisinau";
	const { services, mirror } = await botsFor(env);
	if (job === "morning" || job === "reask" || job === "evening") {
		if (await mirror.read((db) => cleanPrefs(JSON.parse(getSetting(db, "coach_rhythm_prefs") || "null")).on).catch(() => true)) return [];
	}
	const send = async (text, reply_markup, token = env.botToken) => {
		const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: env.chatId,
				text,
				parse_mode: "HTML",
				...reply_markup ? { reply_markup } : {}
			})
		});
		const j = await res.json().catch(() => ({}));
		if (!j.ok) throw new Error(`Telegram: ${j.description ?? res.status}`);
	};
	const todo = await payTodoistDone(env, { since: localMidnight(job === "morning" ? 1 : 0) }).catch(() => null);
	const st = await services.focus.state();
	const todoistToday = env.todoistToken ? await createTodoistApi(env.todoistToken).today().then((t) => t.length).catch(() => null) : null;
	const { input, report, weekPlan, savedPlan } = await mirror.read((db) => {
		const svc = services.services(db);
		const fin = getSetting(db, "app_sync_finance");
		let spending = null;
		try {
			spending = fin ? financeSpending(JSON.parse(fin)?.data) : null;
		} catch {
			spending = null;
		}
		const input = svc.progress.input(spending);
		return {
			input,
			report: progressReport(input),
			weekPlan: svc.weekPlan.active(),
			savedPlan: svc.weekPlan.saved()
		};
	});
	const weekFact = weekFocusFact(weekPlan, report);
	const facts = [
		...deadlineFacts(env.todoistToken && job !== "evening" && job !== "night" ? deadlineRadar(await createTodoistApi(env.todoistToken).upcoming(7).catch(() => []), input.today) : []),
		...weekFact ? [weekFact] : [],
		...coachFacts(input, report)
	].sort((a, b) => b.weight - a.weight);
	/** Gemini says it in its own words; the plain text when there's no key or it fails. */
	const coach = async (when, fallback) => {
		if (!env.ai) return fallback;
		try {
			const prompt = coachPrompt(facts, report, {
				mustdos: st.plan.items.map((x) => x.text),
				todoistToday,
				when
			});
			const text = (await env.ai(prompt)).trim();
			return text ? `🧭 <b>Coach</b>\n\n${escapeHtml(text).slice(0, 900)}` : fallback;
		} catch {
			return fallback;
		}
	};
	/** ▶ buttons under the coach: your open must-dos, else your usual subjects. */
	const focusButtons = () => {
		const open = st.plan.items.filter((x) => !x.done).map((x) => x.text);
		return focusKeyboard(open.length ? open : st.subjects.slice(0, 2));
	};
	const sent = [];
	if (job === "morning") {
		const planAlready = st.plan.items.length > 0;
		const askedToday = await mirror.read((db) => getSetting(db, "morning_sent_day") === input.today);
		if (!askedToday) await mirror.write((db) => setSetting(db, "morning_sent_day", input.today));
		if (!askedToday) await send(morningText({
			focusYesterdayMin: st.week.byDay[5]?.minutes ?? 0,
			goalsBehind: st.goals.filter((g) => g.aheadH < 0),
			todoistToday,
			planAlready
		}), planAlready ? void 0 : {
			force_reply: true,
			input_field_placeholder: "Essay intro; gym; call Leo"
		});
		if (!askedToday) sent.push("morning");
		if (worthSaying(facts)) {
			await send(await coach("morning", coachText(facts)), focusButtons());
			sent.push("coach");
		}
	} else if (job === "reask") {
		if (!st.plan.items.length) {
			await send(`🧭 Still no plan for today. Just one thing is enough.\n\n<b>${PLAN_ASK}</b>\nReply to this message.`, {
				force_reply: true,
				input_field_placeholder: "One thing that makes today good"
			});
			sent.push("reask");
		}
	} else if (job === "midday") {
		if (st.todayMin === 0 && !st.running) {
			const fallback = `🧭 <b>Coach</b>\n\nHalf the day is gone and no focus yet${st.plan.items.length ? `. Your must-do: <b>${escapeHtml(st.plan.items.find((x) => !x.done)?.text ?? st.plan.items[0].text)}</b>` : ""}.\n\n👉 Start one 25-minute block now: <code>/focus 25 ${escapeHtml(st.subjects[0] ?? "study")}</code>`;
			facts.unshift({
				id: "no-focus",
				weight: 10,
				text: "No focus session yet today (it is midday).",
				step: "Start one 25-minute block now."
			});
			await send(await coach("midday", fallback), focusButtons());
			sent.push("midday");
		}
	} else if (job === "night") {
		const slip = wakeSlipping(input.wakes, input.today);
		if (slip) {
			const { bed, wake } = await mirror.read((db) => {
				const sl = services.services(db).sleep;
				return {
					bed: sl.bedtimeTarget(),
					wake: targetForDay(addDays$1(input.today, 1), sl.weekdayTarget(), sl.weekendTarget())
				};
			});
			let first = null;
			if (env.todoistToken) first = (await createTodoistApi(env.todoistToken).tomorrow().catch(() => [])).sort((a, b) => b.priority - a.priority || String(a.dueTime ?? "99").localeCompare(String(b.dueTime ?? "99")))[0]?.content ?? null;
			first ??= st.plan.items.find((x) => !x.done)?.text ?? null;
			await send(windDownText({
				bedTarget: bed,
				wakeTarget: wake,
				late: slip.late,
				of: slip.of,
				first
			}), void 0, env.sleepBotToken || env.botToken);
			sent.push("night");
		}
	} else {
		let weekLine = "";
		const wm = weekPlan ? report.metrics.find((m) => m.id === weekPlan.focus) : null;
		if (weekPlan && wm?.target && wm.now >= wm.target) {
			if (await mirror.write((db) => payOnce(services.services(db).wallet, `weekfocus:${weekPlan.week}`, 50, `Week focus reached: ${wm.label}`))) weekLine = `\n\n🏆 Week focus reached: <b>${wm.label}</b> (${wm.text}). +50 points.`;
		}
		const todoLine = todo && todo.done ? `\n\n✅ Todoist: ${todo.done} done today${todo.paid ? ` · +${todo.paid * TODOIST_COINS} 🪙 just now` : ""}` : "";
		await send(eveningText(st.plan, st.todayMin) + todoLine + weekLine, st.plan.items.length ? planKeyboard(st.plan, true) : void 0);
		sent.push("evening");
		if ((/* @__PURE__ */ new Date()).getDay() === 0) {
			await send(weekText(st.week, st.goals));
			await send(progressText(report));
			if (shouldPlan(savedPlan, input.today)) {
				const url = env.appUrl ? `${env.appUrl.replace(/\/$/, "")}/` : null;
				await send("🗓 <b>Plan next week</b> (15 minutes)\n\nPick <b>one</b> area to focus on and your <b>3 big tasks</b>. Open Progress in the app; the coach then checks that focus every day.", url ? { inline_keyboard: [[{
					text: "🗓 Plan my week",
					url
				}]] } : void 0);
			}
			sent.push("weekly");
		}
	}
	return sent;
}
var escapeHtml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var TICK_AT = "coach_tick_at";
async function runTick(env, now = /* @__PURE__ */ new Date()) {
	process.env.TZ = env.timeZone || "Europe/Chisinau";
	const { services, mirror, calendar, bots } = await botsFor(env);
	if (!await mirror.write((db) => {
		const last = Number(getSetting(db, TICK_AT) || 0);
		if (now.getTime() - last < 5e4) return false;
		setSetting(db, TICK_AT, String(now.getTime()));
		return true;
	})) return [];
	const sent = [];
	const send = async (text, reply_markup) => {
		const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: env.chatId,
				text,
				parse_mode: "HTML",
				...reply_markup ? { reply_markup } : {}
			})
		});
		const j = await res.json().catch(() => ({}));
		if (!j.ok) throw new Error(`Telegram: ${j.description ?? res.status}`);
		sent.push(text);
	};
	const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const pauseRow = [{
		text: "😴 30 min",
		callback_data: "ns|"
	}, {
		text: "⏸ Pause today",
		callback_data: "np|"
	}];
	const today0 = await mirror.read((db) => services.services(db).wallet.today(now));
	const reminders = await mirror.read((db) => {
		try {
			return JSON.parse(getSetting(db, "coach_reminders") || "[]");
		} catch {
			return [];
		}
	});
	let list = reminders;
	for (const r of dueReminders(list, now)) try {
		await send(r.kind === "checkin" ? followUpText({
			...r,
			text: esc(r.text)
		}, promiseStats(list, now)) : `⏰ ${esc(r.text)}`, r.kind === "checkin" ? { inline_keyboard: [pauseRow] } : void 0);
		list = afterSend(list, r.id, now);
		if (list.find((x) => x.id === r.id)?.ignored) await bots.rhythm.countPromise(today0, "ignored").catch(() => null);
	} catch {}
	if (list !== reminders) await mirror.write((db) => setSetting(db, REMINDERS, JSON.stringify(list)));
	try {
		await rhythmTick(env, now, send);
	} catch (e) {
		console.error("rhythm:", e);
	}
	const st = await mirror.read((db) => {
		let nudge = {};
		try {
			nudge = JSON.parse(getSetting(db, "coach_nudges") || "{}");
		} catch {
			nudge = {};
		}
		const svc = services.services(db);
		const today = svc.wallet.today(now);
		const f = svc.focus.state(now);
		const lastLedger = svc.wallet.entries().filter((e) => e.day === today).map((e) => Date.parse(e.ts)).filter(Number.isFinite);
		const lastFocus = f.todaySessions.map((x) => Date.parse(x.endedAt ?? "")).filter(Number.isFinite);
		const last = Math.max(0, ...lastLedger, ...lastFocus);
		return {
			nudge,
			today,
			focus: f,
			idleMin: last ? (now.getTime() - last) / 6e4 : Infinity
		};
	});
	let nudge = st.nudge.day === st.today ? st.nudge : {
		...st.nudge,
		day: st.today,
		count: 0,
		announced: []
	};
	const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	const paused = nudge.pausedDay === st.today;
	if (calendar && !st.focus.running && !paused) {
		const starting = (await calendar.events((/* @__PURE__ */ new Date(now.getTime() - 18e5)).toISOString(), new Date(now.getTime() + 9e5).toISOString()).catch(() => [])).find((e) => isFocusBlock(e) && !(nudge.announced ?? []).includes(e.id) && Date.parse(e.start) - now.getTime() <= 6e5 && Date.parse(e.end) - now.getTime() >= 9e5);
		if (starting) {
			const mins = Math.round((Date.parse(starting.end) - Math.max(now.getTime(), Date.parse(starting.start))) / 6e4);
			const subject = blockSubject(starting.title).slice(0, 28);
			try {
				await send(`📚 <b>${esc(starting.title)}</b> ${Date.parse(starting.start) > now.getTime() ? `starts at ${localIsoHM(starting.start)}` : "is on now"} · ${mins} min · +${focusCoins(mins)} points if you focus.\nStart the timer?`, { inline_keyboard: [[{
					text: `▶ Start: ${subject}`,
					callback_data: `fo|${subject}`
				}], pauseRow] });
				nudge = {
					...nudge,
					announced: [...nudge.announced ?? [], starting.id]
				};
			} catch {}
		}
	}
	const openMustDos = st.focus.plan.items.filter((x) => !x.done);
	const facts = {
		today: st.today,
		time,
		focusRunning: !!st.focus.running,
		focusMinToday: st.focus.todayMin,
		openMustDos: openMustDos.length,
		idleMin: st.idleMin,
		wakeLogged: true
	};
	if (!sent.length && shouldNudge(nudge, facts, now)) {
		const n = (nudge.day === st.today ? nudge.count ?? 0 : 0) + 1;
		const first = openMustDos[0]?.text;
		const idle = Number.isFinite(st.idleMin) ? `${Math.floor(st.idleMin / 60) ? `${Math.floor(st.idleMin / 60)}h ` : ""}${Math.round(st.idleMin % 60)}m` : "all day";
		const text = n === 1 ? `👀 Nothing done for ${idle}. ${first ? `Your must-do: <b>${esc(first)}</b>.` : `Focus today: ${st.focus.todayMin} min.`} 25 minutes, starting now.` : n <= 3 ? `⏰ Still waiting. ${first ? `<b>${esc(first)}</b> won't do itself.` : "One focus block."} Just start the timer, the rest follows.` : `🔥 Nudge ${n}: you said you want this. ${first ? `<b>${esc(first)}</b>,` : "One block,"} 25 min. Tap and go.`;
		const subject = (first ?? "Focus").split(/\s+/).slice(0, 4).join(" ").slice(0, 28);
		try {
			await send(text, { inline_keyboard: [[{
				text: `▶ 50 min: ${subject}`,
				callback_data: `fo|${subject}`
			}], pauseRow] });
			nudge = nudged(nudge, st.today, now);
		} catch {}
	}
	if (JSON.stringify(nudge) !== JSON.stringify(st.nudge)) await mirror.write((db) => setSetting(db, NUDGES, JSON.stringify(nudge)));
	return sent;
}
/** What the rhythm sends now (each thing once a day; state in settings.coach_rhythm). */
async function rhythmTick(env, now, send) {
	const { bots, services, mirror } = await botsFor(env);
	const f = await mirror.read((db) => {
		const svc = services.services(db);
		const today = svc.wallet.today(now);
		const prefs = cleanPrefs(JSON.parse(getSetting(db, "coach_rhythm_prefs") || "null"));
		const state = rhythmFor(JSON.parse(getSetting(db, "coach_rhythm") || "null"), today);
		const row = db.prepare("SELECT wake_time, created_at FROM sleep_logs WHERE day = ?").get(today);
		const sl = svc.sleep;
		let sport = null;
		try {
			sport = JSON.parse(getSetting(db, "sport_tracker_json") || "null")?.data ?? null;
		} catch {
			sport = null;
		}
		const water = sport ? sharedView(sport, sportToday(now)).water : {
			ml: 0,
			target: 0
		};
		let paused = false;
		try {
			paused = JSON.parse(getSetting(db, "coach_nudges") || "{}").pausedDay === today;
		} catch {
			paused = false;
		}
		return {
			prefs,
			state,
			facts: {
				today,
				time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
				weekday: now.getDay(),
				wakeAt: row?.wake_time ?? null,
				wakeTarget: targetForDay(today, sl.weekdayTarget(), sl.weekendTarget()),
				waterMl: water.ml,
				waterTarget: water.target,
				workoutDone: (svc.wallet.summary(now).todayRules ?? []).includes("body.workout_done"),
				paused
			}
		};
	});
	const jobs = dueRhythm(f.state, f.prefs, f.facts);
	for (const job of jobs) if (job === "briefing") {
		const { plan, version } = await bots.rhythm.propose();
		await send(proposalText(plan, { version }), PROPOSAL_KEYBOARD);
	} else if (job === "water") {
		const line = await bots.rhythm.waterLine();
		if (line) await send(line, { inline_keyboard: [[{
			text: "😴 30 min",
			callback_data: "ns|"
		}, {
			text: "⏸ Pause today",
			callback_data: "np|"
		}]] });
	} else if (job === "training") await send(await bots.rhythm.trainingLine());
	else if (job === "weekly") await send(weeklyText(await bots.rhythm.weekly()), WEEKLY_KEYBOARD);
	else if (job === "evening") {
		await payTodoistDone(env, { since: localMidnight(0) }).catch(() => null);
		const r = await bots.rhythm.evening();
		const bonus = await mirror.write((db) => {
			const svc = services.services(db);
			const plan = svc.weekPlan.active();
			if (!plan) return "";
			const m = progressReport(svc.progress.input(null)).metrics.find((x) => x.id === plan.focus);
			if (!m?.target || m.now < m.target) return "";
			return payOnce(svc.wallet, `weekfocus:${plan.week}`, 50, `Week focus reached: ${m.label}`) ? `\n\n🏆 Week focus reached: <b>${m.label}</b> (${m.text}). +50 points.` : "";
		});
		const goalText = r.goals.length ? `\n\n🎯 <b>Goals</b>\n${r.goals.map((g) => escapeHtml(g)).join("\n")}${r.rebooked.length ? `\n${r.rebooked.map((x) => escapeHtml(x)).join("\n")}` : ""}` : "";
		await send(reviewText(r.result, r.score, r.lesson, r.top3) + goalText + bonus, r.top3.length ? REVIEW_KEYBOARD : void 0);
	}
}
/** The app: today's rhythm (state), or an action on it. */
async function coachRhythm(env, op) {
	process.env.TZ = env.timeZone || "Europe/Chisinau";
	const { bots } = await botsFor(env);
	if (op.action === "book") {
		const id = Number(op.note);
		return bots.rhythm.bookGoals(Number.isFinite(id) && id > 0 ? [id] : void 0);
	}
	if (op.action === "propose") await bots.rhythm.propose(String(op.note ?? "").slice(0, 500));
	if (op.action === "approve") {
		const r = await bots.rhythm.approve();
		return {
			...await bots.rhythm.state(),
			done: r.done
		};
	}
	if (op.action === "top3") await bots.rhythm.setTop3(String(op.note ?? ""));
	if (op.action === "prefs") await bots.rhythm.setPrefs(op.prefs ?? {});
	return bots.rhythm.state();
}
var localIsoHM = (iso) => {
	const d = new Date(iso);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
async function sportShared(env, body) {
	process.env.TZ = env.timeZone || "Europe/Chisinau";
	const { mirror, services } = await botsFor(env);
	const today = sportToday();
	const read = (db) => {
		try {
			return JSON.parse(getSetting(db, "sport_tracker_json") || "null")?.data ?? null;
		} catch {
			return null;
		}
	};
	const save = (db, st) => setSetting(db, "sport_tracker_json", JSON.stringify({
		savedAt: Date.now(),
		data: st
	}));
	const op = String(body?.op ?? "state");
	if (op === "state") return {
		ok: true,
		state: await mirror.read((db) => sharedView(read(db), today))
	};
	if ((op === "water" || op === "reps") && !await mirror.read((db) => read(db))) return {
		ok: false,
		error: "Open Sport Track in the Life System app once, so there is something to share"
	};
	if (op === "water") {
		const ml = Number(body.ml);
		if (!Number.isFinite(ml) || Math.abs(ml) > 5e3) return {
			ok: false,
			error: "ml must be a number (−5000…5000)"
		};
		return {
			ok: true,
			state: await mirror.write((db) => {
				const st = addWater(read(db), ml, today);
				save(db, st);
				return sharedView(st, today);
			})
		};
	}
	if (op === "reps") {
		const amount = Number(body.amount);
		if (!body.name || !Number.isFinite(amount) || Math.abs(amount) > 2e3) return {
			ok: false,
			error: "name and amount needed"
		};
		return mirror.write((db) => {
			const r = addReps(read(db), String(body.name), amount, today);
			if (!r) return {
				ok: false,
				error: `No exercise called "${body.name}" in Sport Track`
			};
			save(db, r.st);
			return {
				ok: true,
				exercise: r.exercise,
				state: sharedView(r.st, today)
			};
		});
	}
	if (op === "workout") {
		const title = String(body.title || "Workout").slice(0, 80);
		const items = Array.isArray(body.items) && body.items.length ? body.items : [{
			exerciseId: "ex_workout",
			name: title,
			sets: 1,
			reps: 1
		}];
		try {
			await mirror.write((db) => services.services(db).body.logWorkout({
				title,
				items
			}));
			return {
				ok: true,
				state: await mirror.read((db) => sharedView(read(db), today))
			};
		} catch (e) {
			return {
				ok: false,
				error: e.message
			};
		}
	}
	return {
		ok: false,
		error: "op must be state | water | reps | workout"
	};
}
export { GOOGLE_SETTING, authUrl, cleanupPrompt, coachChat, coachRhythm, createCalendarApi, createTodoistApi, exchangeCode, handleTelegramUpdate, localCleanup, localIso, parseCleanup, payTodoistDone, runDaily, runTick, sportShared };
