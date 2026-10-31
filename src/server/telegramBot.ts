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
import { createTodoistApi } from './todoistApi'
import { eveningText, morningText, planKeyboard, weekText } from '@core/focusBot'

export { createTodoistApi }

export interface BotEnv {
  tursoUrl: string
  tursoToken: string
  defaults: Partial<BotBridgeConfig>
  timeZone?: string
  /** Your Todoist API token (TODOIST_TOKEN): /todo, /task, /done use it. */
  todoistToken?: string
}

let warm: { key: string; bots: ReturnType<typeof createWebBots>; mirror: Mirror; services: ReturnType<typeof createWebServices> } | null = null

async function botsFor(env: BotEnv) {
  const key = env.tursoUrl + '|' + env.tursoToken.slice(-12) + '|' + (env.todoistToken ?? '').slice(-6)
  if (warm && warm.key === key) {
    await warm.mirror.refresh() // what the devices changed since the last message
    return warm
  }
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  const mirror = new Mirror(SQL, new TursoHttp(env.tursoUrl, env.tursoToken), null)
  await mirror.ready
  const services = createWebServices(mirror)
  const defaults = { enabled: true, pollingEnabled: true, morningBriefing: true, eveningNudge: true, ...env.defaults } as BotBridgeConfig
  const todoist = env.todoistToken ? createTodoistApi(env.todoistToken) : null
  const bots = createWebBots({ mirror, services, defaults, server: true, todoist })
  warm = { key, bots, mirror, services }
  return warm
}

/** Handles one Telegram update for the bot with this token; returns the reply sent. */
export async function handleTelegramUpdate(env: BotEnv, token: string, update: unknown): Promise<string | null> {
  // Days, wake-up times and streaks follow your time zone, not the server's.
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { bots } = await botsFor(env)
  return bots.handleUpdate(token, update)
}

/**
 * The daily messages (Vercel runs them on a schedule, api/cron.mjs):
 * morning: the plan question (reply to it with your must-dos);
 * evening: the review with tap-buttons, and on Sundays the weekly report.
 */
export async function runDaily(env: BotEnv & { botToken: string; chatId: string }, job: 'morning' | 'evening'): Promise<string[]> {
  process.env.TZ = env.timeZone || 'Europe/Chisinau'
  const { services } = await botsFor(env)
  const send = async (text: string, reply_markup?: unknown) => {
    const res = await fetch(`https://api.telegram.org/bot${env.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.chatId, text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) })
    })
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    if (!j.ok) throw new Error(`Telegram: ${j.description ?? res.status}`)
  }
  const st = await services.focus.state()
  const sent: string[] = []
  if (job === 'morning') {
    let todoistToday: number | null = null
    if (env.todoistToken) todoistToday = await createTodoistApi(env.todoistToken).today().then((t) => t.length).catch(() => null)
    const planAlready = st.plan.items.length > 0
    await send(
      morningText({ focusYesterdayMin: st.week.byDay[5]?.minutes ?? 0, goalsBehind: st.goals.filter((g) => g.aheadH < 0), todoistToday, planAlready }),
      planAlready ? undefined : { force_reply: true, input_field_placeholder: 'Essay intro; gym; call Leo' }
    )
    sent.push('morning')
  } else {
    await send(eveningText(st.plan, st.todayMin), st.plan.items.length ? planKeyboard(st.plan, true) : undefined)
    sent.push('evening')
    if (new Date().getDay() === 0) {
      await send(weekText(st.week, st.goals))
      sent.push('weekly')
    }
  }
  return sent
}
