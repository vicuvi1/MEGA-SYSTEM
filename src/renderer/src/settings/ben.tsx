// Settings → ben (LT11: split out of pages/Settings.tsx; the state lives in useSettingsState).
import { POPULAR_MODELS } from '@core/ai'
import { features } from '../bridge'
import { Icon } from '../Icon'
import { BrainPanel } from '../BrainPanel'
import { AiCostPanel } from '../AiCostPanel'
import { BenNotes } from '../BenNotes'
import { BenMemory } from '../BenMemory'
import { CoachLooksPanel } from '../CoachLooksPanel'
import { BenPushPanel, LifeFitPanel } from '../LifeFitPanel'
import { FocusBoostPanel, LaunchKitsPanel, WinMusicPanel } from '../boost/BoostSettings'
import type { SettingsState } from './useSettingsState'
import { Select } from '../Select'

export function BenSection({ s }: { s: SettingsState }) {
  const { onGo, aiCfg, setAiCfg, showGemini, setShowGemini, showOr, setShowOr, testingProvider, aiTestResult, saveAiConfig, testAiConnection } = s
  return (
        <>
          <LifeFitPanel />
          <BenPushPanel />
          <FocusBoostPanel />
          <LaunchKitsPanel />
          <WinMusicPanel />
          <CoachLooksPanel />
          {!features.aiSettings && <BrainPanel />}
          <AiCostPanel />
          <BenNotes />
          <BenMemory />
          {onGo && (
            <section className="panel">
              <header className="panel-head">
                <h2>
                  <Icon name="spark" /> How Ben talks to you
                </h2>
              </header>
              <p className="hint block">Tone (gentle → drill sergeant), reply length, what he knows about you and his daily rhythm live with Ben. Angry faces only at tone 5.</p>
              <div className="row">
                <button className="btn primary" onClick={() => onGo('coach')}>
                  Open Ben → About you
                </button>
              </div>
            </section>
          )}
      {features.aiSettings && (
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="spark" /> AI coach
          </h2>
          <span className={`chip ${aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'ok' : 'muted'}`}>
            {aiCfg.enabled && (aiCfg.geminiKey || aiCfg.openRouterKey) ? 'On' : 'Not set up'}
          </span>
        </header>
        <p className="hint block">
          Connect Google Gemini (official free API keys) or OpenRouter (DeepSeek V3/R1, Claude, GPT) for the AI coach, reward ideas and weekly reports.
        </p>

        <div className="field">
          <span>Official Google Gemini API Key (Free)</span>
          <div className="row">
            <input
              type={showGemini ? 'text' : 'password'}
              placeholder="AIzaSy..."
              value={aiCfg.geminiKey}
              onChange={(e) => setAiCfg({ ...aiCfg, geminiKey: e.target.value })}
            />
            <button className="btn ghost" type="button" onClick={() => setShowGemini(!showGemini)}>
              {showGemini ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!aiCfg.geminiKey || testingProvider === 'gemini'}
              onClick={() => testAiConnection('gemini')}
            >
              {testingProvider === 'gemini' ? 'Testing...' : 'Test Gemini'}
            </button>
          </div>
          <small className="hint">
            Get a free key instantly from <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer">Google AI Studio</a>. Free models: Gemini 3.5 Flash, 3.1 Flash Lite, 3.8 Flash.
          </small>
        </div>

        <div className="field">
          <span>OpenRouter API Key (DeepSeek V3 / DeepSeek R1 / Claude / GPT)</span>
          <div className="row">
            <input
              type={showOr ? 'text' : 'password'}
              placeholder="sk-or-v1-..."
              value={aiCfg.openRouterKey}
              onChange={(e) => setAiCfg({ ...aiCfg, openRouterKey: e.target.value })}
            />
            <button className="btn ghost" type="button" onClick={() => setShowOr(!showOr)}>
              {showOr ? 'Hide' : 'Show'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!aiCfg.openRouterKey || testingProvider === 'openrouter'}
              onClick={() => testAiConnection('openrouter')}
            >
              {testingProvider === 'openrouter' ? 'Testing...' : 'Test OpenRouter'}
            </button>
          </div>
          <small className="hint">
            Connect to openrouter.ai to access DeepSeek V3, DeepSeek R1 reasoning models, and 100+ open models.
          </small>
        </div>

        <div className="field">
          <span>Model Routing Strategy</span>
          <Select
            value={aiCfg.selectedModel}
            onChange={(e) => setAiCfg({ ...aiCfg, selectedModel: e.target.value })}
          >
            <option value="auto">⚡ Auto (Smart Task Routing: Flash for rewards, DeepSeek R1/Pro for strategy)</option>
            <optgroup label="Official Google Gemini (Direct / Free)">
              {POPULAR_MODELS.filter((m) => m.provider === 'gemini').map((m) => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </optgroup>
            <optgroup label="OpenRouter Models">
              {POPULAR_MODELS.filter((m) => m.provider === 'openrouter').map((m) => (
                <option key={m.model} value={m.model}>{m.label}</option>
              ))}
            </optgroup>
          </Select>
        </div>

        <label className="check toggle-row">
          <input
            type="checkbox"
            checked={aiCfg.enabled}
            onChange={(e) => setAiCfg({ ...aiCfg, enabled: e.target.checked })}
          />
          <span>
            Enable AI Systems
            <small>Lets Rewards suggest reward ideas and the coach write weekly reports.</small>
          </span>
        </label>

        {aiTestResult && (
          <div className={`notice ${aiTestResult.ok ? 'ok' : 'warn'}`} style={{ margin: '0.75rem 0', padding: '0.6rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}>
            <b>{aiTestResult.ok ? '✅ Connection Verified:' : '❌ Connection Problem:'}</b>{' '}
            {aiTestResult.message} {aiTestResult.model ? `(${aiTestResult.model})` : ''}
          </div>
        )}

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button className="btn primary" onClick={saveAiConfig}>
            Save AI Configuration
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={(!aiCfg.geminiKey && !aiCfg.openRouterKey) || testingProvider !== null}
            onClick={() => testAiConnection()}
          >
            {testingProvider === 'auto' ? 'Testing...' : 'Test Active Auto-Route'}
          </button>
        </div>
      </section>
      )}
        </>
  )
}
