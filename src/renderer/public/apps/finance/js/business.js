// The Business view's numbers (Money v2 phase 2): this month's profit, income
// per client, unpaid and overdue invoices, hours billed and what an hour
// earned, costs by category, business cash and what you paid yourself.
// Everything is read from the Business book (books.js bookView), and can be
// shown in MDL (the main currency), USD or EUR: each record is converted at
// the rate of its own day (fx.js rateOnDay: the saved day rate, else today's),
// and a record already in that currency keeps its own amount.
// Pure and tested (web/financeBusiness.test.ts).

import { B, accountBalances, knownRates } from './model.js';
import { countsAsIncome, countsAsSpending } from './catshare.js';
import { bookView, bookTotals, crossKind, FROM_BIZ } from './books.js';
import { invoiceStatus, invoiceTotal, invoiceHours } from './invoices.js';
import { hourlyRate } from './workhours.js';
import { rateOnDay, convert, perUsd } from './fx.js';
import { monthKey, addMonths, daysInMonth } from './dates.js';

export const REPORT_CURRENCIES = ['MDL', 'USD', 'EUR'];
export const REPORT_CUR_KEY = 'money_biz_currency';

const pad = (n) => String(n).padStart(2, '0');
export const monthRange = (key) => ({ from: `${key}-01`, to: `${key}-${pad(daysInMonth(key))}` });

// One record's value in `cur` (cents) at the rate of its own day; null when no rate is known.
export function valueIn(state, t, cur) {
  const base = state.settings.currency || 'MDL';
  if (!cur || cur === base) return B(t);
  if (t.currency === cur && Number.isInteger(t.amount) && t.type !== 'transfer') return t.amount;
  const r = rateOnDay(state, cur, t.date); // 1 cur = r base
  return r > 0 ? Math.round(B(t) / r) : null;
}

// A main-currency amount of a given day in `cur`.
export function baseIn(state, cents, cur, date) {
  const base = state.settings.currency || 'MDL';
  if (!cur || cur === base) return cents;
  const r = rateOnDay(state, cur, date);
  return r > 0 ? Math.round(cents / r) : null;
}

function sum(state, list, cur) {
  let total = 0; let missing = 0;
  for (const t of list) {
    const v = valueIn(state, t, cur);
    if (v == null) missing++; else total += v;
  }
  return { total, missing };
}

const inRange = (t, from, to) => t.date >= from && t.date <= to;

// One month of the business: income, costs, profit, paid to you, money put in,
// costs by category and income by client.
export function businessMonth(state, key, cur = state.settings.currency) {
  const { from, to } = monthRange(key);
  return businessPeriod(state, from, to, cur);
}

export function businessPeriod(state, from, to, cur = state.settings.currency) {
  const v = bookView(state, 'business');
  const list = v.tx.filter((t) => inRange(t, from, to));
  const incomes = list.filter((t) => countsAsIncome(t) && !(t.synthetic && t.category === FROM_BIZ));
  const costs = list.filter(countsAsSpending);
  const kindOf = (t) => (t.synthetic ? t.cross : crossKind(state, t));
  const drawsList = list.filter((t) => t.type === 'transfer' && !t.loan && ['draw', 'personalFromBiz'].includes(kindOf(t)));
  const inList = list.filter((t) => t.type === 'transfer' && !t.loan && ['ownerIn', 'personalIncomeToBiz'].includes(kindOf(t)));
  const income = sum(state, incomes, cur);
  const cost = sum(state, costs, cur);
  const byCost = new Map();
  for (const t of costs) byCost.set(t.category, (byCost.get(t.category) || 0) + (valueIn(state, t, cur) || 0));
  return {
    from, to, currency: cur,
    income: income.total,
    costs: cost.total,
    profit: income.total - cost.total,
    draws: sum(state, drawsList, cur).total,
    ownerIn: sum(state, inList, cur).total,
    missing: income.missing + cost.missing,
    byCost: [...byCost.entries()].map(([id, amount]) => ({ id, amount })).sort((a, b) => b.amount - a.amount),
    byClient: clientIncome(state, from, to, cur),
  };
}

// Business income per client (the record's person), biggest first, with its share.
export function clientIncome(state, from, to, cur = state.settings.currency) {
  const v = bookView(state, 'business');
  const by = new Map();
  for (const t of v.tx) {
    if (!inRange(t, from, to) || !countsAsIncome(t) || (t.synthetic && t.category === FROM_BIZ)) continue;
    const id = t.person || null;
    const row = by.get(id) || { person: id ? state.people.find((p) => p.id === id) || null : null, id, amount: 0, invoices: 0 };
    row.amount += valueIn(state, t, cur) || 0;
    if (t.invoice) row.invoices++;
    by.set(id, row);
  }
  const rows = [...by.values()].sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? r.amount / total : 0 }));
}

// Invoices sent and not paid: how many, their total per currency (and in
// `cur` at today's rates), and the overdue ones.
export function openInvoices(state, today, cur = state.settings.currency) {
  const open = (state.invoices || []).filter((i) => ['sent', 'overdue'].includes(invoiceStatus(i, today)));
  const byCurrency = {};
  for (const i of open) byCurrency[i.currency] = (byCurrency[i.currency] || 0) + invoiceTotal(i);
  const rates = knownRates(state);
  let total = 0; let missing = 0;
  for (const [c, amount] of Object.entries(byCurrency)) {
    const x = c === cur ? amount : convert(amount, c, cur, rates);
    if (x == null) missing++; else total += x;
  }
  const overdue = open.filter((i) => invoiceStatus(i, today) === 'overdue').sort((a, b) => String(a.due).localeCompare(String(b.due)));
  return { count: open.length, total, missing, byCurrency, overdue, open };
}

// Hours billed on invoices dated in the period, what they bring, and what an hour earned.
export function hoursMoney(state, from, to, today, cur = state.settings.currency) {
  const rates = knownRates(state);
  let hours = 0; let earned = 0;
  for (const inv of state.invoices || []) {
    if (!(inv.date >= from && inv.date <= to)) continue;
    const h = invoiceHours(inv);
    if (!(h > 0)) continue;
    hours += h;
    const amount = invoiceTotal(inv);
    const x = inv.currency === cur ? amount : convert(amount, inv.currency, cur, rates);
    earned += x || 0;
  }
  const r = hourlyRate(state, today);
  const rateIn = r ? baseIn(state, r.rate, cur, today) : null;
  return { hours: Math.round(hours * 10) / 10, earned, perHour: hours > 0 ? Math.round(earned / hours) : rateIn, source: hours > 0 ? 'invoices' : r?.source || null };
}

// Money in business accounts today, in `cur`.
export function businessCash(state, cur = state.settings.currency) {
  const v = bookView(state, 'business');
  const bal = accountBalances(v);
  const rates = knownRates(state);
  const byAccount = v.settings.accounts.filter((a) => !a.archived).map((a) => {
    const own = bal[a.id] || 0;
    const inCur = (a.currency || state.settings.currency) === cur ? own : convert(own, a.currency || state.settings.currency, cur, rates);
    return { account: a, own, inCur };
  });
  return { total: byAccount.reduce((a, x) => a + (x.inCur || 0), 0), byAccount };
}

// Profit for the last n months (oldest first), for the small chart.
export function profitSeries(state, today, n = 6, cur = state.settings.currency) {
  const now = monthKey(today);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addMonths(now, -i);
    const m = businessMonth(state, key, cur);
    out.push({ key, income: m.income, costs: m.costs, profit: m.profit });
  }
  return out;
}

// Records in business accounts that you moved to Personal, and the business
// view's totals for a quick check (Both = Personal + Business − cross-book).
export function businessSummary(state, today, cur = state.settings.currency) {
  const key = monthKey(today);
  const month = businessMonth(state, key, cur);
  const year = businessPeriod(state, `${today.slice(0, 4)}-01-01`, today, cur);
  const inv = openInvoices(state, today, cur);
  const hours = hoursMoney(state, `${key}-01`, today, today, cur);
  const hoursYear = hoursMoney(state, `${today.slice(0, 4)}-01-01`, today, today, cur);
  const cash = businessCash(state, cur);
  return { key, currency: cur, month, year, invoices: inv, hours, hoursYear, cash, series: profitSeries(state, today, 6, cur), knownRate: cur === state.settings.currency || !!perUsd(knownRates(state), cur) };
}

export { bookTotals };
