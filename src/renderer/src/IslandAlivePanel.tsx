// Settings → Desktop island → Alive island: the Lively preset (and Back to
// Calm, which puts back exactly what you had), a switch per kind of alive
// card, and the game counter. Logic: core/islandAlive.ts, core/gaming.ts.
import { useEffect, useState } from 'react'
import { ALIVE_HINT, ALIVE_KINDS, ALIVE_LABEL, type AlivePrefs, type PresetState } from '@core/islandAlive'
import { timeText, type GamingPrefs } from '@core/gaming'
import { ALIVE_EVENT, alivePrefs, aliveAct, presetNow, setAlivePrefs } from './islandAliveFeed'
import { GAMING_EVENT, gamingPrefs, gamingSensorOn, setGamingPrefs, turnOnSensor } from './gamingFeed'
import { Row, Switch } from './settingsUi'

export function IslandAlivePanel() {
  const [prefs, setPrefs] = useState<AlivePrefs>(alivePrefs)
  const [preset, setPreset] = useState<PresetState>(presetNow)
  const [msg, setMsg] = useState('')
  const [game, setGame] = useState<GamingPrefs>(gamingPrefs)
  const [sensor, setSensor] = useState(gamingSensorOn)
  const [prog, setProg] = useState('')
  useEffect(() => {
    const on = () => {
      setPrefs(alivePrefs())
      setPreset(presetNow())
      setGame(gamingPrefs())
      setSensor(gamingSensorOn())
    }
    window.addEventListener(ALIVE_EVENT, on)
    window.addEventListener(GAMING_EVENT, on)
    return () => {
      window.removeEventListener(ALIVE_EVENT, on)
      window.removeEventListener(GAMING_EVENT, on)
    }
  }, [])
  const run = async (op: 'balanced' | 'lively' | 'calm') => {
    setMsg(await aliveAct({ kind: 'alive', op }))
    setPreset(presetNow())
    setPrefs(alivePrefs())
  }
  const saveGame = (p: Partial<GamingPrefs>) => setGame(setGamingPrefs(p))
  const limit = (v: string) => (v.trim() === '' ? null : Math.max(10, Math.round(Number(v) * 60)) || null)
  return (
    <>
      <h3 className="is-sec">Alive island</h3>
      <Row
        title="Lively preset"
        hint={preset.active ? `On (${preset.choice === 'lively' ? 'Lively' : 'Balanced'}): sounds Full, Ben's live coach, win music, normal pushes, morning and evening cards, and every card below. "Back to Calm" puts back exactly what you had.` : 'One tap sets Balanced or Lively, Full island sounds, the live coach, win music, normal pushes, the morning and evening cards and every card below. You can undo it exactly.'}
      >
        {preset.active ? (
          <button className="btn" onClick={() => void run('calm')}>
            Back to Calm
          </button>
        ) : (
          <span className="is-hide-btns">
            <button className="btn primary" onClick={() => void run('balanced')}>
              Balanced
            </button>
            <button className="btn" onClick={() => void run('lively')}>
              Lively
            </button>
          </span>
        )}
      </Row>
      {msg && <p className="muted bk-note" role="status">{msg}</p>}
      <div className="is-kinds">
        {ALIVE_KINDS.map((k) => (
          <label key={k} className="is-kind" title={ALIVE_HINT[k]}>
            <span>{ALIVE_LABEL[k]}</span>
            <Switch label={ALIVE_LABEL[k]} on={prefs[k]} onChange={(v) => setPrefs(setAlivePrefs({ [k]: v }))} />
          </label>
        ))}
      </div>
      <p className="muted bk-note">At most one calm peek every 10 minutes (the rest join it). Never in a meeting, in quiet hours or over another card.</p>

      <h3 className="is-sec">Game time</h3>
      <Row title="Count my game time" hint="Fortnite, Valorant, CS2, League, Minecraft and the programs you add. It reads only the name of the program in front, never a window title or a screenshot, and the minutes stay on this PC.">
        <Switch label="Count my game time" on={game.on} onChange={(v) => saveGame({ on: v })} />
      </Row>
      {game.on && !sensor && (
        <Row title="This needs one switch" hint="Counting uses the active-app sensor ('Let Ben see what I'm doing'). It is off now. Turning it on also lets Ben react to what you do on this PC. Everything stays on this PC.">
          <button className="btn primary" onClick={() => void turnOnSensor().then(() => setSensor(gamingSensorOn()))}>
            Turn it on
          </button>
        </Row>
      )}
      {game.on && (
        <>
          <Row title="Daily limit (hours)" hint="Optional. A gentle note at 80% and at 100% (Gentle pushes only say the 100% one). It never closes or blocks a game.">
            <input className="input" type="number" min={0.5} max={24} step={0.5} aria-label="Daily game limit in hours" value={game.dayLimitMin ? game.dayLimitMin / 60 : ''} placeholder="none" onChange={(e) => saveGame({ dayLimitMin: limit(e.target.value) })} />
          </Row>
          <Row title="Weekly limit (hours)" hint={game.weekLimitMin ? `The week runs Monday to Sunday. Now ${timeText(game.weekLimitMin)} a week.` : 'Optional. The week runs Monday to Sunday.'}>
            <input className="input" type="number" min={1} max={168} step={1} aria-label="Weekly game limit in hours" value={game.weekLimitMin ? game.weekLimitMin / 60 : ''} placeholder="none" onChange={(e) => saveGame({ weekLimitMin: limit(e.target.value) })} />
          </Row>
          <Row title="Other games" hint="Program names, like hades2 or eldenring (no .exe needed). Launchers like Steam and Epic count only while a game runs.">
            <span className="is-hide-btns">
              <input className="input" aria-label="Add a game program name" value={prog} placeholder="program name" onChange={(e) => setProg(e.target.value)} />
              <button
                className="btn"
                onClick={() => {
                  if (prog.trim()) saveGame({ extra: [...game.extra, prog] })
                  setProg('')
                }}
              >
                Add
              </button>
            </span>
          </Row>
          {game.extra.length > 0 && (
            <div className="is-kinds">
              {game.extra.map((x) => (
                <label key={x} className="is-kind">
                  <span>{x}</span>
                  <button className="btn" aria-label={`Remove ${x}`} onClick={() => saveGame({ extra: game.extra.filter((y) => y !== x) })}>
                    Remove
                  </button>
                </label>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
