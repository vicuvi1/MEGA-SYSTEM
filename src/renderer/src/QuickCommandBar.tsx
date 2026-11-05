import React, { useEffect, useRef, useState } from 'react'
import { capture } from './capture'
import { triggerRpgPopup } from './RpgFloatingPopups'
import { soundSuccess, soundTick, soundMechanicalClick } from './sound'
import { useToast } from './ui'
import './quickCommand.css'

interface Props {
  open: boolean
  onClose: () => void
  onRefreshWallet: () => void
}

export function QuickCommandBar({ open, onClose, onRefreshWallet }: Props) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  useEffect(() => {
    if (open) {
      setQuery('')
      setStatusMsg(null)
      soundTick()
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const handleExecute = async (commandStr?: string) => {
    const text = (commandStr || query).trim()
    if (!text || loading) return

    setLoading(true)
    setStatusMsg('Executing command...')
    soundMechanicalClick()

    try {
      // The same pipeline as every capture box (src/renderer/src/capture.ts).
      const r = await capture(text, (step) => setStatusMsg(step))
      soundSuccess()
      triggerRpgPopup({ main: r.via === 'ben' ? 'Ben did it' : 'Logged', sub: r.said.slice(0, 40), kind: 'xp' })
      toast(r.said, r.ok ? 'good' : 'info')
      onRefreshWallet()
      onClose()
    } catch (err: any) {
      toast(err?.message || 'Failed to execute command', 'bad')
      setStatusMsg('Execution error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="quick-command-backdrop" onClick={onClose}>
      <div className="quick-command-window" onClick={(e) => e.stopPropagation()}>
        <div className="quick-command-header">
          <div className="quick-command-tag">
            <span className="solo-pulse-beacon" />
            <span>[ SYSTEM OMNIBAR: INSTANT CAPTURE ]</span>
          </div>
          <span className="quick-command-hint">ESC to exit · ENTER to execute</span>
        </div>

        <div className="quick-command-input-row">
          <span className="quick-command-icon">⚡</span>
          <input
            ref={inputRef}
            type="text"
            className="quick-command-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleExecute()
            }}
            placeholder='Type anything: "30 pushups", "water 500", "45 lunch", "focus 50 algebra", "task call mom tomorrow"…'
            disabled={loading}
          />
          <kbd className="quick-command-kbd">↵ Enter</kbd>
        </div>

        {statusMsg && <div className="quick-command-status">{statusMsg}</div>}

        <div className="quick-command-chips">
          <button className="quick-command-chip" onClick={() => handleExecute('30 pushups')}>
            💪 30 Push-ups
          </button>
          <button className="quick-command-chip" onClick={() => handleExecute('60 situps')}>
            ⚡ 60 Sit-ups
          </button>
          <button className="quick-command-chip" onClick={() => handleExecute('water 500')}>
            💧 +500ml Water
          </button>
          <button className="quick-command-chip" onClick={() => handleExecute('clean')}>
            🛡️ Clean Check-in
          </button>
          <button className="quick-command-chip" onClick={() => handleExecute('oath')}>
            ⚔️ Spartan Oath
          </button>
          <button className="quick-command-chip" onClick={() => setQuery('task ')}>
            📝 New task
          </button>
        </div>
      </div>
    </div>
  )
}
