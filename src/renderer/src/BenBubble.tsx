// Ben everywhere: his face floats in the corner of every page (like chat
// heads). Tap it for a mini chat over whatever you're doing; the full chat
// is one tap away. Same brain, memory and log as the Coach page and Telegram.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoachStatus } from './web/coachStatus'
import { MOOD_FACE, type Mood } from '@core/coachKit'
import { life } from './bridge'
import { useLive } from './live'

type Msg = { role: 'me' | 'coach'; text: string; at: string; mood?: string; done?: string[]; chips?: string[]; pending?: boolean; steps?: string[] }

export function BenBubble({ hidden, unread, onOpenChat }: { hidden: boolean; unread: number; onOpenChat: () => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<CoachStatus | null>(null)
  const [log, setLog] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  busyRef.current = busy

  const load = useCallback(() => {
    if (!life.coach) return
    life.coach.status?.().then(setStatus).catch(() => {})
    if (busyRef.current) return
    life.coach
      .log()
      .then((l) => setLog(l.slice(-12).map((e) => ({ role: e.role, text: e.text, at: e.at, mood: e.mood, done: e.done, chips: e.chips }))))
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])
  useLive(load)
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' })
  }, [open, log.length, log[log.length - 1]?.steps?.length])

  if (!life.coach || hidden) return null

  const send = async (msg = text) => {
    const t = msg.trim()
    if (!t || busy) return
    setText('')
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...l, { role: 'me', text: t, at: now }, { role: 'coach', text: '', at: now, pending: true, steps: [] }])
    try {
      const seen: string[] = []
      const r = await life.coach!.chat(t, (st) => {
        if (seen.includes(st)) return
        seen.push(st)
        setLog((l) => l.map((x) => (x.pending ? { ...x, steps: [...seen] } : x)))
      })
      setLog((l) => [...l.filter((x) => !x.pending), { role: 'coach', text: r.reply, at: r.at ?? new Date().toISOString(), mood: r.mood, done: r.done, chips: r.chips }])
    } catch (e) {
      setLog((l) => [...l.filter((x) => !x.pending), { role: 'coach', text: `I couldn't answer: ${(e as Error).message}`, at: new Date().toISOString() }])
    }
    setBusy(false)
    life.coach!.status?.().then(setStatus).catch(() => {})
  }

  const face = status?.face ?? '✦'
  const lastCoach = [...log].reverse().find((x) => x.role === 'coach' && !x.pending)
  const chips = lastCoach?.chips?.length ? lastCoach.chips : ['What now?', 'Plan my day', 'Push me']

  return (
    <>
      {open && (
        <div className="bb-panel" role="dialog" aria-label="Chat with Ben">
          <header className="bb-head">
            <span className={`bb-face mood-${status?.mood ?? 'chill'}`}>{face}</span>
            <div>
              <b>Ben</b>
              <small>{busy ? 'thinking…' : status ? `${status.mood} · ${status.why}` : 'your coach'}</small>
            </div>
            <button className="bb-x" onClick={() => (setOpen(false), onOpenChat())} title="Open the full chat">
              ⤢
            </button>
            <button className="bb-x" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </header>
          {status && status.move.kind !== 'ask' && (
            <div className="bb-move">
              <small>Do this now</small> {status.move.title}
            </div>
          )}
          <div className="bb-stream">
            {log.map((m, i) => (
              <div key={i} className={`bb-msg ${m.role}`}>
                {m.pending ? (
                  <span className="bb-typing">
                    <i />
                    <i />
                    <i />
                    {m.steps?.length ? <em>{m.steps[m.steps.length - 1]}…</em> : null}
                  </span>
                ) : (
                  <>
                    {m.text}
                    {!!m.done?.length && <small className="bb-done">{m.done.join(' · ')}</small>}
                  </>
                )}
              </div>
            ))}
            <div ref={end} />
          </div>
          <div className="bb-chips">
            {chips.slice(0, 3).map((c) => (
              <button key={c} disabled={busy} onClick={() => void send(c)}>
                {c}
              </button>
            ))}
          </div>
          <form
            className="bb-form"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Ben…" />
            <button disabled={busy || !text.trim()} aria-label="Send">
              ↑
            </button>
          </form>
        </div>
      )}
      <button className={`bb-bubble mood-${status?.mood ?? 'chill'} ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close Ben' : 'Talk to Ben'} title="Talk to Ben">
        <span>{open ? '✕' : lastCoach?.mood && MOOD_FACE[lastCoach.mood as Mood] && !status ? MOOD_FACE[lastCoach.mood as Mood] : face}</span>
        {!open && unread > 0 && <i className="bb-badge">{unread}</i>}
      </button>
    </>
  )
}
