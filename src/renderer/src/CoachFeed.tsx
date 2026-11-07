// Night 7: the pieces of Ben's redesigned chat. Cards you can act on for
// Ben's automatic messages (plan, water, focus block, calendar, mood), the
// folded "earlier updates" line, the one "Now" card, small receipts and the
// one face for Ben.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { life } from './bridge'
import { useAction } from './ui'
import { BlockCard, PlanCard } from './CoachCards'
import { Rich, type Entry } from './BenThread'
import type { CoachStatus } from './web/coachStatus'
import type { DeskView } from './web/benDesk'
import { MOOD_FACES } from '@core/benKnows'
import './coachFeed.css'
import { tidyText, type FeedItem, type NudgeInfo, type NudgeKind } from '@core/chatFeed'
import { barFill } from './motionKit'
import { BenAvatar, type Presence } from './BenAvatar'
import { createPortal } from 'react-dom'
import { doingNow } from '@core/coachLooks'
import { plainRich } from '@core/richText'
import { coachCheer } from './coachCheer'
import { BenPushCard } from './BenPushCard'
import { pushCardOf } from '@core/benPushes'

const hm = (iso: string | number) => new Date(iso).toTimeString().slice(0, 5)

/** CL4: one face for Ben, always the same (his drawn avatar; the look is yours to pick). */
export function BenMark({ ghost = false, big = false, state }: { ghost?: boolean; big?: boolean; state?: Presence }) {
  return (
    <span className={`cf-mark ${ghost ? 'ghost' : ''} ${big ? 'big' : ''}`} aria-hidden>
      {!ghost && <BenAvatar size={big ? 44 : 32} state={state} ring={!!state && state !== 'idle'} />}
    </span>
  )
}

/** CN5: one small label: the time, and a plane when it came by Telegram. */
export function Meta({ m, label }: { m: Entry; label?: string }) {
  return (
    <span className="cf-meta" title={`${m.via === 'app' ? 'In the app' : m.via === 'mcp' ? 'From an AI app you connected' : 'Telegram'} · ${new Date(m.at).toLocaleString('en-GB')}`}>
      {label ? `${label} · ` : ''}
      {hm(m.at)}
      {m.via === 'mcp' ? (
        <i className="cf-via" aria-label="from an AI app">🔌</i>
      ) : (
        m.via !== 'app' && <i className="cf-via" aria-label="via Telegram">✈</i>
      )}
    </span>
  )
}

const KIND_LABEL: Record<NudgeKind, string> = { plan: 'Plan', water: 'Water', block: 'Focus block', calendar: 'Calendar', mood: 'Check-in', idle: 'Nudge', slip: 'Nudge', reminder: 'Reminder', other: 'From Ben' }

const LEAD_ICON = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s*/u

/** One result line: its emoji as the icon, "A → B" with a real arrow. */
function ResultText({ text }: { text: string }) {
  const parts = text.split(/\s(?:→|->)\s/)
  return (
    <span className="tx">
      {parts.map((p, k) => (
        <span key={k}>
          {k > 0 && <i className="arr">→</i>}
          {k > 0 ? <b>{p}</b> : p}
        </span>
      ))}
    </span>
  )
}

/** CC5 + Coach UI v3: what Ben did, as small result cards with Undo (not talk). */
export function Receipts({ m, onUndo }: { m: Entry; onUndo: (index?: number) => void }) {
  if (!m.done?.length) return null
  const open = (m.undo ?? []).filter((op, k) => op && !m.undone?.[k]).length
  return (
    <ul className="cf-results" aria-label="What Ben did">
      {m.done.map((d, k) => {
        const can = !!m.undo?.[k] && !m.undone?.[k]
        const warn = d.startsWith('⚠️')
        const lead = LEAD_ICON.exec(d)
        const text = lead ? d.slice(lead[0].length) : d
        return (
          <li key={k} className={`cf-result ${m.undone?.[k] ? 'undone' : ''} ${warn ? 'warn' : ''}`} style={{ '--k': k } as CSSProperties}>
            <span className="badge" aria-hidden>
              {warn ? '!' : lead?.[1] ?? '✓'}
            </span>
            <ResultText text={text} />
            {can && (
              <button onClick={() => onUndo(k)} title="Take this back">
                ↶ Undo
              </button>
            )}
            {m.undone?.[k] && <em>Undone</em>}
          </li>
        )
      })}
      {m.done.length > 1 && open > 1 && (
        <li className="cf-result all">
          <button onClick={() => onUndo()}>↶ Undo all {open}</button>
        </li>
      )}
    </ul>
  )
}

/** CN1: the older automatic messages of a run, folded into one line. */
/**
 * The feed cut into sections at each day/time divider. Each divider is sticky
 * only inside its own section, so exactly one label sticks at a time (the
 * current section's) and the next one pushes it away instead of piling up.
 */
export function feedSections<T extends { t: string; key: string }>(feed: T[], render: (it: T, idx: number) => ReactNode): ReactNode[] {
  const out: ReactNode[] = []
  let cur: ReactNode[] = []
  let key = 'top'
  const flush = () => {
    if (cur.length) out.push(<section key={`sec-${key}`} className="cf-sec">{cur}</section>)
    cur = []
  }
  feed.forEach((it, idx) => {
    if (it.t === 'divider') {
      flush()
      key = it.key
    }
    cur.push(render(it, idx))
  })
  flush()
  return out
}

export function FoldLine({ item, log, open, onToggle }: { item: Extract<FeedItem, { t: 'fold' }>; log: Entry[]; open: boolean; onToggle: () => void }) {
  return (
    <div className={`cf-fold ${open ? 'open' : ''}`}>
      <button onClick={onToggle} aria-expanded={open}>
        <span className="chev">{open ? '▾' : '▸'}</span> {item.label}
        <em>{hm(log[item.entries[0]].at)}–{hm(log[item.entries[item.entries.length - 1]].at)}</em>
      </button>
      {open && (
        <ul>
          {item.entries.map((k) => {
            const t = tidyText(log[k].text)
            return (
              <li key={k}>
                <span className="ic">{t.icon ?? '•'}</span>
                <span className="tx">
                  <Rich text={t.text} maxBold={1} />
                </span>
                <Meta m={log[k]} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** A card's shell: icon, title, a small note ("reminded twice"), the content. */
function Card({ icon, title, note, settled, tone = 'plain', children }: { icon: string; title: string; note?: string; settled?: boolean; tone?: string; children?: React.ReactNode }) {
  return (
    <div className={`cf-card t-${tone} ${settled ? 'settled' : ''}`}>
      <div className="cf-card-head">
        <span className="ic">{icon}</span>
        <b>{title}</b>
        {note && <small>{note}</small>}
      </div>
      {children}
    </div>
  )
}

const remindedNote = (n: number) => (n === 1 ? 'reminded once more' : n > 1 ? `reminded ${n + 1} times` : undefined)

/** Minutes until HH:MM today (negative when past). */
function minutesTo(time: string | undefined, now: number): number | null {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return Math.round((d.getTime() - now) / 60000)
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/**
 * CC1–CC4, CC6: an automatic message as a card you can use. Old ones settle
 * (CN4); only the newest of a kind shows today's live numbers.
 */
export function NudgeCard({ m, kind, info, repeats, settled, latest, status, deck, onChange }: { m: Entry; kind: NudgeKind; info: NudgeInfo; repeats: number; settled: boolean; latest: boolean; status: CoachStatus | null; deck: DeskView | null; onChange: () => void }) {
  const act = useAction()
  const now = useNow()
  const [done, setDone] = useState<string | null>(null)
  const t = tidyText(m.text)
  const today = new Date(m.at).toDateString() === new Date().toDateString()
  // Ben 2: a push (check-in, brief, shutdown, weekly card) keeps its own card and buttons.
  const push = pushCardOf((m as { push?: unknown }).push)
  if (push) return <BenPushCard card={push} live={today || (push.type === 'weekly' && Date.now() - Date.parse(m.at) < 2 * 864e5)} onChange={onChange} />

  if (kind === 'plan') {
    const st = status?.plan.status
    if (st === 'approved' || !latest || !today)
      return (
        <Card tone="plan" icon="🗓" title={st === 'approved' && today ? 'Plan approved' : "Today's plan"} settled>
          <p className="cf-quiet">{st === 'approved' && today ? 'Blocks are in your calendar and the must-dos are on Today.' : <Rich text={t.text.split('\n')[0]} maxBold={1} />}</p>
        </Card>
      )
    if (st === 'proposed') return <PlanCard onChange={onChange} />
    return (
      <Card tone="plan" icon="🗓" title="Today's plan" note={remindedNote(repeats)}>
        <p className="cf-text">
          <Rich text={t.text} maxBold={2} />
        </p>
      </Card>
    )
  }

  if (kind === 'water') {
    const ml = status?.today.waterMl ?? 0
    const target = status?.today.waterTarget ?? 0
    if (!latest || !today || !target) return <Card tone="water" icon="💧" title="Water" settled><p className="cf-quiet"><Rich text={t.text} maxBold={1} /></p></Card>
    const add = async (n: number) => {
      const r = await act(() => life.coach!.deskDo!({ op: 'water', ml: n }))
      if (r) {
        setDone(String(r))
        coachCheer('water')
        onChange()
      }
    }
    return (
      <Card tone="water" icon="💧" title="Water" note={remindedNote(repeats)}>
        <div className="cf-water">
          <Ring value={ml / target} size={46} tone="water">
            {Math.round((ml / target) * 100)}%
          </Ring>
          <div className="cf-water-tx">
            <span>
              <b>{(ml / 1000).toFixed(1)}</b> of {(target / 1000).toFixed(1)} L today
            </span>
            <div className="cf-bar pbar">
              <i style={barFill(ml / target)} />
            </div>
          </div>
        </div>
        {life.coach?.deskDo && ml < target && (
          <div className="cf-btns">
            <button onClick={() => void add(250)}>+250 ml</button>
            <button onClick={() => void add(500)}>+500 ml</button>
          </div>
        )}
        {done && <small className="cf-done">{done}</small>}
      </Card>
    )
  }

  if (kind === 'block') {
    if (settled || !today)
      return (
        <Card tone="block" icon="🎯" title={info.title ?? 'Focus block'} settled>
          <p className="cf-quiet">{info.time ? `Was at ${info.time}` : 'Time has passed'}{(status?.today.focusMin ?? 0) > 0 ? ` · ${status!.today.focusMin} min of focus today` : ''}</p>
        </Card>
      )
    return <BlockCard title={info.title ?? 'Focus block'} time={info.time} minutes={info.minutes} note={repeats > 0 ? remindedNote(repeats) : undefined} onChange={onChange} />
  }

  if (kind === 'calendar') {
    const left = minutesTo(info.time, now)
    if (settled || !today)
      return (
        <Card tone="cal" icon="📅" title={info.title ?? 'Calendar'} settled>
          <p className="cf-quiet">{info.time ? `${info.time}${info.end ? `–${info.end}` : ''}` : hm(m.at)}</p>
        </Card>
      )
    return (
      <Card tone="cal" icon="📅" title={info.title ?? t.text.split('\n')[0]} note={left != null && left > 0 ? `in ${left} min` : left != null ? 'now' : undefined}>
        <p className="cf-quiet">{info.time ? `${info.time}${info.end ? `–${info.end}` : ''}` : <Rich text={t.text} maxBold={1} />}</p>
        <div className="cf-btns">
          <button onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'calendar' }))}>Open calendar</button>
        </div>
      </Card>
    )
  }

  if (kind === 'mood') {
    const after = (deck?.moods ?? []).find((x) => Date.parse(x.at) >= Date.parse(m.at))
    const picked = done ?? (after ? MOOD_FACES[after.mood - 1] : null)
    if (!today || !latest) return <Card tone="mood" icon="🙂" title="How you felt" settled><p className="cf-quiet">{picked ? `You said ${picked}` : 'No answer'}</p></Card>
    return (
      <Card tone="mood" icon="🙂" title={/how was today/i.test(m.text) ? 'How was today, really?' : 'How do you feel right now?'}>
        {picked ? (
          <small className="cf-done">Noted {picked} · Ben links it to sleep, training and spending.</small>
        ) : (
          <div className="cf-moods" role="group" aria-label="Your mood">
            {MOOD_FACES.map((f, k) => (
              <button
                key={f}
                aria-label={`Mood ${k + 1} of 5`}
                onClick={async () => {
                  if (await act(() => life.coach!.deskDo!({ op: 'mood', mood: k + 1 }))) {
                    setDone(f)
                    onChange()
                  }
                }}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </Card>
    )
  }

  // Everything else: one quiet line with one icon.
  return (
    <div className={`cf-note ${settled ? 'settled' : ''}`}>
      <span className="ic">{t.icon ?? '•'}</span>
      <span className="tx">
        <Rich text={t.text} maxBold={1} />
      </span>
      {repeats > 0 && <small>{remindedNote(repeats)}</small>}
    </div>
  )
}

export const kindLabel = (k: NudgeKind) => KIND_LABEL[k]

/** CN2: the one next thing, right above the message box. */
export function NowCard({ status, busy, onDo, onNotYet }: { status: CoachStatus; busy: boolean; onDo: () => void; onNotYet: () => void }) {
  const mv = status.move
  // Coach UI v3: "Approve" opens the plan card first; you approve what you can see.
  const label: Record<string, string> = { focus: 'Start', running: 'Stop & log', approve: 'See the plan', plan: 'Plan it', answer: 'Done', ask: 'Ask Ben' }
  // A plan waiting for you: one small "See the plan" chip. Approve itself is only on the plan card.
  if (mv.kind === 'approve')
    return (
      <div className="cf-now move-approve slim" role="region" aria-label="Now" title={mv.sub}>
        <button className="p" disabled={busy} onClick={onDo}>
          <ChipIcon text="plan" /> See the plan
        </button>
      </div>
    )
  return (
    <div className={`cf-now move-${mv.kind}`} role="region" aria-label="Now" title={mv.sub}>
      <span className="k" aria-hidden>
        <ChipIcon text={`${mv.kind} ${mv.title}`} />
      </span>
      <div className="tx">
        <small>Now</small>
        <b>{mv.title}</b>
      </div>
      <div className="cf-btns">
        {mv.kind === 'answer' && (
          <button disabled={busy} onClick={onNotYet}>
            Not yet
          </button>
        )}
        <button className="p" disabled={busy} onClick={onDo}>
          {label[mv.kind]}
        </button>
      </div>
    </div>
  )
}

/** A progress ring (static SVG: it is redrawn only when the number changes). */
export function Ring({ value, size = 44, tone = 'accent', children }: { value: number; size?: number; tone?: string; children?: ReactNode }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
  const r = 15.5
  const c = 2 * Math.PI * r
  return (
    <span className={`cf-ring t-${tone}`} style={{ '--rs': `${size}px` } as CSSProperties}>
      <svg viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={r} className="bg" />
        <circle cx="18" cy="18" r={r} className="fg" strokeDasharray={c} strokeDashoffset={c * (1 - v)} />
      </svg>
      {children != null && <b>{children}</b>}
    </span>
  )
}

const ICON_PATH = {
  plan: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  water: 'M12 3.5c3.5 4.2 6 7.6 6 10.6a6 6 0 0 1-12 0c0-3 2.5-6.4 6-10.6Z',
  focus: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 9v4l2.5 1.5M9.5 2.5h5',
  review: 'M4 20h16M7 16V10M12 16V5M17 16v-4',
  push: 'M13 2 4 14h7l-1 8 9-12h-7Z',
  done: 'M5 12.5 10 17 19 7',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6'
}
export type ChipKind = keyof typeof ICON_PATH

/** The small icon for a suggestion chip, from what it says. */
export function chipKind(text: string): ChipKind {
  const t = text.toLowerCase()
  if (/water|drink/.test(t)) return 'water'
  if (/start|focus|block|running|stop/.test(t)) return 'focus'
  if (/review|how did|how was|score|month|pattern/.test(t)) return 'review'
  if (/plan|approve|week|tomorrow|calendar/.test(t)) return 'plan'
  if (/push|procrastinat|lazy|stuck|rescue/.test(t)) return 'push'
  if (/done|answer|did it|finished/.test(t)) return 'done'
  if (/sleep|bed|night/.test(t)) return 'moon'
  return 'spark'
}

export function GlyphIcon({ kind, size = 15 }: { kind: ChipKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICON_PATH[kind]} />
    </svg>
  )
}
export function ChipIcon({ text, size = 15 }: { text: string; size?: number }) {
  return <GlyphIcon kind={chipKind(text)} size={size} />
}

/** A suggestion chip above the message box. */
export function SuggestChip({ text, disabled, onClick }: { text: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`cf-chip k-${chipKind(text)}`} disabled={disabled} onClick={onClick}>
      <ChipIcon text={text} />
      <span>{text}</span>
    </button>
  )
}

/**
 * Ben's words while they stream in: finished lines already look like the
 * final reply (bold, lists), the line being written fades in word by word,
 * with a soft caret at the end.
 */
export function StreamText({ text }: { text: string }) {
  const shown = useRef(0)
  const cut = Math.min(shown.current, text.length)
  useEffect(() => {
    shown.current = text.length
  }, [text])
  const nl = text.lastIndexOf('\n')
  const done = nl >= 0 ? text.slice(0, nl) : ''
  const line = nl >= 0 ? text.slice(nl + 1) : text
  const lineCut = Math.max(0, cut - (nl + 1))
  return (
    <span className="cf-streamtx">
      {done && <Rich text={done} />}
      {done && <br />}
      <span>{plainRich(line.slice(0, lineCut))}</span>
      <span key={cut} className="cf-fresh">
        {freshWords(plainRich(line.slice(lineCut)), cut)}
      </span>
      <i className="cf-caret" aria-hidden />
    </span>
  )
}

/** Coach UI v4: the words that just streamed in, one by one from a soft blur. */
function freshWords(text: string, at: number): ReactNode[] {
  let n = 0
  return text.split(/(\s+)/).map((w, k) => (!w || /^\s+$/.test(w) ? w : <span key={`${at}-${k}`} className="cf-sw" data-w={w} style={{ '--i': n++ } as CSSProperties}>{w}</span>))
}

/** Ben is thinking: what he is doing now (shimmering), the steps he finished above it. */
export function TypingBubble({ step, steps = [] }: { step?: string; steps?: string[] }) {
  const past = steps.slice(0, -1).filter((x) => !/^Reading your day$/.test(x)).slice(-3)
  return (
    <div className="cf-think" aria-live="polite" aria-label={`Ben is ${doingNow(step).toLowerCase()}`}>
      {past.length > 0 && (
        <ul className="cf-think-done">
          {past.map((x) => (
            <li key={x}>
              <i aria-hidden>✓</i>
              {x}
            </li>
          ))}
        </ul>
      )}
      <div className="cf-think-now">
        <span className="cf-orbs" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="cf-shimmer" key={step ?? ''}>
          {doingNow(step)}…
        </span>
      </div>
    </div>
  )
}

type Rated = 'up' | 'down' | null
/**
 * A message bubble with its actions: a small toolbar on hover (desktop) and a
 * menu on a long press (phone). Copy, reply, 👍 / 👎 on Ben's replies, undo.
 */
export function Bubble({ m, mine = false, tail = false, onReply, onUndo, className = '', children }: { m: Entry; mine?: boolean; tail?: boolean; onReply?: () => void; onUndo?: () => void; className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const [rated, setRated] = useState<Rated>(null)
  const [sheet, setSheet] = useState(false)
  const press = useRef<{ t: number; x: number; y: number } | null>(null)
  const canUndo = !!onUndo && (m.undo ?? []).some((op, k) => op && !m.undone?.[k])
  const canRate = !mine && !m.pending && !!life.coach?.feedback
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(m.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* no clipboard here */
    }
  }
  const rate = async (k: 'up' | 'down') => {
    setRated(k)
    await life.coach?.feedback?.(m.at, k).catch(() => setRated(null))
  }
  const stop = () => {
    if (press.current) clearTimeout(press.current.t)
    press.current = null
  }
  const acts: { k: string; label: string; icon: string; run: () => void; on?: boolean }[] = [
    { k: 'copy', label: copied ? 'Copied' : 'Copy', icon: copied ? '✓' : '⧉', run: () => void copy() },
    ...(onReply ? [{ k: 'reply', label: 'Reply', icon: '↩', run: onReply }] : []),
    ...(canRate
      ? [
          { k: 'up', label: 'Good reply', icon: '👍', run: () => void rate('up'), on: rated === 'up' },
          { k: 'down', label: 'Not helpful', icon: '👎', run: () => void rate('down'), on: rated === 'down' }
        ]
      : []),
    ...(canUndo ? [{ k: 'undo', label: 'Undo what Ben logged', icon: '↶', run: () => onUndo!() }] : [])
  ]
  return (
    <div
      className={`cf-bubble ${mine ? 'me' : 'ben'} ${tail ? 'tail' : ''} ${className}`}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch') return
        const t = window.setTimeout(() => {
          press.current = null
          navigator.vibrate?.(8)
          setSheet(true)
        }, 480)
        press.current = { t, x: e.clientX, y: e.clientY }
      }}
      onPointerMove={(e) => press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10 && stop()}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => {
        if (window.matchMedia?.('(hover: none)').matches) e.preventDefault()
      }}
    >
      {children}
      {!m.pending && (
        <span className="cf-tools" role="toolbar" aria-label="Message actions">
          {acts.map((a) => (
            <button key={a.k} type="button" className={a.on ? 'on' : ''} onClick={a.run} title={a.label} aria-label={a.label}>
              {a.icon}
            </button>
          ))}
        </span>
      )}
      {rated && <span className="cf-rated">{rated === 'up' ? '👍' : '👎'}</span>}
      {sheet &&
        createPortal(
        <div className="cf-sheet-wrap" onClick={() => setSheet(false)}>
          <div className="cf-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
            <p>{m.text.replace(/\s+/g, ' ').slice(0, 140) || 'Photo'}</p>
            {acts.map((a) => (
              <button
                key={a.k}
                type="button"
                role="menuitem"
                onClick={() => {
                  a.run()
                  setSheet(false)
                }}
              >
                <span>{a.icon}</span> {a.label}
              </button>
            ))}
            <button type="button" className="x" onClick={() => setSheet(false)}>
              Close
            </button>
          </div>
        </div>,
          document.body
        )}
    </div>
  )
}
