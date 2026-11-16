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
  /**
   * For a block joined from scattered fragments (a displayed equation, the
   * labels of a figure): where the fragments are, since the block's own box
   * also covers whatever lies between them.
   */
  pieces?: Box[]
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

const CAPTION = /^(?:(?:supplementary|extended data)\s+)?(?:fig(?:ure)?s?\.?|table|scheme)\s*\.?\s*S?\d+/i

/** Whether a block is the caption of a figure or table. */
export const isCaption = (block: { text: string }) => CAPTION.test(block.text)

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
 * straight across the gap, which shows it is not a column gutter. Pieces that
 * touch or overlap are one line too: maths set between them (a summation sign
 * with its limits) sits on another baseline and breaks the chain of fragments.
 */
function mergeStretchedLines(groups: TextBox[][]): TextBox[][] {
  const extent = (group: TextBox[]) => ({
    x0: Math.min(...group.map((b) => b.x)),
    x1: Math.max(...group.map((b) => b.x + b.width)),
    baseline: bodyOf(group).baseline,
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
        if (b.x0 < a.x0 || gap > 3 * size) continue
        const bridged = gap <= 0.5 * size || extents.some(
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

/** The size of most of a group's text, and the baseline that text sits on. */
function bodyOf(group: TextBox[]): { size: number; baseline: number } {
  const size = weightedMode(group.map((box) => [roundTo(box.size, 0.1), box.str.length] as [number, number]))!
  // The one most of the text shares, so that a few raised or lowered symbols do not shift it.
  const main = group.filter((box) => Math.abs(box.size - size) < 0.2)
  return { size, baseline: weightedMode(main.map((box) => [box.baseline, box.str.length] as [number, number]))! }
}

/**
 * A large operator (a summation or product sign) is set on a baseline of its
 * own, well above the words around it. That is close enough to the line above
 * to join it, and sometimes to chain two lines into one. Split a group that
 * holds text on two baselines a line apart, and set aside any full-size symbol
 * that is on neither, to be placed by `attachOperators`.
 */
function splitAtOperators(groups: TextBox[][]): TextBox[][] {
  const result: TextBox[][] = []
  for (const group of groups) {
    const { size } = bodyOf(group)
    const words = group.filter((box) => Math.abs(box.size - size) < 0.2 && box.str.trim().length >= 4)
    const upper = Math.min(...words.map((box) => box.baseline))
    if (words.length >= 2 && Math.max(...words.map((box) => box.baseline)) - upper > 0.7 * size) {
      const above = group.filter((box) => box.baseline - upper < 0.25 * size)
      result.push(...splitAtOperators([above, group.filter((box) => !above.includes(box))]))
      continue
    }
    const { baseline } = bodyOf(group)
    const off = (box: TextBox) => box.str.trim().length <= 2 && Math.abs(box.size - size) < 0.2 && Math.abs(box.baseline - baseline) > 0.25 * size
    const strays = words.length > 0 ? group.filter(off) : []
    if (strays.length > 0) result.push(group.filter((box) => !strays.includes(box)), ...strays.map((box) => [box]))
    else result.push(group)
  }
  return result
}

/** Puts a stray operator, and a limit set with it, into the line of words it sits in: the one just below its baseline. */
function attachOperators(groups: TextBox[][]): TextBox[][] {
  const kept = groups.filter((group) => group.reduce((length, box) => length + box.str.trim().length, 0) > 3)
  for (const stray of groups) {
    if (kept.includes(stray)) continue
    const size = Math.max(...stray.map((box) => box.size))
    const baseline = Math.min(...stray.map((box) => box.baseline))
    const centre = (Math.min(...stray.map((box) => box.x)) + Math.max(...stray.map((box) => box.x + box.width))) / 2
    const host = kept.find((group) => {
      const body = bodyOf(group)
      const below = body.baseline - baseline
      return (
        below > 0 &&
        below < 0.85 * size &&
        Math.abs(body.size - size) < 0.2 * size &&
        centre > Math.min(...group.map((box) => box.x)) - size &&
        centre < Math.max(...group.map((box) => box.x + box.width)) + size
      )
    })
    if (host) host.push(...stray)
    else kept.push(stray)
  }
  return kept
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

  const groups = mergeStretchedLines(attachOperators(splitAtOperators([...grouped.values()])))

  const lines: Line[] = []
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x)
    // The baseline of the dominant-size fragments, so super/subscripts do not shift the line.
    const { size, baseline } = bodyOf(group)
    const font = weightedMode(group.map((b) => [b.font, b.str.length] as [string, number]))!

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
  const sideOf = (block: UnorderedBlock): Column =>
    block.x0 < middle - margin && block.x1 > middle + margin ? 'full' : (block.x0 + block.x1) / 2 < middle ? 'left' : 'right'
  // On a page set in one column, a short block (a heading, a centred equation) is not in a column of its own.
  const prose = blocks.filter((block) => block.kind === 'paragraph')
  const narrow = prose.filter((block) => sideOf(block) !== 'full').reduce((sum, block) => sum + block.text.length, 0)
  const oneColumn = prose.length > 0 && narrow < 0.2 * prose.reduce((sum, block) => sum + block.text.length, 0)
  const columnOf = (block: UnorderedBlock): Column => (oneColumn ? 'full' : sideOf(block))

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

const boxAround = (boxes: Box[]): Box => ({
  x0: Math.min(...boxes.map((box) => box.x0)),
  y0: Math.min(...boxes.map((box) => box.y0)),
  x1: Math.max(...boxes.map((box) => box.x1)),
  y1: Math.max(...boxes.map((box) => box.y1)),
})

/**
 * A displayed equation, a table or the labels of a figure reach here as many
 * small blocks: one per fraction bar, brace, limit or cell. This joins the
 * pieces that sit side by side or stacked closely into one block, folds a
 * piece that lies inside a paragraph into that paragraph, and trims a joined
 * block where a tall symbol makes it brush the paragraph above or below.
 */
function joinFragments(blocks: UnorderedBlock[], bodySize: number, pageWidth: number): UnorderedBlock[] {
  const prose = blocks.filter((block) => block.kind === 'paragraph')
  const loose: UnorderedBlock[] = []
  for (const block of blocks) {
    if (block.kind === 'paragraph') continue
    const area = (block.x1 - block.x0) * (block.y1 - block.y0)
    const host = prose.find(
      (p) => Math.max(0, overlap(block.x0, block.x1, p.x0, p.x1)) * Math.max(0, overlap(block.y0, block.y1, p.y0, p.y1)) > 0.6 * area,
    )
    if (host) host.text += ' ' + block.text
    else loose.push(block)
  }

  // Never across the gutter of a two-column page.
  const middle = pageWidth / 2
  const side = (block: Box) => (block.x1 < middle + 0.5 * bodySize ? -1 : block.x0 > middle - 0.5 * bodySize ? 1 : 0)
  const twoColumns = prose.filter((p) => side(p) !== 0).reduce((sum, p) => sum + p.text.length, 0) > 0.2 * prose.reduce((sum, p) => sum + p.text.length, 0)
  const together = (a: UnorderedBlock, b: UnorderedBlock) => {
    if (isCaption(a) || isCaption(b)) return false
    if (twoColumns && side(a) * side(b) < 0) return false
    const across = overlap(a.x0, a.x1, b.x0, b.x1)
    const down = overlap(a.y0, a.y1, b.y0, b.y1)
    const beside = down > 0.3 * Math.min(a.y1 - a.y0, b.y1 - b.y0)
    const close = across > -bodySize && down > -0.5 * bodySize
    return beside || close
  }

  const parent = loose.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let i = 0; i < loose.length; i++) {
    for (let j = i + 1; j < loose.length; j++) if (together(loose[i]!, loose[j]!)) parent[find(i)] = find(j)
  }
  const clusters = new Map<number, UnorderedBlock[]>()
  loose.forEach((block, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), block]))

  const joined = [...clusters.values()].flatMap((members): UnorderedBlock[] => {
    if (members.length === 1) return members
    members.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
    const box = boxAround(members)
    // A tall symbol's box is a guess; do not let it reach into the neighbouring paragraph.
    for (const p of prose) {
      if (overlap(box.x0, box.x1, p.x0, p.x1) <= 0) continue
      const shared = overlap(box.y0, box.y1, p.y0, p.y1)
      if (shared <= 0 || shared > bodySize) continue
      if ((box.y0 + box.y1) / 2 > (p.y0 + p.y1) / 2) box.y0 = p.y1
      else box.y1 = p.y0
    }
    // Pieces that only fit in one box by swallowing prose (cells either side of a caption) stay apart.
    const swallows = prose.some((p) => overlap(box.x0, box.x1, p.x0, p.x1) > 1 && overlap(box.y0, box.y1, p.y0, p.y1) > 1)
    if (swallows) return members
    return [
      {
        kind: 'other',
        ...box,
        text: members.map((member) => member.text).join(' '),
        lineCount: members.reduce((sum, member) => sum + member.lineCount, 0),
        pieces: members.map(({ x0, y0, x1, y1 }) => ({ x0, y0, x1, y1 })),
      },
    ]
  })
  return [...prose, ...joined]
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

  const blocks = open.map((block): UnorderedBlock => {
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
  return inReadingOrder(joinFragments(blocks, bodySize, pageWidth), pageWidth)
}

export function detectBlocks(items: TextBox[], pageWidth: number): Block[] {
  return buildBlocks(buildLines(items), pageWidth)
}
