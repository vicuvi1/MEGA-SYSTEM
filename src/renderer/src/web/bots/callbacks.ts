// The bots' buttons (Telegram callback data), one handler per kind in a typed
// table (LT6). Each tap is "xx|args"; the first entry whose `match` takes it
// runs. Order matters only where two entries could both match: the last one
// takes everything else (must-do ticks and money card buttons). Handlers get
// what they need from the bot through `c` (BotContext) and the tap through `t`.
import { calendarDay } from '@core/dates'
import { getSetting, setSetting, writeSetting } from '../../../../main/settings'
import { saveSport } from '../../../../main/bodyLog'
import { moneyButton, takeMoneyAsk } from '../financeBot'
import { financeDayTx } from '../webServices'
import { payTodoist } from '../todoistCoins'
import { REASONS } from '@core/focus'
import type { CalEvent } from '@core/dayTime'
import { eveningText, planKeyboard, planText } from '@core/focusBot'
import { NUDGES, REMINDERS, type NudgeState, type Reminder } from '@core/coachKit'
import { reminderDone, reminderSnooze } from '@core/healthyDay'
import { readConfirm } from '@core/benSafety'
import { deskChange, loadDesk, saveDesk } from '../benDesk'
import { moodFace } from '@core/benKnows'
import { RATINGS, focusRatings, sportState, loadLog, addFeedback, type Feedback } from '../botBrain'
import { EDIT_ASK, TOP3_ASK, WEEK_ASK, proposalText, checkoutText, checkoutKeyboard } from '@core/rhythm'
import { waterToday } from '../coachStatus'
import { nextSlot } from '@core/benActs'
import { rescueFromEvents } from '@core/benPlans'
import { addStake, suggestStake } from '@core/benStakes'
import { addWater, sportForDay, sportToday } from '@core/sportShared'
import { activeExercises, allDone, applyWorkoutTap, defaultSport, progression, recordWorkoutDay, setExercise, waterCard, workoutCard, type WorkoutLog } from '@core/sportCards'
import { esc, tg } from './telegram'
import { takeLink, sleepTip, STOP_KEYBOARD, stoppedReply } from './helpers'
import type { BotContext, Tap } from './context'
import { goalTap } from '../goalsBrain'
import { readPushCallback } from '@core/benPushes'
import { answerPushIn, applyMark, readPushLog } from '../benPushStore'

export interface CallbackHandler {
  /** The callback-data prefixes it answers ("wa" for "wa|250"), for docs and tests. */
  prefixes: string[]
  match: (data: string) => boolean
  run: (c: BotContext, t: Tap) => Promise<string | null>
}

/** Every callback data the bots answer (anything else isn't a bot button). */
export const CALLBACK_DATA = /^(f[acbksuoxq]|p[pr]|td|sq|g[pxbc]|n[ps]|r[bvwm]|cu|cs|wa|wk|fb|bf|md|sk|sr|bd|bt|bx|bp|rs|sg|m[lnz])\|/

export const CALLBACKS: CallbackHandler[] = [
  // Water and workout cards: a tap updates the shared log and the card.
  {
    prefixes: ['wa', 'wk'],
    match: (data) => data.startsWith('wa|') || data.startsWith('wk|'),
    run: async (c, t) => {
      const { mirror, services, markSeen } = c
      const { data, chat, key, update, answer, edit } = t
      if (!(await markSeen(key))) return null
      const show = data === 'wa|show' || data === 'wk|show'
      const r = await mirror.write((db) => {
        const svc = services.services(db)
        const day = sportToday()
        let st = sportState(db) ?? defaultSport(day)
        // Through the one log: each tap is a row (the same tap delivered twice counts once).
        const save = (x: any) => (st = saveSport(db as any, x, 'telegram', { id: `tg-${key}` }))
        if (data.startsWith('wa|')) {
          if (!show) {
            save(addWater(st, Number(data.slice(3)) || 0, day))
          }
          const c = waterCard(st, day, waterToday(db, svc).target)
          return { ...c, toast: show ? '' : `${Number(data.slice(3)) > 0 ? '+' : ''}${data.slice(3)} ml` }
        }
        let extra = ''
        let toast = ''
        if (!show) {
          const was = allDone(sportForDay(st, day))
          save(applyWorkoutTap(st, day, data.slice(3)))
          toast = 'Logged'
          if (!was && allDone(st)) {
            // Finished: it counts as today's workout (streak, points), and targets may go up.
            const list = activeExercises(st)
            try {
              svc.body.logWorkout({ title: `Daily workout: ${list.map((e: any) => `${e.doneToday} ${e.name}`).join(', ')}`, items: list.map((e: any) => ({ exerciseId: String(e.id ?? e.name), name: String(e.name), amount: Number(e.doneToday) || 0, unit: e.unit === 'sec' ? 'minutes' : 'reps' })), note: 'Logged with Ben' })
            } catch {
              /* already logged today */
            }
            let log: WorkoutLog = { days: {} }
            try {
              log = JSON.parse(getSetting(db as any, 'ben_workouts') || '{"days":{}}')
            } catch {
              log = { days: {} }
            }
            log = recordWorkoutDay(log, st, day)
            setSetting(db as any, 'ben_workouts', JSON.stringify(log))
            const ups = st.sportySettings?.autoProgression === false ? [] : progression(log, st, day)
            for (const u of ups) st = setExercise(st, day, u.name, u.to).st
            if (ups.length) save(st)
            const body = svc.body.state()
            extra = [`🔥 Streak ${body.streak} day${body.streak === 1 ? '' : 's'} · ${body.workoutsThisWeek} this week`, ...ups.map((u) => `${u.to > u.from ? '📈' : '📉'} ${u.name}: ${u.from} → ${u.to} (${u.why})`)].join('\n')
            toast = 'Workout done! 🔥'
          }
        }
        return { ...workoutCard(st, day, extra), toast }
      })
      await answer(r.toast || 'OK')
      if (show) await tg(update.__token, 'sendMessage', { chat_id: chat, text: r.text, parse_mode: 'HTML', reply_markup: r.keyboard }).catch(() => null)
      else await edit(r.text, r.keyboard)
      return r.text
    }
  },
  // A reply button: "say" sends its words as your message; "book" books a goal; "plan" makes today's plan.
  {
    prefixes: ['cs', 'gb', 'rb'],
    match: (data) => data.startsWith('cs|') || data.startsWith('gb|') || data === 'rb|p',
    run: async (c, t) => {
      const { markSeen, rhythm, sendProposal, handleBrain } = c
      const { data, chat, key, botId, cfg, update, answer } = t
      if (!(await markSeen(key))) return null
      await answer(data.startsWith('cs|') ? '…' : 'On it')
      if (data === 'rb|p') return sendProposal(update.__token, chat)
      if (data.startsWith('gb|')) {
        const want = data.slice(3).toLowerCase()
        const plans = await rhythm.goalPlans()
        const ids = plans.filter((p) => p.title.toLowerCase().startsWith(want) || want.startsWith(p.title.toLowerCase().slice(0, want.length))).map((p) => p.goalId)
        const r = await rhythm.bookGoals(ids.length ? ids : undefined)
        const text = r.lines.map(esc).join('\n')
        await tg(update.__token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML' }).catch(() => null)
        return text
      }
      const said = data.slice(3)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text: `💬 <i>${esc(readConfirm(said)?.rest ?? said)}</i>`, parse_mode: 'HTML' }).catch(() => null)
      return handleBrain(botId, { __token: update.__token, update_id: update.update_id, message: { chat: { id: chat }, text: said } }, cfg, said, `${key}:say`)
    }
  },
  // MF10: the evening "anything spent?" ask. [Nothing spent] marks today as you
  // said (the money service's rule: it pays nothing now, and counts as a
  // no-spend day only if it stays true once the day is over); [Log it] asks
  // for the line, which the money rules then log.
  {
    prefixes: ['mz'],
    match: (data) => data.startsWith('mz|'),
    run: async (c, t) => {
      const { data, chat, key, update, cq, answer } = t
      if (!(await c.markSeen(key))) return null
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message?.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      let text = '✍️ Send it in one line: <code>45 food</code>, <code>120+45 groceries</code>, <code>+500 salary</code>. Add "yesterday" for another day.'
      if (data === 'mz|0') {
        text = await c.mirror
          .write((db) => {
            const svc = c.services.services(db)
            svc.money.nothingSpent(financeDayTx(svc))
            return '👍 Noted: nothing spent today. It counts as a no-spend day if it stays that way.'
          })
          .catch((e) => `⚠️ ${esc((e as Error).message)}`)
      }
      await answer(data === 'mz|0' ? 'Nothing spent' : 'Send what you spent')
      await tg(update.__token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML' }).catch(() => null)
      return text
    }
  },
  // An unclear money message (X5): [Log it] logs it, [Not money] gives it to Ben.
  {
    prefixes: ['ml', 'mn'],
    match: (data) => data.startsWith('ml|') || data.startsWith('mn|'),
    run: async (c, t) => {
      const { mirror, onExpense, markSeen, handleBrain, runMoneyIn } = c
      const { data, chat, key, botId, cfg, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const said = await mirror.write((db) => takeMoneyAsk(db as any, data.slice(3)))
      if (!said) {
        await answer('Already done')
        return null
      }
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message?.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      if (data.startsWith('mn|')) {
        await answer('Asking Ben')
        return handleBrain(botId, { __token: update.__token, update_id: update.update_id, message: { chat: { id: chat }, text: said } }, cfg, said, `${key}:nm`)
      }
      await answer('Logged')
      const r = await mirror.write((db) => runMoneyIn(db, said, `${key}:ml`))
      const text = r?.reply ?? 'Could not log that: try "taxi 45".'
      await tg(update.__token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...(r?.keyboard ? { reply_markup: r.keyboard } : {}) }).catch(() => null)
      onExpense?.()
      return text
    }
  },
  // 👍 / 👎 / too long / wrong on a reply: saved, and Ben adjusts.
  // Feedback is "bf|ms|kind" (old messages: "fb|ms|kind"); "fb|<id>" alone is the money card's ⬅️ Back (T1).
  {
    prefixes: ['bf', 'fb'],
    match: (data) => data.startsWith('bf|') || (data.startsWith('fb|') && data.split('|').length === 3),
    run: async (c, t) => {
      const { mirror, markSeen } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const [, ms, kind] = data.split('|')
      const at = new Date(Number(ms)).toISOString()
      await mirror.write((db) => {
        const e = loadLog(db).find((x) => x.role === 'coach' && x.at === at)
        addFeedback(db, { at, kind: (['up', 'down', 'long', 'wrong'].includes(kind) ? kind : 'down') as Feedback['kind'], text: e?.text ?? String(cq.message?.text ?? '').slice(0, 300) })
      })
      await answer(kind === 'up' ? '👍 Noted' : kind === 'long' ? 'Got it: shorter' : kind === 'wrong' ? 'Got it: tell me what was wrong' : 'Noted: I will do better')
      // Keep the other buttons, drop the feedback row (it's been answered).
      const kb = (cq.message?.reply_markup?.inline_keyboard ?? []).filter((row: any[]) => !row.some((b) => /^(bf|fb)\|\d+\|/.test(String(b.callback_data ?? ''))))
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: kb } }).catch(() => null)
      return null
    }
  },
  // Ben's desk from Telegram: mood (md|1-5), a stake done (sk|id), a study topic reviewed (sr|id).
  {
    prefixes: ['md', 'sk', 'sr'],
    match: (data) => data.startsWith('md|') || data.startsWith('sk|') || data.startsWith('sr|'),
    run: async (c, t) => {
      const { mirror, services, markSeen } = c
      const { data, key, cq, answer, edit } = t
      if (!(await markSeen(key))) return null
      const arg = data.slice(3)
      const line = await mirror.write((db) => {
        const svc = services.services(db)
        if (data.startsWith('md|')) return `${moodFace(Number(arg))} ${deskChange(svc, { op: 'mood', mood: Number(arg) })}`
        if (data.startsWith('sk|')) {
          const st = loadDesk(db).stakes.find((x) => x.id === arg)
          if (!st || st.status !== 'open') return st?.status === 'lost' ? 'Too late: the points are gone.' : 'Already done.'
          return `💎 ${deskChange(svc, { op: 'keepStake', id: arg })} "${st.text}" · your ${st.points} points are safe.`
        }
        return `📚 ${deskChange(svc, { op: 'reviewed', id: arg })}`
      })
      await answer(line.slice(0, 190))
      await edit(`${esc(String(cq.message?.text ?? ''))}\n\n${esc(line)}`)
      return line
    }
  },
  // A goal check-in from Telegram: gc|<goal id>|<op> ("+50", "-0.5", "s" same as before, "k" skip, "=3400").
  {
    prefixes: ['gc'],
    match: (data) => data.startsWith('gc|'),
    run: async (c, t) => {
      const { mirror, services, markSeen } = c
      const { data, key, cq, answer, edit } = t
      if (!(await markSeen(key))) return null
      const [, id, op] = data.split('|')
      const line = await mirror.write((db) => goalTap(services.services(db), Number(id), op ?? ''))
      await answer(line.slice(0, 190))
      await edit(`${esc(String(cq.message?.text ?? ''))}\n\n${esc(line)}`)
      return line
    }
  },
  // ↩ Undo under a coach reply: take back what it did.
  {
    prefixes: ['cu'],
    match: (data) => data.startsWith('cu|'),
    run: async (c, t) => {
      const { markSeen, undoReply } = c
      const { data, key, cq, answer, edit } = t
      if (!(await markSeen(key))) return null
      const at = new Date(Number(data.slice(3))).toISOString()
      const r = await undoReply(at)
      await answer(r.ok ? 'Undone' : r.lines[0] ?? 'Nothing to undo')
      const text = `${esc(String(cq.message?.text ?? ''))}\n\n${r.lines.map(esc).join('\n')}`
      await edit(text)
      return text
    }
  },
  // The daily rhythm: today's plan, the evening review, the Sunday review.
  {
    prefixes: ['rb', 'rv', 'rw', 'w3'],
    match: (data) => /^(r[bvw]|w3)\|/.test(data),
    run: async (c, t) => {
      const { calendar, markSeen, rhythm, sendProposal } = c
      const { data, chat, key, update, cq, answer, edit } = t
      if (!(await markSeen(key))) return null
      const msg = String(cq.message?.text ?? '')
      try {
        if (data === 'rb|a') {
          await answer('Approving…')
          const r = await rhythm.approve()
          const text = r.plan ? `${proposalText(r.plan, { approved: true })}\n${r.done.map(esc).join('\n')}` : esc(r.done.join(' '))
          await edit(text)
          return text
        }
        if (data === 'rb|r') {
          await answer('Making another plan…')
          await edit(`${esc(msg)}\n\n🔄 <i>Making another one…</i>`)
          return await sendProposal(update.__token, chat)
        }
        if (data === 'rb|e' || data === 'rv|e' || data === 'rw|e') {
          await answer('Tell me')
          const ask = data === 'rb|e' ? EDIT_ASK : data === 'rv|e' ? TOP3_ASK : WEEK_ASK
          await tg(update.__token, 'sendMessage', { chat_id: chat, text: ask, reply_markup: { force_reply: true, input_field_placeholder: data === 'rb|e' ? 'No gym today; lab report first' : 'One per line' } })
          return ask
        }
        // W6: the honest check-out, item by item (journal only, never points).
        if (data === 'rv|o') {
          const c = await rhythm.checkoutStart()
          await answer(c.items.length ? 'Check out' : 'Nothing to check')
          if (!c.items.length) return null
          await tg(update.__token, 'sendMessage', { chat_id: chat, text: checkoutText(c.items, c.marks), parse_mode: 'HTML', reply_markup: checkoutKeyboard(c.items, c.marks) })
          return 'checkout'
        }
        if (data.startsWith('rv|c|')) {
          const [, , i, v] = data.split('|')
          const c = await rhythm.checkoutMark(Number(i), v as 'k' | 'p' | 'x')
          await answer(v === 'k' ? 'Done' : v === 'p' ? 'Partly' : 'Not done')
          await edit(checkoutText(c.items, c.marks), checkoutKeyboard(c.items, c.marks))
          return 'marked'
        }
        if (data === 'rv|k') {
          await answer('Saved for tomorrow')
          // W18: tomorrow's plan is drafted now, ready when you wake.
          const draft = await rhythm.planTomorrow().catch(() => null)
          const text = `${esc(msg)}\n\n✅ <b>Saved.</b> They're the first must-dos in tomorrow's plan.${draft?.blocks.length ? ` Tomorrow's draft is ready: ${draft.blocks.length} block${draft.blocks.length === 1 ? '' : 's'} from ${draft.blocks[0].start}.` : ''}`
          await edit(text)
          return text
        }
        if (data === 'rw|a') {
          const line = await rhythm.applyWeekly()
          await answer('Week planned')
          const text = `${esc(msg)}\n\n✅ ${esc(line)}`
          await edit(text, { inline_keyboard: [[{ text: '📅 Book the big 3 in my calendar', callback_data: 'rw|b' }]] })
          return text
        }
        // Sunday's "pick your top 3": a chip in or out, then Save (the rest are parked).
        if (data.startsWith('w3|')) {
          const arg = data.slice(3)
          if (arg === 'ok') {
            const line = await rhythm.top3Save()
            await answer('Saved')
            await edit(esc(line))
            return line
          }
          const r = await rhythm.top3Tap(Number(arg))
          await answer(r ? 'Ok' : 'That question is old')
          if (r) await edit(r.text, r.keyboard)
          return r ? 'picked' : null
        }
        // W13: the big 3 as blocks: shown first, booked on "Book them".
        if (data === 'rw|b') {
          const list = await rhythm.bookingPreview()
          await answer(list.length ? 'Here they are' : 'No free time found')
          const text = list.length ? `📅 <b>The big 3 this week</b>, in your free time:\n${list.map((b) => `${new Date(`${b.day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })} ${b.start}–${b.end} ${esc(b.title)}`).join('\n')}` : 'No free time found for the big 3 this week (or they are done).'
          await tg(update.__token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...(list.length ? { reply_markup: { inline_keyboard: [[{ text: '✅ Book them', callback_data: 'rw|y' }, { text: 'Not now', callback_data: 'rw|n' }]] } } : {}) })
          return text
        }
        if (data === 'rw|y' || data === 'rw|n') {
          const done = data === 'rw|y' ? await rhythm.bookWeek() : []
          await answer(data === 'rw|y' ? `Booked ${done.length}` : 'Not booked')
          const text = `${esc(msg)}\n\n${data === 'rw|y' ? `✅ Booked ${done.length} block${done.length === 1 ? '' : 's'}.` : 'Not booked.'}`
          await edit(text)
          return text
        }
      } catch (e) {
        await answer((e as Error).message.slice(0, 190))
      }
      return null
    }
  },
  // A Todoist task finished after a focus session: Todoist is a network
  // call, so the tap is marked seen first, then Todoist, then the coins.
  {
    prefixes: ['td'],
    match: (data) => data.startsWith('td|'),
    run: async (c, t) => {
      const { mirror, services, todoist } = c
      const { data, key, cq, answer, edit } = t
      const fresh = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return false
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        return true
      })
      if (!fresh) return null
      const id = data.slice(3)
      const title = /“([^”]*)”/.exec(String(cq.message?.text ?? ''))?.[1] ?? 'Todoist task'
      try {
        if (!todoist) throw new Error('Todoist is not connected')
        await todoist.close(id)
        const paid = await mirror.write((db) => payTodoist(services.services(db), [{ id, content: title }]))
        await answer(paid ? '+8 points' : 'Done')
        const text = `${String(cq.message?.text ?? '').split('\n\nFinished')[0]}\n\n✅ <b>Done in Todoist:</b> ${esc(title)}${paid ? ' · 🪙 +8' : ''}`
        await edit(text)
        return text
      } catch (e) {
        await answer(`Todoist: ${(e as Error).message}`.slice(0, 190))
        return null
      }
    }
  },
  // The suggested time blocks: into Google Calendar (or not).
  {
    prefixes: ['gp', 'gx'],
    match: (data) => data.startsWith('gp|') || data.startsWith('gx|'),
    run: async (c, t) => {
      const { mirror, calendar } = c
      const { data, key, cq, answer, edit } = t
      const sug = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return undefined
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        try {
          return JSON.parse(getSetting(db as any, 'plan_suggestion') || 'null') as { day: string; blocks: { title: string; start: string; end: string }[] } | null
        } catch {
          return null
        }
      })
      if (sug === undefined) return null
      if (data.startsWith('gx|') || !sug || !calendar) {
        await answer('Okay')
        await edit(`${esc(String(cq.message?.text ?? ''))}\n\nOkay, no blocks. Start when you're ready: /focus 50`)
        return 'no blocks'
      }
      let made = 0
      for (const b of sug.blocks) {
        const ok = await calendar.create({ title: b.title, start: new Date(`${sug.day}T${b.start}:00`).toISOString(), end: new Date(`${sug.day}T${b.end}:00`).toISOString(), description: 'Planned with your coach in Life System' }).then(() => true).catch(() => false)
        if (ok) made++
      }
      await answer(made ? `${made} blocks added` : 'Calendar failed')
      const text = `${esc(String(cq.message?.text ?? ''))}\n\n✅ ${made} block${made === 1 ? '' : 's'} in your Google Calendar. When one starts, I'll be here: /focus 50`
      await edit(text)
      return text
    }
  },
  // How a focus session went (1–5); a low one asks what got in the way.
  {
    prefixes: ['fq'],
    match: (data) => data.startsWith('fq|'),
    run: async (c, t) => {
      const { mirror } = c
      const { data, key, cq, answer, edit } = t
      const [, day, n, minutes] = data.split('|')
      const fresh = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return false
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        setSetting(db as any, RATINGS, JSON.stringify([...focusRatings(db), { day, rating: Number(n), minutes: Number(minutes) || 0 }].slice(-60)))
        return true
      })
      if (!fresh) return null
      const r = Number(n)
      await answer(`${n}/5 noted`)
      const base = esc(String(cq.message?.text ?? '').replace(/\n*(And )?[Hh]ow did it go\?\s*$/, ''))
      const low = r <= 2
      const text = `${base}\n\n${low ? `Session: <b>${r}/5</b>. What got in the way? Tap it, and next time we fix that first.` : r === 3 ? 'Session: <b>3/5</b>. Fine. Next one: phone in another room for the first 10 minutes.' : `Session: <b>${r}/5</b> 🔥 That's the feeling. Same time tomorrow?`}`
      const keyboard = low ? { inline_keyboard: [REASONS.slice(0, 3), REASONS.slice(3)].map((row, k) => row.map((x, i) => ({ text: x, callback_data: `pr|${day}|${k * 3 + i}` }))) } : undefined
      await edit(text, keyboard)
      return text
    }
  },
  // HD: your reminder's buttons: Done, or again in 10 minutes / an hour (the island's card is the same reminder).
  {
    prefixes: ['rm'],
    match: (data) => data.startsWith('rm|'),
    run: async (c, t) => {
      const { mirror, markSeen } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const [, op, id] = data.split('|')
      const now = Date.now()
      const minutes = op === 'h' ? 60 : 10
      const found = await mirror.write((db) => {
        let list: Reminder[] = []
        try {
          list = JSON.parse(getSetting(db as any, REMINDERS) || '[]')
        } catch {
          list = []
        }
        if (!list.some((r) => r.id === id)) return false
        setSetting(db as any, REMINDERS, JSON.stringify(op === 'd' ? reminderDone(list, id, now) : reminderSnooze(list, id, minutes, now)))
        return true
      })
      const text = !found ? 'That reminder is already gone.' : op === 'd' ? '✓ Done.' : `⏰ Again at ${new Date(now + minutes * 60_000).toTimeString().slice(0, 5)}.`
      await answer(text)
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      return text
    }
  },
  // Coach nudges: pause them for today, or snooze 30 minutes.
  {
    prefixes: ['np', 'ns'],
    match: (data) => data.startsWith('np|') || data.startsWith('ns|'),
    run: async (c, t) => {
      const { mirror, services } = c
      const { data, chat, update, cq, answer } = t
      const pause = data.startsWith('np|')
      await mirror.write((db) => {
        let st: NudgeState = {}
        try {
          st = JSON.parse(getSetting(db as any, NUDGES) || '{}')
        } catch {
          st = {}
        }
        const now = new Date()
        const today = services.services(db).wallet.today(now)
        setSetting(db as any, NUDGES, JSON.stringify(pause ? { ...st, pausedDay: today } : { ...st, snoozeUntil: new Date(now.getTime() + 30 * 60000).toISOString() }))
      })
      const text = pause ? '⏸ Nudges paused for today. Back tomorrow.' : '😴 OK, I\'ll check again in 30 minutes.'
      await answer(text)
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
  },
  // ✕ Drop it, under a block Ben moved: off the calendar for today.
  {
    prefixes: ['bd'],
    match: (data) => data.startsWith('bd|'),
    run: async (c, t) => {
      const { mirror, calendar, markSeen } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const arg = data.slice(3)
      // New buttons carry the event id; older ones a position in the moved list.
      const id = /^\d{1,3}$/.test(arg)
        ? await mirror.read((db) => {
            try {
              return (JSON.parse(getSetting(db as any, 'coach_rhythm') || 'null')?.moved ?? [])[Number(arg)] as string | undefined
            } catch {
              return undefined
            }
          })
        : arg
      let ok = false
      if (id && calendar?.remove) {
        const day = new Date()
        const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString()
        const ev = (await calendar.events(from, new Date(Date.parse(from) + 86400000).toISOString()).catch(() => [])).find((e) => e.id === id)
        if (ev) ok = await calendar.remove(ev.calendarId, ev.id).then(() => true).catch(() => false)
      }
      const text = ok ? '✕ Dropped for today. Your calendar is up to date.' : 'Could not find that block anymore; it may already be gone.'
      await answer(ok ? 'Dropped' : 'Not found')
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
  },
  // W15: a stake Ben suggested, made only now that you said yes (settles by the focus log, W16).
  {
    prefixes: ['sg'],
    match: (data) => data.startsWith('sg|'),
    run: async (c, t) => {
      const { mirror, markSeen } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const subject = data.slice(3) || 'Focus'
      const s = suggestStake(subject, new Date())
      await mirror.write((db) => {
        const d = loadDesk(db)
        saveDesk(db, { ...d, stakes: addStake(d.stakes, s.text, s.due, s.points, new Date(), s.proof) })
      })
      const text = `🎯 Deal: ${s.text}. ${s.points} points on it. It settles by itself when the focus log shows the 25 minutes.`
      await answer('Stake set')
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
  },
  // W2: a block that hasn't started → the next free time today.
  {
    prefixes: ['bx'],
    match: (data) => data.startsWith('bx|'),
    run: async (c, t) => {
      const { calendar, markSeen } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const id = data.slice(3)
      let text = 'Could not find that block anymore; it may already be gone.'
      if (calendar?.move) {
        const day = new Date()
        const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString()
        const evs = await calendar.events(from, new Date(Date.parse(from) + 86400000).toISOString()).catch(() => [] as CalEvent[])
        const ev = evs.find((e) => e.id === id)
        if (ev) {
          const len = Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 60000)
          const dayKey = calendarDay(day)
          const slot = nextSlot(evs.filter((e) => e.id !== id), dayKey, day.toTimeString().slice(0, 5), len)
          if (slot && (await calendar.move(ev.calendarId, ev.id, new Date(`${dayKey}T${slot.start}:00`).toISOString(), new Date(`${dayKey}T${slot.end}:00`).toISOString()).then(() => true).catch(() => false))) text = `↪️ ${ev.title} → ${slot.start}–${slot.end}, your next free time.`
          else if (!slot) text = 'No free time left today for it. Drop it, or tell me where it goes.'
        }
      }
      await answer('Moved')
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
  },
  // Ben 2: a push's buttons: 10 min later / Skip / Got it on a check-in or the brief,
  // Plan my day, and Tomorrow / Drop / Keep today on the evening shutdown's items.
  // The answer is saved in the shared log, so the island knows it too.
  {
    prefixes: ['bp'],
    match: (data) => data.startsWith('bp|'),
    run: async (c, t) => {
      const { mirror, services, todoist, markSeen, sendProposal } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const r = readPushCallback(data)
      if (!r) return null
      const now = Date.now()
      const day = await mirror.read((db) => services.services(db).wallet.today())
      const clear = () => tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      if (r.op === 'plan') {
        await answer('Planning your day…')
        await mirror.write((db) => answerPushIn(db, day, r.ref, 'plan', now))
        return sendProposal(update.__token, chat)
      }
      if (r.op === 'later' || r.op === 'skip' || r.op === 'ok') {
        await mirror.write((db) => answerPushIn(db, day, r.ref, r.op, now, 10))
        const text = r.op === 'later' ? '⏰ OK, I’ll ask again in 10 min.' : r.op === 'skip' ? 'Skipped for today.' : '👍'
        await answer(text)
        await clear()
        return text
      }
      // Tomorrow / Drop / Keep today: the item by its number on tonight's list (or * for all left).
      const log = await mirror.read((db) => readPushLog(db, day))
      const items = log.shutdown?.items ?? []
      const id = r.ref === '*' ? '*' : items[Number(r.ref)]?.id
      if (!id) {
        await answer('That list is from another day')
        return null
      }
      const tomorrow = new Date(`${day}T12:00:00Z`)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      const line = await applyMark(
        {
          day,
          tomorrow: tomorrow.toISOString().slice(0, 10),
          write: (fn) => mirror.write((db) => fn(db, services.services(db))),
          todoist: todoist ? { update: todoist.update?.bind(todoist), quickAdd: (text: string) => todoist.quickAdd(text) } : null
        },
        id,
        r.op as 'tomorrow' | 'drop' | 'keep'
      )
      await answer(line.slice(0, 190))
      // The rows left: only the items not sorted yet.
      const after = await mirror.read((db) => readPushLog(db, day))
      const marks = after.shutdown?.marks ?? {}
      const rows = items.map((x, k) => ({ x, k })).filter(({ x }) => !marks[x.id]).map(({ k }) => [{ text: `${k + 1}. ➡️ Tomorrow`, callback_data: `bp|t|${k}` }, { text: '✗ Drop', callback_data: `bp|d|${k}` }, { text: 'Keep today', callback_data: `bp|k|${k}` }])
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: rows.length > 1 ? [[{ text: 'All to tomorrow', callback_data: 'bp|t|*' }], ...rows] : rows } }).catch(() => null)
      return line
    }
  },
  // W1: "Rescue my day": the rest of today shrunk to fit (recomputed now, so it's current).
  {
    prefixes: ['rs'],
    match: (data) => data.startsWith('rs|'),
    run: async (c, t) => {
      const { calendar, markSeen } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      if (data !== 'rs|a') {
        await answer('Kept as is')
        return 'kept'
      }
      const lines: string[] = []
      if (calendar?.move) {
        const now = new Date()
        const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        const evs = await calendar.events(from, new Date(Date.parse(from) + 86400000).toISOString()).catch(() => [] as CalEvent[])
        const end = new Date(now)
        end.setHours(22, 0, 0, 0)
        const r = rescueFromEvents(evs, now.getTime(), end.getTime())
        for (const mv of r.moves) {
          const ev = evs.find((e) => e.id === mv.id)
          if (!ev || mv.action === 'keep') continue
          const s = mv.action === 'tomorrow' ? Date.parse(ev.start) + 86400000 : mv.start!
          const e = mv.action === 'tomorrow' ? Date.parse(ev.end) + 86400000 : mv.end!
          const ok = await calendar.move(ev.calendarId, ev.id, new Date(s).toISOString(), new Date(e).toISOString()).then(() => true).catch(() => false)
          if (ok) lines.push(mv.action === 'tomorrow' ? `➡️ ${ev.title} → tomorrow` : `${mv.action === 'shrink' ? '✂️' : '↪️'} ${ev.title} ${new Date(s).toTimeString().slice(0, 5)}–${new Date(e).toTimeString().slice(0, 5)}`)
        }
      }
      const text = lines.length ? `🛟 Done. The rest of today:\n${lines.join('\n')}` : 'Nothing needed moving.'
      await answer('Rescued')
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
  },
  // A block missed twice → the same time tomorrow (K3).
  {
    prefixes: ['bt'],
    match: (data) => data.startsWith('bt|'),
    run: async (c, t) => {
      const { calendar, markSeen } = c
      const { data, chat, key, update, cq, answer } = t
      if (!(await markSeen(key))) return null
      const id = data.slice(3)
      let ok = false
      if (calendar?.move) {
        const day = new Date()
        const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString()
        const ev = (await calendar.events(from, new Date(Date.parse(from) + 86400000).toISOString()).catch(() => [])).find((e) => e.id === id)
        if (ev) ok = await calendar.move(ev.calendarId, ev.id, new Date(Date.parse(ev.start) + 86400000).toISOString(), new Date(Date.parse(ev.end) + 86400000).toISOString()).then(() => true).catch(() => false)
      }
      const text = ok ? '📅 Moved to tomorrow, same time.' : 'Could not find that block anymore; it may already be gone.'
      await answer(ok ? 'Tomorrow' : 'Not found')
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
      await tg(update.__token, 'sendMessage', { chat_id: chat, text }).catch(() => null)
      return text
    }
  },
  // How you slept (1–5), under the wake-up message.
  {
    prefixes: ['sq'],
    match: (data) => data.startsWith('sq|'),
    run: async (c, t) => {
      const { mirror, services } = c
      const { data, key, cq, answer, edit } = t
      const [, day, n] = data.split('|')
      const res = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return null
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        try {
          const svc = services.services(db)
          svc.sleep.setQuality(day, Number(n))
          return { tip: sleepTip(Number(n), svc.sleep.bedtimeTarget()) }
        } catch (e) {
          return { tip: '', error: (e as Error).message }
        }
      })
      if (!res) return null
      await answer(res.error ?? `Sleep ${n}/5 noted`)
      if (res.error) return null
      // Telegram gives the message back as plain text: escape it, then add ours.
      const text = `${esc(String(cq.message?.text ?? '').replace(/\n*😴 How did you sleep\?\s*$/, ''))}\n\n😴 Sleep: <b>${n}/5</b>. ${res.tip}`
      await edit(text)
      return text
    }
  },
  // ▶ start a 50-minute session on a subject / ⏹ stop the running one.
  {
    prefixes: ['fo', 'fx'],
    match: (data) => data.startsWith('fo|') || data.startsWith('fx|'),
    run: async (c, t) => {
      const { mirror, services, flushFocus, focusEnded } = c
      const { data, chat, key, update, answer, edit } = t
      const res = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return null
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        const f = services.services(db).focus
        try {
          if (data.startsWith('fo|')) {
            // "fo|Subject" (50 min) or "fo|25|Subject" (a coach button with its own length).
            const m = /^fo\|(\d{1,3})\|(.*)$/.exec(data)
            const minutes = m ? Math.min(180, Math.max(5, Number(m[1]))) : 50
            const subject = (m ? m[2] : data.slice(3)) || 'Focus'
            const plan = f.plan(services.services(db).wallet.today())
            const item = plan.items.find((p) => !p.done && p.text.startsWith(subject))
            f.start(subject, minutes, new Date(), item ? { kind: 'mustdo', ref: item.text, title: item.text } : null)
            return { text: `⏱ <b>Focus started:</b> ${esc(item?.text ?? subject)} · ${minutes} min.\nPhone away. Tap Stop when you finish.`, keyboard: STOP_KEYBOARD, toast: 'Focus started' }
          }
          const r = f.stop()
          focusEnded.push({ subject: r.session.subject, minutes: r.session.minutes })
          const out = stoppedReply(r, f.plan(services.services(db).wallet.today()))
          return { text: out.reply, keyboard: out.keyboard, toast: r.coins ? `+${r.coins} points` : 'Logged' }
        } catch (e) {
          return { text: '', keyboard: undefined, toast: (e as Error).message.slice(0, 190) }
        }
      })
      if (!res) return null
      await answer(res.toast)
      if (!res.text) return null
      // A start sends a new message (the coach's stays); a stop edits the timer message.
      if (data.startsWith('fo|')) await tg(update.__token, 'sendMessage', { chat_id: chat, text: res.text, parse_mode: 'HTML', reply_markup: res.keyboard }).catch(() => null)
      else await edit(res.text, res.keyboard)
      await flushFocus()
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-focus-changed'))
      return res.text
    }
  },
  // Everything else: a must-do tick or a "what got in the way" (p…), or a money card button (f…).
  {
    prefixes: ['pp', 'pr', 'fa', 'fb', 'fc', 'fk', 'fs', 'fu'],
    match: () => true,
    run: async (c, t) => {
      const { mirror, services, onExpense } = c
      const { data, chat, key, update, cq, answer } = t
      const res = await mirror.write((db) => {
        if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return null
        db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
        const svc = services.services(db)
        if (data.startsWith('p')) {
          // pp|day|i ticks a must-do; pr|day|n marks what got in the way
          const [kind, day, n] = data.split('|')
          return db.transaction(() => {
            let toast = ''
            if (kind === 'pp') {
              const r = svc.focus.togglePlan(Number(n), new Date(), day)
              toast = r.coins ? `+${r.coins} points` : '✓'
            } else {
              const reason = REASONS[Number(n)]
              const cur = svc.focus.plan(day).reasons
              svc.focus.review(null, cur.includes(reason) ? cur.filter((x) => x !== reason) : [...cur, reason], new Date(), day)
              toast = 'Noted'
            }
            const plan = svc.focus.plan(day)
            // From a session rating ("What got in the way?"): keep that message, note the reason.
            if (kind === 'pr' && String(cq.message?.text ?? '').includes('What got in the way?')) {
              const reason = REASONS[Number(n)]
              return { text: `${esc(String(cq.message?.text ?? '').replace(/What got in the way\?[\s\S]*$/, ''))}Noted: <b>${esc(reason)}</b>. The coach will help you fix that first next time.`, keyboard: undefined, toast }
            }
            const evening = /Evening review|Day review/.test(String(cq.message?.text ?? ''))
            const focusMin = svc.focus.state().todayMin
            return { text: evening ? eveningText(plan, focusMin) : planText(plan), keyboard: planKeyboard(plan, evening), toast }
          })()
        }
        return db.transaction(() => {
          const r = moneyButton(db as any, data, svc.wallet.today())
          // Undo removes it from Life System's spending log too.
          const life = r && data.startsWith('fu|') ? takeLink(db, data.split('|')[1]) : null
          if (life) {
            try {
              svc.money.deleteExpense(life)
            } catch {
              /* already deleted */
            }
          }
          return r
        })()
      })
      if (!res) return null
      await answer(res.toast)
      await tg(update.__token, 'editMessageText', {
        chat_id: chat,
        message_id: cq.message.message_id,
        text: res.text,
        parse_mode: 'HTML',
        ...(res.keyboard ? { reply_markup: res.keyboard } : {})
      }).catch(() => null)
      if (data.startsWith('fu|') || data.startsWith('fa|') || data.startsWith('fk|') || data.startsWith('fs|')) onExpense?.()
      return res.text
    }
  }
]

/** Runs one tap through the table. */
export function runCallback(c: BotContext, t: Tap): Promise<string | null> {
  const h = CALLBACKS.find((x) => x.match(t.data))!
  return h.run(c, t)
}
