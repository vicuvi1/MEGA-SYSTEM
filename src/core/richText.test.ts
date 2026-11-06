import { describe, expect, it } from 'vitest'
import { parseInline, parseRich, plainRich } from './richText'

describe('rich text', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('Do **the report** first, *then* `/water 500`.')).toEqual([
      { k: 'text', s: 'Do ' },
      { k: 'b', s: 'the report' },
      { k: 'text', s: ' first, ' },
      { k: 'i', s: 'then' },
      { k: 'text', s: ' ' },
      { k: 'code', s: '/water 500' },
      { k: 'text', s: '.' }
    ])
  })

  it('leaves lone stars, maths and snake_case alone', () => {
    expect(parseInline('2 * 3 = 6 and 4 * 5')).toEqual([{ k: 'text', s: '2 * 3 = 6 and 4 * 5' }])
    expect(parseInline('the file my_notes_v2.txt')).toEqual([{ k: 'text', s: 'the file my_notes_v2.txt' }])
  })

  it('makes paragraphs and lists', () => {
    const b = parseRich('Your day:\nfocus first.\n\n- App dev 2h\n- Gym\n1. Read\n2. Sleep by 23:30\nThat is it.')
    expect(b.map((x) => x.k)).toEqual(['p', 'ul', 'ol', 'p'])
    expect(b[0]).toEqual({ k: 'p', lines: [[{ k: 'text', s: 'Your day:' }], [{ k: 'text', s: 'focus first.' }]] })
    expect((b[1] as any).items).toHaveLength(2)
    expect((b[2] as any).start).toBe(1)
  })

  it('a list right after a line still becomes a list', () => {
    expect(parseRich('Must-dos\n• one\n• two').map((x) => x.k)).toEqual(['p', 'ul'])
  })

  it('strips the marks for plain text', () => {
    expect(plainRich('**Bold** and `code` and __this__')).toBe('Bold and code and this')
  })
})
