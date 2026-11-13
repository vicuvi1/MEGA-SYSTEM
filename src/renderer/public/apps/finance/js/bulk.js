// Change many records at once (pure, tested). The Log's selection bar picks the
// records; this applies one change to all of them. The caller commits once, so
// one Undo (history.js) puts every record back exactly as it was.

import { touch, category, removeTx } from './model.js';

// kind: 'category' | 'date' | 'account'. `rateFor(cur)` gives a rate when a
// record moves to an account in another currency. Transfers are skipped for
// category and account changes. Returns { changed, skipped }.
export function applyBulk(state, ids, kind, value, { rateFor = () => null, now = Date.now() } = {}) {
  const set = new Set(ids);
  let changed = 0;
  let skipped = 0;
  if (kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { changed, skipped };
  for (const t of state.tx) {
    if (!set.has(t.id)) continue;
    if (kind === 'date') t.date = value;
    else if (t.type === 'transfer') { skipped++; continue; }
    else if (kind === 'category') {
      if (category(state, value)?.type !== t.type) { skipped++; continue; }
      t.category = value;
    } else if (kind === 'account') {
      t.account = value;
      const cur = state.settings.accounts.find((a) => a.id === value)?.currency || state.settings.currency;
      if (cur !== t.currency) {
        t.currency = cur;
        t.rate = rateFor(cur) || t.rate || 1;
        t.base = Math.round(t.amount * t.rate);
      }
    } else continue;
    touch(t, now);
    changed++;
  }
  return { changed, skipped };
}

// How many of the selected records a change would touch (for the confirm text).
export function countApplicable(state, ids, kind, value) {
  const set = new Set(ids);
  return state.tx.filter((t) => set.has(t.id) && (kind === 'date' || (t.type !== 'transfer' && (kind !== 'category' || category(state, value)?.type === t.type)))).length;
}

export function deleteMany(state, ids, now = Date.now()) {
  let n = 0;
  for (const id of ids) if (state.tx.some((t) => t.id === id)) { removeTx(state, id, now); n++; }
  return n;
}
