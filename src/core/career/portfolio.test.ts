import { describe, expect, it } from 'vitest'
import { cleanPortfolio, fromLearn, makeProof, parseSkills, portfolioHtml, portfolioMarkdown, skillCounts, type Proof } from './portfolio'

const T = '2026-11-07'
const p = (over: Partial<Proof> & { title: string }): Proof => ({ ...makeProof({ kind: 'ctf', title: over.title }, T, over.title)!, ...over })

describe('portfolio log', () => {
  it('skills are split, trimmed and kept once', () => {
    expect(parseSkills('Rust, #crypto; rust\nBurp Suite , ')).toEqual(['Rust', 'crypto', 'Burp Suite'])
  })
  it('an entry needs a title; links must be http(s)', () => {
    expect(makeProof({ kind: 'lab', title: '  ' }, T, 'x')).toBeNull()
    expect(makeProof({ kind: 'lab', title: 'Firewall lab', link: 'javascript:alert(1)', skills: 'iptables, Linux' }, T, 'x')).toMatchObject({ link: null, skills: ['iptables', 'Linux'], pub: true })
  })
  it('counts skills across entries', () => {
    expect(skillCounts([p({ title: 'a', skills: ['Rust', 'Crypto'] }), p({ title: 'b', skills: ['rust'] })])).toEqual([
      { skill: 'Rust', n: 2 },
      { skill: 'Crypto', n: 1 }
    ])
  })
  it('suggests Cyber path entries that are not in the portfolio yet', () => {
    const learn = [
      { id: 'l1', track: 'ctf' as const, title: 'Practice CTF: format string', tag: 'pwn', link: null, day: T },
      { id: 'l2', track: 'rust' as const, title: 'Ch 4: Ownership', tag: '', link: null, day: T }
    ]
    const got = fromLearn(learn, [p({ title: 'Ch 4: ownership' })])
    expect(got).toEqual([{ kind: 'ctf', title: 'Practice CTF: format string', link: null, skills: ['CTF', 'pwn'], from: 'l1', day: T }])
  })
  it('markdown: sections by kind, newest first, private entries left out, markdown escaped', () => {
    const list = [
      p({ title: 'Heap *magic*', problem: 'A made-up heap challenge', did: 'Used tcache poisoning', skills: ['pwn'], link: 'https://example.com/w', day: '2026-10-02' }),
      p({ title: 'Secret one', pub: false }),
      p({ kind: 'crate', title: 'tiny-aes', did: 'A small AES crate', skills: ['Rust'], day: '2026-11-01' })
    ]
    const md = portfolioMarkdown(list, { title: 'My work' })
    expect(md).toContain('# My work')
    expect(md).toContain('## CTF writeups')
    expect(md).toContain('### Heap \\*magic\\* (Oct 2026)')
    expect(md).toContain('**What I did:** Used tcache poisoning')
    expect(md).toContain('[Link](https://example.com/w)')
    expect(md).not.toContain('Secret one')
    expect(md.indexOf('## CTF writeups')).toBeLessThan(md.indexOf('## Rust crates'))
  })
  it('the page is escaped and has no scripts', () => {
    const html = portfolioHtml([p({ title: '<script>x</script>', did: 'a & b' })])
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('a &amp; b')
    expect(html).not.toMatch(/<script/i)
  })
  it('cleans saved entries', () => {
    expect(cleanPortfolio([{ id: 'a', title: 't', day: T, kind: 'zzz', skills: ['x', 'x'] }, { id: 1 }])).toEqual([{ id: 'a', kind: 'other', title: 't', problem: '', did: '', skills: ['x'], link: null, day: T, pub: true }])
  })
})
