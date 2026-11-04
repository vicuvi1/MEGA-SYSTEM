// Runs Ben's test (core/benEval) on throwaway in-memory data: a fresh fake
// database per case, made-up calendar blocks and Todoist tasks that only
// record what Ben does. Your real data is never touched.
import type { SqlJsStatic } from 'sql.js'
import { EVAL_CASES, judge, type EvalResult } from '@core/benEval'
import { MIGRATIONS } from '@core/schema'
import type { CalEvent } from '@core/dayTime'
import type { TodoTask } from '@core/todoist'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { Mirror } from '../renderer/src/web/mirror'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { createWebBots, type AskModel } from '../renderer/src/web/webBots'
import { createWebServices } from '../renderer/src/web/webServices'

async function runOne(SQL: SqlJsStatic, model: AskModel, c: (typeof EVAL_CASES)[number]): Promise<EvalResult> {
  const t0 = Date.now()
  const log: string[] = []
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const fakeFetch = (async (_url: string, init?: RequestInit) => {
    const out = handlePipeline(remote, JSON.parse(String(init?.body ?? '{}')))
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  const mirror = new Mirror(SQL, new TursoHttp('https://eval.local', 't', undefined, fakeFetch), null)
  await mirror.ready
  const services = createWebServices(mirror)
  const today = await services.read((s) => s.wallet.today())
  const at = (h: number, m = 0) => new Date(`${today}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
  const events: CalEvent[] = [
    { id: 'g1', calendarId: 'cal', title: 'Deep block', start: at(9), end: at(10), allDay: false },
    { id: 'g2', calendarId: 'cal', title: 'Lab: Programming', start: at(13, 30), end: at(15), allDay: false },
    { id: 'g3', calendarId: 'cal', title: 'Gym', start: at(19), end: at(20), allDay: false },
    { id: 'g4', calendarId: 'cal', title: 'Reading', start: at(21), end: at(21, 30), allDay: false }
  ]
  const task = (id: string, content: string): TodoTask => ({ id, content, priority: 1, due: today, dueTime: null, project: 'Inbox', recurring: false }) as TodoTask
  const tasks = [task('t1', 'etica'), task('t2', 'sport'), task('t3', 'laborator 4 PC')]
  const calendar = {
    events: async () => events,
    create: async (e: { title: string; start: string; end: string }) => {
      log.push(`calendar.create ${e.title} ${localIso(e.start)} → ${localIso(e.end)}`)
      return { ...e, id: 'new', calendarId: 'cal', allDay: false } as CalEvent
    },
    move: async (_cal: string, id: string, start: string, end: string) => void log.push(`calendar.move ${id} ${localIso(start)} → ${localIso(end)}`),
    remove: async (_cal: string, id: string) => void log.push(`calendar.remove ${id}`)
  }
  const todoist = {
    today: async () => tasks,
    upcoming: async () => [],
    everything: async () => ({ tasks, areas: [{ key: 'p:inbox', name: 'Inbox' }] }),
    close: async (id: string) => void log.push(`todoist.close ${id}`),
    quickAdd: async (text: string) => (log.push(`todoist.quickAdd ${text}`), task('t9', text)),
    update: async (id: string, patch: object) => void log.push(`todoist.update ${id} ${JSON.stringify(patch)}`),
    move: async (id: string, area: string) => void log.push(`todoist.move ${id} ${area}`),
    remove: async (id: string) => void log.push(`todoist.remove ${id}`)
  }
  const bots = createWebBots({ mirror, services, defaults: { botToken: '1:eval', chatId: '1' } as any, todoist, calendar, ai: model })
  try {
    const r = await bots.think(c.say, `eval:${c.id}`)
    const trace = [...log, ...r.done, `REPLY: ${r.reply.replace(/\s+/g, ' ')}`].join('\n')
    return { id: c.id, say: c.say, want: c.want, ok: r.ok && judge(c, trace), trace, ms: Date.now() - t0 }
  } catch (e) {
    return { id: c.id, say: c.say, want: c.want, ok: false, trace: log.join('\n'), ms: Date.now() - t0, error: (e as Error).message }
  }
}

/** Local "YYYY-MM-DDTHH:MM" (what the checks read). */
const localIso = (iso: string) => {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** All cases at once; what isn't done by `deadlineMs` counts as a timeout. */
export async function runBenEval(SQL: SqlJsStatic, model: AskModel, deadlineMs = 50_000): Promise<{ passed: number; total: number; results: EvalResult[] }> {
  const results = await Promise.all(
    EVAL_CASES.map((c) =>
      Promise.race([
        runOne(SQL, model, c),
        new Promise<EvalResult>((ok) => setTimeout(() => ok({ id: c.id, say: c.say, want: c.want, ok: false, trace: '', ms: deadlineMs, error: 'timed out' }), deadlineMs))
      ])
    )
  )
  return { passed: results.filter((r) => r.ok).length, total: results.length, results }
}
