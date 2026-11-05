// Ben's monthly AI budget. Spending is checked against the month so far:
// - normal: your chosen models, the strong one for plans and reviews;
// - save (80% used, or running 25% ahead of the month's pace): no strong /
//   thinking model, your chat model only;
// - minimal (budget used up): the cheap automatic model only, and the
//   nice-to-have extras (nudges in his own words, letters) use their
//   fixed text instead of an AI call.
export const DEFAULT_BUDGET_USD = 10
export const BUDGET_KEY = 'ai_budget'
export const EXTRAS = new Set(['nudge', 'letter'])

/** 'normal' | 'save' | 'minimal' for this month. budget <= 0: no limit. */
export function budgetTier(spent, budget, now = new Date()) {
  if (!(budget > 0)) return 'normal'
  if (spent >= budget) return 'minimal'
  const day = now.getUTCDate()
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const pace = (budget * day) / days
  if (spent >= budget * 0.8 || (day >= 3 && spent > pace * 1.25)) return 'save'
  return 'normal'
}

/** What a call may use at this tier. Throws for an extra when the budget is used up. */
export function budgetPlan(tier, opts = {}) {
  if (tier === 'minimal' && EXTRAS.has(opts.kind)) throw Object.assign(new Error('AI budget used up this month: using the fixed text'), { budget: true })
  return { strong: tier === 'normal' ? !!opts.strong : false, useChosen: tier !== 'minimal' }
}

/** Start of this month in UTC (ISO), for summing ai_usage. */
export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
