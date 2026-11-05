// Inside Life System, Waky uses Life System's points (one wallet). Life
// System writes them into this page (localStorage 'life_points': balance,
// what an on-time wake-up and bedtime pay, the next reward). Then this file:
// - says "points" instead of "coins" everywhere on screen;
// - shows the real amounts ("+2"), not Waky's own (+10, +15, +5);
// - hides Waky's own reward shop (rewards live in Life System → Rewards).
// Outside Life System (no 'life_points'), nothing changes.
(() => {
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem('life_points') || 'null');
      return v && typeof v.balance === 'number' ? v : null;
    } catch {
      return null;
    }
  };

  const style = document.createElement('style');
  style.textContent = `
    /* Waky's own shop: closed (rewards live in Life System). The chests stay. */
    .in-life #shop-tiers, .in-life .card:has(#add-reward), .in-life .spent-card { display: none !important; }
  `;
  document.head.appendChild(style);

  // "coins" → "points" in every text on the page, now and as Waky redraws.
  const swap = (t) => t.replace(/\bcoins\b/g, 'points').replace(/\bCoins\b/g, 'Points').replace(/\bcoin\b/g, 'point').replace(/\bDouble Points\b/g, 'Streak boost').replace(/🪙/g, '⭐')
    // The treasury: your Life System points, not Waky's earned/spent.
    .replace(/\b\d+ earned · \d+ spent · /, 'Life System points · ')
    .replace(/^Unlocks .* rewards$/, 'Rewards: Life System → Rewards');
  const fix = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const v = n.nodeValue;
      // Chests opened before: those were Waky's old coins, never Life System points.
      if (v && /\b\d+ (coins|points)\s*$/.test(v) && /chest/i.test(v) && !/old Waky coins/.test(v)) {
        n.nodeValue = v.replace(/\b(\d+) (coins|points)\s*$/, '$1 old Waky coins');
        continue;
      }
      if (v && /^Unlocks .* rewards$/.test(v.trim())) {
        n.nodeValue = 'Rewards: Life System → Rewards';
        continue;
      }
      if (v && !/old Waky coins/.test(v) && /coin|🪙| earned · /i.test(v)) {
        const s = swap(v);
        if (s !== v) n.nodeValue = s;
      }
    }
    root.querySelectorAll?.('[title*="coin"], [aria-label*="coin"]').forEach((el) => {
      for (const a of ['title', 'aria-label']) if (el.getAttribute(a)) el.setAttribute(a, swap(el.getAttribute(a)));
    });
  };

  // The how-it-works lines with Waky's own numbers: the real ones.
  const amounts = () => {
    const L = read();
    if (!L) return;
    document.querySelectorAll('li, p, button').forEach((el) => {
      const t = el.textContent || '';
      if (/when you're up on time/.test(t) && !el.dataset.life) {
        el.dataset.life = '1';
        el.innerHTML = `<b>+${L.wake}</b> points in Life System when you're up on time (logged as you get up)`;
      } else if (/In bed on time: \+\d+/.test(t) && !el.dataset.life) {
        el.dataset.life = '1';
        el.textContent = t.replace(/In bed on time: \+\d+ (coins|points)\./, `In bed on time: +${L.bed} points in Life System.`);
      } else if (/^Yes, I'm up \(\+\d+/.test(t.trim())) {
        el.textContent = "Yes, I'm up";
      }
    });
  };

  const run = () => {
    // Not inside Life System (or its points haven't arrived yet): Waky as it is.
    if (!read()) return;
    document.documentElement.classList.add('in-life');
    fix(document.body);
    amounts();
    // The tab now holds the chests and your points: it says so.
    const tab = document.querySelector('.tab[data-view="rewards"]');
    if (tab && tab.firstChild && tab.firstChild.nodeValue !== 'Chests') tab.firstChild.nodeValue = 'Chests';
  };
  const start = () => {
    run();
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        run();
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // Life System updated your points: Waky redraws with the new balance.
    window.addEventListener('life-points', () => window.dispatchEvent(new Event('focus')));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
