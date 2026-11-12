// One daily budget for pushes (feature freeze, 2026-11-11). Pure and tested
// (notifyBudget.test.ts). The server tick (Telegram) and the desktop app
// (Windows notifications) both ask `budgetCheck` before anything leaves the app.
//
// At most 4 pushes a day, each slot once:
//   07:00  morning    "your 3 must-dos"
//   21:15  plan       "pick tomorrow's 3"
//   23:15  winddown   "15 minutes to bed" (Sleep: only if bed isn't logged; was 23:00)
//   15:30  afternoon  one optional nudge (off by default)
//   18:00  weekly     Sunday's summary of the 3 numbers (Sundays only)
// One exception the owner asked for (2026-11-12, DECISIONS.md): 00:00 lastcall, a
// second sleep reminder on the desktop only when bed still isn't logged. It does not
// count toward the 4 and is not a slot of the server tick (not in SLOTS).
// Everything else is silent and in the app only (the bell). Not pushes, so not
// counted: timers you started yourself (a focus or study block ending, the rest
// timer) are sounds in the app, and reminders you set yourself ("remind me at 18").
// Text is neutral and private: "Life System: 2 of 3 done", never food or body details.

export type PushSlot = 'morning' | 'plan' | 'winddown' | 'afternoon' | 'weekly' | 'lastcall'

export const DAILY_PUSH_CAP = 4
export const SLOTS: PushSlot[] = ['morning', 'afternoon', 'weekly', 'plan', 'winddown']
export const SLOT_TIME: Record<PushSlot, string> = { morning: '07:00', afternoon: '15:30', weekly: '18:00', plan: '21:15', winddown: '23:15', lastcall: '00:00' }
/** The sleep reminders the desktop sends itself (src/desktop/main.ts), only while bed isn't logged. */
export const SLEEP_REMINDERS = ['winddown', 'lastcall'] as const
export type SleepReminder = (typeof SLEEP_REMINDERS)[number]
/** How long after its time a slot may still go out (a missed tick, the PC asleep). */
export const SLOT_WINDOW_MIN = 45

export interface BudgetLedger {
  day: string
  sent: PushSlot[]
}

export interface BudgetPrefs {
  /** The budget is on (Simple mode). Off: the old senders and their own caps. */
  on: boolean
  /** The optional afternoon nudge. */
  afternoon: boolean
}

export const DEFAULT_BUDGET: BudgetPrefs = { on: true, afternoon: false }

export const isSlot = (x: unknown): x is PushSlot => typeof x === 'string' && (x === 'lastcall' || (SLOTS as string[]).includes(x))

/** The bell id of a slot's message: one per slot and day, so every device adds it once. */
export const slotNotifId = (slot: PushSlot, day: string): string => `budget:${slot}:${day}`

/** The slot of a bell id ("budget:plan:2026-11-11"), or null for anything else. */
export function slotOfId(id: string): PushSlot | null {
  const m = /^budget:([a-z]+):/.exec(String(id ?? ''))
  return m && isSlot(m[1]) ? m[1] : null
}

export function cleanLedger(raw: unknown, day: string): BudgetLedger {
  const r = raw as Partial<BudgetLedger> | null
  if (!r || r.day !== day || !Array.isArray(r.sent)) return { day, sent: [] }
  return { day, sent: [...new Set(r.sent.filter(isSlot))] }
}

export interface BudgetVerdict {
  ok: boolean
  /** Why it stays in the app (for Ben's log). */
  reason: string | null
  /** The ledger after sending (unchanged when not ok). */
  next: BudgetLedger
}

/**
 * May this push go out? `slot` null means "not one of the 4": in the app only.
 * Weekly only on Sundays; afternoon only when switched on; each slot once a
 * day; at most DAILY_PUSH_CAP in all.
 */
export function budgetCheck(ledger: BudgetLedger | null, slot: PushSlot | null, day: string, prefs: BudgetPrefs = DEFAULT_BUDGET, weekday?: number): BudgetVerdict {
  const cur = cleanLedger(ledger, day)
  const no = (reason: string): BudgetVerdict => ({ ok: false, reason, next: cur })
  if (!prefs.on) return { ok: true, reason: null, next: cur }
  if (!slot) return no('Daily push budget: in the app only')
  if (slot === 'afternoon' && !prefs.afternoon) return no('The afternoon nudge is off')
  // Sunday: the weekly summary takes the afternoon nudge's place (still 4 at most).
  if (slot === 'afternoon' && weekday === 0) return no("On Sundays the weekly summary takes the afternoon nudge's place")
  if (slot === 'weekly' && weekday != null && weekday !== 0) return no('The weekly summary is for Sundays')
  if (cur.sent.includes(slot)) return no('Already sent this one today')
  // 00:00 lastcall: the owner's sleep-only exception, never one of the 4.
  if (slot === 'lastcall') return { ok: true, reason: null, next: { day, sent: [...cur.sent, slot] } }
  if (cur.sent.filter((s) => s !== 'lastcall').length >= DAILY_PUSH_CAP) return no(`Today's ${DAILY_PUSH_CAP} pushes are used up: in the app only`)
  return { ok: true, reason: null, next: { day, sent: [...cur.sent, slot] } }
}

const minOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** The slot due at this minute of the day (its time up to SLOT_WINDOW_MIN after), or null. */
export function dueSlot(minute: number, weekday: number, prefs: BudgetPrefs = DEFAULT_BUDGET, sent: PushSlot[] = []): PushSlot | null {
  for (const s of SLOTS) {
    if (sent.includes(s)) continue
    if (s === 'afternoon' && (!prefs.afternoon || weekday === 0)) continue
    if (s === 'weekly' && weekday !== 0) continue
    const t = minOf(SLOT_TIME[s])
    if (minute >= t && minute < t + SLOT_WINDOW_MIN) return s
  }
  return null
}

/** The sleep reminder due at this minute of the day (23:15 or 00:00, up to SLOT_WINDOW_MIN after), or null. */
export function sleepReminderDue(minute: number): SleepReminder | null {
  for (const s of SLEEP_REMINDERS) {
    const t = minOf(SLOT_TIME[s])
    if (minute >= t && minute < t + SLOT_WINDOW_MIN) return s
  }
  return null
}

/**
 * Should the desktop show tonight's sleep reminder? Only with the Sleep module on and
 * bed not logged. 23:15 (winddown) is one of the 4: it goes out when it claims its slot,
 * or when the slot is already this one's (the same push, also on Telegram). 00:00
 * (lastcall) is the owner's exception and always passes the budget.
 */
export function sleepReminderShows(o: { slot: SleepReminder; sleepOn: boolean; bedLogged: boolean; claimed: boolean; alreadySent: boolean }): boolean {
  if (!o.sleepOn || o.bedLogged) return false
  return o.slot === 'lastcall' || o.claimed || o.alreadySent
}

/** The neutral text of a slot's push (no food, body or personal details). */
export function slotText(slot: PushSlot, f: { mustDone: number; mustTotal: number; mustDos?: string[]; week?: string }): string {
  switch (slot) {
    case 'morning':
      return f.mustTotal ? `Life System: your 3 must-dos today (${Math.min(f.mustDone, 3)} of 3 done). Open the app to see them.` : "Life System: no must-dos for today yet. Pick 3 in the app."
    case 'afternoon':
      return `Life System: ${Math.min(f.mustDone, 3)} of 3 done.`
    case 'weekly':
      return f.week ?? 'Life System: your week is ready in the app.'
    case 'plan':
      return "Life System: pick tomorrow's 3 must-dos. Reply with 3 lines, each with a number or minutes."
    case 'winddown':
      return 'Life System: 15 minutes to bed. Phone away, asleep by 23:30.'
    case 'lastcall':
      return 'Life System: it is midnight and bed is not logged. Go to sleep now.'
  }
}

/** Reads the `simple_mode` setting's budget part (missing = on, afternoon off). */
export function budgetPrefs(raw: unknown): BudgetPrefs {
  const r = (raw ?? {}) as { on?: unknown; budget?: unknown; afternoon?: unknown }
  return { on: r.budget !== false, afternoon: r.afternoon === true }
}

/**
 * The island in Simple mode (a quiet helper): a card may still pop up only for a timer he started
 * himself (a focus or study timer that is over: kind 'over', or a Study Time notice) or a reminder
 * he set ('remind'). Everything else waits silently until he opens the island; the 4 daily pushes
 * reach him as Windows notifications and on Telegram, so the island adds none.
 */
export function islandAlertPasses(a: { kind: string; study?: unknown } | null | undefined): boolean {
  if (!a) return false
  return a.kind === 'over' || a.kind === 'remind' || !!a.study
}
