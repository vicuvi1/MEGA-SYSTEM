import { useState } from 'react'
import type { ConnectionsState } from '@shared/api'
import { life } from '../bridge'
import { useAction } from '../ui'
import { ConnectCard } from './Connected'

const money = (bani: number) => (bani / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })

export function Money({ state, onState, onWallet }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; onWallet: () => void }) {
  const act = useAction()
  const f = state.finance
  const [draft, setDraft] = useState<string | null>(null)
  if (!f.found || !f.connectedSince) {
    return (
      <div className="settings">
        <ConnectCard kind="finance" title="Connect Finance Helper" icon="coin" color="#F5C84B" {...f} what="Finance Helper stays where you log money. Connect it and logging spending (+3) and staying under your daily budget (+5) pay into this wallet." onState={onState} onWallet={onWallet} />
      </div>
    )
  }
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
    <div className="money">
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
    </div>
  )
}
