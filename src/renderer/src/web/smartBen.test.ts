import { describe, expect, it } from 'vitest'
import { readAction } from './botBrain'
import { dayLogLine } from './dayLog'

describe('Ben and the Smart island', () => {
  it('SI24: a RECIPE: line becomes a recipe card, saved off, safe actions only', () => {
    const a = readAction('RECIPE: {"name":"Coding mornings","when":{"on":"context","ctx":"coding"},"if":{"days":[1,2,3,4,5],"from":"09:00","to":"12:00"},"then":[{"do":"focus","subject":"Coding","minutes":50},{"do":"shell","cmd":"rm -rf"}],"on":true}')
    expect(a?.kind).toBe('recipe')
    if (a?.kind !== 'recipe') return
    expect(a.recipe.on).toBe(false)
    expect(a.recipe.byBen).toBe(true)
    expect(a.recipe.then).toEqual([{ do: 'focus', subject: 'Coding', minutes: 50 }])
    expect(readAction('RECIPE: {"when":{"on":"context","ctx":"coding"},"then":[{"do":"shell"}]}')).toBeNull()
  })
  it('SI8: the day by activity goes into the evening review line', () => {
    expect(dayLogLine({ focus: [], blocks: [], doing: 'coding 3h10, study 1h05, video 55m' })).toBe('His day on the PC by activity: coding 3h10, study 1h05, video 55m')
  })
})
