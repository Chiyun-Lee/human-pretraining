import { describe, expect, it } from 'vitest'
import { mergeLineRects } from './annotations'

describe('mergeLineRects', () => {
  it('joins the pieces of each line and keeps lines apart', () => {
    const merged = mergeLineRects([
      { x0: 100, y0: 50, x1: 140, y1: 60 },
      { x0: 141, y0: 50.5, x1: 200, y1: 60 },
      { x0: 50, y0: 62, x1: 180, y1: 72 },
      { x0: 60, y0: 62, x1: 60.1, y1: 72 },
    ])
    expect(merged).toEqual([
      { x0: 100, y0: 50, x1: 200, y1: 60 },
      { x0: 50, y0: 62, x1: 180, y1: 72 },
    ])
  })

  it('does not join a selection across the gutter between columns', () => {
    const merged = mergeLineRects([
      { x0: 50, y0: 50, x1: 280, y1: 60 },
      { x0: 310, y0: 50, x1: 540, y1: 60 },
    ])
    expect(merged).toHaveLength(2)
  })
})
