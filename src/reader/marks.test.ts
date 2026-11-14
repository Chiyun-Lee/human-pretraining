import { describe, expect, it } from 'vitest'
import type { Reference } from '../library/bibliography'
import type { TextBox } from '../pdf/blocks'
import { citedNumbers, findCitations, findTerms, splitTerms } from './marks'

const line = (str: string, baseline = 100): TextBox => ({ str, x: 0, baseline, width: str.length * 5, size: 10, font: 'f' })
const ref = (author: string, year: number, title: string): Reference => ({ doi: null, title, author, year, venue: null, text: null })
const refs = [ref('Bahdanau', 2014, 'Alignment'), ref('Vaswani A', 2017, 'Attention'), ref('He', 2016, 'ResNet'), ref('He', 2016, 'Identity')]

describe('citations', () => {
  it('reads lists and ranges of numbers', () => {
    expect(citedNumbers('3, 5–7')).toEqual([3, 5, 6, 7])
    expect(citedNumbers('12')).toEqual([12])
  })

  it('maps numbered markers to the reference list, skipping the list itself', () => {
    const marks = findCitations([line('as shown before [1, 2] and [9].'), line('[2] A. Vaswani. Attention.', 200)], refs)
    expect(marks.map((m) => m.refs.map((r) => r.title))).toEqual([['Alignment', 'Attention']])
  })

  it('maps author-year markers when exactly one reference fits', () => {
    const marks = findCitations([line('Following Vaswani et al. (2017) and (Bahdanau and Cho, 2014), unlike He et al., 2016.')], refs)
    expect(marks.map((m) => m.refs[0]!.title)).toEqual(['Attention', 'Alignment'])
  })
})

describe('terms', () => {
  const terms = [
    { term: 'self-attention', meaning: 'a' },
    { term: 'BLEU', meaning: 'b' },
    { term: 'attention', meaning: 'c' },
  ]

  it('marks the first whole-word use of each term on a page', () => {
    const marks = findTerms([line('Self-attention is attention; inattention is not. bleu and BLEU. attention again.')], terms)
    expect(marks.map((m) => m.term.term)).toEqual(['self-attention', 'attention', 'BLEU'])
  })

  it('splits a note around its terms', () => {
    expect(splitTerms('Reaches 28.4 BLEU with attention.', terms)).toEqual([
      'Reaches 28.4 ',
      { text: 'BLEU', term: terms[1] },
      ' with ',
      { text: 'attention', term: terms[2] },
      '.',
    ])
  })
})
