import { describe, expect, it } from 'vitest'
import { referenceBlocks, referenceRegions } from './references'
import type { PageBlock } from './regions'

let next = 0
/** A block in the left or right half of the page, or across it, on the given row. */
const block = (page: number, kind: 'paragraph' | 'other', text: string, column: 'left' | 'right' | 'full' = 'full', row = next): PageBlock => ({
  id: `b${next++}`,
  page,
  kind,
  text,
  column,
  index: next,
  x0: column === 'right' ? 55 : 0,
  y0: row * 10,
  x1: column === 'left' ? 45 : 100,
  y1: row * 10 + 8,
  lineCount: kind === 'paragraph' ? 2 : 1,
})

describe('referenceBlocks', () => {
  it('takes everything after the heading, across pages, up to an appendix', () => {
    const body = block(1, 'paragraph', 'We study attention. Earlier work (2015) used recurrence.')
    const heading = block(1, 'other', 'References')
    const first = block(1, 'paragraph', '[1] A. Author. A paper. NeurIPS, 2016.')
    const second = block(2, 'paragraph', '[2] B. Author. Another paper. ICML, 2017. Also 2018, 2019.')
    const appendix = block(2, 'other', 'A Proofs')
    const proof = block(2, 'paragraph', 'We now prove the lemma in full detail.')

    expect([...referenceBlocks([[body, heading, first], [second, appendix, proof]])]).toEqual([first.id, second.id])
  })

  it('stops at a later page that does not read like references', () => {
    const heading = block(1, 'other', '7. REFERENCES')
    const entry = block(1, 'paragraph', 'Author, A. (2019). A paper. Journal.')
    const caption = block(2, 'paragraph', 'Figure 5: attention heads following long-distance dependencies.')
    expect([...referenceBlocks([[heading, entry], [caption]])]).toEqual([entry.id])
  })

  it('finds nothing without a heading', () => {
    expect(referenceBlocks([[block(1, 'paragraph', 'References are discussed in 2019 work.')]]).size).toBe(0)
  })
})

describe('referenceRegions', () => {
  it('masks the list with one box when that hides nothing else', () => {
    const heading = block(1, 'other', 'References', 'full', 0)
    const entries = [block(1, 'paragraph', '[1] A. 2016.', 'full', 1), block(1, 'paragraph', '[2] B. 2017.', 'full', 2)]
    const regions = referenceRegions([heading, ...entries], new Set(entries.map((entry) => entry.id)))
    expect(regions).toMatchObject([{ page: 1, y0: 10, y1: 28, kind: 'detail', bullets: ['References'] }])
  })

  it('masks each column separately when the list starts partway down the first', () => {
    const body = block(1, 'paragraph', 'The last paragraph of the paper.', 'left', 0)
    const heading = block(1, 'other', 'References', 'left', 1)
    const left = block(1, 'paragraph', '[1] A. 2016.', 'left', 2)
    const right = block(1, 'paragraph', '[2] B. 2017.', 'right', 0)
    const regions = referenceRegions([body, heading, left, right], new Set([left.id, right.id]))
    expect(regions.map((region) => [region.x0, region.y0])).toEqual([[0, 20], [55, 0]])
  })
})
