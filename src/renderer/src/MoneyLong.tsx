// Money page → Month: the long view in one card (net worth, its change this
// year, the savings rate, the runway). The full screen is Finance Helper's
// Reports → Long view, one tap away. Read only.
import { totalText } from '@core/moneyText'
import type { MoneyHubView } from './web/moneyHub'
import './moneyLong.css'

const monthsText = (n: number) => (n >= 10 ? String(Math.round(n)) : (Math.round(n * 10) / 10).toString().replace('.', ','))

export function LongViewCard({ view, onOpenApp }: { view: MoneyHubView; onOpenApp: () => void }) {
  const c = view.long
  if (!c) return null
  const cur = c.currency || view.currency
  const up = c.changeThisYear >= 0
  const open = () => {
    try {
      localStorage.setItem('finance-helper.goto', JSON.stringify({ screen: 'longview', at: Date.now() }))
    } catch {
      /* storage blocked: the app still opens */
    }
    onOpenApp()
  }
  return (
    <section className="mh-card mlv" data-testid="money-long">
      <header className="mh-head">
        <h2>Long view</h2>
        <button type="button" className="mh-link" onClick={open}>
          See it all
        </button>
      </header>
      <dl className="mlv-row">
        <div>
          <dt>Net worth</dt>
          <dd>{totalText(c.netWorth, cur)}</dd>
        </div>
        <div>
          <dt>This year</dt>
          <dd className={up ? 'good' : 'bad'}>
            {up ? '+' : '−'}
            {totalText(Math.abs(c.changeThisYear), cur)}
          </dd>
        </div>
        <div>
          <dt>Savings rate</dt>
          <dd>{c.savingsRate == null ? '–' : `${Math.round(c.savingsRate * 100)}%`}</dd>
        </div>
        <div>
          <dt>Runway</dt>
          <dd>{c.runway == null ? '–' : `${monthsText(Math.min(c.runway, 120))} months`}</dd>
        </div>
      </dl>
      <p className="mlv-line">{c.runwayText}</p>
    </section>
  )
}
