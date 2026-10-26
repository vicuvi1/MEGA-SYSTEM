import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LedgerError } from '@core/ledger'
import { ErrorLog, isExpected } from './errors'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-log-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('error log', () => {
  it('writes entries to the file and keeps the newest first', () => {
    const log = new ErrorLog(dir)
    log.write('warn', 'ipc test', new Error('first'))
    log.write('error', 'main', 'plain text')
    expect(log.list().map((e) => e.message)).toEqual(['plain text', 'first'])
    const text = readFileSync(join(dir, 'life-system.log'), 'utf8')
    expect(text).toContain('WARN [ipc test] first')
    expect(text).toContain('ERROR [main] plain text')
  })

  it('rolls the file over when it gets big', () => {
    writeFileSync(join(dir, 'life-system.log'), 'x'.repeat(1_100_000))
    new ErrorLog(dir).write('info', 'test', new Error('after'))
    expect(existsSync(join(dir, 'life-system.log.1'))).toBe(true)
    expect(readFileSync(join(dir, 'life-system.log'), 'utf8')).toContain('after')
  })

  it('treats limits and wrong PINs as normal answers, not problems', () => {
    expect(isExpected(new LedgerError('Daily limit reached'))).toBe(true)
    expect(isExpected(new Error('Wrong PIN'))).toBe(true)
    expect(isExpected(new TypeError('x is undefined'))).toBe(false)
  })
})
