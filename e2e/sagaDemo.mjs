// E2E_SAGA_DEMO=1 on e2e/server.mjs: made-up data for the Season page
// (screenshots and the smoke step): a season in its 4th week with a boss,
// two finished seasons (Ben's arc in chapter 3), a vision board, identity
// lines, wins, adventures, three quarters of the life wheel and five weeks
// of made-up points. Nothing here is real.
export function seedSaga(db, day) {
  const set = (k, v) => db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)])
  const today = day(0)
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay()
  const monday = day((wd + 6) % 7)
  const back = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10)
  const fwd = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)
  const start = back(monday, 21)
  const goalId = (() => {
    try {
      return Number(db.exec("SELECT id FROM focus_goals WHERE title = 'Get Security+'")[0].values[0][0])
    } catch {
      return null
    }
  })()
  set('saga_seasons', {
    seasons: [
      { id: 'sdemo1', name: 'The Iron Path', theme: 'Forge a body that keeps up with your mind.', cover: 'dojo-dawn', color: '#ff9f43', area: 'body', start: back(start, 112), quests: [{ id: 'q1', title: 'Train 3 times a week', done: back(start, 60) }, { id: 'q2', title: 'Sleep before midnight', done: back(start, 58) }, { id: 'q3', title: 'Walk 8,000 steps a day', done: null }], boss: { title: 'Fitness test: 50 push-ups in one go', kind: 'fitness', day: back(start, 58), result: 'won', resultDay: back(start, 58) }, closed: back(start, 56) },
      { id: 'sdemo2', name: 'The Night Library', theme: 'Read, think and learn on purpose.', cover: 'lofi-room', color: '#ffb066', area: 'mind', start: back(start, 56), quests: [{ id: 'q1', title: 'Study 2 focused blocks a day', done: back(start, 4) }, { id: 'q2', title: 'Finish 2 books', done: back(start, 10) }, { id: 'q3', title: 'Teach one topic to someone', done: back(start, 3) }], boss: { title: 'Pass the end-of-term exam', kind: 'exam', day: back(start, 2), result: 'won', resultDay: back(start, 2) }, closed: back(start, 1) },
      {
        id: 'sdemo3',
        name: 'Shadow Code',
        theme: 'Become the hacker you keep reading about.',
        cover: 'neon-rain',
        color: '#ff3ea5',
        area: 'career',
        start,
        quests: [
          { id: 'q1', title: 'Pass Security+ practice exams', goalId, cardId: 'c2' },
          { id: 'q2', title: 'Write up every solved box', done: back(today, 2), cardId: 'c5' },
          { id: 'q3', title: 'Ship one small security tool', cardId: null }
        ],
        boss: { title: 'Weekend CTF: finish in the top half', kind: 'ctf', day: fwd(start, 54) },
        closed: null
      }
    ]
  })
  set('saga_vision', {
    year: Number(today.slice(0, 4)),
    word: 'Honor',
    becoming: 'A calm, strong man who keeps his word',
    cards: [
      { id: 'c1', text: 'Strong body', art: 'iron' },
      { id: 'c2', text: 'Security+ passed', art: 'shield' },
      { id: 'c3', text: 'A trip to the holy city', art: 'crescent' },
      { id: 'c4', text: 'Family dinners every Sunday', art: 'home' },
      { id: 'c5', text: 'Top 100 in a big CTF', art: 'flag' },
      { id: 'c6', text: '10,000 lei saved', art: 'coin' },
      { id: 'c7', text: 'Sunrise on a mountain', art: 'summit' },
      { id: 'c8', text: 'Read 24 books', art: 'scroll' }
    ]
  })
  set('saga_identity', {
    lines: [
      { id: 'i1', text: 'I am a disciplined hacker', emoji: '🗡️', kinds: ['focus'], words: ['ctf', 'rust'], target: 12 },
      { id: 'i2', text: 'I keep my word', emoji: '🤝', kinds: ['tasks', 'habits'], words: [], target: 20 },
      { id: 'i3', text: 'I am someone who trains', emoji: '💪', kinds: ['body'], words: [], target: 5 },
      { id: 'i4', text: 'I protect my sleep', emoji: '🌙', kinds: ['sleep'], words: [], target: 10 }
    ]
  })
  set('saga_wins', {
    mine: [
      { id: 'w1', day: back(today, 3), kind: 'message', title: 'Thanks for explaining recursion, it finally clicked', detail: 'a classmate, after the seminar', weight: 2 },
      { id: 'w2', day: back(today, 9), kind: 'ctf', title: 'First hard web challenge solved', detail: 'after 3 hours and two wrong ideas', weight: 3 },
      { id: 'w3', day: back(today, 12), kind: 'kind', title: 'Helped the neighbour carry her shopping up 5 floors', detail: '', weight: 1 },
      { id: 'w4', day: back(today, 17), kind: 'record', title: '40 push-ups in one set', detail: 'up from 28 in September', weight: 3 },
      { id: 'w5', day: back(today, 24), kind: 'message', title: 'Proud of you, son', detail: 'Dad, on the phone', weight: 3 },
      { id: 'w6', day: back(today, 30), kind: 'other', title: 'Spoke up in the seminar for the first time', detail: '', weight: 2 }
    ],
    hidden: []
  })
  set('saga_side', {
    weeks: {},
    log: [
      { id: 'a1', questId: 'sunrise', title: 'Sunrise walk to the highest point nearby', emoji: '🌅', day: back(monday, 40), place: 'The old water tower', note: 'Fog below, sun above. Worth the 5:40 alarm.' },
      { id: 'a2', questId: 'cafe', title: "Tried a café I'd never been to", emoji: '☕', day: back(monday, 33), place: 'Corner of the park', note: '' },
      { id: 'a3', questId: 'meetup', title: 'CTF night at the university', emoji: '🚩', day: back(monday, 26), place: 'Lab 3', note: 'Met two people who play every weekend.' },
      { id: 'a4', questId: 'mosque', title: "Prayed in a mosque I'd never visited", emoji: '🕌', day: back(monday, 19), place: 'Across the river', note: '' },
      { id: 'a5', questId: 'museum', title: 'History museum, one room, every label', emoji: '🏛️', day: back(monday, 12), place: 'City centre', note: '' },
      { id: 'a6', questId: 'stars', title: 'Stargazing outside the city', emoji: '🌌', day: back(monday, 6), place: 'The hill road', note: 'Saw the ring planet through binoculars.' },
      { id: 'a7', questId: 'cook', title: 'Cooked a dish from a country I never tasted', emoji: '🍜', day: back(monday, 1), place: 'Home', note: '' }
    ]
  })
  const y = Number(today.slice(0, 4))
  const q = `${y}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`
  const prevQ = (k) => (k.endsWith('Q1') ? `${Number(k.slice(0, 4)) - 1}-Q4` : `${k.slice(0, 4)}-Q${Number(k.slice(-1)) - 1}`)
  set('saga_wheel', {
    quarters: {
      [prevQ(prevQ(q))]: { faith: 5, family: 6, friends: 6, body: 4, mind: 6, career: 5, money: 4, fun: 6 },
      [prevQ(q)]: { faith: 6, family: 7, friends: 5, body: 6, mind: 7, career: 6, money: 5, fun: 6 },
      [q]: { faith: 7, family: 8, friends: 4, body: 7, mind: 7, career: 7, money: 5, fun: 6 }
    },
    at: {}
  })
  set('ben_convo', {
    points: [
      { at: `${back(start, 58)}T20:00:00.000Z`, day: back(start, 58), kind: 'win', text: 'He beat the boss of season "The Iron Path": 50 push-ups in one go', via: 'moment' },
      { at: `${back(start, 2)}T20:00:00.000Z`, day: back(start, 2), kind: 'win', text: 'He beat the boss of season "The Night Library": passed the end-of-term exam', via: 'moment' },
      { at: `${back(today, 9)}T22:00:00.000Z`, day: back(today, 9), kind: 'win', text: 'The night he solved his first hard CTF challenge', via: 'moment' }
    ],
    summary: '',
    summaryDay: null
  })
  // A rough morning today (the wins wall's "remember this").
  set('ben_desk', { excuses: [], moods: [{ day: today, slot: 'morning', mood: 2, at: `${today}T07:30:00.000Z` }], study: [], stacks: [], stakes: [], calls: [], letters: {} })
  // Five weeks of made-up points: focus, training, sleep, tasks, habits, money and perfect quest days.
  const ins = db.prepare('INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const row = (d, module, rule, coins, ref = null, note = null) => ins.run([`${d}T12:00:00.000Z`, d, module, 'earn', coins, coins, rule, ref, note])
  const subjects = ['Rust: ownership', 'CTF: web challenge', 'Security+ domain 3', 'Crypto: block ciphers', 'Algorithms']
  for (let n = 34; n >= 1; n--) {
    const d = day(n)
    const perfect = n % 3 !== 1
    row(d, 'focus', 'focus.session', 10, null, subjects[n % subjects.length])
    if (n % 2 === 0) row(d, 'focus', 'focus.session', 10, null, subjects[(n + 2) % subjects.length])
    if (n % 2 === 1 || perfect) row(d, 'body', 'body.workout_done', 15, null, 'Push day')
    if (n < 20 || n % 4) row(d, 'sleep', 'sleep.bed_on_time', 8)
    if (perfect) {
      row(d, 'sleep', 'sleep.up_on_time', 8)
      row(d, 'money', 'money.logged', 3)
      for (let t = 0; t < 3; t++) row(d, 'tasks', 'tasks.todoist_done', 5, `task:demo${n}-${t}`, 'Todoist task')
      row(d, 'discipline', 'discipline.clean_day', 10)
      row(d, 'tasks', 'face.routine_done', 4)
      row(d, 'tasks', 'habit.own', 4, `habit:read:${d}`, 'Read 20 pages')
    } else row(d, 'tasks', 'tasks.todoist_done', 5, `task:demo${n}-0`, 'Todoist task')
  }
  for (const [n, t] of [[4, 'Security+ at 33%: milestone'], [20, 'Lose 5 kg: 25%']]) row(day(n), 'general', 'goal.milestone', 15, null, t)
  // Today so far: two of the three daily quests on their way.
  row(today, 'focus', 'focus.session', 10, null, 'CTF: crypto warm-up')
  row(today, 'sleep', 'sleep.up_on_time', 8)
  ins.free()
  // The cinematics already seen (screenshots trigger them on purpose).
  set('saga_arc', { seenChapter: 2, outfit: null, played: [...[1, 3, 5, 8, 10, 14, 18, 22, 26, 30, 35, 40, 45, 50, 55, 60].map((n) => `rank:${n}`), 'season:sdemo3:start', 'season:sdemo3:half'] })
}
