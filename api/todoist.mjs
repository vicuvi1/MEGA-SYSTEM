// POST /api/todoist (session required) {op, ...}: your Todoist for the app,
// with the token kept on the server (TODOIST_TOKEN in Vercel).
//   status            → {connected}
//   today             → {tasks}          due today or overdue
//   changes {token}   → {token, changed, items}  what changed in Todoist since token (cheap, every few s);
//                       items: each changed task with checked / deleted
//   lookup {ids, since} → {tasks: [{id, state: open|done|gone, task?}]}  where tasks are now
//   upcoming          → {tasks}          due or deadline in the next 7 days
//   close {id}        → {ok}
//   quick {text}      → {task}           Todoist reads date, time, p1, #project
//   completed {since} → {items}          completed since an ISO time
//   everything        → {tasks, areas}   every open task and your areas
//   update {id, content?, priority?, due?, description?, labels?, duration?} → {ok, task}
//   move {id, area}   reopen {id}   remove {id}
//   addArea {name}  → {area}   renameArea {area, name}
//   cleanup           → {changes, ai}    suggested fixes to approve (AI, else duplicates/overdue)
// New tasks without a #project go to the right area (by their words, else Gemini).
// Every op but status and cleanup runs in src/server/todoistApi.ts (todoistOp), shared with the tests.
import { bearer, config, readBody, send, requireSession, countCall } from './_lib.mjs'
import { cleanupPrompt, createTodoistApi, localCleanup, parseCleanup, todoistOp } from './_bot/bot.mjs'
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
  await countCall(config(), 'todoist') // CL2: counted for Settings → System health
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  if (!(await requireSession(res, config(), bearer(req)))) return
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
    if (body?.op === 'cleanup') {
      const { tasks, areas } = await api.everything()
      const today = String(body.today || new Date().toISOString().slice(0, 10)).slice(0, 10)
      try {
        const r = await askModel(cleanupPrompt(tasks, areas, today), { json: true })
        return send(res, 200, { changes: parseCleanup(r.text, tasks, areas), ai: true })
      } catch (e) {
        return send(res, 200, { changes: localCleanup(tasks, today), ai: false, error: String(e?.message || e) })
      }
    }
    const r = await todoistOp(api, body)
    if (!r) return send(res, 400, { error: 'Unknown op' })
    return send(res, r.status, r.json)
  } catch (e) {
    send(res, 502, { error: e.message || 'Todoist failed' })
  }
}
