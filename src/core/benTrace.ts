// Where one of Ben's answers spends its time (speed work): each step of think()
// (reading the day, building the prompt, every model call, every lookup round)
// with its milliseconds, and how big each prompt was. Pure; the server logs it
// as one line per answer and the speed tests read it. Never holds message text.

export interface BenCall {
  /** The call's label for the usage page: chat, chat-deep, lookup, plan-names… */
  kind: string
  strong: boolean
  ms: number
  /** Prompt size in characters and a rough token count (about 4 characters a token). */
  chars: number
  tokens: number
  /** Milliseconds from the start of the answer to the first streamed words, when it streamed. */
  firstTextMs?: number
  ok: boolean
}

export interface BenTiming {
  totalMs: number
  /** The first words of the reply on screen (streamed or whole), from the start. */
  firstTextMs: number | null
  intent: string
  /** "model", "code" (no model call) or "quick" (an instant answer from the data). */
  path: string
  spans: { name: string; ms: number }[]
  calls: BenCall[]
  /** Lookup rounds after the first answer (each is another model call). */
  rounds: number
}

export const roughTokens = (chars: number) => Math.ceil(chars / 4)

export function createTrace(now: () => number = Date.now) {
  const t0 = now()
  let last = t0
  const spans: { name: string; ms: number }[] = []
  const calls: BenCall[] = []
  let firstText: number | null = null
  let rounds = 0
  return {
    /** Closes the step that ran since the last mark. */
    mark(name: string) {
      const t = now()
      spans.push({ name, ms: t - last })
      last = t
    },
    /** The first words reached the screen. */
    text() {
      if (firstText == null) firstText = now() - t0
    },
    round() {
      rounds++
    },
    /** Times one model call (its prompt size too). */
    async call<T>(kind: string, strong: boolean, prompt: string, run: (onFirst: () => void) => Promise<T>): Promise<T> {
      const s = now()
      let first: number | undefined
      const onFirst = () => {
        if (first == null) first = now() - t0
      }
      const done = (ok: boolean) => calls.push({ kind, strong, ms: now() - s, chars: prompt.length, tokens: roughTokens(prompt.length), ...(first != null ? { firstTextMs: first } : {}), ok })
      try {
        const r = await run(onFirst)
        done(true)
        return r
      } catch (e) {
        done(false)
        throw e
      }
    },
    elapsed: () => now() - t0,
    summary(intent: string, path: string): BenTiming {
      const t = now()
      if (t > last) spans.push({ name: 'finish', ms: t - last })
      last = t
      return { totalMs: t - t0, firstTextMs: firstText ?? t - t0, intent, path, spans: [...spans], calls: [...calls], rounds }
    }
  }
}

/** One short log line: "plan code 1840ms first 1840ms | read 620 · plan 1100 | plan-names quick 1050ms 900tok". */
export function timingLine(t: BenTiming): string {
  const spans = t.spans.filter((s) => s.ms >= 5).map((s) => `${s.name} ${s.ms}`).join(' · ')
  const calls = t.calls.map((c) => `${c.kind} ${c.strong ? 'strong' : 'quick'} ${c.ms}ms ${c.tokens}tok${c.ok ? '' : ' failed'}`).join(', ')
  return `ben ${t.intent} ${t.path} ${t.totalMs}ms first ${t.firstTextMs ?? '-'}ms${t.rounds ? ` rounds ${t.rounds}` : ''} | ${spans}${calls ? ` | ${calls}` : ''}`
}
