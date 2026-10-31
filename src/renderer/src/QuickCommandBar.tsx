import React, { useEffect, useRef, useState } from 'react'
import { features, life } from './bridge'
import { triggerRpgPopup } from './RpgFloatingPopups'
import { soundCoin, soundSuccess, soundTick, soundMechanicalClick } from './sound'
import { useToast } from './ui'
import { parseTelegramText } from '@core/botCommands'
import { formatMdl } from '@core/economy'
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
      // 1. Reps / Workouts: e.g. "30 pushups", "50 situps", "20 press"
      const workoutMatch = text.match(/^(\d+)\s*(pushups?|push-ups?|situps?|sit-ups?|press|pullups?|pull-ups?|squats?|reps?)/i)
      if (workoutMatch) {
        const amount = parseInt(workoutMatch[1], 10)
        let exName = workoutMatch[2].toLowerCase()
        let exId = 'pushups'
        if (exName.includes('sit')) {
          exId = 'situps'
          exName = 'Sit-ups'
        } else if (exName.includes('press')) {
          exId = 'press'
          exName = 'Press'
        } else if (exName.includes('pull')) {
          exId = 'pullups'
          exName = 'Pull-ups'
        } else if (exName.includes('squat')) {
          exId = 'squats'
          exName = 'Squats'
        } else {
          exId = 'pushups'
          exName = 'Push-ups'
        }

        await life.body.logWorkout({
          title: `${exName} (+${amount})`,
          items: [{ exerciseId: exId, name: exName, amount, unit: 'reps' as any }],
          note: 'Logged via Quick Omnibar'
        })
        soundCoin()
        triggerRpgPopup({
          main: `+${amount} ${exName}`,
          sub: '+10 STR XP',
          kind: 'xp'
        })
        toast(`Logged ${amount} ${exName}!`, 'good')
        onRefreshWallet()
        onClose()
        return
      }

      // 2. Water / Hydration: e.g. "water 500", "drank 250"
      const waterMatch = text.match(/^(?:water|hydrat\w*|drank)\s*(\d+)/i)
      if (waterMatch) {
        const ml = parseInt(waterMatch[1], 10)
        const today = new Date().toISOString().slice(0, 10)
        let currentMl = 0
        try {
          const saved = localStorage.getItem('ls.hydration')
          if (saved) {
            const parsed = JSON.parse(saved)
            if (parsed.date === today) currentMl = parsed.ml || 0
          }
        } catch {}
        const nextMl = currentMl + ml
        try {
          localStorage.setItem('ls.hydration', JSON.stringify({ date: today, ml: nextMl }))
        } catch {}

        soundCoin()
        triggerRpgPopup({
          main: `+${ml}ml Water`,
          sub: '+5 VIT XP',
          kind: 'xp'
        })
        toast(`Logged ${ml}ml hydration! (Total: ${nextMl}ml)`, 'good')
        onRefreshWallet()
        onClose()
        return
      }

      // 3. Discipline Check-in / Oath: e.g. "clean", "checkin", "oath"
      if (/^(?:clean|checkin|clean day)/i.test(text)) {
        await life.discipline.checkIn()
        soundSuccess()
        triggerRpgPopup({
          main: 'Clean Day Checked In!',
          sub: '+20 Gold · +40 XP',
          kind: 'gold'
        })
        toast('Checked in clean! Streak preserved.', 'good')
        onRefreshWallet()
        onClose()
        return
      }

      if (/^oath/i.test(text)) {
        await life.discipline.oath()
        soundSuccess()
        triggerRpgPopup({
          main: 'Spartan Oath Sworn!',
          sub: '+3 Gold · +5 XP',
          kind: 'gold'
        })
        toast('Morning Spartan Oath sworn!', 'good')
        onRefreshWallet()
        onClose()
        return
      }

      // 4. Expense: parse with Unified Telegram grammar (e.g. "coffee 35", "35 coffee", "taxi 50", "spent 15 lunch")
      const parsedCmd = parseTelegramText(text)
      if (parsedCmd.type === 'expense' && parsedCmd.expenseAmount) {
        const amtMdl = parsedCmd.expenseAmount
        const cents = Math.round(amtMdl * 100)
        const cat = parsedCmd.expenseCategory || 'other'
        const note = parsedCmd.expenseNote || 'Quick Expense'
        await life.money.addExpense(cents, cat, note)
        soundSuccess()
        triggerRpgPopup({
          main: `-${formatMdl(amtMdl)}`,
          sub: `${cat}: ${note}`,
          kind: 'gold'
        })
        toast(`Logged ${formatMdl(amtMdl)} (${cat}): ${note}`, 'good')
        onRefreshWallet()
        onClose()
        return
      }

      const expenseMatch = text.match(/^(?:spent|expense|paid|cost)\s*\$?(\d+(?:\.\d+)?)\s*(.*)/i)
      if (expenseMatch) {
        const amount = parseFloat(expenseMatch[1])
        const note = expenseMatch[2].trim() || 'Quick Expense'
        const cents = Math.round(amount * 100)
        await life.money.addExpense(cents, 'other', note)
        soundSuccess()
        triggerRpgPopup({
          main: `-${formatMdl(amount)}`,
          sub: note,
          kind: 'gold'
        })
        toast(`Logged ${formatMdl(amount)} expense: ${note}`, 'good')
        onRefreshWallet()
        onClose()
        return
      }

      // 5. Task creation: e.g. "task study math lab p1", "todo write report"
      const taskMatch = text.match(/^(?:task|todo|quest)\s*(.+)/i)
      if (taskMatch) {
        let taskTitle = taskMatch[1].trim()
        let priority: 1 | 2 | 3 = 2
        if (/\bp1\b/i.test(taskTitle)) {
          priority = 1
          taskTitle = taskTitle.replace(/\bp1\b/gi, '').trim()
        } else if (/\bp3\b/i.test(taskTitle)) {
          priority = 3
          taskTitle = taskTitle.replace(/\bp3\b/gi, '').trim()
        }

        const today = new Date().toISOString().slice(0, 10)
        await life.tasks.save({
          title: taskTitle,
          category: 'university',
          priority,
          due: today,
          repeat: 'none',
          weekdays: 0,
          coins: priority === 1 ? 15 : priority === 2 ? 10 : 5,
          xp: priority === 1 ? 30 : priority === 2 ? 20 : 10,
          notes: 'Created via Quick Omnibar'
        })
        soundSuccess()
        triggerRpgPopup({
          main: 'Quest Created!',
          sub: taskTitle,
          kind: 'xp'
        })
        toast(`Created quest "${taskTitle}" (Priority ${priority})`, 'good')
        onRefreshWallet()
        onClose()
        return
      }

      // 6. Anything else: the AI coach
      if (!features.ai) {
        toast(`Not sure what "${text.slice(0, 40)}" means. Try: "45 lunch", "50 pushups", "task Read 10 pages", "check in".`, 'info')
        return
      }
      const res = await life.ai.askCoach(text)
      if (res.toolExecutions && res.toolExecutions.length > 0) {
        const executed = res.toolExecutions.map((e) => e.result).join(' · ')
        triggerRpgPopup({
          main: 'Action Executed!',
          sub: executed.slice(0, 30),
          kind: 'xp'
        })
        toast(`⚡ Agent: ${executed}`, 'good')
        onRefreshWallet()
      } else {
        toast(`💬 Coach: ${res.reply.slice(0, 75)}...`, 'info')
      }
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
            placeholder='Type command: "30 pushups", "water 500", "spent 15 lunch", "task study p1"...'
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
            📝 New Quest
          </button>
        </div>
      </div>
    </div>
  )
}
