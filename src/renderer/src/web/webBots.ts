// Telegram bots on the web: polls getUpdates and runs each command through
// the same services as the desktop, on the Turso copy. Every message is
// recorded in bot_seen_updates in the same Turso transaction as what it
// logged, so the phone and the PC never log one message twice, and a message
// is never marked done without its record (or the other way round).
import type { BotBridgeConfig, BotLogEntry } from '@shared/api'
import {
  formatBalanceResponse,
  formatCleanCheckinResponse,
  formatExpenseResponse,
  formatHelpMessage,
  formatMetricResponse,
  formatSportResponse,
  formatSportStatusResponse,
  formatTodayStatus,
  formatUrgeResponse,
  formatWorkoutResponse,
  parseTelegramText
} from '@core/botCommands'
import { addDays } from '@core/dates'
import { formatMoney } from '@core/money'
import { getSetting, setSetting } from '../../../main/settings'
import { queueFinanceExpense } from './financeInbox'
import { MirrorError, type Mirror } from './mirror'
import { findExercise, updateSport } from '../sportTrack'
import type { Services, WebServices } from './webServices'

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))
const LOGS_KEY = 'life_bot_logs'
const store = typeof localStorage !== 'undefined' ? localStorage : null

/** Telegram's Bot API, small and with a timeout so a hung call can't stall the app. */
async function tg(token: string, method: string, body?: unknown): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    })
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
    return json
  } finally {
    clearTimeout(t)
  }
}

/** Sport Track's checklist on this device: a rep sent from Telegram counts today. */
function addRepsToSportTrack(name: string, amount: number): { done: number; target: number } | null {
  let prog: { done: number; target: number } | null = null
  updateSport((st) => {
    const ex = findExercise(st, name)
    if (!ex) return
    ex.doneToday = (Number(ex.doneToday) || 0) + amount
    prog = { done: ex.doneToday, target: Number(ex.target) || 0 }
  })
  return prog
}

/**
 * Sport Track's data in Turso (settings.sport_tracker_json, see sportSync.ts),
 * for the server: reps land there and every device picks them up.
 */
function addRepsInDb(db: any, name: string, amount: number): { done: number; target: number } | null {
  const saved = (() => {
    try {
      return JSON.parse(getSetting(db, 'sport_tracker_json') || 'null')
    } catch {
      return null
    }
  })()
  const st = saved?.data
  if (!st || !Array.isArray(st.exercises)) return null
  const today = new Date().toISOString().slice(0, 10) // Sport Track's day is the UTC date
  if (st.lastDate !== today) {
    st.lastDate = today
    st.exercises.forEach((e: any) => (e.doneToday = 0))
    if (st.water) st.water.currentMl = 0
  }
  const ex = findExercise(st, name)
  if (!ex) return null
  ex.doneToday = (Number(ex.doneToday) || 0) + amount
  setSetting(db, 'sport_tracker_json', JSON.stringify({ savedAt: Date.now(), data: st }))
  return { done: ex.doneToday, target: Number(ex.target) || 0 }
}

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

export interface WebBotsDeps {
  mirror: Mirror
  services: WebServices
  defaults: BotBridgeConfig
  /** An expense was saved (Finance Helper picks it up from the inbox). */
  onExpense?: () => void
  /** Running on the server: Sport reps go to Turso, not this browser. */
  server?: boolean
}

export function createWebBots({ mirror, services, defaults, onExpense, server = false }: WebBotsDeps) {
  let polling = false
  let timer: ReturnType<typeof setInterval> | null = null
  let lastPollAt: string | null = null
  let lastError: string | null = null
  let processed = 0
  let running: Promise<{ processedCount: number; replies: string[] }> | null = null
  let pruned = false

  // Saved settings win, but an empty token or chat never hides the server's one.
  const merge = (saved: Partial<BotBridgeConfig>): BotBridgeConfig => {
    const out: any = { ...defaults }
    for (const [k, v] of Object.entries(saved ?? {})) if (v !== '' && v != null) out[k] = v
    return out
  }
  const config = (): Promise<BotBridgeConfig> =>
    mirror
      .read((db) => getSetting(db as any, 'bot_bridge_config'))
      .then((raw) => merge(raw ? JSON.parse(raw) : {}))
      .catch(() => {
        try {
          const local = store?.getItem('bot_bridge_config')
          return merge(local ? JSON.parse(local) : {})
        } catch {
          return defaults
        }
      })

  const addLog = (command: string, sender: string, success: boolean, reply: string) => {
    if (!store) return
    try {
      const list: BotLogEntry[] = JSON.parse(store.getItem(LOGS_KEY) || '[]')
      list.push({ id: Date.now() + Math.random(), ts: new Date().toISOString(), command, sender, success, reply })
      store.setItem(LOGS_KEY, JSON.stringify(list.slice(-100)))
    } catch {
      /* logs are a convenience */
    }
  }

  const allowed = (cfg: BotBridgeConfig, chat: string) =>
    [cfg.chatId, cfg.sportBotChatId, cfg.financeBotChatId, cfg.manBotChatId, cfg.wakyBotChatId, cfg.plannerBotChatId, cfg.coachBotChatId]
      .filter(Boolean)
      .some((id) => String(id) === chat)

  /** One command, on the services. Returns the reply and what changed. */
  let currentDb: any = null

  function run(s: Services, text: string): { reply: string; sport?: { name: string; amount: number }; expense?: { amount: number; category: string; note: string; type?: 'expense' | 'income' } } {
    const parsed = parseTelegramText(text)
    switch (parsed.type) {
      case 'help':
        return { reply: formatHelpMessage() }
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
        s.discipline.checkIn()
        // The same day number MAN shows (its start day is Day 1).
        const st = s.discipline.state()
        return { reply: formatCleanCheckinResponse(st.current + (st.resets === 0 ? 1 : 0), 20) }
      }
      case 'oath':
        s.discipline.oath()
        return { reply: '📜 <b>Morning Oath Affirmed!</b>\n\n<i>"I commit to purity, disciplined physical power, sharp financial focus, and daily relentless self-mastery."</i>\n\n+3 coins awarded!' }
      case 'workout': {
        const name = parsed.exerciseName || 'pushups'
        const amount = parsed.exerciseAmount || 20 // like the desktop: "/pushups" alone is 20
        const res = s.body.logWorkout({
          title: `${name} (+${amount})`,
          items: [{ exerciseId: name.toLowerCase(), name, amount, unit: 'reps' }],
          note: 'Logged via Telegram'
        })
        return { reply: formatWorkoutResponse(name, amount, res.state.streak, res.awarded ? 10 : 0), sport: { name, amount } }
      }
      case 'sport': {
        const name = parsed.exerciseName || 'Workout'
        const amount = parsed.exerciseAmount || 1
        const rawUnit = parsed.exerciseUnit || 'minutes'
        const unit = rawUnit === 'reps' || rawUnit === 'kg' || rawUnit === 'sets' ? rawUnit : 'minutes'
        const res = s.body.logWorkout({
          title: `${name} (${amount} ${rawUnit})`,
          items: [{ exerciseId: name.toLowerCase().replace(/\s+/g, '_'), name, amount, unit }],
          note: `Logged via Telegram (${amount} ${rawUnit})`
        })
        return { reply: formatSportResponse(name, amount, rawUnit, res.state.streak, res.awarded ? 10 : 0, res.awarded ? 25 : 0) }
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
        const res = s.sleep.logWake(new Date().toTimeString().slice(0, 5)) // local time (the server runs in your time zone)
        return { reply: `🌅 <b>Wake-up logged</b>: ${res.log.wakeTime}\n${res.awarded ? '🎯 On time! <b>+10 coins</b>' : res.log.onTime ? 'On time.' : 'Saved to your sleep history.'}` }
      }
      case 'bed': {
        const res = s.sleep.logBed(new Date().toTimeString().slice(0, 5))
        return { reply: `🌙 <b>Bedtime logged</b>: ${res.log.bedTime}\n${res.awarded ? '🎯 On time! <b>+5 coins</b>' : 'Saved to your sleep history.'}` }
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
            `🪙 Coins: <b>${v.coinsBalance}</b> (≈ ${v.coinsRealValue} ${v.currency})`,
            `💰 Vault: <b>${v.vaultBalance} ${v.currency}</b>`,
            `🔥 Multiplier: ${v.multiplier.label}`,
            v.pinnedGoal ? `🌟 Goal: ${esc(v.pinnedGoal.title)} (${v.pinnedGoal.allocatedCoins}/${v.pinnedGoal.targetCoins} coins)` : ''
          ].filter(Boolean).join('\n')
        }
      }
      case 'goals': {
        const goals = s.economy.goals().filter((g: any) => !g.completed)
        return {
          reply: goals.length
            ? `🎯 <b>Goals</b>\n\n${goals.map((g: any, i: number) => `${i + 1}. ${g.pinned ? '⭐ ' : ''}<b>${esc(g.title)}</b> · ${g.allocatedCoins}/${g.targetCoins} coins`).join('\n')}`
            : '🎯 No open goals. Add one in the Shop.'
        }
      }
      case 'crush':
        return { reply: formatUrgeResponse() }
      default:
        return { reply: `❓ I didn't understand <code>${esc(text.slice(0, 60))}</code>.\n\nSend <code>/help</code> for the list.` }
    }
  }

  /**
   * Handles one message in one Turso transaction (with its "seen" mark). If
   * another device got there first, the copy reloads and we skip it.
   */
  async function handle(botId: string, update: any, cfg: BotBridgeConfig): Promise<string | null> {
    const key = `${botId}:${update.update_id}`
    const text = String(update.message?.text ?? '').trim()
    const chat = String(update.message?.chat?.id ?? '')
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await mirror.write((db) => {
          if (db.prepare('SELECT 1 FROM bot_seen_updates WHERE key = ?').get(key)) return { skip: true as const }
          db.prepare('INSERT INTO bot_seen_updates (key, ts) VALUES (?, ?)').run(key, new Date().toISOString())
          if (!text || !chat) return { skip: true as const }
          if (!allowed(cfg, chat)) return { skip: false as const, reply: `⛔ This chat (<code>${esc(chat)}</code>) isn't allowed.`, ok: false }
          // A command can fail its own rule (already checked in, daily cap…):
          // the message is still marked seen and the reply says why.
          const svc = services.services(db)
          currentDb = db
          try {
            const r = db.transaction(() => {
              const out = run(svc, text)
              if (server && out.sport) {
                const prog = addRepsInDb(db, out.sport.name, out.sport.amount)
                if (prog && prog.target) out.reply += `\n\n📊 Today: <b>${prog.done}/${prog.target}</b> (${Math.round((prog.done / prog.target) * 100)}%)`
                out.sport = undefined
              }
              // Finance Helper gets it too (see financeInbox.ts).
              if (out.expense) {
                const now = new Date()
                queueFinanceExpense(db as any, { id: `tg-life-${key.replace(/[^\w-]/g, '-')}`, ...out.expense, date: svc.wallet.today(now), at: now.getTime() })
              }
              return out
            })()
            return { skip: false as const, reply: r.reply, ok: true, sport: r.sport, expense: !!r.expense }
          } catch (e) {
            currentDb = null
            return { skip: false as const, reply: `⚠️ ${esc((e as Error).message)}`, ok: false }
          }
        })
        if (out.skip) return null
        processed++
        if (out.ok && 'sport' in out && out.sport) {
          const prog = addRepsToSportTrack(out.sport.name, out.sport.amount)
          if (prog && prog.target) out.reply += `\n\n📊 Today: <b>${prog.done}/${prog.target}</b> (${Math.round((prog.done / prog.target) * 100)}%)`
        }
        if (out.ok && 'expense' in out && out.expense) onExpense?.()
        addLog(text, chat, out.ok, out.reply)
        await tg(update.__token, 'sendMessage', { chat_id: chat, text: out.reply, parse_mode: 'HTML' }).catch(() => null)
        return out.reply
      } catch (e) {
        if (e instanceof MirrorError && attempt === 0) continue // reloaded: try once more
        throw e
      }
    }
    return null
  }

  async function pollOnce(): Promise<{ processedCount: number; replies: string[] }> {
    if (running) return running
    running = (async () => {
      const cfg = await config()
      // The server answers every bot 24/7; reading them here too would fail.
      if (cfg.serverBots && !server) {
        lastPollAt = new Date().toISOString()
        lastError = null
        return { processedCount: 0, replies: [] }
      }
      // The Finance bot too: Finance Helper only reads it while it runs on
      // the PC, and its money messages ("45 lunch") reach Finance Helper
      // through the inbox either way.
      const tokens = [cfg.megaBotToken, cfg.sportBotToken, cfg.financeBotToken, cfg.manBotToken, cfg.botToken, cfg.wakyBotToken, cfg.plannerBotToken, cfg.coachBotToken]
        .filter((t): t is string => !!t && t.includes(':'))
        .filter((t, i, all) => all.indexOf(t) === i)
      const replies: string[] = []
      const before = processed
      lastPollAt = new Date().toISOString()
      for (const token of tokens) {
        const botId = token.split(':')[0]
        const offsetKey = `tg_offset_${botId}`
        const offset = Number(store?.getItem(offsetKey) || 0) || 0
        try {
          const data = await tg(token, `getUpdates?offset=${offset}&limit=25&timeout=0`)
          if (!data?.ok) {
            const why = String(data?.description ?? 'no answer')
            // The Mega bot used to send its messages to the old Cloudflare
            // worker: take it back (waiting messages are kept) and read it
            // on the next round.
            if (/webhook/i.test(why) && token === cfg.megaBotToken) {
              const freed = await tg(token, 'deleteWebhook?drop_pending_updates=false').catch(() => null)
              if (freed?.ok) continue
            }
            lastError = /webhook/i.test(why)
              ? `Bot ${botId} sends its messages to a webhook (e.g. the Cloudflare worker), so it can't be read here. Remove the webhook to use it.`
              : `Bot ${botId}: ${why}`
            continue
          }
          for (const u of data.result ?? []) {
            u.__token = token
            const reply = await handle(botId, u, cfg)
            if (reply) replies.push(reply)
            // Saved after each message: an error later doesn't replay earlier ones.
            store?.setItem(offsetKey, String(u.update_id + 1))
          }
          lastError = null
        } catch (e) {
          lastError = `Bot ${botId}: ${(e as Error).message}`
        }
      }
      if (!pruned && tokens.length) {
        pruned = true
        const cutoff = addDays(new Date().toISOString().slice(0, 10), -14)
        mirror.write((db) => db.prepare('DELETE FROM bot_seen_updates WHERE ts < ?').run(cutoff)).catch(() => {})
      }
      return { processedCount: processed - before, replies }
    })().finally(() => {
      running = null
    })
    return running
  }

  /** One update Telegram sent to the server (webhook) for the bot with this token. */
  async function handleUpdate(token: string, update: any): Promise<string | null> {
    const cfg = await config()
    return handle(token.split(':')[0], { ...update, __token: token }, cfg)
  }

  return {
    pollOnce,
    handleUpdate,
    config,
    saveConfig: async (patch: Partial<BotBridgeConfig>): Promise<BotBridgeConfig> => {
      const next: BotBridgeConfig = { ...(await config()), ...patch }
      delete next.serverBots // comes from the server each time, never saved
      await mirror.write((db) => setSetting(db as any, 'bot_bridge_config', JSON.stringify(next)))
      try {
        store?.setItem('bot_bridge_config', JSON.stringify(next))
      } catch {
        /* fine */
      }
      return next
    },
    status: async () => {
      const cfg = await config()
      return {
        polling,
        enabled: !!cfg.enabled,
        configured: !!(cfg.megaBotToken || cfg.sportBotToken || cfg.botToken || cfg.financeBotToken || cfg.manBotToken),
        lastPollAt,
        lastError,
        processedCount: processed
      }
    },
    logs: async (): Promise<BotLogEntry[]> => {
      try {
        return (JSON.parse(store?.getItem(LOGS_KEY) || '[]') as BotLogEntry[]).slice(-50).reverse()
      } catch {
        return []
      }
    },
    clearLogs: async () => {
      store?.removeItem(LOGS_KEY)
    },
    test: async (botKey?: string): Promise<{ ok: boolean; error?: string }> => {
      const cfg = await config()
      const pick: Record<string, [string | undefined, string | undefined, string]> = {
        finance: [cfg.financeBotToken, cfg.financeBotChatId, 'Finance Bot'],
        man: [cfg.manBotToken, cfg.manBotChatId, 'MAN Bot'],
        waky: [cfg.wakyBotToken, cfg.wakyBotChatId, 'Waky Bot'],
        sport: [cfg.sportBotToken, cfg.sportBotChatId, 'Sport Bot'],
        mega: [cfg.megaBotToken, cfg.chatId, 'Mega Bot']
      }
      const [tok, chat, title] = pick[botKey ?? 'sport'] ?? pick.sport
      const token = tok || cfg.botToken
      const chatId = chat || cfg.chatId
      if (!token || !chatId) return { ok: false, error: 'Bot token or chat ID is missing' }
      try {
        const d = await tg(token, 'sendMessage', { chat_id: chatId, text: `⚡ <b>Life System — ${title} online</b>`, parse_mode: 'HTML' })
        return { ok: !!d.ok, error: d.ok ? undefined : d.description }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    startPolling: async (): Promise<boolean> => {
      polling = true
      if (!timer) {
        timer = setInterval(() => {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') pollOnce().catch(() => {})
        }, 12000)
      }
      return true
    },
    stopPolling: async (): Promise<boolean> => {
      polling = false
      if (timer) clearInterval(timer)
      timer = null
      return false
    }
  }
}
