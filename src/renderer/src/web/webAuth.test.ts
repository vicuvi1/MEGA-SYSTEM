import { randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashPin, pinMatches } from './webAuth'

describe('web PIN, compatible with the desktop', () => {
  it('reads a PIN the desktop hashed (Node scrypt)', async () => {
    const salt = randomBytes(16)
    const stored = `${salt.toString('hex')}:${scryptSync('4821', salt, 32).toString('hex')}`
    expect(await pinMatches(stored, '4821')).toBe(true)
    expect(await pinMatches(stored, '2007')).toBe(false)
  })

  it('writes a hash the desktop can read', async () => {
    const stored = await hashPin('9090')
    const [salt, hash] = stored.split(':')
    expect(scryptSync('9090', Buffer.from(salt, 'hex'), 32).toString('hex')).toBe(hash)
  })

  it('2007 only opens the app when no PIN was ever set; an old plain-text PIN still works', async () => {
    expect(await pinMatches(null, '2007')).toBe(true)
    expect(await pinMatches('5555', '5555')).toBe(true)
    expect(await pinMatches('5555', '2007')).toBe(false)
  })
})
