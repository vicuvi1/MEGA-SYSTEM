import { parseSets } from './sportSets'
import { isSportName, parseSportSay } from './sportBot'
import { matchMove } from './sportMoves'
export type BotCommandType =
  | 'today'
  | 'why'
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
  | 'spent'
  | 'unknown'

export interface ParsedCommand {
  type: BotCommandType
  args: string[]
  raw: string
  exerciseName?: string
  exerciseAmount?: number
  exerciseUnit?: string
  /** Sets as typed ("3x15 push-ups", "push-ups 15 14 12"): reps (or seconds) per set. */
  exerciseSets?: number[]
  /** Backpack weight in kg for the sets ('8 push-ups +10 kg'). */
  exerciseKg?: number
  /** 'best set push-ups 50': a declared max set, not a workout. */
  exerciseBest?: boolean
  metricWeight?: number
  metricWaist?: number
  prExercise?: string
  prValue?: string
  expenseAmount?: number
  expenseCategory?: string
  expenseNote?: string
  taskIndex?: number
  /** 'spent': which days you ask about. */
  period?: 'today' | 'yesterday' | 'week' | 'month'
}

function parseAmountAndUnit(str: string, defaultUnit = 'reps'): { amount: number; unit: string } {
  if (!str) return { amount: 1, unit: defaultUnit }
  // "74,5", "30 min", "500m" (X11): a comma decimal and a space before the unit are fine.
  const match = str.trim().replace(/(\d),(\d)/, '$1.$2').match(/^([\d.]+)\s*([a-zA-Zа-яё]*)$/i)
  if (match) {
    const amount = parseFloat(match[1]) || 1
    let unit = (match[2] || defaultUnit).toLowerCase()
    if (unit === 'k' || unit === 'km' || unit === 'kms' || unit === 'км') unit = 'km'
    // "500m" is metres (a swim, a run); "30m" is minutes.
    else if (unit === 'm' && (amount >= 100 || defaultUnit === 'm')) unit = 'm'
    else if (unit === 'meters' || unit === 'metres' || unit === 'meter' || unit === 'metre' || unit === 'м') unit = 'm'
    else if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours' || unit === 'ore' || unit === 'час') return { amount: Math.round(amount * 60), unit: 'minutes' }
    else if (unit === 'm' || unit === 'min' || unit === 'mins' || unit === 'minute' || unit === 'minutes' || unit === 'мин') unit = 'minutes'
    else if (unit === 'sec' || unit === 'secs' || unit === 's') unit = 'seconds'
    else if (unit === 'kg' || unit === 'kgs') unit = 'kg'
    else if (unit === 'r' || unit === 'rep' || unit === 'reps') unit = 'reps'
    return { amount, unit }
  }
  const fallback = parseFloat(str)
  return { amount: isNaN(fallback) ? 1 : fallback, unit: defaultUnit }
}


export function detectExpenseCategory(text: string): string {
  // "benzină", "cafeá"… match their plain spelling.
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Russian words (X11): Cyrillic needs its own check (\b only sees Latin letters).
  const ru = text.toLowerCase()
  if (/(кофе|чай|обед|ужин|завтрак|еда|продукт|магазин|ресторан|пицц|шаурм|бургер|пиво|вода)/.test(ru)) return 'food'
  if (/(такси|автобус|бензин|топлив|парковк|метро|поезд|транспорт)/.test(ru)) return 'transport'
  if (/(аренд|квартир|счет|счёт|коммунал|свет|газ|интернет)/.test(ru)) return 'home'
  if (/(зал|спорт|протеин|фитнес)/.test(ru)) return 'sport'
  if (/(аптек|лекарств|врач|доктор|стоматолог|витамин)/.test(ru)) return 'health'
  if (/(кино|игр|концерт|клуб|вечеринк)/.test(ru)) return 'fun'
  if (/(одежд|обув|кроссовк|шопинг)/.test(ru)) return 'clothes'
  if (/(зарплат|доход|бонус|фриланс)/.test(ru)) return 'income'
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
  // "spent 50 lei on lunch", "am cheltuit 120 lei pe benzină", "paid 30 for taxi":
  // the verb and the little words around the amount are not the note.
  const trimmed = text
    .trim()
    .replace(/^(i\s+)?(just\s+)?(spent|paid|bought|am\s+cheltuit|am\s+dat|am\s+pl[aă]tit|am\s+cump[aă]rat|cheltuit|pl[aă]tit|потратил[аи]?|заплатил[аи]?)\s+/i, '')
  if (!trimmed || trimmed.startsWith('/')) return null
  const cleanNote = (n: string) => n.replace(/\b(lei|mdl)\b/gi, '').replace(/[$€]/g, '').replace(/^\s*(on|for|at|pe|pentru|la|na|за)\s+/i, '').replace(/\s+/g, ' ').trim()

  // Pattern A: Amount first: e.g. "35 coffee", "35.50 lunch with alex", "+500 salary", "45 lei pizza", "120 mdl groceries"
  const amountFirstMatch = trimmed.match(/^([+-]?\s*\d+(?:[.,]\d+)?)\s*(?:mdl|lei|\$|€)?\s+(.+)$/i)
  if (amountFirstMatch) {
    const rawAmt = amountFirstMatch[1].replace(/\s+/g, '').replace(',', '.')
    const amt = parseFloat(rawAmt)
    const note = cleanNote(amountFirstMatch[2])
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
    const note = cleanNote(noteFirstMatch[1])
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

  // Plain sentences the rules can do without AI (free and instant):
  // "woke up at 7:30", "m-am trezit la 7:30" → wake; "went to bed at 23:40",
  // "m-am culcat la 0:30", "bed 23:40" → bed at that time.
  const hm = (h: string, m?: string) => `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`
  const wake = /^(?:i\s+)?(?:woke(?:\s+up)?|wake(?:\s+up)?|got\s+up|up|m-?am\s+trezit|trezit|m-?am\s+sculat|проснул[аи]?с[ья])\s*(?:at|la|в)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/i.exec(trimmed)
  if (wake && Number(wake[1]) < 24) return { type: 'wake', args: [hm(wake[1], wake[2])], raw: trimmed }
  // "I am awake", "I'm up", "woke up", "m-am trezit" with no time: woke up now.
  if (/^(?:i\s+am\s+(?:awake|up)|i'?m\s+(?:awake|up)|awake|woke\s+up|just\s+woke\s+up|good\s+morning,?\s+i'?m\s+up|m-?am\s+trezit|m-?am\s+sculat|проснул[аи]?с[ья])\s*[.!]*$/i.test(trimmed)) return { type: 'wake', args: [], raw: trimmed }
  const bed = /^(?:i\s+)?(?:went\s+to\s+(?:bed|sleep)|going\s+to\s+(?:bed|sleep)|bed|sleep|m-?am\s+culcat|culcat|m[aă]\s+culc|лег(?:ла)?\s+спать)\s*(?:at|la|в)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/i.exec(trimmed)
  // "sleep 8" is hours slept, not bed at 08:00 (X11): a bare daytime hour needs "at" or minutes.
  const bareDay = bed && !bed[2] && !/\b(at|la|в)\b/i.test(trimmed) && Number(bed[1]) >= 5 && Number(bed[1]) <= 18
  if (bed && Number(bed[1]) < 24 && !bareDay) return { type: 'bed', args: [hm(bed[1], bed[2])], raw: trimmed }
  // "gym done", "workout done", "am fost la sală", "trained": a gym session.
  if (/^(?:(?:gym|sala|sală|workout|training|antrenament(?:ul)?)\s+(?:done|finished|gata|f[aă]cut)|(?:done|finished)\s+(?:gym|workout|training)|am\s+fost\s+la\s+s[aă]l[aă]|trained|i\s+trained|m-?am\s+antrenat)\s*[.!]*$/i.test(trimmed))
    return { type: 'sport', args: [], raw: trimmed, exerciseName: 'Gym Session', exerciseAmount: 60, exerciseUnit: 'minutes' }
  // "how much did I spend today/this week?", "cât am cheltuit azi?", "spent this month?"
  const q = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/(how\s+much.*spen[dt]|spent\b.*\?|cat\s+am\s+cheltuit|cheltuieli|сколько.*потрат)/.test(q) && !/\d{2,}/.test(q)) {
    const period = /yesterday|ieri|вчера/.test(q) ? 'yesterday' : /week|saptaman|недел/.test(q) ? 'week' : /month|luna|месяц/.test(q) ? 'month' : 'today'
    return { type: 'spent', args: [], raw: trimmed, period }
  }

  // Sets: "3x15 push-ups", "push-ups 15 14 12", "plank 3x45s" (one number alone stays a total).
  // Sport lives in Ben: weights ("8 push-ups +10 kg") and best sets ("best set push-ups 50") too.
  const say = parseSportSay(trimmed)
  if (say && (say.kind === 'best' || say.kg > 0) && isSportName(say.name)) {
    const total = say.reps.reduce((a, b) => a + b, 0)
    return { type: 'workout', args: [], raw: trimmed, exerciseName: say.name, exerciseAmount: say.kind === 'best' ? 0 : total, exerciseUnit: say.unit, exerciseSets: say.reps, ...(say.kg ? { exerciseKg: say.kg } : {}), ...(say.kind === 'best' ? { exerciseBest: true } : {}) }
  }
  const sets = parseSets(trimmed)
  if (sets && (matchMove(sets.name) || /^(press|pushups?|situps?|squats?|pullups?|dips?|plank|flotari|abdomene|genuflexiuni|tractiuni)$/i.test(sets.name.replace(/[^a-z]/gi, '')))) {
    const total = sets.reps.reduce((a, b) => a + b, 0)
    return { type: 'workout', args: [], raw: trimmed, exerciseName: sets.name, exerciseAmount: total, exerciseUnit: sets.unit, exerciseSets: sets.reps }
  }

  // Without a slash, a command word counts only alone or with a number:
  // "run 5km", "done 1", "weight 74.5" yes; "clean my room", "done with the lab
  // report", "sleep is bad lately", "help me plan" are sentences for Ben (X3).
  const words = args.filter((a) => !/\d/.test(a))
  if (!parts[0].startsWith('/') && !/^\d/.test(cmd) && args.length && (words.length === args.length || words.length > 2)) cmd = '\u0000'

  // 1. Direct exercise shortcuts like /pushups 50, /situps 30, /press 20
  const exerciseShortcuts: Record<string, string> = {
    pushups: 'pushups',
    pushup: 'pushups',
    push_ups: 'pushups',
    push_up: 'pushups',
    flotari: 'pushups',
    situps: 'situps',
    situp: 'situps',
    sit_ups: 'situps',
    sit_up: 'situps',
    abdomene: 'situps',
    press: 'press',
    shoulderpress: 'press',
    benchpress: 'press',
    bench_press: 'press',
    pullups: 'pullups',
    pullup: 'pullups',
    pull_ups: 'pullups',
    tractiuni: 'pullups',
    squats: 'squats',
    squat: 'squats',
    genuflexiuni: 'squats',
    dips: 'dips',
    dip: 'dips',
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

  // 1b. Inverted natural format: e.g. "50 pushups", "30 situps", "25 press"
  if (/^\d+$/.test(cmd) && args.length > 0) {
    const exCandidate = args[0].toLowerCase().replace(/[^a-z_]/g, '')
    if (exerciseShortcuts[exCandidate]) {
      const amount = parseInt(cmd, 10)
      return {
        type: 'workout',
        args: [cmd],
        raw: trimmed,
        exerciseName: exerciseShortcuts[exCandidate],
        exerciseAmount: amount,
        exerciseUnit: 'reps'
      }
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
    const parsed = parseAmountAndUnit(args.slice(0, 2).join(' '), spec.defaultUnit)
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
    const parsed = parseAmountAndUnit(args.slice(0, 2).join(' '), 'kg')
    return {
      type: 'weight',
      args,
      raw: trimmed,
      metricWeight: parsed.amount
    }
  }

  if (cmd === 'waist') {
    const parsed = parseAmountAndUnit(args.slice(0, 2).join(' '), 'cm')
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

    const parsed = parseAmountAndUnit(args.slice(1, 3).join(' '), defUnit)
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

  if (cmd === 'why') return { type: 'why', args, raw: trimmed }
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

  if (cmd === 'expense' || cmd === 'buy' || cmd === 'spent' || cmd === 'pay' || cmd === 'paid') {
    // "spent 50 lei on lunch": read like a sentence (the category comes from the words).
    if (!trimmed.startsWith('/') || !/^[a-z]+$/i.test(args[1] ?? '') || /^(lei|mdl|on|for|pe|la)$/i.test(args[1] ?? '')) {
      const natural = tryParseNaturalExpense(args.join(' '))
      if (natural) return natural
    }
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
    // "sleep 8" (hours slept) is for Ben, not a bedtime (X11).
    if (bareDay && !parts[0].startsWith('/')) return { type: 'unknown', args, raw: trimmed }
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
    `One bot for everything: Sport, Money (Finance Helper), Discipline (MAN), Sleep (Waky), Tasks and your wallet.`,
    ``,
    `📊 <b>Dashboard & Status</b>`,
    `• <code>/today</code> — Your day: points, streaks and what's left`,
    `• <code>/vault</code> — Real-money Reward Vault surplus, coin valuation & multiplier`,
    `• <code>/goals</code> — Wishlist Mega Goals & savings progress`,
    `• <code>/tasks</code> — View open tasks for today`,
    `• <code>/done &lt;num&gt;</code> — Complete a task (e.g. <code>/done 1</code>)`,
    ``,
    `⚡ <b>Sport & Athletic Tracking</b>`,
    `• <code>/sport &lt;activity&gt; &lt;amount&gt;</code> — e.g. <code>/sport run 5km</code>`,
    `• <code>/run &lt;km&gt;</code> — e.g. <code>/run 5km</code>`,
    `• <code>/football &lt;min&gt;</code> — e.g. <code>/football 90m</code>`,
    `• <code>/boxing &lt;min&gt;</code> — e.g. <code>/boxing 45m</code>`,
    `• <code>/gym &lt;min&gt;</code> — e.g. <code>/gym 60m</code>`,
    `• <code>/bench &lt;kg&gt;</code> — e.g. <code>/bench 80kg</code>`,
    `• <code>/weight &lt;kg&gt;</code> — e.g. <code>/weight 74.5</code>`,
    `• <code>/waist &lt;cm&gt;</code> — e.g. <code>/waist 82</code>`,
    `• <code>/sport status</code> — Your training stats & records`,
    ``,
    `💪 <b>Quick Body Exercises</b>`,
    `• <code>/pushups &lt;reps&gt;</code> — Quick log push-ups`,
    `• <code>/pullups &lt;reps&gt;</code> — Quick log pull-ups`,
    `• <code>/squats &lt;reps&gt;</code> — Quick log squats`,
    `• <code>/workout &lt;reps&gt; &lt;exercise&gt;</code> — e.g. <code>/workout 50 pushups</code>`,
    ``,
    `🛡️ <b>Discipline & Standard</b>`,
    `• <code>/checkin</code> — Clean day check-in (from 19:00, or yesterday's in the morning)`,
    `• <code>/oath</code> — Take morning oath`,
    `• <code>/panic</code> — Instant urge crusher emergency protocol`,
    ``,
    `💳 <b>Money & Expenses</b>`,
    `• <code>coffee 35</code> or <code>taxi 50</code> — Fast natural expense logging`,
    `• <code>/balance</code> — View accounts, coins & vault balances`,
    `• <code>/expense &lt;amount&gt; &lt;category&gt; [note]</code>`,
    `  e.g. <code>/expense 45 food lunch</code>`,
    ``,
    `🌙 <b>Sleep & Wake</b>`,
    `• <code>/wake</code> — Log your wake-up (points only when you log it as you get up)`,
    `• <code>/bed</code> — Log bedtime`,
    ``,
    `🪙 Habits pay +2 each, focus +3 per 10 min, a must-do +10 (Rewards → How you earn).`
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
    `• <b>Reward:</b> +${coins} points`,
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
  _xp = 0
): string {
  // BG10: only what was really paid; no made-up "attribute gains".
  return [
    `🏃 <b>Workout logged</b>`,
    ``,
    `• ${activity} (${amount} ${unit})`,
    coins > 0 ? `• Points: +${coins}` : `• No points (already paid today, or the rule is off)`,
    `• Streak: ${streak} day${streak === 1 ? '' : 's'}`
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
    `• <b>Points:</b> +${coins}`,
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
    `🏋️ <b>Training</b>`,
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

/** BG10: the day that was checked in and the points really paid. */
export function formatCleanCheckinResponse(streak: number, coins: number, day?: string, today?: string): string {
  return [
    `🛡️ <b>Clean day checked in${day && today && day !== today ? ` for yesterday (${day})` : ''}</b>`,
    ``,
    `• Streak: ${streak} day${streak === 1 ? '' : 's'}`,
    coins > 0 ? `• Points: +${coins}` : `• No points this time (the rule is off or today's limit is used)`
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
