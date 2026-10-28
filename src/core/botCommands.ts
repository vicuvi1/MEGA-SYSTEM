export type BotCommandType =
  | 'today'
  | 'checkin'
  | 'oath'
  | 'workout'
  | 'sport'
  | 'weight'
  | 'waist'
  | 'pr'
  | 'sport_status'
  | 'expense'
  | 'tasks'
  | 'done'
  | 'wake'
  | 'bed'
  | 'crush'
  | 'help'
  | 'vault'
  | 'goals'
  | 'balance'
  | 'unknown'

export interface ParsedCommand {
  type: BotCommandType
  args: string[]
  raw: string
  exerciseName?: string
  exerciseAmount?: number
  exerciseUnit?: string
  metricWeight?: number
  metricWaist?: number
  prExercise?: string
  prValue?: string
  expenseAmount?: number
  expenseCategory?: string
  expenseNote?: string
  taskIndex?: number
}

function parseAmountAndUnit(str: string, defaultUnit = 'reps'): { amount: number; unit: string } {
  if (!str) return { amount: 1, unit: defaultUnit }
  const match = str.match(/^([\d.]+)\s*([a-zA-Z]*)$/)
  if (match) {
    const amount = parseFloat(match[1]) || 1
    let unit = (match[2] || defaultUnit).toLowerCase()
    if (unit === 'k' || unit === 'km' || unit === 'kms') unit = 'km'
    else if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes') unit = 'minutes'
    else if (unit === 'sec' || unit === 'secs' || unit === 's') unit = 'seconds'
    else if (unit === 'kg' || unit === 'kgs') unit = 'kg'
    else if (unit === 'r' || unit === 'rep' || unit === 'reps') unit = 'reps'
    return { amount, unit }
  }
  const fallback = parseFloat(str)
  return { amount: isNaN(fallback) ? 1 : fallback, unit: defaultUnit }
}


export function detectExpenseCategory(text: string): string {
  const t = text.toLowerCase()
  if (/\b(coffee|cafe|cafea|cappuccino|tea|ceai|lunch|pranz|dinner|cina|breakfast|dejun|groceries|alimente|market|magazin|lidl|kaufland|linella|supermarket|food|mancare|mcdonalds|kfc|pizza|burger|shawarma|kebab|restaurant|bar|bere|beer|snack|water|apa)\b/i.test(t)) {
    return 'food'
  }
  if (/\b(taxi|cab|uber|bolt|yandex|bus|troleibuz|autobuz|gas|benzina|fuel|motorina|car|auto|parking|parcare|metro|train|tren|transit|transport)\b/i.test(t)) {
    return 'transport'
  }
  if (/\b(rent|chirie|bills|facturi|utilitati|gaz|lumina|electricitate|net|internet|wifi|moldtelecom|orange|clean|cleaning|intretinere|home|casa)\b/i.test(t)) {
    return 'home'
  }
  if (/\b(gym|sala|fitness|workout|protein|proteina|creatine|sport|echipament|antrenament)\b/i.test(t)) {
    return 'sport'
  }
  if (/\b(farmacie|pharmacy|pastile|medic|doctor|dentist|stomatolog|medicina|vitamine|spital|clinic|health|sanatate)\b/i.test(t)) {
    return 'health'
  }
  if (/\b(movie|cinema|cineplex|game|steam|netflix|party|concert|club|fun|joc|distractie)\b/i.test(t)) {
    return 'fun'
  }
  if (/\b(haine|clothes|shoes|pantofi|adibas|adadasi|mall|zara|bershka|shopping)\b/i.test(t)) {
    return 'clothes'
  }
  if (/\b(salary|salariu|freelance|venit|bonus|profit|dividend|cash|income)\b/i.test(t)) {
    return 'income'
  }
  return 'other'
}

export function tryParseNaturalExpense(text: string): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('/')) return null

  // Pattern A: Amount first: e.g. "35 coffee", "35.50 lunch with alex", "+500 salary", "45 lei pizza", "120 mdl groceries"
  const amountFirstMatch = trimmed.match(/^([+-]?\s*\d+(?:[.,]\d+)?)\s*(?:mdl|lei|\$|€)?\s+(.+)$/i)
  if (amountFirstMatch) {
    const rawAmt = amountFirstMatch[1].replace(/\s+/g, '').replace(',', '.')
    const amt = parseFloat(rawAmt)
    const note = amountFirstMatch[2].replace(/\b(lei|mdl|\$|€)\b/gi, '').trim()
    if (!isNaN(amt) && amt > 0 && note.length > 0) {
      const cat = rawAmt.startsWith('+') ? 'income' : detectExpenseCategory(note)
      return {
        type: 'expense',
        args: [String(amt), cat, note],
        raw: trimmed,
        expenseAmount: amt,
        expenseCategory: cat,
        expenseNote: note
      }
    }
  }

  // Pattern B: Note first, amount last: e.g. "coffee 35", "taxi 50", "lunch with alex 120", "groceries 250 lei", "freelance +1000"
  const noteFirstMatch = trimmed.match(/^(.+?)\s+([+-]?\s*\d+(?:[.,]\d+)?)\s*(?:mdl|lei|\$|€)?$/i)
  if (noteFirstMatch) {
    const note = noteFirstMatch[1].replace(/\b(lei|mdl|\$|€)\b/gi, '').trim()
    const rawAmt = noteFirstMatch[2].replace(/\s+/g, '').replace(',', '.')
    const amt = parseFloat(rawAmt)
    if (!isNaN(amt) && amt > 0 && note.length > 0) {
      const cat = rawAmt.startsWith('+') ? 'income' : detectExpenseCategory(note)
      return {
        type: 'expense',
        args: [String(amt), cat, note],
        raw: trimmed,
        expenseAmount: amt,
        expenseCategory: cat,
        expenseNote: note
      }
    }
  }

  return null
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
    plank: 'plank'
  }
  if (exerciseShortcuts[cmd]) {
    const amount = parseInt(args[0], 10) || 20
    return {
      type: 'workout',
      args,
      raw: trimmed,
      exerciseName: exerciseShortcuts[cmd],
      exerciseAmount: amount,
      exerciseUnit: 'reps'
    }
  }

  // 2. Direct sport shortcuts
  const sportDirectShortcuts: Record<string, { name: string; defaultUnit: string }> = {
    run: { name: 'Running', defaultUnit: 'km' },
    running: { name: 'Running', defaultUnit: 'km' },
    football: { name: 'Football', defaultUnit: 'minutes' },
    soccer: { name: 'Football', defaultUnit: 'minutes' },
    boxing: { name: 'Boxing', defaultUnit: 'minutes' },
    combat: { name: 'Combat Sports', defaultUnit: 'minutes' },
    gym: { name: 'Gym Session', defaultUnit: 'minutes' },
    swim: { name: 'Swimming', defaultUnit: 'm' },
    swimming: { name: 'Swimming', defaultUnit: 'm' },
    cycling: { name: 'Cycling', defaultUnit: 'km' },
    bike: { name: 'Cycling', defaultUnit: 'km' },
    bench: { name: 'Bench Press', defaultUnit: 'kg' }
  }
  if (sportDirectShortcuts[cmd]) {
    const spec = sportDirectShortcuts[cmd]
    const parsed = parseAmountAndUnit(args[0], spec.defaultUnit)
    return {
      type: 'sport',
      args,
      raw: trimmed,
      exerciseName: spec.name,
      exerciseAmount: parsed.amount,
      exerciseUnit: parsed.unit
    }
  }

  // 3. Body metric shortcuts
  if (cmd === 'weight') {
    const parsed = parseAmountAndUnit(args[0], 'kg')
    return {
      type: 'weight',
      args,
      raw: trimmed,
      metricWeight: parsed.amount
    }
  }

  if (cmd === 'waist') {
    const parsed = parseAmountAndUnit(args[0], 'cm')
    return {
      type: 'waist',
      args,
      raw: trimmed,
      metricWaist: parsed.amount
    }
  }

  // 4. Personal records (PR)
  if (cmd === 'pr' || cmd === 'record') {
    if (args.length === 0) {
      return { type: 'pr', args, raw: trimmed }
    }
    const exercise = args[0]
    const val = args.slice(1).join(' ')
    return {
      type: 'pr',
      args,
      raw: trimmed,
      prExercise: exercise,
      prValue: val
    }
  }

  // 5. General /sport command
  if (cmd === 'sport' || cmd === 'sports' || cmd === 'athlete') {
    if (args.length === 0 || args[0].toLowerCase() === 'status' || args[0].toLowerCase() === 'stats') {
      return { type: 'sport_status', args, raw: trimmed }
    }
    const act = args[0].toLowerCase()
    let exName = args[0].charAt(0).toUpperCase() + args[0].slice(1)
    let defUnit = 'minutes'
    if (act.includes('run')) { exName = 'Running'; defUnit = 'km' }
    else if (act.includes('foot') || act.includes('soccer')) { exName = 'Football'; defUnit = 'minutes' }
    else if (act.includes('box')) { exName = 'Boxing'; defUnit = 'minutes' }
    else if (act.includes('swim')) { exName = 'Swimming'; defUnit = 'm' }
    else if (act.includes('cycl') || act.includes('bike')) { exName = 'Cycling'; defUnit = 'km' }
    else if (act.includes('push') || act.includes('pull') || act.includes('squat')) { defUnit = 'reps' }
    else if (act.includes('bench') || act.includes('deadlift')) { defUnit = 'kg' }

    const parsed = parseAmountAndUnit(args[1], defUnit)
    return {
      type: 'sport',
      args,
      raw: trimmed,
      exerciseName: exName,
      exerciseAmount: parsed.amount,
      exerciseUnit: parsed.unit
    }
  }

  // 6. Standard commands
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
      exerciseAmount: amount,
      exerciseUnit: 'reps'
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

  if (cmd === 'balance' || cmd === 'accounts' || cmd === 'money') {
    return { type: 'balance', args, raw: trimmed }
  }

  // Natural language expense logging (e.g. "coffee 35", "35 coffee", "taxi 50", "lunch 120", "+500 salary")
  const naturalExp = tryParseNaturalExpense(trimmed)
  if (naturalExp) {
    return naturalExp
  }

  return { type: 'unknown', args, raw: trimmed }
}

export function formatHelpMessage(): string {
  return [
    `⚡ <b>Life System — Telegram Command Center</b> ⚡`,
    ``,
    `Control your habits, workouts, sports, and wallet from your phone:`,
    ``,
    `📊 <b>Dashboard & Status</b>`,
    `• <code>/today</code> — View balance, level, streak & rituals`,
    `• <code>/vault</code> — Real-money Reward Vault surplus, coin valuation & multiplier`,
    `• <code>/goals</code> — Wishlist Mega Goals & savings progress`,
    `• <code>/tasks</code> — View open tasks for today`,
    `• <code>/done &lt;num&gt;</code> — Complete a task (e.g. <code>/done 1</code>)`,
    ``,
    `⚡ <b>Sport & Athletic Tracking</b>`,
    `• <code>/sport &lt;activity&gt; &lt;amount&gt;</code> — e.g. <code>/sport run 5km</code> (+15 🪙)`,
    `• <code>/run &lt;km&gt;</code> — e.g. <code>/run 5km</code>`,
    `• <code>/football &lt;min&gt;</code> — e.g. <code>/football 90m</code>`,
    `• <code>/boxing &lt;min&gt;</code> — e.g. <code>/boxing 45m</code>`,
    `• <code>/gym &lt;min&gt;</code> — e.g. <code>/gym 60m</code>`,
    `• <code>/bench &lt;kg&gt;</code> — e.g. <code>/bench 80kg</code>`,
    `• <code>/weight &lt;kg&gt;</code> — e.g. <code>/weight 74.5</code> (+5 🪙)`,
    `• <code>/waist &lt;cm&gt;</code> — e.g. <code>/waist 82</code> (+5 🪙)`,
    `• <code>/sport status</code> — View Hunter athletic stats & PRs`,
    ``,
    `💪 <b>Quick Body Exercises</b>`,
    `• <code>/pushups &lt;reps&gt;</code> — Quick log push-ups`,
    `• <code>/pullups &lt;reps&gt;</code> — Quick log pull-ups`,
    `• <code>/squats &lt;reps&gt;</code> — Quick log squats`,
    `• <code>/workout &lt;reps&gt; &lt;exercise&gt;</code> — e.g. <code>/workout 50 pushups</code> (+10 🪙)`,
    ``,
    `🛡️ <b>Discipline & Standard</b>`,
    `• <code>/checkin</code> — Log daily clean check-in (+20 🪙)`,
    `• <code>/oath</code> — Take morning oath (+3 🪙)`,
    `• <code>/panic</code> — Instant urge crusher emergency protocol`,
    ``,
    `💳 <b>Money & Expenses</b>`,
    `• <code>coffee 35</code> or <code>taxi 50</code> — Fast natural expense logging`,
    `• <code>/balance</code> — View accounts, coins & vault balances`,
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
      : `<i>Use /checkin, /sport or /expense to log today wins.</i>`
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

export function formatSportResponse(
  activity: string,
  amount: number,
  unit: string,
  streak: number,
  coins: number,
  xp: number
): string {
  return [
    `⚔️ <b>HUNTER ATHLETIC LOG: RECORDED</b> ⚔️`,
    ``,
    `• <b>Sport / Activity:</b> ${activity} (${amount} ${unit})`,
    `• <b>Attribute Gains:</b> +2 STR · +2 VIT · +1 AGI`,
    `• <b>Hunter Rewards:</b> +${coins} 🪙 Coins · +${xp} XP`,
    `• <b>Continuous Streak:</b> ${streak} days active!`,
    ``,
    `<i>"Your physical combat power ascends. The System acknowledges your relentless dedication!"</i>`
  ].join('\n')
}

export function formatMetricResponse(
  type: 'weight' | 'waist',
  val: number,
  unit: string,
  coins: number,
  xp: number
): string {
  return [
    `⚖️ <b>BODY COMPOSITION LOGGED</b> ⚖️`,
    ``,
    `• <b>${type === 'weight' ? 'Body Weight' : 'Waist Circumference'}:</b> ${val} ${unit}`,
    `• <b>Reward:</b> +${coins} 🪙 Coins · +${xp} XP`,
    `• <b>Ledger:</b> Saved to physical metrics archive.`,
    ``,
    `<i>"Consistency in tracking breeds absolute control over physical form."</i>`
  ].join('\n')
}

export function formatSportStatusResponse(data: {
  streak: number
  totalWorkouts: number
  thisWeek: number
  latestWeight?: number | null
  latestWaist?: number | null
}): string {
  return [
    `⚡ <b>HUNTER ATHLETIC STATUS & POWER</b> ⚡`,
    ``,
    `🔥 <b>Workout Streak:</b> ${data.streak} Days Continuous`,
    `🏋️ <b>Sessions Logged:</b> ${data.totalWorkouts} total (${data.thisWeek} this week)`,
    `⚖️ <b>Current Weight:</b> ${data.latestWeight ? `${data.latestWeight} kg` : 'Not recorded'}`,
    `📏 <b>Current Waist:</b> ${data.latestWaist ? `${data.latestWaist} cm` : 'Not recorded'}`,
    ``,
    `<i>Tip: Send <code>/sport run 5km</code>, <code>/bench 80kg</code>, <code>/boxing 45m</code> or <code>/weight 75</code> to log directly!</i>`
  ].join('\n')
}

export function formatExpenseResponse(
  amountFormatted: string,
  category: string,
  note: string | null,
  remainingBudget: string,
  coinsAwarded: number,
  financeSyncInfo?: { synced: boolean; totalBalance?: string; accountName?: string }
): string {
  const parts = [
    `💳 <b>Expense Recorded${financeSyncInfo?.synced ? ' & Synced to Finance Helper!' : ''}</b>`,
    ``,
    `• <b>Amount:</b> ${amountFormatted}${note ? ` · <i>${note}</i>` : ''}`,
    `• <b>Category:</b> ${category}`,
    `• <b>Daily Budget Left:</b> ${remainingBudget}`
  ]
  if (financeSyncInfo?.synced) {
    parts.push(
      `• <b>Finance App Ledger:</b> Synced ✅${financeSyncInfo.accountName ? ` [${financeSyncInfo.accountName}]` : ''}${
        financeSyncInfo.totalBalance ? ` (Total: <b>${financeSyncInfo.totalBalance}</b>)` : ''
      }`
    )
  }
  if (coinsAwarded > 0) {
    parts.push(`• <b>Reward:</b> +${coinsAwarded} coins (first log of the day)`)
  }
  return parts.join('\n')
}

export function formatBalanceResponse(data: {
  currency: string
  walletCoins: number
  walletCoinsValueMdl: number
  vaultSurplusMdl: number
  financeAccountsTotalMdl: number
  financeAccounts: { name: string; balanceMdl: number; currency: string }[]
  dailyBudgetLeftMdl?: number
}): string {
  const lines = [
    `💰 <b>FINANCIAL BALANCE & ASSET OVERVIEW</b> 💰`,
    ``
  ]

  if (data.financeAccounts.length > 0) {
    lines.push(`🏦 <b>Finance Helper Accounts:</b>`)
    for (const acc of data.financeAccounts) {
      lines.push(`• <b>${acc.name}:</b> ${acc.balanceMdl.toFixed(2)} ${acc.currency}`)
    }
    lines.push(`💳 <b>Accounts Total:</b> <b>${data.financeAccountsTotalMdl.toFixed(2)} ${data.currency}</b>`)
    lines.push(``)
  }

  lines.push(
    `🪙 <b>Life System Points Wallet:</b>`,
    `• <b>${data.walletCoins} Coins</b> (≈ <b>${data.walletCoinsValueMdl.toFixed(2)} ${data.currency}</b> at 10:1 ratio)`,
    ``,
    `🏛️ <b>Discipline Reward Vault:</b>`,
    `• <b>${data.vaultSurplusMdl.toFixed(2)} ${data.currency}</b> (unlocked surplus reward cash)`,
    ``,
    `💎 <b>Combined Liquid & Stored Value:</b>`,
    `• <b>${(data.financeAccountsTotalMdl + data.vaultSurplusMdl + data.walletCoinsValueMdl).toFixed(2)} ${data.currency}</b>`
  )

  if (data.dailyBudgetLeftMdl != null) {
    lines.push(
      ``,
      `📊 <b>Today's Spending Budget:</b> ${data.dailyBudgetLeftMdl.toFixed(2)} ${data.currency} remaining`
    )
  }

  return lines.join('\n')
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
