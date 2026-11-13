// life.moneySort (Money phase 5): the Money page's To sort card (captured
// payments, bills due), and the Rules card. The logic is moneySortCore.ts
// (loaded on first use, it brings Finance Helper's modules); writes go into
// Finance Helper's synced copy and this device's copy is synced right after,
// the same path as quick add (moneyApi.ts).
import { countsAsLogged } from '@core/moneyDays'
import { dayKey } from '@core/dates'
import { getSetting, setSetting } from '../../../main/settings'
import type { RulesView, SortUndo, SortView, ToSortList, TypedAmount } from './moneySortCore'
import type { WebServices } from './webServices'

/**
 * Does this Finance record pay "Spending logged" for its day (Life's
 * connection sync)? A captured payment or an auto-logged bill only when you
 * confirmed it on that day; everything else as before.
 */
export function paysLogged(t: any, dayOf: (ms: number) => string): boolean {
  if (!t || typeof t.date !== 'string') return false
  const src = String(t.source ?? '')
  return src === 'capture' || src === 'auto' ? countsAsLogged(t, dayOf) : true
}

export interface SortDone {
  /** One plain line for the toast: "Filed: Food · next time by itself". */
  line: string
  undo: SortUndo
  view: SortView | null
}

export interface SortApi {
  /** What waits for a tap (files the sure ones by themselves first). null: no Finance Helper data yet. */
  view(): Promise<SortView | null>
  /** One tap on a chip: files the capture and teaches the merchant's rule (`typed`: the amount of an unreadable one). */
  file(itemId: string, category: string, typed?: TypedAmount): Promise<SortDone>
  /** OK (or a new category) on one that was filed by itself. */
  confirmAuto(itemId: string, category?: string): Promise<SortDone>
  /** Undo on one that was filed by itself: back in To sort. */
  undoAuto(itemId: string): Promise<SortDone>
  /** "Not mine". */
  dismiss(itemId: string): Promise<SortDone>
  confirmBill(ruleId: string, date: string): Promise<SortDone>
  skipBill(ruleId: string, date: string): Promise<SortDone>
  /** Takes a tap back exactly. */
  undo(u: SortUndo): Promise<SortView | null>
  rules(): Promise<RulesView | null>
  saveRule(r: { id?: string; match: string; type: string; category: string }): Promise<RulesView | null>
  deleteRule(id: string): Promise<RulesView | null>
}

const LOCAL = 'finance-helper.state'
const store = () => (typeof localStorage !== 'undefined' ? localStorage : null)
const localRaw = (): string | null => {
  try {
    return store()?.getItem(LOCAL) ?? null
  } catch {
    return null
  }
}
const dayOf = (ms: number) => dayKey(new Date(ms))
const changed = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('life-money-changed'))
  window.dispatchEvent(new CustomEvent('life-moneysort-changed'))
}

export function createSortApi(svcP: Promise<WebServices>, syncFinance: () => Promise<unknown>): SortApi {
  const core = () => import('./moneySortCore')
  const bot = () => import('./financeBot')

  const readState = async () => {
    const [{ mergedFinance, readToSort, TOSORT_KEY }, { financeState }] = await Promise.all([core(), bot()])
    return (await svcP).read((s) => ({ state: mergedFinance(localRaw(), financeState(s.db as any)), list: readToSort(getSetting(s.db as any, TOSORT_KEY)) }))
  }

  const view = async (): Promise<SortView | null> => {
    const { sortView } = await core()
    const { state, list } = await readState()
    return state ? sortView(state, list, dayKey(new Date()), dayOf) : null
  }

  /** Runs a change on Finance's synced copy and the To sort list, in one write. */
  const run = async <T>(fn: (state: any, list: ToSortList, now: number) => T): Promise<T> => {
    const [{ readToSort, TOSORT_KEY, SortError }, { financeState, saveFinance }] = await Promise.all([core(), bot()])
    let wrote = false
    const out = await (await svcP).write((s) => {
      const db = s.db as any
      const state = financeState(db)
      if (!state) throw new SortError('Open Finance Helper once first, so its data is here')
      const raw = getSetting(db, TOSORT_KEY)
      const list = readToSort(raw)
      const before = JSON.stringify(state)
      const r = fn(state, list, Date.now())
      if (JSON.stringify(state) !== before) {
        saveFinance(db, state)
        wrote = true
      }
      const next = JSON.stringify(list)
      if (list.items.length && next !== JSON.stringify(readToSort(raw))) {
        setSetting(db, TOSORT_KEY, next)
        wrote = true
      }
      return r
    }, 'life-wallet-changed')
    if (!wrote) return out
    await syncFinance().catch(() => null)
    changed()
    return out
  }

  const done = async (line: string, undo: SortUndo): Promise<SortDone> => ({ line, undo, view: await viewAuto().catch(() => null) })
  const catName = (state: any, id: string) => (state.settings?.categories ?? []).find((c: any) => c.id === id)?.name ?? id

  /** The view, after filing the sure ones by themselves (shown under "Filed by itself", with Undo). */
  const viewAuto = async (): Promise<SortView | null> => {
    const { autoFile, dismissTests, sortView } = await core()
    const { state, list } = await readState()
    if (!state) return null
    // Test payments are dismissed; sure ones are filed by themselves (dry run first, so nothing is written for nothing).
    const probe = { items: list.items.map((x) => ({ ...x })) }
    if (dismissTests(probe, Date.now()) + autoFile(JSON.parse(JSON.stringify(state)), probe, Date.now(), dayOf).length) {
      await run((st, l, now) => (dismissTests(l, now), autoFile(st, l, now, dayOf))).catch(() => null)
      return view()
    }
    return sortView(state, list, dayKey(new Date()), dayOf)
  }

  return {
    view: viewAuto,
    file: async (itemId, category, typed) => {
      const { fileItem } = await core()
      const r = await run((st, l, now) => {
        const out = fileItem(st, l, itemId, category, now, dayOf, typed)
        return { ...out, name: catName(st, category) }
      })
      return done(`Filed: ${r.name}${r.undo.rule ? ' · next time by itself' : ''}`, r.undo)
    },
    confirmAuto: async (itemId, category) => {
      const { confirmAuto } = await core()
      const r = await run((st, l, now) => ({ ...confirmAuto(st, l, itemId, now, category), name: category ? catName(st, category) : '' }))
      return done(category ? `Changed to ${r.name}` : 'Confirmed', r.undo)
    },
    undoAuto: async (itemId) => {
      const { undoAuto } = await core()
      const u = await run((st, l, now) => undoAuto(st, l, itemId, now))
      return done('Back in To sort', u)
    },
    dismiss: async (itemId) => {
      const { dismissItem } = await core()
      const u = await run((st, l, now) => dismissItem(st, l, itemId, now))
      return done('Removed from To sort', u)
    },
    confirmBill: async (ruleId, date) => {
      const { confirmBill } = await core()
      const r = await run((st, _l, now) => confirmBill(st, ruleId, date, now))
      return done(`Booked: ${r.tx.note || 'bill'}`, r.undo)
    },
    skipBill: async (ruleId, date) => {
      const { skipBill } = await core()
      const u = await run((st, _l, now) => skipBill(st, ruleId, date, now))
      return done('Skipped this time', u)
    },
    undo: async (u) => {
      const { undoSort } = await core()
      await run((st, l, now) => undoSort(st, l, u, now))
      return viewAuto()
    },
    rules: async () => {
      const { rulesOf } = await core()
      const { state } = await readState()
      return state ? rulesOf(state) : null
    },
    saveRule: async (r) => {
      const { saveRule, rulesOf } = await core()
      await run((st, _l, now) => saveRule(st, r, now))
      const { state } = await readState()
      return state ? rulesOf(state) : null
    },
    deleteRule: async (id) => {
      const { deleteRule, rulesOf } = await core()
      await run((st, _l, now) => deleteRule(st, id, now))
      const { state } = await readState()
      return state ? rulesOf(state) : null
    }
  }
}
