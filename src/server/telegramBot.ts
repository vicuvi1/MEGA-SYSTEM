// The Telegram bots, run by the web server (api/telegram.mjs) so they answer
// 24/7, even with no device open. Telegram sends each message here; it is
// handled exactly like the app does (same services, same Turso transaction
// with its "seen" mark), on a copy of the Turso database kept warm between
// messages. Bundled into api/_bot/bot.mjs by `npm run build:bot`.
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import type { BotBridgeConfig } from '@shared/api'
import { Mirror } from '../renderer/src/web/mirror'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { createWebServices } from '../renderer/src/web/webServices'
import { createWebBots } from '../renderer/src/web/webBots'

export interface BotEnv {
  tursoUrl: string
  tursoToken: string
  defaults: Partial<BotBridgeConfig>
  timeZone?: string
}

let warm: { key: string; bots: ReturnType<typeof createWebBots>; mirror: Mirror } | null = null

async function botsFor(env: BotEnv) {
  const key = env.tursoUrl + '|' + env.tursoToken.slice(-12)
  if (warm && warm.key === key) {
    await warm.mirror.refresh() // what the devices changed since the last message
    return warm.bots
  }
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  const mirror = new Mirror(SQL, new TursoHttp(env.tursoUrl, env.tursoToken), null)
  await mirror.ready
  const services = createWebServices(mirror)
  const defaults = { enabled: true, pollingEnabled: true, morningBriefing: true, eveningNudge: true, ...env.defaults } as BotBridgeConfig
  const bots = createWebBots({ mirror, services, defaults, server: true })
  warm = { key, bots, mirror }
  return bots
}

/** Handles one Telegram update for the bot with this token; returns the reply sent. */
export async function handleTelegramUpdate(env: BotEnv, token: string, update: unknown): Promise<string | null> {
  // Days, wake-up times and streaks follow your time zone, not the server's.
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const bots = await botsFor(env)
  return bots.handleUpdate(token, update)
}
