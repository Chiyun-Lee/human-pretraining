// Finds a paper's reference list by rule, so that it is masked without being
// sent to Claude. Pure, so it is unit-tested.
import { type Box, boxOf, intersects, type PageBlock, type Region } from './regions'

const HEADING = /^(\d+\.?\s*)?(references|bibliography|references and notes|literature cited|works cited)\.?$/i
/** A heading such as "Appendix", "Supplementary material" or "A Proofs". */
const APPENDIX = /^(appendi(x|ces)|supplement\w*)\b|^[A-Z]\.?\s+[A-Z][A-Za-z-]+(\s+[A-Za-z-]+){0,6}$/
const YEAR = /\b(19|20)\d{2}\b/g

/** Whether a page reads like a list of references: short entries, nearly all naming a year. */
function listsReferences(page: PageBlock[]): boolean {
  const prose = page.filter((block) => block.kind === 'paragraph')
  if (prose.length === 0) return false
  const years = page.reduce((count, block) => count + (block.text.match(YEAR)?.length ?? 0), 0)
  const length = prose.reduce((sum, block) => sum + block.text.length, 0) / prose.length
  return years >= Math.max(3, prose.length / 3) && length < 350
}

/**
 * Ids of the blocks in the reference list: everything after its heading, up to
 * an appendix heading, a later page that no longer reads like references, or the end.
 */
export function referenceBlocks(pages: PageBlock[][]): Set<string> {
  const ids = new Set<string>()
  const all = pages.flat()
  const start = all.findLastIndex((block) => block.kind === 'other' && HEADING.test(block.text.trim()))
  if (start < 0) return ids

  let page = all[start]!.page
  for (const block of all.slice(start + 1)) {
    if (block.kind === 'other' && block.text.length < 80 && APPENDIX.test(block.text.trim())) break
    if (block.page !== page) {
      if (!listsReferences(pages[block.page - 1]!)) break
      page = block.page
    }
    ids.add(block.id)
  }
  return ids
}

/**
 * The masks over the part of the reference list on one page: a single box when
 * that hides nothing else, otherwise one per column (the list often starts
 * partway down the first column of two).
 */
export function referenceRegions(page: PageBlock[], references: Set<string>): Region[] {
  const listed = page.filter((block) => references.has(block.id))
  if (!listed.some((block) => block.kind === 'paragraph')) return []
  const hidesOther = (box: Box) => page.some((block) => !references.has(block.id) && intersects(box, block))

  const whole = boxOf(listed)
  const columns = ['left', 'right', 'full']
    .map((column) => listed.filter((block) => block.column === column))
    .filter((column) => column.some((block) => block.kind === 'paragraph'))
    .map(boxOf)
  const boxes = hidesOther(whole) ? columns.filter((box) => !hidesOther(box)) : [whole]
  return boxes.map((box) => ({ page: listed[0]!.page, ...box, kind: 'detail', bullets: ['References'], caveat: null, sources: null }))
}
