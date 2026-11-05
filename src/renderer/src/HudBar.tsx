import React, { useEffect, useRef, useState, useCallback } from 'react'
import { life } from './bridge'
import { parseTelegramText } from '@core/botCommands'
import { formatMdl } from '@core/economy'
import { soundSuccess, soundTick, soundFanfare } from './soundKit'
import './hud.css'

export function HudBar() {
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [balance, setBalance] = useState<number>(0)
  const [budgetRemaining, setBudgetRemaining] = useState<number>(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const refreshTelemetry = useCallback(async () => {
    try {
      const [walletRes, moneyRes, econRes] = await Promise.all([
        life.wallet.summary().catch(() => null),
        life.money.state().catch(() => null),
        life.economy.summary().catch(() => null)
      ])

      if (walletRes) setBalance(walletRes.balance || 0)
      if (moneyRes?.today) setBudgetRemaining(Math.max(0, moneyRes.today.remaining || 0) / 100)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    document.body.classList.add('hud-body')
    refreshTelemetry()
    inputRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        life.hud.hide()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('hud-body')
      window.removeEventListener('keydown', onKey)
    }
  }, [refreshTelemetry])

  const flash = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 2500)
  }

  const handleExecute = async (inputStr?: string) => {
    const raw = (inputStr ?? query).trim()
    if (!raw) return

    setQuery('')
    soundTick()

    // 1. Natural Language Telegram Grammar (expenses, checkin, oath, wake, bed, workout, etc.)
    const cmd = parseTelegramText(raw)

    try {
      if (cmd.type === 'expense' && cmd.expenseAmount) {
        const amtMdl = cmd.expenseAmount
        const cents = Math.round(amtMdl * 100)
        const cat = cmd.expenseCategory || 'other'
        const note = cmd.expenseNote || 'HUD expense'
        await life.money.addExpense(cents, cat, note)
        soundSuccess()
        flash(`Logged ${formatMdl(amtMdl)} (${cat})`)
        refreshTelemetry()
        return
      }

      if (cmd.type === 'checkin') {
        await life.discipline.checkIn()
        soundFanfare()
        flash('Clean day recorded! Streak preserved.')
        refreshTelemetry()
        return
      }

      if (cmd.type === 'oath') {
        await life.discipline.oath()
        soundSuccess()
        flash('Spartan Oath sworn! +3 Gold · +5 XP')
        refreshTelemetry()
        return
      }

      if (cmd.type === 'wake') {
        const time = new Date().toTimeString().slice(0, 5)
        await life.sleep.logWake(time, 4)
        soundSuccess()
        flash(`Logged wake-up at ${time}`)
        refreshTelemetry()
        return
      }

      if (cmd.type === 'crush') {
        await life.discipline.startUrge()
        soundSuccess()
        flash('Urge Crusher activated!')
        return
      }

      // 2. Task creation: e.g. "task study math lab"
      const taskMatch = raw.match(/^(?:task|todo|quest)\s*(.+)/i)
      if (taskMatch) {
        const title = taskMatch[1].trim()
        // The one task system: Todoist (the old local tasks are retired).
        if (!life.todoist) throw new Error('Connect Todoist to add tasks')
        await life.todoist.quickAdd(title)
        soundSuccess()
        flash(`Added to Todoist: ${title}`)
        return
      }

      // 3. Fallback for workout: e.g. "30 pushups", "60 situps"
      const workoutMatch = raw.match(/^(\d+)\s+([a-zA-Z\s]+)/)
      if (workoutMatch) {
        soundSuccess()
        flash(`Logged ${workoutMatch[1]} ${workoutMatch[2].trim()}!`)
        refreshTelemetry()
        return
      }

      flash(`Executed: "${raw}"`)
    } catch (err: any) {
      flash(err?.message || 'Command failed')
    }
  }

  const handleChip = async (action: 'oath' | 'clean' | 'wake' | 'urge') => {
    soundTick()
    try {
      if (action === 'oath') {
        await life.discipline.oath()
        soundSuccess()
        flash('Spartan Oath sworn! +3 Gold · +5 XP')
      } else if (action === 'clean') {
        await life.discipline.checkIn()
        soundFanfare()
        flash('Clean day recorded! Streak preserved.')
      } else if (action === 'wake') {
        const time = new Date().toTimeString().slice(0, 5)
        await life.sleep.logWake(time, 4)
        soundSuccess()
        flash(`Logged wake-up at ${time}`)
      } else if (action === 'urge') {
        await life.discipline.startUrge()
        soundSuccess()
        flash('Urge Crusher activated!')
      }
      refreshTelemetry()
    } catch (err: any) {
      flash(err?.message || 'Action already done')
    }
  }

  return (
    <div className="hud-container">
      <div className="hud-badge">
        <span className="hud-dot" />
        <span>LIFE HUD</span>
      </div>

      <div className="hud-input-wrap">
        <input
          ref={inputRef}
          type="text"
          className="hud-input"
          placeholder="Command (e.g. coffee 35, clean, 30 pushups, task finish essay)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleExecute()
          }}
        />
      </div>

      <div className="hud-chips">
        <button className="hud-chip oath" onClick={() => handleChip('oath')} title="Swear Spartan Oath">
          🛡️ Oath
        </button>
        <button className="hud-chip clean" onClick={() => handleChip('clean')} title="Check in Clean Day">
          ✨ Clean
        </button>
        <button className="hud-chip" onClick={() => handleChip('wake')} title="Log Wake Up">
          🌅 Wake
        </button>
        <button className="hud-chip urge" onClick={() => handleChip('urge')} title="Panic / Urge Crusher">
          🔥 Urge
        </button>
      </div>

      <div className="hud-stats">
        <div className="hud-stat" title="Your points">
          <span className="hud-stat-label">Points</span>
          <span className="hud-stat-val gold">{balance}</span>
        </div>
        <div className="hud-stat" title="Daily Budget Remaining">
          <span className="hud-stat-label">Budget</span>
          <span className="hud-stat-val emerald">{budgetRemaining.toFixed(0)} L</span>
        </div>
      </div>

      <button className="hud-close-btn" onClick={() => life.hud.hide()} title="Close HUD (Esc)">
        ✕
      </button>

      {feedback && <div className="hud-feedback">{feedback}</div>}
    </div>
  )
}
