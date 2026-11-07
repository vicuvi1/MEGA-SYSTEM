// Everything the Sport Track page (apps/sport/index.html) uses from here,
// bundled into apps/sport/sportkit.js as window.SportKit (npm run build:sport;
// a test fails when the bundle is out of date).
export { FLOOR, BONES, frameAt, stillFrame, loopLength, boxOf } from './sportFigure'
export { figureShapes } from './sportDraw'
export { MOVES, GROUPS, FAMILIES, moveById, matchMove } from './sportMoves'
export { moveOf, levelOf, nextStep, prevStep, startTarget, targetRun, suggestHarder, loggedMoves, ladderOf } from './sportLadders'
export { computeBadges, newBadges, activeDays, bestRun } from './sportBadges'
export { PHOTOS, PHOTO_SOURCE, photoOf } from './sportPhotos'
export { MUSCLES, WEEKLY_SETS, muscleOf, setsOn, makeSet, addSets, mergeSets, sessionsOf, bestSet, hardSets, hardSetsByMuscle, weeklyVolume, importSets, parseSets, setsText, mondayOf } from './sportSets'
export { rangeFor, progressFor, growTarget, enduranceStep, BREAK_DAYS, NEED, modeOf, restFor, strengthTarget, strengthSets, needFor, STRENGTH_LO, STRENGTH_HI } from './sportProgress'
export { loadOf, setScore, familySeries, familiesWithSets, strengthChange, strengthScore, isRecord } from './sportStrength'
export { weekPlan, todaysSession, buildSession, estimateMinutes, splitOf, growTips, TRAIN_DAYS } from './sportProgram'
export { parseTelegramExport, mergeTelegramDays, matchExercise } from './sportTelegramImport'
export { migrateRoutine, ROUTINE_VERSION } from './sportRoutine'
export { trackOf, MAIN_FAMILIES, placeFamily, placeAll, seriesOf, levelChanges, overallRank, RANKS, compareThen, milestones, estimateSets, COMEBACK_DAYS } from './sportLevels'
export { coachFor, feedbackFor, missingGroups, formTip, sessionsFor, NEED_TOP, addFeel, resetFeel, setEffort, signalFor, effortAvg, mergeFeel, mergeEffort } from './sportCoach'
export { forecasts, goalPace, weeklyStory, storyWeek, recordsWall, trendLine } from './sportForecast'
export { PROGRAMS, programById, sessionFor, applyProgram, stopProgram, todayRoutine, balanceCheck, deloadAdvice, deloadWeek, slotMove } from './sportPrograms'

import { placeFamily, placeAll, overallRank } from './sportLevels'
import { coachFor } from './sportCoach'
import type { HistoryInput } from './sportLevels'
import type { CoachInput } from './sportCoach'

/**
 * The hero in one call: your overall rank and where your best set puts you on every family you log
 * (level, name, requirement, next level). `heroLevel(history)`; history = { exercises, days, sets, today }.
 */
export function heroLevel(history: HistoryInput) {
  const places = placeAll(history)
  return { rank: overallRank(places), places, top: places[0] ?? null }
}

/** Where one exercise's family places you (your best single set counts, one log is enough). */
export const placementFor = (history: HistoryInput, family: string) => placeFamily(history, family)

/** The strength target and rest for one exercise today: { label: '3×6', sets, goal, lo, hi, rest, restLabel, next, signal, status, line, ready }. */
export function strengthTargetFor(input: CoachInput) {
  const c = coachFor({ ...input, mode: input.mode ?? 'strength' })
  if (!c) return null
  return { label: c.label, sets: c.sets, goal: c.goal, lo: c.lo, hi: c.hi, unit: c.unit, rest: c.rest, restLabel: c.rest % 60 ? `${Math.floor(c.rest / 60)}:${String(c.rest % 60).padStart(2, '0')} min` : `${c.rest / 60} min`, next: c.next, signal: c.signal, status: c.status, line: c.line, ready: c.ready, stepBack: c.stepBack }
}
