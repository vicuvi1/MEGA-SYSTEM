// Settings → Connections: one card per connection with a clear state
// (working / needs you / off), one line about it, and the one thing that
// fixes it. Built from System health (src/core/health.ts) and each
// connection's own status. Pure and tested.
import type { Check } from './health'

export type ConnState = 'ok' | 'needs' | 'off'

export type ConnFix =
  | { kind: 'google'; label: string }
  | { kind: 'link'; label: string; href: string }
  | { kind: 'page'; label: string; page: 'bots' | 'coach' }

export interface ConnCard {
  id: 'google' | 'todoist' | 'telegram' | 'ai' | 'sporty'
  name: string
  what: string
  state: ConnState
  line: string
  fix?: ConnFix
  /** Steps when it can't be fixed with one button (set up on a server). */
  steps?: string[]
}

export interface ConnInput {
  checks: Check[]
  /** null: still loading or unknown. */
  google: { configured?: boolean; connected?: boolean } | null
  todoist: boolean | null
}

const byId = (checks: Check[], id: string) => checks.find((c) => c.id === id)
const TODOIST_TOKEN_PAGE = 'https://app.todoist.com/app/settings/integrations/developer'

export function connectionCards(i: ConnInput): ConnCard[] {
  const out: ConnCard[] = []

  const cal = byId(i.checks, 'calendar')
  if (i.google && i.google.configured === false)
    out.push({ id: 'google', name: 'Google Calendar', what: 'Your day, blocks Ben plans, focus sessions', state: 'off', line: 'Not set up on the server yet', steps: ['In Vercel → Settings → Environment Variables add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.', 'Redeploy, then come back here and press Connect.'] })
  else if (i.google && !i.google.connected) out.push({ id: 'google', name: 'Google Calendar', what: 'Your day, blocks Ben plans, focus sessions', state: 'off', line: 'Not connected', fix: { kind: 'google', label: 'Connect Google' } })
  else if (cal && !cal.ok) out.push({ id: 'google', name: 'Google Calendar', what: 'Your day, blocks Ben plans, focus sessions', state: 'needs', line: cal.detail, fix: { kind: 'google', label: 'Reconnect Google' } })
  else if (i.google) out.push({ id: 'google', name: 'Google Calendar', what: 'Your day, blocks Ben plans, focus sessions', state: 'ok', line: cal?.detail && cal.detail !== 'Not used yet' ? cal.detail : 'Connected' })

  const td = byId(i.checks, 'todoist')
  if (i.todoist === false)
    out.push({ id: 'todoist', name: 'Todoist', what: 'Your tasks, must-dos, deadlines', state: 'off', line: 'Not connected', fix: { kind: 'link', label: 'Get your Todoist token', href: TODOIST_TOKEN_PAGE }, steps: ['Copy the API token from Todoist (the button below opens the page).', 'In Vercel → Settings → Environment Variables add TODOIST_TOKEN with it, then redeploy.'] })
  else if (td && !td.ok) out.push({ id: 'todoist', name: 'Todoist', what: 'Your tasks, must-dos, deadlines', state: 'needs', line: td.detail, fix: { kind: 'link', label: 'Get a new Todoist token', href: TODOIST_TOKEN_PAGE }, steps: ['Put the new token in TODOIST_TOKEN in Vercel, then redeploy.'] })
  else if (i.todoist) out.push({ id: 'todoist', name: 'Todoist', what: 'Your tasks, must-dos, deadlines', state: 'ok', line: td?.detail ?? 'Connected' })

  const tg = byId(i.checks, 'telegram')
  if (tg) {
    const quiet = /No messages sent yet/.test(tg.detail)
    out.push({ id: 'telegram', name: "Ben on Telegram", what: 'Messages, nudges, the morning plan', state: tg.ok ? 'ok' : 'needs', line: quiet ? 'No messages sent yet' : tg.detail, fix: tg.ok ? { kind: 'page', label: 'Bot settings', page: 'bots' } : /BotFather/.test(tg.detail) ? { kind: 'link', label: 'Open BotFather', href: 'https://t.me/BotFather' } : { kind: 'page', label: 'Check the bot', page: 'bots' } })
  }

  const ai = byId(i.checks, 'ai')
  if (ai) out.push({ id: 'ai', name: "Ben's AI", what: 'His answers, plans and reviews', state: ai.ok ? 'ok' : 'needs', line: ai.detail === 'Not used yet' ? 'Ready' : ai.detail, fix: ai.ok ? { kind: 'page', label: 'Talk to Ben', page: 'coach' } : undefined, steps: ai.ok ? undefined : ['Check OPENROUTER_API_KEY (or GEMINI_API_KEY) in Vercel: it may be wrong, revoked or out of credit.'] })

  const sp = byId(i.checks, 'sporty')
  if (sp) out.push({ id: 'sporty', name: 'Sporty', what: 'Water and workouts shared with your sport bot', state: sp.ok ? 'ok' : 'needs', line: sp.detail, steps: sp.ok ? undefined : ['Check that Sporty is running on its server (it should talk to Life System at least once a day).'] })
  else
    out.push({ id: 'sporty', name: 'Sporty', what: 'Water and workouts shared with your sport bot', state: 'off', line: 'Not connected yet', steps: ["On Sporty's server set LIFE_API_URL to this website's address and LIFE_SYNC_KEY to the same value as SPORT_SYNC_KEY in Vercel.", 'Restart Sporty. It shows up here after its first sync.'] })

  return out
}

/** One line for the section: "4 working · 1 needs you". */
export function connectionSummary(cards: ConnCard[]): string {
  const n = (s: ConnState) => cards.filter((c) => c.state === s).length
  return [n('ok') && `${n('ok')} working`, n('needs') && `${n('needs')} need${n('needs') === 1 ? 's' : ''} you`, n('off') && `${n('off')} off`].filter(Boolean).join(' · ')
}
