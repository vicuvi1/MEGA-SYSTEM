import { describe, expect, it } from 'vitest'
import { stripTokens } from './webBots'
// @ts-expect-error plain JS API module
import { publicBots } from '../../../../api/config.mjs'

describe('bot tokens never leave the server', () => {
  it('strips every token from saved settings', () => {
    expect(stripTokens({ botToken: '1:a', megaBotToken: '2:b', chatId: '5', skipBotIds: ['3'] })).toEqual({ chatId: '5', skipBotIds: ['3'] })
  })
  it('the config endpoint masks tokens', () => {
    expect(publicBots({ megaBotToken: '2:secret', financeBotToken: '', chatId: '5' })).toEqual({ megaBotToken: 'on-server', financeBotToken: '', chatId: '5' })
  })
})

import { readFileSync } from 'node:fs'
describe('every Telegram button has a handler', () => {
  it('each callback prefix the bots send is routed by the button handler', () => {
    const src = readFileSync('src/renderer/src/web/webBots.ts', 'utf8')
    const group = src.match(/if \(!cq \|\| !\/\^\(([^)]+)\)/)?.[1] ?? ''
    const routed = new RegExp(`^(${group})$`)
    const sent = new Set<string>()
    for (const f of ['src/server/telegramBot.ts', 'src/renderer/src/web/webBots.ts', 'src/core/coachButtons.ts'])
      for (const m of readFileSync(f, 'utf8').matchAll(/callback_data: [`'"]([a-z]{2})\|/g)) sent.add(m[1])
    expect(routed.test('bd')).toBe(true)
    expect([...sent].filter((p) => !routed.test(p))).toEqual([])
  })
})
