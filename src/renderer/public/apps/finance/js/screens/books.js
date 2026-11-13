// Business and personal books on screen (Money v2 phase 2): the Personal /
// Business / Both switch at the top, the Business home card, "Pay yourself",
// marking accounts Business, moving records (Log → select) and Undo move.
// The numbers are books.js and business.js; every change here only sets or
// clears book fields and goes through ctx.commit (one undo step each).

import { ctx, esc } from '../ctx.js';
import { formatMoney, evalAmount } from '../money.js';
import { todayISO, monthLabel } from '../dates.js';
import { removeTx } from '../model.js';
import * as Bk from '../books.js';
import { businessSummary, REPORT_CURRENCIES, REPORT_CUR_KEY } from '../business.js';

// Add-only starter categories for the business book (made-up names, editable).
export const STARTER_BUSINESS_CATEGORIES = [
  { id: 'biz-tools', name: 'Software & tools', emoji: '🧰' },
  { id: 'biz-taxes', name: 'Taxes & fees', emoji: '🧾' },
  { id: 'biz-office', name: 'Office & equipment', emoji: '🖥️' },
  { id: 'biz-help', name: 'Contractors', emoji: '🤝' },
];

const realState = () => ctx.state?._real || ctx.state;

// ---------- the switch ----------

export function switchHTML(view) {
  const b = (id) => `<button type="button" data-act="book-view" data-book="${id}" aria-pressed="${view === id}">${Bk.BOOK_NAMES[id]}</button>`;
  return `<div class="bk-bar" data-testid="book-switch">
    <div class="seg bk-seg" role="group" aria-label="Which money to show">${b('personal')}${b('business')}${b('both')}</div>
    <div class="bk-tools">
      ${view === 'business' ? '<button type="button" class="chip" data-act="book-pay" data-testid="book-pay">Pay yourself</button>' : ''}
      <button type="button" class="chip" data-act="book-manage">Books…</button>
    </div>
  </div>`;
}

// ---------- the Business home card ----------

function reportCur() {
  try { const v = localStorage.getItem(REPORT_CUR_KEY); if (REPORT_CURRENCIES.includes(v)) return v; } catch { /* blocked */ }
  return realState().settings.currency || 'MDL';
}

export function businessCard() {
  const state = realState();
  const today = todayISO();
  const cur = reportCur();
  const m = (c) => formatMoney(Math.round(c / 100) * 100, cur);
  const hasBiz = state.settings.accounts.some((a) => a.book === 'business') || state.tx.some((t) => t.book === 'business');
  const curBtn = (c) => `<button type="button" data-act="biz-cur" data-cur="${c}" aria-pressed="${c === cur}">${c}</button>`;
  if (!hasBiz) {
    return `<section class="card bk-card" data-testid="business-view"><h2>Business</h2>
      <p class="muted" style="margin-top:0">No business money yet. Everything is in your personal book.</p>
      <p class="muted small">Mark the account your clients pay into as Business: its records move with it, and you can undo it.</p>
      <div class="btns"><button class="btn primary" data-act="book-manage">Mark an account as Business</button></div>
    </section>`;
  }
  const s = businessSummary(state, today, cur);
  const mo = s.month;
  const clients = s.year.byClient.slice(0, 5);
  const max = Math.max(1, ...clients.map((r) => r.amount));
  const inv = s.invoices;
  const invLine = inv.count
    ? `${inv.count} unpaid · ${Object.entries(inv.byCurrency).map(([c, a]) => esc(formatMoney(a, c))).join(' + ')}${inv.overdue.length ? ` · <b class="expense">${inv.overdue.length} overdue</b> (${inv.overdue.slice(0, 3).map((i) => esc(i.number)).join(', ')})` : ''}`
    : 'No unpaid invoices';
  const bar = (r) => `<div class="bk-client"><span>${esc(r.person?.name || 'No client')}</span><i style="--w:${Math.max(4, Math.round((r.amount / max) * 100))}%" aria-hidden="true"></i><b>${esc(m(r.amount))}</b></div>`;
  const costs = mo.byCost.slice(0, 4).map((r) => { const c = state.settings.categories.find((x) => x.id === r.id); return `<li>${esc(`${c?.emoji || ''} ${c?.name || 'Other'}`.trim())} <b>${esc(m(r.amount))}</b></li>`; }).join('');
  const series = s.series;
  const top = Math.max(1, ...series.map((x) => Math.abs(x.profit)));
  const spark = series.map((x) => `<i class="${x.profit < 0 ? 'neg' : ''}" style="--h:${x.profit ? Math.max(3, Math.round((Math.abs(x.profit) / top) * 100)) : 0}%" title="${esc(monthLabel(x.key))}: ${esc(m(x.profit))}"></i>`).join('');
  const missing = mo.missing ? `<p class="muted small">${mo.missing} records have no ${esc(cur)} rate yet and are left out.</p>` : '';
  return `<section class="card bk-card" data-testid="business-view">
    <h2>Business · ${esc(monthLabel(s.key))} <span class="seg bk-cur" role="group" aria-label="Report currency">${REPORT_CURRENCIES.map(curBtn).join('')}</span></h2>
    <div class="bk-kpis">
      <div><span>Profit</span><b data-testid="biz-profit" class="${mo.profit < 0 ? 'expense' : 'income'}">${esc(m(mo.profit))}</b></div>
      <div><span>Income</span><b>${esc(m(mo.income))}</b></div>
      <div><span>Costs</span><b>${esc(m(mo.costs))}</b></div>
      <div><span>Paid to you</span><b data-testid="biz-draws">${esc(m(mo.draws))}</b></div>
    </div>
    <div class="bk-spark" aria-label="Profit, last 6 months">${spark}</div>
    <p class="bk-line"><span>Unpaid invoices</span> ${invLine}</p>
    <p class="bk-line"><span>Hours → money</span> ${s.hours.hours ? `${esc(String(s.hours.hours).replace('.', ','))} h billed this month · ${esc(m(s.hours.earned))}` : 'No hours billed this month'}${s.hours.perHour ? ` · ${esc(m(s.hours.perHour))}/h` : ''}${s.hoursYear.hours ? ` · this year ${esc(String(s.hoursYear.hours).replace('.', ','))} h` : ''}</p>
    <p class="bk-line"><span>Business cash</span> ${esc(m(s.cash.total))}${mo.ownerIn ? ` · you put in ${esc(m(mo.ownerIn))} this month` : ''}</p>
    ${clients.length ? `<h3 class="bk-h">Income per client (${esc(today.slice(0, 4))})</h3>${clients.map(bar).join('')}` : ''}
    ${costs ? `<h3 class="bk-h">Costs this month</h3><ul class="bk-costs">${costs}</ul>` : ''}
    ${missing}
    <p class="muted small">USD and EUR use the rate of each record's own day when this device has it, else today's.</p>
  </section>`;
}

// ---------- taps ----------

export function onClick(act, el) {
  if (act === 'book-view') { setView(el.dataset.book); return true; }
  if (act === 'book-manage') { openManage(); return true; }
  if (act === 'book-pay') { openPay(); return true; }
  if (act === 'biz-cur') {
    try { localStorage.setItem(REPORT_CUR_KEY, el.dataset.cur); } catch { /* this session only */ }
    ctx.render();
    return true;
  }
  return false;
}

export function setView(v) {
  if (!Bk.isView(v)) return;
  ctx.ui.book = v;
  Bk.saveBook(v);
  ctx.render();
}

// ---------- Books… : accounts, starter categories, undo moves ----------

function manageHTML() {
  const state = realState();
  const accs = state.settings.accounts.filter((a) => !a.archived);
  const row = (a) => {
    const b = Bk.accountBook(a);
    const n = state.tx.filter((t) => (t.account === a.id || t.from === a.id || t.to === a.id) && !t.book).length;
    return `<div class="bk-row"><span>${esc(`${a.emoji || ''} ${a.name}`.trim())}<small class="muted"> · ${n} records</small></span>
      <div class="seg two bk-acc" role="group" aria-label="Book of ${esc(a.name)}">
        <button type="button" data-acc="${esc(a.id)}" data-to="personal" aria-pressed="${b === 'personal'}">Personal</button>
        <button type="button" data-acc="${esc(a.id)}" data-to="business" aria-pressed="${b === 'business'}">Business</button>
      </div></div>`;
  };
  const batches = Bk.moveBatches(state).slice(0, 5);
  const missingStarters = STARTER_BUSINESS_CATEGORIES.filter((c) => !state.settings.categories.some((x) => x.id === c.id));
  return `<h3>Books <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">A record belongs to its account's book unless you move it. Personal, Business and Both only change what you see; nothing is deleted.</p>
    <h4>Accounts</h4>
    <div class="list">${accs.map(row).join('')}</div>
    ${batches.length ? `<h4>Moved records</h4>${batches.map((b) => `<div class="bk-row"><span>${b.count} record${b.count === 1 ? '' : 's'} to ${Bk.BOOK_NAMES[b.to]}</span><button type="button" class="btn" data-undo-move="${esc(b.batch)}">Undo move</button></div>`).join('')}` : ''}
    ${missingStarters.length ? `<h4>Business categories</h4><p class="muted small">Adds ${missingStarters.map((c) => esc(c.name)).join(', ')}. Only adds; you can rename or delete them.</p><button type="button" class="btn" data-starters>Add business categories</button>` : ''}
    <p class="muted small">To move single records: Log → Table, tick them, then "Move to…".</p>`;
}

export function openManage() {
  const paint = (sheet) => { sheet.querySelector('.bk-manage').innerHTML = manageHTML(); };
  ctx.openSheet(`<div class="bk-manage" data-testid="books-sheet">${manageHTML()}</div>`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const acc = e.target.closest('[data-acc]');
      if (acc) { setAccount(acc.dataset.acc, acc.dataset.to, () => paint(sheet)); return; }
      const u = e.target.closest('[data-undo-move]');
      if (u) { undo(u.dataset.undoMove); paint(sheet); return; }
      if (e.target.closest('[data-starters]')) { addStarters(); paint(sheet); }
    });
  });
}

function setAccount(id, book, repaint) {
  const state = realState();
  const a = state.settings.accounts.find((x) => x.id === id);
  if (!a || Bk.accountBook(a) === book) return;
  const r = Bk.setAccountBook(state, id, book);
  if (!r) return;
  ctx.commit();
  repaint?.();
  ctx.toast(`${a.name} is now ${Bk.BOOK_NAMES[book]}${r.records ? `: ${r.records} records moved with it` : ''}`, 'Undo', () => {
    Bk.setAccountBook(realState(), id, r.before);
    ctx.commit();
    ctx.toast(`${a.name} is ${Bk.BOOK_NAMES[r.before]} again`);
  });
}

function addStarters() {
  const state = realState();
  const now = Date.now();
  let added = 0;
  for (const c of STARTER_BUSINESS_CATEGORIES) {
    if (state.settings.categories.some((x) => x.id === c.id)) continue;
    state.settings.categories.push({ ...c, type: 'expense', jar: 'none', jarChosen: true, book: 'business', updatedAt: now });
    added++;
  }
  if (added) { ctx.commit(); ctx.toast(`${added} business categories added`); }
}

function undo(batch) {
  const r = Bk.undoMove(realState(), batch);
  ctx.commit();
  ctx.toast(r.keptEdited ? `${r.restored} moved back; ${r.keptEdited} you edited since keep your edit` : `${r.restored} moved back`);
}

// ---------- moving selected records (Log → Table) ----------

export function bulkSelectHTML() {
  return `<select data-bulk="book" aria-label="Move to a book" data-testid="bulk-book"><option value="">Move to…</option><option value="personal">Personal</option><option value="business">Business</option></select>`;
}

export function moveSelected(ids, book) {
  const state = realState();
  const r = Bk.moveToBook(state, ids, book);
  if (!r.moved) { ctx.toast(`Already in ${Bk.BOOK_NAMES[book]} (transfers follow their accounts)`); return 0; }
  ctx.commit();
  ctx.toast(`${r.moved} moved to ${Bk.BOOK_NAMES[book]}`, 'Undo', () => undo(r.batch));
  return r.moved;
}

// ---------- Pay yourself ----------

export function openPay() {
  const state = realState();
  const biz = state.settings.accounts.filter((a) => !a.archived && Bk.accountBook(a) === 'business');
  const mine = state.settings.accounts.filter((a) => !a.archived && Bk.accountBook(a) === 'personal');
  if (!biz.length) {
    ctx.toast('Mark an account as Business first');
    openManage();
    return;
  }
  const opt = (a) => `<option value="${esc(a.id)}">${esc(`${a.emoji || ''} ${a.name}`.trim())} (${esc(a.currency || state.settings.currency)})</option>`;
  ctx.openSheet(`<h3>Pay yourself <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <p class="muted small" style="margin-top:0">Moves money from the business to you. Personal shows it as income, Business as "Paid to you" (not a cost), Both counts your client money once.</p>
    <label class="field"><span>From (business)</span><select id="bk-from">${biz.map(opt).join('')}</select></label>
    <label class="field"><span>To (personal)</span><select id="bk-to">${mine.map(opt).join('')}</select></label>
    <label class="field"><span>Amount</span><input id="bk-amount" type="text" inputmode="decimal" placeholder="e.g. 8000" data-testid="pay-amount"></label>
    <label class="field"><span>Date</span><input id="bk-date" type="date" value="${todayISO()}"></label>
    <p class="muted small" id="bk-err" role="alert"></p>
    <div class="btns"><button type="button" class="btn primary" id="bk-go" data-testid="pay-go">Pay yourself</button></div>`, (sheet) => {
    sheet.querySelector('#bk-go').addEventListener('click', () => {
      const st = realState();
      const amount = evalAmount(sheet.querySelector('#bk-amount').value);
      const t = Bk.drawTx(st, { from: sheet.querySelector('#bk-from').value, to: sheet.querySelector('#bk-to').value, amount, date: sheet.querySelector('#bk-date').value || todayISO() });
      if (!t) { sheet.querySelector('#bk-err').textContent = amount > 0 ? 'Pick a business and a personal account in the same currency.' : 'Type an amount, e.g. 8000'; return; }
      st.tx.push(t);
      ctx.ui.flashId = t.id;
      ctx.closeSheet();
      ctx.commit();
      ctx.toast(`Paid yourself ${formatMoney(t.amount, t.currency)}`, 'Undo', () => {
        if (removeTx(realState(), t.id)) ctx.commit();
      });
    });
  });
}
