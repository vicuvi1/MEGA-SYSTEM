// Settings → Ben → Focus boost: the push ladder, "why I'm stalling", session
// goals and verdicts (with the week's finished-work stats), the morning
// countdown, Dojo mode, launch kits per kind of block, and win music.
import { useEffect, useState } from 'react'
import { DOJO_AMBIENTS, DOJO_SCENES } from '@core/dojo'
import { KIT_KINDS, KIT_LIMITS, KITS_MAX, kitSummary, newKit, type LaunchKit } from '@core/launchKit'
import { learnLine, statsLine, verdictStats } from '@core/sessionGoal'
import { stallLine } from '@core/stallFix'
import { WIN_KINDS, type Track } from '@core/winMoments'
import { cleanMusicKit, type MusicKit } from '@core/music'
import type { BoostLog } from '@core/focusBoost'
import { dayKey } from '@core/dates'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { Row, Segmented, Switch } from '../settingsUi'
import { Select } from '../Select'
import { useToast } from '../ui'
import { previewMoment } from '../soundKit'
import { openDojo, useBoost } from './boostBus'
import { openKit } from './launch'
import { playWin } from './wins'
import './boost.css'

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

function useMusicList(): MusicKit | null {
  const [m, setM] = useState<MusicKit | null>(null)
  useEffect(() => {
    void (life as any).islandKit?.get?.().then((k: any) => setM(cleanMusicKit(k?.music))).catch(() => {})
  }, [])
  return m
}

/** Stations and starred tracks to pick from (address → name). */
const musicChoices = (m: MusicKit | null): Track[] => [...(m?.stations ?? []).map((s) => ({ url: s.url, name: s.name })), ...(m?.favs ?? []).map((f) => ({ url: f.url, name: `★ ${f.title}` }))]

export function FocusBoostPanel() {
  const [p, save] = useBoost()
  const [log, setLog] = useState<BoostLog | null>(null)
  useEffect(() => {
    void life.boost?.log().then(setLog).catch(() => {})
  }, [])
  if (!life.boost) return null
  const today = dayKey(new Date())
  const stats = log ? verdictStats(log.sessions, today) : null
  const learned = stats ? learnLine(stats) : null
  const stalls = log ? stallLine(log.stalls, today) : null
  const L = p.ladder
  return (
    <section className="panel fbs-panel" data-boost="settings">
      <header className="panel-head">
        <h2>
          <Icon name="bolt" /> Focus boost
        </h2>
      </header>
      <div className="fbs-grid">
        <h3 className="lf-sub">Push ladder</h3>
        <Row title="Push harder when I drift or don't start" hint="Three steps, each with its own sound. It resets the moment you start. It follows each area's push level (Pushes tab: Soft stops at step 2) and stays quiet in quiet hours and meetings.">
          <Switch on={L.on} onChange={(on) => void save({ ladder: { ...L, on } })} label="Push ladder" />
        </Row>
        <div className="fbs-ladder" aria-label="The three steps">
          {([['push1', '1 · Soft chime', 'A gentle card: back to it?'], ['push2', '2 · Sharp alarm', 'A firmer card a few minutes later'], ['push3', '3 · Ben calls you out', 'His voice line, plus Telegram with a stake']] as const).map(([id, t, h]) => (
            <button key={id} type="button" className="fbs-step" onClick={() => previewMoment(id)} title="Hear it">
              <b>▶ {t}</b>
              <small>{h}</small>
            </button>
          ))}
        </div>
        <Row title="Step 3: Ben says it out loud" hint="This device's own voice, never in a meeting.">
          <Switch on={L.voice} onChange={(voice) => void save({ ladder: { ...L, voice } })} label="Voice line" />
        </Row>
        <Row title="Step 3: a Telegram message too">
          <Switch on={L.telegram} onChange={(telegram) => void save({ ladder: { ...L, telegram } })} label="Telegram at step 3" />
        </Row>
        <Row title="Offer a stake with it" hint="Ben's usual deal (25 min by a time, 50 points). It's only made if you tap it, and it settles by your focus log.">
          <Switch on={L.stake} onChange={(stake) => void save({ ladder: { ...L, stake } })} label="Stake at step 3" />
        </Row>

        <h3 className="lf-sub">Why I'm stalling</h3>
        <Row title="Ask why when I snooze or skip a block" hint="Tired, unclear, too big, boring or scared: each gets its own fix right away (also on Telegram).">
          <Switch on={p.stall} onChange={(stall) => void save({ stall })} label="Ask why I'm stalling" />
        </Row>
        {stalls && <p className="hint block">{stalls}</p>}

        <h3 className="lf-sub">Session goal and honest verdict</h3>
        <Row title="Ask for a one-line goal when a timer starts, and Done / Half / Not at the end" hint="Your verdict never changes points; it shows finished work and teaches Ben which sessions you finish.">
          <Switch on={p.goals} onChange={(goals) => void save({ goals })} label="Session goals" />
        </Row>
        {stats && <p className="hint block" data-boost="stats">This week: {statsLine(stats)}{learned ? ` · ${learned.replace(/^Sessions he finishes \(7 days, done = 100%, half = 50%\): /, 'you finish ')}` : ''}</p>}

        <h3 className="lf-sub">Morning launch countdown</h3>
        <Row title="After the wake-up (or the morning brief), run water → push-ups → the first must-do within 2 minutes" hint="On the desktop island. Water and push-ups are logged only when you tap them.">
          <Switch on={p.morning.on} onChange={(on) => void save({ morning: { ...p.morning, on } })} label="Morning countdown" />
        </Row>
        <Row title="Push-ups">
          <Segmented value={p.morning.pushups} options={[[5, '5'], [10, '10'], [15, '15'], [20, '20']]} onChange={(pushups) => void save({ morning: { ...p.morning, pushups } })} label="Push-ups" />
        </Row>
        <Row title="Water glass">
          <Segmented value={p.morning.waterMl} options={[[200, '200 ml'], [250, '250 ml'], [330, '330 ml'], [500, '500 ml']]} onChange={(waterMl) => void save({ morning: { ...p.morning, waterMl } })} label="Water glass" />
        </Row>

        <h3 className="lf-sub">Dojo mode</h3>
        <Row title="Scene">
          <Segmented value={p.dojo.scene} options={DOJO_SCENES.map((s) => [s.id, s.label])} onChange={(scene) => void save({ dojo: { ...p.dojo, scene } })} label="Dojo scene" />
        </Row>
        <Row title="Low sound under the music">
          <Segmented value={p.dojo.ambient} options={DOJO_AMBIENTS.map((a) => [a.id, a.label])} onChange={(ambient) => void save({ dojo: { ...p.dojo, ambient } })} label="Ambient sound" />
        </Row>
        <Row title="Its volume">
          <input type="range" min={0} max={60} value={p.dojo.ambientVol} onChange={(e) => void save({ dojo: { ...p.dojo, ambientVol: Number(e.target.value) } })} aria-label="Ambient volume" />
        </Row>
        <Row title="Open Dojo by itself for 25+ minute timers" hint="Esc always leaves; the timer keeps running.">
          <Switch on={p.dojo.auto} onChange={(auto) => void save({ dojo: { ...p.dojo, auto } })} label="Dojo by itself" />
        </Row>
        <div className="fbs-row">
          <button className="btn small" onClick={openDojo}>
            🥋 Try Dojo now
          </button>
        </div>
      </div>
    </section>
  )
}

function KitEditor({ k, music, onChange, onRemove }: { k: LaunchKit; music: MusicKit | null; onChange: (k: LaunchKit) => void; onRemove: () => void }) {
  const toast = useToast()
  const [draft, setDraft] = useState({ apps: k.apps.join('\n'), folders: k.folders.join('\n'), links: k.links.join('\n'), words: k.words.join(', ') })
  useEffect(() => setDraft({ apps: k.apps.join('\n'), folders: k.folders.join('\n'), links: k.links.join('\n'), words: k.words.join(', ') }), [k.id])
  const commit = (patch: Partial<typeof draft>) => {
    const d = { ...draft, ...patch }
    setDraft(d)
    onChange({ ...k, apps: lines(d.apps), folders: lines(d.folders), links: lines(d.links), words: d.words.split(',').map((w) => w.trim()).filter(Boolean) })
  }
  const choices = musicChoices(music)
  return (
    <div className="fbs-kit" data-kit={k.id}>
      <div className="fbs-row">
        <input type="text" value={k.name} maxLength={40} aria-label="Kit name" onChange={(e) => onChange({ ...k, name: e.target.value })} />
        <span className="hint">{kitSummary(k)}</span>
      </div>
      <div className="fbs-chips" role="group" aria-label="For which blocks">
        {KIT_KINDS.map((x) => (
          <button key={x.id} type="button" className={`fbs-chip ${k.kinds.includes(x.id) ? 'on' : ''}`} aria-pressed={k.kinds.includes(x.id)} onClick={() => onChange({ ...k, kinds: k.kinds.includes(x.id) ? k.kinds.filter((y) => y !== x.id) : [...k.kinds, x.id] })}>
            {x.label}
          </button>
        ))}
      </div>
      <label className="hint">
        Also for blocks with these words (comma between)
        <input type="text" value={draft.words} onChange={(e) => setDraft({ ...draft, words: e.target.value })} onBlur={() => commit({})} placeholder="ctf, rust" />
      </label>
      <label className="hint">
        Apps (one per line; desktop app)
        <textarea value={draft.apps} onChange={(e) => setDraft({ ...draft, apps: e.target.value })} onBlur={() => commit({})} placeholder={'VS Code\nObsidian'} />
      </label>
      <label className="hint">
        Folders (full paths; desktop app)
        <textarea value={draft.folders} onChange={(e) => setDraft({ ...draft, folders: e.target.value })} onBlur={() => commit({})} placeholder={'C:\\Projects\\demo-app'} />
      </label>
      <label className="hint">
        Links (https)
        <textarea value={draft.links} onChange={(e) => setDraft({ ...draft, links: e.target.value })} onBlur={() => commit({})} placeholder={'https://example.com/ctf-practice'} />
      </label>
      <Row title="Music station">
        <Select value={k.station ?? ''} onChange={(e) => onChange({ ...k, station: e.target.value || null })} aria-label="Music station">
          <option value="">No music</option>
          {choices.map((c) => (
            <option key={c.url} value={c.url}>
              {c.name}
            </option>
          ))}
        </Select>
      </Row>
      <Row title="Open by itself when a matching timer starts" hint="Otherwise the goal card offers it.">
        <Switch on={k.auto} onChange={(auto) => onChange({ ...k, auto })} label="Open by itself" />
      </Row>
      <Row title="When the timer ends, close the apps this kit opened" hint="Only those apps, asked politely. Never anything you opened yourself.">
        <Switch on={k.closeOnEnd} onChange={(closeOnEnd) => onChange({ ...k, closeOnEnd })} label="Close on end" />
      </Row>
      <div className="fbs-row">
        <button className="btn small" onClick={() => void openKit(k).then((r) => toast(r.text, r.ok ? 'good' : 'info'))}>
          🚀 Test: open it now
        </button>
        <button className="btn small ghost" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  )
}

export function LaunchKitsPanel() {
  const [p, save] = useBoost()
  const music = useMusicList()
  if (!life.boost) return null
  const setKits = (kits: LaunchKit[]) => void save({ kits })
  return (
    <section className="panel fbs-panel" data-boost="kits">
      <header className="panel-head">
        <h2>
          <Icon name="link" /> Launch kits
        </h2>
      </header>
      <p className="hint block">Each kind of block remembers what it needs: apps, folders, links and a music station. Start opens all of it, so the setup minutes where you drift off are gone.</p>
      <div className="fbs-grid">
        {p.kits.map((k, i) => (
          <KitEditor key={k.id} k={k} music={music} onChange={(n) => setKits(p.kits.map((x, j) => (j === i ? n : x)))} onRemove={() => setKits(p.kits.filter((_, j) => j !== i))} />
        ))}
        {p.kits.length < KITS_MAX && (
          <div className="fbs-row">
            <button className="btn small" onClick={() => setKits([...p.kits, newKit(p.kits.length, p.kits.length ? 'study' : 'code')])}>
              + Add a kit
            </button>
          </div>
        )}
        <p className="fbs-limits">{KIT_LIMITS}</p>
      </div>
    </section>
  )
}

export function WinMusicPanel() {
  const [p, save] = useBoost()
  const music = useMusicList()
  const toast = useToast()
  if (!life.boost) return null
  const w = p.wins
  const choices = musicChoices(music)
  const pick = (url: string): Track | null => choices.find((c) => c.url === url) ?? null
  return (
    <section className="panel fbs-panel" data-boost="wins">
      <header className="panel-head">
        <h2>
          <Icon name="trophy" /> Win music
        </h2>
      </header>
      <div className="fbs-grid">
        <Row title="Play a short clip of my victory track on big wins" hint="Off until you switch it on. Never in a meeting or quiet hours, never over music you're playing, one clip every 10 minutes at most.">
          <Switch on={w.on} onChange={(on) => void save({ wins: { ...w, on } })} label="Win music" />
        </Row>
        <Row title="Victory track" hint={choices.length ? undefined : 'Add a station or star a track on the Music page first.'}>
          <Select value={w.victory?.url ?? ''} onChange={(e) => void save({ wins: { ...w, victory: pick(e.target.value) } })} aria-label="Victory track">
            <option value="">None</option>
            {choices.map((c) => (
              <option key={c.url} value={c.url}>
                {c.name}
              </option>
            ))}
          </Select>
        </Row>
        <Row title="Focus theme" hint="Plays when Dojo mode opens by itself, if nothing else is playing.">
          <Select value={w.theme?.url ?? ''} onChange={(e) => void save({ wins: { ...w, theme: pick(e.target.value) } })} aria-label="Focus theme">
            <option value="">None</option>
            {choices.map((c) => (
              <option key={c.url} value={c.url}>
                {c.name}
              </option>
            ))}
          </Select>
        </Row>
        <Row title="Clip length">
          <Segmented value={w.clipSec} options={[[10, '10 s'], [15, '15 s'], [20, '20 s'], [30, '30 s']]} onChange={(clipSec) => void save({ wins: { ...w, clipSec } })} label="Clip length" />
        </Row>
        <div className="fbs-chips" role="group" aria-label="Which wins">
          {WIN_KINDS.map((k) => (
            <button key={k.id} type="button" className={`fbs-chip ${w.kinds[k.id] ? 'on' : ''}`} aria-pressed={w.kinds[k.id]} onClick={() => void save({ wins: { ...w, kinds: { ...w.kinds, [k.id]: !w.kinds[k.id] } } })}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
        <div className="fbs-row">
          <button className="btn small" disabled={!w.on || !w.victory} onClick={() => void playWin('levelUp').then((why) => why && toast(`Not played: ${why}`))}>
            ▶ Play a test clip
          </button>
        </div>
      </div>
    </section>
  )
}
