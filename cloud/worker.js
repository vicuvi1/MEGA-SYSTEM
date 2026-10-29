const DEFAULT_BOT_TOKEN = '9167348166:AAFU1r28fFoWgsAj-52CbH63w5FqtXdEL34'
const DEFAULT_SECRET_TOKEN = 'victor_mega_sync_2026'

// Convert UTC unix timestamp to YYYY-MM-DD (Chisinau/Bucharest EET/EEST or fallback UTC)
function getEventDate(dateSeconds) {
  const d = new Date(dateSeconds * 1000)
  const iso = d.toISOString()
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Chisinau',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const day = formatter.format(d)
    return { day, iso }
  } catch {
    return { day: iso.slice(0, 10), iso }
  }
}

async function sendTelegramReply(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML'
    })
  })
}

function parseCommand(text, dateSeconds) {
  const trimmed = text.trim()
  const { day, iso } = getEventDate(dateSeconds)

  // 1. Clean check-in
  if (/^\/(checkin|clean|check_in)\b/i.test(trimmed)) {
    return {
      event: {
        type: 'checkin',
        day,
        ts: iso,
        payload: { command: trimmed },
        source: 'telegram_bot'
      },
      reply: `🛡️ <b>Clean Check-In Logged!</b>\n📅 Day: <code>${day}</code>\n⚡ Your streak is protected. Auto-sync will heal your PC system upon launch.`
    }
  }

  // 2. Oath
  if (/^\/oath\b/i.test(trimmed)) {
    return {
      event: {
        type: 'oath',
        day,
        ts: iso,
        payload: {},
        source: 'telegram_bot'
      },
      reply: `⚔️ <b>Daily Oath Sworn!</b>\n📅 Day: <code>${day}</code>\nHonored in the hunter registry.`
    }
  }

  // 3. Task Done: /done 1, /done 2, /task 3
  const doneMatch = trimmed.match(/^\/(done|task)\s+(\d+)/i)
  if (doneMatch) {
    const taskIndex = parseInt(doneMatch[2], 10)
    return {
      event: {
        type: 'task_done',
        day,
        ts: iso,
        payload: { taskIndex },
        source: 'telegram_bot'
      },
      reply: `✅ <b>Task #${taskIndex} Marked Done!</b>\nWill check off on your Todoist board & grant XP on PC sync.`
    }
  }

  // 4. Workout / Sport: /workout 50 pushups, /sport running 5km
  const workoutMatch = trimmed.match(/^\/(workout|sport)\s+(.+)/i)
  if (workoutMatch) {
    const rawDetails = workoutMatch[2].trim()
    return {
      event: {
        type: 'workout',
        day,
        ts: iso,
        payload: { raw: rawDetails },
        source: 'telegram_bot'
      },
      reply: `💪 <b>Workout Logged!</b>\nDetails: <code>${rawDetails}</code>\nStrength stats queued for sync.`
    }
  }

  // 5. Wake up / Bed time
  const wakeMatch = trimmed.match(/^\/wake\s+([0-2]?\d:[0-5]\d)/i)
  if (wakeMatch) {
    return {
      event: {
        type: 'wake',
        day,
        ts: iso,
        payload: { time: wakeMatch[1] },
        source: 'telegram_bot'
      },
      reply: `🌅 <b>Wake Time Recorded:</b> <code>${wakeMatch[1]}</code>`
    }
  }

  const bedMatch = trimmed.match(/^\/bed\s+([0-2]?\d:[0-5]\d)/i)
  if (bedMatch) {
    return {
      event: {
        type: 'bed',
        day,
        ts: iso,
        payload: { time: bedMatch[1] },
        source: 'telegram_bot'
      },
      reply: `🌙 <b>Bedtime Recorded:</b> <code>${bedMatch[1]}</code>`
    }
  }

  // 6. Expense: /expense 45 coffee OR natural "45 coffee", "35.50 lunch"
  let expenseAmt = null
  let expenseNote = ''
  let expenseCategory = 'other'

  const cmdExpense = trimmed.match(/^\/expense\s+(\d+(?:[.,]\d+)?)\s*(?:mdl|lei|\$|€)?\s*(.*)$/i)
  const natExpense = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(?:mdl|lei|\$|€)?\s+(.+)$/i)

  if (cmdExpense) {
    expenseAmt = parseFloat(cmdExpense[1].replace(',', '.'))
    expenseNote = cmdExpense[2].trim()
  } else if (natExpense && !trimmed.startsWith('/')) {
    expenseAmt = parseFloat(natExpense[1].replace(',', '.'))
    expenseNote = natExpense[2].trim()
  }

  if (expenseAmt && expenseAmt > 0) {
    const noteLower = expenseNote.toLowerCase()
    if (/\b(coffee|cafe|tea|lunch|dinner|breakfast|food|pizza|kebab|market|lidl|linella|supermarket)\b/i.test(noteLower)) {
      expenseCategory = 'food'
    } else if (/\b(taxi|cab|uber|bolt|yandex|bus|gas|benzina|transit)\b/i.test(noteLower)) {
      expenseCategory = 'transport'
    } else if (/\b(gym|sala|fitness|workout|protein)\b/i.test(noteLower)) {
      expenseCategory = 'sport'
    }

    const amountBani = Math.round(expenseAmt * 100)
    return {
      event: {
        type: 'expense',
        day,
        ts: iso,
        payload: {
          amountBani,
          category: expenseCategory,
          note: expenseNote || 'Telegram mobile expense'
        },
        source: 'telegram_bot'
      },
      reply: `💰 <b>Expense Recorded:</b> <code>${expenseAmt} MDL</code>\nCategory: <code>${expenseCategory}</code>\nNote: <i>${expenseNote || 'none'}</i>`
    }
  }

  return null
}

export default {
  async fetch(request, env) {
    const botToken = env?.TELEGRAM_BOT_TOKEN || DEFAULT_BOT_TOKEN
    const secretToken = env?.SYNC_SECRET_TOKEN || DEFAULT_SECRET_TOKEN

    const url = new URL(request.url)
    const method = request.method

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Secret'
    }

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response(
        JSON.stringify({
          status: 'online',
          service: 'MEGA-SYSTEM 24/7 Mobile Sync Buffer',
          version: '1.4.0',
          time: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const verifyAuth = (req) => {
      const authHeader = req.headers.get('Authorization')
      const customHeader = req.headers.get('X-Sync-Secret')
      const querySecret = url.searchParams.get('secret')

      return (
        !secretToken ||
        authHeader === `Bearer ${secretToken}` ||
        customHeader === secretToken ||
        querySecret === secretToken
      )
    }

    // 1. Telegram Webhook: POST /webhook
    if (url.pathname === '/webhook' && method === 'POST') {
      try {
        const update = await request.json()
        const msg = update?.message
        if (!msg || !msg.text) {
          return new Response('OK', { status: 200 })
        }

        const text = msg.text.trim()
        const chatId = msg.chat.id
        const dateSeconds = msg.date || Math.floor(Date.now() / 1000)

        if (/^\/(start|help)\b/i.test(text)) {
          const helpText =
            `⚡ <b>Life System Mobile Sync Bot</b>\n\n` +
            `Available Mobile Commands:\n` +
            `• <code>/checkin</code> — Log clean day & protect streak\n` +
            `• <code>/done 1</code> — Complete task #1 on Todoist board\n` +
            `• <code>35 coffee</code> — Log expense (35 MDL)\n` +
            `• <code>/workout 50 pushups</code> — Record workout\n` +
            `• <code>/wake 07:30</code> — Log wake time\n` +
            `• <code>/bed 23:00</code> — Log bedtime\n` +
            `• <code>/status</code> — View buffered sync events`
          await sendTelegramReply(botToken, chatId, helpText)
          return new Response('OK', { status: 200 })
        }

        if (/^\/status\b/i.test(text)) {
          let count = 0
          if (env?.LIFE_SYNC_KV) {
            const list = await env.LIFE_SYNC_KV.list({ prefix: 'evt:' })
            count = list.keys.length
          }
          const statusText =
            `📊 <b>Life System Sync Buffer Status</b>\n` +
            `• Events in 60-Day (2 Months) queue: <b>${count}</b>\n` +
            `• Server Time: <code>${new Date().toISOString().replace('T', ' ').slice(0, 19)}</code>\n` +
            `• Status: 🟢 <i>Online & buffering</i>\n\n` +
            `When you launch Life System on PC, these will auto-sync instantly!`
          await sendTelegramReply(botToken, chatId, statusText)
          return new Response('OK', { status: 200 })
        }

        const parsed = parseCommand(text, dateSeconds)
        if (parsed) {
          const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
          const syncEvent = {
            id: eventId,
            ...parsed.event
          }

          if (env?.LIFE_SYNC_KV) {
            await env.LIFE_SYNC_KV.put(eventId, JSON.stringify(syncEvent), {
              expirationTtl: 5184000 /* 60 days (2 months) */
            })
          }

          await sendTelegramReply(botToken, chatId, parsed.reply)
        } else {
          await sendTelegramReply(
            botToken,
            chatId,
            `❓ Unrecognized command. Send <code>/help</code> or log an expense like <code>35 coffee</code> or <code>/checkin</code>.`
          )
        }

        return new Response('OK', { status: 200 })
      } catch (err) {
        return new Response(`Error: ${err.message}`, { status: 500 })
      }
    }

    // 2. PC Desktop Sync: GET /api/sync
    if (url.pathname === '/api/sync' && method === 'GET') {
      if (!verifyAuth(request)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      try {
        const events = []
        if (env?.LIFE_SYNC_KV) {
          const list = await env.LIFE_SYNC_KV.list({ prefix: 'evt:' })
          for (const key of list.keys) {
            const raw = await env.LIFE_SYNC_KV.get(key.name)
            if (raw) {
              try {
                events.push(JSON.parse(raw))
              } catch {}
            }
          }
        }

        events.sort((a, b) => a.ts.localeCompare(b.ts))

        return new Response(
          JSON.stringify({
            success: true,
            count: events.length,
            events
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    // 3. PC Desktop Ack: POST /api/ack
    if (url.pathname === '/api/ack' && method === 'POST') {
      if (!verifyAuth(request)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      try {
        const body = await request.json()
        const ids = body?.ids || []

        let deleted = 0
        if (env?.LIFE_SYNC_KV) {
          for (const id of ids) {
            if (id && id.startsWith('evt_')) {
              await env.LIFE_SYNC_KV.delete(id)
              deleted++
            }
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            acknowledged: deleted
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders })
  }
}
