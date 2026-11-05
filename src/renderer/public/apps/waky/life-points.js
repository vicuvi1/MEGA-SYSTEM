// Inside Life System, Waky uses Life System's points (one wallet): the
// amounts come from Life System (localStorage 'life_points') and Waky shows
// them directly (WK25: no more rewriting "coins" on the page after it draws).
// This file only marks the page as inside Life System and hides Waky's old
// reward shop (rewards live in Life System → Rewards).
(() => {
  const inLife = () => {
    try {
      const v = JSON.parse(localStorage.getItem('life_points') || 'null');
      return !!(v && typeof v.balance === 'number');
    } catch {
      return false;
    }
  };
  const style = document.createElement('style');
  style.textContent = `.in-life #shop-tiers, .in-life .card:has(#add-reward), .in-life .spent-card { display: none !important; }`;
  document.head.appendChild(style);
  const mark = () => {
    if (!inLife()) return;
    document.documentElement.classList.add('in-life');
    const tab = document.querySelector('.tab[data-view="rewards"]');
    if (tab && tab.firstChild && tab.firstChild.nodeValue !== 'Chests') tab.firstChild.nodeValue = 'Chests';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark);
  else mark();
  // Life System updated your points or your sleep: Waky redraws.
  window.addEventListener('life-points', () => (mark(), window.dispatchEvent(new Event('focus'))));
  window.addEventListener('storage', (e) => {
    if (e.key === 'life_points' || e.key === 'life_sleep') window.dispatchEvent(new Event('focus'));
  });
})();
