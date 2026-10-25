import { useState } from 'react'
import { motion } from 'framer-motion'
import type { AuthStatus } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'

export function LockScreen({ onUnlocked }: { onUnlocked: (a: AuthStatus) => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      onUnlocked(await life.auth.unlock(pin))
    } catch (err) {
      setError((err as Error).message)
      setPin('')
      setShake((n) => n + 1)
    }
  }

  return (
    <div className="lock">
      <motion.form key={shake} className="lock-card" onSubmit={submit} animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}} transition={{ duration: 0.35 }}>
        <div className="lock-icon">
          <Icon name="lock" size={26} />
        </div>
        <h1>System locked</h1>
        <p>Enter your PIN to continue.</p>
        <input
          className="pin"
          type="password"
          inputMode="numeric"
          autoFocus
          aria-label="PIN"
          value={pin}
          maxLength={12}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        {error && <div className="err">{error}</div>}
        <button className="btn primary" disabled={pin.length < 4}>
          Unlock
        </button>
      </motion.form>
    </div>
  )
}
