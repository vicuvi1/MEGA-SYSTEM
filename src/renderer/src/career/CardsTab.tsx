// CR4: flashcards with real spaced repetition: today's review (Space shows
// the answer, 1–4 grade it), the deck numbers, and making cards from your
// notes or a writeup (your own "front :: back" lines, or Ben drafts them).
import { useEffect, useState } from 'react'
import { life } from '../bridge'
import { GRADE_LABEL, GRADES, ivlText, nextIvl, type Grade } from '@core/career/srs'
import type { CareerView } from '../web/career'
import { useToast } from '../ui'
import { Empty, Stat, type Run } from './ui'

export function CardsTab({ v, run, active }: { v: CareerView; run: Run; active: boolean }) {
  const c = life.career!
  const toast = useToast()
  const [shown, setShown] = useState(false)
  const [text, setText] = useState('')
  const [deck, setDeck] = useState('')
  const [draft, setDraft] = useState<{ front: string; back: string; on: boolean }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const s = v.cards.stats
  const card = v.cards.queue[0] ?? null
  const gradeIt = async (g: Grade) => {
    if (!card) return
    setShown(false)
    await run(() => c.grade(card.id, g))
  }
  useEffect(() => {
    if (!active || !card) return
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return
      if (e.key === ' ' && !shown) {
        e.preventDefault()
        setShown(true)
      } else if (shown && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        void gradeIt(GRADES[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  })
  const make = async (withBen: boolean) => {
    setBusy(true)
    try {
      const r = withBen ? await c.draftCards(text, deck) : { cards: await c.parseCards(text), by: 'notes' as const }
      if (!r.cards.length) toast(withBen ? "Ben couldn't find facts to turn into cards" : 'Write one card a line: front :: back', 'bad')
      setDraft(r.cards.map((x) => ({ ...x, on: true })))
      if (withBen && r.by === 'notes' && r.cards.length) toast('Ben is not answering: these are your own lines')
    } finally {
      setBusy(false)
    }
  }
  const addDraft = async () => {
    const list = (draft ?? []).filter((x) => x.on)
    await run(() => c.addCards(list, deck || 'General', 'Notes'), `${list.length} card${list.length === 1 ? '' : 's'} added`)
    setDraft(null)
    setText('')
  }
  return (
    <div className="cr-cards">
      <section className="cr-card cr-review" aria-label="Today's review">
        <div className="cr-stats">
          <Stat label="Due today" value={s.due} sub={s.fresh ? `+${s.fresh} new` : undefined} tone={s.due ? 'warn' : 'good'} />
          <Stat label="Known well" value={s.mature} sub={`of ${s.total}`} />
          <Stat label="Remembered" value={s.retention == null ? '–' : `${Math.round(s.retention * 100)}%`} sub="last 30 days" />
          <Stat label="Streak" value={`${s.streak}d`} sub={`${s.reviewedToday} today`} />
        </div>
        {card ? (
          <div className="cr-flash">
            <small className="hint">
              {card.deck} · {v.cards.queue.length} left today{card.reps === 0 && card.last === null ? ' · new card' : ''}
            </small>
            <button className={`cr-face${shown ? ' open' : ''}`} onClick={() => setShown(true)} aria-expanded={shown}>
              <b>{card.front}</b>
              {shown ? <span className="cr-back">{card.back}</span> : <small className="hint">Think of the answer, then tap or press Space</small>}
            </button>
            {shown && (
              <div className="cr-grades" role="group" aria-label="How well did you know it?">
                {GRADES.map((g, i) => (
                  <button key={g} className={`cr-g ${g}`} onClick={() => void gradeIt(g)}>
                    <b>{GRADE_LABEL[g]}</b>
                    <small>
                      {ivlText(nextIvl(card, g, v.today))} · {i + 1}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Empty title={s.total ? '🎉 All done for today' : 'No cards yet'}>{s.total ? 'Come back tomorrow: the cards you know well wait longer.' : 'Make your first cards on the right: ports, formulas, Rust rules, exam terms.'}</Empty>
        )}
        {s.decks.length > 0 && (
          <div className="cr-decks">
            {s.decks.slice(0, 8).map((d) => (
              <span key={d.deck}>
                {d.deck} <small>{d.due ? `${d.due} due · ` : ''}{d.total}</small>
              </span>
            ))}
          </div>
        )}
        <p className="hint small">Also on the island (Study) and on Telegram: send /quiz to Ben.</p>
      </section>
      <section className="cr-card cr-make">
        <h3>Make cards</h3>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={'Paste notes or a writeup.\nOne card a line works best:\nSSH port :: 22\nWhat does XOR with itself give? :: 0'} aria-label="Notes to turn into cards" maxLength={6000} />
        <div className="cr-form-row">
          <input value={deck} onChange={(e) => setDeck(e.target.value)} placeholder="Deck, e.g. Ports" list="cr-decks" maxLength={40} aria-label="Deck" />
          <datalist id="cr-decks">
            {v.cards.decks.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <button className="btn small ghost" disabled={!text.trim() || busy} onClick={() => void make(false)}>
            Read my lines
          </button>
          <button className="btn small primary" disabled={!text.trim() || busy} onClick={() => void make(true)}>
            {busy ? 'Ben is reading…' : 'Ben drafts them'}
          </button>
        </div>
        {draft && draft.length > 0 && (
          <div className="cr-draft">
            <ul>
              {draft.map((d, i) => (
                <li key={i}>
                  <label>
                    <input type="checkbox" checked={d.on} onChange={(e) => setDraft((l) => l!.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
                    <b>{d.front}</b>
                    <span>{d.back}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn small primary" disabled={!draft.some((d) => d.on)} onClick={() => void addDraft()}>
              Add {draft.filter((d) => d.on).length} cards
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
