// LT13: one place for the app's defaults. Import these instead of typing the
// number again, so a change (a bigger water goal, a later day start) is one
// edit and every page, Ben and the server agree.

/** The app day starts at 04:00 local time: 01:30 still belongs to the evening before. */
export const DAY_START_HOUR = 4

/** Your time zone when none is set (LIFE_TZ on the server). */
export const DEFAULT_TZ = 'Europe/Chisinau'

/** Daily water goal (ml) when Sport Track has none saved. */
export const WATER_TARGET_ML = 2700
/** One glass (ml): the "+250" buttons and "a glass now". */
export const WATER_GLASS_ML = 250
/**
 * The most one water log may add or take back (ml). One value everywhere
 * (chat, Ben's actions, the desk card, deep links, AI apps): 3 litres covers a
 * big bottle or fixing a typo, and stops "water 25000" from counting.
 */
export const WATER_MAX_ML = 3000

/** Ben writes first at most this many times a day; the rest wait in the bell (W21). */
export const BEN_DAILY_MESSAGES = 15
