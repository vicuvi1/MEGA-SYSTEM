// Settings → Rewards (RL3, RL7): your monthly fun budget (typed, or taken from
// Finance Helper's Fun / Entertainment limit), what a point is worth, and the
// one-tap move of this month's leftover to a Finance Helper savings goal.
import { useEffect, useState } from 'react'
import type { LeftoverState, ShopValue } from '@shared/api'
import { pointValueLine } from '@core/pointValue'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Row, Saved } from '../settingsUi'
import { useAction } from '../ui'

const lei = (n: number) => `${Math.round(n).toLocaleString('en-US')} lei`

export function RewardsSection() {
  const act = useAction()
  const [v, setV] = useState<ShopValue | null>(null)
  const [left, setLeft] = useState<LeftoverState | null>(null)
  const [draft, setDraft] = useState('')
  const [flash, setFlash] = useState(false)

  const load = () => {
    life.shop.value().then((x) => {
      setV(x)
      setDraft(x.funBudgetLei != null && x.funSource !== 'finance' ? String(x.funBudgetLei) : '')
    }).catch(() => {})
    life.shop.leftover().then(setLeft).catch(() => {})
  }
  useEffect(load, [])

  const saved = (x: ShopValue | undefined) => {
    if (!x) return
    setV(x)
    setFlash(true)
    setTimeout(() => setFlash(false), 1500)
    life.shop.leftover().then(setLeft).catch(() => {})
  }
  const saveManual = async () => {
    const n = Math.round(Number(draft.replace(',', '.')))
    saved(await act(() => life.shop.setFunBudget(draft.trim() && n > 0 ? { lei: n, source: 'manual' } : null)))
  }
  const fromFinance = async () => saved(await act(() => life.shop.setFunBudget({ lei: 0, source: 'finance' }), 'Fun budget taken from Finance Helper'))
  const move = async () => {
    const r = await act(() => life.shop.moveLeftover(), (x) => x.toast ?? 'Moved to savings')
    if (r) {
      setLeft(r)
      life.shop.value().then(setV).catch(() => {})
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="gift" /> Rewards
        </h2>
        <Saved show={flash} />
      </header>
      <Row title="Monthly fun budget" hint="Real money for treats each month. Buying a reward spends from it; when it's empty you're asked first.">
        <div className="row tight">
          <input className="sx-input" type="number" min={0} inputMode="numeric" placeholder="lei a month" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveManual()} aria-label="Monthly fun budget in lei" />
          <button className="btn small primary" onClick={saveManual}>
            Save
          </button>
        </div>
      </Row>
      <Row title="Use Finance Helper's limit" hint="Takes the monthly limit of a Finance Helper category named Fun or Entertainment, and follows it when it changes">
        <button className="btn small" onClick={fromFinance} disabled={v?.funSource === 'finance'}>
          {v?.funSource === 'finance' ? 'In use' : 'Use it'}
        </button>
      </Row>
      {v && (
        <p className="hint block">
          {v.funBudgetLei == null ? 'No fun budget yet. ' : `This month: ${lei(v.funSpentLei)} of ${lei(v.funBudgetLei)} spent, ${lei(Math.max(0, v.funLeftLei ?? 0))} left. `}
          {pointValueLine(v.value)}
          {v.value.source === 'default' ? ' (the fixed value until you set a budget and earn for a few days)' : ''}.
          {v.hourlyLei ? ` Your hour of work: about ${lei(v.hourlyLei)}.` : ''}
        </p>
      )}
      {left && (
        <Row
          title="Move what's left to savings"
          hint={
            left.moved
              ? `Done this month: ${lei(left.moved.lei)} went to ${left.moved.goal}. Undo it from History if it was a mistake.`
              : !left.goal
                ? 'Add a savings goal in Finance Helper first (one you fill by hand, or one on a savings account).'
                : `${lei(left.leftLei)} left of your ${left.kind === 'fun' ? 'fun' : 'month'} budget goes to ${left.goal.name}${left.monthEnd ? ' (the month is nearly over)' : ''}. A small one-time bonus when it's moved.`
          }
        >
          <button className="btn small primary" onClick={move} disabled={!!left.moved || !left.goal || !(left.leftLei > 0)}>
            Move {left.leftLei > 0 ? lei(left.leftLei) : ''}
          </button>
        </Row>
      )}
    </section>
  )
}
