// Anime-style scenes: original art, no characters from any show.
import { W, H, rng, n, pts, lerp, between, pick, svg, lin, rad, blur, rect, circle, ellipse, poly, path, g, ridge, wave, stars, cloud, rain } from './lib.mjs'

/** A point on a wall seen in perspective: u = 0 near → 1 far, v = 0 top → 1 bottom. */
function wallPoint(q, u, v, depth = 4) {
  const z = 1 + u * (depth - 1)
  const s = (1 - 1 / z) / (1 - 1 / depth)
  const top = [lerp(q.nt[0], q.ft[0], s), lerp(q.nt[1], q.ft[1], s)]
  const bot = [lerp(q.nb[0], q.fb[0], s), lerp(q.nb[1], q.fb[1], s)]
  return [lerp(top[0], bot[0], v), lerp(top[1], bot[1], v)]
}
const wallQuad = (q, u0, u1, v0, v1) => [wallPoint(q, u0, v0), wallPoint(q, u1, v0), wallPoint(q, u1, v1), wallPoint(q, u0, v1)]

export function neonStreet() {
  const r = rng(11)
  const VP = [960, 640]
  const left = { nt: [-40, -260], nb: [-40, 1240], ft: [600, VP[1] - 330], fb: [600, VP[1] + 250] }
  const right = { nt: [1960, -260], nb: [1960, 1240], ft: [1320, VP[1] - 330], fb: [1320, VP[1] + 250] }
  const neon = ['#ff3ea5', '#2ee6ff', '#ffb02e', '#a26bff', '#ff4d6d', '#3dffb5']
  let defs = lin('sky', [[0, '#05040f'], [0.45, '#170a33'], [0.8, '#3b1257'], [1, '#6b1f63']])
  defs += lin('street', [[0, '#1a0f2e'], [0.35, '#0f0a1f'], [1, '#07050d']])
  defs += lin('wallL', [[0, '#0b0818'], [1, '#160f2a']], 0, 0, 1, 0)
  defs += lin('wallR', [[0, '#160f2a'], [1, '#0b0818']], 0, 0, 1, 0)
  defs += rad('haze', [[0, '#ff4fa8', 0.55], [0.5, '#7a2bff', 0.18], [1, '#000', 0]], VP[0], VP[1] + 40, 520)
  defs += lin('refl', [[0, '#fff', 0.9], [1, '#fff', 0]])
  defs += blur('glow', 6) + blur('soft', 18) + blur('wide', 40)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 70, { y0: 0, y1: 300, rmax: 1.2, omax: 0.6 })
  // far city at the end of the street
  let far = ''
  let x = 540
  while (x < 1380) {
    const w = between(r, 30, 80)
    const h = between(r, 120, 420)
    far += rect(x, VP[1] + 250 - h, w, h, pick(r, ['#1d1238', '#221545', '#1a1033']))
    for (let i = 0; i < h / 14; i++) for (let j = 0; j < w / 12; j++) if (r() < 0.18) far += rect(x + 4 + j * 12, VP[1] + 250 - h + 8 + i * 14, 4, 5, pick(r, ['#ffd27a', '#7fe8ff', '#ff8fd0']), `opacity="${n(between(r, 0.35, 0.85) * 100) / 100}"`)
    x += w + between(r, 2, 10)
  }
  body += far
  body += rect(0, 0, W, H, 'url(#haze)')
  // the street, wet
  body += poly([left.nb, left.fb, right.fb, right.nb], 'url(#street)')
  // the walls
  body += poly([left.nt, left.ft, left.fb, left.nb], 'url(#wallL)')
  body += poly([right.nt, right.ft, right.fb, right.nb], 'url(#wallR)')
  // floors, windows and balconies on both walls
  let wins = ''
  for (const q of [left, right]) {
    for (let fl = 0; fl < 18; fl++) {
      const v0 = 0.04 + fl * 0.05
      if (v0 > 0.82) break
      for (let c = 0; c < 9; c++) {
        const u0 = c * 0.11 + 0.02
        if (r() < 0.42) continue
        const lit = r() < 0.55
        const col = lit ? pick(r, ['#ffcf7a', '#ffe2a8', '#8fe9ff', '#ff9bd6']) : '#1f1638'
        wins += poly(wallQuad(q, u0, u0 + 0.07, v0, v0 + 0.028), col, lit ? `opacity="${n(between(r, 0.45, 0.9) * 100) / 100}"` : '')
      }
      // a ledge line every few floors
      if (fl % 3 === 0) wins += poly(wallQuad(q, 0, 1, v0 + 0.035, v0 + 0.039), '#2a1f48')
    }
  }
  body += wins
  // neon signs: vertical boards and small horizontal ones, with a glow and a puddle reflection
  let signs = ''
  let glows = ''
  let refl = ''
  const boards = [
    [left, 0.05, 0.1, 0.28, 0.62, 0],
    [left, 0.34, 0.38, 0.4, 0.66, 1],
    [left, 0.62, 0.68, 0.56, 0.62, 2],
    [right, 0.08, 0.13, 0.22, 0.6, 3],
    [right, 0.3, 0.35, 0.44, 0.7, 1],
    [right, 0.58, 0.66, 0.5, 0.56, 4],
    [right, 0.78, 0.82, 0.6, 0.72, 5]
  ]
  for (const [q, u0, u1, v0, v1, ci] of boards) {
    const c = neon[ci]
    const quad = wallQuad(q, u0, u1, v0, v1)
    signs += poly(quad, '#120a20', `stroke="${c}" stroke-width="3" stroke-linejoin="round"`)
    // glyph-like bars inside (no words)
    const rows = Math.max(2, Math.round((v1 - v0) * 18))
    for (let i = 0; i < rows; i++) {
      const vv = v0 + ((i + 0.5) / rows) * (v1 - v0)
      const len = between(r, 0.4, 0.85)
      signs += poly(wallQuad(q, u0 + (u1 - u0) * 0.2, u0 + (u1 - u0) * (0.2 + 0.6 * len), vv - 0.004, vv + 0.004), c)
    }
    glows += poly(quad, c, 'opacity="0.55"')
    // reflection straight down on the wet street
    const [bx, by] = wallPoint(q, (u0 + u1) / 2, 1)
    const w = Math.abs(quad[1][0] - quad[0][0]) + 6
    refl += rect(bx - w / 2, by + 6, w, between(r, 140, 260), c, `opacity="0.32"`)
  }
  body += g('filter="url(#soft)"', glows)
  body += signs
  body += g('filter="url(#glow)"', refl)
  // overhead power lines across the street
  let wires = ''
  for (let i = 0; i < 4; i++) {
    const y1 = 60 + i * 55
    const y2 = 180 + i * 40
    wires += `<path d="M-20,${y1} Q960,${y1 + 160 + i * 20} 1940,${y2}" stroke="#05030b" stroke-width="${3 - i * 0.5}" fill="none"/>`
  }
  body += wires
  // street lamp light pools and the wet sheen
  body += ellipse(960, 960, 520, 70, '#ff5fb0', 'opacity="0.12" filter="url(#wide)"')
  let sheen = ''
  for (let i = 0; i < 60; i++) {
    const y = between(r, 900, 1080)
    const x0 = between(r, 300, 1500)
    sheen += rect(x0, y, between(r, 40, 260), 1.2, pick(r, neon), `opacity="${n(between(r, 0.08, 0.3) * 100) / 100}"`)
  }
  body += sheen
  // a person with an umbrella, small, in the middle of the street
  const px = 990
  const py = 905
  body += g(
    `transform="translate(${px},${py})"`,
    ellipse(0, 4, 40, 6, '#000', 'opacity="0.5"') +
      path('M-9,0 L-7,-46 Q0,-52 7,-46 L9,0 Z', '#06040c') +
      circle(0, -54, 7, '#06040c') +
      path('M-46,-62 Q0,-104 46,-62 Q23,-70 0,-66 Q-23,-70 -46,-62Z', '#0c2a3a', 'stroke="#2ee6ff" stroke-width="2"') +
      rect(-0.8, -66, 1.6, 30, '#06040c')
  )
  body += rect(px - 40, py + 10, 80, 120, '#2ee6ff', 'opacity="0.1" filter="url(#glow)"')
  body += rain(r, 520, { color: '#c9d8ff', omin: 0.06, omax: 0.22 })
  return svg(defs, body)
}

export function sakuraHill() {
  const r = rng(22)
  let defs = lin('sky', [[0, '#2b2a5c'], [0.35, '#7a4a8a'], [0.62, '#f08a8a'], [0.8, '#ffc48a'], [1, '#ffe2b0']])
  defs += rad('sun', [[0, '#fff6dc'], [0.25, '#ffe3a6'], [0.6, '#ffb37a', 0.5], [1, '#ff8a7a', 0]], 1340, 760, 360)
  defs += lin('hillFar', [[0, '#a15a8a'], [1, '#7d4478']])
  defs += lin('hillMid', [[0, '#5e2f63'], [1, '#43224d']])
  defs += lin('hill', [[0, '#2c1638'], [1, '#170b20']])
  defs += blur('b2', 2) + blur('b8', 8)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 50, { y0: 0, y1: 260, rmax: 1.1, omax: 0.7 })
  body += rect(0, 0, W, H, 'url(#sun)')
  body += circle(1340, 760, 92, '#fff2cf', 'opacity="0.95"')
  // flat anime clouds, lit from below
  const cl = (cx, cy, w, h, top, under) => cloud(r, cx, cy, w, h, top) + cloud(r, cx + 12, cy + h * 0.22, w * 0.92, h * 0.6, under)
  body += g('opacity="0.9"', cl(420, 300, 520, 70, '#e7a3b4', '#f7c6a6') + cl(1500, 420, 640, 60, '#f2a9a6', '#ffd3a8') + cl(980, 200, 380, 46, '#c98bb0', '#e9aab9'))
  body += path(ridge(r, { y: 760, amp: 50, steps: 6, smooth: true }), 'url(#hillFar)', 'opacity="0.85"')
  // town lights on the far hill
  body += stars(r, 90, { x0: 200, x1: 1700, y0: 780, y1: 860, rmax: 1.8, color: '#ffd89a', omin: 0.4 })
  body += path(wave([[-20, 870], [400, 820], [900, 880], [1400, 850], [1940, 900]]), 'url(#hillMid)')
  // the main hill, rising to the right where the tree stands
  body += path(wave([[-20, 1010], [500, 990], [1000, 900], [1380, 830], [1700, 860], [1940, 900]]), 'url(#hill)')
  // the tree: trunk and branches
  const tx = 1420
  const ty = 845
  let trunk = path(`M${tx - 26},${ty + 10} C${tx - 18},${ty - 80} ${tx - 30},${ty - 150} ${tx - 6},${ty - 230} L${tx + 12},${ty - 228} C${tx + 2},${ty - 150} ${tx + 22},${ty - 80} ${tx + 30},${ty + 10}Z`, '#1b0d1e')
  const branch = (x1, y1, cx, cy, x2, y2, w) => `<path d="M${x1},${y1} Q${cx},${cy} ${x2},${y2}" stroke="#1b0d1e" stroke-width="${w}" fill="none" stroke-linecap="round"/>`
  trunk += branch(tx, ty - 200, tx - 120, ty - 260, tx - 300, ty - 280, 14) + branch(tx, ty - 210, tx + 110, ty - 280, tx + 280, ty - 300, 13) + branch(tx, ty - 220, tx - 20, ty - 330, tx + 40, ty - 420, 11)
  trunk += branch(tx - 180, ty - 268, tx - 260, ty - 330, tx - 380, ty - 360, 7) + branch(tx + 170, ty - 288, tx + 250, ty - 360, tx + 360, ty - 380, 7) + branch(tx - 60, ty - 250, tx - 140, ty - 360, tx - 180, ty - 430, 6)
  // blossom canopy: soft clusters in three tones
  let back = ''
  let mid = ''
  let front = ''
  const blobs = [
    [tx - 330, ty - 330, 120], [tx - 200, ty - 400, 140], [tx - 40, ty - 450, 150], [tx + 120, ty - 420, 150], [tx + 300, ty - 360, 130],
    [tx - 120, ty - 310, 120], [tx + 60, ty - 330, 130], [tx + 220, ty - 290, 100], [tx - 380, ty - 280, 80], [tx + 380, ty - 300, 80]
  ]
  let mass = ''
  for (const [bx, by, br] of blobs) {
    mass += ellipse(bx, by, br * 0.95, br * 0.62, '#b54d78')
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2
      const d = Math.sqrt(r()) * br
      const cx = bx + Math.cos(a) * d
      const cy = by + Math.sin(a) * d * 0.62
      const rr = between(r, 6, 15)
      const tone = cy - by + between(r, -25, 25)
      if (tone > 18) back += circle(cx, cy, rr, '#c45a84')
      else if (tone > -22) mid += circle(cx, cy, rr, '#ec8db0')
      else front += circle(cx, cy, rr, '#ffc6d8')
    }
  }
  body += trunk + g('filter="url(#b8)"', mass) + g('', back) + g('', mid) + g('', front)
  // rim light from the sun on the canopy
  body += g('filter="url(#b8)" opacity="0.35"', circle(tx + 200, ty - 380, 90, '#ffe0b8'))
  // grass tufts on the hill line
  let grass = ''
  for (let i = 0; i < 160; i++) {
    const x = between(r, 0, W)
    const y = x < 1000 ? lerp(1010, 900, x / 1000) + 4 : lerp(900, 840, Math.min(1, (x - 1000) / 400)) + 6
    const h = between(r, 8, 22)
    grass += `M${n(x)},${n(y)} q${n(between(r, -3, 6))},${n(-h / 2)} ${n(between(r, 2, 8))},${n(-h)}`
  }
  body += `<path d="${grass}" stroke="#170b20" stroke-width="2" fill="none"/>`
  // falling petals
  let petals = ''
  for (let i = 0; i < 140; i++) {
    const x = between(r, 200, 1920)
    const y = between(r, 300, 1060)
    const s = between(r, 2.5, 6)
    petals += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(s)}" ry="${n(s * 0.55)}" transform="rotate(${Math.round(between(r, 0, 180))} ${n(x)} ${n(y)})" fill="${pick(r, ['#ffd0de', '#ffb3c9', '#ff9fbc'])}" opacity="${n(between(r, 0.5, 0.95) * 100) / 100}"/>`
  }
  body += petals
  return svg(defs, body)
}

export function lofiRoom() {
  const r = rng(33)
  let defs = lin('wall', [[0, '#1c1838'], [1, '#2a2148']])
  defs += lin('night', [[0, '#0d1030'], [0.6, '#2b2a6b'], [1, '#5a3d86']])
  defs += rad('lamp', [[0, '#ffd59a', 0.75], [0.35, '#ffb066', 0.3], [1, '#ff9a4d', 0]], 1340, 560, 620)
  defs += rad('moonGlow', [[0, '#e9f0ff', 0.5], [1, '#e9f0ff', 0]], 700, 260, 220)
  defs += lin('desk', [[0, '#3a2a3e'], [1, '#22172a']])
  defs += blur('b4', 4) + blur('b14', 14)
  let body = rect(0, 0, W, H, 'url(#wall)')
  // the window
  const wx = 300
  const wy = 120
  const ww = 900
  const wh = 560
  body += rect(wx, wy, ww, wh, 'url(#night)')
  body += stars(r, 60, { x0: wx, x1: wx + ww, y0: wy, y1: wy + 260, rmax: 1.2 })
  body += rect(wx, wy, ww, wh, 'url(#moonGlow)')
  body += circle(700, 260, 46, '#f3f6ff')
  body += circle(716, 250, 42, '#2b2a6b', 'opacity="0.0"')
  // city skyline in the window
  let city = ''
  let x = wx
  while (x < wx + ww) {
    const w = between(r, 40, 110)
    const h = between(r, 80, 260)
    city += rect(x, wy + wh - h, w, h, pick(r, ['#1a1740', '#201c4c', '#16143a']))
    for (let i = 0; i < h / 16; i++) for (let j = 0; j < w / 14; j++) if (r() < 0.22) city += rect(x + 5 + j * 14, wy + wh - h + 8 + i * 16, 5, 6, pick(r, ['#ffd27a', '#ffe9b3', '#9fd8ff']), `opacity="${n(between(r, 0.4, 0.9) * 100) / 100}"`)
    x += w + between(r, 0, 8)
  }
  body += `<svg x="${wx}" y="${wy}" width="${ww}" height="${wh}" viewBox="${wx} ${wy} ${ww} ${wh}">${city}</svg>`
  // window frame and cross bars
  body += `<rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" fill="none" stroke="#120f26" stroke-width="22"/>`
  body += rect(wx + ww / 2 - 8, wy, 16, wh, '#120f26') + rect(wx, wy + wh * 0.45 - 6, ww, 12, '#120f26')
  // curtain on the left
  body += path(`M${wx - 90},90 C${wx - 40},300 ${wx - 110},500 ${wx - 50},760 L${wx + 60},760 C${wx + 10},520 ${wx + 70},300 ${wx + 30},90Z`, '#3c2a5a')
  body += path(`M${wx - 40},90 C${wx},320 ${wx - 50},520 ${wx},760 L${wx + 30},760 C${wx - 10},520 ${wx + 40},300 ${wx + 10},90Z`, '#4c3670', 'opacity="0.8"')
  body += rect(wx - 140, 74, ww + 300, 14, '#120f26', 'rx="7"')
  // the warm lamp light filling the room
  body += rect(0, 0, W, H, 'url(#lamp)')
  // shelf with books and a plant on the right wall
  body += rect(1360, 250, 420, 14, '#16112a')
  let books = ''
  let bx = 1380
  while (bx < 1680) {
    const bw = between(r, 14, 30)
    const bh = between(r, 60, 100)
    books += rect(bx, 250 - bh, bw, bh, pick(r, ['#7a3b5e', '#3c5a8a', '#c78a3e', '#4f7a5a', '#8a4a3a', '#5c4a8a']), r() < 0.2 ? `transform="rotate(-8 ${n(bx)} 250)"` : '')
    bx += bw + 3
  }
  body += books
  body += path('M1700,250 l12,-40 h44 l12,40z', '#b5654a') + g('fill="#4f8a5a"', ellipse(1712, 200, 30, 10, '#4f8a5a', 'transform="rotate(-40 1712 200)"') + ellipse(1752, 196, 32, 10, '#5f9a62', 'transform="rotate(35 1752 196)"') + ellipse(1734, 180, 26, 9, '#6aa86a', 'transform="rotate(-80 1734 180)"'))
  // fairy lights along the top of the window
  let lights = ''
  for (let i = 0; i <= 18; i++) {
    const t = i / 18
    const lx = wx - 60 + t * (ww + 120)
    const ly = 100 + Math.sin(t * Math.PI * 3) * 14 + 10
    lights += circle(lx, ly, 5, pick(r, ['#ffd27a', '#ffb3d1', '#9fe0ff']))
  }
  body += `<path d="M${wx - 60},110 ${Array.from({ length: 37 }, (_, i) => `L${n(wx - 60 + (i / 36) * (ww + 120))},${n(110 + Math.sin((i / 36) * Math.PI * 3) * 14)}`).join(' ')}" stroke="#0e0b1e" stroke-width="2" fill="none"/>`
  body += g('filter="url(#b4)" opacity="0.9"', lights) + lights
  // the desk
  body += poly([[0, 760], [W, 720], [W, H], [0, H]], 'url(#desk)')
  body += poly([[0, 760], [W, 720], [W, 736], [0, 776]], '#4b3650')
  // lamp
  body += path('M1250,800 h120 l-20,-12 h-80z', '#16112a') + rect(1306, 520, 8, 270, '#16112a') + path('M1240,540 L1310,440 L1380,540 Z', '#2a1f3c') + ellipse(1310, 540, 70, 12, '#ffd59a')
  body += ellipse(1310, 560, 160, 40, '#ffcf8a', 'opacity="0.35" filter="url(#b14)"')
  // laptop, glowing screen
  body += g('transform="translate(0,110)"', path('M640,725 L700,560 L1000,560 L960,725Z', '#141026') + path('M652,716 L706,570 L990,570 L950,716Z', '#3b4fa0', 'opacity="0.9"') + path('M560,730 L1060,722 L1080,742 L540,752Z', '#1c1630') + ellipse(830, 650, 220, 90, '#6f86ff', 'opacity="0.2" filter="url(#b14)"'))
  // code-like lines on the screen
  let code = ''
  for (let i = 0; i < 9; i++) code += rect(728 + (i % 3) * 8 + 330, 700 + i * 13, between(r, 60, 180), 4, pick(r, ['#9fe0ff', '#ffb3d1', '#c8f0a0', '#e6e8ff']), 'opacity="0.7" transform="skewX(-20)"')
  body += g('', code)
  body += rect(wx - 20, wy + wh, ww + 40, 18, '#120f26')
  // mug with steam, headphones, a cat on the sill
  body += rect(1120, 790, 46, 54, '#d9744f', 'rx="6"') + `<path d="M1166,804 q22,6 0,26" stroke="#d9744f" stroke-width="7" fill="none"/>`
  body += `<path d="M1132,770 q-10,-20 4,-36 q12,-14 0,-30 M1152,772 q-8,-18 4,-32" stroke="#fff" stroke-width="3" fill="none" opacity="0.25" stroke-linecap="round"/>`
  body += `<path d="M380,838 q40,-70 90,0" stroke="#120f26" stroke-width="12" fill="none"/>` + ellipse(380, 840, 16, 22, '#2a1f3c') + ellipse(470, 840, 16, 22, '#2a1f3c')
  // the cat: sitting on the window sill, back to us
  body += g('transform="translate(1110,680)" fill="#0c0919"', ellipse(0, -20, 46, 50, '#0c0919') + circle(0, -84, 30, '#0c0919') + path('M-24,-104 l6,-28 l16,20z M24,-104 l-6,-28 l-16,20z', '#0c0919') + `<path d="M40,10 q50,10 40,-40" stroke="#0c0919" stroke-width="10" fill="none" stroke-linecap="round"/>`)
  return svg(defs, body)
}

export function trainCrossing() {
  const r = rng(44)
  let defs = lin('sky', [[0, '#1e3a6a'], [0.4, '#5b6aa0'], [0.7, '#f29a72'], [0.9, '#ffcf8a'], [1, '#ffe4b0']])
  defs += rad('sun', [[0, '#fff1c8'], [0.3, '#ffd28a', 0.6], [1, '#ff9a6a', 0]], 520, 780, 420)
  defs += blur('b10', 10) + blur('b3', 3)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += rect(0, 0, W, H, 'url(#sun)')
  body += circle(520, 790, 70, '#fff3d6')
  body += g('opacity="0.85"', cloud(r, 1300, 260, 700, 60, '#e98f8a') + cloud(r, 1320, 280, 640, 40, '#ffb98f') + cloud(r, 380, 380, 520, 46, '#d98a92') + cloud(r, 390, 395, 480, 30, '#ffc09a'))
  body += path(ridge(r, { y: 800, amp: 60, steps: 6, smooth: true }), '#6c5a8a', 'opacity="0.7"')
  body += path(ridge(r, { y: 850, amp: 30, steps: 6, smooth: true }), '#3d3060')
  // the train passing on an embankment
  const ty = 760
  body += rect(-20, ty + 92, W + 40, 40, '#241a38')
  let train = ''
  for (let c = 0; c < 6; c++) {
    const x0 = -60 + c * 330
    train += rect(x0, ty, 320, 92, '#1a1328', 'rx="10"')
    for (let i = 0; i < 7; i++) train += rect(x0 + 18 + i * 42, ty + 18, 30, 30, '#ffd89a', `rx="3" opacity="${n(between(r, 0.65, 0.95) * 100) / 100}"`)
    train += rect(x0 + 6, ty + 60, 308, 6, '#ff9a6a', 'opacity="0.5"')
  }
  body += train
  body += rect(-20, ty + 22, W + 40, 30, '#ffd89a', 'opacity="0.18" filter="url(#b10)"')
  // overhead wire poles along the line
  let poles = ''
  for (let i = 0; i < 7; i++) {
    const px = 60 + i * 310
    poles += rect(px, ty - 140, 8, 240, '#120c1e') + rect(px - 30, ty - 130, 70, 6, '#120c1e')
  }
  body += poles
  body += `<path d="M-20,${ty - 120} ${Array.from({ length: 8 }, (_, i) => `Q${n(-95 + i * 310 + 155)},${ty - 100} ${n(64 + i * 310)},${ty - 120}`).join(' ')}" stroke="#120c1e" stroke-width="2" fill="none"/>`
  // foreground: the road crossing with its sign and barrier
  body += poly([[0, 900], [W, 880], [W, H], [0, H]], '#160f24')
  body += poly([[700, H], [880, 890], [1040, 890], [1240, H]], '#221935')
  let rails = ''
  for (const dy of [930, 975]) rails += rect(-20, dy, W + 40, 6, '#5a4a6a') + rect(-20, dy + 6, W + 40, 2, '#0d0816')
  for (let i = 0; i < 40; i++) rails += rect(-10 + i * 52, 924, 26, 64, '#0d0816', 'opacity="0.6"')
  body += rails
  // the crossing sign (generic: an X board on a pole with two lamps)
  const sx = 1500
  body += rect(sx, 520, 14, 440, '#0d0816')
  body += g(`transform="translate(${sx + 7},560)"`, rect(-90, -12, 180, 24, '#f2efe8', 'transform="rotate(30)"') + rect(-90, -12, 180, 24, '#f2efe8', 'transform="rotate(-30)"') + rect(-60, -6, 30, 12, '#1a1328', 'transform="rotate(30)"') + rect(30, -6, 30, 12, '#1a1328', 'transform="rotate(30)"') + rect(-60, -6, 30, 12, '#1a1328', 'transform="rotate(-30)"') + rect(30, -6, 30, 12, '#1a1328', 'transform="rotate(-30)"'))
  body += rect(sx - 60, 640, 134, 18, '#0d0816') + circle(sx - 40, 680, 24, '#0d0816') + circle(sx + 54, 680, 24, '#0d0816') + circle(sx - 40, 680, 15, '#ff3b3b') + circle(sx + 54, 680, 15, '#3a1010')
  body += circle(sx - 40, 680, 60, '#ff4b3b', 'opacity="0.35" filter="url(#b10)"')
  // the barrier arm, down
  body += rect(sx - 20, 820, 40, 60, '#0d0816') + g(`transform="rotate(-2 ${sx} 840)"`, rect(sx - 640, 832, 640, 14, '#f2efe8') + Array.from({ length: 8 }, (_, i) => rect(sx - 620 + i * 80, 832, 40, 14, '#d63a3a')).join(''))
  // someone waiting at the barrier, bag on the shoulder
  body += g('transform="translate(1260,900)" fill="#0d0816"', path('M-16,0 l4,-62 h24 l4,62 h-10 l-4,-48 l-4,48z', '#0d0816') + path('M-20,-60 q2,-50 20,-52 q18,2 20,52z', '#0d0816') + circle(0, -126, 15, '#0d0816') + path('M-22,-112 q22,-22 44,0 l-4,10 q-18,-14 -36,0z', '#0d0816') + rect(14, -84, 22, 30, '#0d0816', 'rx="4"') + `<path d="M-14,-108 L28,-82" stroke="#0d0816" stroke-width="4"/>`)
  return svg(defs, body)
}

export function floatingIsland() {
  const r = rng(55)
  let defs = lin('sky', [[0, '#3b8fe8'], [0.55, '#8cc8ff'], [1, '#d8f0ff']])
  defs += lin('rock', [[0, '#8a6a5a'], [0.5, '#5c4250'], [1, '#2e2440']])
  defs += lin('grass', [[0, '#8fe07a'], [1, '#4fae5c']])
  defs += lin('fall', [[0, '#e8fbff'], [1, '#e8fbff', 0]])
  defs += blur('b6', 6) + blur('b20', 20)
  let body = rect(0, 0, W, H, 'url(#sky)')
  // soft background clouds
  const big = (cx, cy, w, h, o) => g(`opacity="${o}"`, cloud(r, cx, cy, w, h, '#ffffff') + cloud(r, cx + 10, cy + h * 0.3, w * 0.9, h * 0.5, '#e3effc'))
  body += big(300, 880, 900, 160, 0.95) + big(1500, 920, 1100, 180, 0.95) + big(900, 1000, 1400, 160, 1)
  body += big(1600, 240, 420, 70, 0.8) + big(260, 200, 320, 50, 0.7)
  // a small far island
  const island = (cx, cy, s, seed) => {
    const rr = rng(seed)
    let d = `M${cx - 300 * s},${cy}`
    for (let i = 0; i <= 12; i++) {
      const t = i / 12
      const x = cx - 300 * s + t * 600 * s
      const depth = Math.sin(t * Math.PI) ** 0.8 * 340 * s * between(rr, 0.7, 1.1)
      d += ` L${n(x)},${n(cy + depth)}`
    }
    d += 'Z'
    let out = path(d, 'url(#rock)')
    // rock strata
    for (let k = 1; k < 4; k++) out += `<path d="M${n(cx - 280 * s)},${n(cy + k * 30 * s)} Q${cx},${n(cy + k * 60 * s)} ${n(cx + 280 * s)},${n(cy + k * 30 * s)}" stroke="#3a2a40" stroke-width="${n(3 * s)}" fill="none" opacity="0.4"/>`
    out += path(`M${n(cx - 320 * s)},${n(cy + 6 * s)} Q${cx},${n(cy - 40 * s)} ${n(cx + 320 * s)},${n(cy + 6 * s)} Q${cx},${n(cy + 30 * s)} ${n(cx - 320 * s)},${n(cy + 6 * s)}Z`, 'url(#grass)')
    return out
  }
  body += g('opacity="0.75"', island(1560, 420, 0.32, 3))
  body += g('opacity="0.85"', island(330, 560, 0.24, 4))
  // the main island
  const cx = 900
  const cy = 520
  // waterfall
  body += rect(1060, cy, 40, 560, 'url(#fall)', 'opacity="0.9"') + rect(1068, cy, 10, 520, '#ffffff', 'opacity="0.7"')
  body += island(cx, cy, 1, 7)
  // trees, a little house
  const tree = (x, y, s) => rect(x - 4 * s, y - 40 * s, 8 * s, 40 * s, '#5a3a3a') + circle(x, y - 60 * s, 34 * s, '#3f9a52') + circle(x - 18 * s, y - 46 * s, 24 * s, '#4fae5c') + circle(x + 20 * s, y - 50 * s, 26 * s, '#5fc066')
  body += tree(760, cy - 8, 1.6) + tree(700, cy + 4, 1.1) + tree(1180, cy + 2, 1.2)
  body += rect(920, cy - 70, 100, 64, '#f4e7d6') + poly([[904, cy - 70], [970, cy - 120], [1036, cy - 70]], '#d65a4a') + rect(958, cy - 46, 22, 40, '#7a4a3a') + rect(934, cy - 56, 16, 16, '#8fd0ff')
  // hanging roots and vines
  let roots = ''
  for (let i = 0; i < 18; i++) {
    const x = between(r, cx - 220, cx + 220)
    roots += `<path d="M${n(x)},${n(cy + 20)} q${n(between(r, -20, 20))},${n(between(r, 60, 140))} ${n(between(r, -10, 10))},${n(between(r, 150, 240))}" stroke="#4a3a40" stroke-width="2" fill="none" opacity="0.6"/>`
  }
  body += roots
  // birds
  let birds = ''
  for (let i = 0; i < 7; i++) {
    const x = between(r, 1150, 1500)
    const y = between(r, 200, 320)
    const s = between(r, 6, 12)
    birds += `<path d="M${n(x - s)},${n(y)} q${n(s / 2)},${n(-s / 2)} ${n(s)},0 q${n(s / 2)},${n(-s / 2)} ${n(s)},0" stroke="#23324a" stroke-width="2" fill="none"/>`
  }
  body += birds
  // front clouds drifting past
  body += big(1700, 700, 600, 90, 0.9) + big(120, 760, 500, 80, 0.85)
  return svg(defs, body)
}

export const anime = {
  'neon-rain': neonStreet,
  'sakura-hill': sakuraHill,
  'lofi-room': lofiRoom,
  'train-crossing': trainCrossing,
  'floating-island': floatingIsland
}
