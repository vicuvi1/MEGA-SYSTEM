// The coach's brain: a message that isn't a simple log or a command goes to
// Gemini with your real data (today, the week, sleep, money, Todoist), what
// the coach remembers about you and the last messages. It answers as a coach
// and can act: log things, add must-dos, start focus, add Todoist tasks, set
// goals. Each bot is a specialist (Mega: head + training, Finance: money,
// Waky: sleep). Pure helpers here; webBots.ts runs it.
import type { BotBridgeConfig } from '@shared/api'
import { addDays } from '@core/dates'
import { hm } from '@core/focus'
import { progressReport } from '@core/progress'
import { activePlan } from '@core/weekPlan'
import { deadlineRadar, whenText, type TodoTask } from '@core/todoist'
import { financeSpending } from '@core/progress'
import { getSetting, setSetting } from '../../../main/settings'
import type { Services } from './webServices'

export type Persona = 'mega' | 'finance' | 'waky' | 'sport'

export interface Memory {
  /** Things worth remembering ("exam on 7 Nov", "wants to wake at 7"). */
  facts: { t: string; at: string }[]
  /** The last messages, all bots together (one coach team). */
  chat: { role: 'me' | 'coach'; bot: Persona; text: string; at: string }[]
}

const MEMORY = 'coach_memory'
const MAX_FACTS = 40
const MAX_CHAT = 24

export function loadMemory(db: any): Memory {
  try {
    const m = JSON.parse(getSetting(db, MEMORY) || 'null')
    return { facts: Array.isArray(m?.facts) ? m.facts : [], chat: Array.isArray(m?.chat) ? m.chat : [] }
  } catch {
    return { facts: [], chat: [] }
  }
}

export function saveMemory(db: any, m: Memory): void {
  setSetting(db, MEMORY, JSON.stringify({ facts: m.facts.slice(-MAX_FACTS), chat: m.chat.slice(-MAX_CHAT) }))
}

/** Adds facts (no near-duplicates) and conversation turns, keeping the newest. */
export function updateMemory(m: Memory, add: { facts?: string[]; turns?: Memory['chat'] }, now = new Date()): Memory {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const facts = m.facts.slice()
  for (const f of add.facts ?? []) {
    const t = String(f).trim().slice(0, 200)
    if (!t) continue
    const n = norm(t)
    const i = facts.findIndex((x) => norm(x.t) === n || norm(x.t).includes(n) || n.includes(norm(x.t)))
    if (i >= 0) facts.splice(i, 1)
    facts.push({ t, at: now.toISOString().slice(0, 10) })
  }
  return { facts: facts.slice(-MAX_FACTS), chat: [...m.chat, ...(add.turns ?? [])].slice(-MAX_CHAT) }
}

/** Which coach a bot is, from its token's id. */
export function personaFor(botId: string, cfg: BotBridgeConfig): Persona {
  const id = (t?: string) => (t && t.includes(':') ? t.split(':')[0] : '')
  if (botId === id(cfg.financeBotToken)) return 'finance'
  if (botId === id(cfg.manBotToken) || botId === id(cfg.wakyBotToken)) return 'waky'
  if (botId === id(cfg.sportBotToken) || botId === id(cfg.botToken)) return 'sport'
  return 'mega'
}

/**
 * Short, clear logs keep the fast path ("taxi 45", "30 pushups", "coffee 35
 * maib"): one number, a few words. Anything longer is for the brain.
 */
export function isSimpleLog(text: string): boolean {
  const t = text.trim()
  if (t.startsWith('/')) return true
  const nums = t.match(/\d+(?:[.,]\d+)?/g) ?? []
  const words = t.split(/\s+/).filter(Boolean)
  return nums.length >= 1 && nums.length <= 2 && words.length <= 5 && !/[?]/.test(t) && !/\b(and|și|si|и|then|also|plus)\b/i.test(t)
}

/** Finance Helper's saved state on this device, else the copy synced to Turso. */
export function financeStateFrom(db: any, store: Storage | null): any {
  try {
    const local = store?.getItem('finance-helper.state')
    if (local) return JSON.parse(local)
  } catch {
    /* try the cloud copy */
  }
  try {
    const synced = JSON.parse(getSetting(db, 'app_sync_finance') || 'null')
    if (synced?.data) return synced.data
  } catch {
    /* older copy */
  }
  try {
    return JSON.parse(getSetting(db, 'finance_backup_json') || 'null')
  } catch {
    return null
  }
}

const lei = (bani: number) => `${Math.round(bani / 100).toLocaleString('en-US')} lei`

/** The money picture: this month, this week, today, by category, against the limit. */
export function moneyContext(state: any, today: string): string {
  if (!state || !Array.isArray(state.tx)) return 'Money: Finance Helper data not available.'
  const cats = new Map<string, string>((state.settings?.categories ?? []).map((c: any) => [String(c.id), String(c.name)]))
  const exp = (state.tx as any[]).filter((t) => t && t.type === 'expense' && !t.deleted && typeof t.date === 'string')
  const amt = (t: any) => Math.abs(Number(t.base ?? t.amount) || 0)
  const month = today.slice(0, 7)
  const weekFrom = addDays(today, -6)
  const inMonth = exp.filter((t) => t.date.startsWith(month))
  const byCat = new Map<string, number>()
  for (const t of inMonth) byCat.set(cats.get(String(t.category)) ?? String(t.category ?? 'Other'), (byCat.get(cats.get(String(t.category)) ?? String(t.category ?? 'Other')) ?? 0) + amt(t))
  const top = [...byCat].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `${c} ${lei(v)}`)
  const monthTotal = inMonth.reduce((s, t) => s + amt(t), 0)
  const weekTotal = exp.filter((t) => t.date >= weekFrom && t.date <= today).reduce((s, t) => s + amt(t), 0)
  const todayTotal = exp.filter((t) => t.date === today).reduce((s, t) => s + amt(t), 0)
  const last = exp
    .filter((t) => t.date >= weekFrom)
    .slice(-6)
    .map((t) => `${t.date.slice(5)} ${cats.get(String(t.category)) ?? t.category ?? ''} ${t.note ? `"${String(t.note).slice(0, 30)}" ` : ''}${lei(amt(t))}`)
  const limit = state.settings?.limit
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  const daysLeft = daysInMonth - Number(today.slice(8)) + 1
  const limitLine =
    limit?.on && Number(limit.amount) > 0
      ? `Monthly limit ${lei(Number(limit.amount))}: ${Math.round((monthTotal / Number(limit.amount)) * 100)}% used, ${lei(Math.max(0, Number(limit.amount) - monthTotal))} left for ${daysLeft} days (${lei(Math.max(0, Number(limit.amount) - monthTotal) / daysLeft)}/day).`
      : 'No monthly limit set.'
  return [
    `Money (MDL): today ${lei(todayTotal)}, last 7 days ${lei(weekTotal)}, this month ${lei(monthTotal)}.`,
    limitLine,
    top.length ? `This month by category: ${top.join(', ')}.` : '',
    last.length ? `Recent expenses: ${last.join('; ')}.` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Everything the coach should know about you right now, in plain lines. */
export function lifeContext(s: Services, db: any, extra: { finance: any; todoToday: TodoTask[] | null; upcoming: TodoTask[] | null }, now = new Date()): string {
  const today = s.wallet.today(now)
  const sum = s.wallet.summary()
  const f = s.focus.state(now)
  const disc = s.discipline.state(now)
  const body = s.body.state(now)
  const sl = s.sleep
  const input = s.progress.input(financeSpending(extra.finance), now)
  const report = progressReport(input)
  const wp = activePlan(s.weekPlan.saved(), today)
  const wakes = input.wakes.filter((w) => w.day > addDays(today, -7)).sort((a, b) => (a.day < b.day ? -1 : 1))
  const lines = [
    `Now: ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${now.toTimeString().slice(0, 5)}.`,
    `Coins: ${sum.balance} (today +${sum.todayCoins}). Level ${sum.level.level}.`,
    `Focus today: ${hm(f.todayMin)}${f.running ? `, RUNNING now on "${f.running.subject}" (${f.running.planned} min planned)` : ''}. Last 7 days ${hm(f.week.totalMin)}. Subjects: ${f.subjects.slice(0, 5).join(', ') || 'none yet'}.`,
    `Today's must-dos: ${f.plan.items.length ? f.plan.items.map((x) => `${x.done ? '[done]' : '[open]'} ${x.text}`).join('; ') : 'none written yet'}.`,
    f.goals.length ? `Goals with deadlines: ${f.goals.map((g) => `${g.title} (${g.subject}) due ${g.deadline}, ${g.aheadH >= 0 ? `${g.aheadH}h ahead` : `${-g.aheadH}h behind`}`).join('; ')}.` : 'No goals with deadlines.',
    `Week score ${report.score}/100 (last week ${report.prevScore}). ${report.verdict}`,
    `Last 7 days: ${report.metrics.map((m) => `${m.label} ${m.text}${m.target ? ` of ${m.targetText}` : ''} (${m.trend})`).join('; ')}.`,
    wp ? `This week's chosen focus: ${wp.focus}${wp.note ? ` ("${wp.note}")` : ''}. Big 3: ${wp.big3.map((b) => `${b.done ? '[done]' : '[open]'} ${b.text}`).join('; ')}.` : 'No week plan yet.',
    `Sleep: bedtime target ${sl.bedtimeTarget()}, wake target weekday ${sl.weekdayTarget()} / weekend ${sl.weekendTarget()}. Last wake-ups: ${wakes.map((w) => `${w.day.slice(5)} ${w.onTime ? 'on time' : 'late'}`).join(', ') || 'none logged'}.`,
    wakePattern(input.wakes) ?? '',
    `Discipline: clean streak ${disc.current} days (best ${disc.best}).`,
    `Training: workout streak ${body.streak}, ${body.workoutsThisWeek} workouts this week, total ${body.totalWorkouts}${body.latestWeight ? `, weight ${body.latestWeight} kg` : ''}. Recent: ${s.body.workouts(6).map((w) => `${w.day.slice(5)} ${w.title}`).join('; ') || 'none'}.`,
    moneyContext(extra.finance, today)
  ]
  if (extra.todoToday) {
    const list = extra.todoToday.slice(0, 8).map((t) => `${t.content}${t.due && t.due < today ? ' (late)' : ''}${t.priority >= 3 ? ` P${5 - t.priority}` : ''}${t.section ? ` [${t.section}]` : ''}`)
    lines.push(`Todoist today/late (${extra.todoToday.length}): ${list.join('; ') || 'nothing'}.`)
  }
  if (extra.upcoming) {
    const r = deadlineRadar(extra.upcoming, today)
    if (r.length) lines.push(`Deadlines soon: ${r.map((x) => `${x.task.content} ${whenText(x.daysLeft, x.date)}`).join('; ')}.`)
  }
  return lines.filter(Boolean).join('\n')
}

const PERSONA: Record<Persona, string> = {
  mega: 'You are MEGA, Victor\'s head coach for his whole life: study (university), cyber security skills, career, sport and training, sleep, discipline and money. You also coach his training: suggest concrete workouts (sets and reps, progressing a little each week), keep his streak alive.',
  finance: 'You are the MONEY COACH (Finance bot). Help Victor spend with intention and save: react to spending with context (how often, how much this week/month, against his limit), spot patterns, suggest one concrete change. Logging money is your main job; coaching on money is what makes you useful.',
  waky: 'You are WAKY, the SLEEP COACH. Help Victor wake up on time and sleep well: bedtime routine, consistency, sleep debt, patterns (which days go wrong and why). Be concrete about times.',
  sport: 'You are the TRAINING COACH. Plan concrete workouts and progressions, keep the streak alive.'
}

const ACTIONS = `You can act. Put actions in "actions" (strings), only when Victor asked for it or clearly reported doing it:
- "log: <text>" to record something with the app's own parser, one item per action. Money: "<what> <amount>" with the amount LAST (shop names go before it), a wallet name may follow the amount: "pizza 120", "groceries Linella 163", "taxi 30 maib", "+500 salary". Workouts: "30 pushups", "run 5 km". Sleep: "/wake 06:40", "/bed". Discipline: "/checkin", "/oath". Body: "/weight 74.5".
- "mustdo: <text>" to add a must-do for today.
- "focus: <minutes> <subject>" to start a focus timer now.
- "fun: <minutes> <what>" to spend coins on guilt-free fun.
- "task: <text>" to add a task to Todoist (Todoist reads dates like "friday 18:00", "p1", "#University").
- "goal: <title> | <subject> | <YYYY-MM-DD> | <hours>" for an exam or project with a deadline and the hours it needs.
Never invent amounts or times he didn't give. Never log the same thing twice.
IMPORTANT: something is saved ONLY if you put an action for it. If he reports spending, a workout, a wake-up, etc., include the action. Never write "logged"/"added"/"saved" in your reply: the app adds a ✅ line under your reply for each thing it really saved. The conversation history shows ✅ lines for what was saved before; if there is none, it was NOT saved.`

/** The full prompt for one message. */
export function brainPrompt(persona: Persona, context: string, memory: Memory, message: string, media?: 'voice' | 'photo'): string {
  const chat = memory.chat.slice(-10).map((c) => `${c.role === 'me' ? 'Victor' : `Coach (${c.bot})`}: ${c.text.replace(/<[^>]+>/g, '').slice(0, 300)}`)
  return [
    PERSONA[persona],
    'Style: a real coach, not a recorder. Warm, direct, honest; short (2–5 sentences, Telegram). Use his real numbers. End with ONE concrete next step when it helps (with a time or a duration). Ask a question back when you need to know more. Plain text, no markdown, at most 2 emojis. Reply in the language Victor writes in (English, Romanian or Russian); with no text from him, in English.',
    '',
    ACTIONS,
    '',
    'Also put in "remember" any NEW lasting fact worth keeping about Victor (goals, exams and dates, preferences, problems, promises), short, with dates. Not things already in memory, not one-off logs.',
    '',
    'Answer ONLY with JSON: {"reply": string, "actions": string[], "remember": string[]}.',
    '',
    '== Victor right now ==',
    context,
    '',
    '== What you remember about him ==',
    memory.facts.length ? memory.facts.map((f) => `- ${f.t} (noted ${f.at})`).join('\n') : '- nothing yet',
    '',
    '== Recent conversation ==',
    chat.length ? chat.join('\n') : '(none)',
    '',
    media === 'voice' ? 'Victor sent a VOICE message (attached). First understand what he said; treat it like his text message.' : '',
    media === 'photo' ? 'Victor sent a PHOTO (attached). If it is a receipt or a bill: you MUST add one action "log: <kind> <shop> <total>" with the TOTAL as a plain number LAST (e.g. "log: groceries Linella 245"), then comment briefly as his money coach. Otherwise react as a coach.' : '',
    `Victor's message: ${message || (media ? '(see attachment)' : '')}`
  ]
    .filter((l) => l !== '')
    .join('\n')
}

export interface BrainOut {
  reply: string
  actions: string[]
  remember: string[]
}

/** Reads the model's JSON (tolerating code fences or text around it). */
export function parseBrain(text: string): BrainOut {
  const raw = String(text ?? '').trim()
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  try {
    const j = JSON.parse(json ?? raw)
    return {
      reply: String(j.reply ?? '').trim(),
      actions: (Array.isArray(j.actions) ? j.actions : []).map(String).slice(0, 8),
      remember: (Array.isArray(j.remember) ? j.remember : []).map(String).slice(0, 5)
    }
  } catch {
    return { reply: raw.replace(/^```\w*|```$/g, '').trim(), actions: [], remember: [] }
  }
}

/** Only these slash commands may come from the brain (nothing that resets or deletes). */
const SAFE_SLASH = /^\/(wake|bed|checkin|oath|weight|waist|pushups|situps|squats|plank|run|stop)\b/i

export type BrainAction =
  | { kind: 'log'; text: string }
  | { kind: 'mustdo'; text: string }
  | { kind: 'focus'; minutes: number; subject: string }
  | { kind: 'fun'; minutes: number; what: string }
  | { kind: 'task'; text: string }
  | { kind: 'goal'; title: string; subject: string; deadline: string; hours: number }

/** Turns an action line into something safe to run, or null. */
export function readAction(line: string): BrainAction | null {
  const m = /^\s*(log|mustdo|focus|fun|task|goal)\s*:\s*([\s\S]+)$/i.exec(line)
  if (!m) return null
  const kind = m[1].toLowerCase()
  const arg = m[2].trim().slice(0, 200)
  if (!arg) return null
  if (kind === 'log') return arg.startsWith('/') && !SAFE_SLASH.test(arg) ? null : { kind: 'log', text: arg }
  if (kind === 'mustdo') return { kind: 'mustdo', text: arg.slice(0, 140) }
  if (kind === 'task') return { kind: 'task', text: arg }
  if (kind === 'focus' || kind === 'fun') {
    const minutes = Number(/\d{1,3}/.exec(arg)?.[0] ?? (kind === 'focus' ? 50 : 0))
    const rest = arg.replace(/\d{1,3}\s*(minutes|min|m)?\b/i, '').trim()
    if (!(minutes >= 5 && minutes <= 180) && kind === 'focus') return null
    if (!(minutes >= 1 && minutes <= 240) && kind === 'fun') return null
    return kind === 'focus' ? { kind, minutes, subject: rest || 'Focus' } : { kind, minutes, what: rest || 'Fun' }
  }
  const [title, subject, deadline, hours] = arg.split('|').map((x) => x.trim())
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(deadline ?? '') || !(Number(hours) > 0)) return null
  return { kind: 'goal', title, subject: subject || title, deadline, hours: Math.min(500, Number(hours)) }
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

/**
 * The money coach's line under an expense: how often this week, the month
 * against the limit and what's left per day. Null when there's nothing useful.
 */
export function moneyInsight(state: any, tx: { category?: string | null; amount: number; type?: string }, today: string): string | null {
  if (!state || !Array.isArray(state.tx) || tx.type === 'income') return null
  const cats = new Map<string, string>((state.settings?.categories ?? []).map((c: any) => [String(c.id), String(c.name)]))
  const amt = (t: any) => Math.abs(Number(t.base ?? t.amount) || 0)
  const exp = (state.tx as any[]).filter((t) => t && t.type === 'expense' && !t.deleted && typeof t.date === 'string')
  const weekFrom = addDays(today, -6)
  const same = exp.filter((t) => t.date >= weekFrom && t.date <= today && String(t.category) === String(tx.category))
  const name = cats.get(String(tx.category)) ?? 'this'
  const parts: string[] = []
  if (same.length >= 2) parts.push(`${ordinal(same.length)} ${name} this week (${lei(same.reduce((s, t) => s + amt(t), 0))})`)
  const month = today.slice(0, 7)
  const monthTotal = exp.filter((t) => t.date.startsWith(month)).reduce((s, t) => s + amt(t), 0)
  const limit = state.settings?.limit
  if (limit?.on && Number(limit.amount) > 0) {
    const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
    const daysLeft = daysInMonth - Number(today.slice(8)) + 1
    const left = Math.max(0, Number(limit.amount) - monthTotal)
    const pct = Math.round((monthTotal / Number(limit.amount)) * 100)
    parts.push(pct >= 100 ? `over the monthly limit by ${lei(monthTotal - Number(limit.amount))}` : `${pct}% of the monthly limit, ${lei(left / daysLeft)}/day left for ${daysLeft} days`)
  } else parts.push(`this month ${lei(monthTotal)}`)
  return parts.length ? `📊 ${parts.join(' · ')}` : null
}

/** Which weekdays your wake-ups go wrong (last 8 weeks), for the sleep coach. */
export function wakePattern(wakes: { day: string; onTime: boolean }[]): string | null {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const by = names.map(() => ({ late: 0, n: 0 }))
  for (const w of wakes) {
    const d = new Date(`${w.day}T12:00:00Z`).getUTCDay()
    by[d].n++
    if (!w.onTime) by[d].late++
  }
  const bad = by.map((x, i) => ({ ...x, d: names[i] })).filter((x) => x.n >= 2 && x.late / x.n >= 0.5)
  return bad.length ? `Late most often on: ${bad.map((x) => `${x.d} (${x.late}/${x.n})`).join(', ')}.` : null
}
