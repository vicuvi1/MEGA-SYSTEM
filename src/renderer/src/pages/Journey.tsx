import { useEffect, useMemo, useState } from 'react'
import { addDays } from '@core/dates'
import { effective } from '@core/ledger'
import { RANKS, type HunterRankDef } from '@core/levels'
import type { LedgerEntry, Rule, Summary, AIPerformanceReport } from '@shared/api'
import { life } from '../bridge'
import { Icon } from '../Icon'
import { MODULE_LABEL, MODULES } from '../modules'
import { Coins, describeEntry, useToast } from '../ui'
import { HolographicRadarChart } from '../HolographicRadarChart'

const COLOR: Record<string, string> = Object.fromEntries(MODULES.map((m) => [m.id, m.color]))
const GOAL_KEY = 'ls.weekGoal'

export function Journey({ summary, rules }: { summary: Summary; rules: Rule[] }) {
  const [rows, setRows] = useState<LedgerEntry[]>([])
  const toast = useToast()
  const [goal, setGoal] = useState(() => {
    try {
      return localStorage.getItem(GOAL_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [rankFilter, setRankFilter] = useState<'all' | 'early' | 'mid' | 'high' | 'monarch'>('all')
  const [report, setReport] = useState<AIPerformanceReport | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  async function generateReport() {
    setLoadingReport(true)
    try {
      const rep = await life.ai.performanceReport()
      setReport(rep)
      toast('✨ Solo Leveling Strategic Report compiled!', 'good')
    } catch (err: any) {
      toast(err?.message || 'Failed to compile AI report. Check keys in Settings.', 'bad')
    } finally {
      setLoadingReport(false)
    }
  }

  useEffect(() => {
    life.wallet.history(2000).then(setRows).catch(() => {})
  }, [summary])

  const titles = useMemo(() => Object.fromEntries(rules.map((r) => [r.id, r.title])), [rules])
  const week = useMemo(() => {
    const live = effective(rows.slice().reverse())
    const today = summary.today
    const from = addDays(today, -6)
    const prevFrom = addDays(today, -13)
    const thisWeek = live.filter((e) => e.day >= from && e.day <= today)
    const lastWeek = live.filter((e) => e.day >= prevFrom && e.day < from)
    const earned = (list: LedgerEntry[]) => list.reduce((s, e) => s + Math.max(0, e.coins), 0)
    const byModule: Record<string, number> = {}
    for (const e of thisWeek) if (e.coins > 0) byModule[e.module] = (byModule[e.module] ?? 0) + e.coins
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((d) => ({
      day: d,
      coins: earned(thisWeek.filter((e) => e.day === d))
    }))
    const best = days.reduce((a, b) => (b.coins > a.coins ? b : a), days[0])
    const slips = thisWeek.filter((e) => e.coins < 0)
    return {
      earned: earned(thisWeek),
      last: earned(lastWeek),
      xp: thisWeek.reduce((s, e) => s + e.xp, 0),
      byModule,
      days,
      best,
      slips
    }
  }, [rows, summary.today])

  const diff = week.earned - week.last
  const lv = summary.level

  const copyRecap = () => {
    const text = [
      `⚡ [SYSTEM STATUS RECAP] Victor Barbuta`,
      `🏆 Hunter Rank: ${lv.hunterGrade} · ${lv.hunterTitle} (Level ${lv.level})`,
      `💥 Combat Power: ${lv.attributes.totalCombatPower.toLocaleString()} CP`,
      `📊 Stats: STR ${lv.attributes.str} | AGI ${lv.attributes.agi} | VIT ${lv.attributes.vit} | INT ${lv.attributes.int} | SEN ${lv.attributes.sen}`,
      `🪙 Coins Earned: ${week.earned} coins (${diff >= 0 ? '+' : ''}${diff} vs last week)`,
      `⚡ XP Gained: +${week.xp} XP (${lv.xpForNext - lv.xpIntoLevel} XP to next rank)`,
      `🛡️ Slips: ${week.slips.length === 0 ? '0 (Clean week!)' : `${week.slips.length} slips`}`,
      goal ? `🎯 Target: ${goal}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast('Hunter Status recap copied to clipboard!', 'good')
      })
      .catch(() => {})
  }

  const filteredRanks = useMemo(() => {
    switch (rankFilter) {
      case 'early':
        return RANKS.filter((r) => r.minLevel <= 14) // E-D-C Rank
      case 'mid':
        return RANKS.filter((r) => r.minLevel >= 18 && r.minLevel <= 45) // B-A Rank
      case 'high':
        return RANKS.filter((r) => r.minLevel >= 50 && r.minLevel <= 75) // S & National
      case 'monarch':
        return RANKS.filter((r) => r.minLevel >= 80) // Monarch & Sovereign
      default:
        return RANKS
    }
  }, [rankFilter])

  return (
    <div className="journey">
      {/* 1. SOLO LEVELING HOLOGRAPHIC PLAYER STATUS WINDOW */}
      <section className="hunter-status-window">
        <div className="system-window-header">
          <span className="system-tag">[ SYSTEM STATUS WINDOW — AWAKENED HUNTER ]</span>
          <span className="system-cp">
            COMBAT POWER: <b>{lv.attributes.totalCombatPower.toLocaleString()} CP</b>
          </span>
        </div>

        <div className="hunter-profile-row">
          <div className="hunter-name-col">
            <h1>
              <span>{lv.rankBadge}</span>
              <span>Victor Barbuta</span>
            </h1>
            <p>
              TITLE: <b>{lv.hunterTitle}</b> · GRADE: <b>{lv.hunterGrade}</b>
            </p>
          </div>

          <div className="hunter-level-badge">
            <div className="hunter-level-num">LV {lv.level}</div>
            <div className="hunter-level-xp">
              {lv.xpIntoLevel} / {lv.xpForNext} XP ({Math.round(lv.progress * 100)}%)
            </div>
          </div>
        </div>

        {/* Solo Leveling Holographic Radar & Stat Allocation Matrix */}
        <div style={{ margin: '20px 0' }}>
          <HolographicRadarChart level={lv} />
        </div>

        {/* Current Hunter Lore & Active Perk Banner */}
        <div className="current-rank-lore-card">
          <div className="lore-header">
            <div className="lore-title">
              <span style={{ fontSize: 18 }}>{lv.rankBadge}</span>
              <span>
                {lv.hunterGrade}: <b>{lv.rank}</b>
              </span>
            </div>
            {lv.nextRank && (
              <span className="count-pill">
                Next Rank: {lv.nextRank.name} (LV {lv.nextRank.minLevel})
              </span>
            )}
          </div>
          <p className="lore-desc">"{lv.rankDesc}"</p>
          <div className="lore-perk-box">
            <Icon name="bolt" size={16} />
            <span>
              <b>Active Hunter Perk:</b> {lv.rankPerk}
            </span>
          </div>
        </div>

        {/* Foundation: The Law of Real Growth */}
        <div className="growth-philosophy-card">
          <div className="philosophy-header">
            <span className="philosophy-symbol">🌱</span>
            <div>
              <h3>LIFE · REAL GROWTH MATRIX</h3>
              <p>LIFE is not a game you play to escape reality. It is a system built to conquer it. Every stat point, level, and coin corresponds to real human evolution.</p>
            </div>
          </div>
          <div className="growth-matrix-grid">
            <div className="growth-stat-item">
              <span className="growth-stat-tag" style={{ color: '#fb7185' }}>⚔️ STR · STRENGTH</span>
              <p>Forged through physical workouts, strength training, and physical grit.</p>
            </div>
            <div className="growth-stat-item">
              <span className="growth-stat-tag" style={{ color: '#38bdf8' }}>⚡ AGI · AGILITY</span>
              <p>Forged through rapid task execution, habit speed, and punctual actions.</p>
            </div>
            <div className="growth-stat-item">
              <span className="growth-stat-tag" style={{ color: '#34d399' }}>🛡️ VIT · VITALITY</span>
              <p>Forged through deep sleep hygiene, waking on time, and physical recovery.</p>
            </div>
            <div className="growth-stat-item">
              <span className="growth-stat-tag" style={{ color: '#a78bfa' }}>🧠 INT · INTELLIGENCE</span>
              <p>Forged through deep study blocks, university excellence, and cognitive focus.</p>
            </div>
            <div className="growth-stat-item">
              <span className="growth-stat-tag" style={{ color: '#fbbf24' }}>👁️ SEN · PERCEPTION</span>
              <p>Forged through urge conquest, streak control, and calendar schedule vigilance.</p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn small ai-sparkle-btn"
            onClick={generateReport}
            disabled={loadingReport}
          >
            <Icon name="spark" size={14} /> {loadingReport ? 'Oracle Synthesizing...' : '✨ Generate AI Tactical Evaluation'}
          </button>
          <button className="btn small ghost" onClick={copyRecap}>
            📋 Copy Status Card
          </button>
        </div>
      </section>

      {/* 2. STATS OVERVIEW CARDS */}
      <section className="stats four">
        <div className="stat hero">
          <span className="label">This week</span>
          <div className="big">
            <Coins n={week.earned} />
          </div>
          <span className="sub">
            {week.last ? `${diff >= 0 ? '+' : ''}${diff} vs last week` : 'Your first week'} · +
            {week.xp} XP
          </span>
        </div>
        <div className="stat">
          <span className="label">Best day</span>
          <div className="big small-big">
            {week.best.coins
              ? new Date(`${week.best.day}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: 'long'
                })
              : '–'}
          </div>
          <span className="sub">{week.best.coins} coins</span>
        </div>
        <div className="stat">
          <span className="label">Hunter Rank</span>
          <div className="big" style={{ fontSize: 20 }}>
            {lv.hunterGrade}
          </div>
          <span className="sub">
            {lv.xpForNext - lv.xpIntoLevel} XP to level {lv.level + 1}
          </span>
        </div>
        <div className="stat">
          <span className="label">Slips this week</span>
          <div className="big small-big">{week.slips.length}</div>
          <span className="sub">
            {week.slips.length ? 'skipped, missed or reset' : 'None. Clean week.'}
          </span>
        </div>
      </section>

      {/* 3. WEEKLY REVIEW & GOAL */}
      <div className="cols even">
        <section className="panel">
          <header className="panel-head">
            <h2>Last 7 days</h2>
            <button className="btn small" onClick={copyRecap} title="Copy hunter stats to clipboard">
              <Icon name="spark" size={13} /> Copy Hunter Recap
            </button>
          </header>
          <div className="week-bars">
            {week.days.map((d) => (
              <div key={d.day} className="day-col">
                <span className="bar">
                  <i
                    style={{
                      height: `${Math.min(100, (d.coins / Math.max(1, week.best.coins)) * 100)}%`
                    }}
                  />
                </span>
                <span className="day-label">
                  {new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </span>
                <span className="day-val">{d.coins}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <h2>One goal for next week</h2>
          </header>
          <textarea
            className="week-goal"
            value={goal}
            placeholder="e.g. Finish every study block on weekdays"
            maxLength={200}
            onChange={(e) => {
              setGoal(e.target.value)
              try {
                localStorage.setItem(GOAL_KEY, e.target.value)
              } catch {
                // kept until restart
              }
            }}
          />
          <p className="hint block-hint">It shows here every time you open Journey.</p>
        </section>
      </div>

      {/* 4. THE 30 SOLO LEVELING HUNTER RANKS CODEX */}
      <section className="panel" style={{ marginTop: 24 }}>
        <header className="panel-head">
          <div>
            <h2>Solo Leveling — Hunter Awakening Codex</h2>
            <span className="hint">
              30 Described Hunter Ranks spanning Levels 1 to 150. Level up by completing daily quests, workouts, and focus blocks.
            </span>
          </div>

          <div className="shop-pills" style={{ marginTop: 8 }}>
            <button
              className={`shop-pill-btn ${rankFilter === 'all' ? 'active' : ''}`}
              onClick={() => setRankFilter('all')}
            >
              All (30)
            </button>
            <button
              className={`shop-pill-btn ${rankFilter === 'early' ? 'active' : ''}`}
              onClick={() => setRankFilter('early')}
            >
              E-D-C Rank
            </button>
            <button
              className={`shop-pill-btn ${rankFilter === 'mid' ? 'active' : ''}`}
              onClick={() => setRankFilter('mid')}
            >
              B-A Rank
            </button>
            <button
              className={`shop-pill-btn ${rankFilter === 'high' ? 'active' : ''}`}
              onClick={() => setRankFilter('high')}
            >
              S & National
            </button>
            <button
              className={`shop-pill-btn ${rankFilter === 'monarch' ? 'active' : ''}`}
              onClick={() => setRankFilter('monarch')}
            >
              Monarch & Sovereign
            </button>
          </div>
        </header>

        <div className="hunter-codex-grid" style={{ marginTop: 18 }}>
          {filteredRanks.map((r) => {
            const isReached = lv.level >= r.minLevel
            const isCurrent = lv.rank === r.name
            return (
              <div
                key={r.name}
                className={`hunter-rank-card ${isCurrent ? 'active' : isReached ? 'unlocked' : 'locked'}`}
                style={{
                  borderLeft: `4px solid ${r.color}`,
                  boxShadow: isCurrent ? `0 0 25px ${r.auraGlow}` : undefined
                }}
              >
                <div className="rank-card-top">
                  <div className="rank-badge-wrap">
                    <span className="rank-badge-icon">{r.badge}</span>
                    <span
                      className="rank-grade-pill"
                      style={{ background: `${r.color}25`, color: r.color }}
                    >
                      {r.grade}
                    </span>
                  </div>
                  <span className="rank-level-tag">
                    {isCurrent ? 'ACTIVE' : `LV ${r.minLevel}+`}
                  </span>
                </div>

                <div className="rank-name-title">
                  <h3>{r.name}</h3>
                  <small>{r.title}</small>
                </div>

                <p className="rank-desc-text">"{r.desc}"</p>

                <div className="rank-perk-footer" style={{ color: r.color }}>
                  <Icon name="bolt" size={14} />
                  <span>{r.perk}</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* AI SOLO LEVELING PERFORMANCE REPORT MODAL */}
      {report && (
        <div className="sheet" role="dialog" aria-label="System Performance Report">
          <div className="sheet-card ai-report-sheet-card" style={{ maxWidth: 680, border: '1px solid #6366f1' }}>
            <div className="ai-report-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="system-tag" style={{ color: '#818cf8', fontWeight: 800 }}>
                  [ SYSTEM EVALUATION PROTOCOL ]
                </span>
                <span className="chip" style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc', fontSize: 11 }}>
                  {report.modelUsed}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
                <span className="grade-badge" style={{ fontSize: 24, fontWeight: 900, color: '#38bdf8' }}>
                  {report.gradeRating}
                </span>
                <h3 style={{ margin: 0, fontSize: 18, color: '#f8fafc' }}>{report.headline}</h3>
              </div>
            </div>

            <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 16, background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 8 }}>
              {report.summary}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div style={{ background: 'rgba(34, 197, 94, 0.05)', border: '1px solid rgba(34, 197, 94, 0.2)', borderRadius: 8, padding: 12 }}>
                <h4 style={{ margin: '0 0 8px', color: '#4ade80', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ⚔️ Core Strengths
                </h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
                  {report.strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>

              <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 8, padding: 12 }}>
                <h4 style={{ margin: '0 0 8px', color: '#fbbf24', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  ⚠️ Vulnerability Vectors
                </h4>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
                  {report.growthAreas.map((g, i) => <li key={i}>{g}</li>)}
                </ul>
              </div>
            </div>

            <div style={{ background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <h4 style={{ margin: '0 0 8px', color: '#818cf8', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                📜 Tactical Directives
              </h4>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#f1f5f9', lineHeight: 1.5 }}>
                {report.strategicDirectives.map((d, i) => <li key={i}>{d}</li>)}
              </ol>
            </div>

            <div style={{ fontStyle: 'italic', fontSize: 12, color: '#94a3b8', borderLeft: '3px solid #818cf8', paddingLeft: 12, marginBottom: 16 }}>
              "{report.warriorVerdict}"
            </div>

            <div className="sheet-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn small ghost"
                onClick={() => {
                  navigator.clipboard.writeText(`⚡ [SOLO LEVELING STRATEGIC REPORT]\nGrade: ${report.gradeRating}\nHeadline: ${report.headline}\n\nSummary:\n${report.summary}\n\nDirectives:\n${report.strategicDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\nVerdict: "${report.warriorVerdict}"`)
                  toast('Tactical Report copied to clipboard!', 'good')
                }}
              >
                📋 Copy Report
              </button>
              <button className="btn primary small" onClick={() => setReport(null)}>
                Acknowledge Directives
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
