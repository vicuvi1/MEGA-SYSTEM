// Search across all months (Log → search box). Plain words must all match
// the note, category, account, bank, person or currency; extras:
//   >1000  <50  >=200  <=80     amount limits (in your currency)
//   100-500                     amount between
//   35                          that exact amount (or "35" in a note)
//   march  mar 2025  2026       a month and/or year
//   today  yesterday            a day
//   spent  earned  moves        a type
//   #trip                       a tag in the note
//   cat:food  acc:cash          a category or account (name or id, start of it)
//   sub:coffee                  a subcategory (name, start of it)
//   this year  last month       a period (also "this week"); "all", "my" are ignored
//   from:2026-01-01 to:2026-01-31   a date range (or 2026-01-01..2026-01-31)
// Pure; app.js shows the results and the summary.

import { addDays, addMonths } from './dates.js';

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const MONTH_WORDS = [
  ['january', 'jan', 'ianuarie', 'январь', 'января'],
  ['february', 'feb', 'februarie', 'февраль', 'февраля'],
  ['march', 'mar', 'martie', 'март', 'марта'],
  ['april', 'apr', 'aprilie', 'апрель', 'апреля'],
  ['may', 'mai', 'май', 'мая'],
  ['june', 'jun', 'iunie', 'июнь', 'июня'],
  ['july', 'jul', 'iulie', 'июль', 'июля'],
  ['august', 'aug', 'august', 'август', 'августа'],
  ['september', 'sep', 'sept', 'septembrie', 'сентябрь', 'сентября'],
  ['october', 'oct', 'octombrie', 'октябрь', 'октября'],
  ['november', 'nov', 'noiembrie', 'ноябрь', 'ноября'],
  ['december', 'dec', 'decembrie', 'декабрь', 'декабря'],
];
const TYPE_WORDS = {
  spent: 'expense', spend: 'expense', expense: 'expense', expenses: 'expense',
  earned: 'income', income: 'income',
  moves: 'transfer', move: 'transfer', transfer: 'transfer', transfers: 'transfer',
};
const num = (s) => {
  const v = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
};

const REL_WORDS = [
  [/\b(this|current) year\b|\banul (acesta|asta|curent)\b|(в )?этом году|этот год/g, 'year'],
  [/\blast year\b|\banul trecut\b|(в )?прошлом году|прошлый год/g, 'lastyear'],
  [/\b(this|current) month\b|\bluna (aceasta|asta|curenta)\b|(в )?этом месяце|этот месяц/g, 'month'],
  [/\blast month\b|\bluna trecuta\b|(в )?прошлом месяце|прошлый месяц/g, 'lastmonth'],
  [/\bthis week\b|\bsaptamana (aceasta|asta)\b|(на )?этой неделе/g, 'week'],
];
// Words people type in a question that say nothing to filter by.
const FILLER = new Set(['all', 'my', 'everything', 'on', 'in', 'for', 'the', 'of', 'tot', 'toate', 'toata', 'pe', 'все', 'всё', 'на']);

// The dates a relative period ("this year") covers on `today`.
export function relRange(rel, today) {
  if (!rel || !today) return null;
  const y = today.slice(0, 4);
  const m = today.slice(0, 7);
  const end = (k) => { const [yy, mm] = k.split('-').map(Number); return `${k}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`; };
  if (rel === 'year') return { from: `${y}-01-01`, to: today };
  if (rel === 'lastyear') return { from: `${Number(y) - 1}-01-01`, to: `${Number(y) - 1}-12-31` };
  if (rel === 'month') return { from: `${m}-01`, to: end(m) };
  if (rel === 'lastmonth') { const k = addMonths(m, -1); return { from: `${k}-01`, to: end(k) }; }
  if (rel === 'week') return { from: addDays(today, -6), to: today };
  return null;
}

export function parseQuery(q) {
  const out = { words: [], min: null, max: null, exact: null, months: [], year: null, day: null, type: null, tags: [], cats: [], subs: [], accs: [], from: null, to: null, rel: null };
  // Join "1 000" into "1000", "> 1000" into ">1000", "100 - 500" into "100-500".
  let text = fold(q).replace(/(\d)[\s\u00a0](?=\d{3}(?!\d))/g, '$1').replace(/([<>]=?)\s+(?=\d)/g, '$1').replace(/(\d)\s*-\s*(\d)/g, '$1-$2').trim();
  // "this year", "last month", "anul acesta", "в этом году": a period from today.
  for (const [re, rel] of REL_WORDS) text = text.replace(re, () => { out.rel = rel; return ' '; });
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    let m;
    if (FILLER.has(tok)) continue;
    if ((m = tok.match(/^#([\p{L}\p{N}_-]+)$/u))) out.tags.push(m[1]);
    else if ((m = tok.match(/^(?:cat|category):(.+)$/))) out.cats.push(m[1]);
    else if ((m = tok.match(/^(?:acc|account):(.+)$/))) out.accs.push(m[1]);
    else if ((m = tok.match(/^(?:sub|subcategory):(.+)$/))) out.subs.push(m[1]);
    else if ((m = tok.match(/^from:(\d{4}-\d{2}-\d{2})$/))) out.from = m[1];
    else if ((m = tok.match(/^to:(\d{4}-\d{2}-\d{2})$/))) out.to = m[1];
    else if ((m = tok.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/))) { out.from = m[1]; out.to = m[2]; }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) { out.from = tok; out.to = tok; }
    else if ((m = tok.match(/^(>=?|<=?)(\d+(?:[.,]\d+)?)$/))) {
      const v = num(m[2]);
      if (m[1] === '>') out.min = v + 1;
      else if (m[1] === '>=') out.min = v;
      else if (m[1] === '<') out.max = v - 1;
      else out.max = v;
    } else if ((m = tok.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/))) {
      out.min = num(m[1]);
      out.max = num(m[2]);
    } else if (/^(19|20)\d\d$/.test(tok)) out.year = tok;
    else if (/^\d+(?:[.,]\d+)?$/.test(tok)) out.exact = { cents: num(tok), text: tok };
    else if (tok === 'today' || tok === 'azi' || tok === 'сегодня') out.day = 0;
    else if (tok === 'yesterday' || tok === 'ieri' || tok === 'вчера') out.day = -1;
    else if (TYPE_WORDS[tok] && !out.type) out.type = TYPE_WORDS[tok];
    else {
      const mi = MONTH_WORDS.findIndex((names) => names.includes(tok));
      if (mi >= 0) out.months.push(mi + 1);
      else out.words.push(tok);
    }
  }
  return out;
}

// Tags in a note (same rule as model.js tagsOf), folded.
const noteTags = (note) => [...String(note || '').matchAll(/(^|\s)#([\p{L}\p{N}_-]{1,30})/gu)].map((m) => fold(m[2]));

// Saved filters (Log → search → ☆ Save): a name and the query text, on this
// device's settings (they sync with your data).
export function savedFilters(state) {
  return Array.isArray(state.settings.savedFilters) ? state.settings.savedFilters.filter((f) => f && typeof f.q === 'string' && f.q.trim()) : [];
}
export function saveFilter(state, q, name = q) {
  const list = savedFilters(state).filter((f) => f.q !== q.trim());
  list.push({ q: q.trim(), name: String(name || q).trim().slice(0, 30) });
  state.settings.savedFilters = list.slice(-12);
  state.settings.updatedAt = Date.now();
  return state.settings.savedFilters;
}
export function removeFilter(state, q) {
  state.settings.savedFilters = savedFilters(state).filter((f) => f.q !== q);
  state.settings.updatedAt = Date.now();
  return state.settings.savedFilters;
}

// Everything a word can match on a record.
function haystack(state, t) {
  const name = (arr, id) => arr.find((x) => x.id === id);
  const parts = [t.note, t.currency, t.personName];
  if (t.category) parts.push(name(state.settings.categories, t.category)?.name);
  const sub = t.sub && (state.settings.subcats || []).find((x) => x.id === t.sub && x.parent === t.category);
  if (sub) parts.push(sub.name);
  for (const id of [t.account, t.from, t.to]) {
    const a = id && name(state.settings.accounts, id);
    if (a) parts.push(a.name, a.bank);
  }
  if (t.person) parts.push(name(state.people, t.person)?.name);
  return fold(parts.filter(Boolean).join(' '));
}

export function searchTx(state, query, today) {
  const q = typeof query === 'string' ? parseQuery(query) : query;
  const day = q.day == null ? null : addDays(today, q.day);
  const rel = relRange(q.rel, today);
  return state.tx.filter((t) => {
    if (q.type && t.type !== q.type) return false;
    if (rel && (t.date < rel.from || t.date > rel.to)) return false;
    if (q.from && t.date < q.from) return false;
    if (q.to && t.date > q.to) return false;
    if (q.tags?.length) {
      const have = noteTags(t.note);
      if (!q.tags.every((g) => have.includes(g))) return false;
    }
    if (q.cats?.length) {
      const c = t.category && state.settings.categories.find((x) => x.id === t.category);
      if (!c || !q.cats.some((w) => fold(c.id).startsWith(w) || fold(c.name).startsWith(w))) return false;
    }
    if (q.subs?.length) {
      const sub = t.sub && (state.settings.subcats || []).find((x) => x.id === t.sub && x.parent === t.category);
      if (!sub || !q.subs.some((w) => fold(sub.name).startsWith(w) || fold(sub.name).split(/[\s&]+/).some((p) => p.startsWith(w)))) return false;
    }
    if (q.accs?.length) {
      const accs = [t.account, t.from, t.to].filter(Boolean).map((id) => state.settings.accounts.find((a) => a.id === id)).filter(Boolean);
      if (!q.accs.some((w) => accs.some((a) => fold(a.id).startsWith(w) || fold(a.name).startsWith(w) || fold(a.name).split(/\s+/).some((p) => p.startsWith(w))))) return false;
    }
    if (day && t.date !== day) return false;
    if (q.year && !t.date.startsWith(q.year)) return false;
    if (q.months.length && !q.months.includes(Number(t.date.slice(5, 7)))) return false;
    // Amounts are compared in the record's own currency, as you see them.
    if (q.min != null && t.amount < q.min) return false;
    if (q.max != null && t.amount > q.max) return false;
    const hay = q.words.length || q.exact ? haystack(state, t) : '';
    if (q.exact && Math.floor(t.amount / 100) * 100 !== q.exact.cents && t.amount !== q.exact.cents && !hay.includes(q.exact.text)) return false;
    return q.words.every((w) => hay.includes(w));
  });
}

// Totals for the result line: how many, spent / earned, first and last date,
// in how many months.
export function searchSummary(list, base = (t) => t.base ?? t.amount) {
  const real = list.filter((t) => !t.loan);
  const spent = real.filter((t) => t.type === 'expense').reduce((a, t) => a + base(t), 0);
  const earned = real.filter((t) => t.type === 'income').reduce((a, t) => a + base(t), 0);
  const dates = list.map((t) => t.date).sort();
  return {
    count: list.length,
    spent,
    earned,
    first: dates[0] || null,
    last: dates.at(-1) || null,
    months: new Set(dates.map((d) => d.slice(0, 7))).size,
  };
}

export const SEARCH_HINT = 'coffee · >100 · #trip · cat:food · acc:cash · from:2026-01-01 · march · earned';
