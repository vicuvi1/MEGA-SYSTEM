// The saga's drawn art: vision card pictures, Ben's mentor avatar in each
// outfit of his arc, and the boss sigils. All original inline SVG (no
// franchise characters, ships or logos), in the wallpapers' style: deep
// two-tone gradients, layered silhouettes and one bright accent.
import { useId, type ReactElement } from 'react'
import { VISION_ARTS, type VisionArt } from '@core/vision'
import { ARC, type Outfit } from '@core/benArc'
import type { BossKind } from '@core/season'

const colorsOf = (art: VisionArt) => VISION_ARTS.find((a) => a.id === art)?.colors ?? ['#151a26', '#c8f135']

/** A vision card's picture (160×120, scales to fill). */
export function VisionArtSvg({ art, className }: { art: VisionArt; className?: string }) {
  const id = useId().replace(/:/g, '')
  const [bg, acc] = colorsOf(art)
  const sky = (
    <defs>
      <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={bg} />
        <stop offset="1" stopColor="#07090e" />
      </linearGradient>
      <radialGradient id={`${id}g`} cx="50%" cy="50%" r="50%">
        <stop offset="0" stopColor={acc} stopOpacity="0.9" />
        <stop offset="1" stopColor={acc} stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={acc} />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0.85" />
      </linearGradient>
    </defs>
  )
  const glow = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} fill={`url(#${id}g)`} opacity="0.55" />
  const stars = (
    <g fill="#fff" opacity="0.7">
      <circle cx="18" cy="16" r="0.9" /><circle cx="44" cy="10" r="0.6" /><circle cx="122" cy="14" r="0.8" /><circle cx="146" cy="30" r="0.6" /><circle cx="96" cy="8" r="0.5" /><circle cx="70" cy="22" r="0.5" />
    </g>
  )
  const body: Record<VisionArt, ReactElement> = {
    summit: (
      <>
        {stars}
        {glow(112, 34, 26)}
        <circle cx="112" cy="34" r="10" fill={acc} opacity="0.9" />
        <path d="M0 120 L38 62 L58 84 L88 36 L124 92 L140 76 L160 98 V120Z" fill="#0b0f1a" />
        <path d="M88 36 L98 52 L92 50 L86 58 L80 50Z" fill="#e8edf7" opacity="0.85" />
        <path d="M88 36 V20" stroke="#e8edf7" strokeWidth="1.4" />
        <path d="M88 20 L100 24 L88 28Z" fill={acc} />
        <path d="M0 120 L26 96 L54 110 L82 92 L118 112 L160 100 V120Z" fill="#05070c" />
      </>
    ),
    blade: (
      <>
        {stars}
        {glow(80, 60, 50)}
        <path d="M18 104 L134 22" stroke={`url(#${id}a)`} strokeWidth="5" strokeLinecap="round" />
        <path d="M18 104 L134 22" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
        <path d="M34 92 L44 104" stroke="#c9a14a" strokeWidth="5" strokeLinecap="round" />
        <path d="M20 106 L32 97" stroke="#2a1a14" strokeWidth="7" strokeLinecap="round" />
        <path d="M6 120 Q60 40 160 6" stroke={acc} strokeWidth="0.8" fill="none" opacity="0.5" />
      </>
    ),
    temple: (
      <>
        {glow(80, 48, 34)}
        <circle cx="80" cy="48" r="18" fill={acc} opacity="0.85" />
        <path d="M30 40 Q80 30 130 40 L128 47 Q80 38 32 47Z" fill="#b8261f" />
        <rect x="38" y="52" width="84" height="5" fill="#b8261f" />
        <rect x="46" y="46" width="7" height="60" fill="#9c1f19" />
        <rect x="107" y="46" width="7" height="60" fill="#9c1f19" />
        <path d="M0 106 H160 V120 H0Z" fill="#0a0d14" />
        <path d="M0 102 Q40 96 80 102 T160 100 V108 H0Z" fill="#141a26" opacity="0.8" />
      </>
    ),
    scroll: (
      <>
        {glow(80, 60, 40)}
        <rect x="34" y="28" width="92" height="64" rx="4" fill="#efe3c2" />
        <rect x="28" y="24" width="10" height="72" rx="5" fill="#7a4a24" />
        <rect x="122" y="24" width="10" height="72" rx="5" fill="#7a4a24" />
        <g stroke="#5b4a2e" strokeWidth="1.6" strokeLinecap="round" opacity="0.75">
          <path d="M50 42 H108" /><path d="M50 52 H100" /><path d="M50 62 H106" /><path d="M50 72 H88" />
        </g>
        <circle cx="104" cy="78" r="7" fill="#c8322a" />
        <path d="M101 78 h6 M104 75 v6" stroke="#efe3c2" strokeWidth="1.2" />
      </>
    ),
    iron: (
      <>
        {glow(80, 64, 44)}
        <rect x="30" y="58" width="100" height="8" rx="3" fill="#c9ced8" />
        <rect x="36" y="42" width="12" height="40" rx="3" fill="#2a3240" />
        <rect x="50" y="46" width="9" height="32" rx="3" fill="#3a4454" />
        <rect x="112" y="42" width="12" height="40" rx="3" fill="#2a3240" />
        <rect x="101" y="46" width="9" height="32" rx="3" fill="#3a4454" />
        <g fill={acc}><path d="M80 22 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" /><circle cx="60" cy="30" r="1.5" /><circle cx="102" cy="28" r="1.2" /></g>
        <path d="M0 108 H160 V120 H0Z" fill="#05070c" />
      </>
    ),
    flag: (
      <>
        <g fill={acc} opacity="0.35" fontFamily="monospace" fontSize="7">
          <text x="8" y="16">0101</text><text x="120" y="22">1100</text><text x="30" y="36">10</text><text x="132" y="44">011</text>
        </g>
        {glow(90, 50, 34)}
        <path d="M0 120 Q60 70 160 92 V120Z" fill="#0b0f1a" />
        <path d="M88 82 V28" stroke="#e8edf7" strokeWidth="2" />
        <path d="M88 28 Q104 22 118 30 T146 30 L140 46 Q126 40 114 46 T88 48Z" fill={acc} />
        <path d="M100 34 l4 4 l8 -8" stroke="#07090e" strokeWidth="2" fill="none" />
      </>
    ),
    home: (
      <>
        {stars}
        <circle cx="128" cy="24" r="8" fill="#fff6dc" opacity="0.9" />
        <path d="M40 66 L80 34 L120 66 V104 H40Z" fill="#1d1622" />
        <path d="M32 68 L80 28 L128 68" stroke={acc} strokeWidth="4" fill="none" strokeLinejoin="round" />
        {glow(80, 78, 26)}
        <rect x="70" y="70" width="20" height="18" rx="2" fill="#ffd39a" />
        <path d="M80 70 V88 M70 79 H90" stroke="#1d1622" strokeWidth="1.5" />
        <path d="M0 104 H160 V120 H0Z" fill="#07090e" />
      </>
    ),
    star: (
      <>
        {stars}
        {glow(80, 58, 50)}
        <path d="M80 14 C84 48 92 54 124 58 C92 62 84 68 80 102 C76 68 68 62 36 58 C68 54 76 48 80 14Z" fill={`url(#${id}a)`} />
        <g fill="#fff"><path d="M128 20 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5z" /><path d="M30 88 l1.2 3 3 1.2 -3 1.2 -1.2 3 -1.2 -3 -3 -1.2 3 -1.2z" /></g>
      </>
    ),
    wave: (
      <>
        <circle cx="122" cy="30" r="12" fill="#f4e7cf" opacity="0.9" />
        <path d="M0 92 C20 60 46 40 76 44 C104 48 112 74 92 82 C80 86 72 76 80 70 C70 72 70 88 86 92 C112 98 134 80 160 70 V120 H0Z" fill="#1d3f6e" />
        <path d="M0 98 C24 72 48 56 72 58 C90 60 98 72 88 78" stroke={acc} strokeWidth="2.2" fill="none" />
        <path d="M0 108 C40 98 80 112 160 96 V120 H0Z" fill="#0d1d33" />
        <g fill="#e9f6ff" opacity="0.85"><circle cx="78" cy="46" r="2" /><circle cx="86" cy="50" r="1.6" /><circle cx="92" cy="56" r="1.2" /></g>
      </>
    ),
    sunrise: (
      <>
        {glow(80, 86, 60)}
        <g stroke={acc} strokeWidth="1.6" opacity="0.7">
          <path d="M80 70 V30" /><path d="M80 70 L52 38" /><path d="M80 70 L108 38" /><path d="M80 70 L34 56" /><path d="M80 70 L126 56" />
        </g>
        <circle cx="80" cy="86" r="22" fill={acc} />
        <path d="M0 86 H160 V120 H0Z" fill="#120a12" />
        <path d="M10 96 H70 M90 104 H150 M30 112 H110" stroke={acc} strokeWidth="1.4" opacity="0.5" />
      </>
    ),
    shield: (
      <>
        {glow(80, 58, 44)}
        <path d="M80 18 L118 30 V58 C118 84 100 98 80 106 C60 98 42 84 42 58 V30Z" fill="#1f2a3a" stroke={acc} strokeWidth="3" />
        <path d="M80 30 L106 38 V58 C106 76 94 88 80 94Z" fill={acc} opacity="0.35" />
        <path d="M80 44 l5 10 11 1.5 -8 7.5 2 11 -10 -5.5 -10 5.5 2 -11 -8 -7.5 11 -1.5z" fill="#fff" opacity="0.9" />
      </>
    ),
    key: (
      <>
        {glow(60, 60, 36)}
        <circle cx="56" cy="60" r="18" fill="none" stroke={acc} strokeWidth="7" />
        <path d="M74 60 H132 M118 60 V74 M106 60 V70" stroke={acc} strokeWidth="7" strokeLinecap="round" />
        <circle cx="56" cy="60" r="6" fill="#fff" opacity="0.7" />
      </>
    ),
    crescent: (
      <>
        {stars}
        {glow(108, 32, 26)}
        <path d="M118 16 A20 20 0 1 0 118 52 A16 16 0 1 1 118 16Z" fill="#f4ecd2" />
        <path d="M128 22 l1.4 3.4 3.6 0.3 -2.8 2.3 0.9 3.5 -3.1 -1.9 -3.1 1.9 0.9 -3.5 -2.8 -2.3 3.6 -0.3z" fill={acc} />
        <path d="M30 104 V76 Q50 54 70 76 V104Z" fill="#0f2a2c" />
        <path d="M50 54 V44" stroke="#0f2a2c" strokeWidth="2.5" />
        <rect x="84" y="62" width="8" height="42" fill="#0f2a2c" />
        <path d="M84 62 L88 50 L92 62Z" fill="#0f2a2c" />
        <path d="M0 104 H160 V120 H0Z" fill="#061314" />
      </>
    ),
    coin: (
      <>
        {glow(80, 60, 44)}
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <ellipse cx="72" cy={96 - i * 12} rx="26" ry="8" fill="#a3780f" />
            <ellipse cx="72" cy={92 - i * 12} rx="26" ry="8" fill={acc} />
          </g>
        ))}
        <ellipse cx="116" cy="88" rx="16" ry="16" fill={acc} stroke="#a3780f" strokeWidth="3" />
        <path d="M116 80 V96 M111 84 h8 M111 92 h8" stroke="#6b4e08" strokeWidth="1.8" />
      </>
    )
  }
  return (
    <svg className={className} viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {sky}
      <rect width="160" height="120" fill={`url(#${id}s)`} />
      {body[art]}
    </svg>
  )
}

/** Ben the mentor in one of his arc's outfits (original art), on a disc with his chapter's aura. */
export function BenArcAvatar({ outfit, size = 96, locked = false }: { outfit: Outfit; size?: number; locked?: boolean }) {
  const id = useId().replace(/:/g, '')
  const ch = ARC.find((c) => c.outfit === outfit) ?? ARC[0]
  const aura = locked ? '#3a4150' : ch.aura
  const skin = '#d9a77f'
  const hair = outfit === 'master' ? '#d8dde6' : '#16181f'
  const robe: Record<Outfit, { base: string; trim: string }> = {
    traveler: { base: '#3b3f4a', trim: '#5a5f6c' },
    gi: { base: '#eef1f6', trim: '#c8cfdb' },
    haori: { base: '#1d2233', trim: '#ff9f43' },
    armor: { base: '#2a1420', trim: '#ff3ea5' },
    starcloak: { base: '#141b2b', trim: '#38d8ff' },
    master: { base: '#f4f1e8', trim: '#f5c84b' }
  }
  const r = robe[outfit]
  return (
    <svg className={`ben-arc-av ${locked ? 'locked' : ''}`} width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={`Ben in his ${ch.outfitLabel.toLowerCase()}${locked ? ' (locked)' : ''}`}>
      <defs>
        <radialGradient id={`${id}bg`} cx="50%" cy="40%" r="65%">
          <stop offset="0" stopColor={aura} stopOpacity="0.45" />
          <stop offset="0.6" stopColor="#111621" />
          <stop offset="1" stopColor="#07090e" />
        </radialGradient>
        <clipPath id={`${id}c`}><circle cx="60" cy="60" r="58" /></clipPath>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#${id}bg)`} />
      <g clipPath={`url(#${id}c)`} opacity={locked ? 0.35 : 1}>
        {outfit === 'master' && <circle cx="60" cy="50" r="40" fill="none" stroke={aura} strokeWidth="1.5" opacity="0.6" strokeDasharray="2 5" />}
        {outfit === 'starcloak' && (
          <g>
            <path d="M84 30 L98 96" stroke={aura} strokeWidth="5" strokeLinecap="round" opacity="0.9" />
            <path d="M84 30 L98 96" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        )}
        {outfit === 'armor' && <path d="M36 32 L60 14 L84 32 L78 34 L60 22 L42 34Z" fill={r.trim} />}
        {/* shoulders and robe */}
        <path d="M14 120 C16 92 34 80 60 80 C86 80 104 92 106 120Z" fill={r.base} />
        {outfit === 'armor' && (
          <g fill="#3d1d2d" stroke={r.trim} strokeWidth="1.2">
            <path d="M14 104 C16 90 24 84 38 82 L42 98 C30 100 22 104 14 108Z" />
            <path d="M106 104 C104 90 96 84 82 82 L78 98 C90 100 98 104 106 108Z" />
          </g>
        )}
        <path d="M46 82 L60 106 L74 82" fill="none" stroke={r.trim} strokeWidth="4" strokeLinejoin="round" />
        {outfit === 'haori' && <circle cx="84" cy="98" r="6" fill="none" stroke={r.trim} strokeWidth="1.6" />}
        {outfit === 'gi' && <path d="M30 112 H90" stroke="#16181f" strokeWidth="4" />}
        {outfit === 'master' && <path d="M60 106 V120" stroke={r.trim} strokeWidth="2" />}
        {/* neck and head */}
        <rect x="53" y="66" width="14" height="16" rx="5" fill={skin} />
        <ellipse cx="60" cy="52" rx="19" ry="22" fill={skin} />
        {/* hair, topknot, headband */}
        {outfit !== 'traveler' && <path d="M41 50 C40 32 50 26 60 26 C70 26 80 32 79 50 C76 40 70 36 60 36 C50 36 44 40 41 50Z" fill={hair} />}
        {outfit !== 'traveler' && outfit !== 'gi' && <ellipse cx="60" cy="24" rx="5" ry="6" fill={hair} />}
        {outfit === 'gi' && <path d="M41 42 Q60 36 79 42 L79 46 Q60 40 41 46Z" fill="#c8322a" />}
        {/* eyes, brows, mouth */}
        <path d="M49 50 l7 -1.5 M71 50 l-7 -1.5" stroke="#1a1a1f" strokeWidth="2" strokeLinecap="round" />
        <path d="M51 55 h5 M64 55 h5" stroke="#1a1a1f" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M55 65 Q60 67 65 65" stroke="#7a4a3a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {outfit === 'master' && <path d="M50 66 C52 76 56 82 60 84 C64 82 68 76 70 66 C66 70 54 70 50 66Z" fill={hair} opacity="0.95" />}
        {/* the traveller's hood */}
        {outfit === 'traveler' && (
          <>
            <path d="M34 66 C30 38 42 22 60 22 C78 22 90 38 86 66 C82 54 76 44 60 44 C44 44 38 54 34 66Z" fill={r.base} />
            <path d="M34 66 C30 38 42 22 60 22 C78 22 90 38 86 66" fill="none" stroke={r.trim} strokeWidth="1.5" />
          </>
        )}
      </g>
      <circle cx="60" cy="60" r="58" fill="none" stroke={aura} strokeWidth="2.5" opacity={locked ? 0.4 : 0.9} />
      {locked && <text x="60" y="68" textAnchor="middle" fontSize="22">🔒</text>}
    </svg>
  )
}

/** The boss's sigil (a drawn crest by kind) for the boss card. */
export function BossSigil({ kind, color, size = 72 }: { kind: BossKind; color: string; size?: number }) {
  const id = useId().replace(/:/g, '')
  const inner: Record<BossKind, ReactElement> = {
    exam: <path d="M36 22 h22 l8 8 v34 h-30z M58 22 v8 h8 M42 40 h18 M42 48 h18 M42 56 h12" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />,
    ctf: <path d="M38 66 V22 M38 24 Q50 18 60 24 T80 24 V44 Q70 38 60 44 T38 44" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinejoin="round" />,
    fitness: <path d="M26 46 h40 M30 36 v20 M36 32 v28 M62 36 v20 M56 32 v28" stroke="#fff" strokeWidth="3" strokeLinecap="round" />,
    project: <path d="M46 64 C46 46 52 30 60 22 C68 30 74 46 74 64Z M50 58 l-8 10 h12 M70 58 l8 10 h-12 M60 34 a4 4 0 1 0 0.1 0" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" transform="translate(-14 0)" />,
    other: <path d="M28 66 L66 28 M30 30 L64 64 M24 70 l8 -2 -6 -6z M70 24 l-2 8 -6 -6z" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" fill="#fff" />
  }
  return (
    <svg width={size} height={size} viewBox="0 0 92 92" aria-hidden="true" className="sg-sigil">
      <defs>
        <radialGradient id={`${id}r`} cx="50%" cy="45%" r="60%">
          <stop offset="0" stopColor={color} stopOpacity="0.9" />
          <stop offset="1" stopColor="#0a0c12" />
        </radialGradient>
      </defs>
      <path d="M46 4 L84 26 V66 L46 88 L8 66 V26Z" fill={`url(#${id}r)`} stroke={color} strokeWidth="2" />
      <path d="M46 12 L77 30 V62 L46 80 L15 62 V30Z" fill="none" stroke="#fff" strokeOpacity="0.25" />
      <g transform="translate(0 0)">{inner[kind]}</g>
    </svg>
  )
}
