import { createElement as h, Fragment } from 'react'
import { describe, expect, it } from 'vitest'
import { readOptions, typeAhead } from './Select'

describe('Select', () => {
  it('reads options, groups, fragments and disabled ones from the children', () => {
    const opts = readOptions([
      h('option', { key: 'a', value: 'top' }, 'Top center'),
      h(Fragment, { key: 'f' }, h('option', { value: 2 }, 'Two'), false, null),
      h('optgroup', { key: 'g', label: 'Docked' }, h('option', { value: 'dl' }, 'Docked left'), h('option', { value: 'dr', disabled: true }, 'Docked right'))
    ])
    expect(opts.map((o) => [o.value, o.text, o.disabled, o.group])).toEqual([
      ['top', 'Top center', false, undefined],
      ['2', 'Two', false, undefined],
      ['dl', 'Docked left', false, 'Docked'],
      ['dr', 'Docked right', true, 'Docked']
    ])
  })
  it('type-ahead jumps to the matching option, cycles on the same letter and skips disabled ones', () => {
    const opts = ['Top left', 'Top center', 'Top right', 'Docked left', 'Docked right', 'Floating'].map((text, i) => ({ text, disabled: i === 4 }))
    expect(typeAhead(opts, 'd', 0)).toBe(3)
    expect(typeAhead(opts, 'f', 0)).toBe(5)
    expect(typeAhead(opts, 't', 0)).toBe(1)
    expect(typeAhead(opts, 'tt', 1)).toBe(2)
    expect(typeAhead(opts, 'top r', -1)).toBe(2)
    expect(typeAhead(opts, 'docked r', 0)).toBe(-1)
    expect(typeAhead(opts, 'x', 0)).toBe(-1)
  })
})
