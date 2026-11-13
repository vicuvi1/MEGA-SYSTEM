// [books] Money v2 phase 2 on Life's Money page: the Personal / Business / Both
// switch (shared with Finance Helper on this device through localStorage
// `money_book`) and, in the Business view, a short business card. The numbers
// come from Finance Helper's own books.js / business.js (web/moneyHub.ts);
// nothing here writes money data.
import { useEffect } from 'react'
import type { MoneyBook, MoneyHubView } from './web/moneyHub'
import { totalText } from '@core/moneyText'

export const BOOK_KEY = 'money_book'
export const BIZ_CUR_KEY = 'money_biz_currency'
const BOOKS: { id: MoneyBook; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'business', label: 'Business' },
  { id: 'both', label: 'Both' }
]

function put(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage blocked: this session only */
  }
}

export function BookSwitch({ view, onChange }: { view: MoneyHubView; onChange: () => void }) {
  // Finance Helper (another page on this device) changed the pick: follow it.
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === BOOK_KEY || e.key === BIZ_CUR_KEY) onChange()
    }
    window.addEventListener('storage', on)
    return () => window.removeEventListener('storage', on)
  }, [onChange])
  const pick = (b: MoneyBook) => {
    put(BOOK_KEY, b)
    onChange()
  }
  return (
    <div className="mh-books" data-testid="money-book-switch">
      <div className="mh-books-seg" role="radiogroup" aria-label="Which money to show">
        {BOOKS.map((b) => (
          <button key={b.id} type="button" role="radio" aria-checked={view.book === b.id} className={view.book === b.id ? 'on' : ''} onClick={() => pick(b.id)}>
            {b.label}
          </button>
        ))}
      </div>
      {!view.booksOn && view.book !== 'both' && <small className="mh-books-hint">No business accounts yet: everything is personal. Mark one in Finance Helper → Books.</small>}
    </div>
  )
}

export function BusinessHubCard({ view, onChange }: { view: MoneyHubView; onChange: () => void }) {
  const b = view.business
  if (!b) return null
  const t = (n: number) => totalText(n, b.currency)
  return (
    <section className="mh-card mh-biz" data-testid="money-business">
      <header className="mh-head">
        <h2>Business this month</h2>
        <span className="mh-books-seg mh-biz-cur" role="radiogroup" aria-label="Report currency">
          {['MDL', 'USD', 'EUR'].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={b.currency === c}
              className={b.currency === c ? 'on' : ''}
              onClick={() => {
                put(BIZ_CUR_KEY, c)
                onChange()
              }}
            >
              {c}
            </button>
          ))}
        </span>
      </header>
      {!b.hasBusiness ? (
        <p className="mh-biz-empty">No business money yet. In Finance Helper, open Books… and mark the account your clients pay into as Business (you can undo it).</p>
      ) : (
        <>
          <div className="mh-biz-kpis">
            <div>
              <span>Profit</span>
              <b data-testid="money-biz-profit">{t(b.profit)}</b>
            </div>
            <div>
              <span>Income</span>
              <b>{t(b.income)}</b>
            </div>
            <div>
              <span>Costs</span>
              <b>{t(b.costs)}</b>
            </div>
            <div>
              <span>Paid to you</span>
              <b>{t(b.draws)}</b>
            </div>
          </div>
          <p className="mh-biz-line">
            {b.unpaid ? `${b.unpaid} unpaid invoice${b.unpaid === 1 ? '' : 's'} · ${b.unpaidText}` : 'No unpaid invoices'}
            {b.overdue ? ` · ${b.overdue} overdue` : ''}
          </p>
          {b.hours > 0 && (
            <p className="mh-biz-line">
              {String(b.hours).replace('.', ',')} h billed this month{b.perHour ? ` · ${t(b.perHour)}/h` : ''}
            </p>
          )}
          {b.clients.length > 0 && <p className="mh-biz-line">Top clients this year: {b.clients.map((c) => `${c.name} ${t(c.amount)}`).join(' · ')}</p>}
        </>
      )}
    </section>
  )
}
