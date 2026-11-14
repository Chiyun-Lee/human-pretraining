// Finds where a piece of text sits on a page, from the page's text fragments.
// Pure, so it is unit-tested.
import type { TextBox } from './blocks'
import type { Box } from './figures'

/** The rectangle of characters [from, to) of a fragment, assuming evenly wide characters. */
function span(box: TextBox, from: number, to: number): Box {
  const per = box.width / Math.max(box.str.length, 1)
  return { x0: box.x + from * per, x1: box.x + to * per, y0: box.baseline - 0.8 * box.size, y1: box.baseline + 0.25 * box.size }
}

const letters = (text: string) => text.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '')

/** Joins rectangles on the same line into one. */
function byLine(rects: Box[]): Box[] {
  const lines: Box[] = []
  for (const rect of rects) {
    const line = lines.find((l) => Math.abs(l.y0 - rect.y0) < 2 && rect.x0 <= l.x1 + 12 && rect.x1 >= l.x0 - 12)
    if (line) {
      line.x0 = Math.min(line.x0, rect.x0)
      line.x1 = Math.max(line.x1, rect.x1)
    } else {
      lines.push({ ...rect })
    }
  }
  return lines
}

/**
 * Where a quoted sentence lies among `boxes`, one rectangle per line. Matching ignores case,
 * spacing, punctuation and line-break hyphens, since a quote rarely survives copying exactly;
 * if the whole quote is not found, its opening and closing words are tried. Empty if not found.
 */
export function locateQuote(boxes: TextBox[], quote: string): Box[] {
  const wanted = letters(quote)
  if (wanted.length < 20) return []

  // The page's letters in one string, remembering which fragment and character each came from.
  let haystack = ''
  const origin: { box: number; char: number }[] = []
  boxes.forEach((box, b) => {
    for (let c = 0; c < box.str.length; c++) {
      for (const letter of letters(box.str[c]!)) {
        haystack += letter
        origin.push({ box: b, char: c })
      }
    }
  })

  let start = haystack.indexOf(wanted)
  let end = start + wanted.length
  if (start < 0) {
    const head = wanted.slice(0, 20)
    const tail = wanted.slice(-20)
    start = haystack.indexOf(head)
    const tailAt = start < 0 ? -1 : haystack.indexOf(tail, start)
    // Accept only a span about as long as the quote.
    if (start < 0 || tailAt < 0 || tailAt + tail.length - start > 1.5 * wanted.length) return []
    end = tailAt + tail.length
  }

  const rects: Box[] = []
  let from = origin[start]!
  for (let i = start + 1; i <= end; i++) {
    const here = origin[i]
    const previous = origin[i - 1]!
    if (i === end || here!.box !== previous.box) {
      rects.push(span(boxes[previous.box]!, from.char, previous.char + 1))
      if (here) from = here
    }
  }
  return byLine(rects)
}

export interface Found {
  match: RegExpExecArray
  box: Box
}

/** Every match of `pattern` (a global regular expression) within a single fragment. */
export function findInBoxes(boxes: TextBox[], pattern: RegExp): Found[] {
  const found: Found[] = []
  for (const box of boxes) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(box.str); match; match = pattern.exec(box.str)) {
      if (match[0].length === 0) {
        pattern.lastIndex++
        continue
      }
      found.push({ match, box: span(box, match.index, match.index + match[0].length) })
    }
  }
  return found
}
