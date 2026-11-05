// One Goals page (FT3): every goal in one list. Goals with a deadline and
// hours (what Ben's "goal:" writes too), goals Ben tracks with you, and this
// week's big 3. Each shows its deadline, hours left, this week's share,
// today's block and whether you're on track. Below: the cyber security
// learning path (FT8), which pays no points itself.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useLive } from '../live'
import { useAction } from '../ui'
import { useTodayEvents } from '../todayEvents'
import type { PageId } from '../modules'
import type { GoalsView } from '../web/lifeExtras'
import type { BoardGoal } from '@core/goalsBoard'
import { TRACKS, TRACK_IDS, type LearnTrack } from '@core/learnPath'
import { PageSkeleton } from '../blocks'
import '../lifeExtras.css'

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}` : `${min} min`)
const dayText = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const STATUS: Record<BoardGoal['status'], string> = { done: 'Done', ahead: 'Ahead', 'on track': 'On track', behind: 'Behind', late: 'Deadline passed', tracked: 'Ben tracks it' }

const blank = { title: '', subject: '', deadline: '', hours: '' }

export function Goals({ onGo }: { onGo?: (p: PageId) => void }) {
  const act = useAction()
  const { events } = useTodayEvents()
  const [v, setV] = useState<GoalsView | null>(null)
  const [form, setForm] = useState(blank)
  const [adding, setAdding] = useState(false)
  const load = useCallback(() => {
    life.extras?.goals(events).then(setV).catch(() => {})
  }, [events])
  useEffect(load, [load])
  useLive(load)
  if (!life.extras) return <p className="hint">Goals need the web app.</p>
  if (!v) return <PageSkeleton />

  const save = async () => {
    const hours = Number(form.hours)
    const r = await act(() => life.focus.saveGoal({ title: form.title.trim(), subject: (form.subject || form.title).trim(), deadline: form.deadline, hours }), `Goal added: ${form.title.trim()}`)
    if (r) {
      setForm(blank)
      setAdding(false)
      load()
    }
  }
  const archive = async (g: BoardGoal) => {
    if (!g.id) return
    if (await act(() => life.focus.archiveGoal(g.id!), `${g.title}: off the list`)) load()
  }
  const focus = async (g: BoardGoal) => {
    const min = Math.max(25, Math.min(90, g.todayLeftMin || 50))
    if (await act(() => life.focus.start(g.subject ?? g.title, min), `Focus started: ${g.subject ?? g.title} · ${min} min`)) window.dispatchEvent(new CustomEvent('life-focus-changed'))
  }
  const open = v.goals.filter((g) => g.status !== 'done')
  const behind = open.filter((g) => g.onTrack === false).length

  return (
    <div className="gl">
      <section className="panel gl-head">
        <div>
          <span className="rv-kicker">Your goals</span>
          <h2>{open.length ? `${open.length} open${behind ? ` · ${behind} behind` : open.some((g) => g.onTrack) ? ' · on track' : ''}` : 'No goals yet'}</h2>
          <p className="hint small">Goals with a deadline and hours are planned backward: the minutes a day you need, and the blocks Ben books. Tell Ben "goal: Rust book | Rust | 2026-12-20 | 30" and it lands here too.</p>
        </div>
        <button className="btn primary small" onClick={() => setAdding((x) => !x)} aria-expanded={adding}>
          {adding ? 'Close' : '+ Add a goal'}
        </button>
      </section>

      {adding && (
        <form
          className="panel gl-form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Goal, e.g. Math exam" maxLength={80} required aria-label="Goal" />
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Focus subject, e.g. Math" maxLength={40} aria-label="Subject" />
          <input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} required aria-label="Deadline" />
          <input value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value.replace(/[^\d.]/g, '') })} placeholder="Hours it needs" inputMode="decimal" required aria-label="Hours" />
          <button className="btn primary small" disabled={!form.title.trim() || !form.deadline || !(Number(form.hours) > 0)}>
            Save goal
          </button>
        </form>
      )}

      <div className="gl-list">
        {v.goals.map((g) => (
          <article key={g.key} className={`panel gl-goal ${g.onTrack === false ? 'behind' : g.status === 'done' ? 'done' : ''}`}>
            <header>
              <div>
                <b>{g.title}</b>
                <small className="hint">
                  {g.subject && g.subject.toLowerCase() !== g.title.toLowerCase() ? `${g.subject} · ` : ''}
                  {g.deadline ? `due ${dayText(g.deadline)}${g.daysLeft != null ? ` · ${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left` : ''}` : 'no deadline'}
                </small>
              </div>
              <span className={`gl-pill ${g.onTrack === true ? 'good' : g.onTrack === false ? 'bad' : ''}`}>
                {STATUS[g.status]}
                {g.status === 'behind' && g.aheadH ? ` ${Math.abs(g.aheadH)}h` : g.status === 'ahead' && g.aheadH ? ` ${g.aheadH}h` : ''}
              </span>
            </header>
            {g.source === 'goal' ? (
              <dl className="gl-nums">
                <div>
                  <dt>Hours left</dt>
                  <dd>{g.hoursLeft}h</dd>
                </div>
                <div>
                  <dt>This week</dt>
                  <dd>{g.weekLeftMin ? hm(g.weekLeftMin) : 'done'}</dd>
                </div>
                <div>
                  <dt>Today</dt>
                  <dd>{g.todayBlock ? `${g.todayBlock.start}–${g.todayBlock.end}` : g.todayLeftMin ? `${hm(g.todayLeftMin)} left` : 'done'}</dd>
                </div>
              </dl>
            ) : (
              <p className="hint small">{g.weekly ? `Weekly target: ${g.weekly}. ` : ''}Ben tracks this one with you. Give it hours and a deadline above to plan it backward.</p>
            )}
            {g.source === 'goal' && g.status !== 'done' && (
              <div className="gl-actions">
                {!!g.todayLeftMin && (
                  <button className="btn small primary" onClick={() => void focus(g)}>
                    ▶ Focus on {g.subject}
                  </button>
                )}
                {!g.todayBlock && !!g.todayLeftMin && (
                  <button className="btn small ghost" onClick={() => onGo?.('coach')} title="Ask Ben to book blocks for your goals">
                    Book blocks with Ben
                  </button>
                )}
                <button className="btn small ghost" onClick={() => void archive(g)}>
                  Remove
                </button>
              </div>
            )}
            {g.source === 'goal' && g.status === 'done' && (
              <div className="gl-actions">
                <button className="btn small ghost" onClick={() => void archive(g)}>
                  Archive
                </button>
              </div>
            )}
          </article>
        ))}
        {!v.goals.length && <p className="hint">Add an exam, project or skill with a deadline and the hours it needs.</p>}
      </div>

      {v.week.length > 0 && (
        <section className="panel gl-week">
          <header className="rv-head">
            <h3>This week's big 3</h3>
            <small className="hint">from your week plan and Sunday call</small>
          </header>
          <ul>
            {v.week.map((w) => (
              <li key={w.text} className={w.done ? 'done' : ''}>
                <span>{w.done ? '✓' : '○'}</span> {w.text} <small className="hint">{w.from}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LearningPath v={v} onChange={setV} />
    </div>
  )
}

function LearningPath({ v, onChange }: { v: GoalsView; onChange: (v: GoalsView) => void }) {
  const act = useAction()
  const [track, setTrack] = useState<LearnTrack>('ctf')
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [link, setLink] = useState('')
  const add = async () => {
    const r = await act(() => life.extras!.addLearning({ track, title, tag, link: link || null }), `Logged: ${title.trim()}`)
    if (r) {
      onChange({ ...r, goals: v.goals, week: v.week })
      setTitle('')
      setTag('')
      setLink('')
    }
  }
  const remove = async (id: string) => {
    const r = await act(() => life.extras!.removeLearning(id))
    if (r) onChange({ ...r, goals: v.goals, week: v.week })
  }
  const start = async (subject: string) => {
    await act(() => life.focus.start(subject, 50), `Focus started: ${subject} · 50 min`)
  }
  return (
    <section className="panel lp" aria-label="Cyber security path">
      <header className="rv-head">
        <h3>Cyber security path</h3>
        <small className="hint">log what you finish; no points here, the focus timer pays for the time</small>
      </header>
      {v.learnNext && (
        <p className="lp-next">
          Next block: <b>{v.learnNext.subject}</b> <small className="hint">({v.learnNext.why})</small>
          <button className="btn small ghost" onClick={() => void start(v.learnNext!.subject)}>
            ▶ 50 min
          </button>
        </p>
      )}
      <div className="lp-grid">
        {v.learn.map((t) => (
          <div key={t.track} className="lp-track">
            <div className="sk-top">
              <b>{t.label}</b>
              <small>
                {t.count} {t.unit}
                {t.count === 1 ? '' : 's'}
              </small>
            </div>
            <div className="sk-steps" aria-hidden="true">
              {Array.from({ length: t.total }, (_, i) => (
                <i key={i} className={i < t.level ? 'on' : i === t.level ? 'now' : ''} />
              ))}
            </div>
            <p className="hint small">
              {t.current ? `Now: ${t.current}` : 'Not started'}
              {t.next ? ` · ${t.next.at - t.count} more to "${t.next.name}"` : ' · ladder complete 🏆'}
            </p>
            {t.recent.length > 0 && (
              <ul className="lp-recent">
                {t.recent.map((e) => (
                  <li key={e.id}>
                    {e.link ? (
                      <a href={e.link} target="_blank" rel="noreferrer noopener">
                        {e.title}
                      </a>
                    ) : (
                      <span>{e.title}</span>
                    )}
                    {e.tag && <small className="lp-tag">#{e.tag}</small>}
                    <button className="lp-x" onClick={() => void remove(e.id)} aria-label={`Remove ${e.title}`} title="Remove">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <form
        className="lp-add"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <select value={track} onChange={(e) => setTrack(e.target.value as LearnTrack)} aria-label="Track">
          {TRACK_IDS.map((t) => (
            <option key={t} value={t}>
              {TRACKS[t].label}
            </option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={TRACKS[track].placeholder} maxLength={120} aria-label="What you did" />
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag, e.g. web" maxLength={30} aria-label="Tag" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link (optional)" maxLength={300} aria-label="Link" />
        <button className="btn small primary" disabled={!title.trim()}>
          Log it
        </button>
      </form>
    </section>
  )
}
