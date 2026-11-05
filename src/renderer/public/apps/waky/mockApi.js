// Full-fidelity in-browser engine for Waky Sleep companion inside Life System Web
// Persists directly to localStorage and syncs with Turso Cloud
(function() {
  const STORAGE_KEY = 'waky_web_data_v2';
    // Through the Life System web server, with the session from the PIN login
    // (the Turso key stays on the server).
    const tursoSession = () => { try { return localStorage.getItem('life_web_session') || ''; } catch { return ''; } };

  // A clean start: no personal data in this public file. Inside Life System the
  // real record (wake-ups, bedtimes, targets) comes from Life System (WK2).
  const SEED_DATA = {
    "version": 2,
    "settings": {
      "weekday": "07:00",
      "weekend": "08:30",
      "grace": 20,
      "reps": 20,
      "sound": true,
      "why": "",
      "pcAlarm": true,
      "stillUp": true,
      "alarmOffset": -1,
      "alarmSound": "bells",
      "alarmRamp": 60,
      "alarmVolume": 80,
      "alarmMax": 20,
      "stillUpAfter": 10,
      "stillUpWindow": 10,
      "bedtimeOn": true,
      "sleepGoal": 450,
      "bedRemind": 30,
      "sunrise": 10,
      "theme": "dawn",
      "notifications": true
    },
    "days": {},
    "rewards": [],
    "spent": [],
    "opened": {},
    "shielded": [],
    "nights": {},
    "bedReminders": {}
  };

  const JOURNEY = [
    [1, 1, "First morning", "Your body clock is set mostly by when you wake up and see light. Today you sent it its first new signal.", "Probably rough. That's normal.", "Open the curtains or turn on a bright light as soon as you're up."],
    [2, 1, "The hard one", "Day 2 is often the toughest: the novelty is gone and you may be short on sleep. The grogginess fades 15–30 minutes after you're up.", "Tired. Get light on your face and move.", "Don't sleep in to 'catch up'. Getting up at the same time is what resets your clock."],
    [3, 1, "The pattern starts", "Every repeat strengthens the link between alarm and stand up. Your brain starts treating it as the default.", "Still effort, but less arguing with yourself.", "Charge your phone across the room again tonight."],
    [4, 1, "Proof", "Four mornings is proof to yourself that you can. Self-trust is built from small promises you keep.", "A bit proud, still tired.", "Go to bed 15 minutes earlier tonight."],
    [5, 2, "Sleepy earlier", "Regular wake-ups and morning light move your evening melatonin earlier. You'll start getting sleepy sooner at night.", "Evenings feel sleepier. Go with it.", "When you feel sleepy in the evening, go to bed. Don't push through it."],
    [7, 2, "One week", "Your body clock has had a week of the same signal and has shifted toward your new time.", "Mornings start feeling less like a fight.", "Look at your calendar: seven marks. Remember this on a hard morning."],
    [9, 2, "The weekend test", "Weekends are where most people slip. Sleeping in two hours shifts your body clock like flying across time zones.", "Tempted to sleep in.", "Keep weekends within an hour of your weekday time."],
    [10, 3, "Morning energy", "Your body's natural energy boost comes more reliably when your wake time is regular.", "More energy in the first hour.", "Get 5–10 minutes of outdoor light in the first hour."],
    [12, 3, "Fewer arguments", "You negotiate less with the alarm. A decision made in advance takes far less effort in the moment.", "Less drama at 06:30.", "Lay out your clothes the night before."],
    [14, 3, "Before the alarm", "With a steady rhythm, some mornings you'll wake a few minutes before the alarm.", "Waking up feels more natural.", "If you wake before the alarm, get up. Don't go back to sleep."],
    [17, 3, "Steadier afternoons", "A regular sleep schedule tends to soften the afternoon slump.", "Fewer crashes after lunch.", "Keep caffeine before noon."],
    [21, 3, "Less willpower", "The behaviour is shifting from deliberate effort to routine.", "Getting up is just what happens.", "Decide what the free morning hour is for."],
    [25, 4, "Evenings reorganise", "Your evenings start arranging themselves around the wake time.", "Late nights feel less appealing.", "Phone out of the bedroom an hour before bed."],
    [30, 4, "One month", "A month of steady sleep timing. Linked to better mood, focus and sleep quality.", "Clearer head, steadier days.", "Claim a reward. You've earned it."],
    [40, 4, "Mornings are yours", "The early hours are now reliably yours.", "Calm, ahead of the day.", "Keep the first 30 minutes phone-free."],
    [45, 4, "Bad days don't break it", "Missing a single day doesn't undo the progress. What matters is getting back on track.", "Confident, even after an off day.", "Never miss twice."],
    [50, 4, "Fifty", "Most attempts at a new routine fade in the first couple of weeks. You're at fifty.", "Quietly confident.", "Tell someone what you've built."],
    [60, 4, "The new normal", "This wake time is now your body's normal.", "Sleeping in feels strange.", "Keep the same time on holidays when you can."],
    [66, 4, "Automatic", "It took 66 days on average for a habit to feel automatic. You're there.", "You don't decide to get up. You just do.", "Nothing to change. Keep showing up."],
    [75, 5, "Others notice", "People around you see the change: the steadiness, the early start.", "Steady.", "Help someone else start."],
    [90, 5, "A full season", "Three months is a full season of mornings.", "Solid.", "Set your next goal for those mornings."],
    [100, 5, "Morning person", "Not a streak any more. It's who you are.", "Proud. You earned this.", "Claim the big reward."]
  ];

  const LEVELS = { 1: "Waking up", 2: "Adjusting", 3: "Body clock locked in", 4: "The habit", 5: "Identity" };
  const RANKS = { 1: "Recruit", 2: "Agoge", 3: "Hoplite", 4: "Spartan", 5: "Legend" };
  const LEVEL_INFO = {
    1: "The hardest part. Your body is still fighting the change, so every morning counts double.",
    2: "Training. Your body clock starts following your new time instead of the old one.",
    3: "You stand in the line. Energy comes earlier and more reliably, and mornings stop being a fight.",
    4: "Getting up stops being a decision. It's simply what you do.",
    5: "Not something you do any more. Who you are."
  };
  const LEVEL_STARTS = { 1: 1, 2: 5, 3: 10, 4: 25, 5: 75 };

  const TIERS = [
    { id: "bronze", name: "Bronze", level: 1, min: 0 },
    { id: "silver", name: "Silver", level: 2, min: 100 },
    { id: "gold", name: "Gold", level: 3, min: 250 },
    { id: "legendary", name: "Legendary", level: 4, min: 500 }
  ];

  const QUOTES = [
    { text: "How long will you wait before you demand the best of yourself?", who: "Epictetus", source: "Enchiridion" },
    { text: "At dawn, when you have trouble getting out of bed, tell yourself: 'I have to go to work — as a human being.'", who: "Marcus Aurelius", source: "Meditations" },
    { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", who: "Will Durant", source: "Story of Philosophy" },
    { text: "The first and greatest victory is to conquer yourself.", who: "Plato", source: "Laws" },
    { text: "No man is free who is not master of himself.", who: "Epictetus", source: "Discourses" }
  ];

  function toMin(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  function fromMin(total) {
    total = Math.round(total);
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  function load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === 'object') {
          parsed.days = parsed.days || {};
          parsed.settings = { ...SEED_DATA.settings, ...(parsed.settings || {}) };
          parsed.rewards = parsed.rewards || [];
          parsed.opened = parsed.opened || {};
          parsed.nights = parsed.nights || {};
          // Older copies carried a Telegram link from the first seed: not needed here.
          delete parsed.telegram;
          mergeLife(parsed);
          return parsed;
        }
      }
    } catch {}
    const fresh = JSON.parse(JSON.stringify(SEED_DATA));
    mergeLife(fresh);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  // ---- WK2: one sleep record. Life System writes your real sleep log and
  // targets here (localStorage 'life_sleep'); Waky shows that, not its own copy.
  function lifeSleep() {
    try {
      const v = JSON.parse(localStorage.getItem('life_sleep') || 'null');
      return v && Array.isArray(v.logs) ? v : null;
    } catch { return null; }
  }
  const QUALITY_MOOD = { 5: 'great', 4: 'great', 3: 'okay', 2: 'tired', 1: 'tired' };
  const MOOD_QUALITY = { great: 5, okay: 3, tired: 1 };
  const dayBefore = (d) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  function mergeLife(data) {
    const L = lifeSleep();
    if (!L) return false;
    data.settings = data.settings || {};
    if (L.weekday) data.settings.weekday = L.weekday;
    if (L.weekend) data.settings.weekend = L.weekend;
    if (L.bedTarget) data.settings.bedtime = L.bedTarget;
    const days = {};
    const nights = {};
    for (const l of L.logs) {
      if (!l || !/^\d{4}-\d{2}-\d{2}$/.test(l.day)) continue;
      const own = (data.days || {})[l.day] || {};
      if (l.wakeTime) days[l.day] = Object.assign({}, own, { time: l.wakeTime, target: l.wakeTarget || own.target, sent: true, mode: own.mode || 'life' }, l.quality ? { mood: QUALITY_MOOD[l.quality] } : {});
      // Life keeps a bedtime on the morning it ends in; Waky files it under the evening.
      if (l.bedTime) nights[dayBefore(l.day)] = { time: l.bedTime, target: l.bedTarget || L.bedTarget || '23:00', onTime: !!l.bedOnTime };
    }
    // A check-in or bedtime from the last two days that Life System hasn't saved yet stays.
    const recent = dayBefore(dayBefore(L.today || new Date().toISOString().slice(0, 10)));
    for (const [k, v] of Object.entries(data.days || {})) if (k >= recent && !days[k]) days[k] = v;
    for (const [k, v] of Object.entries(data.nights || {})) if (k >= recent && !nights[k]) nights[k] = v;
    data.days = days;
    data.nights = nights;
    return true;
  }
  // Messages to Life System: the typed bridge, to our own page only (WK6).
  const tell = (action, payload) => {
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action, payload }, location.origin); } catch {}
  };

  function save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
    // Background sync to Turso Cloud
    syncTurso(data);
  }

  async function syncTurso(data) {
    try {
      const requests = [
        {
          type: 'execute',
          stmt: {
            sql: "INSERT INTO settings (key, value) VALUES ('waky_backup_json', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            args: [{ type: 'text', value: JSON.stringify(data) }]
          }
        }
      ];
      fetch('/api/db', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + tursoSession(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      }).catch(() => {});
    } catch {}
  }

  // Inside Life System there is ONE wallet: Life System writes your points,
  // what a wake-up and a bedtime really pay, and your next reward here
  // (localStorage 'life_points'). Waky then shows those instead of its own
  // coins, and its own shop is closed (rewards live in Life System).
  function lifeWallet() {
    try {
      const v = JSON.parse(localStorage.getItem('life_points') || 'null');
      return v && typeof v.balance === 'number' ? v : null;
    } catch { return null; }
  }

  function computeStats(data, todayDateStr) {
    const days = data.days || {};
    const nights = data.nights || {};
    const settings = data.settings || {};
    const grace = settings.grace || 20;

    const dayKeys = Object.keys(days).sort();
    const goodMornings = dayKeys.filter(k => {
      const rec = days[k];
      return toMin(rec.time) <= toMin(rec.target) + grace;
    });

    const goodTotal = goodMornings.length;
    // WK3: real streaks: on-time mornings in a row (today not logged yet doesn't break it).
    const isGood = (k) => days[k] && toMin(days[k].time) <= toMin(days[k].target) + grace;
    const prev = (k) => { const x = new Date(k + 'T12:00:00'); x.setDate(x.getDate() - 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    let streak = 0;
    let k0 = days[todayDateStr] ? todayDateStr : prev(todayDateStr);
    while (isGood(k0)) { streak++; k0 = prev(k0); }
    let best = 0;
    let run = 0;
    let last = null;
    for (const k of dayKeys) {
      run = isGood(k) && last && prev(k) === last && isGood(last) ? run + 1 : isGood(k) ? 1 : 0;
      best = Math.max(best, run);
      last = k;
    }
    best = Math.max(best, streak);
    const recent30 = dayKeys.filter((k) => k > (() => { let x = todayDateStr; for (let n = 0; n < 30; n++) x = prev(x); return x; })());
    const rate = recent30.length ? Math.round((100 * recent30.filter(isGood).length) / recent30.length) : null;
    const last14 = dayKeys.slice(-14);
    const avg = last14.length ? fromMin(last14.reduce((t, k) => t + toMin(days[k].time), 0) / last14.length) : null;
    // Real nights: bedtime (the evening before) to wake-up.
    const sleepOf = (morning) => {
      const n = nights[prev(morning)];
      const d = days[morning];
      if (!n || !d) return null;
      let m = toMin(d.time) - toMin(n.time);
      if (m <= 0) m += 1440;
      return m >= 120 && m <= 16 * 60 ? m : null;
    };

    // Calculate level
    let level = 1;
    if (goodTotal >= 75) level = 5;
    else if (goodTotal >= 25) level = 4;
    else if (goodTotal >= 10) level = 3;
    else if (goodTotal >= 5) level = 2;

    const rank = RANKS[level];
    const levelName = LEVELS[level];

    // Journey stages
    const stages = JOURNEY.map(([d, lv, title, text, feel, tip], i) => ({
      days: d,
      level: lv,
      rank: RANKS[lv],
      title,
      text,
      feel,
      tip,
      reached: goodTotal >= d,
      current: goodTotal === d,
      bonus: Object.values(LEVEL_STARTS).includes(d)
    }));

    const levels = [1, 2, 3, 4, 5].map(lv => ({
      level: lv,
      rank: RANKS[lv],
      name: LEVELS[lv],
      text: LEVEL_INFO[lv],
      from: LEVEL_STARTS[lv],
      to: LEVEL_STARTS[lv + 1] ? LEVEL_STARTS[lv + 1] - 1 : '…',
      reached: goodTotal >= LEVEL_STARTS[lv],
      current: level === lv
    }));

    const currentStage = stages.find(st => st.days === goodTotal) || stages[0];
    const nextStage = stages.find(st => st.days > goodTotal) || null;

    const journey = {
      level,
      rank,
      levelName,
      good: goodTotal,
      stages,
      levels,
      current: currentStage,
      next: nextStage
    };

    // Calculate coins & chest rewards
    const opened = data.opened || {};
    let chestCoins = 0;
    Object.values(opened).forEach(op => {
      op?.prize?.items?.forEach(item => {
        if (item.type === 'coins') chestCoins += item.amount || 0;
      });
    });

    const earnedCoins = (goodTotal * 20) + chestCoins;
    const spentCoins = (data.spent || []).reduce((acc, s) => acc + (s.cost || 0), 0);
    const balance = earnedCoins - spentCoins;

    const rewards = data.rewards || [];
    const goal = rewards.find(r => r.cost > balance) || rewards[0];
    const L = lifeWallet();

    // Build 14-day chart
    const chart = [];
    const today = new Date(todayDateStr);
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 864e5);
      const k = d.toISOString().slice(0, 10);
      const rec = days[k] || null;
      chart.push({
        date: k,
        time: rec ? rec.time : null,
        target: rec ? rec.target : (d.getDay() === 0 || d.getDay() === 6 ? settings.weekend : settings.weekday),
        ontime: rec ? toMin(rec.time) <= toMin(rec.target) + grace : false
      });
    }

    // Build calendar
    const calendar = [];
    for (let i = 24; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 864e5);
      const k = d.toISOString().slice(0, 10);
      const rec = days[k] || null;
      calendar.push({
        date: k,
        status: rec ? (toMin(rec.time) <= toMin(rec.target) + grace ? 'ontime' : 'late') : dayKeys.length && k >= dayKeys[0] && k < todayDateStr ? 'missed' : 'empty',
        time: rec ? rec.time : null
      });
    }
    for (let i = 1; i <= 3; i++) {
      const d = new Date(today.getTime() + i * 864e5);
      calendar.push({
        date: d.toISOString().slice(0, 10),
        status: 'future',
        time: null
      });
    }

    // Chests: one for each journey day you really reached, on the date you reached it.
    // Inside Life System they hold a badge (a keepsake), never points or power-ups (WK4).
    const reachedOn = {};
    goodMornings.forEach((k, n) => { reachedOn[n + 1] = k; });
    const chests = stages.filter((st) => st.reached).map((st) => ({
      id: `stage-${st.days}`,
      kind: st.bonus ? 'rank' : 'milestone',
      date: reachedOn[st.days] || todayDateStr,
      reason: `Day ${st.days} of your journey${st.bonus ? ` · ${st.rank}` : ''}`,
      opened: Boolean(opened[`stage-${st.days}`]),
      prize: opened[`stage-${st.days}`]?.prize || null,
      name: st.bonus ? 'Rank chest' : 'Milestone chest',
      info: 'A badge for this milestone.'
    }));

    const todayRec = days[todayDateStr] || null;
    const isTodayOnTime = todayRec ? toMin(todayRec.time) <= toMin(todayRec.target) + grace : false;

    return {
      today: {
        date: todayDateStr,
        target: todayRec ? todayRec.target : ((today.getDay() === 0 || today.getDay() === 6) ? settings.weekend : settings.weekday) || '07:00',
        weekend: today.getDay() === 0 || today.getDay() === 6,
        record: todayRec,
        ontime: isTodayOnTime,
        coins: L ? (isTodayOnTime ? L.wake : 0) : 20,
        coinReasons: L ? ['on time'] : ['early', 'still up'],
        quote: QUOTES[Math.abs(today.getDate()) % QUOTES.length],
        stillUp: {
          state: todayRec?.stillUp ? 'done' : 'none',
          due: todayRec?.stillUpDue || null,
          deadline: todayRec?.stillUpDue ? fromMin(toMin(todayRec.stillUpDue) + 10) : null
        }
      },
      streak,
      best,
      rate,
      avg,
      total: dayKeys.length,
      calendar,
      chart,
      journey,
      hit: currentStage,
      levelUp: goodTotal === 5,
      coins: L ? {
        balance: L.balance,
        earned: 0,
        spent: 0,
        goal: L.goal ? { id: 'life', emoji: '🎁', name: L.goal.title, cost: L.goal.price } : null
      } : {
        balance,
        earned: earnedCoins,
        spent: spentCoins,
        goal
      },
      preview: {
        onTime: L ? L.wake : 10,
        early: L ? L.wake : 15,
        // A rank never pays extra inside Life System.
        stage: nextStage,
        levelUp: false,
        streak: streak + 1,
        double: false
      },
      night: {
        morning: new Date(today.getTime() + 864e5).toISOString().slice(0, 10),
        wake: settings.weekday || '06:30',
        bedtime: settings.bedtime || '23:00',
        remindAt: fromMin(toMin(settings.bedtime || '23:00') - (settings.bedRemind || 30)),
        state: 'day',
        record: null,
        minutesLeft: 420,
        onTime: false,
        sleepIfNow: 840,
        enabled: true,
        coins: L ? L.bed : 5
      },
      sleep: (() => {
        const goal = settings.sleepGoal || 450;
        const chartS = chart.map((c) => ({ date: c.date, minutes: sleepOf(c.date), bed: nights[prev(c.date)]?.time || null, wake: days[c.date]?.time || null }));
        const known = chartS.filter((c) => c.minutes);
        const week = known.slice(-7);
        return {
          last: sleepOf(todayDateStr) || (known.length ? known[known.length - 1].minutes : null),
          avg: week.length ? Math.round(week.reduce((t, c) => t + c.minutes, 0) / week.length) : null,
          goal,
          chart: chartS,
          nightsOnGoal: week.filter((c) => c.minutes >= goal).length,
          nights: week.length,
          // WK7: what the last 7 nights are short of the goal (nights not logged don't count).
          debt: week.length ? Math.max(0, week.reduce((t, c) => t + (goal - c.minutes), 0)) : 0,
          // WK8: how steady your sleep is, 0–100: how far wake-ups (and bedtimes) wander from their usual time.
          steady: (() => {
            const w = dayKeys.slice(-14).map((k) => toMin(days[k].time));
            if (w.length < 5) return null;
            const b = Object.keys(nights).sort().slice(-14).map((k) => { const m = toMin(nights[k].time); return m < 720 ? m + 1440 : m; });
            const dev = (xs) => { const mean = xs.reduce((a, c) => a + c, 0) / xs.length; return xs.reduce((a, c) => a + Math.abs(c - mean), 0) / xs.length; };
            const d = dev(w) + (b.length >= 5 ? dev(b) * 0.5 : 0);
            return Math.max(0, Math.min(100, Math.round(100 - d * 1.2)));
          })(),
          // WK12: naps today.
          naps: (data.naps || {})[todayDateStr] || []
        };
      })(),
      game: {
        chests,
        unopened: chests.filter(c => !c.opened).length,
        inventory: {
          shields: 0,
          doubles: 0,
          vouchers: [],
          chestCoins,
          badges: Object.values(opened).filter((o) => o?.prize?.items?.some((it) => it.type === 'badge')).length
        },
        tiers: TIERS.map(t => ({
          ...t,
          unlocked: t.level <= level,
          rank: RANKS[t.level]
        })),
        shieldSave: 0,
        streakAtRisk: 0,
        newChests: chests.filter(c => c.date === todayDateStr && !c.opened)
      }
    };
  }

  const origFetch = window.fetch;
  window.fetch = async function(url, options = {}) {
    const u = typeof url === 'string' ? url : (url.url || '');
    if (!u.includes('/api/')) return origFetch.apply(this, arguments);

    const data = load();
    const now = new Date();
    // Your own calendar day (not UTC: in Chisinau that turned at 02:00/03:00).
    const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const today = ymd(now);
    // A night is filed under its evening: bed at 00:40 is still "last night".
    const nightKey = now.getHours() < 4 ? ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12)) : today;
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    if (u.includes('/api/ping')) {
      return new Response(JSON.stringify({ app: 'waky', commit: 'web' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Every action answers with the full state (the app re-renders from it);
    // a bare {ok:true} made it crash on 'today' (e.g. editing a day).
    const buildState = () => {
      const stats = computeStats(data, today);
      return {
        settings: data.settings || SEED_DATA.settings,
        days: data.days || {},
        nights: data.nights || {},
        rewards: data.rewards || SEED_DATA.rewards,
        tiers: TIERS,
        sounds: { bells: 'Bells', chime: 'Chime', digital: 'Digital', sunrise: 'Sunrise' },
        themes: {
          dawn: { name: 'Dawn', level: 1 },
          bronze: { name: 'Bronze', level: 2 },
          moonlight: { name: 'Moonlight', level: 3 },
          marble: { name: 'Gold & marble', level: 4 },
          legend: { name: 'Legend', level: 5 }
        },
        // The shape the app reads (mood counts and what helps); an array here
        // made every redraw crash ("reading 'length'").
        insights: (() => {
          const counts = { great: 0, okay: 0, tired: 0 };
          for (const r of Object.values(data.days || {})) if (r && counts[r.mood] !== undefined) counts[r.mood]++;
          const logged = counts.great + counts.okay + counts.tired;
          const lines = logged >= 7 ? [`You felt great on ${counts.great} of ${logged} mornings you logged.`] : [];
          return { logged, counts, lines, needed: 7 };
        })(),
        recapMonths: [...new Set(Object.keys(data.days || {}).map((d) => d.slice(0, 7)))].sort().reverse().slice(0, 12),
        spent: data.spent || [],
        stats: stats,
        telegram: { connected: false },
        alarm: { active: false, test: false },
        pcAlarm: { armed: false },
        update: { available: false }
      }
    };
    const reply = (extra) => new Response(JSON.stringify(Object.assign(buildState(), extra || {})), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const method = String(options.method || 'GET').toUpperCase();
    const readBody = () => { try { return JSON.parse(options.body || '{}'); } catch { return {}; } };
    const targetFor = (date) => { const wd = new Date(date + 'T12:00:00Z').getUTCDay(); return (wd === 0 || wd === 6 ? data.settings?.weekend : data.settings?.weekday) || '06:30'; };

    if (u.includes('/api/state')) return reply();

    // Edit or add a morning (History → Edit day / Add a day), or delete one.
    if (u.includes('/api/days')) {
      data.days = data.days || {};
      const m = /\/api\/days\/(\d{4}-\d{2}-\d{2})/.exec(u);
      if (method === 'DELETE' && m) {
        delete data.days[m[1]];
        save(data);
        return reply();
      }
      const body = readBody();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '') || !/^\d{1,2}:\d{2}$/.test(body.time || '')) {
        return new Response(JSON.stringify({ error: 'Pick a day and a time' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (body.date > today) return new Response(JSON.stringify({ error: 'That day has not come yet' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const time = body.time.padStart(5, '0');
      data.days[body.date] = Object.assign({ reps: 0, mode: 'manual', sent: true }, data.days[body.date] || {}, { time, target: (data.days[body.date] || {}).target || targetFor(body.date) });
      save(data);
      // Life System corrects its sleep record too (coins only for today).
      tell('WAKY_DAY_EDITED', { date: body.date, time });
      return reply();
    }

    if (u.includes('/api/bed') && method === 'DELETE') {
      if (data.nights) delete data.nights[nightKey];
      save(data);
      return reply();
    }

    if (u.includes('/api/spent/') && method === 'DELETE') {
      const id = decodeURIComponent(u.split('/api/spent/')[1] || '');
      data.spent = (data.spent || []).filter((x, i) => String(x.id) !== id && String(i) !== id);
      save(data);
      return reply();
    }

    if (u.includes('/api/rewards')) {
      data.rewards = data.rewards || [];
      if (method === 'DELETE') {
        const id = decodeURIComponent(u.split('/api/rewards/')[1] || '');
        data.rewards = data.rewards.filter((r) => String(r.id) !== id);
      } else {
        const b = readBody();
        if (b.name) data.rewards.push({ id: 'r-' + Date.now().toString(36), emoji: b.emoji || '🎁', name: String(b.name).slice(0, 60), tier: b.tier || 'small', cost: Number(b.cost) || 100 });
      }
      save(data);
      return reply();
    }

    if (u.includes('/api/update')) {
      return new Response(JSON.stringify({ available: false, behind: 0, error: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/recap')) {
      // WK18: the month from your real record.
      const month = (u.split('month=')[1] || today.slice(0, 7)).slice(0, 7);
      const grace = data.settings?.grace || 20;
      const entries = Object.entries(data.days || {}).filter(([d]) => d.startsWith(month)).sort((a, b) => a[0].localeCompare(b[0]));
      const good = (r) => toMin(r.time) <= toMin(r.target || '07:00') + grace;
      const onTime = entries.filter(([, r]) => good(r)).length;
      const earliest = entries.slice().sort((a, b) => a[1].time.localeCompare(b[1].time))[0];
      let longest = 0, run = 0, prevD = null;
      for (const [d, r] of entries) {
        run = good(r) && prevD && dayBefore(d) === prevD ? run + 1 : good(r) ? 1 : 0;
        longest = Math.max(longest, run);
        prevD = good(r) ? d : null;
      }
      const sleeps = entries.map(([d, r]) => {
        const n = (data.nights || {})[dayBefore(d)];
        if (!n) return null;
        let m = toMin(r.time) - toMin(n.time);
        if (m <= 0) m += 1440;
        return m >= 120 && m <= 960 ? m : null;
      }).filter(Boolean);
      const avgSleep = sleeps.length ? Math.round(sleeps.reduce((a, b) => a + b, 0) / sleeps.length) : 0;
      const moods = { great: 0, okay: 0, tired: 0 };
      for (const [, r] of entries) if (moods[r.mood] !== undefined) moods[r.mood]++;
      return new Response(JSON.stringify({ label: month, rankFrom: '', rankTo: '', mornings: entries.length, onTime, earliest: earliest ? { date: earliest[0], time: earliest[1].time } : null, longestStreak: longest, avgSleep, sleepHours: Math.round(sleeps.reduce((a, b) => a + b, 0) / 60), coins: 0, chests: Object.values(data.opened || {}).filter((o) => String(o.openedOn || '').startsWith(month)).length, bestChest: null, moods }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/checkin')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      data.days = data.days || {};
      data.days[today] = {
        time: timeStr,
        target: targetFor(today),
        reps: body.reps || 0,
        mode: body.mode || 'button',
        sent: true,
        stillUpDue: fromMin(toMin(timeStr) + 10),
        stillUpWindow: 10
      };
      save(data);
      tell('WAKY_CHECKIN_LOGGED', data.days[today]);
      const stats = computeStats(data, today);
      return reply({ ok: true, day: data.days[today], stats });
    }

    if (u.includes('/api/bed')) {
      data.nights = data.nights || {};
      // On time = by your bedtime target (past midnight counts as late).
      const bedT = data.settings?.bedtime || '23:00';
      const late = (t) => (toMin(t) < 12 * 60 ? toMin(t) + 1440 : toMin(t));
      data.nights[nightKey] = { time: timeStr, target: bedT, onTime: late(timeStr) <= late(bedT) + (data.settings?.grace || 20) };
      save(data);
      // Life System's sleep log gets the bedtime too (on the morning it ends in).
      tell('WAKY_BED_LOGGED', { time: timeStr });
      return reply({ ok: true });
    }

    // WK12: a nap (minutes), with a word on how late is too late. No points.
    if (u.includes('/api/nap')) {
      const b = readBody();
      const min = Math.max(5, Math.min(240, Math.round(Number(b.minutes) || 20)));
      data.naps = data.naps || {};
      data.naps[today] = [...(data.naps[today] || []), { at: timeStr, minutes: min }].slice(-4);
      save(data);
      const late = toMin(timeStr) >= 15 * 60;
      return reply({ ok: true, note: late ? 'Naps after 15:00 push your bedtime back. Keep the next one earlier.' : min > 30 ? 'Over 30 minutes can leave you groggy: 20 is the sweet spot.' : 'Nice: a short nap before 15:00 is the good kind.' });
    }

    if (u.includes('/api/stillup')) {
      if (data.days && data.days[today]) {
        data.days[today].stillUp = timeStr;
        save(data);
      }
      return reply({ ok: true });
    }

    if (u.includes('/api/mood')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      if (data.days && data.days[today]) {
        data.days[today].mood = body.mood || 'great';
        save(data);
        // WK13: the same 1–5 sleep quality Ben asks about.
        tell('WAKY_MOOD', { date: today, quality: MOOD_QUALITY[data.days[today].mood] || 3 });
      }
      return reply({ ok: true });
    }

    if (u.includes('/api/chests/open')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const chestId = body.id || 'rank-5';
      data.opened = data.opened || {};
      // In Life System, points come only from what you did: a chest gives a streak shield, not coins.
      const prize = lifeWallet() ? { rarity: chestId.includes('stage-') && [5, 10, 25, 75].includes(Number(chestId.split('-')[1])) ? 'epic' : 'common', items: [{ type: 'badge' }] } : { rarity: 'rare', items: [{ type: 'coins', amount: 35 }] };
      data.opened[chestId] = { prize, openedOn: today };
      save(data);
      return reply({ ok: true, prize });
    }

    if (u.includes('/api/redeem')) {
      if (lifeWallet()) return new Response(JSON.stringify({ error: 'Rewards live in Life System now: open Rewards there.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      data.spent = data.spent || [];
      data.spent.push({ id: body.id, cost: body.cost || 100, at: now.toISOString() });
      save(data);
      return reply({ ok: true });
    }

    if (u.includes('/api/settings')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      data.settings = Object.assign(data.settings || {}, body);
      save(data);
      // WK5: one set of wake-up targets: Life System's change too.
      if (body.weekday || body.weekend) tell('WAKY_TARGETS', { weekday: data.settings.weekday, weekend: data.settings.weekend });
      return reply({ ok: true });
    }

    return reply({ ok: true });
  };
})();
