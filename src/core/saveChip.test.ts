import { describe, expect, it } from 'vitest'
import { backupRetryMs, saveChip } from './saveChip'

describe('the top-bar cloud chip is honest', () => {
  it('never says "Backed up" while offline or while changes wait', () => {
    expect(saveChip({ online: false, waiting: 0, backupError: null }).text).toBe('Offline')
    expect(saveChip({ online: false, waiting: 3, backupError: null })).toMatchObject({ tone: 'warn', text: '3 waiting' })
    expect(saveChip({ online: true, waiting: 1, backupError: null }).title).toContain('1 change saved on this device')
    for (const online of [true, false]) for (const waiting of [1, 7]) expect(saveChip({ online, waiting, backupError: null }).text).not.toMatch(/Backed up/)
  })
  it('online with nothing waiting: the backup state', () => {
    expect(saveChip({ online: true, waiting: 0, backupError: "Today's cloud backup failed: HTTP 503" })).toMatchObject({ tone: 'warn', text: 'Backup missed' })
    expect(saveChip({ online: true, waiting: 0, backupError: null, backupAt: '2026-11-13' })).toMatchObject({ tone: 'ok', text: 'Backed up' })
  })
  it('the backup is tried again after 30 s, then less often, at most every 30 min', () => {
    expect([0, 1, 2, 3, 6, 50].map(backupRetryMs)).toEqual([30_000, 60_000, 120_000, 240_000, 1_800_000, 1_800_000])
  })
})
