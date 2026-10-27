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
        content: `**System Coach Ready.**\nHey Victor. I am tracking your schedule, tasks, and streaks in real-time.\n\nWhat are we focusing on right now?`,
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
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }

      setMessages((prev) => [...prev, assistantMsg])
    } catch (err: any) {
      toast(err?.message || 'System Oracle unreachable. Check API keys in Settings.', 'bad')
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `**[SYSTEM ALERT]** Connection to AI provider failed: ${err?.message || 'Check keys in Settings.'}`,
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

  function clearChat() {
    setMessages([
      {
        id: `init-${Date.now()}`,
        role: 'assistant',
        content: `**[SYSTEM REBOOT]**\nCommand log cleared. Standing by for directives, Hunter Victor.`,
        modelUsed: 'SYSTEM CORE',
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
            aria-label="Solo Leveling System Oracle"
          >
            {/* Header */}
            <div className="system-oracle-header">
              <div className="system-oracle-title-row">
                <div className="system-oracle-badge">
                  <span className="system-oracle-pulse" />
                  <span>[SYSTEM NOTICE: HUNTER ORACLE]</span>
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
                onClick={() => handleSend('Analyze my schedule, tasks, and hunter rank. What is my single highest-ROI quest today?')}
              >
                🎯 Today's Critical Quest
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
                    <span>{m.role === 'user' ? 'Hunter Victor' : '✦ System Oracle'}</span>
                    {m.modelUsed && <span className="system-model-tag">{m.modelUsed}</span>}
                    <span style={{ fontSize: '10px', color: '#64748b' }}>{m.timestamp}</span>
                  </div>
                  <div className="system-msg-bubble">
                    <RenderMarkdown text={m.content} />
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
                  <span>System Oracle formulating tactical directive…</span>
                </div>
              )}
              <div ref={streamEndRef} />
            </div>

            {/* Input Bar */}
            <div className="system-oracle-input-bar">
              <div className="system-oracle-form">
                <textarea
                  ref={inputRef}
                  className="system-oracle-textarea"
                  placeholder="Ask the System Oracle for tactical directives..."
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