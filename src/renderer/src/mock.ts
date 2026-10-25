import { dayKey } from '@core/dates'
import { balance, effective, planUndo, totalXp, type LedgerEntry, type NewEntry } from '@core/ledger'
import { levelInfo } from '@core/levels'
import { DEFAULT_RULES, planAward, type Rule } from '@core/rules'
import type { AuthStatus, BackupStatus, Summary } from '@shared/api'
import type { Bridge } from './bridge'

/** Browser-only stand-in for the Electron bridge, using the same core logic. */
export function createMockApi(): Bridge {
  let rules: Rule[] = DEFAULT_RULES.map((r) => ({ ...r }))
  const entries: LedgerEntry[] = []
  let pin: string | null = null
  let locked = false
  let pass: string | null = null
  let id = 1

  const add = (e: NewEntry) => entries.push({ ...e, id: id++ })
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

  return {
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
