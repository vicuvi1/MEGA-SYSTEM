// POST /api/todoist (session required) {op, ...}: your Todoist for the app,
// with the token kept on the server (TODOIST_TOKEN in Vercel).
//   status            → {connected}
//   today             → {tasks}          due today or overdue
//   upcoming          → {tasks}          due or deadline in the next 7 days
//   close {id}        → {ok}
//   quick {text}      → {task}           Todoist reads date, time, p1, #project
//   completed {since} → {items}          completed since an ISO time
//   everything        → {tasks, areas}   every open task and your areas
//   update {id, content?, priority?, due?, description?}
//   move {id, area}   reopen {id}   remove {id}
//   addArea {name}  → {area}   renameArea {area, name}
// New tasks without a #project go to the right area (by their words, else Gemini).
import { bearer, config, readBody, send, sessionOk } from './_lib.mjs'
import { createTodoistApi } from './_bot/bot.mjs'
import { askModel } from './ai.mjs'

/** Gemini picks one of your areas for a task, or none. */
export function geminiAreaPicker(key) {
  if (!key) return undefined
  return async (text, names) => {
    const r = await askModel(`Which ONE of these life areas does this task belong to? Areas: ${names.join(', ')}.\nTask: "${text}"\nReply with exactly one area name from the list, or "none".`)
    const pick = r.text.trim().replace(/^"|"$/g, '')
    return /^none$/i.test(pick) ? null : pick
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  if (!sessionOk(config(), bearer(req))) return send(res, 401, { error: 'Locked: enter your PIN again' })
  const token = (process.env.TODOIST_TOKEN || '').trim()
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  if (body?.op === 'status') return send(res, 200, { connected: !!token })
  if (!token) return send(res, 200, { connected: false, error: 'Add TODOIST_TOKEN in Vercel to connect Todoist' })
  const api = createTodoistApi(token, fetch, { pickArea: geminiAreaPicker((process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()) })
  try {
    switch (body?.op) {
      case 'today':
        return send(res, 200, { connected: true, tasks: await api.today() })
      case 'upcoming':
        return send(res, 200, { tasks: await api.upcoming(7) })
      case 'close':
        await api.close(String(body.id))
        return send(res, 200, { ok: true })
      case 'quick':
        return send(res, 200, { task: await api.quickAdd(String(body.text || '').slice(0, 500), body.area ? String(body.area) : undefined) })
      case 'everything':
        return send(res, 200, await api.everything())
      case 'update':
        await api.update(String(body.id), { content: body.content, priority: body.priority, due: body.due, description: body.description })
        return send(res, 200, { ok: true })
      case 'move':
        await api.move(String(body.id), String(body.area))
        return send(res, 200, { ok: true })
      case 'reopen':
        await api.reopen(String(body.id))
        return send(res, 200, { ok: true })
      case 'remove':
        await api.remove(String(body.id))
        return send(res, 200, { ok: true })
      case 'addArea':
        return send(res, 200, { area: await api.addArea(String(body.name || '').trim().slice(0, 60) || 'New area') })
      case 'renameArea':
        await api.renameArea(String(body.area), String(body.name || '').trim().slice(0, 60))
        return send(res, 200, { ok: true })
      case 'completed':
        return send(res, 200, { items: await api.completedSince(String(body.since || new Date(Date.now() - 86400_000).toISOString())) })
      default:
        return send(res, 400, { error: 'Unknown op' })
    }
  } catch (e) {
    send(res, 502, { error: e.message || 'Todoist failed' })
  }
}
