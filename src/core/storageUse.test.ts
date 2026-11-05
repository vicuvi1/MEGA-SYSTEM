import { describe, expect, it } from 'vitest'
import { STORAGE_WARN_BYTES, storageUse, storageWarning } from './storageUse'

const store = (data: Record<string, string>) => {
  const keys = Object.keys(data)
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => data[k] ?? null }
}

describe('browser storage use (LT5)', () => {
  it('counts keys and values at 2 bytes a character, biggest first', () => {
    const u = storageUse(store({ a: 'xx', bigger: 'x'.repeat(10) }))
    expect(u.bytes).toBe((1 + 2 + 6 + 10) * 2)
    expect(u.top[0].key).toBe('bigger')
  })
  it('warns only from 4 MB', () => {
    expect(storageWarning({ bytes: STORAGE_WARN_BYTES - 1, top: [] })).toBeNull()
    const w = storageWarning({ bytes: 4.5 * 1024 * 1024, top: [{ key: 'demo_app', bytes: 3 * 1024 * 1024 }] })
    expect(w).toContain('4.5 MB')
    expect(w).toContain('demo_app (3.0 MB)')
  })
})
