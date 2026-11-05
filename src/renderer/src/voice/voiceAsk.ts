// What you said goes to Ben the same way the Coach chat sends it
// (life.coach.chat, his reply streaming in). The desktop island has no data
// of its own: it asks the app window over a BroadcastChannel (same origin,
// nothing leaves the PC), which runs the chat and streams the reply back.
// The island window never loads the app's data layer: the bridge is imported only where it runs.
const bridge = () => import('../bridge').then((m) => m.life)

const CH = 'life-voice-ask'
type Msg =
  | { type: 'ask'; id: string; text: string }
  | { type: 'ack'; id: string }
  | { type: 'delta'; id: string; soFar: string }
  | { type: 'done'; id: string; reply: string }
  | { type: 'fail'; id: string; why: string }

/** Ben's answer to `text`, with his words as they arrive. */
export async function askBen(text: string, onDelta: (soFar: string) => void): Promise<string> {
  if (!/[?&]island=1/.test(location.search)) {
    const life = await bridge()
    if (!life.coach?.chat) throw new Error('Ben is not available here')
    const r = await life.coach.chat(text, undefined, undefined, onDelta)
    return r.reply
  }
  if (typeof BroadcastChannel === 'undefined') throw new Error('Ben is not available here')
  const ch = new BroadcastChannel(CH)
  const id = Math.random().toString(36).slice(2, 10)
  try {
    return await new Promise<string>((resolve, reject) => {
      const noHost = window.setTimeout(() => reject(new Error("The app didn't answer. Open Life System from the tray.")), 4000)
      let stuck = window.setTimeout(() => reject(new Error('Ben took too long')), 120_000)
      ch.onmessage = (e: MessageEvent<Msg>) => {
        const m = e.data
        if (!m || m.id !== id) return
        if (m.type === 'ack') clearTimeout(noHost)
        else if (m.type === 'delta') onDelta(m.soFar)
        else if (m.type === 'done') (clearTimeout(stuck), resolve(m.reply))
        else if (m.type === 'fail') (clearTimeout(stuck), reject(new Error(m.why)))
        if (m.type !== 'ack') {
          clearTimeout(stuck)
          stuck = window.setTimeout(() => reject(new Error('Ben took too long')), 120_000)
        }
      }
      ch.postMessage({ type: 'ask', id, text } satisfies Msg)
    })
  } finally {
    ch.close()
  }
}

/** In the app window (desktop): answers the island's voice questions. */
export function startVoiceAskHost(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const ch = new BroadcastChannel(CH)
  ch.onmessage = async (e: MessageEvent<Msg>) => {
    const m = e.data
    if (m?.type !== 'ask' || typeof m.text !== 'string' || !m.text.trim()) return
    ch.postMessage({ type: 'ack', id: m.id } satisfies Msg)
    try {
      const life = await bridge()
      if (!life.coach?.chat) throw new Error('Ben is not available here')
      const r = await life.coach.chat(m.text.slice(0, 2000), undefined, undefined, (soFar) => ch.postMessage({ type: 'delta', id: m.id, soFar } satisfies Msg))
      ch.postMessage({ type: 'done', id: m.id, reply: r.reply } satisfies Msg)
      window.dispatchEvent(new CustomEvent('life-external-changed'))
    } catch (err) {
      ch.postMessage({ type: 'fail', id: m.id, why: (err as Error).message || 'no connection' } satisfies Msg)
    }
  }
  return () => ch.close()
}
