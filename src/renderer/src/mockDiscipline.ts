import { addDays, dayKey } from '@core/dates'
import {
  milestoneRef, milestonesOf, planCheckIn, quoteFor, rankFor, startOf, statsOf, validateStart, type DisciplineEvent
} from '@core/discipline'
import { effective, type LedgerEntry, type NewEntry } from '@core/ledger'
import { planAward, type Rule } from '@core/rules'
import type { DisciplineState, LifeApi } from '@shared/api'

interface Ctx {
  entries: LedgerEntry[]
  add: (e: NewEntry) => number
  rules: () => Rule[]
}

/** In-memory Discipline for the browser demo; the urge timer is shortened to 10 s. */
export function createMockDiscipline(ctx: Ctx): Pick<LifeApi, 'discipline'> {
  const today = () => dayKey(new Date())
  const events: DisciplineEvent[] = []
  let id = 1
  let urgeStartedAt: string | null = null
  let stealth = false
  const record = (kind: DisciplineEvent['kind'], day = today()) => events.push({ id: id++, kind, day, ts: new Date().toISOString() })
  const award = (ruleId: string) => {
    const rule = ctx.rules().find((r) => r.id === ruleId)
    if (!rule) return
    try {
      ctx.add(planAward(rule, ctx.entries, new Date(), today()))
    } catch {
      // over a limit
    }
  }
  const claimed = () => new Set(effective(ctx.entries).map((e) => e.ref ?? '').filter((r) => r.startsWith('milestone:')))

  const state = (): DisciplineState => {
    const t = today()
    const stats = statsOf(events, t)
    const rank = rankFor(stats.current)
    const has = (k: DisciplineEvent['kind']) => events.some((e) => e.kind === k && e.day === t)
    return {
      setup: !!startOf(events),
      today: t,
      since: stats.since,
      current: stats.current,
      best: stats.best,
      totalClean: stats.totalClean,
      resets: stats.relapses,
      rank: rank.name,
      nextRank: rank.next,
      checkedInToday: has('checkin'),
      oathToday: has('oath'),
      resetToday: has('reset'),
      canEditStart: !events.some((e) => e.kind === 'reset'),
      milestones: milestonesOf(events, t, claimed(), (s) => dayKey(new Date(s.ts))),
      urgeStartedAt,
      urgesThisWeek: events.filter((e) => e.kind === 'urge' && e.day >= addDays(t, -6)).length,
      stealth,
      quote: quoteFor(t)
    }
  }

  return {
    discipline: {
      state: async () => state(),
      setStart: async (day) => {
        validateStart(day, today(), events)
        record('start', day)
        return state()
      },
      checkIn: async () => {
        planCheckIn(events, today())
        award('discipline.clean_day')
        record('checkin')
        return state()
      },
      oath: async () => {
        if (state().oathToday) throw new Error('Oath already sworn today')
        award('discipline.oath')
        record('oath')
        return state()
      },
      reset: async () => {
        if (state().resetToday) throw new Error('Already reset today. Tomorrow is day 1.')
        award('discipline.reset')
        record('reset')
        urgeStartedAt = null
        return state()
      },
      claim: async (days) => {
        const s = state()
        const m = s.milestones.find((x) => x.days === days)
        if (!m || m.status !== 'claimable') throw new Error('Nothing to claim for that milestone')
        ctx.add({ ts: new Date().toISOString(), day: today(), module: 'discipline', kind: 'earn', coins: m.coins, xp: m.coins, ref: milestoneRef(s.since!, days), note: `${days}-day milestone` })
        return { coins: m.coins, state: state() }
      },
      startUrge: async () => {
        urgeStartedAt ??= new Date().toISOString()
        return state()
      },
      finishUrge: async () => {
        if (!urgeStartedAt || Date.now() - Date.parse(urgeStartedAt) < 10_000) throw new Error('Stay with it a little longer')
        award('discipline.urge_resisted')
        record('urge')
        urgeStartedAt = null
        return state()
      },
      cancelUrge: async () => {
        urgeStartedAt = null
        return state()
      },
      setStealth: async (on) => {
        stealth = on
        return state()
      }
    }
  }
}
