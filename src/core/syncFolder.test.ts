import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEBOUNCE_MS, MAX_WAIT_MS, copyMeta, copyName, createPacer, deviceFolder, isDeviceFolder, isTempName, minGapMs, parseCopyName, parseVersionId, retryDelayMs, statusLine, tempName, versionsToDelete,
  type PaceResult, type SyncFolderStatus
} from './syncFolder'

const at = (iso: string) => new Date(iso)

describe('sync folder: names', () => {
  it('names a copy by its UTC time and reads the name back', () => {
    const name = copyName(at('2026-11-18T09:05:07Z'))
    expect(name).toBe('life-sync-20261118T090507Z.zip')
    expect(parseCopyName(name)).toMatchObject({ at: Date.parse('2026-11-18T09:05:07Z'), encrypted: false })
    expect(parseCopyName(copyName(at('2026-11-18T09:05:07Z'), true))?.encrypted).toBe(true)
    expect(parseCopyName('life-system-2026-11-18.zip')).toBeNull()
    expect(parseCopyName('holiday.jpg')).toBeNull()
  })
  it('gives the file a temp name cloud-drive apps skip', () => {
    const t = tempName('life-sync-20261118T090507Z.zip')
    expect(t.startsWith('.~')).toBe(true)
    expect(t.endsWith('.tmp')).toBe(true)
    expect(isTempName(t)).toBe(true)
    expect(parseCopyName(t)).toBeNull()
    expect(isTempName('notes.tmp')).toBe(false)
  })
  it('makes a safe folder name for this PC and refuses ids that are not a version', () => {
    const d = deviceFolder('My PC (home)!', 'A1B2C3zz')
    expect(d).toBe('My-PC-home-a1b2c3')
    expect(isDeviceFolder(d)).toBe(true)
    expect(parseVersionId(`${d}/life-sync-20261118T090507Z.zip`)).toMatchObject({ device: d, encrypted: false })
    for (const bad of ['../x/life-sync-20261118T090507Z.zip', `${d}/../../secret.zip`, `${d}/a/life-sync-20261118T090507Z.zip`, 'life-sync-20261118T090507Z.zip', `${d}\\..\\x`]) expect(parseVersionId(bad)).toBeNull()
  })
})

describe('sync folder: which versions are kept', () => {
  const every = (startIso: string, stepMin: number, n: number) => Array.from({ length: n }, (_, i) => copyName(new Date(Date.parse(startIso) + i * stepMin * 60_000)))

  it('keeps one copy an hour for the newest 24 hours, and always the newest', () => {
    const names = every('2026-11-17T00:00:00Z', 10, 6 * 40) // 40 hours, 6 an hour
    const gone = new Set(versionsToDelete(names))
    const kept = names.filter((n) => !gone.has(n))
    expect(kept).toContain(names[names.length - 1])
    // The newest of each hour is the one kept.
    expect(kept).toContain(copyName(at('2026-11-18T15:50:00Z')))
    expect(kept).not.toContain(copyName(at('2026-11-18T15:40:00Z')))
    // 24 hourly; both days and the month are already among them.
    expect(kept.length).toBe(24)
  })
  it('keeps 14 daily and 12 monthly, counted by the days and months that have a copy', () => {
    // One copy a day at noon for 500 days.
    const names = every('2025-07-01T12:00:00Z', 24 * 60, 500)
    const gone = new Set(versionsToDelete(names))
    const kept = names.filter((n) => !gone.has(n)).sort()
    // 24 "hourly" (one a day here) cover the 14 daily and the 2 newest months; then 10 more months.
    expect(kept.length).toBe(24 + 10)
    expect(kept[kept.length - 1]).toBe(names[names.length - 1])
    // The oldest kept one is the newest copy of the 12th month back.
    expect(parseCopyName(kept[0])!.stamp.slice(0, 6)).toBe('202512')
  })
  it('keeps old copies of a PC that was off for a long time', () => {
    const names = [...every('2026-01-01T08:00:00Z', 60, 5), ...every('2026-11-18T08:00:00Z', 60, 3)]
    expect(versionsToDelete(names)).toEqual([])
  })
  it('never returns a file that is not a sync copy', () => {
    const names = [...every('2026-11-18T08:00:00Z', 1, 30), 'README.txt', 'life-system-2026-11-18.zip', 'photo.jpg', '.~life-sync-20261118T080000Z.zip.tmp']
    const gone = versionsToDelete(names)
    expect(gone.length).toBe(29)
    for (const g of gone) expect(parseCopyName(g)).not.toBeNull()
  })
})

describe('sync folder: manifest counts', () => {
  it('counts rows per table and lists each app with a checksum', () => {
    const m = copyMeta({ tables: { tasks: [{ id: 1 }, { id: 2 }], ledger: [{ id: 1 }], broken: 'x' }, financeState: { tx: [1, 2] }, wakyState: { nights: [] } }, 71)
    expect(m.schemaVersion).toBe(71)
    expect(m.tables).toEqual({ tasks: 2, ledger: 1 })
    expect(m.apps.map((a) => a.field)).toEqual(['financeState', 'wakyState'])
    expect(m.apps[0].sum).not.toBe(copyMeta({ tables: {}, financeState: { tx: [1, 2, 3] } }).apps[0].sum)
  })
})

describe('sync folder: when a copy is written', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-18T10:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const pacerWith = (result: () => PaceResult = () => 'ok') => {
    const runs: { why: string; at: number }[] = []
    const p = createPacer({
      run: async (why) => {
        runs.push({ why, at: Date.now() })
        return result()
      }
    })
    return { p, runs }
  }

  it('copies 15 s after the last change, and one copy covers many changes', async () => {
    const { p, runs } = pacerWith()
    p.touch()
    await vi.advanceTimersByTimeAsync(10_000)
    p.touch()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1)
    expect(runs.length).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(runs.length).toBe(1)
    expect(p.dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(runs.length).toBe(1)
  })
  it('never waits more than a minute while changes keep coming', async () => {
    const { p, runs } = pacerWith()
    const start = Date.now()
    for (let i = 0; i < 30; i++) {
      p.touch()
      await vi.advanceTimersByTimeAsync(5000)
      if (runs.length) break
    }
    expect(runs.length).toBe(1)
    expect(runs[0].at - start).toBeLessThanOrEqual(MAX_WAIT_MS)
  })
  it('writes at once on quit, sleep or lock, and does nothing when nothing changed', async () => {
    const { p, runs } = pacerWith()
    expect(await p.flush('quit')).toBe('skipped')
    p.touch()
    expect(await p.flush('lock')).toBe('ok')
    expect(runs).toEqual([{ why: 'lock', at: Date.now() }])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(runs.length).toBe(1)
  })
  it('keeps trying by itself after a failure (30 s, 1 min, 2 min, then every 5 min) and stops once it works', async () => {
    let ok = false
    const { p, runs } = pacerWith(() => (ok ? 'ok' : 'failed'))
    p.touch()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(runs.length).toBe(1)
    expect(p.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(runs.length).toBe(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(runs.length).toBe(3)
    // A change made meanwhile does not hammer the missing folder.
    p.touch()
    await vi.advanceTimersByTimeAsync(119_000)
    expect(runs.length).toBe(3)
    ok = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(runs.length).toBe(4)
    expect(p.failures).toBe(0)
    expect(p.dirty).toBe(false)
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(runs.length).toBe(4)
    expect([1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000])
  })
  it('a change made while a copy is being written gets its own copy', async () => {
    let release: (r: PaceResult) => void = () => {}
    let n = 0
    const p = createPacer({
      run: () => {
        n++
        return new Promise<PaceResult>((r) => (release = r))
      }
    })
    p.touch()
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(n).toBe(1)
    p.touch()
    release('ok')
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS)
    expect(n).toBe(2)
  })
  it('spaces big copies out', () => {
    expect(minGapMs(2 * 1024 * 1024)).toBe(DEBOUNCE_MS)
    expect(minGapMs(20 * 1024 * 1024)).toBe(60_000)
    expect(minGapMs(100 * 1024 * 1024)).toBe(5 * 60_000)
  })
})

describe('sync folder: the status line', () => {
  const base: SyncFolderStatus = { enabled: true, folder: 'E:\\', device: 'PC-a1b2c3', lastWrite: '2026-11-18T09:58:00Z', lastVerifiedOk: true, versions: 5, sizeBytes: 5 * 1024 * 1024, lastSizeBytes: 1024 * 1024, error: null, missing: false, encrypt: false, passphraseSaved: false, others: [] }
  const now = Date.parse('2026-11-18T10:00:00Z')
  it('is off until a folder is chosen', () => {
    expect(statusLine({ ...base, enabled: false, folder: null }, now).light).toBe('off')
  })
  it('is green after a checked copy', () => {
    const l = statusLine(base, now)
    expect(l.light).toBe('green')
    expect(l.text).toContain('2 min ago')
    expect(l.text).toContain('5 versions')
    expect(statusLine({ ...base, versions: 1 }, now).text).toContain('1 version ·')
  })
  it('says clearly when the folder is missing: amber for a day, then red', () => {
    expect(statusLine({ ...base, missing: true }, now)).toMatchObject({ light: 'amber' })
    expect(statusLine({ ...base, missing: true }, now).text).toMatch(/Folder not found/)
    expect(statusLine({ ...base, missing: true, lastWrite: '2026-11-16T09:00:00Z' }, now).light).toBe('red')
  })
  it('is red when a copy failed its check or could not be written', () => {
    expect(statusLine({ ...base, lastVerifiedOk: false }, now).light).toBe('red')
    expect(statusLine({ ...base, error: 'The disk is full.' }, now)).toMatchObject({ light: 'red' })
  })
})
