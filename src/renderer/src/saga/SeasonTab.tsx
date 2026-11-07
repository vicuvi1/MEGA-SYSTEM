// LF1: the season you are in. A cover from the wallpaper art, the 8 chapters
// as a path, the boss with its HP bar, the three main quests, today's daily
// quests (all three done hits the boss), your Hunter rank and Ben's path.
import { useMemo, useState, type CSSProperties } from 'react'
import { life } from '../bridge'
import { useAction } from '../ui'
import { artUrl } from '../wallpaper/art'
import { barFill } from '../motionKit'
import { BOSS_KINDS, CHAPTERS, SEASON_THEMES, SEASON_WEEKS, nextMonday, type BossKind, type SeasonTheme } from '@core/season'
import { WHEEL_AREAS } from '@core/lifeWheel'
import type { SagaView } from '../web/sagaStore'
import { BenArcAvatar, BossSigil, VisionArtSvg } from './sagaArt'
import { Select } from '../Select'

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export function SeasonTab({ v, onIntro, onRecap, onArc, onTab }: { v: SagaView; onIntro: () => void; onRecap: () => void; onArc: () => void; onTab: (t: string) => void }) {
  const act = useAction()
  const [sheet, setSheet] = useState<SeasonTheme | 'own' | 'pick' | null>(null)
  const c = v.current
  if (!c) return (
    <>
      <EmptySeason v={v} onPick={setSheet} />
      {sheet && <NewSeason v={v} start={sheet} onClose={() => setSheet(null)} />}
    </>
  )
  const s = c.season
  const p = c.progress
  const cover = artUrl(s.cover)
  const bossOpen = p.phase === 'boss-week' || p.phase === 'over' || p.daysToBoss <= 7
  const hpPct = c.boss.hp / c.boss.max
  return (
    <div className="sg-season" style={{ '--sc': s.color } as CSSProperties}>
      <section className="sg-hero">
        {cover && <img className="sg-hero-art" src={cover} alt="" aria-hidden="true" />}
        <div className="sg-hero-shade" aria-hidden="true" />
        <div className="sg-hero-body">
          <span className="sg-kicker">Season {c.number} · {p.phase === 'before' ? `starts ${fmtDay(s.start)}` : p.phase === 'over' ? 'complete' : `chapter ${p.week} of ${SEASON_WEEKS}`}</span>
          <h1 className="sg-title">{s.name}</h1>
          {s.theme && <p className="sg-theme">{s.theme}</p>}
          <ol className="sg-path" aria-label="The eight chapters">
            {CHAPTERS.map((name, i) => {
              const state = i + 1 < p.week ? 'done' : i + 1 === p.week && p.phase !== 'over' ? 'now' : p.phase === 'over' ? 'done' : 'next'
              return (
                <li key={name} className={`sg-step ${state}`} title={`Week ${i + 1}: ${name}`}>
                  <i />
                  <small>{i + 1 === SEASON_WEEKS ? '⚔' : i + 1}</small>
                </li>
              )
            })}
          </ol>
          <div className="sg-hero-meta">
            {p.phase !== 'before' && p.phase !== 'over' && <span className="sg-pill">{p.chapter}</span>}
            <span className="sg-pill">{p.phase === 'over' ? 'Finished' : `${p.daysLeft} days left`}</span>
            <span className="sg-pill">⚡ {c.xp.toLocaleString('en-GB')} XP this season</span>
            <span className="sg-pill">✦ {c.perfectDays} perfect days</span>
          </div>
          <div className="sg-hero-actions">
            <button className="btn" onClick={onIntro}>▶ Watch the intro</button>
            {c.recap && <button className="btn primary" onClick={onRecap}>📜 Season recap</button>}
            <button className="btn ghost" onClick={() => setSheet('pick')}>New season…</button>
          </div>
        </div>

        <aside className={`sg-boss ${c.boss.result === 'won' ? 'won' : ''} ${c.boss.ready ? 'ready' : ''}`} aria-label="The final boss">
          <div className="sg-boss-head">
            <BossSigil kind={s.boss.kind} color={s.color} size={64} />
            <div>
              <span className="sg-kicker">Final boss · {fmtDay(s.boss.day)}</span>
              <b className="sg-boss-name">{s.boss.title}</b>
            </div>
          </div>
          <div className="sg-hp" role="meter" aria-label="Boss HP" aria-valuemin={0} aria-valuemax={c.boss.max} aria-valuenow={c.boss.hp}>
            <div className="sg-hp-track pbar"><i style={barFill(hpPct)} /></div>
            <div className="sg-hp-ticks" aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <span key={i} />)}</div>
          </div>
          <div className="sg-hp-row">
            <b>{c.boss.result === 'won' ? 'Defeated' : `HP ${c.boss.hp} / ${c.boss.max}`}</b>
            <small>{c.boss.result === 'won' ? `on ${fmtDay(s.boss.resultDay ?? s.boss.day)}` : c.boss.ready ? 'Only the real fight is left' : p.daysToBoss > 0 ? `${p.daysToBoss} days to the fight` : p.daysToBoss === 0 ? 'Fight day' : 'Fight day passed'}</small>
          </div>
          {c.boss.hits.length > 0 && c.boss.result !== 'won' && (
            <ul className="sg-hits">
              {c.boss.hits.map((h) => (
                <li key={h.id}><span>{h.label}</span><b>−{h.hp}</b></li>
              ))}
              <li className="final"><span>The real fight</span><b>−10</b></li>
            </ul>
          )}
          {bossOpen && !c.boss.result && (
            <div className="sg-boss-actions">
              <button className="btn primary" onClick={() => act(() => life.saga!.bossResult(s.id, 'won'), 'Boss defeated. Ben will remember this one.')}>⚔ I beat it</button>
              <button className="btn" onClick={() => act(() => life.saga!.bossResult(s.id, 'lost'), 'Noted. A rematch makes a good next season.')}>It beat me</button>
            </div>
          )}
          {c.boss.result && (
            <button className="btn ghost sm" onClick={() => act(() => life.saga!.bossResult(s.id, null))}>Undo the result</button>
          )}
        </aside>
      </section>

      <section className="sg-quests" aria-label="Main quests">
        {s.quests.map((q, i) => {
          const pct = c.questPcts[i] ?? 0
          const g = c.questGoals[i]
          const card = q.cardId ? v.vision.cards.find((x) => x.id === q.cardId) : null
          return (
            <article key={q.id} className={`sg-quest ${pct >= 100 ? 'done' : ''}`}>
              <div className="sg-quest-top">
                <span className="sg-quest-n">Main quest {i + 1}</span>
                {card && (
                  <span className="sg-quest-card" title={`Serves your vision: ${card.text}`}>
                    {v.photos[card.id] ? <img src={v.photos[card.id]} alt="" /> : <VisionArtSvg art={card.art} />}
                  </span>
                )}
              </div>
              <b className="sg-quest-title">{q.title}</b>
              <div className="sg-qbar pbar"><i style={barFill(pct / 100)} /></div>
              <div className="sg-quest-foot">
                <small>{g ? `Follows your goal "${g.title}" · ${Math.round(pct)}%` : q.done ? `Done ${fmtDay(q.done)}` : 'Tick it when it is really done'}</small>
                {q.goalId == null && (
                  <button className={`sg-tick ${q.done ? 'on' : ''}`} aria-pressed={!!q.done} aria-label={q.done ? `Mark "${q.title}" not done` : `Mark "${q.title}" done`} onClick={() => act(() => life.saga!.toggleQuest(s.id, q.id))}>
                    {q.done ? '✓' : ''}
                  </button>
                )}
              </div>
              <QuestLinks v={v} seasonId={s.id} questId={q.id} goalId={q.goalId} cardId={q.cardId} />
            </article>
          )
        })}
        {s.quests.length === 0 && <p className="sg-muted">No main quests yet: edit the season to add three.</p>}
      </section>

      <section className="sg-row3">
        <article className="sg-card sg-train">
          <header><span className="sg-kicker">Today's training</span><small>{c.today.allDone ? 'All three: the boss took a hit today' : 'All three done = 1 perfect day'}</small></header>
          <ul>
            {c.today.quests.map((q) => (
              <li key={q.title} className={q.done ? 'done' : ''}>
                <span className="sg-dq-tick">{q.done ? '✓' : ''}</span>
                <span>{q.title}</span>
                <small>{q.progress}/{q.goal}</small>
              </li>
            ))}
          </ul>
        </article>
        <article className="sg-card sg-rank" style={{ '--rk': v.level.color } as CSSProperties}>
          <header><span className="sg-kicker">Hunter rank</span><small>Level {v.level.level}</small></header>
          <div className="sg-rank-body">
            <span className="sg-rank-badge" aria-hidden="true">{v.level.badge}</span>
            <div>
              <b>{v.level.title}</b>
              <small>{v.level.rank}</small>
            </div>
          </div>
          <div className="sg-qbar pbar thin"><i style={barFill(v.level.progress)} /></div>
          <small className="sg-muted">{v.level.next ? `Next rank at level ${v.level.next.minLevel}: ${v.level.next.name}` : 'The highest rank'}</small>
        </article>
        <button className="sg-card sg-arc-card" onClick={onArc} aria-label="Ben's path: chapters and outfits">
          <header><span className="sg-kicker">Ben's path</span><small>Chapter {v.arc.chapter.n}</small></header>
          <div className="sg-arc-mini">
            <BenArcAvatar outfit={v.arc.outfit} size={64} />
            <div>
              <b>{v.arc.chapter.title}</b>
              <small>{v.arc.next ? `Next chapter after ${v.arc.toNext} more season${v.arc.toNext === 1 ? '' : 's'}` : 'Every chapter unlocked'}</small>
            </div>
          </div>
          {v.arcNew && <span className="sg-new">New chapter unlocked</span>}
        </button>
      </section>
      {v.wheelDue.due && (
        <button className="sg-nudge" onClick={() => onTab('wheel')}>
          🧭 This quarter's life wheel isn't rated yet ({v.wheelDue.daysLeft} days left). Two minutes →
        </button>
      )}
      {sheet && <NewSeason v={v} start={sheet} onClose={() => setSheet(null)} />}
    </div>
  )
}

function QuestLinks({ v, seasonId, questId, goalId, cardId }: { v: SagaView; seasonId: string; questId: string; goalId: number | null; cardId: string | null }) {
  const act = useAction()
  if (!v.goals.length && !v.vision.cards.length) return null
  return (
    <div className="sg-links">
      {v.goals.length > 0 && (
        <Select value={goalId == null ? '' : String(goalId)} onChange={(e) => act(() => life.saga!.linkQuest(seasonId, questId, { goalId: e.target.value ? Number(e.target.value) : null }))} title="Follow a goal">
          <option value="">No goal (tick it)</option>
          {v.goals.map((g) => <option key={g.id} value={String(g.id)}>Goal: {g.title}</option>)}
        </Select>
      )}
      {v.vision.cards.length > 0 && (
        <Select value={cardId ?? ''} onChange={(e) => act(() => life.saga!.linkQuest(seasonId, questId, { cardId: e.target.value || null }))} title="The vision card it serves">
          <option value="">No vision card</option>
          {v.vision.cards.map((c) => <option key={c.id} value={c.id}>Card: {c.text}</option>)}
        </Select>
      )}
    </div>
  )
}

function EmptySeason({ v, onPick }: { v: SagaView; onPick: (t: SeasonTheme | 'own') => void }) {
  const sug = v.suggestion
  return (
    <div className="sg-empty">
      <div className="sg-empty-head">
        <span className="sg-kicker">Seasons</span>
        <h1 className="sg-title">Your life, in 8-week arcs</h1>
        <p className="sg-theme">Pick a theme, three main quests and a final boss: a real test on a real day. Your daily quests and XP wear the boss down; the last blow is the real fight.</p>
      </div>
      {sug && (
        <p className="sg-suggest">🧭 From your life wheel: <b>{sug.theme.name}</b>. {sug.why}</p>
      )}
      <div className="sg-themes">
        {SEASON_THEMES.map((t) => (
          <button key={t.id} className={`sg-theme-card ${sug?.theme.id === t.id ? 'suggested' : ''}`} style={{ '--sc': t.color } as CSSProperties} onClick={() => onPick(t)}>
            {artUrl(t.cover) && <img src={artUrl(t.cover)!} alt="" aria-hidden="true" />}
            <span className="sg-theme-shade" />
            <span className="sg-theme-text">
              <small>{WHEEL_AREAS.find((a) => a.id === t.area)?.label}</small>
              <b>{t.name}</b>
              <em>{t.theme}</em>
            </span>
          </button>
        ))}
        <button className="sg-theme-card own" onClick={() => onPick('own')}>
          <span className="sg-theme-text"><small>Your own</small><b>Write your own season</b><em>Name, theme, quests and boss in your words.</em></span>
        </button>
      </div>
    </div>
  )
}

/** Start a season from a theme or from scratch. */
function NewSeason({ v, start, onClose }: { v: SagaView; start: SeasonTheme | 'own' | 'pick'; onClose: () => void }) {
  const act = useAction()
  const [theme, setTheme] = useState<SeasonTheme | null>(start === 'own' || start === 'pick' ? null : start)
  const [picking, setPicking] = useState(start === 'pick')
  const t = theme
  const [name, setName] = useState(t?.name ?? '')
  const [about, setAbout] = useState(t?.theme ?? '')
  const [quests, setQuests] = useState<string[]>(t?.quests ?? ['', '', ''])
  const [boss, setBoss] = useState(t?.boss.title ?? '')
  const [kind, setKind] = useState<BossKind>(t?.boss.kind ?? 'exam')
  const startDay = useMemo(() => nextMonday(v.today), [v.today])
  const choose = (x: SeasonTheme | null) => {
    setTheme(x)
    setName(x?.name ?? '')
    setAbout(x?.theme ?? '')
    setQuests(x?.quests ?? ['', '', ''])
    setBoss(x?.boss.title ?? '')
    setKind(x?.boss.kind ?? 'exam')
    setPicking(false)
  }
  const save = async () => {
    const ok = await act(
      () => life.saga!.startSeason({ name: name.trim(), theme: about.trim(), cover: t?.cover ?? 'ronin-moon', color: t?.color ?? '#c8f135', area: t?.area ?? null, start: v.current ? v.today : startDay, quests: quests.map((q) => q.trim()).filter(Boolean), boss: { title: boss.trim() || 'The final test', kind } }),
      'A new season begins'
    )
    if (ok) {
      onClose()
      window.dispatchEvent(new CustomEvent('life-season-intro'))
    }
  }
  return (
    <div className="sheet sg-sheet" role="dialog" aria-modal="true" aria-label="Start a season" onKeyDown={(e) => e.key === 'Escape' && onClose()} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet-card sg-sheet-card">
        <header className="sg-sheet-head">
          <b>{picking ? 'Pick a theme' : 'A new season'}</b>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {picking ? (
          <div className="sg-themes small">
            {SEASON_THEMES.map((x) => (
              <button key={x.id} className={`sg-theme-card ${v.suggestion?.theme.id === x.id ? 'suggested' : ''}`} style={{ '--sc': x.color } as CSSProperties} onClick={() => choose(x)}>
                {artUrl(x.cover) && <img src={artUrl(x.cover)!} alt="" aria-hidden="true" />}
                <span className="sg-theme-shade" />
                <span className="sg-theme-text"><b>{x.name}</b><em>{x.theme}</em></span>
              </button>
            ))}
            <button className="sg-theme-card own" onClick={() => choose(null)}><span className="sg-theme-text"><b>Write your own</b></span></button>
          </div>
        ) : (
          <div className="sg-form">
            <label>Name<input value={name} maxLength={48} onChange={(e) => setName(e.target.value)} placeholder="Shadow Code" autoFocus /></label>
            <label>Theme<input value={about} maxLength={160} onChange={(e) => setAbout(e.target.value)} placeholder="Become the hacker you keep reading about." /></label>
            <fieldset>
              <legend>Three main quests</legend>
              {[0, 1, 2].map((i) => (
                <input key={i} value={quests[i] ?? ''} maxLength={80} placeholder={`Main quest ${i + 1}`} onChange={(e) => setQuests((q) => Object.assign([...q], { [i]: e.target.value }))} />
              ))}
            </fieldset>
            <label>Final boss (a real test on a real day)<input value={boss} maxLength={80} onChange={(e) => setBoss(e.target.value)} placeholder="Finish a weekend CTF in the top half" /></label>
            <label>What kind of fight
              <Select value={kind} onChange={(e) => setKind(e.target.value as BossKind)}>
                {BOSS_KINDS.map((k) => <option key={k.id} value={k.id}>{k.icon} {k.label}</option>)}
              </Select>
            </label>
            <p className="sg-muted">{v.current ? 'Starts today; the season you are in now is closed.' : `Starts Monday ${fmtDay(startDay)} and runs 8 weeks. The boss is in the last week.`}</p>
            <footer className="sg-sheet-foot">
              <button className="btn ghost" onClick={() => setPicking(true)}>Other themes</button>
              <button className="btn primary" disabled={!name.trim()} onClick={save}>Begin the season</button>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}
