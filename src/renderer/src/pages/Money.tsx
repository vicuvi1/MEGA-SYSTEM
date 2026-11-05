import { useEffect, useState } from 'react'
import { usePoints } from '../usePoints'
import { motion } from 'framer-motion'
import type { ConnectionsState, Expense, NativeMoneySummary } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { soundCoin, soundSpend } from '../sound'
import { Coins, useAction } from '../ui'
import { ConnectCard } from './Connected'

const money = (bani: number) => (bani / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })

export function Money({ state, onState, onWallet }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; onWallet: () => void }) {
  const f = state.finance
  const hasFinance = f.found && Boolean(f.connectedSince)
  const [mode, setMode] = useState<'finance' | 'native'>(() => (hasFinance ? 'finance' : 'native'))

  if (hasFinance && mode === 'finance') {
    return (
      <div className="money">
        <div className="row end-row">
          <button className="btn small ghost" onClick={() => setMode('native')}>
            Switch to Standalone Expense Hub
          </button>
        </div>
        <FinanceHelperView f={f} onState={onState} />
      </div>
    )
  }

  return (
    <div className="money">
      {hasFinance && (
        <div className="row end-row">
          <button className="btn small ghost" onClick={() => setMode('finance')}>
            Switch to Connected Finance Helper View
          </button>
        </div>
      )}
      <NativeMoneyView onWallet={onWallet} />
      {!hasFinance && (
        <section className="panel" style={{ marginTop: '20px' }}>
          <header className="panel-head">
            <h2>
              <Icon name="link" /> Connect Finance Helper
            </h2>
            <span className="hint">Optional: sync expenses and safe-to-spend from your Finance Helper app</span>
          </header>
          <ConnectCard
            kind="finance"
            title="Connect Finance Helper"
            icon="coin"
            color="#F5C84B"
            {...f}
            what="Finance Helper stays where you log money. Connect it and logging spending (+3) and staying under your daily budget (+5) pay into this wallet."
            onState={onState}
            onWallet={onWallet}
          />
        </section>
      )}
    </div>
  )
}

function FinanceHelperView({ f, onState }: { f: ConnectionsState['finance']; onState: (s: ConnectionsState) => void }) {
  const act = useAction()
  const [draft, setDraft] = useState<string | null>(null)
  const cur = f.currency
  const budget = f.dailyBudget * 100
  const todayLeft = budget ? budget - (f.today?.everydaySpent ?? 0) : null

  async function saveBudget() {
    const s = await act(() => life.connections.setDailyBudget(parseInt(draft ?? '0', 10) || 0), 'Daily budget saved')
    if (s) {
      onState(s)
      setDraft(null)
    }
  }

  return (
    <>
      {f.staleDays !== null && f.staleDays > 1 && (
        <section className="panel warn-panel">
          <b>Finance Helper hasn't saved for {f.staleDays} days.</b> Open Finance Helper and turn on syncing to your Google Drive folder in its Sync screen, so new spending reaches Life System. Days after its last save aren't judged.
        </section>
      )}
      <section className="stats four">
        <div className="stat hero gold">
          <span className="label">Everyday spending today</span>
          <div className="big">
            {money(f.today?.everydaySpent ?? 0)} <small>{cur}</small>
          </div>
          <span className="sub">{todayLeft === null ? 'Set a daily budget to earn +5 a day' : todayLeft >= 0 ? `${money(todayLeft)} ${cur} left today` : `${money(-todayLeft)} ${cur} over today`}</span>
        </div>
        <div className="stat">
          <span className="label">Daily budget</span>
          {draft === null ? (
            <>
              <div className="big small-big">
                {f.dailyBudget || '–'} <small>{cur}</small>
              </div>
              <button className="link" onClick={() => setDraft(String(f.dailyBudget || ''))}>
                {f.dailyBudget ? 'Change' : 'Set a budget'}
              </button>
            </>
          ) : (
            <div className="row tight">
              <input autoFocus type="number" min={0} placeholder={`${cur} per day`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveBudget()} />
              <button className="btn small primary" onClick={saveBudget}>
                Save
              </button>
            </div>
          )}
        </div>
        <div className="stat">
          <span className="label">This month</span>
          <div className="big small-big">
            {money(f.month?.spent ?? 0)} <small>{cur}</small>
          </div>
          <span className="sub">{money(f.month?.everyday ?? 0)} everyday · {f.month?.days ?? 0} days logged</span>
        </div>
        <div className="stat">
          <span className="label">Income this month</span>
          <div className="big small-big">
            {money(f.month?.income ?? 0)} <small>{cur}</small>
          </div>
          <span className="sub">from Finance Helper</span>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Last 14 days</h2>
          <span className="hint">Everyday spending (bills and rent left out). A day is judged once it's over and Finance Helper has saved after it.</span>
        </header>
        <div className="day-grid">
          {f.days.map((d) => {
            const under = budget > 0 && d.logged && d.everydaySpent <= budget
            const cls = !d.logged ? 'none' : !d.judged ? 'open' : budget === 0 ? 'logged' : under ? 'under' : 'over'
            return (
              <div key={d.day} className={`dg ${cls}`} title={d.day}>
                <small>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</small>
                <b>{d.logged ? money(d.everydaySpent) : '–'}</b>
                <span>{!d.logged ? 'not logged' : !d.judged ? 'today' : budget === 0 ? 'logged' : under ? 'under +5' : 'over'}</span>
              </div>
            )
          })}
        </div>
        <p className="hint block-hint">Finance Helper keeps doing the real money work: safe to spend, jars, goals. This page only turns your logging into coins.</p>
      </section>
    </>
  )
}

function NativeMoneyView({ onWallet }: { onWallet: () => void }) {
  const pts = usePoints()
  const [summary, setSummary] = useState<NativeMoneySummary | null>(null)
  const [amountStr, setAmountStr] = useState('')
  const [category, setCategory] = useState('food')
  const [note, setNote] = useState('')
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)
  const act = useAction()

  const refresh = () => {
    life.money.state().then(setSummary)
  }

  useEffect(() => {
    refresh()
  }, [])

  if (!summary) return <div className="empty">Loading expense hub…</div>

  const cur = summary.currency
  const budget = summary.dailyBudget
  const today = summary.today
  const todayLeft = budget > 0 ? budget - today.everydaySpent : null

  async function handleAddExpense() {
    const amt = parseFloat(amountStr)
    if (isNaN(amt) || amt <= 0) return
    const res = await act(() => life.money.addExpense(Math.round(amt * 100), category, note), 'Expense recorded')
    if (res) {
      if (res.awarded) {
        soundCoin()
      } else {
        soundSpend()
      }
      setSummary(res.state)
      setAmountStr('')
      setNote('')
      onWallet()
    }
  }

  async function handleDeleteExpense(id: number) {
    const res = await act(() => life.money.deleteExpense(id), 'Expense removed')
    if (res) {
      setSummary(res)
    }
  }

  async function handleSaveBudget() {
    const val = parseFloat(budgetDraft ?? '0')
    const res = await act(() => life.money.setBudget(Math.round(val * 100)), 'Daily budget updated')
    if (res) {
      setSummary(res)
      setBudgetDraft(null)
    }
  }

  return (
    <>
      <section className="stats four">
        <div className="stat hero gold">
          <span className="label">Everyday spending today</span>
          <div className="big">
            {money(today.everydaySpent)} <small>{cur}</small>
          </div>
          <span className="sub">
            {todayLeft === null
              ? 'Set a daily budget to track savings'
              : todayLeft >= 0
              ? `${money(todayLeft)} ${cur} left under budget`
              : `${money(-todayLeft)} ${cur} over daily budget`}
          </span>
        </div>

        <div className="stat">
          <span className="label">Daily budget</span>
          {budgetDraft === null ? (
            <>
              <div className="big small-big">
                {budget ? money(budget) : '–'} <small>{cur}</small>
              </div>
              <button className="link" onClick={() => setBudgetDraft(String(budget / 100 || ''))}>
                {budget ? 'Change budget' : 'Set a budget'}
              </button>
            </>
          ) : (
            <div className="row tight">
              <input autoFocus type="number" min={0} placeholder={`${cur} per day`} value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSaveBudget()} />
              <button className="btn small primary" onClick={handleSaveBudget}>
                Save
              </button>
            </div>
          )}
        </div>

        <div className="stat">
          <span className="label">This month</span>
          <div className="big small-big">
            {money(summary.monthSpent)} <small>{cur}</small>
          </div>
          <span className="sub">total recorded this month</span>
        </div>

        <div className="stat">
          <span className="label">Budget status</span>
          <div className="big small-big">
            {today.underBudget ? 'Under' : today.everydaySpent > budget ? 'Over' : '–'}
          </div>
          <span className="sub">{today.underBudget ? `On track for +${pts('money.under_budget', 5)} points` : 'Stay under budget'}</span>
        </div>
      </section>

      <div className="cols even">
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="plus" /> Quick Expense Logger
            </h2>
            <span className="hint">First log of the day pays +{pts('money.logged', 3)} points</span>
          </header>
          <div className="log-form">
            <div className="row">
              <label>
                <span>Amount ({cur}):</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddExpense()}
                />
              </label>
              <label>
                <span>Category:</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="food">🍔 Food & Dining</option>
                  <option value="groceries">🛒 Groceries</option>
                  <option value="transit">🚗 Transit & Gas</option>
                  <option value="shopping">🛍️ Shopping</option>
                  <option value="bills">💡 Bills & Rent</option>
                  <option value="health">💊 Health & Care</option>
                  <option value="other">📦 Other</option>
                </select>
              </label>
            </div>
            <div className="row">
              <label style={{ width: '100%' }}>
                <span>Note (optional):</span>
                <input
                  type="text"
                  placeholder="e.g. Lunch with team, Groceries haul"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddExpense()}
                />
              </label>
            </div>
            <motion.button className="btn primary block-btn" whileTap={{ scale: 0.96 }} onClick={handleAddExpense}>
              <Icon name="coin" size={15} /> Log Expense
            </motion.button>
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>Today by Category</h2>
          </header>
          {Object.keys(today.byCategory).length === 0 ? (
            <div className="empty small-empty">
              <Icon name="coin" size={28} />
              <p>Nothing spent yet today.</p>
            </div>
          ) : (
            <div className="category-bars">
              {Object.entries(today.byCategory).map(([cat, amt]) => (
                <div key={cat} className="cat-row">
                  <span className="cat-label">{cat}</span>
                  <div className="bar">
                    <motion.i initial={false} animate={{ width: `${Math.min(100, (amt / Math.max(1, today.totalSpent)) * 100)}%` }} />
                  </div>
                  <b>{money(amt)} {cur}</b>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Recent Expenses</h2>
        </header>
        {summary.recentExpenses.length === 0 ? (
          <div className="empty">No expenses logged yet. Add one above.</div>
        ) : (
          <ul className="feed">
            {summary.recentExpenses.map((e) => (
              <li key={e.id}>
                <span className="what">
                  <b>{money(e.amount)} {cur}</b> · <span className="cat-pill">{e.category}</span> {e.note ? `— ${e.note}` : ''}
                </span>
                <span className="when">{e.day}</span>
                <button className="icon-btn delete-btn" title="Delete expense" aria-label="Delete expense" onClick={() => handleDeleteExpense(e.id)}>
                  <Icon name="undo" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
