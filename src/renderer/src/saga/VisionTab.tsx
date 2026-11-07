// LF4: the vision board. One word for the year, the "who I'm becoming"
// line and 6–9 cards (drawn art or your own picture plus one sentence).
// Goals and season quests can link to a card.
import { useEffect, useRef, useState } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { VISION_ARTS, VISION_MAX, VISION_MIN, type VisionArt, type VisionBook, type VisionCard } from '@core/vision'
import type { SagaView } from '../web/sagaStore'
import { VisionArtSvg } from './sagaArt'
import { smallPicture } from './useSaga'

const uid = () => `v${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`

export function VisionTab({ v }: { v: SagaView }) {
  const act = useAction()
  const [edit, setEdit] = useState(false)
  const [draft, setDraft] = useState<VisionBook>(v.vision)
  const [card, setCard] = useState<VisionCard | 'new' | null>(null)
  useEffect(() => {
    if (!edit) setDraft(v.vision)
  }, [v.vision, edit])
  const b = edit ? draft : v.vision
  const empty = !b.word && !b.becoming && !b.cards.length
  const save = async (next: VisionBook) => {
    setDraft(next)
    await act(() => life.saga!.saveVision(next))
  }
  const linked = (id: string) => [
    ...v.goals.filter((g) => g.card === id).map((g) => g.title),
    ...(v.current?.season.quests.filter((q) => q.cardId === id).map((q) => q.title) ?? [])
  ]
  return (
    <div className="sg-vision">
      <section className="sg-vision-head">
        <span className="sg-kicker">{b.year} · word of the year</span>
        {edit ? (
          <input className="sg-word-input" value={draft.word} maxLength={24} placeholder="Honor" onChange={(e) => setDraft({ ...draft, word: e.target.value })} aria-label="Word of the year" />
        ) : (
          <h1 className={`sg-word ${b.word ? '' : 'empty'}`}>{b.word || 'Your word'}</h1>
        )}
        {edit ? (
          <input className="sg-becoming-input" value={draft.becoming} maxLength={140} placeholder="A calm, strong man who keeps his word" onChange={(e) => setDraft({ ...draft, becoming: e.target.value })} aria-label="Who I'm becoming" />
        ) : (
          <p className="sg-becoming">{b.becoming ? <>Who I'm becoming: <em>{b.becoming}</em></> : 'Who are you becoming this year? One line.'}</p>
        )}
        <div className="sg-vision-actions">
          {edit ? (
            <>
              <button className="btn primary" onClick={async () => { await save(draft); setEdit(false) }}>Save</button>
              <button className="btn ghost" onClick={() => { setDraft(v.vision); setEdit(false) }}>Cancel</button>
            </>
          ) : (
            <button className="btn" onClick={() => setEdit(true)}>{empty ? 'Make your board' : 'Edit word and line'}</button>
          )}
          <small className="sg-muted">Shows on the island's morning card and in Ben's chats.</small>
        </div>
      </section>

      <section className={`sg-board n-${b.cards.length}`} aria-label="Vision cards">
        {b.cards.map((c, i) => {
          const links = linked(c.id)
          return (
            <button key={c.id} className="sg-vcard" style={{ animationDelay: `${i * 40}ms` }} onClick={() => setCard(c)} aria-label={`Vision card: ${c.text}. Edit`}>
              {v.photos[c.id] ? <img className="sg-vcard-art" src={v.photos[c.id]} alt="" /> : <VisionArtSvg art={c.art} className="sg-vcard-art" />}
              <span className="sg-vcard-shade" />
              <span className="sg-vcard-text">
                <b>{c.text}</b>
                {links.length > 0 && <small>↳ {links.slice(0, 2).join(' · ')}</small>}
              </span>
            </button>
          )
        })}
        {b.cards.length < VISION_MAX && (
          <button className="sg-vcard add" onClick={() => setCard('new')}>
            <span>＋</span>
            <small>{b.cards.length < VISION_MIN ? `Add a card (${b.cards.length} of ${VISION_MIN}–${VISION_MAX})` : 'Add a card'}</small>
          </button>
        )}
      </section>
      {card && <CardSheet v={v} card={card === 'new' ? null : card} onClose={() => setCard(null)} />}
    </div>
  )
}

function CardSheet({ v, card, onClose }: { v: SagaView; card: VisionCard | null; onClose: () => void }) {
  const act = useAction()
  const [text, setText] = useState(card?.text ?? '')
  const [art, setArt] = useState<VisionArt>(card?.art ?? VISION_ARTS[v.vision.cards.length % VISION_ARTS.length].id)
  const file = useRef<HTMLInputElement>(null)
  const photo = card ? v.photos[card.id] : undefined
  const save = async () => {
    const id = card?.id ?? uid()
    const cards = card ? v.vision.cards.map((c) => (c.id === id ? { ...c, text: text.trim(), art } : c)) : [...v.vision.cards, { id, text: text.trim(), art, photo: false }]
    const ok = await act(() => life.saga!.saveVision({ ...v.vision, cards }))
    if (ok !== undefined) onClose()
    return id
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    const id = card?.id ?? (await save())
    await act(async () => life.saga!.setCardPhoto(id, await smallPicture(f, 720, 115_000)), 'Picture saved')
  }
  return (
    <div className="sheet sg-sheet" role="dialog" aria-modal="true" aria-label={card ? 'Edit vision card' : 'New vision card'} onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card sg-sheet-card">
        <header className="sg-sheet-head">
          <b>{card ? 'Vision card' : 'New vision card'}</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="sg-card-preview">
          {photo ? <img src={photo} alt="" /> : <VisionArtSvg art={art} />}
          <span className="sg-vcard-shade" />
          <b>{text || 'One sentence: "OSCP passed"'}</b>
        </div>
        <div className="sg-form">
          <label>The sentence<input value={text} maxLength={80} autoFocus placeholder="OSCP passed" onChange={(e) => setText(e.target.value)} /></label>
          <fieldset>
            <legend>Drawn art</legend>
            <div className="sg-art-grid">
              {VISION_ARTS.map((a) => (
                <button key={a.id} className={`sg-art-pick ${art === a.id && !photo ? 'on' : ''}`} onClick={() => setArt(a.id)} aria-label={a.label} aria-pressed={art === a.id}>
                  <VisionArtSvg art={a.id} />
                </button>
              ))}
            </div>
          </fieldset>
          <div className="sg-row">
            <button className="btn" onClick={() => file.current?.click()} disabled={!text.trim()}>{photo ? 'Change picture' : 'Use my own picture'}</button>
            {photo && card && <button className="btn ghost" onClick={() => act(() => life.saga!.setCardPhoto(card.id, null))}>Use drawn art</button>}
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
          </div>
          <footer className="sg-sheet-foot">
            {card && <button className="btn ghost danger" onClick={async () => { await act(() => life.saga!.saveVision({ ...v.vision, cards: v.vision.cards.filter((c) => c.id !== card.id) })); onClose() }}>Remove</button>}
            <button className="btn primary" disabled={!text.trim()} onClick={() => void save()}>Save</button>
          </footer>
        </div>
      </div>
    </div>
  )
}
