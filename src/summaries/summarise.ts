// Runs the summarising of a paper: reads the text blocks of each page, sends
// them to Claude in small batches, and saves the resulting regions.
import { supabase } from '../lib/supabase'
import { detectBlocks } from '../pdf/blocks'
import { findFigures } from '../pdf/figureScan'
import type { Box } from '../pdf/figures'
import { pageTextBoxes, type PdfDocument } from '../pdf/pdfjs'
import { ClaudeError, invokeClaude } from './invoke'
import { type Brief, isBrief, isSlide, type Slide } from './slide'
import { buildRegions, type PageBlock, type Region, type SummaryGroup, uncovered } from './regions'

export interface PaperSummaries {
  summarisedPages: number[]
  regions: Region[]
  slide: Slide | null
  brief: Brief | null
}

const REGION_COLUMNS = 'id, show_original, page, x0, y0, x1, y1, kind, bullets, caveat'

export async function fetchSummaries(paperId: string): Promise<PaperSummaries> {
  const [paper, regions] = await Promise.all([
    supabase.from('papers').select('summarised_pages, slide, brief').eq('id', paperId).single(),
    supabase.from('regions').select(REGION_COLUMNS).eq('paper_id', paperId),
  ])
  if (paper.error) throw paper.error
  if (regions.error) throw regions.error
  return {
    summarisedPages: paper.data.summarised_pages,
    regions: regions.data as Region[],
    slide: isSlide(paper.data.slide) ? paper.data.slide : null,
    brief: isBrief(paper.data.brief) ? paper.data.brief : null,
  }
}

/** Discards a paper's summaries and slide so they are written again. */
export async function resetSummaries(paperId: string): Promise<void> {
  const cleared = await supabase.from('regions').delete().eq('paper_id', paperId)
  if (cleared.error) throw cleared.error
  const { error } = await supabase.from('papers').update({ summarised_pages: [], slide: null, brief: null }).eq('id', paperId)
  if (error) throw error
}

/** `todo`: on a second pass, the only text blocks that still need a region. */
async function requestGroups(brief: Brief, blocks: PageBlock[], todo?: string[]): Promise<SummaryGroup[]> {
  const payload = blocks.map((block) => ({
    id: block.id,
    kind: block.kind === 'paragraph' ? 'text' : 'other',
    column: block.column,
    // Non-prose blocks are only there for orientation.
    text: block.kind === 'paragraph' ? block.text : block.text.slice(0, 200),
  }))
  return (await invokeClaude<{ regions: SummaryGroup[] }>('summarise', { brief, blocks: payload, todo })).regions
}

const MAX_BATCH_CHARS = 9000
const MAX_BATCH_PAGES = 3
const PARALLEL_BATCHES = 3

interface Batch {
  pages: number[]
  blocks: PageBlock[]
}

export async function readPageBlocks(doc: PdfDocument, pageNumber: number): Promise<PageBlock[]> {
  const page = await doc.getPage(pageNumber)
  const blocks = detectBlocks(await pageTextBoxes(page), page.getViewport({ scale: 1 }).width)
  return blocks.map((block) => ({ ...block, page: pageNumber, id: `p${pageNumber}b${block.index}` }))
}

/**
 * Summarises every page not yet done, against the paper's brief. Calls `onRegions` as each batch is
 * saved, so the reader fills in progressively.
 */
export async function summarisePaper(
  doc: PdfDocument,
  paperId: string,
  brief: Brief,
  donePages: number[],
  onRegions: (pages: number[], regions: Region[]) => void,
): Promise<void> {
  const done = new Set(donePages)
  const pictures = new Map<string, Box>()
  for (const figure of await findFigures(doc)) if (figure.box) pictures.set(figure.captionBlockId, figure.box)
  const batches: Batch[] = []
  let current: Batch = { pages: [], blocks: [] }
  let currentChars = 0

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const blocks = await readPageBlocks(doc, pageNumber)
    if (done.has(pageNumber)) continue

    const chars = blocks.reduce((sum, b) => sum + (b.kind === 'paragraph' ? b.text.length : 0), 0)
    const full = current.pages.length >= MAX_BATCH_PAGES || currentChars + chars > MAX_BATCH_CHARS
    if (full && current.pages.length > 0) {
      batches.push(current)
      current = { pages: [], blocks: [] }
      currentChars = 0
    }
    current.pages.push(pageNumber)
    current.blocks.push(...blocks)
    currentChars += chars
  }
  if (current.pages.length > 0) batches.push(current)

  const runBatch = async (batch: Batch) => {
    const used = new Set<string>()
    const groups = batch.blocks.length > 0 ? await requestGroups(brief, batch.blocks) : []
    const first = buildRegions(groups, batch.blocks, used, pictures)
    const regions = first.regions

    // One more request for any paragraphs that were skipped or whose group could not be drawn.
    const missed = uncovered(batch.blocks, used)
    if (missed.length > 0) {
      const retry = await requestGroups(brief, batch.blocks, missed.map((block) => block.id))
      const second = buildRegions(retry, batch.blocks, used, pictures)
      regions.push(...second.regions)
      const left = uncovered(batch.blocks, used).length
      if (left > 0) console.info(`Pages ${batch.pages.join(', ')}: ${left} paragraph(s) left as original text`)
    }
    const { data: saved, error } = await supabase.rpc('save_page_summaries', {
      p_paper_id: paperId,
      p_pages: batch.pages,
      p_regions: regions,
    })
    if (error) throw new ClaudeError('Summaries could not be saved. Check your connection.')
    // Read back what is stored (with ids). If another device saved these pages first, this is its version.
    void saved
    const stored = await supabase.from('regions').select(REGION_COLUMNS).eq('paper_id', paperId).in('page', batch.pages)
    onRegions(batch.pages, stored.error ? regions : (stored.data as Region[]))
  }

  // A few batches at a time; the first failure stops the rest from starting.
  const queue = [...batches]
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      try {
        await runBatch(batch)
      } catch (error) {
        queue.length = 0
        throw error
      }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: PARALLEL_BATCHES }, worker))
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) {
    throw failure.reason instanceof ClaudeError ? failure.reason : new ClaudeError('Summarising failed. Try again.')
  }
}

/** Remembers that a note is flipped to the original text (or back). */
export async function setShowOriginal(regionId: string, showOriginal: boolean): Promise<void> {
  const { error } = await supabase.from('regions').update({ show_original: showOriginal }).eq('id', regionId)
  if (error) console.error(error)
}
