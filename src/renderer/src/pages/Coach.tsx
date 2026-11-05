// Coach: one chat with your coach (the same brain and memory as the Telegram
// bots, so the conversation continues wherever you are), what it remembers
// about you (edit or delete), and the goals & rules it holds you to.
import { useCallback, useEffect, useRef, useState } from 'react'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { useAction } from '../ui'
import { useLive } from '../live'
import type { CoachMind } from '@core/coachMind'
import type { RhythmPrefs } from '@core/rhythm'
import { MOOD_FACE, type Mood } from '@core/coachKit'
import { CoachScorecard, GoalPlans } from '../CoachPanels'
import { CoachPlan } from '../CoachPlan'
import { CoachAbout } from '../CoachAbout'
import type { CoachStatus } from '../web/coachStatus'
import type { DeskView } from '../web/benDesk'
import { readDo } from '@core/coachButtons'
import { BenDesk, type DeskTab } from '../BenDesk'
import { Feedback, ReplyExtras, Rich, type Entry } from '../BenThread'
import '../ben.css'

type Profile = { about: string; goals: string[]; rules: string[] }

const BOT_LABEL: Record<string, string> = { mega: 'Ben', finance: 'Finance', waky: 'Waky', sport: 'Sport' }
const CARDS: { title: string; sub: string; ask: string }[] = [
  { title: 'What now?', sub: 'The one thing that matters most right now', ask: 'What should I focus on right now? Be specific.' },
  { title: 'Plan my day', sub: 'Blocks in my free time, from my calendar', ask: 'Plan the rest of my day around my calendar and put the blocks in it.' },
  { title: 'Honest week review', sub: 'Where I improved, where I slipped', ask: 'How was my week, honestly? What should I change next week?' },
  { title: 'Push me', sub: "I'm procrastinating. Tough love, one step", ask: "I'm procrastinating right now. Push me and give me one step to start." }
]
const QUICK = [
  'What should I focus on right now?',
  'Plan my afternoon around my calendar',
  'How was my week, honestly?',
  "I'm procrastinating. Push me.",
  'Block 2 hours tomorrow for my most urgent task'
]
const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const t = new Date()
  const y = new Date(t.getTime() - 86400000)
  if (d.toDateString() === t.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}
const timeOf = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toTimeString().slice(0, 5) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toTimeString().slice(0, 5)
}

export function Coach({ onWallet }: { onWallet: () => void }) {
  const act = useAction()
  const [log, setLog] = useState<Entry[] | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [facts, setFacts] = useState<{ t: string; at: string }[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [mind, setMind] = useState<CoachMind | null>(null)
  const [status, setStatus] = useState<CoachStatus | null>(null)
  const [photo, setPhoto] = useState<{ url: string; data: string } | null>(null)
  const [query, setQuery] = useState<string | null>(null)
  // U1: the status cards and shortcuts fold away once you're talking; "⋯" brings them back.
  const [extras, setExtras] = useState(false)
  // U8: replies that came in while you were scrolled up.
  const [unseen, setUnseen] = useState(0)
  // U10: which search hit is shown (index into the hits).
  const [hit, setHit] = useState(0)
  // U16: on a phone the composer stays above the keyboard and the header shrinks while typing.
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const on = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`)
    vv.addEventListener('resize', on)
    vv.addEventListener('scroll', on)
    on()
    return () => {
      vv.removeEventListener('resize', on)
      vv.removeEventListener('scroll', on)
      document.documentElement.style.removeProperty('--kb')
    }
  }, [])
  const [listening, setListening] = useState(false)
  const recog = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const undoLine = async (m: Entry, index?: number) => {
    if (!life.coach?.undo) return
    const r = await act(() => life.coach!.undo!(m.at, index))
    if (!r) return
    const marks = [...(m.undone ?? [])]
    if (r.ok) (m.undo ?? []).forEach((op, k) => op && (index == null || index === k) && (marks[k] = true))
    setLog((l) => (l ?? []).map((x) => (x === m ? { ...x, undone: marks } : x)))
    await act(async () => r, r.lines.join(' · '))
    onWallet()
    loadStatus()
  }
  // 🎤 Dictation (the browser's speech recognition): words go into the box.
  const Speech = typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition) : null
  const toggleMic = () => {
    if (!Speech) return
    if (listening) {
      recog.current?.stop()
      return
    }
    const r = new Speech()
    r.lang = navigator.language || 'en-US'
    r.interimResults = true
    r.continuous = false
    const base = text ? `${text.trim()} ` : ''
    r.onresult = (e: any) => setText(base + Array.from(e.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(''))
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recog.current = r
    setListening(true)
    r.start()
  }
  // 📷 A photo (receipt, meal, screen): shrunk to 1280 px JPEG before it goes.
  const pickPhoto = async (f: File | undefined) => {
    if (!f) return
    const img = new Image()
    const src = URL.createObjectURL(f)
    img.src = src
    await img.decode().catch(() => null)
    const k = Math.min(1, 1280 / Math.max(img.width || 1, img.height || 1))
    const c = document.createElement('canvas')
    c.width = Math.round((img.width || 1) * k)
    c.height = Math.round((img.height || 1) * k)
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/jpeg', 0.85)
    URL.revokeObjectURL(src)
    setPhoto({ url, data: url.split(',')[1] })
  }
  // The info drawer: open by default on wide screens, a slide-over on phones.
  const [info, setInfo] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1200)
  const [tab, setTabRaw] = useState<DeskTab>(() => {
    try {
      // Sunday: the weekly review first (D6), once per Sunday.
      const today = new Date().toLocaleDateString('sv-SE')
      if (new Date().getDay() === 0 && localStorage.getItem('ls.sundayOpened') !== today) {
        localStorage.setItem('ls.sundayOpened', today)
        return 'sunday'
      }
      return (localStorage.getItem('ls.deskTab') as DeskTab) || 'today'
    } catch {
      return 'today'
    }
  })
  const setTab = (t: DeskTab | 'goals' | 'score' | 'about') => {
    const next: DeskTab = t === 'goals' ? 'plan' : t === 'score' || t === 'about' ? 'you' : t
    setTabRaw(next)
    try {
      localStorage.setItem('ls.deskTab', next)
    } catch {
      /* fine */
    }
  }
  const end = useRef<HTMLDivElement>(null)
  const [deck, setDeck] = useState<DeskView | null>(null)
  const loadStatus = useCallback(() => {
    life.coach?.status?.().then(setStatus).catch(() => {})
    life.coach?.desk?.().then(setDeck).catch(() => {})
  }, [])
  useEffect(() => {
    loadStatus()
    const t = setInterval(loadStatus, 60_000)
    return () => clearInterval(t)
  }, [loadStatus])
  useLive(loadStatus)

  const load = useCallback(async () => {
    if (!life.coach) return setLog([])
    const [l, m, p] = await Promise.all([life.coach.log().catch(() => []), life.coach.memory().catch(() => ({ facts: [] })), life.coach.profile().catch(() => null)])
    setLog(l)
    setFacts(m.facts)
    if (p) setProfile(p)
    life.coach.mind?.().then(setMind).catch(() => {})
  }, [])
  useEffect(() => {
    void load()
    life.coach?.model().then(setModel).catch(() => {})
    const onBrain = () => void life.coach?.model().then(setModel).catch(() => {})
    window.addEventListener('life-brain-changed', onBrain)
    return () => window.removeEventListener('life-brain-changed', onBrain)
  }, [load])
  const stuckRef = useRef(true)
  const prevLen = useRef(0)
  useEffect(() => {
    const n = log?.length ?? 0
    const added = n - prevLen.current
    prevLen.current = n
    if (stuckRef.current || added <= 0) {
      end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
      setUnseen(0)
    } else setUnseen((u) => u + added)
  }, [log?.length])
  const toBottom = () => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    setUnseen(0)
  }
  // Stay at the bottom while a reply types itself out or widgets appear (unless you scrolled up).
  const streamRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = streamRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let stuck = true
    const onScroll = () => {
      stuck = el.scrollHeight - el.scrollTop - el.clientHeight < 140
      stuckRef.current = stuck
      if (stuck) setUnseen(0)
    }
    const ro = new ResizeObserver(() => {
      if (stuck) el.scrollTop = el.scrollHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    Array.from(el.children).forEach((c) => ro.observe(c))
    const mo = new MutationObserver(() => Array.from(el.children).forEach((c) => ro.observe(c)))
    mo.observe(el, { childList: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [log === null])
  // Live: what you and the coach say on Telegram appears here as it happens.
  const busyRef = useRef(false)
  busyRef.current = busy
  useLive(() => {
    if (busyRef.current || !life.coach) return
    life.coach
      .log()
      .then((l) => setLog((cur) => (busyRef.current || (cur && cur.length === l.length && cur[cur.length - 1]?.at === l[l.length - 1]?.at) ? cur : l)))
      .catch(() => {})
    life.coach.memory().then((m) => setFacts(m.facts)).catch(() => {})
    life.coach.mind?.().then(setMind).catch(() => {})
  })

  const send = async (msg = text) => {
    const t = msg.trim()
    const pic = photo
    if ((!t && !pic) || busy || !life.coach) return
    setText('')
    setPhoto(null)
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...(l ?? []), { role: 'me', bot: 'mega', via: 'app', text: t, at: now, photo: pic?.url }, { role: 'coach', bot: 'mega', via: 'app', text: '', at: now, pending: true }])
    try {
      const seen: string[] = []
      let streamed = false
      const r = await life.coach.chat(
        t,
        (st) => {
          if (seen.includes(st)) return
          seen.push(st)
          setLog((l) => (l ?? []).map((x) => (x.pending ? { ...x, steps: [...seen] } : x)))
        },
        pic ? { mime: 'image/jpeg', data: pic.data } : undefined,
        // U2: Ben's words as he writes them.
        (soFar) => {
          streamed = true
          setLog((l) => (l ?? []).map((x) => (x.pending ? { ...x, text: soFar, streamed: true } : x)))
        }
      )
      setLog((l) => [...(l ?? []).filter((x) => !x.pending), { role: 'coach', bot: 'mega', via: 'app', text: r.reply, done: r.done, mood: r.mood, at: r.at ?? new Date().toISOString(), undo: r.undo, chips: r.chips, buttons: r.buttons, show: r.show, fresh: !streamed, steps: seen.filter((x) => !/^Reading your day$/.test(x)) }])
      // One face for Ben (K6): the header shows the mood of his latest reply.
      if (r.mood && MOOD_FACE[r.mood as Mood]) setStatus((s) => (s ? { ...s, mood: r.mood as any, face: MOOD_FACE[r.mood as Mood] } : s))
      if (r.done.length) onWallet()
      void life.coach.memory().then((m) => setFacts(m.facts)).catch(() => {})
      void life.coach.mind?.().then(setMind).catch(() => {})
    } catch (e) {
      // Not a fake Ben reply (K4): your message is marked "Not sent" with Retry, the draft comes back.
      const why = (e as Error).message || 'no connection'
      setLog((l) => (l ?? []).filter((x) => !x.pending).map((x) => (x.role === 'me' && x.at === now ? { ...x, failed: why } : x)))
      if (t) setText((cur) => cur || t)
    }
    setBusy(false)
    loadStatus()
  }

  const saveFacts = async (next: { t: string; at: string }[]) => {
    setFacts(next)
    await act(() => life.coach!.setFacts(next))
  }
  const saveProfile = async (next: Profile) => {
    setProfile(next)
    const r = await act(() => life.coach!.saveProfile(next), 'Saved: the coach will push you on this')
    if (r) setProfile(r)
  }

  const doMove = async () => {
    const m = status?.move
    if (!m || busy) return
    if (m.kind === 'focus') {
      if (await act(() => life.focus.start(m.subject, m.minutes, null), `Focus started: ${m.subject} · ${m.minutes} min`)) loadStatus()
    } else if (m.kind === 'running') {
      if (await act(() => life.focus.stop(), 'Logged')) loadStatus()
    } else if (m.kind === 'approve') {
      if (await act(() => life.coach!.rhythm!('approve'), 'Approved: blocks in your calendar, must-dos on Today')) loadStatus()
    } else if (m.kind === 'plan') {
      setBusy(true)
      await act(() => life.coach!.rhythm!('propose'), 'Your plan is ready: see Plan')
      setBusy(false)
      setTab('plan')
      setInfo(true)
      loadStatus()
    } else if (m.kind === 'answer') void send(`Done: ${m.promise}`)
    else void send(m.kind === 'ask' && new Date().getHours() >= 21 ? 'How did today go? Review my day.' : 'What should I do right now? One thing.')
  }
  const moveLabel: Record<string, string> = { focus: '▶ Start', running: '⏹ Stop & log', approve: '✓ Approve', plan: 'Plan it', answer: '✅ Done', ask: 'Ask' }
  const face = status?.face ?? '✦'
  // U10: search hits (indexes in the log), newest first.
  const hits = query?.trim() ? (log ?? []).map((m, k) => (m.text.toLowerCase().includes(query.trim().toLowerCase()) ? k : -1)).filter((k) => k >= 0).reverse() : []
  const jump = (n: number) => {
    if (!hits.length) return
    const k = (n + hits.length) % hits.length
    setHit(k)
    document.getElementById(`cx-m${hits[k]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  // U17: first-chat starters from your real day.
  const starters: { title: string; sub: string; ask: string }[] = [
    ...(status ? [{ title: status.move.title, sub: status.move.sub, ask: `${status.move.title}: help me start.` }] : []),
    ...(status && status.plan.status === 'none' ? [{ title: 'Plan my day', sub: 'Blocks in my free time, from my calendar', ask: CARDS[1].ask }] : [CARDS[0]]),
    CARDS[3]
  ]
    .filter((c, k, all) => all.findIndex((x) => x.title.toLowerCase() === c.title.toLowerCase()) === k)
    .slice(0, 3)
  // The newest real Ben reply: its live cards stay even if a later message failed.
  const lastReply = (() => {
    for (let k = (log?.length ?? 0) - 1; k >= 0; k--) if (log![k].role === 'coach' && !log![k].pending) return k
    return -1
  })()

  return (
    <div className={`cx ${info ? 'info-open' : ''} ${typing ? 'typing' : ''}`}>
      <section className="cx-chat">
        <header className="cx-head">
          <button className={`cx-face mood-${status?.mood ?? 'chill'}`} onClick={() => setInfo((v) => !v)} title="Coach info" aria-label="Coach info">
            {face}
          </button>
          <div className="cx-who">
            <b>Ben</b>
            <span className="cx-status">
              {busy ? (
                <span className="cx-typing-label">thinking…</span>
              ) : status ? (
                <>
                  <i className={`cx-dot mood-${status.mood}`} /> {status.mood} · {status.why}
                </>
              ) : (
                'your coach'
              )}
            </span>
          </div>
          <button
            className="cx-model"
            title="Ben's brain: change the model and see what it costs"
            onClick={() => {
              try {
                localStorage.setItem('ls.settingsTab', 'ben')
              } catch {
                /* fine */
              }
              window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'settings' }))
              setTimeout(() => window.dispatchEvent(new CustomEvent('life-settings-tab', { detail: 'ben' })), 300)
            }}
          >
            {/* The model's name and cost live in Settings → Ben (V8); here just the way there. */}
            🧠 Ben's brain
          </button>
          <button className="cx-model" title="Your notebook: what Ben knows about you, his notes, your journal" onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'notebook' }))}>
            📓 Notebook
          </button>
          <button className={`icon-btn ${query != null ? 'on' : ''}`} onClick={() => setQuery((q) => (q == null ? '' : null))} aria-label="Search the chat" title="Search the chat">
            <Icon name="search" />
          </button>
          <button className={`icon-btn cx-info-btn ${info ? 'on' : ''}`} onClick={() => setInfo((v) => !v)} aria-label="Show plan, goals and more" title="Plan, goals, score, about you">
            <Icon name="sliders" />
          </button>
        </header>

        {query != null && (
          <div className="cx-search">
            <input
              autoFocus
              value={query}
              onChange={(e) => (setQuery(e.target.value), setHit(0))}
              placeholder="Search your chats with Ben…"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery(null)
                if (e.key === 'Enter' || e.key === 'ArrowDown') (e.preventDefault(), jump(hit + 1))
                if (e.key === 'ArrowUp') (e.preventDefault(), jump(hit - 1))
              }}
            />
            <span>{query.trim() ? (hits.length ? `${Math.min(hit + 1, hits.length)} of ${hits.length}` : 'nothing found') : ''}</span>
            {hits.length > 1 && (
              <>
                <button type="button" className="icon-btn" onClick={() => jump(hit - 1)} aria-label="Previous match">
                  ↑
                </button>
                <button type="button" className="icon-btn" onClick={() => jump(hit + 1)} aria-label="Next match">
                  ↓
                </button>
              </>
            )}
          </div>
        )}
        {query != null && query.trim() && hits.length > 0 && (
          <ul className="cx-hits">
            {hits.slice(0, 30).map((k, n) => {
              const m = log![k]
              const t = m.text.replace(/\s+/g, ' ')
              const at = t.toLowerCase().indexOf(query.trim().toLowerCase())
              return (
                <li key={k}>
                  <button type="button" className={n === hit ? 'on' : ''} onClick={() => jump(n)}>
                    <small>
                      {m.role === 'me' ? 'You' : 'Ben'} · {timeOf(m.at)}
                    </small>
                    <span>
                      {at > 30 ? '…' : ''}
                      {t.slice(Math.max(0, at - 30), at + 70)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {status && query == null && (
          <div className={`cx-pin move-${status.move.kind} ${log?.length ? 'slim' : ''}`}>
            <div className="cx-pin-text">
              <small>Do this now</small>
              <b>{status.move.title}</b>
              <span>{status.move.sub}</span>
            </div>
            <div className="cx-pin-actions">
              {status.move.kind === 'answer' && (
                <button className="btn ghost small" disabled={busy} onClick={() => void send(`Not yet: ${(status.move as any).promise}`)}>
                  Not yet
                </button>
              )}
              <button className="btn primary" disabled={busy} onClick={() => void doMove()}>
                {moveLabel[status.move.kind]}
              </button>
              {!!log?.length && (
                <button className={`btn ghost small cx-more-btn ${extras ? 'on' : ''}`} onClick={() => setExtras((v) => !v)} aria-expanded={extras} title={extras ? 'Fold away' : 'Plan, promises, goals and shortcuts'}>
                  ⋯
                </button>
              )}
            </div>
          </div>
        )}

        {status && query == null && (!log?.length || extras) && (
          <div className="cx-strip" role="list">
            <button role="listitem" className="cx-card" onClick={() => (setTab('plan'), setInfo(true))}>
              <small>Plan</small>
              <b>{status.plan.status === 'approved' ? '✓ Approved' : status.plan.status === 'proposed' ? 'Waiting for you' : 'Not yet'}</b>
              <span>{status.plan.score != null ? `Day score ${status.plan.score}/100` : status.plan.status === 'none' ? 'Tap “Plan it”' : `${status.plan.mustdos} must-dos · ${status.plan.blocks} blocks`}</span>
            </button>
            <button role="listitem" className={`cx-card ${status.promises.missed ? 'warn' : ''}`} onClick={() => (setTab('today'), setInfo(true))}>
              <small>Promises · 7 days</small>
              <b>
                {status.promises.kept} kept · {status.promises.missed} missed
              </b>
              <span>{status.promises.awaiting.length ? `${status.promises.awaiting.length} waiting for your answer` : 'Nothing waiting'}</span>
            </button>
            <button role="listitem" className="cx-card" onClick={() => (setTab('goals'), setInfo(true))}>
              <small>Goals</small>
              {status.goals.length ? (
                <div className="cx-rings">
                  {status.goals.slice(0, 3).map((g) => (
                    <span key={g.id} className="cx-ring-wrap" title={`${g.title}: ${g.pct}% · ${g.perDayMin} min/day · ${g.daysLeft} days left`}>
                      <span className={`cx-ring ${g.status.replace(' ', '-')}`} style={{ ['--p' as string]: `${g.pct}%` }}>
                        <i>{g.pct}%</i>
                      </span>
                      <em>{g.subject}</em>
                    </span>
                  ))}
                </div>
              ) : (
                <>
                  <b>None yet</b>
                  <span>Add one with a deadline</span>
                </>
              )}
            </button>
            <div role="listitem" className="cx-card static">
              <small>Today</small>
              <b>
                {Math.floor(status.today.focusMin / 60) ? `${Math.floor(status.today.focusMin / 60)}h ` : ''}
                {status.today.focusMin % 60}m focus
              </b>
              <span>
                {status.today.mustTotal ? `${status.today.mustDone}/${status.today.mustTotal} must-dos` : 'No must-dos'}
                {status.today.waterTarget ? ` · 💧 ${(status.today.waterMl / 1000).toFixed(1)}/${(status.today.waterTarget / 1000).toFixed(1)} L` : ''}
              </span>
            </div>
          </div>
        )}

        {query == null && (!log?.length || extras) && (
          <div className="cx-deck" role="toolbar" aria-label="Ben's big moves">
            {(
              [
                ['today', '🛟', 'Rescue my day', false],
                ['plan', '🗓', 'Plan my week', false],
                ['today', '💎', 'Stake a promise', false],
                ['plan', '🎙', 'Coach call', !!deck?.callDue],
                ['money', '🛍', 'Should I buy it?', false],
                ['you', '🔍', 'My patterns', false],
                ['month', '📖', 'My month', false]
              ] as const
            ).map(([t, icon, label, hot]) => (
              <button
                key={label}
                className={hot ? 'hot' : ''}
                disabled={busy}
                onClick={() => {
                  // U14: the big moves start a short talk in the chat; stakes and the call open the desk.
                  const say: Record<string, string> = {
                    'Rescue my day': 'Rescue my day: shrink the rest of today to fit what I can still do.',
                    'Plan my week': 'Plan my week: my big 3 and blocks in my free time.',
                    'My patterns': 'What patterns do you see in my data lately? The top 3, with numbers.',
                    'My month': 'How was my month, honestly? Numbers first.'
                  }
                  if (say[label]) return void (setExtras(false), send(say[label]))
                  if (label === 'Should I buy it?') {
                    setExtras(false)
                    setText('Should I buy ')
                    setTimeout(() => (document.querySelector('.cx-composer textarea') as HTMLTextAreaElement | null)?.focus(), 30)
                    return
                  }
                  setTab(t)
                  setInfo(true)
                }}
              >
                <span>{icon}</span>
                {label}
                {label === 'Stake a promise' && !!deck?.stakes.filter((x) => x.status === 'open').length && <i className="n">{deck.stakes.filter((x) => x.status === 'open').length}</i>}
              </button>
            ))}
          </div>
        )}

        <div className="co-stream cx-stream" ref={streamRef}>
          {log === null && (
            <div className="cx-skel" aria-label="Loading your conversation">
              <i />
              <i className="me" />
              <i />
            </div>
          )}
          {log?.length === 0 && (
            <div className="co-hero">
              <span className="co-avatar">{face}</span>
              <h3>Talk to me like a friend.</h3>
              <p>I see your day, calendar, Todoist, sleep, training and money, and I can act: log things, plan blocks, book goals, hold you to promises.</p>
              {/* One starter, not four (V5): "Do this now" above already offers the plan. */}
              <div className="co-cards">
                {starters.map((c) => (
                  <button key={c.title} className="co-card" disabled={busy} onClick={() => void send(c.ask)}>
                    <b>{c.title}</b>
                    <small>{c.sub}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {log?.map((m, i) => {
            const prev = log[i - 1]
            const day = new Date(m.at).toDateString()
            const newDay = !prev || new Date(prev.at).toDateString() !== day
            const grouped = !newDay && prev && prev.role === m.role && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60000
            return (
              <div key={i} id={`cx-m${i}`} className={`cx-item ${hits[hit] === i && query?.trim() ? 'flash' : ''}`}>
                {newDay && <div className="cx-day">{dayLabel(m.at)}</div>}
                {m.role === 'coach' && m.proactive && (
                  <div className="cx-own-label">
                    {/^(🔔|⏰)/u.test(m.text) ? '⏰ Reminder' : /^(📅|🚶)/u.test(m.text) ? '📅 Calendar' : /^(💧|💪)/u.test(m.text) ? '💧 Check-in' : '🎯 Ben, on his own'} · {m.via === 'app' ? 'app' : 'Telegram'} {new Date(m.at).toTimeString().slice(0, 5)}
                  </div>
                )}
                <div className={`co-row ${m.role} ${grouped ? 'grouped' : ''} ${m.proactive ? 'own' : ''}`}>
                  {m.role === 'coach' && (
                    <span className={`co-avatar ${m.mood && MOOD_FACE[m.mood as Mood] ? `mood mood-${m.mood}` : ''} ${grouped ? 'ghost' : ''}`} title={m.mood ? `Coach was ${m.mood}` : undefined}>
                      {(m.mood && MOOD_FACE[m.mood as Mood]) || '✦'}
                    </span>
                  )}
                  <div className={`co-msg ${m.role} ${m.pending ? 'pending' : ''}`}>
                    <div className="co-bubble">
                      {m.pending ? (
                        <div className="co-thinking">
                          <span className="co-typing">
                            <i />
                            <i />
                            <i />
                          </span>
                          {m.streamed && m.text ? <Rich text={m.text} /> : null}
                          {!!m.steps?.length && !m.streamed && (
                            <ul className="co-steps live">
                              {m.steps.map((st, k) => (
                                <li key={k} className={k === m.steps!.length - 1 ? 'now' : 'ok'}>
                                  {st}
                                  {k === m.steps!.length - 1 ? '…' : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <>
                          {!!m.steps?.length && (
                            <details className="co-steps-pill">
                              <summary>
                                ✓ {m.steps.length} step{m.steps.length === 1 ? '' : 's'}
                              </summary>
                              <ul>
                                {m.steps.map((st, k) => (
                                  <li key={k}>{st}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {m.photo && <img className="cx-photo" src={m.photo} alt="Your photo" />}
                          {m.role === 'coach' ? <Rich text={m.text} reveal={!!m.fresh} highlight={query ?? ''} /> : <Rich text={m.text} highlight={query ?? ''} />}
                        </>
                      )}
                      {!!m.done?.length && (
                        <ul className="cx-actions cx-receipt">
                          {m.done.length > 1 && (m.undo ?? []).filter((op, k) => op && !m.undone?.[k]).length > 1 && (
                            <li className="cx-receipt-head">
                              <span>
                                {m.done.length} things done
                              </span>
                              <button className="cx-undo" onClick={() => void undoLine(m)} title="Take all of it back">
                                ↩ Undo all
                              </button>
                            </li>
                          )}
                          {m.done.map((d, k) => {
                            const can = !!m.undo?.[k] && !m.undone?.[k]
                            return (
                              <li key={k} className={`cx-action ${m.undone?.[k] ? 'undone' : ''} ${d.startsWith('⚠️') ? 'warn' : ''}`}>
                                <span>{d}</span>
                                {can && (
                                  <button className="cx-undo" onClick={() => void undoLine(m, k)} title="Take this back">
                                    ↩ Undo
                                  </button>
                                )}
                                {m.undone?.[k] && <em>undone</em>}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {!m.pending && (!!m.buttons?.length || !!m.show?.length) && <ReplyExtras m={m} status={status} latest={i === lastReply} busy={busy} onSay={(t) => void send(t)} onOpen={(t) => (setTab(t), setInfo(true))} onDone={() => (loadStatus(), onWallet())} />}
                      {!m.pending && m.role === 'coach' && life.coach?.feedback && <Feedback m={m} latest={i === lastReply} />}
                      {m.failed && (
                        <span className="cx-failed" title={m.failed}>
                          Not sent ·{' '}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setLog((l) => (l ?? []).filter((x) => x !== m))
                              setText('')
                              void send(m.text)
                            }}
                          >
                            Retry
                          </button>
                        </span>
                      )}
                      {!m.pending && (
                        <span className="cx-time">
                          {m.via === 'app' ? '' : 'Telegram · '}
                          {new Date(m.at).toTimeString().slice(0, 5)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={end} />
        </div>
        {unseen > 0 && (
          <button className="cx-newbtn" onClick={toBottom}>
            ↓ {unseen} new
          </button>
        )}
        {!!log?.length && !busy && (
          <div className="co-quick cx-quick">
            {([...(log ?? [])].reverse().find((x) => x.role === 'coach' && !x.pending)?.chips?.length ? [...(log ?? [])].reverse().find((x) => x.role === 'coach' && !x.pending)!.chips! : QUICK).slice(0, 3).map((q) => (
              <button key={q} className="wp-chip" disabled={busy} onClick={() => void send(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <form
          className="co-composer cx-composer"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          {photo && (
            <span className="cx-attach">
              <img src={photo.url} alt="" />
              <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo">
                ✕
              </button>
            </span>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files?.[0]).then(() => (e.target.value = ''))} />
          <button type="button" className="cx-tool" onClick={() => fileRef.current?.click()} aria-label="Send a photo" title="Photo (a receipt, a meal…)">
            📷
          </button>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(180, e.target.scrollHeight)}px`
            }}
            placeholder={listening ? 'Listening…' : 'Message Ben…'}
            rows={1}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
          />
          {Speech && (
            <button type="button" className={`cx-tool ${listening ? 'rec' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop dictation' : 'Dictate'} title={listening ? 'Listening… tap to stop' : 'Speak instead of typing'}>
              🎤
            </button>
          )}
          <button className="co-send" disabled={busy || (!text.trim() && !photo)} aria-label="Send" title="Send (Enter)">
            {busy ? '…' : '↑'}
          </button>
        </form>
      </section>

      <div className="cx-scrim" onClick={() => setInfo(false)} aria-hidden />
      <aside className="cx-info" aria-label="Coach info">
        <div className="cx-info-head">
          <span className={`cx-face big mood-${status?.mood ?? 'chill'}`}>{face}</span>
          <div>
            <b>Ben</b>
            <small>Ben's desk · everything he knows and plans for you</small>
          </div>
          <button className="icon-btn cx-close" onClick={() => setInfo(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <BenDesk
          tab={tab}
          setTab={setTab}
          status={status}
          onChange={() => (loadStatus(), onWallet())}
          onSay={(t) => void send(t)}
          slots={{
            plan: (
              <>
                <CoachPlan onChange={loadStatus} />
                <RhythmSettings />
              </>
            ),
            goals: <GoalPlans />,
            score: <CoachScorecard />,
            about: (
              <>
                <CoachAbout />
                {profile && <GoalsRules profile={profile} onSave={saveProfile} />}
                {mind && (
                  <Learning
                    mind={mind}
                    onSave={async (next) => {
                      setMind(next)
                      await act(() => life.coach!.setMind!(next))
                    }}
                  />
                )}
                <section className="panel">
                  <header className="panel-head">
                    <h2>
                      <Icon name="list" /> What the coach remembers
                    </h2>
                  </header>
                  <p className="hint small">Picked up from your conversations. Edit or delete anything that's wrong or old.</p>
                  <FactList facts={facts} onSave={saveFacts} />
                </section>
              </>
            )
          }}
        />
      </aside>
    </div>
  )
}

function ListEditor({ items, onChange, placeholder }: { items: string[]; onChange: (next: string[]) => void; placeholder: string }) {
  const [v, setV] = useState('')
  return (
    <div className="co-list">
      {items.map((it, i) => (
        <div key={`${i}:${it}`} className="co-item">
          <input
            defaultValue={it}
            onBlur={(e) => {
              const t = e.target.value.trim()
              if (t !== it) onChange(t ? items.map((x, k) => (k === i ? t : x)) : items.filter((_, k) => k !== i))
            }}
          />
          <button className="ta-act" aria-label="Remove" title="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <form
        className="co-item add"
        onSubmit={(e) => {
          e.preventDefault()
          if (!v.trim()) return
          onChange([...items, v.trim()])
          setV('')
        }}
      >
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
        <button className="ta-act" aria-label="Add" title="Add">
          ＋
        </button>
      </form>
    </div>
  )
}

function GoalsRules({ profile, onSave }: { profile: Profile; onSave: (p: Profile) => void }) {
  const [about, setAbout] = useState(profile.about)
  return (
    <section className="panel">
      <header className="panel-head">
        <h2>
          <Icon name="trophy" /> Goals & rules
        </h2>
      </header>
      <h3 className="co-sub">Long-term goals</h3>
      <p className="hint small">The coach pushes you toward these in every answer and message.</p>
      <ListEditor items={profile.goals} onChange={(goals) => onSave({ ...profile, goals })} placeholder="e.g. Get a cyber security internship by summer" />
      <h3 className="co-sub">My rules</h3>
      <p className="hint small">Rules you want to be held to. Tough love: it calls you out when you break one.</p>
      <ListEditor items={profile.rules} onChange={(rules) => onSave({ ...profile, rules })} placeholder="e.g. No phone in bed · 2 focus blocks every weekday" />
      <h3 className="co-sub">About me</h3>
      <textarea className="co-about" value={about} onChange={(e) => setAbout(e.target.value)} onBlur={() => about !== profile.about && onSave({ ...profile, about })} rows={3} placeholder="Anything the coach should always know: your schedule, what motivates you, what doesn't work…" />
    </section>
  )
}

function FactList({ facts, onSave }: { facts: { t: string; at: string }[]; onSave: (f: { t: string; at: string }[]) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  return (
    <ListEditor
      items={facts.map((f) => f.t)}
      onChange={(next) => onSave(next.map((t) => facts.find((f) => f.t === t) ?? { t, at: today }))}
      placeholder="Add something it should remember…"
    />
  )
}

/** What the coach is learning about you: goals it tracks, what works, patterns. Delete what's wrong. */
function Learning({ mind, onSave }: { mind: CoachMind; onSave: (m: CoachMind) => void }) {
  const empty = !mind.goals.length && !mind.works.length && !mind.fails.length && !mind.patterns.length && !(mind.people ?? []).length
  const today = new Date().toISOString().slice(0, 10)
  const left = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000)
  const row = (key: string, text: string, sub: string, remove: () => void) => (
    <li key={key} className="co-learn-row">
      <span>
        {text}
        {sub && <small>{sub}</small>}
      </span>
      <button className="ta-act" aria-label="Forget" title="Forget this" onClick={remove}>
        ✕
      </button>
    </li>
  )
  const group = (title: string, items: React.ReactNode[]) =>
    items.length ? (
      <div className="co-learn-group">
        <h3>{title}</h3>
        <ul>{items}</ul>
      </div>
    ) : null
  return (
    <section className="panel co-learn">
      <header className="panel-head">
        <h2>
          <Icon name="spark" /> What the coach knows about you
        </h2>
      </header>
      {empty ? (
        <p className="hint small">Nothing yet. Tell it a goal with a date ("pass algebra by 15 Dec, 6h a week") and it tracks it; it also notes what works for you and patterns in your data.</p>
      ) : (
        <>
          {group(
            'Goals it tracks',
            mind.goals.map((g, i) =>
              row(`g${i}`, g.title, [g.deadline ? (left(g.deadline) >= 0 ? `${left(g.deadline)} days left` : `${-left(g.deadline)} days late`) : '', g.weekly ? `${g.weekly} a week` : ''].filter(Boolean).join(' · '), () => onSave({ ...mind, goals: mind.goals.filter((_, k) => k !== i) }))
            )
          )}
          {group('People in your life', (mind.people ?? []).map((x, i) => row(`pp${i}`, x.name, x.note, () => onSave({ ...mind, people: mind.people.filter((_, k) => k !== i) }))))}
          {group('What works for you', mind.works.map((x, i) => row(`w${i}`, x.t, '', () => onSave({ ...mind, works: mind.works.filter((_, k) => k !== i) }))))}
          {group("What doesn't", mind.fails.map((x, i) => row(`f${i}`, x.t, '', () => onSave({ ...mind, fails: mind.fails.filter((_, k) => k !== i) }))))}
          {group('Patterns', mind.patterns.map((x, i) => row(`p${i}`, x.t, '', () => onSave({ ...mind, patterns: mind.patterns.filter((_, k) => k !== i) }))))}
        </>
      )}
    </section>
  )
}

/** The daily rhythm: what the coach sends you and when (Telegram and Today). */
function RhythmSettings() {
  const act = useAction()
  const [prefs, setPrefs] = useState<RhythmPrefs | null>(null)
  useEffect(() => {
    life.coach?.rhythm?.('state').then((r) => setPrefs(r.prefs)).catch(() => {})
  }, [])
  if (!life.coach?.rhythm || !prefs) return null
  const save = async (patch: Partial<RhythmPrefs>) => {
    setPrefs({ ...prefs, ...patch })
    const r = await act(() => life.coach!.rhythm!('prefs', undefined, patch), 'Saved')
    if (r) setPrefs(r.prefs)
  }
  return (
    <section className="panel co-rhythm">
      <header className="panel-head">
        <h2>
          <Icon name="clock" /> Daily rhythm
        </h2>
      </header>
      <label className="check co-check">
        <input type="checkbox" checked={prefs.on} onChange={(e) => void save({ on: e.target.checked })} /> On
      </label>
      <p className="hint small">After you wake up: a plan for the day to approve. During the day: water and training nudges. In the evening: a review and tomorrow's top 3. Sundays: the week and next week's plan.</p>
      {prefs.on && (
        <div className="co-rhythm-rows">
          <label>
            Evening review
            <input type="time" value={prefs.evening} onChange={(e) => e.target.value && void save({ evening: e.target.value })} />
          </label>
          <label>
            Sunday review
            <input type="time" value={prefs.weekly} onChange={(e) => e.target.value && void save({ weekly: e.target.value })} />
          </label>
          <label className="co-check">
            <input type="checkbox" checked={prefs.water} onChange={(e) => void save({ water: e.target.checked })} /> Water nudges
          </label>
          <label className="co-check">
            <input type="checkbox" checked={prefs.training} onChange={(e) => void save({ training: e.target.checked })} /> Training nudge
          </label>
        </div>
      )}
    </section>
  )
}
