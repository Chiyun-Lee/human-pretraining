import { supabase } from '../lib/supabase'
import { fetchCrossref, type PaperMeta, type Reference } from '../library/bibliography'
import { findFigures } from '../pdf/figureScan'
import type { Box } from '../pdf/figures'
import type { PdfDocument } from '../pdf/pdfjs'
import { invokeClaude } from './invoke'
import { readPageBlocks } from './summarise'

export type FlowKind = 'question' | 'approach' | 'finding' | 'meaning'

/** The whole paper condensed to one slide: a graphical abstract. */
export interface Slide {
  /** The paper's real title, as printed. */
  paper_title: string
  /** A short playful title for the slide. */
  title: string
  takeaway: string
  flow: { kind: FlowKind; text: string }[]
  bullets: string[]
  /** Up to two key figures, cut from the PDF when the slide is drawn. */
  figures?: SlideFigure[]
}

export interface SlideFigure extends Box {
  page: number
  /** A short handwritten callout: what to notice. */
  label: string
}

/** An independent reading of the whole paper that every page's summaries are written against. */
export interface Brief {
  claims: string[]
  evidence: string[]
  weaknesses: string[]
  terms: { term: string; meaning: string }[]
  focus: string
}

export const isBrief = (value: unknown): value is Brief =>
  typeof value === 'object' && value !== null && Array.isArray((value as Brief).claims) && Array.isArray((value as Brief).terms)

/** Whether a stored value is a slide in the current shape (older ones are rewritten). */
export const isSlide = (value: unknown): value is Slide =>
  typeof value === 'object' && value !== null && Array.isArray((value as Slide).flow) && Array.isArray((value as Slide).bullets)

const MAX_CHARS = 150_000

interface PrintedMeta {
  doi: string
  authors: string[]
  year: string
  venue: string
}

export interface Bibliography {
  doi: string | null
  meta: PaperMeta | null
  refs: Reference[] | null
}

/**
 * Looks the paper up in Crossref by DOI for its authors, venue and reference
 * list, and saves them. `printed` is what the paper itself says, used when
 * Crossref does not know the DOI.
 */
export async function saveBibliography(paperId: string, doi: string | null, printed?: PrintedMeta): Promise<Bibliography> {
  const record = doi ? await fetchCrossref(doi).catch(() => null) : null
  const fallback: PaperMeta | null =
    printed && printed.authors.length > 0
      ? { authors: printed.authors, year: Number.parseInt(printed.year, 10) || null, venue: printed.venue || null }
      : null
  const bibliography = { doi, meta: record?.meta ?? fallback, refs: record?.refs ?? null }
  const { error } = await supabase.from('papers').update(bibliography).eq('id', paperId)
  if (error) console.error(error)
  return bibliography
}

/**
 * Has Claude read the whole paper: writes the brief and the slide, and saves
 * both with the paper's real title and bibliographic details.
 */
export async function readPaper(
  doc: PdfDocument,
  paperId: string,
  name: string,
  knownDoi: string | null,
): Promise<{ brief: Brief; slide: Slide; bibliography: Bibliography }> {
  let text = ''
  let front = ''
  for (let pageNumber = 1; pageNumber <= doc.numPages && text.length < MAX_CHARS; pageNumber++) {
    const blocks = await readPageBlocks(doc, pageNumber)
    if (pageNumber === 1) front = blocks.map((b) => b.text).join('\n').slice(0, 4000)
    text += blocks.filter((b) => b.kind === 'paragraph').map((b) => b.text).join('\n\n') + '\n\n'
  }

  // Claude ranks the figures by their captions; the slide shows the first two whose picture was found.
  const found = (await findFigures(doc)).filter((figure) => figure.box)
  const figures = found.map((figure) => ({ id: figure.id, caption: figure.caption.slice(0, 400) }))

  const reply = await invokeClaude<{
    meta: PrintedMeta
    brief: Brief
    slide: Slide & { figures: { id: string; label: string }[] }
  }>('slide', { name, text: text.slice(0, MAX_CHARS), figures, front })
  const picked: SlideFigure[] = []
  for (const choice of reply.slide.figures ?? []) {
    const figure = found.find((candidate) => candidate.id === choice.id)
    if (figure?.box && picked.length < 2) picked.push({ page: figure.page, ...figure.box, label: choice.label })
  }
  const result = { brief: reply.brief, slide: { ...reply.slide, figures: picked } }

  const title = result.slide.paper_title.trim()
  const { error } = await supabase.from('papers').update({ ...result, ...(title && { title }) }).eq('id', paperId)
  if (error) console.error(error) // still usable for this session; it is written again next time

  const printedDoi = reply.meta.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim()
  const bibliography = await saveBibliography(paperId, knownDoi ?? (/^10\.\d{4,9}\/\S+$/.test(printedDoi) ? printedDoi : null), reply.meta)
  return { ...result, bibliography }
}
