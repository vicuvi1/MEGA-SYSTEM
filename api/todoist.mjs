// POST /api/todoist (session required) {op, ...}: your Todoist for the app,
// with the token kept on the server (TODOIST_TOKEN in Vercel).
//   status            → {connected}
//   today             → {tasks}          due today or overdue
//   close {id}        → {ok}
//   quick {text}      → {task}           Todoist reads date, time, p1, #project
//   completed {since} → {items}          completed since an ISO time
import { bearer, config, readBody, send, sessionOk } from './_lib.mjs'
import { createTodoistApi } from './_bot/bot.mjs'

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
  const api = createTodoistApi(token)
  try {
    switch (body?.op) {
      case 'today':
        return send(res, 200, { connected: true, tasks: await api.today() })
      case 'close':
        await api.close(String(body.id))
        return send(res, 200, { ok: true })
      case 'quick':
        return send(res, 200, { task: await api.quickAdd(String(body.text || '').slice(0, 500)) })
      case 'completed':
        return send(res, 200, { items: await api.completedSince(String(body.since || new Date(Date.now() - 86400_000).toISOString())) })
      default:
        return send(res, 400, { error: 'Unknown op' })
    }
  } catch (e) {
    send(res, 502, { error: e.message || 'Todoist failed' })
  }
}
