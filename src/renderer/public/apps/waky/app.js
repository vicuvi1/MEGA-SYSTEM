import { analyzePose, RepCounter, HINTS } from "./pushups.js";
import { spartanSvg } from "./avatar.js";
import { startPoseCamera } from "./camera.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(Math.round(n % 60)).padStart(2, "0")}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

let state = null;

// Numbers roll up to their new value instead of jumping.
function countTo(el, to) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = to;
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
  const start = performance.now(), dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- api ----------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function refresh() {
  try {
    state = await api("GET", "/api/state");
  } catch (e) {
    $("offline").hidden = false;  // The server is restarting or stopped; keep trying.
    throw e;
  }
  $("offline").hidden = true;
  render();
}

async function act(method, path, body, okMsg) {
  try {
    state = await api(method, path, body);
    render();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

function toast(msg, error = false) {
  const el = $("toast");
  el.textContent = msg;
  el.className = `toast${error ? " error" : ""}`;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, error ? 5000 : 2500);
}

// ---------- render ----------

function render() {
  renderToday();
  renderJourney();
  renderRewards();
  renderProgress();
  renderSettings();
  renderUpdates();
  renderAlarm();
  renderStillUp();
  renderNight();
  renderAvatar();
  renderMood();
  renderInsights();
  renderThemes();
}

function renderToday() {
  const s = state.stats;
  const now = new Date();
  const h = now.getHours();
  $("greeting").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("today-date").textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const t = s.today;
  const hero = $("hero");
  if (t.record) {
    const late = toMin(t.record.time) - toMin(t.record.target);
    const how = t.ontime ? (late <= 0 ? "On time" : `On time · ${late} min after target`) : `${late} min late`;
    hero.className = "hero card checked-in";
    hero.innerHTML = `
      <div>
        <div class="eyebrow">Done for today</div>
        <div class="target">${esc(t.record.time)}</div>
        <div class="status ${t.ontime ? "ok" : "late"}">${how}${t.record.reps ? ` · ${plural(t.record.reps, "push-up")}` : ""}${t.coins ? ` · +${t.coins} coins` : ""}</div>
        ${stillUpLine(t.stillUp, t.record, t.ontime)}
        ${s.sleep.last ? `<div class="su-line sleep-line">😴 Slept ${fmtDur(s.sleep.last)}</div>` : ""}
        <div class="mood-ask inline">${moodButtons(t.record.mood)}</div>
      </div>
      <svg class="hero-check ${t.ontime ? "" : "late"}" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg>`;
  } else {
    const nowMin = h * 60 + now.getMinutes();
    const target = toMin(t.target);
    const deadline = target + state.settings.grace;
    const missed = nowMin > deadline + 180; // Same cut-off as the nag bot.
    let status;
    if (nowMin < target) status = `<span class="status">Target in ${formatGap(target - nowMin)}</span>`;
    else if (nowMin <= deadline) status = `<span class="status ok">Check in by ${fromMin(deadline)} to be on time</span>`;
    else if (!missed) status = `<span class="status late">Past your on-time window. Check in anyway.</span>`;
    else status = `<span class="status">No check-in this morning. Tomorrow is a fresh one.</span>`;

    const shown = missed ? new Date(now.getTime() + 864e5) : now;
    const shownWeekend = [0, 6].includes(shown.getDay());
    const dayName = shown.toLocaleDateString("en-GB", { weekday: "long" });
    const editable = (time) =>
      `<button class="target editable" id="edit-time" title="Change wake-up time">${esc(time)}<span class="edit">Change</span></button>`;
    const pv = state.stats.preview;
    const early = nowMin < target;
    const prizeCoins = (missed ? pv.onTime : early ? pv.early : pv.onTime) * (pv.double ? 2 : 1);
    const gm = state.stats.game;
    const chips = [
      `<span class="chip gold">🪙 +${prizeCoins} coins${!missed && early ? " (early bonus)" : ""}</span>`,
      pv.stage ? `<span class="chip">🧠 Day ${pv.stage.days} · ${esc(pv.stage.title)}</span>` : "",
      pv.levelUp ? `<span class="chip rank">⚔️ Become ${pv.stage.rank === "Agoge" ? "an Agoge trainee" : `a ${esc(pv.stage.rank)}`}</span>` : "",
      pv.streak > 1 ? `<span class="chip">🔥 ${pv.streak}-day streak</span>` : "",
      pv.double ? `<span class="chip gold">⚡ Double Coins active</span>` : "",
      gm.shieldSave && !missed ? `<span class="chip shield">🛡️ Shield ready: saves your ${gm.shieldSave}-day streak</span>` : "",
      pv.stage ? `<span class="chip">🎁 ${pv.stage.bonus ? "Rank" : "Milestone"} chest</span>` : "",
    ].join("");
    const frac = missed ? 1 : nowMin < target ? 1 : Math.max(0, (deadline - nowMin) / Math.max(1, state.settings.grace));
    const calling = !missed && nowMin >= target - 30 && nowMin <= deadline;
    hero.className = `hero card wake${calling ? " calling" : ""}`;
    hero.innerHTML = `
      <div class="hero-left">
        <div class="eyebrow">${missed ? `Wake up tomorrow · ${dayName}` : `Wake-up target · ${dayName}`}</div>
        ${editable(missed ? (shownWeekend ? state.settings.weekend : state.settings.weekday) : t.target)}
        ${status}
        <div class="prize"><div class="prize-label">${missed ? "Tomorrow's prize" : "Waiting for you"}</div><div class="chips-row">${chips}</div></div>
      </div>
      <div class="cta wake-cta">
        ${missed ? `<button class="btn ghost" id="start">Check in for today anyway</button>
          <span class="muted small">Set your phone alarm before bed</span>` : `
        <button class="wake-btn" id="start" aria-label="I'm up">
          <span class="rays"></span>
          ${ring(frac, 104, "wake-ring")}
          <span class="sun"><b>I'M UP</b><small>+${prizeCoins} 🪙</small></span>
        </button>
        <button class="btn ghost small" id="start-cam">Or check in with ${state.settings.reps} push-ups</button>`}
      </div>`;
    $("start").onclick = checkinNow;
    if ($("start-cam")) $("start-cam").onclick = () => startSession("checkin");
    $("edit-time").onclick = () => openTimeDialog(shownWeekend);
  }

  countTo($("streak"), s.streak);
  $("streak-unit").textContent = s.streak === 1 ? "day" : "days";
  $("streak-best").textContent = s.best ? `Best: ${plural(s.best, "day")}` : "Your first check-in starts it";

  const why = state.settings.why;
  $("why-banner").className = `why-banner${why ? "" : " empty"}`;
  $("why-banner").innerHTML = why
    ? `<span class="why-mark">“</span>${esc(why)}<span class="why-edit">Edit</span>`
    : `<span class="why-cta">What are you getting up for? <b>Write your why →</b></span>`;
  const q = t.quote;
  $("quote-card").innerHTML = `<div class="label">Today's words</div>
    <blockquote>${esc(q.text)}</blockquote>
    <figcaption>${esc(q.who)} <span>· ${esc(q.source)}</span></figcaption>`;

  const j = s.journey;
  const cur = j.current, nxt = j.next;
  const pct = nxt ? Math.max(4, (100 * (j.good - nxt.from)) / (nxt.days - nxt.from)) : 100;
  $("journey-card").innerHTML = `
    <div class="jc-badge"><span>${["I", "II", "III", "IV", "V"][j.level - 1]}</span></div>
    <div>
      <div class="jc-eyebrow"><span class="rank">${esc(j.rank)}</span> Level ${j.level} · ${esc(j.levelName)}${cur ? ` · day ${cur.days}` : ""}</div>
      <div class="jc-title">${cur ? esc(cur.title) : "Your journey starts with one good morning"}</div>
      <div class="jc-text">${esc(cur ? cur.text : "Get up on time once and your body clock gets its first new signal.")}</div>
    </div>
    <div class="jc-next">${nxt ? `Next: <b>Day ${nxt.days} · ${esc(nxt.title)}</b>${plural(nxt.days - j.good, "more good morning")}
      <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>` : "<b>Journey complete</b>Keep going."}</div>`;

  const c = s.coins;
  countTo($("coin-balance"), c.balance);
  if (c.goal) {
    $("goal-bar").style.width = `${Math.max(4, Math.min(100, (100 * c.balance) / c.goal.cost))}%`;
    $("goal-sub").textContent = `${c.balance} / ${c.goal.cost} to ${c.goal.emoji} ${c.goal.name}`;
    if (s.game.unopened) $("goal-sub").innerHTML = `<span class="chest-chip">🎁 ${s.game.unopened} ${s.game.unopened === 1 ? "chest" : "chests"} to open</span>`;
  } else {
    $("goal-bar").style.width = "100%";
    $("goal-sub").textContent = state.rewards.length ? "You can afford every reward 🎉" : "Add rewards in the Rewards tab";
  }

  const week = s.calendar.slice(-7);
  const names = ["M", "T", "W", "T", "F", "S", "S"];
  $("week").innerHTML = week.map((d, i) =>
    `<div class="d ${d.status}${d.date === t.date ? " today" : ""}" title="${d.time ? "Up at " + d.time : ""}"><i></i>${names[i]}</div>`).join("");
  const good = week.filter((d) => d.status === "ontime").length;
  const past = week.filter((d) => !["future", "empty"].includes(d.status) && d.status !== "pending").length;
  $("week-sub").textContent = past ? `${good} of ${past} on time` : "Nothing logged yet this week";
}

const ROMAN = ["I", "II", "III", "IV", "V"];

function ring(frac, r = 54, cls = "") {
  const c = 2 * Math.PI * r;
  return `<svg class="ring-svg ${cls}" viewBox="0 0 ${2 * r + 12} ${2 * r + 12}">
    <circle class="ring-track" cx="${r + 6}" cy="${r + 6}" r="${r}"/>
    <circle class="ring-fill" cx="${r + 6}" cy="${r + 6}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(1, frac)))}"/>
  </svg>`;
}

function renderJourney() {
  const j = state.stats.journey;
  const lv = j.levels.find((l) => l.level === j.level);
  const nextLv = j.levels.find((l) => l.level === j.level + 1);
  const span = nextLv ? nextLv.from - lv.from : 1;
  const inLevel = j.good ? (nextLv ? (j.good - lv.from + 1) / span : 1) : 0;

  $("j-hero").innerHTML = `
    <div class="medal">
      ${ring(inLevel, 70, "medal-ring")}
      <div class="medal-core avatar-core">${spartanSvg(j.good ? j.level : 1)}</div>
      <div class="medal-num">${ROMAN[j.level - 1]}</div>
    </div>
    <div class="jh-main">
      <div class="label">Your journey · Level ${j.level} of 5</div>
      <h1 class="jh-rank">${esc(j.rank)}</h1>
      <div class="jh-name">${esc(j.levelName)}</div>
      <p class="jh-text">${esc(lv.text)}</p>
    </div>
    <div class="jh-stats">
      <div><b>${j.good}</b><span>good ${j.good === 1 ? "morning" : "mornings"}</span></div>
      <div><b>${j.next ? j.next.days - j.good : 0}</b><span>to ${j.next ? `"${esc(j.next.title)}"` : "the end"}</span></div>
      <div><b>${nextLv ? nextLv.from - j.good : "✓"}</b><span>${nextLv ? `to ${esc(nextLv.rank)}` : "Legend reached"}</span></div>
    </div>`;

  $("j-ranks").innerHTML = j.levels.map((l) => `
    <div class="rank-card ${l.current ? "current" : l.reached ? "reached" : "locked"}">
      <div class="rc-num">${ROMAN[l.level - 1]}</div>
      <div class="rc-rank">${esc(l.rank)}</div>
      <div class="rc-name">${esc(l.name)}</div>
      <div class="rc-days">${l.reached || l.current ? (l.current ? "You are here" : "✓ Reached") : `🔒 Day ${l.from}`}</div>
    </div>`).join("");

  let lastLevel = 0;
  $("timeline").innerHTML = j.stages.map((st, i) => {
    const isCur = j.current && st.days === j.current.days;
    const isNext = j.next && st.days === j.next.days;
    let head = "";
    if (st.level !== lastLevel) {
      lastLevel = st.level;
      const l = j.levels[st.level - 1];
      head = `<li class="lvl-banner ${l.reached ? "on" : ""}">
        <div class="lb-num">${ROMAN[st.level - 1]}</div>
        <div><div class="lb-rank">${esc(l.rank)} <span>· ${esc(l.name)} · days ${l.from}–${l.to}</span></div>
        <p>${esc(l.text)}</p></div></li>`;
    }
    const cls = ["stage", st.reached && "reached", isCur && "current", isNext && "next"].filter(Boolean).join(" ");
    const tag = isCur ? "You are here" : isNext ? `Next · ${st.days - j.good} more` : st.reached ? "✓" : "";
    return `${head}<li class="${cls}" style="--i:${i}">
      <div class="s-medal">${st.days}</div>
      <div class="card">
        <div class="s-top"><span class="s-day">Day ${st.days}</span><span class="s-title">${esc(st.title)}</span>
          ${st.bonus ? `<span class="s-bonus">+20 🪙 level bonus</span>` : ""}${tag ? `<span class="s-tag">${tag}</span>` : ""}</div>
        <p>${esc(st.text)}</p>
        <div class="s-meta"><span>💭 ${esc(st.feel)}</span><span>💡 ${esc(st.tip)}</span></div>
      </div></li>`;
  }).join("");

  const nx = j.next, cur = j.current;
  const pct = nx ? Math.max(4, (100 * (j.good - nx.from)) / (nx.days - nx.from)) : 100;
  $("j-side").innerHTML = `
    <div class="card side-next">
      <div class="label">Coming up</div>
      ${nx ? `<div class="sn-day">Day ${nx.days}</div><div class="sn-title">${esc(nx.title)}</div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <div class="muted small">${nx.days - j.good} more good ${nx.days - j.good === 1 ? "morning" : "mornings"}${nx.bonus ? " · unlocks a new rank" : ""}</div>`
      : `<div class="sn-title">You've walked the whole path.</div>`}
    </div>
    <div class="card side-tip">
      <div class="label">💡 For tonight</div>
      <p>${esc((cur || j.stages[0]).tip)}</p>
    </div>
    <div class="card side-rule">
      <div class="label">The rule</div>
      <p>Good mornings count in total, not in a row. A bad day pauses the journey. It never sends you back.</p>
    </div>`;
}

const RARITY = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const ITEMS = {
  shield: ["🛡️", "Streak Shield", "Saves your streak if you miss one day"],
  double: ["⚡", "Double Coins", "Your next on-time morning pays double"],
  voucher: ["🎟️", "Voucher", "One reward of this tier, free"],
};

function chestSvg(kind) {
  return `<svg class="chest-svg kind-${kind}" viewBox="0 0 120 100" aria-hidden="true">
    <ellipse class="ch-shadow" cx="60" cy="94" rx="46" ry="5"/>
    <rect class="ch-body" x="14" y="46" width="92" height="44" rx="6"/>
    <rect class="ch-plank" x="14" y="66" width="92" height="3"/>
    <g class="ch-lid"><path class="ch-lid-top" d="M14 48 Q14 16 60 16 Q106 16 106 48 Z"/><rect class="ch-band" x="12" y="43" width="96" height="8" rx="2"/></g>
    <rect class="ch-strap" x="22" y="18" width="9" height="72" rx="2"/><rect class="ch-strap" x="89" y="18" width="9" height="72" rx="2"/>
    <rect class="ch-lock" x="51" y="44" width="18" height="20" rx="4"/><circle class="ch-hole" cx="60" cy="54" r="2.6"/>
  </svg>`;
}

function itemLine(it) {
  if (it.type === "coins") return `<div class="pz-item"><span class="pz-ico">🪙</span><div><b>+${it.amount} coins</b></div></div>`;
  const [ico, name, desc] = ITEMS[it.type];
  const title = it.type === "voucher" ? `${it.tier[0].toUpperCase() + it.tier.slice(1)} ${name}` : name;
  return `<div class="pz-item"><span class="pz-ico">${ico}</span><div><b>${title}</b><small>${desc}</small></div></div>`;
}

function prizeShort(p) {
  return p.items.map((it) => it.type === "coins" ? `${it.amount} coins` : it.type === "voucher" ? `${it.tier} voucher` : ITEMS[it.type][1]).join(" + ");
}

function renderRewards() {
  const c = state.stats.coins;
  const g = state.stats.game;
  const j = state.stats.journey;
  const inv = g.inventory;
  const vouchers = inv.vouchers.reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {});

  $("treasury").innerHTML = `
    <div class="tr-coins">
      <div class="label">Treasury</div>
      <div class="balance"><span id="r-balance">${c.balance}</span><i class="coin"></i></div>
      <p class="muted small">${c.earned} earned · ${c.spent} spent${c.goal ? ` · next: ${esc(c.goal.emoji)} ${esc(c.goal.name)} in ${c.goal.cost - c.balance}` : ""}</p>
    </div>
    <div class="tr-rank"><div class="label">Rank</div><div class="tr-rank-name">${esc(j.rank)}</div>
      <div class="muted small">Unlocks ${g.tiers.filter((t) => t.unlocked).map((t) => t.name).join(", ")} rewards</div></div>
    <div class="tr-inv">
      <div class="label">Power-ups</div>
      <div class="inv">
        <div class="inv-item ${inv.shields ? "" : "none"}" title="${ITEMS.shield[2]}"><span>🛡️</span><b>${inv.shields}</b><small>Shield${inv.shields === 1 ? "" : "s"}</small></div>
        <div class="inv-item ${inv.doubles ? "" : "none"}" title="${ITEMS.double[2]}"><span>⚡</span><b>${inv.doubles}</b><small>Double</small></div>
        <div class="inv-item ${inv.vouchers.length ? "" : "none"}" title="${ITEMS.voucher[2]}"><span>🎟️</span><b>${inv.vouchers.length}</b><small>${inv.vouchers.length ? Object.entries(vouchers).map(([t, n]) => `${n}× ${t}`).join(", ") : "Vouchers"}</small></div>
      </div>
    </div>`;

  const closed = g.chests.filter((x) => !x.opened);
  const opened = g.chests.filter((x) => x.opened).reverse().slice(0, 6);
  $("chests").innerHTML = (closed.length ? closed.map((x) => `
      <button class="chest kind-${x.kind}" data-open="${esc(x.id)}">
        <div class="chest-glow"></div>${chestSvg(x.kind)}
        <div class="chest-name">${esc(x.name)}</div><div class="muted small">${esc(x.reason)}</div>
        <span class="btn primary small">Open</span>
      </button>`).join("") : `<div class="no-chests"><div class="chest-ghost">${chestSvg("milestone")}</div>
        <div><b>No chests waiting</b><p class="muted small">${j.next ? `Your next one comes with day ${j.next.days} of your journey.` : "Keep your streak going for streak chests."}</p></div></div>`)
    + (opened.length ? `<div class="opened"><div class="label">Opened</div>${opened.map((x) => `
      <div class="opened-row r-${x.prize.rarity}"><span class="rar">${RARITY[x.prize.rarity]}</span>${esc(x.name)} · ${esc(prizeShort(x.prize))}</div>`).join("")}</div>` : "");

  const byTier = {};
  state.rewards.forEach((r) => { (byTier[r.tier || "bronze"] ||= []).push(r); });
  $("shop-tiers").innerHTML = g.tiers.map((t) => {
    const list = (byTier[t.id] || []).sort((a, b) => a.cost - b.cost);
    const head = `<div class="tier-head tier-${t.id}"><span class="tier-badge">${t.name}</span>
      ${t.unlocked ? `<span class="muted small">Unlocked</span>` : `<span class="lock">🔒 Unlocks when you become <b>${esc(t.rank)}</b></span>`}</div>`;
    const cards = list.length ? list.map((r) => {
      const ready = t.unlocked && c.balance >= r.cost;
      const voucher = t.unlocked && inv.vouchers.find((v) => ["bronze", "silver", "gold", "legendary"].indexOf(v) >= ["bronze", "silver", "gold", "legendary"].indexOf(t.id));
      const pct = Math.max(3, Math.min(100, (100 * c.balance) / r.cost));
      return `<div class="reward tier-${t.id}${ready ? " ready" : ""}${t.unlocked ? "" : " locked"}">
        <button class="icon-btn del" data-del-reward="${esc(r.id)}" title="Remove">✕</button>
        <div class="emoji">${esc(r.emoji)}</div>
        <div class="name">${esc(r.name)}</div>
        <div class="cost">${r.cost} <i class="coin sm"></i></div>
        <div class="bar"><div class="bar-fill" style="width:${t.unlocked ? pct : 0}%"></div></div>
        ${!t.unlocked ? `<button class="btn ghost small" disabled>🔒 ${esc(t.rank)}</button>`
          : `<button class="btn ${ready ? "primary" : "ghost"} small" data-redeem="${esc(r.id)}" ${ready ? "" : "disabled"}>${ready ? "Claim it" : `${r.cost - c.balance} more to go`}</button>`}
        ${voucher ? `<button class="btn small voucher-btn" data-voucher="${esc(r.id)}">🎟️ Use voucher</button>` : ""}
      </div>`;
    }).join("") : `<div class="empty-note">No ${t.name.toLowerCase()} rewards yet. Add one below.</div>`;
    return `<section class="card tier-section tier-${t.id}${t.unlocked ? "" : " locked"} reveal">${head}<div class="shop">${cards}</div></section>`;
  }).join("");

  const spent = [...state.spent].reverse();
  $("spent").innerHTML = spent.length ? spent.map((x) => `<div class="row">
      <div class="when">${esc(x.emoji)} <b>${esc(x.name)}</b> <span class="muted small">· ${new Date(x.date + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></div>
      <span class="muted small">${x.voucher ? `🎟️ ${esc(x.voucher)} voucher` : `−${x.cost} coins`}</span>
      <div class="acts"><button class="icon-btn" data-undo="${esc(x.id)}">Undo</button></div>
    </div>`).join("") : `<div class="empty-note">Nothing claimed yet. Enjoy it when you get there.</div>`;
}

async function openChest(id) {
  const chest = state.stats.game.chests.find((x) => x.id === id);
  const box = $("chest-open");
  $("co-chest").innerHTML = `${chestSvg(chest.kind)}<div class="co-name">${esc(chest.name)}</div><div class="muted small">Tap to open</div>`;
  $("co-chest").className = "co-chest";
  $("co-prize").hidden = true;
  box.hidden = false;
  box.className = "chest-open";
  let res;
  try {
    res = await api("POST", "/api/chests/open", { id });
  } catch (e) {
    box.hidden = true;
    toast(e.message, true);
    return;
  }
  sound("tick");
  $("co-chest").classList.add("shaking");
  await new Promise((r) => setTimeout(r, 1500));
  $("co-chest").classList.add("bursting");
  box.classList.add(`flash-${res.prize.rarity}`);
  sound("done");
  await new Promise((r) => setTimeout(r, 450));
  const p = res.prize;
  $("co-prize").className = `co-prize r-${p.rarity}`;
  $("co-prize").innerHTML = `
    <div class="pz-rarity">${RARITY[p.rarity]}</div>
    <div class="pz-items">${p.items.map(itemLine).join("")}</div>
    <button class="btn primary" id="co-collect">Collect</button>`;
  $("co-prize").hidden = false;
  $("co-chest").classList.add("gone");
  if (p.rarity === "epic" || p.rarity === "legendary") confetti($("chest-confetti"), p.rarity === "legendary" ? 260 : 160);
  $("co-collect").onclick = () => { box.hidden = true; state = res; render(); };
}

function formatNext(iso) {
  if (!iso) return "soon";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "short" }) + " " + iso.slice(11, 16);
}

function stillUpLine(su, rec, ontime) {
  if (!su || su.state === "none") return "";
  const text = {
    waiting: `🕒 Still-up check at ${su.due}. Be at your desk.`,
    open: `🕒 Still-up check is open until ${su.deadline}.`,
    done: `✓ Still up at ${rec.stillUp}${ontime ? " · +5 coins" : ""}`,
    missed: ontime ? "✗ Missed the still-up check: this morning pays half." : "✗ Missed the still-up check.",
  }[su.state];
  return `<div class="su-line su-${su.state}">${text}</div>`;
}

function formatGap(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function renderProgress() {
  const s = state.stats;
  $("p-streak").textContent = plural(s.streak, "day");
  $("p-best").textContent = plural(s.best, "day");
  $("p-rate").textContent = s.rate == null ? "–" : `${s.rate}%`;
  $("p-avg").textContent = s.avg ?? "–";

  $("calendar").innerHTML = s.calendar.map((d, i) => {
    const day = Number(d.date.slice(8));
    const label = new Date(d.date + "T12:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const tip = d.time ? `${label} · up at ${d.time}` : d.status === "missed" ? `${label} · missed` : "";
    return `<div class="c ${d.status}" style="--i:${i}"${tip ? ` data-tip="${esc(tip)}"` : ""}>${day}</div>`;
  }).join("");

  $("chart").innerHTML = chartSvg(s.chart);


  const rows = Object.entries(state.days).sort(([a], [b]) => b.localeCompare(a));
  $("history").innerHTML = rows.length ? rows.map(([date, r]) => {
    const ontime = toMin(r.time) <= toMin(r.target) + state.settings.grace;
    const label = new Date(date + "T12:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const how = { manual: " · push-ups counted by hand", camera: ` · ${r.reps} push-ups`, added: " · added by hand" }[r.mode] || "";
    return `<div class="row">
      <div class="when"><span class="t">${esc(r.time)}</span> <span class="muted small">· ${label} · target ${esc(r.target)}${how}</span></div>
      <span class="tag ${ontime ? "ontime" : "late"}">${ontime ? "On time" : "Late"}</span>
      <div class="acts"><button class="icon-btn" data-edit="${date}">Edit</button><button class="icon-btn" data-del="${date}">Delete</button></div>
    </div>`;
  }).join("") : `<div class="empty-note">No days yet. Your first check-in shows up here.</div>`;
}

function chartSvg(points) {
  const W = 520, H = 240, L = 46, R = 12, T = 14, B = 26;
  const times = points.flatMap((p) => [toMin(p.target), ...(p.time ? [toMin(p.time)] : [])]);
  let lo = Math.min(...times) - 15, hi = Math.max(...times) + 15;
  lo = Math.floor(lo / 15) * 15; hi = Math.ceil(hi / 15) * 15;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (m) => T + ((m - lo) * (H - T - B)) / (hi - lo || 1); // Earlier = higher.
  const step = hi - lo > 600 ? 180 : hi - lo > 240 ? 60 : 30;
  let out = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
    out += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(m)}" y2="${y(m)}"/><text class="axis" x="${L - 8}" y="${y(m) + 4}" text-anchor="end">${fromMin(m)}</text>`;
  }
  out += `<polyline class="target" points="${points.map((p, i) => `${x(i)},${y(toMin(p.target))}`).join(" ")}"/>`;
  let seg = [];
  const segs = [];
  points.forEach((p, i) => {
    if (p.time) seg.push(`${x(i)},${y(toMin(p.time))}`);
    else if (seg.length) { segs.push(seg); seg = []; }
  });
  if (seg.length) segs.push(seg);
  segs.filter((s) => s.length > 1).forEach((s) => { out += `<polyline class="path" points="${s.join(" ")}"/>`; });
  points.forEach((p, i) => {
    if (p.time) out += `<circle class="pt" cx="${x(i)}" cy="${y(toMin(p.time))}" r="6" fill="var(--${p.ontime ? "ontime" : "late"})"><title>${p.date.slice(5)} · ${p.time}</title></circle>`;
    if (i % 2 === (points.length - 1) % 2) out += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${Number(p.date.slice(8))}</text>`;
  });
  if (!points.some((p) => p.time)) out += `<text class="empty" x="${(L + W) / 2}" y="${H / 2 - 20}" text-anchor="middle">Your wake-up times will show here</text>`;
  return out + "</svg>";
}

function renderSettings() {
  const st = state.settings;
  for (const [id, key] of [["s-weekday", "weekday"], ["s-weekend", "weekend"], ["s-grace", "grace"], ["s-reps", "reps"]]) {
    if (document.activeElement !== $(id)) $(id).value = st[key];
  }
  $("s-sound").checked = st.sound;
  $("s-pcalarm").checked = st.pcAlarm;
  $("s-bedtimeOn").checked = st.bedtimeOn;
  $("s-notifications").checked = st.notifications;
  $("bed-form").classList.toggle("off", !st.bedtimeOn);
  const bedFor = (wake) => fromMin(((toMin(wake) - st.sleepGoal) % 1440 + 1440) % 1440);
  $("bed-times").innerHTML = st.bedtimeOn
    ? `Bedtime: <b>${bedFor(st.weekday)}</b> on weeknights${st.weekend !== st.weekday ? `, <b>${bedFor(st.weekend)}</b> before weekend mornings` : ""}`
    : `<span class="muted">Off</span>`;
  $("s-stillup").checked = st.stillUp;
  if (!$("s-alarmSound").options.length) {
    $("s-alarmSound").innerHTML = Object.entries(state.sounds).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  }
  for (const key of SETTING_SELECTS) {
    if (document.activeElement !== $(`s-${key}`)) $(`s-${key}`).value = String(st[key]);
  }
  $("pcalarm-form").classList.toggle("off", !st.pcAlarm);
  $("stillup-form").classList.toggle("off", !st.stillUp);
  $("stillup-desc").textContent = st.stillUp
    ? `${st.stillUpAfter} minutes after you check in, Waky chimes and asks if you're still up. Answer at the PC within ${st.stillUpWindow} minutes: +5 coins. Miss it: that morning pays half.`
    : "Off. Turn it on to make sure you don't go back to bed after checking in.";
  const pa = state.pcAlarm;
  $("pcalarm-status").innerHTML = !st.pcAlarm ? `<span class="muted">Off</span>`
    : pa.error ? `<span class="err">${esc(pa.error)}</span>`
    : pa.armed ? `<span class="ok-text">✓ Armed · next ring ${esc(formatNext(pa.next))}</span>` : `<span class="muted">Setting up…</span>`;
  $("why-preview").textContent = st.why ? `“${st.why}”` : "Not written yet.";

  const tg = state.telegram;
  if (tg.connected) {
    $("tg-box").innerHTML = `
      <div class="tg-status"><span class="led"></span><div>Connected to <b>@${esc(tg.bot)}</b>${tg.name ? ` · ${esc(tg.name)}` : ""}</div></div>
      <p class="muted small">Each check-in is posted and pinned there. The nag bot reads the pin to know you're up.
        Its config needs your chat id: <b>${esc(tg.chatId)}</b></p>
      ${tg.error ? `<p class="err">Last check-in didn't go through: ${esc(tg.error)} Waky keeps retrying.</p>` : ""}
      <button class="btn ghost small" id="tg-off">Disconnect</button>`;
    $("tg-off").onclick = () => act("DELETE", "/api/telegram", null, "Disconnected");
  } else {
    $("tg-box").innerHTML = `
      <ol class="steps">
        <li>In @BotFather, revoke the old token and copy the new one.</li>
        <li>Paste it here.</li>
        <li>Open your bot in Telegram and send <b>/start</b>.</li>
        <li>Press Connect.</li>
      </ol>
      <div class="form"><input type="password" id="tg-token" placeholder="Bot token" autocomplete="off"></div>
      <p></p><button class="btn primary" id="tg-connect">Connect</button>`;
    $("tg-connect").onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Connecting…";
      await act("POST", "/api/telegram", { token: $("tg-token").value }, "Telegram connected");
      if ($("tg-connect")) { $("tg-connect").disabled = false; $("tg-connect").textContent = "Connect"; }
    };
  }
  $("data-note").textContent = `Data: ${state.dataDir}` + (state.backupDir
    ? ` · Backup: ${state.backupDir} ${state.backupOk ? "✓ up to date" : "· waiting for the drive, retrying every minute"}` : "");
}

// ---------- check-in ----------

async function checkinNow() {
  const prevStreak = state.stats.streak;
  const ok = await act("POST", "/api/checkin", { mode: "button" });
  if (ok) { sound("done"); showDone(prevStreak); }
}

// ---------- push-up session ----------

let session = null;

async function startSession(mode) {
  const target = mode === "test" ? 999 : state.settings.reps;
  session = { mode, target, reps: 0, stop: null, manual: false, lastValid: performance.now(), done: false };
  $("session").hidden = false;
  $("manual-pad").hidden = true;
  $("session-manual").hidden = true;
  $("count-of").textContent = mode === "test" ? "test" : `/ ${target}`;
  setCount(0);
  hint("Starting camera…");

  const counter = new RepCounter();
  const manualTimer = setTimeout(() => { if (session && !session.manual) $("session-manual").hidden = mode === "test"; }, 20000);
  session.cleanup = () => clearTimeout(manualTimer);

  try {
    hint("Loading the pose model…");
    session.stop = await startPoseCamera($("video"), $("overlay"), (lms, now, aspect) => {
      if (!session || session.manual || session.done) return;
      const pose = analyzePose(lms, aspect);
      const r = counter.push(pose.ok ? pose.elbow : null, now);
      if (!pose.ok) return hint(HINTS[pose.reason], "warn");
      session.lastValid = now;
      if (r.event === "rep") addRep();
      else if (r.event === "shallow") hint("Go lower", "warn");
      else if (r.phase === "wait") hint("Straighten your arms to start", "good");
      else hint(r.phase === "down" ? "Up!" : "Down", "good");
    });
    if (!session) return; // Closed while loading.
  } catch (e) {
    console.error(e);
    if (!session) return;
    hint(e.name === "NotAllowedError" ? "Camera blocked. Allow it in the address bar." : "Camera or pose model failed to load", "warn");
    if (mode !== "test") $("session-manual").hidden = false;
  }
}

function hint(text, tone = "") {
  const el = $("session-hint");
  if (el.textContent !== text) el.textContent = text;
  el.className = `pill ${tone}`;
}

function setCount(n) {
  const el = $("count");
  el.textContent = n;
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
  const frac = session.mode === "test" ? (n % 10) / 10 : Math.min(1, n / session.target);
  $("ring-fg").style.strokeDashoffset = 553 * (1 - frac);
}

function addRep() {
  session.reps += 1;
  setCount(session.reps);
  sound("tick");
  if (session.reps >= session.target) finishSession();
}

function closeSession() {
  if (!session) return;
  session.stop?.();
  session.cleanup?.();
  session = null;
  $("session").hidden = true;
}

async function finishSession() {
  const s = session;
  s.done = true;
  hint("Done!", "good");
  sound("done");
  const prevStreak = state.stats.streak;
  setTimeout(async () => {
    closeSession();
    const ok = await act("POST", "/api/checkin", { reps: s.reps, mode: s.manual ? "manual" : "camera" });
    if (ok) showDone(prevStreak);
  }, 600);
}

function showDone(prevStreak) {
  const s = state.stats;
  const t = s.today;
  $("done-title").textContent = t.ontime ? "You're up." : "You're up. Late, but up.";
  $("done-sub").textContent = `Checked in at ${t.record.time}` + (t.record.reps ? ` · ${plural(t.record.reps, "push-up")}` : "");
  $("done-coins").textContent = `+${t.coins}`;
  $("done-coins").nextElementSibling.textContent = t.coins ? `coins · ${t.coinReasons.join(", ")}` : "coins (late mornings earn none)";
  $("done-why").hidden = !state.settings.why;
  $("done-why").textContent = state.settings.why ? `“${state.settings.why}”` : "";
  $("done-quote").innerHTML = `${esc(t.quote.text)}<cite>${esc(t.quote.who)}</cite>`;
  const m = s.hit;
  $("done-milestone").hidden = !m;
  $("done-milestone").className = `milestone-hit${s.levelUp ? " level" : ""}`;
  if (m) {
    $("done-milestone").innerHTML = s.levelUp
      ? `<small>New level</small><b class="rank-up">${m.rank === "Agoge" ? "You've entered the Agoge" : `You are now a ${esc(m.rank)}`}</b>Level ${m.level} · ${esc(m.levelName)}. Day ${m.days}: ${esc(m.title)}. ${esc(m.text)}<span>+20 coins level bonus</span>`
      : `<b>🧠 Day ${m.days} · ${esc(m.title)}</b>${esc(m.text)}<span>How it may feel: ${esc(m.feel)}</span>`;
  }
  const extras = [];
  if (t.record.shieldUsed) extras.push("🛡️ A Streak Shield saved your streak");
  if (t.record.boost) extras.push("⚡ Double Coins used");
  s.game.newChests.forEach((x) => extras.push(`🎁 New ${x.name.toLowerCase()}! Open it in Rewards`));
  if (t.stillUp.state === "waiting") extras.push(`🕒 At ${t.stillUp.due} Waky asks if you're still up. Be at your desk: +5 coins.`);
  $("done-extras").innerHTML = extras.map((x) => `<div>${esc(x)}</div>`).join("");
  $("done-open").hidden = !s.game.unopened;
  $("done-mood").innerHTML = `<div class="muted small">How do you feel?</div>${moodButtons(t.record.mood)}`;
  const g = s.coins.goal;
  $("done-goal").textContent = g ? `${s.coins.balance} / ${g.cost} coins to ${g.emoji} ${g.name}` : `${s.coins.balance} coins: you can claim any reward`;
  $("done").hidden = false;
  $("done-streak-label").textContent = s.streak ? "day streak" : "Streak reset. On time tomorrow starts a new one.";
  $("done-streak").hidden = !s.streak;
  countUp($("done-streak"), Math.min(prevStreak, s.streak), s.streak);
  if (t.ontime) confetti($("confetti"), m ? 220 : 120);
}

function countUp(el, from, to) {
  el.textContent = from;
  if (from === to) return;
  setTimeout(() => { el.textContent = to; el.animate([{ transform: "scale(1.4)" }, { transform: "scale(1)" }], { duration: 500, easing: "ease-out" }); }, 700);
}

// ---------- effects ----------

let audio = null;
function sound(kind) {
  if (!state.settings.sound) return;
  audio ??= new AudioContext();
  const notes = kind === "tick" ? [[880, 0, 0.08]] : [[523, 0, 0.18], [659, 0.12, 0.18], [784, 0.24, 0.18], [1047, 0.36, 0.4]];
  for (const [freq, at, dur] of notes) {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = "sine";
    o.frequency.value = freq;
    const t0 = audio.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audio.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
}

function confetti(canvas, count) {
  const ctx = canvas.getContext("2d");
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  const colors = ["#ffb547", "#ff8a3d", "#34d399", "#f4f4f6", "#fbbf24"];
  const parts = Array.from({ length: count }, () => ({
    x: canvas.width / 2, y: canvas.height * 0.42,
    vx: (Math.random() - 0.5) * 26 * devicePixelRatio, vy: (-Math.random() * 22 - 6) * devicePixelRatio,
    r: (Math.random() * 5 + 3) * devicePixelRatio, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.vy += 0.6 * devicePixelRatio; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 2600);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    if (t < 2600) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  requestAnimationFrame(frame);
}

// ---------- events ----------

function showView(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".view .bar-fill").forEach((b) => { const w = b.style.width; b.style.width = "0"; requestAnimationFrame(() => requestAnimationFrame(() => { b.style.width = w; })); });
  scrollTo(0, 0);
}
document.querySelectorAll(".tab").forEach((tab) => { tab.onclick = () => showView(tab.dataset.view); });
document.querySelectorAll("[data-goto]").forEach((el) => { el.onclick = () => showView(el.dataset.goto); });

$("view-rewards").onclick = (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.open) openChest(btn.dataset.open);
  if (btn.dataset.redeem) {
    const r = state.rewards.find((x) => x.id === btn.dataset.redeem);
    if (r && confirm(`Claim ${r.emoji} ${r.name} for ${r.cost} coins?`)) {
      act("POST", "/api/redeem", { id: r.id }, `Enjoy it! ${r.emoji}`).then((ok) => ok && confetti($("chest-confetti"), 120));
    }
  }
  if (btn.dataset.voucher) {
    const r = state.rewards.find((x) => x.id === btn.dataset.voucher);
    if (r && confirm(`Use a voucher to claim ${r.emoji} ${r.name} for free?`)) {
      act("POST", "/api/redeem", { id: r.id, voucher: true }, `Enjoy it! ${r.emoji}`);
    }
  }
  if (btn.dataset.undo) act("DELETE", `/api/spent/${btn.dataset.undo}`, null, "Coins returned");
  if (btn.dataset.delReward && confirm("Remove this reward?")) act("DELETE", `/api/rewards/${btn.dataset.delReward}`, null, "Removed");
};

$("add-reward").onsubmit = async (e) => {
  e.preventDefault();
  const ok = await act("POST", "/api/rewards", { emoji: $("nr-emoji").value, name: $("nr-name").value, tier: $("nr-tier").value, cost: $("nr-cost").value }, "Reward added");
  if (ok) $("nr-name").value = "";
};

$("session-close").onclick = closeSession;
$("session-manual").onclick = () => {
  session.manual = true;
  session.stop?.();
  $("session-manual").hidden = true;
  $("manual-pad").hidden = false;
  hint("Counting by hand");
};
$("manual-tap").onclick = () => { if (session && !session.done) addRep(); };
$("done-close").onclick = () => { $("done").hidden = true; };
$("done-open").onclick = () => {
  $("done").hidden = true;
  showView("rewards");
  const first = state.stats.game.chests.find((x) => !x.opened);
  if (first) setTimeout(() => openChest(first.id), 400);
};
$("cam-test").onclick = () => startSession("test");
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeSession(); $("done").hidden = true; } });

const saveSetting = (key, value) => act("POST", "/api/settings", { [key]: value }, "Saved");
$("s-weekday").onchange = (e) => saveSetting("weekday", e.target.value);
$("s-weekend").onchange = (e) => saveSetting("weekend", e.target.value);
$("s-grace").onchange = (e) => saveSetting("grace", e.target.value);
$("s-reps").onchange = (e) => saveSetting("reps", e.target.value);
$("s-sound").onchange = (e) => saveSetting("sound", e.target.checked);
document.querySelectorAll("[data-step]").forEach((b) => {
  b.onclick = () => saveSetting("reps", Math.max(1, Number($("s-reps").value) + Number(b.dataset.step)));
});

$("history").onclick = (e) => {
  const del = e.target.dataset.del, edit = e.target.dataset.edit;
  if (del && confirm(`Delete ${del}?`)) act("DELETE", `/api/days/${del}`, null, "Deleted");
  if (edit) openDayDialog(edit);
};
$("add-day").onclick = () => openDayDialog(null);

function openDayDialog(date) {
  const today = state.stats.today.date;
  $("day-dialog-title").textContent = date ? "Edit day" : "Add a day";
  $("d-date").value = date || today;
  $("d-date").max = today;
  $("d-date").disabled = !!date;
  $("d-time").value = date ? state.days[date].time : state.stats.today.target;
  $("day-dialog").showModal();
}
$("day-dialog").addEventListener("close", () => {
  if ($("day-dialog").returnValue === "save") {
    act("POST", "/api/days", { date: $("d-date").value, time: $("d-time").value }, "Saved");
  }
});

function openWhyDialog() {
  $("why-input").value = state.settings.why || "";
  $("why-dialog").showModal();
  $("why-input").focus();
}
$("why-banner").onclick = openWhyDialog;
$("why-edit-settings").onclick = openWhyDialog;
$("why-chips").onclick = (e) => { if (e.target.tagName === "BUTTON") $("why-input").value = e.target.textContent; };
$("why-dialog").addEventListener("close", () => {
  if ($("why-dialog").returnValue === "save") act("POST", "/api/settings", { why: $("why-input").value }, "Saved. See you at dawn.");
});

function ago(sec) {
  if (sec == null) return "never";
  const d = Math.floor(Date.now() / 1000) - sec;
  return d < 90 ? "just now" : d < 5400 ? `${Math.round(d / 60)} min ago` : `${Math.round(d / 3600)} h ago`;
}

function renderUpdates() {
  const u = state.update;
  $("update-dot").hidden = !u.behind;
  $("u-version").textContent = u.build ? `Build ${u.build} · ${u.commit} · ${u.date}` : "";
  if (u.behind) {
    $("u-box").innerHTML = `
      <p class="u-new">✨ A new version is ready (${u.behind} ${u.behind === 1 ? "change" : "changes"})</p>
      <ul class="u-changes">${u.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
      <button class="btn primary" id="u-install">Update now</button>
      <p class="muted small">Takes a few seconds. Your days, coins and settings stay exactly as they are.</p>`;
    $("u-install").onclick = installUpdate;
  } else {
    $("u-box").innerHTML = `
      <p>${u.error ? `<span class="err">${esc(u.error)}</span>` : "✓ You're on the latest version."}</p>
      <button class="btn ghost" id="u-check">Check for updates</button>
      <p class="muted small">Checked ${ago(u.checkedAt)}. Waky also checks GitHub by itself every 6 hours.</p>`;
    $("u-check").onclick = checkUpdate;
  }

  const items = [
    [true, `Running for ${formatGap(Math.max(1, Math.round(state.uptime / 60)))}`],
    [!state.settings.pcAlarm || state.pcAlarm.armed, state.settings.pcAlarm ? (state.pcAlarm.armed ? `PC alarm armed · next ${formatNext(state.pcAlarm.next)}` : (state.pcAlarm.error || "PC alarm not armed yet")) : "PC alarm off"],
    [state.backupOk, state.backupDir ? (state.backupOk ? "Google Drive backup up to date" : "Waiting for Google Drive, retrying every minute") : "No backup folder set"],
    [state.telegram.connected && !state.telegram.error, state.telegram.connected ? (state.telegram.error ? `Telegram: ${state.telegram.error}` : `Telegram connected to @${state.telegram.bot}`) : "Telegram not connected"],
    [!u.error, u.error ? "Can't reach GitHub for updates" : "Updates from GitHub working"],
  ];
  $("health").innerHTML = items.map(([ok, text]) => `<li class="${ok ? "ok" : "warn"}"><i></i>${esc(text)}</li>`).join("");
}

async function checkUpdate(e) {
  e.target.disabled = true;
  e.target.textContent = "Checking GitHub…";
  try {
    state.update = await api("GET", "/api/update");
    renderUpdates();
    toast(state.update.behind ? "A new version is ready" : state.update.error ? "Couldn't check" : "You're up to date", !!state.update.error);
  } catch (err) {
    toast(err.message, true);
    renderUpdates();
  }
}

async function installUpdate(e) {
  e.target.disabled = true;
  e.target.textContent = "Updating…";
  try {
    const res = await api("POST", "/api/update", {});
    toast(`Updated to build ${res.version.build}. Restarting…`);
  } catch (err) {
    toast(err.message, true);
    renderUpdates();
    return;
  }
  // Wait for the new version to come back up, then load it.
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 1500));
  while (Date.now() - started < 60000) {
    try {
      const ping = await fetch("/api/ping", { cache: "no-store" });
      if (ping.ok) { location.reload(); return; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  toast("Waky didn't come back. Open it again from the desktop.", true);
}

// ---------- PC alarm & still-up ----------

const wantsAlarm = new URLSearchParams(location.search).has("alarm");

function renderAlarm() {
  const a = state.alarm;
  const ringing = a.active || (wantsAlarm && !state.stats.today.record && !renderAlarm.dismissed);
  $("alarm").hidden = !ringing;
  if (!ringing) return;
  const sunrise = a.phase === "sunrise";
  $("alarm").classList.toggle("sunrising", sunrise);
  $("alarm").style.setProperty("--sunrise", `${a.sunriseSeconds || 60}s`);
  $("alarm-label").textContent = sunrise ? `Good morning · the alarm sounds at ${(a.ringAt || "").slice(0, 5)}`
    : a.test ? "Test alarm" : "Time to get up";
  $("alarm-up").querySelector("small").textContent = sunrise ? "up before the sound" : "stop the alarm";
  $("alarm-why").textContent = state.settings.why ? `“${state.settings.why}”` : state.stats.today.quote.text;
  $("alarm-stop-test").hidden = !a.test;
  $("alarm-up").hidden = !!a.test;
}

function renderStillUp() {
  const su = state.stats.today.stillUp;
  $("stillup").hidden = su.state !== "open";
  if (su.state === "open") $("su-left").textContent = `You have until ${su.deadline}.`;
  clearTimeout(renderStillUp.timer);
  if (su.state === "waiting" || su.state === "open") {
    // Refresh right when the window opens or closes.
    const [h, m] = (su.state === "waiting" ? su.due : su.deadline).split(":").map(Number);
    const at = new Date(); at.setHours(h, m + (su.state === "open" ? 1 : 0), 2, 0);
    renderStillUp.timer = setTimeout(() => refresh().catch(() => {}), Math.max(1000, at - Date.now()));
  }
}

$("alarm-up").onclick = async () => {
  renderAlarm.dismissed = true;
  history.replaceState(null, "", "/");
  await checkinNow();
};
$("alarm-stop-test").onclick = () => act("POST", "/api/alarm", { action: "stop" });
$("alarm-test").onclick = () => act("POST", "/api/alarm", { action: "test" }, "Ringing for 15 seconds");
$("su-yes").onclick = () => act("POST", "/api/stillup", {}, "Still up! +5 coins").then((ok) => ok && confetti($("chest-confetti"), 90));
$("s-pcalarm").onchange = (e) => saveSetting("pcAlarm", e.target.checked);
const SETTING_SELECTS = ["alarmOffset", "alarmSound", "alarmRamp", "alarmVolume", "alarmMax", "stillUpAfter", "stillUpWindow", "sleepGoal", "bedRemind", "sunrise"];
$("s-notifications").onchange = (e) => saveSetting("notifications", e.target.checked);
$("notify-test").onclick = () => api("POST", "/api/notify-test", {}).then(() => toast("Sent: look at the bottom-right corner")).catch((e) => toast(e.message, true));
$("s-bedtimeOn").onchange = (e) => saveSetting("bedtimeOn", e.target.checked);
for (const key of SETTING_SELECTS) {
  $(`s-${key}`).onchange = (e) => saveSetting(key, key === "alarmSound" ? e.target.value : Number(e.target.value));
}
$("s-stillup").onchange = (e) => saveSetting("stillUp", e.target.checked);
setInterval(() => {
  $("alarm-clock").textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (!$("alarm").hidden) refresh().catch(() => {});  // Notice quickly when the alarm stops.
}, 3000);

// ---------- bedtime ----------

function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

function renderNight() {
  const n = state.stats.night;
  const card = $("night-card");
  const show = n.enabled && n.state !== "day";
  card.hidden = !show;
  if (show) {
    const left = n.minutesLeft;
    let body;
    if (n.state === "done") {
      body = `
        <div class="nc-main"><div class="eyebrow">Good night 🌙</div>
          <div class="nc-big">In bed at ${esc(n.record.time)}</div>
          <div class="status ${n.onTime ? "ok" : ""}">${n.onTime ? `On time · +${n.coins} coins` : "After bedtime · no coins tonight"} · alarm ${esc(n.wake)}</div></div>
        <div class="nc-cta"><button class="btn primary" id="nc-sleep">😴 Put the PC to sleep</button>
          <button class="btn ghost small" id="nc-undo">Undo</button>
          <span class="muted small">Asleep, not shut down: then the PC alarm can wake it.</span></div>`;
    } else {
      const head = { evening: `Bedtime ${n.bedtime}`, remind: `Bedtime in ${left} min`, due: "It's bedtime", late: `Past bedtime (${n.bedtime})` }[n.state];
      const sub = n.state === "late"
        ? `Going now still gives you ${fmtDur(n.sleepIfNow)} of sleep.`
        : `${n.state === "evening" ? `In ${formatGap(left)}. ` : ""}Going now gives you ${fmtDur(n.sleepIfNow)} of sleep before ${n.wake}.`;
      body = `
        <div class="nc-main"><div class="eyebrow">Tonight</div><div class="nc-big">${head}</div><div class="status">${sub}</div></div>
        <div class="nc-cta"><button class="btn ${n.state === "evening" ? "ghost" : "primary"} ${n.state === "due" ? "calling" : ""}" id="nc-bed">🌙 Going to bed</button>
          <span class="muted small">${n.state === "late" ? "Too late for coins tonight" : `+${n.coins} coins if you're in bed by ${addMin(n.bedtime, state.settings.grace)}`}</span></div>`;
    }
    card.className = `card night-card s-${n.state}`;
    card.innerHTML = `<div class="nc-moon"></div>${body}`;
    if ($("nc-bed")) $("nc-bed").onclick = goToBed;
    if ($("nc-sleep")) $("nc-sleep").onclick = sleepPc;
    if ($("nc-undo")) $("nc-undo").onclick = () => act("DELETE", "/api/bed", null, "Undone");
  }

  // The reminder prompt: once per state per night.
  const key = `bed-${n.morning}-${n.state}`;
  const prompt = n.enabled && (n.state === "remind" || n.state === "due") && !seen(key);
  $("bed-prompt").hidden = !prompt;
  if (prompt) {
    $("bp-title").textContent = n.state === "due" ? "Time for bed" : `Bedtime in ${n.minutesLeft} minutes`;
    $("bp-sub").textContent = `Bedtime ${n.bedtime} · wake-up ${n.wake}. Going now gives you ${fmtDur(n.sleepIfNow)} of sleep.`;
    $("bp-alarm").textContent = `⏰ Phone alarm set for ${n.wake}`;
    $("bp-later").onclick = () => { remember(key); $("bed-prompt").hidden = true; };
    $("bp-bed").onclick = () => { remember(key); goToBed(); };
  }

  renderSleep();
}

function seen(key) { try { return localStorage.getItem(key) === "1"; } catch { return renderNight[key]; } }
function remember(key) { try { localStorage.setItem(key, "1"); } catch { renderNight[key] = true; } }
function addMin(hhmm, m) { return fromMin((toMin(hhmm) + m) % 1440); }

async function goToBed() {
  const ok = await act("POST", "/api/bed", {});
  if (!ok) return;
  $("bed-prompt").hidden = true;
  const n = state.stats.night;
  toast(n.onTime ? `Good night. +${n.coins} coins 🌙` : "Good night 🌙");
  sound("done");
}

async function sleepPc() {
  if (!confirm(`Put the PC to sleep now? It wakes itself for the alarm at ${state.pcAlarm.next ? state.pcAlarm.next.slice(11, 16) : "your wake-up time"}.`)) return;
  try {
    await api("POST", "/api/sleep-pc", {});
    toast("Sleeping in 3 seconds. Good night 🌙");
  } catch (e) { toast(e.message, true); }
}

function renderSleep() {
  const sl = state.stats.sleep;
  $("sleep-stats").innerHTML = `
    <div><b>${sl.last ? fmtDur(sl.last) : "–"}</b><span>last night</span></div>
    <div><b>${sl.avg ? fmtDur(sl.avg) : "–"}</b><span>average</span></div>
    <div><b>${fmtDur(sl.goal)}</b><span>goal</span></div>
    <div><b>${sl.nights ? `${sl.nightsOnGoal}/${sl.nights}` : "–"}</b><span>nights near the goal</span></div>`;
  const max = Math.max(sl.goal + 60, ...sl.chart.map((c) => c.minutes || 0));
  $("sleep-bars").innerHTML = `<div class="goal-line" style="bottom:${(100 * sl.goal) / max}%"></div>` + sl.chart.map((c) => {
    const h = c.minutes ? (100 * c.minutes) / max : 0;
    const cls = !c.minutes ? "none" : c.minutes >= sl.goal - 15 ? "good" : c.minutes >= sl.goal - 75 ? "ok" : "short";
    return `<div class="sb ${cls}" title="${c.date.slice(5)}${c.minutes ? " · " + fmtDur(c.minutes) : ""}"><i style="height:${h}%"></i><span>${Number(c.date.slice(8))}</span></div>`;
  }).join("") + (sl.nights ? "" : `<div class="sleep-empty">Press "Going to bed" at night and check in in the morning: your sleep shows up here.</div>`);
}

// ---------- Spartan avatar ----------

function renderAvatar() {
  const j = state.stats.journey;
  const level = j.good ? j.level : 1;
  const next = j.levels.find((l) => l.level === j.level + 1);
  const gear = ["Plain tunic", "Red tunic, belt and a small shield", "Bronze helmet, breastplate, spear and the Λ shield", "A red crest and the Spartan cloak", "Golden armour"][level - 1];
  $("avatar-card").innerHTML = `
    <div class="av-figure">${spartanSvg(level)}</div>
    <div class="av-info"><div class="label">Your Spartan</div>
      <div class="av-rank">${esc(j.rank)}</div>
      <div class="muted small">${gear}</div>
      ${next ? `<div class="av-next">Next look at <b>${esc(next.rank)}</b> · ${next.from - j.good} more good mornings</div>` : `<div class="av-next">Fully armed. Legend.</div>`}
    </div>`;
}

// ---------- mood ----------

const MOODS = { tired: ["😴", "Tired"], okay: ["🙂", "Okay"], great: ["⚡", "Great"] };

function moodButtons(current) {
  return `<div class="moods">${Object.entries(MOODS).map(([k, [e, label]]) =>
    `<button class="mood ${current === k ? "on" : ""}" data-mood="${k}"><span>${e}</span>${label}</button>`).join("")}</div>`;
}

function renderMood() {}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-mood]");
  if (b) act("POST", "/api/mood", { mood: b.dataset.mood }, `${MOODS[b.dataset.mood][0]} Noted`).then(() => {
    if (!$("done").hidden) $("done-mood").innerHTML = `<div class="muted small">How do you feel?</div>${moodButtons(b.dataset.mood)}`;
  });
});

function renderInsights() {
  const ins = state.insights;
  $("mood-counts").textContent = ins.logged ? Object.entries(ins.counts).map(([k, n]) => `${MOODS[k][0]} ${n}`).join("  ") : "";
  $("insights").innerHTML = ins.lines.length
    ? ins.lines.map((l) => `<p class="insight">${esc(l)}</p>`).join("")
    : `<p class="muted">Tap how you feel after each check-in. After ${ins.needed} mornings with sleep hours, Waky tells you what helps you wake up feeling great.</p>
       <div class="bar"><div class="bar-fill" style="width:${Math.max(4, (100 * Math.min(ins.logged, ins.needed)) / ins.needed)}%"></div></div>
       <p class="muted small">${ins.logged} of ${ins.needed} logged</p>`;
  $("recap-months").innerHTML = state.recapMonths.length
    ? state.recapMonths.map((m) => `<button class="btn ghost small" data-recap="${m}">${new Date(m + "-15").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</button>`).join("")
    : `<p class="muted small">Your first recap appears after your first month.</p>`;
}

// ---------- themes ----------

function renderThemes() {
  const level = state.stats.journey.good ? state.stats.journey.level : 1;
  document.body.dataset.theme = state.settings.theme || "dawn";
  const RANK = ["Recruit", "Agoge", "Hoplite", "Spartan", "Legend"];
  $("themes").innerHTML = Object.entries(state.themes).map(([id, t]) => {
    const open = level >= t.level;
    return `<button class="theme-swatch sw-${id} ${state.settings.theme === id ? "on" : ""} ${open ? "" : "locked"}" data-theme-pick="${id}" ${open ? "" : "disabled"}>
      <i></i><b>${esc(t.name)}</b><span>${open ? (state.settings.theme === id ? "In use" : "Use") : `🔒 ${RANK[t.level - 1]}`}</span></button>`;
  }).join("");
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-theme-pick]");
  if (t) act("POST", "/api/settings", { theme: t.dataset.themePick }, "Theme changed");
});

// ---------- monthly recap story ----------

let story = null;

async function openRecap(month) {
  let r;
  try { r = await api("GET", `/api/recap?month=${month}`); } catch (e) { toast(e.message, true); return; }
  const RAR = { common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary" };
  const moods = r.moods.great + r.moods.okay + r.moods.tired;
  const slides = [
    `<div class="st-kicker">Your month</div><div class="st-huge">${esc(r.label)}</div><p>${r.rankFrom === r.rankTo ? `You held the line as <b>${esc(r.rankTo)}</b>.` : `You rose from <b>${esc(r.rankFrom)}</b> to <b>${esc(r.rankTo)}</b>.`}</p>`,
    `<div class="st-kicker">Mornings on time</div><div class="st-huge">${r.onTime}<small>/${r.mornings}</small></div><p>${r.mornings ? `${Math.round((100 * r.onTime) / Math.max(1, r.mornings))}% of the mornings you checked in.` : "No check-ins this month."}</p>`,
    r.earliest ? `<div class="st-kicker">Your earliest morning</div><div class="st-huge">${esc(r.earliest.time)}</div><p>${new Date(r.earliest.date + "T12:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>` : null,
    `<div class="st-kicker">Longest streak</div><div class="st-huge">${r.longestStreak}<small> days</small></div><p>${r.longestStreak >= 7 ? "A full week and more. That's a Spartan." : "Next month: beat it."}</p>`,
    r.avgSleep ? `<div class="st-kicker">Sleep</div><div class="st-huge">${r.sleepHours}<small> h</small></div><p>${fmtDur(r.avgSleep)} a night on average.</p>` : null,
    `<div class="st-kicker">Treasury</div><div class="st-huge">+${r.coins}<small> coins</small></div><p>${r.chests ? `${r.chests} chests opened${r.bestChest ? `, the best one ${RAR[r.bestChest]}` : ""}.` : "No chests opened."}</p>`,
    moods ? `<div class="st-kicker">How you felt</div><div class="st-moods"><div>⚡<b>${r.moods.great}</b></div><div>🙂<b>${r.moods.okay}</b></div><div>😴<b>${r.moods.tired}</b></div></div>` : null,
    `<div class="st-kicker">For next month</div><blockquote>${esc(r.quote.text)}</blockquote><cite>${esc(r.quote.who)}</cite>`,
  ].filter(Boolean);
  story = { slides, i: 0, timer: null };
  $("story").hidden = false;
  showSlide(0);
}

function showSlide(i) {
  if (!story) return;
  if (i >= story.slides.length) return closeStory();
  story.i = Math.max(0, i);
  $("story-bars").innerHTML = story.slides.map((_, k) => `<i class="${k < story.i ? "full" : k === story.i ? "run" : ""}"></i>`).join("");
  $("story-slide").innerHTML = `<div class="st-inner">${story.slides[story.i]}</div>`;
  clearTimeout(story.timer);
  story.timer = setTimeout(() => showSlide(story.i + 1), 4800);
}

function closeStory() {
  if (story) clearTimeout(story.timer);
  story = null;
  $("story").hidden = true;
}

$("story-next").onclick = () => story && showSlide(story.i + 1);
$("story-prev").onclick = () => story && showSlide(story.i - 1);
$("story-close").onclick = closeStory;
document.addEventListener("click", (e) => { const b = e.target.closest("[data-recap]"); if (b) openRecap(b.dataset.recap); });

// On the first days of a month, show last month's recap once.
function maybeAutoRecap() {
  const now = new Date();
  if (now.getDate() > 3) return;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 7);
  if (!state.recapMonths.includes(prev) || seen(`recap-${prev}`)) return;
  remember(`recap-${prev}`);
  setTimeout(() => openRecap(prev), 1500);
}

let timeScope = "all";
function setTimeScope(scope) {
  timeScope = scope;
  document.querySelectorAll("#t-scope button").forEach((b) => b.classList.toggle("on", b.dataset.scope === scope));
}
function openTimeDialog(weekend) {
  const { weekday, weekend: weekendTime } = state.settings;
  setTimeScope(weekday === weekendTime ? "all" : weekend ? "weekend" : "weekday");
  $("t-time").value = weekend ? weekendTime : weekday;
  $("time-dialog").showModal();
}
document.querySelectorAll("#t-scope button").forEach((b) => { b.onclick = () => setTimeScope(b.dataset.scope); });
$("time-dialog").addEventListener("close", () => {
  if ($("time-dialog").returnValue !== "save") return;
  const time = $("t-time").value;
  const body = timeScope === "all" ? { weekday: time, weekend: time } : { [timeScope]: time };
  const label = { all: "every day", weekday: "Mon–Fri", weekend: "Sat–Sun" }[timeScope];
  act("POST", "/api/settings", body, `Wake-up set to ${time}, ${label}`);
});

function tick() {
  $("clock").textContent = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
setInterval(tick, 1000);
tick();
setInterval(() => refresh().catch(() => {}), 60000); // Also tells the server the window is still open.
setInterval(() => { if (!$("offline").hidden) refresh().catch(() => {}); }, 5000);
addEventListener("focus", () => refresh().catch(() => {}));
refresh().then(maybeAutoRecap).catch((e) => toast(e.message, true));
