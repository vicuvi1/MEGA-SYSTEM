// "/why": every action Ben took keeps why (your words that led to it) and
// where its data came from (pure). The last 40 are kept.
export interface WhyEntry { at: string; action: string; because: string; source: string }
export const WHY_KEY = 'ben_why'

export function addWhy(list: WhyEntry[], actions: string[], because: string, source: string, at = new Date().toISOString()): WhyEntry[] {
  const real = actions.filter((a) => a && !/^⚠️/.test(a))
  if (!real.length) return list
  return [...list, ...real.map((action) => ({ at, action: action.slice(0, 160), because: because.replace(/\s+/g, ' ').trim().slice(0, 160), source }))].slice(-40)
}

/** The answer to /why: the last few actions, each with its reason and source. */
export function whyText(list: WhyEntry[], n = 5): string {
  if (!list.length) return "🤔 Nothing to explain yet: I haven't done anything for you lately."
  const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
  return ['🤔 <b>Why I did it</b>', ...list.slice(-n).reverse().map((w) => `• ${w.action}\n   <i>because you said:</i> “${w.because}” · ${hm(w.at)} · ${w.source}`)].join('\n')
}
