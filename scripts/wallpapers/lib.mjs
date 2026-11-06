// Small helpers for drawing the wallpapers as SVG (scripts/wallpapers/build.mjs).
// Everything is drawn from code with a seeded random, so a rebuild gives the
// same files. Original art only: no characters, logos or franchise names.

export const W = 1920
export const H = 1080

/** A seeded random in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A number with at most one decimal (smaller files). */
export const n = (v) => {
  const r = Math.round(v * 10) / 10
  return Object.is(r, -0) ? 0 : r
}
export const pts = (list) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')
export const lerp = (a, b, t) => a + (b - a) * t
export const between = (r, a, b) => a + (b - a) * r()
export const pick = (r, list) => list[Math.floor(r() * list.length)]

export function svg(defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>\n`
}

const stopsOf = (stops) => stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a != null && a !== 1 ? ` stop-opacity="${a}"` : ''}/>`).join('')

/** Vertical by default: lin(id, stops) top to bottom. */
export function lin(id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) {
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopsOf(stops)}</linearGradient>`
}
/** Radial in user space (cx, cy, r in px). */
export function rad(id, stops, cx, cy, r, extra = '') {
  return `<radialGradient id="${id}" cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" gradientUnits="userSpaceOnUse"${extra}>${stopsOf(stops)}</radialGradient>`
}
export const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`

/** A blur over the whole picture (for big soft shapes whose own box would cut the blur off). */
export const wideBlur = (id, sd) => `<filter id="${id}" filterUnits="userSpaceOnUse" x="-100" y="-100" width="${W + 200}" height="${H + 200}"><feGaussianBlur stdDeviation="${sd}"/></filter>`

export const rect = (x, y, w, h, fill, extra = '') => `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
export const circle = (cx, cy, r, fill, extra = '') => `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
export const ellipse = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
export const poly = (list, fill, extra = '') => `<polygon points="${pts(list)}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
export const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra ? ' ' + extra : ''}/>`
export const g = (attrs, body) => `<g ${attrs}>${body}</g>`

/** A ridge line (mountains, hills, dunes) by midpoint displacement, closed down to `bottom`. */
export function ridge(r, { y, amp, rough = 0.55, steps = 7, x0 = -20, x1 = W + 20, bottom = H + 10, ends, smooth = false }) {
  const count = 2 ** steps
  const ys = new Array(count + 1)
  ys[0] = ends ? ends[0] : y + between(r, -amp, amp) * 0.5
  ys[count] = ends ? ends[1] : y + between(r, -amp, amp) * 0.5
  let span = count
  let a = amp
  while (span > 1) {
    const half = span / 2
    for (let i = half; i < count; i += span) ys[i] = (ys[i - half] + ys[i + half]) / 2 + between(r, -a, a)
    span = half
    a *= rough
  }
  const xs = ys.map((_, i) => lerp(x0, x1, i / count))
  if (smooth) {
    let d = `M${n(x0)},${n(bottom)} L${n(xs[0])},${n(ys[0])}`
    for (let i = 1; i < xs.length; i++) {
      const mx = (xs[i - 1] + xs[i]) / 2
      const my = (ys[i - 1] + ys[i]) / 2
      d += ` Q${n(xs[i - 1])},${n(ys[i - 1])} ${n(mx)},${n(my)}`
    }
    return `${d} L${n(x1)},${n(ys[ys.length - 1])} L${n(x1)},${n(bottom)}Z`
  }
  return `M${n(x0)},${n(bottom)} ${xs.map((x, i) => `L${n(x)},${n(ys[i])}`).join(' ')} L${n(x1)},${n(bottom)}Z`
}

/** Smooth rolling line through a few control heights (dunes, hills, waves). */
export function wave(points, bottom = H + 10) {
  // points: [[x, y], ...] left to right; drawn with smooth quadratic joins
  let d = `M${n(points[0][0])},${n(bottom)} L${n(points[0][0])},${n(points[0][1])}`
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1]
    const [x, y] = points[i]
    d += ` C${n(px + (x - px) / 2)},${n(py)} ${n(px + (x - px) / 2)},${n(y)} ${n(x)},${n(y)}`
  }
  const last = points[points.length - 1]
  return `${d} L${n(last[0])},${n(bottom)}Z`
}

/** Dots of light: stars, windows far away, dust. */
export function stars(r, count, { x0 = 0, x1 = W, y0 = 0, y1 = H, rmin = 0.5, rmax = 1.6, color = '#fff', omin = 0.25, omax = 1, fade = null } = {}) {
  let out = ''
  for (let i = 0; i < count; i++) {
    const x = between(r, x0, x1)
    const y = between(r, y0, y1)
    // fewer, fainter stars near the bottom when `fade` is given (a y where they vanish)
    let o = between(r, omin, omax)
    if (fade != null) o *= Math.max(0, 1 - (y - y0) / (fade - y0))
    if (o < 0.05) continue
    const rr = rmin + (rmax - rmin) * r() ** 3
    out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(rr)}" fill="${color}" opacity="${n(o * 100) / 100}"/>`
  }
  return out
}

/** A bright star with a soft four-point flare. */
export function flare(x, y, size, color = '#fff', o = 0.9) {
  const s = size
  return `<g opacity="${o}"><circle cx="${n(x)}" cy="${n(y)}" r="${n(s * 0.35)}" fill="${color}"/><path d="M${n(x - s * 3)},${n(y)} L${n(x)},${n(y - s * 0.18)} L${n(x + s * 3)},${n(y)} L${n(x)},${n(y + s * 0.18)}Z M${n(x)},${n(y - s * 3)} L${n(x + s * 0.18)},${n(y)} L${n(x)},${n(y + s * 3)} L${n(x - s * 0.18)},${n(y)}Z" fill="${color}" opacity="0.7"/></g>`
}

/** A cloud as a cluster of circles on a flat base (anime-style). */
export function cloud(r, cx, cy, w, h, fill, extra = '') {
  // one path: a flat base and a row of round bumps, taller in the middle
  const k = Math.max(3, Math.round(w / Math.max(40, h * 0.9)))
  const x0 = cx - w / 2
  const top = []
  for (let i = 0; i <= k; i++) {
    const t = i / k
    const lift = i === 0 || i === k ? 0 : h * (0.25 + 0.55 * Math.sin(t * Math.PI)) * between(r, 0.8, 1.15)
    top.push([x0 + t * w + (i > 0 && i < k ? between(r, -0.15, 0.15) * (w / k) : 0), cy - lift])
  }
  let d = `M${n(top[0][0])},${n(cy)}`
  for (let i = 1; i < top.length; i++) {
    const [ax, ay] = top[i - 1]
    const [bx, by] = top[i]
    const rr = Math.hypot(bx - ax, by - ay) * between(r, 0.52, 0.7)
    d += ` A${n(rr)},${n(rr)} 0 0 1 ${n(bx)},${n(by)}`
  }
  d += 'Z'
  return `<path d="${d}" fill="${fill}" ${extra}/>`
}

/** Rain: thin slanted lines. */
export function rain(r, count, { color = '#bcd4ff', angle = 0.18, lmin = 18, lmax = 60, omin = 0.08, omax = 0.3, y0 = 0, y1 = H } = {}) {
  let d = ''
  let out = ''
  const groups = [[], [], []]
  for (let i = 0; i < count; i++) {
    const x = between(r, -60, W + 60)
    const y = between(r, y0, y1)
    const l = between(r, lmin, lmax)
    groups[Math.floor(r() * 3)].push(`M${n(x)},${n(y)}l${n(-l * angle)},${n(l)}`)
  }
  groups.forEach((gr, i) => {
    d = gr.join('')
    out += `<path d="${d}" stroke="${color}" stroke-width="${i === 2 ? 1.6 : 1}" opacity="${n((omin + (omax - omin) * (i / 2)) * 100) / 100}" stroke-linecap="round"/>`
  })
  return out
}
