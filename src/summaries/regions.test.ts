import { describe, expect, it } from 'vitest'
import { buildRegions, type PageBlock, type SummaryGroup, uncovered } from './regions'

const block = (id: string, y0: number, extra: Partial<PageBlock> = {}): PageBlock => ({
  id,
  page: 1,
  index: 0,
  kind: 'paragraph',
  column: 'left',
  x0: 50,
  x1: 280,
  y0,
  y1: y0 + 40,
  text: '',
  lineCount: 4,
  ...extra,
})

const blocks = [
  block('a', 100),
  block('eq', 145, { kind: 'other', y1: 160, x0: 120, x1: 200 }),
  block('b', 165),
  block('heading', 215, { kind: 'other', y1: 228 }),
  block('c', 235),
  block('r', 100, { column: 'right', x0: 310, x1: 540 }),
]

const group = (ids: string[], bullet: string, extra: Partial<SummaryGroup> = {}): SummaryGroup => ({
  blocks: ids,
  kind: 'summary',
  bullets: [bullet],
  caveat: '',
  ...extra,
})

describe('detail regions', () => {
  it('may mask non-prose blocks, keep one label and carry no caveat', () => {
    const { regions, dropped } = buildRegions(
      [group(['heading'], 'References', { kind: 'detail', bullets: ['References', 'extra'], caveat: 'ignored' })],
      blocks,
    )
    expect(dropped).toBe(0)
    expect(regions[0]).toMatchObject({ kind: 'detail', bullets: ['References'], caveat: null })
  })
})

describe('peripheral figures', () => {
  const caption = block('cap', 400, { text: 'Figure 2: variants' })
  const picture = { x0: 60, y0: 300, x1: 270, y1: 395 }
  const pictures = new Map([['cap', picture]])

  it('masks the picture together with the caption', () => {
    const { regions } = buildRegions([group(['cap'], 'Figure 2: variants', { kind: 'detail' })], [...blocks, caption], new Set(), pictures)
    expect(regions[0]).toMatchObject({ kind: 'detail', y0: 300, y1: 440 })
  })

  it('leaves the picture alone for a figure note, or when masking it would hide prose', () => {
    const note = buildRegions([group(['cap'], 'Fig. 2: look here', { kind: 'figure' })], [...blocks, caption], new Set(), pictures)
    expect(note.regions[0]).toMatchObject({ kind: 'figure', y0: 400 })
    const overProse = new Map([['cap', { ...picture, y0: 240 }]])
    const masked = buildRegions([group(['cap'], 'Figure 2', { kind: 'detail' })], [...blocks, caption], new Set(), overProse)
    expect(masked.regions[0]).toMatchObject({ y0: 400 })
  })
})

describe('buildRegions', () => {
  it('covers a paragraph, the equation inside it and the continuation with one box', () => {
    const { regions, dropped } = buildRegions([group(['a', 'eq', 'b'], 'One idea.', { caveat: ' One dataset. ' })], blocks)
    expect(dropped).toBe(0)
    expect(regions).toEqual([
      { page: 1, x0: 50, y0: 100, x1: 280, y1: 205, kind: 'summary', bullets: ['One idea.'], caveat: 'One dataset.', sources: null },
    ])
  })

  it('drops a group whose box would hide a block it does not list', () => {
    const { regions, dropped } = buildRegions([group(['b', 'c'], 'Spans a heading.')], blocks)
    expect(regions).toEqual([])
    expect(dropped).toBe(1)
  })

  it('splits a paragraph that runs into the next column, with the note in the larger part', () => {
    const { regions, dropped } = buildRegions([group(['c', 'r'], 'Across columns.')], [...blocks, block('r2', 150, { column: 'right', x0: 310, x1: 540, y1: 300 })])
    expect(dropped).toBe(0)
    expect(regions.map((r) => [r.x0, r.kind, r.bullets[0]])).toEqual([
      [50, 'summary', 'Across columns.'],
      [310, 'detail', '← Continued'],
    ])
  })

  it('drops groups that reuse a block, name unknown blocks or have no text, and reports what is left', () => {
    const used = new Set<string>()
    const { regions, dropped } = buildRegions(
      [
        group(['c'], 'Fine.'),
        group(['c'], 'Used twice.'),
        group(['nope'], 'Unknown.'),
        group(['r'], '  '),
        group(['heading'], 'Not prose.'),
      ],
      blocks,
      used,
    )
    expect(regions.map((r) => r.bullets[0])).toEqual(['Fine.'])
    expect(dropped).toBe(4)
    expect(uncovered(blocks, used).map((b) => b.id)).toEqual(['a', 'b', 'r'])
  })
})

describe('pieces in different columns', () => {
  it('draws one box when an equation piece labelled as another column sits inside the paragraph', () => {
    const wide = { column: 'full' as const, x0: 50, x1: 540 }
    const page = [block('p1', 100, wide), block('frag', 145, { kind: 'other', column: 'right', x0: 400, x1: 540, y1: 160 }), block('p2', 150, wide)]
    const { regions } = buildRegions([group(['p1', 'frag', 'p2'], 'One point.')], page)
    expect(regions).toMatchObject([{ kind: 'summary', x0: 50, y0: 100, x1: 540, y1: 190, bullets: ['One point.'] }])
  })

  it('still points across when a paragraph really continues in the next column', () => {
    const { regions } = buildRegions([group(['c', 'r'], 'One point.')], blocks)
    expect(regions.map((region) => region.kind)).toEqual(['summary', 'detail'])
  })
})
