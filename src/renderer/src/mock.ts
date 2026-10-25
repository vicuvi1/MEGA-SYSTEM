import { dayKey } from '@core/dates'
import { balance, effective, planUndo, totalXp, type LedgerEntry, type NewEntry } from '@core/ledger'
import { levelInfo } from '@core/levels'
import { DEFAULT_RULES, planAward, type Rule } from '@core/rules'
import { chestRef, DEFAULT_REWARDS, planRedeem, rollChest, unopenedChests, validateReward, type Reward } from '@core/shop'
import type { AuthStatus, BackupStatus, ShopState, Summary } from '@shared/api'
import type { Bridge } from './bridge'
import { createMockPlan } from './mockPlan'

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
      level: levelInfo(xp),
      today,
      todayCoins: live.reduce((s, e) => s + e.coins, 0),
      todayXp: live.reduce((s, e) => s + e.xp, 0),
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
      undo: async (eid, note) => {
        const now = new Date()
        add(planUndo(entries, eid, note, now.toISOString(), dayKey(now)))
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
      }
    },
    backup: {
      status: () => ok(backup()),
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
    onLocked: () => {}
  }
}
