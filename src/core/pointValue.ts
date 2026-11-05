/**
 * Night 11 (RL1): what one point is worth in real money.
 *
 * leiPerPoint = your monthly fun budget ÷ the points you usually earn in a
 * month, so normal effort buys exactly your fun budget; earn more, spend more.
 * Without a fun budget (or too little history) it falls back to the old fixed
 * 10 points = 1 lei. Clamped so one strange week can't make points absurd.
 * Shared by Rewards, Money and Ben: always use this, never COINS_PER_MDL.
 */
import { COINS_PER_MDL } from './economy'

export const DEFAULT_LEI_PER_POINT = 1 / COINS_PER_MDL
export const MIN_LEI_PER_POINT = 0.02
export const MAX_LEI_PER_POINT = 2

export interface PointValueInput {
  /** Monthly fun budget in lei (null = not set). */
  funBudgetLei: number | null
  /** Points you usually earn a day (core/shop earnPerDay; 0 = too little history). */
  earnPerDay: number
}

export interface PointValue {
  leiPerPoint: number
  pointsPerLei: number
  funBudgetLei: number | null
  usualMonthlyPoints: number
  /** 'budget' = from your fun budget; 'default' = the fixed fallback. */
  source: 'budget' | 'default'
}

export function pointValue(input: PointValueInput): PointValue {
  const usualMonthlyPoints = Math.max(0, Math.round((input.earnPerDay || 0) * 30))
  const budget = input.funBudgetLei && input.funBudgetLei > 0 ? input.funBudgetLei : null
  let lei = DEFAULT_LEI_PER_POINT
  let source: PointValue['source'] = 'default'
  if (budget && usualMonthlyPoints >= 30) {
    lei = Math.min(MAX_LEI_PER_POINT, Math.max(MIN_LEI_PER_POINT, budget / usualMonthlyPoints))
    source = 'budget'
  }
  lei = Math.round(lei * 1000) / 1000
  return { leiPerPoint: lei, pointsPerLei: 1 / lei, funBudgetLei: budget, usualMonthlyPoints, source }
}

/** Points for a real price in lei (rounded to 5). */
export function pointsForLei(lei: number, v: PointValue): number {
  return Math.max(5, Math.round((lei * v.pointsPerLei) / 5) * 5)
}

/** Lei for a number of points (2 decimals). */
export function leiForPoints(points: number, v: PointValue): number {
  return Math.round(points * v.leiPerPoint * 100) / 100
}

/** "1 point ≈ 0.20 lei" */
export function pointValueLine(v: PointValue): string {
  return `1 point ≈ ${v.leiPerPoint.toFixed(2)} lei`
}
