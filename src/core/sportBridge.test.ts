import { describe, expect, it } from 'vitest'
import { validateWorkout } from '@core/body'
import { sportItems } from '@core/sportBridge'

describe('Sport Track → Body', () => {
  it('a routine becomes real exercise items that Body accepts', () => {
    const items = sportItems({ title: 'Daily routine: 30 Push-ups', items: [{ exerciseId: 'ex_push', name: 'Push-ups', unit: 'reps', amount: 30 }, { name: '', amount: 5 }] })
    expect(items).toEqual([{ exerciseId: 'ex_push', name: 'Push-ups', unit: 'reps', amount: 30 }])
    expect(validateWorkout({ title: 'Daily routine', items })).toBeNull()
  })
  it('an old record without items still counts as one session', () => {
    const items = sportItems({ title: 'Running', amount: '5 km' })
    expect(items).toEqual([{ exerciseId: 'sport_session', name: 'Running', unit: 'km', amount: 5 }])
    expect(validateWorkout({ title: 'Running', items })).toBeNull()
  })
})
