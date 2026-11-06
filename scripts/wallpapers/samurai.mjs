// Samurai and old-Japan scenes: generic figures and places, original art.
import { W, H, rng, n, pts, lerp, between, pick, svg, lin, rad, blur, rect, circle, ellipse, poly, path, g, ridge, wave, stars, cloud } from './lib.mjs'

/** A ronin standing, facing right, coat and sash blown by the wind (feet at 0,0, about 300 px tall). */
function ronin(fill, sash) {
  return (
    path('M-74,-248 Q0,-302 74,-248 Q0,-262 -74,-248Z', fill) +
    circle(0, -236, 16, fill) +
    path('M-30,-226 Q0,-236 30,-226 L40,-150 Q70,-90 104,-36 L44,-48 L32,-10 L14,-10 L10,-62 L-4,-62 L-10,-10 L-26,-10 L-32,-60 Q-52,-120 -40,-182 Z', fill) +
    path('M-28,-12 h18 v12 h-22z M12,-12 h20 l4,12 h-24z', fill) +
    `<path d="M22,-216 Q46,-180 46,-150" stroke="${fill}" stroke-width="15" fill="none" stroke-linecap="round"/>` +
    `<path d="M20,-128 L-118,-84" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="M24,-130 L70,-146" stroke="${fill}" stroke-width="7" stroke-linecap="round"/>` +
    ellipse(22, -129, 4, 9, fill, 'transform="rotate(-18 22 -129)"') +
    `<path d="M-30,-136 q-40,-12 -74,4 t-74,-2 t-62,-10" stroke="${sash}" stroke-width="7" fill="none" stroke-linecap="round"/>` +
    `<path d="M-34,-130 q-36,4 -60,22 t-56,14" stroke="${sash}" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.85"/>`
  )
}

export function roninMoon() {
  const r = rng(101)
  let defs = lin('sky', [[0, '#060a1c'], [0.5, '#141d45'], [0.85, '#2e3566'], [1, '#4a4a78']])
  defs += rad('moon', [[0, '#fbf6e6'], [0.85, '#ece3c8'], [1, '#d9cfae']], 1300, 470, 270)
  defs += rad('halo', [[0, '#f5efd8', 0.35], [0.4, '#c9c6e8', 0.12], [1, '#000', 0]], 1300, 470, 760)
  defs += lin('hill', [[0, '#0b0d1c'], [1, '#04050c']])
  defs += blur('b3', 3) + blur('b12', 12)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += stars(r, 220, { y0: 0, y1: 700, rmax: 1.4, omax: 0.9, fade: 760 })
  body += rect(0, 0, W, H, 'url(#halo)')
  body += circle(1300, 470, 270, 'url(#moon)')
  // soft maria on the moon
  let maria = ''
  for (const [x, y, rr] of [[1220, 400, 60], [1350, 380, 40], [1290, 520, 80], [1400, 500, 34], [1180, 540, 30]]) maria += circle(x, y, rr, '#c9bf9e', 'opacity="0.35"')
  body += g('filter="url(#b12)"', maria)
  // thin clouds drifting over the moon
  let wisps = ''
  for (let i = 0; i < 7; i++) {
    const y = between(r, 300, 680)
    const x = between(r, 700, 1700)
    wisps += ellipse(x, y, between(r, 200, 480), between(r, 6, 14), '#c7c3e0', `opacity="${n(between(r, 0.12, 0.3) * 100) / 100}"`)
  }
  body += g('filter="url(#b3)"', wisps)
  // far ridge and the hill the ronin stands on
  body += path(ridge(r, { y: 800, amp: 70, steps: 7 }), '#151a36', 'opacity="0.9"')
  body += path(wave([[-20, 960], [500, 930], [1000, 860], [1300, 836], [1600, 860], [1940, 930]]), 'url(#hill)')
  body += g('transform="translate(1310,842) scale(1.05)"', ronin('#04050c', '#c8202a'))
  // grass leaning in the wind
  let grass = ''
  for (let i = 0; i < 260; i++) {
    const x = between(r, -10, W + 10)
    const base = x < 1300 ? lerp(960, 836, Math.max(0, (x - 0) / 1300) ** 1.4) : lerp(836, 930, (x - 1300) / 620)
    const h = between(r, 14, 46)
    grass += `M${n(x)},${n(base + 6)} q${n(h * 0.2)},${n(-h * 0.6)} ${n(h * 0.55)},${n(-h)}`
  }
  body += `<path d="${grass}" stroke="#04050c" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
  // red leaves carried by the wind
  let leaves = ''
  for (let i = 0; i < 26; i++) {
    const x = between(r, 900, 1900)
    const y = between(r, 520, 900)
    const s = between(r, 4, 9)
    leaves += ellipse(x, y, s, s * 0.45, pick(r, ['#c8202a', '#e0453a', '#a51a24']), `transform="rotate(${Math.round(between(r, 0, 180))} ${n(x)} ${n(y)})" opacity="${n(between(r, 0.6, 1) * 100) / 100}"`)
  }
  body += leaves
  return svg(defs, body)
}

export function katanaSun() {
  const r = rng(102)
  let defs = lin('paper', [[0, '#f3ead8'], [1, '#e6d9bf']])
  defs += rad('sunG', [[0, '#d23a2c'], [0.92, '#c32f25'], [1, '#b1281f']], 1160, 420, 300)
  defs += lin('lacquer', [[0, '#2a2422'], [0.5, '#0e0b0a'], [1, '#1d1816']])
  defs += lin('saya', [[0, '#3a302c'], [0.35, '#141110'], [1, '#050404']])
  defs += `<pattern id="wrap" width="26" height="26" patternUnits="userSpaceOnUse"><rect width="26" height="26" fill="#14100e"/><path d="M0,13 L13,0 L26,13 L13,26Z" fill="#e8ddc7"/><path d="M5,13 L13,5 L21,13 L13,21Z" fill="#14100e"/></pattern>`
  defs += blur('b1', 1.2) + blur('b20', 20)
  let body = rect(0, 0, W, H, 'url(#paper)')
  // paper fibres
  let fib = ''
  for (let i = 0; i < 260; i++) {
    const x = between(r, 0, W)
    const y = between(r, 0, H)
    fib += `M${n(x)},${n(y)} q${n(between(r, -20, 20))},${n(between(r, -6, 6))} ${n(between(r, -40, 40))},${n(between(r, -4, 4))}`
  }
  body += `<path d="${fib}" stroke="#bfae8e" stroke-width="0.8" fill="none" opacity="0.35"/>`
  body += circle(1160, 420, 300, 'url(#sunG)')
  // a few ink brush lines across the sun, like distant birds and clouds
  body += `<path d="M640,330 C900,300 1300,320 1720,290" stroke="#efe6d4" stroke-width="10" fill="none" opacity="0.8" stroke-linecap="round"/>`
  body += `<path d="M760,370 C1000,350 1240,360 1560,342" stroke="#efe6d4" stroke-width="5" fill="none" opacity="0.7" stroke-linecap="round"/>`
  // the brush stroke the stand rests on
  let ink = 'M300,830'
  for (let i = 0; i <= 40; i++) {
    const x = 300 + i * 36
    ink += ` L${n(x)},${n(828 - Math.sin(i / 40 * Math.PI) * 14 + between(r, -5, 5))}`
  }
  for (let i = 40; i >= 0; i--) {
    const x = 300 + i * 36 + between(r, -6, 6)
    ink += ` L${n(x)},${n(870 + Math.sin(i / 40 * Math.PI) * 18 + between(r, -8, 8))}`
  }
  body += path(ink + 'Z', '#1b1715', 'opacity="0.88"')
  let drip = ''
  for (let i = 0; i < 40; i++) drip += circle(between(r, 280, 1760), between(r, 818, 900), between(r, 1, 5), '#1b1715', `opacity="${n(between(r, 0.4, 0.9) * 100) / 100}"`)
  body += drip
  // the stand: lacquered base and two arms
  body += rect(560, 790, 920, 34, 'url(#lacquer)', 'rx="8"')
  const arm = (x) => path(`M${x - 34},792 C${x - 30},700 ${x - 46},610 ${x - 20},520 L${x + 4},520 C${x - 2},560 ${x + 8},572 ${x + 26},578 L${x + 22},604 C${x + 4},604 ${x - 6},630 ${x + 2},660 C${x + 10},672 ${x + 20},676 ${x + 34},680 L${x + 30},704 C${x + 10},706 ${x},730 ${x + 30},792Z`, 'url(#lacquer)')
  body += arm(700) + arm(1340)
  // the long sword in its scabbard, resting in the upper notches
  const sori = (x0, x1, y, k) => `M${x0},${y} Q${(x0 + x1) / 2},${y - k} ${x1},${y}`
  body += `<path d="${sori(760, 1560, 576, 26)}" stroke="url(#saya)" stroke-width="24" fill="none" stroke-linecap="round"/>`
  body += `<path d="${sori(780, 1540, 570, 26)}" stroke="#5a4a40" stroke-width="2" fill="none" opacity="0.6"/>`
  body += path('M1548,566 l26,8 l-4,14 l-26,-6z', '#8a6a3a')
  body += ellipse(742, 578, 12, 34, '#2a2018') + ellipse(742, 578, 6, 26, '#8a6a3a', 'opacity="0.7"')
  body += `<path d="M732,580 L520,598" stroke="url(#wrap)" stroke-width="26" stroke-linecap="butt"/>` + path('M524,585 l-16,2 l2,24 l16,-2z', '#8a6a3a')
  // the short sword below
  body += `<path d="${sori(820, 1330, 690, 14)}" stroke="url(#saya)" stroke-width="20" fill="none" stroke-linecap="round"/>`
  body += ellipse(806, 691, 10, 28, '#2a2018')
  body += `<path d="M798,692 L660,702" stroke="url(#wrap)" stroke-width="20"/>`
  body += path('M1318,682 l20,6 l-3,12 l-20,-4z', '#8a6a3a')
  // a soft shadow on the paper and a red seal in the corner (no text)
  body += ellipse(1020, 840, 560, 22, '#3b2a20', 'opacity="0.25" filter="url(#b20)"')
  body += rect(1700, 880, 70, 70, '#b8281f', 'rx="6" opacity="0.9"') + `<circle cx="1735" cy="915" r="18" stroke="#f3ead8" stroke-width="5" fill="none" opacity="0.9"/><path d="M1712,940 l46,-50" stroke="#f3ead8" stroke-width="4" opacity="0.9"/>`
  return svg(defs, body)
}

function torii(color, dark) {
  // a gate about 560 px wide, feet at y = 0
  return (
    path('M-330,-430 Q0,-405 330,-430 L346,-456 Q0,-428 -346,-456Z', dark) +
    path('M-310,-412 Q0,-392 310,-412 L310,-388 Q0,-370 -310,-388Z', color) +
    rect(-290, -320, 580, 26, color) +
    rect(-14, -380, 28, 64, color) +
    path('M-214,-392 L-196,-392 L-186,0 L-224,0Z', color) +
    path('M196,-392 L214,-392 L224,0 L186,0Z', color) +
    rect(-232, -26, 54, 26, dark) +
    rect(178, -26, 54, 26, dark)
  )
}

export function toriiMist() {
  const r = rng(103)
  let defs = lin('sky', [[0, '#8fa4bf'], [0.5, '#c9d3dd'], [1, '#e8e4dc']])
  defs += lin('fog', [[0, '#eef0f2', 0], [0.5, '#eef0f2', 0.85], [1, '#eef0f2', 0]])
  defs += lin('water', [[0, '#c4ccd4'], [1, '#7f8ea0']])
  defs += rad('sun', [[0, '#fff3dc', 0.9], [1, '#fff3dc', 0]], 560, 420, 300)
  defs += blur('b4', 4) + blur('b16', 16)
  let body = rect(0, 0, W, H, 'url(#sky)')
  body += rect(0, 0, W, H, 'url(#sun)') + circle(560, 420, 50, '#fff6e6', 'opacity="0.85"')
  const layers = [
    [480, 110, '#8a9bb2', 0.7],
    [560, 90, '#73859e', 0.8],
    [640, 70, '#5d6f88', 0.85],
    [700, 50, '#4a5a72', 0.9]
  ]
  layers.forEach(([y, amp, c, o], i) => {
    body += path(ridge(r, { y, amp, steps: 8, rough: 0.52 }), c, `opacity="${o}"`)
    body += rect(0, y - 40, W, 200, 'url(#fog)', `opacity="${0.75 - i * 0.1}"`)
  })
  // still water
  body += rect(0, 760, W, 320, 'url(#water)')
  body += rect(0, 740, W, 70, 'url(#fog)', 'opacity="0.9"')
  // the gate standing in the water, and its reflection
  body += g('transform="translate(1260,860)"', torii('#d0442c', '#2b2524'))
  body += g('transform="translate(1260,860) scale(1,-0.7)" opacity="0.35" filter="url(#b4)"', torii('#d0442c', '#2b2524'))
  let ripples = ''
  for (let i = 0; i < 40; i++) {
    const y = between(r, 860, 1060)
    const x = between(r, 900, 1640)
    ripples += rect(x, y, between(r, 40, 200), 1.6, '#eef2f6', `opacity="${n(between(r, 0.2, 0.5) * 100) / 100}"`)
  }
  body += ripples
  // low mist over the water
  body += g('filter="url(#b16)" opacity="0.75"', ellipse(600, 880, 700, 50, '#f2f3f4') + ellipse(1500, 950, 600, 40, '#f2f3f4') + ellipse(1000, 1040, 900, 50, '#f2f3f4'))
  // a few birds
  let birds = ''
  for (let i = 0; i < 6; i++) {
    const x = between(r, 1450, 1750)
    const y = between(r, 240, 360)
    const s = between(r, 7, 12)
    birds += `<path d="M${n(x - s)},${n(y)} q${n(s / 2)},${n(-s / 2)} ${n(s)},0 q${n(s / 2)},${n(-s / 2)} ${n(s)},0" stroke="#3a4558" stroke-width="2" fill="none"/>`
  }
  body += birds
  return svg(defs, body)
}

export function bamboo() {
  const r = rng(104)
  let defs = lin('bg', [[0, '#d9eec6'], [0.5, '#9ccc7a'], [1, '#3f7a3c']])
  defs += rad('light', [[0, '#fbffe8', 0.9], [1, '#fbffe8', 0]], 600, 120, 900)
  defs += lin('stalkFar', [[0, '#a8d08a'], [1, '#86b56a']], 0, 0, 1, 0)
  defs += lin('stalkMid', [[0, '#5f9a4a'], [0.4, '#7fb862'], [1, '#467a36']], 0, 0, 1, 0)
  defs += lin('stalkNear', [[0, '#1f4a22'], [0.35, '#3b7a36'], [1, '#143a18']], 0, 0, 1, 0)
  defs += blur('b2', 2) + blur('b6', 6) + blur('b30', 30)
  let body = rect(0, 0, W, H, 'url(#bg)') + rect(0, 0, W, H, 'url(#light)')
  const leafCluster = (x, y, s, color, dir) => {
    let out = ''
    for (let i = 0; i < 5; i++) {
      const a = (dir > 0 ? 10 : 170) + between(r, -35, 35) + i * 6 * dir
      out += `<path d="M0,0 Q${n(30 * s)},${n(-7 * s)} ${n(80 * s)},0 Q${n(30 * s)},${n(7 * s)} 0,0Z" fill="${color}" transform="translate(${n(x)},${n(y)}) rotate(${n(a + 20)})"/>`
    }
    return out
  }
  const stalk = (x, w, fill, nodeColor, leafColor, leafS, lean) => {
    let out = path(`M${n(x - w / 2)},${H + 10} L${n(x - w / 2 + lean)},-10 L${n(x + w / 2 + lean)},-10 L${n(x + w / 2)},${H + 10}Z`, fill)
    let y = H - between(r, 40, 160)
    while (y > -20) {
      const t = 1 - y / H
      const xx = x + lean * t
      out += rect(xx - w / 2 - 1, y, w + 2, Math.max(2, w * 0.12), nodeColor)
      if (leafColor && r() < 0.35) out += leafCluster(xx + (r() < 0.5 ? -w / 2 : w / 2), y, leafS, leafColor, r() < 0.5 ? 1 : -1)
      y -= between(r, 120, 220)
    }
    return out
  }
  let far = ''
  for (let i = 0; i < 36; i++) far += stalk(between(r, 0, W), between(r, 8, 16), 'url(#stalkFar)', '#b9dc9c', null, 0, between(r, -10, 10))
  body += g('opacity="0.7" filter="url(#b2)"', far)
  // light shafts
  let rays = ''
  for (let i = 0; i < 6; i++) {
    const x = between(r, 200, 1300)
    rays += poly([[x, -20], [x + 60, -20], [x + 420, H], [x + 260, H]], '#fffbe0', `opacity="${n(between(r, 0.08, 0.18) * 100) / 100}"`)
  }
  body += g('filter="url(#b30)"', rays)
  let mid = ''
  for (let i = 0; i < 16; i++) mid += stalk(between(r, 0, W), between(r, 22, 36), 'url(#stalkMid)', '#a6d486', '#5f9a4a', 0.8, between(r, -20, 20))
  body += mid
  let near = ''
  for (const x of [120, 380, 1560, 1790]) near += stalk(x + between(r, -30, 30), between(r, 54, 78), 'url(#stalkNear)', '#5a9a50', '#24572a', 1.4, between(r, -30, 30))
  body += near
  // ground and fallen leaves
  body += rect(0, 1000, W, 80, '#2a5a28', 'opacity="0.6" filter="url(#b6)"')
  return svg(defs, body)
}

export function dojoDawn() {
  const r = rng(105)
  let defs = lin('sky', [[0, '#1b2a55'], [0.4, '#58618f'], [0.68, '#e59b8a'], [0.85, '#ffc98f'], [1, '#ffe2b4']])
  defs += rad('sun', [[0, '#fff2cc'], [0.25, '#ffd79a', 0.7], [1, '#ff9f7a', 0]], 960, 720, 500)
  defs += lin('fog', [[0, '#f6d6c0', 0], [0.5, '#f6d6c0', 0.8], [1, '#f6d6c0', 0]])
  defs += blur('b6', 6) + blur('b18', 18)
  let body = rect(0, 0, W, H, 'url(#sky)') + rect(0, 0, W, H, 'url(#sun)')
  body += circle(960, 730, 80, '#fff1d0')
  body += stars(r, 50, { y0: 0, y1: 260, rmax: 1.1, omax: 0.6 })
  body += path(ridge(r, { y: 700, amp: 90, steps: 7 }), '#7a6a8f', 'opacity="0.75"')
  body += rect(0, 660, W, 140, 'url(#fog)')
  body += path(ridge(r, { y: 780, amp: 50, steps: 7 }), '#4a3f63')
  // the hall: stone base, posts, glowing paper doors and a sweeping roof
  const cx = 960
  const base = 900
  body += poly([[cx - 520, base], [cx + 520, base], [cx + 560, base + 50], [cx - 560, base + 50]], '#241c30')
  for (let i = 0; i < 5; i++) body += rect(cx - 140 + i * 6, base + 50 + i * 22, 280 - i * 12, 22, '#2e2440')
  body += rect(cx - 440, 700, 880, 200, '#2a2036')
  // doors
  for (let i = 0; i < 8; i++) {
    const x = cx - 420 + i * 105
    body += rect(x + 8, 730, 88, 160, '#ffd59a', 'opacity="0.92"')
    for (let k = 1; k < 4; k++) body += rect(x + 8, 730 + k * 40, 88, 2, '#2a2036', 'opacity="0.6"')
    body += rect(x + 51, 730, 2, 160, '#2a2036', 'opacity="0.6"')
  }
  body += rect(cx - 440, 860, 880, 10, '#1a1424')
  for (let i = 0; i <= 8; i++) body += rect(cx - 440 + i * 105 - 4, 700, 12, 200, '#1a1424')
  body += ellipse(cx, 820, 520, 120, '#ffc98a', 'opacity="0.25" filter="url(#b18)"')
  // roof (irimoya-like) with upturned eaves
  body += path(`M${cx - 620},690 Q${cx - 520},660 ${cx - 420},640 L${cx + 420},640 Q${cx + 520},660 ${cx + 620},690 Q${cx + 560},700 ${cx + 470},696 L${cx - 470},696 Q${cx - 560},700 ${cx - 620},690Z`, '#140f1c')
  body += path(`M${cx - 430},642 L${cx - 300},540 L${cx + 300},540 L${cx + 430},642Z`, '#1e1729')
  body += path(`M${cx - 330},548 Q${cx - 260},520 ${cx - 200},500 L${cx + 200},500 Q${cx + 260},520 ${cx + 330},548 Q${cx},530 ${cx - 330},548Z`, '#140f1c')
  body += poly([[cx - 140, 540], [cx, 470], [cx + 140, 540]], '#2a2036')
  body += rect(cx - 210, 496, 420, 8, '#140f1c', 'rx="4"')
  // stone lanterns
  const lantern = (x) => rect(x - 10, 820, 20, 80, '#1a1424') + rect(x - 34, 806, 68, 14, '#1a1424') + rect(x - 24, 770, 48, 36, '#1a1424') + rect(x - 12, 778, 24, 20, '#ffcf8a') + poly([[x - 44, 772], [x, 744], [x + 44, 772]], '#1a1424') + circle(x, 788, 40, '#ffcf8a', 'opacity="0.3" filter="url(#b6)"')
  body += lantern(cx - 640) + lantern(cx + 640)
  // ground
  body += rect(0, 948, W, 140, '#140f1c')
  // a pine in the foreground, flat layered foliage
  let pine = `<path d="M150,1080 C170,940 120,860 220,760 C300,690 330,640 420,600" stroke="#0c0910" stroke-width="30" fill="none" stroke-linecap="round"/>`
  pine += `<path d="M230,750 C300,740 380,760 470,730 M300,690 C240,640 200,640 140,630" stroke="#0c0910" stroke-width="14" fill="none" stroke-linecap="round"/>`
  for (const [x, y, w] of [[440, 588, 220], [500, 720, 200], [150, 618, 160], [330, 520, 150], [250, 820, 180]]) pine += cloud(r, x, y, w, 46, '#0c0910')
  body += pine
  // petals of light / dust in the air
  body += stars(r, 40, { x0: 400, x1: 1500, y0: 500, y1: 900, rmax: 2, color: '#ffe2b4', omin: 0.3, omax: 0.8 })
  return svg(defs, body)
}

export function greatWave() {
  const r = rng(106)
  const navy = '#1d3461'
  const blue = '#355c94'
  const pale = '#8fb0d6'
  const foam = '#f4efe2'
  let defs = lin('sky', [[0, '#e8dcc0'], [0.6, '#efe5cf'], [1, '#d9cba8']])
  defs += lin('sea', [[0, '#5b7fb0'], [1, navy]])
  defs += blur('b1', 0.8)
  let body = rect(0, 0, W, H, 'url(#sky)')
  // flat bands of cloud, ukiyo-e style
  body += path('M0,140 C400,120 900,170 1400,130 C1600,116 1800,124 1920,120 L1920,170 C1700,180 1300,190 900,200 C500,210 200,190 0,200Z', '#d8c39a', 'opacity="0.55"')
  body += path('M300,300 C700,280 1200,310 1920,280 L1920,312 C1300,340 800,330 300,330Z', '#d8c39a', 'opacity="0.4"')
  // the far mountain on the horizon
  body += path('M1080,800 L1300,610 Q1340,580 1380,610 L1620,800Z', '#5d6f8a')
  body += path('M1258,646 L1300,610 Q1340,580 1380,610 L1424,648 L1400,640 L1384,660 L1364,636 L1344,664 L1322,640 L1300,662 L1282,640Z', foam)
  body += rect(0, 790, W, 300, 'url(#sea)')
  // rolling swells
  for (let k = 0; k < 6; k++) {
    const y = 820 + k * 44
    let d = `M-20,${y}`
    for (let x = -20; x < W + 80; x += 80) d += ` q40,${n(-14 - k * 2)} 80,0`
    body += `<path d="${d}" stroke="${k % 2 ? pale : foam}" stroke-width="${2 + k * 0.6}" fill="none" opacity="${0.5 + k * 0.06}"/>`
  }
  // curling waves: a hump whose top rolls forward into a spiral, foam fingers on the crest
  const curl = (x, y, sc, seed, mass, line) => {
    const rr = rng(seed)
    let out = path('M-40,40 L0,0 C60,-120 160,-300 330,-360 C430,-395 540,-370 580,-300 C600,-262 590,-220 560,-200 C556,-240 530,-268 492,-270 C450,-272 420,-240 425,-205 C430,-170 462,-150 492,-160 C470,-120 480,-50 560,0 L600,40Z', mass)
    for (let i = 1; i <= 5; i++) {
      const k = i * 22
      out += `<path d="M${n(20 + k * 0.6)},${n(-10 - k * 0.1)} C${n(90 + k * 0.4)},${n(-130 + k * 0.5)} ${n(190 + k * 0.2)},${n(-290 + k * 0.9)} ${n(340 - k * 0.2)},${n(-340 + k)} C${n(420 - k * 0.3)},${n(-362 + k)} ${n(500 - k * 0.6)},${n(-345 + k * 0.9)} ${n(530 - k * 0.8)},${n(-300 + k * 0.6)}" stroke="${i % 2 ? line : pale}" stroke-width="${n(9 - i)}" fill="none" stroke-linecap="round" opacity="0.85"/>`
    }
    // foam band along the crest and claws reaching forward
    out += `<path d="M150,-250 C220,-330 300,-360 360,-366 C450,-374 540,-350 572,-296 C590,-262 584,-226 560,-202" stroke="${foam}" stroke-width="22" fill="none" stroke-linecap="round"/>`
    const crest = [[200, -300], [250, -334], [300, -354], [350, -364], [400, -368], [450, -364], [500, -350], [540, -326], [568, -292], [578, -256], [566, -218]]
    crest.forEach(([cx, cy], i) => {
      const ang = -0.9 + i * 0.22 + between(rr, -0.1, 0.1)
      const len = between(rr, 26, 46)
      const tx = cx + Math.cos(ang) * len
      const ty = cy + Math.sin(ang) * len
      out += `<path d="M${n(cx - 9)},${n(cy + 4)} Q${n(cx + Math.cos(ang - 0.6) * len * 0.8)},${n(cy + Math.sin(ang - 0.6) * len * 0.8)} ${n(tx)},${n(ty)} Q${n(cx + Math.cos(ang + 0.5) * len * 0.5)},${n(cy + Math.sin(ang + 0.5) * len * 0.5)} ${n(cx + 9)},${n(cy + 6)}Z" fill="${foam}"/>` + circle(tx, ty, between(rr, 3, 5), foam)
    })
    out += stars(rr, 30, { x0: 300, x1: 700, y0: -460, y1: -250, rmin: 2, rmax: 6, color: foam, omin: 0.7, omax: 1 })
    return g(`transform="translate(${x},${y}) scale(${sc})"`, out)
  }
  body += curl(1380, 960, 0.75, 7, blue, pale)
  body += curl(-120, 1000, 1.85, 8, navy, blue)
  // a long boat riding between the waves
  body += path('M820,930 Q1000,900 1180,914 L1164,934 Q1000,926 836,950Z', '#e8d9b8')
  for (let i = 0; i < 6; i++) body += rect(880 + i * 46, 904 - i * 1.5, 13, 20, navy, 'rx="6"')
  body += curl(980, 1120, 1.1, 9, navy, blue)
  return svg(defs, body)
}

export const samurai = {
  'ronin-moon': roninMoon,
  'katana-sun': katanaSun,
  'torii-mist': toriiMist,
  bamboo,
  'dojo-dawn': dojoDawn,
  'great-wave': greatWave
}
