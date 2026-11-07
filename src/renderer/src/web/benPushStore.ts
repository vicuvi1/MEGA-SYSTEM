// Ben 2's pushes on the database (core/benPushes.ts is the logic): the shared
// log (synced setting `ben_pushes`: one key per push, your answers, tonight's
// shutdown list and marks, drift words waiting for Telegram) and "am I at the
// PC" (`ben_pc_seen`). Used by the app window (the island), the server's tick
// and the Telegram buttons, so a push shown on one never comes on the other.
import { answerPush, claim, cleanPcSeen, cleanPushLog, markItem, MARK_WORD, outboxAdd, PC_SEEN_KEY, PUSH_LOG_KEY, type Channel, type ItemMark, type OutItem, type PcSeen, type PushLog, type PushOp, type ShutdownItem } from '@core/benPushes'
import { getSetting, setSetting } from '../../../main/settings'

const parse = (db: any, key: string): unknown => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}
export const readPushLog = (db: any, day: string): PushLog => cleanPushLog(parse(db, PUSH_LOG_KEY), day)
export const writePushLog = (db: any, log: PushLog) => setSetting(db, PUSH_LOG_KEY, JSON.stringify(log))
export const readPcSeen = (db: any): PcSeen | null => cleanPcSeen(parse(db, PC_SEEN_KEY))
export const writePcSeen = (db: any, p: PcSeen) => setSetting(db, PC_SEEN_KEY, JSON.stringify(p))

/** Claims a push (inside one write): false when it already went out anywhere. */
export function claimPush(db: any, day: string, key: string, via: Channel, now: number): boolean {
  const r = claim(readPushLog(db, day), key, via, now)
  if (r.ok) writePushLog(db, r.log)
  return r.ok
}
export function answerPushIn(db: any, day: string, key: string, op: PushOp, now: number, minutes?: number): PushLog {
  const log = answerPush(readPushLog(db, day), key, op, now, minutes)
  writePushLog(db, log)
  return log
}
export function queueOut(db: any, day: string, item: OutItem): void {
  const cur = readPushLog(db, day)
  const next = outboxAdd(cur, item)
  if (next !== cur) writePushLog(db, next)
}
/** Tonight's list (kept with the marks already made today). */
export function setShutdownItems(db: any, day: string, items: ShutdownItem[]): void {
  const cur = readPushLog(db, day)
  writePushLog(db, { ...cur, shutdown: { day, items, marks: cur.shutdown?.marks ?? {} } })
}
/** Only records a choice (Today's Shut down did the moving itself). */
export function noteMark(db: any, day: string, id: string, mark: ItemMark): void {
  writePushLog(db, markItem(readPushLog(db, day), id, mark))
}

const planItems = (svc: any, day: string): string[] => (svc.focus.plan(day).items as { text: string }[]).map((x) => x.text)

export interface MarkDeps {
  day: string
  tomorrow: string
  /** One change on the database (the app's mirror or the server's), with its services. */
  write: <T>(fn: (db: any, svc: any) => T) => Promise<T>
  todoist: { update?: (id: string, patch: { due?: string }) => Promise<void>; quickAdd?: (text: string) => Promise<unknown> } | null
}

/**
 * Tomorrow / Drop / Keep today on one shutdown item (or `*`: every one not
 * chosen yet), from Telegram, the island or the Coach card. Tomorrow: a
 * Todoist task gets tomorrow's date, a must-do goes into Todoist for tomorrow
 * (as Today's Shut down does), or into tomorrow's must-dos without Todoist.
 * Drop: the task loses its date, the must-do leaves today's list. Nothing is
 * completed and nothing pays points. Returns a short line.
 */
export async function applyMark(d: MarkDeps, id: string, mark: ItemMark): Promise<string> {
  const log = await d.write((db) => readPushLog(db, d.day))
  const sd = log.shutdown
  if (!sd) return 'That list is from another day.'
  const items = id === '*' ? sd.items.filter((x) => !sd.marks[x.id]) : sd.items.filter((x) => x.id === id && !sd.marks[x.id])
  if (!items.length) return sd.items.some((x) => x.id === id) ? 'Already done.' : 'Nothing left to sort.'
  const done: string[] = []
  for (const x of items) {
    try {
      if (mark === 'tomorrow') {
        if (x.kind === 'todo' && x.ref && d.todoist?.update) await d.todoist.update(x.ref, { due: 'tomorrow' })
        else if (x.kind === 'mustdo' && d.todoist?.quickAdd) await d.todoist.quickAdd(`${x.text} tomorrow`)
        else await d.write((_db, svc) => svc.focus.setPlan([...planItems(svc, d.tomorrow), x.text], new Date(), d.tomorrow))
      } else if (mark === 'drop') {
        if (x.kind === 'todo' && x.ref && d.todoist?.update) await d.todoist.update(x.ref, { due: '' })
        else if (x.kind === 'mustdo')
          await d.write((_db, svc) => {
            const left = planItems(svc, d.day).filter((t) => t !== x.text)
            if (left.length) svc.focus.setPlan(left, new Date(), d.day)
          })
      }
      done.push(x.id)
    } catch {
      /* that one stays open: try again */
    }
  }
  await d.write((db) => {
    let cur = readPushLog(db, d.day)
    for (const k of done) cur = markItem(cur, k, mark)
    writePushLog(db, cur)
  })
  if (!done.length) return 'Couldn’t change that one. Try again in a minute.'
  return items.length === 1 ? `${MARK_WORD[mark]}: ${items[0].text}` : `${MARK_WORD[mark]}: ${done.length} items`
}
