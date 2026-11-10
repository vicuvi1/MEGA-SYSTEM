// Sport Track → the swap sheet: tap a move (Change ›) to pick how hard, with a
// real photo for every option. It lists the move's chain around your step:
// easier steps, your step, the next one and a side option; harder locked steps
// are only named (they open in Exercises) and moves that need gear you don't own
// are not listed. The big demo loops the picked move with a short pop-in
// (prefers-reduced-motion: none). "Use … today" changes today only; "Make it my
// step" changes your level on the chain. Your history is never deleted.
import { useEffect, useMemo, useRef, useState } from 'react'
import { swapView, type SwapOption } from '@core/trainSwap'
import type { LadderId } from '@core/trainLadders'
import { DemoPic, MovePic } from './MovePic'
import type { SportTrain } from './useSportTrain'

const restText = (s: number) => `${s} s`
const EYEBROW: Record<LadderId, string> = { push: 'Push path', pull: 'Pull path', shoulders: 'Shoulders path', single: 'Legs path', hinge: 'Hinge path', core: 'Core path' }

export function SwapSheet({ t, ladder, onClose, onGear }: { t: SportTrain; ladder: LadderId; onClose: () => void; onGear: () => void }) {
  const view = useMemo(() => swapView(t.st, ladder, t.today, t.v.dose), [t.st, ladder, t.today, t.v.dose])
  const [sel, setSel] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!view) return null
  const cur: SwapOption = view.options.find((o) => o.move === sel) ?? view.options.find((o) => o.move === view.now.move) ?? view.options[0]
  const onToday = cur.move === view.now.move
  const isYours = cur.move === view.yours.move
  const canStep = cur.index != null && !isYours
  const name = view.now.name
  const useToday = () => {
    if (isYours) t.usePick(ladder, null)
    else t.usePick(ladder, cur.level)
    onClose()
  }
  const step = () => {
    if (cur.index == null) return
    t.makeStep(ladder, cur.index)
    onClose()
  }
  return (
    <div className="sp-sheet-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-sp="swap-back">
      <section className="sp-sheet" role="dialog" aria-modal="true" aria-label={`Change ${name}`} data-sp="swap">
        <header className="sp-sheet-head">
          <div>
            <small className="sp-eyebrow">{EYEBROW[ladder]} · today&rsquo;s move</small>
            <h2>Pick how hard</h2>
          </div>
          <button type="button" ref={closeRef} className="sp-sheet-x" onClick={onClose} aria-label="Close" data-sp="swap-close">
            ×
          </button>
        </header>
        <div className="sp-sheet-body">
          <div className="sp-sheet-demo">
            <div className="sp-sheet-stage">
              <DemoPic move={cur.move} pop fig={260} className="big" />
              <span className="sp-sheet-badge">{cur.kind === 'yours' ? (view.picked ? 'Your step' : 'Your step now') : cur.kind === 'next' ? 'Next step: try it today' : cur.kind === 'side' ? 'Side option' : cur.kind === 'alt' ? 'Another way' : 'Easier'}</span>
              <span className="sp-sheet-loop">Real demo · loops start → end</span>
            </div>
            <div className="sp-sheet-stats">
              <div>
                <b className="num">{cur.target}</b>
                <small>sets × reps</small>
              </div>
              <div>
                <b className="num">{restText(cur.rest)}</b>
                <small>rest</small>
              </div>
              <div>
                <b>{cur.needs}</b>
                <small>needs</small>
              </div>
            </div>
          </div>
          <div className="sp-sheet-side">
            <div>
              <h3 data-sp="swap-name">{cur.name}</h3>
              <p className="sp-sheet-why">{cur.why}</p>
            </div>
            <ul className="sp-picks" role="listbox" aria-label="Moves you can pick">
              {view.options.map((o) => (
                <li key={o.move}>
                  <button type="button" role="option" aria-selected={o.move === cur.move} className={`sp-pick${o.move === cur.move ? ' on' : ''}`} onClick={() => setSel(o.move)} data-pick={o.move} data-kind={o.kind}>
                    <MovePic move={o.move} size="md" />
                    <span className="sp-pick-text">
                      <small className={o.kind === 'yours' ? 'yours' : o.kind === 'side' ? 'side' : 'ladder'}>{o.label}</small>
                      <b>{o.name}</b>
                      <span>{o.line}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="sp-sheet-actions">
              <button type="button" className="sp-btn primary big grow" onClick={useToday} disabled={onToday && !(isYours && view.picked)} data-sp="swap-use">
                {isYours && view.picked ? `Back to ${cur.name} today` : `Use ${cur.name} today`}
              </button>
              <button type="button" className="sp-btn big grow" onClick={step} disabled={!canStep} title={cur.index == null ? 'This one is not a step of the chain: use it for today only.' : undefined} data-sp="swap-step">
                Make it my step
              </button>
            </div>
            <p className="sp-small">
              {view.locked.length ? `Harder locked steps (${view.locked.join(', ')}) open from Exercises. ` : 'Nothing harder is left on this chain with your gear. '}
              Your history always stays.{' '}
              <button type="button" className="sp-link inline" onClick={() => { onClose(); onGear() }}>
                Edit gear
              </button>
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
