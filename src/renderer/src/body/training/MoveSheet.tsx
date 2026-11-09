// How to do a move: the drawn demo (library moves), the steps, the common
// mistake and what it needs. Opened from today's session and the roadmap.
import { moveInfo, rangeText, type Level } from '@core/trainLadders'
import { FigureSvg } from '../../DrillFigure'

export function MoveSheet({ level, title, onClose, children }: { level: Level; title?: string; onClose: () => void; children?: React.ReactNode }) {
  const m = moveInfo(level.move)
  if (!m) return null
  return (
    <div className="sheet tr-sheet" role="dialog" aria-modal="true" aria-label={m.name} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card tr-sheet-card" data-tr="move-sheet">
        {title && <small className="bdy-eyebrow">{title}</small>}
        <h3 className="bdy-title">{m.name}</h3>
        <p className="bdy-note">
          {rangeText(level)} a set · {m.muscles.join(', ')}
          {m.needs ? ` · needs ${m.needs}` : ''}
        </p>
        {m.lib && (
          <div className="tr-demo">
            <FigureSvg anim={m.lib.anim} size={120} />
          </div>
        )}
        <ol className="tr-steps">
          {m.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="tr-mistake">
          <b>Common mistake:</b> {m.mistake}
        </p>
        {children}
        <div className="sheet-actions">
          <button type="button" className="bdy-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
