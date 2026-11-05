// Night 7: the pieces of Ben's redesigned chat. Cards you can act on for
// Ben's automatic messages (plan, water, focus block, calendar, mood), the
// folded "earlier updates" line, the one "Now" card, small receipts and the
// one face for Ben.
import { useEffect, useState } from 'react'
import { life } from './bridge'
import { useAction } from './ui'
import { CoachPlan } from './CoachPlan'
import { Rich, type Entry } from './BenThread'
import type { CoachStatus } from './web/coachStatus'
import type { DeskView } from './web/benDesk'
import { MOOD_FACES } from '@core/benKnows'
import './coachFeed.css'
import { tidyText, type FeedItem, type NudgeInfo, type NudgeKind } from '@core/chatFeed'

const hm = (iso: string | number) => new Date(iso).toTimeString().slice(0, 5)

/** CL4: one face for Ben, always the same. */
export function BenMark({ ghost = false, big = false }: { ghost?: boolean; big?: boolean }) {
  return (
    <span className={`cf-mark ${ghost ? 'ghost' : ''} ${big ? 'big' : ''}`} aria-hidden>
      B
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

/** CC5: things Ben logged, as short lines with Undo. */
export function Receipts({ m, onUndo }: { m: Entry; onUndo: (index?: number) => void }) {
  if (!m.done?.length) return null
  const open = (m.undo ?? []).filter((op, k) => op && !m.undone?.[k]).length
  return (
    <ul className="cf-receipts">
      {m.done.map((d, k) => {
        const can = !!m.undo?.[k] && !m.undone?.[k]
        return (
          <li key={k} className={`${m.undone?.[k] ? 'undone' : ''} ${d.startsWith('⚠️') ? 'warn' : ''}`}>
            <span>{d}</span>
            {can && (
              <button onClick={() => onUndo(k)} title="Take this back">
                Undo
              </button>
            )}
            {m.undone?.[k] && <em>undone</em>}
          </li>
        )
      })}
      {m.done.length > 1 && open > 1 && (
        <li className="all">
          <button onClick={() => onUndo()}>Undo all {open}</button>
        </li>
      )}
    </ul>
  )
}

/** CN1: the older automatic messages of a run, folded into one line. */
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
function Card({ icon, title, note, settled, children }: { icon: string; title: string; note?: string; settled?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`cf-card ${settled ? 'settled' : ''}`}>
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

  if (kind === 'plan') {
    const st = status?.plan.status
    if (st === 'approved' || !latest || !today)
      return (
        <Card icon="🗓" title={st === 'approved' && today ? 'Plan approved' : "Today's plan"} settled>
          <p className="cf-quiet">{st === 'approved' && today ? 'Blocks are in your calendar and the must-dos are on Today.' : <Rich text={t.text.split('\n')[0]} maxBold={1} />}</p>
        </Card>
      )
    return (
      <Card icon="🗓" title="Today's plan" note={remindedNote(repeats)}>
        {st === 'proposed' ? <CoachPlan onChange={onChange} oneApprove hideReview /> : <p className="cf-text"><Rich text={t.text} maxBold={2} /></p>}
      </Card>
    )
  }

  if (kind === 'water') {
    const ml = status?.today.waterMl ?? 0
    const target = status?.today.waterTarget ?? 0
    if (!latest || !today || !target) return <Card icon="💧" title="Water" settled><p className="cf-quiet"><Rich text={t.text} maxBold={1} /></p></Card>
    const add = async (n: number) => {
      const r = await act(() => life.coach!.deskDo!({ op: 'water', ml: n }))
      if (r) {
        setDone(String(r))
        onChange()
      }
    }
    return (
      <Card icon="💧" title="Water" note={remindedNote(repeats)}>
        <div className="cf-water">
          <div className="cf-bar">
            <i style={{ width: `${Math.min(100, (ml / target) * 100)}%` }} />
          </div>
          <span>
            <b>{(ml / 1000).toFixed(1)}</b> of {(target / 1000).toFixed(1)} L
          </span>
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
    const left = minutesTo(info.time, now)
    if (settled || !today)
      return (
        <Card icon="🎯" title={info.title ?? 'Focus block'} settled>
          <p className="cf-quiet">{info.time ? `Was at ${info.time}` : 'Time has passed'}{(status?.today.focusMin ?? 0) > 0 ? ` · ${status!.today.focusMin} min of focus today` : ''}</p>
        </Card>
      )
    const subject = (info.title ?? 'Focus').replace(/\(.*?\)/g, '').trim().slice(0, 28)
    const start = async () => {
      if (await act(() => life.focus.start(subject, info.minutes ?? 25, null), `Focus started: ${subject}`)) {
        setDone('Timer running')
        onChange()
      }
    }
    return (
      <Card icon="🎯" title={info.title ?? 'Focus block'} note={left != null ? (left > 0 ? `in ${left} min` : 'now') : undefined}>
        <p className="cf-quiet">
          {info.time ? `${info.time} · ` : ''}
          {info.minutes ? `${info.minutes} min` : ''}
        </p>
        {done ? (
          <small className="cf-done">✓ {done}</small>
        ) : (
          <div className="cf-btns">
            <button className="p" onClick={() => void start()}>
              Start the timer
            </button>
            <button onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'calendar' }))}>Move</button>
            <button onClick={() => setDone('Skipped for now')}>Skip</button>
          </div>
        )}
      </Card>
    )
  }

  if (kind === 'calendar') {
    const left = minutesTo(info.time, now)
    if (settled || !today)
      return (
        <Card icon="📅" title={info.title ?? 'Calendar'} settled>
          <p className="cf-quiet">{info.time ? `${info.time}${info.end ? `–${info.end}` : ''}` : hm(m.at)}</p>
        </Card>
      )
    return (
      <Card icon="📅" title={info.title ?? t.text.split('\n')[0]} note={left != null && left > 0 ? `in ${left} min` : left != null ? 'now' : undefined}>
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
    if (!today || !latest) return <Card icon="🙂" title="How you felt" settled><p className="cf-quiet">{picked ? `You said ${picked}` : 'No answer'}</p></Card>
    return (
      <Card icon="🙂" title={/how was today/i.test(m.text) ? 'How was today, really?' : 'How do you feel right now?'}>
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
  const label: Record<string, string> = { focus: 'Start', running: 'Stop & log', approve: 'Approve', plan: 'Plan it', answer: 'Done', ask: 'Ask Ben' }
  return (
    <div className={`cf-now move-${mv.kind}`} role="region" aria-label="Now">
      <span className="k">Now</span>
      <div className="tx">
        <b>{mv.title}</b>
        <small>{mv.sub}</small>
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
