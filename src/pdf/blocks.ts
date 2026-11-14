// Groups positioned text fragments from one PDF page into lines and then into
// paragraph-like blocks. Pure geometry: no PDF.js or DOM dependency, so it runs
// the same in the browser, in tests and in Node.
//
// Coordinates are top-down page units (PDF points at scale 1).

export interface TextBox {
  str: string
  /** Left edge. */
  x: number
  /** Baseline, measured from the top of the page. */
  baseline: number
  width: number
  /** Font size in page units. */
  size: number
  font: string
}

export interface Line {
  x0: number
  x1: number
  baseline: number
  size: number
  font: string
  text: string
}

export type BlockKind = 'paragraph' | 'other'

export type Column = 'left' | 'right' | 'full'

export interface Block {
  /** Index within the page, in reading order. */
  index: number
  kind: BlockKind
  column: Column
  x0: number
  y0: number
  x1: number
  y1: number
  text: string
  lineCount: number
}

const ASCENT = 0.8
const DESCENT = 0.25

/** Value with the largest total weight. */
function weightedMode<T>(pairs: Iterable<[T, number]>): T | undefined {
  const totals = new Map<T, number>()
  for (const [value, weight] of pairs) totals.set(value, (totals.get(value) ?? 0) + weight)
  let best: T | undefined
  let bestWeight = -Infinity
  for (const [value, weight] of totals) {
    if (weight > bestWeight) {
      best = value
      bestWeight = weight
    }
  }
  return best
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step

/**
 * Justified text can leave a word gap wider than the same-line limit, which
 * splits one line in two. Rejoin such pieces when a neighbouring line runs
 * straight across the gap, which shows it is not a column gutter.
 */
function mergeStretchedLines(groups: TextBox[][]): TextBox[][] {
  const extent = (group: TextBox[]) => ({
    x0: Math.min(...group.map((b) => b.x)),
    x1: Math.max(...group.map((b) => b.x + b.width)),
    baseline: group.reduce((sum, b) => sum + b.baseline, 0) / group.length,
    size: Math.max(...group.map((b) => b.size)),
  })
  let extents = groups.map(extent)

  for (let merged = true; merged; ) {
    merged = false
    search: for (let i = 0; i < groups.length; i++) {
      for (let j = 0; j < groups.length; j++) {
        if (i === j) continue
        const a = extents[i]!
        const b = extents[j]!
        const size = Math.max(a.size, b.size)
        if (Math.abs(a.baseline - b.baseline) > 0.45 * size) continue
        const gap = b.x0 - a.x1
        if (gap <= 0 || gap > 3 * size) continue
        const bridged = extents.some(
          (c) =>
            Math.abs(c.baseline - a.baseline) > 0.5 * size &&
            Math.abs(c.baseline - a.baseline) < 2.5 * size &&
            c.x0 < a.x1 - size &&
            c.x1 > b.x0 + size,
        )
        if (!bridged) continue
        groups[i] = [...groups[i]!, ...groups[j]!]
        groups.splice(j, 1)
        extents = groups.map(extent)
        merged = true
        break search
      }
    }
  }
  return groups
}

export function buildLines(items: TextBox[]): Line[] {
  const boxes = items.filter((item) => item.str.trim() !== '' && item.size > 0)
  boxes.sort((a, b) => a.baseline - b.baseline)

  // Union fragments that share a baseline and sit close together horizontally.
  // The horizontal limit is what keeps the two columns of a page apart.
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }

  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i]!
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j]!
      const size = Math.max(a.size, b.size)
      if (b.baseline - a.baseline > 0.45 * size) {
        // Sorted by baseline, so only a much larger later fragment could still match.
        if (b.baseline - a.baseline > 0.45 * 40) break
        continue
      }
      const gap = Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)
      if (gap <= size) parent[find(i)] = find(j)
    }
  }

  const grouped = new Map<number, TextBox[]>()
  boxes.forEach((box, i) => {
    const root = find(i)
    const group = grouped.get(root)
    if (group) group.push(box)
    else grouped.set(root, [box])
  })

  const groups = mergeStretchedLines([...grouped.values()])

  const lines: Line[] = []
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x)
    const size = weightedMode(group.map((b) => [roundTo(b.size, 0.1), b.str.length] as [number, number]))!
    const font = weightedMode(group.map((b) => [b.font, b.str.length] as [string, number]))!
    // Baseline of the dominant-size fragments, so super/subscripts do not shift the line.
    const main = group.filter((b) => Math.abs(b.size - size) < 0.2)
    const baseline = main.reduce((sum, b) => sum + b.baseline, 0) / main.length

    let text = ''
    let right = -Infinity
    for (const box of group) {
      if (text && box.x - right > 0.15 * size && !text.endsWith(' ')) text += ' '
      text += box.str
      right = Math.max(right, box.x + box.width)
    }

    lines.push({
      x0: group[0]!.x,
      x1: right,
      baseline,
      size,
      font,
      text: text.replace(/\s+/g, ' ').trim(),
    })
  }

  lines.sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0)
  return lines
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0)

/** The page's usual baseline-to-baseline distance for body text. */
function bodyLeading(lines: Line[], bodySize: number): number {
  const gaps: [number, number][] = []
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i]!
    if (Math.abs(a.size - bodySize) > 0.3) continue
    for (let j = i + 1; j < lines.length; j++) {
      const b = lines[j]!
      const gap = b.baseline - a.baseline
      if (gap < 0.5 * bodySize) continue
      if (gap > 4 * bodySize) break
      const shared = overlap(a.x0, a.x1, b.x0, b.x1)
      if (shared > 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0)) {
        gaps.push([roundTo(gap, 0.5), 1])
        break
      }
    }
  }
  return weightedMode(gaps) ?? 1.2 * bodySize
}

interface OpenBlock {
  lines: Line[]
  x0: number
  x1: number
}

function joinLines(lines: Line[]): string {
  let text = ''
  for (const line of lines) {
    if (!text) text = line.text
    else if (/[a-z]-$/.test(text) && /^[a-z]/.test(line.text)) text = text.slice(0, -1) + line.text
    else text += ' ' + line.text
  }
  return text
}

/**
 * Prose counts as a paragraph when it is long, or when it is set in the page's
 * body type: that picks up a paragraph's last line or two at the top of a
 * column without also picking up headings and footnotes.
 */
function classify(text: string, lineCount: number, bodyType: boolean): BlockKind {
  const visible = text.replace(/\s/g, '')
  const letters = visible.replace(/[^\p{L}]/gu, '')
  if (visible.length === 0 || letters.length / visible.length < 0.7) return 'other'
  const long = lineCount >= 3 && visible.length >= 100
  const fragment = bodyType && visible.length >= 30
  return long || fragment ? 'paragraph' : 'other'
}

type UnorderedBlock = Omit<Block, 'index' | 'column'>

/**
 * Orders blocks the way a reader would: down the left column, then the right,
 * restarting at every block that spans both (title, abstract, wide figure).
 */
function inReadingOrder(blocks: UnorderedBlock[], pageWidth: number): Block[] {
  const middle = pageWidth / 2
  const margin = 0.1 * pageWidth
  const columnOf = (block: UnorderedBlock): Column =>
    block.x0 < middle - margin && block.x1 > middle + margin ? 'full' : (block.x0 + block.x1) / 2 < middle ? 'left' : 'right'

  const ordered: Omit<Block, 'index'>[] = []
  let left: Omit<Block, 'index'>[] = []
  let right: Omit<Block, 'index'>[] = []
  const flush = () => {
    ordered.push(...left, ...right)
    left = []
    right = []
  }

  for (const block of [...blocks].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const column = columnOf(block)
    if (column === 'full') {
      flush()
      ordered.push({ ...block, column })
    } else {
      ;(column === 'left' ? left : right).push({ ...block, column })
    }
  }
  flush()
  return ordered.map((block, index) => ({ ...block, index }))
}

export function buildBlocks(lines: Line[], pageWidth: number): Block[] {
  if (lines.length === 0) return []

  const bodySize = weightedMode(lines.map((l) => [l.size, l.text.length] as [number, number]))!
  const leading = bodyLeading(lines, bodySize)
  const bodyFont = weightedMode(
    lines.filter((l) => Math.abs(l.size - bodySize) < 0.3).map((l) => [l.font, l.text.length] as [string, number]),
  )
  const isBodyType = (line: Line) => line.font === bodyFont && Math.abs(line.size - bodySize) < 0.3

  const open: OpenBlock[] = []
  for (const line of lines) {
    let best: OpenBlock | undefined
    let bestGap = Infinity

    for (const block of open) {
      const last = block.lines[block.lines.length - 1]!
      const size = Math.max(line.size, last.size)
      const gap = line.baseline - last.baseline

      // Same row (another column) or further apart than normal line spacing.
      if (gap <= 0.3 * size) continue
      if (gap > 1.3 * leading * Math.max(1, size / bodySize)) continue
      if (Math.abs(line.size - last.size) > 0.12 * size) continue

      // Text set flush right with a ragged left edge (margin notes, front-page sidebars) lines up on
      // its right edge instead, and its lines start anywhere. A justified paragraph also lines up on
      // the right, so the ragged left edge has to have shown itself before an indent is ignored.
      const rightAligned =
        Math.abs(line.x1 - last.x1) <= 0.5 * size && block.lines.every((l) => Math.abs(l.x1 - block.x1) <= 0.5 * size)
      const [firstLine, secondLine] = block.lines
      const later = block.lines.slice(1).map((l) => l.x0)
      const raggedLeft =
        block.lines.length === 1 ||
        Math.max(...later) - Math.min(...later) > 0.8 * size ||
        Math.abs(secondLine!.x0 - firstLine!.x0) > 3 * size
      const flushRight = rightAligned && raggedLeft

      // Must sit inside the block's column. Unjustified text in the same type may run a little wider.
      const shared = overlap(line.x0, line.x1, block.x0, block.x1)
      if (shared < 0.5 * Math.min(line.x1 - line.x0, block.x1 - block.x0)) continue
      if (line.x0 < block.x0 - (rightAligned ? 12 : 1.5) * size) continue
      if (line.x1 > block.x1 + (last.font === line.font ? 3 : 1.5) * size) continue

      // A lone, shorter line in a different font is a heading, not the paragraph's first line.
      if (block.lines.length === 1 && last.font !== line.font && last.x1 < line.x1 - 2 * size) continue
      // An indented line starts a new paragraph.
      if (line.x0 - last.x0 > 0.8 * size && !flushRight) continue

      if (gap < bestGap) {
        best = block
        bestGap = gap
      }
    }

    if (best) {
      best.lines.push(line)
      best.x0 = Math.min(best.x0, line.x0)
      best.x1 = Math.max(best.x1, line.x1)
    } else {
      open.push({ lines: [line], x0: line.x0, x1: line.x1 })
    }
  }

  const blocks = open.map((block) => {
    const first = block.lines[0]!
    const last = block.lines[block.lines.length - 1]!
    const text = joinLines(block.lines)
    return {
      kind: classify(text, block.lines.length, block.lines.every(isBodyType)),
      x0: block.x0,
      x1: block.x1,
      y0: Math.min(...block.lines.map((l) => l.baseline - ASCENT * l.size), first.baseline),
      y1: last.baseline + DESCENT * last.size,
      text,
      lineCount: block.lines.length,
    }
  })
  return inReadingOrder(blocks, pageWidth)
}

export function detectBlocks(items: TextBox[], pageWidth: number): Block[] {
  return buildBlocks(buildLines(items), pageWidth)
}
