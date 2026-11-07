// Real photos for the exercise demos: two frames (start and end) per move,
// from the Free Exercise DB (github.com/yuhonas/free-exercise-db), which is
// released into the public domain under the Unlicense (see
// src/renderer/public/apps/sport/photos/NOTICE.md). The frames are bundled
// with the app (apps/sport/photos/<move>-0.webp and -1.webp, 480 × 384),
// made by scripts/sport-photos.mjs from the crops below. Moves without a good
// photo are drawn instead (sportDraw.ts). No imports: the script reads this
// file with Node's type stripping.

export interface MovePhoto {
  /** The exercise folder in the Free Exercise DB. */
  src: string
  /** The crop of the original frame, as fractions: left, top, width (height follows the 5:4 shape). */
  crop: [number, number, number]
  /** Mirror it so the person faces the same way as in the other frames. */
  flip?: boolean
}

/** Width and height of a bundled frame. */
export const PHOTO_W = 480
export const PHOTO_H = 384

export const PHOTOS: Record<string, MovePhoto> = {
  incline_pushup: { src: 'Incline_Push-Up', crop: [0.2, 0.2, 0.66] },
  pushup: { src: 'Pushups', crop: [0.17, 0.08, 0.8] },
  wide_pushup: { src: 'Push-Up_Wide', crop: [0, 0.3, 1] },
  diamond_pushup: { src: 'Push-Ups_-_Close_Triceps_Position', crop: [0.03, 0.05, 0.8] },
  decline_pushup: { src: 'Push-Ups_With_Feet_Elevated', crop: [0.16, 0.0, 0.82] },
  chair_dip: { src: 'Bench_Dips', crop: [0.22, 0.0, 0.76] },
  table_row: { src: 'Inverted_Row', crop: [0.1, 0.0, 0.83] },
  superman: { src: 'Superman', crop: [0.1, 0.12, 0.8] },
  crunch: { src: 'Crunches', crop: [0.27, 0.27, 0.6] },
  situp: { src: 'Sit-Up', crop: [0.12, 0.03, 0.8] },
  leg_raise: { src: 'Flat_Bench_Lying_Leg_Raise', crop: [0.2, 0.08, 0.72] },
  v_up: { src: 'Jackknife_Sit-Up', crop: [0.18, 0.06, 0.78] },
  dead_bug: { src: 'Dead_Bug', crop: [0.1, 0.0, 0.83] },
  plank: { src: 'Plank', crop: [0.2, 0.08, 0.76] },
  side_plank: { src: 'Side_Bridge', crop: [0.06, 0.04, 0.8] },
  squat: { src: 'Bodyweight_Squat', crop: [0.11, 0.03, 0.78] },
  split_squat: { src: 'Split_Squats', crop: [0.12, 0.02, 0.8] },
  lunge: { src: 'Bodyweight_Walking_Lunge', crop: [0.0, 0.16, 0.7] },
  jump_lunge: { src: 'Split_Jump', crop: [0.13, 0.06, 0.76] },
  glute_bridge: { src: 'Butt_Lift_Bridge', crop: [0.1, 0.04, 0.82] },
  single_leg_bridge: { src: 'Single_Leg_Glute_Bridge', crop: [0.08, 0.0, 0.82] },
  star_jump: { src: 'Star_Jump', crop: [0.12, 0.0, 0.8] },
  mountain_climber: { src: 'Mountain_Climbers', crop: [0.06, 0.0, 0.83] },
  cat_cow: { src: 'Cat_Stretch', crop: [0.04, 0.02, 0.82] },
  worlds_greatest: { src: 'Worlds_Greatest_Stretch', crop: [0.15, 0.02, 0.8] },
  arm_circles: { src: 'Arm_Circles', crop: [0.1, 0.02, 0.8] },
  childs_pose: { src: 'Childs_Pose', crop: [0.18, 0.1, 0.78] }
}

export const PHOTO_SOURCE = {
  name: 'Free Exercise DB',
  url: 'https://github.com/yuhonas/free-exercise-db',
  license: 'The Unlicense (public domain)'
}

/** The two frames of a move's photo demo (paths next to the Sport Track page), or null when it is drawn. */
export function photoOf(moveId: string | null | undefined): { start: string; end: string } | null {
  if (!moveId || !Object.prototype.hasOwnProperty.call(PHOTOS, moveId)) return null
  return { start: `photos/${moveId}-0.webp`, end: `photos/${moveId}-1.webp` }
}
