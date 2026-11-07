// Settings → Voice: the main switch (off until you turn it on), the wake word,
// speech to text, Ben's voice, and the downloads (sizes, a progress bar, a
// delete button). Everything is free and runs on this device; nothing is in
// the installer.
import { useEffect, useState } from 'react'
import { EAR_PACK, KOKORO_VOICES, STT_MODELS, downloadPlan, sizeText, type SttModelId } from '@core/voiceModels'
import { Row, Saved, Segmented, Switch, useSaved } from '../settingsUi'
import { Icon } from '../Icon'
import { useVoicePrefs, type VoicePrefs } from './voicePrefs'
import { deleteVoiceDownloads, getFile, hasFile, hasModel, voiceBytes } from './voiceStore'
import { preload, unload } from './voiceAi'
import { Speaker, probeVoicebox, systemVoices } from './voiceSpeak'
import './voice.css'
import { Select } from '../Select'

const LANGS: [string, string][] = [['', 'Find out'], ['en', 'English'], ['ro', 'Romanian'], ['ru', 'Russian'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian']]

export function VoiceSettings() {
  const [p, setP] = useVoicePrefs()
  const [flash, saved] = useSaved()
  const set = (x: Partial<VoicePrefs>) => (setP(x), saved())
  const desktop = !!(window as any).desktop
  const [voices, setVoices] = useState(() => systemVoices())
  useEffect(() => {
    const on = () => setVoices(systemVoices())
    try {
      speechSynthesis.addEventListener('voiceschanged', on)
      return () => speechSynthesis.removeEventListener('voiceschanged', on)
    } catch {
      return
    }
  }, [])
  const [have, setHave] = useState<{ ear: boolean; stt: boolean; tts: boolean; bytes: number } | null>(null)
  const check = async () => {
    const [ear, stt, tts, bytes] = await Promise.all([hasFile('sherpa.wasm'), hasModel(STT_MODELS[p.stt].repo), hasModel('onnx-community/Kokoro-82M-v1.0-ONNX'), voiceBytes()])
    setHave({ ear, stt, tts, bytes })
  }
  useEffect(() => void check(), [p.stt, p.tts]) // eslint-disable-line react-hooks/exhaustive-deps
  const [dl, setDl] = useState<{ what: string; loaded: number; total: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const plan = downloadPlan({ wake: desktop && p.wake, stt: p.stt, tts: p.tts })
  const total = plan.reduce((n, x) => n + x.bytes, 0)

  const download = async () => {
    setErr(null)
    const done = { n: 0 }
    const files = new Map<string, { loaded: number; total: number }>()
    const show = (what: string) => (f: { file: string; loaded: number; total: number }) => {
      files.set(f.file, { loaded: f.loaded, total: f.total })
      let loaded = done.n
      for (const v of files.values()) loaded += v.loaded
      setDl({ what, loaded, total: Math.max(total, loaded) })
    }
    try {
      if (desktop && p.wake) {
        for (const f of EAR_PACK.files) {
          // The wake word model may be missing on a mirror: the backup way still works.
          await getFile(f, show('Wake word')).catch((e) => {
            if (f.name.startsWith('kws-')) return null
            throw e
          })
        }
      }
      await preload('stt', { model: p.stt }, show('Speech to text'))
      if (p.tts === 'kokoro') await preload('tts', { voice: p.kokoroVoice }, show("Ben's voice"))
      unload()
    } catch (e) {
      setErr((e as Error).message || 'The download stopped')
    }
    setDl(null)
    void check()
  }
  const remove = async () => {
    unload()
    await deleteVoiceDownloads()
    void check()
    saved()
  }
  const tryVoice = () => {
    const s = new Speaker(() => p)
    s.sayAll("Hey Victor. Two focus blocks done, one to go. Let's move.")
  }
  const ready = have && (!desktop || !p.wake || have.ear) && have.stt && (p.tts !== 'kokoro' || have.tts)

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="bot" /> Voice
        </h2>
        <Saved show={flash} />
      </header>
      <Row
        title="Talk to Ben"
        hint={desktop ? 'Say "Hey Ben", press the Talk to Ben shortcut, or tap 🎤 on the island. Off until you turn it on. The mic stops when the PC is locked or idle, in a call, or when the island is quiet.' : 'A 🎤 button on the Coach page. No wake word on the web.'}
      >
        <Switch label="Voice" on={p.on} onChange={(v) => set({ on: v })} />
      </Row>
      {desktop && (
        <>
          <Row title='Listen for "Hey Ben"' hint="Only a tiny wake-word model runs while it waits (about 1–3% of one CPU core, nothing in a quiet room). Off: only the shortcut and 🎤.">
            <Switch label="Wake word" on={p.wake} onChange={(v) => set({ wake: v })} />
          </Row>
          <Row title="Wake word sensitivity" hint="Strict: fewer false wakes. Eager: hears you from further away.">
            <Segmented label="Sensitivity" value={p.wakeThreshold <= 0.15 ? 0.15 : p.wakeThreshold >= 0.4 ? 0.4 : 0.25} options={[[0.4, 'Strict'], [0.25, 'Normal'], [0.15, 'Eager']]} onChange={(v) => set({ wakeThreshold: v })} />
          </Row>
          <Row title="Stop the mic when I'm away" hint="No mouse or keys for this long: the mic closes until you're back.">
            <Segmented label="Away" value={p.idleStopMin} options={[[5, '5 min'], [10, '10 min'], [30, '30 min'], [0, 'Never']]} onChange={(v) => set({ idleStopMin: v })} />
          </Row>
        </>
      )}
      <Row title="Speech to text" hint={`${STT_MODELS[p.stt].hint} · ${sizeText(STT_MODELS[p.stt].bytes)} · loads when you talk, unloads after 2 minutes`}>
        <Select value={p.stt} onChange={(e) => set({ stt: e.target.value as SttModelId })} aria-label="Speech to text model">
          {Object.entries(STT_MODELS).map(([id, m]) => (
            <option key={id} value={id}>
              {m.label} · {m.hint}
            </option>
          ))}
        </Select>
      </Row>
      {STT_MODELS[p.stt].multilingual && (
        <Row title="Language" hint="What you speak (Whisper can also find out by itself).">
          <Select value={p.lang} onChange={(e) => set({ lang: e.target.value })} aria-label="Language">
            {LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row title="Ben's voice" hint={p.tts === 'kokoro' ? 'Kokoro: natural, runs on this PC (about 92 MB, loads when he talks).' : "Light: your system's own voices, no download."}>
        <Segmented label="Voice engine" value={p.tts} options={[['system', 'Light'], ['kokoro', 'Natural (Kokoro)']]} onChange={(v) => set({ tts: v })} />
      </Row>
      {p.tts === 'system' ? (
        <Row title="Voice" hint={voices.length ? `${voices.length} voices on this device` : 'Your system has no voices installed'}>
          <Select value={p.systemVoice} onChange={(e) => set({ systemVoice: e.target.value })} aria-label="System voice">
            <option value="">Default</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </Select>
        </Row>
      ) : (
        <Row title="Voice" hint="Kokoro's voices (English)">
          <Select value={p.kokoroVoice} onChange={(e) => set({ kokoroVoice: e.target.value })} aria-label="Kokoro voice">
            {KOKORO_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row title="Speed" hint={`${p.speed.toFixed(1)}×`}>
        <input type="range" min={0.7} max={1.6} step={0.1} value={p.speed} onChange={(e) => set({ speed: Number(e.target.value) })} aria-label="Speed" />
        <button type="button" className="ghost" onClick={tryVoice}>
          ▶ Try
        </button>
      </Row>
      <Row title={desktop ? 'Ben answers out loud' : 'Read Ben’s replies aloud'} hint={desktop ? 'Off: his answer shows on the island only.' : 'On the Coach page (🔊 there too).'}>
        <Switch label="Speak replies" on={desktop ? p.speak : p.readAloud} onChange={(v) => set(desktop ? { speak: v } : { readAloud: v })} />
      </Row>
      {desktop && <VoiceboxRow p={p} set={set} />}
      <Row
        title="Downloads"
        hint={
          <>
            {ready ? '✓ Ready on this device' : `About ${sizeText(total)} the first time, kept in this device's cache`}
            {have && have.bytes > 0 ? ` · ${sizeText(have.bytes)} used` : ''}
            <ul className="vs-list">
              {plan.map((x) => (
                <li key={x.part}>
                  {x.label}: {sizeText(x.bytes)}
                </li>
              ))}
            </ul>
            {dl && (
              <>
                {dl.what} · {sizeText(dl.loaded)} of {sizeText(dl.total)}
                <span className="vs-bar">
                  <i style={{ transform: `scaleX(${Math.min(1, dl.loaded / Math.max(1, dl.total)).toFixed(3)})` }} />
                </span>
              </>
            )}
            {err && <span className="err"> ⚠ {err}</span>}
          </>
        }
      >
        <button type="button" disabled={!!dl} onClick={() => void download()}>
          {dl ? 'Downloading…' : ready ? 'Check again' : 'Download now'}
        </button>
        <button type="button" className="ghost" disabled={!!dl || !have?.bytes} onClick={() => void remove()}>
          Delete
        </button>
      </Row>
      <p className="hint">
        Free and on this device: sherpa-onnx (Apache-2.0), Silero VAD (MIT), Moonshine and Whisper (MIT), Transformers.js (Apache-2.0), ONNX Runtime (MIT), Kokoro (Apache-2.0). Kokoro's phonemizer (eSpeak NG, GPL-3.0) is downloaded from the public CDN when you pick a Kokoro voice, never bundled. What you say is turned into text on this PC; only the text goes to Ben.
      </p>
    </section>
  )
}

/** TV3 (optional): Ben's voice from Voicebox, a local voice app, when it runs on this PC. */
function VoiceboxRow({ p, set }: { p: VoicePrefs; set: (x: Partial<VoicePrefs>) => void }) {
  const [vb, setVb] = useState<{ ok: boolean; profiles: string[] } | null>(null)
  useEffect(() => {
    void probeVoicebox().then(setVb)
  }, [p.voicebox])
  return (
    <Row title="Voice from Voicebox" hint={vb == null ? 'Looking for Voicebox on this PC…' : vb.ok ? `Voicebox is running${vb.profiles.length ? ` · ${vb.profiles.length} voices` : ''}. If it stops, Ben uses the voice above.` : 'Voicebox (a free local voice studio) is not running on this PC. Ben uses the voice above.'}>
      <Switch label="Use Voicebox" on={p.voicebox} onChange={(v) => set({ voicebox: v })} />
      {p.voicebox && vb?.ok && vb.profiles.length > 0 && (
        <Select value={p.voiceboxProfile} onChange={(e) => set({ voiceboxProfile: e.target.value })} aria-label="Voicebox voice">
          <option value="">Its default voice</option>
          {vb.profiles.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      )}
    </Row>
  )
}
