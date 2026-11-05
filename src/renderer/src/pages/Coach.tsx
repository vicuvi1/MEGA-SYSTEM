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
import { BenMark, FoldLine, Meta, NowCard, NudgeCard, Receipts } from '../CoachFeed'
import { buildFeed, momentChips, readSlash, SLASH, type Filter } from '@core/chatFeed'
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
  // CL2: closed by default; it remembers if you leave it open on a wide screen.
  const [info, setInfoRaw] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.innerWidth >= 1200 && localStorage.getItem('ls.coachDrawer') === '1'
    } catch {
      return false
    }
  })
  const setInfo = (v: boolean | ((x: boolean) => boolean)) =>
    setInfoRaw((cur) => {
      const next = typeof v === 'function' ? v(cur) : v
      try {
        localStorage.setItem('ls.coachDrawer', next ? '1' : '0')
      } catch {
        /* fine */
      }
      return next
    })
  // CM5: what the chat shows; CN1: which folded runs are open; CM4: the message you reply to.
  const [filter, setFilter] = useState<Filter>('all')
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({})
  const [quote, setQuote] = useState<Entry | null>(null)
  const [menu, setMenu] = useState(false)
  // CN8: when you last had the chat open (fixed for this visit), saved when you leave.
  const [seenAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem('ls.coachSeen')
    } catch {
      return null
    }
  })
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem('ls.coachSeen', new Date().toISOString())
      } catch {
        /* fine */
      }
    }
    const onVis = () => document.hidden && save()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      save()
    }
  }, [])
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
    // CM3: "/water 500" and friends; CM4: a reply says what it's about.
    const slashed = readSlash(msg)
    const q = quote
    setQuote(null)
    const base = (slashed ?? msg).trim()
    const t = q && base ? `About your message "${q.text.replace(/\s+/g, ' ').slice(0, 120)}": ${base}` : base
    const pic = photo
    if ((!t && !pic) || busy || !life.coach) return
    setText('')
    setPhoto(null)
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...(l ?? []), { role: 'me', bot: 'mega', via: 'app', text: q && base ? base : t, at: now, photo: pic?.url, ...(q ? { quote: q.text.slice(0, 140) } : {}) }, { role: 'coach', bot: 'mega', via: 'app', text: '', at: now, pending: true }])
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

  // Night 7: the feed (folded nudges, cards, groups, parts of the day, the "new" line).
  const feed = buildFeed(log ?? [], { seenAt, filter: query?.trim() ? 'raw' : filter })
  const latestOf: Record<string, number> = {}
  for (const it of feed) if (it.t === 'msg' && it.kind !== 'talk') latestOf[it.kind] = it.i
  const soon = (() => {
    for (let k = feed.length - 1; k >= 0; k--) {
      const it = feed[k]
      if (it.t === 'msg' && (it.kind === 'block' || it.kind === 'calendar') && !it.settled && it.info.time && new Date(log![it.i].at).toDateString() === new Date().toDateString()) return `the ${it.info.time} block`
    }
    return null
  })()
  const lastEntry = lastReply >= 0 ? log![lastReply] : null
  const chips = momentChips({
    hour: new Date().getHours(),
    planStatus: status?.plan.status ?? 'none',
    blockSoon: soon,
    mustLeft: status ? status.today.mustTotal - status.today.mustDone : 0,
    replyChips: lastEntry && Date.now() - Date.parse(lastEntry.at) < 20 * 60000 ? lastEntry.chips : undefined
  })
  const slashOpen = text.startsWith('/') && !/\s/.test(text)
  const slashHits = slashOpen ? SLASH.filter((x) => x.cmd.startsWith(text.toLowerCase())) : []
  const openBrain = () => {
    try {
      localStorage.setItem('ls.settingsTab', 'ben')
    } catch {
      /* fine */
    }
    window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'settings' }))
    setTimeout(() => window.dispatchEvent(new CustomEvent('life-settings-tab', { detail: 'ben' })), 300)
  }
  const addWater = async () => {
    if (life.coach?.deskDo && (await act(() => life.coach!.deskDo!({ op: 'water', ml: 250 }), '💧 +250 ml'))) loadStatus()
  }
  const statusLine = busy ? 'typing…' : status ? (status.move.kind === 'running' ? status.move.title : `Next: ${status.move.title}`) : 'your coach'

  return (
    <div className={`cx cf ${info ? 'info-open' : ''} ${typing ? 'typing' : ''}`}>
      <section className="cx-chat">
        {/* CL6: a calm header; CL7: today's numbers as small chips. */}
        <header className="cf-head">
          <button className="cf-who" onClick={() => setInfo((v) => !v)} title="Ben's desk: plan, goals, about you">
            <BenMark big />
            <span>
              <b>Ben</b>
              <small className={busy ? 'typing' : ''}>{statusLine}</small>
            </span>
          </button>
          {status && (
            <div className="cf-chips" role="list" aria-label="Today">
              <button role="listitem" onClick={() => (setTab('plan'), setInfo(true))} title="Must-dos: open the plan">
                Must-dos <b>{status.today.mustTotal ? `${status.today.mustDone}/${status.today.mustTotal}` : 'none'}</b>
              </button>
              {!!status.today.waterTarget && (
                <button role="listitem" onClick={() => void addWater()} title="Tap to add 250 ml">
                  Water <b>{(status.today.waterMl / 1000).toFixed(1)}/{(status.today.waterTarget / 1000).toFixed(1)} L</b>
                </button>
              )}
              <button role="listitem" onClick={() => (status.move.kind === 'focus' || status.move.kind === 'running' ? void doMove() : (setTab('today'), setInfo(true)))} title={status.move.kind === 'focus' ? 'Start focus' : 'Focus today'}>
                Focus <b>{status.today.focusMin >= 60 ? `${Math.floor(status.today.focusMin / 60)}h ${status.today.focusMin % 60}m` : `${status.today.focusMin} min`}</b>
              </button>
            </div>
          )}
          <div className="cf-head-tools">
            <button className={`icon-btn ${query != null ? 'on' : ''}`} onClick={() => setQuery((q) => (q == null ? '' : null))} aria-label="Search the chat" title="Search and filter">
              <Icon name="search" />
            </button>
            <button className={`icon-btn ${menu ? 'on' : ''}`} onClick={() => setMenu((v) => !v)} aria-label="More" aria-expanded={menu} title="More">
              ⋯
            </button>
            {menu && (
              <div className="cf-menu" role="menu" onClick={() => setMenu(false)}>
                <button role="menuitem" onClick={() => setInfo(true)}>Plan, goals and about you</button>
                <button role="menuitem" onClick={() => setExtras((v) => !v)}>{extras ? 'Hide shortcuts' : 'Show shortcuts'}</button>
                <button role="menuitem" onClick={openBrain}>Ben's brain (model and cost)</button>
                <button role="menuitem" onClick={() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'notebook' }))}>Notebook</button>
              </div>
            )}
          </div>
        </header>

        {query != null && (
          <div className="cx-search cf-search">
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
            {/* CM5: filters */}
            <div className="cf-filters" role="tablist" aria-label="Show">
              {(
                [
                  ['all', 'All'],
                  ['talk', 'Conversation'],
                  ['nudges', "Ben's nudges"],
                  ['logged', 'Logged']
                ] as const
              ).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {l}
                </button>
              ))}
            </div>
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

        {status && query == null && (!log?.length || extras) && (
          <div className="cx-strip cf-wide" role="list">
            <button role="listitem" className="cx-card" onClick={() => (setTab('plan'), setInfo(true))}>
              <small>Plan</small>
              <b>{status.plan.status === 'approved' ? 'Approved' : status.plan.status === 'proposed' ? 'Waiting for you' : 'Not yet'}</b>
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
              <b>{status.goals.length ? `${status.goals.length} active` : 'None yet'}</b>
              <span>{status.goals.length ? status.goals.slice(0, 2).map((g) => `${g.subject} ${g.pct}%`).join(' · ') : 'Add one with a deadline'}</span>
            </button>
          </div>
        )}

        {query == null && (!log?.length || extras) && (
          <div className="cx-deck cf-wide" role="toolbar" aria-label="Ben's big moves">
            {(
              [
                ['today', 'Rescue my day', false],
                ['plan', 'Plan my week', false],
                ['today', 'Stake a promise', false],
                ['plan', 'Coach call', !!deck?.callDue],
                ['money', 'Should I buy it?', false],
                ['you', 'My patterns', false],
                ['month', 'My month', false]
              ] as const
            ).map(([t, label, hot]) => (
              <button
                key={label}
                className={hot ? 'hot' : ''}
                disabled={busy}
                onClick={() => {
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
                {label}
                {label === 'Stake a promise' && !!deck?.stakes.filter((x) => x.status === 'open').length && <i className="n">{deck.stakes.filter((x) => x.status === 'open').length}</i>}
              </button>
            ))}
          </div>
        )}

        <div className="co-stream cx-stream cf-stream" ref={streamRef}>
          <div className="cf-col">
            {log === null && (
              <div className="cx-skel" aria-label="Loading your conversation">
                <i />
                <i className="me" />
                <i />
              </div>
            )}
            {log?.length === 0 && (
              <div className="co-hero cf-hero">
                <BenMark big />
                <h3>Talk to me like a friend.</h3>
                <p>I see your day, calendar, Todoist, sleep, training and money, and I can act: log things, plan blocks, book goals, hold you to promises.</p>
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
            {!!log?.length && !feed.some((x) => x.t === 'msg') && <p className="cf-empty">Nothing here with this filter.</p>}
            {log &&
              feed.map((it) => {
                if (it.t === 'divider')
                  return (
                    <div key={it.key} className="cf-divider">
                      <span>{it.label}</span>
                    </div>
                  )
                if (it.t === 'new')
                  return (
                    <div key={it.key} className="cf-new">
                      <span>New since {it.since}</span>
                    </div>
                  )
                if (it.t === 'fold') return <FoldLine key={it.key} item={it} log={log} open={!!openFolds[it.key]} onToggle={() => setOpenFolds((o) => ({ ...o, [it.key]: !o[it.key] }))} />
                const i = it.i
                const m = log[i]
                const flash = hits[hit] === i && query?.trim() ? 'flash' : ''
                const replyBtn = !m.pending && (
                  <button className="cf-reply" onClick={() => (setQuote(m), setTimeout(() => (document.querySelector('.cx-composer textarea') as HTMLTextAreaElement | null)?.focus(), 30))} title="Reply to this message">
                    ↩ Reply
                  </button>
                )
                if (m.role === 'me')
                  return (
                    <div key={it.key} id={`cx-m${i}`} className={`cf-row me ${it.grouped ? 'grouped' : ''} ${flash}`}>
                      <div className="cf-me">
                        {m.quote && <blockquote>{m.quote}</blockquote>}
                        {m.photo && <img className="cx-photo" src={m.photo} alt="Your photo" />}
                        <Rich text={m.text} highlight={query ?? ''} />
                      </div>
                      {m.failed ? (
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
                      ) : (
                        !it.grouped && <Meta m={m} />
                      )}
                    </div>
                  )
                if (it.kind !== 'talk')
                  return (
                    <div key={it.key} id={`cx-m${i}`} className={`cf-row ben nudge ${it.grouped ? 'grouped' : ''} ${flash}`}>
                      <BenMark ghost={it.grouped} />
                      <div className="cf-ben">
                        <NudgeCard m={m} kind={it.kind} info={it.info} repeats={it.repeats} settled={it.settled} latest={latestOf[it.kind] === i} status={status} deck={deck} onChange={() => (loadStatus(), onWallet())} />
                        <Receipts m={m} onUndo={(k) => void undoLine(m, k)} />
                        <div className="cf-foot">
                          <Meta m={m} />
                          {replyBtn}
                        </div>
                      </div>
                    </div>
                  )
                return (
                  <div key={it.key} id={`cx-m${i}`} className={`cf-row ben ${it.grouped ? 'grouped' : ''} ${flash}`}>
                    <BenMark ghost={it.grouped} />
                    <div className={`cf-ben ${m.pending ? 'pending' : ''}`}>
                      {m.pending ? (
                        // CM6: typing, with one short line about what Ben is doing.
                        <div className="cf-thinking">
                          <span className="co-typing">
                            <i />
                            <i />
                            <i />
                          </span>
                          {!!m.steps?.length && <span className="cf-step">{m.steps[m.steps.length - 1]}…</span>}
                          {m.streamed && m.text ? (
                            <div className="cf-text">
                              <Rich text={m.text} maxBold={2} />
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          {m.photo && <img className="cx-photo" src={m.photo} alt="" />}
                          <div className="cf-text">
                            <Rich text={m.text} reveal={!!m.fresh} highlight={query ?? ''} maxBold={2} />
                          </div>
                          <Receipts m={m} onUndo={(k) => void undoLine(m, k)} />
                          {(!!m.buttons?.length || !!m.show?.length) && <ReplyExtras m={m} status={status} latest={i === lastReply} busy={busy} onSay={(t) => void send(t)} onOpen={(t) => (setTab(t), setInfo(true))} onDone={() => (loadStatus(), onWallet())} />}
                          <div className="cf-foot">
                            {!it.grouped && <Meta m={m} />}
                            {!!m.steps?.length && (
                              <details className="cf-steps">
                                <summary>
                                  {m.steps.length} step{m.steps.length === 1 ? '' : 's'}
                                </summary>
                                <ul>
                                  {m.steps.map((st, k) => (
                                    <li key={k}>{st}</li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {replyBtn}
                            {life.coach?.feedback && <Feedback m={m} latest={i === lastReply} />}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            <div ref={end} />
          </div>
        </div>
        {unseen > 0 && (
          <button className="cx-newbtn" onClick={toBottom}>
            ↓ {unseen} new
          </button>
        )}

        <div className="cf-dock">
          {status && query == null && filter === 'all' && !!log?.length && <NowCard status={status} busy={busy} onDo={() => void doMove()} onNotYet={() => void send(`Not yet: ${(status.move as any).promise}`)} />}
          {!!log?.length && !busy && (
            <div className="cf-sugg">
              {chips.map((q) => (
                <button key={q} disabled={busy} onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          {slashHits.length > 0 && (
            <ul className="cf-slash" role="listbox" aria-label="Shortcuts">
              {slashHits.map((x) => (
                <li key={x.cmd}>
                  <button type="button" onClick={() => (setText(`${x.cmd} `), (document.querySelector('.cx-composer textarea') as HTMLTextAreaElement | null)?.focus())}>
                    <b>{x.cmd}</b> {x.hint}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="co-composer cx-composer cf-composer"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            {quote && (
              <div className="cf-quote">
                <span>
                  Replying to {quote.role === 'me' ? 'yourself' : 'Ben'}: {quote.text.replace(/\s+/g, ' ').slice(0, 90)}
                </span>
                <button type="button" onClick={() => setQuote(null)} aria-label="Cancel the reply">
                  ✕
                </button>
              </div>
            )}
            <div className="cf-input">
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
                <Icon name="plus" />
              </button>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`
                }}
                placeholder={listening ? 'Listening…' : typeof window !== 'undefined' && window.innerWidth < 600 ? 'Message Ben…' : 'Message Ben…  (type / for shortcuts)'}
                rows={1}
                aria-label="Message Ben"
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && quote) setQuote(null)
                  if (e.key === 'Tab' && slashHits.length) {
                    e.preventDefault()
                    setText(`${slashHits[0].cmd} `)
                  }
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              {Speech && (
                <button type="button" className={`cx-tool ${listening ? 'rec' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop dictation' : 'Dictate'} title={listening ? 'Listening… tap to stop' : 'Speak instead of typing'}>
                  🎙
                </button>
              )}
              <button className="cf-send" disabled={busy || (!text.trim() && !photo)} aria-label="Send" title="Send (Enter) · new line: Shift+Enter">
                {busy ? '…' : '↑'}
              </button>
            </div>
          </form>
        </div>
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
