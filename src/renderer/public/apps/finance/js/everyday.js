// "Everyday only" for the Where-your-money-goes card. Pure (no page, no clock).
// Everyday spending leaves out (a) categories you marked as a work cost
// (category.workCost) and (b) one-off records: a single expense of at least
// the everyday limit (settings.everydayLimit, cents of the main currency;
// default 1 000 MDL, converted when your main currency is another one).
// "Everything" never goes through here, so its totals stay exactly as before.

import { convert } from './fx.js';
import { countsAsSpending } from './catshare.js';

export const DEFAULT_LIMIT_MDL = 100000; // 1 000 MDL, in cents

// The limit in cents of the main currency.
export function everydayLimit(settings, rates) {
  const own = Number(settings?.everydayLimit);
  if (Number.isFinite(own) && own > 0) return Math.round(own);
  const cur = settings?.currency || 'MDL';
  const c = convert(DEFAULT_LIMIT_MDL, 'MDL', cur, rates);
  return c > 0 ? c : DEFAULT_LIMIT_MDL;
}

// Ids of the expense categories marked as a work cost.
export const workCostIds = (settings) => new Set((settings?.categories || []).filter((c) => c.workCost).map((c) => c.id));

// A single expense at or above the limit (the limit itself counts as one-off).
export const isOneOff = (t, limit, base) => countsAsSpending(t) && base(t) >= limit;

// The records that count as everyday spending, plus how much was left out of
// the spending in [from, to] (main currency cents).
export function everydayList(list, { settings, rates, base, from, to }) {
  const limit = everydayLimit(settings, rates);
  const work = workCostIds(settings);
  const keep = [];
  let leftOut = 0;
  for (const t of list) {
    if (countsAsSpending(t) && (work.has(t.category) || isOneOff(t, limit, base))) {
      if ((from == null || t.date >= from) && (to == null || t.date <= to)) leftOut += base(t);
      continue;
    }
    keep.push(t);
  }
  return { list: keep, leftOut, limit };
}
