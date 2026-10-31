import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Summary } from '@shared/api'
import { life } from './bridge'
import { Icon } from './Icon'
import { soundSystemOracle } from './sound'
import { useToast } from './ui'
import './systemOracle.css'

interface Props {
  open: boolean
  onClose: () => void
  summary: Summary | null
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  modelUsed?: string
  toolExecutions?: Array<{ tool: string; result: string; success: boolean; data?: any }>
  timestamp: string
}

const STORAGE_KEY = 'ls.systemOracleChat'

export function SystemOracleDrawer({ open, onClose, summary }: Props) {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const streamEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved)
    } catch {
      // ignore
    }
    return [
      {
        id: 'init-1',
        role: 'assistant',
        content: `**Coach ready.**\nHey Victor. I am tracking your schedule, tasks, and streaks in real-time.\n\nWhat are we focusing on right now?`,
        modelUsed: 'COACH',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ]
  })

  // Play sound effect and focus input on open
  useEffect(() => {
    if (open) {
      soundSystemOracle()
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [open])

  // Save chat to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)))
    } catch {
      // ignore
    }
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Close on Esc
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const lv = summary?.level

  async function handleSend(textToSend?: string) {
    const query = (textToSend || input).trim()
    if (!query || loading) return

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    setMessages((prev) => [...prev, userMsg])
    if (!textToSend) setInput('')
    setLoading(true)

    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }))
      const res = await life.ai.askCoach(query, history)

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: res.reply,
        modelUsed: res.modelUsed,
        toolExecutions: res.toolExecutions,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }

      setMessages((prev) => [...prev, assistantMsg])

      if (res.toolExecutions && res.toolExecutions.length > 0) {
        soundSystemOracle()
        const count = res.toolExecutions.length
        toast(`The coach did ${count} thing${count > 1 ? 's' : ''}`, 'good')
        window.dispatchEvent(new CustomEvent('life:refresh'))
      }
    } catch (err: any) {
      toast(err?.message || 'The coach is unreachable right now.', 'bad')
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `The coach couldn't answer: ${err?.message || 'try again in a minute.'}`,
        modelUsed: 'OFFLINE',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }


  async function handleUndoTool(exec: { tool: string; result: string; success: boolean; data?: any }) {
    try {
      if (exec.tool === 'complete_task' && exec.data?.taskId) {
        await life.tasks.uncomplete(exec.data.taskId)
        toast('↩️ Task uncompleted and returned to queue!', 'good')
      } else if (exec.tool === 'log_workout' && exec.data?.workoutId) {
        await life.body.deleteWorkout(exec.data.workoutId)
        toast('↩️ Workout undone & coins refunded!', 'good')
      } else if (exec.data?.ledgerId) {
        await life.wallet.undo(exec.data.ledgerId, 'Undone from the coach chat')
        toast('↩️ Action undone!', 'good')
      } else {
        toast('Action reverted!', 'good')
      }
      soundSystemOracle()
      window.dispatchEvent(new CustomEvent('life:refresh'))
    } catch (err: any) {
      toast(err?.message || 'Undo failed', 'bad')
    }
  }

  function clearChat() {
    setMessages([
      {
        id: `init-${Date.now()}`,
        role: 'assistant',
        content: `Chat cleared. What are we working on?`,
        modelUsed: 'Coach',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ])
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="system-oracle-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="system-oracle-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            aria-label="Coach"
          >
            {/* Header */}
            <div className="system-oracle-header">
              <div className="system-oracle-title-row">
                <div className="system-oracle-badge">
                  <span className="system-oracle-pulse" />
                  <span>Coach</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    className="system-oracle-close"
                    onClick={clearChat}
                    title="Clear history"
                    style={{ fontSize: '11px', width: 'auto', padding: '0 8px' }}
                  >
                    Clear
                  </button>
                  <button className="system-oracle-close" onClick={onClose} title="Close (Esc)">
                    ✕
                  </button>
                </div>
              </div>

              {lv && (
                <div className="system-oracle-telemetry">
                  <span className="system-telemetry-tag">
                    {lv.hunterGrade} · {lv.hunterTitle} (Lv.{lv.level})
                  </span>
                  <span className="system-telemetry-pill">
                    ⚡ {lv.attributes.totalCombatPower.toLocaleString()} CP
                  </span>
                  <span className="system-telemetry-pill">
                    🪙 {summary?.balance ?? 0} Coins
                  </span>
                </div>
              )}
            </div>

            {/* Quick Action Interceptors */}
            <div className="system-oracle-quick">
              <button
                className="system-quick-btn"
                onClick={() => handleSend('I have 5 minutes right now and feel inertia. Give me 1 surgical directive to execute right now.')}
              >
                ⚡ 5-Min Action Directive
              </button>
              <button
                className="system-quick-btn urgent"
                onClick={() => handleSend('EMERGENCY URGE INTERCEPT: I feel an urge or distraction pull. Give me the immediate 3-step physical reset protocol.')}
              >
                🛡️ Urge Defense Protocol
              </button>
              <button
                className="system-quick-btn"
                onClick={() => handleSend('Look at my day, tasks and goals. What is the single most important thing to do today?')}
              >
                🎯 Today's Critical Quest
              </button>
              <button
                className="system-quick-btn"
                onClick={() => handleSend('Check off task "ss" as completed.')}
              >
                ⚔️ Check off task "ss"
              </button>
              <button
                className="system-quick-btn"
                onClick={() => handleSend('Log 25 pushups for me.')}
              >
                🏋️ Log 25 Pushups
              </button>
              <button
                className="system-quick-btn"
                onClick={() => handleSend('Log 500 ml water for me.')}
              >
                💧 Log 500ml Water
              </button>
              <button
                className="system-quick-btn"
                onClick={() => handleSend('Audit my open tasks and priorities. Tell me what order I should tackle them.')}
              >
                ⚔️ Audit Task Queue
              </button>
            </div>

            {/* Stream */}
            <div className="system-oracle-stream">
              {messages.map((m) => (
                <div key={m.id} className={`system-msg ${m.role}`}>
                  <div className="system-msg-sender">
                    <span>{m.role === 'user' ? 'You' : '✦ Coach'}</span>
                    {m.modelUsed && <span className="system-model-tag">{m.modelUsed}</span>}
                    <span style={{ fontSize: '10px', color: '#64748b' }}>{m.timestamp}</span>
                  </div>
                  <div className="system-msg-bubble">
                    <RenderMarkdown text={m.content} />
                    {m.toolExecutions && m.toolExecutions.length > 0 && (
                      <div className="oracle-tool-pills">
                        {m.toolExecutions.map((t, idx) => (
                          <div key={idx} className={`oracle-tool-pill ${t.success ? 'success' : 'failed'}`}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="tool-icon">{t.success ? '⚡' : '⚠️'}</span>
                              <span className="tool-text">{t.result}</span>
                            </div>
                            {t.success && t.data && (
                              <button
                                className="oracle-tool-undo-btn"
                                onClick={() => handleUndoTool(t)}
                                title="Undo this action"
                              >
                                ↩️ Undo
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="system-oracle-typing">
                  <div className="system-oracle-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <span>Coach is thinking…</span>
                </div>
              )}
              <div ref={streamEndRef} />
            </div>

            {/* Input Bar */}
            <div className="system-oracle-input-bar">
              <div className="oracle-quick-chips">
                <button
                  type="button"
                  className="oracle-quick-chip"
                  onClick={() => handleSend('Give me my morning briefing: sleep, discipline, training, money and the plan for today.')}
                >
                  🌅 Morning Briefing
                </button>
                <button
                  type="button"
                  className="oracle-quick-chip"
                  onClick={() => handleSend('Conduct my Evening Debrief & Sovereign Audit. Review whether all 4 pillars were conquered today, calculate total XP/Coins, and flag any incomplete quests.')}
                >
                  🌙 Evening Audit
                </button>
                <button
                  type="button"
                  className="oracle-quick-chip"
                  onClick={() => handleSend('I am procrastinating. Push me, honestly, and give me one step to start now.')}
                >
                  ⚔️ Spartan War Cry
                </button>
                <button
                  type="button"
                  className="oracle-quick-chip"
                  onClick={() => handleSend('Analyze my progress over the last 7 days and recommend my main priorities for the upcoming week.')}
                >
                  📊 Weekly Strategy
                </button>
              </div>

              <div className="system-oracle-form">
                <textarea
                  ref={inputRef}
                  className="system-oracle-textarea"
                  placeholder="Ask your coach…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  rows={1}
                />
                <button
                  className="system-oracle-send-btn"
                  onClick={() => handleSend()}
                  disabled={loading || !input.trim()}
                  title="Transmit Directive (Enter)"
                >
                  <Icon name="bolt" size={18} />
                </button>
              </div>
              <div className="system-oracle-hints">
                <span>Press <kbd>Enter</kbd> to send, <kbd>Shift + Enter</kbd> for newline</span>
                <span>Toggle with <kbd>Ctrl + Shift + A</kbd></span>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

export function RenderMarkdown({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <div className="oracle-markdown-body">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="oracle-empty-line" />

        // Horizontal dividers
        if (/^[-*_]{3,}$/.test(trimmed)) {
          return <div key={i} className="oracle-divider" />
        }

        // Headings: #, ##, ###
        if (trimmed.startsWith("#")) {
          const levelMatch = trimmed.match(/^#+/)
          const level = levelMatch ? levelMatch[0].length : 1
          const rawTitle = trimmed.replace(/^#+\s*/, "").replace(/^\[(.*)\]$/, "$1")
          return (
            <div key={i} className={`oracle-heading h${level}`}>
              <span className="oracle-heading-accent">✦</span>
              <span>{formatInline(rawTitle)}</span>
            </div>
          )
        }

        // Standalone bracket tag like [SYSTEM NOTICE]
        if (/^\[[A-Z0-9\s:_-]+\]$/.test(trimmed)) {
          const label = trimmed.slice(1, -1)
          return (
            <div key={i} className="oracle-tag-pill">
              <span className="oracle-tag-dot" />
              <span>{label}</span>
            </div>
          )
        }

        // Numbered action items: 1. or 1)
        if (/^\d+[\.)]\s/.test(trimmed)) {
          const match = trimmed.match(/^(\d+)[\.)]\s(.*)/)
          if (match) {
            return (
              <div key={i} className="oracle-step-item">
                <span className="oracle-step-num">{match[1]}</span>
                <div className="oracle-step-content">{formatInline(match[2])}</div>
              </div>
            )
          }
        }

        // Bullet points: - or * or • or ▸
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ") || trimmed.startsWith("▸ ")) {
          const rawBullet = trimmed.replace(/^[-*•▸]\s+/, "")
          return (
            <div key={i} className="oracle-bullet-item">
              <span className="oracle-bullet-dot">▸</span>
              <div className="oracle-bullet-content">{formatInline(rawBullet)}</div>
            </div>
          )
        }

        // Blockquotes
        if (trimmed.startsWith(">")) {
          const quote = trimmed.replace(/^>\s*/, "")
          return (
            <blockquote key={i} className="oracle-quote">
              {formatInline(quote)}
            </blockquote>
          )
        }

        return (
          <p key={i} className="oracle-paragraph">
            {formatInline(line)}
          </p>
        )
      })}
    </div>
  )
}

function formatInline(str: string): React.ReactNode {
  const inlineRegex = new RegExp("(\\*{2}[^*]+?\\*{2}|\\*[^*]+?\\*|`[^`]+?`|_[^_]+?_)", "g")
  const tokens = str.split(inlineRegex)
  return tokens.map((token, idx) => {
    if (token.startsWith("**") && token.endsWith("**") && token.length > 4) {
      return <strong key={idx} className="oracle-strong">{token.slice(2, -2)}</strong>
    }
    if (token.startsWith("*") && token.endsWith("*") && token.length > 2) {
      return <em key={idx} className="oracle-em">{token.slice(1, -1)}</em>
    }
    if (token.startsWith("_") && token.endsWith("_") && token.length > 2) {
      return <em key={idx} className="oracle-em">{token.slice(1, -1)}</em>
    }
    if (token.startsWith("`") && token.endsWith("`") && token.length > 2) {
      return <code key={idx} className="oracle-code">{token.slice(1, -1)}</code>
    }
    return token
  })
}