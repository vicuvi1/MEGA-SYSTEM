import { describe, expect, it } from 'vitest'
import { anyRed, safetyRows, type SafetyInput } from './dataSafety'
import { crc32, listZip, makeZip, readZipEntry, utf8 } from './zip'

const now = new Date('2026-11-12T15:00:00Z')
const ok: SafetyInput = {
  now,
  today: '2026-11-12',
  cloud: { lastDay: '2026-11-12', bytes: 900_000, biggest: 900_000 },
  local: { available: true, lastAt: '2026-11-12T09:00:00Z', bytes: 4_000_000 },
  offsite: { okAt: '2026-11-10T02:45:00Z', day: '2026-11-09' },
  drill: { cloud: { at: '2026-11-09T03:00:00Z', ok: true, msg: '40 tables' }, local: { at: '2026-11-12T09:01:00Z', ok: true, msg: 'zip ok' } }
}
const light = (i: SafetyInput, id: string) => safetyRows(i).find((r) => r.id === id)!

describe('Data safety lights', () => {
  it('all green when every copy is fresh', () => {
    expect(safetyRows(ok).map((r) => r.light)).toEqual(['green', 'green', 'green', 'green'])
    expect(anyRed(safetyRows(ok))).toBe(false)
    expect(light(ok, 'cloud').text).toMatch(/900 KB/)
  })

  it('a failed or missing backup is red, never silent', () => {
    expect(light({ ...ok, cloud: { lastDay: '2026-11-10', error: 'HTTP 503' } }, 'cloud')).toMatchObject({ light: 'red', text: 'HTTP 503' })
    expect(light({ ...ok, cloud: { lastDay: '2026-11-09' } }, 'cloud').light).toBe('red')
    expect(light({ ...ok, cloud: { lastDay: '2026-11-11' } }, 'cloud').light).toBe('amber')
    expect(light({ ...ok, local: { available: true, lastAt: '2026-11-12T09:00:00Z', error: 'disk full' } }, 'local')).toMatchObject({ light: 'red', text: 'Failed: disk full' })
    expect(light({ ...ok, local: { available: true, lastAt: '2026-11-08T09:00:00Z' } }, 'local').light).toBe('red')
    expect(light({ ...ok, local: { available: true, lastAt: null } }, 'local').light).toBe('red')
    expect(light({ ...ok, offsite: { okAt: '2026-11-03T02:45:00Z', errAt: '2026-11-10T02:45:00Z', err: 'BACKUP_PASSPHRASE missing' } }, 'offsite').light).toBe('red')
    expect(light({ ...ok, offsite: { okAt: '2026-10-20T02:45:00Z' } }, 'offsite').light).toBe('red')
    expect(light({ ...ok, drill: { cloud: { at: '2026-11-09T03:00:00Z', ok: false, msg: 'tasks: 3/4 rows' }, local: ok.drill.local } }, 'drill').light).toBe('red')
    expect(anyRed(safetyRows({ ...ok, cloud: { lastDay: null } }))).toBe(true)
  })

  it('amber, not red, when it simply has not happened yet', () => {
    expect(light({ ...ok, offsite: { okAt: null } }, 'offsite').light).toBe('amber')
    expect(light({ ...ok, drill: {} }, 'drill').light).toBe('amber')
    expect(light({ ...ok, local: { available: false, lastAt: null } }, 'local').light).toBe('amber')
    // A piece at 2.5 MB is a warning even though it was saved.
    expect(light({ ...ok, cloud: { lastDay: '2026-11-12', bytes: 6e6, biggest: 2_600_000 } }, 'cloud').light).toBe('amber')
  })
})

describe('zip files', () => {
  it('what makeZip writes, listZip reads back (stored and packed), with the standard CRC', async () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926)
    const files = [
      { name: 'a.txt', data: utf8('hello') },
      { name: 'tables/b.csv', data: utf8('x,y\r\n1,2\r\n'.repeat(50)) }
    ]
    // A fake "packer" that only reverses the bytes, to prove the packed path is used and read back.
    const rev = (u8: Uint8Array) => u8.slice().reverse().subarray(0, u8.length - 1)
    const zip = makeZip(files, (u8) => (u8.length > 100 ? rev(u8) : u8))
    const items = listZip(zip)
    expect(items.map((i) => [i.name, i.method])).toEqual([
      ['a.txt', 0],
      ['tables/b.csv', 8]
    ])
    expect(new TextDecoder().decode(await readZipEntry(items[0]))).toBe('hello')
    await expect(readZipEntry(items[1])).rejects.toThrow(/unpacking/)
  })
})
