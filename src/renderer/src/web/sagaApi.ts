// What the Season page calls (life.saga): read the whole view, and the few
// writes it makes. Every write goes through the core cleaners, so a broken
// page can't save a broken record.
import { addDays } from '@core/dates'
import { newSeason, seasonDays, type BossKind, type Season } from '@core/season'
import { rateQuarter, quarterOf, type Ratings } from '@core/lifeWheel'
import { type IdentityBook } from '@core/identityVotes'
import { SIDE_QUESTS, pickInput } from '@core/sideQuest'
import { type VisionBook } from '@core/vision'
import { WIN_KINDS, type Win } from '@core/winsWall'
import { ARC, type Outfit } from '@core/benArc'
import { financeStateFrom } from './botBrain'
import { noteMoment } from './benMind'
import { loadArc, loadIdentity, loadSeasons, loadSide, loadWheel, loadWins, sagaView, saveArc, saveIdentity, saveSeasons, saveSide, saveVision, saveVisionPhoto, saveWheel, saveWins, type SideFacts } from './sagaStore'
import type { Services, WebServices } from './webServices'

const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

export function createSaga(svcP: Promise<WebServices>) {
  const fin = (s: Services) => financeStateFrom(s.db, typeof localStorage !== 'undefined' ? localStorage : null)
  const read = async <T>(fn: (s: Services) => T) => (await svcP).read(fn)
  const write = async <T>(fn: (s: Services) => T) => (await svcP).write(fn, 'life-saga-changed')
  const today = (s: Services) => s.wallet.today()
  const editSeason = (s: Services, id: string, fn: (x: Season) => Season) => {
    const b = loadSeasons(s.db)
    if (!b.seasons.some((x) => x.id === id)) throw new Error('No such season')
    saveSeasons(s.db, { seasons: b.seasons.map((x) => (x.id === id ? fn(x) : x)) })
  }
  return {
    view: (side?: SideFacts) => read((s) => sagaView(s, { finance: fin(s), side })),
    // ---- seasons (LF1)
    startSeason: (p: { name: string; theme?: string; cover?: string; color?: string; area?: string | null; start: string; quests?: string[]; boss?: { title: string; kind: BossKind; day?: string } }) =>
      write((s) => {
        const b = loadSeasons(s.db)
        const sea = newSeason(p, uid('s'))
        // Only one open season at a time: an unfinished one that overlaps is closed today.
        const seasons = b.seasons.map((x) => (!x.closed && x.start <= addDays(sea.start, seasonDays(sea) - 1) && addDays(x.start, seasonDays(x) - 1) >= sea.start ? { ...x, closed: today(s) } : x))
        saveSeasons(s.db, { seasons: [...seasons, sea] })
        // The intro plays right away on the page, so the "a new season begins" scene isn't shown twice.
        const arc = loadArc(s.db)
        saveArc(s.db, { ...arc, played: [...arc.played, `season:${sea.id}:start`] })
        return sea
      }),
    saveSeason: (sea: Season) => write((s) => editSeason(s, sea.id, () => sea)),
    toggleQuest: (seasonId: string, questId: string) =>
      write((s) => editSeason(s, seasonId, (x) => ({ ...x, quests: x.quests.map((q) => (q.id === questId ? { ...q, done: q.done ? null : today(s) } : q)) }))),
    linkQuest: (seasonId: string, questId: string, link: { goalId?: number | null; cardId?: string | null }) =>
      write((s) => editSeason(s, seasonId, (x) => ({ ...x, quests: x.quests.map((q) => (q.id === questId ? { ...q, ...(link.goalId !== undefined ? { goalId: link.goalId } : {}), ...(link.cardId !== undefined ? { cardId: link.cardId } : {}) } : q)) }))),
    /** Only you can say how the real fight went. A win is kept as a moment Ben remembers. */
    bossResult: (seasonId: string, result: 'won' | 'lost' | null) =>
      write((s) => {
        const d = today(s)
        let title = ''
        let name = ''
        editSeason(s, seasonId, (x) => {
          title = x.boss.title
          name = x.name
          return { ...x, boss: { ...x.boss, result, resultDay: result ? d : null } }
        })
        if (result === 'won') noteMoment(s.db, `He beat the boss of season "${name}": ${title}`, d)
      }),
    closeSeason: (seasonId: string) =>
      write((s) => {
        const d = today(s)
        let name = ''
        let weeks = 12
        editSeason(s, seasonId, (x) => {
          name = x.name
          weeks = x.weeks
          return { ...x, closed: x.closed ?? d }
        })
        noteMoment(s.db, `He finished the season "${name}" (${weeks} weeks, start to finish)`, d)
      }),
    // ---- vision board (LF4)
    saveVision: (v: VisionBook) => write((s) => saveVision(s.db, v, today(s))),
    setCardPhoto: (cardId: string, url: string | null) => write((s) => saveVisionPhoto(s.db, cardId, url, today(s))),
    // ---- identity (LF6)
    saveIdentity: (b: IdentityBook) => write((s) => saveIdentity(s.db, b)),
    // ---- side quest (LF5)
    /** "Another one": pass on this week's pick. */
    passSide: (questId: string) =>
      write((s) => {
        const b = loadSide(s.db)
        const week = pickInput(b, today(s), { budget: null, weather: null, freeEvenings: null, freeDay: null }).week
        const w = b.weeks[week] ?? { passed: [], status: 'open' as const }
        saveSide(s.db, { ...b, weeks: { ...b.weeks, [week]: { ...w, passed: [...new Set([...w.passed, questId])] } } })
      }),
    skipSide: () =>
      write((s) => {
        const b = loadSide(s.db)
        const week = pickInput(b, today(s), { budget: null, weather: null, freeEvenings: null, freeDay: null }).week
        saveSide(s.db, { ...b, weeks: { ...b.weeks, [week]: { passed: b.weeks[week]?.passed ?? [], status: 'skipped' } } })
      }),
    /** "Did it": into your adventures (the photo stays on this device; only "has a photo" is saved). */
    didSide: (a: { questId: string | null; title?: string; place?: string; note?: string; day?: string; photo?: boolean }) =>
      write((s) => {
        const b = loadSide(s.db)
        const d = a.day && /^\d{4}-\d{2}-\d{2}$/.test(a.day) ? a.day : today(s)
        const def = SIDE_QUESTS.find((q) => q.id === a.questId)
        const id = uid('a')
        const week = pickInput(b, d, { budget: null, weather: null, freeEvenings: null, freeDay: null }).week
        saveSide(s.db, {
          weeks: { ...b.weeks, ...(a.questId ? { [week]: { passed: b.weeks[week]?.passed ?? [], status: 'done' as const } } : {}) },
          log: [...b.log, { id, questId: a.questId, title: (a.title || def?.title || 'An adventure').slice(0, 90), emoji: def?.emoji ?? '🧭', day: d, place: (a.place ?? '').slice(0, 60), note: (a.note ?? '').slice(0, 280), photo: !!a.photo }]
        })
        return id
      }),
    removeAdventure: (id: string) =>
      write((s) => {
        const b = loadSide(s.db)
        saveSide(s.db, { ...b, log: b.log.filter((a) => a.id !== id) })
      }),
    // ---- wins (LF15)
    addWin: (w: Pick<Win, 'kind' | 'title' | 'detail'> & { day?: string; weight?: Win['weight'] }) =>
      write((s) => {
        if (!WIN_KINDS.some((k) => k.id === w.kind && k.manual)) throw new Error('Pick what kind of win it is')
        const b = loadWins(s.db)
        const win: Win = { id: uid('w'), day: w.day && /^\d{4}-\d{2}-\d{2}$/.test(w.day) ? w.day : today(s), kind: w.kind, title: w.title, detail: w.detail ?? '', auto: false, weight: w.weight ?? 2 }
        saveWins(s.db, { ...b, mine: [...b.mine, win] })
        return win.id
      }),
    /** Your own win is deleted; an auto one is only taken off the wall. */
    removeWin: (id: string) =>
      write((s) => {
        const b = loadWins(s.db)
        saveWins(s.db, b.mine.some((w) => w.id === id) ? { ...b, mine: b.mine.filter((w) => w.id !== id) } : { ...b, hidden: [...b.hidden, id] })
      }),
    // ---- life wheel (LF18)
    rateWheel: (r: Ratings) => write((s) => saveWheel(s.db, rateQuarter(loadWheel(s.db), quarterOf(today(s)), r, new Date().toISOString()))),
    // ---- Ben's arc (LF12) and the cinematics (LF7)
    seeChapter: (n: number) => write((s) => saveArc(s.db, { ...loadArc(s.db), seenChapter: Math.max(1, Math.min(ARC.length, Math.round(n))) })),
    setOutfit: (o: Outfit | null) => write((s) => saveArc(s.db, { ...loadArc(s.db), outfit: o })),
    /** A cinematic played (once across your devices). */
    played: (id: string) =>
      write((s) => {
        const a = loadArc(s.db)
        if (!a.played.includes(id)) saveArc(s.db, { ...a, played: [...a.played, id] })
      }),
    identity: () => read((s) => loadIdentity(s.db))
  }
}

export type SagaApi = ReturnType<typeof createSaga>
