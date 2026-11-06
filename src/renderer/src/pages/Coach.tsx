// Coach: one chat with your coach (the same brain and memory as the Telegram
// bots, so the conversation continues wherever you are), what it remembers
// about you (edit or delete), and the goals & rules it holds you to.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CoachMic, ReadAloudToggle, readAloud } from '../voice/CoachMic'
import { calendarDay, dayKey } from '@core/dates'
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
import { BenMark, FoldLine, Meta, NowCard, NudgeCard, Receipts, feedSections } from '../CoachFeed'
import { Bubble, CoachAmbient, GlyphIcon, Ring, StreamText, SuggestChip, TypingBubble } from '../CoachFeed'
import { BenAvatar, MeAvatar, avatarFromFile, useCoachLooks, type Presence } from '../BenAvatar'
import { CoachSide } from '../CoachSide'
import { PlanCard, ShowCards, cardKind } from '../CoachCards'
import { play } from '../soundKit'
import { reducedMotion } from '../motionKit'
import { useToastDock } from '../coachToastDock'
import { benStatus } from '@core/coachLooks'
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
  // Coach UI v3: the plan card opened from "Now: Approve" (when no reply shows it yet).
  const [planSpot, setPlanSpot] = useState(false)
  // ↑ in an empty box brings back your last message to edit and send again.
  const [editingLast, setEditingLast] = useState(false)
  const boxRef = useRef<HTMLTextAreaElement>(null)
  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(240, el.scrollHeight)}px`
  }
  useEffect(() => grow(boxRef.current), [text])
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
  // Ben's view of today (wide screens): open unless you folded it away.
  const [side, setSideRaw] = useState(() => {
    try {
      return localStorage.getItem('ls.coachSide') !== '0'
    } catch {
      return true
    }
  })
  const setSide = (v: boolean) => {
    setSideRaw(v)
    try {
      localStorage.setItem('ls.coachSide', v ? '1' : '0')
    } catch {
      /* fine */
    }
  }
  // Your photo: tap your face in the chat to change it.
  const [, saveLooks] = useCoachLooks(true)
  const meFile = useRef<HTMLInputElement>(null)
  // Pop-up notices dock beside or above the chat instead of covering it.
  const rootRef = useRef<HTMLDivElement>(null)
  useToastDock(rootRef)
  const pickMe = async (f: File | undefined) => {
    if (!f) return
    await act(async () => {
      if (!(await saveLooks({ me: await avatarFromFile(f) }))) throw new Error('Could not save your photo')
    }, 'Your photo is in the chat')
  }
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
      const today = calendarDay()
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
    let lastTop = el.scrollTop
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140
      // Only scrolling UP lets go of the bottom: cards that load in (the plan,
      // the tasks) make the page taller mid-scroll and must not unstick it.
      if (near) stuck = true
      else if (el.scrollTop < lastTop - 4) stuck = false
      lastTop = el.scrollTop
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
    setEditingLast(false)
    play('click')
    setText('')
    setPhoto(null)
    setBusy(true)
    const now = new Date().toISOString()
    setLog((l) => [...(l ?? []), { role: 'me', bot: 'mega', via: 'app', text: q && base ? base : t, at: now, photo: pic?.url, ...(q ? { quote: q.text.slice(0, 140) } : {}) }, { role: 'coach', bot: 'mega', via: 'app', text: '', at: now, pending: true }])
    readAloud.start()
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
          readAloud.feed(soFar)
          setLog((l) => (l ?? []).map((x) => (x.pending ? { ...x, text: soFar, streamed: true } : x)))
        }
      )
      readAloud.end(r.reply)
      play('tick')
      setLog((l) => [...(l ?? []).filter((x) => !x.pending), { role: 'coach', bot: 'mega', via: 'app', text: r.reply, done: r.done, mood: r.mood, at: r.at ?? new Date().toISOString(), undo: r.undo, chips: r.chips, buttons: r.buttons, show: r.show, cards: r.cards, fresh: !streamed, steps: seen.filter((x) => !/^Reading your day$/.test(x)) }])
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
      focusPlan()
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
  // Coach UI v3: scroll to the live plan card (or open one at the bottom) and make it glow once.
  const focusPlan = () => {
    const smooth: ScrollBehavior = reducedMotion() ? 'auto' : 'smooth'
    const cards = document.querySelectorAll<HTMLElement>('.cf-col .cf-plan.live')
    const el = cards[cards.length - 1]
    if (el) {
      el.scrollIntoView({ behavior: smooth, block: 'center' })
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
      return
    }
    setPlanSpot(true)
    setTimeout(() => document.querySelector('.cf-plan.spot')?.scrollIntoView({ behavior: smooth, block: 'center' }), 120)
  }
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
  // Coach UI v3: the newest card of each kind is the live one; older ones settle.
  const liveCard: Record<string, number> = {}
  ;(log ?? []).forEach((x, k) => x.role === 'coach' && x.show?.forEach((w) => cardKind(w) && (liveCard[cardKind(w)!] = k)))
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
  // Ben is alive: what he is doing shows on his face and under his name.
  const pendingMsg = busy ? (log ?? []).find((x) => x.pending) : undefined
  const presence: Presence = busy ? (pendingMsg?.streamed && pendingMsg.text ? 'typing' : 'thinking') : 'idle'
  const st = benStatus({ busy, streaming: presence === 'typing', step: pendingMsg?.steps?.[pendingMsg.steps.length - 1], running: status?.move.kind === 'running' ? status.move.title : null, hour: new Date().getHours() })
  const focusLabel = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n} min`)

  return (
    <div ref={rootRef} className={`cx cf cf2 ${info ? 'info-open' : ''} ${typing ? 'typing' : ''} ${side && status ? 'side-on' : ''} ${busy ? 'busy' : ''}`}>
      <section className="cx-chat">
        <CoachAmbient />
        {/* CL6: a rich header (Ben's face, what he is doing); CL7: today's numbers as small pills. */}
        <header className="cf-head">
          <button className="cf-who" onClick={() => setInfo((v) => !v)} title="Ben's desk: plan, goals, about you">
            <BenAvatar size={52} state={presence} ring online live />
            <span>
              <b>
                Ben <i className="cf-tag">AI coach</i>
              </b>
              <small className={`cf-status ${st.live ? 'typing' : ''}`} aria-live="polite">
                {st.live ? st.text : `Online · ${st.text}`}
              </small>
            </span>
          </button>
          {status && (
            <div className="cf-chips" role="list" aria-label="Today">
              <button role="listitem" className="p-must" onClick={() => (setTab('plan'), setInfo(true))} title="Must-dos: open the plan">
                <GlyphIcon kind="done" size={14} />
                {status.today.mustTotal ? (
                  <>
                    <b>
                      {status.today.mustDone}/{status.today.mustTotal}
                    </b>{' '}
                    must-dos
                  </>
                ) : (
                  'No must-dos yet'
                )}
              </button>
              {!!status.today.waterTarget && (
                <button role="listitem" className="p-water" onClick={() => void addWater()} title="Tap to add 250 ml">
                  <Ring value={status.today.waterMl / status.today.waterTarget} size={16} tone="water" />
                  <b>
                    {(status.today.waterMl / 1000).toFixed(1)}/{(status.today.waterTarget / 1000).toFixed(1)} L
                  </b>
                </button>
              )}
              <button role="listitem" className="p-focus" onClick={() => (status.move.kind === 'focus' || status.move.kind === 'running' ? void doMove() : (setTab('today'), setInfo(true)))} title={status.move.kind === 'focus' ? 'Start focus' : 'Focus today'}>
                <GlyphIcon kind="focus" size={14} />
                <b>{focusLabel(status.today.focusMin)}</b> focus
              </button>
            </div>
          )}
          <div className="cf-head-tools">
            {status && !side && (
              <button className="icon-btn cf-side-open" onClick={() => setSide(true)} aria-label="Show Ben's view of today" title="Ben's view of today">
                <GlyphIcon kind="review" />
              </button>
            )}
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
                    setTimeout(() => boxRef.current?.focus(), 30)
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
                <BenAvatar size={88} ring online live />
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
              feedSections(feed, (it, idx) => {
                // The last message of a group carries the face, the tail and the time.
                const nx = feed[idx + 1]
                const lastOfGroup = !(nx && nx.t === 'msg' && nx.grouped)
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
                const firstOfGroup = !it.grouped
                const reply = () => (setQuote(m), setTimeout(() => boxRef.current?.focus(), 30))
                const replyBtn = !m.pending && (
                  <button className="cf-reply" onClick={reply} title="Reply to this message">
                    ↩ Reply
                  </button>
                )
                if (m.role === 'me')
                  return (
                    <div key={it.key} id={`cx-m${i}`} className={`cf-row me ${it.grouped ? 'grouped' : ''} ${lastOfGroup ? 'last' : ''} ${flash}`}>
                      <div className="cf-me-line">
                        <Bubble m={m} mine tail={lastOfGroup} onReply={reply} className="cf-me">
                          {m.quote && <blockquote>{m.quote}</blockquote>}
                          {m.photo && <img className="cx-photo" src={m.photo} alt="Your photo" />}
                          <Rich text={m.text} highlight={query ?? ''} />
                        </Bubble>
                        {firstOfGroup ? <MeAvatar size={26} onPick={() => meFile.current?.click()} /> : <span className="cf-me-gap" />}
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
                        lastOfGroup && <Meta m={m} />
                      )}
                    </div>
                  )
                // Ben: his face and name only at the start of a group, then clean text.
                const who = firstOfGroup && (
                  <div className="cf-who-line">
                    <b>Ben</b>
                    <Meta m={m} />
                  </div>
                )
                if (it.kind !== 'talk')
                  return (
                    <div key={it.key} id={`cx-m${i}`} className={`cf-row ben nudge ${it.grouped ? 'grouped' : 'first'} ${lastOfGroup ? 'last' : ''} ${flash}`}>
                      <BenMark ghost={!firstOfGroup} />
                      <div className="cf-ben">
                        {who}
                        <NudgeCard m={m} kind={it.kind} info={it.info} repeats={it.repeats} settled={it.settled} latest={latestOf[it.kind] === i} status={status} deck={deck} onChange={() => (loadStatus(), onWallet())} />
                        <Receipts m={m} onUndo={(k) => void undoLine(m, k)} />
                        <div className="cf-foot">
                          {!firstOfGroup && <Meta m={m} />}
                          {replyBtn}
                        </div>
                      </div>
                    </div>
                  )
                const cards = (m.show ?? []).filter((w) => cardKind(w))
                const widgets = (m.show ?? []).filter((w) => !cardKind(w))
                return (
                  <div key={it.key} id={`cx-m${i}`} className={`cf-row ben ${it.grouped && !m.pending ? 'grouped' : 'first'} ${lastOfGroup || m.pending ? 'last' : ''} ${flash}`}>
                    {m.pending ? <BenMark state={presence} /> : <BenMark ghost={!firstOfGroup} />}
                    <div className={`cf-ben ${m.pending ? 'pending' : ''}`}>
                      {m.pending ? (
                        // CM6: what Ben is doing ("Checking your calendar…"); then his words stream in.
                        <>
                          <div className="cf-who-line">
                            <b>Ben</b>
                          </div>
                          {m.streamed && m.text ? (
                            <div className="cf-text cf-streaming">
                              <StreamText text={m.text} />
                            </div>
                          ) : (
                            <TypingBubble step={m.steps?.length ? m.steps[m.steps.length - 1] : undefined} steps={m.steps} />
                          )}
                        </>
                      ) : (
                        <>
                          {who}
                          {m.photo && <img className="cx-photo" src={m.photo} alt="" />}
                          <Bubble m={m} tail={lastOfGroup} onReply={reply} onUndo={() => void undoLine(m)}>
                            <div className="cf-text">
                              <Rich text={m.text} reveal={!!m.fresh} highlight={query ?? ''} maxBold={2} />
                            </div>
                          </Bubble>
                          <Receipts m={m} onUndo={(k) => void undoLine(m, k)} />
                          {cards.length > 0 && <ShowCards show={cards} live={(k) => liveCard[k] === i} status={status} onChange={() => (loadStatus(), onWallet())} onOpenPlan={focusPlan} />}
                          {(!!m.buttons?.length || !!widgets.length) && <ReplyExtras m={{ ...m, show: widgets }} status={status} latest={i === lastReply} busy={busy} onSay={(t) => void send(t)} onOpen={(t) => (setTab(t), setInfo(true))} onDone={() => (loadStatus(), onWallet())} />}
                          <div className="cf-foot">
                            {!firstOfGroup && <Meta m={m} />}
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
            {planSpot && (
              <div className="cf-row ben first last cf-spot">
                <BenMark />
                <div className="cf-ben">
                  <div className="cf-who-line">
                    <b>Ben</b>
                  </div>
                  <div className="cf-text">Here is today&apos;s plan. Look it over, then approve it or tell me what to change.</div>
                  <div className="cf-cards">
                    <PlanCard live spotlight onChange={() => (loadStatus(), onWallet())} />
                  </div>
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
        </div>
        {unseen > 0 && (
          <button className="cx-newbtn" onClick={toBottom}>
            ↓ {unseen} new
          </button>
        )}

        <div className="cf-dock">
          {/* CN2 + CM2: the one next thing and the suggestions, as one row of pills. */}
          {!!log?.length && (
            <div className="cf-sugg cf-rail" role="toolbar" aria-label="Suggestions">
              {status && query == null && filter === 'all' && <NowCard status={status} busy={busy} onDo={() => void doMove()} onNotYet={() => void send(`Not yet: ${(status.move as any).promise}`)} />}
              {!busy && chips.map((q) => <SuggestChip key={q} text={q} disabled={busy} onClick={() => void send(q)} />)}
            </div>
          )}
          {slashHits.length > 0 && (
            <ul className="cf-slash" role="listbox" aria-label="Shortcuts">
              {slashHits.map((x) => (
                <li key={x.cmd}>
                  <button type="button" onClick={() => (setText(`${x.cmd} `), boxRef.current?.focus())}>
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
            {editingLast && (
              <div className="cf-quote edit">
                <span>Editing your last message · Enter sends it again</span>
                <button type="button" onClick={() => (setEditingLast(false), setText(''))} aria-label="Stop editing">
                  ✕
                </button>
              </div>
            )}
            {photo && (
              <div className="cf-attachments">
                <span className="cx-attach">
                  <img src={photo.url} alt="" />
                  <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo">
                    ✕
                  </button>
                </span>
              </div>
            )}
            <div className="cf-input">
              <textarea
                ref={boxRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  grow(e.target)
                }}
                placeholder={listening ? 'Listening…' : typeof window !== 'undefined' && window.innerWidth < 600 ? 'Message Ben…' : 'Message Ben…  (type / for shortcuts)'}
                rows={1}
                aria-label="Message Ben"
                onFocus={() => setTyping(true)}
                onBlur={() => setTyping(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && quote) setQuote(null)
                  if (e.key === 'Escape' && editingLast) (setEditingLast(false), setText(''))
                  if (e.key === 'Tab' && slashHits.length) {
                    e.preventDefault()
                    setText(`${slashHits[0].cmd} `)
                  }
                  // ↑ in an empty box: your last message comes back to edit.
                  if (e.key === 'ArrowUp' && !text && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
                    const last = [...(log ?? [])].reverse().find((x) => x.role === 'me' && x.text)
                    if (last) {
                      e.preventDefault()
                      setText(last.text)
                      setEditingLast(true)
                      requestAnimationFrame(() => {
                        const el = boxRef.current
                        if (el) el.selectionStart = el.selectionEnd = el.value.length
                      })
                    }
                  }
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="cf-tools-row">
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files?.[0]).then(() => (e.target.value = ''))} />
                <button type="button" className="cx-tool cf-attach" onClick={() => fileRef.current?.click()} aria-label="Send a photo" title="Photo (a receipt, a meal…)">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m20.5 11.5-8.3 8.3a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.6-7.6" />
                  </svg>
                </button>
                <span className="cf-hint" aria-hidden>
                  <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line · <kbd>↑</kbd> edit last
                </span>
                {/* JV7: push-to-talk (sends when you stop) and 🔊 read-aloud. */}
                <CoachMic base={text} disabled={busy} onListening={setListening} onText={(t, final) => (final ? void send(t) : setText(t))} />
                <ReadAloudToggle />
                <button className={`cf-send ${busy ? 'busy' : text.trim() || photo ? 'ready' : ''}`} disabled={busy || (!text.trim() && !photo)} aria-label="Send" title="Send (Enter) · new line: Shift+Enter">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
                  </svg>
                </button>
              </div>
            </div>
          </form>
        </div>
        {status && side && <CoachSide status={status} onClose={() => setSide(false)} onPlan={focusPlan} onOpen={(t) => (setTab(t), setInfo(true))} onWater={() => void addWater()} onFocus={() => void (status.move.kind === 'focus' || status.move.kind === 'running' ? doMove() : send('Start a 25 minute focus block on my most important task.'))} />}
        <input ref={meFile} type="file" accept="image/*" hidden onChange={(e) => void pickMe(e.target.files?.[0]).then(() => (e.target.value = ''))} />
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
  const today = dayKey(new Date())
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
  const today = dayKey(new Date())
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
