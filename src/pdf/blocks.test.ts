import { describe, expect, it } from 'vitest'
import { buildLines, detectBlocks as detect, type TextBox } from './blocks'

const PAGE_WIDTH = 612
const detectBlocks = (items: TextBox[]) => detect(items, PAGE_WIDTH)
const SIZE = 10
const LEADING = 12
const sentence = 'The quick brown fox jumps over the lazy dog near the river bank.'

/** One text fragment per line, like a typical LaTeX PDF. */
function paragraph(x: number, top: number, lines: number, width = 230, opts: { indent?: number; font?: string } = {}): TextBox[] {
  return Array.from({ length: lines }, (_, i) => ({
    str: sentence,
    x: x + (i === 0 ? (opts.indent ?? 0) : 0),
    baseline: top + i * LEADING,
    width: width - (i === 0 ? (opts.indent ?? 0) : 0),
    size: SIZE,
    font: opts.font ?? 'body',
  }))
}

describe('detectBlocks', () => {
  it('keeps two columns apart', () => {
    const blocks = detectBlocks([...paragraph(50, 100, 5), ...paragraph(310, 100, 5)])
    expect(blocks.map((b) => [b.kind, b.lineCount, Math.round(b.x0)])).toEqual([
      ['paragraph', 5, 50],
      ['paragraph', 5, 310],
    ])
  })

  it('starts a new paragraph at an indented line', () => {
    const first = paragraph(50, 100, 4, 230, { indent: 12 })
    const second = paragraph(50, 100 + 4 * LEADING, 4, 230, { indent: 12 })
    expect(detectBlocks([...first, ...second]).map((b) => b.lineCount)).toEqual([4, 4])
  })

  it('starts a new paragraph after extra vertical space', () => {
    const blocks = detectBlocks([...paragraph(50, 100, 4), ...paragraph(50, 100 + 4 * LEADING + 6, 4)])
    expect(blocks.map((b) => b.lineCount)).toEqual([4, 4])
  })

  it('does not attach a heading to the paragraph below it', () => {
    const heading: TextBox = { str: 'Introduction', x: 50, baseline: 88, width: 70, size: SIZE, font: 'bold' }
    const blocks = detectBlocks([heading, ...paragraph(50, 100, 4)])
    expect(blocks.map((b) => [b.kind, b.lineCount])).toEqual([
      ['other', 1],
      ['paragraph', 4],
    ])
  })

  it('joins words hyphenated across lines', () => {
    const items = paragraph(50, 100, 3)
    items[0]!.str = 'Residual learning makes optimi-'
    items[1]!.str = 'sation easier.'
    expect(detectBlocks(items)[0]!.text).toContain('optimisation easier.')
  })
})

describe('paragraph tails', () => {
  it('treats a body-type line at the top of a column as prose, but not a heading', () => {
    const tail: TextBox = { str: 'greatly benefited from very deep models.', x: 310, baseline: 80, width: 170, size: SIZE, font: 'body' }
    const heading: TextBox = { str: 'A fairly long section heading goes here', x: 50, baseline: 80, width: 170, size: SIZE, font: 'bold' }
    const blocks = detectBlocks([tail, heading, ...paragraph(50, 100, 5), ...paragraph(310, 100, 5, 230, { indent: 12 })])
    expect(blocks.map((b) => [b.column, b.lineCount, b.kind])).toEqual([
      ['left', 1, 'other'],
      ['left', 5, 'paragraph'],
      ['right', 1, 'paragraph'],
      ['right', 5, 'paragraph'],
    ])
  })
})

describe('unjustified text', () => {
  it('keeps a flush-right margin note together', () => {
    const note = ['Edited by:', 'Rinku Sharma,', 'Harvard Medical School,', 'United States'].map((str, i) => {
      const width = 30 + ((i * 37) % 60)
      return { str, x: 160 - width, baseline: 100 + i * LEADING, width, size: SIZE, font: 'italic' }
    })
    const blocks = detectBlocks([...note, ...paragraph(180, 100, 6, 370)])
    expect(blocks.map((b) => b.lineCount).sort()).toEqual([4, 6])
  })

  it('keeps a caption whose first line is the shortest in one block', () => {
    const caption = paragraph(50, 100, 5, 480)
    caption[0]!.width = 460
    expect(detectBlocks(caption).map((b) => b.lineCount)).toEqual([5])
  })
})

describe('reading order', () => {
  it('reads the left column before the right, below a full-width block', () => {
    const title = paragraph(50, 60, 3, 500)
    const left = [...paragraph(50, 120, 4), ...paragraph(50, 120 + 4 * LEADING + 8, 4)]
    const right = paragraph(310, 120, 4)
    const blocks = detectBlocks([...right, ...left, ...title])
    expect(blocks.map((b) => [b.column, Math.round(b.y0)])).toEqual([
      ['full', 52],
      ['left', 112],
      ['left', 168],
      ['right', 112],
    ])
  })
})

describe('buildLines', () => {
  it('rejoins a justified line with one very wide word gap', () => {
    const items = paragraph(50, 100, 3)
    // Middle line split into two fragments 15 units apart (wider than the font size).
    items[1] = { ...items[1]!, str: 'degrades rapidly.', width: 150 }
    items.push({ str: 'Unexpectedly,', x: 50 + 150 + 15, baseline: 100 + LEADING, width: 65, size: SIZE, font: 'body' })
    const lines = buildLines(items)
    expect(lines).toHaveLength(3)
    expect(lines[1]!.text).toBe('degrades rapidly. Unexpectedly,')
  })

  it('does not join text across a column gutter', () => {
    const lines = buildLines([...paragraph(50, 100, 3), ...paragraph(298, 100, 3)])
    expect(lines).toHaveLength(6)
  })
})

describe('maths', () => {
  const box = (str: string, x: number, baseline: number, width: number, size = SIZE): TextBox => ({ str, x, baseline, width, size, font: 'body' })

  it('keeps a line whole when a summation sign sits on a higher baseline inside it', () => {
    const lines = paragraph(108, 100, 4, 396)
    // The third line: words, a tall operator with its limit, then more words.
    lines[2] = box('recover y from the sequence alone: L =', 108, 124, 210)
    const operator = [box('P', 322, 116.5, 10), box('n', 332, 127, 5, 7), box('(h(x) − y), where n indexes the samples', 338, 124, 166)]
    const blocks = detectBlocks([...lines, ...operator])
    expect(blocks.map((b) => [b.kind, b.lineCount])).toEqual([['paragraph', 4]])
    expect(blocks[0]!.text).toContain('alone: L = Pn(h(x) − y), where n indexes')
  })

  it('does not let an operator between two lines chain them into one', () => {
    const lines = paragraph(108, 100, 3, 396)
    const blocks = detectBlocks([...lines, box('P', 300, 115.6, 10)])
    expect(blocks.map((b) => b.lineCount)).toEqual([3])
  })

  it('joins the pieces of a displayed equation into one block that keeps clear of the prose', () => {
    const above = paragraph(108, 100, 3, 396)
    const below = paragraph(108, 190, 3, 396)
    const equation = [
      box('L =', 173, 150, 17),
      box('Lsta', 200, 153, 18),
      box('+ λ Linv + λ Lreg.', 229, 153, 210),
      box('Sufficiency', 193, 166, 32, 7),
      box('(6)', 493, 150, 12),
    ]
    const blocks = detectBlocks([...above, ...equation, ...below])
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'other', 'paragraph'])
    expect(blocks[1]!.pieces!.length).toBeGreaterThan(1)
    expect(blocks[1]!.text).toContain('(6)')
    expect(blocks[1]!.y0).toBeGreaterThanOrEqual(blocks[0]!.y1)
    expect(blocks[1]!.y1).toBeLessThanOrEqual(blocks[2]!.y0)
  })

  it('does not put a short centred block in a column of its own on a one-column page', () => {
    const blocks = detectBlocks([...paragraph(108, 100, 4, 396), box('x = y + z', 380, 170, 60), ...paragraph(108, 200, 4, 396)])
    expect(blocks.map((b) => b.column)).toEqual(['full', 'full', 'full'])
  })

  it('still keeps the columns of a two-column page', () => {
    const blocks = detectBlocks([...paragraph(50, 100, 5), box('x = y', 120, 180, 40), ...paragraph(310, 100, 5), box('a = b', 400, 180, 40)])
    expect(blocks.map((b) => [b.kind, b.column])).toEqual([
      ['paragraph', 'left'],
      ['other', 'left'],
      ['paragraph', 'right'],
      ['other', 'right'],
    ])
  })
})
