// Finds where a figure's picture sits on the page, given its caption. PDF text
// says nothing about drawings, so this looks at the rendered page: the figure
// is the run of non-text "ink" next to the caption, plus the labels inside it.
import type { Block } from './blocks'

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** One byte per pixel of a rendered page: 1 where something is drawn. */
export interface InkMask {
  data: Uint8Array
  width: number
  height: number
  /** Pixels per page unit. */
  scale: number
}

const CAPTION = /^(?:(?:supplementary|extended data)\s+)?(?:fig(?:ure)?s?\.?|table|scheme)\s*\.?\s*S?\d+/i

export const isCaption = (block: Block) => CAPTION.test(block.text)

// Page units.
const MAX_GAP_TO_CAPTION = 40
const MAX_GAP_INSIDE = 25
const MIN_HEIGHT = 30
const LABEL_REACH = 40

/** The box of the figure or table that `caption` describes, or null if none is found. */
export function figureBox(mask: InkMask, blocks: Block[], caption: Block, pageWidth: number): Box | null {
  const { width, height, scale } = mask
  const px = (value: number) => Math.round(value * scale)

  const without = (hidden: Block[]) => {
    const copy = mask.data.slice()
    for (const block of hidden) {
      const top = Math.max(0, px(block.y0 - 1))
      const bottom = Math.min(height, px(block.y1 + 1))
      const left = Math.max(0, px(block.x0 - 1))
      const right = Math.min(width, px(block.x1 + 1))
      for (let y = top; y < bottom; y++) copy.fill(0, y * width + left, y * width + right)
    }
    return copy
  }

  // Only look in the caption's own column.
  const [bandLeft, bandRight] =
    caption.column === 'full' ? [0, width] : caption.column === 'left' ? [0, px(pageWidth / 2)] : [px(pageWidth / 2), width]

  // Walk away from the caption: reach the first drawn row, then keep going while rows stay close together.
  const extent = (ink: Uint8Array, start: number, step: 1 | -1): [number, number] | null => {
    const rowHasInk = (y: number) => {
      let count = 0
      for (let x = bandLeft; x < bandRight; x++) if (ink[y * width + x] && ++count >= 2) return true
      return false
    }
    let first = -1
    let last = -1
    let gap = 0
    for (let y = start; y >= 0 && y < height; y += step) {
      if (rowHasInk(y)) {
        if (first < 0) first = y
        last = y
        gap = 0
      } else if (++gap > px(first < 0 ? MAX_GAP_TO_CAPTION : MAX_GAP_INSIDE)) {
        break
      }
    }
    if (first < 0 || Math.abs(last - first) < px(MIN_HEIGHT)) return null
    return [Math.min(first, last), Math.max(first, last)]
  }

  // A figure is drawing above its caption: everything that is not text. A table sits below its
  // caption and is mostly text, so there only prose is cleared and the cells count as ink.
  let drawn = without(blocks)
  let rows = extent(drawn, px(caption.y0) - 1, -1)
  if (!rows) {
    drawn = without(blocks.filter((block) => block === caption || block.kind === 'paragraph'))
    rows = extent(drawn, px(caption.y1) + 1, 1)
  }
  if (!rows) return null

  let left = bandRight
  let right = bandLeft
  for (let y = rows[0]; y <= rows[1]; y++) {
    for (let x = bandLeft; x < bandRight; x++) {
      if (!drawn[y * width + x]) continue
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  const box: Box = { x0: left / scale, y0: rows[0] / scale, x1: right / scale, y1: rows[1] / scale }

  // Labels belong to the figure: text that is not prose, inside it or between it and the caption.
  const towardsCaption = box.y1 <= caption.y0 ? { y0: box.y0, y1: caption.y0 } : { y0: caption.y1, y1: box.y1 }
  for (const block of blocks) {
    if (block === caption || block.kind === 'paragraph') continue
    const centreX = (block.x0 + block.x1) / 2
    const centreY = (block.y0 + block.y1) / 2
    const inside = centreY > towardsCaption.y0 - 14 && centreY < towardsCaption.y1 + 14
    if (inside && centreX > box.x0 - LABEL_REACH && centreX < box.x1 + LABEL_REACH) {
      box.x0 = Math.min(box.x0, block.x0)
      box.x1 = Math.max(box.x1, block.x1)
      box.y0 = Math.min(box.y0, block.y0)
      box.y1 = Math.max(box.y1, block.y1)
    }
  }

  const pad = 3
  return { x0: Math.max(0, box.x0 - pad), y0: Math.max(0, box.y0 - pad), x1: box.x1 + pad, y1: box.y1 + pad }
}
