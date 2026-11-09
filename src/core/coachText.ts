// The day's one friendly line + one tip: asked of the AI once a morning and
// kept in coach_days, with a template when the AI fails or the budget is out.
// Every number in the text must come from the plan (the benGround rule), and
// the safety rules run on every sentence. Pure.
import type { DailyPlan, DayLine, TipKey } from './coachPlan'
import type { CoachLang } from './coachConfig'
import { safeText } from './coachSafety'

export const AI_WORDS = 80
/** A template line is tried again with the AI after this long (at most twice a day). */
export const AI_RETRY_MS = 2 * 3600_000
export const AI_TRIES = 2

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export const TIPS: Record<TipKey, Record<CoachLang, string>> = {
  'eat-more': { en: 'Add a glass of milk to two meals today: easy food, real growth.', ro: 'Adaugă un pahar de lapte la două mese azi: mâncare ușoară, creștere reală.' },
  ramp: { en: 'Eat a little more each day this week. Your stomach gets used to it fast.', ro: 'Mănâncă puțin mai mult în fiecare zi săptămâna asta. Stomacul se obișnuiește repede.' },
  'catch-up': { en: 'A missed day is fine. Do this one and the week is back on track.', ro: 'O zi ratată e ok. Fă-o pe asta și săptămâna e din nou pe drum.' },
  'beat-last': { en: 'Beat last time by one rep on one set. That is progress.', ro: 'Bate data trecută cu o repetare la un set. Asta e progres.' },
  'rest-eat': { en: 'Muscles grow on rest days. Eat every meal and walk a little.', ro: 'Mușchii cresc în zilele de pauză. Mănâncă toate mesele și plimbă-te puțin.' },
  recover: { en: 'Sleep is part of the workout. Lights off on time tonight.', ro: 'Somnul face parte din antrenament. Stinge lumina la timp diseară.' },
  sleep: { en: 'Put the phone away 30 min before bed. You fall asleep faster.', ro: 'Lasă telefonul cu 30 de minute înainte de culcare. Adormi mai repede.' },
  protein: { en: 'Have some protein at every meal: eggs, brânză, milk or meat.', ro: 'Pune proteină la fiecare masă: ouă, brânză, lapte sau carne.' },
  weigh: { en: 'Weigh in after the toilet, before breakfast. Only the weekly average matters.', ro: 'Cântărește-te după toaletă, înainte de micul dejun. Contează doar media săptămânii.' }
}

/** The line without the AI: from the plan's own numbers. */
export function templateLine(plan: DailyPlan, lang: CoachLang = 'en'): { line: string; tip: string } {
  const t = plan.training
  const meals = plan.food.meals.length
  const kcal = fmt(plan.food.kcal)
  const ro = lang === 'ro'
  const train =
    t.kind === 'session'
      ? ro
        ? `Azi: ${t.title}, ${t.minutes} min.`
        : `Today: ${t.title}, ${t.minutes} min.`
      : t.kind === 'rest'
        ? ro
          ? 'Azi e zi de pauză: plimbare 20 min.'
          : 'Rest day today: walk 20 min.'
        : ro
          ? 'Antrenamentul de azi e gata.'
          : "Today's workout is done."
  const food = ro ? `Mănâncă ${kcal} kcal în ${meals} mese.` : `Eat ${kcal} kcal over ${meals} meals.`
  return { line: `${train} ${food}`, tip: TIPS[plan.focus][lang] }
}

/** The numbers the text may use: everything in the plan (and small counting words). */
export function planNumbers(plan: DailyPlan): Set<string> {
  const s = new Set<string>()
  const add = (n: number | string) => {
    const v = String(n).replace(/,/g, '')
    if (v) s.add(v)
  }
  const t = plan.training
  if (t.kind === 'session') {
    add(t.minutes)
    for (const m of t.moves) {
      add(m.sets)
      for (const x of m.last.match(/\d+(\.\d+)?/g) ?? []) add(x)
    }
  }
  add(plan.food.kcal)
  add(plan.food.protein)
  add(plan.food.meals.length)
  if (plan.food.ramp) add(plan.food.ramp)
  for (const m of plan.food.meals) {
    add(m.kcal)
    add(m.protein)
    for (const x of m.items.match(/\d+(\.\d+)?/g) ?? []) add(x)
  }
  for (const e of [...plan.food.extras, plan.food.change ?? '', ...plan.morning.map((x) => `${x.label} ${x.min ?? ''}`)]) for (const x of e.match(/\d+(\.\d+)?/g) ?? []) add(x)
  for (const n of ['1', '2', '3', '20', '30']) add(n)
  return s
}

/** The prompt for the AI (one call, short): the coach's voice, the plan as data, a JSON answer. */
export function aiPrompt(plan: DailyPlan, lang: CoachLang, context: string): string {
  const t = plan.training
  const data = {
    training: t.kind === 'session' ? { session: t.title, minutes: t.minutes, moves: t.moves.map((m) => `${m.name} ${m.sets} sets (${m.last})`) } : t.kind,
    food: { kcal: plan.food.kcal, protein: plan.food.protein, meals: plan.food.meals.map((m) => m.label), extras: plan.food.extras, change: plan.food.change, rampWeek: plan.food.ramp },
    focus: plan.focus
  }
  return [
    `You are Ben, a friendly, short, practical fitness coach for a 19-year-old student gaining muscle slowly at home (+0.25–0.5 kg a week). Write in ${lang === 'ro' ? 'Romanian' : 'English'}.`,
    `Rules: at most ${AI_WORDS} words in total; one concrete action; use ONLY numbers from the data below; no comments about his body or daily weight; never suggest eating less; no supplements except an optional protein shake or creatine 3–5 g; no medical advice.`,
    'Answer only JSON: {"line": "<one friendly sentence about today>", "tip": "<one concrete tip>"}',
    `Data: ${JSON.stringify(data)}`,
    context ? `Context:\n${context}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length

/**
 * The AI's answer, checked: JSON with line and tip, short, every number from
 * the plan, every sentence safe. null: use the template.
 */
export function parseAiLine(text: string, plan: DailyPlan): { line: string; tip: string } | null {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''))
  if (!m) return null
  let j: any
  try {
    j = JSON.parse(m[0])
  } catch {
    return null
  }
  const line = safeText(String(j?.line ?? '').trim())
  const tip = safeText(String(j?.tip ?? '').trim())
  if (!line || !tip || words(`${line} ${tip}`) > AI_WORDS) return null
  const ok = planNumbers(plan)
  for (const n of `${line} ${tip}`.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(\.\d+)?/g) ?? []) if (!ok.has(n)) return null
  return { line, tip }
}

/** True when the day's line should be (re)asked: none yet, or a template from 2+ h ago (at most 2 tries). */
export function needsAi(line: DayLine | undefined, now: number, aiOn: boolean, key?: string): boolean {
  if (!aiOn) return false
  if (!line) return true
  // The plan changed since (a workout logged, a session moved): one more try for the new plan.
  if (key && line.key && line.key !== key) return line.tries < AI_TRIES + 1
  return line.src === 'template' && line.tries < AI_TRIES && now - line.at >= AI_RETRY_MS
}

/** What the line depends on: today's training and the kcal goal. */
export const planKey = (plan: DailyPlan) => `${plan.training.kind === 'rest' ? 'rest' : plan.training.kind === 'done' ? 'done' : plan.training.type}|${plan.food.kcal}`

/** The line to show now: the kept AI line while the plan is the same, else the template from today's plan. */
export function lineToShow(plan: DailyPlan, lang: CoachLang, kept: DayLine | undefined): { line: string; tip: string; src: 'ai' | 'template' } {
  if (kept && kept.src === 'ai' && (!kept.key || kept.key === planKey(plan))) return { line: kept.line, tip: kept.tip, src: 'ai' }
  return { ...templateLine(plan, lang), src: 'template' }
}

/** The day's line as stored: the AI's when it passed, else the template. */
export function dayLineFrom(plan: DailyPlan, lang: CoachLang, aiText: string | null, prev: DayLine | undefined, now: number): DayLine {
  const tries = (prev?.tries ?? 0) + 1
  const ai = aiText ? parseAiLine(aiText, plan) : null
  const t = ai ?? templateLine(plan, lang)
  return { line: t.line, tip: t.tip, src: ai ? 'ai' : 'template', lang, at: now, tries, key: planKey(plan) }
}
