import { describe, expect, it } from 'vitest'
import { addDays, dayKey, daysBetween } from './dates'
import { levelInfo, xpToNext } from './levels'
import { balance, byModule, clampPenalty, LedgerError, planSpend, planUndo, totalXp, type LedgerEntry } from './ledger'
import { planAward, type Rule } from './rules'
import { bestDayStreak, cleanStats, dayStreak } from './streaks'
import { decryptBackup, encryptBackup } from './backupCrypto'
import { backupName, namesToPrune } from './retention'

let nextId = 1
function entry(p: Partial<LedgerEntry>): LedgerEntry {
  return { id: nextId++, ts: '2026-10-25T10:00:00.000Z', day: '2026-10-25', module: 'test', kind: 'earn', coins: 0, xp: 0, ...p }
}

const rule: Rule = { id: 'r', module: 'schedule', title: 'Study', coins: 15, xp: 30, dailyCap: 2, cooldownMin: 20, enabled: true }

describe('dates', () => {
  it('counts 01:30 as the previous day', () => {
    expect(dayKey('2026-10-25T01:30:00', 'UTC')).toBe('2026-10-24')
    expect(dayKey('2026-10-25T04:00:00Z', 'UTC')).toBe('2026-10-25')
  })
  it('respects the time zone', () => {
    // 23:30 UTC is 02:30 next day in Chisinau (UTC+3 in summer) -> still the 25th
    expect(dayKey('2026-07-25T23:30:00Z', 'Europe/Chisinau')).toBe('2026-07-25')
    expect(dayKey('2026-07-26T01:30:00Z', 'Europe/Chisinau')).toBe('2026-07-26')
  })
  it('does day arithmetic across months', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('levels', () => {
  it('starts at level 1 and climbs', () => {
    expect(levelInfo(0).level).toBe(1)
    expect(levelInfo(xpToNext(1)).level).toBe(2)
    expect(levelInfo(xpToNext(1) - 1).level).toBe(1)
    expect(levelInfo(10_000).rank).not.toBe('Recruit')
  })
})

describe('ledger', () => {
  it('sums coins and xp, ignoring undone rows', () => {
    const a = entry({ coins: 10, xp: 20 })
    const b = entry({ coins: 5, xp: 10 })
    const u = entry({ kind: 'undo', undoOf: b.id })
    expect(balance([a, b, u])).toBe(10)
    expect(totalXp([a, b, u])).toBe(20)
    expect(byModule([a, b, u]).test).toEqual({ earned: 10, spent: 0, xp: 20 })
  })
  it('never lets a penalty push the balance below zero', () => {
    expect(clampPenalty(3, -5)).toBe(-3)
    expect(clampPenalty(0, -5)).toBe(-0)
    expect(clampPenalty(50, -5)).toBe(-5)
    expect(clampPenalty(10, 7)).toBe(7)
  })
  it('refuses spending more than the balance', () => {
    const rows = [entry({ coins: 50 })]
    expect(() => planSpend(rows, 60)).toThrow(LedgerError)
    expect(() => planSpend(rows, 50)).not.toThrow()
  })
  it('validates undo', () => {
    const earn = entry({ coins: 20 })
    const spend = entry({ kind: 'spend', coins: -15 })
    expect(() => planUndo([earn], earn.id, '  ', 't', 'd')).toThrow('reason')
    expect(() => planUndo([earn, spend], earn.id, 'mistake', 't', 'd')).toThrow('already spent')
    const u = planUndo([earn], earn.id, 'mistake', 't', 'd')
    expect(u.undoOf).toBe(earn.id)
    const undoRow = entry({ ...u })
    expect(() => planUndo([earn, undoRow], earn.id, 'again', 't', 'd')).toThrow('Already undone')
  })
})

describe('rules', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  it('awards coins and xp', () => {
    const row = planAward(rule, [], now, '2026-10-25')
    expect(row).toMatchObject({ coins: 15, xp: 30, kind: 'earn', ruleId: 'r' })
  })
  it('enforces the cooldown', () => {
    const prev = entry({ ruleId: 'r', ts: '2026-10-25T11:50:00Z' })
    expect(() => planAward(rule, [prev], now, '2026-10-25')).toThrow('Wait 10 min')
  })
  it('enforces the daily cap per local day', () => {
    const rows = [entry({ ruleId: 'r', ts: '2026-10-25T08:00:00Z' }), entry({ ruleId: 'r', ts: '2026-10-25T09:00:00Z' })]
    expect(() => planAward(rule, rows, now, '2026-10-25')).toThrow('Daily limit')
    expect(() => planAward(rule, rows, now, '2026-10-26')).not.toThrow()
  })
  it('clamps penalties and gives no xp', () => {
    const penalty: Rule = { ...rule, id: 'p', coins: -5, xp: 0 }
    const row = planAward(penalty, [entry({ coins: 2 })], now, '2026-10-25')
    expect(row).toMatchObject({ coins: -2, xp: 0, kind: 'adjust' })
  })
  it('refuses disabled rules', () => {
    expect(() => planAward({ ...rule, enabled: false }, [], now, '2026-10-25')).toThrow('turned off')
  })
})

describe('streaks', () => {
  it('keeps a streak alive until today is done', () => {
    const done = ['2026-10-22', '2026-10-23', '2026-10-24']
    expect(dayStreak(done, '2026-10-25')).toBe(3)
    expect(dayStreak([...done, '2026-10-25'], '2026-10-25')).toBe(4)
    expect(dayStreak(['2026-10-22'], '2026-10-25')).toBe(0)
    expect(bestDayStreak(['2026-10-01', '2026-10-02', '2026-10-05'])).toBe(2)
  })
  it('derives clean days from the start date', () => {
    expect(cleanStats('2026-10-15', [], '2026-10-25')).toMatchObject({ current: 10, best: 10, totalClean: 10, relapses: 0 })
  })
  it('resets only the current streak on relapse, keeping best and total', () => {
    const s = cleanStats('2026-09-01', ['2026-09-21'], '2026-10-01')
    expect(s).toMatchObject({ current: 10, best: 20, totalClean: 30, relapses: 1, since: '2026-09-21' })
    expect(cleanStats('2026-09-01', ['2026-10-01'], '2026-10-01').current).toBe(0)
  })
  it('handles no start date', () => {
    expect(cleanStats(null, [], '2026-10-25').current).toBe(0)
  })
})

describe('backup crypto', () => {
  it('round-trips and rejects a wrong passphrase', () => {
    const data = Buffer.from('ledger rows here')
    const enc = encryptBackup(data, 'correct horse')
    expect(enc.includes(data)).toBe(false)
    expect(decryptBackup(enc, 'correct horse').toString()).toBe('ledger rows here')
    expect(() => decryptBackup(enc, 'wrong')).toThrow('Wrong passphrase')
    expect(() => decryptBackup(Buffer.from('nope'), 'x')).toThrow('Not a Life System backup')
  })
})

describe('retention', () => {
  it('keeps recent snapshots and one per day for 30 days', () => {
    const now = new Date(2026, 9, 25, 12)
    const names: string[] = []
    for (let d = 0; d < 40; d++) {
      for (const h of [9, 18]) names.push(backupName(new Date(2026, 9, 25 - d, h)))
    }
    const gone = new Set(namesToPrune(names, now))
    const kept = names.filter((n) => !gone.has(n))
    expect(kept).toContain(backupName(new Date(2026, 9, 25, 18)))
    expect(kept.length).toBeGreaterThanOrEqual(30)
    expect(kept.length).toBeLessThanOrEqual(36)
    expect(gone.has(backupName(new Date(2026, 9, 25 - 39, 9)))).toBe(true)
  })
})
