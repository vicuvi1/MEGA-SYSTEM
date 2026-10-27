import { useEffect, useState, useCallback } from 'react'
import type { BotBridgeConfig, BotLogEntry } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useToast } from '../ui'

const COMMAND_CODEX = [
  {
    cmd: '/today',
    syntax: '/today',
    badge: 'Overview',
    coins: '0',
    desc: 'Instant summary of balance, level, XP, discipline streak, and top pending tasks.'
  },
  {
    cmd: '/checkin',
    syntax: '/checkin clean',
    badge: 'Discipline',
    coins: '+10',
    desc: 'Log daily streak check-in. Validates your daily discipline and awards streak coins.'
  },
  {
    cmd: '/oath',
    syntax: '/oath',
    badge: 'Mindset',
    coins: '0',
    desc: 'Reaffirm your core commitment oath and warrior code.'
  },
  {
    cmd: '/workout',
    syntax: '/workout pushups 30',
    badge: 'Fitness',
    coins: '+15',
    desc: 'Log a workout directly from your phone. E.g. /workout running 5km or /workout pushups 30.'
  },
  {
    cmd: '/expense',
    syntax: '/expense 14.50 food lunch',
    badge: 'Finance',
    coins: '+3',
    desc: 'Log an expense into your ledger with category and note. Calculates daily budget.'
  },
  {
    cmd: '/tasks',
    syntax: '/tasks',
    badge: 'Planner',
    coins: '0',
    desc: 'List your top uncompleted tasks across Body, Face, Finance, University, and Life.'
  },
  {
    cmd: '/done',
    syntax: '/done <task_id>',
    badge: 'Planner',
    coins: '+10',
    desc: 'Complete an active task remotely by its short ID.'
  },
  {
    cmd: '/wake',
    syntax: '/wake',
    badge: 'Circadian',
    coins: '+10',
    desc: 'Log morning wake-up time. Awards bonus coins if up on or before your target time.'
  },
  {
    cmd: '/bed',
    syntax: '/bed',
    badge: 'Circadian',
    coins: '+5',
    desc: 'Log evening bedtime. Enforces circadian rhythm consistency.'
  },
  {
    cmd: '/panic',
    syntax: '/panic',
    badge: 'Emergency',
    coins: '0',
    desc: 'Emergency urge protocol! Activates immediate calming guidance and distraction steps.'
  },
  {
    cmd: '/help',
    syntax: '/help',
    badge: 'System',
    coins: '0',
    desc: 'Shows interactive directory of all available Telegram commands.'
  }
]

export function BotCenter() {
  const toast = useToast()
  const [config, setConfig] = useState<BotBridgeConfig>({
    botToken: '',
    chatId: '',
    enabled: true,
    pollingEnabled: false,
    morningBriefing: true,
    eveningNudge: true,
    sportBotToken: '',
    sportBotChatId: '',
    financeBotToken: '',
    financeBotChatId: '',
    manBotToken: '',
    manBotChatId: ''
  })
  const [status, setStatus] = useState<{
    polling: boolean
    enabled: boolean
    configured: boolean
    lastPollAt: string | null
    lastError: string | null
    processedCount: number
  }>({
    polling: false,
    enabled: false,
    configured: false,
    lastPollAt: null,
    lastError: null,
    processedCount: 0
  })
  const [logs, setLogs] = useState<BotLogEntry[]>([])
  const [showToken, setShowToken] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)
  const [searchLog, setSearchLog] = useState('')
  const [activeTab, setActiveTab] = useState<'codex' | 'ecosystem' | 'logs'>('codex')

  const refreshAll = useCallback(async () => {
    try {
      const [c, s, l] = await Promise.all([
        life.bots.config(),
        life.bots.status(),
        life.bots.logs()
      ])
      setConfig(c)
      setStatus(s)
      setLogs(l)
    } catch (err: any) {
      console.error('Failed to load bot hub data:', err)
    }
  }, [])

  useEffect(() => {
    refreshAll()
    const timer = setInterval(async () => {
      try {
        const [s, l] = await Promise.all([life.bots.status(), life.bots.logs()])
        setStatus(s)
        setLogs(l)
      } catch {
        // ignore background poll errors
      }
    }, 3500)
    return () => clearInterval(timer)
  }, [refreshAll])

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setIsSaving(true)
    try {
      const updated = await life.bots.saveConfig(config)
      setConfig(updated)
      toast('Bot Command Center settings saved', 'good')
      const s = await life.bots.status()
      setStatus(s)
    } catch (err: any) {
      toast(err.message || 'Failed to save bot settings', 'bad')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTogglePolling = async () => {
    try {
      if (status.polling) {
        await life.bots.stopPolling()
        toast('Telegram polling stopped', 'info')
      } else {
        await life.bots.startPolling()
        toast('Telegram 2-way polling started', 'good')
      }
      const s = await life.bots.status()
      setStatus(s)
    } catch (err: any) {
      toast(err.message || 'Failed to change polling state', 'bad')
    }
  }

  const handleSendTest = async () => {
    setIsTesting(true)
    try {
      const res = await life.bots.test()
      if (res.ok) {
        toast('Ping message delivered to your Telegram!', 'good')
      } else {
        toast(res.error || 'Failed to send test message', 'bad')
      }
      refreshAll()
    } catch (err: any) {
      toast(err.message || 'Failed to send test message', 'bad')
    } finally {
      setIsTesting(false)
    }
  }

  const handleClearLogs = async () => {
    try {
      await life.bots.clearLogs()
      setLogs([])
      toast('Command audit logs cleared', 'info')
    } catch (err: any) {
      toast(err.message || 'Failed to clear logs', 'bad')
    }
  }

  const copyToClipboard = (syntax: string) => {
    navigator.clipboard.writeText(syntax)
    setCopiedCmd(syntax)
    toast(`Copied ${syntax} to clipboard`, 'good')
    setTimeout(() => setCopiedCmd(null), 2000)
  }

  const filteredLogs = logs.filter(
    (l) =>
      l.command.toLowerCase().includes(searchLog.toLowerCase()) ||
      l.reply.toLowerCase().includes(searchLog.toLowerCase()) ||
      l.sender.toLowerCase().includes(searchLog.toLowerCase())
  )

  return (
    <div className="page-body bot-center-page">
      {/* Top Banner / Hero */}
      <div className="bot-hero">
        <div className="bot-hero-info">
          <div className="bot-hero-title-row">
            <div className="bot-icon-circle">
              <Icon name="bot" size={26} />
            </div>
            <div>
              <h1 className="page-title" style={{ margin: 0 }}>
                Bot Command Center
              </h1>
              <p className="page-sub" style={{ margin: '4px 0 0 0' }}>
                Unified 2-way Telegram controller for all Victor's bots. Control your habits, ledger, and streaks from your pocket.
              </p>
            </div>
          </div>
        </div>

        <div className="bot-status-panel">
          <div className="bot-status-indicators">
            <span
              className={`bot-pill ${
                status.polling ? 'pill-online' : config.botToken ? 'pill-paused' : 'pill-offline'
              }`}
            >
              <i className="status-dot" />
              {status.polling ? '2-Way Live (Polling)' : config.botToken ? 'Paused' : 'Unconfigured'}
            </span>
            <span className="bot-metric">
              <b>{status.processedCount}</b> commands run
            </span>
            {status.lastPollAt && (
              <span className="bot-timestamp">
                Poll: {new Date(status.lastPollAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>

          <div className="bot-hero-actions">
            <button
              className={`btn ${status.polling ? 'btn-warn' : 'btn-primary'}`}
              onClick={handleTogglePolling}
              disabled={!config.botToken || !config.chatId}
              title={!config.botToken ? 'Set Bot Token and Chat ID below first' : ''}
            >
              {status.polling ? 'Pause Polling' : 'Start Polling'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleSendTest}
              disabled={isTesting || !config.botToken || !config.chatId}
            >
              {isTesting ? 'Sending...' : 'Send Test Ping'}
            </button>
          </div>
        </div>
      </div>

      {status.lastError && (
        <div className="bot-error-banner">
          <Icon name="bolt" size={16} />
          <span><b>Telegram Error:</b> {status.lastError}</span>
        </div>
      )}

      {/* Main Connection Setup Card */}
      <div className="bot-config-card">
        <div className="card-header">
          <h3>Central Controller Pairing & Security Whitelist</h3>
          <span className="badge-shield">Encrypted with Windows DPAPI</span>
        </div>
        <form onSubmit={handleSave} className="bot-form">
          <div className="form-grid">
            <div className="form-group">
              <label>Telegram Bot Token</label>
              <div className="input-reveal-wrap">
                <input
                  type={showToken ? 'text' : 'password'}
                  placeholder="e.g. 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  value={config.botToken}
                  onChange={(e) => setConfig({ ...config, botToken: e.target.value.trim() })}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="btn-reveal"
                  onClick={() => setShowToken(!showToken)}
                  title={showToken ? 'Hide token' : 'Show token'}
                >
                  {showToken ? 'Hide' : 'Reveal'}
                </button>
              </div>
              <small className="form-hint">Obtain from @BotFather on Telegram.</small>
            </div>

            <div className="form-group">
              <label>Your Telegram Chat ID (Strict Security Whitelist)</label>
              <input
                type="text"
                placeholder="e.g. 987654321"
                value={config.chatId}
                onChange={(e) => setConfig({ ...config, chatId: e.target.value.trim() })}
                autoComplete="off"
                spellCheck={false}
              />
              <small className="form-hint">
                Only messages from this specific Chat ID will be processed. Message @userinfobot to see yours.
              </small>
            </div>
          </div>

          <div className="form-footer">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.pollingEnabled}
                onChange={(e) => setConfig({ ...config, pollingEnabled: e.target.checked })}
              />
              <span>Enable automatic 2-way command polling on app startup</span>
            </label>

            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Pairing Configuration'}
            </button>
          </div>
        </form>
      </div>

      {/* Navigation Tabs */}
      <div className="bot-tabs">
        <button
          className={`tab-btn ${activeTab === 'codex' ? 'active' : ''}`}
          onClick={() => setActiveTab('codex')}
        >
          <Icon name="sliders" size={15} />
          <span>Interactive Command Codex</span>
          <span className="count-pill">{COMMAND_CODEX.length}</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'ecosystem' ? 'active' : ''}`}
          onClick={() => setActiveTab('ecosystem')}
        >
          <Icon name="link" size={15} />
          <span>Ecosystem Bot Bridges</span>
          <span className="count-pill">3</span>
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          <Icon name="list" size={15} />
          <span>Live Command Audit Feed</span>
          <span className="count-pill">{logs.length}</span>
        </button>
      </div>

      {/* TAB 1: COMMAND CODEX */}
      {activeTab === 'codex' && (
        <div className="tab-pane codex-pane">
          <div className="section-intro">
            <h4>Telegram Command Directory</h4>
            <p>Send any of these commands directly from your phone to update your local Life System database in real-time.</p>
          </div>

          <div className="codex-grid">
            {COMMAND_CODEX.map((item) => (
              <div key={item.cmd} className="codex-card">
                <div className="codex-card-header">
                  <span className="codex-badge">{item.badge}</span>
                  {item.coins !== '0' && <span className="codex-coins">{item.coins} coins</span>}
                </div>
                <div className="codex-cmd-row">
                  <code className="codex-cmd">{item.syntax}</code>
                  <button
                    className="btn-copy"
                    onClick={() => copyToClipboard(item.syntax)}
                    title="Copy command"
                  >
                    {copiedCmd === item.syntax ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="codex-desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: ECOSYSTEM BOT BRIDGES */}
      {activeTab === 'ecosystem' && (
        <div className="tab-pane ecosystem-pane">
          <div className="section-intro">
            <h4>Multi-Bot Ecosystem Connectivity</h4>
            <p>
              Bridge secondary automated bots into this central hub. All secondary bots forward events into your central ledger.
            </p>
          </div>

          <div className="ecosystem-grid">
            {/* Sport Bot */}
            <div className="ecosystem-card">
              <div className="ecosystem-header">
                <div className="badge-icon sport-icon">
                  <Icon name="bolt" size={18} />
                </div>
                <div>
                  <h4>Sport & Workout Bot</h4>
                  <small>Automated rep counter and fitness logger</small>
                </div>
              </div>
              <div className="ecosystem-inputs">
                <label>Secondary Bot Token</label>
                <input
                  type="password"
                  placeholder="Sport bot token (optional)"
                  value={config.sportBotToken || ''}
                  onChange={(e) => setConfig({ ...config, sportBotToken: e.target.value.trim() })}
                />
                <label>Assigned Chat ID</label>
                <input
                  type="text"
                  placeholder="Defaults to primary Chat ID"
                  value={config.sportBotChatId || ''}
                  onChange={(e) => setConfig({ ...config, sportBotChatId: e.target.value.trim() })}
                />
              </div>
              <div className="ecosystem-footer">
                <span className="status-tag active">Integrated with /workout</span>
              </div>
            </div>

            {/* Finance Helper Bot */}
            <div className="ecosystem-card">
              <div className="ecosystem-header">
                <div className="badge-icon finance-icon">
                  <Icon name="coin" size={18} />
                </div>
                <div>
                  <h4>Finance Helper Bot</h4>
                  <small>Receipt parser & quick expense input</small>
                </div>
              </div>
              <div className="ecosystem-inputs">
                <label>Secondary Bot Token</label>
                <input
                  type="password"
                  placeholder="Finance bot token (optional)"
                  value={config.financeBotToken || ''}
                  onChange={(e) => setConfig({ ...config, financeBotToken: e.target.value.trim() })}
                />
                <label>Assigned Chat ID</label>
                <input
                  type="text"
                  placeholder="Defaults to primary Chat ID"
                  value={config.financeBotChatId || ''}
                  onChange={(e) => setConfig({ ...config, financeBotChatId: e.target.value.trim() })}
                />
              </div>
              <div className="ecosystem-footer">
                <span className="status-tag active">Integrated with /expense</span>
              </div>
            </div>

            {/* MAN Recovery Bot */}
            <div className="ecosystem-card">
              <div className="ecosystem-header">
                <div className="badge-icon man-icon">
                  <Icon name="shield" size={18} />
                </div>
                <div>
                  <h4>MAN Recovery Bot</h4>
                  <small>Discipline guard, urge protocol & streak defense</small>
                </div>
              </div>
              <div className="ecosystem-inputs">
                <label>Secondary Bot Token</label>
                <input
                  type="password"
                  placeholder="MAN bot token (optional)"
                  value={config.manBotToken || ''}
                  onChange={(e) => setConfig({ ...config, manBotToken: e.target.value.trim() })}
                />
                <label>Assigned Chat ID</label>
                <input
                  type="text"
                  placeholder="Defaults to primary Chat ID"
                  value={config.manBotChatId || ''}
                  onChange={(e) => setConfig({ ...config, manBotChatId: e.target.value.trim() })}
                />
              </div>
              <div className="ecosystem-footer">
                <span className="status-tag active">Integrated with /panic & /checkin</span>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" onClick={() => handleSave()} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Ecosystem Bridges'}
            </button>
          </div>
        </div>
      )}

      {/* TAB 3: LIVE COMMAND AUDIT FEED */}
      {activeTab === 'logs' && (
        <div className="tab-pane logs-pane">
          <div className="logs-toolbar">
            <div className="logs-search">
              <Icon name="search" size={14} />
              <input
                type="text"
                placeholder="Search command logs..."
                value={searchLog}
                onChange={(e) => setSearchLog(e.target.value)}
              />
            </div>
            <div className="logs-actions">
              <button className="btn btn-secondary btn-sm" onClick={refreshAll}>
                Refresh
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleClearLogs}
                disabled={logs.length === 0}
              >
                Clear Logs
              </button>
            </div>
          </div>

          {filteredLogs.length === 0 ? (
            <div className="empty-logs">
              <Icon name="bot" size={32} />
              <p>No Telegram commands received yet.</p>
              <small>Send any command like <code>/today</code> or <code>/help</code> from your connected Telegram account.</small>
            </div>
          ) : (
            <div className="logs-list">
              {filteredLogs.map((log) => (
                <div key={log.id} className={`log-item ${log.success ? 'log-ok' : 'log-fail'}`}>
                  <div className="log-top">
                    <span className={`log-badge ${log.success ? 'badge-ok' : 'badge-fail'}`}>
                      {log.success ? 'SUCCESS' : 'REJECTED'}
                    </span>
                    <code className="log-cmd">{log.command}</code>
                    <span className="log-chat">Chat: {log.sender}</span>
                    <span className="log-time">
                      {new Date(log.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  <div
                    className="log-response"
                    dangerouslySetInnerHTML={{ __html: log.reply }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
