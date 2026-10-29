// In-browser mock adapter for Waky running inside Life System Web
(function() {
  const STORAGE_KEY = 'waky_web_data';
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
    "2026-10-25": {
      "time": "06:32",
      "target": "06:30",
      "reps": 0,
      "mode": "button",
      "sent": true
    },
    "2026-10-26": {
      "time": "06:31",
      "target": "06:30",
      "reps": 0,
      "mode": "button",
      "sent": true,
      "stillUpDue": "06:41",
      "stillUpWindow": 10,
      "stillUpPinged": true,
      "stillUp": "06:41"
    },
    "2026-10-27": {
      "time": "06:50",
      "target": "06:30",
      "reps": 0,
      "mode": "button",
      "sent": true,
      "stillUpDue": "07:00",
      "stillUpWindow": 10,
      "mood": "okay",
      "stillUpPinged": true
    },
    "2026-10-28": {
      "time": "06:32",
      "target": "06:30",
      "reps": 0,
      "mode": "button",
      "sent": true,
      "stillUpDue": "06:42",
      "stillUpWindow": 10,
      "mood": "okay",
      "stillUpPinged": true,
      "stillUp": "06:42"
    },
    "2026-10-29": {
      "time": "06:21",
      "target": "06:30",
      "reps": 0,
      "mode": "button",
      "sent": true,
      "stillUpDue": "06:31",
      "stillUpWindow": 10,
      "stillUpPinged": true,
      "stillUp": "06:31"
    }
  },
  "telegram": {
    "chat_id": 1900611848,
    "name": "_",
    "bot": "wakysss_bot",
    "pin": 19
  },
  "rewards": [
    {
      "id": "b1",
      "tier": "bronze",
      "emoji": "🍫",
      "name": "My favourite snack",
      "cost": 100
    },
    {
      "id": "b2",
      "tier": "bronze",
      "emoji": "🎮",
      "name": "1 hour of gaming, guilt-free",
      "cost": 150
    },
    {
      "id": "s1",
      "tier": "silver",
      "emoji": "🎬",
      "name": "Movie night",
      "cost": 300
    },
    {
      "id": "s2",
      "tier": "silver",
      "emoji": "🍕",
      "name": "Pizza or shawarma",
      "cost": 400
    },
    {
      "id": "g1",
      "tier": "gold",
      "emoji": "🍽️",
      "name": "Dinner out",
      "cost": 800
    },
    {
      "id": "g2",
      "tier": "gold",
      "emoji": "🕹️",
      "name": "A new game",
      "cost": 1000
    },
    {
      "id": "l1",
      "tier": "legendary",
      "emoji": "🎁",
      "name": "Something big I've wanted",
      "cost": 2500
    }
  ],
  "spent": [],
  "opened": {
    "stage-1": {
      "prize": {
        "rarity": "common",
        "items": [
          {
            "type": "coins",
            "amount": 30
          }
        ]
      },
      "openedOn": "2026-10-25"
    },
    "stage-2": {
      "prize": {
        "rarity": "rare",
        "items": [
          {
            "type": "coins",
            "amount": 42
          }
        ]
      },
      "openedOn": "2026-10-26"
    }
  },
  "shielded": [],
  "nights": {
    "2026-10-26": {
      "time": "23:09",
      "target": "23:30"
    },
    "2026-10-27": {
      "time": "23:15",
      "target": "23:30"
    },
    "2026-10-28": {
      "time": "23:23",
      "target": "23:30"
    }
  },
  "bedReminders": {
    "2026-10-28:remind": true
  }
};

  function load() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) return JSON.parse(s);
    } catch {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DATA));
    return JSON.parse(JSON.stringify(SEED_DATA));
  }

  function save(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
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
      const days = data.days || {};
      const dayKeys = Object.keys(days).sort();
      const streak = dayKeys.length;
      const state = {
        settings: data.settings || { weekday: '06:30', weekend: '06:30', why: "The man I am becoming doesn't stay in bed.", sound: true },
        days: days,
        nights: data.nights || {},
        rewards: data.rewards || [],
        tiers: [{ id: 1, name: 'Bronze', min: 0 }, { id: 2, name: 'Silver', min: 100 }, { id: 3, name: 'Gold', min: 250 }],
        sounds: { bells: 'Bells', chime: 'Chime', digital: 'Digital' },
        themes: ['dawn', 'dusk', 'nordic', 'obsidian'],
        insights: [],
        recapMonths: [],
        spent: data.spent || [],
        stats: {
          streak: streak,
          best: Math.max(streak, 7),
          onTimeRate: 0.85,
          avgSleepMin: 440,
          today: days[today] || null
        },
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
        sent: true
      };
      save(data);
      return new Response(JSON.stringify({ ok: true, day: data.days[today] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (u.includes('/api/bed')) {
      data.nights = data.nights || {};
      data.nights[today] = { time: timeStr, onTime: true };
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
