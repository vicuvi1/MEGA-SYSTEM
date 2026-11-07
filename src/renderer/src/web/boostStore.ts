// Focus boost on this device's copy of the database (synced like every
// setting): the settings (`focus_boost`) and the log of session goals,
// verdicts and stalling reasons (`focus_log`). A verdict is also a block
// result in the day log, which Ben's learning (core/benLearn.ts) reads; a
// "tired" or "boring" stall also lands on Ben's desk with his excuses.
// No points are paid or taken here.
import { readSetting, writeSetting } from '../../../main/settings'
import { BOOST_KEY, BOOST_LOG_KEY, cleanBoost, cleanBoostLog, type BoostApi, type BoostLog, type BoostPrefs } from '@core/focusBoost'
import { blockResultOf, setGoal, setVerdict } from '@core/sessionGoal'
import { addStall, excuseWords } from '@core/stallFix'
import { addBlockResult } from './dayLog'
import { noteExcuse } from './benDesk'

interface Db {
  read<T>(fn: (db: any) => T): Promise<T>
  write<T>(fn: (db: any) => T): Promise<T>
}

export const readBoost = (db: any): BoostPrefs => cleanBoost(readSetting(db, BOOST_KEY))
export const readBoostLog = (db: any): BoostLog => cleanBoostLog(readSetting(db, BOOST_LOG_KEY))
const saveLog = (db: any, log: BoostLog) => writeSetting(db, BOOST_LOG_KEY, log as unknown as Record<string, unknown>)

export function createBoostApi(mirrorP: Promise<Db>): BoostApi {
  return {
    get: async () => (await mirrorP).read(readBoost),
    save: async (p) => {
      const clean = cleanBoost(p)
      await (await mirrorP).write((db) => writeSetting(db, BOOST_KEY, clean as unknown as Record<string, unknown>))
      return clean
    },
    log: async () => (await mirrorP).read(readBoostLog),
    goal: async (o) => {
      await (await mirrorP).write((db) => {
        const log = readBoostLog(db)
        saveLog(db, { ...log, sessions: setGoal(log.sessions, o) })
      })
    },
    verdict: async (o) => {
      const at = new Date().toISOString()
      await (await mirrorP).write((db) => {
        const log = readBoostLog(db)
        saveLog(db, { ...log, sessions: setVerdict(log.sessions, { ...o, endedAt: at }) })
        addBlockResult(db, o.day, { at, title: o.subject, result: blockResultOf(o.verdict) })
      })
    },
    stall: async (o) => {
      const now = new Date()
      await (await mirrorP).write((db) => {
        const log = readBoostLog(db)
        saveLog(db, { ...log, stalls: addStall(log.stalls, { at: now.toISOString(), reason: o.reason, subject: o.subject }) })
        const words = excuseWords(o.reason, o.subject)
        if (words) noteExcuse(db, words, now.toISOString().slice(0, 10), now)
      })
    }
  }
}
