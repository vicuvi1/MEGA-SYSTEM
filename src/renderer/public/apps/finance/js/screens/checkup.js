// Monthly check-up (js/checkup.js): a card on Home when it is due, the
// Check-up sheet ("Does your bank show X?" per account) and its settings.

import { ctx, esc } from '../ctx.js';
import * as C from '../checkup.js';
import { accountBalances } from '../model.js';
import { evalAmount, formatMoney } from '../money.js';
import { todayISO, dayLabel } from '../dates.js';

export function card(today = todayISO()) {
  const due = C.checkupCard(ctx.state, today);
  if (!due) return '';
  return `<section class="card" data-testid="checkup-card"><h2>Monthly check-up</h2>
    <p style="margin-top:0">Time to compare ${due.left.length === 1 ? 'one account' : `${due.left.length} accounts`} with your bank. It takes a minute.</p>
    <div class="btns"><button type="button" class="btn primary" data-act="checkup-open" data-testid="checkup-open">Start check-up</button><button type="button" class="btn" data-act="checkup-later">Not today</button></div></section>`;
}

export function settingsCard() {
  const c = C.checkupConfig(ctx.state);
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  return `<section class="card"><h2>Monthly check-up</h2>
    <p class="muted small" style="margin-top:0">Once a month Money asks, for each account, whether your bank shows the same balance. A difference becomes one visible adjustment that doesn't count as income or spending. Life System also sends one reminder that day.</p>
    <label class="motion-setting"><span><b>Remind me to check my accounts</b></span><input type="checkbox" data-set="checkupOn" ${c.on ? 'checked' : ''} aria-label="Monthly check-up"></label>
    <label class="field" style="margin:10px 0 0"><span>Day of the month</span><select data-set="checkupDay" aria-label="Check-up day">${days.map((d) => `<option value="${d}"${d === c.day ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
    <div class="btns" style="margin-top:10px"><button type="button" class="btn" data-act="checkup-open">Check my accounts now</button></div></section>`;
}

function sheetHTML() {
  const { state } = ctx;
  const today = todayISO();
  const bal = accountBalances(state, today);
  const start = `${today.slice(0, 7)}-01`;
  const rows = C.checkupAccounts(state).map(({ account: a, last }) => {
    const done = last && last >= start;
    return `<div class="card" style="margin:0 0 10px" data-testid="checkup-row" data-acc="${esc(a.id)}">
      <b>${esc(a.name)}</b> <span class="muted small">${last ? `last checked ${esc(dayLabel(last))}` : 'never checked'}</span>
      ${done ? '<p class="muted small" style="margin:6px 0 0">✓ Checked this month</p>' : `<p style="margin:6px 0">Does your bank show <b>${esc(formatMoney(bal[a.id] || 0, a.currency))}</b>?</p>
      <div class="cash-count-row"><button type="button" class="btn primary" data-act="checkup-yes" data-id="${esc(a.id)}" data-testid="checkup-yes">Yes</button>
      <input type="text" inputmode="decimal" data-checkup-real aria-label="Real balance of ${esc(a.name)}" placeholder="Enter the real balance" data-testid="checkup-real">
      <button type="button" class="btn" data-act="checkup-set" data-id="${esc(a.id)}" data-testid="checkup-set">Save</button></div>`}
    </div>`;
  }).join('');
  return `<h3>Monthly check-up <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>${rows || '<p class="muted">No accounts to check.</p>'}`;
}

export function open() {
  ctx.openSheet(sheetHTML(), (sheet) => {
    sheet.addEventListener('click', (e) => {
      const yes = e.target.closest('[data-act="checkup-yes"]');
      const set = e.target.closest('[data-act="checkup-set"]');
      if (!yes && !set) return;
      const id = (yes || set).dataset.id;
      const acc = ctx.state.settings.accounts.find((a) => a.id === id);
      if (!acc) return;
      const today = todayISO();
      let real = null;
      if (set) {
        real = evalAmount(set.closest('[data-testid="checkup-row"]').querySelector('[data-checkup-real]').value);
        if (real == null || !Number.isFinite(real)) { ctx.toast('Type the balance your bank shows, e.g. 1250 or 1000+250'); return; }
      }
      const rate = acc.currency === ctx.state.settings.currency ? 1 : ctx.suggestedRate?.(acc.currency);
      if (!rate) { ctx.toast(`No ${acc.currency} rate yet. Update rates first.`); return; }
      const r = C.applyCheckup(ctx.state, id, real, today, { rate });
      ctx.commit();
      ctx.toast(!r.tx ? `${acc.name}: same as your bank` : `${acc.name}: adjusted by ${formatMoney(Math.abs(r.diff), acc.currency, { sign: r.diff > 0 })}`);
      sheet.innerHTML = `<div class="grab"></div>${sheetHTML()}`;
    });
  });
}

export function onClick(act) {
  if (act === 'checkup-open') { open(); return true; }
  if (act === 'checkup-later') {
    C.snoozeCheckup(ctx.state, todayISO());
    ctx.commit();
    ctx.toast('OK, I will ask again tomorrow');
    return true;
  }
  return false;
}
