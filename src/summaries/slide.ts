import { supabase } from '../lib/supabase'
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

/** Has Claude read the whole paper: writes the brief and the slide, and saves both with the paper's real title. */
export async function readPaper(doc: PdfDocument, paperId: string, name: string): Promise<{ brief: Brief; slide: Slide }> {
  let text = ''
  for (let pageNumber = 1; pageNumber <= doc.numPages && text.length < MAX_CHARS; pageNumber++) {
    const blocks = await readPageBlocks(doc, pageNumber)
    text += blocks.filter((b) => b.kind === 'paragraph').map((b) => b.text).join('\n\n') + '\n\n'
  }

  const result = await invokeClaude<{ brief: Brief; slide: Slide }>('slide', { name, text: text.slice(0, MAX_CHARS) })
  const title = result.slide.paper_title.trim()
  const { error } = await supabase.from('papers').update({ ...result, ...(title && { title }) }).eq('id', paperId)
  if (error) console.error(error) // still usable for this session; it is written again next time
  return result
}
