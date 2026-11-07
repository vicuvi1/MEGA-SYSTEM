// Seasons, boss HP, identity votes, the life wheel, the side-quest picker,
// the vision board, the wins wall, Ben's arc and the level-up cinematic
// (LF1, LF4–LF7, LF12, LF15, LF18). Made-up data only.
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './ledger'
import { bossHp, cleanSeasonBook, currentSeason, FINAL_BLOW, finishedSeasons, mondayOf, newSeason, nextMonday, questPct, seasonEnd, seasonLine, seasonMoments, seasonProgress, seasonRecap } from './season'
import { cleanIdentity, identityLine, identityVotes, strongestLine, voteKindsOf } from './identityVotes'
import { average, cleanWheel, quarterLabel, quarterOf, rateQuarter, suggestTheme, weakestAreas, wheelChange, wheelDue, wheelHistory, wheelLine, wheelPoints, prevQuarter } from './lifeWheel'
import { adventureStats, cleanSide, pickInput, pickSideQuest, SIDE_QUESTS, trailPoint, unfit } from './sideQuest'
import { cardOfDay, cleanVision, cleanVisionPhotos, okVisionPhoto, visionLine } from './vision'
import { cleanWins, collectWins, isLowDay, pickWin, winsLine } from './winsWall'
import { ARC, arcLine, arcState, chapterFor, cleanArc, newChapter } from './benArc'
import { CINE, nextCinematic, rankUp, seasonCinematic, synthHit } from './levelCine'

let id = 0
const e = (day: string, ruleId: string | null, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({ id: ++id, ts: `${day}T10:00:00.000Z`, day, module: ruleId?.split('.')[0] ?? 'general', kind: 'earn', coins: 10, xp: 10, ruleId, ref: null, note: null, undoOf: null, ...extra })

describe('seasons (LF1)', () => {
  const s = newSeason({ name: 'Shadow Code', theme: 'Become the hacker', start: '2026-11-04', quests: ['Solve 20 boxes', 'Write ups', 'Ship a tool'], boss: { title: 'Weekend CTF', kind: 'ctf' } })
  it('starts on a Monday and lasts 8 weeks with the boss in the last week', () => {
    expect(s.start).toBe('2026-11-02')
    expect(mondayOf('2026-11-08')).toBe('2026-11-02')
    expect(nextMonday('2026-11-07')).toBe('2026-11-09')
    expect(nextMonday('2026-11-09')).toBe('2026-11-09')
    expect(seasonEnd(s)).toBe('2026-12-27')
    expect(s.boss.day).toBe('2026-12-26')
    expect(s.quests.map((q) => q.id)).toEqual(['q1', 'q2', 'q3'])
  })
  it('knows the week, its chapter, the days left and the boss week', () => {
    expect(seasonProgress(s, '2026-11-01').phase).toBe('before')
    const p = seasonProgress(s, '2026-11-07')
    expect(p).toMatchObject({ phase: 'active', week: 1, chapter: 'The Call', daysLeft: 51 })
    expect(seasonProgress(s, '2026-12-21')).toMatchObject({ phase: 'boss-week', week: 8, chapter: 'Final Battle' })
    expect(seasonProgress(s, '2026-12-28').phase).toBe('over')
  })
  it('boss HP falls with quests, perfect days and XP, but the last blow is the real fight', () => {
    const fresh = bossHp(s, { questPcts: [0, 0, 0], perfectDays: 0, xp: 0 })
    expect(fresh).toMatchObject({ hp: 100, ready: false })
    const mid = bossHp(s, { questPcts: [50, 20, 0], perfectDays: 10, xp: 1000 })
    expect(mid.hp).toBe(100 - 13 - 10 - 8)
    expect(mid.hits[0]).toMatchObject({ id: 'quests', hp: 13 })
    const max = bossHp(s, { questPcts: [100, 100, 100], perfectDays: 99, xp: 99999 })
    expect(max.hp).toBe(FINAL_BLOW)
    expect(max.ready).toBe(true)
    const won = bossHp({ ...s, boss: { ...s.boss, result: 'won', resultDay: '2026-12-26' } }, { questPcts: [], perfectDays: 0, xp: 0 })
    expect(won).toMatchObject({ hp: 0, result: 'won' })
    // nonsense in is clamped, never NaN
    expect(bossHp(s, { questPcts: [NaN, -50, 400], perfectDays: -3, xp: NaN }).hp).toBe(100 - 18)
  })
  it('a quest follows its goal or its tick', () => {
    expect(questPct({ id: 'q', title: 'x', goalId: 4, cardId: null, done: null }, (i) => (i === 4 ? 62 : null))).toBe(62)
    expect(questPct({ id: 'q', title: 'x', goalId: 9, cardId: null, done: null }, () => null)).toBe(0)
    expect(questPct({ id: 'q', title: 'x', goalId: null, cardId: null, done: '2026-11-10' }, () => null)).toBe(100)
  })
  it('season moments: start, halfway, boss ready, boss won', () => {
    const b = bossHp(s, { questPcts: [100, 100, 100], perfectDays: 30, xp: 5000 })
    expect(seasonMoments(s, seasonProgress(s, '2026-11-03'), b).map((m) => m.kind)).toEqual(['season-start', 'boss-ready'])
    expect(seasonMoments(s, seasonProgress(s, '2026-12-01'), bossHp(s, { questPcts: [], perfectDays: 0, xp: 0 })).map((m) => m.kind)).toEqual(['season-start', 'season-half'])
  })
  it('finds the current season, keeps the book clean and sorted', () => {
    const later = newSeason({ name: 'Iron Path', start: '2027-01-04' })
    const book = cleanSeasonBook({ seasons: [later, s, { name: '' }, s, 'junk'] })
    expect(book.seasons.map((x) => x.name)).toEqual(['Shadow Code', 'Iron Path'])
    expect(currentSeason(book, '2026-11-20')?.name).toBe('Shadow Code')
    expect(currentSeason(book, '2027-01-10')?.name).toBe('Iron Path')
    expect(finishedSeasons(book, '2027-01-10').map((x) => x.name)).toEqual(['Shadow Code'])
    expect(cleanSeasonBook(null)).toEqual({ seasons: [] })
  })
  it('recaps the arc and gives Ben one honest line', () => {
    const r = seasonRecap({ ...s, boss: { ...s.boss, result: 'won', resultDay: '2026-12-26' } }, { questPcts: [100, 100, 40], perfectDays: 22, xp: 2400, workouts: 18 }, '2026-12-28')
    expect(r).toMatchObject({ weeks: 8, questsDone: 2, verdict: 'Legend' })
    expect(r.lines).toContain('Boss defeated: Weekend CTF')
    const line = seasonLine(s, seasonProgress(s, '2026-11-20'), bossHp(s, { questPcts: [10, 0, 0], perfectDays: 2, xp: 300 }), [10, 0, 0])
    expect(line).toMatch(/week 3 "Training Arc"/)
    expect(line).toMatch(/HP \d+\/100/)
    expect(seasonLine(null, null, null)).toBe('')
  })
})

describe('identity votes (LF6)', () => {
  const book = cleanIdentity({ lines: [{ id: 'h', text: 'I am a disciplined hacker', kinds: ['focus'], words: ['CTF'], target: 4 }, { id: 'w', text: 'I keep my word', kinds: ['tasks', 'habits'], target: 5 }, { text: '' }, { text: 'x', kinds: ['nope'] }] })
  it('keeps up to 5 clean lines', () => {
    expect(book.lines.map((l) => l.id)).toEqual(['h', 'w', 'i4'])
    expect(book.lines[0].words).toEqual(['ctf'])
    expect(book.lines[2].kinds).toEqual([])
    expect(cleanIdentity({ lines: Array.from({ length: 9 }, (_, i) => ({ text: `l${i}` })) }).lines).toHaveLength(5)
  })
  it('only real earns vote; spends, resets, quest bonuses and undone rows do not', () => {
    expect(voteKindsOf(e('2026-11-02', 'focus.session'))).toEqual(['focus'])
    expect(voteKindsOf(e('2026-11-02', 'tasks.todoist_done'))).toEqual(['tasks'])
    expect(voteKindsOf(e('2026-11-02', 'discipline.reset'))).toEqual([])
    expect(voteKindsOf(e('2026-11-02', null, { kind: 'spend', coins: -50 }))).toEqual([])
    expect(voteKindsOf(e('2026-11-02', null, { ref: 'quest:2026-11-02' }))).toEqual([])
  })
  it('counts this week, last week and fills the bar', () => {
    const entries = [e('2026-11-02', 'focus.session'), e('2026-11-03', 'focus.session'), e('2026-11-04', 'study.block_done'), e('2026-10-28', 'focus.session'), e('2026-11-04', 'habit.own'), e('2026-11-05', 'tasks.todoist_done')]
    const undone = e('2026-11-05', 'focus.session')
    entries.push(undone, { ...e('2026-11-05', null), kind: 'undo', coins: 0, xp: 0, undoOf: undone.id })
    const v = identityVotes(book, entries, '2026-11-06', [{ day: '2026-11-06', kinds: ['kind'], text: 'Won my first CTF' }])
    expect(v[0]).toMatchObject({ week: 4, lastWeek: 1, fill: 1, trend: 'up' })
    expect(v[0].line).toBe('4 votes this week for: I am a disciplined hacker')
    expect(v[1]).toMatchObject({ week: 2, fill: 0.4 })
    expect(v[0].weeks).toHaveLength(4)
    expect(strongestLine(v)?.id).toBe('h')
    expect(identityLine(v)).toMatch(/4 votes this week for 'I am a disciplined hacker'/)
  })
})

describe('life wheel (LF18)', () => {
  const book = rateQuarter(rateQuarter(cleanWheel(null), '2026-Q3', { faith: 6, family: 7, friends: 5, body: 6, mind: 7, career: 6, money: 5, fun: 6 }, '2026-09-20T10:00:00Z'), '2026-Q4', { faith: 7, family: 8, friends: 4, body: 7, mind: 6, career: 7, money: 4, fun: 7, junk: 99 } as never, '2026-11-06T10:00:00Z')
  it('quarters and labels', () => {
    expect(quarterOf('2026-11-07')).toBe('2026-Q4')
    expect(quarterOf('2027-01-01')).toBe('2027-Q1')
    expect(prevQuarter('2027-Q1')).toBe('2026-Q4')
    expect(quarterLabel('2026-Q4')).toBe('Oct–Dec 2026')
  })
  it('keeps ratings 1–10 and the history oldest first', () => {
    expect(wheelHistory(book).map((h) => h.q)).toEqual(['2026-Q3', '2026-Q4'])
    expect(average(book.quarters['2026-Q4'])).toBe(6.3)
    expect(cleanWheel({ quarters: { '2026-Q4': { body: 0, mind: 11, fun: '7' }, nope: { body: 5 } } }).quarters).toEqual({ '2026-Q4': { fun: 7 } })
  })
  it('weakest area with the drop as tie-break, and the theme it suggests', () => {
    const cur = book.quarters['2026-Q4']
    const prev = book.quarters['2026-Q3']
    expect(wheelChange(cur, prev).friends).toBe(-1)
    expect(weakestAreas(cur, prev).slice(0, 2)).toEqual(['friends', 'money'])
    const s = suggestTheme(cur, prev)!
    expect(s.area).toBe('friends')
    expect(s.theme.name).toBe('Bonds of the Road')
    expect(s.why).toMatch(/down 1 since last quarter/)
    expect(suggestTheme({}, null)).toBeNull()
  })
  it('due once a quarter, draws a polygon, and gives Ben a line', () => {
    expect(wheelDue(book, '2026-11-07')).toMatchObject({ due: false, quarter: '2026-Q4', daysLeft: 55 })
    expect(wheelDue(book, '2027-01-02').due).toBe(true)
    const pts = wheelPoints({ faith: 10, body: 5 }, 100, 100, 50)
    expect(pts[0]).toEqual([100, 50])
    expect(pts[3][0]).toBeGreaterThan(100)
    expect(wheelLine(book, '2026-11-07')).toMatch(/Weakest: friends, money/)
  })
})

describe('weekly side quest (LF5)', () => {
  const facts = { budget: 300, weather: 'clear' as const, freeEvenings: 2, freeDay: true }
  it('the same pick all week, a different one next week', () => {
    const a = pickSideQuest(pickInput(cleanSide(null), '2026-11-04', facts))!
    const b = pickSideQuest(pickInput(cleanSide(null), '2026-11-08', facts))!
    const c = pickSideQuest(pickInput(cleanSide(null), '2026-11-11', facts))!
    expect(a.quest.id).toBe(b.quest.id)
    expect(SIDE_QUESTS.map((q) => q.id)).toContain(c.quest.id)
    expect(a.why).toMatch(/^Fits: /)
  })
  it('fits budget, rain, free evenings and skips what you did lately or passed on', () => {
    const base = { week: '2026-11-02', budget: 40, weather: 'rain' as const, freeEvenings: 0, freeDay: true, recent: ['museum'], passed: [] }
    for (let w = 0; w < 10; w++) {
      const p = pickSideQuest({ ...base, week: `2026-1${w % 2}-0${(w % 7) + 1}` })!
      expect(p.quest.cost).toBeLessThanOrEqual(20)
      expect(p.quest.outdoor).toBe(false)
      expect(p.quest.when).not.toBe('evening')
      expect(p.quest.id).not.toBe('museum')
    }
    expect(unfit(SIDE_QUESTS.find((q) => q.id === 'stars')!, base)).toBe('over budget')
    const passedAll = SIDE_QUESTS.map((q) => q.id)
    expect(pickSideQuest({ ...base, passed: passedAll })).toBeNull()
  })
  it('keeps a clean log, counts weeks in a row and lays out the trail', () => {
    const book = cleanSide({ log: [{ title: 'Sunrise walk', questId: 'sunrise', day: '2026-11-01' }, { title: 'Cafe', questId: 'cafe', day: '2026-10-20' }, { title: '', day: '2026-10-01' }], weeks: { '2026-11-02': { passed: ['cafe'], status: 'open' }, bad: {} } })
    expect(book.log.map((a) => a.title)).toEqual(['Cafe', 'Sunrise walk'])
    expect(Object.keys(book.weeks)).toEqual(['2026-11-02'])
    expect(pickInput(book, '2026-11-05', facts).passed).toEqual(['cafe'])
    expect(pickInput(book, '2026-11-05', facts).recent).toEqual(['cafe', 'sunrise'])
    expect(adventureStats(book, '2026-11-05')).toMatchObject({ total: 2, weeksInARow: 2 })
    const p0 = trailPoint(0)
    const p4 = trailPoint(4)
    expect(p0.y).toBeGreaterThan(p4.y)
    expect(p0.x).toBeGreaterThan(0)
    expect(p0.x).toBeLessThan(1)
  })
})

describe('vision board (LF4)', () => {
  it('word, line, up to 9 cards, a card of the day and Ben\'s line', () => {
    const v = cleanVision({ word: 'Honor', becoming: 'A calm, strong man who keeps his word', cards: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, text: `Card ${i}`, art: i === 0 ? 'blade' : 'nope' })) }, 2026)
    expect(v.cards).toHaveLength(9)
    expect(v.cards[0].art).toBe('blade')
    expect(v.year).toBe(2026)
    expect(cardOfDay(v, '2026-11-07')?.id).toBe(cardOfDay(v, '2026-11-07')?.id)
    expect(cardOfDay(v, '2026-11-07')?.id).not.toBe(cardOfDay(v, '2026-11-08')?.id)
    expect(visionLine(v)).toMatch(/word of the year: "Honor"/)
    expect(visionLine(cleanVision(null, 2026))).toBe('')
  })
  it('keeps only small pictures of cards that exist', () => {
    const v = cleanVision({ cards: [{ id: 'a', text: 'Strong body' }] }, 2026)
    const ok = 'data:image/jpeg;base64,AAAA'
    expect(okVisionPhoto(ok)).toBe(true)
    expect(okVisionPhoto('data:image/jpeg;base64,' + 'A'.repeat(130_000))).toBe(false)
    expect(cleanVisionPhotos({ a: ok, b: ok, c: 'http://x' }, v.cards)).toEqual({ a: ok })
  })
})

describe('wins wall (LF15)', () => {
  const entries: LedgerEntry[] = []
  for (let i = 0; i < 12; i++) entries.push(e(`2026-10-${String(i + 1).padStart(2, '0')}`, 'body.workout_done', { note: 'Push day' }))
  for (const d of ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-20']) entries.push(e(d, 'sleep.bed_on_time'))
  entries.push(e('2026-10-18', 'focus.session', { note: 'CTF: web challenge' }))
  entries.push(e('2026-10-19', 'goal.milestone', { note: 'Save 5,000 lei: 50%' }))
  const book = cleanWins({ mine: [{ id: 'm1', day: '2026-10-21', kind: 'message', title: '"Thanks for helping me move"', detail: 'a friend' }, { title: 'bad' }] })
  it('collects real proof by itself and keeps your own', () => {
    const wins = collectWins({ entries, book, seasons: [{ id: 's1', name: 'Shadow Code', boss: 'Weekend CTF', won: true, day: '2026-10-22' }], adventures: [{ id: 'a1', title: 'Sunrise walk', emoji: '🌅', day: '2026-10-23', place: 'The hill' }] })
    const titles = wins.map((w) => w.title)
    expect(titles).toContain('10 workouts done')
    expect(titles).toContain('6 nights on time in a row')
    expect(titles).toContain('CTF: web challenge')
    expect(titles).toContain('Save 5,000 lei: 50%')
    expect(titles).toContain('Boss defeated: Weekend CTF')
    expect(titles).toContain('"Thanks for helping me move"')
    expect(wins[0].day >= wins[wins.length - 1].day).toBe(true)
    const hidden = collectWins({ entries, book: { ...book, hidden: ['auto:workouts:10'] } })
    expect(hidden.map((w) => w.title)).not.toContain('10 workouts done')
  })
  it('spots a low day and brings back one real win', () => {
    expect(isLowDay({ mood: 2, yesterday: 50, score: 70, prevScore: 70, slipped: false })).toBe(true)
    expect(isLowDay({ mood: null, yesterday: 0, score: null, prevScore: null, slipped: false })).toBe(true)
    expect(isLowDay({ mood: 4, yesterday: 40, score: 50, prevScore: 70, slipped: false })).toBe(true)
    expect(isLowDay({ mood: 4, yesterday: 40, score: 66, prevScore: 70, slipped: false })).toBe(false)
    const wins = collectWins({ entries, book })
    expect(pickWin(wins, '2026-11-07')).toBeTruthy()
    expect(winsLine(wins, true, '2026-11-07')).toMatch(/LOW DAY/)
    expect(winsLine(wins, false, '2026-11-07')).not.toMatch(/LOW DAY/)
    expect(winsLine([], true, '2026-11-07')).toBe('')
  })
})

describe("Ben's arc (LF12)", () => {
  it('a chapter per finished season, outfits unlock, the reveal plays once', () => {
    expect(chapterFor(0).title).toBe('The stranger at the gate')
    expect(chapterFor(2).outfit).toBe('haori')
    expect(chapterFor(5).n).toBe(5)
    expect(chapterFor(9).n).toBe(ARC.length)
    const st = arcState(2, 'gi')
    expect(st).toMatchObject({ outfit: 'gi', toNext: 1 })
    expect(st.unlocked.map((c) => c.outfit)).toEqual(['traveler', 'gi', 'haori'])
    expect(arcState(2, 'master').outfit).toBe('haori')
    const book = cleanArc({ seenChapter: 2, played: ['rank:5'] })
    expect(newChapter(book, st)?.n).toBe(3)
    expect(newChapter({ ...book, seenChapter: 3 }, st)).toBeNull()
    expect(cleanArc({ seenChapter: 99, outfit: 'cape' })).toMatchObject({ seenChapter: 1, outfit: null })
    expect(arcLine(st, [{ day: '2026-10-22', text: 'He beat his first CTF boss' }], '2026-11-07')).toMatch(/chapter 3 "The sensei".*first CTF boss/)
  })
})

describe('level-up cinematic (LF7)', () => {
  it('only a new rank plays, not every level', () => {
    expect(rankUp(3, 4)).toBeNull()
    expect(rankUp(4, 5)).toMatchObject({ id: 'rank:5', kind: 'rank' })
    expect(rankUp(4, 9)?.id).toBe('rank:8')
    expect(rankUp(5, 5)).toBeNull()
    expect(rankUp(0, 5)).toBeNull()
  })
  it('plays each moment once, ranks first', () => {
    const r = rankUp(4, 5)!
    const s = seasonCinematic({ id: 'season:s1:start', kind: 'season-start', title: 'Shadow Code', sub: 'x' }, '#ff3ea5')
    expect(nextCinematic([s, r], [])?.id).toBe('rank:5')
    expect(nextCinematic([s, r], ['rank:5'])?.id).toBe('season:s1:start')
    expect(nextCinematic([s, r], ['rank:5', 'season:s1:start'])).toBeNull()
  })
  it('a 5-second scene with a deep hit on the flash', () => {
    expect(CINE.end).toBe(5000)
    const v = synthHit()
    expect(Math.min(...v.map((x) => x.f2 ?? x.f))).toBeLessThan(60)
    expect(v.every((x) => x.at >= 0 && x.at + x.len <= 5)).toBe(true)
  })
})
