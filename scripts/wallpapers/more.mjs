// Cyberpunk, nature and minimal scenes.
import { W, H, rng, n, lerp, between, pick, svg, lin, rad, blur, wideBlur, rect, circle, ellipse, poly, path, g, ridge, wave, stars, rain, flare } from './lib.mjs'

export function neonGrid() {
  const r = rng(301)
  const hz = 640
  let defs = lin('sky', [[0, '#0a0420'], [0.55, '#2a0a4a'], [1, '#7a1a6a']])
  defs += lin('sun', [[0, '#ffe36a'], [0.45, '#ff8a4a'], [1, '#ff2a8a']])
  defs += lin('floor', [[0, '#1a0430'], [1, '#05010c']])
  defs += rad('glow', [[0, '#ff4fb0', 0.6], [1, '#ff4fb0', 0]], 960, hz, 700)
  defs += `<clipPath id="sunc"><circle cx="960" cy="${hz - 120}" r="260"/></clipPath>`
  defs += blur('b6', 6)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 160, { y0: 0, y1: 420, rmax: 1.3, omax: 0.9, fade: 520 })
  body += rect(0, 0, W, H, 'url(#glow)')
  // the striped sun
  let sun = rect(700, hz - 380, 520, 520, 'url(#sun)')
  for (let i = 0; i < 9; i++) {
    const y = hz - 160 + i * 18
    sun += rect(680, y, 560, 4 + i * 1.6, '#2a0a4a')
  }
  body += `<g clip-path="url(#sunc)">${sun}</g>`
  body += circle(960, hz - 120, 300, '#ff6aa8', 'opacity="0.2" filter="url(#b6)"')
  // wireframe mountains
  const mtn = (pts2, c) => {
    let out = poly(pts2, '#12052a')
    out += `<polyline points="${pts2.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5"/>`
    for (let i = 1; i < pts2.length - 1; i++) out += `<path d="M${n(pts2[i][0])},${n(pts2[i][1])} L${n(pts2[i][0] + between(r, -60, 60))},${hz}" stroke="${c}" stroke-width="1.2" opacity="0.6"/>`
    return out
  }
  body += mtn([[0, hz], [120, 520], [260, 580], [380, 470], [520, 560], [640, hz]], '#3ae0ff')
  body += mtn([[1280, hz], [1400, 540], [1520, 470], [1660, 560], [1780, 500], [1920, 560], [1920, hz]], '#3ae0ff')
  // the floor grid in perspective
  body += rect(0, hz, W, H - hz, 'url(#floor)')
  let grid = ''
  for (let i = -24; i <= 24; i++) grid += `<path d="M${960 + i * 40},${hz} L${960 + i * 260},${H}" stroke="#ff3ad0" stroke-width="2"/>`
  for (let k = 1; k <= 14; k++) {
    const y = hz + (H - hz) * (k / 14) ** 2.1
    grid += `<path d="M0,${n(y)} H${W}" stroke="#ff3ad0" stroke-width="${n(1 + k * 0.18)}"/>`
  }
  body += g('opacity="0.35" filter="url(#b6)"', grid) + g('opacity="0.9"', grid)
  body += rect(0, hz - 2, W, 4, '#ff8ad8')
  return svg(defs, body)
}

export function rooftop() {
  const r = rng(302)
  let defs = lin('sky', [[0, '#04060f'], [0.6, '#151a3a'], [1, '#3a1a4a']])
  defs += rad('cityglow', [[0, '#ff3a8a', 0.5], [0.5, '#5a2aff', 0.2], [1, '#000', 0]], 960, 900, 1000)
  defs += lin('roof', [[0, '#0d0c16'], [1, '#05050a']])
  defs += blur('b4', 4) + blur('b16', 16)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 60, { y0: 0, y1: 240, rmax: 1.1, omax: 0.5 })
  body += rect(0, 0, W, H, 'url(#cityglow)')
  // three layers of towers, the far ones hazy
  const layer = (count, hmin, hmax, wmin, wmax, base, col, winA, signs) => {
    let out = ''
    let x = -40
    while (x < W + 40) {
      const w = between(r, wmin, wmax)
      const h = between(r, hmin, hmax)
      const top = base - h
      out += rect(x, top, w, h + 40, col)
      if (r() < 0.3) out += rect(x + w / 2 - 2, top - between(r, 30, 90), 4, 90, col) + circle(x + w / 2, top - 70, 3, '#ff4a4a')
      for (let yy = top + 10; yy < base; yy += 14) for (let xx = x + 6; xx < x + w - 8; xx += 12) if (r() < winA) out += rect(xx, yy, 6, 7, pick(r, ['#7fe8ff', '#ff8fd0', '#ffd27a', '#b9a0ff']), `opacity="${n(between(r, 0.3, 0.8) * 100) / 100}"`)
      if (signs && r() < 0.45) {
        const c = pick(r, ['#ff2a8a', '#2ae6ff', '#ffb02e', '#a26bff', '#3dffb5'])
        const sh = between(r, 60, 160)
        const sy = between(r, top + 20, base - sh - 20)
        out += rect(x + w - 10, sy, 16, sh, c, 'opacity="0.85"') + rect(x + w - 30, sy - 10, 56, sh + 20, c, 'opacity="0.25" filter="url(#b16)"')
      }
      x += w + between(r, 4, 20)
    }
    return out
  }
  body += g('opacity="0.55"', layer(0, 300, 640, 50, 120, 860, '#1b1640', 0.12, false))
  body += layer(0, 240, 520, 70, 160, 940, '#120f2a', 0.16, true)
  // a big hologram in the sky (an abstract shape, no logo)
  body += g('opacity="0.5"', `<path d="M1380,260 l70,-40 l70,40 v80 l-70,40 l-70,-40z" fill="none" stroke="#2ae6ff" stroke-width="4"/><path d="M1450,220 v160 M1380,260 l140,80 M1520,260 l-140,80" stroke="#2ae6ff" stroke-width="2" opacity="0.7"/>`) + circle(1450, 300, 120, '#2ae6ff', 'opacity="0.12" filter="url(#b16)"')
  // flying lights (cars) on a curve
  let cars = ''
  for (let i = 0; i < 24; i++) {
    const t = r()
    const x = lerp(-50, W + 50, t)
    const y = 420 + Math.sin(t * Math.PI * 1.4) * 60 + between(r, -10, 10)
    cars += rect(x, y, between(r, 14, 30), 3, pick(r, ['#ffffff', '#ff6a6a', '#ffd27a']), `opacity="${n(between(r, 0.5, 0.9) * 100) / 100}" rx="1.5"`)
  }
  body += cars
  // the rooftop we're on: ledge, water tank, antennas, someone sitting on the edge
  body += path('M-20,1100 L-20,900 L760,880 L1940,930 L1940,1100Z', 'url(#roof)')
  body += rect(-20, 880, 800, 14, '#16142a') + `<path d="M-20,882 L760,868 L1940,918" stroke="#ff3a8a" stroke-width="1.6" opacity="0.35"/>`
  body += g('fill="#06060c"', rect(1500, 640, 220, 200, '#06060c', 'rx="20"') + rect(1520, 840, 14, 90, '#06060c') + rect(1686, 840, 14, 90, '#06060c') + poly([[1490, 650], [1610, 590], [1730, 650]], '#06060c'))
  body += `<path d="M1300,930 V700 M1270,740 H1330 M1280,780 H1320" stroke="#06060c" stroke-width="5"/>` + circle(1300, 700, 4, '#ff4a4a')
  body += g('transform="translate(540,878)" fill="#06060c"', path('M-20,0 Q-24,-50 -6,-74 Q10,-84 22,-70 Q30,-40 26,0Z', '#06060c') + circle(4, -92, 16, '#06060c') + path('M-14,-2 L-30,50 L-18,54 L2,6Z M12,-2 L14,56 L26,56 L28,0Z', '#06060c') + path('M-12,-104 Q4,-122 20,-104 L18,-96 Q4,-108 -10,-96Z', '#06060c'))
  body += rain(r, 380, { color: '#a8b8ff', omin: 0.06, omax: 0.2 })
  return svg(defs, body)
}

export function forest() {
  const r = rng(303)
  let defs = lin('sky', [[0, '#cfe3e0'], [0.6, '#e9efe2'], [1, '#f4f0dc']])
  defs += lin('fog', [[0, '#eef3ea', 0], [0.5, '#eef3ea', 0.85], [1, '#eef3ea', 0]])
  defs += rad('sun', [[0, '#fffbe6', 0.95], [1, '#fffbe6', 0]], 1350, 220, 600)
  defs += blur('b30', 30)
  let body = rect(0, 0, W, H, 'url(#sky)') + rect(0, 0, W, H, 'url(#sun)')
  const pine = (x, base, h, c) => {
    const w = h * 0.28
    let d = `M${n(x)},${n(base - h)}`
    const tiers = 7
    for (let i = 1; i <= tiers; i++) {
      const t = i / tiers
      const y = base - h + h * t * 0.92
      d += ` L${n(x + w * t * 0.5 + w * 0.12)},${n(y)} L${n(x + w * t * 0.3)},${n(y - h * 0.03)}`
    }
    d += ` L${n(x + 4)},${n(base)} L${n(x - 4)},${n(base)}`
    for (let i = tiers; i >= 1; i--) {
      const t = i / tiers
      const y = base - h + h * t * 0.92
      d += ` L${n(x - w * t * 0.3)},${n(y - h * 0.03)} L${n(x - w * t * 0.5 - w * 0.12)},${n(y)}`
    }
    return path(d + 'Z', c)
  }
  const rows = [
    [560, 40, 120, 200, '#a9c3bb', 0.8],
    [660, 34, 160, 260, '#86a89c', 0.85],
    [770, 28, 220, 340, '#5f8578', 0.9],
    [900, 20, 300, 460, '#3c5f52', 1],
    [1080, 12, 480, 700, '#1f3a30', 1]
  ]
  rows.forEach(([base, count, hmin, hmax, c, o], i) => {
    let trees = rect(0, base - 30, W, H - base + 60, c)
    for (let k = 0; k < count; k++) trees += pine(between(r, -40, W + 40), base + between(r, -10, 30), between(r, hmin, hmax), c)
    body += g(`opacity="${o}"`, trees)
    if (i < 4) body += rect(0, base - 120, W, 220, 'url(#fog)', `opacity="${0.8 - i * 0.12}"`)
  })
  // sun rays through the trees
  let rays = ''
  for (let i = 0; i < 7; i++) {
    const x = between(r, 900, 1700)
    rays += poly([[1350, 200], [1350 + 30, 200], [x + 200, H], [x, H]], '#fffbe0', `opacity="${n(between(r, 0.06, 0.14) * 100) / 100}"`)
  }
  body = body.replace(/(<g opacity="1">)/, `<g filter="url(#b30)">${rays}</g>$1`)
  return svg(defs, body)
}

export function ocean() {
  const r = rng(304)
  const hz = 600
  let defs = lin('sky', [[0, '#0b1a3a'], [0.55, '#2c4a7a'], [0.85, '#d98a8a'], [1, '#ffc49a']])
  defs += lin('sea', [[0, '#3a5a8a'], [0.4, '#1d3560'], [1, '#08142c']])
  defs += rad('moonG', [[0, '#fff7e6', 0.7], [1, '#fff7e6', 0]], 1260, 260, 380)
  defs += blur('b3', 3) + wideBlur('b10', 14)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 140, { y0: 0, y1: 380, rmax: 1.3, omax: 0.8, fade: 460 })
  body += rect(0, 0, W, H, 'url(#moonG)') + circle(1260, 260, 54, '#fff6e2')
  body += g('opacity="0.5"', ellipse(500, 470, 380, 16, '#f2b3a6') + ellipse(620, 500, 300, 10, '#ffcdb0') + ellipse(1600, 440, 300, 12, '#e8a8b0'))
  body += rect(0, hz, W, H - hz, 'url(#sea)')
  // the moon's path on the water
  let path2 = ''
  for (let i = 0; i < 70; i++) {
    const t = i / 70
    const y = hz + 6 + t ** 1.6 * (H - hz)
    const w = 20 + t * 300 * between(r, 0.4, 1.2)
    path2 += rect(1260 - w / 2 + between(r, -30, 30) * t, y, w, 2 + t * 4, '#fff1d6', `opacity="${n(between(r, 0.3, 0.8) * (1 - t * 0.5) * 100) / 100}"`)
  }
  body += path2
  // gentle swell lines
  let sw = ''
  for (let k = 0; k < 40; k++) {
    const t = k / 40
    const y = hz + 10 + t ** 1.7 * (H - hz)
    const x = between(r, -100, W)
    sw += rect(x, y, between(r, 80, 400) * (0.4 + t), 1 + t * 2, '#8fb0d8', `opacity="${n(between(r, 0.1, 0.3) * 100) / 100}"`)
  }
  body += sw
  body += rect(0, hz - 1, W, 2, '#ffd8b0', 'opacity="0.5"')
  // a lighthouse on rocks to the left
  body += path('M-20,1100 L-20,820 C60,800 140,790 220,830 C300,860 360,900 420,1100Z', '#050a18')
  body += poly([[150, 820], [170, 640], [196, 640], [216, 820]], '#e8e2d8') + rect(160, 690, 46, 18, '#b83a3a') + rect(160, 750, 50, 18, '#b83a3a') + rect(162, 610, 42, 30, '#2a2a3a') + rect(170, 616, 26, 18, '#ffe7a8') + poly([[156, 612], [183, 590], [210, 612]], '#2a2a3a')
  body += poly([[196, 625], [1000, 500], [1000, 640]], '#ffe7a8', 'opacity="0.1" filter="url(#b10)"')
  return svg(defs, body)
}

export function aurora() {
  const r = rng(305)
  let defs = lin('sky', [[0, '#02040e'], [0.6, '#06142a'], [1, '#0a2a3a']])
  defs += lin('lake', [[0, '#0a2030'], [1, '#02060c']])
  defs += lin('curtain', [[0, '#5affb0', 0], [0.5, '#5affb0', 0.55], [0.85, '#2ad0a0', 0.25], [1, '#2ad0a0', 0]])
  defs += lin('curtain2', [[0, '#b06aff', 0], [0.4, '#b06aff', 0.35], [1, '#4affc0', 0]])
  defs += wideBlur('b20', 9) + blur('b2', 1.5)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 500, { y0: 0, y1: 640, rmax: 1.3, omax: 0.95, fade: 700 })
  // aurora curtains: wavy bands of vertical rays
  const curtain = (y0, amp, len, fillId, seed, o) => {
    o *= 0.85
    const rr = rng(seed)
    let rays = ''
    for (let x = -40; x < W + 40; x += 9) {
      const y = y0 + Math.sin(x / 260 + seed) * amp + Math.sin(x / 90) * amp * 0.25
      const l = len * between(rr, 0.6, 1.2)
      rays += rect(x, y - l, 12, l, `url(#${fillId})`)
    }
    return g(`opacity="${o}" filter="url(#b20)"`, rays)
  }
  body += curtain(420, 70, 320, 'curtain2', 2, 0.7) + curtain(470, 90, 380, 'curtain', 5, 0.9) + curtain(380, 50, 220, 'curtain', 9, 0.5)
  // snowy mountains
  const m = ridge(r, { y: 680, amp: 140, steps: 7, rough: 0.5, bottom: 760 })
  body += path(m, '#122236')
  body += path(m, '#9fb8d0', 'opacity="0.08"')
  body += path(ridge(rng(77), { y: 720, amp: 60, steps: 7, bottom: 760 }), '#071020')
  body += rect(0, 756, W, 324, 'url(#lake)')
  // the lake mirrors the sky
  body += `<g transform="translate(0,1512) scale(1,-1)" opacity="0.3">${curtain(420, 70, 320, 'curtain2', 2, 0.6)}${curtain(470, 90, 380, 'curtain', 5, 0.8)}</g>`
  body += `<g transform="translate(0,1512) scale(1,-1)" opacity="0.6">${path(m, '#0c1828')}</g>`
  let shim = ''
  for (let i = 0; i < 50; i++) shim += rect(between(r, 0, W), between(r, 770, 1070), between(r, 40, 220), 1.4, '#9affd0', `opacity="${n(between(r, 0.05, 0.2) * 100) / 100}"`)
  body += shim
  // pines on the shore
  let pines = ''
  for (let i = 0; i < 40; i++) {
    const x = between(r, 0, W)
    if (x > 600 && x < 1300) continue
    const h = between(r, 40, 120)
    pines += poly([[x, 760 - h], [x + h * 0.2, 762], [x - h * 0.2, 762]], '#02060c')
  }
  body += pines + rect(0, 756, W, 8, '#02060c')
  return svg(defs, body)
}

export function mesh() {
  const r = rng(306)
  let defs = wideBlur('b120', 120)
  let body = rect(0, 0, W, H, '#14102a')
  let blobs = ''
  for (const [x, y, rr, c] of [[300, 200, 520, '#6a3aff'], [1500, 180, 560, '#ff4a9a'], [1000, 760, 600, '#2ad0ff'], [200, 900, 420, '#ff9a4a'], [1700, 900, 460, '#7a2aff'], [960, 380, 360, '#ffd06a']]) blobs += circle(x, y, rr, c, 'opacity="0.75"')
  body += g('filter="url(#b120)"', blobs)
  return svg(defs, body)
}

export function grain() {
  const r = rng(307)
  let defs = rad('vig', [[0, '#2a2d3a'], [0.6, '#1a1c26'], [1, '#0b0c12']], 960, 420, 1200)
  defs += `<filter id="noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" seed="4"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/></filter>`
  let body = rect(0, 0, W, H, 'url(#vig)')
  body += rect(0, 0, W, H, '#000', 'filter="url(#noise)"').replace('fill="#000"', 'fill="#fff"')
  return svg(defs, body)
}

export const more = {
  'neon-grid': neonGrid,
  rooftop,
  forest,
  ocean,
  aurora,
  mesh,
  grain
}
