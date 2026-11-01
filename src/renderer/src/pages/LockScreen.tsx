// The PIN screen. It opens the moment the right PIN is typed: the app
// remembers your PIN's length on this device (never the PIN itself) and
// checks as soon as you reach it, so wrong partial PINs never count as
// failed tries. The first time on a new device, press Enter once.
import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
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

  async function tryPin(value: string) {
    if (busy || value.length < 4) return
    setBusy(true)
    try {
      const s = await life.auth.unlock(value)
      rememberPinLength(value)
      onUnlocked(s)
    } catch (err) {
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

  return (
    <div className="lock">
      <motion.form
        key={shake}
        className="lock-card"
        onSubmit={(e) => {
          e.preventDefault()
          void tryPin(pin)
        }}
        animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}}
        transition={{ duration: 0.35 }}
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
      </motion.form>
    </div>
  )
}
