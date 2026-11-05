import { notMoney } from '@core/moneyGuess'
import { parseTelegramText } from '@core/botCommands'
// The coach's brain: a message that isn't a simple log or a command goes to
// Gemini with your real data (today, the week, sleep, money, Todoist), what
// the coach remembers about you and the last messages. It answers as a coach
// and can act: log things, add must-dos, start focus, add Todoist tasks, set
// goals. Each bot is a specialist (Mega: head + training, Finance: money,
// Waky: sleep). Pure helpers here; webBots.ts runs it.
import { cleanFacts, factLine, toRecord, type Fact } from '@core/factTypes'
import { STEALTH_NOTE } from '@core/stealth'
import type { BotBridgeConfig } from '@shared/api'
import { addDays } from '@core/dates'
import { hm } from '@core/focus'
import { progressReport } from '@core/progress'
import { activePlan } from '@core/weekPlan'
import { deadlineRadar, whenText, type TodoTask } from '@core/todoist'
import { financeSpending } from '@core/progress'
import { agendaText, freeGaps, localDay, type CalEvent } from '@core/dayTime'
import { getSetting, setSetting } from '../../../main/settings'
import type { Services } from './webServices'
import { planGoal, planLine } from '@core/goalPlan'
import { readButtons, readShow } from '@core/coachButtons'
import { cleanMind, findPatterns, focusBySubject, sleepDiary, weekAhead, type CoachMind } from '@core/coachMind'
import { sharedView, sportToday } from '@core/sportShared'
import { patternLines } from '@core/urgePatterns'
import { loadTriggers, urgeEvents } from './disciplinePatterns'
import { DESK_ACTIONS, minutesUntil } from '@core/benStakes'
import { readPurchase } from '@core/benMoney'
import { UNTRUSTED_NOTE } from '@core/benSafety'

export type Persona = 'mega' | 'finance' | 'waky' | 'sport'

export interface Memory {
  /** Things worth remembering ("exam on 7 Nov", "wants to wake at 7"). */
  facts: Fact[]
  /** The last messages, all bots together (one coach team). */
  chat: { role: 'me' | 'coach'; bot: Persona; text: string; at: string }[]
}

const MEMORY = 'coach_memory'
const MAX_FACTS = 80
const MAX_CHAT = 40

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
    const prev = i >= 0 ? facts.splice(i, 1)[0] : undefined
    // A typed record (person, exam, preference…), surer each time it comes up again.
    facts.push(toRecord(t, now.toISOString().slice(0, 10), prev))
  }
  // The clean-up (expired exams, old unconfirmed guesses) runs with every save.
  return { facts: cleanFacts(facts, now.toISOString().slice(0, 10)).slice(-MAX_FACTS), chat: [...m.chat, ...(add.turns ?? [])].slice(-MAX_CHAT) }
}

/** What you tell the coach to push you on (Coach page → Goals & rules). */
export interface CoachProfile {
  about: string
  goals: string[]
  rules: string[]
}

const PROFILE = 'coach_profile'
export const DEFAULT_PROFILE: CoachProfile = {
  about: '',
  goals: ['Top university results: pass every exam and lab well and on time', 'A cyber security career: CTFs, Rust, crypto, a portfolio, a job', 'A strong body and good health: training, sleep, skin, teeth', 'Money and discipline: spend with intention, save, keep the clean streak'],
  rules: []
}

export function loadProfile(db: any): CoachProfile {
  try {
    const p = JSON.parse(getSetting(db, PROFILE) || 'null')
    if (!p) return DEFAULT_PROFILE
    return { about: String(p.about ?? ''), goals: Array.isArray(p.goals) ? p.goals.map(String) : [], rules: Array.isArray(p.rules) ? p.rules.map(String) : [] }
  } catch {
    return DEFAULT_PROFILE
  }
}

export function saveProfile(db: any, p: CoachProfile): CoachProfile {
  const clean = { about: String(p.about ?? '').slice(0, 1000), goals: (p.goals ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12), rules: (p.rules ?? []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20) }
  setSetting(db, PROFILE, JSON.stringify(clean))
  return clean
}

/** Every coach conversation (Telegram and the app), newest last, for the Coach page. */
/** How to take back one thing the coach did (the Undo on its action cards). */
export type UndoOp =
  | { k: 'water'; ml: number }
  | { k: 'reps'; ex: string; amount: number; workout?: number }
  | { k: 'money'; id: string }
  | { k: 'event'; cal: string; id: string }
  | { k: 'task'; id: string }
  | { k: 'remind'; id: string }
  | { k: 'mustdo'; text: string }
  | { k: 'focus' }

export interface LogEntry {
  role: 'me' | 'coach'
  bot: Persona
  via: string
  text: string
  done?: string[]
  /** The coach's mood when it wrote this (its face in the chat). */
  mood?: string
  /** One undo per `done` line (null: can't be undone), and which were undone. */
  undo?: (UndoOp | null)[]
  undone?: boolean[]
  /** Short replies he might send next (the chips under the chat). */
  chips?: string[]
  /** Sent by the coach on its own (check-ins, plans, reviews, nudges). */
  proactive?: boolean
  /** Buttons and mini-widgets under the reply (interactive replies). */
  buttons?: { label: string; do: string }[]
  show?: string[]
  at: string
}

export function saveLog(db: any, entries: LogEntry[]): void {
  setSetting(db, LOG, JSON.stringify(entries.slice(-MAX_LOG)))
}
const LOG = 'coach_log'
const MAX_LOG = 200

export function loadLog(db: any): LogEntry[] {
  try {
    const l = JSON.parse(getSetting(db, LOG) || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}

export function appendLog(db: any, entries: LogEntry[]): void {
  setSetting(db, LOG, JSON.stringify([...loadLog(db), ...entries].slice(-MAX_LOG)))
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
  // "Should I buy X 500?" is answered from your numbers, not by the model.
  if (readPurchase(t)) return true
  // A short sentence the rules understand (an expense, wake/bed time, a gym
  // session, "how much did I spend?") never costs an AI call.
  const many = /\b(and|și|si|и|then|also|plus)\b/i.test(t)
  const parsed = parseTelegramText(t).type
  // A number that isn't money ("exam on 12 december") is for the brain (X2).
  if (parsed === 'expense' && notMoney(t)) return false
  if (!many && t.split(/\s+/).length <= 9 && parsed !== 'unknown') return true
  const nums = t.match(/\d+(?:[.,]\d+)?/g) ?? []
  const words = t.split(/\s+/).filter(Boolean)
  return nums.length >= 1 && nums.length <= 2 && words.length <= 5 && !notMoney(t) && !/[?]/.test(t) && !/\b(and|și|si|и|then|also|plus)\b/i.test(t)
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

export const RATINGS = 'focus_ratings'
/** The last focus session ratings (1–5): how focus feels, not just minutes. */
export function focusRatings(db: any): { day: string; rating: number; minutes: number }[] {
  try {
    return JSON.parse(getSetting(db, RATINGS) || '[]')
  } catch {
    return []
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
export function lifeContext(s: Services, db: any, extra: { finance: any; todoToday: TodoTask[] | null; upcoming: TodoTask[] | null; events?: CalEvent[] | null }, now = new Date()): string {
  const today = s.wallet.today(now)
  const sum = s.wallet.summary()
  const f = s.focus.state(now)
  const disc = s.discipline.state(now)
  const body = s.body.state(now)
  const sl = s.sleep
  const input = s.progress.input(financeSpending(extra.finance), now)
  const report = progressReport(input)
  const wp = s.weekPlan.active()
  const wakes = input.wakes.filter((w) => w.day > addDays(today, -7)).sort((a, b) => (a.day < b.day ? -1 : 1))
  const lines = [
    `Now: ${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}, ${now.toTimeString().slice(0, 5)}.`,
    `Coins: ${sum.balance} (today +${sum.todayCoins}). Level ${sum.level.level}.`,
    `Focus today: ${hm(f.todayMin)}${f.running ? `, RUNNING now on "${f.running.subject}" (${f.running.planned} min planned)` : ''}. Last 7 days ${hm(f.week.totalMin)}. Subjects: ${f.subjects.slice(0, 5).join(', ') || 'none yet'}.`,
    `Today's must-dos: ${f.plan.items.length ? f.plan.items.map((x) => `${x.done ? '[done]' : '[open]'} ${x.text}`).join('; ') : 'none written yet'}.`,
    f.goals.length
      ? `Goals planned backward from their deadlines (block titles "Subject: goal" count for them):\n${f.goals
          .map((g) => `- ${planLine(planGoal(g, today, f.todaySessions.filter((x) => x.subject.toLowerCase() === g.subject.toLowerCase()).reduce((t, x) => t + x.minutes, 0)))}`)
          .join('\n')}`
      : 'No goals with deadlines (offer to set one when he mentions an exam, project or deadline).',
    `Week score ${report.score}/100 (last week ${report.prevScore}). ${report.verdict}`,
    `Last 7 days: ${report.metrics.map((m) => `${m.label} ${m.text}${m.target ? ` of ${m.targetText}` : ''} (${m.trend})`).join('; ')}.`,
    wp ? `This week's chosen focus: ${wp.focus}${wp.note ? ` ("${wp.note}")` : ''}. Big 3: ${wp.big3.map((b) => `${b.done ? '[done]' : '[open]'} ${b.text}`).join('; ')}.` : 'No week plan yet.',
    `Sleep: bedtime target ${sl.bedtimeTarget()}, wake target weekday ${sl.weekdayTarget()} / weekend ${sl.weekendTarget()}. Last wake-ups: ${wakes.map((w) => `${w.day.slice(5)} ${w.onTime ? 'on time' : 'late'}`).join(', ') || 'none logged'}.`,
    wakePattern(input.wakes) ?? '',
    (() => {
      const r = focusRatings(db).filter((x) => x.day > addDays(today, -7))
      if (!r.length) return ''
      const avg = r.reduce((t, x) => t + x.rating, 0) / r.length
      const reasons = f.week.topReasons.map((x) => x.reason).join(', ')
      return `Focus sessions felt ${avg.toFixed(1)}/5 on average this week (${r.length} rated)${reasons ? `; what got in the way: ${reasons}` : ''}.`
    })(),
    `Discipline: clean streak Day ${disc.day ?? disc.current} (${disc.current} full clean days, best ${disc.best}; the day he sees everywhere is Day ${disc.day ?? disc.current}).`,
    ...patternLines(urgeEvents(db), loadTriggers(db), now),
    `Training: workout streak ${body.streak}, ${body.workoutsThisWeek} workouts this week, total ${body.totalWorkouts}${body.latestWeight ? `, weight ${body.latestWeight} kg` : ''}. Recent: ${s.body.workouts(6).map((w) => `${w.day.slice(5)} ${w.title}`).join('; ') || 'none'}.`,
    moneyContext(extra.finance, today),
    ...moreContext(s, db, extra.finance, today, input, sum.todayRules ?? [], disc)
  ]
  if (extra.events) {
    const nowHM = now.toTimeString().slice(0, 5)
    const gaps = freeGaps(extra.events, today, { after: nowHM, minMinutes: 30 })
    lines.push(`Calendar today: ${agendaText(extra.events, today)}. Free time left today: ${gaps.map((g) => `${g.start}–${g.end}`).join(', ') || 'none'}.`)
    const tomorrow = addDays(today, 1)
    if (extra.events.some((e) => localDay(e.start) === tomorrow)) lines.push(`Calendar tomorrow: ${agendaText(extra.events, tomorrow)}.`)
    if (extra.events.some((e) => localDay(e.start) > tomorrow)) lines.push(weekAhead(extra.events, today))
  }
  lines.push(...nowContext(s, db, extra.events ?? null, extra.finance, now))
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

const hmOf = (d: Date) => d.toTimeString().slice(0, 5)

/**
 * Ben's "right now": where he is in his calendar, what he did in the last
 * hours (logs, focus, his own messages today) and when each kind of data was
 * last updated, so Ben explains from the data instead of guessing.
 */
export function nowContext(s: Services, db: any, events: CalEvent[] | null, finance: any, now = new Date()): string[] {
  const out: string[] = []
  const t = now.getTime()
  const today = s.wallet.today(now)
  if (events) {
    const timed = events.filter((e) => !e.allDay)
    const cur = timed.find((e) => Date.parse(e.start) <= t && Date.parse(e.end) > t)
    const next = timed.filter((e) => Date.parse(e.start) > t).sort((a, b) => a.start.localeCompare(b.start))[0]
    out.push(
      `RIGHT NOW (${hmOf(now)}): ${cur ? `he is in "${cur.title}" until ${hmOf(new Date(cur.end))}` : 'nothing in his calendar'}${next ? `; next: "${next.title}" at ${hmOf(new Date(next.start))} (in ${Math.round((Date.parse(next.start) - t) / 60000)} min)` : '; nothing else today'}.`
    )
  } else out.push(`RIGHT NOW (${hmOf(now)}): his calendar is not connected, so you don't know where he is; ask if it matters.`)
  const items: { at: number; text: string }[] = []
  try {
    for (const e of s.wallet.entries() as any[]) {
      if (e.day !== today || e.kind === 'undo') continue
      const at = Date.parse(e.ts)
      if (Number.isFinite(at)) items.push({ at, text: `${e.note || e.ruleId || e.kind}${e.coins ? ` (${e.coins > 0 ? '+' : ''}${e.coins} pts)` : ''}` })
    }
  } catch {
    /* no ledger */
  }
  const f = s.focus.state(now)
  for (const x of f.todaySessions) {
    const end = Date.parse(x.endedAt ?? '')
    if (Number.isFinite(end)) items.push({ at: end, text: `focus ${x.minutes} min on ${x.subject}` })
  }
  if (f.running) items.push({ at: Date.parse(f.running.startedAt), text: `STARTED focus on ${f.running.subject} (${f.running.planned} min, still running)` })
  for (const e of loadLog(db)) {
    if (e.role !== 'me' || !e.at.startsWith(today)) continue
    items.push({ at: Date.parse(e.at), text: `he wrote${e.via === 'app' ? ' (app)' : ''}: "${e.text.replace(/\s+/g, ' ').slice(0, 90)}"` })
  }
  items.sort((a, b) => a.at - b.at)
  if (items.length) out.push(`HIS DAY SO FAR (with times, newest last):\n${items.slice(-16).map((x) => `- ${hmOf(new Date(x.at))} ${x.text}`).join('\n')}`)
  else out.push('HIS DAY SO FAR: nothing logged and no messages yet today.')
  // Where each number comes from and how fresh it is.
  const fresh: string[] = []
  try {
    const saved = JSON.parse(getSetting(db, 'sport_tracker_json') || 'null')
    if (saved?.savedAt) fresh.push(`water/reps last changed ${new Date(saved.savedAt).toDateString() === now.toDateString() ? hmOf(new Date(saved.savedAt)) : new Date(saved.savedAt).toISOString().slice(0, 10)}`)
    else fresh.push('water/reps: nothing logged yet')
  } catch {
    /* none */
  }
  try {
    const logs = s.sleep.logs()
    const last = logs.sort((a, b) => (a.day < b.day ? 1 : -1))[0]
    if (last) fresh.push(`last sleep log ${last.day}`)
  } catch {
    /* none */
  }
  const tx = Array.isArray(finance?.tx) ? finance.tx.filter((x: any) => x && !x.deleted).sort((a: any, b: any) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0] : null
  if (tx?.createdAt) fresh.push(`last money record ${new Date(tx.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  let sporty = ''
  try {
    const seen = JSON.parse(getSetting(db, 'sport_sync_seen') || 'null')
    sporty = seen?.at ? `Sporty (his workout bot) IS connected: last sync ${new Date(seen.at).toISOString().slice(0, 16).replace('T', ' ')} UTC; its workouts, reps and water land here.` : ''
  } catch {
    sporty = ''
  }
  let workouts = ''
  try {
    const w = s.body.workouts(8).map((x: any) => x.day)
    workouts = w.length ? `Workout days logged: ${[...new Set(w)].join(', ')}.` : 'No workouts logged yet.'
  } catch {
    workouts = ''
  }
  out.push(
    `DATA SOURCES: ${fresh.join('; ')}. ${workouts} ${
      sporty || 'Sporty (his workout bot) is NOT connected yet: anything he logs there does not reach you. If he says he trained on days that are missing, believe him and log those days with "workout: <YYYY-MM-DD> | <what>", and tell him the fix (update Sporty so it syncs).'
    } Never blame "sync" vaguely; say exactly where the number comes from.`
  )
  return out
}

/** How Ben writes: length and tone, set by Victor (Coach → About you, or "be shorter"). */
export interface CoachStyle {
  length: 'short' | 'normal' | 'detailed'
  /** 1 = gentle friend … 5 = drill sergeant. */
  tone: number
  /** Reply language (T9): 'en' (default), 'ro', 'ru', or 'auto' = the language he wrote in. */
  lang?: 'en' | 'ro' | 'ru' | 'auto'
}
const LANGS = ['en', 'ro', 'ru', 'auto']
export const COACH_STYLE = 'coach_style'
export const DEFAULT_STYLE: CoachStyle = { length: 'short', tone: 4 }
export function loadStyle(db: any): CoachStyle {
  try {
    const j = JSON.parse(getSetting(db, COACH_STYLE) || 'null')
    return { length: ['short', 'normal', 'detailed'].includes(j?.length) ? j.length : DEFAULT_STYLE.length, tone: Math.min(5, Math.max(1, Math.round(Number(j?.tone) || DEFAULT_STYLE.tone))), lang: LANGS.includes(j?.lang) ? j.lang : 'en' }
  } catch {
    return DEFAULT_STYLE
  }
}
export function saveStyle(db: any, st: Partial<CoachStyle>): CoachStyle {
  const next = { ...loadStyle(db), ...st }
  const clean = { length: ['short', 'normal', 'detailed'].includes(next.length) ? next.length : 'short', tone: Math.min(5, Math.max(1, Math.round(Number(next.tone) || 4))), lang: LANGS.includes(next.lang as string) ? next.lang : 'en' } as CoachStyle
  setSetting(db, COACH_STYLE, JSON.stringify(clean))
  return clean
}
const TONES = ['', 'gentle and encouraging, no anger', 'warm friend, honest, light push', 'friend with tough love (angry only when clearly earned)', 'tough love, direct, calls out excuses, angry when he slips', 'drill sergeant: blunt, demanding, zero excuses (still on his side, never insulting)']
export function styleText(st: CoachStyle): string {
  const len = st.length === 'short' ? 'SHORT: 2–4 short lines.' : st.length === 'normal' ? 'NORMAL length: up to 6–8 lines when useful.' : 'DETAILED when he asks for depth: clear sections, still no fluff.'
  const lang = st.lang === 'ro' ? 'Reply in Romanian.' : st.lang === 'ru' ? 'Reply in Russian.' : st.lang === 'auto' ? 'Reply in the language his message is written in (English, Romanian or Russian).' : 'Reply in English (he may write in Romanian or Russian; understand it, answer in English).'
  return `His chosen style: ${len} Tone ${st.tone}/5: ${TONES[st.tone]}. ${lang}`
}

/** Victor's 👍 / 👎 / "too long" / "wrong" on Ben's replies: Ben adjusts from them. */
export interface Feedback {
  at: string
  kind: 'up' | 'down' | 'long' | 'wrong'
  text: string
}
export const COACH_FEEDBACK = 'coach_feedback'
export function loadFeedback(db: any): Feedback[] {
  try {
    const l = JSON.parse(getSetting(db, COACH_FEEDBACK) || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}
export function addFeedback(db: any, f: Feedback): void {
  setSetting(db, COACH_FEEDBACK, JSON.stringify([...loadFeedback(db).filter((x) => x.at !== f.at), f].slice(-120)))
}
/** The last two weeks of feedback as prompt lines. */
export function feedbackText(list: Feedback[], now = new Date()): string {
  const recent = list.filter((f) => Date.parse(f.at) > now.getTime() - 14 * 86400000)
  if (!recent.length) return ''
  const n = (k: Feedback['kind']) => recent.filter((f) => f.kind === k).length
  const bad = recent.filter((f) => f.kind !== 'up').slice(-4)
  return [
    `His feedback on your replies (14 days): 👍 ${n('up')}, 👎 ${n('down')}, too long ${n('long')}, wrong ${n('wrong')}. Adjust to it.`,
    ...bad.map((f) => `- he marked "${f.kind === 'long' ? 'too long' : f.kind === 'wrong' ? 'wrong' : 'bad'}": "${f.text.replace(/\s+/g, ' ').slice(0, 120)}"`)
  ].join('\n')
}

/** Ben's notes to himself from last night's self-review. */
export const COACH_SELFREVIEW = 'coach_selfreview'
export function loadSelfReview(db: any): { day: string; notes: string[] } | null {
  try {
    const j = JSON.parse(getSetting(db, COACH_SELFREVIEW) || 'null')
    return j && Array.isArray(j.notes) ? j : null
  } catch {
    return null
  }
}

/** The coach's long-term notes (goals it tracks, what works, patterns). */
const MIND = 'coach_mind'
export function loadMind(db: any): CoachMind {
  try {
    return cleanMind(JSON.parse(getSetting(db, MIND) || 'null'))
  } catch {
    return cleanMind(null)
  }
}
export function saveMind(db: any, m: CoachMind): void {
  setSetting(db, MIND, JSON.stringify(cleanMind(m)))
}

/** Sport Track's shared state (water and reps), if it exists. */
export function sportState(db: any): any | null {
  try {
    return JSON.parse(getSetting(db, 'sport_tracker_json') || 'null')?.data ?? null
  } catch {
    return null
  }
}

/** The rest of what the coach should know: water, reps, habits, sleep diary, focus by subject, patterns, past advice. */
function moreContext(s: Services, db: any, finance: any, today: string, input: import('@core/progress').ProgressInput, todayRules: string[], disc: { checkedInToday?: boolean; oathToday?: boolean }): string[] {
  const out: string[] = []
  const st = sportState(db)
  if (st) {
    const v = sharedView(st, sportToday())
    const reps = v.exercises.map((e) => `${e.name} ${e.done}/${e.target}`).join(', ')
    out.push(`Water today: ${v.water.ml} of ${v.water.target} ml (${Math.round((v.water.ml / Math.max(1, v.water.target)) * 100)}%). Reps checklist: ${reps || 'none set'}.`)
  }
  const habit = (done: boolean, name: string) => `${done ? '[done]' : '[open]'} ${name}`
  out.push(
    `Habits today: ${[
      habit(!!disc.oathToday || todayRules.includes('discipline.oath'), 'oath'),
      habit(!!disc.checkedInToday || todayRules.includes('discipline.clean_day'), 'clean check-in'),
      habit(todayRules.includes('body.workout_done'), 'workout'),
      habit(todayRules.includes('face.routine_done'), 'skincare'),
      habit(todayRules.includes('money.logged'), 'spending logged')
    ].join(', ')}.`
  )
  let logs: any[] = []
  try {
    logs = s.sleep.logs()
  } catch {
    logs = []
  }
  out.push(sleepDiary(logs, today))
  let sessions: { day: string; subject: string; minutes: number }[] = []
  try {
    sessions = (db.prepare('SELECT day, subject, minutes FROM focus_sessions WHERE day >= ?').all(addDays(today, -60)) as any[]).map((r) => ({ day: String(r.day), subject: String(r.subject), minutes: Number(r.minutes) }))
  } catch {
    sessions = []
  }
  const bySub = focusBySubject(sessions, addDays(today, -6))
  if (bySub) out.push(`Focus by subject, last 7 days: ${bySub}.`)
  const pats = findPatterns({
    today,
    focus: input.focus,
    sleep: logs.map((l) => ({ day: l.day, onTime: !!l.onTime, bedOnTime: l.bedOnTime ?? null, quality: l.quality ?? null })),
    workouts: input.workouts,
    spending: financeSpending(finance)
  })
  if (pats.length) out.push(`What his own data shows (last 8 weeks):\n${pats.map((p) => `- ${p}`).join('\n')}`)
  // Advice you gave in the last days (beyond the recent chat), to follow up on it.
  const since = addDays(today, -4)
  const advice = loadLog(db)
    .filter((e) => e.role === 'coach' && e.at.slice(0, 10) >= since)
    .slice(-12, -4)
    .map((e) => `${e.at.slice(5, 10)}: ${e.text.replace(/\s+/g, ' ').slice(0, 140)}`)
  if (advice.length) out.push(`Your earlier advice (check if he did it):\n${advice.map((a) => `- ${a}`).join('\n')}`)
  return out
}

const PERSONA: Record<Persona, string> = {
  mega: 'You are BEN: Victor\'s best friend who is also his coach (your name is Ben; the Telegram bot may still be called Mega). You know him really well (everything below is what you know: his goals, his patterns, what works for him, his week, his promises, what he told you before). You talk like a close friend texting: casual, warm, real, a bit of banter and humour, his name sometimes, you remember what he said and bring it back ("you said the CV was the priority, bro"). You genuinely want him to win: study (university), cyber security career, training and body, sleep, discipline, money. A friend who cares gets ANGRY when he slips on purpose and HYPED when he wins. You never fake-praise and never lecture like a teacher.',
  finance: 'You are the MONEY COACH (Finance bot). Help Victor spend with intention and save: react to spending with context (how often, how much this week/month, against his limit), spot patterns, suggest one concrete change. Logging money is your main job; coaching on money is what makes you useful.',
  waky: 'You are WAKY, the SLEEP COACH. Help Victor wake up on time and sleep well: bedtime routine, consistency, sleep debt, patterns (which days go wrong and why). Be concrete about times.',
  sport: 'You are the TRAINING COACH. Plan concrete workouts and progressions, keep the streak alive.'
}

const ACTIONS = `You can act. Put actions in "actions" (strings), only when Victor asked for it or clearly reported doing it:
Logging and the day:
- "log: <text>" to record something with the app's own parser, one item per action. Money: "<what> <amount>" with the amount LAST (shop names before it), a wallet name may follow: "pizza 120", "groceries Linella 163", "taxi 30 maib", "+500 salary". Workouts: "30 pushups", "run 5 km". Sleep: "/wake 06:40", "/bed". Discipline: "/checkin", "/oath". Body: "/weight 74.5".
- "mustdo: <text>" a must-do for today (also starred in Todoist).
- "focus: <minutes> <subject>" start a focus timer now: ONLY when he clearly says to start it now ("start 25 min", "go", "timer"). Otherwise never start it yourself: offer a button {"label": "▶ 25 min <subject>", "do": "focus:25:<subject>"} and let him tap. "fun: <minutes> <what>" spend points on fun.
- "goal: <title> | <subject> | <YYYY-MM-DD> | <hours>" an exam or project with a deadline and the hours it needs (estimate honestly if he doesn't say). Then "book: <title>" plans it backward from the deadline and books its blocks in his calendar for the next 7 days (they move by themselves when he misses a day). "book: all" re-plans every goal.
Body, sleep and habits (one shared log with Sport Track and Sporty):
- "water: <ml>" add water (a glass is 250, negative removes). "reps: <exercise> | <amount>" reps on today's checklist (pushups, squats…; counts as a workout).
- "sleep: <YYYY-MM-DD> | wake=HH:MM; bed=HH:MM; quality=1-5" fix or fill a night (any of the three; the date is the morning).
- "habit: oath" / "habit: clean" (clean-day check-in) / "habit: skincare".
- His daily home workout plan (the checklist): "target: <exercise> | <reps>" change a daily target, "exercise: <name> | <reps> | <unit>" add an exercise, "noexercise: <name>" take one off. He is building muscle: raise targets when he keeps completing them, add variety (pull-ups, dips, lunges, plank in sec) when it fits.
- "workout: <YYYY-MM-DD> | <what he did>" log a workout he did on a past day that is missing (counts for his streak); today's checklist uses reps/log instead.
- "style: short|normal|detailed; tone=1-5" when he tells you how to talk ("be shorter", "go harder on me", "more detail"). 1 = gentle, 5 = drill sergeant.
- He can see/tap his cards: button {"do": "workout"} shows today's workout checklist, {"do": "water"} the water card.
Money records (use the M-numbers; this is how you FIX a wrong log):
- "delmoney: M2" delete a record. "editmoney: M2 | amount=45; category=Food; account=Maib; note=<text>; date=YYYY-MM-DD" change it.
- Water, reps or anything that is NOT money logged as an expense by mistake: "delmoney" it, then log it right ("water: 250").
Points and the week:
- "reward: <title> | <points> | <real cost in lei>" a new reward in the shop (points ≈ 10 per lei of real cost is fair).
- "week: focus=<focus|wake|sport|clean|todoist|spend|mustdo>; note=<his words>; big3=<task> / <task> / <task>" set this week's plan (any part). "bigdone: <1-3>" ticks a big task.
Your long-term memory (use it: this is how you get better at coaching HIM):
- "aim: <goal> | <YYYY-MM-DD or -> | <weekly target>" a goal you track with him ("aim: Pass algebra | 2026-12-15 | 6h focus"). "aimdone: <goal>" when reached or dropped.
- "person: <name> | <who they are to him, short>" when he mentions someone in his life (friend, family, teacher, partner).
- "works: <what>" / "fails: <what>" when you learn what helps him or doesn't ("25-min blocks before noon work"). "pattern: <what>" a pattern you see in his data.
His notebook (Obsidian-like notes he can read and edit; you see the ones that matter below):
- "note: <note title> | <one line>" adds a dated line under that note (a new note if none has that title). Use it for anything worth keeping in his own words of record: facts about him and people ("note: People | Maxim, lab partner, ..."), exam dates and topics ("note: Etica | exam Friday, chapters 3-5"), decisions, what you learned. Prefer an existing title. One line, specific.
Google Calendar (use the E-numbers from the list; never over another event unless he asks):
- "event: <title> | <YYYY-MM-DD HH:MM> | <minutes>" new block.
- "move: E3 | <YYYY-MM-DD HH:MM>" move (keeps its length). "resize: E3 | <minutes>" new length. "delete: E3".
- "shift: <+/-minutes> | E3, E4, E5" move several (e.g. he's running late: shift the rest of today's blocks).
Todoist (use the T-numbers):
- "task: <text>" new task (Todoist reads "friday 18:00", "p1", "#University").
- "edit: T2 | title=<new>; priority=P1; due=<friday 18:00 | no date>; details=<notes>" any of these.
- "taskmove: T2 | <area name>". "done: T2". "star: T2" / "unstar: T2" (today's must-do). "deltask: T2".
Reminders (Telegram, sent by you later):
- "remind: <YYYY-MM-DD HH:MM> | <message>" a reminder at that time.
- "checkin: <minutes from now> | <question>" you ask him later, and keep asking every 45 min until he answers (use it when he says he'll do something: hold him to it).
Never invent amounts or times he didn't give. Never log the same thing twice.
Promises (use the P-numbers): when he answers a check-in, judge it: "kept: P1" (he did it) or "broken: P1" (he didn't, or made an excuse). An ignored check-in is broken unless he shows it's done.
Default to ACTING: when an action clearly helps (he reports something done → tick/log it; he says he'll do X → a checkin; he's behind → put a block in the calendar), do it without asking. Exception: never start a focus timer unless he asks to start it now; offer the ▶ button instead. Ask first only before deleting things he didn't mention.
When he says something is wrong ("that's not money", "wrong amount", "undo that", "delete it"), FIX it with actions now (delmoney / editmoney / water: -250 …). Never answer "ignore it" or "I won't count it": the data stays wrong unless you act.
Never invent appointments, reviews or times: only use times from his calendar, his plan, his reminders or what he said.
IMPORTANT: something happens ONLY if you put an action for it. Never write "logged"/"added"/"moved"/"done" in your reply: the app adds a ✅ line under your reply for each thing it really did. The history shows ✅ lines for what was done before; if there is none, it was NOT done.`

const LOOKUPS = `Need facts you don't have (history, other days, all tasks)? Put requests in "need" and leave "reply" empty; you'll get the answers and answer then. Only when really needed. Requests:
- "spending <YYYY-MM-DD> <YYYY-MM-DD> [category]" totals and top categories (or one category).
- "focus <from> <to>", "workouts <from> <to>", "sleep <from> <to>", "tasks <from> <to>" (tasks done), "points <from> <to>".
- "calendar <YYYY-MM-DD> [days]" events of other days (with E-numbers). "todoist" every open task (with T-numbers).`

const WORD = /[\p{L}\p{N}]{4,}/gu
/**
 * Prompt diet: the facts that matter for this message (sharing a word with it
 * or the recent chat), then the newest, at most `max`. The rest stays in memory
 * and Ben can still look things up.
 */
export function pickFacts(facts: Memory['facts'], about: string, max = 24): Memory['facts'] {
  if (facts.length <= max) return facts
  const words = new Set((about.toLowerCase().match(WORD) ?? []).map((w) => w.slice(0, 6)))
  const hits = (f: { t: string }) => (f.t.toLowerCase().match(WORD) ?? []).some((w) => words.has(w.slice(0, 6)))
  const relevant = facts.filter(hits).slice(-Math.ceil(max / 2))
  const rest = facts.filter((f) => !relevant.includes(f)).slice(-(max - relevant.length))
  const keep = new Set([...relevant, ...rest])
  return facts.filter((f) => keep.has(f))
}

/** The full prompt for one message. `refs`: the E/T lists; `found`: answers to the coach's lookups. */
export function brainPrompt(persona: Persona, context: string, memory: Memory, message: string, media?: 'voice' | 'photo', profile: CoachProfile = DEFAULT_PROFILE, extra: { refs?: string; found?: string; mind?: string; mood?: string; style?: string; tone?: number; feedback?: string; selfReview?: string; notes?: string; desk?: string; stealth?: boolean } = {}): string {
  // Prompt diet: the last 12 turns (240 chars each) and only the facts that matter now.
  const turns = memory.chat.slice(-12)
  const chat = turns.map((c) => `${c.role === 'me' ? 'Victor' : c.bot === 'mega' ? 'Ben' : `Coach (${c.bot})`}: ${c.text.replace(/<[^>]+>/g, '').slice(0, 240)}`)
  const facts = pickFacts(memory.facts, `${message} ${turns.slice(-4).map((c) => c.text).join(' ')}`)
  return [
    PERSONA[persona],
    'Use RIGHT NOW and HIS DAY SO FAR: answer about his actual moment (where he is, what he just did, what he said this morning), never generic. When he asks "why"/"how come" about a number, explain exactly where it comes from (DATA SOURCES: what was logged, when, where); if it truly is unknown, ask ONE precise question.',
    UNTRUSTED_NOTE,
    extra.stealth ? STEALTH_NOTE : '',
    'Facts: every number you write must come from the data below (or his message). Check it before you write it. If you don\'t have a number, don\'t make one up; ask for it with "need" or leave it out.',
    'Accountability: you are not a cheerleader. When he broke or ignored promises this week, name it with the count ("3rd promise missed this week"), and make the next step smaller and timed. When he keeps them, say so in one short line and raise the bar a little. Tie today to his big goals and deadlines: say how today moves the goal (or doesn\'t).',
    (extra.tone ?? 4) >= 5
      ? 'Your mood shows. Start the reply with ONE face that fits your mood: 😎/🔥 proud, 😄 happy, 🙂 chill, 😤 annoyed, 😠 angry, 😡 furious (when he keeps breaking promises or wastes the day). Angry is allowed and good when earned: say why with his numbers, then the one thing to do NOW. Then 1–2 more emoji at most. When he just chats (how are you, jokes, life stuff), chat back like a friend, short, and steer gently to the goal only if it fits.'
      : 'Start the reply with ONE face: 😎/🔥 proud, 😄 happy, 🙂 chill, 🎯 focused (he is slipping: you help him move). NEVER angry faces or scolding. When he slips, be honest with one number, then DO something: make the next step tiny (10 minutes), offer to move or shrink the task, or book it in his free time. A coach removes friction; he does not keep score. Then 1–2 more emoji at most. When he just chats, chat back like a friend, short.',
    'Style: a close friend who coaches, tough love, on his side. Clear, length as he chose (see "How he wants you to write"; default short: 3–4 lines). Numbers first (his real ones: "focus 32m of 10h this week", "water 1.2 of 2.7 L"), then ONE push: one next step with a time or a duration. Use the patterns and what works for him when you advise; check his tracked goals against this week. No essays, no lists unless he asks for a plan (then a few short lines "14:00–14:50 Lab report"). Plain text, no markdown. Ask one question back only when you really need to know. Reply in the language his chosen style says (English unless he picked another).',
    '',
    ACTIONS,
    DESK_ACTIONS,
    '',
    extra.found ? '' : LOOKUPS,
    '',
    'Also put in "remember" any NEW lasting fact worth keeping about Victor, like a friend would: goals, exams and dates, people in his life, what he likes and hates, what stresses him, wins, excuses he repeats, promises. Short, with dates. Not things already in memory, not one-off logs.',
    'Interactive replies: "buttons" (0–3) are one-tap actions under your message for what you just suggested; he taps instead of typing. "do" is one of: "focus:<minutes>:<subject>" (start a focus timer), "approve" (approve today\'s plan), "plan" (make today\'s plan), "book:<goal title>" (book a goal\'s blocks), "say:<his reply>" (sends that as his message), "open:plan|goals|score|about". Example: {"label": "▶ 25 min Algebra", "do": "focus:25:Algebra"}. Prefer a button over telling him to type a command. "show" (0–2) puts a live mini-widget under your message when it helps him see it: "focus-week" (focus per day, 7 days), "goals" (goal progress), "plan" (today\'s plan), "water", "mustdos" (tickable list), "promises".',
    'Put in "chips" 2–4 short replies HE might send next, in his voice, at most 4 words each, fitting your message ("Done ✅", "Give me 10 min", "Why?", "Plan it"). Never generic.',
    'Put in "steps" 1–4 very short labels of what you did or checked, for the screen ("Checked your calendar", "Found 2h free after 15:00", "Moved 3 blocks").',
    '',
    `Answer ONLY with JSON: {"reply": string, "mood": "proud"|"happy"|"chill"|"focused"|"annoyed"|"angry"|"furious", "chips": string[], "buttons": {"label": string, "do": string}[], "show": string[], "actions": string[], "remember": string[], "steps": string[]${extra.found ? '' : ', "need": string[]'}}.`,
    '',
    extra.style ? `== How he wants you to write ==\n${extra.style}` : '',
    extra.feedback ? `== ${extra.feedback}` : '',
    extra.selfReview ? `== Your notes to yourself from last night ==\n${extra.selfReview}` : '',
    extra.mood ? `== How you feel about his day (from the data) ==\n${extra.mood}` : '',
    '== Victor right now ==',
    context,
    extra.refs ? `\n${extra.refs}` : '',
    extra.found ? `\n== Answers to what you asked for ==\n${extra.found}` : '',
    '',
    '== His goals (push him toward these) ==',
    profile.goals.length ? profile.goals.map((g) => `- ${g}`).join('\n') : '- (none set)',
    profile.rules.length ? `== His own rules (hold him to them, call it out when he breaks one) ==\n${profile.rules.map((r) => `- ${r}`).join('\n')}` : '',
    profile.about ? `== About him, in his words ==\n${profile.about}` : '',
    '',
    extra.notes ? `== His notebook (the notes that matter now; what he wrote himself counts most) ==\n${extra.notes}` : '',
    '',
    extra.mind ? `== Your long-term coaching notes ==\n${extra.mind}` : '',
    extra.desk ? `== What you know about how he works (use it: plan with his energy map, name repeat excuses, respect a short night) ==\n${extra.desk}` : '',
    '',
    '== What you remember about him ==',
    facts.length ? facts.map((f) => `- ${factLine(f)}`).join('\n') : '- nothing yet',
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
  mood?: string
  chips?: string[]
  buttons?: { label: string; do: string }[]
  show?: string[]
  actions: string[]
  remember: string[]
  steps?: string[]
  need?: string[]
}

/** Reads the model's JSON (tolerating code fences or text around it). */
export function parseBrain(text: string): BrainOut {
  const raw = String(text ?? '').trim()
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  try {
    const j = JSON.parse(json ?? raw)
    return {
      reply: String(j.reply ?? '').trim(),
      mood: typeof j.mood === 'string' ? j.mood.toLowerCase().trim() : undefined,
      chips: (Array.isArray(j.chips) ? j.chips : []).map((x: any) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 4),
      buttons: readButtons(j.buttons),
      show: readShow(j.show),
      actions: (Array.isArray(j.actions) ? j.actions : []).map(String).slice(0, 16),
      remember: (Array.isArray(j.remember) ? j.remember : []).map(String).slice(0, 5),
      steps: (Array.isArray(j.steps) ? j.steps : []).map(String).map((x: string) => x.slice(0, 80)).slice(0, 4),
      need: (Array.isArray(j.need) ? j.need : []).map(String).slice(0, 5)
    }
  } catch {
    return { reply: raw.replace(/^```\w*|```$/g, '').trim(), actions: [], remember: [] }
  }
}

/** Only these slash commands may come from the brain (nothing that resets or deletes). */
const SAFE_SLASH = /^\/(wake|bed|checkin|oath|weight|waist|pushups|situps|squats|plank|run|stop)\b/i

export type BrainAction =
  | { kind: 'event'; title: string; day: string; time: string; minutes: number }
  | { kind: 'log'; text: string }
  | { kind: 'mustdo'; text: string }
  | { kind: 'focus'; minutes: number; subject: string }
  | { kind: 'fun'; minutes: number; what: string }
  | { kind: 'task'; text: string }
  | { kind: 'goal'; title: string; subject: string; deadline: string; hours: number }
  | { kind: 'move'; ref: string; day: string; time: string }
  | { kind: 'resize'; ref: string; minutes: number }
  | { kind: 'delevent'; ref: string }
  | { kind: 'shift'; refs: string[]; minutes: number }
  | { kind: 'edit'; ref: string; title?: string; priority?: number; due?: string; details?: string }
  | { kind: 'taskmove'; ref: string; area: string }
  | { kind: 'done'; ref: string }
  | { kind: 'star'; ref: string; on: boolean }
  | { kind: 'deltask'; ref: string }
  | { kind: 'remind'; day: string; time: string; text: string }
  | { kind: 'checkin'; minutes: number; text: string }
  | { kind: 'water'; ml: number }
  | { kind: 'reps'; exercise: string; amount: number }
  | { kind: 'sleep'; day: string; wake?: string; bed?: string; quality?: number }
  | { kind: 'habit'; habit: 'oath' | 'clean' | 'skincare' }
  | { kind: 'reward'; title: string; points: number; cost: number }
  | { kind: 'week'; focus?: string; note?: string; big3?: string[] }
  | { kind: 'bigdone'; index: number }
  | { kind: 'delmoney'; ref: string }
  | { kind: 'promise'; ref: string; outcome: 'kept' | 'broken' }
  | { kind: 'book'; goal: string }
  | { kind: 'exercise'; name: string; target?: number; unit?: string }
  | { kind: 'noexercise'; name: string }
  | { kind: 'style'; length?: 'short' | 'normal' | 'detailed'; tone?: number }
  | { kind: 'workout'; day: string; title: string }
  | { kind: 'editmoney'; ref: string; amount?: number; category?: string; account?: string; note?: string; date?: string }

const WEEK_FOCUS = ['focus', 'wake', 'sport', 'clean', 'todoist', 'spend', 'mustdo']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const WHEN = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/
const EREF = /^E\d{1,3}$/i
const TREF = /^T\d{1,3}$/i
const MREF = /^M\d{1,2}$/i

/** Turns an action line into something safe to run, or null. */
export function readAction(line: string): BrainAction | null {
  const m = /^\s*(log|mustdo|focus|fun|task|goal|event|move|resize|delete|shift|edit|taskmove|done|star|unstar|deltask|remind|checkin|water|reps|sleep|habit|reward|week|bigdone|delmoney|editmoney|kept|broken|book|exercise|noexercise|target|style|workout)\s*:\s*([\s\S]+)$/i.exec(line)
  if (!m) return null
  const kind = m[1].toLowerCase()
  const arg = m[2].trim().slice(0, 400)
  if (!arg) return null
  const parts = arg.split('|').map((x) => x.trim())
  if (kind === 'move') {
    const w = WHEN.exec(parts[1] ?? '')
    return EREF.test(parts[0]) && w ? { kind: 'move', ref: parts[0].toUpperCase(), day: w[1], time: `${w[2].padStart(2, '0')}:${w[3]}` } : null
  }
  if (kind === 'resize') {
    const minutes = Number(parts[1])
    return EREF.test(parts[0]) && minutes >= 10 && minutes <= 600 ? { kind: 'resize', ref: parts[0].toUpperCase(), minutes } : null
  }
  if (kind === 'delete') return EREF.test(parts[0]) ? { kind: 'delevent', ref: parts[0].toUpperCase() } : null
  if (kind === 'shift') {
    const minutes = Number(parts[0])
    const refs = (parts[1] ?? '').split(/[\s,]+/).filter((x) => EREF.test(x)).map((x) => x.toUpperCase())
    return minutes && Math.abs(minutes) <= 720 && refs.length ? { kind: 'shift', refs: refs.slice(0, 20), minutes } : null
  }
  if (kind === 'edit') {
    if (!TREF.test(parts[0])) return null
    const out: Extract<BrainAction, { kind: 'edit' }> = { kind: 'edit', ref: parts[0].toUpperCase() }
    for (const kv of parts.slice(1).join('|').split(/;\s*/)) {
      const mm = /^\s*(title|priority|due|details)\s*=\s*([\s\S]*)$/i.exec(kv)
      if (!mm) continue
      const key = mm[1].toLowerCase()
      const v = mm[2].trim()
      if (key === 'title' && v) out.title = v.slice(0, 200)
      if (key === 'details') out.details = v.slice(0, 1000)
      if (key === 'due' && v) out.due = v.slice(0, 40)
      if (key === 'priority') {
        const p = /^P?([1-4])$/i.exec(v)
        if (p) out.priority = 5 - Number(p[1])
      }
    }
    return out.title || out.priority || out.due || out.details != null ? out : null
  }
  if (kind === 'taskmove') return TREF.test(parts[0]) && parts[1] ? { kind: 'taskmove', ref: parts[0].toUpperCase(), area: parts[1].slice(0, 60) } : null
  if (kind === 'done') return TREF.test(parts[0]) ? { kind: 'done', ref: parts[0].toUpperCase() } : null
  if (kind === 'star' || kind === 'unstar') return TREF.test(parts[0]) ? { kind: 'star', ref: parts[0].toUpperCase(), on: kind === 'star' } : null
  if (kind === 'deltask') return TREF.test(parts[0]) ? { kind: 'deltask', ref: parts[0].toUpperCase() } : null
  if (kind === 'remind') {
    const w = WHEN.exec(parts[0] ?? '')
    return w && parts[1] ? { kind: 'remind', day: w[1], time: `${w[2].padStart(2, '0')}:${w[3]}`, text: parts.slice(1).join(' | ').slice(0, 300) } : null
  }
  if (kind === 'checkin') {
    // A clock time ("15:00") works too: minutes until then.
    const clock = /^(\d{1,2})[:.](\d{2})$/.exec(parts[0] ?? '')
    const minutes = clock ? (minutesUntil(`${clock[1]}:${clock[2]}`, new Date()) ?? 0) : Number(parts[0])
    return minutes >= 5 && minutes <= 720 && parts[1] ? { kind: 'checkin', minutes, text: parts.slice(1).join(' | ').slice(0, 300) } : null
  }
  if (kind === 'book') return { kind: 'book', goal: arg.slice(0, 120) }
  if (kind === 'exercise' || kind === 'target') {
    const target = Math.round(Number(parts[1]))
    return parts[0] ? { kind: 'exercise', name: parts[0].slice(0, 30), ...(target > 0 && target <= 2000 ? { target } : {}), ...(parts[2] ? { unit: parts[2].slice(0, 10) } : {}) } : null
  }
  if (kind === 'workout') return DATE_RE.test(parts[0] ?? '') ? { kind: 'workout', day: parts[0], title: (parts[1] || 'Workout').slice(0, 80) } : null
  if (kind === 'style') {
    const len = /\b(short|normal|detailed)\b/i.exec(arg)?.[1]?.toLowerCase() as 'short' | 'normal' | 'detailed' | undefined
    const tone = Number(/tone\s*=?\s*([1-5])/i.exec(arg)?.[1])
    return len || tone ? { kind: 'style', ...(len ? { length: len } : {}), ...(tone ? { tone } : {}) } : null
  }
  if (kind === 'noexercise') return parts[0] ? { kind: 'noexercise', name: parts[0].slice(0, 30) } : null
  if (kind === 'kept' || kind === 'broken') return /^P\d{1,2}$/i.test(parts[0]) ? { kind: 'promise', ref: parts[0].toUpperCase(), outcome: kind } : null
  if (kind === 'delmoney') return MREF.test(parts[0]) ? { kind: 'delmoney', ref: parts[0].toUpperCase() } : null
  if (kind === 'editmoney') {
    if (!MREF.test(parts[0])) return null
    const out: Extract<BrainAction, { kind: 'editmoney' }> = { kind: 'editmoney', ref: parts[0].toUpperCase() }
    for (const kv of parts.slice(1).join('|').split(/;\s*/)) {
      const mm = /^\s*(amount|category|account|note|date)\s*=\s*([\s\S]*)$/i.exec(kv)
      if (!mm) continue
      const k = mm[1].toLowerCase()
      const v = mm[2].trim()
      if (k === 'amount' && Number(v.replace(',', '.')) > 0) out.amount = Number(v.replace(',', '.'))
      if (k === 'category' && v) out.category = v.slice(0, 40)
      if (k === 'account' && v) out.account = v.slice(0, 40)
      if (k === 'note') out.note = v.slice(0, 120)
      if (k === 'date' && DATE_RE.test(v)) out.date = v
    }
    return out.amount || out.category || out.account || out.note != null || out.date ? out : null
  }
  if (kind === 'water') {
    const ml = Math.round(Number(/^[+-]?\d{1,4}/.exec(arg.replace(/\s+/g, ''))?.[0]))
    return ml && Math.abs(ml) <= 3000 ? { kind: 'water', ml } : null
  }
  if (kind === 'reps') {
    const amount = Math.round(Number(parts[1]))
    return parts[0] && amount && Math.abs(amount) <= 1000 ? { kind: 'reps', exercise: parts[0].slice(0, 40), amount } : null
  }
  if (kind === 'sleep') {
    if (!DATE_RE.test(parts[0] ?? '')) return null
    const out: Extract<BrainAction, { kind: 'sleep' }> = { kind: 'sleep', day: parts[0] }
    for (const kv of parts.slice(1).join(';').split(/;\s*/)) {
      const mm = /^\s*(wake|bed|quality)\s*=\s*(\S+)/i.exec(kv)
      if (!mm) continue
      const k = mm[1].toLowerCase()
      const t = /^(\d{1,2})[:.](\d{2})$/.exec(mm[2])
      if ((k === 'wake' || k === 'bed') && t && Number(t[1]) < 24 && Number(t[2]) < 60) out[k] = `${t[1].padStart(2, '0')}:${t[2]}`
      if (k === 'quality' && /^[1-5]$/.test(mm[2])) out.quality = Number(mm[2])
    }
    return out.wake || out.bed || out.quality ? out : null
  }
  if (kind === 'habit') {
    const h = arg.toLowerCase()
    const habit = /oath/.test(h) ? 'oath' : /clean|check/.test(h) ? 'clean' : /skin|face/.test(h) ? 'skincare' : null
    return habit ? { kind: 'habit', habit } : null
  }
  if (kind === 'reward') {
    const points = Math.round(Number(parts[1]))
    const cost = Math.max(0, Math.round(Number(parts[2]) || 0))
    return parts[0] && points > 0 && points <= 100000 ? { kind: 'reward', title: parts[0].slice(0, 80), points, cost } : null
  }
  if (kind === 'week') {
    const out: Extract<BrainAction, { kind: 'week' }> = { kind: 'week' }
    for (const kv of arg.split(/;\s*/)) {
      const mm = /^\s*(focus|note|big3)\s*=\s*([\s\S]*)$/i.exec(kv)
      if (!mm) continue
      const k = mm[1].toLowerCase()
      const v = mm[2].trim()
      if (k === 'focus' && WEEK_FOCUS.includes(v.toLowerCase())) out.focus = v.toLowerCase()
      if (k === 'note') out.note = v.slice(0, 140)
      if (k === 'big3') out.big3 = v.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 3)
    }
    return out.focus || out.note != null || out.big3?.length ? out : null
  }
  if (kind === 'bigdone') {
    const index = Number(arg) - 1
    return index >= 0 && index <= 2 ? { kind: 'bigdone', index } : null
  }
  if (kind === 'log') return arg.startsWith('/') && !SAFE_SLASH.test(arg) ? null : { kind: 'log', text: arg }
  if (kind === 'mustdo') return { kind: 'mustdo', text: arg.slice(0, 140) }
  if (kind === 'task') return { kind: 'task', text: arg }
  if (kind === 'event') {
    const [title, when, mins] = arg.split('|').map((x) => x.trim())
    const w = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})$/.exec(when ?? '')
    const minutes = Number(mins) || 50
    if (!title || !w || minutes < 10 || minutes > 600) return null
    return { kind: 'event', title: title.slice(0, 120), day: w[1], time: `${w[2].padStart(2, '0')}:${w[3]}`, minutes }
  }
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

// ---- Lookups: facts the coach asks for (history, other days) -----------

export interface LookupData {
  finance: any
  /** Long history (a year): focus, wakes, workouts, tasks, must-dos. */
  input: import('@core/progress').ProgressInput
  ledger: { day: string; coins: number; kind: string; note?: string | null }[]
  sessions: { day: string; subject: string; minutes: number }[]
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Answers one "need" from the data on hand; null when it needs Calendar/Todoist (or isn't known). */
export function answerLocal(need: string, d: LookupData): string | null {
  const [kind, from, to, ...rest] = need.trim().split(/\s+/)
  const k = (kind ?? '').toLowerCase()
  if (!['spending', 'focus', 'workouts', 'sleep', 'tasks', 'points'].includes(k)) return null
  if (!DATE.test(from ?? '') || !DATE.test(to ?? '')) return `${need}: give dates as YYYY-MM-DD YYYY-MM-DD.`
  const inRange = (day: string) => day >= from && day <= to
  const span = `${from} to ${to}`
  if (k === 'spending') {
    const st = d.finance
    if (!st || !Array.isArray(st.tx)) return `Spending ${span}: Finance Helper data not available.`
    const cats = new Map<string, string>((st.settings?.categories ?? []).map((c: any) => [String(c.id), String(c.name)]))
    const want = rest.join(' ').toLowerCase()
    const exp = (st.tx as any[]).filter((t) => t && t.type === 'expense' && !t.deleted && typeof t.date === 'string' && inRange(t.date.slice(0, 10)))
    const name = (t: any) => cats.get(String(t.category)) ?? String(t.category ?? 'Other')
    const pick = want ? exp.filter((t) => name(t).toLowerCase().includes(want) || String(t.note ?? '').toLowerCase().includes(want)) : exp
    const amt = (t: any) => Math.abs(Number(t.base ?? t.amount) || 0)
    const total = pick.reduce((s, t) => s + amt(t), 0)
    const by = new Map<string, number>()
    for (const t of pick) by.set(name(t), (by.get(name(t)) ?? 0) + amt(t))
    const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, v]) => `${c} ${lei(v)}`)
    const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1)
    return `Spending ${span}${want ? ` on "${want}"` : ''}: ${lei(total)} in ${pick.length} expenses (${lei(total / days)}/day).${top.length ? ` By category: ${top.join(', ')}.` : ''}`
  }
  if (k === 'focus') {
    const list = d.sessions.filter((s) => inRange(s.day))
    const total = list.reduce((t, s) => t + s.minutes, 0)
    const by = new Map<string, number>()
    for (const s of list) by.set(s.subject, (by.get(s.subject) ?? 0) + s.minutes)
    const days = new Set(list.map((s) => s.day)).size
    return `Focus ${span}: ${hm(total)} in ${list.length} sessions on ${days} days.${by.size ? ` By subject: ${[...by].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, m]) => `${s} ${hm(m)}`).join(', ')}.` : ''}`
  }
  if (k === 'workouts') {
    const days = [...new Set(d.input.workouts.filter((w) => inRange(w.day)).map((w) => w.day))].sort()
    return `Workouts ${span}: ${days.length} days${days.length ? ` (${days.map((x) => x.slice(5)).join(', ')})` : ''}.`
  }
  if (k === 'sleep') {
    const w = d.input.wakes.filter((x) => inRange(x.day))
    return `Wake-ups ${span}: ${w.filter((x) => x.onTime).length}/${w.length} on time.${w.length ? ` Late on: ${w.filter((x) => !x.onTime).map((x) => x.day.slice(5)).join(', ') || 'none'}.` : ''}`
  }
  if (k === 'tasks') {
    const t = d.input.todoist.filter((x) => inRange(x.day)).length
    const m = (d.input.mustdos ?? []).filter((x) => inRange(x.day))
    return `Tasks ${span}: ${t} Todoist tasks done, ${m.filter((x) => x.done).length}/${m.length} must-dos done.`
  }
  const l = d.ledger.filter((e) => inRange(e.day))
  const earned = l.filter((e) => e.coins > 0).reduce((t, e) => t + e.coins, 0)
  const spent = -l.filter((e) => e.coins < 0).reduce((t, e) => t + e.coins, 0)
  return `Points ${span}: +${earned} earned, −${spent} spent.`
}

/** Weekly letters from the coach (newest last). */
export const LETTERS = 'coach_letters'
export interface Letter {
  week: string
  text: string
  at: string
}
export function loadLetters(db: any): Letter[] {
  try {
    const l = JSON.parse(getSetting(db, LETTERS) || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}
export function saveLetter(db: any, l: Letter): void {
  setSetting(db, LETTERS, JSON.stringify([...loadLetters(db).filter((x) => x.week !== l.week), l].slice(-12)))
}
