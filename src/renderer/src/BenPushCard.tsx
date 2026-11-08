// Ben 2: a push as a card on the Coach page (the same push Telegram got, by
// its one key): a block check-in with Start / 10 min later / Skip, the morning
// brief with Plan my day, the evening shutdown with Tomorrow / Drop / Keep
// today on each open item (the same marks as Telegram and Today's Shut down),
// and the weekly card (a score, 3 wins, 1 thing to fix, next week's top 3).
import { useEffect, useState } from 'react'
import { askWhyStalling } from './boost/boostBus'
import { life } from './bridge'
import { useAction } from './ui'
import { MARK_WORD, type ItemMark, type PushCard, type PushLog, type PushOp } from '@core/benPushes'
import { WeekTop3Pick } from './WeekTop3'
import './benPush.css'

const ICON: Record<PushCard['type'], string> = { checkin: '🎯', brief: '☀️', shutdown: '🌙', weekly: '📊', drift: '👀', workoutNote: '💪', rescue: '🛟' }

export function BenPushCard({ card, live, onChange }: { card: PushCard; live: boolean; onChange?: () => void }) {
  const act = useAction()
  const [log, setLog] = useState<PushLog | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  useEffect(() => {
    if (!live) return
    life.coach?.pushes?.log().then(setLog).catch(() => {})
  }, [live, said])
  const answered = log?.recs[card.key]?.ans ?? null
  const answer = async (op: PushOp, line: string, then?: () => Promise<unknown>) => {
    const r = await act(async () => {
      if (then) await then()
      await life.coach!.pushes!.answer(card.key, op, 10)
      return true
    }, line)
    if (r) {
      setSaid(line)
      onChange?.()
    }
  }
  const mark = async (id: string, m: ItemMark) => {
    const r = await act(() => life.coach!.pushes!.mark(id, m), (x) => x)
    if (r) setSaid(r)
  }
  // Auto-rescue: Accept / Not now / Skip today, then Undo (the same answers as the island and Telegram).
  const rescue = async (op: 'accept' | 'later' | 'skip' | 'undo') => {
    const r = await act(() => life.coach!.pushes!.rescue!(op, card.key), (x) => x)
    if (r) {
      setSaid(r)
      onChange?.()
    }
  }
  const can = live && !!life.coach?.pushes && !answered
  const marks = log?.shutdown?.marks ?? {}
  const body = card.type === 'weekly' ? null : card.lines.filter(Boolean)
  return (
    <div className={`cf-card bp-card t-${card.type} ${live ? '' : 'settled'}`} data-push={card.type}>
      <div className="cf-card-head">
        <span className="ic">{ICON[card.type]}</span>
        <b>{card.title}</b>
        {answered && <small>{answered === 'start' ? 'started' : answered === 'skip' ? 'skipped' : answered === 'later' ? 'in 10 min' : 'done'}</small>}
      </div>
      {card.weekly ? (
        <div className="bp-week">
          <div className="bp-score">
            <b>{card.weekly.score}</b>
            <small>/100 · {card.weekly.delta >= 0 ? '+' : ''}{card.weekly.delta} vs last week</small>
          </div>
          <div className="bp-wins">
            <span className="bp-sub">🏆 Wins</span>
            <ul>
              {card.weekly.wins.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <span className="bp-sub">🔧 One thing to fix</span>
            <p>{card.weekly.fix}</p>
          </div>
        </div>
      ) : (
        <ul className="bp-lines">
          {(card.type === 'shutdown' ? body!.filter((l) => !/^\d+\. /.test(l) && !/^Still open/.test(l)) : body!).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {card.type === 'shutdown' && !!card.items?.length && (
        <ol className="bp-items" aria-label="Still open">
          {card.items.map((x) => (
            <li key={x.id}>
              <span>{x.text}</span>
              {marks[x.id] ? (
                <small className="bp-mark">{MARK_WORD[marks[x.id]]}</small>
              ) : live && life.coach?.pushes ? (
                <span className="bp-acts">
                  <button type="button" onClick={() => void mark(x.id, 'tomorrow')}>Tomorrow</button>
                  <button type="button" onClick={() => void mark(x.id, 'drop')}>Drop</button>
                  <button type="button" onClick={() => void mark(x.id, 'keep')}>Keep today</button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {can && card.type === 'checkin' && (
        <div className="cf-btns">
          <button className="p" onClick={() => void answer('start', `▶ ${card.title.split(' · ')[0]}`, () => life.focus.start(card.title.split(' · ')[0].slice(0, 40), 50, null))}>▶ Start</button>
          <button onClick={() => void answer('later', '⏰ Again in 10 min').then(() => askWhyStalling(card.title.split(' · ')[0]))}>10 min later</button>
          <button onClick={() => void answer('skip', 'Skipped for today').then(() => askWhyStalling(card.title.split(' · ')[0]))}>Skip</button>
        </div>
      )}
      {can && card.type === 'brief' && (
        <div className="cf-btns">
          <button className="p" onClick={() => void answer('plan', '🗓 Planning your day…', () => life.coach!.rhythm!('propose'))}>🗓 Plan my day</button>
          <button onClick={() => void answer('ok', '👍')}>Got it</button>
        </div>
      )}
      {live && card.type === 'shutdown' && (
        <div className="cf-btns">
          <button
            className="p"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'today' }))
              setTimeout(() => window.dispatchEvent(new CustomEvent('life-close-day')), 400)
            }}
          >
            🌙 Shut down
          </button>
        </div>
      )}
      {can && card.type === 'rescue' && life.coach?.pushes?.rescue && (
        <div className="cf-btns">
          <button className="p" onClick={() => void rescue('accept')}>✅ Accept</button>
          {!card.key.endsWith(':again') && <button onClick={() => void rescue('later')}>Not now</button>}
          <button onClick={() => void rescue('skip')}>Skip today</button>
        </div>
      )}
      {live && card.type === 'rescue' && answered === 'accept' && life.coach?.pushes?.rescue && (
        <div className="cf-btns">
          <button onClick={() => void rescue('undo')}>↩ Undo</button>
        </div>
      )}
      {live && card.type === 'weekly' && <WeekTop3Pick />}
      {said && <small className="cf-done">{said}</small>}
    </div>
  )
}
