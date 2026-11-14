import { describe, expect, it } from 'vitest'
import type { Block } from './blocks'
import { figureBox, type InkMask, isCaption } from './figures'

const WIDTH = 600
const HEIGHT = 800

function maskWith(...rects: [number, number, number, number][]): InkMask {
  const data = new Uint8Array(WIDTH * HEIGHT)
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) data.fill(1, y * WIDTH + x0, y * WIDTH + x1)
  return { data, width: WIDTH, height: HEIGHT, scale: 1 }
}

const block = (text: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<Block> = {}): Block => ({
  index: 0,
  kind: 'other',
  column: 'full',
  text,
  lineCount: 1,
  x0,
  y0,
  x1,
  y1,
  ...extra,
})

describe('isCaption', () => {
  it('recognises figure and table captions', () => {
    for (const text of ['Figure 1: The model', 'FIGURE 2 | Results', 'Fig. 3. Overview', 'Table 4: Scores', 'Supplementary Figure S2']) {
      expect(isCaption(block(text, 0, 0, 1, 1)), text).toBe(true)
    }
    expect(isCaption(block('Figures are shown below', 0, 0, 1, 1))).toBe(false)
  })
})

describe('figureBox', () => {
  const caption = block('Figure 1: A plot', 100, 400, 500, 420, { kind: 'paragraph' })
  const prose = block('Body text', 60, 80, 540, 180, { kind: 'paragraph' })
  const axisLabel = block('iterations', 250, 375, 350, 388)

  it('finds the drawing above the caption with its labels, but not the prose above', () => {
    // Text pixels are in the mask too, as on a real page.
    const mask = maskWith([150, 220, 450, 370], [60, 80, 540, 180], [250, 375, 350, 388], [100, 400, 500, 420])
    const box = figureBox(mask, [prose, axisLabel, caption], caption, WIDTH)!
    expect(box.y0).toBeCloseTo(217, 0)
    expect(box.y1).toBeCloseTo(391, 0)
    expect(box.x0).toBeCloseTo(147, 0)
    expect(box.x1).toBeGreaterThanOrEqual(450)
  })

  it('looks below the caption when nothing is drawn above (a table)', () => {
    const rows = [445, 470, 495].map((y) => block('0.91 0.87', 120, y, 480, y + 10))
    const cells = rows.map((row): [number, number, number, number] => [row.x0, row.y0, row.x1, row.y1])
    const mask = maskWith([100, 400, 500, 420], [100, 430, 500, 432], ...cells, [100, 520, 500, 522])
    const box = figureBox(mask, [caption, ...rows], caption, WIDTH)!
    expect(box.y0).toBeGreaterThan(420)
    expect(box.y1).toBeCloseTo(524, 0)
  })

  it('stays in the caption’s column and returns null when there is no drawing', () => {
    const left = block('Figure 2: left', 40, 400, 280, 420, { kind: 'paragraph', column: 'left' })
    const mask = maskWith([320, 200, 560, 380], [40, 400, 280, 420])
    expect(figureBox(mask, [left], left, WIDTH)).toBeNull()
  })
})
