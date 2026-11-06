// Meetings on the island (MT3, AI17), the part that needs your data: the
// island window has no data of its own, so it asks the app window over a
// BroadcastChannel (same origin, nothing leaves the PC):
// - save: the captions as a Notebook note (only when you tapped Save);
// - replies: 3 short replies from the AI, with Ben's People note;
// - paste / deny: a reply typed into the app in front through the PC action
//   ("Ben can do things on this PC", checked again by the desktop), never sent.
import { parseReplies, peopleNote, replyPrompt } from '@core/replyHelper'

const CH = 'life-island-meet'
export type MeetOp = { op: 'save'; title: string; body: string } | { op: 'replies'; app: string; message: string } | { op: 'paste'; text: string } | { op: 'deny'; text: string }
type Msg = ({ type: 'ask'; id: string } & MeetOp) | { type: 'ack'; id: string } | { type: 'done'; id: string; result: unknown } | { type: 'fail'; id: string; why: string }

/** From the island: ask the app window, wait for its answer. */
export async function askMeetHost<T>(op: MeetOp, timeoutMs = 60_000): Promise<T> {
  if (typeof BroadcastChannel === 'undefined') throw new Error('Not available here')
  const ch = new BroadcastChannel(CH)
  const id = Math.random().toString(36).slice(2, 10)
  try {
    return await new Promise<T>((resolve, reject) => {
      const noHost = window.setTimeout(() => reject(new Error("The app didn't answer. Open Life System from the tray.")), 4000)
      const stuck = window.setTimeout(() => reject(new Error('That took too long')), timeoutMs)
      ch.onmessage = (e: MessageEvent<Msg>) => {
        const m = e.data
        if (!m || m.id !== id) return
        if (m.type === 'ack') return clearTimeout(noHost)
        clearTimeout(noHost)
        clearTimeout(stuck)
        if (m.type === 'done') resolve(m.result as T)
        else if (m.type === 'fail') reject(new Error(m.why))
      }
      ch.postMessage({ type: 'ask', id, ...op } satisfies Msg)
    })
  } finally {
    ch.close()
  }
}

const bridge = () => import('./bridge').then((m) => m.life)

async function saveNote(title: string, body: string): Promise<string> {
  const life = await bridge()
  if (!life.notes) throw new Error('The Notebook is not available')
  const t = title.slice(0, 120)
  const notes = await life.notes.list().catch(() => [])
  // Two saves of the same meeting on one day: "(2)", "(3)"…
  let name = t
  for (let n = 2; notes.some((x) => x.title.toLowerCase() === name.toLowerCase()); n++) name = `${t} (${n})`
  await life.notes.save({ title: name, body: body.replace(/^# .*$/m, `# ${name}`).slice(0, 400_000) })
  return name
}

async function replies(app: string, message: string): Promise<string[]> {
  const life = await bridge()
  const view = await life.coach?.brain?.view().catch(() => null)
  const { serverAi } = await import('./web/webAi')
  const { currentSession } = await import('./web/session')
  const r = await serverAi(currentSession)(replyPrompt({ app, message: message.slice(0, 800), people: peopleNote(view?.blocks) }))
  const list = parseReplies(r.text)
  if (!list.length) throw new Error('The AI gave no replies: try again')
  return list
}

async function paste(text: string, op: 'run' | 'deny'): Promise<string> {
  const pcx = window.desktop?.pcx
  if (!pcx) throw new Error('Paste works in the Windows app only')
  const act = { kind: 'type', arg: text.replace(/\s+/g, ' ').trim().slice(0, 200) }
  const r = await pcx(op, act)
  if (op === 'deny') return 'Not pasted'
  if (!r?.ok) throw new Error(r?.why || 'It did not paste')
  return 'Pasted (not sent: check it and press Enter yourself)'
}

/** In the app window (desktop): answers the island's meeting and reply asks. */
export function startMeetHost(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {}
  const ch = new BroadcastChannel(CH)
  ch.onmessage = async (e: MessageEvent<Msg>) => {
    const m = e.data
    if (m?.type !== 'ask' || typeof m.id !== 'string') return
    ch.postMessage({ type: 'ack', id: m.id } satisfies Msg)
    try {
      const result =
        m.op === 'save' ? await saveNote(String(m.title), String(m.body)) : m.op === 'replies' ? await replies(String(m.app), String(m.message)) : m.op === 'paste' || m.op === 'deny' ? await paste(String(m.text), m.op === 'paste' ? 'run' : 'deny') : null
      ch.postMessage({ type: 'done', id: m.id, result } satisfies Msg)
      if (m.op === 'save') window.dispatchEvent(new CustomEvent('life-external-changed'))
    } catch (err) {
      ch.postMessage({ type: 'fail', id: m.id, why: (err as Error)?.message || 'It did not work' } satisfies Msg)
    }
  }
  return () => ch.close()
}
