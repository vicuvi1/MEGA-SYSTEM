// Ben's log rows: his messages (sent, held back, failed) and AI calls in one timeline.
export interface BenLogEntry { at?: string; status: 'sent' | 'skipped' | 'failed'; kind: string; reason?: string; text?: string }
export interface AiCall { at: string; model: string; kind: string | null; prompt: number | null; completion: number | null; cost: number | null }
export type LogRow = { at: string; type: 'msg'; e: BenLogEntry & { at: string } } | { at: string; type: 'ai'; c: AiCall }

/** Messages and AI calls merged, newest first. */
export function mergeLog(msgs: (BenLogEntry & { at: string })[], calls: AiCall[]): LogRow[] {
  return [...msgs.map((e) => ({ at: e.at, type: 'msg' as const, e })), ...calls.map((c) => ({ at: c.at, type: 'ai' as const, c }))].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}
