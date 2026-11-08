// The weekly AI review (tested with a stub model). Once a week Ben reads the
// last week's sets, best sets, protein, sleep and stalls, and rewrites this
// week's program through the strong model. The rules (sportCoachRules.ts) are
// hard limits: every target is clamped to 10-20 sets, 2+ sessions, a deload only
// when the rules say it is due, and every number in the explanation must come
// from the facts (invented numbers are dropped, then benGround checks times and
// events). If the model fails or says nothing usable, the code writes the plan.
import { groundReply } from './benGround'
import { BODY_PART, RULES, bodyLines, deloadCheck, muscleLoad, type CoachCtx } from './sportCoachRules'
import { stallsOf } from './sportInsight'
import { MUSCLES, mondayOf, type Muscle } from './sportSets'
import { moveOf } from './sportLadders'
import { strengthChange } from './sportStrength'

export interface Program {
  /** The Monday of the week this program is for. */
  week: string
  target: Record<Muscle, number>
  sessions: number
  deload: boolean
  lines: string[]
  source: 'ai' | 'code'
}

export type Ask = (prompt: string, opts: { json: boolean; strong: boolean; think?: boolean; kind: string }) => Promise<string>

/** The facts the model gets (and the only numbers it may use). */
export function reviewFacts(ctx: CoachCtx): string {
  const load = muscleLoad(ctx)
  const stalled = stallsOf(ctx.sets, ctx.exercises, ctx.today)
  const change = strengthChange(ctx.sets, ctx.exercises, ctx.today)
  const b = ctx.body
  const out: string[] = []
  out.push('Hard sets in the last 7 days: ' + load.map((l) => `${l.short} ${l.sets} sets on ${l.days} days`).join('; ') + '.')
  const bests = ctx.exercises
    .filter((e) => e.active !== false)
    .map((e) => {
      const m = moveOf(e)
      const top = Math.max(0, ...Object.values(ctx.sets ?? {}).flatMap((d) => (d?.[String(e.id)] ?? []).map((s) => s.reps)))
      return m && top ? `${m.name} best set ${top}` : ''
    })
    .filter(Boolean)
  if (bests.length) out.push('Best sets: ' + bests.join('; ') + '.')
  if (change.pct != null) out.push(`Strength change versus 4 weeks ago: ${change.pct} percent.`)
  out.push(stalled.length ? 'Stalled: ' + stalled.map((s) => `${s.name} (${s.sessions} sessions without a better set)`).join('; ') + '.' : 'Nothing stalled.')
  out.push(b?.protein && b.protein.days ? `Protein averaged ${b.protein.avg} g a day on ${b.protein.days} days, goal ${b.protein.goal} g.` : 'Protein: not logged.')
  out.push(b?.sleep && b.sleep.avgMin != null ? `Sleep averaged ${Math.round(b.sleep.avgMin / 6) / 10} hours over ${b.sleep.nights} nights.` : 'Sleep: not logged.')
  const dl = deloadCheck(ctx)
  out.push(`Training weeks in a row: ${dl.weeks}. Deload ${dl.due ? 'is due' : 'is not due'}.`)
  return out.join('\n')
}

/** The program the rules alone give: low muscles up to 10, the rest one more, a deload when due. */
export function baseProgram(ctx: CoachCtx): Program {
  const load = muscleLoad(ctx)
  const dl = deloadCheck(ctx)
  const target = {} as Record<Muscle, number>
  for (const l of load) target[l.id] = Math.max(RULES.setsLo, Math.min(RULES.setsHi, l.sets < RULES.setsLo ? RULES.setsLo : l.sets + 1))
  const lines: string[] = []
  const low = load.filter((l) => l.status === 'low' && l.sets > 0)
  if (low.length) lines.push(`Your ${low.map((l) => BODY_PART[l.id].part).join(' and ')} got under ${RULES.setsLo} hard sets, so this week each gets ${RULES.setsLo}.`)
  if (dl.due) lines.push(dl.why)
  lines.push(...bodyLines(ctx.body).lines.slice(0, 2))
  lines.push(`Every muscle is trained on ${RULES.minDays} or more days, and each set stops ${RULES.rir}.`)
  return { week: mondayOf(ctx.today), target, sessions: 3, deload: dl.due, lines: lines.slice(0, 4), source: 'code' }
}

const NUM = /\d+(?:[.,]\d+)?/g

/** Keep only the sentences whose numbers are all in `allowed`. */
export function groundNumbers(text: string, allowed: string): string[] {
  const ok = new Set((allowed.match(NUM) ?? []).map((n) => n.replace(',', '.')))
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => (s.match(NUM) ?? []).every((n) => ok.has(n.replace(',', '.'))))
}

/** The model's proposal, forced inside the rules. */
export function enforce(raw: unknown, ctx: CoachCtx, facts: string, now: Date): Program {
  const base = baseProgram(ctx)
  const p: any = raw && typeof raw === 'object' ? raw : {}
  const target = { ...base.target }
  for (const m of MUSCLES) {
    const n = Math.round(Number(p.target?.[m.id]))
    if (Number.isFinite(n)) target[m.id] = Math.max(RULES.setsLo, Math.min(RULES.setsHi, n))
  }
  const sessions = Number.isFinite(Number(p.sessions)) ? Math.max(RULES.minDays, Math.min(5, Math.round(Number(p.sessions)))) : base.sessions
  // A deload only when the rules say so, and always when they do.
  const dl = deloadCheck(ctx)
  const allowed = `${facts}\n${Object.values(target).join(' ')} ${sessions} ${RULES.setsLo} ${RULES.setsHi} ${RULES.minDays} ${RULES.sleepHours} 1 2 1.6 2.2`
  const said = (Array.isArray(p.lines) ? p.lines : String(p.lines ?? '').split('\n')).map(String).join('\n')
  let lines = groundNumbers(said, allowed)
  lines = groundReply(lines.join('\n'), { facts, said: '', now }).reply.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  // A line may not fight the rules (skipping a deload, training to failure).
  lines = lines.filter((l) => !/\b(skip|no|without)\b.*\bdeload\b/i.test(l) && !/\bto failure\b|\bfull failure\b/i.test(l))
  const ai = lines.length > 0
  if (dl.due && !lines.some((l) => /easy week|deload/i.test(l))) lines.unshift(dl.why)
  return { week: base.week, target, sessions, deload: dl.due, lines: (ai ? lines : base.lines).slice(0, 4), source: ai ? 'ai' : 'code' }
}

export function reviewPrompt(facts: string): string {
  return [
    'You are BEN, a strength coach for a home bodyweight athlete. The goal is to grow as fast as possible.',
    'HARD RULES you cannot break: each muscle (push, pull, legs, core) gets 10 to 20 hard sets a week on at least 2 days; sets stop 1-2 reps short of failure; progress in this order: more reps, then a harder variation or added weight, then back to the bottom of the range; deload only when the facts say it is due; protein 1.6-2.2 g/kg and sleep 7+ hours.',
    'Use ONLY numbers that appear in the facts below. Never invent a time, an event or a number.',
    'Write this week\'s program. Answer ONLY with JSON: {"target":{"push":n,"pull":n,"legs":n,"core":n},"sessions":n,"lines":[3 or 4 short plain sentences that say what changes and why]}',
    '',
    'FACTS',
    facts
  ].join('\n')
}

/** Once a week: ask the strong model, keep it inside the rules. `ask` null or failing gives the code's program. */
export async function weeklyReview(ctx: CoachCtx, ask: Ask | null, now = new Date()): Promise<Program> {
  if (!ask) return baseProgram(ctx)
  const facts = reviewFacts(ctx)
  try {
    const raw = await ask(reviewPrompt(facts), { json: true, strong: true, think: true, kind: 'weekly' })
    const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return enforce(j, ctx, facts, now)
  } catch {
    return baseProgram(ctx)
  }
}

/** True when there is no review for this week yet (one per Monday-to-Sunday week). */
export const reviewDue = (program: { week: string } | null | undefined, today: string) => !program || program.week < mondayOf(today)
