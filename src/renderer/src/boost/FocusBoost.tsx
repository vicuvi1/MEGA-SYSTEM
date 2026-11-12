// Focus boost in the app window (mounted once in App): it watches the focus
// timer, whatever started it (Today, the island, Telegram, Ben), and
// - DX10: when a timer starts, asks for a one-line goal; when it ends, asks
//   Done / Half / Not (saved with the session; Ben learns from it);
// - DX9: offers (or opens, if you said so) the block's launch kit, and when
//   the timer ends asks the apps the kit opened to close (if you said so);
// - LF14: opens Dojo mode (by the button, or by itself for 25+ min timers);
// - DX7: shows "why I'm stalling" when a block is snoozed or skipped here;
// - LF20: shows the small victory card while a win's clip plays.
// Nothing here pays or takes points.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusState } from '@shared/api'
import { kitFor, kitSummary, type LaunchKit } from '@core/launchKit'
import { goalHint, verdictSaid, VERDICTS, type Verdict } from '@core/sessionGoal'
import { stallFix, STALL_REASONS, type StallFix, type StallReason } from '@core/stallFix'
import { stationFor } from '@core/musicOnly'
import { cleanMusicKit } from '@core/music'
import { dayKey } from '@core/dates'
import { life } from '../bridge'
import { useToast } from '../ui'
import { useSimple } from '../useSimple'
import { askWhyStalling, DOJO_EVENT, loadBoost, musicPlaying, playUrl, STALL_EVENT, useBoost } from './boostBus'
import { endKit, openKit } from './launch'
import { installWins, onWinClip } from './wins'
import { Dojo, type DojoTimer } from './Dojo'
import './boost.css'

export { askWhyStalling }

interface Run {
  subject: string
  startedAt: string
  planned: number
  pausedAt?: string | null
  pausedMs?: number
}
type Card =
  | { t: 'goal'; run: Run; kit: LaunchKit | null }
  | { t: 'verdict'; run: Run; minutes: number; goal: string }
  | { t: 'stall'; subject: string }
  | { t: 'fix'; fix: StallFix }

const endsAt = (r: Run) => Date.parse(r.startedAt) + r.planned * 60_000 + (r.pausedMs ?? 0)

/** The boring-task station (Music → a station marked "only during boring tasks"), if any. */
async function boringStation(): Promise<string | null> {
  try {
    const k = (await (life as any).islandKit?.get?.()) ?? null
    const m = cleanMusicKit(k?.music)
    return stationFor(m.stations, m.onlyDuring ?? {}, 'boring')?.url ?? null
  } catch {
    return null
  }
}

export function FocusBoost() {
  const toast = useToast()
  const [prefs, savePrefs] = useBoost()
  const [card, setCard] = useState<Card | null>(null)
  const [goal, setGoal] = useState('')
  const [dojo, setDojo] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [win, setWin] = useState<{ title: string; track: string } | null>(null)
  const prev = useRef<Run | null | undefined>(undefined)
  const goals = useRef<Record<string, string>>({})
  const kitOpen = useRef<LaunchKit | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  // Simple mode (usability pass, 2026-11-12): no goal question at the start and no "how did it go?" at the end
  // (Study Time already asks "What did you do?"; a must-do is its own goal). Settings → Simple mode brings them back.
  const simple = useSimple()
  const simpleRef = useRef(simple.on)
  simpleRef.current = simple.on

  const onStart = useCallback(
    async (r: Run) => {
      const p = await loadBoost()
      const kit = kitFor(p.kits, r.subject)
      if (kit?.auto) {
        kitOpen.current = kit
        const res = await openKit(kit)
        toast(res.text, res.ok ? 'good' : 'info')
      }
      if (p.goals && !simpleRef.current) {
        setGoal('')
        setCard({ t: 'goal', run: r, kit: kit && !kit.auto ? kit : null })
      }
      if (p.dojo.auto && r.planned >= 25) setDojo(true)
      // The focus theme (Win music) plays in Dojo when nothing else does.
      if (p.dojo.auto && r.planned >= 25 && p.wins.on && p.wins.theme && !musicPlaying()) playUrl(p.wins.theme.url, p.wins.theme.name)
    },
    [toast]
  )

  const onEnd = useCallback(async (r: Run, st: FocusState) => {
    const p = await loadBoost()
    const k = kitOpen.current
    kitOpen.current = null
    if (k) {
      const said = await endKit(k)
      if (said) toast(`🚀 ${k.name}: ${said}`)
    }
    const s = st.todaySessions.find((x) => x.startedAt === r.startedAt) ?? st.todaySessions.filter((x) => x.subject === r.subject).slice(-1)[0]
    // A cancelled timer logs nothing: no verdict to give.
    if (!s || !p.goals || simpleRef.current) return
    setCard({ t: 'verdict', run: r, minutes: s.minutes, goal: goals.current[r.startedAt] ?? '' })
  }, [toast])

  // The timer, whatever started it: on changes, and every 20 s while the window shows.
  useEffect(() => {
    let alive = true
    let t = 0
    const load = async () => {
      const st = await life.focus.state().catch(() => null)
      if (!alive || !st) return
      const cur = (st.running as Run | null) ?? null
      setRun(cur)
      const before = prev.current
      prev.current = cur
      if (before === undefined) {
        // Just opened: a timer that started this minute still gets its goal.
        if (cur && Date.now() - Date.parse(cur.startedAt) < 60_000) void onStart(cur)
        return
      }
      if (before && (!cur || cur.startedAt !== before.startedAt)) void onEnd(before, st)
      if (cur && cur.startedAt !== before?.startedAt && Date.now() - Date.parse(cur.startedAt) < 3 * 60_000) void onStart(cur)
    }
    const tick = () => {
      if (!document.hidden) void load()
      t = window.setTimeout(tick, 20_000)
    }
    const on = () => void load()
    tick()
    for (const e of ['life-focus-changed', 'life-data-changed', 'life-wallet-changed']) window.addEventListener(e, on)
    return () => {
      alive = false
      clearTimeout(t)
      for (const e of ['life-focus-changed', 'life-data-changed', 'life-wallet-changed']) window.removeEventListener(e, on)
    }
  }, [onStart, onEnd])

  // "Why I'm stalling", Dojo, win clips.
  useEffect(() => {
    installWins()
    const stall = (e: Event) => {
      if (!prefsRef.current.stall) return
      const subject = String((e as CustomEvent<{ subject?: string }>).detail?.subject ?? 'it').slice(0, 60)
      setCard({ t: 'stall', subject })
    }
    const d = () => setDojo(true)
    window.addEventListener(STALL_EVENT, stall)
    window.addEventListener(DOJO_EVENT, d)
    const off = onWinClip((w) => {
      setWin({ title: w.title, track: w.track })
      window.setTimeout(() => setWin(null), 6000)
    })
    return () => {
      window.removeEventListener(STALL_EVENT, stall)
      window.removeEventListener(DOJO_EVENT, d)
      off()
    }
  }, [])

  const close = () => setCard(null)
  const saveGoal = async (r: Run) => {
    const g = goal.trim()
    if (g) {
      goals.current[r.startedAt] = g
      await life.boost?.goal({ id: r.startedAt, day: dayKey(new Date(Date.parse(r.startedAt))), subject: r.subject, goal: g }).catch(() => {})
      toast(`🎯 Goal: ${g}`, 'good')
    }
    close()
  }
  const answer = async (r: Run, v: Verdict, minutes: number, g: string) => {
    await life.boost?.verdict({ id: r.startedAt, day: dayKey(new Date(Date.parse(r.startedAt))), subject: r.subject, verdict: v, minutes }).catch(() => {})
    toast(verdictSaid(v, g), v === 'not' ? 'info' : 'good')
    close()
  }
  const pickReason = async (subject: string, reason: StallReason) => {
    await life.boost?.stall({ reason, subject }).catch(() => {})
    const reward = await life.shop?.state?.().then((s: any) => s?.rewards?.find((x: any) => x.pinned && !x.archived)?.title ?? null).catch(() => null)
    setCard({ t: 'fix', fix: stallFix(reason, subject, { boringStation: reason === 'boring' ? await boringStation() : null, reward }) })
  }
  const runFix = async (f: StallFix) => {
    close()
    if (f.action.kind === 'split') {
      toast('✂️ Asking Ben to split it…')
      const r = await life.coach?.chat(`break down ${f.action.subject}`).catch(() => null)
      if (r?.reply) toast(r.reply.split('\n')[0].slice(0, 160), 'good')
      return
    }
    if (f.station && !musicPlaying()) playUrl(f.station, 'Boring-task music')
    try {
      await life.focus.start(f.action.subject, f.action.minutes, null)
      window.dispatchEvent(new Event('life-focus-changed'))
      toast(`▶ ${f.action.subject} · ${f.action.minutes} min`, 'good')
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  const dojoTimer: DojoTimer | null = run ? { subject: run.subject, goal: goals.current[run.startedAt] ?? null, startedAt: Date.parse(run.startedAt), endsAt: endsAt(run), pausedAt: run.pausedAt ? Date.parse(run.pausedAt) : null } : null

  return (
    <>
      {card && (
        <div className={`fb-card fb-${card.t}`} role="dialog" aria-label={card.t === 'goal' ? 'Session goal' : card.t === 'verdict' ? 'How did it go?' : "What's in the way?"} data-boost={card.t}>
          <button className="fb-x" aria-label="Close" onClick={close}>
            ✕
          </button>
          {card.t === 'goal' && (
            <>
              <b className="fb-head">🎯 {card.run.subject} · {card.run.planned} min</b>
              <label className="fb-q" htmlFor="fb-goal">What exactly will be done at the end?</label>
              <input
                id="fb-goal"
                autoFocus
                value={goal}
                maxLength={120}
                placeholder={goalHint(card.run.subject)}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveGoal(card.run)
                  if (e.key === 'Escape') close()
                }}
              />
              <div className="fb-row">
                <button className="btn small primary" onClick={() => void saveGoal(card.run)} disabled={!goal.trim()}>
                  Set goal
                </button>
                {card.kit && (
                  <button className="btn small" title={kitSummary(card.kit)} onClick={() => void openKit(card.kit!).then((r) => ((kitOpen.current = card.kit), toast(r.text, r.ok ? 'good' : 'info')))}>
                    🚀 Open {card.kit.name} kit
                  </button>
                )}
                <button className="btn small ghost" onClick={() => setDojo(true)}>
                  🥋 Dojo
                </button>
              </div>
            </>
          )}
          {card.t === 'verdict' && (
            <>
              <b className="fb-head">⏱ {card.run.subject} · {card.minutes} min</b>
              <span className="fb-q">{card.goal ? <>Goal: “{card.goal}”. Done?</> : 'How did it go?'}</span>
              <div className="fb-row fb-verdicts">
                {VERDICTS.map((v) => (
                  <button key={v.id} className={`btn small ${v.id === 'done' ? 'primary' : ''}`} onClick={() => void answer(card.run, v.id, card.minutes, card.goal)}>
                    {v.icon} {v.label}
                  </button>
                ))}
              </div>
              <span className="fb-note">Honest answers only change your stats and what Ben learns, never your points.</span>
            </>
          )}
          {card.t === 'stall' && (
            <>
              <b className="fb-head">What's in the way of {card.subject}?</b>
              <span className="fb-q">One tap, one fix.</span>
              <div className="fb-reasons">
                {STALL_REASONS.map((r) => (
                  <button key={r.id} className="fb-reason" onClick={() => void pickReason(card.subject, r.id)}>
                    <span aria-hidden>{r.icon}</span>
                    <b>{r.label}</b>
                    <small>{r.fix}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {card.t === 'fix' && (
            <>
              <b className="fb-head">{STALL_REASONS.find((r) => r.id === card.fix.reason)?.icon} {card.fix.title}</b>
              <span className="fb-q">{card.fix.text}</span>
              <div className="fb-row">
                <button className="btn small primary" onClick={() => void runFix(card.fix)}>
                  {card.fix.button}
                </button>
                <button className="btn small ghost" onClick={close}>
                  Not now
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {win && (
        <div className="fb-win" role="status" data-boost="win">
          <span className="fb-win-glow" aria-hidden />
          <b>🏆 {win.title}</b>
          <small>♫ {win.track}</small>
        </div>
      )}
      {dojo && <Dojo timer={dojoTimer} prefs={prefs.dojo} onScene={(scene) => void savePrefs({ dojo: { ...prefs.dojo, scene } })} onClose={() => setDojo(false)} />}
    </>
  )
}
