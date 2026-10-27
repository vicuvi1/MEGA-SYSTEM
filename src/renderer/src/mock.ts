import { dayKey } from '@core/dates'
import { balance, effective, planUndo, totalXp, type LedgerEntry, type NewEntry } from '@core/ledger'
import { levelInfo, type StatAllocation } from '@core/levels'
import { DEFAULT_RULES, planAward, type Rule } from '@core/rules'
import { chestRef, DEFAULT_REWARDS, planRedeem, rollChest, unopenedChests, validateReward, type Reward } from '@core/shop'
import type { AuthStatus, BackupStatus, ShopState, Summary } from '@shared/api'
import type { Bridge } from './bridge'
import { createMockPlan } from './mockPlan'
import { questRef, questState } from '@core/quests'
import { createMockDiscipline } from './mockDiscipline'
import { createMockConnections } from './mockConnections'
import { createMockBody } from './mockBody'

/** Browser-only stand-in for the Electron bridge, using the same core logic. */
export function createMockApi(): Bridge {
  let rules: Rule[] = DEFAULT_RULES.map((r) => ({ ...r }))
  const entries: LedgerEntry[] = []
  let pin: string | null = null
  let locked = false
  let pass: string | null = null
  let id = 1
  let rewards: Reward[] = DEFAULT_REWARDS.map((r, i) => ({ ...r, id: i + 1 }))
  const bought: { ledgerId: number; title: string; realCost: number; day: string }[] = []
  let budget = 0
  let statAlloc: StatAllocation = { str: 0, agi: 0, vit: 0, int: 0, sen: 0 }

  const add = (e: NewEntry) => {
    entries.push({ ...e, id: id++ })
    return id - 1
  }
  // A little history so the demo isn't empty.
  const seed = ['sleep.up_on_time', 'discipline.clean_day', 'study.block_done', 'body.workout_done']
  seed.forEach((rid, i) => {
    const t = new Date(Date.now() - (seed.length - i) * 3600_000)
    add(planAward(rules.find((r) => r.id === rid)!, entries, t, dayKey(t)))
  })

  const summary = (): Summary => {
    const today = dayKey(new Date())
    const live = effective(entries).filter((e) => e.day === today)
    const xp = totalXp(entries)
    return {
      balance: balance(entries),
      totalXp: xp,
      level: levelInfo(xp, { allocated: statAlloc }),
      today,
      todayCoins: live.reduce((s, e) => s + e.coins, 0),
      todayXp: live.reduce((s, e) => s + e.xp, 0),
      todayRules: [...new Set(live.map((e) => e.ruleId).filter(Boolean) as string[])],
      recent: entries.slice(-12).reverse()
    }
  }
  const auth = (): AuthStatus => ({ pinSet: !!pin, locked: locked && !!pin })
  const backup = (): BackupStatus => ({
    dir: 'G:\\My Drive\\Life System\\backups (demo)',
    driveAvailable: true,
    passphraseSet: !!pass,
    last: pass ? { name: 'life-demo.lsb', at: new Date().toISOString() } : null,
    pending: 0,
    count: pass ? 1 : 0,
    lastError: pass ? null : 'Set a backup passphrase in Settings to turn on backups'
  })
  const ok = <T>(v: T) => Promise.resolve(v)

  const shop = (): ShopState => {
    const live = new Set(effective(entries).map((e) => e.id))
    const today = dayKey(new Date())
    const level = levelInfo(totalXp(entries)).level
    return {
      rewards: rewards.filter((r) => !r.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.price - b.price),
      balance: balance(entries),
      level,
      budget,
      monthSpent: bought.filter((b) => live.has(b.ledgerId) && b.day.slice(0, 7) === today.slice(0, 7)).reduce((s, b) => s + b.realCost, 0),
      currency: 'MDL',
      chests: unopenedChests(level, effective(entries).map((e) => e.ref ?? '')),
      recent: bought.slice().reverse().map((b) => ({ title: b.title, realCost: b.realCost, day: b.day, undone: !live.has(b.ledgerId) }))
    }
  }

  return {
    ...createMockPlan({ entries, add, rules: () => rules }),
    ...createMockDiscipline({ entries, add, rules: () => rules }),
    ...createMockBody({ entries, add, rules: () => rules }),
    ...createMockConnections(),
    updates: {
      status: async () => ({ current: '0.5.0', state: 'dev' as const, latest: null, progress: 0, error: 'Updates work in the installed app', checkedAt: null }),
      check: async () => ({ current: '0.5.0', state: 'dev' as const, latest: null, progress: 0, error: 'Updates work in the installed app', checkedAt: null }),
      run: async () => ({ current: '0.5.0', state: 'dev' as const, latest: null, progress: 0, error: 'Updates work in the installed app', checkedAt: null })
    },
    apps: {
      info: async () => {
        throw new Error('The apps run inside the desktop app')
      },
      startWaky: async () => ({ ok: false, error: 'Only in the desktop app' })
    },
    auth: {
      status: () => ok(auth()),
      setPin: async (p) => {
        if (!/^\d{4,12}$/.test(p)) throw new Error('PIN must be 4 to 12 digits')
        pin = p
        locked = false
        return auth()
      },
      unlock: async (p) => {
        if (p !== pin) throw new Error('Wrong PIN')
        locked = false
        return auth()
      },
      lock: async () => {
        locked = true
        return auth()
      }
    },
    wallet: {
      summary: () => ok(summary()),
      history: (limit = 100) => ok(entries.slice().reverse().slice(0, limit)),
      award: async (ruleId, note) => {
        const now = new Date()
        add(planAward(rules.find((r) => r.id === ruleId)!, entries, now, dayKey(now), note))
        return summary()
      },
      quests: async () => questState(dayKey(new Date()), entries),
      claimQuests: async () => {
        const q = questState(dayKey(new Date()), entries)
        if (!q.allDone || q.claimed) throw new Error(q.claimed ? 'Already claimed today' : 'Finish all three quests first')
        add({ ts: new Date().toISOString(), day: q.day, module: 'quests', kind: 'earn', coins: q.bonus.coins, xp: q.bonus.xp, ref: questRef(q.day), note: 'Daily quests complete' })
        return summary()
      },
      undo: async (eid, note) => {
        const now = new Date()
        add(planUndo(entries, eid, note, now.toISOString(), dayKey(now)))
        return summary()
      },
      allocateStats: async (stat, points = 1) => {
        statAlloc[stat] = (statAlloc[stat] ?? 0) + points
        return summary()
      },
      resetStats: async () => {
        statAlloc = { str: 0, agi: 0, vit: 0, int: 0, sen: 0 }
        return summary()
      }
    },
    rules: {
      list: () => ok(rules),
      save: async (rule) => {
        rules = rules.some((r) => r.id === rule.id) ? rules.map((r) => (r.id === rule.id ? rule : r)) : [...rules, rule]
        return rules
      }
    },
    shop: {
      state: () => ok(shop()),
      save: async (input) => {
        const r = { ...input, archived: false }
        validateReward(r)
        if (r.pinned) rewards = rewards.map((x) => ({ ...x, pinned: false }))
        rewards = input.id ? rewards.map((x) => (x.id === input.id ? { ...x, ...r, id: x.id } : x)) : [...rewards, { ...r, id: rewards.length + 1 }]
        return shop()
      },
      archive: async (rid) => {
        rewards = rewards.map((r) => (r.id === rid ? { ...r, archived: true, pinned: false } : r))
        return shop()
      },
      redeem: async (rid) => {
        const s = shop()
        const reward = rewards.find((r) => r.id === rid)!
        planRedeem({ reward, balance: s.balance, level: s.level, monthSpent: s.monthSpent, budget })
        const now = new Date()
        const ledgerId = add({ ts: now.toISOString(), day: dayKey(now), module: 'shop', kind: 'spend', coins: -reward.price, xp: 0, ref: `reward:${rid}`, note: reward.title })
        bought.push({ ledgerId, title: reward.title, realCost: reward.realCost, day: dayKey(now) })
        return shop()
      },
      openChest: async (level) => {
        if (!shop().chests.includes(level)) throw new Error('No chest waiting for that level')
        const coins = rollChest(level, Math.random())
        const now = new Date()
        add({ ts: now.toISOString(), day: dayKey(now), module: 'shop', kind: 'earn', coins, xp: 0, ref: chestRef(level), note: `Level ${level} chest` })
        return { coins, state: shop() }
      },
      setBudget: async (amount) => {
        budget = amount
        return shop()
      },
      setCurrency: async (_cur) => shop()
    },
    telegram: {
      config: async () => ({ botToken: '', chatId: '', enabled: false, morningBriefing: true, eveningNudge: true }),
      saveConfig: async (c) => ({ botToken: '', chatId: '', enabled: false, morningBriefing: true, eveningNudge: true, ...c }),
      test: async () => ({ ok: true })
    },
    sleep: {
      state: async () => ({
        today: dayKey(new Date()),
        weekdayTarget: '07:00',
        weekendTarget: '08:30',
        todayLog: null,
        streak: 3,
        bestStreak: 14,
        onTimeRate: 0.9,
        avgSleepMin: 450,
        recentLogs: []
      }),
      logWake: async (time = '07:00') => ({
        log: { id: 1, day: dayKey(new Date()), wakeTime: time, wakeTarget: '07:00', onTime: true, bedTime: null, bedTarget: null, bedOnTime: null, quality: 5, createdAt: '' },
        state: { today: dayKey(new Date()), weekdayTarget: '07:00', weekendTarget: '08:30', todayLog: null, streak: 4, bestStreak: 14, onTimeRate: 0.92, avgSleepMin: 450, recentLogs: [] },
        awarded: true
      }),
      logBed: async (time = '23:00') => ({
        log: { id: 1, day: dayKey(new Date()), wakeTime: '07:00', wakeTarget: '07:00', onTime: true, bedTime: time, bedTarget: '23:00', bedOnTime: true, quality: 5, createdAt: '' },
        state: { today: dayKey(new Date()), weekdayTarget: '07:00', weekendTarget: '08:30', todayLog: null, streak: 4, bestStreak: 14, onTimeRate: 0.92, avgSleepMin: 450, recentLogs: [] },
        awarded: true
      }),
      setTargets: async (weekday, weekend) => ({
        today: dayKey(new Date()),
        weekdayTarget: weekday,
        weekendTarget: weekend,
        todayLog: null,
        streak: 3,
        bestStreak: 14,
        onTimeRate: 0.9,
        avgSleepMin: 450,
        recentLogs: []
      })
    },
    money: {
      state: async () => ({
        currency: 'MDL',
        dailyBudget: 10000,
        today: { day: dayKey(new Date()), totalSpent: 3500, everydaySpent: 3500, budget: 10000, underBudget: true, remaining: 6500, byCategory: { food: 3500 } },
        monthSpent: 28500,
        recentExpenses: []
      }),
      addExpense: async (amount, category, note) => ({
        expense: { id: 1, day: dayKey(new Date()), amount, category, note: note ?? null, createdAt: new Date().toISOString() },
        state: {
          currency: 'MDL',
          dailyBudget: 10000,
          today: { day: dayKey(new Date()), totalSpent: amount, everydaySpent: amount, budget: 10000, underBudget: true, remaining: 10000 - amount, byCategory: { [category]: amount } },
          monthSpent: amount,
          recentExpenses: []
        },
        awarded: true
      }),
      deleteExpense: async () => ({
        currency: 'MDL',
        dailyBudget: 10000,
        today: { day: dayKey(new Date()), totalSpent: 0, everydaySpent: 0, budget: 10000, underBudget: true, remaining: 10000, byCategory: {} },
        monthSpent: 0,
        recentExpenses: []
      }),
      setBudget: async (b) => ({
        currency: 'MDL',
        dailyBudget: b,
        today: { day: dayKey(new Date()), totalSpent: 0, everydaySpent: 0, budget: b, underBudget: true, remaining: b, byCategory: {} },
        monthSpent: 0,
        recentExpenses: []
      }),
      setCurrency: async (cur) => ({
        currency: cur,
        dailyBudget: 10000,
        today: { day: dayKey(new Date()), totalSpent: 0, everydaySpent: 0, budget: 10000, underBudget: true, remaining: 10000, byCategory: {} },
        monthSpent: 0,
        recentExpenses: []
      })
    },
    shields: {
      count: async () => 1,
      buy: async () => ({ shields: 2, balance: balance(entries) - 50 })
    },
    data: {
      exportJson: async () => JSON.stringify({ demo: true }, null, 2),
      exportCsv: async () => 'Date,Amount\n2026-10-27,50.00'
    },
        economy: {
      summary: async () => ({
        coinsBalance: 1420,
        coinsRealValue: 142,
        exchangeRate: 10,
        vaultBalance: 420,
        currency: 'MDL',
        monthlyBudget: 1500,
        monthSpent: 300,
        multiplier: {
          rate: 1.5,
          cleanStreak: 14,
          budgetStreak: 4,
          budgetBonus: 0.15,
          totalRate: 1.65,
          label: 'Spartan (1.5x) + 💰 Budget Shield (+15%)'
        },
        pinnedGoal: {
          id: 1,
          title: 'Kaaba Pilgrimage Fund',
          targetCoins: 20000,
          targetRealCost: 15000,
          allocatedCoins: 4500,
          allocatedRealCost: 3200,
          category: 'trip',
          pinned: true,
          completed: false,
          completedAt: null,
          note: 'The supreme spiritual milestone. Keep stacking.',
          createdAt: new Date().toISOString()
        },
        goals: [
          {
            id: 1,
            title: 'Kaaba Pilgrimage Fund',
            targetCoins: 20000,
            targetRealCost: 15000,
            allocatedCoins: 4500,
            allocatedRealCost: 3200,
            category: 'trip',
            pinned: true,
            completed: false,
            completedAt: null,
            note: 'The supreme spiritual milestone. Keep stacking.',
            createdAt: new Date().toISOString()
          },
          {
            id: 2,
            title: 'MacBook / Pro Warrior Setup',
            targetCoins: 12000,
            targetRealCost: 8000,
            allocatedCoins: 2000,
            allocatedRealCost: 1500,
            category: 'tech',
            pinned: false,
            completed: false,
            completedAt: null,
            note: 'High-performance battle workstation.',
            createdAt: new Date().toISOString()
          }
        ],
        recentVaultEntries: [
          { id: 1, ts: new Date().toISOString(), day: '2026-10-27', kind: 'surplus_credit', amount: 85, ref: null, note: 'Daily surplus savings under budget' }
        ]
      }),
      goals: async () => [],
      saveGoal: async (g) => ({
        id: g.id || Date.now(),
        title: g.title,
        targetCoins: g.targetCoins,
        targetRealCost: g.targetRealCost,
        allocatedCoins: 0,
        allocatedRealCost: 0,
        category: g.category || 'gear',
        pinned: !!g.pinned,
        completed: false,
        completedAt: null,
        note: g.note || null,
        createdAt: new Date().toISOString()
      }),
      deleteGoal: async () => {},
      pinGoal: async () => {},
      depositCoins: async (goalId, amount) => ({
        goal: {
          id: goalId,
          title: 'Kaaba Pilgrimage Fund',
          targetCoins: 20000,
          targetRealCost: 15000,
          allocatedCoins: 5000,
          allocatedRealCost: 3200,
          category: 'trip',
          pinned: true,
          completed: false,
          completedAt: null,
          note: null,
          createdAt: new Date().toISOString()
        },
        balance: 1420 - amount
      }),
      depositVault: async (goalId, amount) => ({
        goal: {
          id: goalId,
          title: 'Kaaba Pilgrimage Fund',
          targetCoins: 20000,
          targetRealCost: 15000,
          allocatedCoins: 4500,
          allocatedRealCost: 3200 + amount,
          category: 'trip',
          pinned: true,
          completed: false,
          completedAt: null,
          note: null,
          createdAt: new Date().toISOString()
        },
        vaultBalance: 420 - amount
      }),
      claimGoal: async (goalId) => ({
        id: goalId,
        title: 'Claimed Goal',
        targetCoins: 100,
        targetRealCost: 100,
        allocatedCoins: 100,
        allocatedRealCost: 100,
        category: 'gear',
        pinned: false,
        completed: true,
        completedAt: new Date().toISOString(),
        note: null,
        createdAt: new Date().toISOString()
      }),
      creditVault: async (amount) => 420 + amount,
      setExchangeRate: async (rate) => rate,
      setCurrency: async (cur) => ({
        coinsBalance: 1420,
        coinsRealValue: 142,
        exchangeRate: 10,
        vaultBalance: 420,
        currency: cur,
        monthlyBudget: 1500,
        monthSpent: 300,
        multiplier: {
          rate: 1.5,
          cleanStreak: 14,
          budgetStreak: 4,
          budgetBonus: 0.15,
          totalRate: 1.65,
          label: 'Spartan (1.5x) + 💰 Budget Shield (+15%)'
        },
        pinnedGoal: null,
        goals: [],
        recentVaultEntries: []
      }),
      openChest: async (level) => ({
        drop: {
          type: 'coins',
          value: 35,
          label: '+35 Coins Jackpot!',
          description: 'Discipline dividends credited directly to your points wallet.'
        },
        coins: 35,
        balance: 1455,
        chests: []
      })
    },
    bots: {
      config: async () => ({
        botToken: '',
        chatId: '',
        enabled: false,
        pollingEnabled: false,
        morningBriefing: true,
        eveningNudge: true,
        sportBotToken: '',
        financeBotToken: '',
        manBotToken: ''
      }),
      saveConfig: async (c) => ({
        botToken: '',
        chatId: '',
        enabled: false,
        pollingEnabled: false,
        morningBriefing: true,
        eveningNudge: true,
        ...c
      }),
      status: async () => ({ polling: false, enabled: false, configured: false, lastPollAt: null, lastError: null, processedCount: 0 }),
      logs: async () => [
        { id: 1, ts: new Date().toISOString(), command: '/today', sender: '12345678', success: true, reply: '👑 Life System Status...' },
        { id: 2, ts: new Date().toISOString(), command: '/checkin', sender: '12345678', success: true, reply: '🛡️ Clean Day Affirmed!' }
      ],
      clearLogs: async () => {},
      test: async () => ({ ok: true }),
      startPolling: async () => true,
      stopPolling: async () => false
    },
    backup: {
      status: () => ok(backup()),
      chooseDir: () => ok(backup()),
      setPassphrase: async (p) => {
        if (p.length < 8) throw new Error('Use at least 8 characters')
        pass = p
        return backup()
      },
      runNow: () => ok(backup()),
      list: () => ok(pass ? ['life-demo.lsb'] : []),
      verifyLatest: () => ok({ ok: !!pass, name: pass ? 'life-demo.lsb' : null, detail: pass ? 'Demo backup looks fine' : 'No backups yet' }),
      restore: async () => {
        throw new Error('Restore is not available in the browser demo')
      }
    },
    ai: {
      config: async () => ({
        openRouterKey: 'sk-or-v1-mock-key',
        geminiKey: 'AIzaSyMockKey',
        selectedModel: 'auto',
        enabled: true
      }),
      saveConfig: async (cfg) => ({
        openRouterKey: cfg.openRouterKey ?? 'sk-or-v1-mock-key',
        geminiKey: cfg.geminiKey ?? 'AIzaSyMockKey',
        selectedModel: cfg.selectedModel ?? 'auto',
        enabled: cfg.enabled ?? true
      }),
      test: async (provider) => ({
        ok: true,
        message: 'Connection successful',
        model: provider === 'openrouter' ? 'deepseek/deepseek-chat' : 'gemini-2.0-flash'
      }),
      generateRewards: async (userPrompt?: string) => ({
        modelUsed: 'gemini-2.0-flash',
        rewards: [
          {
            title: userPrompt ? `Custom Upgrade: ${userPrompt}` : 'Premium Espresso & Reading Afternoon',
            price: 450,
            realCost: 85,
            tier: 'bronze',
            category: 'wellness',
            note: 'High yield restoration for cognitive focus and dopamine reset.',
            imageUrl: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?auto=format&fit=crop&w=600&q=80'
          },
          {
            title: 'Deep Tissue Recovery & Spa Session',
            price: 1200,
            realCost: 400,
            tier: 'silver',
            category: 'wellness',
            note: 'Physical recovery following intense training protocols.',
            imageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=600&q=80'
          },
          {
            title: 'Mechanical Ergonomic Keyboard',
            price: 3500,
            realCost: 89,
            tier: 'gold',
            category: 'tech',
            note: 'Top tier hunter hardware for maximum code execution velocity.',
            imageUrl: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=600&q=80'
          }
        ]
      }),
      performanceReport: async () => ({
        modelUsed: 'deepseek/deepseek-r1',
        gradeRating: 'A-Rank',
        headline: 'Formidable Momentum: Discipline Core Operating at 94% Efficiency',
        summary: 'Player displays superior consistency in physical training and streak preservation. Vault reserve expansion is accelerating toward next echelon.',
        strengths: [
          'Unbroken discipline streak exceeding 14 days',
          'Morning momentum routine completion rate at 90%+',
          'Prudent financial reserve maintenance in the secure vault'
        ],
        growthAreas: [
          'Sleep midpoint alignment variance on weekend cycles',
          'Delayed afternoon recovery blocks after deep work sprints'
        ],
        strategicDirectives: [
          'Lock in bedtime window strictly within 23:00 - 07:00.',
          'Execute remaining S-Rank quest before end of the current micro-cycle.',
          'Channel 15% of surplus coins into primary milestone goal.'
        ],
        warriorVerdict: 'You are ascending beyond the limits of common hunters. Maintain absolute focus—the Monarchs have noticed.',
        generatedAt: new Date().toISOString()
      }),
      decomposeTask: async (title: string) => ({
        strategyTip: `Conquer the foundation of "${title}" in the first 10 minutes to generate momentum.`,
        subtasks: [
          { title: `Prepare setup & eliminate distractions for ${title}`, minutes: 10, coins: 5, xp: 10, priority: 2 },
          { title: `Execute core focus phase for ${title}`, minutes: 35, coins: 15, xp: 30, priority: 1 },
          { title: `Review, test, and finalize ${title}`, minutes: 15, coins: 10, xp: 20, priority: 2 }
        ],
        modelUsed: 'gemini-2.0-flash'
      }),
      askCoach: async (msg: string) => ({
        reply: `[System Oracle]: Understood, Hunter. In response to "${msg}": stay locked onto your primary directives. Discipline compounds exponentially.`,
        modelUsed: 'gemini-2.0-flash'
      })
    },
    calendar: {
      config: async () => ({
        feedUrl: 'https://calendar.google.com/calendar/ical/demo/basic.ics',
        enabled: true,
        autoSyncIntervalMin: 15,
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        cachedEventsCount: 2
      }),
      saveConfig: async (c) => ({
        feedUrl: c.feedUrl ?? '',
        enabled: c.enabled ?? true,
        autoSyncIntervalMin: 15,
        lastSyncAt: new Date().toISOString(),
        lastError: null,
        cachedEventsCount: 2
      }),
      sync: async () => ({
        events: [
          {
            id: 'mock-1',
            title: 'Hunter Strategy Alignment',
            start: new Date().toISOString(),
            end: new Date(Date.now() + 3600_000).toISOString(),
            day: dayKey(new Date()),
            startTime: '10:00',
            endTime: '11:00',
            allDay: false,
            location: 'HQ Command',
            description: 'Sprint planning and habit calibration'
          },
          {
            id: 'mock-2',
            title: 'Evening Physical Conditioning',
            start: new Date().toISOString(),
            end: new Date(Date.now() + 5400_000).toISOString(),
            day: dayKey(new Date()),
            startTime: '18:30',
            endTime: '20:00',
            allDay: false,
            location: 'Gym / Track'
          }
        ],
        count: 2
      }),
      events: async () => [
        {
          id: 'mock-1',
          title: 'Hunter Strategy Alignment',
          start: new Date().toISOString(),
          end: new Date(Date.now() + 3600_000).toISOString(),
          day: dayKey(new Date()),
          startTime: '10:00',
          endTime: '11:00',
          allDay: false,
          location: 'HQ Command',
          description: 'Sprint planning and habit calibration'
        },
        {
          id: 'mock-2',
          title: 'Evening Physical Conditioning',
          start: new Date().toISOString(),
          end: new Date(Date.now() + 5400_000).toISOString(),
          day: dayKey(new Date()),
          startTime: '18:30',
          endTime: '20:00',
          allDay: false,
          location: 'Gym / Track'
        }
      ],
      clear: async () => {}
    },
    onLocked: () => {},
    onUrge: () => {},
    onWalletChanged: () => {},
    onNavigate: () => {},
    onUpdate: () => {},
    onUiKey: () => () => {},
    onFullScreen: () => () => {}
  }
}
