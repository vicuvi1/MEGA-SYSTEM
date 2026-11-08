// A drawn backdrop for a reward without a photo (Rewards 2): soft shapes per
// kind of reward on its gradient, drawn here as SVG, so nothing is loaded
// from anywhere and nothing can break. Your own photos still win.
import type { RewardCategory } from '@core/shop'

const W = 'rgb(255 255 255 / 0.22)'
const W2 = 'rgb(255 255 255 / 0.12)'

function Shapes({ cat }: { cat: RewardCategory }) {
  switch (cat) {
    case 'fun':
      // A d-pad, buttons and sparkles.
      return (
        <g fill={W}>
          <path d="M18 34h8v-8h8v8h8v8h-8v8h-8v-8h-8z" />
          <circle cx="132" cy="30" r="6" />
          <circle cx="146" cy="42" r="6" fill={W2} />
          <circle cx="118" cy="42" r="6" fill={W2} />
          <circle cx="132" cy="54" r="6" />
          <path d="M70 80l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill={W2} />
          <path d="M150 82l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
        </g>
      )
    case 'food':
      // Bubbles and crumbs.
      return (
        <g fill={W}>
          <circle cx="22" cy="24" r="12" fill={W2} />
          <circle cx="40" cy="78" r="7" />
          <circle cx="140" cy="22" r="9" />
          <circle cx="128" cy="76" r="15" fill={W2} />
          <circle cx="152" cy="58" r="4" />
          <circle cx="14" cy="60" r="4" />
          <circle cx="80" cy="12" r="3" />
        </g>
      )
    case 'gear':
      // Circuit lines with nodes.
      return (
        <g stroke={W} strokeWidth="2.5" fill="none" strokeLinecap="round">
          <path d="M0 26h30l10 10h22" />
          <path d="M160 70h-34l-10-10h-18" />
          <path d="M0 82h18l8-8h14" stroke={W2} />
          <path d="M160 18h-22l-8 8h-12" stroke={W2} />
          <g fill={W} stroke="none">
            <circle cx="62" cy="36" r="4" />
            <circle cx="98" cy="60" r="4" />
            <circle cx="40" cy="74" r="3" />
            <circle cx="118" cy="26" r="3" />
          </g>
        </g>
      )
    case 'experience':
      // Stars and a ticket edge.
      return (
        <g fill={W}>
          <path d="M24 20l3.5 7.5 8 1-6 5.5 1.7 8L24 38l-7.2 4 1.7-8-6-5.5 8-1z" />
          <path d="M138 64l2.6 5.6 6 .8-4.4 4 1.2 6-5.4-3-5.4 3 1.2-6-4.4-4 6-.8z" fill={W2} />
          <g fill={W2}>
            {[10, 26, 42, 58, 74, 90].map((y) => (
              <circle key={y} cx="160" cy={y} r="5" />
            ))}
          </g>
          <circle cx="120" cy="20" r="2.5" />
          <circle cx="40" cy="80" r="2.5" />
        </g>
      )
    case 'selfcare':
      // Calm waves.
      return (
        <g stroke={W} strokeWidth="3" fill="none" strokeLinecap="round">
          <path d="M-4 72c20-10 34 10 54 0s34-10 54 0 34 10 60 0" />
          <path d="M-4 86c20-10 34 10 54 0s34-10 54 0 34 10 60 0" stroke={W2} />
          <path d="M-4 18c20-8 34 8 54 0s34-8 54 0 34 8 60 0" stroke={W2} />
        </g>
      )
    case 'games':
      // A screen with a play triangle and pixels.
      return (
        <g fill={W}>
          <rect x="96" y="14" width="52" height="34" rx="5" fill={W2} />
          <path d="M116 22l14 9-14 9z" />
          <rect x="14" y="64" width="10" height="10" />
          <rect x="28" y="74" width="10" height="10" fill={W2} />
          <rect x="120" y="68" width="10" height="10" fill={W2} />
          <rect x="134" y="78" width="10" height="10" />
        </g>
      )
    case 'media':
      // A film strip and a spotlight.
      return (
        <g fill={W}>
          <rect x="0" y="12" width="160" height="14" fill={W2} />
          {[6, 28, 50, 72, 94, 116, 138].map((x) => (
            <rect key={x} x={x} y="15" width="9" height="8" rx="1.5" fill={W} />
          ))}
          <circle cx="40" cy="66" r="14" fill={W2} />
          <path d="M104 52l26 18-26 18z" />
        </g>
      )
    case 'people':
      // Two chat bubbles.
      return (
        <g fill={W}>
          <path d="M16 22h56a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H42l-12 10v-10h-14a8 8 0 0 1-8-8V30a8 8 0 0 1 8-8z" transform="translate(4 0)" />
          <path d="M96 52h48a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8h-8v9l-11-9H96a8 8 0 0 1-8-8V60a8 8 0 0 1 8-8z" fill={W2} />
        </g>
      )
    case 'treat':
      // Sprinkles and a candy.
      return (
        <g fill={W}>
          <path d="M30 70l30-16 6 12-30 16z" fill={W2} />
          <circle cx="120" cy="30" r="10" />
          <rect x="20" y="20" width="14" height="5" rx="2.5" transform="rotate(30 27 22)" />
          <rect x="70" y="16" width="14" height="5" rx="2.5" transform="rotate(-40 77 18)" fill={W2} />
          <rect x="130" y="72" width="14" height="5" rx="2.5" transform="rotate(60 137 74)" />
        </g>
      )
    case 'big':
      // Mountains and a sun.
      return (
        <g>
          <circle cx="128" cy="26" r="11" fill={W} />
          <path d="M-6 100L38 46l22 24 22-30 46 60z" fill={W2} />
          <path d="M60 100l40-44 34 30 32-22v36z" fill={W} />
        </g>
      )
  }
}

export function CoverArt({ cat }: { cat: RewardCategory }) {
  return (
    <svg className="rx-art" viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden focusable="false">
      <Shapes cat={cat} />
    </svg>
  )
}
