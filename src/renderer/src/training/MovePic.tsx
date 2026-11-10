// A move's picture for Sport Track: the real photo from the classic tracker's
// library when there is one (public-domain Free Exercise DB frames, see
// apps/sport/photos/NOTICE.md; the end frame shows on hover), else the drawn
// library figure of the move, else the drawn figure of its chain's first move
// (moves like Archer push-ups have no photo yet). Decorative: the name is
// always written next to it.
import { moveInfo, DEFAULT_LADDERS } from '@core/trainLadders'
import { FigureSvg } from '../DrillFigure'

/** Moves with two photo frames in /apps/sport/photos (<id>-0.webp start, <id>-1.webp end). */
const PHOTOS = new Set([
  'arm_circles', 'box_pistol', 'cat_cow', 'chair_dip', 'childs_pose', 'crunch', 'dead_bug', 'decline_pushup', 'diamond_pushup', 'glute_bridge', 'incline_pushup', 'jump_lunge', 'leg_raise', 'lunge', 'mountain_climber', 'plank', 'pushup', 'side_plank', 'single_leg_bridge', 'situp', 'split_squat', 'squat', 'star_jump', 'superman', 'table_row', 'v_up', 'wide_pushup', 'worlds_greatest'
])

export const hasPhoto = (move: string) => PHOTOS.has(move)

/** The figure to draw for a move without a photo: its own, else the first move of its chain that has one. */
function figureOf(move: string) {
  const own = moveInfo(move)?.lib?.anim
  if (own) return own
  const ladder = DEFAULT_LADDERS.find((l) => l.levels.some((v) => v.move === move))
  for (const v of ladder?.levels ?? []) {
    const a = moveInfo(v.move)?.lib?.anim
    if (a) return a
  }
  return null
}

export function MovePic({ move, size = 'md', className = '' }: { move: string; size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  if (PHOTOS.has(move))
    return (
      <span className={`sp-pic photo ${size} ${className}`} aria-hidden="true">
        <img src={`/apps/sport/photos/${move}-0.webp`} alt="" loading="lazy" draggable={false} />
        <img className="end" src={`/apps/sport/photos/${move}-1.webp`} alt="" loading="lazy" draggable={false} />
      </span>
    )
  const anim = figureOf(move)
  return (
    <span className={`sp-pic drawn ${size} ${className}`} aria-hidden="true">
      {anim ? <FigureSvg anim={anim} size={size === 'sm' ? 34 : size === 'md' ? 48 : size === 'lg' ? 90 : 120} /> : null}
    </span>
  )
}
