import { describe, expect, it } from 'vitest'
import type { TextBox } from './blocks'
import { findInBoxes, locateQuote } from './locate'

const line = (str: string, baseline: number, x = 100): TextBox => ({ str, x, baseline, width: str.length * 5, size: 10, font: 'f' })
const page = [
  line('Recurrent models are slow to train. We propose the Trans-', 100),
  line('former, a model based solely on attention mecha-', 112),
  line('nisms [3, 12]. It reaches 28.4 BLEU on WMT 2014.', 124),
]

describe('locateQuote', () => {
  it('finds a sentence that runs over hyphenated line breaks', () => {
    const rects = locateQuote(page, 'We propose the Transformer, a model based solely on attention mechanisms [3, 12].')
    expect(rects).toHaveLength(3)
    // Starts after the first sentence on line one, and ends before "It reaches" on line three.
    expect(rects[0]!.x0).toBeCloseTo(100 + 36 * 5)
    expect(rects[1]).toMatchObject({ x0: 100, x1: 100 + 47 * 5 })
    expect(rects[2]!.x1).toBeLessThan(100 + 16 * 5)
    expect(rects[0]!.y0).toBeLessThan(100)
  })

  it('tolerates changed punctuation and a paraphrased middle', () => {
    expect(locateQuote(page, 'we propose the transformer — a model based solely on attention mechanisms')).toHaveLength(3)
    expect(locateQuote(page, 'We propose the Transformer, a model that is based only on attention mechanisms [3, 12]')).toHaveLength(3)
  })

  it('returns nothing for text that is not there, or too short to place', () => {
    expect(locateQuote(page, 'Convolutional networks are faster than recurrent ones.')).toEqual([])
    expect(locateQuote(page, 'attention')).toEqual([])
  })
})

describe('findInBoxes', () => {
  it('gives each match with its place in the line', () => {
    const found = findInBoxes(page, /\[(\d+(?:,\s*\d+)*)\]/g)
    expect(found).toHaveLength(1)
    expect(found[0]!.match[1]).toBe('3, 12')
    expect(found[0]!.box.x0).toBeCloseTo(100 + 6 * 5)
  })
})
