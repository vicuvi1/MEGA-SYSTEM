// "Where my money goes": a donut of spending by category (labels with leader
// lines when there is room, a legend on a phone) and, below it, one rounded
// row per category: icon, name, amount, its share in a small circle, a thin
// bar and how it compares with the period before. Tap a segment or a row to
// light it up and see its records; "See all in the Log" opens the Log
// filtered to that category. Categories under 3% fold into "Other".
// The numbers come from catshare.js (tested). Drawn as inline SVG, no library.

import { ctx, esc } from '../ctx.js';
import * as M from '../model.js';
import * as T from '../cattree.js';
import { todayISO, addMonths, monthKey, monthLabel } from '../dates.js';
import { categoryShares, changeText, spendRange, SPEND_PERIODS, OTHER_ID, countsAsSpending } from '../catshare.js';

const TOP = 7; // openCategory's own fold ("Everything else"), kept for the old sheet

// Stable color per category (its place in your category list, the same one the
// Log's chips use), moving to the next free color only when two shown
// categories would share one.
function colorsFor(state, ids) {
  const used = new Set();
  const out = {};
  for (const id of ids) {
    const i = Math.max(0, state.settings.categories.findIndex((c) => c.id === id));
    let slot = (i % 8) + 1;
    for (let k = 0; k < 8 && used.has(slot); k++) slot = (slot % 8) + 1;
    used.add(slot);
    out[id] = `var(--c${slot})`;
  }
  return out;
}

// ---------- The donut ----------

const f = (n) => Math.round(n * 100) / 100;

// A ring of stroked circles (pathLength 100), one per segment. `wide` adds
// labels with leader lines either side; the narrow one has none (the legend
// is the list under it).
function donutSvg(items, { total, wide, selected, label }) {
  const W = wide ? 480 : 220;
  const H = wide ? 240 : 220;
  const cx = W / 2;
  const cy = H / 2;
  const R = wide ? 74 : 78;
  const SW = wide ? 28 : 30;
  const gap = items.length > 1 ? 0.5 : 0;
  let at = 0;
  const segs = [];
  const labels = [];
  for (const it of items) {
    const len = it.share * 100;
    const mid = (at + len / 2) / 100 * Math.PI * 2;
    segs.push(`<circle class="dn-seg${selected === it.id ? ' sel' : ''}" cx="${cx}" cy="${cy}" r="${R}" pathLength="100" data-act="cat-pick" data-cat="${esc(it.id)}" style="--c:${it.color};--len:${f(Math.max(0.2, len - gap))};--off:${f(-(at + gap / 2))};--i:${segs.length}" transform="rotate(-90 ${cx} ${cy})"/>`);
    if (wide && it.pct >= 4) {
      const s = Math.sin(mid);
      const c = -Math.cos(mid);
      labels.push({ it, side: s >= 0 ? 1 : -1, x0: cx + (R + SW / 2) * s, y0: cy + (R + SW / 2) * c, x1: cx + (R + SW / 2 + 12) * s, y1: cy + (R + SW / 2 + 12) * c });
    }
    at += len;
  }
  // Labels: keep each side's apart (15 units) so none sit on another.
  let leaders = '';
  if (wide) {
    for (const side of [-1, 1]) {
      const mine = labels.filter((l) => l.side === side).sort((a, b) => a.y1 - b.y1);
      for (let k = 0; k < mine.length; k++) { mine[k].y = k && mine[k].y1 < mine[k - 1].y + 15 ? mine[k - 1].y + 15 : mine[k].y1; }
      for (let k = mine.length - 1; k >= 0; k--) { if (mine[k].y > H - 10) mine[k].y = H - 10; if (k < mine.length - 1 && mine[k].y > mine[k + 1].y - 15) mine[k].y = mine[k + 1].y - 15; }
      for (const l of mine) {
        const x2 = cx + side * (R + SW / 2 + 30);
        leaders += `<g class="dn-lab" data-act="cat-pick" data-cat="${esc(l.it.id)}"><path d="M${f(l.x0)} ${f(l.y0)} L${f(l.x1)} ${f(l.y1)} L${f(x2)} ${f(l.y)}" fill="none" stroke="${l.it.color}" stroke-width="1.5" stroke-linecap="round"/><text x="${f(x2 + side * 5)}" y="${f(l.y + 4)}" text-anchor="${side > 0 ? 'start' : 'end'}">${esc(l.it.name)} <tspan class="dn-lab-p">${l.it.pct}%</tspan></text></g>`;
      }
    }
  }
  const money = ctx.money(total, { compact: false });
  return `<svg class="dn-svg ${wide ? 'dn-wide' : 'dn-narrow'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" class="dn-track" stroke-width="${SW}"/>
    <g class="dn-ring" stroke-width="${SW}">${segs.join('')}</g>
    ${leaders}
    <text class="dn-c1" x="${cx}" y="${cy - 8}" text-anchor="middle">Spent</text>
    <text class="dn-c2" x="${cx}" y="${cy + 16}" text-anchor="middle">${esc(money)}</text>
  </svg>`;
}

// ---------- The card ----------

// Remembered so a tap can redraw just the card (no jump, no replayed animation).
const last = {};

export function spendingCard(opts = {}) {
  const { state, ui } = ctx;
  const key = opts.key || 'home';
  last[key] = opts;
  const today = todayISO();
  const period = opts.period || 'month';
  const range = opts.range || spendRange(period, today);
  const base = opts.base || M.B;
  const list = opts.list || state.tx;
  const { total, rows } = categoryShares(list, range, base);
  const word = range.prev?.word || 'before';
  const name = (id) => (id === OTHER_ID ? 'Other' : M.category(state, id)?.name || 'Unknown');
  const icon = (id) => (id === OTHER_ID ? '…' : M.category(state, id)?.emoji || '');
  const colors = colorsFor(state, rows.filter((r) => r.id !== OTHER_ID).map((r) => r.id));
  const item = (r) => ({ ...r, name: name(r.id), icon: icon(r.id), color: r.id === OTHER_ID ? 'var(--faint)' : colors[r.id] || `var(--c${(Math.max(0, state.settings.categories.findIndex((c) => c.id === r.id)) % 8) + 1})` });
  const items = rows.map(item);
  const sel = ui.catSel?.[key] || null;
  const otherOpen = !!ui.catOtherOpen?.[key];

  const stepper = !opts.range && (period === 'month' || period === 'last' || /^m:/.test(period));
  const cur = range.from.slice(0, 7);
  const chips = opts.range ? '' : `<div class="chips">${SPEND_PERIODS.map((p) => `<button class="chip" data-act="spend-period" data-key="${key}" data-period="${p.id}" aria-pressed="${p.id === period}">${p.name}</button>`).join('')}
    ${stepper ? `<span class="spend-step" role="group" aria-label="Pick a month"><button type="button" class="chip" data-act="spend-step" data-key="${key}" data-step="-1" aria-label="Month before">‹</button><button type="button" class="chip" data-act="spend-step" data-key="${key}" data-step="1" aria-label="Month after" ${cur >= monthKey(today) ? 'disabled' : ''}>›</button></span>` : ''}</div>`;

  const title = esc(opts.title || 'Where your money goes');
  if (!total) {
    return `<section class="card spend" data-spend="expense" data-key="${key}"><h2>${title} <span class="right muted">${esc(range.label)}</span></h2>${chips}
      <p class="muted" style="margin:6px 0 0">Nothing spent in ${esc(range.label)}.</p></section>`;
  }

  const aria = `Spending by category, ${range.label}: ${items.map((it) => `${it.name} ${it.pct}%`).join(', ')}. Total ${ctx.money(total)}.`;
  const donut = `<div class="dn-wrap">${donutSvg(items, { total, wide: true, selected: sel, label: aria })}${donutSvg(items, { total, wide: false, selected: sel, label: aria })}</div>`;

  const row = (it, { child = false } = {}) => {
    const cmp = changeText(it, word);
    const pressed = sel === it.id;
    const exp = it.id === OTHER_ID ? ` aria-expanded="${otherOpen}"` : '';
    return `<button type="button" class="dn-row${child ? ' child' : ''}${pressed ? ' sel' : ''}" data-act="cat-pick" data-cat="${esc(it.id)}" data-key="${key}" aria-pressed="${pressed}"${exp} style="--c:${it.color}">
      <span class="dn-ic" aria-hidden="true">${it.icon ? esc(it.icon) : `<i class="dot" style="--c:${it.color}"></i>`}</span>
      <span class="dn-name">${esc(it.name)}${it.id === OTHER_ID ? ` <span class="muted small">(${it.items.length})</span>` : ''}</span>
      <span class="dn-amt">${ctx.money(it.amount)}</span>
      <span class="dn-pct" aria-label="${it.pct} percent">${it.pct}%</span>
      <span class="dn-bar" aria-hidden="true"><i style="width:${Math.max(1.5, it.share * 100).toFixed(1)}%"></i></span>
      <span class="dn-cmp muted small">${esc(cmp)}${it.count ? ` · ${it.count} record${it.count === 1 ? '' : 's'}` : ''}</span>
    </button>`;
  };
  const rowsHtml = items.map((it) => row(it) + (it.id === OTHER_ID && otherOpen ? it.items.map((c) => row(item(c), { child: true })).join('') : '')).join('');

  const table = `<table class="sr-only"><caption>Spending by category, ${esc(range.label)}</caption><thead><tr><th>Category</th><th>Amount</th><th>Share</th></tr></thead><tbody>${items.map((it) => `<tr><td>${esc(it.name)}</td><td>${esc(ctx.money(it.amount))}</td><td>${it.pct}%</td></tr>`).join('')}</tbody></table>`;

  return `<section class="card spend dn-card" data-spend="expense" data-key="${key}"><h2>${title} <span class="right muted">${esc(range.label)}</span></h2>
    ${chips}
    ${donut}
    <div class="dn-list" role="group" aria-label="Categories, biggest first">${rowsHtml}</div>
    ${selectedPanel(key, items, range, list, base)}
    ${table}
  </section>`;
}

// The records of the tapped category in this period, with a way into the Log.
function selectedPanel(key, items, range, list, base) {
  const { ui, state } = ctx;
  const id = ui.catSel?.[key];
  const it = id && items.find((x) => x.id === id) || id && items.flatMap((x) => x.items || []).find((x) => x.id === id);
  if (!it) return '';
  const ids = new Set(id === OTHER_ID ? it.items.map((x) => x.id) : [id]);
  const recs = M.sortTx(list.filter((t) => countsAsSpending(t) && ids.has(t.category) && t.date >= range.from && t.date <= range.to));
  const nm = id === OTHER_ID ? 'Other' : M.category(state, id)?.name || 'Unknown';
  return `<div class="dn-sel" role="region" aria-label="${esc(nm)} records">
    <div class="dn-sel-h"><b>${esc(nm)}</b><span class="muted small">${recs.length} record${recs.length === 1 ? '' : 's'} · ${esc(range.label)}</span>
      <button type="button" class="btn sm" data-act="cat-log" data-key="${key}" data-cat="${esc(id)}">See all in the Log</button></div>
    <div class="list">${recs.slice(0, 6).map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>
    ${recs.length > 6 ? `<p class="muted small" style="margin:6px 0 0">${recs.length - 6} more in the Log.</p>` : ''}
  </div>`;
}

// Taps on the card. Returns true when handled. `redraw(el)` swaps the card in place.
export function onClick(act, el) {
  const { ui } = ctx;
  const key = el.dataset.key || el.closest('.spend')?.dataset.key || 'home';
  if (act === 'cat-pick') {
    const id = el.dataset.cat;
    const was = ui.catSel?.[key] === id;
    ui.catSel = { ...(ui.catSel || {}), [key]: was ? null : id };
    if (id === OTHER_ID) ui.catOtherOpen = { ...(ui.catOtherOpen || {}), [key]: !was };
    redraw(el, key);
    return true;
  }
  if (act === 'spend-period') {
    ui.spendPeriod = el.dataset.period;
    ui.catSel = { ...(ui.catSel || {}), [key]: null };
    redraw(el, key, true);
    return true;
  }
  if (act === 'spend-step') {
    const today = todayISO();
    const r = spendRange(ui.spendPeriod || 'month', today);
    const k = addMonths(r.from.slice(0, 7), Number(el.dataset.step));
    ui.spendPeriod = k === monthKey(today) ? 'month' : `m:${k}`;
    ui.catSel = { ...(ui.catSel || {}), [key]: null };
    redraw(el, key, true);
    return true;
  }
  if (act === 'cat-log') {
    const o = last[key] || {};
    const range = o.range || spendRange(o.period || 'month', todayISO());
    const state = ctx.state;
    const id = el.dataset.cat;
    let cats = [id];
    if (id === OTHER_ID) {
      const { rows } = categoryShares(o.list || state.tx, range, o.base || M.B);
      cats = (rows.find((r) => r.id === OTHER_ID)?.items || []).map((r) => r.id);
    }
    ui.search = `${cats.map((c) => `cat:${c}`).join(' ')} from:${range.from} to:${range.to}`;
    ui.filter = 'all';
    location.hash = '#log';
    return true;
  }
  return false;
}

function redraw(el, key, replay = false) {
  const card = el.closest('.spend') || document.querySelector(`.spend[data-key="${key}"]`);
  const o = last[key];
  if (!card || !o) { ctx.render(); return; }
  const next = spendingCard({ ...o, period: key === 'home' ? ctx.ui.spendPeriod : o.period });
  const tpl = document.createElement('template');
  tpl.innerHTML = next.trim();
  const fresh = tpl.content.firstElementChild;
  if (replay) fresh.classList.add('flash-in');
  card.replaceWith(fresh);
}

// Records of one category in a period, with its last 6 months for context.
// `period` is a preset id ("month", "3m"...) or a { from, to, label } range.
export function openCategory(id, period = 'month', type = 'expense') {
  const { state } = ctx;
  const today = todayISO();
  const range = typeof period === 'string' ? M.periodRange(period, today) : period;
  const { total, rows, list } = M.totalsByCategory(state, range.from, range.to, type);
  const restIds = new Set(rows.slice(TOP).map((r) => r.id));
  const match = (t) => (id === '__rest' ? restIds.has(t.category) : t.category === id);
  const items = M.sortTx(list.filter(match));
  const sum = items.reduce((a, t) => a + M.B(t), 0);
  const title = id === '__rest' ? 'Everything else' : (M.category(state, id)?.name || 'Unknown');
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const k = addMonths(monthKey(today), -i);
    const r = M.totalsByCategory(state, `${k}-01`, `${k}-31`, type);
    months.push({ k, v: id === '__rest' ? r.rows.filter((x) => restIds.has(x.id)).reduce((a, x) => a + x.amount, 0) : (r.rows.find((x) => x.id === id)?.amount || 0) });
  }
  const max = Math.max(1, ...months.map((m) => m.v));
  // Normal month = average of the earlier months that have any spending here.
  const prior = months.slice(0, 5).filter((m) => m.v > 0);
  const avg = prior.length ? Math.round(prior.reduce((a, m) => a + m.v, 0) / prior.length) : null;
  // One level deeper: where the money went inside this category.
  const subs = type === 'expense' && id !== '__rest' && T.subsOf(state, id).length ? T.totalsBySub(state, list, id).rows : [];
  const subHtml = subs.length ? `<div class="sheet-subs">${subs.map((r) => {
    const sb = r.id === T.NO_SUB ? null : T.subById(state, r.id);
    return `<div class="sheet-sub"><span>${sb?.emoji ? `${esc(sb.emoji)} ` : ''}${esc(sb ? sb.name : 'No subcategory')}</span><span class="muted small">${Math.round(r.share * 100)}%</span><b class="font-num">${ctx.money(r.amount)}</b></div>`;
  }).join('')}<button type="button" class="btn small" data-drill="${esc(id)}">See it in Reports</button></div>` : '';
  ctx.openSheet(`<h3>${esc(title)} <button type="button" class="icon-btn" data-close aria-label="Close">✕</button></h3>
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><span class="k">${esc(range.label)}</span><b>${ctx.money(sum)}</b></div>
      <div class="stat"><span class="k">Share</span><b>${total ? Math.round((sum / total) * 100) : 0}%</b></div>
      <div class="stat"><span class="k">Normal month</span><b>${avg == null ? '–' : ctx.money(avg)}</b></div>
    </div>
    <div class="mini-months">${months.map((m) => `<div class="mm"><span class="mm-bar"><i style="height:${((m.v / max) * 100).toFixed(1)}%"></i></span><span class="mm-l">${monthLabel(m.k, true).slice(0, 3)}</span><span class="mm-v">${m.v ? ctx.money(m.v).replace(/ [A-Z]+$/, '') : '–'}</span></div>`).join('')}</div>
    ${subHtml}
    ${items.length ? `<div class="list">${items.map((t) => ctx.txRow(t, { showDate: true })).join('')}</div>` : '<p class="muted">No records.</p>'}`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const d = e.target.closest('[data-drill]');
      if (d) { ctx.closeSheet(); ctx.drillReports?.(d.dataset.drill); return; }
      const row = e.target.closest('[data-act="edit"]');
      if (row) { ctx.closeSheet(); ctx.openTxSheet(ctx.state.tx.find((t) => t.id === row.dataset.id)); }
    });
  });
}

// Hovering a category in the list or the bar lights up both.
export function bindHover(root) {
  root.addEventListener('mouseover', (e) => {
    const el = e.target.closest('.spend [data-cat]');
    const card = el?.closest('.spend') || null;
    for (const c of root.querySelectorAll('.spend.hovering')) if (c !== card) c.classList.remove('hovering');
    if (!el) return;
    card.classList.add('hovering');
    for (const x of card.querySelectorAll('[data-cat]')) x.classList.toggle('hot', x.dataset.cat === el.dataset.cat);
  });
}
