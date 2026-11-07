// The bots' slash commands and plain one-liners (LT6: split out of
// webBots.ts): /focus /stop /plan /fun /week /review, and /help /today
// /checkin /oath /workout /weight /expense /balance /wake /spent /bed /tasks
// /done /vault /goals /crush. Each runs on the services of one database
// change; what changed comes back in RunOut for the caller to finish.
import { whyText, WHY_KEY, type WhyEntry } from '@core/benWhy'
import { formatBalanceResponse, formatCleanCheckinResponse, formatExpenseResponse, formatHelpMessage, formatMetricResponse, formatSportResponse, formatSportStatusResponse, formatTodayStatus, formatUrgeResponse, formatWorkoutResponse, parseTelegramText } from '@core/botCommands'
import { addDays } from '@core/dates'
import { formatMoney } from '@core/money'
import { getSetting } from '../../../../main/settings'
import { hm, parsePlan } from '@core/focus'
import { goalsText, planKeyboard, planText, weekText } from '@core/focusBot'
import type { Services } from '../webServices'
import { answerLocal, financeStateFrom } from '../botBrain'
import { esc } from './telegram'
import { sleepKeyboard, STOP_KEYBOARD, stoppedReply, ruleCoins } from './helpers'
import { setsText } from '@core/sportSets'

const store = typeof localStorage !== 'undefined' ? localStorage : null

export type RunOut = { reply: string; keyboard?: any; sport?: { name: string; amount: number }; expense?: { amount: number; category: string; note: string; type?: 'expense' | 'income' }; unknown?: boolean }

/**
 * Finance Helper's accounts, for /balance (own currency each): this device's
 * copy, else the backup Finance Helper keeps in Turso (the server has no device).
 */
function financeAccounts(db?: any): { name: string; balanceMdl: number; currency: string }[] {
  try {
    const raw = store?.getItem('finance-helper.state') || (db ? getSetting(db, 'finance_backup_json') : null)
    const st = JSON.parse(raw || 'null')
    const accounts: any[] = st?.settings?.accounts ?? []
    const tx: any[] = Array.isArray(st?.tx) ? st.tx : []
    return accounts
      .filter((a) => !a.archived)
      .map((a) => {
        let bal = Number(a.start) || 0
        for (const t of tx) {
          if (t.type === 'income' && t.account === a.id) bal += Number(t.amount) || 0
          else if (t.type === 'expense' && t.account === a.id) bal -= Number(t.amount) || 0
          else if (t.type === 'transfer') {
            if (t.from === a.id) bal -= Number(t.amount) || 0
            if (t.to === a.id) bal += Number(t.toAmount ?? t.amount) || 0
          }
        }
        return { name: String(a.name), balanceMdl: Math.round(bal) / 100, currency: a.currency || st?.settings?.currency || 'MDL' }
      })
  } catch {
    return []
  }
}

/** /focus, /stop, /plan, /fun, /week, /deadlines (focus.ts). */
export function runFocus(s: Services, text: string, focusEnded: { subject: string; minutes: number }[]): RunOut | null {
  const m = /^\/(focus|stop|plan|fun|week|deadlines|review)(?:@\w+)?(?:\s+([\s\S]+))?$/i.exec(text.trim())
  if (!m) return null
  const cmd = m[1].toLowerCase()
  const arg = (m[2] ?? '').trim()
  const f = s.focus
  if (cmd === 'focus') {
    const st = f.state()
    if (!arg) {
      if (st.running) {
        const min = Math.round((Date.now() - Date.parse(st.running.startedAt)) / 60000)
        return { reply: `⏱ <b>Focusing on ${esc(st.running.subject)}</b>: ${min} of ${st.running.planned} min.\nSend <code>/stop</code> when you're done.` }
      }
      return { reply: `⏱ Today: <b>${hm(st.todayMin)}</b> of focus.\nStart one: <code>/focus 50 math</code>` }
    }
    const minutes = Number(/\b(\d{1,3})\b/.exec(arg)?.[1] ?? 50)
    const subject = arg.replace(/\b\d{1,3}\s*(min|m)?\b/i, '').trim() || st.subjects[0] || 'Focus'
    f.start(subject, minutes)
    return { reply: `⏱ <b>Focus started:</b> ${esc(subject)} · ${minutes} min.\nPhone away. Tap Stop (or send <code>/stop</code>) when you finish.`, keyboard: STOP_KEYBOARD }
  }
  if (cmd === 'stop') {
    const r = f.stop()
    focusEnded.push({ subject: r.session.subject, minutes: r.session.minutes })
    return stoppedReply(r, f.plan(s.wallet.today()))
  }
  if (cmd === 'plan') {
    if (arg) f.setPlan(parsePlan(arg))
    const plan = f.plan(s.wallet.today())
    return { reply: planText(plan, arg ? '📝 <b>Plan saved</b>' : undefined), keyboard: plan.items.length ? planKeyboard(plan, false) : undefined }
  }
  if (cmd === 'fun') {
    const minutes = Number(/\b(\d{1,3})\b/.exec(arg)?.[1] ?? 0)
    if (!minutes) return { reply: '🎮 How long? e.g. <code>/fun 30 youtube</code> (1 coin a minute)' }
    const what = arg.replace(/\b\d{1,3}\s*(min|m)?\b/i, '').trim() || 'Fun'
    const r = f.fun(minutes, what)
    return { reply: `🎮 <b>Enjoy ${minutes} min of ${esc(what)}</b> · −${r.cost} points (left: ${r.balance})` }
  }
  if (cmd === 'review') {
    if (!arg) return { reply: '📝 Send one line about today, e.g. <code>/review good focus, phone was the problem</code>' }
    const today = s.wallet.today()
    const cur = f.plan(today)
    f.review(cur.review ? `${cur.review}\n${arg}` : arg, cur.reasons)
    return { reply: '📝 <b>Saved.</b> Thanks: this is what makes next week better.' }
  }
  const st = f.state()
  if (cmd === 'week') return { reply: weekText(st.week, st.goals) }
  return { reply: goalsText(st.goals) }
}

/** One parsed command. `db`: the database of this change (Finance Helper's copy for /balance and /spent). */
export function runCommand(s: Services, parsed: ReturnType<typeof parseTelegramText>, text: string, env: { db: any }): RunOut {
  const currentDb = env.db
  switch (parsed.type) {
    case 'help':
      return { reply: formatHelpMessage() }
    case 'why': {
      let list: WhyEntry[] = []
      try {
        list = JSON.parse(getSetting(s.db as any, WHY_KEY) || '[]')
      } catch {
        list = []
      }
      return { reply: whyText(Array.isArray(list) ? list : []) }
    }
    case 'today': {
      const sum = s.wallet.summary()
      return {
        reply: formatTodayStatus({
          balance: sum.balance,
          level: sum.level.level,
          rank: sum.level.rank,
          totalXp: sum.totalXp,
          ritualsDone: sum.todayRules?.length ?? 0,
          totalRituals: 5,
          cleanStreak: s.discipline.state().current,
          workoutStreak: s.body.state().streak,
          tasksLeft: s.tasks.state().tasks.filter((t) => !t.done).length
        })
      }
    }
    case 'checkin': {
      const paid = s.discipline.checkIn()
      // The same "Day N" MAN and every screen show (dayNumber: P7).
      const st = s.discipline.state()
      return { reply: formatCleanCheckinResponse(st.day, paid.coins, paid.day, s.wallet.today()) }
    }
    case 'oath':
      s.discipline.oath()
      return { reply: '📜 <b>Morning Oath Affirmed!</b>\n\n<i>"I commit to purity, disciplined physical power, sharp financial focus, and daily relentless self-mastery."</i>\n\n+' + ruleCoins(s, 'discipline.oath', 3) + ' points!' }
    case 'workout': {
      const name = parsed.exerciseName || 'pushups'
      const amount = parsed.exerciseAmount || 20 // like the desktop: "/pushups" alone is 20
      const sets = parsed.exerciseSets
      const res = s.body.logWorkout({
        title: sets ? `${name} ${setsText(sets, parsed.exerciseUnit)}` : `${name} (+${amount})`,
        items: [{ exerciseId: name.toLowerCase(), name, amount, unit: parsed.exerciseUnit === 'sec' ? 'sec' : 'reps', ...(sets ? { sets: sets.map((reps) => ({ reps, weight: 0 })) } : {}) } as any],
        note: 'Logged via Telegram'
      })
      return { reply: formatWorkoutResponse(name, amount, res.state.streak, res.awarded ? ruleCoins(s, 'body.workout_done', 10) : 0) + (sets ? `\nSets: <b>${setsText(sets, parsed.exerciseUnit)}</b> · best set <b>${Math.max(...sets)}</b>` : ''), sport: { name, amount, ...(sets ? { sets } : {}) } }
    }
    case 'sport': {
      const name = parsed.exerciseName || 'Workout'
      const amount = parsed.exerciseAmount || 1
      const rawUnit = parsed.exerciseUnit || 'minutes'
      // 5 km stays 5 km, 500 m stays metres (X11).
      const unit = ['reps', 'kg', 'sets', 'km', 'm'].includes(rawUnit) ? rawUnit : 'minutes'
      const res = s.body.logWorkout({
        title: `${name} (${amount} ${rawUnit})`,
        items: [{ exerciseId: name.toLowerCase().replace(/\s+/g, '_'), name, amount, unit }],
        note: `Logged via Telegram (${amount} ${rawUnit})`
      })
      return { reply: formatSportResponse(name, amount, rawUnit, res.state.streak, res.awarded ? ruleCoins(s, 'body.workout_done', 10) : 0) }
    }
    case 'weight': {
      const w = parsed.metricWeight
      if (!w || w < 30 || w > 300) return { reply: '⚠️ Send a real weight, e.g. <code>/weight 74.5</code>.' }
      s.body.logMetric({ weight: w, note: 'Telegram' })
      return { reply: formatMetricResponse('weight', w, 'kg', 0, 0) }
    }
    case 'waist': {
      const w = parsed.metricWaist
      if (!w || w < 40 || w > 200) return { reply: '⚠️ Send a real waist size, e.g. <code>/waist 82</code>.' }
      s.body.logMetric({ waist: w, note: 'Telegram' })
      return { reply: formatMetricResponse('waist', w, 'cm', 0, 0) }
    }
    case 'sport_status':
    case 'pr': {
      const st = s.body.state()
      return { reply: formatSportStatusResponse({ streak: st.streak, totalWorkouts: st.totalWorkouts, thisWeek: st.workoutsThisWeek, latestWeight: st.latestWeight, latestWaist: st.latestWaist }) }
    }
    case 'expense': {
      const cents = Math.round((parsed.expenseAmount || 0) * 100)
      if (!(cents > 0)) return { reply: '⚠️ How much? e.g. <code>/expense 45 food lunch</code>' }
      const cat = parsed.expenseCategory || 'other'
      const note = parsed.expenseNote || ''
      // "+500 salary": money in. It goes to Finance Helper only (Life
      // System's spending log has no income), never as an expense.
      if (cat === 'income') {
        return {
          reply: `💰 <b>Income noted:</b> ${formatMoney(cents, 'MDL')}${note ? ` · ${esc(note)}` : ''}\n\nAdded to Finance Helper.`,
          expense: { amount: cents, category: 'income', note, type: 'income' as const }
        }
      }
      const res = s.money.addExpense(cents, cat, note ? `[Telegram] ${note}` : '[Telegram]', new Date(), true)
      const cur = res.state.currency || 'MDL'
      return {
        reply: formatExpenseResponse(formatMoney(cents, cur), cat, note || null, formatMoney(Math.max(0, res.state.today.remaining), cur), res.awarded ? 3 : 0),
        expense: { amount: cents, category: res.expense?.category ?? cat, note }
      }
    }
    case 'balance': {
      const coins = s.wallet.summary().balance
      const accounts = financeAccounts(currentDb)
      const money = s.money.state()
      return {
        reply: formatBalanceResponse({
          currency: 'MDL',
          walletCoins: coins,
          walletCoinsValueMdl: Math.round((coins / 10) * 100) / 100,
          vaultSurplusMdl: s.economy.getEconomySummary().vaultBalance,
          financeAccountsTotalMdl: accounts.filter((a) => a.currency === 'MDL').reduce((t, a) => t + a.balanceMdl, 0),
          financeAccounts: accounts,
          dailyBudgetLeftMdl: Math.max(0, money.today.remaining) / 100
        })
      }
    }
    case 'wake': {
      // "/wake" now, "/wake 06:40" (forgot to log it), "/wake yesterday 06:30".
      const time = parsed.args.find((a) => /^\d{1,2}[:.]\d{2}$/.test(a))?.replace('.', ':')
      const back = parsed.args.some((a) => /^(yesterday|ieri|вчера)$/i.test(a)) ? 1 : 0
      if (time || back) {
        if (!time) return { reply: '⏰ What time? e.g. <code>/wake yesterday 06:30</code>' }
        const day = addDays(s.wallet.today(), -back)
        const res = s.sleep.setWake(day, time)
        return { reply: `🌅 <b>Wake-up ${back ? 'for yesterday ' : ''}set</b>: ${res.log.wakeTime} (target ${res.log.wakeTarget})\n${res.awarded ? `🎯 On time! <b>+${ruleCoins(s, 'sleep.up_on_time', 10)} points</b>` : res.log.onTime ? (back ? 'On time · no points for past days.' : 'On time.') : 'Saved to your sleep history.'}` }
      }
      const res = s.sleep.logWake(new Date().toTimeString().slice(0, 5)) // local time (the server runs in your time zone)
      return {
        reply: `🌅 <b>Wake-up logged</b>: ${res.log.wakeTime}\n${res.awarded ? `🎯 On time! <b>+${ruleCoins(s, 'sleep.up_on_time', 10)} points</b>` : res.log.onTime ? 'On time.' : 'Saved to your sleep history.'}\n<i>Woke up earlier? Send</i> <code>/wake 06:40</code>\n\n😴 <b>How did you sleep?</b>`,
        keyboard: sleepKeyboard(res.log.day)
      }
    }
    case 'spent': {
      // Answered from Finance Helper's records, no AI needed.
      const today = s.wallet.today()
      const from = parsed.period === 'week' ? addDays(today, -6) : parsed.period === 'month' ? `${today.slice(0, 8)}01` : parsed.period === 'yesterday' ? addDays(today, -1) : today
      const to = parsed.period === 'yesterday' ? from : today
      const line = answerLocal(`spending ${from} ${to}`, { finance: financeStateFrom(currentDb, store), input: null as any, ledger: [], sessions: [] }) ?? 'No spending data yet.'
      const label = { today: 'Today', yesterday: 'Yesterday', week: 'The last 7 days', month: 'This month' }[parsed.period ?? 'today']
      return { reply: `💸 <b>${label}</b>\n${esc(line.replace(/^Spending [^:]+: /, ''))}` }
    }
    case 'bed': {
      // "bed 23:40" / "went to bed at 0:30": that time, else now.
      const at = parsed.args.find((a) => /^\d{1,2}:\d{2}$/.test(a))
      const res = s.sleep.logBed(at ?? new Date().toTimeString().slice(0, 5))
      return { reply: `🌙 <b>Bedtime logged</b>: ${res.log.bedTime}\n${res.awarded ? `🎯 On time! <b>+${ruleCoins(s, 'sleep.bed_on_time', 5)} points</b>` : 'Saved to your sleep history.'}` }
    }
    case 'tasks': {
      const open = s.tasks.state().tasks.filter((t) => !t.done).slice(0, 8)
      return {
        reply: open.length
          ? `📋 <b>Open tasks</b>\n\n${open.map((t, i) => `${i + 1}. [${esc(t.category)}] <b>${esc(t.title)}</b>`).join('\n')}\n\n<i>Done one? Send</i> <code>/done 1</code>`
          : '📋 <b>No open tasks.</b> All clear!'
      }
    }
    case 'done': {
      const open = s.tasks.state().tasks.filter((t) => !t.done)
      const num = parsed.taskIndex ?? parseInt(parsed.args[0], 10)
      const target = open.find((t) => t.id === num) ?? (num > 0 && num <= open.length ? open[num - 1] : undefined)
      if (!target) return { reply: '⚠️ No task with that number. Send <code>/tasks</code> to see them.' }
      s.tasks.complete(target.id)
      return { reply: `✅ Done: <b>${esc(target.title)}</b>` }
    }
    case 'vault': {
      const v = s.economy.getEconomySummary()
      return {
        reply: [
          '🏛️ <b>Reward vault</b>',
          '',
          `🪙 Points: <b>${v.coinsBalance}</b> (≈ ${v.coinsRealValue} ${v.currency})`,
          `💰 Vault: <b>${v.vaultBalance} ${v.currency}</b>`,
          `🔥 Multiplier: ${v.multiplier.label}`,
          v.pinnedGoal ? `🌟 Goal: ${esc(v.pinnedGoal.title)} (${v.pinnedGoal.allocatedCoins}/${v.pinnedGoal.targetCoins} points)` : ''
        ].filter(Boolean).join('\n')
      }
    }
    case 'goals': {
      const goals = s.economy.goals().filter((g: any) => !g.completed)
      return {
        reply: goals.length
          ? `🎯 <b>Goals</b>\n\n${goals.map((g: any, i: number) => `${i + 1}. ${g.pinned ? '⭐ ' : ''}<b>${esc(g.title)}</b> · ${g.allocatedCoins}/${g.targetCoins} points`).join('\n')}`
          : '🎯 No open goals. Add one in the Shop.'
      }
    }
    case 'crush':
      return { reply: formatUrgeResponse() }
    default:
      return { reply: `❓ I didn't understand <code>${esc(text.slice(0, 60))}</code>.\n\nSend <code>/help</code> for the list.`, unknown: true }
  }
}
