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
      <StylePanel />
      {v.selfReview && (
        <section className="panel">
          <header className="panel-head">
            <h2>🧠 Ben's notes to himself</h2>
          </header>
          <small className="ab-when">From his review of {short(`${v.selfReview.day}T12:00:00`)}</small>
          <ul className="ab-list">
            {v.selfReview.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <p className="hint small">Every night at 23:15 Ben reads his own day (what helped, what you ignored, your 👍/👎) and changes how he coaches you tomorrow.</p>
        </section>
      )}
      <section className="panel ab-letter">
        <header className="panel-head">
          <h2>💌 Letter from Ben</h2>
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

const TONE_LABEL = ['', 'Gentle', 'Warm', 'Tough love', 'Hard', 'Drill sergeant']
/** How Ben talks: length and tone (he also changes it when you tell him "be shorter"). */
function StylePanel() {
  const act = useAction()
  const [st, setSt] = useState<{ length: 'short' | 'normal' | 'detailed'; tone: number; lang?: 'en' | 'ro' | 'ru' | 'auto' } | null>(null)
  useEffect(() => {
    life.coach?.style?.().then(setSt).catch(() => {})
  }, [])
  if (!st || !life.coach?.setStyle) return null
  const save = async (p: Partial<typeof st>) => {
    setSt({ ...st, ...p })
    await act(() => life.coach!.setStyle!(p))
  }
  return (
    <section className="panel ab-style">
      <header className="panel-head">
        <h2>🎚 How Ben talks</h2>
      </header>
      <small className="ab-when">Length</small>
      <div className="isl-seg ab-seg">
        {(['short', 'normal', 'detailed'] as const).map((l) => (
          <button key={l} className={st.length === l ? 'on' : ''} onClick={() => void save({ length: l })}>
            {l === 'short' ? 'Short' : l === 'normal' ? 'Normal' : 'Detailed'}
          </button>
        ))}
      </div>
      <small className="ab-when">
        Tone: <b>{TONE_LABEL[st.tone]}</b>
      </small>
      <input className="ab-tone" type="range" min={1} max={5} step={1} value={st.tone} onChange={(e) => void save({ tone: Number(e.target.value) })} aria-label="Tone" />
      <div className="ab-tone-ends">
        <span>😊 Gentle</span>
        <span>😡 Drill sergeant</span>
      </div>
      <small className="ab-when">Language</small>
      <div className="isl-seg ab-seg">
        {(['en', 'ro', 'ru', 'auto'] as const).map((l) => (
          <button key={l} className={(st.lang ?? 'en') === l ? 'on' : ''} onClick={() => void save({ lang: l })}>
            {l === 'en' ? 'English' : l === 'ro' ? 'Română' : l === 'ru' ? 'Русский' : 'Like my message'}
          </button>
        ))}
      </div>
    </section>
  )
}
