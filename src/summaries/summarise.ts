// Runs the summarising of a paper: reads the text blocks of each page, sends
// them to Claude in small batches, and saves the resulting regions.
import { supabase } from '../lib/supabase'
import { detectBlocks } from '../pdf/blocks'
import { findFigures } from '../pdf/figureScan'
import type { Box } from '../pdf/figures'
import { pageTextBoxes, type PdfDocument } from '../pdf/pdfjs'
import { ClaudeError, invokeClaude } from './invoke'
import type { PaperMeta, Reference } from '../library/bibliography'
import { type Level, levelOf } from './level'
import { type Bibliography, type Brief, isBrief } from './slide'
import { readSlide, type Slide } from './slideShape'
import { referenceBlocks, referenceRegions } from './references'
import { buildRegions, type PageBlock, type Region, type Source, type SummaryGroup, uncovered } from './regions'

export interface PaperSummaries {
  summarisedPages: number[]
  regions: Region[]
  slide: Slide | null
  brief: Brief | null
  /** Who the notes are (or will be) written for. */
  level: Level
  bibliography: Bibliography
}

const REGION_COLUMNS = 'id, show_original, page, x0, y0, x1, y1, kind, bullets, caveat, sources'

export async function fetchSummaries(paperId: string): Promise<PaperSummaries> {
  const [paper, regions] = await Promise.all([
    supabase.from('papers').select('summarised_pages, slide, brief, level, doi, meta, refs').eq('id', paperId).single(),
    supabase.from('regions').select(REGION_COLUMNS).eq('paper_id', paperId),
  ])
  if (paper.error) throw paper.error
  if (regions.error) throw regions.error
  return {
    summarisedPages: paper.data.summarised_pages,
    regions: regions.data as Region[],
    slide: readSlide(paper.data.slide),
    brief: isBrief(paper.data.brief) ? paper.data.brief : null,
    level: levelOf(paper.data.level),
    bibliography: {
      doi: paper.data.doi as string | null,
      meta: paper.data.meta as PaperMeta | null,
      refs: paper.data.refs as Reference[] | null,
    },
  }
}

/** Discards a paper's summaries and slide so they are written again, for the given reader. */
export async function resetSummaries(paperId: string, level: Level): Promise<void> {
  const cleared = await supabase.from('regions').delete().eq('paper_id', paperId)
  if (cleared.error) throw cleared.error
  const { error } = await supabase.from('papers').update({ summarised_pages: [], slide: null, brief: null, level }).eq('id', paperId)
  if (error) throw error
}

/** `todo`: on a second pass, the only text blocks that still need a region. */
async function requestGroups(brief: Brief, level: Level, blocks: PageBlock[], todo?: string[]): Promise<SummaryGroup[]> {
  const payload = blocks.map((block) => ({
    id: block.id,
    kind: block.kind === 'paragraph' ? 'text' : 'other',
    column: block.column,
    // Non-prose blocks are only there for orientation.
    text: block.kind === 'paragraph' ? block.text : block.text.slice(0, 200),
  }))
  return (await invokeClaude<{ regions: SummaryGroup[] }>('summarise', { brief, level, blocks: payload, todo })).regions
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

/** Every page's blocks, and which of them belong to the reference list. */
async function readPaperBlocks(doc: PdfDocument): Promise<{ pages: PageBlock[][]; references: Set<string> }> {
  const pages: PageBlock[][] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) pages.push(await readPageBlocks(doc, pageNumber))
  return { pages, references: referenceBlocks(pages) }
}

/** The paper's body prose, page by page, without the reference list. */
export async function readProse(doc: PdfDocument): Promise<string[]> {
  const { pages, references } = await readPaperBlocks(doc)
  return pages.map((blocks) =>
    blocks
      .filter((block) => block.kind === 'paragraph' && !references.has(block.id))
      .map((block) => block.text)
      .join('\n\n'),
  )
}

/**
 * Summarises every page not yet done, against the paper's brief. Calls `onRegions` as each batch is
 * saved, so the reader fills in progressively. Once `signal` is aborted no further request is made.
 */
export async function summarisePaper(
  doc: PdfDocument,
  paperId: string,
  brief: Brief,
  level: Level,
  donePages: number[],
  onRegions: (pages: number[], regions: Region[]) => void,
  signal: AbortSignal,
): Promise<void> {
  const done = new Set(donePages)
  const pictures = new Map<string, Box>()
  for (const figure of await findFigures(doc)) if (figure.box) pictures.set(figure.captionBlockId, figure.box)
  const { pages, references } = await readPaperBlocks(doc)
  // The reference list is masked by rule; Claude is sent everything else.
  const toSend = (blocks: PageBlock[]) => blocks.filter((block) => !references.has(block.id))
  const batches: Batch[] = []
  let current: Batch = { pages: [], blocks: [] }
  let currentChars = 0

  for (const [i, blocks] of pages.entries()) {
    const pageNumber = i + 1
    if (done.has(pageNumber)) continue

    const chars = toSend(blocks).reduce((sum, b) => sum + (b.kind === 'paragraph' ? b.text.length : 0), 0)
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
    const regions = batch.pages.flatMap((page) => referenceRegions(batch.blocks.filter((block) => block.page === page), references))
    const sent = toSend(batch.blocks)
    const missed = () => uncovered(sent, used)

    if (sent.some((block) => block.kind === 'paragraph')) regions.push(...buildRegions(await requestGroups(brief, level, sent), batch.blocks, used, pictures).regions)

    // One more request for any paragraphs that were skipped or whose group could not be drawn, with only their pages.
    const todo = missed()
    if (todo.length > 0 && !signal.aborted) {
      const retried = sent.filter((block) => todo.some((left) => left.page === block.page))
      const retry = await requestGroups(brief, level, retried, todo.map((block) => block.id))
      regions.push(...buildRegions(retry, batch.blocks, used, pictures).regions)
      const left = missed().length
      if (left > 0) console.info(`Pages ${batch.pages.join(', ')}: ${left} paragraph(s) left as original text`)
    }
    // What comes back is what is stored (with ids). If another device saved these pages first, it is that version.
    const { data: stored, error } = await supabase.rpc('save_page_summaries', {
      p_paper_id: paperId,
      p_pages: batch.pages,
      p_regions: regions,
    })
    if (error) throw new ClaudeError('Summaries could not be saved. Check your connection.')
    onRegions(batch.pages, stored as Region[])
  }

  // A few batches at a time; the first failure, or the reader leaving, stops the rest from starting.
  const queue = [...batches]
  const worker = async () => {
    for (let batch = queue.shift(); batch && !signal.aborted; batch = queue.shift()) {
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

/** Saves new wording for a note, with the source sentences that still apply. */
export async function saveRegionText(regionId: string, bullets: string[], caveat: string | null, sources: Source[] | null): Promise<void> {
  const { error } = await supabase.from('regions').update({ bullets, caveat, sources, edited: true }).eq('id', regionId)
  if (error) throw error
}

/** The prose of the whole paper, with a [page N] marker before each page. */
export async function paperText(doc: PdfDocument, maxChars = 180_000): Promise<string> {
  const prose = await readProse(doc)
  return prose.map((text, i) => `[page ${i + 1}]\n${text}\n\n`).join('').slice(0, maxChars)
}
