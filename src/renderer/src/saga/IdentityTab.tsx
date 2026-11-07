// LF6: identity votes. 3–5 "I am someone who…" lines; every real log is a
// vote, shown as a bar that fills through the week (the target is a tick on
// it) and the last 4 weeks as small columns.
import { useState, type CSSProperties } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { barFill } from '../motionKit'
import { IDENTITY_MAX, IDENTITY_STARTERS, VOTE_KINDS, type IdentityLine, type VoteKind } from '@core/identityVotes'
import type { SagaView } from '../web/sagaStore'

const HUES = ['#c8f135', '#38d8ff', '#ff9f43', '#ec8db0', '#b892ff']

export function IdentityTab({ v }: { v: SagaView }) {
  const [edit, setEdit] = useState<IdentityLine | 'new' | null>(null)
  const best = [...v.votes].sort((a, b) => b.fill - a.fill || b.week - a.week)[0]
  return (
    <div className="sg-identity">
      <header className="sg-id-head">
        <span className="sg-kicker">Who you are becoming</span>
        <h1 className="sg-title sm">Every log is a vote</h1>
        <p className="sg-theme">Not hype: proof. Each habit, task or session you really log counts for the lines it fits.</p>
        {best && best.week > 0 && <p className="sg-id-best">🔥 {best.line}</p>}
      </header>
      <ul className="sg-id-list">
        {v.votes.map((x, i) => {
          const line = v.identity.lines.find((l) => l.id === x.id)!
          const max = Math.max(1, ...x.weeks, x.target)
          return (
            <li key={x.id} className="sg-id" style={{ '--ic': HUES[i % HUES.length], animationDelay: `${i * 50}ms` } as CSSProperties}>
              <span className="sg-id-emoji" aria-hidden="true">{x.emoji}</span>
              <div className="sg-id-main">
                <div className="sg-id-top">
                  <b>{x.text}</b>
                  <button className="sg-link" onClick={() => setEdit(line)} aria-label={`Edit "${x.text}"`}>Edit</button>
                </div>
                <div className="sg-id-bar pbar" role="meter" aria-label={`${x.week} of ${x.target} votes this week`} aria-valuenow={x.week} aria-valuemin={0} aria-valuemax={x.target}>
                  <i style={barFill(x.fill)} />
                  <span className="sg-id-ticks" aria-hidden="true">{Array.from({ length: Math.min(30, x.target) - 1 }, (_, k) => <s key={k} />)}</span>
                </div>
                <div className="sg-id-foot">
                  <span>{x.line}</span>
                  <small className={`trend ${x.trend}`}>{x.trend === 'up' ? `▲ ${x.week - x.lastWeek} more than last week` : x.trend === 'down' ? `▼ last week ${x.lastWeek}` : x.week ? 'same as last week' : `goal: ${x.target} a week`}</small>
                </div>
                <div className="sg-id-kinds">
                  {line.kinds.map((k) => { const d = VOTE_KINDS.find((q) => q.id === k)!; return <span key={k}>{d.icon} {d.label}</span> })}
                  {line.words.map((w) => <span key={w} className="word">“{w}”</span>)}
                </div>
              </div>
              <div className="sg-id-weeks" aria-label={`Last 4 weeks: ${x.weeks.join(', ')}`}>
                {x.weeks.map((n, k) => (
                  <span key={k} className={k === 3 ? 'now' : ''}><i style={{ transform: `scaleY(${Math.max(0.04, n / max)})` }} /><small>{k === 3 ? 'now' : `−${3 - k}w`}</small></span>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
      {v.identity.lines.length < IDENTITY_MAX && (
        <div className="sg-id-add">
          <button className="btn primary" onClick={() => setEdit('new')}>＋ Add an “I am…” line</button>
          {v.identity.lines.length < 3 && <small className="sg-muted">3 to 5 lines work best.</small>}
        </div>
      )}
      {edit && <LineSheet v={v} line={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function LineSheet({ v, line, onClose }: { v: SagaView; line: IdentityLine | null; onClose: () => void }) {
  const act = useAction()
  const [text, setText] = useState(line?.text ?? '')
  const [emoji, setEmoji] = useState(line?.emoji ?? '✦')
  const [kinds, setKinds] = useState<VoteKind[]>(line?.kinds ?? [])
  const [words, setWords] = useState((line?.words ?? []).join(', '))
  const [target, setTarget] = useState(line?.target ?? 10)
  const used = new Set(v.identity.lines.map((l) => l.text.toLowerCase()))
  const save = async (next: IdentityLine[]) => {
    const ok = await act(() => life.saga!.saveIdentity({ lines: next }))
    if (ok !== undefined) onClose()
  }
  const me: IdentityLine = { id: line?.id ?? `i${Date.now().toString(36)}`, text: text.trim(), emoji: emoji.trim() || '✦', kinds, words: words.split(',').map((w) => w.trim()).filter(Boolean), target }
  return (
    <div className="sheet sg-sheet" role="dialog" aria-modal="true" aria-label="Identity line" onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card sg-sheet-card">
        <header className="sg-sheet-head">
          <b>{line ? 'Edit the line' : 'I am someone who…'}</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {!line && (
          <div className="sg-starters">
            {IDENTITY_STARTERS.filter((s) => !used.has(s.text.toLowerCase())).map((s) => (
              <button key={s.text} className="sg-chip" onClick={() => { setText(s.text); setEmoji(s.emoji); setKinds(s.kinds); setWords(s.words.join(', ')); setTarget(s.target) }}>
                {s.emoji} {s.text}
              </button>
            ))}
          </div>
        )}
        <div className="sg-form">
          <div className="sg-row">
            <label className="narrow">Icon<input value={emoji} maxLength={4} onChange={(e) => setEmoji(e.target.value)} /></label>
            <label className="grow">The line<input value={text} maxLength={70} autoFocus placeholder="I am a disciplined hacker" onChange={(e) => setText(e.target.value)} /></label>
          </div>
          <fieldset>
            <legend>What counts as a vote</legend>
            <div className="sg-chips">
              {VOTE_KINDS.map((k) => (
                <button key={k.id} className={`sg-chip ${kinds.includes(k.id) ? 'on' : ''}`} aria-pressed={kinds.includes(k.id)} title={k.hint} onClick={() => setKinds((ks) => (ks.includes(k.id) ? ks.filter((x) => x !== k.id) : [...ks, k.id]))}>
                  {k.icon} {k.label}
                </button>
              ))}
            </div>
          </fieldset>
          <label>Also words in what you log (comma-separated)<input value={words} maxLength={120} placeholder="CTF, rust, mom" onChange={(e) => setWords(e.target.value)} /></label>
          <label>Votes a week that fill the bar: <b>{target}</b><input type="range" min={1} max={40} value={target} onChange={(e) => setTarget(Number(e.target.value))} /></label>
          <footer className="sg-sheet-foot">
            {line && <button className="btn ghost danger" onClick={() => save(v.identity.lines.filter((l) => l.id !== line.id))}>Remove</button>}
            <button className="btn primary" disabled={!me.text || (!me.kinds.length && !me.words.length)} onClick={() => save(line ? v.identity.lines.map((l) => (l.id === line.id ? me : l)) : [...v.identity.lines, me])}>Save</button>
          </footer>
        </div>
      </div>
    </div>
  )
}
