// The PIN screen. It opens the moment the right PIN is typed: the app
// remembers your PIN's length on this device (never the PIN itself) and
// checks as soon as you reach it, so wrong partial PINs never count as
// failed tries. The first time on a new device, press Enter once.
import { hasPasskeyHere } from '../web/passkey'
import { useEffect, useRef, useState } from 'react'
import type { AuthStatus } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'

const LEN_KEY = 'ls.pinLen'
export const rememberPinLength = (pin: string) => {
  try {
    localStorage.setItem(LEN_KEY, String(pin.length))
  } catch {
    // private window: Enter still works
  }
}
const knownLength = () => {
  try {
    const n = Number(localStorage.getItem(LEN_KEY))
    return n >= 4 && n <= 12 ? n : 0
  } catch {
    return 0
  }
}

export function LockScreen({ onUnlocked }: { onUnlocked: (a: AuthStatus) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const len = useRef(knownLength())

  // No PIN was ever set on the server: the one-time setup (there is no default PIN).
  const [setup, setSetup] = useState(false)

  async function tryPin(value: string) {
    if (busy || value.length < 4) return
    setBusy(true)
    try {
      const s = await life.auth.unlock(value)
      rememberPinLength(value)
      onUnlocked(s)
    } catch (err) {
      if ((err as Error).name === 'SetupNeeded' || /No PIN is set yet/i.test((err as Error).message)) {
        setSetup(true)
        setError(null)
        setPin('')
        setBusy(false)
        return
      }
      setError((err as Error).message)
      setPin('')
      setShake((n) => n + 1)
      setBusy(false)
    }
  }

  // Right length typed: check straight away (no Enter, no button).
  useEffect(() => {
    if (len.current && pin.length === len.current) void tryPin(pin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin])

  if (setup && life.auth.setupPin) return <FirstPin onUnlocked={onUnlocked} />

  return (
    <div className="lock">
      <form
        key={shake}
        className={`lock-card${shake ? ' shake' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          void tryPin(pin)
        }}
      >
        <div className="lock-icon">
          <Icon name="lock" size={26} />
        </div>
        <h1>Welcome back</h1>
        <p>{len.current ? 'Type your PIN: it opens by itself.' : 'Enter your PIN to open Life System.'}</p>
        <input
          className="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          aria-label="PIN"
          value={pin}
          maxLength={12}
          readOnly={busy}
          onChange={(e) => {
            setError(null)
            setPin(e.target.value.replace(/\D/g, ''))
          }}
        />
        {error && <div className="err">{error}</div>}
        {!len.current && (
          <button className="btn primary" disabled={pin.length < 4 || busy}>
            {busy ? 'Opening…' : 'Unlock'}
          </button>
        )}
        {len.current > 0 && busy && <p className="hint">Opening…</p>}
        {life.auth.unlockPasskey && hasPasskeyHere() && (
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                onUnlocked(await life.auth.unlockPasskey!())
              } catch (err) {
                setError((err as Error).message)
                setBusy(false)
              }
            }}
          >
            🔐 Unlock with fingerprint / face
          </button>
        )}
      </form>
    </div>
  )
}

/**
 * The first PIN. Shown once, when the server has no PIN yet: you type the
 * server's setup key (the CRON_SECRET value from Vercel) and choose a PIN of
 * 4 to 8 digits. The server checks the key; nothing is built in.
 */
function FirstPin({ onUnlocked }: { onUnlocked: (a: AuthStatus) => void }) {
  const [key, setKey] = useState('')
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = key.trim().length > 0 && /^\d{4,8}$/.test(pin) && pin === again
  const save = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const s = await life.auth.setupPin!(key.trim(), pin)
      rememberPinLength(pin)
      onUnlocked(s)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="lock">
      <form
        className="lock-card"
        data-testid="first-pin"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="lock-icon">
          <Icon name="lock" size={26} />
        </div>
        <h1>Set your PIN</h1>
        <p>No PIN is set yet. To set the first one, type the server's setup key (the CRON_SECRET value in Vercel) and choose a PIN of 4 to 8 digits.</p>
        <input className="pin" type="password" autoComplete="off" autoFocus aria-label="Setup key" placeholder="Setup key" value={key} readOnly={busy} onChange={(e) => (setError(null), setKey(e.target.value))} />
        <input className="pin" type="password" inputMode="numeric" autoComplete="new-password" aria-label="New PIN" placeholder="New PIN" value={pin} maxLength={8} readOnly={busy} onChange={(e) => (setError(null), setPin(e.target.value.replace(/\D/g, '')))} />
        <input className="pin" type="password" inputMode="numeric" autoComplete="new-password" aria-label="New PIN again" placeholder="New PIN again" value={again} maxLength={8} readOnly={busy} onChange={(e) => (setError(null), setAgain(e.target.value.replace(/\D/g, '')))} />
        {again.length >= 4 && pin !== again && <div className="err">The two PINs are not the same</div>}
        {error && <div className="err">{error}</div>}
        <button className="btn primary" disabled={!ready || busy}>
          {busy ? 'Saving…' : 'Set PIN and open'}
        </button>
      </form>
    </div>
  )
}
