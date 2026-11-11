import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUNDLED_VIDEOS, clearVerdict, cuesFor, isVerified, mediaFor, mediaList, mediaTag, mergeVerdicts, PHOTO_MOVES, setVerdict, tempoFor, VIDEOS } from './trainMedia'
import { DEFAULT_LADDERS } from './trainLadders'

// Paths are joined per part, so the test reads the same files on Windows and Linux.
const PUBLIC = join(__dirname, '..', 'renderer', 'public')
const fileOf = (src: string) => join(PUBLIC, ...src.split('/').filter(Boolean))

describe('the media manifest', () => {
  it('every listed demo is a real bundled file, with its source, licence and changes; none is verified yet', () => {
    const moves = new Set([...DEFAULT_LADDERS.flatMap((l) => l.levels.map((v) => v.move)), ...PHOTO_MOVES, 'shrimp_squat', 'lunge'])
    for (const m of moves)
      for (const it of mediaList(m)) {
        for (const src of it.src) expect(existsSync(fileOf(src)), src).toBe(true)
        expect(it.sourceUrl).toMatch(/^https:\/\//)
        expect(it.licenceUrl).toMatch(/^https:\/\//)
        expect(it.changes.length).toBeGreaterThan(10)
        expect(it.verifiedTechnique).toBe(false)
        // Share-alike files live in their own folder.
        expect(it.shareAlike).toBe(it.src[0].includes('/by-sa/'))
        expect(['CC BY 3.0', 'CC BY-SA 4.0', 'Public domain', 'The Unlicense']).toContain(it.licence)
      }
  })

  it('every bundled video is listed, credited in a NOTICE and small (≤ 1.5 MB each, ≤ 6 MB in all)', () => {
    const dir = join(PUBLIC, 'apps', 'sport', 'media')
    const files = [...readdirSync(dir).filter((f) => f.endsWith('.webm')), ...readdirSync(join(dir, 'by-sa')).filter((f) => f.endsWith('.webm')).map((f) => `by-sa/${f}`)]
    expect(new Set(files)).toEqual(BUNDLED_VIDEOS)
    const notice = readFileSync(join(dir, 'NOTICE.md'), 'utf8')
    const sa = readFileSync(join(dir, 'by-sa', 'NOTICE.md'), 'utf8')
    let total = 0
    for (const f of files) {
      const size = statSync(join(dir, ...f.split('/'))).size
      total += size
      expect(size, f).toBeLessThanOrEqual(1.5 * 1024 * 1024)
      expect((f.startsWith('by-sa/') ? sa : notice).includes(f.replace('by-sa/', '')), f).toBe(true)
    }
    expect(total).toBeLessThanOrEqual(6 * 1024 * 1024)
    for (const v of Object.values(VIDEOS)) expect(notice + sa).toContain(v.sourceUrl.replace('https://', ''))
  })

  it('videos come first, then the photo frames; a move with neither has no demo', () => {
    expect(mediaList('pushup').map((m) => m.kind)).toEqual(['video', 'frames'])
    expect(mediaList('pullup').map((m) => m.id)).toEqual(['v-pullup-fs'])
    expect(mediaList('neg_pullup')[0]).toMatchObject({ id: 'v-pullup-fs', match: 'close' })
    expect(mediaList('diamond_pushup').map((m) => m.kind)).toEqual(['frames'])
    expect(mediaList('archer_pushup')).toEqual([])
  })

  it('a demo the owner marks wrong is never shown again; "Looks right" verifies it; answers merge newest first', () => {
    const st: any = {}
    setVerdict(st, 'v-pushup-navy', false, 10)
    expect(mediaFor('pushup', st.trainMediaOk).map((m) => m.kind)).toEqual(['frames'])
    setVerdict(st, 'p-pushup', true, 11)
    expect(isVerified(mediaFor('pushup', st.trainMediaOk)[0], st.trainMediaOk)).toBe(true)
    clearVerdict(st, 'v-pushup-navy')
    expect(mediaFor('pushup', st.trainMediaOk)[0].id).toBe('v-pushup-navy')
    expect(mergeVerdicts({ a: { ok: true, at: 3 } }, { a: { ok: false, at: 2 }, b: { ok: 'x' } })).toEqual({ a: { ok: true, at: 3 } })
  })

  it('a small tag on every demo; tempo and cues for the line under it', () => {
    expect(mediaTag(VIDEOS.pullup)).toBe('Video · FitnessScape · CC BY 3.0')
    expect(mediaTag(VIDEOS.singleLegSquat)).toBe('Video · RickyBennison · CC BY-SA 4.0 · close match')
    expect(mediaTag(mediaList('diamond_pushup')[0])).toBe('Photo frames · Free Exercise DB · public domain')
    expect(tempoFor({ move: 'pushup', unit: 'reps' })).toBe('2 s down · 1 s up')
    expect(tempoFor({ move: 'neg_pullup', unit: 'reps' })).toBe('5 s down · reset')
    expect(tempoFor({ move: 'plank', unit: 'sec' })).toBe('Hold still · breathe')
    expect(cuesFor('bulgarian_squat')).toEqual(['Front knee over the toes', 'back knee nearly touches the floor', 'torso tall'])
    expect(cuesFor('archer_pullup').length).toBe(3)
  })
})
