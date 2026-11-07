// Ben's chat pieces, shared by the Coach page and the floating face (U4):
// the reply text (numbers in bold, search highlights), the buttons and live
// cards under a reply, and the rating. One look and one behaviour everywhere.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { life } from './bridge'
import { useAction } from './ui'
import type { CoachStatus } from './web/coachStatus'
import { readDo, type ReplyCards } from '@core/coachButtons'
import type { NudgeInfo, NudgeKind } from '@core/chatFeed'
import { CoachPlan } from './CoachPlan'
import { parseRich, type Inline } from '@core/richText'

/** One chat message (the Coach page's log entry). */
export type Entry = { role: 'me' | 'coach'; bot: string; via: string; text: string; done?: string[]; receipt?: string; at: string; pending?: boolean; steps?: string[]; mood?: string; undo?: unknown[]; undone?: boolean[]; chips?: string[]; fresh?: boolean; photo?: string; buttons?: { label: string; do: string }[]; show?: string[]; cards?: ReplyCards; failed?: string; proactive?: boolean; kind?: NudgeKind; info?: NudgeInfo; streamed?: boolean; quote?: string; stopped?: boolean; full?: string; fly?: boolean; basic?: 'offline' | 'ai-down' | 'budget'; queued?: boolean }

// Numbers with their unit in bold ("25 min", "1.9/2.7", "750 ml"), never half a word ("10 min|utes").
const NUM = /(\d+(?:[.,:]\d+)*(?:\s?(?:min|h|ml|m|L|lei|MDL|km|kg|reps|days?)(?![\p{L}])|%|\/\d+(?:[.,]\d+)?)?)/gu

/** Coach text with numbers in bold (and search hits marked); a new reply types itself out. */
/** CL5: at most `maxBold` numbers in bold (the ones that matter come first). */
/** AF13: the text is split and bolded once; a new reply reveals word by word
 *  with a CSS stagger (opacity only), so typing costs no re-renders. */
/** Coach UI v3: a little markdown too (bold, italic, code, lists: core/richText). */
export function Rich({ text, reveal = false, highlight = '', maxBold = Infinity }: { text: string; reveal?: boolean; highlight?: string; maxBold?: number }) {
  const animate = reveal && !(typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const h = highlight.trim().toLowerCase()
  // ~1.2 s for a whole reply, 12–40 ms between words.
  const words = useMemo(() => (text.match(/\S+/g) ?? []).length, [text])
  const step = Math.max(12, Math.min(40, Math.round(1200 / Math.max(1, words))))
  const total = words * step + 220
  const [typing, setTyping] = useState(animate)
  useEffect(() => {
    if (!animate) return setTyping(false)
    setTyping(true)
    const t = setTimeout(() => setTyping(false), total)
    return () => clearTimeout(t)
  }, [animate, total, text])
  // Words get their own span only while they fade in; then the reply is plain flowing text.
  const split = animate && typing
  const nodes = useMemo(() => {
    let w = 0
    let bold = 0
    let key = 0
    const word = (str: string): ReactNode[] =>
      split
        ? str.split(/(\s+)/).map((t) => (!t || /^\s+$/.test(t) ? t : <span key={key++} className="cx-wd" data-w={t} style={{ ['--i' as string]: w++ }}>{t}</span>))
        : [str]
    const plain = (str: string): ReactNode[] =>
      str.split(NUM).map((p, i) => {
        if (!p) return null
        const hit = h && p.toLowerCase().includes(h)
        if (i % 2 === 1 && bold < maxBold) {
          bold++
          return <b key={key++} className={`${hit ? 'hit' : ''}${split ? ' cx-wd' : ''}`} data-w={split ? p : undefined} style={split ? { ['--i' as string]: w++ } : undefined}>{p}</b>
        }
        if (!hit) return <Fragment key={key++}>{word(p)}</Fragment>
        const k = p.toLowerCase().indexOf(h)
        return (
          <span key={key++}>
            {p.slice(0, k)}
            <mark>{p.slice(k, k + h.length)}</mark>
            {p.slice(k + h.length)}
          </span>
        )
      })
    const inline = (line: Inline[]): ReactNode[] =>
      line.map((x) =>
        x.k === 'text' ? <Fragment key={key++}>{plain(x.s)}</Fragment> : x.k === 'b' ? <strong key={key++} className="rx-b">{word(x.s)}</strong> : x.k === 'i' ? <em key={key++} className="rx-i">{word(x.s)}</em> : <code key={key++} className="rx-code">{x.s}</code>
      )
    const lines = (ls: Inline[][]): ReactNode[] => ls.map((l, i) => <Fragment key={key++}>{i > 0 && <br />}{inline(l)}</Fragment>)
    const blocks = parseRich(text)
    // One paragraph stays inline, so short lines sit anywhere a plain text did.
    const out: ReactNode =
      blocks.length === 1 && blocks[0].k === 'p'
        ? lines(blocks[0].lines)
        : blocks.map((b) =>
            b.k === 'p' ? (
              <span key={key++} className="rx-p">{lines(b.lines)}</span>
            ) : (
              <span key={key++} className={`rx-list rx-${b.k}`} role="list">
                {b.items.map((it, k) => (
                  <span key={key++} className="rx-li" role="listitem" data-n={b.k === 'ol' ? `${(b.start ?? 1) + k}.` : undefined}>
                    {inline(it)}
                  </span>
                ))}
              </span>
            )
          )
    return out
  }, [text, h, maxBold, split])
  return (
    <span className={`cx-rich${split ? ' typing' : ''}`} style={split ? { ['--step' as string]: `${step}ms` } : undefined}>
      {nodes}
      {typing && <i className="cx-caret" />}
    </span>
  )
}

/** Buttons and live mini-widgets under a coach reply (interactive replies). */
export function ReplyExtras({ m, status, latest, busy, onSay, onOpen, onDone }: { m: Entry; status: CoachStatus | null; latest: boolean; busy: boolean; onSay: (t: string) => void; onOpen: (tab: 'plan' | 'goals' | 'score' | 'about') => void; onDone: () => void }) {
  const act = useAction()
  const [used, setUsed] = useState<Record<number, boolean>>({})
  const run = async (k: number, b: { label: string; do: string }) => {
    const d = readDo(b.do)
    if (!d) return
    let ok: unknown = true
    if (d.k === 'focus') ok = await act(() => life.focus.start(d.subject, d.minutes, null), `Focus started: ${d.subject} · ${d.minutes} min`)
    else if (d.k === 'approve') ok = await act(() => life.coach!.rhythm!('approve'), 'Approved: blocks in your calendar, must-dos on Today')
    else if (d.k === 'plan') ok = await act(() => life.coach!.rhythm!('propose'), "Today's plan is ready (Plan tab)")
    else if (d.k === 'book') {
      const g = status?.goals.find((x) => x.title.toLowerCase().includes(d.goal.toLowerCase()) || d.goal.toLowerCase().includes(x.title.toLowerCase()))
      const r = await act(() => life.coach!.rhythm!('book', g ? String(g.id) : undefined))
      ok = r
      if (r?.lines?.length) await act(async () => r, r.lines.join(' · '))
    } else if (d.k === 'say') onSay(d.text)
    else if (d.k === 'change') onOpen('plan')
    else if (d.k === 'workout' || d.k === 'water') window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'body' }))
    else onOpen(d.tab)
    if (ok && d.k !== 'open' && d.k !== 'change' && d.k !== 'workout' && d.k !== 'water') setUsed((u) => ({ ...u, [k]: true }))
    if (ok) onDone()
  }
  const tick = async (i: number) => {
    if (await act(() => life.focus.togglePlan(i))) onDone()
  }
  return (
    <div className="cx-extras">
      {status &&
        m.show?.map((w) => {
          // Live widgets show today's numbers; on old messages they'd be misleading, so only the latest shows them.
          if (!latest) return null
          if (w === 'focus-week') {
            const max = Math.max(30, ...status.week.map((d) => d.min))
            return (
              <div key={w} className="cx-w cx-w-week">
                <small>Focus · last 7 days · {(status.week.reduce((t, d) => t + d.min, 0) / 60).toFixed(1)}h</small>
                <div className="cx-bars">
                  {status.week.map((d) => (
                    <span key={d.day} title={`${d.day}: ${d.min} min`}>
                      <i style={{ height: `${Math.max(3, (d.min / max) * 100)}%` }} className={d.min >= 50 ? 'ok' : ''} />
                      <em>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })}</em>
                    </span>
                  ))}
                </div>
              </div>
            )
          }
          if (w === 'goals')
            return (
              <div key={w} className="cx-w">
                <small>Goals</small>
                {status.goals.length ? (
                  status.goals.map((g) => (
                    <div key={g.id} className="cx-w-goal">
                      <span>{g.title}</span>
                      <div className="gp-bar">
                        <i style={{ width: `${g.pct}%` }} />
                      </div>
                      <em className={g.status === 'behind' ? 'bad' : ''}>
                        {g.pct}% · {g.perDayMin} min/day
                      </em>
                    </div>
                  ))
                ) : (
                  <span className="hint small">No goals yet.</span>
                )}
              </div>
            )
          if (w === 'water' && status.today.waterTarget)
            return (
              <div key={w} className="cx-w">
                <small>
                  💧 Water · {(status.today.waterMl / 1000).toFixed(1)} of {(status.today.waterTarget / 1000).toFixed(1)} L
                </small>
                <div className="gp-bar water">
                  <i style={{ width: `${Math.min(100, (status.today.waterMl / status.today.waterTarget) * 100)}%` }} />
                </div>
              </div>
            )
          if (w === 'mustdos')
            return (
              <div key={w} className="cx-w">
                <small>Must-dos</small>
                {status.mustdos.length ? (
                  status.mustdos.map((x) => (
                    <label key={x.i} className={`cx-w-check ${x.done ? 'done' : ''}`}>
                      <input type="checkbox" checked={x.done} onChange={() => void tick(x.i)} /> {x.text}
                    </label>
                  ))
                ) : (
                  <span className="hint small">No must-dos today.</span>
                )}
              </div>
            )
          // A plan written in the reply and "Not made yet" under it contradict each other (K7).
          if (w === 'plan' && status.plan.status === 'none' && /\b\d{1,2}:\d{2}\b/.test(m.text)) return null
          // U3: the plan itself, editable (times, drop a block, Approve), not a link.
          if (w === 'plan')
            return (
              <div key={w} className="cx-w cx-w-plan">
                <CoachPlan onChange={onDone} />
              </div>
            )
          // BQ2: the day and the task list, as they were when Ben answered (data saved with the reply).
          if (w === 'day')
            return (
              <div key={w} className="cx-w cx-w-day">
                <small>Your day</small>
                {m.cards?.day?.length ? (
                  m.cards.day.map((e, k) => (
                    <div key={k} className="cx-w-row">
                      <em>
                        {e.start}–{e.end}
                      </em>{' '}
                      <span>{e.title}</span>
                    </div>
                  ))
                ) : (
                  <span className="hint small">Nothing in your calendar today.</span>
                )}
              </div>
            )
          if (w === 'tasks')
            return (
              <div key={w} className="cx-w cx-w-tasks">
                <small>Tasks</small>
                {m.cards?.tasks?.length ? (
                  m.cards.tasks.map((t, k) => (
                    <div key={k} className={`cx-w-row ${t.late ? 'bad' : ''}`}>
                      <span>{t.text}</span>
                      {t.late && <em> late</em>}
                    </div>
                  ))
                ) : (
                  <span className="hint small">No tasks for today.</span>
                )}
              </div>
            )
          if (w === 'promises')
            return (
              <div key={w} className="cx-w">
                <small>Promises · 7 days</small>
                <b>
                  {status.promises.kept} kept · {status.promises.missed} missed
                </b>
              </div>
            )
          return null
        })}
      {!!m.buttons?.length && (
        <div className="cx-btns">
          {m.buttons.map((b, k) => (
            <button key={k} className={`cx-btn ${used[k] ? 'used' : ''}`} disabled={busy || used[k]} onClick={() => void run(k, b)}>
              {used[k] ? `✓ ${b.label}` : b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 👍 👎 📏 ❌ under Ben's replies: he learns what you like. */
/** U6: rate a reply on any device: "⋯" (always there on the latest reply) opens 👍 👎 Too long / Wrong. */
export function Feedback({ m, latest = false }: { m: Entry; latest?: boolean }) {
  const [sent, setSent] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const give = async (kind: 'up' | 'down' | 'long' | 'wrong') => {
    setSent(kind)
    await life.coach?.feedback?.(m.at, kind).catch(() => setSent(null))
  }
  if (sent) return <span className="cx-fb done">{sent === 'up' ? '👍 thanks' : sent === 'long' ? '📏 noted: shorter' : sent === 'wrong' ? '❌ noted: tell me what' : '👎 noted'}</span>
  if (!open)
    return (
      <button className={`cx-fb-more ${latest ? 'latest' : ''}`} onClick={() => setOpen(true)} aria-label="Rate this reply" title="Rate this reply">
        ⋯
      </button>
    )
  return (
    <span className="cx-fb open" aria-label="Rate this reply">
      <button onClick={() => void give('up')} title="Good reply">
        👍
      </button>
      <button onClick={() => void give('down')} title="Not helpful">
        👎
      </button>
      <button onClick={() => void give('long')} title="Too long">
        📏
      </button>
      <button onClick={() => void give('wrong')} title="Wrong">
        ❌
      </button>
    </span>
  )
}
