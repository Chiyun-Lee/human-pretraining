import { supabase } from '../lib/supabase'
import { fetchCrossref, type PaperMeta, type Reference } from '../library/bibliography'
import type { PdfDocument } from '../pdf/pdfjs'
import { invokeClaude } from './invoke'
import type { Slide } from './slideShape'
import { readPageBlocks } from './summarise'

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

  const result = await invokeClaude<{ meta: PrintedMeta; brief: Brief; slide: Slide }>('slide', { name, text: text.slice(0, MAX_CHARS), front })

  const title = result.slide.paper_title.trim()
  const { error } = await supabase.from('papers').update({ brief: result.brief, slide: result.slide, ...(title && { title }) }).eq('id', paperId)
  if (error) console.error(error) // still usable for this session; it is written again next time

  const printedDoi = result.meta.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim()
  const bibliography = await saveBibliography(paperId, knownDoi ?? (/^10\.\d{4,9}\/\S+$/.test(printedDoi) ? printedDoi : null), result.meta)
  return { brief: result.brief, slide: result.slide, bibliography }
}
