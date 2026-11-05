// AU8 phone push by ntfy, AU9 n8n flows (webhooks out, one door in), AU10 the
// MCP servers Ben may use. The settings live on the server only (sys_kv: never
// copied to devices, never sent back to pages after saving: pages see a hint
// like "ntfy.sh · …k3x9"). Pure and tested.
import { urlHint, urlProblem } from './netGuard'

// ---- AU8: ntfy ----

export interface NtfyConf { server: string; topic: string; /** 'reminders': your reminders and urgent alerts; 'all': everything Ben sends. */ level: 'reminders' | 'all' }
export const NTFY_DEFAULT = 'https://ntfy.sh'
export const TOPIC_RE = /^[A-Za-z0-9_-]{6,64}$/

export function cleanNtfy(v: unknown): NtfyConf | null {
  const o = v as Partial<NtfyConf> | null
  if (!o || typeof o !== 'object' || !TOPIC_RE.test(String(o.topic ?? ''))) return null
  const server = String(o.server || NTFY_DEFAULT).trim().replace(/\/+$/, '')
  if (urlProblem(server)) return null
  return { server, topic: String(o.topic), level: o.level === 'all' ? 'all' : 'reminders' }
}

/** What a page may see: the server and the topic's last 4 letters. */
export const ntfyView = (c: NtfyConf | null) => (c ? { on: true, server: c.server, topicHint: `…${c.topic.slice(-4)}`, level: c.level } : { on: false, server: NTFY_DEFAULT, topicHint: '', level: 'reminders' as const })

/** Telegram HTML → plain text for a phone notification (title = the first line, short). */
export function ntfyMessage(html: string): { title: string; body: string } {
  const plain = String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
  const [first, ...rest] = plain.split('\n')
  const title = first.length <= 80 ? first : `${first.slice(0, 77)}…`
  const body = (rest.join('\n').trim() || (first.length > 80 ? first : '')).slice(0, 1000)
  return { title: title || 'Life System', body: body || title || ' ' }
}

/** Should this message also go to the phone by ntfy? Your reminders (🔔 ⏰) and urgent ones always; the rest with "all". */
export function ntfyWants(c: NtfyConf | null, text: string, urgent: boolean): boolean {
  if (!c) return false
  if (c.level === 'all' || urgent) return true
  return /^\s*(🔔|⏰)/u.test(String(text ?? '').replace(/<[^>]+>/g, ''))
}

// ---- AU9: webhooks out ----

export const HOOK_EVENTS = ['task_done', 'focus_done', 'habit_logged', 'day_closed', 'mustdo_late'] as const
export type HookEvent = (typeof HOOK_EVENTS)[number]
export const HOOK_EVENT_LABEL: Record<HookEvent, string> = { task_done: 'A task is done', focus_done: 'A focus block is done', habit_logged: 'A habit is logged', day_closed: 'The day is closed', mustdo_late: 'Must-dos still open at 20:00' }

export interface Hook { id: string; url: string; events: HookEvent[]; on: boolean; last?: { at: number; status: number | string } }
export interface HookState { hooks: Hook[]; /** The last ledger row looked at; days closed / late already sent. */ seen: { ledger: number; closed: string[]; late: string[] } }

export function cleanHooks(v: unknown): HookState {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<HookState>
  const hooks = (Array.isArray(o.hooks) ? o.hooks : [])
    .filter((h) => h && typeof h.id === 'string' && !urlProblem(String(h.url)))
    .map((h) => ({ id: String(h.id).slice(0, 16), url: String(h.url), events: (Array.isArray(h.events) ? h.events : []).filter((e: string): e is HookEvent => (HOOK_EVENTS as readonly string[]).includes(e)), on: h.on !== false, ...(h.last ? { last: { at: Number(h.last.at) || 0, status: typeof h.last.status === 'number' ? h.last.status : String(h.last.status).slice(0, 60) } } : {}) }))
    .slice(0, 5)
  const s = o.seen as HookState['seen'] | undefined
  return { hooks, seen: { ledger: Number(s?.ledger) || 0, closed: Array.isArray(s?.closed) ? s!.closed.slice(-10).map(String) : [], late: Array.isArray(s?.late) ? s!.late.slice(-10).map(String) : [] } }
}

export const hooksView = (s: HookState) => s.hooks.map((h) => ({ id: h.id, urlHint: urlHint(h.url), events: h.events, on: h.on, last: h.last ?? null }))

/** The small JSON each webhook gets. */
export interface HookPayload { event: HookEvent | 'test'; at: string; day: string; text: string; points?: number; source: 'life-system' }

/** A point earned → the event it is (null: not one you can hook). Undone rows never count. */
export function ledgerEvent(rule: string | null, module: string): HookEvent | null {
  const r = String(rule ?? '')
  if (r === 'focus.session') return 'focus_done'
  if (r === 'tasks.todoist_done' || r === 'plan.item_done' || r === 'study.block_done') return 'task_done'
  if (/^(sleep\.|discipline\.(oath|clean_day|urge_resisted)|body\.workout_done|face\.|habit\.|money\.(logged|cooked_home|no_spend))/.test(r)) return 'habit_logged'
  if (!r && module === 'habits') return 'habit_logged'
  return null
}

/**
 * New ledger rows (id, ts, day, module, kind, coins, rule, note, undone) →
 * payloads, oldest first, at most `max`. The first look only remembers where
 * it is (no flood of old events).
 */
export function eventsFromLedger(rows: { id: number; ts: string; day: string; module: string; kind: string; coins: number; rule: string | null; note: string | null; undone: boolean }[], seen: number, max = 10): { events: HookPayload[]; seen: number } {
  const sorted = [...rows].sort((a, b) => a.id - b.id)
  const top = sorted.length ? sorted[sorted.length - 1].id : seen
  if (!seen) return { events: [], seen: top }
  const out: HookPayload[] = []
  let last = seen
  for (const r of sorted) {
    if (r.id <= seen) continue
    if (out.length >= max) break
    last = r.id
    if (r.kind !== 'earn' || r.undone) continue
    const ev = ledgerEvent(r.rule, r.module)
    if (ev) out.push({ event: ev, at: r.ts, day: r.day, text: String(r.note ?? '').slice(0, 140), points: r.coins, source: 'life-system' })
  }
  return { events: out, seen: Math.max(last, seen) }
}

/** Which webhooks get this event. */
export const hooksFor = (s: HookState, ev: HookPayload['event']) => s.hooks.filter((h) => h.on && (ev === 'test' || h.events.includes(ev as HookEvent)))

// ---- AU9: the one door in (n8n → Life System) ----

export type InAction = 'add_task' | 'note' | 'ask_ben' | 'log_habit'
/**
 * {action: …} from a flow → the Life System MCP tool call that does it
 * (the same honest paths as the app: a habit pays only when it is logged now).
 */
export function inboundCall(body: unknown): { name: string; arguments: Record<string, unknown> } | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const s = (k: string, max: number) => String(b[k] ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max)
  switch (b.action) {
    case 'add_task': {
      const text = s('text', 300)
      return text.length >= 2 ? { name: 'add_task', arguments: { text } } : { error: 'add_task needs "text"' }
    }
    case 'note': {
      const line = s('text', 500)
      return line ? { name: 'add_note', arguments: { title: s('title', 80) || 'Inbox', line } } : { error: 'note needs "text"' }
    }
    case 'ask_ben': {
      const message = s('text', 2000) || s('message', 2000)
      return message ? { name: 'ask_ben', arguments: { message } } : { error: 'ask_ben needs "text"' }
    }
    case 'log_habit': {
      const habit = s('habit', 30).toLowerCase()
      return ['oath', 'clean', 'skincare'].includes(habit) ? { name: 'log_habit', arguments: { habit } } : { error: 'log_habit needs "habit": oath, clean or skincare' }
    }
    default:
      return { error: 'action must be add_task, note, ask_ben or log_habit' }
  }
}

// ---- AU10: MCP servers Ben may use ----

export interface McpTool { name: string; description: string; allowed: boolean }
export interface McpServer { id: string; label: string; url: string; token: string; tools: McpTool[]; at: number; error?: string }

export function cleanMcpServers(v: unknown): McpServer[] {
  return (Array.isArray(v) ? v : [])
    .filter((x) => x && typeof x.id === 'string' && !urlProblem(String(x.url)))
    .map((x) => ({
      id: String(x.id).slice(0, 16),
      label: String(x.label ?? '').slice(0, 40) || urlHint(String(x.url)),
      url: String(x.url),
      token: typeof x.token === 'string' ? x.token.slice(0, 2000) : '',
      tools: cleanTools(x.tools, x.tools),
      at: Number(x.at) || 0,
      ...(x.error ? { error: String(x.error).slice(0, 160) } : {})
    }))
    .slice(0, 5)
}

/** tools/list's tools → ours (name, short description), keeping what you allowed before. */
export function cleanTools(list: unknown, before: unknown): McpTool[] {
  const was = new Map((Array.isArray(before) ? before : []).map((t: any) => [String(t?.name), t?.allowed === true]))
  return (Array.isArray(list) ? list : [])
    .filter((t: any) => t && /^[A-Za-z0-9_.:-]{1,64}$/.test(String(t.name)))
    .map((t: any) => ({ name: String(t.name), description: String(t.description ?? t.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), allowed: was.get(String(t.name)) === true }))
    .slice(0, 60)
}

/** What a page sees: never the token or the full address. */
export const mcpView = (list: McpServer[]) => list.map((s) => ({ id: s.id, label: s.label, urlHint: urlHint(s.url), hasToken: !!s.token, tools: s.tools, at: s.at, error: s.error ?? null }))

/** The tools Ben may call, each once by name (the first server that has it). */
export function allowedTools(list: McpServer[]): { name: string; description: string; server: McpServer }[] {
  const out: { name: string; description: string; server: McpServer }[] = []
  for (const s of list) for (const t of s.tools) if (t.allowed && !out.some((o) => o.name === t.name)) out.push({ name: t.name, description: t.description, server: s })
  return out.slice(0, 20)
}

/** A tools/call answer → short text for Ben (text parts only, capped). */
export function toolResultText(result: unknown, max = 1500): string {
  const r = result as { content?: { type?: string; text?: string }[]; structuredContent?: unknown; isError?: boolean } | null
  if (!r || typeof r !== 'object') return 'No answer.'
  const parts = (Array.isArray(r.content) ? r.content : []).filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text!)
  let text = parts.join('\n').trim()
  if (!text && r.structuredContent) text = JSON.stringify(r.structuredContent)
  if (!text) text = '(no text in the answer)'
  text = text.replace(/[\u0000-\u0008\u000b-\u001f]+/g, ' ')
  return `${r.isError ? 'Error: ' : ''}${text.length > max ? `${text.slice(0, max)}… (cut)` : text}`
}

/** One JSON-RPC answer out of a Streamable HTTP reply: plain JSON, or the matching `data:` of an event stream. */
export function rpcFromBody(body: string, contentType: string, id: number | string): any | null {
  const pick = (j: any) => (Array.isArray(j) ? j.find((x) => x?.id === id) ?? null : j && (j.id === id || j.id === undefined) ? j : null)
  if (/text\/event-stream/i.test(contentType)) {
    for (const block of body.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        const j = pick(JSON.parse(data))
        if (j && (j.result !== undefined || j.error !== undefined)) return j
      } catch {
        /* not JSON */
      }
    }
    return null
  }
  try {
    return pick(JSON.parse(body))
  } catch {
    return null
  }
}
