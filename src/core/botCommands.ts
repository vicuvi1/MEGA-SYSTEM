export type BotCommandType =
  | 'today'
  | 'checkin'
  | 'oath'
  | 'workout'
  | 'expense'
  | 'tasks'
  | 'done'
  | 'wake'
  | 'bed'
  | 'crush'
  | 'help'
  | 'vault'
  | 'goals'
  | 'unknown'

export interface ParsedCommand {
  type: BotCommandType
  args: string[]
  raw: string
  exerciseName?: string
  exerciseAmount?: number
  expenseAmount?: number
  expenseCategory?: string
  expenseNote?: string
  taskIndex?: number
}

export function parseTelegramText(text: string): ParsedCommand {
  const trimmed = (text || '').trim()
  if (!trimmed) {
    return { type: 'unknown', args: [], raw: '' }
  }

  const parts = trimmed.split(/\s+/)
  let cmd = parts[0].toLowerCase()
  if (cmd.startsWith('/')) {
    cmd = cmd.slice(1)
  }
  // Strip bot handle like /today@LifeSystemBot
  if (cmd.includes('@')) {
    cmd = cmd.split('@')[0]
  }

  const args = parts.slice(1)

  // 1. Direct exercise shortcuts like /pushups 50 or /pullups 20
  const exerciseShortcuts: Record<string, string> = {
    pushups: 'pushups',
    pullups: 'pullups',
    squats: 'squats',
    dips: 'dips',
    plank: 'plank',
    running: 'running'
  }
  if (exerciseShortcuts[cmd]) {
    const amount = parseInt(args[0], 10) || 20
    return {
      type: 'workout',
      args,
      raw: trimmed,
      exerciseName: exerciseShortcuts[cmd],
      exerciseAmount: amount
    }
  }

  // 2. Standard commands
  if (cmd === 'start' || cmd === 'help' || cmd === 'commands') {
    return { type: 'help', args, raw: trimmed }
  }

    if (cmd === 'vault' || cmd === 'economy') {
    return { type: 'vault', args, raw: trimmed }
  }

  if (cmd === 'goals' || cmd === 'wishlist') {
    return { type: 'goals', args, raw: trimmed }
  }

  if (cmd === 'today' || cmd === 'status' || cmd === 'stat') {
    return { type: 'today', args, raw: trimmed }
  }

  if (cmd === 'checkin' || cmd === 'clean') {
    return { type: 'checkin', args, raw: trimmed }
  }

  if (cmd === 'oath') {
    return { type: 'oath', args, raw: trimmed }
  }

  if (cmd === 'workout' || cmd === 'train') {
    // /workout 50 pushups  or /workout pushups 50
    let amount = 20
    let ex = 'pushups'
    if (args.length >= 2) {
      if (/^\d+$/.test(args[0])) {
        amount = parseInt(args[0], 10)
        ex = args[1].toLowerCase()
      } else {
        ex = args[0].toLowerCase()
        amount = parseInt(args[1], 10) || 20
      }
    } else if (args.length === 1) {
      if (/^\d+$/.test(args[0])) {
        amount = parseInt(args[0], 10)
      } else {
        ex = args[0].toLowerCase()
      }
    }
    return {
      type: 'workout',
      args,
      raw: trimmed,
      exerciseName: ex,
      exerciseAmount: amount
    }
  }

  if (cmd === 'expense' || cmd === 'buy' || cmd === 'spent' || cmd === 'pay') {
    // /expense 45 food lunch
    let amount = 0
    let cat = 'food'
    let note = ''
    if (args.length > 0) {
      amount = parseFloat(args[0]) || 0
      if (args.length > 1) {
        cat = args[1].toLowerCase()
        note = args.slice(2).join(' ')
      }
    }
    return {
      type: 'expense',
      args,
      raw: trimmed,
      expenseAmount: amount,
      expenseCategory: cat,
      expenseNote: note || undefined
    }
  }

  if (cmd === 'tasks' || cmd === 'todo') {
    return { type: 'tasks', args, raw: trimmed }
  }

  if (cmd === 'done' || cmd === 'tick' || cmd === 'complete') {
    const idx = parseInt(args[0], 10) || 1
    return { type: 'done', args, raw: trimmed, taskIndex: idx }
  }

  if (cmd === 'wake' || cmd === 'up') {
    return { type: 'wake', args, raw: trimmed }
  }

  if (cmd === 'bed' || cmd === 'sleep') {
    return { type: 'bed', args, raw: trimmed }
  }

  if (cmd === 'crush' || cmd === 'panic' || cmd === 'urge') {
    return { type: 'crush', args, raw: trimmed }
  }

  return { type: 'unknown', args, raw: trimmed }
}

export function formatHelpMessage(): string {
  return [
    `⚡ <b>Life System — Telegram Command Center</b> ⚡`,
    ``,
    `Control your habits, workouts, and wallet from your phone:`,
    ``,
    `📊 <b>Dashboard & Status</b>`,
    `• <code>/today</code> — View balance, level, streak & rituals`,
    `• <code>/vault</code> — Real-money Reward Vault surplus, coin valuation & multiplier
• <code>/goals</code> — Wishlist Mega Goals & savings progress
• <code>/tasks</code> — View open tasks for today`,
    `• <code>/done &lt;num&gt;</code> — Complete a task (e.g. <code>/done 1</code>)`,
    ``,
    `🛡️ <b>Discipline & Standard</b>`,
    `• <code>/checkin</code> — Log daily clean check-in (+20 🪙)`,
    `• <code>/oath</code> — Take morning oath (+3 🪙)`,
    `• <code>/panic</code> — Instant urge crusher emergency protocol`,
    ``,
    `💪 <b>Body & Workouts</b>`,
    `• <code>/workout &lt;reps&gt; &lt;exercise&gt;</code> — e.g. <code>/workout 50 pushups</code> (+10 🪙)`,
    `• <code>/pushups &lt;reps&gt;</code> — Quick log push-ups`,
    `• <code>/pullups &lt;reps&gt;</code> — Quick log pull-ups`,
    `• <code>/squats &lt;reps&gt;</code> — Quick log squats`,
    ``,
    `💳 <b>Money & Expenses</b>`,
    `• <code>/expense &lt;amount&gt; &lt;category&gt; [note]</code>`,
    `  e.g. <code>/expense 45 food lunch</code> (+3 🪙)`,
    ``,
    `🌙 <b>Sleep & Wake</b>`,
    `• <code>/wake</code> — Log on-time morning check-in (+10 🪙)`,
    `• <code>/bed</code> — Log bedtime check-in (+5 🪙)`
  ].join('\n')
}

export function formatTodayStatus(data: {
  balance: number
  level: number
  rank: string
  totalXp: number
  ritualsDone: number
  totalRituals: number
  cleanStreak: number
  workoutStreak: number
  tasksLeft: number
}): string {
  return [
    `👑 <b>Life System Status</b>`,
    ``,
    `🪙 <b>Balance:</b> ${data.balance} coins`,
    `⭐ <b>Level:</b> ${data.level} (${data.rank}) · ${data.totalXp} XP`,
    `🔥 <b>Clean Streak:</b> ${data.cleanStreak} days`,
    `💪 <b>Workout Streak:</b> ${data.workoutStreak} days`,
    `⚡ <b>Daily Rituals:</b> ${data.ritualsDone}/${data.totalRituals} completed today`,
    `📋 <b>Tasks Remaining:</b> ${data.tasksLeft} open tasks`,
    ``,
    data.ritualsDone === data.totalRituals
      ? `🏆 <i>All daily rituals complete! Supreme focus today.</i>`
      : `<i>Use /checkin, /workout or /expense to log today wins.</i>`
  ].join('\n')
}

export function formatWorkoutResponse(exName: string, amount: number, streak: number, coins: number): string {
  return [
    `💪 <b>Workout Recorded!</b>`,
    ``,
    `• <b>Exercise:</b> ${amount} ${exName}`,
    `• <b>Reward:</b> +${coins} coins · +25 XP`,
    `• <b>Workout Streak:</b> ${streak} days in a row!`,
    ``,
    `<i>The iron never lies. Keep pushing forward!</i>`
  ].join('\n')
}

export function formatExpenseResponse(
  amountFormatted: string,
  category: string,
  note: string | null,
  remainingBudget: string,
  coinsAwarded: number
): string {
  const parts = [
    `💳 <b>Expense Recorded</b>`,
    ``,
    `• <b>Amount:</b> ${amountFormatted}`,
    `• <b>Category:</b> ${category}${note ? ` (${note})` : ''}`,
    `• <b>Daily Budget Left:</b> ${remainingBudget}`
  ]
  if (coinsAwarded > 0) {
    parts.push(`• <b>Reward:</b> +${coinsAwarded} coins (first log of the day)`)
  }
  return parts.join('\n')
}

export function formatCleanCheckinResponse(streak: number, coins: number): string {
  return [
    `🛡️ <b>Clean Day Affirmed!</b>`,
    ``,
    `• <b>Current Streak:</b> ${streak} days clean!`,
    `• <b>Reward:</b> +${coins} coins · +40 XP`,
    ``,
    `<i>"Stand fast, keep the standard, give today everything."</i>`
  ].join('\n')
}

export function formatUrgeResponse(): string {
  return [
    `🚨 <b>URGE CRUSHER ACTIVATED</b> 🚨`,
    ``,
    `<b>STOP. DO NOT NEGOTIATE.</b>`,
    `1. Stand up from where you are immediately.`,
    `2. Take 5 slow, deep breaths through your nose.`,
    `3. Drop to the floor and do 20 push-ups right now.`,
    `4. Splash cold water on your face.`,
    ``,
    `<i>A few seconds of temporary comfort is not worth your self-respect and progress. You are stronger than any momentary impulse. STAND FAST!</i>`
  ].join('\n')
}
