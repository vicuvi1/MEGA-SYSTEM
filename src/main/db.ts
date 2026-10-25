import Database from 'better-sqlite3'
import { DEFAULT_RULES } from '@core/rules'

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
    ('Face cream', 300, 'bronze', 250, 0, NULL),
    ('New phone case', 600, 'bronze', 300, 1, NULL),
    ('Shaver machine', 1500, 'silver', 900, 0, NULL),
    ('Kaaba trip fund', 20000, 'legendary', 0, 0, 'The big one. Keep stacking.');
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
  const insert = db.prepare(
    `INSERT OR IGNORE INTO rules (id, module, title, coins, xp, daily_cap, cooldown_min, enabled, sort)
     VALUES (@id, @module, @title, @coins, @xp, @dailyCap, @cooldownMin, @enabled, @sort)`
  )
  db.transaction(() => {
    DEFAULT_RULES.forEach((r, i) => insert.run({ ...r, enabled: r.enabled ? 1 : 0, sort: i }))
  })()
}

export function openDb(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 3000')
  migrate(db)
  seedDefaults(db)
  return db
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
