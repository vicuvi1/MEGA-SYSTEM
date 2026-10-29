// The Spartan avatar: one SVG figure that gains gear with each rank.
// 1 Recruit: tunic · 2 Agoge: red tunic, belt, small shield · 3 Hoplite: helmet, breastplate, spear, Λ shield
// 4 Spartan: crest and cloak · 5 Legend: golden armour with an aura.

let uid = 0;

export function spartanSvg(level) {
  const id = `sp${++uid}`; // Gradient ids must be unique per figure on the page.
  const gold = level >= 5;
  const metal = `url(#${id}${gold ? "gold" : "bronze"})`;
  const skin = `url(#${id}skin)`;
  const tunic = level >= 2 ? `url(#${id}red)` : `url(#${id}linen)`;
  const hair = "#2f1d12";
  const p = [];

  p.push(`<defs>
    <radialGradient id="${id}skin" cx="45%" cy="35%" r="70%"><stop offset="0" stop-color="#f3caa0"/><stop offset="1" stop-color="#c58b5e"/></radialGradient>
    <linearGradient id="${id}limb" x1="0" x2="1"><stop offset="0" stop-color="#c58b5e"/><stop offset=".45" stop-color="#ecbf93"/><stop offset="1" stop-color="#b97f54"/></linearGradient>
    <linearGradient id="${id}bronze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d08c"/><stop offset=".5" stop-color="#c8913f"/><stop offset="1" stop-color="#7a4c1a"/></linearGradient>
    <linearGradient id="${id}gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset=".45" stop-color="#f5c44a"/><stop offset="1" stop-color="#9a6410"/></linearGradient>
    <linearGradient id="${id}red" x1="0" x2="1"><stop offset="0" stop-color="#7f1515"/><stop offset=".5" stop-color="#b42222"/><stop offset="1" stop-color="#6d1111"/></linearGradient>
    <linearGradient id="${id}linen" x1="0" x2="1"><stop offset="0" stop-color="#b9a47c"/><stop offset=".5" stop-color="#ddcaa1"/><stop offset="1" stop-color="#a8936c"/></linearGradient>
    <radialGradient id="${id}aura"><stop offset="0" stop-color="rgba(245,196,74,.6)"/><stop offset="1" stop-color="rgba(245,196,74,0)"/></radialGradient>
  </defs>`);

  if (gold) p.push(`<circle cx="60" cy="80" r="66" fill="url(#${id}aura)" class="av-aura"/>`);
  p.push(`<ellipse cx="60" cy="155" rx="30" ry="4" fill="rgba(0,0,0,.35)"/>`); // ground shadow

  // Cloak behind everything.
  if (level >= 4) p.push(`<path d="M36 58 Q60 50 84 58 L100 150 Q60 158 20 150 Z" fill="${gold ? "#8a1414" : "#7a1212"}"/>
    <path d="M36 58 Q30 100 20 150 L28 150 Q36 104 42 62 Z" fill="rgba(0,0,0,.25)"/>`);

  // Legs, greaves and sandals.
  p.push(`<path d="M47 112 L46 146 L56 146 L57 112 Z" fill="url(#${id}limb)"/><path d="M63 112 L64 146 L74 146 L73 112 Z" fill="url(#${id}limb)"/>`);
  if (level >= 3) p.push(`<path d="M45.5 124 L46 145 L56 145 L56.5 124 Q51 121 45.5 124 Z" fill="${metal}"/><path d="M63.5 124 L64 145 L74 145 L74.5 124 Q69 121 63.5 124 Z" fill="${metal}"/>`);
  p.push(`<path d="M43 145 h15 v4 q-7.5 2 -15 0 Z" fill="#4a2e17"/><path d="M62 145 h15 v4 q-7.5 2 -15 0 Z" fill="#4a2e17"/>`);

  // Arms (behind the torso edges).
  p.push(`<path d="M37 60 Q28 64 26 82 L24 100 Q28 104 32 101 L35 84 Q38 72 42 66 Z" fill="url(#${id}limb)"/>`);
  p.push(`<path d="M83 60 Q92 64 94 82 L96 100 Q92 104 88 101 L85 84 Q82 72 78 66 Z" fill="url(#${id}limb)"/>`);
  p.push(`<circle cx="28" cy="102" r="4.5" fill="#d9a77a"/><circle cx="92" cy="102" r="4.5" fill="#d9a77a"/>`); // hands

  // Torso: tunic, then armour.
  p.push(`<path d="M38 58 Q60 50 82 58 L85 114 Q60 121 35 114 Z" fill="${tunic}"/>`);
  p.push(`<path d="M35 106 Q60 112 85 106 L85 114 Q60 121 35 114 Z" fill="rgba(0,0,0,.18)"/>`); // hem shade
  if (level >= 3) {
    p.push(`<path d="M40 60 Q60 53 80 60 L81 94 Q60 100 39 94 Z" fill="${metal}" stroke="rgba(0,0,0,.3)" stroke-width="1"/>`);
    p.push(`<path d="M50 70 Q55 76 60 74 Q65 76 70 70" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.6"/>`); // chest
    p.push(`<path d="M52 84 Q60 87 68 84" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.4"/>`);
    // Pteruges: leather strips below the armour.
    for (let x = 40; x < 80; x += 6.5) p.push(`<rect x="${x}" y="95" width="5.4" height="13" rx="1.5" fill="#5a3418" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>`);
  }
  if (level >= 2) p.push(`<rect x="37" y="92" width="46" height="5" rx="2" fill="${metal}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>`); // belt

  // Spear in the right hand.
  if (level >= 3) p.push(`<line x1="93" y1="16" x2="91" y2="152" stroke="#5e3b1e" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M93.5 2 L99 20 L88 20 Z" fill="${metal}" stroke="rgba(0,0,0,.3)" stroke-width=".8"/>`);

  // Neck and head.
  p.push(`<path d="M53 44 L53 56 Q60 60 67 56 L67 44 Z" fill="#cf9a6e"/>`);
  p.push(`<ellipse cx="46.5" cy="35" rx="2.6" ry="4.2" fill="#d9a277"/><ellipse cx="73.5" cy="35" rx="2.6" ry="4.2" fill="#d9a277"/>`);
  p.push(`<ellipse cx="60" cy="33" rx="13.5" ry="15.5" fill="${skin}"/>`);

  // Face: brows, eyes, nose, beard. Under a helmet only the eyes and beard show.
  const eyes = `<ellipse cx="54.6" cy="33.6" rx="2.3" ry="1.5" fill="#fbf4ea"/><ellipse cx="65.4" cy="33.6" rx="2.3" ry="1.5" fill="#fbf4ea"/>
    <circle cx="55" cy="33.7" r="1.15" fill="#2a170c"/><circle cx="65" cy="33.7" r="1.15" fill="#2a170c"/>
    <circle cx="55.4" cy="33.3" r=".35" fill="#fff"/><circle cx="65.4" cy="33.3" r=".35" fill="#fff"/>`;
  const beard = `<path d="M47 37 Q47.5 51 60 54 Q72.5 51 73 37 Q71 44.5 66.5 45 Q63 43.5 60 44 Q57 43.5 53.5 45 Q49 44.5 47 37 Z" fill="${hair}"/>
    <path d="M54.5 42.2 Q60 39.6 65.5 42.2 Q60 43.4 54.5 42.2 Z" fill="#24150b"/>`;
  if (level >= 3) {
    if (level >= 4) p.push(`<path d="M44 24 Q50 2 60 0 Q70 2 76 24 Q68 12 60 11 Q52 12 44 24 Z" fill="${gold ? "url(#" + id + "gold)" : "#c01f1f"}"/>
      <path d="M48 20 Q54 6 60 5 Q66 6 72 20" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1"/>`);
    p.push(beard);
    // Corinthian helmet with the T-shaped opening.
    p.push(`<path d="M44.5 38 Q44 15 60 14 Q76 15 75.5 38 L75 49 Q70.5 51.5 66.5 49 L66.5 39.5 L63 39.5 L63 46 L57 46 L57 39.5 L53.5 39.5 L53.5 49 Q49.5 51.5 45 49 Z"
      fill="${metal}" stroke="rgba(0,0,0,.35)" stroke-width="1"/>`);
    p.push(`<path d="M50 30 L70 30 L70 36.5 L63 36.5 L63 46 L57 46 L57 36.5 L50 36.5 Z" fill="#160d06"/>`); // opening
    p.push(`<circle cx="55" cy="33.4" r="1.1" fill="#f6e7c8"/><circle cx="65" cy="33.4" r="1.1" fill="#f6e7c8"/>`); // eyes glinting inside
    p.push(`<path d="M47 22 Q60 16 73 22" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>`); // highlight
  } else {
    p.push(`<path d="M46.5 31 Q45 14 60 14.5 Q75 14 73.5 31 Q72 24 66 22.5 Q60 25 54 22.5 Q48 24 46.5 31 Z" fill="${hair}"/>`); // hair
    p.push(`<path d="M50.8 29.6 Q54.5 27.8 58 29.8" fill="none" stroke="#24150b" stroke-width="1.9" stroke-linecap="round"/>
      <path d="M69.2 29.6 Q65.5 27.8 62 29.8" fill="none" stroke="#24150b" stroke-width="1.9" stroke-linecap="round"/>`); // brows
    p.push(eyes);
    p.push(`<path d="M60 34.5 Q58.6 38.8 59 39.6 Q60.2 40.4 61.4 39.6" fill="none" stroke="#a8714a" stroke-width="1.1" stroke-linecap="round"/>`); // nose
    p.push(beard);
  }

  // Shield on the left arm, in front.
  if (level >= 2) {
    const r = level >= 3 ? 23 : 15;
    const cy = level >= 3 ? 90 : 96;
    p.push(`<circle cx="27" cy="${cy}" r="${r}" fill="${metal}" stroke="rgba(0,0,0,.35)" stroke-width="1.4"/>
      <circle cx="27" cy="${cy}" r="${r - 3.2}" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.2"/>
      <path d="M${27 - r * 0.62} ${cy - r * 0.55} A${r} ${r} 0 0 1 ${27 + r * 0.2} ${cy - r * 0.9}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.6"/>`);
    if (level >= 3) p.push(`<path d="M18 101 L27 78 L36 101" fill="none" stroke="#8a1414" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round"/>`); // Λ
  }

  return `<svg class="spartan" viewBox="0 0 120 160" aria-hidden="true">${p.join("")}</svg>`;
}
