import { useState, useMemo } from 'react'
import type { PageId } from '../modules'
import type { Rule, Summary } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL } from '../modules'
import { useAction } from '../ui'
import { soundCoin, soundFanfare, soundSystemOracle, soundWarning, soundTick } from '../sound'
import { RANKS } from '@core/levels'

interface Props {
  rules: Rule[]
  onChange: (r: Rule[]) => void
  summary?: Summary | null
  onGo?: (page: PageId) => void
  onOracle?: () => void
  onModal?: (type: 'quest-complete' | 'level-up' | 'penalty-warning', data?: any) => void
}

const MODULE_IDS = ['tasks', 'schedule', 'sleep', 'discipline', 'body', 'money']

type TabKey = 'codex' | 'attributes' | 'ranks' | 'quests' | 'economy' | 'ecosystem' | 'editor'

function blank(): Rule {
  return { id: `custom.${Date.now().toString(36)}`, module: 'tasks', title: '', coins: 5, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true }
}

export function Rules({ rules, onChange, summary, onGo, onOracle, onModal }: Props) {
  const act = useAction()
  const [tab, setTab] = useState<TabKey>('codex')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Rule | null>(null)

  const lv = summary?.level

  async function save(r: Rule) {
    const next = await act(() => life.rules.save(r), 'Saved')
    if (next) {
      onChange(next)
      setDraft(null)
    }
  }

  const num = (k: keyof Rule) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => d && { ...d, [k]: e.target.value === '' || e.target.value === '-' ? 0 : parseInt(e.target.value, 10) || 0 })

  const filteredRules = useMemo(() => {
    if (!search.trim()) return rules
    const q = search.toLowerCase()
    return rules.filter((r) => r.title.toLowerCase().includes(q) || r.module.toLowerCase().includes(q) || String(r.coins).includes(q))
  }, [rules, search])

  return (
    <div className="game-rules-container">
      {/* Solo Leveling System Hero Frame */}
      <section className="game-rules-hero">
        <div className="hero-corner-bl" />
        <div className="hero-corner-br" />
        <div className="game-rules-hero-content">
          <div>
            <div className="hero-badge-tag">
              <span>⚔️</span> THE SYSTEM CODEX // GAME RULES
            </div>
            <h1 className="hero-title">
              RULES OF <span className="glow-cyan">LIFE</span> — REAL GROWTH RPG
            </h1>
            <p className="hero-subtitle">
              &ldquo;This game is called LIFE. Everything is based on real life. We built this system so you truly awaken, rise, and become an apex human.&rdquo;
            </p>
            <div className="hero-actions-row">
              <button
                className="btn small primary"
                onClick={() => {
                  soundSystemOracle()
                  onOracle?.()
                }}
              >
                <Icon name="bolt" size={14} /> Summon System Oracle
              </button>
              <button
                className="btn small ghost"
                onClick={() => {
                  soundFanfare()
                  onModal?.('quest-complete', {
                    todayCoins: summary?.todayCoins ?? 50,
                    level: lv?.level ?? 1,
                    rank: lv?.rank ?? 'E-Rank Novice',
                    questsDone: 3
                  })
                }}
              >
                <span>🏆</span> Test Quest Modal
              </button>
              <button
                className="btn small ghost"
                onClick={() => {
                  soundCoin()
                }}
                title="Play Cyberpunk Coin SFX"
              >
                <span>🪙</span> Coin SFX
              </button>
              <button
                className="btn small ghost"
                onClick={() => {
                  soundWarning()
                  onModal?.('penalty-warning', {
                    penaltyReason: 'Relapse Urge Reset / Oath Broken',
                    penaltyCoins: 30
                  })
                }}
                title="Play System Penalty Alert"
              >
                <span>⚠️</span> Warning SFX
              </button>
            </div>
          </div>

          {lv && (
            <div className="hero-stats-badge">
              <div className="hero-stat-col">
                <span className="hero-stat-label">Hunter Rank</span>
                <span className="hero-stat-val" style={{ color: lv.rankColor }}>
                  {lv.rankBadge} {lv.rank}
                </span>
              </div>
              <div className="hero-stat-col">
                <span className="hero-stat-label">Level</span>
                <span className="hero-stat-val">Lv. {lv.level}</span>
              </div>
              <div className="hero-stat-col">
                <span className="hero-stat-label">Combat Power</span>
                <span className="hero-stat-val" style={{ color: '#00d2ff' }}>
                  {lv.attributes.totalCombatPower.toLocaleString()} CP
                </span>
              </div>
              <div className="hero-stat-col">
                <span className="hero-stat-label">Free Points</span>
                <span className="hero-stat-val" style={{ color: lv.attributes.unallocatedPoints > 0 ? '#4ade80' : '#94a3b8' }}>
                  +{lv.attributes.unallocatedPoints}
                </span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Segmented Navigation Tabs */}
      <nav className="rules-tabs-nav" aria-label="Game Rules Sections">
        <button className={`rules-tab-btn ${tab === 'codex' ? 'active' : ''}`} onClick={() => { soundTick(); setTab('codex') }}>
          <span>📜</span> System Codex
        </button>
        <button className={`rules-tab-btn ${tab === 'attributes' ? 'active' : ''}`} onClick={() => { soundTick(); setTab('attributes') }}>
          <span>⚔️</span> Attributes & CP
        </button>
        <button className={`rules-tab-btn ${tab === 'ranks' ? 'active' : ''}`} onClick={() => { soundTick(); setTab('ranks') }}>
          <span>🏆</span> Hunter Ranks
        </button>
        <button className={`rules-tab-btn ${tab === 'quests' ? 'active' : ''}`} onClick={() => { soundTick(); setTab('quests') }}>
          <span>🛡️</span> Quests & Penalties
        </button>
        <button className={`rules-tab-btn ${tab === 'economy' ? 'active' : ''}`} onClick={() => { soundTick(); setTab('economy') }}>
          <span>💰</span> Economy & Vault
        </button>
        <button className={`rules-tab-btn ${tab === 'ecosystem' ? 'active' : ''}`} onClick={() => { soundTick(); setTab('ecosystem') }}>
          <span>🤖</span> Oracle & Apps
        </button>
        <button className={`rules-tab-btn ${tab === 'editor' ? 'active' : ''}`} onClick={() => { soundTick(); setTab('editor') }}>
          <span>⚙️</span> Point Rules Editor
        </button>
      </nav>

      {/* TAB 1: SYSTEM CODEX (THE GRAND PHILOSOPHY) */}
      {tab === 'codex' && (
        <section className="rules-section">
          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>🌌</span> The Real Growth Manifesto
              </h2>
              <span className="badge-tag">FOUNDATIONAL LAW</span>
            </div>
            <p style={{ color: '#cbd5e1', lineHeight: '1.7', fontSize: '14px', margin: '0 0 16px 0' }}>
              Unlike fantasy games designed for escapism, <b>LIFE is an Augmentation Engine for Reality</b>.
              Every level you gain, every coin you earn, and every point of Combat Power (CP) you amass is backed by
              tangible real-world blood, sweat, intellectual focus, and ruthless dopamine self-control.
            </p>
            <div className="rules-grid-2">
              <div style={{ background: 'rgba(0, 210, 255, 0.05)', border: '1px solid rgba(0, 210, 255, 0.2)', padding: '16px', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 6px 0', color: '#00d2ff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🎯</span> The Real-Life Projection
                </h4>
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: '1.5' }}>
                  When you wake up early, lift heavy weights, conquer complex university labs, track your money, and crush addictive urges—the System registers your growth and grants you power. If you cheat the logs, you only cheat yourself.
                </p>
              </div>
              <div style={{ background: 'rgba(74, 222, 128, 0.05)', border: '1px solid rgba(74, 222, 128, 0.2)', padding: '16px', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 6px 0', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚡</span> The Solo Leveling Ascent
                </h4>
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: '1.5' }}>
                  You awaken as an E-Rank Hunter at Level 1. Through strict daily execution, your stats grow, you unlock devastating hunter perks, allocate stat points, and ascend into S-Rank and National Level sovereignty.
                </p>
              </div>
            </div>
          </div>

          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>🛡️</span> The 4 Cardinal Directives
              </h2>
            </div>
            <div className="rules-grid-2">
              <div className="rank-rule-card">
                <div className="rank-badge-box" style={{ borderColor: '#38bdf8' }}>1</div>
                <div className="rank-info-box">
                  <span className="rank-name-txt">Honesty Over Ego</span>
                  <p className="rank-desc-txt">
                    Never log a fake workout or pretend an urge was defeated if it wasn&apos;t. An honest reset builds titanium willpower; a fabricated log rots your character.
                  </p>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-badge-box" style={{ borderColor: '#f5c84b' }}>2</div>
                <div className="rank-info-box">
                  <span className="rank-name-txt">Daily Quest Completion</span>
                  <p className="rank-desc-txt">
                    The System generates 3 Daily Quests every morning: Wake up on time, Deep Focus study session, and Workout. Clear all 3 for the +50 Coin & +100 XP Golden Seal.
                  </p>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-badge-box" style={{ borderColor: '#f43f5e' }}>3</div>
                <div className="rank-info-box">
                  <span className="rank-name-txt">Zero Relapse & Panic Protocol</span>
                  <p className="rank-desc-txt">
                    Protect your dopamine purity. When cravings surge, hit the Panic Shortcut (<kbd>Ctrl+Alt+U</kbd>) to trigger the 5-Minute Urge Crusher. Use Streak Shields to absorb slips.
                  </p>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-badge-box" style={{ borderColor: '#a855f7' }}>4</div>
                <div className="rank-info-box">
                  <span className="rank-name-txt">Delayed Gratification & Vault</span>
                  <p className="rank-desc-txt">
                    Coins earned from hard work buy custom Shop rewards or deposit into your Wishlist Vault—funding real laptops, gym gear, and travel goals with cold hard discipline.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>⏱️</span> Victor&apos;s Daily Execution Protocol
              </h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="routine-step">
                <div className="routine-step-num">1</div>
                <div className="routine-step-content">
                  <div className="routine-step-title">Morning Wake-Up & Check-In (06:00 – 07:00)</div>
                  <p className="routine-step-desc">
                    Waky alarm rings. Get out of bed on time (+15 XP, +20 Coins). Check in on Today dashboard. Review today&apos;s Google Calendar appointments and scheduled study blocks.
                  </p>
                </div>
              </div>
              <div className="routine-step">
                <div className="routine-step-num">2</div>
                <div className="routine-step-content">
                  <div className="routine-step-title">Deep Work & Study Sprints (Daytime)</div>
                  <p className="routine-step-desc">
                    Start study blocks from the Schedule timeline. Finish focused blocks without distraction (+10 to +25 Coins). Complete top P1 tasks on the Kanban board (+30 Coins).
                  </p>
                </div>
              </div>
              <div className="routine-step">
                <div className="routine-step-num">3</div>
                <div className="routine-step-content">
                  <div className="routine-step-title">Physical Training & Expense Tracking (Afternoon/Evening)</div>
                  <p className="routine-step-desc">
                    Hit the gym or bodyweight workout. Log exercises and reps on the Body page (+10 Coins, +30 XP). Open Money tab to log today&apos;s spending into Finance Helper (+3 Coins).
                  </p>
                </div>
              </div>
              <div className="routine-step">
                <div className="routine-step-num">4</div>
                <div className="routine-step-content">
                  <div className="routine-step-title">Night System Seal & Level-Up Verification</div>
                  <p className="routine-step-desc">
                    Complete all 3 daily quests. Claim your Daily Seal (+50 Coins). Review your Combat Power increase on Journey. Go to bed on time from Waky to secure tomorrow&apos;s Agility bonus.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: ATTRIBUTES & COMBAT POWER */}
      {tab === 'attributes' && (
        <section className="rules-section">
          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>⚔️</span> The 5 Hunter Attributes
              </h2>
              <span className="badge-tag">SOLO LEVELING ENGINE</span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0' }}>
              Your character in LIFE possesses 5 primary stats. Each stat is anchored to a distinct domain of real-world personal mastery.
            </p>
            <div className="rules-grid-5">
              <div className="attr-rule-card" style={{ ['--attr-color' as string]: '#ff6b8b', ['--attr-glow' as string]: 'rgba(255, 107, 139, 0.3)' }}>
                <div className="attr-rule-top">
                  <span className="attr-rule-code">STR</span>
                  <span>💪</span>
                </div>
                <span className="attr-rule-name">Strength</span>
                <p className="attr-rule-desc">Physical power, muscular endurance, and workout consistency.</p>
                <div className="attr-rule-train">
                  <b>Trained by:</b> Weightlifting, calisthenics, running, compound exercises.
                </div>
              </div>

              <div className="attr-rule-card" style={{ ['--attr-color' as string]: '#38bdf8', ['--attr-glow' as string]: 'rgba(56, 189, 248, 0.3)' }}>
                <div className="attr-rule-top">
                  <span className="attr-rule-code">AGI</span>
                  <span>⚡</span>
                </div>
                <span className="attr-rule-name">Agility</span>
                <p className="attr-rule-desc">Execution speed, prompt wakeups, and zero hesitation in taking action.</p>
                <div className="attr-rule-train">
                  <b>Trained by:</b> Waking up on time from Waky, completing scheduled morning tasks.
                </div>
              </div>

              <div className="attr-rule-card" style={{ ['--attr-color' as string]: '#b892ff', ['--attr-glow' as string]: 'rgba(184, 146, 255, 0.3)' }}>
                <div className="attr-rule-top">
                  <span className="attr-rule-code">INT</span>
                  <span>🧠</span>
                </div>
                <span className="attr-rule-name">Intelligence</span>
                <p className="attr-rule-desc">Mental bandwidth, deep focus duration, and analytical mastery.</p>
                <div className="attr-rule-train">
                  <b>Trained by:</b> 25m+ & 60m+ study blocks, university labs, complex problem-solving.
                </div>
              </div>

              <div className="attr-rule-card" style={{ ['--attr-color' as string]: '#4ade80', ['--attr-glow' as string]: 'rgba(74, 222, 128, 0.3)' }}>
                <div className="attr-rule-top">
                  <span className="attr-rule-code">VIT</span>
                  <span>❤️</span>
                </div>
                <span className="attr-rule-name">Vitality</span>
                <p className="attr-rule-desc">Biological recovery, sleep duration, clean nutrition, and physical health.</p>
                <div className="attr-rule-train">
                  <b>Trained by:</b> On-time bedtime, 7.5h+ sleep logged in Waky, cold showers, hydration.
                </div>
              </div>

              <div className="attr-rule-card" style={{ ['--attr-color' as string]: '#f5c84b', ['--attr-glow' as string]: 'rgba(245, 200, 75, 0.3)' }}>
                <div className="attr-rule-top">
                  <span className="attr-rule-code">SEN</span>
                  <span>🛡️</span>
                </div>
                <span className="attr-rule-name">Sense & Willpower</span>
                <p className="attr-rule-desc">Impulse immunity, dopamine receptor health, and unshakeable discipline.</p>
                <div className="attr-rule-train">
                  <b>Trained by:</b> Unbroken check-in streaks, zero urge resets, urge crusher victories.
                </div>
              </div>
            </div>
          </div>

          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>📊</span> Combat Power (CP) Formula & Stat Allocation
              </h2>
            </div>
            <div className="rules-grid-2">
              <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#00d2ff' }}>The Total Combat Power Formula</h4>
                <div style={{ fontFamily: 'monospace', fontSize: '13px', background: 'rgba(0, 210, 255, 0.08)', padding: '10px', borderRadius: '6px', color: '#f8fafc', border: '1px solid rgba(0, 210, 255, 0.25)', marginBottom: '8px' }}>
                  CP = (STR + AGI + VIT + INT + SEN) × (1 + Streak Multiplier) + (Level × 25)
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', lineHeight: '1.5' }}>
                  A longer unbroken streak multiplies your entire attribute sum! If your streak breaks, your base stats remain, but your multiplier drops until rebuild.
                </p>
              </div>

              <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#f5c84b' }}>Free Stat Points Upon Level-Up</h4>
                <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#94a3b8', lineHeight: '1.5' }}>
                  Each time you gain enough XP to Level Up, the System awards you <b>+1 to +3 Free Attribute Points</b>. You can manually invest these points into STR, AGI, INT, VIT, or SEN to tailor your Hunter build.
                </p>
                <button className="btn small primary" onClick={() => onGo?.('journey')}>
                  Go to Journey & Allocate Stats
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 3: HUNTER RANKS */}
      {tab === 'ranks' && (
        <section className="rules-section">
          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>🏆</span> Hunter Rank Hierarchy & Milestones
              </h2>
              <span className="badge-tag">S-RANK ASCENT</span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0' }}>
              As you accumulate XP through daily consistency, the System promotes you through the Hunter Ranks, unlocking rank perks and increased daily quest payouts.
            </p>
            <div className="rules-grid-2">
              {RANKS.slice(0, 10).map((r) => (
                <div key={r.name} className="rank-rule-card" style={{ ['--rank-color' as string]: r.color, ['--rank-glow' as string]: r.auraGlow }}>
                  <div className="rank-badge-box">
                    <span>{r.badge}</span>
                  </div>
                  <div className="rank-info-box">
                    <div className="rank-head-line">
                      <span className="rank-name-txt" style={{ color: r.color }}>{r.name}</span>
                      <span className="rank-req-tag">Min Level {r.minLevel}</span>
                      <span className="badge-tag">{r.grade}</span>
                    </div>
                    <p className="rank-desc-txt">{r.desc}</p>
                    <div className="rank-perk-txt">✨ {r.perk}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TAB 4: DAILY QUESTS, STREAK & PENALTIES */}
      {tab === 'quests' && (
        <section className="rules-section">
          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>🛡️</span> The 3 Mandatory Daily Quests
              </h2>
              <span className="badge-tag">MIDNIGHT RESET</span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0' }}>
              Every morning at 00:00, the System establishes 3 non-negotiable daily objectives. Fulfilling all 3 summons the Solo Leveling Quest Clear Modal and grants huge payouts.
            </p>
            <div className="rules-grid-3">
              <div className="chest-rule-card" style={{ ['--chest-color' as string]: '#38bdf8' }}>
                <div className="chest-header-row">
                  <span className="chest-title-txt"><span>🌅</span> 1. Circadian Ritual</span>
                  <span className="xp-badge">+20 XP</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  Wake up on time or log your morning check-in before 09:00. Sets your Agility tone for the day.
                </p>
                <span className="coin-badge-plus">+20 Coins</span>
              </div>

              <div className="chest-rule-card" style={{ ['--chest-color' as string]: '#b892ff' }}>
                <div className="chest-header-row">
                  <span className="chest-title-txt"><span>📚</span> 2. Deep Focus Block</span>
                  <span className="xp-badge">+35 XP</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  Complete at least one scheduled 25m+ or 60m+ focused study sprint on your schedule timeline.
                </p>
                <span className="coin-badge-plus">+10 to +25 Coins</span>
              </div>

              <div className="chest-rule-card" style={{ ['--chest-color' as string]: '#ff6b8b' }}>
                <div className="chest-header-row">
                  <span className="chest-title-txt"><span>💪</span> 3. Physical Training</span>
                  <span className="xp-badge">+30 XP</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  Execute and log a workout on the Body page (lifting, running, pushups, or pullups).
                </p>
                <span className="coin-badge-plus">+10 Coins</span>
              </div>
            </div>

            <div style={{ marginTop: '16px', background: 'rgba(245, 200, 75, 0.08)', border: '1px solid rgba(245, 200, 75, 0.3)', padding: '14px 18px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <b style={{ color: '#f5c84b', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>👑</span> Daily Quest Completion Bonus
                </b>
                <span style={{ fontSize: '12px', color: '#cbd5e1' }}>
                  Clearing all 3 quests triggers the Solo Leveling Golden Seal: awards <b>+50 Bonus Coins</b> & <b>+100 Bonus XP</b>!
                </span>
              </div>
              <button className="btn small primary" onClick={() => onGo?.('today')}>
                Go to Today Dashboard
              </button>
            </div>
          </div>

          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>⚠️</span> System Penalties & Safe Boundaries
              </h2>
            </div>
            <div className="rules-grid-2">
              <div style={{ background: 'rgba(248, 113, 113, 0.05)', border: '1px solid rgba(248, 113, 113, 0.25)', padding: '16px', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#f87171', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🛑</span> How Penalties Work
                </h4>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#94a3b8', lineHeight: '1.6' }}>
                  <li><b>Breaking an oath / check-in failure:</b> -50 Coins</li>
                  <li><b>Urge reset:</b> -30 Coins (or absorbed by a Streak Shield)</li>
                  <li><b>Missed study block:</b> -10 Coins</li>
                </ul>
              </div>

              <div style={{ background: 'rgba(0, 210, 255, 0.05)', border: '1px solid rgba(0, 210, 255, 0.25)', padding: '16px', borderRadius: '8px' }}>
                <h4 style={{ margin: '0 0 8px 0', color: '#00d2ff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔒</span> System Protection Laws
                </h4>
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', lineHeight: '1.6' }}>
                  1. <b>XP is Permanent:</b> Penalties NEVER deduct XP or demote your Level. The physical strength and brain adaptations you earned cannot be unlearned.<br />
                  2. <b>No Debt:</b> Your wallet balance can NEVER fall below 0 coins.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 5: ECONOMY, SHOP & VAULT */}
      {tab === 'economy' && (
        <section className="rules-section">
          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>💰</span> How Coins Are Earned
              </h2>
              <span className="badge-tag">UNIFIED ECONOMY</span>
            </div>
            <div className="rules-grid-3">
              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt">Circadian Wake-Up</span>
                  <p className="rank-desc-txt">Wake on time from Waky alarm.</p>
                  <span className="coin-badge-plus">+20 Coins · +15 XP</span>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt">Study Sprint (25m–45m)</span>
                  <p className="rank-desc-txt">Complete focused study block.</p>
                  <span className="coin-badge-plus">+10 Coins · +20 XP</span>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt">Deep Work Sprint (60m+)</span>
                  <p className="rank-desc-txt">Uninterrupted deep work sprint.</p>
                  <span className="coin-badge-plus">+25 Coins · +45 XP</span>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt">Physical Workout</span>
                  <p className="rank-desc-txt">Complete workout in Body section.</p>
                  <span className="coin-badge-plus">+10 Coins · +30 XP</span>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt">Log Daily Expenses</span>
                  <p className="rank-desc-txt">Track spending in Finance Helper.</p>
                  <span className="coin-badge-plus">+3 Coins · +10 XP</span>
                </div>
              </div>
              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt">Under Daily Budget Bonus</span>
                  <p className="rank-desc-txt">End the day within spending budget.</p>
                  <span className="coin-badge-plus">+5 Coins · +15 XP</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>🎁</span> Mystery Loot Chests
              </h2>
              <span className="badge-tag">SHOP REWARDS</span>
            </div>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0' }}>
              Spend surplus coins in the Shop on Mystery Loot Chests. Higher tier chests contain generous coin jackpots, bonus XP, and rare streak shields.
            </p>
            <div className="rules-grid-2">
              <div className="chest-rule-card" style={{ ['--chest-color' as string]: '#cd7f32' }}>
                <div className="chest-header-row">
                  <span className="chest-title-txt"><span>📦</span> Bronze Chest</span>
                  <span className="chest-cost-tag">Cost: 50 Coins</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  Beginner hunter loot. Yields <b>40 – 80 Coins</b> (+10 XP).
                </p>
              </div>

              <div className="chest-rule-card" style={{ ['--chest-color' as string]: '#94a3b8' }}>
                <div className="chest-header-row">
                  <span className="chest-title-txt"><span>🪙</span> Silver Chest</span>
                  <span className="chest-cost-tag">Cost: 120 Coins</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  Adept warrior loot. Yields <b>100 – 200 Coins</b> (+25 XP).
                </p>
              </div>

              <div className="chest-rule-card" style={{ ['--chest-color' as string]: '#f5c84b' }}>
                <div className="chest-header-row">
                  <span className="chest-title-txt"><span>👑</span> Gold Chest</span>
                  <span className="chest-cost-tag">Cost: 300 Coins</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  High-rank dungeon chest. Yields <b>250 – 550 Coins</b> (+60 XP, rare perk bonus).
                </p>
              </div>

              <div className="chest-rule-card" style={{ ['--chest-color' as string]: '#a855f7' }}>
                <div className="chest-header-row">
                  <span className="chest-title-txt"><span>💎</span> Legendary Chest</span>
                  <span className="chest-cost-tag">Cost: 800 Coins</span>
                </div>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
                  Monarch&apos;s royal treasury. Yields <b>700 – 1,600 Coins</b> (+200 XP, guaranteed Streak Shield).
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 6: ORACLE & ECOSYSTEM */}
      {tab === 'ecosystem' && (
        <section className="rules-section">
          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>🤖</span> Solo Leveling System Oracle (AI Mentor)
              </h2>
              <span className="badge-tag">TACTICAL INTEL</span>
            </div>
            <p style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: '1.6', margin: '0 0 16px 0' }}>
              The System Oracle is your omnipresent AI mentor. Summon it instantly from anywhere with <kbd>Ctrl+Shift+A</kbd> or <kbd>Ctrl+J</kbd>.
              Unlike a generic chatbot, the Oracle analyzes your <b>live Hunter Rank, Combat Power, Google Calendar events, pending Kanban tasks, and discipline streak</b> to deliver sharp, tactical directives.
            </p>
            <div className="rules-grid-2">
              <div style={{ background: 'rgba(0, 210, 255, 0.05)', border: '1px solid rgba(0, 210, 255, 0.25)', padding: '16px', borderRadius: '8px' }}>
                <b style={{ color: '#00d2ff', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span>🛡️</span> Urge & Procrastination Interceptor
                </b>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0, lineHeight: '1.5' }}>
                  When stalling or experiencing craving urges, the Oracle provides stoic warrior mantras and immediate micro-actions tailored to your Hunter Archetype.
                </p>
              </div>

              <div style={{ background: 'rgba(74, 222, 128, 0.05)', border: '1px solid rgba(74, 222, 128, 0.25)', padding: '16px', borderRadius: '8px' }}>
                <b style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span>🪄</span> AI Task Decomposition
                </b>
                <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0, lineHeight: '1.5' }}>
                  Click &ldquo;Break down with AI&rdquo; on any complex task (e.g., &ldquo;SI-266 Lab 7&rdquo;) to instantly generate sub-steps with recommended focus blocks and coin payouts.
                </p>
              </div>
            </div>
          </div>

          <div className="rules-card">
            <div className="rules-card-header">
              <h2 className="rules-card-title">
                <span>🔗</span> Connected Apps & Google Drive Cloud Backup
              </h2>
            </div>
            <div className="rules-grid-3">
              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt" style={{ color: '#6ee7d8' }}>🌙 Waky (Sleep)</span>
                  <p className="rank-desc-txt">Monitors circadian alarms, wakeups, bedtime on-time metrics.</p>
                </div>
              </div>

              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt" style={{ color: '#f5c84b' }}>💰 Finance Helper</span>
                  <p className="rank-desc-txt">Multi-account ledger (Cards, Safe, Cash), 4 jars, safe-to-spend, auto Google Drive sync.</p>
                </div>
              </div>

              <div className="rank-rule-card">
                <div className="rank-info-box">
                  <span className="rank-name-txt" style={{ color: '#ff8a3d' }}>🛡️ MAN (Discipline)</span>
                  <p className="rank-desc-txt">Private chastity/dopamine streak, urge crusher, honest relapse resets.</p>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '16px', background: 'rgba(0, 210, 255, 0.08)', border: '1px solid rgba(0, 210, 255, 0.3)', padding: '14px 18px', borderRadius: '8px' }}>
              <b style={{ color: '#00d2ff', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span>☁️</span> Automated Google Drive Cloud Backups
              </b>
              <p style={{ margin: 0, fontSize: '12px', color: '#cbd5e1', lineHeight: '1.5' }}>
                LIFE automatically takes an encrypted snapshot of your complete database every 30 minutes and upon shutdown, saving directly to <code>G:\My Drive\Life System\backups</code>. Your progression is 100% safe and permanent.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* TAB 7: POINT RULES EDITOR (SQLITE TABLE) */}
      {tab === 'editor' && (
        <section className="panel">
          <header className="panel-head">
            <h2>
              <span>⚙️</span> SQLite Point Rules Engine
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="rules-search-bar" style={{ minWidth: '220px' }}>
                <Icon name="search" size={14} />
                <input
                  type="text"
                  className="rules-search-input"
                  placeholder="Filter rules..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button className="btn small primary" onClick={() => setDraft(blank())}>
                <Icon name="plus" size={14} /> New rule
              </button>
            </div>
          </header>
          <p className="hint block">
            Customize exact payouts for any system action. Penalties (negative coins) never take XP and never push your wallet below zero. Daily limit 0 means no limit.
          </p>

          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Section</th>
                <th className="num">Coins</th>
                <th className="num">XP</th>
                <th className="num">Per day</th>
                <th className="num">Cooldown</th>
                <th>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((r) => (
                <tr key={r.id} className={r.enabled ? '' : 'muted'}>
                  <td><b>{r.title}</b></td>
                  <td>{MODULE_LABEL[r.module] ?? r.module}</td>
                  <td className={`num ${r.coins < 0 ? 'neg-text' : ''}`}>
                    {r.coins > 0 ? `+${r.coins}` : r.coins}
                  </td>
                  <td className="num">{r.xp}</td>
                  <td className="num">{r.dailyCap || '∞'}</td>
                  <td className="num">{r.cooldownMin ? `${r.cooldownMin} min` : '–'}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Turn ${r.title} on or off`}
                      checked={r.enabled}
                      onChange={() => save({ ...r, enabled: !r.enabled })}
                    />
                  </td>
                  <td className="row-act">
                    <button className="btn small ghost" onClick={() => setDraft({ ...r })}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {draft && (
            <div className="sheet" role="dialog" aria-label="Edit rule">
              <div className="sheet-card">
                <h3>{rules.some((r) => r.id === draft.id) ? 'Edit rule' : 'New rule'}</h3>
                <label>
                  Title
                  <input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </label>
                <label>
                  Section
                  <select value={draft.module} onChange={(e) => setDraft({ ...draft, module: e.target.value })}>
                    {MODULE_IDS.map((m) => (
                      <option key={m} value={m}>
                        {MODULE_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid4">
                  <label>
                    Coins
                    <input type="number" value={draft.coins} onChange={num('coins')} />
                  </label>
                  <label>
                    XP
                    <input type="number" min={0} value={draft.xp} onChange={num('xp')} />
                  </label>
                  <label>
                    Per day
                    <input type="number" min={0} value={draft.dailyCap} onChange={num('dailyCap')} />
                  </label>
                  <label>
                    Cooldown (min)
                    <input type="number" min={0} value={draft.cooldownMin} onChange={num('cooldownMin')} />
                  </label>
                </div>
                <div className="sheet-actions">
                  <button className="btn ghost" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  <button className="btn primary" onClick={() => save(draft)}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
