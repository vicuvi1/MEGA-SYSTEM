// Undo for what Ben did in one reply (LT6: split out of webBots.ts). Used by
// the app's Undo, the "↩ Undo" button on Telegram and AI apps.
import { REMINDERS, type Reminder } from '@core/coachKit'
import { addReps, addWater, sportToday } from '@core/sportShared'
import { readSetting, writeSetting } from '../../../../main/settings'
import { saveSport } from '../../../../main/bodyLog'
import { undoPluginAction } from '../../../../plugins'
import { loadLog, saveLog, sportState } from '../botBrain'
import { deleteMoney } from '../financeBot'
import { takeLink } from './helpers'
import { RHYTHM, rhythmFor } from '@core/rhythm'
import { editPlanBlock } from '@core/benTalk'
import type { BotContext } from './context'
import { undoKnow, undoTool } from '../benMind'

export type UndoDeps = Pick<BotContext, 'mirror' | 'services' | 'calendar' | 'todoist' | 'onExpense'>

/**
 * Takes back what the coach did in one reply (`at`): all of it, or one line.
 * Each line once; the log remembers what was undone.
 */
export async function undoReply(c: UndoDeps, at: string, index?: number): Promise<{ ok: boolean; lines: string[] }> {
  const { mirror, services, calendar, todoist, onExpense } = c
  // BG6: the lines are marked undone first, in one write, so two taps (the
  // app and Telegram, or two servers) can't both take the same thing back.
  const claim = await mirror.write((db) => {
    const log = loadLog(db)
    const e = log.find((x) => x.role === 'coach' && x.at === at)
    if (!e?.undo) return null
    const ids = e.undo.map((op, k) => (op && !e.undone?.[k] && (index == null || index === k) ? k : -1)).filter((k) => k >= 0)
    if (ids.length) {
      const undone = e.undone ?? []
      for (const k of ids) undone[k] = true
      e.undone = undone
      saveLog(db, log)
    }
    return { entry: e, idx: ids }
  })
  if (!claim) return { ok: false, lines: ['Nothing to undo there'] }
  const { entry, idx } = claim
  const ops = entry.undo!
  if (!idx.length) return { ok: false, lines: ['Already undone'] }
  const lines: string[] = []
  const ok: number[] = []
  for (const k of idx) {
    const op = ops[k]!
    try {
      if (op.k === 'event') {
        if (!calendar?.remove) throw new Error('Calendar not connected')
        await calendar.remove(op.cal, op.id)
        lines.push('↩ Block removed from your calendar')
      } else if (op.k === 'eventedit') {
        if (op.title != null) {
          if (!calendar?.update) throw new Error('Calendar not connected')
          await calendar.update(op.cal, op.id, { title: op.title })
          lines.push(`↩ Back to "${op.title}"`)
        } else if (op.start && op.end) {
          if (!calendar?.move) throw new Error('Calendar not connected')
          await calendar.move(op.cal, op.id, op.start, op.end)
          lines.push(`↩ Block back at ${new Date(op.start).toTimeString().slice(0, 5)}`)
        }
      } else if (op.k === 'task') {
        if (!todoist?.remove) throw new Error('Todoist not connected')
        await todoist.remove(op.id)
        lines.push('↩ Todoist task removed')
      } else {
        const line = await mirror.write((db) => {
          const svc = services.services(db)
          if (op.k === 'water' || op.k === 'reps') {
            const st = sportState(db)
            if (!st) return '⚠️ Sport Track data is gone'
            const day = sportToday()
            // BG3: the checklist only holds today. A past day's water or reps
            // are closed; taking them off today would be wrong.
            if (op.day && op.day !== day) return `⚠️ That was logged on ${op.day}; that day is closed, so today stays as it is`
            if (op.k === 'water') {
              saveSport(db as any, addWater(st, op.ml, day), 'telegram', { id: `undo-${at}-${k}` })
              return `↩ Water ${op.ml > 0 ? '+' : ''}${op.ml} ml`
            }
            const r = addReps(st, op.ex, op.amount, day)
            if (!r) return '⚠️ Exercise not found'
            saveSport(db as any, r.st, 'telegram', { id: `undo-${at}-${k}` })
            let gone = ''
            if (op.workout) {
              try {
                // Just this set: other sets the same day stay (P2); the last one takes the points with it.
                svc.body.takeBackSet(op.workout, r.exercise.name, -op.amount)
                gone = ' · taken out of today\'s workout'
              } catch {
                /* already deleted */
              }
            }
            return `↩ ${r.exercise.name} back to ${r.exercise.done}${gone}`
          }
          if (op.k === 'money') {
            const what = deleteMoney(db as any, op.id)
            const life = takeLink(db, op.id)
            if (life) {
              try {
                svc.money.deleteExpense(life)
              } catch {
                /* already gone */
              }
            }
            return what ? `↩ Removed: ${what}` : '⚠️ That money record is already gone'
          }
          if (op.k === 'remind') {
            let list: Reminder[] = []
            try {
              list = readSetting(db as any, REMINDERS)
            } catch {
              list = []
            }
            writeSetting(db as any, REMINDERS, list.filter((r) => r.id !== op.id))
            return '↩ Reminder cancelled'
          }
          if (op.k === 'planblock') {
            const st = rhythmFor(readSetting(db as any, RHYTHM), svc.wallet.today())
            if (st.day !== op.day || !st.briefing) return '⚠️ That plan is gone'
            const blocks = st.briefing.plan.blocks
            // A moved block may sit elsewhere in the list now: find it by what it became.
            const byNow = op.cur ? blocks.findIndex((b) => b.title === op.cur!.title && b.start === op.cur!.start) : -1
            const at = byNow >= 0 ? byNow : op.index < blocks.length ? op.index : -1
            if (at < 0) return '⚠️ That plan block is gone'
            const r = editPlanBlock(st, at, { title: op.title, start: op.start })
            if (!r.state) return `⚠️ ${r.error}`
            writeSetting(db as any, RHYTHM, r.state as any)
            return `↩ Plan block back to ${op.title} at ${op.start}`
          }
          if (op.k === 'plugin') return undoPluginAction({ db: db as any, now: new Date() }, op.plugin, op.verb, op.data)
          if (op.k === 'know') return undoKnow(db, op.op)
          if (op.k === 'tool') {
            try {
              return undoTool(svc, op.op)
            } catch (e) {
              return `⚠️ ${(e as Error).message}`
            }
          }
          if (op.k === 'mustdo') {
            if (op.day && op.day !== svc.wallet.today()) return `⚠️ That must-do was for ${op.day}: it's gone with that day`
            const p = svc.focus.plan(svc.wallet.today())
            const rest = p.items.map((x) => x.text).filter((t) => t.toLowerCase() !== op.text.toLowerCase())
            if (!rest.length) return '⚠️ It is your only must-do: tick it or replace it'
            svc.focus.setPlan(rest)
            return `↩ Must-do removed: ${op.text}`
          }
          const run = svc.focus.state().running
          if (!run) return '⚠️ That focus timer already ended'
          if (op.startedAt && run.startedAt !== op.startedAt) return '⚠️ That timer already ended; a newer one is running, so it stays'
          svc.focus.cancel()
          return '↩ Focus timer cancelled'
        })
        lines.push(line)
        if (line.startsWith('⚠️')) continue
      }
      ok.push(k)
    } catch (e) {
      lines.push(`⚠️ ${(e as Error).message}`)
    }
  }
  // Lines that couldn't be taken back are open again.
  const failed = idx.filter((k) => !ok.includes(k))
  if (failed.length)
    await mirror.write((db) => {
      const log = loadLog(db)
      const e = log.find((x) => x.role === 'coach' && x.at === at)
      if (e?.undone) {
        for (const k of failed) e.undone[k] = false
        saveLog(db, log)
      }
    })
  if (ok.length) onExpense?.()
  return { ok: ok.length > 0, lines }
}
