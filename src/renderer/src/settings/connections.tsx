// Settings → connections (LT11: split out of pages/Settings.tsx; the state lives in useSettingsState).
import { features, life } from '../bridge'
import { GooglePanel } from '../GooglePanel'
import { SportyPanel } from '../SportyPanel'
import { ConnectionsOverview } from '../ConnectionsOverview'
import { Icon } from '../Icon'
import { timeAgo } from '../ui'
import type { SettingsState } from './useSettingsState'

export function ConnectionsSection({ s }: { s: SettingsState }) {
  const { backup, onGo, botCfg, setBotCfg, showTokens, testingBotKey, botTestResult, saveBotArmy, testBotIndividual, toggleTokenVisibility, BOTS_METADATA, calCfg, setCalCfg, syncingCal, calSyncMsg, saveCalendarConfig, syncCalendarNow } = s
  return (
        <>
          <ConnectionsOverview onGo={onGo} />
          <h3 className="st-sub">Details</h3>
      <GooglePanel />
      {onGo && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="link" /> Bots & connections
            </h2>
          </header>
          <div className="set-links">
            <button className="set-link" onClick={() => onGo('bots')}>
              <Icon name="bot" size={18} />
              <span>
                <b>Telegram bots</b>
                <small>Mega, Finance and Waky: status, tests, settings</small>
              </span>
            </button>
            <button className="set-link" onClick={() => onGo('connected')}>
              <Icon name="link" size={18} />
              <span>
                <b>Connected apps</b>
                <small>Waky, Finance Helper, Sport Track, MAN</small>
              </span>
            </button>
            <button className="set-link" onClick={() => onGo('history')}>
              <Icon name="list" size={18} />
              <span>
                <b>Point history</b>
                <small>Every point in and out, with undo</small>
              </span>
            </button>
          </div>
        </section>
      )}
      <SportyPanel />
      {features.calendar && (
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="calendar" /> Google Calendar Integration
          </h2>
          <span className={`chip ${calCfg.enabled && calCfg.feedUrl ? 'ok' : 'ghost'}`}>
            {calCfg.enabled && calCfg.feedUrl ? 'Connected' : 'Disabled'}
          </span>
        </header>

        <p className="hint block">
          Connect your Google Calendar so the <b>coach</b> can see your schedule, upcoming commitments, and daily agenda.
        </p>

        <div className="field">
          <span>Google Calendar iCal Feed URL (Private Secret Address)</span>
          <input
            type="url"
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            value={calCfg.feedUrl}
            onChange={(e) => setCalCfg({ ...calCfg, feedUrl: e.target.value })}
          />
          <small className="hint">
            <b>How to get it in 3 steps:</b> 1. Open Google Calendar (web) → 2. Click Settings ⚙️ → select your calendar under <i>Settings for my calendars</i> on the left → 3. Scroll down to <i>"Secret address in iCal format"</i>, copy the link, and paste here.
          </small>
        </div>

        <label className="check toggle-row">
          <input
            type="checkbox"
            checked={calCfg.enabled}
            onChange={(e) => setCalCfg({ ...calCfg, enabled: e.target.checked })}
          />
          <span>
            Enable Calendar Synchronization & AI Visibility
            <small>The coach includes your agenda in its advice.</small>
          </span>
        </label>

        {calCfg.lastSyncAt && (
          <dl className="facts" style={{ margin: '0.75rem 0' }}>
            <dt>Last Synced</dt>
            <dd>{timeAgo(calCfg.lastSyncAt)}</dd>
            <dt>Cached Events</dt>
            <dd>{calCfg.cachedEventsCount} events synchronized</dd>
            {calCfg.lastError && (
              <>
                <dt>Last Issue</dt>
                <dd className="warn-text">{calCfg.lastError}</dd>
              </>
            )}
          </dl>
        )}

        {calSyncMsg && (
          <div
            className={`notice ${calSyncMsg.ok ? 'ok' : 'warn'}`}
            style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}
          >
            {calSyncMsg.ok ? '✅ ' : '❌ '} {calSyncMsg.message}
          </div>
        )}

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button className="btn primary" onClick={saveCalendarConfig}>
            Save Calendar Settings
          </button>
          <button
            className="btn ghost"
            disabled={!calCfg.feedUrl || syncingCal}
            onClick={syncCalendarNow}
          >
            {syncingCal ? 'Syncing...' : 'Sync Calendar Now'}
          </button>
        </div>
      </section>
      )}
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="bot" /> Telegram Multi-Bot Army & Tokens Hub
          </h2>
          <span className={`chip ${botCfg.enabled && botCfg.botToken ? 'ok' : 'muted'}`}>
            {botCfg.enabled && botCfg.botToken ? 'Army Active' : 'Setup Required'}
          </span>
        </header>

        <p className="hint block">
          Connect your dedicated Telegram bots individually. Each bot specializes in a specific life domain, while all data, streaks, and balances synchronize in real-time across your entire Life System and embedded Finance Helper app!
        </p>

        {/* 7 Individual Bot Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', margin: '1rem 0' }}>
          {BOTS_METADATA.map((b) => {
            const hasToken = !!botCfg[b.tokenField]
            const isRevealed = !!showTokens[b.key]
            const isTestingThis = testingBotKey === b.key
            return (
              <div
                key={b.key}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: hasToken ? '1px solid rgba(0, 210, 255, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  boxShadow: hasToken ? '0 0 15px rgba(0, 210, 255, 0.05)' : 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.4rem' }}>{b.icon}</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>{b.name}</h3>
                      <small style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>{b.badge}</small>
                    </div>
                  </div>
                  <span className={`chip small ${hasToken ? 'ok' : 'ghost'}`}>
                    {hasToken ? 'Connected' : 'Empty'}
                  </span>
                </div>

                <p style={{ margin: '0.2rem 0', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                  {b.desc}
                </p>

                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Bot Token (from @BotFather)</label>
                  <div className="row" style={{ gap: '0.4rem' }}>
                    <input
                      type={isRevealed ? 'text' : 'password'}
                      placeholder="123456789:AA..."
                      value={botCfg[b.tokenField] || ''}
                      onChange={(e) => setBotCfg({ ...botCfg, [b.tokenField]: e.target.value.trim() })}
                      style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
                    />
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => toggleTokenVisibility(b.key)}
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                    >
                      {isRevealed ? 'Hide' : 'Reveal'}
                    </button>
                  </div>
                </div>

                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>Assigned Telegram Chat ID</label>
                  <input
                    type="text"
                    placeholder={b.key === 'master' ? 'e.g. 12345678 (whitelist)' : `Defaults to ${botCfg.chatId || 'Master Chat ID'}`}
                    value={botCfg[b.chatField] || ''}
                    onChange={(e) => setBotCfg({ ...botCfg, [b.chatField]: e.target.value.trim() })}
                    style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
                  />
                </div>

                {b.key === 'finance' && (
                  <label className="check toggle-row" style={{ margin: '0.2rem 0', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={botCfg.financeSyncEnabled ?? true}
                      onChange={(e) => setBotCfg({ ...botCfg, financeSyncEnabled: e.target.checked })}
                    />
                    <span>
                      Sync with Finance Helper App
                      <small>Auto-records to Finance ledger and Google Drive backup</small>
                    </span>
                  </label>
                )}

                <div style={{ marginTop: 'auto', paddingTop: '0.4rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={!botCfg[b.tokenField] || testingBotKey !== null}
                    onClick={() => testBotIndividual(b.key)}
                    style={{ fontSize: '0.78rem' }}
                  >
                    {isTestingThis ? 'Testing...' : `Test ${b.name.split(' ')[0]} Bot`}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Global Hub Options */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
          <label className="check toggle-row">
            <input
              type="checkbox"
              checked={botCfg.pollingEnabled}
              onChange={(e) => setBotCfg({ ...botCfg, pollingEnabled: e.target.checked })}
            />
            <span>
              Enable Automatic 2-Way Long Polling on Startup
              <small>Allows all configured bots to continuously receive commands and natural expenses in real time.</small>
            </span>
          </label>

          <label className="check toggle-row">
            <input
              type="checkbox"
              checked={botCfg.morningBriefing}
              onChange={(e) => setBotCfg({ ...botCfg, morningBriefing: e.target.checked })}
            />
            <span>
              Morning Briefing Notification
              <small>Delivers your morning agenda, rituals status, and streak affirmations at wake-up time.</small>
            </span>
          </label>

          <label className="check toggle-row">
            <input
              type="checkbox"
              checked={botCfg.eveningNudge}
              onChange={(e) => setBotCfg({ ...botCfg, eveningNudge: e.target.checked })}
            />
            <span>
              Evening Bedtime & Habit Nudge
              <small>Sends nightly habit wrap-up and reminds you to affirm your clean streak and bedtime.</small>
            </span>
          </label>
        </div>

        {botTestResult && (
          <div
            className={`notice ${botTestResult.ok ? 'ok' : 'warn'}`}
            style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}
          >
            {botTestResult.ok ? '✅ ' : '❌ '} {botTestResult.message}
          </div>
        )}

        <div className="row" style={{ marginTop: '1rem', gap: '0.8rem' }}>
          <button className="btn primary" onClick={saveBotArmy}>
            Save All Bot Tokens & Settings
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={testingBotKey !== null}
            onClick={() => testBotIndividual('all')}
          >
            {testingBotKey === 'all' ? 'Testing Army...' : 'Test All Connected Bots'}
          </button>
        </div>
      </section>
        </>
  )
}
