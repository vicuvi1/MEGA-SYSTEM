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
