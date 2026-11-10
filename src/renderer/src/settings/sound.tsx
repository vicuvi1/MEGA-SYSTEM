// Settings → Sound: the main switch and volume, each kind of sound on or off
// with a preview, the theme, the focus background, the last-10-seconds tick
// and the phone buzz. Saved on this device (uiPrefs → sounds).
import { useEffect, useRef, useState } from 'react'
import { SOUND_CATEGORIES, SOUND_THEMES, type BedKind, type SoundCategory, type SoundName, type SoundPrefs, type SoundThemeId } from '@core/sounds'
import { Row, Saved, Segmented, Switch, useSaved } from '../settingsUi'
import { Icon } from '../Icon'
import { useUiPrefs } from '../uiPrefs'
import { bedPlaying, play, playBodyReminder, playCard, previewMoment, setBedVolume, soundPrefs, startBed, stopBed, whyQuiet } from '../soundKit'
import { reminderGain } from '@core/islandReminderSound'
import { CARD_SOUND_KEYS, CARD_SOUND_LABEL, cardSoundName, type CardSoundKey } from '@core/islandCardSound'
import { startIslandSoundTest } from '../IslandFeed'
import { ISLAND_SOUND_LABEL, ISLAND_SOUND_MODES, type IslandSoundMode, type IslandSoundName } from '@core/islandSound'
import { soundCheck } from '../islandSounds'
import { DEFAULT_MOMENTS, MOMENTS, MOMENT_SOUNDS, type MomentId, type MomentSound } from '@core/soundMoments'
import { Select } from '../Select'

/** What each kind's preview plays. */
const PREVIEW: Record<SoundCategory, SoundName[]> = { success: ['habit', 'mustDo', 'water', 'levelUp'], money: ['coin', 'reward'], focus: ['focusStart', 'focusEnd'], alerts: ['remind', 'error'], ui: ['tick', 'click'] }
const LABEL: Partial<Record<SoundName, string>> = { habit: 'Habit', mustDo: 'Must-do', water: 'Water', levelUp: 'Level up', coin: 'Points', reward: 'Reward', focusStart: 'Start', focusEnd: 'Gong', remind: 'Reminder', error: 'Error', tick: 'Tick', click: 'Click' }

/** Each switch's ▶: the sound a typical notification of that kind plays. */
const KEY_SOUND: Record<CardSoundKey, SoundName> = Object.fromEntries(
  CARD_SOUND_KEYS.map((k) => [k, cardSoundName(({ water: { kind: 'water', id: 'water:t' }, eyes: { kind: 'eyes', id: 'eyes:t' }, move: { kind: 'move', id: 'move:t' }, screen: { kind: 'move', id: 'coach:break:t' }, ben: { kind: 'ben', id: 'ben:t' }, remind: { kind: 'remind', id: 'r:t' }, timer: { kind: 'over', id: 'o:t' }, meeting: { kind: 'block', id: 'm:t', meeting: true }, plan: { kind: 'block', id: 'b:t' }, bed: { kind: 'bed', id: 'bed:t' }, other: { kind: 'suggest', id: 's:t' } } as const)[k])])
) as Record<CardSoundKey, SoundName>

export function SoundSection() {
  const [ui, setUi] = useUiPrefs()
  const [flash, saved] = useSaved()
  const p = soundPrefs()
  const set = (x: Partial<SoundPrefs>) => (setUi({ sounds: { ...p, ...x } }), saved())
  const [trying, setTrying] = useState<BedKind | null>(null)
  useEffect(() => () => void (trying && stopBed(0.3)), [trying])
  const tryBed = (k: BedKind) => {
    if (bedPlaying() === k) return stopBed(0.4), setTrying(null)
    startBed(k, { preview: true })
    setTrying(k)
    window.setTimeout(() => (bedPlaying() === k && stopBed(), setTrying((x) => (x === k ? null : x))), 5000)
  }
  // Test island sound: a test card through the real path; the island log says what happened.
  const [islandTest, setIslandTest] = useState<string | null>(null)
  const testIsland = async () => {
    const d = window.desktop
    if (!d?.islandGetLog) {
      const r = await playCard('remind', reminderGain(p.reminders.volume), { preview: true })
      return setIslandTest(r === 'played' ? 'Played here. The island itself runs in the desktop app.' : `No sound: ${r}`)
    }
    setIslandTest('waiting')
    const id = startIslandSoundTest()
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => window.setTimeout(r, 500))
      const line = (await d.islandGetLog().catch(() => [])).filter((l) => l.line.includes(id)).pop()
      if (line) return setIslandTest(line.line.replace(/^sound: /, '').replace(id + ': ', ''))
    }
    setIslandTest('The island did not answer. Is it on (Settings → Desktop island)? Look in Settings → Island log.')
  }
  const [checking, setChecking] = useState<IslandSoundName | null>(null)
  const stopCheck = useRef<(() => void) | null>(null)
  useEffect(() => () => stopCheck.current?.(), [])
  const runCheck = () => {
    stopCheck.current?.()
    if (checking) return setChecking(null)
    stopCheck.current = soundCheck((n) => setChecking(n))
  }
  const why = ui.sound ? whyQuiet() : null
  const step = useRef(0)
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="bell" /> Sound
        </h2>
        <Saved show={flash} />
      </header>
      <Row title="Sounds" hint={why === 'quiet hours' ? 'Quiet right now: quiet hours (Notifications)' : why === 'in a meeting' ? 'Quiet right now: a meeting is on' : 'Short sounds for done things, points, focus and alerts'}>
        <Switch label="Sounds" on={!!ui.sound} onChange={(v) => (setUi({ sound: v }), saved())} />
      </Row>
      {ui.sound && (
        <>
          <Row title="Volume" hint={`${ui.volume ?? 80}%`}>
            <input className="sx-range" type="range" min={0} max={100} step={5} value={ui.volume ?? 80} onChange={(e) => setUi({ volume: Number(e.target.value) })} onPointerUp={() => (play('coin', { preview: true }), saved())} aria-label="Volume" />
          </Row>
          <Row title="Theme" hint="Soft, Arcade (8-bit blips) or Glass (bells)">
            <Segmented<SoundThemeId>
              label="Sound theme"
              value={p.theme}
              options={Object.values(SOUND_THEMES).map((t) => [t.id, t.label])}
              onChange={(v) => {
                set({ theme: v })
                play('mustDo', { preview: true, theme: v })
                window.setTimeout(() => play('coin', { preview: true, theme: v }), 420)
              }}
            />
          </Row>
          {SOUND_CATEGORIES.map((c) => (
            <Row key={c.id} title={c.label} hint={c.hint}>
              <div className="sx-try">
                {PREVIEW[c.id].map((n) => (
                  <button key={n} type="button" className="btn small ghost" onClick={() => play(n, { preview: true, step: n === 'habit' ? step.current++ % 6 : 0 })}>
                    {LABEL[n] ?? n}
                  </button>
                ))}
                <Switch label={c.label} on={p.cats[c.id]} onChange={(v) => set({ cats: { ...p.cats, [c.id]: v } })} />
              </div>
            </Row>
          ))}
          <div className="sx-moments" role="group" aria-label="Which sound for what">
            <h3>Which sound for what</h3>
            <p className="hint">Each thing has its own sound, so you know what it is without looking. Telegram keeps its own sound.</p>
            {MOMENTS.map((m) => {
              const cur = p.moments[m.id]
              const pickMoment = (id: MomentId, v: MomentSound) => {
                set({ moments: { ...p.moments, [id]: v } })
                previewMoment(id, v)
              }
              return (
                <div key={m.id} className="sx-moment" data-moment={m.id}>
                  <span className="sx-moment-name">
                    <i aria-hidden>{m.icon}</i> {m.label}
                  </span>
                  <Select aria-label={`Sound for ${m.label}`} value={cur} onChange={(e) => pickMoment(m.id, e.target.value as MomentSound)}>
                    {MOMENT_SOUNDS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                        {o.id === DEFAULT_MOMENTS[m.id] ? ' (default)' : ''}
                      </option>
                    ))}
                  </Select>
                  <button type="button" className="btn small ghost sx-play" aria-label={`Play the sound for ${m.label}`} disabled={cur === 'none'} onClick={() => previewMoment(m.id)}>
                    ▶
                  </button>
                </div>
              )
            })}
          </div>
          <Row title="Focus background" hint="Plays softly while a focus timer runs; fades in and out">
            <div className="sx-try">
              <Segmented<BedKind> label="Focus background" value={p.bed} options={[['off', 'Off'], ['brown', 'Brown noise'], ['rain', 'Rain'], ['tick', 'Soft tick'], ['white', 'White noise']]} onChange={(v) => set({ bed: v })} />
              {p.bed !== 'off' && (
                <button type="button" className="btn small ghost" onClick={() => tryBed(p.bed)}>
                  {trying === p.bed ? 'Stop' : 'Try'}
                </button>
              )}
            </div>
          </Row>
          {p.bed !== 'off' && (
            <Row title="Background volume" hint={`${p.bedVolume}%`}>
              <input className="sx-range" type="range" min={5} max={100} step={5} value={p.bedVolume} onChange={(e) => (set({ bedVolume: Number(e.target.value) }), setBedVolume(Number(e.target.value)))} aria-label="Background volume" />
            </Row>
          )}
          <Row title="Island sounds" hint="The desktop island's own soft sounds: open and close, pages, taps, done, alerts. Much quieter while music plays, silent in a call">
            <div className="sx-try">
              <Segmented<IslandSoundMode> label="Island sounds" value={p.island} options={ISLAND_SOUND_MODES} onChange={(v) => set({ island: v })} />
              <button type="button" className="btn small ghost" onClick={runCheck} disabled={p.island === 'off'} aria-live="polite">
                {checking ? `Playing: ${ISLAND_SOUND_LABEL[checking]}` : 'Sound check'}
              </button>
            </div>
          </Row>
          {p.island !== 'off' && (
            <Row title="Island quiet during focus" hint="No island sounds while a focus timer runs (errors still sound)">
              <Switch label="Island quiet during focus" on={p.islandFocusQuiet} onChange={(v) => set({ islandFocusQuiet: v })} />
            </Row>
          )}
          <Row title="Last 10 seconds" hint="A very quiet tick each second before the gong (never in a meeting)">
            <Switch label="Last 10 seconds" on={p.lastTen} onChange={(v) => set({ lastTen: v })} />
          </Row>
        </>
      )}
      <div className="sx-moments" role="group" aria-label="Island reminders" data-reminder-sounds>
        <h3>Island reminders</h3>
        <p className="hint">Every notification that drops down on the desktop island plays its sound once. Dots that wait stay silent. Never in a call, quiet hours or after bed. Works even with Sounds off above.</p>
        <div className="sx-test-island">
          <button type="button" className="btn small" data-test-island-sound onClick={() => void testIsland()} disabled={islandTest === 'waiting'}>
            🔔 Test island sound
          </button>
          {islandTest && islandTest !== 'waiting' && <small data-test-island-result>{islandTest}</small>}
          {islandTest === 'waiting' && <small>Showing a test card on the island…</small>}
        </div>
        {CARD_SOUND_KEYS.map((k) => (
          <div key={k} className="sx-moment" data-reminder={k}>
            <span className="sx-moment-name">{CARD_SOUND_LABEL[k]}</span>
            <Switch label={`Island reminder sound: ${CARD_SOUND_LABEL[k]}`} on={p.reminders.on[k]} onChange={(v) => set({ reminders: { ...p.reminders, on: { ...p.reminders.on, [k]: v } } })} />
            <button type="button" className="btn small ghost sx-play" aria-label={`Test the ${CARD_SOUND_LABEL[k]} sound`} disabled={!p.reminders.on[k] || p.reminders.volume <= 0} onClick={() => void playCard(KEY_SOUND[k], reminderGain(p.reminders.volume), { preview: true })}>
              ▶
            </button>
          </div>
        ))}
        <Row title="Reminder volume" hint={`${p.reminders.volume}%`}>
          <input className="sx-range" type="range" min={0} max={100} step={5} value={p.reminders.volume} onChange={(e) => set({ reminders: { ...p.reminders, volume: Number(e.target.value) } })} onPointerUp={() => playBodyReminder('water', soundPrefs().reminders.volume, { preview: true })} aria-label="Island reminder volume" />
        </Row>
      </div>
      <Row title="Phone buzz" hint="A short buzz with habits, must-dos and errors (phones only)">
        <Switch label="Phone buzz" on={p.haptics} onChange={(v) => set({ haptics: v })} />
      </Row>
    </section>
  )
}
