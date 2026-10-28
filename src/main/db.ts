import Database from 'better-sqlite3'
import { DEFAULT_RULES } from '@core/rules'
import { DEFAULT_EXERCISES } from '@core/body'

export type DB = Database.Database

// Append-only list: never edit a migration once it has shipped, add a new one.
const MIGRATIONS: string[] = [
  /* 001 core: settings, wallet ledger, point rules */ `
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
  /* 002 shop: rewards and what was bought (the coins live in the ledger) */ `
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
  /* 003 plan: task categories, tasks, schedule blocks */ `
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
  /* 004 discipline: dated events; the streak is computed from them */ `
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
  /* 005 body: workouts, exercises, body metrics */ `
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
  /* 006 sleep & expenses: native sleep logging and standalone expense tracking */ `
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
  /* 007 unified rewarding & financial economy: wishlist mega goals, reward vault surplus ledger, chest loot drops */ `
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
  /* 008 photo urls and multi-currency: image_url & currency on rewards and wishlist_goals */ `
  ALTER TABLE rewards ADD COLUMN image_url TEXT;
  ALTER TABLE rewards ADD COLUMN currency TEXT NOT NULL DEFAULT 'MDL';
  ALTER TABLE wishlist_goals ADD COLUMN image_url TEXT;
  ALTER TABLE wishlist_goals ADD COLUMN currency TEXT NOT NULL DEFAULT 'MDL';
  `,
  /* 009 clean up pseudo-categories today & tomorrow from categories table */ `
  UPDATE tasks SET category = 'life' WHERE category IN ('today', 'tomorrow');
  UPDATE categories SET archived = 1 WHERE id IN ('today', 'tomorrow');
  `,
  /* 010 permanently purge password / pin lock from settings */ `
  DELETE FROM settings WHERE key = 'pin_hash';
  `,
  /* 011 Shadow Economy 2.0: active buffs and inventory items */ `
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
  /* 012 Align rewards real_cost with the standard 10 coins = 1 MDL exchange rate */ `
  UPDATE rewards SET real_cost = CAST(ROUND(price / 10.0) AS INTEGER) WHERE real_cost != CAST(ROUND(price / 10.0) AS INTEGER) OR real_cost = 0;
  `,
  /* 013 Rich store URLs for rewards and wishlist_goals */ `
  ALTER TABLE rewards ADD COLUMN product_url TEXT;
  ALTER TABLE wishlist_goals ADD COLUMN product_url TEXT;
  `
]

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

function seedDefaults(db: DB): void {
  const insertRule = db.prepare(
    `INSERT OR IGNORE INTO rules (id, module, title, coins, xp, daily_cap, cooldown_min, enabled, sort)
     VALUES (@id, @module, @title, @coins, @xp, @dailyCap, @cooldownMin, @enabled, @sort)`
  )
  const insertExercise = db.prepare(
    `INSERT OR IGNORE INTO exercises (id, name, unit, target, category, sort, archived)
     VALUES (@id, @name, @unit, @target, @category, @sort, 0)`
  )

  db.transaction(() => {
    DEFAULT_RULES.forEach((r, i) => insertRule.run({ ...r, enabled: r.enabled ? 1 : 0, sort: i }))
    DEFAULT_EXERCISES.forEach((e) => insertExercise.run(e))
  })()
}

export function openDb(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 3000')
  migrate(db)
  seedDefaults(db)
  // Ensure any legacy PIN lock is immediately wiped
  db.prepare("DELETE FROM settings WHERE key = 'pin_hash'").run()
  return db
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
