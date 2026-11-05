// Settings → look (LT11: split out of pages/Settings.tsx; the state lives in useSettingsState).
import { useState } from 'react'
import { LayoutEditor } from '../LayoutEditor'
import { life } from '../bridge'
import { Row, Saved, Segmented, Switch } from '../settingsUi'
import { Icon } from '../Icon'
import { soundCoin, soundFanfare, soundMechanicalClick, soundSystemOracle, soundWarning } from '../sound'
import type { SettingsState } from './useSettingsState'

export function LookSection({ s }: { s: SettingsState }) {
  const { ui, setUi, lookFlash, lookSaved } = s
  return (
        <>
      <section className="panel">
        <header className="panel-head">
          <h2>
            <Icon name="sun" /> Appearance
          </h2>
          <Saved show={lookFlash} />
        </header>
        <Row title="Theme" hint="Dark, light, or follow Windows">
          <Segmented label="Theme" value={ui.theme} options={[['dark', 'Dark'], ['light', 'Light'], ['system', 'Like Windows']]} onChange={(v) => (setUi({ theme: v }), lookSaved())} />
        </Row>
        <Row title="Text size" hint="Ctrl + / Ctrl − also work, Ctrl 0 resets">
          <Segmented label="Text size" value={ui.textSize ?? 100} options={[[90, 'Small'], [100, 'Normal'], [110, '110%'], [125, '125%']]} onChange={(v) => (setUi({ textSize: v }), lookSaved())} />
        </Row>
        <Row title="Your name" hint="For the greeting on Today">
          <input className="sx-input" value={ui.name} maxLength={30} placeholder="e.g. Victor" onChange={(e) => setUi({ name: e.target.value })} onBlur={() => lookSaved()} aria-label="Your name" />
        </Row>
        <Row title="Calm mode" hint="Lighter and faster: effects play once, no glass blur">
          <Switch label="Calm mode" on={ui.calm !== false} onChange={(v) => (setUi({ calm: v }), lookSaved())} />
        </Row>
        {!window.desktop && <IslandToggle onSaved={lookSaved} />}
        <Row title="Sounds" hint="Short sounds for done tasks, points and alerts">
          <Switch label="Sounds" on={!!ui.sound} onChange={(v) => (setUi({ sound: v }), lookSaved())} />
        </Row>
        {ui.sound && (
          <Row title="Volume" hint={`${ui.volume ?? 80}%`}>
            <input className="sx-range" type="range" min={0} max={100} step={5} value={ui.volume ?? 80} onChange={(e) => setUi({ volume: Number(e.target.value) })} onMouseUp={() => (soundCoin(), lookSaved())} aria-label="Volume" />
          </Row>
        )}
        {ui.sound && (
          <Row title="Try them" hint="Hear how they sound">
            <div className="sx-try">
              <button type="button" className="btn small ghost" onClick={() => soundSystemOracle()}>Ben</button>
              <button type="button" className="btn small ghost" onClick={() => soundCoin()}>Points</button>
              <button type="button" className="btn small ghost" onClick={() => soundMechanicalClick()}>Click</button>
              <button type="button" className="btn small ghost" onClick={() => soundFanfare()}>Level up</button>
              <button type="button" className="btn small ghost" onClick={() => soundWarning()}>Alert</button>
            </div>
          </Row>
        )}
      </section>
      <LayoutEditor />
        </>
  )
}

/** The focus island on/off (its other options live in its own ⚙). */
function IslandToggle({ onSaved }: { onSaved?: () => void }) {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem('ls.island') || '{}').on !== false
    } catch {
      return true
    }
  }
  const [on, setOn] = useState(read)
  const set = (v: boolean) => {
    try {
      localStorage.setItem('ls.island', JSON.stringify({ ...JSON.parse(localStorage.getItem('ls.island') || '{}'), on: v }))
    } catch {
      /* private window */
    }
    setOn(v)
    window.dispatchEvent(new Event('life-island-prefs'))
    onSaved?.()
  }
  return (
    <Row title="Focus island" hint="A live timer pill at the top of every page; ⚙ inside it to customize">
      <Switch label="Focus island" on={on} onChange={set} />
    </Row>
  )
}
