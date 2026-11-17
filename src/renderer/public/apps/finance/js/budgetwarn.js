// Budget warnings at 80% and 100% (#8), the pure part. When a category's
// spending this month reaches 80% and then 100% of its monthly budget
// (category.budget, the same numbers as Plan -> Monthly Budgets), Life System
// sends one calm notification for each, once per category per month
// (src/renderer/src/money/budgetWarnRunner.ts, core/budgetNotice.ts, slot
// 'budgetwarn' of the 4-a-day push budget). A jump past both at once sends
// only the 100% one. The switch is settings.budgetWarn (missing = on), a
// plain settings key that syncs with the data.

import { budgetStatus } from './model.js';
import { monthKey } from './dates.js';
import { isMoneyHidden } from './money.js';

export const LEVELS = [80, 100];

/** Budget warnings are on unless switched off in Settings. */
export const warningsOn = (state) => state?.settings?.budgetWarn !== false;

/** The key of one warning: "2026-11:food:80". */
export const warnKey = (month, cat, level) => `${month}:${cat}:${level}`;

/** Each budgeted category at or past 80% this month: { month, cat, name, level, pct, spent, budget }. */
export function budgetCrossings(state, today) {
  if (!state?.settings?.categories) return [];
  const month = monthKey(today);
  const out = [];
  for (const r of budgetStatus(state, month, today).rows) {
    if (!(r.budget > 0)) continue;
    const level = r.spent >= r.budget ? 100 : r.spent >= r.budget * 0.8 ? 80 : 0;
    if (!level) continue;
    out.push({ month, cat: r.category.id, name: r.category.name, level, pct: Math.floor((r.spent / r.budget) * 100), spent: Math.round(r.spent), budget: r.budget });
  }
  return out;
}

/**
 * Which warnings to send now, given the keys already sent this month.
 * Returns { warn: [crossing], keys: [every key now sent, old ones included] }.
 */
export function newWarnings(crossings, sentKeys = []) {
  const sent = new Set(sentKeys);
  const warn = [];
  for (const c of crossings || []) {
    const top = warnKey(c.month, c.cat, c.level);
    if (!sent.has(top)) warn.push(c);
    for (const l of LEVELS) if (l <= c.level) sent.add(warnKey(c.month, c.cat, l));
  }
  return { warn, keys: [...sent] };
}

/**
 * Amounts are hidden (Space shows them): then a warning names the percentage only.
 * This is the real privacy state (js/privacy.js flips it through money.js), not a guess.
 */
export const amountsHidden = () => isMoneyHidden();

/** Keeps only this month's keys (the guard starts over each month). */
export const thisMonthKeys = (keys, month) => (Array.isArray(keys) ? keys.filter((k) => typeof k === 'string' && k.startsWith(`${month}:`)) : []);
