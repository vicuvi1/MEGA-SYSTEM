import { budgetBani } from './money'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  financeDay, financeMonth, manStartSuggestion, parseFinance, parseFinanceState, parseManLog, parseWaky, sleptMinutes,
  type FinanceData, type ManData, type WakyData
} from '@core/connect'
import { addDays, daysBetween } from '@core/dates'
import { LedgerError } from '@core/ledger'
import { bestDayStreak, dayStreak } from '@core/streaks'
import type { ConnectionKind, ConnectionsState } from '@shared/api'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

export interface Candidates {
  waky: string[]
  finance: string[]
  /** MAN keeps its data in a Chrome profile: the LevelDB folder of localStorage. */
  man: string[]
}

/** Usual places of the three apps on this PC. */
export function defaultCandidates(home: string, driveRoot: string): Candidates {
  const scratch = join(home, '.gemini', 'antigravity', 'scratch')
  return {
    waky: [join(scratch, 'Waky-', 'data', 'waky.json'), join(home, 'Projects', 'Waky-', 'data', 'waky.json'), join(home, 'Waky-', 'data', 'waky.json')],
    finance: [
      join(driveRoot, 'Finance', 'Backup', 'Finance Helper', 'finance-helper-sync.json'),
      join(driveRoot, 'Finance Helper', 'finance-helper-sync.json')
    ],
    man: [join(scratch, 'ManDesktop', 'profile', 'Default', 'Local Storage', 'leveldb'), join(scratch, 'ManApp', 'desktop', 'profile', 'Default', 'Local Storage', 'leveldb')]
  }
}

/** How far back a newly connected or idle app is checked for missed payouts. */
const CATCH_UP_DAYS = 31

export class Connections {
  /** Latest state read from the Finance Helper inside Life System. */
  private embeddedFinance: { text: string; at: number } | null = null

  constructor(private db: DB, private wallet: Wallet, private candidates: Candidates) {}

  /** Called by the main process after reading the embedded Finance Helper. */
  setEmbeddedFinance(text: string | null, at = Date.now()): void {
    this.embeddedFinance = text ? { text, at } : null
  }

  private financeLabel(): string | null {
    return this.embeddedFinance ? 'Finance Helper inside Life System' : this.path('finance')
  }

  path(kind: ConnectionKind): string | null {
    const chosen = getSetting(this.db, `conn_${kind}_path`)
    if (chosen) return chosen
    return this.candidates[kind].find((p) => existsSync(p)) ?? null
  }

  setPath(kind: ConnectionKind, p: string): void {
    if (!existsSync(p)) throw new LedgerError('That file or folder does not exist')
    // Validate before saving so a wrong pick is reported right away.
    if (kind === 'waky') parseWaky(readFileSync(p, 'utf8'))
    if (kind === 'finance') parseFinance(readFileSync(p, 'utf8'))
    if (kind === 'man' && !this.readMan(p)) throw new LedgerError('No MAN data found there')
    setSetting(this.db, `conn_${kind}_path`, p)
  }

  private since(kind: 'waky' | 'finance'): string | null {
    return getSetting(this.db, `conn_${kind}_since`) || null
  }

  /** Payouts start from the day you connect; nothing older is paid. */
  connect(kind: 'waky' | 'finance', now = new Date()): void {
    if (kind === 'finance') {
      if (!this.readFinance().data) throw new LedgerError('Finance Helper data not found. Open the Money section once, or choose its sync file.')
    } else {
      const p = this.path(kind)
      if (!p) throw new LedgerError('App data not found. Choose the file first.')
      parseWaky(readFileSync(p, 'utf8'))
    }
    if (!this.since(kind)) setSetting(this.db, `conn_${kind}_since`, this.wallet.today(now))
  }

  disconnect(kind: 'waky' | 'finance'): void {
    setSetting(this.db, `conn_${kind}_since`, '')
  }

  /** The daily budget in whole lei (stored in bani, the same setting Money uses: P1). */
  dailyBudget(): number {
    const raw = getSetting(this.db, 'money_daily_budget')
    return raw ? Math.round(budgetBani(raw) / 100) : 0
  }

  setDailyBudget(amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) throw new LedgerError('Budget must be a whole number, 0 or more')
    setSetting(this.db, 'money_daily_budget', String(amount * 100))
  }

  private readWaky(): { data: WakyData | null; error: string | null } {
    const p = this.path('waky')
    if (!p) return { data: null, error: null }
    try {
      return { data: parseWaky(readFileSync(p, 'utf8')), error: null }
    } catch (e) {
      return { data: null, error: (e as Error).message }
    }
  }

  private readFinance(): { data: FinanceData | null; error: string | null } {
    if (this.embeddedFinance) {
      try {
        return { data: parseFinanceState(this.embeddedFinance.text, this.embeddedFinance.at), error: null }
      } catch (e) {
        return { data: null, error: (e as Error).message }
      }
    }
    const p = this.path('finance')
    if (!p) return { data: null, error: null }
    try {
      return { data: parseFinance(readFileSync(p, 'utf8')), error: null }
    } catch (e) {
      return { data: null, error: (e as Error).message }
    }
  }

  private readMan(dir = this.path('man')): ManData | null {
    if (!dir) return null
    const files = statSync(dir).isDirectory()
      ? readdirSync(dir).filter((f) => f.endsWith('.log')).map((f) => join(dir, f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
      : [dir]
    let found: ManData | null = null
    for (const f of files) found = parseManLog(readFileSync(f)) ?? found
    return found
  }

  /** Every ref already in the ledger, undone ones too, so nothing is paid twice. */
  private handledRefs(): Set<string> {
    return new Set(this.wallet.entries().map((e) => e.ref ?? '').filter(Boolean))
  }

  private pay(ruleId: string, day: string, ref: string, handled: Set<string>, now: Date, note: string): number {
    if (handled.has(ref)) return 0
    try {
      this.wallet.awardRule(ruleId, { now, day, ref, note })
      handled.add(ref)
      return 1
    } catch (e) {
      if (e instanceof LedgerError) return 0 // rule off or that day's limit used
      throw e
    }
  }

  /** Waky's reward list, once, so its goals carry over into the Shop. */
  wakyRewardsToImport(): WakyData['rewards'] {
    if (getSetting(this.db, 'waky_rewards_imported')) return []
    const data = this.readWaky().data
    if (!data) return []
    setSetting(this.db, 'waky_rewards_imported', new Date().toISOString())
    return data.rewards
  }

  /** Pays out what the connected apps recorded since they were connected. */
  sync(now = new Date()): number {
    const today = this.wallet.today(now)
    const handled = this.handledRefs()
    let paid = 0
    const from = (since: string) => (daysBetween(since, today) > CATCH_UP_DAYS ? addDays(today, -CATCH_UP_DAYS) : since)

    const wakySince = this.since('waky')
    const waky = wakySince ? this.readWaky().data : null
    if (wakySince && waky) {
      const start = from(wakySince)
      for (const m of waky.mornings) {
        if (m.day >= start && m.day <= today && m.onTime) paid += this.pay('sleep.up_on_time', m.day, `waky:up:${m.day}`, handled, now, `Up at ${m.time} (Waky)`)
      }
      // Waky files a bedtime under the morning it leads to; it is booked on that day.
      for (const n of waky.nights) {
        // Booked on the evening it started, like a bedtime you log yourself, so the
        // same night is never paid twice (once here, once from the app: P3).
        if (n.day >= start && n.day <= today && n.onTime) paid += this.pay('sleep.bed_on_time', addDays(n.day, -1), `waky:bed:${n.day}`, handled, now, `In bed at ${n.time} (Waky)`)
      }
    }

    const finSince = this.since('finance')
    const fin = finSince ? this.readFinance().data : null
    if (finSince && fin) {
      const budget = this.dailyBudget() * 100
      // Only days that ended before Finance Helper last saved can be judged.
      const lastSavedDay = fin.savedAt ? this.wallet.today(new Date(fin.savedAt)) : null
      for (let d = from(finSince); d <= today; d = addDays(d, 1)) {
        const fd = financeDay(fin, d)
        if (fd.logged) paid += this.pay('money.logged', d, `fin:logged:${d}`, handled, now, 'Spending logged (Finance Helper)')
        const closed = d < today && lastSavedDay !== null && d < lastSavedDay
        if (budget > 0 && closed && fd.logged && fd.everydaySpent <= budget) {
          paid += this.pay('money.under_budget', d, `fin:budget:${d}`, handled, now, 'Under the daily budget (Finance Helper)')
        }
      }
    }

    setSetting(this.db, 'conn_last_sync', now.toISOString())
    return paid
  }

  state(now = new Date()): ConnectionsState {
    const today = this.wallet.today(now)
    const w = this.readWaky()
    const f = this.readFinance()
    const manPath = this.path('man')
    let man: ManData | null = null
    let manError: string | null = null
    try {
      man = this.readMan()
      if (manPath && !man) manError = 'Could not read MAN data (it may be stored in a compressed file)'
    } catch (e) {
      manError = (e as Error).message
    }

    const wd = w.data
    const onTimeDays = wd ? wd.mornings.filter((m) => m.onTime).map((m) => m.day) : []
    const nightsBy = new Map((wd?.nights ?? []).map((n) => [n.day, n]))
    const recent = wd ? wd.mornings.filter((m) => m.day > addDays(today, -14)) : []
    const slept = recent.map((m) => sleptMinutes(nightsBy.get(m.day), m)).filter((x): x is number => x !== null)
    const todayMorning = wd?.mornings.find((m) => m.day === today) ?? null

    const fd = f.data
    const lastSavedDay = fd?.savedAt ? this.wallet.today(new Date(fd.savedAt)) : null

    return {
      today,
      lastSync: getSetting(this.db, 'conn_last_sync') || null,
      waky: {
        path: this.path('waky'),
        found: !!wd,
        error: w.error,
        connectedSince: this.since('waky'),
        weekday: wd?.weekday ?? null,
        weekend: wd?.weekend ?? null,
        today: todayMorning ? { time: todayMorning.time, target: todayMorning.target, onTime: todayMorning.onTime } : null,
        streak: dayStreak(onTimeDays, today),
        best: bestDayStreak(onTimeDays),
        onTimeRate: recent.length ? recent.filter((m) => m.onTime).length / recent.length : null,
        mornings: recent.slice().reverse().map((m) => ({ ...m, sleptMin: sleptMinutes(nightsBy.get(m.day), m) })),
        avgSleepMin: slept.length ? Math.round(slept.reduce((s, x) => s + x, 0) / slept.length) : null
      },
      finance: {
        path: this.financeLabel(),
        found: !!fd,
        error: f.error,
        connectedSince: this.since('finance'),
        currency: fd?.currency ?? 'MDL',
        savedAt: fd?.savedAt ? new Date(fd.savedAt).toISOString() : null,
        staleDays: lastSavedDay ? daysBetween(lastSavedDay, today) : null,
        dailyBudget: this.dailyBudget(),
        today: fd ? financeDay(fd, today) : null,
        month: fd ? financeMonth(fd, today) : null,
        days: fd
          ? Array.from({ length: 14 }, (_, i) => addDays(today, -i)).map((d) => ({ day: d, ...financeDay(fd, d), judged: d < today && lastSavedDay !== null && d < lastSavedDay }))
          : []
      },
      man: {
        path: manPath,
        found: !!man,
        error: manError,
        data: man,
        suggestion: man ? manStartSuggestion(man, today) : null
      }
    }
  }
}
