import { useEffect, useState } from 'react'
import { SleepSteady } from '../SleepSteady'
import { usePoints } from '../usePoints'
import type { ConnectionsState, SleepLog, SleepSummary } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { soundCoin, soundSuccess } from '../soundKit'
import { useAction } from '../ui'
import { ConnectCard } from './Connected'
import { addDays } from '@core/dates'
import { CountUp } from '../motionKit'
import { Select } from '../Select'

const hm = (min: number | null) => (min == null ? '–' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`)
const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function Sleep({ state, onState, onWallet, openEditor = 0 }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; onWallet: () => void; openEditor?: number }) {
  const w = state.waky
  const hasWaky = w.found && Boolean(w.connectedSince)
  const [mode, setMode] = useState<'waky' | 'native'>(() => (hasWaky ? 'waky' : 'native'))

  if (hasWaky && mode === 'waky') {
    return (
      <div className="sleep">
        <div className="row end-row">
          <button className="btn small ghost" onClick={() => setMode('native')}>
            Switch to Standalone Sleep Tracker
          </button>
        </div>
        <WakeEditor state={state} onState={onState} onWallet={onWallet} openSignal={openEditor} />
        <WakySleepView w={w} />
      </div>
    )
  }

  return (
    <div className="sleep">
      {hasWaky && (
        <div className="row end-row">
          <button className="btn small ghost" onClick={() => setMode('waky')}>
            Switch to Connected Waky View
          </button>
        </div>
      )}
      <WakeEditor state={state} onState={onState} onWallet={onWallet} openSignal={openEditor} />
      <NativeSleepView onWallet={onWallet} />
      {!hasWaky && (
        <section className="panel" style={{ marginTop: '20px' }}>
          <header className="panel-head">
            <h2>
              <Icon name="link" /> Connect Waky
            </h2>
            <span className="hint">Optional: sync alarms automatically from your installed Waky alarm app</span>
          </header>
          <ConnectCard
            kind="waky"
            title="Connect Waky Alarm"
            icon="moon"
            color="#6EE7D8"
            {...w}
            what="Waky stays your alarm and check-in app. Connect it and every on-time wake-up and bedtime lands in this wallet."
            onState={onState}
            onWallet={onWallet}
          />
        </section>
      )}
    </div>
  )
}

/**
 * Forgot to log when you got up, or logged it late? Set the real time for
 * today or one of the last 14 days. Today's on-time wake-up still pays its
 * coins (once); past days are corrected for the streak and stats only.
 */
function WakeEditor({ state, onState, onWallet, openSignal = 0 }: { state: ConnectionsState; onState: (s: ConnectionsState) => void; onWallet: () => void; openSignal?: number }) {
  const act = useAction()
  const today = state.today
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, -i))
  const [day, setDay] = useState(today)
  const known = (d: string) => state.waky.mornings.find((m) => m.day === d)?.time ?? (d === today ? state.waky.today?.time : undefined)
  const [time, setTime] = useState(() => known(today) ?? '')
  const [open, setOpen] = useState(openSignal > 0)
  useEffect(() => {
    if (openSignal > 0) setOpen(true)
  }, [openSignal])
  const label = (d: string, i: number) =>
    i === 0 ? 'Today' : i === 1 ? 'Yesterday' : new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

  async function save() {
    const res = await act(
      () => life.sleep.setWake(day, time),
      day === today ? 'Wake-up saved' : 'Saved (past days count for your streak, without points)'
    )
    if (!res) return
    if (res.awarded) {
      soundCoin()
      onWallet()
    } else soundSuccess()
    life.connections.state().then(onState).catch(() => {})
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="row end-row">
        <button className="btn small" onClick={() => setOpen(true)}>
          <Icon name="edit" size={13} /> Fix a wake-up time
        </button>
      </div>
    )
  }
  return (
    <section className="panel wake-editor">
      <header className="panel-head">
        <h2>
          <Icon name="edit" /> Fix a wake-up time
        </h2>
        <button className="btn small ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </header>
      <p className="hint block">Forgot to log it, or logged it late? Set when you really got up. Telegram works too: <code>/wake 06:40</code> or <code>/wake yesterday 06:30</code>.</p>
      <div className="row wake-editor-row">
        <label className="field">
          <span>Day</span>
          <Select
            value={day}
            onChange={(e) => {
              setDay(e.target.value)
              setTime(known(e.target.value) ?? '')
            }}
          >
            {days.map((d, i) => (
              <option key={d} value={d}>
                {label(d, i)}
                {known(d) ? ` · now ${known(d)}` : ' · not logged'}
              </option>
            ))}
          </Select>
        </label>
        <label className="field">
          <span>Woke up at</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button className="btn primary" disabled={!time} onClick={() => void save()}>
          Save
        </button>
      </div>
    </section>
  )
}

function WakySleepView({ w }: { w: ConnectionsState['waky'] }) {
  const pts = usePoints()
  const rows = w.mornings.slice(0, 14).reverse()
  const maxOff = Math.max(30, ...rows.map((m) => Math.abs(toMin(m.time) - toMin(m.target))))
  return (
    <>
      <section className="stats four">
        <div className="stat hero teal">
          <span className="label">This morning</span>
          <div className="big">{w.today ? w.today.time : '–'}</div>
          <span className="sub">{w.today ? (w.today.onTime ? `On time (target ${w.today.target}) · +${pts('sleep.up_on_time', 10)} paid` : `Late (target ${w.today.target})`) : 'No check-in in Waky yet today'}</span>
        </div>
        <div className="stat">
          <span className="label">Wake streak</span>
          <div className="big"><CountUp value={w.streak} /></div>
          <span className="sub">best {w.best}</span>
        </div>
        <div className="stat">
          <span className="label">On time, last 2 weeks</span>
          <div className="big">{w.onTimeRate == null ? '–' : `${Math.round(w.onTimeRate * 100)}%`}</div>
          <span className="sub">
            targets {w.weekday} weekdays · {w.weekend} weekends
          </span>
        </div>
        <div className="stat">
          <span className="label">Average sleep</span>
          <div className="big small-big">{w.avgSleepMin == null ? hm(w.avgSleepMin) : <CountUp value={w.avgSleepMin} format={(v) => hm(Math.round(v))} />}</div>
          <span className="sub">from Waky bedtimes</span>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Mornings</h2>
          <span className="hint">Bars show minutes early (down) or late (up) against your target. Green paid out.</span>
        </header>
        {rows.length === 0 ? (
          <div className="empty">No mornings recorded yet.</div>
        ) : (
          <div className="wake-chart" role="img" aria-label="Wake-up times against target, last two weeks">
            {rows.map((m) => {
              const off = toMin(m.time) - toMin(m.target)
              const h = Math.max(4, (Math.abs(off) / maxOff) * 60)
              return (
                <div key={m.day} className="wc-col" title={`${m.day}: up ${m.time}, target ${m.target}`}>
                  <div className="wc-track">
                    <i className={`wc-bar ${m.onTime ? 'ok' : 'late'} ${off > 0 ? 'up' : 'down'}`} style={{ height: h }} />
                  </div>
                  <b>{m.time}</b>
                  <small>{new Date(`${m.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Recent nights</h2>
        </header>
        <ul className="feed">
          {w.mornings.slice(0, 7).map((m) => (
            <li key={m.day}>
              <span className="what">
                {m.day} · up {m.time}
              </span>
              <span className="when">{m.sleptMin ? `slept ${hm(m.sleptMin)}` : 'no bedtime logged'}</span>
              <span className={m.onTime ? 'ok-text' : 'warn-text'}>{m.onTime ? 'on time' : 'late'}</span>
            </li>
          ))}
        </ul>
        <p className="hint block-hint">Waky keeps running as your alarm. Its check-ins sync here every few minutes, paying from {w.connectedSince}.</p>
      </section>
    </>
  )
}

function NativeSleepView({ onWallet }: { onWallet: () => void }) {
  const pts = usePoints()
  const [summary, setSummary] = useState<SleepSummary | null>(null)
  const [wakeTime, setWakeTime] = useState('')
  const [quality, setQuality] = useState(5)
  const [bedTime, setBedTime] = useState('')
  const [editingTargets, setEditingTargets] = useState(false)
  const [weekdayDraft, setWeekdayDraft] = useState('07:00')
  const [weekendDraft, setWeekendDraft] = useState('08:30')
  const [bedDraft, setBedDraft] = useState('23:00')
  const act = useAction()

  const refresh = () => {
    life.sleep.state().then((s) => {
      setSummary(s)
      setWeekdayDraft(s.weekdayTarget)
      setWeekendDraft(s.weekendTarget)
      if (s.bedTarget) setBedDraft(s.bedTarget)
    })
  }

  useEffect(() => {
    refresh()
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    setWakeTime(`${hh}:${mm}`)
    setBedTime(`${hh}:${mm}`)
  }, [])

  if (!summary) return <div className="empty">Loading sleep tracker…</div>

  const todayLog = summary.todayLog
  const rows = summary.recentLogs.slice().reverse()
  const maxOff = Math.max(30, ...rows.map((m) => Math.abs(toMin(m.wakeTime) - toMin(m.wakeTarget))))

  async function handleLogWake() {
    const res = await act(() => life.sleep.logWake(wakeTime || undefined, quality), 'Wake up logged')
    if (res) {
      if (res.awarded) {
        soundCoin()
      } else {
        soundSuccess()
      }
      setSummary(res.state)
      onWallet()
    }
  }

  async function handleLogBed() {
    const res = await act(() => life.sleep.logBed(bedTime || undefined), 'Bedtime logged')
    if (res) {
      if (res.awarded) {
        soundCoin()
      } else {
        soundSuccess()
      }
      setSummary(res.state)
      onWallet()
    }
  }

  async function handleSaveTargets() {
    const res = await act(() => life.sleep.setTargets(weekdayDraft, weekendDraft, bedDraft), 'Targets updated')
    if (res) {
      setSummary(res)
      setEditingTargets(false)
    }
  }

  return (
    <>
      <section className="stats four">
        <div className="stat hero teal">
          <span className="label">This morning</span>
          <div className="big">{todayLog?.wakeTime || '–'}</div>
          <span className="sub">
            {todayLog ? (todayLog.onTime ? `On time (target ${todayLog.wakeTarget}) · +${pts('sleep.up_on_time', 10)} points` : `Late (target ${todayLog.wakeTarget})`) : 'Not logged yet today'}
          </span>
        </div>
        <div className="stat">
          <span className="label">Wake streak</span>
          <div className="big"><CountUp value={summary.streak} /></div>
          <span className="sub">best {summary.bestStreak}</span>
        </div>
        <div className="stat">
          <span className="label">On time, last 2 weeks</span>
          <div className="big">{summary.onTimeRate == null ? '–' : `${Math.round(summary.onTimeRate * 100)}%`}</div>
          <span className="sub">
            targets {summary.weekdayTarget} weekdays · {summary.weekendTarget} weekends
          </span>
        </div>
        <div className="stat">
          <span className="label">Average sleep</span>
          <div className="big small-big">{summary.avgSleepMin == null ? hm(summary.avgSleepMin) : <CountUp value={summary.avgSleepMin} format={(v) => hm(Math.round(v))} />}</div>
          <span className="sub">calculated from bedtimes</span>
        </div>
      </section>
      <SleepSteady logs={summary.recentLogs} bedTarget={summary.bedTarget} />

      <div className="cols even">
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="sun" /> Morning check-in
            </h2>
            <span className="hint">Wake up by {summary.weekdayTarget} to earn +{pts('sleep.up_on_time', 10)} points</span>
          </header>
          {todayLog ? (
            <div className="empty small-empty">
              <Icon name="check" size={28} />
              <p>
                <b>Checked in at {todayLog.wakeTime}!</b>
              </p>
              <small className="muted">{todayLog.onTime ? 'On-time standard upheld.' : 'Late morning. Tomorrow is a fresh start.'}</small>
            </div>
          ) : (
            <div className="log-form">
              <div className="row">
                <label>
                  <span>Wake-up time:</span>
                  <input type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} />
                </label>
                <label>
                  <span>Sleep Quality (1-5):</span>
                  <Select value={quality} onChange={(e) => setQuality(Number(e.target.value))}>
                    <option value={5}>⭐⭐⭐⭐⭐ Rested</option>
                    <option value={4}>⭐⭐⭐⭐ Good</option>
                    <option value={3}>⭐⭐⭐ Moderate</option>
                    <option value={2}>⭐⭐ Tired</option>
                    <option value={1}>⭐ Exhausted</option>
                  </Select>
                </label>
              </div>
              <button className="btn primary block-btn" onClick={handleLogWake}>
                <Icon name="sun" size={15} /> I'm up
              </button>
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="moon" /> Bedtime check-in
            </h2>
            <span className="hint">In bed on time earns +{pts('sleep.bed_on_time', 5)} points</span>
          </header>
          {(summary.tonight ?? todayLog)?.bedTime ? (
            <div className="empty small-empty">
              <Icon name="check" size={28} />
              <p>
                <b>In bed at {(summary.tonight ?? todayLog)!.bedTime}</b>
              </p>
              <small className="muted">{(summary.tonight ?? todayLog)?.bedOnTime ? 'Bedtime on-time award received.' : 'Bedtime logged.'}</small>
            </div>
          ) : (
            <div className="log-form">
              <div className="row">
                <label>
                  <span>Bedtime:</span>
                  <input type="time" value={bedTime} onChange={(e) => setBedTime(e.target.value)} />
                </label>
              </div>
              <button className="btn block-btn" onClick={handleLogBed}>
                <Icon name="moon" size={15} /> Going to bed
              </button>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <header className="panel-head">
          <h2>Wake-up history & target consistency</h2>
          <button className="btn small" onClick={() => setEditingTargets((v) => !v)}>
            <Icon name="sliders" size={13} /> {editingTargets ? 'Close' : 'Set Targets'}
          </button>
        </header>

        {editingTargets && (
          <div className="panel sub-panel" style={{ marginBottom: '16px' }}>
            <div className="row">
              <label>
                <span>Weekday target:</span>
                <input type="time" value={weekdayDraft} onChange={(e) => setWeekdayDraft(e.target.value)} />
              </label>
              <label>
                <span>Weekend target:</span>
                <input type="time" value={weekendDraft} onChange={(e) => setWeekendDraft(e.target.value)} />
              </label>
              <label>
                <span>Bedtime target:</span>
                <input type="time" value={bedDraft} onChange={(e) => setBedDraft(e.target.value)} />
              </label>
              <button className="btn primary" onClick={handleSaveTargets}>
                Save Targets
              </button>
            </div>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="empty">No mornings recorded yet. Log your first wake-up above.</div>
        ) : (
          <div className="wake-chart" role="img" aria-label="Wake-up times against target">
            {rows.map((m) => {
              const off = toMin(m.wakeTime) - toMin(m.wakeTarget)
              const h = Math.max(4, (Math.abs(off) / maxOff) * 60)
              return (
                <div key={m.day} className="wc-col" title={`${m.day}: up ${m.wakeTime}, target ${m.wakeTarget}`}>
                  <div className="wc-track">
                    <i className={`wc-bar ${m.onTime ? 'ok' : 'late'} ${off > 0 ? 'up' : 'down'}`} style={{ height: h }} />
                  </div>
                  <b>{m.wakeTime}</b>
                  <small>{new Date(`${m.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</small>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
