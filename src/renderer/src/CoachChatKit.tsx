// Ben 2 chat pieces for the Coach page (each one small, pure logic in src/core):
// - AnswerBar: the quick chips under every answer (CH2), 👍/👎 with a reason
//   (QA2), the pin (CH4) and the cost line on hover (QA4);
// - PinnedStrip: pinned messages, collapsible, at the top of the chat (CH4);
// - ChatSearch: search your chats, highlighted hits that jump to the message (CH3);
// - DraftCard: an email/message draft with Copy and "Open in mail app" (TL8);
// - BasicChip: "Offline — basic mode" and what is queued (QA3);
// - WeekMisses: what Ben got wrong this week (QA2), for the side panel.
import { useEffect, useMemo, useState } from 'react'
import { life } from './bridge'
import { chipsFor, copyText, type AnswerChip } from '@core/answerChips'
import { markParts, searchChat, type ChatDoc, type ChatHit } from '@core/chatSearch'
import { pinTitle, type ChatPin } from '@core/chatPins'
import { costLine, type AnswerMeta } from '@core/answerCost'
import { REASONS, type FeedbackReason } from '@core/feedbackLearn'
import { TONES, draftText, mailtoLink, parseDraft } from '@core/emailDraft'
import { basicHint, basicLabel, type BasicReason } from '@core/offlineMode'
import type { Entry } from './BenThread'
import './coachChatKit.css'

const hm = (iso: string) => new Date(iso).toTimeString().slice(0, 5)
const when = (iso: string) => {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? hm(iso) : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${hm(iso)}`
}

async function toClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** 👍 / 👎, and after 👎 an optional reason (Wrong · Too long · Didn't do it …). */
export function RateAnswer({ m }: { m: Entry }) {
  const [given, setGiven] = useState<'up' | 'down' | null>(null)
  const [reason, setReason] = useState<FeedbackReason | null>(null)
  const [asking, setAsking] = useState(false)
  if (!life.coach?.feedback) return null
  const rate = async (k: 'up' | 'down') => {
    setGiven(k)
    setAsking(k === 'down')
    await life.coach!.feedback!(m.at, k).catch(() => setGiven(null))
  }
  const why = async (r: FeedbackReason) => {
    setReason(r)
    setAsking(false)
    // The old kinds stay in step (Ben's prompt and Telegram read them too).
    await life.coach!.feedback!(m.at, r === 'long' ? 'long' : r === 'wrong' ? 'wrong' : 'down', { reason: r }).catch(() => setReason(null))
  }
  return (
    <span className="ak-rate" role="group" aria-label="Rate this answer">
      <button type="button" className={given === 'up' ? 'on' : ''} aria-pressed={given === 'up'} onClick={() => void rate('up')} title="Good answer">
        👍
      </button>
      <button type="button" className={given === 'down' ? 'on' : ''} aria-pressed={given === 'down'} onClick={() => void rate('down')} title="Not good">
        👎
      </button>
      {asking && (
        <span className="ak-why" role="group" aria-label="What was wrong?">
          {REASONS.filter((r) => r.id !== 'other').map((r) => (
            <button key={r.id} type="button" onClick={() => void why(r.id)}>
              {r.label}
            </button>
          ))}
          <button type="button" className="x" onClick={() => setAsking(false)} aria-label="Skip">
            ✕
          </button>
        </span>
      )}
      {reason && <small className="ak-noted">Noted: {REASONS.find((r) => r.id === reason)?.label.toLowerCase()}. Ben adjusts.</small>}
    </span>
  )
}

/** The row under an answer: chips, rating, pin, and the model + cost on hover. */
export function AnswerBar({ m, planWaiting, planCardShown, pinned, meta, busy, onSay, onApprove, onPin, hideChips = false }: { m: Entry; planWaiting: boolean; planCardShown: boolean; pinned: boolean; meta?: AnswerMeta; busy: boolean; onSay: (text: string, prefill?: boolean) => void; onApprove: () => void; onPin: () => void; hideChips?: boolean }) {
  const [copied, setCopied] = useState(false)
  const chips = useMemo(() => chipsFor({ text: m.text, show: m.show, done: m.done, chips: m.chips, planWaiting, planCardShown }), [m.text, m.show, m.done, m.chips, planWaiting, planCardShown])
  const tap = async (c: AnswerChip) => {
    if (c.id === 'copy') {
      if (await toClipboard(copyText(m.text, m.done))) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }
      return
    }
    if (c.id === 'approve') return onApprove()
    // "Change the plan: …" waits for your words; the rest go at once.
    onSay(c.say, c.id === 'change')
  }
  const line = costLine(meta)
  return (
    <div className="ak-bar">
      <div className="ak-chips" role="toolbar" aria-label="Quick actions">
        {!hideChips && chips.map((c) => (
          <button key={c.id} type="button" className={`ak-chip ${c.primary ? 'primary' : ''} k-${c.id}`} disabled={busy && c.id !== 'copy'} onClick={() => void tap(c)}>
            {c.id === 'copy' && copied ? '✓ Copied' : c.label}
          </button>
        ))}
      </div>
      <span className="ak-side">
        <RateAnswer m={m} />
        <button type="button" className={`ak-pin ${pinned ? 'on' : ''}`} aria-pressed={pinned} onClick={onPin} title={pinned ? 'Unpin' : 'Pin this answer'}>
          📌
        </button>
      </span>
      {line && (
        <small className="ak-cost" title="Which model answered and roughly what it cost">
          {line}
        </small>
      )}
    </div>
  )
}

/** Pinned messages at the top of the chat: one line folded, the list open. */
export function PinnedStrip({ pins, onJump, onUnpin }: { pins: ChatPin[]; onJump: (at: string) => void; onUnpin: (p: ChatPin) => void }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('ls.coachPinsOpen') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('ls.coachPinsOpen', open ? '1' : '0')
    } catch {
      /* fine */
    }
  }, [open])
  if (!pins.length) return null
  return (
    <section className={`ak-pins ${open ? 'open' : ''}`} aria-label="Pinned messages">
      <button type="button" className="ak-pins-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span aria-hidden>📌</span>
        <b>{pins.length} pinned</b>
        {!open && <span className="ak-pins-first">{pinTitle(pins[0], 70)}</span>}
        <i aria-hidden>{open ? '▴' : '▾'}</i>
      </button>
      {open && (
        <ul>
          {pins.map((p) => (
            <li key={p.at}>
              <button type="button" className="ak-pin-go" onClick={() => onJump(p.at)} title="Show it in the chat">
                <small>
                  {p.role === 'me' ? 'You' : 'Ben'} · {when(p.at)}
                </small>
                <span>{pinTitle(p, 140)}</span>
              </button>
              <button type="button" className="ak-pin-x" onClick={() => onUnpin(p)} aria-label="Unpin" title="Unpin">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Search your chats: the chat log on this page, plus a past-conversation store
 * when one is there (life.coach.searchHistory). Hits are highlighted; a click
 * jumps to the message.
 */
export function ChatSearch({ docs, onJump, onClose, onQuery, compact = false }: { docs: ChatDoc[]; onJump: (at: string) => void; onClose?: () => void; onQuery?: (q: string) => void; compact?: boolean }) {
  const [q, setQ] = useState('')
  const [more, setMore] = useState<ChatHit[]>([])
  const [sel, setSel] = useState(0)
  const local = useMemo(() => searchChat(docs, q, { limit: 40 }), [docs, q])
  useEffect(() => {
    onQuery?.(q)
    if (!life.coach?.searchHistory || q.trim().length < 2) return setMore([])
    let gone = false
    const t = setTimeout(() => {
      life.coach!.searchHistory!(q, 30)
        .then((h) => !gone && setMore(h))
        .catch(() => !gone && setMore([]))
    }, 220)
    return () => {
      gone = true
      clearTimeout(t)
    }
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useMemo(() => {
    const seen = new Set(local.map((h) => h.at))
    return [...local, ...more.filter((h) => !seen.has(h.at))].slice(0, 50)
  }, [local, more])
  const inLog = new Set(docs.map((d) => d.at))
  const go = (k: number) => {
    const h = hits[(k + hits.length) % hits.length]
    if (!h) return
    setSel((k + hits.length) % hits.length)
    onJump(h.at)
  }
  return (
    <div className={`ak-search ${compact ? 'compact' : ''}`} role="search">
      <div className="ak-search-box">
        <span aria-hidden>⌕</span>
        <input
          autoFocus={!compact}
          value={q}
          onChange={(e) => (setQ(e.target.value), setSel(0))}
          placeholder="Search your chats with Ben…"
          aria-label="Search your chats with Ben"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose?.()
            if (e.key === 'Enter' || e.key === 'ArrowDown') (e.preventDefault(), go(sel + (e.key === 'Enter' && hits.length ? 0 : 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), go(sel - 1))
          }}
        />
        <small aria-live="polite">{q.trim().length >= 2 ? (hits.length ? `${hits.length} found` : 'Nothing found') : ''}</small>
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close search">
            ✕
          </button>
        )}
      </div>
      {hits.length > 0 && (
        <ul className="ak-hits">
          {hits.map((h, k) => (
            <li key={`${h.id}:${k}`}>
              <button type="button" className={k === sel ? 'on' : ''} onClick={() => go(k)} title={inLog.has(h.at) ? 'Jump to it' : 'An older conversation'}>
                <small>
                  {h.role === 'me' ? 'You' : 'Ben'} · {when(h.at)}
                  {!inLog.has(h.at) && ' · older'}
                </small>
                <span>
                  {markParts(h.snippet, h.ranges).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** An email / message draft: subject, body, tone chips, Copy, Open in mail app. Never sent by Ben. */
export function DraftCard({ text, busy, onSay }: { text: string; busy: boolean; onSay: (t: string) => void }) {
  const d = useMemo(() => parseDraft(text), [text])
  const [copied, setCopied] = useState(false)
  if (!d) return null
  return (
    <div className="ak-draft" aria-label="Draft">
      <div className="ak-draft-head">
        <span aria-hidden>✉️</span>
        <small>Draft · not sent</small>
      </div>
      <div className="ak-draft-subject">
        <small>Subject</small>
        <b>{d.subject}</b>
      </div>
      <pre className="ak-draft-body">{d.body}</pre>
      <div className="ak-draft-tools">
        <button
          type="button"
          className="ak-chip primary"
          onClick={async () => {
            if (await toClipboard(draftText(d))) {
              setCopied(true)
              setTimeout(() => setCopied(false), 1400)
            }
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <a className="ak-chip" href={mailtoLink(d)} target="_blank" rel="noreferrer">
          Open in mail app
        </a>
        <span className="ak-draft-tones" role="group" aria-label="Tone">
          {TONES.map((t) => (
            <button key={t.id} type="button" className="ak-chip ghost" disabled={busy} onClick={() => onSay(t.say)}>
              {t.label}
            </button>
          ))}
        </span>
      </div>
    </div>
  )
}

/** "Offline — basic mode": what still works, what waits, and (budget) going over it once. */
export function BasicChip({ reason, queued, onOverride, onSendNow }: { reason: BasicReason; queued: number; onOverride?: () => void; onSendNow?: () => void }) {
  return (
    <div className={`ak-basic r-${reason}`} role="status" aria-live="polite">
      <span className="dot" aria-hidden />
      <b>{basicLabel(reason)}</b>
      <small>{basicHint(reason)}</small>
      {queued > 0 && (
        <em className="ak-queued">
          {queued} waiting
          {onSendNow && reason !== 'offline' && (
            <button type="button" onClick={onSendNow}>
              Send now
            </button>
          )}
        </em>
      )}
      {reason === 'budget' && onOverride && (
        <button type="button" className="ak-chip ghost" onClick={onOverride}>
          Ask the AI anyway
        </button>
      )}
    </div>
  )
}

/** QA2: what Ben got wrong this week (your 👎s), for the side panel. */
export function WeekMisses() {
  const [w, setW] = useState<Awaited<ReturnType<NonNullable<NonNullable<typeof life.coach>['feedbackWeek']>>> | null>(null)
  useEffect(() => {
    life.coach?.feedbackWeek?.().then(setW).catch(() => setW(null))
  }, [])
  if (!w || (!w.misses.length && !w.ups)) return null
  return (
    <section className="cf-side-card ak-misses" aria-label="What Ben got wrong this week">
      <div className="hd">
        <b>What Ben got wrong this week</b>
        <small>
          👍 {w.ups} · 👎 {w.misses.length}
        </small>
      </div>
      {w.byReason.length > 0 && (
        <p className="ak-miss-why">
          {w.byReason.map((r) => (
            <span key={r.label}>
              {r.label} ×{r.n}
            </span>
          ))}
        </p>
      )}
      {w.misses.length ? (
        <ul>
          {w.misses.slice(0, 4).map((x) => (
            <li key={x.at}>
              <small>
                {x.reason} · {when(x.at)}
              </small>
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cf-side-empty">Nothing marked wrong this week.</p>
      )}
    </section>
  )
}

/** Pinned messages for the side panel (the same list as the strip). */
export function SidePins({ pins, onJump }: { pins: ChatPin[]; onJump: (at: string) => void }) {
  if (!pins.length) return null
  return (
    <section className="cf-side-card ak-side-pins" aria-label="Pinned">
      <div className="hd">
        <b>📌 Pinned</b>
        <small>{pins.length}</small>
      </div>
      <ul>
        {pins.slice(0, 5).map((p) => (
          <li key={p.at}>
            <button type="button" onClick={() => onJump(p.at)}>
              {pinTitle(p, 90)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
