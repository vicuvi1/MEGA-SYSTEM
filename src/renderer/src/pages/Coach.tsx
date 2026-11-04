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
import { readDo } from '@core/coachButtons'

type Entry = { role: 'me' | 'coach'; bot: string; via: string; text: string; done?: string[]; at: string; pending?: boolean; steps?: string[]; mood?: string; undo?: unknown[]; undone?: boolean[]; chips?: string[]; fresh?: boolean; photo?: string; buttons?: { label: string; do: string }[]; show?: string[] }
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
  const [info, setInfo] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1400)
  const [tab, setTab] = useState<'plan' | 'goals' | 'score' | 'about'>('plan')
  const end = useRef<HTMLDivElement>(null)
  const loadStatus = useCallback(() => {
    life.coach?.status?.().then(setStatus).catch(() => {})
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
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [log?.length])
  // Stay at the bottom while a reply types itself out or widgets appear (unless you scrolled up).
  const streamRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = streamRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let stuck = true
    const onScroll = () => (stuck = el.scrollHeight - el.scrollTop - el.clientHeight < 140)
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
      const r = await life.coach.chat(
        t,
        (st) => {
          if (seen.includes(st)) return
          seen.push(st)
          setLog((l) => (l ?? []).map((x) => (x.pending ? { ...x, steps: [...seen] } : x)))
        },
        pic ? { mime: 'image/jpeg', data: pic.data } : undefined
      )
      setLog((l) => [...(l ?? []).filter((x) => !x.pending), { role: 'coach', bot: 'mega', via: 'app', text: r.reply, done: r.done, mood: r.mood, at: r.at ?? new Date().toISOString(), undo: r.undo, chips: r.chips, buttons: r.buttons, show: r.show, fresh: true, steps: seen.filter((x) => !/^Reading your day$/.test(x)) }])
      if (r.done.length) onWallet()
      void life.coach.memory().then((m) => setFacts(m.facts)).catch(() => {})
      void life.coach.mind?.().then(setMind).catch(() => {})
    } catch (e) {
      setLog((l) => [...(l ?? []).filter((x) => !x.pending), { role: 'coach', bot: 'mega', via: 'app', text: `I couldn't answer: ${(e as Error).message}`, at: new Date().toISOString() }])
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

  return (
    <div className={`cx ${info ? 'info-open' : ''}`}>
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
            🧠 {model ? model.replace(/^.*\//, '').replace(/-\d{3,}$/, '') : 'coach'}
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
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your chats with Ben…" onKeyDown={(e) => e.key === 'Escape' && setQuery(null)} />
            <span>{query.trim() ? `${(log ?? []).filter((m) => m.text.toLowerCase().includes(query.trim().toLowerCase())).length} found` : ''}</span>
          </div>
        )}

        {status && query == null && (
          <div className={`cx-pin move-${status.move.kind}`}>
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
            </div>
          </div>
        )}

        {status && query == null && (
          <div className="cx-strip" role="list">
            <button role="listitem" className="cx-card" onClick={() => (setTab('plan'), setInfo(true))}>
              <small>Plan</small>
              <b>{status.plan.status === 'approved' ? '✓ Approved' : status.plan.status === 'proposed' ? 'Waiting for you' : 'Not yet'}</b>
              <span>{status.plan.score != null ? `Day score ${status.plan.score}/100` : status.plan.status === 'none' ? 'Tap “Plan it”' : `${status.plan.mustdos} must-dos · ${status.plan.blocks} blocks`}</span>
            </button>
            <button role="listitem" className={`cx-card ${status.promises.missed ? 'warn' : ''}`} onClick={() => (setTab('score'), setInfo(true))}>
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

        <div className="co-stream cx-stream" ref={streamRef}>
          {log === null && <p className="hint">Loading your conversation…</p>}
          {log?.length === 0 && (
            <div className="co-hero">
              <span className="co-avatar">{face}</span>
              <h3>Talk to me like a friend.</h3>
              <p>I see your day, calendar, Todoist, sleep, training and money, and I can act: log things, plan blocks, book goals, hold you to promises.</p>
              <div className="co-cards">
                {CARDS.map((c) => (
                  <button key={c.title} className="co-card" disabled={busy} onClick={() => void send(c.ask)}>
                    <b>{c.title}</b>
                    <small>{c.sub}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {log?.map((m, i) => {
            if (query?.trim() && !m.text.toLowerCase().includes(query.trim().toLowerCase())) return null
            const prev = log[i - 1]
            const day = new Date(m.at).toDateString()
            const newDay = !prev || new Date(prev.at).toDateString() !== day
            const grouped = !newDay && prev && prev.role === m.role && Date.parse(m.at) - Date.parse(prev.at) < 5 * 60000
            return (
              <div key={i} className="cx-item">
                {newDay && <div className="cx-day">{dayLabel(m.at)}</div>}
                <div className={`co-row ${m.role} ${grouped ? 'grouped' : ''}`}>
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
                          {!!m.steps?.length && (
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
                          {!!m.steps?.length && <div className="co-steps-done">{m.steps.join(' · ')}</div>}
                          {m.photo && <img className="cx-photo" src={m.photo} alt="Your photo" />}
                          {m.role === 'coach' ? <Rich text={m.text} reveal={!!m.fresh} highlight={query ?? ''} /> : <Rich text={m.text} highlight={query ?? ''} />}
                        </>
                      )}
                      {!!m.done?.length && (
                        <ul className="cx-actions">
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
                      {!m.pending && (!!m.buttons?.length || !!m.show?.length) && <ReplyExtras m={m} status={status} latest={i === (log?.length ?? 0) - 1} busy={busy} onSay={(t) => void send(t)} onOpen={(t) => (setTab(t), setInfo(true))} onDone={() => (loadStatus(), onWallet())} />}
                      {!m.pending && m.role === 'coach' && life.coach?.feedback && <Feedback m={m} />}
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
        {!!log?.length && (
          <div className="co-quick cx-quick">
            {([...(log ?? [])].reverse().find((x) => x.role === 'coach' && !x.pending)?.chips?.length ? [...(log ?? [])].reverse().find((x) => x.role === 'coach' && !x.pending)!.chips! : QUICK).map((q) => (
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
            <small>Your coach · same memory on Telegram</small>
          </div>
          <button className="icon-btn cx-close" onClick={() => setInfo(false)} aria-label="Close">
            ✕
          </button>
        </div>
        <nav className="cx-tabs" role="tablist">
          {(
            [
              ['plan', 'Plan'],
              ['goals', 'Goals'],
              ['score', 'Score'],
              ['about', 'About you']
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="cx-tab-body">
          {tab === 'plan' && (
            <>
              <CoachPlan onChange={loadStatus} />
              <RhythmSettings />
            </>
          )}
          {tab === 'goals' && <GoalPlans />}
          {tab === 'score' && <CoachScorecard />}
          {tab === 'about' && (
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
          )}
        </div>
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

/** Coach text with numbers in bold (and search hits marked); a new reply types itself out. */
function Rich({ text, reveal = false, highlight = '' }: { text: string; reveal?: boolean; highlight?: string }) {
  const [n, setN] = useState(reveal ? 0 : text.length)
  useEffect(() => {
    if (!reveal || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setN(text.length)
    setN(0)
    const step = Math.max(2, Math.ceil(text.length / 60))
    const t = setInterval(() => setN((x) => (x + step >= text.length ? (clearInterval(t), text.length) : x + step)), 16)
    return () => clearInterval(t)
  }, [text, reveal])
  const shown = text.slice(0, n)
  const h = highlight.trim().toLowerCase()
  // Numbers with their unit in bold ("25 min", "1.9/2.7", "750 ml"), never half a word ("10 min|utes").
  const parts = shown.split(/(\d+(?:[.,:]\d+)*(?:\s?(?:min|h|ml|L|lei|MDL|km|kg|reps|days?)(?![\p{L}])|%|\/\d+(?:[.,]\d+)?)?)/gu)
  return (
    <span className="cx-rich">
      {parts.map((p, i) => {
        const hit = h && p.toLowerCase().includes(h)
        if (i % 2 === 1) return <b key={i} className={hit ? 'hit' : ''}>{p}</b>
        if (!hit) return p
        const k = p.toLowerCase().indexOf(h)
        return (
          <span key={i}>
            {p.slice(0, k)}
            <mark>{p.slice(k, k + h.length)}</mark>
            {p.slice(k + h.length)}
          </span>
        )
      })}
      {n < text.length && <i className="cx-caret" />}
    </span>
  )
}

/** Buttons and live mini-widgets under a coach reply (interactive replies). */
function ReplyExtras({ m, status, latest, busy, onSay, onOpen, onDone }: { m: Entry; status: CoachStatus | null; latest: boolean; busy: boolean; onSay: (t: string) => void; onOpen: (tab: 'plan' | 'goals' | 'score' | 'about') => void; onDone: () => void }) {
  const act = useAction()
  const [used, setUsed] = useState<Record<number, boolean>>({})
  const run = async (k: number, b: { label: string; do: string }) => {
    const d = readDo(b.do)
    if (!d) return
    let ok: unknown = true
    if (d.k === 'focus') ok = await act(() => life.focus.start(d.subject, d.minutes, null), `Focus started: ${d.subject} · ${d.minutes} min`)
    else if (d.k === 'approve') ok = await act(() => life.coach!.rhythm!('approve'), 'Approved: blocks in your calendar, must-dos on Today')
    else if (d.k === 'plan') ok = await act(() => life.coach!.rhythm!('propose'), "Today's plan is ready (Plan tab)")
    else if (d.k === 'book') {
      const g = status?.goals.find((x) => x.title.toLowerCase().includes(d.goal.toLowerCase()) || d.goal.toLowerCase().includes(x.title.toLowerCase()))
      const r = await act(() => life.coach!.rhythm!('book', g ? String(g.id) : undefined))
      ok = r
      if (r?.lines?.length) await act(async () => r, r.lines.join(' · '))
    } else if (d.k === 'say') onSay(d.text)
    else if (d.k === 'workout' || d.k === 'water') window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'body' }))
    else onOpen(d.tab)
    if (ok && d.k !== 'open' && d.k !== 'workout' && d.k !== 'water') setUsed((u) => ({ ...u, [k]: true }))
    if (ok) onDone()
  }
  const tick = async (i: number) => {
    if (await act(() => life.focus.togglePlan(i))) onDone()
  }
  return (
    <div className="cx-extras">
      {status &&
        m.show?.map((w) => {
          // Live widgets show today's numbers; on old messages they'd be misleading, so only the latest shows them.
          if (!latest) return null
          if (w === 'focus-week') {
            const max = Math.max(30, ...status.week.map((d) => d.min))
            return (
              <div key={w} className="cx-w cx-w-week">
                <small>Focus · last 7 days · {(status.week.reduce((t, d) => t + d.min, 0) / 60).toFixed(1)}h</small>
                <div className="cx-bars">
                  {status.week.map((d) => (
                    <span key={d.day} title={`${d.day}: ${d.min} min`}>
                      <i style={{ height: `${Math.max(3, (d.min / max) * 100)}%` }} className={d.min >= 50 ? 'ok' : ''} />
                      <em>{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' })}</em>
                    </span>
                  ))}
                </div>
              </div>
            )
          }
          if (w === 'goals')
            return (
              <div key={w} className="cx-w">
                <small>Goals</small>
                {status.goals.length ? (
                  status.goals.map((g) => (
                    <div key={g.id} className="cx-w-goal">
                      <span>{g.title}</span>
                      <div className="gp-bar">
                        <i style={{ width: `${g.pct}%` }} />
                      </div>
                      <em className={g.status === 'behind' ? 'bad' : ''}>
                        {g.pct}% · {g.perDayMin} min/day
                      </em>
                    </div>
                  ))
                ) : (
                  <span className="hint small">No goals yet.</span>
                )}
              </div>
            )
          if (w === 'water' && status.today.waterTarget)
            return (
              <div key={w} className="cx-w">
                <small>
                  💧 Water · {(status.today.waterMl / 1000).toFixed(1)} of {(status.today.waterTarget / 1000).toFixed(1)} L
                </small>
                <div className="gp-bar water">
                  <i style={{ width: `${Math.min(100, (status.today.waterMl / status.today.waterTarget) * 100)}%` }} />
                </div>
              </div>
            )
          if (w === 'mustdos')
            return (
              <div key={w} className="cx-w">
                <small>Must-dos</small>
                {status.mustdos.length ? (
                  status.mustdos.map((x) => (
                    <label key={x.i} className={`cx-w-check ${x.done ? 'done' : ''}`}>
                      <input type="checkbox" checked={x.done} onChange={() => void tick(x.i)} /> {x.text}
                    </label>
                  ))
                ) : (
                  <span className="hint small">No must-dos today.</span>
                )}
              </div>
            )
          if (w === 'plan')
            return (
              <button key={w} className="cx-w cx-w-link" onClick={() => onOpen('plan')}>
                <small>Today's plan</small>
                <b>{status.plan.status === 'none' ? 'Not made yet' : status.plan.status === 'proposed' ? 'Waiting for your approval' : 'Approved'}</b>
                <span>{status.plan.headline}</span>
              </button>
            )
          if (w === 'promises')
            return (
              <div key={w} className="cx-w">
                <small>Promises · 7 days</small>
                <b>
                  {status.promises.kept} kept · {status.promises.missed} missed
                </b>
              </div>
            )
          return null
        })}
      {!!m.buttons?.length && (
        <div className="cx-btns">
          {m.buttons.map((b, k) => (
            <button key={k} className={`cx-btn ${used[k] ? 'used' : ''}`} disabled={busy || used[k]} onClick={() => void run(k, b)}>
              {used[k] ? `✓ ${b.label}` : b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 👍 👎 📏 ❌ under Ben's replies: he learns what you like. */
function Feedback({ m }: { m: Entry }) {
  const [sent, setSent] = useState<string | null>(null)
  const give = async (kind: 'up' | 'down' | 'long' | 'wrong') => {
    setSent(kind)
    await life.coach?.feedback?.(m.at, kind).catch(() => setSent(null))
  }
  if (sent) return <span className="cx-fb done">{sent === 'up' ? '👍 thanks' : sent === 'long' ? '📏 noted: shorter' : sent === 'wrong' ? '❌ noted: tell me what' : '👎 noted'}</span>
  return (
    <span className="cx-fb" aria-label="Rate this reply">
      <button onClick={() => void give('up')} title="Good reply">
        👍
      </button>
      <button onClick={() => void give('down')} title="Not helpful">
        👎
      </button>
      <button onClick={() => void give('long')} title="Too long">
        📏
      </button>
      <button onClick={() => void give('wrong')} title="Wrong">
        ❌
      </button>
    </span>
  )
}
