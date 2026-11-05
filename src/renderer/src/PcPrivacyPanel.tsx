// Settings → Ben on this PC (P1): every sensor the desktop app has, a switch
// for each, what it saw today and a Delete button. The app sensor is off until
// you turn it on; nothing here leaves this computer except, if you choose, the
// day's totals for Ben's evening review.
import { useCallback, useEffect, useState } from 'react'
import type { PcPrefs } from '@core/pcActivity'
import { Row, Switch } from './settingsUi'
import { useAction } from './ui'

type Info = { prefs: PcPrefs; port: number; token: string; now: { label: string; kind: string } | null; windows: boolean; siteServer?: string | null }

export function PcPrivacyPanel() {
  const desk = window.desktop
  const act = useAction()
  const [info, setInfo] = useState<Info | null>(null)
  const [today, setToday] = useState<{ line: string } | null>(null)
  const [web, setWeb] = useState<{ line: string; todayLine: string } | null>(null)
  const load = useCallback(() => {
    desk?.pcGetPrefs?.().then((i) => i && setInfo(i)).catch(() => {})
    desk?.pcToday?.().then((t) => t && setToday(t)).catch(() => {})
  }, [desk])
  useEffect(() => {
    load()
    // The live "Ben sees now" line.
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])
  const historyOn = !!info?.prefs.browserHistory
  useEffect(() => {
    if (!historyOn) return setWeb(null)
    desk?.pcBrowserMinutes?.().then((w) => setWeb(w), () => setWeb(null))
  }, [desk, historyOn])
  if (!desk?.pcGetPrefs) return <p className="hint small">Update the desktop app to get these settings.</p>
  if (!info) return <p className="hint small">Loading…</p>
  const p = info.prefs
  const set = async (patch: Partial<PcPrefs>) => {
    const next = await desk.pcSetPrefs?.(patch)
    if (next) setInfo({ ...info, prefs: next })
  }
  const list = (v: string[]) => v.join(', ')
  const read = (v: string) => v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  return (
    <div className="pc-panel">
      <p className="hint small">
        Everything below stays on this PC. Ben only gets the day's totals, and only if you turn on "Share totals with Ben". {info.windows ? '' : 'Most sensors work on Windows only.'}
      </p>
      {p.activeApp && (
        <p className="pc-live" role="status">
          👁 Ben sees now: <b>{info.now ? info.now.label : '…'}</b>
          {info.now ? ` (${info.now.kind === 'distract' ? 'distracting' : info.now.kind === 'work' ? 'work' : 'neutral'})` : ''}
        </p>
      )}
      <h4 className="pc-h">Sensors</h4>
      <Row title="Away and breaks" hint="Seconds since your last mouse or key press. Used for your bedtime, break reminders and focus quality.">
        <Switch label="Away and breaks" on={p.idle} onChange={(v) => void set({ idle: v })} />
      </Row>
      <Row title="Copied text with a date" hint="Only short text with a date or time in it (never passwords, codes, links or long text), for “save this?” on the island.">
        <Switch label="Copied text" on={p.clipboard} onChange={(v) => void set({ clipboard: v })} />
      </Row>
      <Row title="Calls (mic or camera in use)" hint="From Windows' own privacy log: only yes or no, never sound or video. Set what the island does in a call under Desktop & island." />
      <Row title="The app in front" hint="Which program you're using (just its name), to tell work from distraction during focus. Off until you turn it on. A 👁 shows on this page while it's on.">
        <Switch label="The app in front" on={p.activeApp} onChange={(v) => void set({ activeApp: v, ...(v ? {} : { titles: false }) })} />
      </Row>
      <Row title="Window titles too" hint="Tells YouTube from Google Docs inside a browser. Titles are checked on this PC and never stored." disabled={!p.activeApp}>
        <Switch label="Window titles" on={p.titles} disabled={!p.activeApp} onChange={(v) => void set({ titles: v })} />
      </Row>
      <Row title="Keep today's app totals" hint={today?.line ? `Today so far: ${today.line}` : 'Minutes per app per day, in a file on this PC.'} disabled={!p.activeApp}>
        <Switch label="Keep app totals" on={p.history} disabled={!p.activeApp} onChange={(v) => void set({ history: v })} />
      </Row>
      <Row title="Share totals with Ben" hint="Only the day's top apps and minutes go into Ben's evening review. Never titles, never the minute-by-minute log." disabled={!p.history}>
        <Switch label="Share totals" on={p.shareTotals} disabled={!p.history} onChange={(v) => void set({ shareTotals: v })} />
      </Row>
      <Row
        title="Distraction minutes from browser history"
        hint={
          p.browserHistory
            ? web
              ? `${[web.line, web.todayLine].filter(Boolean).join('; ') || 'Nothing on your sites list yet.'} Only minutes per site from the Sites list below; never full addresses.`
              : 'Reading…'
            : "Counts minutes on the sites in your Sites list below from Chrome, Edge or Brave history (a temporary copy, deleted right away). Only site names and minutes; never full addresses. Ben gets one line for the evening review, like “2 h on YouTube yesterday”."
        }
      >
        <Switch label="Browser history minutes" on={p.browserHistory} disabled={!desk.pcBrowserMinutes} onChange={(v) => void set({ browserHistory: v })} />
      </Row>
      <div className="row">
        <button
          className="btn small ghost"
          onClick={async () => {
            if (await act(() => desk.pcClear!(), 'App history deleted from this PC')) load()
          }}
        >
          Delete app history
        </button>
      </div>

      <h4 className="pc-h">Work and distraction</h4>
      <p className="hint small">Program names (like code, steam) or site words (like youtube). Your work list wins. "It's for this" on the island adds to it.</p>
      <label className="pc-list">
        <span>Work</span>
        <input defaultValue={list(p.work)} onBlur={(e) => void set({ work: read(e.target.value) })} />
      </label>
      <label className="pc-list">
        <span>Distracting</span>
        <input defaultValue={list(p.distract)} onBlur={(e) => void set({ distract: read(e.target.value) })} />
      </label>

      <h4 className="pc-h">During focus</h4>
      <Row title="Hold Life System's notifications" hint="Your own reminders still come; the rest waits until the timer ends.">
        <Switch label="Hold notifications" on={p.holdNotifs} onChange={(v) => void set({ holdNotifs: v })} />
      </Row>
      <Row title="Windows Do Not Disturb" hint="Windows has no switch apps may flip, so here's the way to it: turn it on (or set it to come on with focus sessions).">
        <button className="btn small" onClick={() => void desk.pcDnd?.()}>
          Open Do Not Disturb
        </button>
      </Row>
      <Row title="Keep distracting sites away" hint="With the browser helper (below): during a focus timer these sites show “after the block” instead.">
        <Switch label="Block sites during focus" on={p.blockSites} onChange={(v) => void set({ blockSites: v })} />
      </Row>
      {info.siteServer && <p className="hint warn-text">⚠ {info.siteServer}</p>}
      <label className="pc-list">
        <span>Sites</span>
        <input defaultValue={list(p.sites)} onBlur={(e) => void set({ sites: read(e.target.value) })} />
      </label>
      <details className="pc-setup">
        <summary>Set up the browser helper (Chrome, Edge, Brave)</summary>
        <ol>
          <li>
            <button className="btn small ghost" onClick={async () => (await desk.pcExtensionFolder?.()) || void act(async () => null, 'The helper folder comes with the next desktop update')}>
              Open the helper folder
            </button>
          </li>
          <li>
            In the browser go to <code>chrome://extensions</code> (or <code>edge://extensions</code>), turn on Developer mode, press <b>Load unpacked</b> and pick that folder.
          </li>
          <li>
            Open the helper's options and paste this code: <code className="pc-token">{info.token}</code>{' '}
            <button className="btn small ghost" onClick={() => void navigator.clipboard.writeText(info.token).then(() => act(async () => true, 'Copied'))}>
              Copy
            </button>
          </li>
        </ol>
        <p className="hint small">It only asks this PC (127.0.0.1:{info.port}) whether a focus timer runs. Nothing goes online.</p>
      </details>

      <h4 className="pc-h">Shortcuts</h4>
      <p className="hint small">
        <b>Alt+Shift+N</b> add a task from anywhere · <b>Alt+Shift+B</b> talk to Ben (press again to send) · right-click the taskbar icon: Start 25-min focus, Talk to Ben, Capture a task.
      </p>
    </div>
  )
}
