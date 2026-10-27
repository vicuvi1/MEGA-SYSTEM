import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelegramNotifier } from './telegram'

let dir: string
let file: string
let notifier: TelegramNotifier

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-tg-test-'))
  file = join(dir, 'tg.bin')
  notifier = new TelegramNotifier(file)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('TelegramNotifier backend', () => {
  it('loads default config when file does not exist', () => {
    const cfg = notifier.getConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.botToken).toBe('')
    expect(cfg.chatId).toBe('')
  })

  it('saves and re-reads config', () => {
    notifier.saveConfig({
      botToken: '123456:ABC-DEF',
      chatId: '987654321',
      enabled: true
    })
    const reloaded = notifier.getConfig()
    expect(reloaded.enabled).toBe(true)
    expect(reloaded.botToken).toBe('123456:ABC-DEF')
    expect(reloaded.chatId).toBe('987654321')
  })

  it('fails gracefully when token or chatId is missing', async () => {
    const res = await notifier.sendMessage('Hello')
    expect(res.ok).toBe(false)
    expect(res.error).toContain('missing')
  })
})
