// Business and personal books (Money v2 phase 2, docs/design/money/money-v2-plan.md D3/D4).
// A record's book comes from its account (`account.book`, missing = personal)
// unless the record says otherwise (`t.book`). So all existing data is
// Personal with zero writes. Personal / Business / Both are read-only views:
// bookView() builds a copy whose records and accounts are those of one book;
// money that crosses books shows as a synthetic record (marked `synthetic`,
// `of: <real id>`, same id so a tap opens the real one). "Both" is the full
// state, unchanged. Nothing here writes, except moveToBook / undoMove /
// setAccountBook, which only set or clear record fields and stamp updatedAt.
// Pure and tested (web/financeBooks.test.ts).

import { B, touch, uid } from './model.js';
import { countsAsIncome, countsAsSpending } from './catshare.js';

export const BOOKS = ['personal', 'business'];
export const VIEWS = ['personal', 'business', 'both'];
export const BOOK_NAMES = { personal: 'Personal', business: 'Business', both: 'Both' };
// This device's pick, shared by Finance Helper and Life's Money page (same origin).
export const BOOK_KEY = 'money_book';
// The income category a draw shows under in the Personal view.
export const FROM_BIZ = 'from-business';
const FROM_BIZ_CAT = { id: FROM_BIZ, type: 'income', name: 'From your business', emoji: '💼', jar: undefined };

const isBook = (b) => b === 'personal' || b === 'business';
export const isView = (v) => VIEWS.includes(v);
const accountOf = (state, id) => (id == null ? null : state.settings.accounts.find((a) => a.id === id) || null);

// Books are on once you turned them on or marked any account Business.
export const booksOn = (state) => !!state?.settings?.books?.on || (state?.settings?.accounts || []).some((a) => a.book === 'business');

export const accountBook = (a) => (a && a.book === 'business' ? 'business' : 'personal');
export const bookOfAccount = (state, id) => accountBook(accountOf(state, id));

// The book of an income or expense: its own when set, else its account's.
export function bookOf(state, t) {
  if (isBook(t?.book)) return t.book;
  return bookOfAccount(state, t?.account);
}

// Each side of a transfer belongs to its account's book.
export function transferBooks(state, t) {
  return { from: bookOfAccount(state, t.from), to: bookOfAccount(state, t.to) };
}

// How a record crosses books (null when it stays in one):
// draw: transfer business -> personal (pay yourself; today's salary too)
// ownerIn: transfer personal -> business (money put in)
// paidForBiz: a business expense paid from a personal account
// bizIncomeToPersonal: business income received into a personal account
// personalFromBiz: a personal expense paid from a business account
// personalIncomeToBiz: personal income received into a business account
export function crossKind(state, t) {
  if (!t) return null;
  if (t.type === 'transfer') {
    const s = transferBooks(state, t);
    if (s.from === s.to) return null;
    return s.from === 'business' ? 'draw' : 'ownerIn';
  }
  const own = bookOf(state, t);
  const acc = bookOfAccount(state, t.account);
  if (own === acc) return null;
  if (t.type === 'expense') return own === 'business' ? 'paidForBiz' : 'personalFromBiz';
  return own === 'business' ? 'bizIncomeToPersonal' : 'personalIncomeToBiz';
}

const synth = (t, over) => ({ ...t, ...over, synthetic: true, of: t.id });
// The other book as a named side of a synthetic transfer (no balance: it is not an account).
export const BOOK_SIDE = { business: 'book:business', personal: 'book:personal' };
const SIDE_ACCOUNTS = [
  { id: BOOK_SIDE.business, name: 'Business', emoji: '💼', archived: true, holdings: [] },
  { id: BOOK_SIDE.personal, name: 'Personal', emoji: '🙂', archived: true, holdings: [] },
];
const CROSS_NOTE = { paidForBiz: 'Paid for business', personalFromBiz: 'Paid to you', personalIncomeToBiz: 'Owner money in' };

// The records of one book, cross-book money as synthetic records (D4 table).
function viewRecords(state, book) {
  const out = [];
  for (const t of state.tx) {
    const kind = crossKind(state, t);
    if (!kind) {
      const b = t.type === 'transfer' ? transferBooks(state, t).from : bookOf(state, t);
      if (b === book) out.push(t);
      continue;
    }
    if (kind === 'draw' || kind === 'ownerIn') {
      const toAcc = accountOf(state, t.to);
      if (kind === 'draw' && book === 'personal') {
        // Pay yourself: income for you.
        const amount = Number.isInteger(t.toAmount) ? t.toAmount : t.amount;
        out.push(synth(t, { type: 'income', category: FROM_BIZ, account: t.to, amount, currency: toAcc?.currency || t.currency, base: B(t), from: undefined, to: undefined, toAmount: undefined }));
      } else {
        // Business sees "Paid to you" / "Owner money in"; Personal sees money put in going out. Never income or a cost.
        out.push(t);
      }
      continue;
    }
    const acc = t.account;
    if (kind === 'paidForBiz' || kind === 'personalFromBiz') {
      // The expense counts in its own book; the account's book sees money leaving (not spending).
      if (bookOf(state, t) === book) out.push(t);
      else out.push(synth(t, { type: 'transfer', from: acc, to: kind === 'paidForBiz' ? BOOK_SIDE.business : BOOK_SIDE.personal, account: undefined, category: undefined, cross: kind, note: t.note ? `${CROSS_NOTE[kind]} · ${t.note}` : CROSS_NOTE[kind] }));
      continue;
    }
    // bizIncomeToPersonal / personalIncomeToBiz
    if (bookOf(state, t) === book) out.push(t);
    else if (kind === 'bizIncomeToPersonal') out.push(synth(t, { category: FROM_BIZ, cross: kind }));
    else out.push(synth(t, { type: 'transfer', from: BOOK_SIDE.personal, to: acc, account: undefined, category: undefined, cross: kind, note: t.note ? `${CROSS_NOTE[kind]} · ${t.note}` : CROSS_NOTE[kind] }));
  }
  return out;
}

function parts(state, book) {
  const tx = viewRecords(state, book);
  const accounts = state.settings.accounts.filter((a) => accountBook(a) === book);
  const hasFromBiz = book === 'personal' && tx.some((t) => t.synthetic && t.category === FROM_BIZ);
  const categories = hasFromBiz && !state.settings.categories.some((c) => c.id === FROM_BIZ)
    ? [...state.settings.categories, FROM_BIZ_CAT] : state.settings.categories;
  return { tx, accounts, categories };
}

const mark = (obj, book, state) => {
  Object.defineProperty(obj, '_view', { value: book, enumerable: false });
  // Names of accounts in the other book still resolve (a draw's other side).
  Object.defineProperty(obj, '_allAccounts', { value: [...state.settings.accounts, ...SIDE_ACCOUNTS], enumerable: false });
  return obj;
};

// A read-only copy of one book ("both" or anything unknown: the state itself).
// store.js refuses to save a state with `_view`.
export function bookView(state, book) {
  if (!state || !isBook(book)) return state;
  const p = parts(state, book);
  const view = { ...state, tx: p.tx, settings: { ...state.settings, accounts: p.accounts, categories: p.categories } };
  return Object.freeze(mark(view, book, state));
}

// The same view for drawing Finance Helper's screens: reads see one book,
// small writes a screen makes while drawing (meta, settings flags) reach the
// real data, and the record and account lists can never be replaced from it.
export function bookLens(state, book) {
  if (!state || !isBook(book)) return state;
  const p = parts(state, book);
  const LISTS = ['accounts', 'categories'];
  const settings = new Proxy(state.settings, {
    get: (t, k) => (k === 'accounts' ? p.accounts : k === 'categories' ? p.categories : Reflect.get(t, k)),
    set: (t, k, v) => (LISTS.includes(k) ? true : Reflect.set(t, k, v)),
  });
  return new Proxy(state, {
    get: (t, k) => (k === 'tx' ? p.tx : k === 'settings' ? settings : k === '_view' ? book : k === '_allAccounts' ? [...state.settings.accounts, ...SIDE_ACCOUNTS] : k === '_real' ? state : Reflect.get(t, k)),
    set: (t, k, v) => (k === 'tx' || k === 'settings' ? true : Reflect.set(t, k, v)),
  });
}

const inRange = (t, from, to) => (!from || t.date >= from) && (!to || t.date <= to);

// Totals of one view between two dates (main currency).
// income: all income the book sees; extIncome: without money from the other
// book (draws); spent: costs (the shared spending rule); draws: paid to you;
// ownerIn: money put into the business.
export function bookTotals(state, from, to, book) {
  const v = isBook(book) ? bookView(state, book) : state;
  let income = 0; let extIncome = 0; let spent = 0; let draws = 0; let ownerIn = 0;
  for (const t of v.tx) {
    if (!inRange(t, from, to)) continue;
    if (countsAsIncome(t)) {
      income += B(t);
      if (!(t.synthetic && t.category === FROM_BIZ)) extIncome += B(t);
      if (t.synthetic && t.category === FROM_BIZ) draws += B(t);
    } else if (countsAsSpending(t)) spent += B(t);
    else if (t.type === 'transfer' && !t.loan) {
      const k = t.synthetic ? t.cross : crossKind(state, t);
      if (k === 'draw' || k === 'personalFromBiz') { if (book === 'business') draws += B(t); }
      else if (k === 'ownerIn' || k === 'personalIncomeToBiz') { if (book === 'business') ownerIn += B(t); }
    }
  }
  return { income, extIncome, spent, draws, ownerIn, net: income - spent, savingsRate: income > 0 ? (income - spent) / income : null };
}

// Categories to offer in a book: its own, those for both, and those with no book.
export function categoriesFor(state, book, type) {
  return state.settings.categories.filter((c) => (!type || c.type === type) && (!isBook(book) || !isBook(c.book) || c.book === book || c.book === 'both'));
}

// The book a new record goes to: the view you are in, else the category's
// own book, else the account's.
export function defaultBook(state, { account, category, uiBook } = {}) {
  if (isBook(uiBook)) return uiBook;
  const c = state.settings.categories.find((x) => x.id === category);
  if (isBook(c?.book)) return c.book;
  return bookOfAccount(state, account);
}

// Sets the book field on a record being saved: an edit keeps the record's
// book (the edit sheet rebuilds the record); a new income or expense gets
// `book` only when it differs from its account's.
export function stampBook(state, tx, existing, uiBook) {
  if (!tx || tx.type === 'transfer') {
    if (existing?.draw) tx.draw = existing.draw;
    return tx;
  }
  if (existing) {
    if (isBook(existing.book)) tx.book = existing.book;
    if (existing.moved) tx.moved = existing.moved;
    return tx;
  }
  const b = defaultBook(state, { account: tx.account, category: tx.category, uiBook });
  if (b !== bookOfAccount(state, tx.account)) tx.book = b;
  return tx;
}

// Moves records to a book: sets or clears `t.book` and keeps
// `t.moved = {from, at, batch}` so the move can be undone exactly.
// Transfers follow their accounts and are left alone.
export function moveToBook(state, ids, book, now = Date.now()) {
  if (!isBook(book)) return { moved: 0, batch: null };
  const want = new Set(ids);
  const batch = `mv-${uid()}`;
  let moved = 0;
  for (const t of state.tx) {
    if (!want.has(t.id) || t.type === 'transfer' || bookOf(state, t) === book) continue;
    const from = isBook(t.book) ? t.book : null;
    if (book === bookOfAccount(state, t.account)) delete t.book; else t.book = book;
    t.moved = { from, at: now, batch };
    touch(t, now);
    moved++;
  }
  return { moved, batch: moved ? batch : null };
}

// Undoes one move: each record gets its old book back, unless it was edited
// after the move (that one keeps the edit).
export function undoMove(state, batch, now = Date.now()) {
  let restored = 0; let keptEdited = 0;
  for (const t of state.tx) {
    if (!batch || t.moved?.batch !== batch) continue;
    if ((t.updatedAt || 0) !== t.moved.at) { keptEdited++; continue; }
    if (isBook(t.moved.from)) t.book = t.moved.from; else delete t.book;
    delete t.moved;
    touch(t, now);
    restored++;
  }
  return { restored, keptEdited };
}

// Moves are listed newest first for "Undo move" (one per batch still undoable).
export function moveBatches(state) {
  const by = new Map();
  for (const t of state.tx) {
    if (!t.moved?.batch) continue;
    const b = by.get(t.moved.batch) || { batch: t.moved.batch, at: t.moved.at, count: 0, to: bookOf(state, t) };
    b.count++;
    by.set(t.moved.batch, b);
  }
  return [...by.values()].sort((a, b) => b.at - a.at);
}

// Marks an account Personal or Business. Its records without their own book
// move with it. Keeps `moved` on the account for Undo; turns books on.
export function setAccountBook(state, accountId, book, now = Date.now()) {
  const a = accountOf(state, accountId);
  if (!a || !isBook(book)) return null;
  const before = accountBook(a);
  const records = state.tx.filter((t) => (t.account === accountId || t.from === accountId || t.to === accountId) && !isBook(t.book)).length;
  if (before === book) return { before, records: 0 };
  if (book === 'business') a.book = 'business'; else delete a.book;
  a.moved = { from: before, at: now };
  touch(a, now);
  if (book === 'business' && !state.settings.books?.on) {
    state.settings.books = { on: true, ...(state.settings.books || {}), updatedAt: now };
    state.settings.books.on = true;
    state.settings.updatedAt = now;
  }
  return { before, records };
}

// "Pay yourself": a transfer from a business account to a personal one,
// marked as a draw. Personal shows it as income, Business as "Paid to you",
// Both as a plain transfer.
export function drawTx(state, { from, to, amount, date, note = '', id = uid(), now = Date.now() }) {
  const a = accountOf(state, from);
  const b = accountOf(state, to);
  if (!a || !b || accountBook(a) !== 'business' || accountBook(b) !== 'personal' || !(Number.isInteger(amount) && amount > 0)) return null;
  const cur = a.currency || state.settings.currency;
  if ((b.currency || state.settings.currency) !== cur) return null;
  const base = cur === state.settings.currency ? amount : null;
  return { id, createdAt: now, updatedAt: now, type: 'transfer', amount, currency: cur, rate: base == null ? null : 1, base: base ?? amount, date, from, to, note: note || 'Paid to you', draw: true };
}

// Reads this device's pick (falls back to Personal once books are on, else Both).
export function readBook(state, store = globalThis.localStorage) {
  let v = null;
  try { v = store?.getItem(BOOK_KEY); } catch { v = null; }
  if (isView(v)) return v;
  return booksOn(state) ? 'personal' : 'both';
}
export function saveBook(v, store = globalThis.localStorage) {
  if (!isView(v)) return;
  try { store?.setItem(BOOK_KEY, v); } catch { /* storage blocked: this session only */ }
}
