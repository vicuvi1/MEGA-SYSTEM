// Small line icons for habits (24×24, drawn with the current colour).
import type { CSSProperties } from 'react'

const PATHS: Record<string, string> = {
  sunrise: 'M12 3v3M5.6 8.6l1.4 1.4M18.4 8.6 17 10M3 17h18M7 17a5 5 0 0 1 10 0M8 21h8',
  shield: 'M12 3 5 6v5c0 4.6 3 8.3 7 10 4-1.7 7-5.4 7-10V6l-7-3ZM9 12l2 2 4-4',
  dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 12h.01',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z',
  wallet: 'M3 7a2 2 0 0 1 2-2h11v4M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2ZM16 14h.01',
  book: 'M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2ZM12 6.5v13',
  drop: 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z',
  run: 'M13 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM7 21l3-5 3 2v-5l-3-3 3-2 2 3h3M10 8 7 10',
  leaf: 'M5 19C5 10 10 5 20 4c-1 10-6 15-15 15ZM5 19l8-8',
  bed: 'M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5a1.5 1.5 0 1 0 0-.01',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2M4 4l16 16',
  pen: 'M15 5l4 4L8 20H4v-4L15 5ZM13 7l4 4',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z',
  brain: 'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1ZM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
  check: 'M5 12.5 10 17l9-10',
  play: 'M8 5.5v13l10.5-6.5L8 5.5Z',
  arrow: 'M5 12h13M13 6l6 6-6 6',
  skip: 'M5 6l7 6-7 6V6ZM14 6v12M19 6v12'
}

export function HabitIcon({ name, size = 18, style }: { name: string; size?: number; style?: CSSProperties }) {
  return (
    <svg className="hb-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={PATHS[name] ?? PATHS.check} />
    </svg>
  )
}

/** The habit colours (dark and light themes pick their shade in CSS from these). */
export const COLOR_HEX: Record<string, string> = {
  lime: '#a3e635',
  amber: '#f5b53d',
  coral: '#ff7a59',
  pink: '#f472b6',
  violet: '#a78bfa',
  sky: '#38bdf8',
  teal: '#2dd4bf',
  slate: '#94a3b8'
}
