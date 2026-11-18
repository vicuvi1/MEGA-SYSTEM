// Monthly check-up (pure, tested). Once a month, on the day you pick (default
// the 1st), Money asks for each account: "Does your bank show X?" Yes only
// saves the check date. A different real balance adds ONE visible adjustment
// record ("Monthly check-up") that moves the balance but is marked
// notIncome / notSpending, so income and spending totals stay honest.
// Plain settings keys (they sync with the data):
//   checkupOn (missing = on), checkupDay (1-28, missing = 1),
//   checkupLast = { accountId: 'YYYY-MM-DD' } the last check of each account,
//   checkupSnooze = 'YYYY-MM-DD' "Not today".
// The reminder in Life System's bell (slot 'checkup', src/core/checkupNotice.ts)
// is sent once a month by src/renderer/src/money/checkupRunner.ts.

import { accountBalances, activeAccounts, uid } from './model.js';
import { monthKey } from './dates.js';

export const CHECKUP_NOTE = 'Monthly check-up';

export function checkupConfig(state) {
  const st = state.settings || {};
  const day = Number.isInteger(st.checkupDay) && st.checkupDay >= 1 && st.checkupDay <= 28 ? st.checkupDay : 1;
  return { on: st.checkupOn !== false, day, last: st.checkupLast && typeof st.checkupLast === 'object' ? st.checkupLast : {}, snooze: typeof st.checkupSnooze === 'string' ? st.checkupSnooze : '' };
}

/** The accounts to check: open accounts, with the date each was last checked ('' = never). */
export function checkupAccounts(state) {
  const { last } = checkupConfig(state);
  return activeAccounts(state).map((a) => ({ account: a, last: last[a.id] || '' }));
}

/** Accounts not yet checked this month. */
export function unchecked(state, today) {
  const start = `${monthKey(today)}-01`;
  return checkupAccounts(state).filter((x) => !x.last || x.last < start);
}

/** Is the check-up due (the reminder): on, the day has come, something is left this month. Returns { month, left } or null. */
export function checkupDue(state, today) {
  const c = checkupConfig(state);
  if (!c.on || Number(today.slice(8, 10)) < c.day) return null;
  const left = unchecked(state, today);
  return left.length ? { month: monthKey(today), left } : null;
}

/** The Home card: due and not snoozed for today. */
export const checkupCard = (state, today) => {
  const due = checkupDue(state, today);
  return due && checkupConfig(state).snooze !== today ? due : null;
};

/**
 * You looked at the bank. `real` = the balance the bank shows (cents, the account's
 * currency), or null for "Yes, the same". Adds the adjustment only when it differs.
 * Returns { expected, diff, tx }.
 */
export function applyCheckup(state, accountId, real, today, { id = `chk-${uid()}`, now = Date.now(), rate = 1 } = {}) {
  const acc = state.settings.accounts.find((a) => a.id === accountId);
  if (!acc) return { expected: 0, diff: 0, tx: null };
  const expected = accountBalances(state, today)[accountId] || 0;
  const diff = real == null ? 0 : real - expected;
  let tx = null;
  if (diff) {
    const out = diff < 0;
    const amount = Math.abs(diff);
    const cur = acc.currency || state.settings.currency;
    const r = cur === state.settings.currency ? 1 : rate;
    tx = {
      id, createdAt: now, updatedAt: now, type: out ? 'expense' : 'income', amount, currency: cur, rate: r, base: Math.round(amount * r), date: today,
      category: out ? 'other' : 'other-in', account: accountId, note: CHECKUP_NOTE, checkup: true,
      ...(out ? { notSpending: true } : { notIncome: true }),
    };
    state.tx.push(tx);
  }
  state.settings.checkupLast = { ...(state.settings.checkupLast || {}), [accountId]: today };
  state.settings.updatedAt = now;
  return { expected, diff, tx };
}

export function snoozeCheckup(state, today, now = Date.now()) {
  state.settings.checkupSnooze = today;
  state.settings.updatedAt = now;
}

export function setCheckup(state, { on, day }, now = Date.now()) {
  if (on !== undefined) state.settings.checkupOn = !!on;
  if (day !== undefined && Number.isInteger(day) && day >= 1 && day <= 28) state.settings.checkupDay = day;
  state.settings.updatedAt = now;
}
