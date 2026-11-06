// Settings → Desktop island → System and AI usage: which pages, which
// readings on the closed island, and the alert levels. Kept on this PC.
import type { SysmonPrefs } from '@core/sysmon'
import { Row, Segmented, Switch } from '../settingsUi'
import { hasSysmon, saveSysmonPrefs, useSysmonPrefs } from './sysmonFeed'

export function SysmonSettings({ onSaved }: { onSaved?: () => void }) {
  const p = useSysmonPrefs()
  if (!hasSysmon() || !p) return null
  const save = async (patch: Partial<SysmonPrefs>) => {
    if (await saveSysmonPrefs(patch)) onSaved?.()
  }
  const limit = (tool: 'claude' | 'codex', label: string) => (
    <Row title={`${label}: tokens per 5 hours`} hint="Empty: the ring compares this 5-hour window with your busiest one in the last 7 days">
      <input
        className="sx-input"
        type="number"
        min={0}
        step={100000}
        aria-label={`${label} tokens per 5 hours`}
        style={{ width: 130 }}
        defaultValue={p.limits[tool] || ''}
        placeholder="Auto"
        onBlur={(e) => void save({ limits: { ...p.limits, [tool]: Number(e.target.value) || 0 } })}
      />
    </Row>
  )
  return (
    <>
      <h3 className="is-sec">System and AI usage</h3>
      <Row title="System page" hint="CPU per core, GPU, memory, network, the busiest apps (Close asks first), drives, temperatures and power. Read once a second only while the page is open.">
        <Switch label="System page" on={p.pages.system} onChange={(v) => void save({ pages: { ...p.pages, system: v } })} />
      </Row>
      {p.pages.system && (
        <Row title="Busiest apps by">
          <Segmented label="Busiest apps by" value={p.topBy} options={[['cpu', 'CPU'], ['mem', 'Memory']]} onChange={(v) => void save({ topBy: v })} />
        </Row>
      )}
      <Row title="AI usage page" hint="Tokens and cost for today and 7 days, and the 5-hour window. Claude Code and Codex are read from this PC's log files (numbers only, never what was said); nothing is uploaded.">
        <Switch label="AI usage page" on={p.pages.ai} onChange={(v) => void save({ pages: { ...p.pages, ai: v } })} />
      </Row>
      {(p.pages.ai || p.readings.rings) && (
        <>
          <Row title="Claude Code" hint="~/.claude/projects">
            <Switch label="Claude Code" on={p.tools.claude} onChange={(v) => void save({ tools: { ...p.tools, claude: v } })} />
          </Row>
          <Row title="Codex" hint="~/.codex/sessions (uses Codex's own 5-hour limit when it reports one)">
            <Switch label="Codex" on={p.tools.codex} onChange={(v) => void save({ tools: { ...p.tools, codex: v } })} />
          </Row>
          <Row title="Ben's AI" hint="This month's cost against your budget (Settings → Ben's brain)">
            <Switch label="Ben's AI" on={p.tools.ben} onChange={(v) => void save({ tools: { ...p.tools, ben: v } })} />
          </Row>
          {p.tools.claude && limit('claude', 'Claude Code')}
          {p.tools.codex && limit('codex', 'Codex')}
        </>
      )}
      <Row title="Usage rings on the pill" hint="A small ring per tool with a letter inside: C Claude, X Codex, B Ben">
        <Switch label="Usage rings on the pill" on={p.readings.rings} onChange={(v) => void save({ readings: { ...p.readings, rings: v } })} />
      </Row>
      <Row title="CPU and memory on the pill" hint="Read every 30 seconds">
        <Switch label="CPU and memory on the pill" on={p.readings.cpuRam} onChange={(v) => void save({ readings: { ...p.readings, cpuRam: v } })} />
      </Row>
      <Row title="Usage alerts" hint={`A 5-second notice in the pill at ${p.alerts.warn}% and ${p.alerts.crit}%, once per window (needs the AI usage page or the rings)`}>
        <Switch label="Usage alerts" on={p.alerts.on} onChange={(v) => void save({ alerts: { ...p.alerts, on: v } })} />
      </Row>
      {p.alerts.on && (
        <>
          <Row title="Warning at" hint={`${p.alerts.warn}%`}>
            <input className="sx-range" type="range" min={30} max={95} step={5} value={p.alerts.warn} aria-label="Warning at" onChange={(e) => void save({ alerts: { ...p.alerts, warn: Number(e.target.value) } })} />
          </Row>
          <Row title="Critical at" hint={`${p.alerts.crit}%`}>
            <input className="sx-range" type="range" min={50} max={100} step={5} value={p.alerts.crit} aria-label="Critical at" onChange={(e) => void save({ alerts: { ...p.alerts, crit: Number(e.target.value) } })} />
          </Row>
        </>
      )}
    </>
  )
}
