import { describe, expect, it } from 'vitest'
import { stripTokens } from './webBots'
import { CALLBACK_DATA, CALLBACKS } from './bots/callbacks'
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
    const routed = (p: string) => CALLBACK_DATA.test(`${p}|`)
    const sent = new Set<string>()
    for (const f of ['src/server/telegramBot.ts', 'src/renderer/src/web/webBots.ts', 'src/renderer/src/web/bots/callbacks.ts', 'src/renderer/src/web/bots/helpers.ts', 'src/renderer/src/web/rhythmBot.ts', 'src/renderer/src/web/financeBot.ts', 'src/core/coachButtons.ts', 'src/core/focusBot.ts'])
      for (const m of readFileSync(f, 'utf8').matchAll(/callback_data: [`'"]([a-z]{2})\|/g)) sent.add(m[1])
    expect(routed('bd')).toBe(true)
    expect([...sent].filter((p) => !routed(p))).toEqual([])
    // LT6: each one also has its own entry in the handler table (the last entry catches the rest).
    const named = new Set(CALLBACKS.flatMap((h) => h.prefixes))
    expect([...sent].filter((p) => !named.has(p))).toEqual([])
  })
})
