// Custom Center: simple static drawings of a widget and of the island pill,
// from the plain WidgetView data (core/custom/layout.ts widgetState). The
// island rebuild draws its own; these are the live preview on the page.
import type { CSSProperties, ReactNode } from 'react'
import type { Looks, WidgetView } from '@core/custom'
import { centerLooksToIsland } from '@core/islandCenter'

/** A small progress ring (SVG), drawn once; no animation. */
export function Ring({ value, size = 34, stroke = 4, color }: { value: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="cc-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color ?? 'var(--cc-accent)'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
  )
}

const fontVar: Record<Looks['font']['family'], string> = { system: 'var(--font)', rounded: "'Nunito', 'Segoe UI Rounded', var(--font)", mono: 'var(--mono)', serif: "Georgia, 'Times New Roman', serif" }

/** CSS variables of the looks, for a preview box. */
export function looksStyle(l: Looks): CSSProperties {
  return {
    ['--cc-accent' as string]: l.colors.accent,
    ['--cc-glow' as string]: String(l.colors.glow),
    ['--cc-blur' as string]: `${l.colors.blur}px`,
    ['--cc-radius' as string]: `${l.island.radius}px`,
    ['--cc-font' as string]: fontVar[l.font.family],
    ['--cc-nums' as string]: l.font.numbers === 'tabular' ? 'tabular-nums' : 'normal'
  }
}

/** One widget as a card (the app home and the open island preview). */
export function WidgetCard({ v, numbers, children }: { v: WidgetView; numbers?: Looks['font']['numbers']; children?: ReactNode }) {
  const style = v.color ? ({ ['--cc-w' as string]: v.color } as CSSProperties) : undefined
  return (
    <div className={`cc-card cc-k-${v.kind} ${v.done ? 'is-done' : ''}`} style={style} data-widget={v.id}>
      <div className="cc-card-top">
        <span className="cc-card-icon" aria-hidden="true">{v.icon}</span>
        <span className="cc-card-title">{v.title}</span>
        {v.progress != null && v.kind !== 'ring' && <Ring value={v.progress} size={22} stroke={3} color={v.color ?? undefined} />}
      </div>
      <div className="cc-card-main">
        {v.kind === 'ring' && <Ring value={v.progress ?? 0} size={44} stroke={5} color={v.color ?? undefined} />}
        <b className={`cc-value ${numbers === 'segment' ? 'cc-seg' : ''}`}>{v.value}</b>
      </div>
      {v.sub && <small className="cc-card-sub">{v.sub}</small>}
      {children}
    </div>
  )
}

/** The island pill as it would look, with its widgets side by side. */
export function PillPreview({ items, looks, open }: { items: WidgetView[]; looks: Looks; open?: WidgetView[] }) {
  const { shape, size } = looks.island
  // What the desktop island gets from these looks (the same conversion the island uses).
  const isl = centerLooksToIsland(looks)
  return (
    <div className={`cc-pill-wrap cc-shape-${shape} cc-size-${size}`} style={looksStyle(looks)} data-testid="cc-pill-preview" data-island-size={isl.size ?? 'medium'} data-island-radius={isl.radius ?? ''}>
      <div className="cc-pill" role="img" aria-label={items.length ? `Island pill: ${items.map((v) => `${v.title} ${v.value}`).join(', ')}` : 'Island pill: empty'}>
        {items.length ? (
          items.map((v) => (
            <span key={v.id} className="cc-pill-item" style={v.color ? ({ ['--cc-w' as string]: v.color } as CSSProperties) : undefined}>
              {v.progress != null ? <Ring value={v.progress} size={16} stroke={2.5} color={v.color ?? undefined} /> : <i aria-hidden="true">{v.icon}</i>}
              <b className={looks.font.numbers === 'segment' ? 'cc-seg' : ''}>{v.value}</b>
            </span>
          ))
        ) : (
          <span className="cc-pill-empty">Drop widgets here</span>
        )}
      </div>
      {open && open.length > 0 && (
        <div className="cc-island-open">
          {open.map((v) => (
            <WidgetCard key={v.id} v={v} numbers={looks.font.numbers} />
          ))}
        </div>
      )}
    </div>
  )
}
