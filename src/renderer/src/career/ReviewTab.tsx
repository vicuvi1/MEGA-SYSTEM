// CR20: the monthly career review letters. Ben writes one in the first week
// of each month (and sends it on Telegram); you can write one any time.
import { useState } from 'react'
import { life } from '../bridge'
import { monthLabel } from '@core/career/letter'
import type { CareerView } from '../web/career'
import { BenAvatar } from '../BenAvatar'
import { Empty, hm, type Run } from './ui'

export function ReviewTab({ v, run }: { v: CareerView; run: Run }) {
  const c = life.career!
  const [open, setOpen] = useState(0)
  const l = v.letters[open] ?? null
  const month = v.today.slice(0, 7)
  return (
    <div className="cr-review-tab">
      <section className="cr-card cr-letter" aria-label="Career letter">
        {l ? (
          <>
            <header>
              <BenAvatar size={40} />
              <div>
                <h3>{l.title}</h3>
                <small className="hint">From Ben · written {l.written}</small>
              </div>
            </header>
            <ul>
              {l.lines.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <p className="cr-change">
              <b>One change for next month</b>
              {l.change}
            </p>
          </>
        ) : (
          <Empty title="No letter yet">Ben writes your career letter in the first week of each month: applications, skills, portfolio, hours, income, and one change.</Empty>
        )}
      </section>
      <aside className="cr-letters-side">
        <section className="cr-card">
          <h3>This month so far</h3>
          <p className="hint">
            {v.week.sent} applications this week · {v.proofs.filter((p) => p.day.startsWith(month)).length} portfolio entries · {hm(v.hours.month)} of career work · income {v.money.income.total.toLocaleString('en-US')} lei
          </p>
          <div className="cr-form-foot">
            {v.letterDue && (
              <button className="btn small primary" onClick={() => void run(() => c.writeLetter(v.letterDue!), 'Letter written').then(() => setOpen(0))}>
                Write {monthLabel(v.letterDue)}
              </button>
            )}
            <button className="btn small ghost" onClick={() => void run(() => c.writeLetter(month), 'Letter written').then(() => setOpen(0))}>
              Letter for {monthLabel(month)} so far
            </button>
          </div>
        </section>
        {v.letters.length > 1 && (
          <section className="cr-card">
            <h3>Earlier letters</h3>
            <ul className="cr-old">
              {v.letters.map((x, i) => (
                <li key={x.month}>
                  <button className={i === open ? 'on' : ''} onClick={() => setOpen(i)}>
                    {monthLabel(x.month)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  )
}
