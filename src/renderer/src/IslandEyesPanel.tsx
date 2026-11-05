// Settings → Island eyes (EY1–EY6): every eye has its own switch and is off
// until you turn it on; the Pause; your private list; the caption model's
// download (progress, Cancel, Delete); and "What the eyes saw" (the last 50
// short lines, with Clear).
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_DENY, EYE_LABEL, pauseLabel, type EyesPrefs, type PauseChoice } from '@core/eyesGuard'
import type { EyesInfo, EyesModelStatus } from '../../shared/eyes'
import { Row, Saved, Segmented, Switch, useSaved } from './settingsUi'
import { barFill } from './motionKit'
import { useToast } from './ui'
import { onEyesState } from './eyesState'
import './islandEyes.css'

const mb = (n: number) => `${Math.max(0, Math.round(n / (1024 * 1024)))} MB`
const hm = (t: number) => new Date(t).toTimeString().slice(0, 5)

export function IslandEyesPanel() {
  const eyes = window.desktop?.eyes
  const toast = useToast()
  const [info, setInfo] = useState<EyesInfo | null>(null)
  const [deny, setDeny] = useState('')
  const [flash, saved] = useSaved()
  const load = useCallback(() => {
    eyes?.get().then((i) => {
      if (!i) return
      setInfo(i)
      setDeny(i.prefs.deny.join('\n'))
    }, () => {})
  }, [eyes])
  useEffect(() => {
    load()
    // Live: the model's progress, a pause from the island, what is being read.
    return onEyesState((s) => setInfo((cur) => (cur ? { ...cur, ...s } : cur)))
  }, [eyes, load])
  if (!eyes) return <p className="hint small">Update the desktop app to get the island eyes.</p>
  if (!info) return <p className="hint small">Loading…</p>
  const p = info.prefs
  const set = async (patch: Partial<EyesPrefs>) => {
    const next = await eyes.set(patch).catch(() => null)
    if (next) {
      setInfo(next)
      saved()
    }
  }
  const pause = async (c: PauseChoice) => {
    const s = await eyes.pause(c).catch(() => null)
    if (s) setInfo({ ...info, ...s })
  }
  const later = (what: 'read' | 'caption') => {
    toast(`Switch to the window you want read: ${what === 'read' ? 'reading' : 'a caption'} in 5 s`, 'good')
    setTimeout(async () => {
      const r = await (what === 'read' ? eyes.readScreen() : eyes.captionNow()).catch(() => ({ ok: false, said: 'Did not work' }))
      if (r.said) toast(r.said, r.ok ? 'good' : 'bad')
      load()
    }, 5000)
  }
  const m = info.model
  const now = Date.now()
  return (
    <div className="pc-panel eyes-panel">
      <div className="eyes-head">
        <p className="hint small">
          The island can read the window in front of you to suggest the right thing. Everything is off until you turn it on, and you choose each eye.
          Only a short line (120 characters at most) is kept, on this PC; no picture is ever saved or sent. Ben gets that line only if you turn on “Tell Ben”.
          {info.windows ? '' : ' The eyes work on Windows only.'}
        </p>
        <Saved show={flash} />
      </div>
      <Row title="Island eyes" hint="The main switch. Off: no eye looks, whatever the switches below say.">
        <Switch label="Island eyes" on={p.on} onChange={(v) => void set({ on: v })} />
      </Row>
      {p.on && (
        <Row title={info.pausedUntil ? pauseLabel(info.pausedUntil, now) : 'Pause the eyes'} hint="Also on the island (the eye) and in the tray menu.">
          {info.pausedUntil ? (
            <button className="btn small" onClick={() => void pause('resume')}>Resume</button>
          ) : (
            <span className="eyes-btns">
              <button className="btn small" onClick={() => void pause('1h')}>1 hour</button>
              <button className="btn small" onClick={() => void pause('tomorrow')}>Until tomorrow</button>
              <button className="btn small" onClick={() => void pause('forever')}>Until I resume</button>
            </span>
          )}
        </Row>
      )}

      <h4 className="pc-h">The eyes</h4>
      <Row disabled={!p.on} title="Read the window in front" hint="When you switch windows, its text is read once with Windows' own UI Automation (built in, nothing to download). At most one read every 20 s; about half a second of one CPU core each time, nothing in between.">
        <Switch label="Read the window in front" disabled={!p.on} on={p.read} onChange={(v) => void set({ read: v })} />
      </Row>
      <Row disabled={!p.on} title="Screen text when a window has little" hint="Some apps (games, video, pictures of text) give no text. Then the window is captured in memory and read with Windows' own OCR, once per window. The island's “Read screen” button works without this switch.">
        <Switch label="Screen text" disabled={!p.on} on={p.ocrAuto} onChange={(v) => void set({ ocrAuto: v })} />
      </Row>
      {p.on && info.windows && (
        <Row title="Try the screen reader" hint="Switch to another window within 5 seconds.">
          <button className="btn small" onClick={() => later('read')}>Read in 5 s</button>
        </Row>
      )}
      <Row disabled={!p.on} title="Short captions" hint={`A one-line description of the window, made on this PC by a small model (Florence-2, about ${mb(info.modelSize)}, downloaded once). It loads only for a caption and leaves memory after 2 idle minutes.`}>
        <Switch label="Short captions" disabled={!p.on || m.state !== 'ready'} on={p.caption && m.state === 'ready'} onChange={(v) => void set({ caption: v })} />
      </Row>
      <ModelRow m={m} size={info.modelSize} onDownload={() => void eyes.modelDownload().then(load, load)} onCancel={() => void eyes.modelCancel().then(load, load)} onDelete={() => void eyes.modelDelete().then(() => (set({ caption: false }), load()), load)} />
      {p.on && p.caption && m.state === 'ready' && (
        <>
          <Row title="A caption by itself" hint="Only while you're at the PC (not when it's idle or locked).">
            <Switch label="Captions by themselves" on={p.captionAuto} onChange={(v) => void set({ captionAuto: v })} />
          </Row>
          {p.captionAuto && (
            <Row title="How often">
              <Segmented label="Minutes between captions" value={p.captionEveryMin} options={[[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']]} onChange={(v) => void set({ captionEveryMin: v })} />
            </Row>
          )}
          <Row title="Try a caption" hint="Switch to another window within 5 seconds. The first one takes longer (the model loads).">
            <button className="btn small" onClick={() => later('caption')}>Caption in 5 s</button>
          </Row>
        </>
      )}

      <h4 className="pc-h">What the eyes are for</h4>
      <Row disabled={!p.on} title="Island suggestions" hint="“Looks like interview prep. Start a focus block for it?”, “Save this as a task?”. One at a time, like the other suggestions.">
        <Switch label="Island suggestions" disabled={!p.on} on={p.suggest} onChange={(v) => void set({ suggest: v })} />
      </Row>
      <Row disabled={!p.on} title="Tell Ben" hint="Ben gets the last short line (“now: reading … in Chrome”) for his answers. It is synced with your data; nothing else is.">
        <Switch label="Tell Ben" disabled={!p.on} on={p.shareBen} onChange={(v) => void set({ shareBen: v })} />
      </Row>

      <h4 className="pc-h">Never read</h4>
      <p className="hint small">One rule per line; a rule matches the app's name or the window's title, and “a|b” means either. Your own windows (Life System) are never read.</p>
      <textarea className="eyes-deny" rows={6} value={deny} onChange={(e) => setDeny(e.target.value)} aria-label="Apps and words never read" spellCheck={false} />
      <span className="eyes-btns">
        <button className="btn small" onClick={() => void set({ deny: deny.split('\n') })} disabled={deny === p.deny.join('\n')}>Save the list</button>
        <button className="btn small ghost" onClick={() => (setDeny(DEFAULT_DENY.join('\n')), void set({ deny: DEFAULT_DENY }))}>Back to the default list</button>
      </span>

      <h4 className="pc-h">What the eyes saw</h4>
      {info.log.length ? (
        <>
          <ul className="eyes-log">
            {info.log.map((e, i) => (
              <li key={`${e.at}:${i}`} className={e.outcome === 'kept' ? '' : 'skip'}>
                <time>{hm(e.at)}</time>
                <span className="eyes-kind">{EYE_LABEL[e.kind]}</span>
                {e.app && <b>{e.app}</b>}
                <span>{e.summary}</span>
              </li>
            ))}
          </ul>
          <button className="btn small ghost" onClick={() => void eyes.clearLog().then(load)}>Clear</button>
        </>
      ) : (
        <p className="hint small">Nothing yet. The last 50 looks show here, the skipped ones too.</p>
      )}
    </div>
  )
}

function ModelRow({ m, size, onDownload, onCancel, onDelete }: { m: EyesModelStatus; size: number; onDownload: () => void; onCancel: () => void; onDelete: () => void }) {
  if (m.state === 'downloading')
    return (
      <div className="eyes-model" role="status">
        <div className="pbar eyes-bar" aria-label="Download progress">
          <i style={barFill(m.total ? m.got / m.total : 0)} />
        </div>
        <small>
          Downloading the caption model: {mb(m.got)} of {mb(m.total)}
        </small>
        <button className="btn small ghost" onClick={onCancel}>Cancel</button>
      </div>
    )
  if (m.state === 'ready')
    return (
      <div className="eyes-model">
        <small>The caption model is on this PC ({mb(m.onDisk)}).</small>
        <button className="btn small ghost" onClick={onDelete}>Delete it</button>
      </div>
    )
  return (
    <div className="eyes-model">
      <small>{m.state === 'error' ? `The download stopped: ${m.error ?? 'try again'}.` : `Captions need a one-time download (about ${mb(size)}) into this app's folder.`}{m.onDisk > 0 ? ` ${mb(m.onDisk)} already here.` : ''}</small>
      <button className="btn small" onClick={onDownload}>{m.state === 'error' || m.onDisk > 0 ? 'Go on downloading' : 'Download'}</button>
      {m.onDisk > 0 && <button className="btn small ghost" onClick={onDelete}>Delete</button>}
    </div>
  )
}
