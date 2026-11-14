import { supabase } from '../lib/supabase'
import type { Box } from '../pdf/figures'

/** A highlight the reader made on a page, optionally with a note. */
export interface Annotation {
  id: string
  page: number
  /** One rectangle per highlighted line, in page units. */
  rects: Box[]
  quote: string
  note: string | null
  /** Questions asked about the highlighted text, with Claude's answers. */
  thread: Turn[]
}

export interface Turn {
  role: 'user' | 'claude'
  text: string
}

const COLUMNS = 'id, page, rects, quote, note, thread'

export async function listAnnotations(paperId: string): Promise<Annotation[]> {
  const { data, error } = await supabase.from('annotations').select(COLUMNS).eq('paper_id', paperId).order('created_at')
  if (error) throw error
  return data as Annotation[]
}

export async function addAnnotation(paperId: string, annotation: Omit<Annotation, 'id'>): Promise<Annotation> {
  const { data, error } = await supabase
    .from('annotations')
    .insert({ paper_id: paperId, ...annotation })
    .select(COLUMNS)
    .single()
  if (error) throw error
  return data as Annotation
}

export async function setAnnotationNote(id: string, note: string | null): Promise<void> {
  const { error } = await supabase.from('annotations').update({ note, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function setAnnotationThread(id: string, thread: Turn[]): Promise<void> {
  const { error } = await supabase.from('annotations').update({ thread, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteAnnotation(id: string): Promise<void> {
  const { error } = await supabase.from('annotations').delete().eq('id', id)
  if (error) throw error
}

/** Joins the many small rectangles a text selection produces into one per line. */
export function mergeLineRects(rects: Box[]): Box[] {
  const lines: Box[] = []
  for (const rect of [...rects].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    if (rect.x1 - rect.x0 < 0.5 || rect.y1 - rect.y0 < 0.5) continue
    const height = rect.y1 - rect.y0
    const line = lines.find(
      (l) => Math.min(l.y1, rect.y1) - Math.max(l.y0, rect.y0) > 0.5 * Math.min(height, l.y1 - l.y0) && rect.x0 <= l.x1 + height,
    )
    if (line) {
      line.x0 = Math.min(line.x0, rect.x0)
      line.x1 = Math.max(line.x1, rect.x1)
      line.y0 = Math.min(line.y0, rect.y0)
      line.y1 = Math.max(line.y1, rect.y1)
    } else {
      lines.push({ ...rect })
    }
  }
  return lines
}

export interface PageSelection {
  page: number
  rects: Box[]
  quote: string
  /** Where on screen the selection ends, for placing the toolbar. */
  anchor: { x: number; y: number }
}

/** The current text selection, if it lies in a page's text, in that page's units. */
export function currentSelection(): PageSelection | null {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const frame = start?.closest<HTMLElement>('.page')
  const quote = selection.toString().replace(/\s+/g, ' ').trim()
  if (!frame || !start?.closest('.textLayer') || !quote) return null

  const bounds = frame.getBoundingClientRect()
  const scale = Number(frame.dataset.pageWidth) / bounds.width
  const inPage = [...range.getClientRects()].filter((r) => r.bottom > bounds.top && r.top < bounds.bottom)
  const rects = mergeLineRects(
    inPage.map((r) => ({
      x0: (r.left - bounds.left) * scale,
      y0: (r.top - bounds.top) * scale,
      x1: (r.right - bounds.left) * scale,
      y1: (r.bottom - bounds.top) * scale,
    })),
  )
  const last = inPage[inPage.length - 1]
  if (rects.length === 0 || !last) return null
  return { page: Number(frame.dataset.page), rects, quote: quote.slice(0, 2000), anchor: { x: last.right, y: last.bottom } }
}
