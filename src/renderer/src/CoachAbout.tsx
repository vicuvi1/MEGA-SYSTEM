// Coach → About you: the weekly letter, what your own data shows, the promise
// timeline and your wins (the editable notes and memory come below it).
import { useCallback, useEffect, useState } from 'react'
import type { ProfileView } from './web/coachProfile'
import { life } from './bridge'
import { Icon } from './Icon'
import { useAction } from './ui'
import { useLive } from './live'

const STATE: Record<string, { label: string; cls: string }> = {
  kept: { label: 'Kept', cls: 'good' },
  broken: { label: 'Broken', cls: 'bad' },
  ignored: { label: 'Ignored', cls: 'bad' },
  answered: { label: 'Answered', cls: 'ok' },
  open: { label: 'Waiting', cls: 'ok' }
}
const short = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export function CoachAbout() {
  const act = useAction()
  const [v, setV] = useState<ProfileView | null>(null)
  const [writing, setWriting] = useState(false)
  const load = useCallback(() => {
    life.coach?.profileView?.().then(setV).catch(() => {})
  }, [])
  useEffect(load, [load])
  useLive(load)
  if (!v) return null
  const letter = v.letters[v.letters.length - 1]
  const write = async () => {
    setWriting(true)
    const r = await act(() => life.coach!.rhythm!('letter'))
    setWriting(false)
    if (r && !r.letter) await act(async () => r, 'The coach needs its AI key to write letters')
    load()
  }
  return (
    <>
      <section className="panel ab-letter">
        <header className="panel-head">
          <h2>💌 Letter from Mega</h2>
          <button className="btn small ghost" disabled={writing} onClick={() => void write()}>
            {writing ? 'Writing…' : letter ? 'Write a new one' : "Write this week's"}
          </button>
        </header>
        {letter ? (
          <>
            <small className="ab-when">Week of {short(`${letter.week}T12:00:00`)}</small>
            <p className="ab-letter-text">{letter.text}</p>
          </>
        ) : (
          <p className="hint small">Every Sunday the coach writes you a letter: what it noticed, what it is proud of, what worries it, and the one thing it wants next week.</p>
        )}
      </section>

      {v.dataPatterns.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="chart" /> What your data shows
            </h2>
          </header>
          <ul className="ab-list">
            {v.dataPatterns.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="hint small">Found in your last 8 weeks, not guessed. The coach uses these when it advises you.</p>
        </section>
      )}

      <section className="panel">
        <header className="panel-head">
          <h2>🤝 Promises · 2 weeks</h2>
        </header>
        {v.promises.length ? (
          <ul className="ab-timeline">
            {v.promises.map((p, i) => (
              <li key={i}>
                <span className={`ab-state ${STATE[p.state].cls}`}>{STATE[p.state].label}</span>
                <span className="ab-ptext">{p.text}</span>
                <small>{short(p.at)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint small">No promises yet. When you tell the coach you'll do something, it checks on you and keeps score here.</p>
        )}
      </section>

      {v.wins.length > 0 && (
        <section className="panel">
          <header className="panel-head">
            <h2>🏆 Your wins</h2>
          </header>
          <ul className="ab-list wins">
            {v.wins.map((w) => (
              <li key={w.day + w.text}>
                <b>{short(`${w.day}T12:00:00`)}</b> {w.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
