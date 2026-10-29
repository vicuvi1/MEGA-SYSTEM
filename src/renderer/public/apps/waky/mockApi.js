// Full-fidelity in-browser engine for Waky Sleep companion inside Life System Web
// Persists directly to localStorage and syncs with Turso Cloud
(function() {
  const STORAGE_KEY = 'waky_web_data_v2';
  const TURSO_URL = 'https://life-os-vicuvi1.aws-eu-central-1.turso.io';
  const TURSO_TOKEN = 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3OTMyNzg3ODIsImlkIjoiMDFhMTg3YmMtZTMwMS03NjMxLTk1ZWItOTZlZWYwZjliYWI5Iiwia2lkIjoiaTR0SmlyVldhQWpaMjBqVGl4amV0djdlX01Takk3VjJoYjJETHdPY0ZlMCIsInJpZCI6IjNjOGYwZjRlLTU4N2ItNDQzNy05ZTJiLWFlNDVhMDI4Mjg5MiJ9.zgJsjcY3LncWY_DHcmQmbPaZBybHd1xff3Cwi3RTpHPfEo2XU_nCUa2VYS0VFmVKKntzCXR9ZV7Vh2geaIdyCA';

  // Seed with Victor's real PC data from waky.json
  const SEED_DATA = {
    "version": 2,
    "settings": {
      "weekday": "06:30",
      "weekend": "06:30",
      "grace": 20,
      "reps": 20,
      "sound": true,
      "why": "The man I'm becoming doesn't stay in bed.",
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
      "sleepGoal": 420,
      "bedRemind": 30,
      "sunrise": 10,
      "theme": "dawn",
      "notifications": true
    },
    "days": {
      "2026-10-25": { "time": "06:32", "target": "06:30", "reps": 0, "mode": "button", "sent": true },
      "2026-10-26": { "time": "06:31", "target": "06:30", "reps": 0, "mode": "button", "sent": true, "stillUpDue": "06:41", "stillUpWindow": 10, "stillUpPinged": true, "stillUp": "06:41" },
      "2026-10-27": { "time": "06:50", "target": "06:30", "reps": 0, "mode": "button", "sent": true, "stillUpDue": "07:00", "stillUpWindow": 10, "mood": "okay", "stillUpPinged": true },
      "2026-10-28": { "time": "06:32", "target": "06:30", "reps": 0, "mode": "button", "sent": true, "stillUpDue": "06:42", "stillUpWindow": 10, "mood": "okay", "stillUpPinged": true, "stillUp": "06:42" },
      "2026-10-29": { "time": "06:21", "target": "06:30", "reps": 0, "mode": "button", "sent": true, "stillUpDue": "06:31", "stillUpWindow": 10, "stillUpPinged": true, "stillUp": "06:31" }
    },
    "telegram": {
      "chat_id": 1900611848,
      "name": "_",
      "bot": "wakysss_bot",
      "pin": 19
    },
    "rewards": [
      { "id": "b1", "tier": "bronze", "emoji": "🍫", "name": "My favourite snack", "cost": 100 },
      { "id": "b2", "tier": "bronze", "emoji": "🎮", "name": "1 hour of gaming, guilt-free", "cost": 150 },
      { "id": "s1", "tier": "silver", "emoji": "🎬", "name": "Movie night", "cost": 300 },
      { "id": "s2", "tier": "silver", "emoji": "🍕", "name": "Pizza or shawarma", "cost": 400 },
      { "id": "g1", "tier": "gold", "emoji": "🍽️", "name": "Dinner out", "cost": 800 },
      { "id": "g2", "tier": "gold", "emoji": "🕹️", "name": "A new game", "cost": 1000 },
      { "id": "l1", "tier": "legendary", "emoji": "🎁", "name": "Something big I've wanted", "cost": 2500 }
    ],
    "spent": [],
    "opened": {
      "stage-1": { "prize": { "rarity": "common", "items": [{ "type": "coins", "amount": 30 }] }, "openedOn": "2026-10-25" },
      "stage-2": { "prize": { "rarity": "rare", "items": [{ "type": "coins", "amount": 42 }] }, "openedOn": "2026-10-26" }
    },
    "shielded": [],
    "nights": {
      "2026-10-26": { "time": "23:09", "target": "23:30" },
      "2026-10-27": { "time": "23:15", "target": "23:30" },
      "2026-10-28": { "time": "23:23", "target": "23:30" }
    },
    "bedReminders": { "2026-10-28:remind": true }
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
        if (parsed && parsed.days && Object.keys(parsed.days).length >= 5) {
          return parsed;
        }
      }
    } catch {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DATA));
    return JSON.parse(JSON.stringify(SEED_DATA));
  }

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
      fetch(TURSO_URL + '/v2/pipeline', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + TURSO_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests })
      }).catch(() => {});
    } catch {}
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
    const streak = goodTotal;
    const best = Math.max(streak, 5);

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
        status: rec ? (toMin(rec.time) <= toMin(rec.target) + grace ? 'ontime' : 'late') : 'empty',
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

    // Chests
    const chests = [
      { id: 'stage-1', kind: 'milestone', date: '2026-10-25', reason: 'Day 1 of your journey', opened: Boolean(opened['stage-1']), prize: opened['stage-1']?.prize || null, name: 'Milestone chest', info: 'For every new day on your journey.' },
      { id: 'stage-2', kind: 'milestone', date: '2026-10-26', reason: 'Day 2 of your journey', opened: Boolean(opened['stage-2']), prize: opened['stage-2']?.prize || null, name: 'Milestone chest', info: 'For every new day on your journey.' },
      { id: 'stage-3', kind: 'milestone', date: '2026-10-27', reason: 'Day 3 of your journey', opened: Boolean(opened['stage-3']), prize: opened['stage-3']?.prize || null, name: 'Milestone chest', info: 'For every new day on your journey.' },
      { id: 'stage-4', kind: 'milestone', date: '2026-10-28', reason: 'Day 4 of your journey', opened: Boolean(opened['stage-4']), prize: opened['stage-4']?.prize || null, name: 'Milestone chest', info: 'For every new day on your journey.' },
      { id: 'rank-5', kind: 'rank', date: '2026-10-29', reason: 'Reached day 5 · Agoge Rank', opened: Boolean(opened['rank-5']), prize: opened['rank-5']?.prize || null, name: 'Rank chest', info: 'For every new rank. The best loot.' }
    ];

    const todayRec = days[todayDateStr] || null;
    const isTodayOnTime = todayRec ? toMin(todayRec.time) <= toMin(todayRec.target) + grace : false;

    return {
      today: {
        date: todayDateStr,
        target: todayRec ? todayRec.target : settings.weekday || '06:30',
        weekend: today.getDay() === 0 || today.getDay() === 6,
        record: todayRec,
        ontime: isTodayOnTime,
        coins: 20,
        coinReasons: ['early', 'still up'],
        quote: QUOTES[Math.abs(today.getDate()) % QUOTES.length],
        stillUp: {
          state: todayRec?.stillUp ? 'done' : 'none',
          due: todayRec?.stillUpDue || null,
          deadline: todayRec?.stillUpDue ? fromMin(toMin(todayRec.stillUpDue) + 10) : null
        }
      },
      streak,
      best,
      rate: 100,
      avg: '06:33',
      total: dayKeys.length,
      calendar,
      chart,
      journey,
      hit: currentStage,
      levelUp: goodTotal === 5,
      coins: {
        balance,
        earned: earnedCoins,
        spent: spentCoins,
        goal
      },
      preview: {
        onTime: 10,
        early: 15,
        stage: nextStage,
        levelUp: false,
        streak: streak + 1,
        double: false
      },
      night: {
        morning: new Date(today.getTime() + 864e5).toISOString().slice(0, 10),
        wake: settings.weekday || '06:30',
        bedtime: '23:30',
        remindAt: '23:00',
        state: 'day',
        record: null,
        minutesLeft: 420,
        onTime: false,
        sleepIfNow: 840,
        enabled: true,
        coins: 5
      },
      sleep: {
        last: 442,
        avg: 442,
        goal: settings.sleepGoal || 420,
        chart: chart.map(c => ({ date: c.date, minutes: c.ontime ? 440 : null })),
        nightsOnGoal: 3,
        nights: 3
      },
      game: {
        chests,
        unopened: chests.filter(c => !c.opened).length,
        inventory: {
          shields: 0,
          doubles: 0,
          vouchers: [],
          chestCoins
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
    const today = now.toISOString().slice(0, 10);
    const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    if (u.includes('/api/ping')) {
      return new Response(JSON.stringify({ app: 'waky', commit: 'web' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/state')) {
      const stats = computeStats(data, today);
      const state = {
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
        insights: [
          { icon: '☀️', title: '5-day Spartan Streak', text: 'You have been on time 5 days in a row! Agoge rank unlocked.' }
        ],
        recapMonths: ['2026-10'],
        spent: data.spent || [],
        stats: stats,
        telegram: { connected: false },
        alarm: { active: false, test: false },
        pcAlarm: { armed: false },
        update: { available: false }
      };
      return new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/checkin')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      data.days = data.days || {};
      data.days[today] = {
        time: timeStr,
        target: data.settings?.weekday || '06:30',
        reps: body.reps || 0,
        mode: body.mode || 'button',
        sent: true,
        stillUpDue: fromMin(toMin(timeStr) + 10),
        stillUpWindow: 10
      };
      save(data);
      const stats = computeStats(data, today);
      return new Response(JSON.stringify({ ok: true, day: data.days[today], stats }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/bed')) {
      data.nights = data.nights || {};
      data.nights[today] = { time: timeStr, target: '23:30', onTime: true };
      save(data);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/stillup')) {
      if (data.days && data.days[today]) {
        data.days[today].stillUp = timeStr;
        save(data);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/mood')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      if (data.days && data.days[today]) {
        data.days[today].mood = body.mood || 'great';
        save(data);
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/chests/open')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      const chestId = body.id || 'rank-5';
      data.opened = data.opened || {};
      const prize = { rarity: 'rare', items: [{ type: 'coins', amount: 35 }] };
      data.opened[chestId] = { prize, openedOn: today };
      save(data);
      return new Response(JSON.stringify({ ok: true, prize }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/redeem')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      data.spent = data.spent || [];
      data.spent.push({ id: body.id, cost: body.cost || 100, at: now.toISOString() });
      save(data);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/settings')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      data.settings = Object.assign(data.settings || {}, body);
      save(data);
      return new Response(JSON.stringify({ ok: true, settings: data.settings }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})();
