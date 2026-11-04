import { describe, expect, it } from 'vitest'
import { connectionCards, connectionSummary } from './connections'
import type { Check } from './health'

const c = (id: string, ok: boolean, detail: string): Check => ({ id, label: id, ok, detail })

describe('connections', () => {
  it('working, needs you, off, with the fix', () => {
    const cards = connectionCards({
      checks: [c('calendar', true, 'OK, last 5 min ago'), c('telegram', false, "Ben's bot token was refused: make a new one in @BotFather (/revoke), then update TELEGRAM_BOT_TOKEN in Vercel. Since 1 h ago: Unauthorized"), c('ai', true, 'Not used yet')],
      google: { configured: true, connected: true },
      todoist: false
    })
    const by = Object.fromEntries(cards.map((x) => [x.id, x]))
    expect(by.google.state).toBe('ok')
    expect(by.telegram).toMatchObject({ state: 'needs', fix: { kind: 'link', href: 'https://t.me/BotFather' } })
    expect(by.todoist).toMatchObject({ state: 'off', fix: { kind: 'link' } })
    expect(by.ai).toMatchObject({ state: 'ok', line: 'Ready' })
    expect(by.sporty.state).toBe('off')
    expect(by.sporty.steps?.join(' ')).toContain('LIFE_SYNC_KEY')
    expect(connectionSummary(cards)).toBe('2 working · 1 needs you · 2 off')
  })

  it('Google: not set up, not connected, failing', () => {
    expect(connectionCards({ checks: [], google: { configured: false }, todoist: null })[0]).toMatchObject({ id: 'google', state: 'off', steps: expect.any(Array) })
    expect(connectionCards({ checks: [], google: { configured: true, connected: false }, todoist: null })[0].fix).toEqual({ kind: 'google', label: 'Connect Google' })
    expect(connectionCards({ checks: [c('calendar', false, 'Failing since 2 h ago: invalid_grant')], google: { configured: true, connected: true }, todoist: null })[0]).toMatchObject({ state: 'needs', fix: { label: 'Reconnect Google' } })
  })
})
