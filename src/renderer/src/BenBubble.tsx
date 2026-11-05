// Ben everywhere: his face floats in the corner of every page (like chat
// heads). Tap it for a mini chat over whatever you're doing; the full chat
// is one tap away. Same brain, memory and log as the Coach page and Telegram.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoachStatus } from './web/coachStatus'
import { MOOD_FACE, type Mood } from '@core/coachKit'
import { life } from './bridge'
import { useLive } from './live'

import { ReplyExtras, Rich } from './BenThread'

type Msg = { role: 'me' | 'coach'; text: string; at: string; mood?: string; done?: string[]; chips?: string[]; pending?: boolean; steps?: string[]; undo?: unknown[]; undone?: boolean[]; buttons?: { label: string; do: string }[]; show?: string[]; failed?: string; streamed?: boolean }
// The face can be dragged (U15); where you put it is remembered.
const POS_KEY = 'ls.benBubblePos'

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
      .then((l) => setLog(l.slice(-12).map((e: any) => ({ role: e.role, text: e.text, at: e.at, mood: e.mood, done: e.done, chips: e.chips, undo: e.undo, undone: e.undone, buttons: e.buttons, show: e.show }))))
      .catch(() => {})
  }, [])
  useEffect(() => {
    load()
    // CL2: only while you can see it; new messages arrive with live data anyway.
    const t = setInterval(() => document.visibilityState !== 'hidden' && load(), 60_000)
    const vis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [load])
  useLive(load)
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'end' })
  }, [open, log.length, log[log.length - 1]?.steps?.length])

  // U15: drag the face out of the way (a quick tap still opens it).
  const [pos, setPos] = useState<{ right: number; bottom: number } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    } catch {
      return null
    }
  })
  const dragRef = useRef<{ x: number; y: number; r: number; b: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    dragRef.current = { x: e.clientX, y: e.clientY, r: window.innerWidth - r.right, b: window.innerHeight - r.bottom, moved: false }
    el.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 8) return
    d.moved = true
    setPos({ right: Math.max(8, Math.min(window.innerWidth - 64, d.r - dx)), bottom: Math.max(8, Math.min(window.innerHeight - 64, d.b - dy)) })
  }
  const onUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos))
      } catch {
        /* fine */
      }
      return
    }
    setOpen((o) => !o)
  }

  if (!life.coach || hidden) return null

  // "Plan my day" is the same plan as Today's card (D1), not a free chat.
  const planDay = async () => {
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...l, { role: 'me', text: 'Plan my day', at: now }, { role: 'coach', text: '', at: now, pending: true, steps: [] }])
    try {
      const r = await life.coach!.rhythm!('propose')
      const head = r.state.briefing?.plan?.headline
      setLog((l) => [...l.filter((x) => !x.pending), { role: 'coach', text: head ? `Here's today: ${head}. It's on Today: approve it there, or tell me what to change.` : 'Your plan is on Today: approve it there, or tell me what to change.', at: new Date().toISOString() }])
      window.dispatchEvent(new CustomEvent('life-coach-changed'))
    } catch (e) {
      setLog((l) => [...l.filter((x) => !x.pending), { role: 'coach', text: `I couldn't plan it: ${(e as Error).message}`, at: new Date().toISOString() }])
    }
    setBusy(false)
  }

  const send = async (msg = text) => {
    const t = msg.trim()
    if (!t || busy) return
    setText('')
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...l, { role: 'me', text: t, at: now }, { role: 'coach', text: '', at: now, pending: true, steps: [] }])
    try {
      const seen: string[] = []
      const r = await life.coach!.chat(
        t,
        (st) => {
          if (seen.includes(st)) return
          seen.push(st)
          setLog((l) => l.map((x) => (x.pending ? { ...x, steps: [...seen] } : x)))
        },
        undefined,
        (soFar) => setLog((l) => l.map((x) => (x.pending ? { ...x, text: soFar, streamed: true } : x)))
      )
      setLog((l) => [...l.filter((x) => !x.pending), { role: 'coach', text: r.reply, at: r.at ?? new Date().toISOString(), mood: r.mood, done: r.done, chips: r.chips, undo: r.undo, buttons: r.buttons, show: r.show }])
      if (r.done?.length) window.dispatchEvent(new CustomEvent('life-wallet-changed'))
    } catch (e) {
      // Same as the Coach page (K4): your message says "Not sent", the text comes back.
      setLog((l) => l.filter((x) => !x.pending).map((x) => (x.role === 'me' && x.at === now ? { ...x, failed: (e as Error).message || 'no connection' } : x)))
      setText((cur) => cur || t)
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
                {m.pending && !m.streamed ? (
                  <span className="bb-typing">
                    <i />
                    <i />
                    <i />
                    {m.steps?.length ? <em>{m.steps[m.steps.length - 1]}…</em> : null}
                  </span>
                ) : (
                  <>
                    {m.role === 'coach' ? <Rich text={m.text} /> : m.text}
                    {/* U4: the same done-lines with Undo, buttons and cards as the Coach page. */}
                    {!!m.done?.length && (
                      <ul className="bb-done">
                        {m.done.map((d, k) => (
                          <li key={k} className={m.undone?.[k] ? 'undone' : ''}>
                            {d}
                            {!!m.undo?.[k] && !m.undone?.[k] && life.coach?.undo && (
                              <button
                                className="cx-undo"
                                onClick={async () => {
                                  const r = await life.coach!.undo!(m.at, k).catch(() => null)
                                  if (r?.ok) setLog((l) => l.map((x) => (x === m ? { ...x, undone: Object.assign([...(x.undone ?? [])], { [k]: true }) } : x)))
                                }}
                              >
                                ↩ Undo
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.role === 'coach' && !m.pending && (!!m.buttons?.length || !!m.show?.length) && (
                      <ReplyExtras
                        m={{ ...m, bot: 'mega', via: 'app' } as any}
                        status={status}
                        latest={i === log.length - 1}
                        busy={busy}
                        onSay={(t) => void send(t)}
                        onOpen={() => (setOpen(false), onOpenChat())}
                        onDone={() => load()}
                      />
                    )}
                    {m.failed && (
                      <span className="cx-failed">
                        Not sent ·{' '}
                        <button type="button" disabled={busy} onClick={() => (setLog((l) => l.filter((x) => x !== m)), setText(''), void send(m.text))}>
                          Retry
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
            <div ref={end} />
          </div>
          <div className="bb-chips">
            {chips.slice(0, 3).map((c) => (
              <button key={c} disabled={busy} onClick={() => void (/^plan my day$/i.test(c) && life.coach?.rhythm ? planDay() : send(c))}>
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
      <button
        className={`bb-bubble mood-${status?.mood ?? 'chill'} ${open ? 'open' : ''}`}
        /* UI7: a moved face still keeps clear of the phone's bottom bar (--bb-min-bottom). */
        style={pos ? { right: pos.right, bottom: `max(${pos.bottom}px, var(--bb-min-bottom, 8px))`, left: 'auto', top: 'auto' } : undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen((o) => !o))}
        aria-label={open ? 'Close Ben' : 'Talk to Ben'}
        title="Talk to Ben (drag to move)"
      >
        <span>{open ? '✕' : lastCoach?.mood && MOOD_FACE[lastCoach.mood as Mood] && !status ? MOOD_FACE[lastCoach.mood as Mood] : face}</span>
        {!open && unread > 0 && <i className="bb-badge">{unread}</i>}
      </button>
    </>
  )
}
