// Salary watch. Optional: settings.salary = { amount, currency, day, account }
// (amount in bani, day of the month 1-31, account may be ''). When the pay day
// plus 2 days has passed and no income of about that size (within 20%, on that
// account or any) is in the log, Money Home says so once, in one card.
// "Your real hourly pay this month" = the salary that came in ÷ your hours.
// Pure (the clock is passed in); screens/moneyb.js shows it.

import { B, account } from './model.js';
import { addDays, daysInMonth, monthKey } from './dates.js';
import { countsAsIncome } from './catshare.js';
import { rateToBase } from './fx.js';
import { invoiceHours } from './invoices.js';

export const GRACE_DAYS = 2;
export const TOLERANCE = 0.2;

/** The saved salary settings, or null when it is off. */
export function salaryConfig(state) {
  const s = state.settings?.salary;
  if (!s || !(s.amount > 0) || !(s.day >= 1 && s.day <= 31)) return null;
  return { amount: Math.round(s.amount), currency: s.currency || state.settings.currency || 'MDL', day: Math.floor(s.day), account: s.account || '' };
}

const clampDay = (key, day) => `${key}-${String(Math.min(day, daysInMonth(key))).padStart(2, '0')}`;

// What the expected salary is worth in your main currency (null when no rate is known).
function expectedBase(state, cfg) {
  const r = rateToBase(state, cfg.currency);
  return r > 0 ? Math.round(cfg.amount * r) : null;
}

/** Income records that look like this month's salary: ±20% of the expected amount, from 10 days before pay day until today. */
export function matchingIncome(state, cfg, payDate, today) {
  const exp = expectedBase(state, cfg);
  const from = addDays(payDate, -10);
  return state.tx.filter((t) => {
    if (!countsAsIncome(t) || t.date < from || t.date > today) return false;
    if (exp == null) return t.currency === cfg.currency && Math.abs(t.amount - cfg.amount) <= cfg.amount * TOLERANCE;
    return Math.abs(B(t) - exp) <= exp * TOLERANCE;
  });
}

// Hours worked this month: the hours on invoices paid this month, else the hours a month you set under "Your hour".
export function monthHours(state, key) {
  let h = 0;
  for (const inv of state.invoices || []) if (inv.paidDate && monthKey(inv.paidDate) === key) h += invoiceHours(inv);
  if (h > 0) return { hours: h, source: 'invoices' };
  const set = Number(state.settings?.workHour?.hoursPerMonth);
  return set > 0 ? { hours: set, source: 'set' } : null;
}

/**
 * @returns {null | { cfg, payDate, dueDate, late: boolean, received: object|null, hourly: null|{ rate: number, hours: number } }}
 * `late`: pay day + 2 days has passed and nothing matches. `dueDate` is the pay day.
 */
export function salaryStatus(state, today) {
  const cfg = salaryConfig(state);
  if (!cfg) return null;
  const key = monthKey(today);
  const payDate = clampDay(key, cfg.day);
  const found = matchingIncome(state, cfg, payDate, today).sort((a, b) => (a.date < b.date ? 1 : -1));
  const received = found[0] || null;
  const late = !received && today > addDays(payDate, GRACE_DAYS);
  let hourly = null;
  if (received) {
    const mh = monthHours(state, key);
    const got = found.filter((t) => monthKey(t.date) === key).reduce((a, t) => a + B(t), 0);
    if (mh && got > 0) hourly = { rate: Math.round(got / mh.hours), hours: mh.hours, source: mh.source };
  }
  return { cfg, payDate, dueDate: payDate, late, received, hourly, accountName: cfg.account ? account(state, cfg.account)?.name || '' : '' };
}
