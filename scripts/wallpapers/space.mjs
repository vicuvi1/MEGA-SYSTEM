// "Space saga" scenes: original sci-fi art. No ships, people or places from any film.
import { W, H, rng, n, lerp, between, pick, svg, lin, rad, blur, wideBlur, rect, circle, ellipse, poly, path, g, ridge, wave, stars, flare } from './lib.mjs'

export function twinSuns() {
  const r = rng(201)
  let defs = lin('sky', [[0, '#1f3b5c'], [0.38, '#5b7c8f'], [0.62, '#e0a46c'], [0.8, '#f4c27c'], [1, '#ffe0a6']])
  defs += rad('s1', [[0, '#fffbe8'], [0.2, '#fff0bf', 0.9], [0.5, '#ffcf7a', 0.35], [1, '#ff9a4a', 0]], 1180, 640, 380)
  defs += rad('s2', [[0, '#ffe7c4'], [0.2, '#ffb36b', 0.85], [0.6, '#ff7a3a', 0.25], [1, '#ff6a2a', 0]], 1420, 690, 260)
  defs += lin('d1', [[0, '#d98e52'], [1, '#b0653a']])
  defs += lin('d2', [[0, '#c27440'], [1, '#8f4a2a']])
  defs += lin('d3', [[0, '#9b5530'], [1, '#5e2e1c']])
  defs += lin('d4', [[0, '#6a3520'], [1, '#2e160e']])
  defs += blur('b2', 2)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 90, { y0: 0, y1: 320, rmax: 1.2, omax: 0.7, fade: 360 })
  body += rect(0, 0, W, H, 'url(#s1)') + rect(0, 0, W, H, 'url(#s2)')
  body += circle(1180, 640, 58, '#fffbe8') + circle(1420, 690, 34, '#ffd6a0')
  // a pale moon high up
  body += circle(420, 210, 34, '#eef2f4', 'opacity="0.55"') + circle(432, 204, 30, '#5b7c8f', 'opacity="0.35"')
  // mesas on the horizon
  body += path('M120,760 L170,690 L330,690 L370,760Z M1620,760 L1650,650 L1760,650 L1800,700 L1840,700 L1870,760Z', '#8e5a52', 'opacity="0.7"')
  // dunes, back to front, each lit on its sun side
  body += path(wave([[-20, 770], [300, 740], [700, 780], [1100, 745], [1500, 770], [1940, 740]]), 'url(#d1)')
  body += path(wave([[-20, 840], [420, 800], [820, 860], [1260, 810], [1700, 860], [1940, 830]]), 'url(#d2)')
  body += path(wave([[-20, 930], [380, 880], [760, 950], [1160, 900], [1600, 960], [1940, 910]]), 'url(#d3)')
  body += path(wave([[-20, 1030], [500, 980], [1000, 1050], [1500, 1000], [1940, 1040]]), 'url(#d4)')
  // wind ripples on the near dunes
  let rip = ''
  for (let i = 0; i < 26; i++) {
    const x = between(r, 0, W)
    const y = between(r, 900, 1060)
    rip += `<path d="M${n(x)},${n(y)} q${n(between(r, 40, 80))},${n(-6)} ${n(between(r, 100, 180))},0" stroke="#e3a46c" stroke-width="2" fill="none" opacity="0.25"/>`
  }
  body += rip
  // a lone traveller in a hooded cloak watching the suns, and a long shadow
  body += path('M820,912 L560,940 L568,946 L824,920Z', '#3a1c10', 'opacity="0.45"')
  body += g('transform="translate(828,916)" fill="#1a0c07"', path('M-14,0 L-10,-50 Q-20,-80 -12,-104 Q0,-124 12,-104 Q20,-80 12,-50 L16,0Z', '#1a0c07') + path('M-14,-98 Q0,-130 14,-98 Q8,-90 0,-92 Q-8,-90 -14,-98Z', '#1a0c07') + `<path d="M14,-60 L28,4" stroke="#1a0c07" stroke-width="3"/>`)
  // a small dome shelter and a vapour tower in the distance (generic)
  body += path('M1500,776 a40,26 0 0 1 80,0Z', '#6b3a2a') + rect(1600, 730, 6, 46, '#6b3a2a') + rect(1592, 730, 22, 4, '#6b3a2a')
  return svg(defs, body)
}

export function hyperspace() {
  const r = rng(202)
  const cx = 960
  const cy = 520
  let defs = rad('core', [[0, '#ffffff'], [0.08, '#d9f1ff', 0.9], [0.3, '#5aa8ff', 0.35], [1, '#000', 0]], cx, cy, 700)
  defs += rad('vig', [[0.4, '#000', 0], [1, '#000', 0.85]], cx, cy, 1150)
  defs += blur('b2', 2) + blur('b8', 8)
  // a streak per star: thin at the centre, wider and brighter going out
  defs += `<linearGradient id="st" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9fd4ff" stop-opacity="0"/><stop offset="0.7" stop-color="#cfe9ff" stop-opacity="0.7"/><stop offset="1" stop-color="#ffffff"/></linearGradient>`
  let body = rect(0, 0, W, H, '#02040c')
  let streaks = ''
  let glows = ''
  for (let i = 0; i < 520; i++) {
    const a = r() * Math.PI * 2
    const d0 = between(r, 40, 520) ** 1.05
    const len = between(r, 120, 760) * (d0 / 400 + 0.4)
    const d1 = d0 + len
    const w = between(r, 0.8, 3.2) * (d1 / 900 + 0.4)
    const deg = (a * 180) / Math.PI
    const col = pick(r, ['url(#st)', 'url(#st)', 'url(#st)'])
    const line = `<rect x="${n(d0)}" y="${n(-w / 2)}" width="${n(len)}" height="${n(w)}" rx="${n(w / 2)}" fill="${col}" transform="translate(${cx},${cy}) rotate(${n(deg)})"/>`
    streaks += line
    if (r() < 0.12) glows += line
  }
  body += g('filter="url(#b8)" opacity="0.8"', glows)
  body += streaks
  body += rect(0, 0, W, H, 'url(#core)')
  body += circle(cx, cy, 22, '#ffffff', 'filter="url(#b2)"')
  body += rect(0, 0, W, H, 'url(#vig)')
  return svg(defs, body)
}

export function nebula() {
  const r = rng(203)
  let defs = rad('vig', [[0.5, '#000', 0], [1, '#000', 0.6]], 960, 540, 1100)
  defs += wideBlur('b40', 40) + wideBlur('b90', 90) + wideBlur('b14', 22)
  let body = rect(0, 0, W, H, '#05030f')
  // big soft clouds of colour
  let clouds = ''
  const blobs = [
    [600, 420, 520, 260, '#5b2aa8', 0.7], [1000, 520, 600, 300, '#c03a8a', 0.55], [1350, 420, 520, 240, '#2a5ac0', 0.6],
    [820, 620, 420, 200, '#ff7a5a', 0.4], [1200, 640, 380, 180, '#3ad0d0', 0.35], [400, 700, 360, 200, '#3a2a90', 0.5], [1600, 760, 420, 220, '#6a2aa0', 0.45]
  ]
  for (const [x, y, rx, ry, c, o] of blobs) clouds += ellipse(x, y, rx, ry, c, `opacity="${o}" transform="rotate(${Math.round(between(r, -25, 25))} ${x} ${y})"`)
  body += g('filter="url(#b90)"', clouds)
  // brighter filaments
  let fil = ''
  for (let i = 0; i < 14; i++) {
    const x = between(r, 500, 1500)
    const y = between(r, 380, 700)
    fil += `<path d="M${n(x)},${n(y)} c${n(between(r, 60, 200))},${n(between(r, -80, 80))} ${n(between(r, 200, 380))},${n(between(r, -60, 60))} ${n(between(r, 320, 520))},${n(between(r, -40, 40))}" stroke="${pick(r, ['#ff9ad0', '#9fc8ff', '#ffd0a0', '#c8a0ff'])}" stroke-width="${n(between(r, 24, 60))}" fill="none" opacity="${n(between(r, 0.1, 0.22) * 100) / 100}" stroke-linecap="round"/>`
  }
  body += g('filter="url(#b14)"', fil)
  // dark dust lanes
  body += g('filter="url(#b40)"', `<path d="M300,560 C600,480 800,640 1100,560 C1300,510 1500,600 1700,540" stroke="#05030f" stroke-width="70" fill="none" opacity="0.7"/>`)
  body += stars(r, 700, { rmax: 1.3, omin: 0.2, omax: 0.9 })
  body += stars(r, 60, { rmin: 1.2, rmax: 2.4, omin: 0.6, omax: 1, color: '#e6f0ff' })
  for (let i = 0; i < 9; i++) body += flare(between(r, 100, 1820), between(r, 80, 1000), between(r, 3, 7), pick(r, ['#ffffff', '#cfe3ff', '#ffe2c8']))
  body += rect(0, 0, W, H, 'url(#vig)')
  return svg(defs, body)
}

export function ringPlanet() {
  const r = rng(204)
  let defs = rad('planet', [[0, '#f0c890'], [0.5, '#c8875a'], [0.85, '#6a3a3a'], [1, '#2a1a2a']], 820, 380, 520)
  defs += rad('shade', [[0.45, '#000', 0], [1, '#000', 0.85]], 900, 300, 560)
  defs += rad('atm', [[0.905, '#ffb07a', 0], [0.93, '#ffb07a', 0.5], [1, '#ffb07a', 0]], 960, 460, 440)
  defs += lin('ground', [[0, '#3a3044'], [1, '#120e18']])
  defs += `<clipPath id="pc"><circle cx="960" cy="460" r="400"/></clipPath>`
  defs += blur('b3', 3) + blur('b20', 20)
  let body = rect(0, 0, W, H, '#04040c')
  body += stars(r, 600, { rmax: 1.3, omax: 0.9 })
  // rings behind the planet (back half)
  const ring = (front) => {
    let out = ''
    const bands = [[640, '#d9b48a', 0.5], [610, '#b88f6a', 0.35], [700, '#e9cfa8', 0.45], [740, '#a3866a', 0.3], [790, '#cdb08c', 0.22]]
    for (const [rx, c, o] of bands) out += `<ellipse cx="960" cy="460" rx="${rx}" ry="${n(rx * 0.2)}" fill="none" stroke="${c}" stroke-width="${n(rx * 0.05)}" opacity="${o}"/>`
    const clip = front ? 'M0,460 H1920 V1080 H0Z' : 'M0,0 H1920 V460 H0Z'
    return `<g transform="rotate(-14 960 460)"><clipPath id="rc${front ? 'f' : 'b'}"><path d="${clip}"/></clipPath><g clip-path="url(#rc${front ? 'f' : 'b'})">${out}</g></g>`
  }
  body += ring(false)
  body += circle(960, 460, 400, 'url(#planet)')
  // cloud bands on the planet
  let bands = ''
  for (let i = 0; i < 14; i++) {
    const y = 120 + i * 50 + between(r, -10, 10)
    bands += ellipse(960, y, 520, between(r, 8, 22), pick(r, ['#f6d8a8', '#a8603e', '#e0a874', '#7a4a3a']), `opacity="${n(between(r, 0.2, 0.45) * 100) / 100}" transform="rotate(-14 960 460)"`)
  }
  body += g('clip-path="url(#pc)" filter="url(#b3)"', bands)
  body += circle(960, 460, 400, 'url(#shade)')
  body += circle(960, 460, 440, 'url(#atm)')
  body += ring(true)
  // the moon surface we stand on
  body += path(ridge(r, { y: 930, amp: 40, steps: 7, rough: 0.6 }), 'url(#ground)')
  let craters = ''
  for (let i = 0; i < 14; i++) {
    const x = between(r, 0, W)
    const y = between(r, 980, 1070)
    const s = between(r, 20, 70)
    craters += ellipse(x, y, s, s * 0.22, '#0c0912', 'opacity="0.6"') + ellipse(x, y - s * 0.06, s * 0.9, s * 0.16, '#4a3e58', 'opacity="0.35"')
  }
  body += craters
  body += flare(260, 180, 6, '#ffffff')
  return svg(defs, body)
}

export function bladeDuel() {
  const r = rng(205)
  let defs = lin('sky', [[0, '#090814'], [0.55, '#2a1430'], [0.8, '#6a2a3a'], [1, '#c45a3a']])
  defs += rad('sunset', [[0, '#ffb070', 0.75], [0.5, '#ff6a4a', 0.25], [1, '#000', 0]], 960, 860, 700)
  defs += lin('cliff', [[0, '#120b14'], [1, '#050307']])
  defs += blur('g1', 4) + blur('g2', 14) + blur('g3', 40)
  let body = rect(0, 0, W, H, 'url(#sky)') + rect(0, 0, W, H, 'url(#sunset)')
  body += stars(r, 180, { y0: 0, y1: 520, rmax: 1.3, omax: 0.9, fade: 600 })
  // two moons
  body += circle(1500, 230, 80, '#f2d6c8', 'opacity="0.85"') + circle(1530, 214, 74, '#2a1430', 'opacity="0.55"') + circle(1330, 330, 26, '#e8c8c0', 'opacity="0.7"')
  // far spires on the horizon
  body += path(ridge(r, { y: 820, amp: 50, steps: 6 }), '#3a1a2a', 'opacity="0.9"')
  let spires = ''
  for (let i = 0; i < 9; i++) {
    const x = between(r, 0, W)
    const h = between(r, 120, 320)
    spires += poly([[x - 20, 840], [x - 4, 840 - h], [x + 4, 840 - h], [x + 24, 840]], '#2a1220', 'opacity="0.9"')
  }
  body += spires
  // the cliff edge where they meet
  body += path('M-20,1100 L-20,880 C300,860 600,850 900,856 C1200,862 1500,872 1940,860 L1940,1100Z', 'url(#cliff)')
  // two duelists, blades crossed in the middle
  const fill = '#030205'
  const left = g('transform="translate(830,858)"', path('M-20,0 L-34,-90 Q-30,-160 -6,-176 L14,-176 Q34,-150 26,-100 L48,-6 L30,0 L10,-80 L0,0Z', fill) + circle(4, -194, 18, fill) + path('M-30,-150 Q-70,-100 -110,-40 L-90,-34 Q-56,-90 -18,-120Z', fill, 'opacity="0.95"') + `<path d="M14,-160 L64,-200" stroke="${fill}" stroke-width="13" stroke-linecap="round"/>`)
  const right = g('transform="translate(1090,858)"', path('M20,0 L34,-96 Q32,-166 6,-182 L-14,-182 Q-36,-156 -28,-106 L-48,-6 L-30,0 L-10,-84 L0,0Z', fill) + circle(-4, -200, 18, fill) + path('M30,-160 Q80,-110 120,-30 L100,-24 Q66,-90 22,-126Z', fill) + `<path d="M-14,-166 L-64,-206" stroke="${fill}" stroke-width="13" stroke-linecap="round"/>`)
  body += left + right
  // blades: a wide glow, a narrow glow and a white core
  const blade = (x1, y1, x2, y2, c) => `<g><path d="M${x1},${y1} L${x2},${y2}" stroke="${c}" stroke-width="40" stroke-linecap="round" opacity="0.35" filter="url(#g3)"/><path d="M${x1},${y1} L${x2},${y2}" stroke="${c}" stroke-width="16" stroke-linecap="round" opacity="0.9" filter="url(#g1)"/><path d="M${x1},${y1} L${x2},${y2}" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/></g>`
  body += blade(898, 660, 1150, 420, '#38d8ff')
  body += blade(1022, 652, 760, 420, '#ff3a4a')
  // the clash: a spark of light
  body += circle(958, 560, 70, '#ffe0f0', 'opacity="0.55" filter="url(#g2)"') + circle(958, 560, 10, '#ffffff')
  let sparks = ''
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2
    const d = between(r, 20, 120)
    sparks += circle(958 + Math.cos(a) * d, 560 + Math.sin(a) * d, between(r, 1, 3), pick(r, ['#ffffff', '#ffd0e0', '#c8f4ff']), `opacity="${n(between(r, 0.5, 1) * 100) / 100}"`)
  }
  body += sparks
  // rim light from the blades on the ground
  body += ellipse(960, 864, 360, 16, '#ff9aa8', 'opacity="0.35" filter="url(#g2)"')
  return svg(defs, body)
}

/** A starfighter seen from above-behind: arrow body, swept wings, two glowing engines (original design). */
function fighter(x, y, s, rot, hull, glow) {
  return g(
    `transform="translate(${n(x)},${n(y)}) rotate(${rot}) scale(${s})"`,
    `<path d="M0,-30 L-160,-12 L-150,0 L-160,12 L0,30Z" fill="${glow}" opacity="0.35" filter="url(#trail)"/>` +
      path('M130,0 L30,-12 L0,-24 L-26,-72 Q-40,-80 -50,-74 L-40,-20 L-70,-14 L-70,14 L-40,20 L-50,74 Q-40,80 -26,72 L0,24 L30,12Z', hull) + path('M10,-6 L-50,-30 L-60,-26 L-30,-4Z M10,6 L-50,30 L-60,26 L-30,4Z', '#9aa2b4') +
      path('M120,0 L30,-8 L-40,-6 L-40,6 L30,8Z', '#ffffff', 'opacity="0.18"') +
      path('M60,-5 L90,0 L60,5Z', '#9fe8ff', 'opacity="0.8"') +
      ellipse(-72, -8, 8, 5, glow) +
      ellipse(-72, 8, 8, 5, glow) +
      ellipse(-74, -8, 18, 9, glow, 'opacity="0.45" filter="url(#eng)"') +
      ellipse(-74, 8, 18, 9, glow, 'opacity="0.45" filter="url(#eng)"')
  )
}

export function starfighters() {
  const r = rng(206)
  let defs = rad('planet', [[0, '#3aa0c8'], [0.6, '#1a4a7a'], [1, '#0a1a3a']], 960, 2400, 1600)
  defs += rad('atm', [[0.9, '#7fd4ff', 0], [0.955, '#7fd4ff', 0.55], [1, '#7fd4ff', 0]], 960, 2500, 1700)
  defs += rad('sun', [[0, '#ffffff'], [0.02, '#fff4d8', 0.95], [0.07, '#ffe0a8', 0.45], [0.25, '#ffb070', 0.14], [0.6, '#ff9a5a', 0.04], [1, '#ff9a5a', 0]], 1560, 840, 900)
  defs += blur('trail', 10) + blur('eng', 6) + blur('b30', 30)
  let body = rect(0, 0, W, H, '#03050d')
  body += stars(r, 500, { rmax: 1.3, omax: 0.85 })
  // planet curve at the bottom with cloud streaks
  body += circle(960, 2500, 1700, 'url(#atm)')
  body += circle(960, 2400, 1600, 'url(#planet)')
  let cl = ''
  for (let i = 0; i < 18; i++) cl += ellipse(between(r, 0, W), between(r, 860, 1080), between(r, 120, 360), between(r, 6, 16), '#e6f6ff', `opacity="${n(between(r, 0.15, 0.4) * 100) / 100}"`)
  body += `<g clip-path="url(#pclip)" filter="url(#trail)">${cl}</g>`
  body = body.replace('</defs>', '')
  defs += `<clipPath id="pclip"><circle cx="960" cy="2400" r="1600"/></clipPath>`
  body += rect(0, 0, W, H, 'url(#sun)') + flare(1560, 840, 16, '#ffffff', 1)
  // the squadron in a loose V, flying up and right
  const hull = '#c8cdd8'
  body += fighter(1180, 360, 1.25, -22, hull, '#7fd8ff')
  body += fighter(900, 470, 1, -22, hull, '#7fd8ff')
  body += fighter(1290, 560, 0.95, -22, hull, '#7fd8ff')
  body += fighter(640, 560, 0.75, -22, hull, '#7fd8ff')
  body += fighter(1060, 700, 0.7, -22, hull, '#7fd8ff')
  // long engine trails
  let trails = ''
  for (const [x, y, s] of [[1180, 360, 1.25], [900, 470, 1], [1290, 560, 0.95], [640, 560, 0.75], [1060, 700, 0.7]]) {
    const a = (-22 * Math.PI) / 180
    const bx = x - Math.cos(a) * 80 * s
    const by = y - Math.sin(a) * 80 * s
    trails += `<path d="M${n(bx)},${n(by)} L${n(bx - Math.cos(a) * 700)},${n(by - Math.sin(a) * 700)}" stroke="#7fd8ff" stroke-width="${n(6 * s)}" opacity="0.18" stroke-linecap="round"/>`
  }
  body = body.replace(/(<g transform="translate\(1180)/, `${trails}$1`)
  return svg(defs, body)
}

export const space = {
  'twin-suns': twinSuns,
  hyperspace,
  nebula,
  'ring-planet': ringPlanet,
  'blade-duel': bladeDuel,
  starfighters
}
