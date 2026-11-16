// Turns Claude's groups of block ids into rectangles on the page, repairing or
// rejecting any group that could not be drawn as one clean box. Pure, so it is
// unit-tested.
import type { Block } from '../pdf/blocks'

export type RegionKind = 'summary' | 'figure' | 'detail'

export interface Region {
  /** Set once the region is saved. */
  id?: string
  /** The reader has flipped this note back to the original text. */
  show_original?: boolean
  page: number
  x0: number
  y0: number
  x1: number
  y1: number
  /**
   * "summary" replaces text with bullets; "figure" is a note over a caption about the figure above
   * it; "detail" masks skippable text behind one short label.
   */
  kind: RegionKind
  bullets: string[]
  /** Where the evidence falls short of what the passage claims. */
  caveat: string | null
  /** One per bullet: the sentence of the original it rests on. Absent on older summaries. */
  sources?: Source[] | null
}

export type Facet = 'goal' | 'method' | 'result' | 'other'

export interface Source {
  quote: string
  facet: Facet
}

export interface PageBlock extends Block {
  /** Identifier sent to Claude, unique within the paper. */
  id: string
  page: number
}

export interface SummaryGroup {
  blocks: string[]
  kind: RegionKind
  bullets: string[]
  sources?: Source[]
  caveat: string
}

export type Box = Pick<Region, 'x0' | 'y0' | 'x1' | 'y1'>

export const intersects = (a: Box, b: Box, slack = 1) =>
  a.x0 + slack < b.x1 && b.x0 + slack < a.x1 && a.y0 + slack < b.y1 && b.y0 + slack < a.y1

export const boxOf = (members: PageBlock[]): Box => ({
  x0: Math.min(...members.map((m) => m.x0)),
  y0: Math.min(...members.map((m) => m.y0)),
  x1: Math.max(...members.map((m) => m.x1)),
  y1: Math.max(...members.map((m) => m.y1)),
})

const area = (box: Box) => (box.x1 - box.x0) * (box.y1 - box.y0)

/**
 * `used` holds the ids of blocks already covered; it is added to, so a second
 * pass over the same blocks cannot cover one twice.
 */
export function buildRegions(
  groups: SummaryGroup[],
  blocks: PageBlock[],
  used = new Set<string>(),
  /** Where each figure's picture is, by the id of its caption block. */
  pictures = new Map<string, Box>(),
): { regions: Region[]; dropped: number } {
  const byId = new Map(blocks.map((block) => [block.id, block]))
  const regions: Region[] = []
  let dropped = 0

  for (const group of groups) {
    const kind: RegionKind = group.kind === 'detail' || group.kind === 'figure' ? group.kind : 'summary'
    const written = group.bullets
      .map((bullet, i) => ({ text: bullet.trim(), source: group.sources?.[i] ?? { quote: '', facet: 'other' as const } }))
      .filter((bullet) => bullet.text)
    const bullets = written.map((bullet) => bullet.text)
    const sources = written.map((bullet) => bullet.source)
    const members = [...new Set(group.blocks)].map((id) => byId.get(id))

    const valid =
      bullets.length > 0 &&
      members.length > 0 &&
      members.every((m): m is PageBlock => m !== undefined && !used.has(m.id)) &&
      // Bullets must replace some prose; a detail mask may cover anything (a reference list, a table).
      (kind === 'detail' || members.some((m) => m.kind === 'paragraph'))
    if (!valid) {
      dropped++
      continue
    }

    // A paragraph that runs on into the next column or page cannot be one box:
    // draw one per column, with the note in the largest and a pointer in the rest.
    const parts = new Map<string, PageBlock[]>()
    for (const member of members) {
      const key = `${member.page}/${member.column}`
      parts.set(key, [...(parts.get(key) ?? []), member])
    }
    const boxes = [...parts.values()].map((part) => ({ part, box: boxOf(part) }))
    const main = boxes.reduce((a, b) => (area(b.box) > area(a.box) ? b : a))

    // No box may hide anything Claude did not mean to replace.
    const ids = new Set(members.map((m) => m.id))
    const hidesOther = boxes.some(({ part, box }) =>
      blocks.some((b) => b.page === part[0]!.page && !ids.has(b.id) && intersects(box, b)),
    )
    if (hidesOther) {
      dropped++
      continue
    }

    members.forEach((m) => used.add(m.id))

    // A peripheral figure is masked whole: its picture along with its caption.
    if (kind === 'detail') {
      for (const piece of boxes) {
        const picture = piece.part.map((m) => pictures.get(m.id)).find(Boolean)
        if (!picture) continue
        const whole = {
          x0: Math.min(piece.box.x0, picture.x0),
          y0: Math.min(piece.box.y0, picture.y0),
          x1: Math.max(piece.box.x1, picture.x1),
          y1: Math.max(piece.box.y1, picture.y1),
        }
        const hidesProse = blocks.some(
          (b) => b.page === piece.part[0]!.page && b.kind === 'paragraph' && !ids.has(b.id) && intersects(whole, b),
        )
        if (!hidesProse) piece.box = whole
      }
    }

    for (const piece of boxes) {
      const isMain = piece === main
      const before = boxes.indexOf(piece) < boxes.indexOf(main)
      regions.push({
        page: piece.part[0]!.page,
        ...piece.box,
        kind: isMain ? kind : 'detail',
        bullets: isMain ? (kind === 'detail' ? bullets.slice(0, 1) : bullets) : [before ? 'Continues →' : '← Continued'],
        caveat: isMain && kind !== 'detail' && group.caveat.trim() ? group.caveat.trim() : null,
        sources: isMain && kind === 'summary' && sources.some((source) => source.quote) ? sources : null,
      })
    }
  }
  return { regions, dropped }
}

/** Body paragraphs that no region covers yet. */
export const uncovered = (blocks: PageBlock[], used: Set<string>) =>
  blocks.filter((block) => block.kind === 'paragraph' && block.lineCount >= 2 && !used.has(block.id))
