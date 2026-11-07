// One summary of today's plan, used by Ben's chat line and the plan card, so the
// headline, the card and the chat never disagree (pure, tested).
//
// Before: the chat said "Here's today's plan (v2), starting 13:25: 8 blocks", the
// card later said "5 blocks · 4h5m · v15" and the model's headline still said
// "3 must-dos · 8 blocks · 6h10". The version and the counts were read at
// different moments. Now every count comes from the live plan, the chat line
// carries no version (the card shows the live one), and the numbers in the
// model's headline are dropped once they no longer match.

export interface PlanLike {
  blocks: { title: string; start: string; minutes: number }[]
  mustdos: string[]
  headline?: string
}

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`)

/** Blocks, focus minutes and must-dos, counted the way the plan card counts them. */
export function planSummary(p: PlanLike): { blocks: number; focusMin: number; mustdos: number; start: string | null; text: string } {
  const blocks = p.blocks.length
  const focusMin = p.blocks.reduce((t, b) => t + Math.max(5, b.minutes || 0), 0)
  const mustdos = p.mustdos.length
  const start = [...p.blocks].map((b) => b.start).filter((s) => /^\d{1,2}:\d{2}$/.test(s)).sort()[0] ?? null
  const text = [`${blocks} block${blocks === 1 ? '' : 's'}`, `${hm(focusMin)} of focus`, mustdos ? `${mustdos} must-do${mustdos === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
  return { blocks, focusMin, mustdos, start, text }
}

/** "3 must-dos", "8 blocks", "6h10 focus", "2h 40m of focus": a count in a headline part. */
const COUNT = /^\s*(\d+\s*(must-?dos?|blocks?|tasks?)|\d+\s*h\s*\d*\s*m?\s*(of\s+)?(focus|deep work)?|\d+\s*min(utes)?\s*(of\s+)?(focus|deep work))\s*$/i

/** The model's headline without counts that no longer match the plan (the rest stays). */
export function liveHeadline(headline: string | undefined, p: PlanLike): string {
  const h = String(headline ?? '').trim()
  if (!h) return ''
  const s = planSummary(p)
  const parts = h.split(/\s*·\s*/)
  const kept = parts.filter((part) => {
    if (!COUNT.test(part)) return true
    const n = Number(/\d+/.exec(part)?.[0])
    if (/must/i.test(part)) return n === s.mustdos
    if (/block/i.test(part)) return n === s.blocks
    if (/task/i.test(part)) return false
    const m = /(\d+)\s*h\s*(\d+)?/i.exec(part)
    const min = m ? Number(m[1]) * 60 + Number(m[2] ?? 0) : Number(/(\d+)\s*min/i.exec(part)?.[1] ?? NaN)
    return min === s.focusMin
  })
  return kept.join(' · ')
}

/** The chat line for a new plan: the same numbers as the card, no version number. */
export function planMadeLine(p: PlanLike, ask = ''): string {
  const s = planSummary(p)
  return `Here's today's plan, starting ${s.start ?? 'now'}: ${s.text}.${ask || ' Look it over, then approve it or tell me what to change.'}`
}

/** He asks for a new plan while one is approved: asked first, never replaced silently. */
export const REPLACE_ASK = "Today's plan is already approved. Replace it with a new one from now? Done and pinned blocks stay where they are."
export const REPLACE_CHIPS = ['Yes, replace it', 'No, keep it']

/** "create a new plan", "make me a fresh plan", "redo my day": a new plan, not the current one. */
export function wantsNewPlan(text: string): boolean {
  const t = text.toLowerCase()
  return /\b(new|fresh|another|different|other)\s+(day\s+)?plan\b|\b(redo|remake|re-?do|start over|from scratch|scrap)\b.{0,20}\b(plan|day)\b|\b(plan|day)\b.{0,20}\b(again|from scratch|over)\b/.test(t)
}

/** His answer to REPLACE_ASK: 'yes', 'no' or null (something else). */
export function replaceAnswer(text: string): 'yes' | 'no' | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '')
  if (/^(yes,? )?replace( it| the( approved)? plan)?$|^(yes|yep|yeah|da|ok)[, ]+(replace|new one|make a new one)/.test(t)) return 'yes'
  if (/^(no,? )?keep( it| the( approved)? plan)$|^(no|nope|nu)[, ]+keep\b/.test(t)) return 'no'
  return null
}
