import { useMemo } from 'react'
import { motion } from 'framer-motion'

interface Props {
  stats: {
    str: number
    agi: number
    vit: number
    int: number
    sen: number
  }
  size?: number
}

const STAT_CONFIG = [
  { key: 'str', label: 'STR', name: 'Strength', color: '#ff6b8b' },
  { key: 'agi', label: 'AGI', name: 'Agility', color: '#38bdf8' },
  { key: 'vit', label: 'VIT', name: 'Vitality', color: '#4ade80' },
  { key: 'int', label: 'INT', name: 'Intelligence', color: '#b892ff' },
  { key: 'sen', label: 'SEN', name: 'Perception', color: '#f5c84b' }
] as const

export function RadarChart({ stats, size = 240 }: Props) {
  const center = size / 2
  const maxRadius = (size / 2) * 0.72

  // Determine scale (minimum scale of 30, or 1.25x max stat)
  const maxStat = Math.max(25, ...Object.values(stats))
  const scaleLimit = Math.max(30, Math.ceil(maxStat * 1.15))

  // 5 angle positions: 0 = top (-90 deg), then evenly spaced by 72 deg
  const angles = useMemo(() => {
    return [0, 1, 2, 3, 4].map((i) => -Math.PI / 2 + (i * 2 * Math.PI) / 5)
  }, [])

  // Web rings at 25%, 50%, 75%, 100%
  const webRings = useMemo(() => {
    return [0.25, 0.5, 0.75, 1.0].map((pct) => {
      const r = maxRadius * pct
      const points = angles
        .map((ang) => `${center + r * Math.cos(ang)},${center + r * Math.sin(ang)}`)
        .join(' ')
      return { pct, points }
    })
  }, [center, maxRadius, angles])

  // Player stat polygon coordinates
  const statPoints = useMemo(() => {
    return STAT_CONFIG.map((cfg, i) => {
      const val = stats[cfg.key] || 0
      const norm = Math.min(1, Math.max(0.12, val / scaleLimit))
      const r = maxRadius * norm
      const ang = angles[i]
      return {
        x: center + r * Math.cos(ang),
        y: center + r * Math.sin(ang),
        val,
        cfg
      }
    })
  }, [stats, scaleLimit, maxRadius, angles, center])

  const polygonPath = statPoints.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="radar-chart-wrap" style={{ width: size, height: size, position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="radar-chart-svg">
        <defs>
          <radialGradient id="radarGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#00f2fe" stopOpacity="0.45" />
            <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#a855f7" stopOpacity="0.1" />
          </radialGradient>
          <filter id="radarGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Web Rings (Background Grids) */}
        {webRings.map(({ pct, points }) => (
          <polygon
            key={pct}
            points={points}
            fill="none"
            stroke="rgba(0, 210, 255, 0.15)"
            strokeWidth={pct === 1.0 ? '1.5' : '1'}
            strokeDasharray={pct === 1.0 ? undefined : '3,3'}
          />
        ))}

        {/* Axis Spokes from center to edge */}
        {angles.map((ang, i) => (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={center + maxRadius * Math.cos(ang)}
            y2={center + maxRadius * Math.sin(ang)}
            stroke="rgba(0, 210, 255, 0.2)"
            strokeWidth="1"
          />
        ))}

        {/* Filled Stat Polygon */}
        <motion.polygon
          points={polygonPath}
          fill="url(#radarGradient)"
          stroke="#00f2fe"
          strokeWidth="2.5"
          filter="url(#radarGlow)"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          style={{ transformOrigin: `${center}px ${center}px` }}
        />

        {/* Stat Vertex Glow Nodes */}
        {statPoints.map((p, i) => (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="4.5"
            fill={p.cfg.color}
            stroke="#000"
            strokeWidth="1.5"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2 + i * 0.08, duration: 0.3 }}
            filter="drop-shadow(0 0 4px #00f2fe)"
          />
        ))}

        {/* Perimeter Labels with Value */}
        {STAT_CONFIG.map((cfg, i) => {
          const ang = angles[i]
          const labelDist = maxRadius + 22
          const lx = center + labelDist * Math.cos(ang)
          const ly = center + labelDist * Math.sin(ang)
          const val = stats[cfg.key] || 0

          return (
            <g key={cfg.key} transform={`translate(${lx}, ${ly})`}>
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fill={cfg.color}
                fontSize="11"
                fontWeight="900"
                fontFamily="var(--display)"
                letterSpacing="0.05em"
              >
                {cfg.label}
              </text>
              <text
                textAnchor="middle"
                dominantBaseline="central"
                y="12"
                fill="#f1f5f9"
                fontSize="10"
                fontWeight="700"
                fontFamily="var(--mono)"
              >
                {val}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
