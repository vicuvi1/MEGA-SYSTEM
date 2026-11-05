// Settings → general (LT11: split out of pages/Settings.tsx; the state lives in useSettingsState).
import { hasPasskeyHere, passkeySupported } from '../web/passkey'
import { features, life } from '../bridge'
import { Row, Saved, Segmented, Switch } from '../settingsUi'
import { Icon } from '../Icon'
import { DevicesPanel } from '../DevicesPanel'
import type { SettingsState } from './useSettingsState'

export function GeneralSection({ s }: { s: SettingsState }) {
  const { auth, backup, prefs, currentPin, setCurrentPin, newPin, setNewPin, confirmPin, setConfirmPin, pinError, setPinError, pinSuccess, setPinSuccess, isUpdatingPin, bgFlash, bgSaved, noPin, offAsk, setOffAsk, offPin, setOffPin, setAskPin, handleUpdatePin, handleLockNow, changePrefs } = s
  return (
        <>
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="lock" /> PIN
          </h2>
          <span className={`chip ${noPin ? 'warn' : 'ok'}`}>{noPin ? 'Not asked on this device' : 'Asked when the app opens'}</span>
        </header>
        <p className="hint block">The PIN keeps your data private. The website is on the internet, so a new device always needs it once; on your own PC or phone you can skip it.</p>
        <Row title="Ask for the PIN on this device" hint={noPin ? 'Never: Life System opens straight away here and stays signed in.' : 'Every time Life System opens.'}>
          {life.auth.setRemembered && (
            <Segmented label="Ask for the PIN on this device" value={noPin ? 'never' : 'always'} options={[['always', 'Always'], ['never', 'Never']]} onChange={(v) => void setAskPin(v === 'always')} />
          )}
        </Row>
        {offAsk && !noPin && (
          <form
            className="set-confirm"
            onSubmit={(e) => {
              e.preventDefault()
              void setAskPin(false)
            }}
          >
            <span>Enter your PIN once to stop asking for it on this device.</span>
            <input autoFocus type="password" inputMode="numeric" value={offPin} maxLength={12} placeholder="Your PIN" onChange={(e) => setOffPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn primary small" disabled={offPin.length < 4}>
              Stop asking
            </button>
            <button type="button" className="btn ghost small" onClick={() => (setOffAsk(false), setOffPin(''))}>
              Cancel
            </button>
          </form>
        )}

        {life.auth.signOutOthers && (
          <div className="row" style={{ gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', margin: '0.5rem 0 1rem' }}>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                try {
                  await life.auth.signOutOthers!()
                  setPinSuccess('Signed out everywhere else: other devices need the PIN again.')
                } catch (err: any) {
                  setPinError(err.message || 'Sign-out failed')
                }
              }}
            >
              Sign out all other devices
            </button>
            <span className="hint small">A lost phone or an old browser? This ends their access. Changing the PIN does it too.</span>
          </div>
        )}
        <DevicesPanel />
        {life.auth.setupPasskey && passkeySupported() && (
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn small"
              onClick={async () => {
                setPinError(null)
                setPinSuccess(null)
                try {
                  await life.auth.setupPasskey!()
                  setPinSuccess('Fingerprint / face unlock is on for this device. The PIN still works too.')
                } catch (err: any) {
                  setPinError(err.message || 'Could not set it up')
                }
              }}
            >
              🔐 {hasPasskeyHere() ? 'Set up fingerprint / face again' : 'Unlock with fingerprint / face'}
            </button>
            <span className="hint small">Uses this device's fingerprint, face or Windows Hello. The server checks it; the PIN stays as a backup.</span>
          </div>
        )}

        <details className="set-more">
          <summary>Change PIN</summary>
        <form onSubmit={handleUpdatePin} className="pin-settings-form">
          <div className="grid col-3 gap" style={{ gridTemplateColumns: auth.pinSet ? 'repeat(auto-fit, minmax(180px, 1fr))' : 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {auth.pinSet && (
              <div className="field">
                <span>Current PIN</span>
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="Current PIN"
                  value={currentPin}
                  maxLength={12}
                  autoComplete="current-password"
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            )}
            <div className="field">
              <span>New PIN (6–12 digits)</span>
              <input
                type="password"
                inputMode="numeric"
                placeholder="New numeric PIN"
                value={newPin}
                maxLength={12}
                autoComplete="new-password"
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="field">
              <span>Confirm New PIN</span>
              <input
                type="password"
                inputMode="numeric"
                placeholder="Re-enter new PIN"
                value={confirmPin}
                maxLength={12}
                autoComplete="new-password"
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>

          {pinError && (
            <div className="err" style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px' }}>
              ⚠️ {pinError}
            </div>
          )}
          {pinSuccess && (
            <div className="good" style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '6px', color: 'var(--green, #22c55e)' }}>
              ✓ {pinSuccess}
            </div>
          )}

          <div className="row" style={{ marginTop: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="btn primary"
              disabled={isUpdatingPin || newPin.length < 4 || confirmPin.length < 4}
            >
              {isUpdatingPin ? 'Saving PIN...' : 'Update PIN'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={handleLockNow}
              title="Immediately lock the application and return to the PIN screen"
            >
              <Icon name="lock" size={15} /> Lock App Now
            </button>
          </div>
        </form>
        </details>
      </section>
      {prefs && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <Icon name="bolt" /> Apps & start-up
            </h2>
            <Saved show={bgFlash} />
          </header>
          <Row title="Match the apps to Life System's look" hint="Finance Helper, Waky and MAN use the same dark colors and fonts">
            <Switch label="Match the apps to Life System's look" on={prefs.matchAppThemes} onChange={(v) => void changePrefs({ matchAppThemes: v }).then(bgSaved)} />
          </Row>
          {window.desktop ? (
            <Row title="Start with Windows, keep in the tray" hint="In the tray icon's menu (bottom right of the taskbar): Life System keeps running there when you close the window." />
          ) : (
            <>
              {features.updates && (
                <Row title="Keep running in the tray" hint="When the window is closed. Needed for block reminders.">
                  <Switch label="Keep running in the tray" on={prefs.keepInTray} onChange={(v) => void changePrefs({ keepInTray: v }).then(bgSaved)} />
                </Row>
              )}
              {prefs.canAutoStart && (
                <Row title="Start with Windows" hint="Opens quietly when you sign in">
                  <Switch label="Start with Windows" on={prefs.openAtLogin} onChange={(v) => void changePrefs({ openAtLogin: v }).then(bgSaved)} />
                </Row>
              )}
            </>
          )}
        </section>
      )}
        </>
  )
}
