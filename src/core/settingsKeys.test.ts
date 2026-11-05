// LT5: every settings key used in src/ is listed in settingsKeys.ts, and the
// typed reads give the stored value or a safe default.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { knownSettingKey, parseSetting, serializeSetting, SETTINGS } from './settingsKeys'

const SRC = join(__dirname, '..')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

const CONST = /(?:export )?const ([A-Za-z_][A-Za-z0-9_]*) = '([a-z][a-z0-9_.]*)'/g
const CALL = /\b(?:getSetting|setSetting|readSetting|writeSetting)\(\s*[^,()]+(?:\([^()]*\))?\s*,\s*([^,)\s]+)/g
const SQL = /FROM settings WHERE key = '([a-z][a-z0-9_.]*)'/g

/** Every key the code names: string literals, and constants that hold one. */
function usedKeys(): { key: string; file: string }[] {
  const files = walk(SRC).map((f) => ({ f: relative(SRC, f), s: readFileSync(f, 'utf8') }))
  const global = new Map<string, Set<string>>()
  for (const { s } of files) for (const m of s.matchAll(CONST)) global.set(m[1], (global.get(m[1]) ?? new Set()).add(m[2]))
  const out: { key: string; file: string }[] = []
  for (const { f, s } of files) {
    const local = new Map([...s.matchAll(CONST)].map((m) => [m[1], m[2]] as const))
    for (const m of s.matchAll(CALL)) {
      const a = m[1]
      if (a.startsWith("'")) out.push({ key: a.slice(1, -1), file: f })
      else if (local.has(a)) out.push({ key: local.get(a)!, file: f })
      else if (global.get(a)?.size === 1) out.push({ key: [...global.get(a)!][0], file: f })
      // other arguments are variables or template strings (prefix families)
    }
    for (const m of s.matchAll(SQL)) out.push({ key: m[1], file: f })
  }
  return out
}

describe('settings keys (LT5)', () => {
  it('every key used in src/ is in the registry', () => {
    const used = usedKeys()
    expect(used.length).toBeGreaterThan(80)
    const missing = used.filter((u) => !knownSettingKey(u.key)).map((u) => `${u.key} (${u.file})`)
    expect(missing, 'add these to SETTINGS in src/core/settingsKeys.ts').toEqual([])
  })
  it('each key says what it holds', () => {
    for (const [k, spec] of Object.entries(SETTINGS)) expect(spec.about.length, k).toBeGreaterThan(3)
  })
  it('reads the stored value, or the default when missing or broken', () => {
    expect(parseSetting('sport_tracker_json', '{"savedAt":1,"data":{"lastDate":"2026-01-02"}}')).toEqual({ savedAt: 1, data: { lastDate: '2026-01-02' } })
    expect(parseSetting('sport_tracker_json', null)).toBeNull()
    expect(parseSetting('sport_tracker_json', '{broken')).toBeNull()
    expect(parseSetting('coach_log', 'null')).toEqual([])
    expect(parseSetting('discipline_stealth', '1')).toBe(true)
    expect(parseSetting('discipline_stealth', '0')).toBe(false)
    expect(parseSetting('discipline_stealth', null)).toBe(false)
    expect(parseSetting('money_daily_budget', 'abc')).toBe(0)
    expect(parseSetting('money_daily_budget', '150')).toBe(150)
  })
  it('writes in the same format the old code did', () => {
    expect(serializeSetting('discipline_stealth', true)).toBe('1')
    expect(serializeSetting('discipline_stealth', false)).toBe('0')
    expect(serializeSetting('focus_running', null)).toBe('null')
    expect(serializeSetting('coach_log', [{ a: 1 }])).toBe('[{"a":1}]')
  })
})
