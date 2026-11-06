// Ben checks in on your measurable goals (server tick). Once per goal and
// check-in period, between 10:00 and 21:00, at most GOAL_ASKS_PER_DAY a day
// (and inside his overall daily cap and quiet hours, which `send` keeps):
// a manual goal gets the question with quick answers; a goal that counts
// itself gets a short report when its number moved. Behind? One concrete
// move with a button (you still tap). Auto numbers are saved once a day.
import { behindMove, cleanAsks, markPing, pickPing, quickAnswers, seedSeen, askText, reportText, type AskState, type GoalPing } from '@core/goalsBen'
import type { Mirror } from '../renderer/src/web/mirror'
import { getSetting, setSetting } from '../main/settings'

export const GOAL_ASKS = 'goal_asks'

const bytes = (s: string) => new TextEncoder().encode(s).length
const fit = (prefix: string, s: string) => {
  let t = s
  while (bytes(prefix + t) > 64 && t) t = t.slice(0, -1)
  return prefix + t
}

/** The Telegram keyboard under a goal ping: quick answers (manual goals), and the move when behind. */
export function goalKeyboard(p: GoalPing): { inline_keyboard: { text: string; callback_data: string }[][] } | undefined {
  const rows: { text: string; callback_data: string }[][] = []
  if (p.kind === 'ask') {
    const q = quickAnswers(p.card).map((a) => ({ text: a.label, callback_data: `gc|${p.card.goal.id}|${a.op}` }))
    rows.push([q[0], q[1], q[2]], [q[3]])
  }
  const move = behindMove(p.card)
  if (move) {
    const f = /^focus:(\d+):(.+)$/.exec(move.do)
    if (f) rows.push([{ text: `▶ ${f[1]} min: ${f[2]}`.slice(0, 40), callback_data: fit(`fo|${f[1]}|`, f[2]) }])
    else if (move.do === 'workout') rows.push([{ text: '💪 Log a workout', callback_data: 'wk|show' }])
  }
  return rows.length ? { inline_keyboard: rows } : undefined
}

/** The message for a ping (HTML-escaped by `esc`). */
export function goalPingText(p: GoalPing, esc: (s: string) => string): string {
  const main = p.kind === 'ask' ? askText(p.card) : reportText(p.card, p.before)
  const move = behindMove(p.card)
  return esc(move ? `${main}\n👉 ${move.text}` : main)
}

export async function goalsTick(mirror: Mirror, services: any, now: Date, send: (text: string, markup?: unknown) => Promise<unknown>, esc: (s: string) => string): Promise<string | null> {
  const hourKey = `${now.toISOString().slice(0, 13)}`
  // One read to decide; a write only when something changes.
  const plan = await mirror.read((db) => {
    const s = services.services(db)
    const today = s.wallet.today(now)
    let raw: any = null
    try {
      raw = JSON.parse(getSetting(db as any, GOAL_ASKS) || 'null')
    } catch {
      raw = null
    }
    const cards = s.goals.cards(now)
    if (!cards.length) return null
    const st0 = cleanAsks(raw, today)
    const st = seedSeen(st0, cards)
    return { st, seeded: st !== st0, ping: pickPing(cards, st, now.getHours()), sync: raw?.synced !== hourKey && cards.some((c: any) => c.auto) }
  })
  if (!plan) return null
  const save = (st: AskState) => mirror.write((db) => setSetting(db as any, GOAL_ASKS, JSON.stringify({ ...st, synced: hourKey })))
  // Auto goals: their number for today's history, once an hour at most.
  if (plan.sync) await mirror.write((db) => services.services(db).goals.syncAuto(now)).catch(() => null)
  if (!plan.ping) {
    if (plan.seeded || plan.sync) await save(plan.st).catch(() => null)
    return null
  }
  const p = plan.ping
  // Asked once per period, even when quiet hours or the day's budget put it in the bell instead.
  await save(markPing(plan.st, p))
  try {
    await send(goalPingText(p, esc), goalKeyboard(p))
  } catch {
    /* Telegram hiccup: the bell has it, he'll see it on the Goals page */
  }
  return `${p.kind}:${p.card.goal.id}`
}
